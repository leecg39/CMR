import { randomUUID } from "node:crypto";
import { audit, type DB } from "../database/index.js";
import { hash, permit, type Context, fail } from "../consent-domain/common.js";
import { owned, recordConsent } from "../consent-domain/consent.js";
export async function evidence(db: DB, ctx: Context, subject: string) {
  permit(ctx, "evidence:read");
  const s = await owned(db, "subjects", subject);
  const q = async (sql: string) => (await db.query(sql, [subject])).rows;
  const bundle = {
    schema_version: 1,
    tenant_id: ctx.tenant,
    subject: s,
    contacts: await q(
      "SELECT id,channel,masked,verified,active FROM contact_points WHERE subject_id=$1",
    ),
    events: await q(
      "SELECT * FROM consent_events WHERE subject_id=$1 ORDER BY seq",
    ),
    notices: await q(
      "SELECT DISTINCT n.* FROM notices n JOIN consent_events e ON e.tenant_id=n.tenant_id AND e.notice_id=n.id WHERE e.subject_id=$1",
    ),
    rendered_web_configs: await q(
      "SELECT DISTINCT w.* FROM web_configs w JOIN consent_events e ON e.tenant_id=w.tenant_id AND e.source=('web:'||w.site_id::text||':v'||w.version::text) WHERE e.subject_id=$1",
    ),
    agreements: await q(
      "SELECT e.*,v.title,v.body,v.hash FROM agreement_events e JOIN agreement_versions v ON v.tenant_id=e.tenant_id AND v.id=e.version_id WHERE e.subject_id=$1 ORDER BY e.received_at",
    ),
    current: await q(
      "SELECT * FROM consent_current WHERE subject_id=$1 ORDER BY scope",
    ),
    decisions: await q(
      "SELECT * FROM decisions WHERE subject_id=$1 ORDER BY evaluated_at",
    ),
    messages: await q(
      "SELECT * FROM message_jobs WHERE subject_id=$1 ORDER BY created_at",
    ),
  };
  await audit(db, ctx.tenant, ctx.actor, "evidence.exported", {
    subject_id: subject,
  });
  return { ...bundle, sha256: hash(JSON.stringify(bundle)) };
}
export function csv(rows: Record<string, unknown>[]) {
  const fields = [
    "id",
    "action",
    "evidence",
    "revision",
    "occurred_at",
    "received_at",
  ];
  const esc = (v: unknown) =>
    `"${String(v ?? "")
      .replace(/^[=+@-]/, "'$&")
      .replace(/"/g, '""')}"`;
  return (
    "\ufeff" +
    [
      fields.join(","),
      ...rows.map((r) => fields.map((k) => esc(r[k])).join(",")),
    ].join("\r\n")
  );
}
export async function requestDeletion(
  db: DB,
  ctx: Context,
  subject: string,
  reason: string,
) {
  permit(ctx, "deletion:write");
  await owned(db, "subjects", subject);
  const { rows: states } = await db.query(
    "SELECT * FROM consent_current WHERE subject_id=$1 AND state='GRANTED'",
    [subject],
  );
  for (const s of states)
    await recordConsent(
      db,
      { ...ctx, role: "system" },
      {
        subject_id: subject,
        contact_id: s.contact_id,
        purpose_id: s.purpose_id,
        action: "revoked",
        idempotency_key: `delete:${randomUUID()}`,
      },
      {
        web:
          (await owned(db, "purposes", s.purpose_id)).kind === "web_tracking",
      },
    );
  await db.query("UPDATE subjects SET restricted=true WHERE id=$1", [subject]);
  const id = randomUUID();
  await db.query(
    "INSERT INTO deletion_requests(tenant_id,id,subject_id,reason) VALUES($1,$2,$3,$4)",
    [ctx.tenant, id, subject, reason],
  );
  for (const system of ["cmp", "external:crm", "backup"])
    await db.query(
      "INSERT INTO deletion_tasks(tenant_id,id,request_id,system) VALUES($1,$2,$3,$4)",
      [ctx.tenant, randomUUID(), id, system],
    );
  await audit(db, ctx.tenant, ctx.actor, "deletion.requested", {
    id,
    subject_id: subject,
  });
  return { id, status: "open" };
}
export async function confirmDeletionTask(
  db: DB,
  ctx: Context,
  id: string,
  proof: string,
) {
  permit(ctx, "deletion:write");
  const task = await owned(db, "deletion_tasks", id),
    request = await owned(db, "deletion_requests", task.request_id);
  if (proof.trim().length < 10) fail("EVIDENCE_REQUIRED");
  if (task.system === "cmp") {
    await db.query(
      "UPDATE contact_points SET encrypted='',masked='삭제됨',active=false,verified=false WHERE subject_id=$1",
      [request.subject_id],
    );
    await db.query(
      "UPDATE subjects SET external_id=$2,restricted=true,deleted_at=now() WHERE id=$1",
      [request.subject_id, `deleted:${request.subject_id}`],
    );
    await db.query(
      "INSERT INTO deletion_journal(tenant_id,id,subject_id) VALUES($1,$2,$3)",
      [ctx.tenant, randomUUID(), request.subject_id],
    );
  }
  await db.query(
    "UPDATE deletion_tasks SET status='verified',evidence=$2 WHERE id=$1",
    [id, proof],
  );
  const {
    rows: [left],
  } = await db.query(
    "SELECT count(*)::int AS n FROM deletion_tasks WHERE request_id=$1 AND status NOT IN ('verified','retained')",
    [task.request_id],
  );
  if (left.n === 0)
    await db.query(
      "UPDATE deletion_requests SET status='completed' WHERE id=$1",
      [task.request_id],
    );
  await audit(db, ctx.tenant, ctx.actor, "deletion.task_confirmed", {
    id,
    system: task.system,
  });
  return { ok: true };
}
