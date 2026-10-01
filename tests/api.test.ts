import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { buildApp } from "../apps/api/app.js";
import { pool, transaction } from "../packages/database/index.js";
import { hash, token } from "../packages/consent-domain/common.js";
import { newUser } from "../packages/consent-domain/auth.js";
import { fixture, NOW } from "../packages/test-fixtures/index.js";
import {
  requestDeletion,
  confirmDeletionTask,
  evidence,
} from "../packages/evidence/index.js";
import { exportJournal, applyJournal } from "../packages/evidence/recovery.js";
const app = await buildApp();
after(async () => {
  await app.close();
  await pool.end();
});
const key = async (tenant: string, scopes: string[]) => {
  const secret = token();
  await pool.query(
    "INSERT INTO api_keys(id,tenant_id,name,token_hash,scopes) VALUES($1,$2,$3,$4,$5)",
    [randomUUID(), tenant, "test", hash(secret), scopes],
  );
  return { authorization: "Bearer " + secret, host: "127.0.0.1:4310" };
};
test("API: 로그인, 세션 테넌트 결정, Origin 검증 및 로그아웃", async () => {
  const f = await fixture(),
    email = randomUUID() + "@example.test",
    u = await newUser(email, "strong-test-password", "테스트");
  await pool.query("INSERT INTO memberships VALUES($1,$2,'owner')", [
    u,
    f.tenant,
  ]);
  const login = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    headers: { host: "127.0.0.1:4310", origin: "http://127.0.0.1:4310" },
    payload: { email, password: "strong-test-password" },
  });
  assert.equal(login.statusCode, 200, login.body);
  const cookie = String(login.headers["set-cookie"]).split(";")[0];
  assert.match(String(login.headers["set-cookie"]), /HttpOnly/);
  const headers = { cookie, host: "127.0.0.1:4310" };
  const me = await app.inject({ url: "/v1/me", headers });
  assert.equal(me.json().ctx.tenant, f.tenant);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/auth/logout",
        headers: { ...headers, origin: "https://evil.example" },
        payload: {},
      })
    ).statusCode,
    403,
  );
  await app.inject({
    method: "POST",
    url: "/v1/auth/logout",
    headers: { ...headers, origin: "http://127.0.0.1:4310" },
    payload: {},
  });
  assert.equal((await app.inject({ url: "/v1/me", headers })).statusCode, 401);
});
test("T12 HTTP 키의 범위 및 다른 테넌트 증빙·회원 조회를 차단한다", async () => {
  const a = await fixture(),
    b = await fixture(),
    headers = await key(a.tenant, ["read", "evidence:read"]);
  assert.equal(
    (await app.inject({ url: "/v1/evidence/" + b.subject, headers }))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        url: "/v1/subjects/" + b.subject + "/preferences",
        headers,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/consent-events",
        headers,
        payload: {},
      })
    ).statusCode,
    403,
  );
  const good = await app.inject({ url: "/v1/evidence/" + a.subject, headers });
  assert.equal(good.statusCode, 200);
  assert.ok(good.json().events.length);
});
test("본문 tenant_id로 테넌트 교체 불가, 알림톡 is_ad=false 우회 불가", async () => {
  const f = await fixture(),
    headers = await key(f.tenant, ["consent:write", "messages:send"]);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/consent-events",
        headers,
        payload: {
          tenant_id: f.tenant,
          subject_id: f.subject,
          purpose_id: f.purposes.ad_sms,
          action: "revoked",
          idempotency_key: "injection",
        },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/messages",
        headers,
        payload: { ...f.input, idempotency_key: "ad", is_ad: false },
      })
    ).statusCode,
    400,
  );
});
test("서명된 연락처 한정 링크는 추가 동의 없이 철회하며 재전송은 멱등이다", async () => {
  const f = await fixture(),
    headers = await key(f.tenant, ["consent:write"]);
  const link = await app.inject({
    method: "POST",
    url: "/v1/revoke-links",
    headers,
    payload: {
      subject_id: f.subject,
      contact_id: f.contact,
      purpose_id: f.purposes.ad_sms,
    },
  });
  assert.equal(link.statusCode, 200, link.body);
  const value = new URL(link.json().url).searchParams.get("token");
  for (let i = 0; i < 2; i++) {
    const r = await app.inject({
      method: "POST",
      url: "/v1/preference-actions/revoke",
      headers: { host: "127.0.0.1:4310", origin: "http://127.0.0.1:4310" },
      payload: { token: value },
    });
    assert.equal(r.statusCode, 200, r.body);
    if (i) assert.equal(r.json().duplicate, true);
  }
  const bad = await app.inject({
    method: "POST",
    url: "/v1/preference-actions/revoke",
    headers: { host: "127.0.0.1:4310", origin: "http://127.0.0.1:4310" },
    payload: { token: value + "x" },
  });
  assert.equal(bad.statusCode, 401);
});
test("서명된 공급자 브리지 이벤트: 재전송 제거, 오래된 서명 거부", async () => {
  process.env.PROVIDER_BRIDGE_SECRET = "isolated-test-bridge-secret";
  const f = await fixture(),
    payload = {
      tenant_id: f.tenant,
      event_id: "optout-1",
      kind: "optout",
      contact_id: f.contact,
    },
    stamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", process.env.PROVIDER_BRIDGE_SECRET)
    .update(stamp + "." + JSON.stringify(payload))
    .digest("hex");
  const headers = {
    host: "127.0.0.1:4310",
    "x-cmp-timestamp": stamp,
    "x-cmp-signature": signature,
  };
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/provider-events/bridge",
        headers,
        payload,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/provider-events/bridge",
        headers,
        payload,
      })
    ).json().duplicate,
    true,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/provider-events/bridge",
        headers: { ...headers, "x-cmp-timestamp": "100" },
        payload,
      })
    ).statusCode,
    401,
  );
});
test("T14 이관 미리보기는 쓰지 않고, 승인 이관도 증빙 미검증으로 남긴다", async () => {
  const f = await fixture(),
    headers = await key(f.tenant, ["consent:write"]),
    rows = [
      { external_id: "legacy-import", phone: "01000008888", state: "granted" },
    ];
  const preview = await app.inject({
    method: "POST",
    url: "/v1/import",
    headers,
    payload: { rows },
  });
  assert.equal(preview.json().unverified, 1);
  await transaction(f.tenant, async (db) =>
    assert.equal(
      (
        await db.query(
          "SELECT count(*) FROM subjects WHERE external_id='legacy-import'",
        )
      ).rows[0].count,
      "0",
    ),
  );
  const commit = await app.inject({
    method: "POST",
    url: "/v1/import",
    headers,
    payload: { rows, commit: true },
  });
  assert.equal(commit.statusCode, 200, commit.body);
  await transaction(f.tenant, async (db) =>
    assert.equal(
      (
        await db.query(
          "SELECT evidence FROM consent_events WHERE source='legacy_import'",
        )
      ).rows[0].evidence,
      "LEGACY_UNVERIFIED",
    ),
  );
});
test("T18 삭제 이후 복구된 자료에 외부 보관 삭제 이력을 재적용한다", async () => {
  const f = await fixture();
  await transaction(f.tenant, async (db) => {
    const d = await requestDeletion(
      db,
      f.ctx,
      f.subject,
      "본인 요청에 따른 연락처 삭제",
    );
    const {
      rows: [task],
    } = await db.query(
      "SELECT * FROM deletion_tasks WHERE request_id=$1 AND system='cmp'",
      [d.id],
    );
    await confirmDeletionTask(
      db,
      f.ctx,
      task.id,
      "자체 DB 연락처 암호문 삭제 확인",
    );
  });
  const journal = await exportJournal(f.tenant);
  await transaction(f.tenant, async (db) => {
    await db.query(
      "UPDATE subjects SET restricted=false,deleted_at=NULL WHERE id=$1",
      [f.subject],
    );
    await db.query(
      "UPDATE contact_points SET active=true,verified=true,encrypted='restored-old-value' WHERE id=$1",
      [f.contact],
    );
  });
  assert.equal((await applyJournal(journal)).reapplied, 1);
  await transaction(f.tenant, async (db) => {
    assert.equal(
      (
        await db.query("SELECT restricted FROM subjects WHERE id=$1", [
          f.subject,
        ])
      ).rows[0].restricted,
      true,
    );
    assert.equal(
      (
        await db.query("SELECT encrypted FROM contact_points WHERE id=$1", [
          f.contact,
        ])
      ).rows[0].encrypted,
      "",
    );
  });
  await assert.rejects(applyJournal({ ...journal, signature: "fake" }));
});
test("복원 DB에 없던 삭제 이력은 재적용 후 다시 내보내며 반복 적용은 중복하지 않는다", async () => {
  const f = await fixture();
  assert.equal(
    JSON.parse((await exportJournal(f.tenant)).payload).deletions.length,
    0,
  );
  const data = {
    version: 1,
    tenant: f.tenant,
    deletions: [
      { subject_id: f.subject, deleted_at: "2026-09-30T02:00:00.000Z" },
    ],
  };
  const payload = JSON.stringify(data);
  const journal = {
    payload,
    signature: createHmac("sha256", process.env.SESSION_SECRET!)
      .update(payload)
      .digest("hex"),
  };
  const applied = await Promise.all([
    applyJournal(journal),
    applyJournal(journal),
  ]);
  assert.ok(applied.every((result) => result.reapplied === 1));
  const exported = await exportJournal(f.tenant);
  assert.deepEqual(JSON.parse(exported.payload), data);
  await transaction(f.tenant, async (db) => {
    assert.equal(
      (
        await db.query(
          "SELECT count(*) FROM deletion_journal WHERE subject_id=$1",
          [f.subject],
        )
      ).rows[0].count,
      "1",
    );
    assert.equal(
      (
        await db.query("SELECT encrypted FROM contact_points WHERE id=$1", [
          f.contact,
        ])
      ).rows[0].encrypted,
      "",
    );
  });
});
test("웹 설정은 검증된 Origin에서만 제공되며 사이트 세션으로 SMS를 변경할 수 없다", async () => {
  const f = await fixture(),
    site = randomUUID(),
    publicKey = f.tenant + "." + token();
  await transaction(f.tenant, async (db) => {
    await db.query(
      "INSERT INTO sites(tenant_id,id,controller_id,domain,verification_token,verified_at,public_key) VALUES($1,$2,$3,'shop.example.test','test',now(),$4)",
      [f.tenant, site, f.controller, publicKey],
    );
    await db.query(
      "INSERT INTO web_configs(tenant_id,id,site_id,version,notice,tags,status,published_at) VALUES($1,$2,$3,1,'웹 분석과 광고를 선택하세요.','[]','published',now())",
      [f.tenant, randomUUID(), site],
    );
  });
  const headers = {
    host: "127.0.0.1:4310",
    origin: "https://shop.example.test",
  };
  const config = await app.inject({
    url: "/v1/web/config?key=" + publicKey,
    headers,
  });
  assert.equal(config.statusCode, 200, config.body);
  assert.deepEqual(config.json().choices, {
    analytics: false,
    advertising: false,
  });
  assert.equal(
    (
      await app.inject({
        url: "/v1/web/config?key=" + publicKey,
        headers: { ...headers, origin: "https://evil.example" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/web/consent",
        headers,
        payload: {
          key: publicKey,
          session: config.json().session,
          version: 1,
          choices: { analytics: true, advertising: false },
          idempotency_key: "choice",
        },
      })
    ).statusCode,
    200,
  );
  const reload = await app.inject({
    url:
      "/v1/web/config?key=" + publicKey + "&session=" + config.json().session,
    headers,
  });
  assert.equal(reload.json().choices.analytics, true);
  const browserSubject = JSON.parse(
    Buffer.from(config.json().session.split(".")[0], "base64url").toString(),
  ).subject;
  const receipt = await transaction(f.tenant, (db) =>
    evidence(db, f.ctx, browserSubject),
  );
  assert.equal(receipt.rendered_web_configs.length, 1);
  assert.equal(
    receipt.rendered_web_configs[0].notice,
    "웹 분석과 광고를 선택하세요.",
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/consent-events",
        headers: { ...headers, authorization: "Bearer " + publicKey },
        payload: {},
      })
    ).statusCode,
    401,
  );
});
test("웹 선택 재전송은 단일 원본을 유지하고 철회 뒤 과거 허용 재전송은 태그를 허용하지 않는다", async () => {
  const f = await fixture(),
    site = randomUUID(),
    publicKey = f.tenant + "." + token();
  await transaction(f.tenant, async (db) => {
    await db.query(
      "INSERT INTO sites(tenant_id,id,controller_id,domain,verification_token,verified_at,public_key) VALUES($1,$2,$3,'retry.example.test','test',now(),$4)",
      [f.tenant, site, f.controller, publicKey],
    );
    await db.query(
      "INSERT INTO web_configs(tenant_id,id,site_id,version,notice,tags,status,published_at) VALUES($1,$2,$3,1,'분석과 광고 선택','[]','published',now())",
      [f.tenant, randomUUID(), site],
    );
  });
  const headers = {
    host: "127.0.0.1:4310",
    origin: "https://retry.example.test",
  };
  const config = (
    await app.inject({ url: "/v1/web/config?key=" + publicKey, headers })
  ).json();
  const subject = JSON.parse(
    Buffer.from(config.session.split(".")[0], "base64url").toString(),
  ).subject;
  const send = (
    id: string,
    choices: { analytics: boolean; advertising: boolean },
  ) =>
    app.inject({
      method: "POST",
      url: "/v1/web/consent",
      headers,
      payload: {
        key: publicKey,
        session: config.session,
        version: 1,
        choices,
        idempotency_key: id,
      },
    });
  const denied = { analytics: false, advertising: false },
    allowed = { analytics: true, advertising: true };
  const records = () =>
    transaction(f.tenant, async (db) => ({
      events: (
        await db.query(
          "SELECT * FROM consent_events WHERE subject_id=$1 ORDER BY seq",
          [subject],
        )
      ).rows,
      current: (
        await db.query(
          "SELECT state FROM consent_current WHERE subject_id=$1",
          [subject],
        )
      ).rows,
    }));
  const concurrent = await Promise.all(
    Array.from({ length: 8 }, () => send("initial-refusal", denied)),
  );
  for (const response of concurrent)
    assert.equal(response.statusCode, 200, response.body);
  const first = await records();
  assert.equal(first.events.length, 2);
  const retry = await send("initial-refusal", denied);
  assert.equal(retry.statusCode, 200, retry.body);
  assert.deepEqual(await records(), first);
  assert.ok(first.current.every((s) => s.state === "DENIED"));
  assert.equal((await send("initial-refusal", allowed)).statusCode, 409);
  assert.equal((await send("allow", allowed)).statusCode, 200);
  const granted = await records();
  assert.equal((await send("allow", allowed)).statusCode, 200);
  assert.deepEqual(await records(), granted);
  assert.equal((await send("withdraw", denied)).statusCode, 200);
  const revoked = await records();
  assert.equal(revoked.events.length, 6);
  assert.ok(revoked.current.every((s) => s.state === "REVOKED"));
  assert.ok(revoked.events.slice(-2).every((e) => e.action === "revoked"));
  assert.equal((await send("withdraw", denied)).statusCode, 200);
  assert.deepEqual(await records(), revoked);
  const historical = await send("allow", allowed);
  assert.equal(historical.statusCode, 200, historical.body);
  assert.deepEqual(historical.json().choices, denied);
  assert.deepEqual(await records(), revoked);
});
test("약관 수락은 개인정보 및 광고 수신 동의와 다른 원장에 기록된다", async () => {
  const f = await fixture({ sms: false }),
    v = randomUUID();
  await transaction(f.tenant, (db) =>
    db.query(
      "INSERT INTO agreement_versions(tenant_id,id,version,title,body,hash) VALUES($1,$2,1,'서비스 약관','테스트 서비스 약관입니다.',$3)",
      [f.tenant, v, hash("terms")],
    ),
  );
  const headers = await key(f.tenant, ["consent:write"]),
    payload = {
      subject_id: f.subject,
      version_id: v,
      action: "accepted",
      idempotency_key: "terms",
    };
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/agreement-events",
        headers,
        payload,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/agreement-events",
        headers,
        payload,
      })
    ).json().duplicate,
    true,
  );
  await transaction(f.tenant, async (db) =>
    assert.equal(
      (
        await db.query(
          "SELECT count(*) FROM consent_current WHERE contact_id=$1",
          [f.contact],
        )
      ).rows[0].count,
      "0",
    ),
  );
});
