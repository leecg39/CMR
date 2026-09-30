import { randomUUID, createHmac } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { transaction } from "../../packages/database/index.js";
import {
  fail,
  safeEqual,
  type Context,
} from "../../packages/consent-domain/common.js";
import { recordConsent } from "../../packages/consent-domain/consent.js";
function sign(data: unknown) {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  return (
    payload +
    "." +
    createHmac("sha256", process.env.SESSION_SECRET!)
      .update(payload)
      .digest("base64url")
  );
}
function verify(raw: string) {
  try {
    const [p, s] = raw.split(".");
    if (
      !safeEqual(
        sign(JSON.parse(Buffer.from(p, "base64url").toString())).split(".")[1],
        s,
      )
    )
      return null;
    const data = JSON.parse(Buffer.from(p, "base64url").toString());
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}
function tenantOf(key: string) {
  return z.uuid().parse(key.split(".")[0]);
}
function checkOrigin(req: FastifyRequest, site: any) {
  const origin =
    req.headers.origin ??
    (req.headers.referer ? new URL(req.headers.referer).origin : "");
  if (!site.verified_at) fail("DOMAIN_UNVERIFIED", 403);
  if (!origin || new URL(origin).host !== site.domain)
    fail("ORIGIN_FORBIDDEN", 403);
  return origin;
}
export async function webRoutes(app: FastifyInstance) {
  app.options("/v1/web/*", async (req, reply) => {
    const origin = req.headers.origin;
    if (origin)
      reply
        .header("Access-Control-Allow-Origin", origin)
        .header("Vary", "Origin");
    return reply
      .header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
      .header("Access-Control-Allow-Headers", "Content-Type")
      .code(204)
      .send();
  });
  app.get("/v1/web/config", async (req, reply) => {
    const q = z
        .object({ key: z.string(), session: z.string().optional() })
        .parse(req.query),
      tenant = tenantOf(q.key);
    return transaction(tenant, async (db) => {
      const {
        rows: [site],
      } = await db.query("SELECT * FROM sites WHERE public_key=$1", [q.key]);
      if (!site) fail("NOT_FOUND", 404);
      const origin = checkOrigin(req, site);
      reply
        .header("Access-Control-Allow-Origin", origin)
        .header("Vary", "Origin");
      const {
        rows: [config],
      } = await db.query(
        "SELECT * FROM web_configs WHERE site_id=$1 AND status='published' ORDER BY version DESC LIMIT 1",
        [site.id],
      );
      if (!config) fail("CONFIG_UNAVAILABLE", 503);
      let session = verify(q.session ?? "");
      if (session?.site !== site.id) session = null;
      const subject = session?.subject ?? randomUUID();
      await db.query(
        "INSERT INTO subjects(tenant_id,id,external_id,kind) VALUES($1,$2,$3,'browser') ON CONFLICT DO NOTHING",
        [tenant, subject, `browser:${site.id}:${subject}`],
      );
      const { rows: states } = await db.query(
        "SELECT c.*,p.key FROM consent_current c JOIN purposes p ON p.tenant_id=c.tenant_id AND p.id=c.purpose_id JOIN consent_events e ON e.tenant_id=c.tenant_id AND e.id=c.last_event_id WHERE c.subject_id=$1 AND p.kind='web_tracking' AND e.source=$2",
        [subject, `web:${site.id}:v${config.version}`],
      );
      const choices = {
        analytics: states.some(
          (s) => s.key === "analytics" && s.state === "GRANTED",
        ),
        advertising: states.some(
          (s) => s.key === "advertising" && s.state === "GRANTED",
        ),
      };
      return {
        session: sign({
          site: site.id,
          subject,
          tenant,
          exp: Date.now() + 180 * 86400000,
        }),
        config: {
          version: config.version,
          notice: config.notice,
          tags: config.tags,
          has_choice: states.length > 0,
        },
        choices,
      };
    });
  });
  app.post("/v1/web/consent", async (req, reply) => {
    const i = z
        .object({
          key: z.string(),
          session: z.string(),
          version: z.number().int(),
          choices: z
            .object({ analytics: z.boolean(), advertising: z.boolean() })
            .strict(),
          idempotency_key: z.string().max(100),
        })
        .strict()
        .parse(req.body),
      session = verify(i.session);
    if (!session || session.tenant !== tenantOf(i.key))
      fail("INVALID_SESSION", 401);
    return transaction(session.tenant, async (db) => {
      const {
        rows: [site],
      } = await db.query("SELECT * FROM sites WHERE public_key=$1 AND id=$2", [
        i.key,
        session.site,
      ]);
      if (!site) fail("NOT_FOUND", 404);
      reply
        .header("Access-Control-Allow-Origin", checkOrigin(req, site))
        .header("Vary", "Origin");
      const {
        rows: [config],
      } = await db.query(
        "SELECT * FROM web_configs WHERE site_id=$1 AND status='published' ORDER BY version DESC LIMIT 1",
        [site.id],
      );
      if (config.version !== i.version) fail("CONFIG_CHANGED", 409);
      const ctx: Context = {
        tenant: session.tenant,
        actor: `browser:${session.subject}`,
        role: "system",
      };
      for (const [key, granted] of Object.entries(i.choices)) {
        const {
          rows: [p],
        } = await db.query(
          "SELECT * FROM purposes WHERE key=$1 AND controller_id=$2",
          [key, site.controller_id],
        );
        const {
          rows: [n],
        } = await db.query(
          "SELECT id FROM notices WHERE purpose_id=$1 AND status='published' ORDER BY version DESC LIMIT 1",
          [p.id],
        );
        await recordConsent(
          db,
          ctx,
          {
            subject_id: session.subject,
            purpose_id: p.id,
            notice_id: n.id,
            action: granted ? "granted" : "denied",
            occurred_at: new Date().toISOString(),
            idempotency_key: `${i.idempotency_key}:${key}`,
          },
          { web: true, source: `web:${site.id}:v${config.version}` },
        );
      }
      return { choices: i.choices };
    });
  });
}
