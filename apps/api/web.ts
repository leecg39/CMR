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
function mac(payload: string) {
  return createHmac("sha256", process.env.SESSION_SECRET!)
    .update(payload)
    .digest("base64url");
}
function sign(data: unknown) {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  return payload + "." + mac(payload);
}
// The MAC covers the exact transmitted payload, so verification never depends on JSON re-serialization.
function verify(raw: string) {
  try {
    const [p, s] = raw.split(".");
    if (!p || !s || !safeEqual(mac(p), s)) return null;
    const data = JSON.parse(Buffer.from(p, "base64url").toString());
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}
function tenantOf(key: string) {
  return z.uuid().parse(key.split(".")[0]);
}
function originOf(value?: string) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.origin
      : "";
  } catch {
    return "";
  }
}
function checkOrigin(req: FastifyRequest, site: any) {
  // A present Origin header (including the opaque "null") is authoritative; Referer is only a fallback.
  const origin =
    req.headers.origin !== undefined
      ? originOf(req.headers.origin)
      : originOf(req.headers.referer);
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
      // The browser subject row is created only when a choice is recorded, not on every anonymous page view.
      const subject = session?.subject ?? randomUUID();
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
      if (!config) fail("CONFIG_UNAVAILABLE", 503);
      if (config.version !== i.version) fail("CONFIG_CHANGED", 409);
      await db.query(
        "INSERT INTO subjects(tenant_id,id,external_id,kind) VALUES($1,$2,$3,'browser') ON CONFLICT DO NOTHING",
        [
          session.tenant,
          session.subject,
          `browser:${site.id}:${session.subject}`,
        ],
      );
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
        // A refusal for a purpose that is not configured has nothing to record; an allow must never be silently dropped.
        if (!p) {
          if (granted) fail("PURPOSE_NOT_CONFIGURED", 409);
          continue;
        }
        const {
          rows: [n],
        } = await db.query(
          "SELECT id FROM notices WHERE purpose_id=$1 AND status='published' ORDER BY version DESC LIMIT 1",
          [p.id],
        );
        if (granted && !n) fail("NOTICE_NOT_PUBLISHED", 409);
        const requestKey = `${i.idempotency_key}:${key}`;
        const {
          rows: [prior],
        } = await db.query(
          "SELECT action,notice_id,occurred_at,purpose_id,source FROM consent_events WHERE producer=$1 AND idempotency_key=$2",
          [ctx.actor, requestKey],
        );
        const source = `web:${site.id}:v${config.version}`;
        if (prior && (prior.purpose_id !== p.id || prior.source !== source))
          fail("IDEMPOTENCY_CONFLICT", 409);
        const {
          rows: [current],
        } = await db.query(
          "SELECT state FROM consent_current WHERE subject_id=$1 AND purpose_id=$2 AND contact_id IS NULL",
          [session.subject, p.id],
        );
        const sameChoice = prior && granted === (prior.action === "granted");
        const action = sameChoice
          ? prior.action
          : granted
            ? "granted"
            : ["GRANTED", "REVOKED"].includes(current?.state)
              ? "revoked"
              : "denied";
        await recordConsent(
          db,
          ctx,
          {
            subject_id: session.subject,
            purpose_id: p.id,
            notice_id: sameChoice ? prior.notice_id : (n?.id ?? null),
            action,
            occurred_at: sameChoice
              ? new Date(prior.occurred_at).toISOString()
              : new Date().toISOString(),
            idempotency_key: requestKey,
          },
          { web: true, source },
        );
      }
      const { rows: states } = await db.query(
        "SELECT p.key,c.state FROM consent_current c JOIN purposes p ON p.tenant_id=c.tenant_id AND p.id=c.purpose_id JOIN consent_events e ON e.tenant_id=c.tenant_id AND e.id=c.last_event_id WHERE c.subject_id=$1 AND p.kind='web_tracking' AND e.source=$2",
        [session.subject, `web:${site.id}:v${config.version}`],
      );
      return {
        choices: {
          analytics: states.some(
            (s) => s.key === "analytics" && s.state === "GRANTED",
          ),
          advertising: states.some(
            (s) => s.key === "advertising" && s.state === "GRANTED",
          ),
        },
      };
    });
  });
}
