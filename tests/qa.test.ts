import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID, createHmac } from "node:crypto";
import { buildApp } from "../apps/api/app.js";
import { pool, transaction } from "../packages/database/index.js";
import {
  hash,
  token,
  passwordHash,
  encrypt,
} from "../packages/consent-domain/common.js";
import {
  newUser,
  login,
  beginMfa,
  finishMfa,
  totp,
} from "../packages/consent-domain/auth.js";
import {
  addContact,
  createSubject,
  recordConsent,
} from "../packages/consent-domain/consent.js";
import { enqueue } from "../packages/policy-engine/index.js";
import {
  requestDeletion,
  confirmDeletionTask,
} from "../packages/evidence/index.js";
import { runTenant } from "../apps/worker/jobs.js";
import { pinnedLookup } from "../packages/web-sdk/security.js";
import { fixture, NOW } from "../packages/test-fixtures/index.js";
const app = await buildApp();
after(async () => {
  await app.close();
  await pool.end();
});
const HOST = "127.0.0.1:4310",
  ORIGIN = "http://127.0.0.1:4310";
const key = async (tenant: string, scopes: string[]) => {
  const secret = token();
  await pool.query(
    "INSERT INTO api_keys(id,tenant_id,name,token_hash,scopes) VALUES($1,$2,$3,$4,$5)",
    [randomUUID(), tenant, "qa", hash(secret), scopes],
  );
  return { authorization: "Bearer " + secret, host: HOST };
};
async function ownerSession(tenant: string) {
  const email = `qa-${randomUUID()}@example.test`,
    password = "qa-strong-password-1";
  const user = await newUser(email, password, "QA 소유자");
  await pool.query("INSERT INTO memberships VALUES($1,$2,'owner')", [
    user,
    tenant,
  ]);
  const r = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    headers: { host: HOST, origin: ORIGIN },
    payload: { email, password },
  });
  assert.equal(r.statusCode, 200, r.body);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  return {
    user,
    email,
    headers: { cookie, host: HOST, origin: ORIGIN },
  };
}
const count = (tenant: string, sql: string, params: unknown[] = []) =>
  transaction(tenant, async (db) =>
    Number((await db.query(sql, params)).rows[0].count),
  );

test("QA 오류 응답: 잘못된 JSON·과대 본문·미지원 형식은 503이 아닌 4xx", async () => {
  const f = await fixture(),
    headers = await key(f.tenant, ["consent:write"]);
  const bad = await app.inject({
    method: "POST",
    url: "/v1/consent-events",
    headers: { ...headers, "content-type": "application/json" },
    payload: "{bad json",
  });
  assert.equal(bad.statusCode, 400, bad.body);
  assert.equal(bad.json().code, "INVALID_REQUEST");
  const big = await app.inject({
    method: "POST",
    url: "/v1/consent-events",
    headers: { ...headers, "content-type": "application/json" },
    payload: JSON.stringify({ x: "a".repeat(300000) }),
  });
  assert.equal(big.statusCode, 413);
  assert.equal(big.json().code, "PAYLOAD_TOO_LARGE");
  const media = await app.inject({
    method: "POST",
    url: "/v1/consent-events",
    headers: { ...headers, "content-type": "text/xml" },
    payload: "<a/>",
  });
  assert.equal(media.statusCode, 415);
});

test("QA 보안 헤더: 클릭재킹 차단, 운영 Origin에서는 개발 서버 Origin 거부", async () => {
  const r = await app.inject({ url: "/v1/health", headers: { host: HOST } });
  assert.equal(r.headers["x-frame-options"], "DENY");
  assert.match(String(r.headers["content-security-policy"]), /frame-ancestors 'none'/);
  const previous = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = "https://console.example.test";
  try {
    const prod = await buildApp();
    const denied = await prod.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: { host: "console.example.test", origin: "http://127.0.0.1:5178" },
      payload: {},
    });
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.json().code, "ORIGIN_REQUIRED");
    await prod.close();
  } finally {
    process.env.APP_ORIGIN = previous;
  }
});

test("QA 데모 페이지는 DEMO_MODE가 아니면 제공하지 않는다", async () => {
  assert.equal(process.env.DEMO_MODE, "false");
  for (const url of ["/demo?key=abc", "/demo/tag.js?kind=analytics"])
    assert.equal(
      (await app.inject({ url, headers: { host: HOST } })).statusCode,
      404,
      url,
    );
});

test("QA 로그인: 대소문자 이메일로 만든 구성원도 로그인하고 모르는 계정도 같은 오류", async () => {
  const f = await fixture(),
    owner = await ownerSession(f.tenant),
    email = `Mixed.Case.${randomUUID()}@Example.TEST`;
  const created = await app.inject({
    method: "POST",
    url: "/v1/memberships",
    headers: owner.headers,
    payload: {
      email,
      name: "대소문자 구성원",
      password: "member-strong-password",
      role: "auditor",
    },
  });
  assert.equal(created.statusCode, 200, created.body);
  for (const variant of [email, email.toLowerCase(), " " + email.toUpperCase()])
    assert.ok(await login(variant, "member-strong-password"), variant);
  await assert.rejects(login("nobody-" + randomUUID() + "@example.test", "x"), {
    code: "INVALID_CREDENTIALS",
  });
  const duplicate = await app.inject({
    method: "POST",
    url: "/v1/memberships",
    headers: owner.headers,
    payload: {
      email: email.toUpperCase(),
      name: "중복",
      password: "member-strong-password",
      role: "auditor",
    },
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(
    (
      await pool.query("SELECT count(*) FROM users WHERE email=$1", [
        email.toLowerCase(),
      ])
    ).rows[0].count,
    "1",
  );
  assert.equal(
    await count(
      f.tenant,
      "SELECT count(*) FROM audit_log WHERE action='membership.created'",
    ),
    1,
  );
});

test("QA MFA: 설정된 인증 요소는 세션만으로 교체할 수 없다", async () => {
  const user = await newUser(
    `mfa-${randomUUID()}@example.test`,
    "mfa-strong-password",
    "MFA",
  );
  const { secret } = await beginMfa(user);
  const code = totp(secret, Math.floor(Date.now() / 30000));
  await finishMfa(user, code);
  await assert.rejects(beginMfa(user), { code: "MFA_ALREADY_ENABLED" });
  await assert.rejects(finishMfa(user, code), { code: "MFA_ALREADY_ENABLED" });
  const {
    rows: [u],
  } = await pool.query("SELECT mfa_pending FROM users WHERE id=$1", [user]);
  assert.equal(u.mfa_pending, null);
});

test("QA 서버 키 폐기: 최초 폐기 시각 유지, 없는 키 404, 감사 기록", async () => {
  const f = await fixture(),
    owner = await ownerSession(f.tenant);
  const issued = await app.inject({
    method: "POST",
    url: "/v1/keys",
    headers: owner.headers,
    payload: { name: "qa", scopes: ["read", "decisions"] },
  });
  assert.equal(issued.statusCode, 200, issued.body);
  const list = (await app.inject({ url: "/v1/keys", headers: owner.headers })).json();
  assert.deepEqual(list[0].scopes, ["read", "decisions"]);
  const id = list[0].id;
  const first = await app.inject({
    method: "DELETE",
    url: "/v1/keys/" + id,
    headers: owner.headers,
  });
  assert.equal(first.statusCode, 200, first.body);
  const {
    rows: [before],
  } = await pool.query("SELECT revoked_at FROM api_keys WHERE id=$1", [id]);
  const again = await app.inject({
    method: "DELETE",
    url: "/v1/keys/" + id,
    headers: owner.headers,
  });
  assert.equal(again.json().already, true);
  const {
    rows: [afterRow],
  } = await pool.query("SELECT revoked_at FROM api_keys WHERE id=$1", [id]);
  assert.equal(
    new Date(afterRow.revoked_at).getTime(),
    new Date(before.revoked_at).getTime(),
  );
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url: "/v1/keys/" + randomUUID(),
        headers: owner.headers,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        url: "/v1/me",
        headers: { authorization: "Bearer " + issued.json().secret, host: HOST },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    await count(f.tenant, "SELECT count(*) FROM audit_log WHERE action='api_key.revoked'"),
    1,
  );
});

test("QA 한도·모의 모드 변경은 감사 기록을 남기고 /me가 실제 한도를 반환한다", async () => {
  const f = await fixture(),
    owner = await ownerSession(f.tenant);
  const plan = await app.inject({
    method: "POST",
    url: "/v1/plan",
    headers: owner.headers,
    payload: { ad_limit: 250 },
  });
  assert.equal(plan.json().ad_limit, 250);
  const me = (await app.inject({ url: "/v1/me", headers: owner.headers })).json();
  assert.equal(me.tenants.find((t: any) => t.id === f.tenant).ad_limit, 250);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/connectors/" + randomUUID() + "/mock-mode",
        headers: owner.headers,
        payload: { mode: "reject" },
      })
    ).statusCode,
    404,
  );
  await app.inject({
    method: "POST",
    url: "/v1/connectors/" + f.connector + "/mock-mode",
    headers: owner.headers,
    payload: { mode: "reject" },
  });
  assert.equal(
    await count(
      f.tenant,
      "SELECT count(*) FROM audit_log WHERE action IN ('plan.ad_limit_changed','connector.mock_mode')",
    ),
    2,
  );
});

test("QA 파기·제한 회원에 연락처를 다시 붙일 수 없고, 재등록한 연락처는 암호문을 갱신한다", async () => {
  const f = await fixture();
  // 같은 번호를 비활성 후 다시 등록하면 새 암호문으로 활성화됩니다.
  await transaction(f.tenant, async (db) => {
    await addContact(db, f.ctx, {
      subject_id: f.subject,
      channel: "sms",
      value: "01000007777",
      verified: true,
    });
    await db.query("UPDATE contact_points SET encrypted='stale' WHERE id=$1", [
      f.contact,
    ]);
    const again = await addContact(db, f.ctx, {
      subject_id: f.subject,
      channel: "sms",
      value: "01000009999",
      verified: true,
    });
    assert.equal(again.id, f.contact);
    const {
      rows: [c],
    } = await db.query("SELECT encrypted,active FROM contact_points WHERE id=$1", [
      f.contact,
    ]);
    assert.notEqual(c.encrypted, "stale");
    assert.equal(c.active, true);
  });
  await transaction(f.tenant, async (db) => {
    const d = await requestDeletion(db, f.ctx, f.subject, "본인 요청에 따른 삭제");
    const {
      rows: [task],
    } = await db.query(
      "SELECT id FROM deletion_tasks WHERE request_id=$1 AND system='cmp'",
      [d.id],
    );
    await confirmDeletionTask(db, f.ctx, task.id, "자체 연락처 암호문 파기 확인");
  });
  const headers = await key(f.tenant, ["consent:write"]);
  const r = await app.inject({
    method: "POST",
    url: "/v1/contacts",
    headers,
    payload: {
      subject_id: f.subject,
      channel: "sms",
      value: "01000009999",
      verified: true,
    },
  });
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(r.json().code, "SUBJECT_RESTRICTED");
  assert.equal(
    await count(
      f.tenant,
      "SELECT count(*) FROM contact_points WHERE subject_id=$1 AND active",
      [f.subject],
    ),
    0,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/subjects",
        headers,
        payload: { external_id: "deleted:" + randomUUID() },
      })
    ).statusCode,
    400,
  );
});

test("QA 삭제: 중복 요청·파기 회원 재요청·확인 완료 작업 재확인 거부", async () => {
  const f = await fixture(),
    headers = await key(f.tenant, ["deletion:write"]);
  const request = (reason: string) =>
    app.inject({
      method: "POST",
      url: "/v1/deletion-requests",
      headers,
      payload: { subject_id: f.subject, reason, identity_verified: true },
    });
  assert.equal((await request("본인 확인 후 삭제 요청")).statusCode, 200);
  const dup = await request("같은 회원의 두 번째 요청");
  assert.equal(dup.statusCode, 409);
  assert.equal(dup.json().code, "DELETION_ALREADY_REQUESTED");
  const tasks = await transaction(f.tenant, async (db) =>
    (await db.query("SELECT id,system FROM deletion_tasks")).rows,
  );
  const cmp = tasks.find((t) => t.system === "cmp")!;
  const confirm = () =>
    app.inject({
      method: "POST",
      url: "/v1/deletion-tasks/" + cmp.id + "/confirm",
      headers,
      payload: { evidence: "자체 DB 연락처 파기 결과 확인" },
    });
  assert.equal((await confirm()).statusCode, 200);
  const again = await confirm();
  assert.equal(again.statusCode, 409);
  assert.equal(again.json().code, "TASK_ALREADY_CONFIRMED");
  assert.equal(
    await count(f.tenant, "SELECT count(*) FROM deletion_journal WHERE subject_id=$1", [
      f.subject,
    ]),
    1,
  );
  for (const t of tasks.filter((t) => t.system !== "cmp"))
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/deletion-tasks/" + t.id + "/confirm",
          headers,
          payload: { evidence: "외부 시스템 삭제 결과 확인" },
        })
      ).statusCode,
      200,
    );
  const erased = await request("파기 완료 후 다시 요청");
  assert.equal(erased.statusCode, 409);
  assert.equal(erased.json().code, "SUBJECT_ALREADY_DELETED");
});

test("QA 보유기간 파기 거부는 409와 사유 코드로 응답한다", async () => {
  const f = await fixture(),
    headers = await key(f.tenant, ["deletion:write"]);
  const r = await app.inject({
    method: "POST",
    url: "/v1/retention-purge",
    headers,
    payload: { subject_id: f.subject },
  });
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(r.json().code, "RETENTION_POLICY_REQUIRED");
  const past = await app.inject({
    method: "POST",
    url: "/v1/holds",
    headers,
    payload: {
      subject_id: f.subject,
      basis: "분쟁 대응을 위한 보존 요청",
      until_at: "2020-01-01T00:00:00Z",
    },
  });
  assert.equal(past.json().code, "HOLD_IN_PAST");
  const hold = await app.inject({
    method: "POST",
    url: "/v1/holds",
    headers,
    payload: {
      subject_id: f.subject,
      basis: "분쟁 대응을 위한 보존 요청",
      until_at: new Date(Date.now() + 86400000).toISOString(),
    },
  });
  assert.equal(hold.statusCode, 200, hold.body);
  assert.equal(
    await count(f.tenant, "SELECT count(*) FROM audit_log WHERE action='hold.created'"),
    1,
  );
});

test("QA 이관: CSV 오류는 400, 기존 회원은 미리보기에 표시하고 확정을 거부한다", async () => {
  const f = await fixture(),
    headers = await key(f.tenant, ["consent:write"]);
  const broken = await app.inject({
    method: "POST",
    url: "/v1/import",
    headers,
    payload: { csv: 'external_id,phone,state\n"unterminated,01000001111,granted' },
  });
  assert.equal(broken.statusCode, 400, broken.body);
  assert.equal(broken.json().code, "CSV_INVALID");
  const csvText =
    "external_id,phone,state\nfixture-member,01000006666,granted\nqa-new-member,01000006667,denied";
  const preview = await app.inject({
    method: "POST",
    url: "/v1/import",
    headers,
    payload: { csv: csvText },
  });
  assert.equal(preview.json().existing, 1);
  assert.deepEqual(preview.json().existing_ids, ["fixture-member"]);
  const commit = await app.inject({
    method: "POST",
    url: "/v1/import",
    headers,
    payload: { csv: csvText, commit: true },
  });
  assert.equal(commit.statusCode, 409);
  assert.equal(commit.json().code, "IMPORT_MEMBERS_EXIST");
  await transaction(f.tenant, async (db) => {
    const {
      rows: [c],
    } = await db.query("SELECT active,verified FROM contact_points WHERE id=$1", [
      f.contact,
    ]);
    assert.deepEqual(c, { active: true, verified: true });
    assert.equal(
      (await db.query("SELECT count(*) FROM subjects WHERE external_id='qa-new-member'"))
        .rows[0].count,
      "0",
    );
  });
});

test("QA 브리지 수신거부는 이미 철회된 동의에 처리결과 통지를 다시 만들지 않는다", async () => {
  process.env.PROVIDER_BRIDGE_SECRET = "isolated-test-bridge-secret";
  const f = await fixture();
  await transaction(f.tenant, (db) =>
    recordConsent(
      db,
      f.ctx,
      {
        subject_id: f.subject,
        contact_id: f.contact,
        purpose_id: f.purposes.ad_sms,
        action: "revoked",
        idempotency_key: "qa-pre-revoke",
      },
      { now: NOW },
    ),
  );
  const notices = () =>
    count(f.tenant, "SELECT count(*) FROM notification_jobs WHERE kind='processing_result'");
  const before = await notices();
  const payload = {
      tenant_id: f.tenant,
      event_id: "qa-optout-" + randomUUID(),
      kind: "optout",
      contact_id: f.contact,
    },
    stamp = String(Math.floor(Date.now() / 1000));
  const r = await app.inject({
    method: "POST",
    url: "/v1/provider-events/bridge",
    headers: {
      host: HOST,
      "x-cmp-timestamp": stamp,
      "x-cmp-signature": createHmac("sha256", process.env.PROVIDER_BRIDGE_SECRET)
        .update(stamp + "." + JSON.stringify(payload))
        .digest("hex"),
    },
    payload,
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(await notices(), before);
});

test("QA 웹 SDK: 잘못된 Origin/Referer는 403, 익명 조회는 행을 만들지 않고, 미설정 목적 허용은 거부", async () => {
  const f = await fixture(),
    site = randomUUID(),
    publicKey = f.tenant + "." + token();
  await transaction(f.tenant, async (db) => {
    await db.query(
      "INSERT INTO sites(tenant_id,id,controller_id,domain,verification_token,verified_at,public_key) VALUES($1,$2,$3,'qa.example.test','t',now(),$4)",
      [f.tenant, site, f.controller, publicKey],
    );
    await db.query(
      "INSERT INTO web_configs(tenant_id,id,site_id,version,notice,tags,status,published_at) VALUES($1,$2,$3,1,'웹 분석과 광고를 선택하세요.','[]','published',now())",
      [f.tenant, randomUUID(), site],
    );
  });
  const url = "/v1/web/config?key=" + publicKey;
  for (const headers of [
    { host: HOST, origin: "null" },
    { host: HOST, referer: "not a url" },
    { host: HOST, origin: "https://qa.example.test.evil.test" },
  ])
    assert.equal((await app.inject({ url, headers })).statusCode, 403);
  const browsers = () =>
    count(f.tenant, "SELECT count(*) FROM subjects WHERE kind='browser'");
  const headers = { host: HOST, origin: "https://qa.example.test" };
  for (let i = 0; i < 3; i++)
    assert.equal((await app.inject({ url, headers })).statusCode, 200);
  assert.equal(await browsers(), 0);
  const config = (await app.inject({ url, headers })).json();
  // 서명은 전송된 원문 그대로 검증합니다. 한 글자라도 바뀌면 새 방문자로 취급합니다.
  const tampered = config.session.slice(0, -2) + (config.session.endsWith("A") ? "BB" : "AA");
  const choice = (session: string, choices: object) =>
    app.inject({
      method: "POST",
      url: "/v1/web/consent",
      headers,
      payload: {
        key: publicKey,
        session,
        version: 1,
        choices,
        idempotency_key: randomUUID(),
      },
    });
  assert.equal(
    (await choice(tampered, { analytics: false, advertising: false })).statusCode,
    401,
  );
  assert.equal(
    (await choice(config.session, { analytics: true, advertising: false })).statusCode,
    200,
  );
  assert.equal(await browsers(), 1);
  // 광고 목적이 없는 사업자라면 광고 허용은 조용히 무시하지 않고 거부합니다.
  await transaction(f.tenant, async (db) => {
    await db.query(
      "UPDATE purposes SET key='advertising_retired' WHERE id=$1",
      [f.purposes.advertising],
    );
  });
  const missing = await choice(config.session, { analytics: true, advertising: true });
  assert.equal(missing.statusCode, 409, missing.body);
  assert.equal(missing.json().code, "PURPOSE_NOT_CONFIGURED");
  assert.equal(
    (await choice(config.session, { analytics: false, advertising: false })).statusCode,
    200,
  );
});

test("QA 워커: 한 작업의 복호화 실패가 테넌트의 다른 발송을 멈추지 않는다", async () => {
  const f = await fixture();
  const jobs = await transaction(f.tenant, async (db) => {
    const s = await createSubject(db, f.ctx, { external_id: "qa-second" }),
      c = await addContact(db, f.ctx, {
        subject_id: s.id,
        channel: "sms",
        value: "01000005555",
        verified: true,
      });
    for (const [purpose, contact] of [
      ["marketing_use", null],
      ["ad_sms", c.id],
    ] as const)
      await recordConsent(
        db,
        f.ctx,
        {
          subject_id: s.id,
          contact_id: contact,
          purpose_id: f.purposes[purpose],
          notice_id: f.notices[purpose],
          action: "granted",
          occurred_at: "2026-09-29T01:00:00Z",
          idempotency_key: "qa-second:" + purpose,
        },
        { now: NOW },
      );
    const broken = await enqueue(
      db,
      f.ctx,
      { ...f.input, idempotency_key: "qa-broken" },
      NOW,
    );
    const ok = await enqueue(
      db,
      f.ctx,
      {
        subject_id: s.id,
        contact_id: c.id,
        template_id: f.template,
        idempotency_key: "qa-ok",
      },
      new Date(NOW.getTime() + 1000),
    );
    assert.equal(broken.status, "queued");
    assert.equal(ok.status, "queued");
    // 이 검증에서는 발송 작업만 비교하도록 자동 통지는 제외합니다.
    await db.query("UPDATE notification_jobs SET status='cancelled'");
    // 복원 사고 등으로 암호문이 손상된 연락처를 재현합니다.
    await db.query("UPDATE contact_points SET encrypted='' WHERE id=$1", [
      f.contact,
    ]);
    return { broken: broken.id, ok: ok.id };
  });
  const r = await runTenant(f.tenant, new Date(NOW.getTime() + 5000));
  assert.deepEqual(r, { accepted: 1, blocked: 0, failed: 1 });
  await transaction(f.tenant, async (db) => {
    const status = async (id: string) =>
      (
        await db.query("SELECT status,reasons FROM message_jobs WHERE id=$1", [
          id,
        ])
      ).rows[0];
    assert.deepEqual(await status(jobs.broken), {
      status: "blocked",
      reasons: ["DISPATCH_PREPARATION_FAILED"],
    });
    assert.equal((await status(jobs.ok)).status, "delivered");
    assert.equal(
      (
        await db.query(
          "SELECT count(*) FROM provider_receipts WHERE job_id=$1",
          [jobs.broken],
        )
      ).rows[0].count,
      "0",
    );
  });
});

test("QA 워커: 재시도 통지의 멱등 충돌이 다른 통지와 접수 조정을 되돌리지 않는다", async () => {
  const f = await fixture();
  const ids = await transaction(f.tenant, async (db) => {
    await recordConsent(
      db,
      f.ctx,
      {
        subject_id: f.subject,
        contact_id: f.contact,
        purpose_id: f.purposes.ad_sms,
        action: "revoked",
        idempotency_key: "qa-notice-revoke",
      },
      { now: NOW },
    );
    const { rows } = await db.query(
      "SELECT id FROM notification_jobs WHERE kind='processing_result' AND status='pending' ORDER BY due_at,id",
    );
    assert.equal(rows.length, 2);
    // 담당자가 다시 대기로 돌린 통지: 이전 시도의 발송 작업이 같은 멱등 키로 남아 있습니다.
    await db.query(
      "INSERT INTO message_jobs(tenant_id,id,subject_id,contact_id,template_id,idempotency_key,payload_hash,status,scheduled_at) VALUES($1,$2,$3,$4,$5,$6,'earlier-attempt','cancelled',now())",
      [
        f.tenant,
        randomUUID(),
        f.subject,
        f.contact,
        f.template,
        "notice:" + rows[0].id,
      ],
    );
    // 같은 유지보수 트랜잭션에서 처리되는 접수 결과 조정 대상입니다.
    const unknownJob = randomUUID();
    await db.query(
      "INSERT INTO message_jobs(tenant_id,id,subject_id,contact_id,template_id,idempotency_key,payload_hash,status,scheduled_at) VALUES($1,$2,$3,$4,$5,'qa-unknown','x','unknown',now())",
      [f.tenant, unknownJob, f.subject, f.contact, f.template],
    );
    await db.query(
      "INSERT INTO provider_receipts(tenant_id,job_id,provider_id,status) VALUES($1,$2,'mock_qa','delivered')",
      [f.tenant, unknownJob],
    );
    return { conflicted: rows[0].id, healthy: rows[1].id, unknownJob };
  });
  await runTenant(f.tenant, NOW);
  await transaction(f.tenant, async (db) => {
    const status = async (table: string, id: string) =>
      (await db.query(`SELECT status FROM ${table} WHERE id=$1`, [id])).rows[0]
        .status;
    assert.equal(
      await status("notification_jobs", ids.conflicted),
      "manual_required",
    );
    assert.equal(await status("notification_jobs", ids.healthy), "delivered");
    assert.equal(await status("message_jobs", ids.unknownJob), "delivered");
  });
});

test("QA 트랜잭션: DB 연결이 끊겨도 프로세스는 유지되고 원래 오류로 실패한다", async () => {
  const f = await fixture();
  const admin = (await import("pg")).default;
  const killer = new admin.Client({ host: process.env.PGHOST ?? "/tmp", database: "postgres" });
  await killer.connect();
  try {
    await assert.rejects(
      transaction(f.tenant, async (db) => {
        const {
          rows: [{ pid }],
        } = await db.query("SELECT pg_backend_pid() AS pid");
        await killer.query("SELECT pg_terminate_backend($1)", [pid]);
        await new Promise((r) => setTimeout(r, 200));
        await db.query("SELECT 1");
      }),
    );
    assert.equal((await pool.query("SELECT 1 AS ok")).rows[0].ok, 1);
  } finally {
    await killer.end();
  }
});

test("QA 설치 검사 고정 조회는 Node 22 autoSelectFamily(all:true) 호출에도 검증 주소만 사용한다", async () => {
  const server = http.createServer((_q, s) => s.end("ok"));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  const seen: any[] = [];
  const lookup = pinnedLookup("127.0.0.1");
  const status = await new Promise<number>((resolve, reject) => {
    http
      .get(
        {
          hostname: "pinned.invalid",
          port,
          path: "/",
          lookup: (h: string, o: any, cb: any) => {
            seen.push(o);
            lookup(h, o, cb);
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      )
      .on("error", reject);
  });
  server.close();
  assert.equal(status, 200);
  assert.ok(seen.some((o) => o?.all === true));
  const single: any[] = [];
  lookup("x", {}, (...args: any[]) => single.push(args));
  assert.deepEqual(single[0], [null, "127.0.0.1", 4]);
});

test("QA 현황: 회원은 목적이 여러 개여도 한 줄이며 증빙 미확인은 동의 상태만 센다", async () => {
  const f = await fixture(),
    owner = await ownerSession(f.tenant);
  await transaction(f.tenant, async (db) => {
    const extra = randomUUID(),
      notice = randomUUID();
    await db.query(
      "INSERT INTO purposes(tenant_id,id,controller_id,key,name,kind,channel,reviewed) VALUES($1,$2,$3,'ad_sms_partner','제휴 문자 광고','advertising_reception','sms',true)",
      [f.tenant, extra, f.controller],
    );
    await db.query(
      "INSERT INTO notices(tenant_id,id,purpose_id,version,body,hash,status,published_at) VALUES($1,$2,$3,1,'제휴 광고 수신에 동의하며 언제든 철회할 수 있습니다.',$4,'published',now())",
      [f.tenant, notice, extra, hash("partner")],
    );
    await recordConsent(
      db,
      f.ctx,
      {
        subject_id: f.subject,
        contact_id: f.contact,
        purpose_id: extra,
        action: "denied",
        idempotency_key: "qa-partner-deny",
      },
      { now: NOW },
    );
    await recordConsent(
      db,
      f.ctx,
      {
        subject_id: f.subject,
        contact_id: f.contact,
        purpose_id: f.purposes.ad_sms,
        action: "revoked",
        idempotency_key: "qa-revoke-main",
      },
      { now: NOW, legacy: true },
    );
  });
  const o = (await app.inject({ url: "/v1/overview", headers: owner.headers })).json();
  const rows = o.subjects.filter((s: any) => s.id === f.subject);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, "REVOKED");
  assert.equal(o.stats.unverified, 0);
});

test("QA 게시·승인 재요청은 멱등이고, 검수 실패 사유는 구조화해 반환한다", async () => {
  const f = await fixture(),
    owner = await ownerSession(f.tenant);
  const draft = await app.inject({
    method: "POST",
    url: "/v1/templates",
    headers: owner.headers,
    payload: {
      controller_id: f.controller,
      purpose_id: f.purposes.ad_sms,
      name: "검수 미완료",
      body: "광고 표시가 없는 본문",
    },
  });
  assert.ok(draft.json().issues.includes("AD_LABEL_REQUIRED"));
  const approve = await app.inject({
    method: "POST",
    url: "/v1/templates/" + draft.json().id + "/approve",
    headers: owner.headers,
    payload: {},
  });
  assert.equal(approve.statusCode, 400);
  assert.equal(approve.json().code, "TEMPLATE_REVIEW_REQUIRED");
  assert.ok(approve.json().details.includes("FREE_OPTOUT_REQUIRED"));
  const approved = await app.inject({
    method: "POST",
    url: "/v1/templates/" + f.template + "/approve",
    headers: owner.headers,
    payload: {},
  });
  assert.equal(approved.json().already, true);
  const notice = await app.inject({
    method: "POST",
    url: "/v1/notices/" + f.notices.ad_sms + "/publish",
    headers: owner.headers,
    payload: {},
  });
  assert.deepEqual(notice.json(), { ok: true, already: true });
});

test("QA 사이트 중복 등록은 409, 태그 id 중복은 400", async () => {
  const f = await fixture(),
    owner = await ownerSession(f.tenant);
  const add = () =>
    app.inject({
      method: "POST",
      url: "/v1/sites",
      headers: owner.headers,
      payload: { controller_id: f.controller, domain: "dup.example.test" },
    });
  const first = await add();
  assert.equal(first.statusCode, 200, first.body);
  const second = await add();
  assert.equal(second.statusCode, 409);
  assert.equal(second.json().code, "SITE_EXISTS");
  await transaction(f.tenant, (db) =>
    db.query("UPDATE sites SET verified_at=now() WHERE id=$1", [first.json().id]),
  );
  const tag = {
    id: "same",
    name: "tag",
    purpose: "analytics",
    type: "script",
    src: "https://cdn.example.test/a.js",
  };
  const r = await app.inject({
    method: "POST",
    url: "/v1/web-configs",
    headers: owner.headers,
    payload: { site_id: first.json().id, notice: "배너 문구 검증입니다.", tags: [tag, tag] },
  });
  assert.equal(r.statusCode, 400);
});

test("QA API 키로는 세션 테넌트를 전환할 수 없다", async () => {
  const f = await fixture(),
    headers = await key(f.tenant, ["read"]);
  const r = await app.inject({
    method: "POST",
    url: "/v1/auth/tenant",
    headers,
    payload: { tenant_id: f.tenant },
  });
  assert.equal(r.statusCode, 403);
});
