import { randomUUID } from "node:crypto";
import { transaction, audit, type DB } from "../../packages/database/index.js";
import {
  decrypt,
  hash,
  calendarDue,
  type Context,
} from "../../packages/consent-domain/common.js";
import { evaluate, enqueue } from "../../packages/policy-engine/index.js";
import {
  syncSolapi,
  propagateSolapi,
} from "../../packages/connectors/solapi-sync.js";
import { submitSolapi } from "../../packages/connectors/index.js";
export async function runTenant(tenant: string, now = new Date()) {
  const ctx: Context = { tenant, actor: "worker", role: "system" };
  if (process.env.SOLAPI_TENANT_ID === tenant) {
    try {
      await syncSolapi(tenant);
    } catch {
      /* Failed sync never refreshes the freshness barrier. */
    }
    const pending = await transaction(
      tenant,
      async (db) =>
        (
          await db.query(
            "SELECT * FROM outbox WHERE status='pending' AND attempts<3",
          )
        ).rows,
    );
    for (const event of pending) {
      try {
        await propagateSolapi(tenant, event.payload);
        await transaction(tenant, (db) =>
          db.query(
            "UPDATE outbox SET status='delivered',attempts=attempts+1 WHERE id=$1",
            [event.id],
          ),
        );
      } catch {
        await transaction(tenant, (db) =>
          db.query(
            "UPDATE outbox SET attempts=attempts+1,status=CASE WHEN attempts>=2 THEN 'manual_required' ELSE 'pending' END WHERE id=$1",
            [event.id],
          ),
        );
      }
    }
  }
  await transaction(tenant, async (db) => {
    await db.query(
      "UPDATE message_jobs SET status='unknown',reasons=ARRAY['WORKER_INTERRUPTED'] WHERE status='dispatching' AND authorized_at<$1::timestamptz-interval '2 minutes'",
      [now],
    );
    const { rows: outs } = await db.query(
      "SELECT * FROM outbox WHERE status='pending' LIMIT 100",
    );
    const {
      rows: [con],
    } = await db.query("SELECT * FROM connectors LIMIT 1");
    for (const o of outs)
      if (con?.provider === "mock")
        await db.query(
          "UPDATE outbox SET status=$2,attempts=attempts+1 WHERE id=$1",
          [o.id, con?.provider === "mock" ? "delivered" : "pending"],
        );
    const { rows: unknown } = await db.query(
      "SELECT * FROM message_jobs WHERE status='unknown'",
    );
    for (const j of unknown) {
      const {
        rows: [r],
      } = await db.query("SELECT * FROM provider_receipts WHERE job_id=$1", [
        j.id,
      ]);
      if (r)
        await db.query(
          "UPDATE message_jobs SET status=$2,provider_id=$3 WHERE id=$1",
          [j.id, r.status, r.provider_id],
        ); /* Absence is not proof of nonacceptance: remain unknown, never auto-resend. */
    }
    const { rows: periodic } = await db.query(
      "SELECT n.*,e.occurred_at FROM notification_jobs n JOIN consent_events e ON e.tenant_id=n.tenant_id AND e.id=n.event_id JOIN consent_current c ON c.tenant_id=e.tenant_id AND c.last_event_id=e.id WHERE n.kind='periodic' AND n.status='delivered' AND c.state='GRANTED'",
    );
    for (const n of periodic)
      await db.query(
        "INSERT INTO notification_jobs(tenant_id,id,event_id,subject_id,kind,due_at,cycle) VALUES($1,$2,$3,$4,'periodic',$5,$6) ON CONFLICT(tenant_id,event_id,kind,cycle) DO NOTHING",
        [
          tenant,
          randomUUID(),
          n.event_id,
          n.subject_id,
          calendarDue(new Date(n.occurred_at), (n.cycle + 2) * 2),
          n.cycle + 1,
        ],
      );
    await queueNotifications(db, ctx, now);
  });
  const ids = await transaction(
    tenant,
    async (db) =>
      (
        await db.query(
          "SELECT id FROM message_jobs WHERE status='queued' AND scheduled_at<=$1 ORDER BY scheduled_at LIMIT 50",
          [now],
        )
      ).rows,
  );
  let accepted = 0,
    blocked = 0;
  for (const { id } of ids) {
    const dispatch = await transaction(tenant, async (db) => {
      const {
        rows: [j],
      } = await db.query(
        "SELECT * FROM message_jobs WHERE id=$1 AND status='queued' FOR UPDATE",
        [id],
      );
      if (!j) return null;
      const d = await evaluate(
        db,
        ctx,
        {
          subject_id: j.subject_id,
          contact_id: j.contact_id,
          template_id: j.template_id,
        },
        now,
      );
      if (!d.allowed) {
        await db.query(
          "UPDATE message_jobs SET status='blocked',reasons=$2,decision_id=$3 WHERE id=$1",
          [id, d.reasons, d.id],
        );
        blocked++;
        return null;
      }
      const {
        rows: [c],
      } = await db.query("SELECT * FROM contact_points WHERE id=$1", [
        j.contact_id,
      ]);
      const {
        rows: [t],
      } = await db.query(
        "SELECT t.*,c.sender FROM templates t JOIN controllers c ON c.tenant_id=t.tenant_id AND c.id=t.controller_id WHERE t.id=$1",
        [j.template_id],
      );
      const {
        rows: [provider],
      } = await db.query(
        "SELECT * FROM connectors ORDER BY CASE provider WHEN 'solapi' THEN 0 ELSE 1 END LIMIT 1",
      );
      await db.query(
        "UPDATE message_jobs SET status='dispatching',authorized_at=$2,decision_id=$3,attempts=attempts+1 WHERE id=$1",
        [id, now, d.id],
      );
      return {
        provider,
        message: {
          id,
          tenant,
          to: decrypt(tenant, c.encrypted),
          from: t.sender,
          body: t.body,
          route: t.route,
          image_id: t.image_id,
          title: t.title,
        },
      };
    });
    if (!dispatch) continue;
    let outcome;
    if (dispatch.provider.provider === "mock") {
      outcome = await transaction(tenant, async (db) => {
        const mode = dispatch.provider.mode;
        await db.query("UPDATE connectors SET mode='normal' WHERE id=$1", [
          dispatch.provider.id,
        ]);
        if (mode === "reject")
          return { kind: "rejected" as const, reason: "MOCK_REJECTED" };
        if (mode === "timeout_before") return { kind: "unknown" as const };
        const provider_id = `mock_${id}`;
        await db.query(
          "INSERT INTO provider_receipts(tenant_id,job_id,provider_id,status) VALUES($1,$2,$3,'delivered') ON CONFLICT DO NOTHING",
          [tenant, id, provider_id],
        );
        return mode === "timeout_after"
          ? { kind: "unknown" as const }
          : { kind: "accepted" as const, provider_id };
      });
    } else outcome = await submitSolapi(dispatch.message);
    await transaction(tenant, async (db) => {
      await db.query(
        "UPDATE message_jobs SET status=$2,provider_id=$3,accepted_at=$4,reasons=$5 WHERE id=$1",
        [
          id,
          outcome.kind === "accepted"
            ? dispatch.provider.provider === "mock"
              ? "delivered"
              : "accepted"
            : outcome.kind === "unknown"
              ? "unknown"
              : "failed",
          outcome.kind === "accepted" ? outcome.provider_id : null,
          outcome.kind === "accepted" ? now : null,
          outcome.kind === "rejected" ? [outcome.reason] : [],
        ],
      );
      await audit(db, tenant, "worker", `message.${outcome.kind}`, {
        job_id: id,
      });
    });
    if (outcome.kind === "accepted") accepted++;
  }
  await transaction(tenant, async (db) => {
    await db.query(
      "UPDATE notification_jobs n SET status='delivered',evidence='provider_delivery_confirmed' FROM message_jobs m WHERE m.tenant_id=n.tenant_id AND m.id=n.message_job_id AND m.status='delivered' AND n.status='queued'",
    );
    await db.query(
      "UPDATE notification_jobs n SET status='manual_required' FROM message_jobs m WHERE m.tenant_id=n.tenant_id AND m.id=n.message_job_id AND m.status IN ('blocked','failed','cancelled') AND n.status='queued'",
    );
  });
  return { accepted, blocked };
}
async function queueNotifications(db: DB, ctx: Context, now: Date) {
  const { rows: jobs } = await db.query(
    "SELECT n.*,e.action,e.contact_id,e.purpose_id,e.occurred_at,e.received_at FROM notification_jobs n JOIN consent_events e ON e.tenant_id=n.tenant_id AND e.id=n.event_id WHERE n.status='pending' AND (n.kind='processing_result' OR n.due_at<=$1::timestamptz+interval '30 days') LIMIT 50",
    [now],
  );
  for (const n of jobs) {
    if (!n.contact_id) {
      await db.query(
        "UPDATE notification_jobs SET status='manual_required' WHERE id=$1",
        [n.id],
      );
      continue;
    }
    const {
      rows: [p],
    } = await db.query("SELECT * FROM purposes WHERE id=$1", [n.purpose_id]);
    const text =
      n.kind === "processing_result"
        ? `광고 수신 의사표시 처리결과\n처리일: ${new Date(n.received_at).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}\n결과: ${{ granted: "동의", denied: "거부", revoked: "철회" }[n.action as "granted"]}\n선택은 수신 설정에서 언제든 변경할 수 있습니다.`
        : `광고 수신동의 확인 안내\n동의일: ${new Date(n.occurred_at).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}\n기존 선택을 유지하거나 무료수신거부 번호로 철회할 수 있습니다. 응답하지 않아도 새 동의로 기록하지 않습니다.`;
    const {
      rows: [c],
    } = await db.query("SELECT * FROM controllers WHERE id=$1", [
      p.controller_id,
    ]);
    const body = `[${c.name}]\n${text}\n무료수신거부 ${c.opt_out}`;
    const template = randomUUID();
    await db.query(
      "INSERT INTO templates(tenant_id,id,controller_id,name,channel,route,message_class,body,status,hash,approved_by) VALUES($1,$2,$3,$4,'sms','lms','legal_notice',$5,'approved',$6,'system:reviewed-notice-template-v1')",
      [ctx.tenant, template, p.controller_id, n.kind, body, hash(body + "\n")],
    );
    const j = await enqueue(
      db,
      ctx,
      {
        subject_id: n.subject_id,
        contact_id: n.contact_id,
        template_id: template,
        idempotency_key: `notice:${n.id}`,
      },
      now,
    );
    await db.query(
      "UPDATE notification_jobs SET status=$2,message_job_id=$3,attempts=attempts+1 WHERE id=$1",
      [n.id, j.status === "queued" ? "queued" : "manual_required", j.id],
    );
  }
}
