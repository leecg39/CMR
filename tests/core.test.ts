import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  pool,
  transaction,
  assertRuntimeRole,
} from "../packages/database/index.js";
import {
  recordConsent,
  addContact,
} from "../packages/consent-domain/consent.js";
import {
  calendarDue,
  contactHash,
  daytime,
  hash,
  encrypt,
  decrypt,
} from "../packages/consent-domain/common.js";
import {
  evaluate,
  enqueue,
  templateIssues,
} from "../packages/policy-engine/index.js";
import { runTenant } from "../apps/worker/jobs.js";
import {
  requestDeletion,
  confirmDeletionTask,
  evidence,
  csv,
} from "../packages/evidence/index.js";
import { publicIP } from "../packages/web-sdk/security.js";
import { totp, verifyTotp, base32 } from "../packages/consent-domain/auth.js";
import { fixture, NOW } from "../packages/test-fixtures/index.js";
after(() => pool.end());
const rev = async (f: any, at = new Date(NOW.getTime() + 1000)) =>
  transaction(f.tenant, (db) =>
    recordConsent(
      db,
      f.ctx,
      {
        subject_id: f.subject,
        contact_id: f.contact,
        purpose_id: f.purposes.ad_sms,
        action: "revoked",
        idempotency_key: "revoke",
      },
      { now: at },
    ),
  );
test("T03 웹 광고 허용은 SMS 광고 수신 동의로 확장되지 않는다", async () => {
  const f = await fixture({ sms: false });
  await transaction(f.tenant, (db) =>
    recordConsent(
      db,
      f.ctx,
      {
        subject_id: f.subject,
        purpose_id: f.purposes.advertising,
        notice_id: f.notices.advertising,
        action: "granted",
        occurred_at: NOW.toISOString(),
        idempotency_key: "web",
      },
      { web: true, now: NOW },
    ),
  );
  const d = await transaction(f.tenant, (db) =>
    evaluate(db, f.ctx, f.input, NOW),
  );
  assert.equal(d.allowed, false);
  assert.ok(d.reasons.includes("RECEPTION_CONSENT_MISSING"));
});
test("T04 SMS 동의는 이메일 또는 다른 연락처로 확장되지 않는다", async () => {
  const f = await fixture();
  const c = await transaction(f.tenant, (db) =>
    addContact(db, f.ctx, {
      subject_id: f.subject,
      channel: "email",
      value: "fixture@example.test",
      verified: true,
    }),
  );
  const d = await transaction(f.tenant, (db) =>
    evaluate(db, f.ctx, { ...f.input, contact_id: c.id }, NOW),
  );
  assert.equal(d.allowed, false);
  assert.ok(d.reasons.includes("CHANNEL_MISMATCH"));
});
test("T05 예약 후 철회는 취소·거부·outbox를 원자적으로 갱신한다", async () => {
  const f = await fixture();
  const j = await transaction(f.tenant, (db) =>
    enqueue(
      db,
      f.ctx,
      {
        ...f.input,
        idempotency_key: "send",
        scheduled_at: new Date(NOW.getTime() + 3600000).toISOString(),
      },
      NOW,
    ),
  );
  assert.equal(j.status, "queued");
  await rev(f);
  await transaction(f.tenant, async (db) => {
    assert.equal(
      (await db.query("SELECT status FROM message_jobs WHERE id=$1", [j.id]))
        .rows[0].status,
      "cancelled",
    );
    assert.equal(
      (await db.query("SELECT count(*) FROM outbox")).rows[0].count,
      "1",
    );
    assert.equal((await evaluate(db, f.ctx, f.input, NOW)).allowed, false);
  });
  await runTenant(f.tenant, NOW);
  await transaction(f.tenant, async (db) =>
    assert.equal(
      (
        await db.query(
          "SELECT count(*) FROM provider_receipts WHERE job_id=$1",
          [j.id],
        )
      ).rows[0].count,
      "0",
    ),
  );
});
test("T06 같은 grant 재전송 및 새 멱등 키의 과거 grant는 철회를 되돌리지 않는다", async () => {
  const f = await fixture();
  await rev(f);
  await transaction(f.tenant, async (db) => {
    const e = await recordConsent(
      db,
      f.ctx,
      {
        subject_id: f.subject,
        contact_id: f.contact,
        purpose_id: f.purposes.ad_sms,
        notice_id: f.notices.ad_sms,
        action: "granted",
        occurred_at: "2026-09-29T01:00:00Z",
        idempotency_key: "grant:ad_sms",
      },
      { now: NOW },
    );
    assert.equal(e.duplicate, true);
    const replay = await recordConsent(
      db,
      f.ctx,
      {
        subject_id: f.subject,
        contact_id: f.contact,
        purpose_id: f.purposes.ad_sms,
        notice_id: f.notices.ad_sms,
        action: "granted",
        occurred_at: "2026-09-29T01:00:00Z",
        idempotency_key: "old:new-key",
      },
      { now: new Date(NOW.getTime() + 2000) },
    );
    assert.equal(replay.applied, false);
    assert.equal((await evaluate(db, f.ctx, f.input, NOW)).allowed, false);
  });
});
test("T07 20:59 예약도 21:00 실행 시 차단된다", async () => {
  const f = await fixture(),
    before = new Date("2026-09-30T11:59:00Z"),
    after = new Date("2026-09-30T12:00:00Z");
  await transaction(f.tenant, (db) =>
    enqueue(db, f.ctx, { ...f.input, idempotency_key: "night" }, before),
  );
  const r = await runTenant(f.tenant, after);
  assert.equal(r.blocked, 1);
  await transaction(f.tenant, async (db) =>
    assert.equal(
      (
        await db.query(
          "SELECT count(*) FROM provider_receipts r JOIN message_jobs m ON m.tenant_id=r.tenant_id AND m.id=r.job_id WHERE m.idempotency_key='night'",
        )
      ).rows[0].count,
      "0",
    ),
  );
  assert.equal(daytime(new Date("2026-09-30T23:00:00Z")), true);
});
test("T08 상태 저장 트랜잭션 실패는 이벤트·현재 상태를 모두 롤백한다", async () => {
  const f = await fixture();
  await assert.rejects(
    transaction(f.tenant, async (db) => {
      await recordConsent(
        db,
        f.ctx,
        {
          subject_id: f.subject,
          contact_id: f.contact,
          purpose_id: f.purposes.ad_sms,
          action: "revoked",
          idempotency_key: "rollback",
        },
        { now: NOW },
      );
      throw Error("storage failure");
    }),
  );
  const d = await transaction(f.tenant, (db) =>
    evaluate(db, f.ctx, f.input, NOW),
  );
  assert.equal(d.allowed, true);
});
test("T09 접수 후 타임아웃은 조회로 조정하고 중복 발송하지 않는다", async () => {
  const f = await fixture();
  await transaction(f.tenant, async (db) => {
    await db.query("UPDATE connectors SET mode='timeout_after'");
    await enqueue(db, f.ctx, { ...f.input, idempotency_key: "timeout" }, NOW);
  });
  await runTenant(f.tenant, NOW);
  await runTenant(f.tenant, NOW);
  await transaction(f.tenant, async (db) => {
    const j = (
      await db.query(
        "SELECT * FROM message_jobs WHERE idempotency_key='timeout'",
      )
    ).rows[0];
    assert.equal(j.status, "delivered");
    assert.equal(j.attempts, 1);
    assert.equal(
      (
        await db.query(
          "SELECT count(*) FROM provider_receipts WHERE job_id=$1",
          [j.id],
        )
      ).rows[0].count,
      "1",
    );
  });
});
test("T09b 접수 전 타임아웃도 미접수를 증명하기 전 재발송하지 않는다", async () => {
  const f = await fixture();
  await transaction(f.tenant, async (db) => {
    await db.query("UPDATE connectors SET mode='timeout_before'");
    await enqueue(db, f.ctx, { ...f.input, idempotency_key: "timeout" }, NOW);
  });
  await runTenant(f.tenant, NOW);
  await runTenant(f.tenant, NOW);
  await transaction(f.tenant, async (db) => {
    const j = (
      await db.query(
        "SELECT * FROM message_jobs WHERE idempotency_key='timeout'",
      )
    ).rows[0];
    assert.equal(j.status, "unknown");
    assert.equal(j.attempts, 1);
  });
});
test("T10 동의·거부·철회는 각각 처리결과 통지를 만든다", async () => {
  const f = await fixture();
  await rev(f);
  await transaction(f.tenant, async (db) => {
    await recordConsent(
      db,
      f.ctx,
      {
        subject_id: f.subject,
        contact_id: f.contact,
        purpose_id: f.purposes.ad_sms,
        action: "denied",
        idempotency_key: "deny",
      },
      { now: NOW },
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*) FROM notification_jobs WHERE kind='processing_result'",
        )
      ).rows[0].count,
      "3",
    );
  });
});
test("T11 한국 달력의 14일·2년 기한과 윤년을 처리한다", () => {
  assert.equal(
    calendarDue(new Date("2024-02-29T00:00:00Z"), 2).toISOString(),
    "2026-02-28T14:59:59.999Z",
  );
  assert.equal(
    calendarDue(new Date("2026-09-30T15:01:00Z"), 0, 14).toISOString(),
    "2026-10-15T14:59:59.999Z",
  );
  assert.equal(
    calendarDue(new Date("2026-01-31T00:00:00Z"), 0, 14).toISOString(),
    "2026-02-14T14:59:59.999Z",
  );
});
test("T12 실제 비소유자 RLS: A 세션에서 B 자료 읽기·참조·쓰기 차단", async () => {
  await assertRuntimeRole();
  const a = await fixture(),
    b = await fixture();
  await transaction(a.tenant, async (db) => {
    assert.equal(
      (await db.query("SELECT * FROM subjects WHERE id=$1", [b.subject]))
        .rowCount,
      0,
    );
  });
  await assert.rejects(
    transaction(a.tenant, (db) =>
      db.query(
        "INSERT INTO subjects(tenant_id,id,external_id) VALUES($1,$2,$3)",
        [b.tenant, randomUUID(), "foreign"],
      ),
    ),
  );
  await assert.rejects(
    transaction(a.tenant, (db) =>
      db.query(
        "INSERT INTO contact_points(tenant_id,id,subject_id,channel,encrypted,value_hmac,masked) VALUES($1,$2,$3,'sms','x','y','z')",
        [a.tenant, randomUUID(), b.subject],
      ),
    ),
  );
  assert.equal((await pool.query("SELECT * FROM subjects")).rowCount, 0);
});
test("T13 외부 삭제가 확인되지 않으면 완료될 수 없다", async () => {
  const f = await fixture();
  const d = await transaction(f.tenant, (db) =>
    requestDeletion(db, f.ctx, f.subject, "회원 본인 확인 후 삭제 요청"),
  );
  await assert.rejects(
    transaction(f.tenant, (db) =>
      db.query("UPDATE deletion_requests SET status='completed' WHERE id=$1", [
        d.id,
      ]),
    ),
  );
  await transaction(f.tenant, async (db) => {
    const tasks = (
      await db.query("SELECT * FROM deletion_tasks WHERE request_id=$1", [d.id])
    ).rows;
    await confirmDeletionTask(
      db,
      f.ctx,
      tasks.find((t) => t.system === "cmp").id,
      "자체 연락처 파기 실행 결과 확인",
    );
    assert.equal(
      (
        await db.query("SELECT status FROM deletion_requests WHERE id=$1", [
          d.id,
        ])
      ).rows[0].status,
      "open",
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
test("T14 증빙 없는 과거 동의는 광고에서 제외된다", async () => {
  const f = await fixture({ legacy: true });
  const d = await transaction(f.tenant, (db) =>
    evaluate(db, f.ctx, f.input, NOW),
  );
  assert.ok(d.reasons.includes("EVIDENCE_UNVERIFIED"));
});
test("T15 광고 알림톡 및 거래 안내에 섞인 할인 광고는 거절된다", () => {
  assert.ok(
    templateIssues({
      route: "alimtalk",
      message_class: "marketing",
      body: "할인 행사",
    }).includes("ADVERTISING_ALIMTALK_FORBIDDEN"),
  );
  assert.ok(
    templateIssues({
      route: "sms",
      message_class: "transactional",
      body: "쿠폰 소멸 안내",
    }).includes("PROMOTIONAL_NOTICE_FORBIDDEN"),
  );
});
test("T17 동시 중복 요청은 이벤트와 통지를 한 번만 생성한다", async () => {
  const f = await fixture({ sms: false }),
    input = {
      subject_id: f.subject,
      contact_id: f.contact,
      purpose_id: f.purposes.ad_sms,
      notice_id: f.notices.ad_sms,
      action: "granted",
      occurred_at: NOW.toISOString(),
      idempotency_key: "repeat",
    };
  await Promise.all(
    Array.from({ length: 8 }, () =>
      transaction(f.tenant, (db) =>
        recordConsent(db, f.ctx, input, { now: NOW }),
      ),
    ),
  );
  await transaction(f.tenant, async (db) => {
    assert.equal(
      (
        await db.query(
          "SELECT count(*) FROM consent_events WHERE idempotency_key='repeat'",
        )
      ).rows[0].count,
      "1",
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*) FROM notification_jobs WHERE kind='processing_result'",
        )
      ).rows[0].count,
      "1",
    );
  });
});
test("T19 번호 변경 시 기존 번호의 수신 동의는 이전되지 않는다", async () => {
  const f = await fixture();
  const c = await transaction(f.tenant, (db) =>
    addContact(db, f.ctx, {
      subject_id: f.subject,
      channel: "sms",
      value: "01000008888",
      verified: true,
    }),
  );
  const d = await transaction(f.tenant, (db) =>
    evaluate(db, f.ctx, { ...f.input, contact_id: c.id }, NOW),
  );
  assert.ok(d.reasons.includes("RECEPTION_CONSENT_MISSING"));
  const old = await transaction(f.tenant, (db) =>
    evaluate(db, f.ctx, f.input, NOW),
  );
  assert.ok(old.reasons.includes("CONTACT_UNVERIFIED"));
});
test("T20 과금 한도 초과도 철회는 계속 반영한다", async () => {
  const f = await fixture({ limit: 0 });
  const d = await transaction(f.tenant, (db) =>
    evaluate(db, f.ctx, f.input, NOW),
  );
  assert.ok(d.reasons.includes("QUOTA_EXCEEDED"));
  await rev(f);
  assert.ok(
    (
      await transaction(f.tenant, (db) => evaluate(db, f.ctx, f.input, NOW))
    ).reasons.includes("CONSENT_WITHDRAWN"),
  );
});
test("문구·원장은 DB에서 수정 금지이고 증빙은 마스킹된 연락처만 포함한다", async () => {
  const f = await fixture();
  await assert.rejects(
    transaction(f.tenant, (db) =>
      db.query("UPDATE notices SET body='changed'"),
    ),
  );
  await assert.rejects(
    transaction(f.tenant, (db) => db.query("DELETE FROM consent_events")),
  );
  const e = await transaction(f.tenant, (db) => evidence(db, f.ctx, f.subject));
  assert.equal(e.sha256.length, 64);
  assert.ok(e.notices.length);
  assert.ok(!JSON.stringify(e).includes("01000009999"));
  assert.ok(csv([{ id: "=SUM(1)", action: "granted" }]).includes("'=SUM(1)"));
});
test("테넌트별 암호화·HMAC, TOTP 재전송 및 사설 네트워크 보호", () => {
  assert.notEqual(contactHash("A", "phone"), contactHash("B", "phone"));
  const c = encrypt("A", "phone");
  assert.equal(decrypt("A", c), "phone");
  assert.throws(() => decrypt("B", c));
  const secret = base32(Buffer.from("12345678901234567890"));
  assert.equal(totp(secret, 1), "287082");
  assert.equal(verifyTotp(secret, "287082", 1, 59000), null);
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.0.1",
    "::1",
    "::ffff:127.0.0.1",
  ])
    assert.equal(publicIP(ip), false);
  assert.equal(publicIP("8.8.8.8"), true);
});
test("웹 추적 거절은 예약 SMS와 다른 목적의 동의를 취소하지 않는다", async () => {
  const f = await fixture();
  const j = await transaction(f.tenant, (db) =>
    enqueue(db, f.ctx, { ...f.input, idempotency_key: "scope" }, NOW),
  );
  await transaction(f.tenant, async (db) => {
    await recordConsent(
      db,
      f.ctx,
      {
        subject_id: f.subject,
        purpose_id: f.purposes.advertising,
        action: "denied",
        idempotency_key: "web-deny",
      },
      { web: true, now: NOW },
    );
    assert.equal(
      (await db.query("SELECT status FROM message_jobs WHERE id=$1", [j.id]))
        .rows[0].status,
      "queued",
    );
    assert.equal((await evaluate(db, f.ctx, f.input, NOW)).allowed, true);
  });
});
test("동일 테넌트 동시 작업에서도 철회 후 새 허용은 발생하지 않는다", async () => {
  const f = await fixture();
  await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      transaction(f.tenant, (db) =>
        enqueue(
          db,
          f.ctx,
          { ...f.input, idempotency_key: `concurrent:${i}` },
          NOW,
        ),
      ),
    ),
  );
  await rev(f);
  const decisions = await Promise.all(
    Array.from({ length: 10 }, () =>
      transaction(f.tenant, (db) =>
        evaluate(db, f.ctx, f.input, new Date(NOW.getTime() + 2000)),
      ),
    ),
  );
  assert.ok(decisions.every((d) => !d.allowed));
  await transaction(f.tenant, async (db) =>
    assert.equal(
      (
        await db.query(
          "SELECT count(*) FROM message_jobs WHERE status='queued'",
        )
      ).rows[0].count,
      "0",
    ),
  );
});
test("정기 확인 전달은 동의일을 바꾸지 않고 다음 2년 회차를 한 번만 만든다", async () => {
  const f = await fixture();
  const before = await transaction(f.tenant, async (db) => {
    await db.query(
      "UPDATE notification_jobs SET status='delivered' WHERE kind='periodic'",
    );
    return (
      await db.query(
        "SELECT grant_at,revision FROM consent_current WHERE contact_id=$1",
        [f.contact],
      )
    ).rows[0];
  });
  await runTenant(f.tenant, NOW);
  await runTenant(f.tenant, NOW);
  await transaction(f.tenant, async (db) => {
    const current = (
      await db.query(
        "SELECT grant_at,revision FROM consent_current WHERE contact_id=$1",
        [f.contact],
      )
    ).rows[0];
    assert.deepEqual(current, before);
    const rows = (
      await db.query(
        "SELECT cycle,due_at FROM notification_jobs WHERE kind='periodic' ORDER BY cycle",
      )
    ).rows;
    assert.equal(rows.length, 2);
    assert.equal(rows[1].cycle, 1);
    assert.equal(new Date(rows[1].due_at).getUTCFullYear(), 2030);
  });
});
test("보유기간 종료 파기는 승인 정책·외부 확인·보존 중지를 모두 검사한다", async () => {
  const f = await fixture();
  await transaction(f.tenant, async (db) => {
    const d = await requestDeletion(
      db,
      f.ctx,
      f.subject,
      "테스트 본인 요청 연락처 삭제",
    );
    const tasks = (
      await db.query("SELECT id FROM deletion_tasks WHERE request_id=$1", [
        d.id,
      ])
    ).rows;
    for (const t of tasks)
      await confirmDeletionTask(
        db,
        f.ctx,
        t.id,
        "각 시스템의 삭제 완료 증빙 확인",
      );
  });
  await assert.rejects(
    transaction(f.tenant, (db) =>
      db.query("SELECT purge_retained_subject($1,$2)", [f.tenant, f.subject]),
    ),
  );
  await transaction(f.tenant, async (db) => {
    await db.query(
      "INSERT INTO retention_policies VALUES($1,0,'합성 데이터 즉시 파기 검증','privacy-officer',now())",
      [f.tenant],
    );
    await db.query(
      "INSERT INTO holds VALUES($1,$2,$3,'테스트 보존 중지',now()+interval '1 day')",
      [f.tenant, randomUUID(), f.subject],
    );
  });
  await assert.rejects(
    transaction(f.tenant, (db) =>
      db.query("SELECT purge_retained_subject($1,$2)", [f.tenant, f.subject]),
    ),
  );
  await transaction(f.tenant, async (db) => {
    await db.query("DELETE FROM holds WHERE subject_id=$1", [f.subject]);
    await db.query("SELECT purge_retained_subject($1,$2)", [
      f.tenant,
      f.subject,
    ]);
    assert.equal(
      (
        await db.query(
          "SELECT count(*) FROM consent_events WHERE subject_id=$1",
          [f.subject],
        )
      ).rows[0].count,
      "0",
    );
    assert.equal(
      (await db.query("SELECT count(*) FROM subjects WHERE id=$1", [f.subject]))
        .rows[0].count,
      "0",
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*) FROM deletion_journal WHERE subject_id=$1",
          [f.subject],
        )
      ).rows[0].count,
      "1",
    );
  });
});
test("MMS는 승인된 이미지 ID를 요구하며 승인 후 본문·이미지를 바꿀 수 없다", async () => {
  assert.ok(
    templateIssues({
      body: "광고",
      route: "mms",
      message_class: "marketing",
    }).includes("MMS_IMAGE_REQUIRED"),
  );
  const f = await fixture(),
    id = randomUUID();
  await transaction(f.tenant, async (db) => {
    const {
      rows: [base],
    } = await db.query("SELECT * FROM templates WHERE id=$1", [f.template]);
    await db.query(
      "INSERT INTO templates(tenant_id,id,controller_id,purpose_id,name,channel,route,message_class,body,title,status,hash,image_id) VALUES($1,$2,$3,$4,'MMS','sms','mms','marketing',$5,'','approved',$6,'IMG_SYNTHETIC')",
      [
        f.tenant,
        id,
        f.controller,
        f.purposes.ad_sms,
        base.body,
        hash(base.body + "\n\nimage:IMG_SYNTHETIC"),
      ],
    );
    assert.equal(
      (await evaluate(db, f.ctx, { ...f.input, template_id: id }, NOW)).allowed,
      true,
    );
  });
  await assert.rejects(
    transaction(f.tenant, (db) =>
      db.query("UPDATE templates SET image_id='tampered' WHERE id=$1", [id]),
    ),
  );
  await assert.rejects(
    transaction(f.tenant, (db) =>
      db.query("UPDATE templates SET body='tampered' WHERE id=$1", [
        f.template,
      ]),
    ),
  );
});
