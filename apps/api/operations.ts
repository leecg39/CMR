import { parse } from "csv-parse/sync";
import { randomUUID, createHmac } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { pool, transaction, audit } from "../../packages/database/index.js";
import { authenticate } from "../../packages/consent-domain/auth.js";
import {
  fail,
  hash,
  permit,
  safeEqual,
  type Context,
} from "../../packages/consent-domain/common.js";
import {
  owned,
  recordConsent,
  createSubject,
  addContact,
} from "../../packages/consent-domain/consent.js";
const auth = (r: FastifyRequest) =>
  authenticate(
    r.cookies.cmp_session,
    r.headers.authorization?.replace(/^Bearer /, ""),
  );
function sign(v: string) {
  return createHmac("sha256", process.env.SESSION_SECRET!)
    .update(v)
    .digest("base64url");
}
export async function operationRoutes(app: FastifyInstance) {
  app.post("/v1/retention-policy", async (req) => {
    const c = await auth(req);
    permit(c, "policy:write");
    const i = z
      .object({
        days: z.number().int().min(0).max(36500),
        basis: z.string().min(10).max(2000),
      })
      .strict()
      .parse(req.body);
    return transaction(c.tenant, async (db) => {
      await db.query(
        "INSERT INTO retention_policies(tenant_id,days,basis,approved_by) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id) DO UPDATE SET days=EXCLUDED.days,basis=EXCLUDED.basis,approved_by=EXCLUDED.approved_by,approved_at=now()",
        [c.tenant, i.days, i.basis, c.actor],
      );
      await audit(db, c.tenant, c.actor, "retention_policy.approved", i);
      return { ok: true };
    });
  });
  app.post("/v1/holds", async (req) => {
    const c = await auth(req);
    permit(c, "deletion:write");
    const i = z
      .object({
        subject_id: z.uuid(),
        basis: z.string().min(10),
        until_at: z.iso.datetime(),
      })
      .strict()
      .parse(req.body);
    return transaction(c.tenant, async (db) => {
      await owned(db, "subjects", i.subject_id);
      await db.query("INSERT INTO holds VALUES($1,$2,$3,$4,$5)", [
        c.tenant,
        randomUUID(),
        i.subject_id,
        i.basis,
        i.until_at,
      ]);
      return { ok: true };
    });
  });
  app.post("/v1/retention-purge", async (req) => {
    const c = await auth(req);
    permit(c, "deletion:write");
    const i = z.object({ subject_id: z.uuid() }).strict().parse(req.body);
    return transaction(c.tenant, async (db) => {
      await db.query("SELECT purge_retained_subject($1,$2)", [
        c.tenant,
        i.subject_id,
      ]);
      await audit(db, c.tenant, c.actor, "retention.purged", {
        subject_id: i.subject_id,
      });
      return { ok: true };
    });
  });
  app.post("/v1/agreement-versions", async (req) => {
    const c = await auth(req);
    permit(c, "policy:write");
    const i = z
      .object({
        title: z.string().min(1).max(100),
        body: z.string().min(20).max(20000),
      })
      .strict()
      .parse(req.body);
    return transaction(c.tenant, async (db) => {
      const {
        rows: [v],
      } = await db.query(
        "SELECT coalesce(max(version),0)+1 AS n FROM agreement_versions WHERE title=$1",
        [i.title],
      );
      const id = randomUUID();
      await db.query(
        "INSERT INTO agreement_versions(tenant_id,id,version,title,body,hash) VALUES($1,$2,$3,$4,$5,$6)",
        [c.tenant, id, v.n, i.title, i.body, hash(i.body)],
      );
      return { id, version: v.n };
    });
  });
  app.post("/v1/agreement-events", async (req) => {
    const c = await auth(req);
    permit(c, "consent:write");
    const i = z
      .object({
        subject_id: z.uuid(),
        version_id: z.uuid(),
        action: z.enum(["accepted", "withdrawn"]),
        idempotency_key: z.string().min(1).max(200),
      })
      .strict()
      .parse(req.body);
    return transaction(c.tenant, async (db) => {
      await owned(db, "subjects", i.subject_id);
      const {
        rows: [prior],
      } = await db.query(
        "SELECT * FROM agreement_events WHERE producer=$1 AND idempotency_key=$2",
        [c.actor, i.idempotency_key],
      );
      if (prior) {
        if (
          prior.subject_id !== i.subject_id ||
          prior.version_id !== i.version_id ||
          prior.action !== i.action
        )
          fail("IDEMPOTENCY_CONFLICT", 409);
        return { ...prior, duplicate: true };
      }
      const {
        rows: [event],
      } = await db.query(
        "INSERT INTO agreement_events(tenant_id,id,subject_id,version_id,action,producer,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [
          c.tenant,
          randomUUID(),
          i.subject_id,
          i.version_id,
          i.action,
          c.actor,
          i.idempotency_key,
        ],
      );
      return event;
    });
  });
  app.post("/v1/identity-links", async (req) => {
    const c = await auth(req);
    permit(c, "consent:write");
    const i = z
      .object({
        member_id: z.uuid(),
        browser_id: z.uuid(),
        assertion_id: z.string().min(1).max(200),
      })
      .strict()
      .parse(req.body);
    return transaction(c.tenant, async (db) => {
      const member = await owned(db, "subjects", i.member_id),
        browser = await owned(db, "subjects", i.browser_id);
      if (member.kind !== "member" || browser.kind !== "browser")
        fail("IDENTITY_KIND_MISMATCH");
      const {
        rows: [prior],
      } = await db.query("SELECT * FROM identity_links WHERE assertion_id=$1", [
        i.assertion_id,
      ]);
      if (prior) {
        if (
          prior.member_id !== i.member_id ||
          prior.browser_id !== i.browser_id
        )
          fail("IDEMPOTENCY_CONFLICT", 409);
        return prior;
      }
      const id = randomUUID();
      await db.query(
        "INSERT INTO identity_links(tenant_id,id,member_id,browser_id,verified_by,assertion_id) VALUES($1,$2,$3,$4,$5,$6)",
        [c.tenant, id, i.member_id, i.browser_id, c.actor, i.assertion_id],
      );
      return { id, consents_copied: false };
    });
  });
  app.post("/v1/revoke-links", async (req) => {
    const c = await auth(req);
    permit(c, "consent:write");
    const i = z
      .object({
        subject_id: z.uuid(),
        contact_id: z.uuid(),
        purpose_id: z.uuid(),
      })
      .strict()
      .parse(req.body);
    return transaction(c.tenant, async (db) => {
      const contact = await owned(db, "contact_points", i.contact_id),
        purpose = await owned(db, "purposes", i.purpose_id);
      if (
        contact.subject_id !== i.subject_id ||
        purpose.kind !== "advertising_reception" ||
        contact.channel !== purpose.channel
      )
        fail("SCOPE_MISMATCH");
      const p = Buffer.from(
        JSON.stringify({
          ...i,
          tenant: c.tenant,
          expires: Date.now() + 30 * 86400000,
        }),
      ).toString("base64url");
      return {
        url: process.env.APP_ORIGIN + "/preferences?token=" + p + "." + sign(p),
      };
    });
  });
  app.post("/v1/preference-actions/revoke", async (req) => {
    const i = z
        .object({ token: z.string().max(2000) })
        .strict()
        .parse(req.body),
      [raw, sig] = i.token.split(".");
    if (!sig || !safeEqual(sign(raw), sig)) fail("INVALID_TOKEN", 401);
    const p = z
      .object({
        tenant: z.uuid(),
        subject_id: z.uuid(),
        contact_id: z.uuid(),
        purpose_id: z.uuid(),
        expires: z.number(),
      })
      .strict()
      .parse(JSON.parse(Buffer.from(raw, "base64url").toString()));
    if (p.expires < Date.now()) fail("EXPIRED_TOKEN", 401);
    return transaction(p.tenant, (db) =>
      recordConsent(
        db,
        {
          tenant: p.tenant,
          actor: "revoke-link:" + hash(i.token),
          role: "system",
        },
        {
          subject_id: p.subject_id,
          contact_id: p.contact_id,
          purpose_id: p.purpose_id,
          action: "revoked",
          idempotency_key: hash(i.token),
        },
        { source: "signed_revoke_link" },
      ),
    );
  });
  app.get("/preferences", async (_req, reply) =>
    reply
      .type("text/html")
      .send(
        `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>광고 수신 철회</title><body style="font-family:system-ui;max-width:480px;margin:12vh auto;padding:25px"><h1>광고 수신을 철회하시겠어요?</h1><p>이 연락처의 해당 광고 수신 동의를 철회합니다. 다른 동의는 요구하지 않습니다.</p><button id="revoke" style="padding:15px 25px">수신 철회</button><p id="result" role="status"></p><script>document.getElementById('revoke').onclick=async function(){this.disabled=true;try{const r=await fetch('/v1/preference-actions/revoke',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:new URLSearchParams(location.search).get('token')})});if(!r.ok)throw Error();document.getElementById('result').textContent='광고 수신 동의를 철회했습니다.';}catch{this.disabled=false;document.getElementById('result').textContent='철회를 기록하지 못했습니다. 다시 시도해 주세요.';}};</script></body></html>`,
      ),
  );
  // This endpoint accepts a normalized event from an authenticated integration bridge, not an assumed SOLAPI signature format.
  app.post("/v1/provider-events/bridge", async (req) => {
    if (!process.env.PROVIDER_BRIDGE_SECRET) fail("BRIDGE_NOT_CONFIGURED", 503);
    const stamp = String(req.headers["x-cmp-timestamp"] ?? ""),
      sig = String(req.headers["x-cmp-signature"] ?? "");
    if (
      !/^\d+$/.test(stamp) ||
      Math.abs(Date.now() - Number(stamp) * 1000) > 300000
    )
      fail("STALE_SIGNATURE", 401);
    const expected = createHmac("sha256", process.env.PROVIDER_BRIDGE_SECRET!)
      .update(stamp + "." + JSON.stringify(req.body))
      .digest("hex");
    if (!safeEqual(sig, expected)) fail("INVALID_SIGNATURE", 401);
    const i = z
      .object({
        tenant_id: z.uuid(),
        event_id: z.string().min(1).max(100),
        kind: z.enum(["optout", "delivered", "failed"]),
        contact_id: z.uuid().optional(),
        job_id: z.uuid().optional(),
      })
      .strict()
      .parse(req.body);
    return transaction(i.tenant_id, async (db) => {
      const inserted = await db.query(
        "INSERT INTO provider_events(tenant_id,id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [i.tenant_id, i.event_id],
      );
      if (!inserted.rowCount) return { duplicate: true };
      if (i.kind === "optout") {
        if (!i.contact_id) fail("CONTACT_REQUIRED");
        const contact = await owned(db, "contact_points", i.contact_id!);
        const contacts = (
          await db.query(
            "SELECT * FROM contact_points WHERE value_hmac=$1 AND active",
            [contact.value_hmac],
          )
        ).rows;
        for (const c of contacts) {
          const states = (
            await db.query(
              "SELECT * FROM consent_current WHERE contact_id=$1",
              [c.id],
            )
          ).rows;
          for (const s of states)
            await recordConsent(
              db,
              { tenant: i.tenant_id, actor: "bridge", role: "system" },
              {
                subject_id: c.subject_id,
                contact_id: c.id,
                purpose_id: s.purpose_id,
                action: "revoked",
                idempotency_key: `bridge:${i.event_id}:${s.scope}`,
              },
              { source: "provider_080" },
            );
        }
      } else {
        if (!i.job_id) fail("JOB_REQUIRED");
        await owned(db, "message_jobs", i.job_id!);
        await db.query(
          "UPDATE message_jobs SET status=$2 WHERE id=$1 AND status IN ('dispatching','accepted','unknown')",
          [i.job_id, i.kind],
        );
      }
      await audit(db, i.tenant_id, "provider-bridge", "provider." + i.kind, {
        event_id: i.event_id,
      });
      return { ok: true };
    });
  });
  const importSchema = z
    .object({
      rows: z
        .array(
          z.object({
            external_id: z.string().min(1).max(100),
            phone: z.string().regex(/^010[0-9]{8}$/),
            state: z.enum(["granted", "denied", "revoked"]),
          }),
        )
        .min(1)
        .max(1000),
      commit: z.boolean().default(false),
    })
    .strict();
  app.post("/v1/import", async (req) => {
    const c = await auth(req);
    permit(c, "consent:write");
    const raw = req.body as Record<string, unknown>;
    const i = importSchema.parse(
      typeof raw?.csv === "string"
        ? {
            rows: parse(raw.csv, {
              columns: true,
              skip_empty_lines: true,
              trim: true,
            }),
            commit: raw.commit ?? false,
          }
        : raw,
    );
    const duplicates =
      i.rows.length - new Set(i.rows.map((r) => r.external_id)).size;
    if (duplicates) fail("DUPLICATE_IMPORT_MEMBERS");
    const summary = {
      rows: i.rows.length,
      unverified: i.rows.filter((r) => r.state === "granted").length,
      suppressions: i.rows.filter((r) => r.state !== "granted").length,
    };
    if (!i.commit) return { ...summary, preview: true };
    return transaction(c.tenant, async (db) => {
      const {
        rows: [purpose],
      } = await db.query("SELECT * FROM purposes WHERE key='ad_sms'");
      for (const [n, row] of [...i.rows]
        .sort(
          (a, b) =>
            Number(a.state === "granted") - Number(b.state === "granted"),
        )
        .entries()) {
        const s = await createSubject(db, c, { external_id: row.external_id }),
          contact = await addContact(db, c, {
            subject_id: s.id,
            channel: "sms",
            value: row.phone,
            verified: false,
          });
        await recordConsent(
          db,
          c,
          {
            subject_id: s.id,
            contact_id: contact.id,
            purpose_id: purpose.id,
            action: row.state,
            idempotency_key: `import:${hash(JSON.stringify(i.rows))}:${n}`,
          },
          { legacy: true, source: "legacy_import" },
        );
      }
      await audit(db, c.tenant, c.actor, "import.completed", summary);
      return { ...summary, preview: false };
    });
  });
  app.post("/v1/tenant/suspend", async (req) => {
    const c = await auth(req);
    permit(c, "org:write");
    await pool.query("UPDATE tenants SET status='suspended' WHERE id=$1", [
      c.tenant,
    ]);
    await transaction(c.tenant, (db) =>
      audit(db, c.tenant, c.actor, "tenant.suspended"),
    );
    return { ok: true };
  });
}
