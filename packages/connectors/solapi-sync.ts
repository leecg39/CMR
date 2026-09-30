import { createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import { transaction } from "../database/index.js";
import { contactHash, decrypt, fail } from "../consent-domain/common.js";
import { recordConsent } from "../consent-domain/consent.js";
export function solapiAuth() {
  if (!process.env.SOLAPI_API_KEY || !process.env.SOLAPI_API_SECRET)
    fail("PROVIDER_NOT_CONFIGURED");
  const date = new Date().toISOString(),
    salt = randomBytes(16).toString("hex");
  const sig = createHmac("sha256", process.env.SOLAPI_API_SECRET!)
    .update(date + salt)
    .digest("hex");
  return `HMAC-SHA256 apiKey=${process.env.SOLAPI_API_KEY}, date=${date}, salt=${salt}, signature=${sig}`;
}
const blockSchema = z.object({
  blackList: z.array(
    z.object({
      handleKey: z.string(),
      senderNumber: z.string(),
      recipientNumber: z.string(),
      dateUpdated: z.string(),
    }),
  ),
  nextKey: z.string().nullable(),
});
export async function fetchOptouts(fetcher: typeof fetch = fetch) {
  const rows: z.infer<typeof blockSchema>["blackList"] = [],
    seen = new Set<string>();
  let cursor: string | null = null;
  for (let i = 0; i < 1000; i++) {
    const query = new URLSearchParams({
      limit: "100",
      ...(cursor ? { startKey: cursor } : {}),
    });
    const r = await fetcher("https://api.solapi.com/iam/v1/black/?" + query, {
      headers: { Authorization: solapiAuth() },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw Error("OPTOUT_SYNC_FAILED");
    const data = blockSchema.parse(await r.json());
    rows.push(...data.blackList);
    if (!data.nextKey) return rows;
    if (seen.has(data.nextKey)) throw Error("OPTOUT_PAGINATION_LOOP");
    seen.add(data.nextKey);
    cursor = data.nextKey;
  }
  throw Error("OPTOUT_PAGE_LIMIT");
}
export async function syncSolapi(tenant: string) {
  if (process.env.SOLAPI_TENANT_ID !== tenant) fail("PROVIDER_TENANT_MISMATCH");
  const blocks = await fetchOptouts();
  return transaction(tenant, async (db) => {
    let applied = 0;
    for (const b of blocks) {
      const id = `solapi:${b.handleKey}:${b.dateUpdated}`;
      const inserted = await db.query(
        "INSERT INTO provider_events(tenant_id,id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [tenant, id],
      );
      if (!inserted.rowCount) continue;
      const contacts = (
        await db.query(
          "SELECT c.id,c.subject_id,p.id AS purpose_id FROM contact_points c CROSS JOIN purposes p JOIN controllers ctrl ON ctrl.tenant_id=p.tenant_id AND ctrl.id=p.controller_id WHERE c.tenant_id=p.tenant_id AND c.active AND c.value_hmac=$1 AND p.kind='advertising_reception' AND p.channel='sms' AND ctrl.sender=$2",
          [
            contactHash(tenant, b.recipientNumber.replace(/\D/g, "")),
            b.senderNumber.replace(/\D/g, ""),
          ],
        )
      ).rows;
      for (const c of contacts) {
        await recordConsent(
          db,
          { tenant, actor: "solapi-poll", role: "system" },
          {
            subject_id: c.subject_id,
            contact_id: c.id,
            purpose_id: c.purpose_id,
            action: "revoked",
            idempotency_key: id + ":" + c.id,
          },
          { source: "provider_080" },
        );
        applied++;
      }
    }
    await db.query(
      "UPDATE connectors SET last_optout_sync=now() WHERE provider='solapi'",
    );
    return { applied };
  });
}
export async function propagateSolapi(
  tenant: string,
  payload: { subject_id: string; contact_id?: string },
) {
  if (process.env.SOLAPI_TENANT_ID !== tenant) fail("PROVIDER_TENANT_MISMATCH");
  const contacts = await transaction(
    tenant,
    async (db) =>
      (
        await db.query(
          "SELECT encrypted FROM contact_points WHERE subject_id=$1 AND ($2::uuid IS NULL OR id=$2) AND active AND channel='sms'",
          [payload.subject_id, payload.contact_id ?? null],
        )
      ).rows,
  );
  if (!contacts.length) throw Error("NO_PROPAGATABLE_CONTACT");
  for (const c of contacts) {
    const response = await fetch(
      "https://api.solapi.com/iam/v1/block/numbers/",
      {
        method: "POST",
        headers: {
          Authorization: solapiAuth(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          phoneNumber: decrypt(tenant, c.encrypted),
          memo: "CMP verified withdrawal",
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) throw Error("SUPPRESSION_PROPAGATION_FAILED");
  }
}
