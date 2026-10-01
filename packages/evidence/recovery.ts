import { randomUUID, createHmac } from "node:crypto";
import { z } from "zod";
import { transaction, audit, type DB } from "../database/index.js";
import { safeEqual, fail } from "../consent-domain/common.js";
const schema = z
  .object({
    version: z.literal(1),
    tenant: z.uuid(),
    deletions: z.array(
      z.object({ subject_id: z.uuid(), deleted_at: z.string() }),
    ),
  })
  .strict();
function signature(payload: string) {
  return createHmac("sha256", process.env.SESSION_SECRET!)
    .update(payload)
    .digest("hex");
}
export async function exportJournal(tenant: string) {
  const data = await transaction(tenant, async (db) => ({
    version: 1 as const,
    tenant,
    deletions: (
      await db.query(
        "SELECT subject_id,deleted_at FROM deletion_journal ORDER BY deleted_at",
      )
    ).rows.map((r) => ({
      subject_id: r.subject_id,
      deleted_at: new Date(r.deleted_at).toISOString(),
    })),
  }));
  const payload = JSON.stringify(data);
  return { payload, signature: signature(payload) };
}
export async function applyJournal(bundle: {
  payload: string;
  signature: string;
}) {
  if (!safeEqual(signature(bundle.payload), bundle.signature))
    fail("INVALID_JOURNAL_SIGNATURE");
  const d = schema.parse(JSON.parse(bundle.payload));
  return transaction(d.tenant, async (db) => {
    for (const item of d.deletions) {
      await db.query(
        "UPDATE subjects SET restricted=true,deleted_at=$2,external_id=$3 WHERE id=$1",
        [item.subject_id, item.deleted_at, `deleted:${item.subject_id}`],
      );
      await db.query(
        "UPDATE contact_points SET encrypted='',masked='삭제됨',active=false,verified=false WHERE subject_id=$1",
        [item.subject_id],
      );
      await db.query(
        "UPDATE message_jobs SET status='cancelled',reasons=ARRAY['DELETION_REAPPLIED'] WHERE subject_id=$1 AND status='queued'",
        [item.subject_id],
      );
      // Restored backups can predate this deletion. Keep the signed history in
      // the restored ledger so the next export cannot silently forget it.
      await db.query(
        "INSERT INTO deletion_journal(tenant_id,id,subject_id,deleted_at) SELECT $1,$2,$3,$4::timestamptz WHERE NOT EXISTS(SELECT 1 FROM deletion_journal WHERE subject_id=$3)",
        [d.tenant, randomUUID(), item.subject_id, item.deleted_at],
      );
    }
    await audit(db, d.tenant, "recovery", "deletion_journal.reapplied", {
      count: d.deletions.length,
    });
    return { reapplied: d.deletions.length };
  });
}
