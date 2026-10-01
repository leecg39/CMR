import Fastify, { type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import statics from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHmac } from "node:crypto";
import { z } from "zod";
import { pool, transaction, audit } from "../../packages/database/index.js";
import {
  AppError,
  fail,
  hash,
  token,
  permit,
  passwordHash,
  type Context,
} from "../../packages/consent-domain/common.js";
import {
  authenticate,
  login,
  beginMfa,
  finishMfa,
  normalizeEmail,
} from "../../packages/consent-domain/auth.js";
import {
  recordConsent,
  createSubject,
  addContact,
  owned,
} from "../../packages/consent-domain/consent.js";
import {
  evaluate,
  enqueue,
  templateIssues,
} from "../../packages/policy-engine/index.js";
import {
  evidence,
  csv,
  requestDeletion,
  confirmDeletionTask,
} from "../../packages/evidence/index.js";
import { runTenant } from "../worker/jobs.js";
import { verifyDomain, safeScan } from "../../packages/web-sdk/security.js";
import { webRoutes } from "./web.js";
import { operationRoutes } from "./operations.js";
const cookieName = "cmp_session";
const ctxFor = (r: FastifyRequest) =>
  authenticate(
    r.cookies[cookieName],
    r.headers.authorization?.replace(/^Bearer /, ""),
  );
// Database triggers and the purge function refuse business actions with RAISE EXCEPTION (P0001).
const databaseRefusals: Record<string, string> = {
  "retention period has not ended": "RETENTION_PERIOD_ACTIVE",
  "legal hold active": "LEGAL_HOLD_ACTIVE",
  "external deletion unconfirmed": "DELETION_UNCONFIRMED",
  "unconfirmed deletion tasks": "DELETION_UNCONFIRMED",
  "approved retention policy required": "RETENTION_POLICY_REQUIRED",
  "published version is immutable": "PUBLISHED_IMMUTABLE",
  "approved template is immutable": "APPROVED_IMMUTABLE",
  "immutable record: append a correction": "IMMUTABLE_RECORD",
};
const clientErrors: Record<number, string> = {
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  429: "RATE_LIMITED",
};
export async function buildApp() {
  const app = Fastify({ logger: false, bodyLimit: 262144, trustProxy: false });
  await app.register(cookie);
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  const localOrigin = ["127.0.0.1", "localhost"].includes(
    new URL(process.env.APP_ORIGIN ?? "http://127.0.0.1:4310").hostname,
  );
  const setSession = (reply: any, secret: string) =>
    reply.setCookie(cookieName, secret, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.APP_ORIGIN?.startsWith("https:"),
      path: "/",
      maxAge: 28800,
    });
  app.setErrorHandler((e: any, _req, reply) => {
    if (e instanceof z.ZodError)
      return reply.code(400).send({
        code: "INVALID_INPUT",
        error: "입력 형식을 확인해 주세요.",
        details: e.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    if (e instanceof AppError)
      return reply.code(e.status).send({
        code: e.code,
        error: e.code,
        ...(e.details ? { details: e.details } : {}),
      });
    if (e.code === "23505") return reply.code(409).send({ code: "CONFLICT" });
    if (e.code === "23503")
      return reply.code(400).send({ code: "INVALID_REFERENCE" });
    if (e.code === "23514" || e.code === "22P02" || e.code === "22007")
      return reply.code(400).send({ code: "INVALID_INPUT" });
    if (e.code === "P0001")
      return reply
        .code(409)
        .send({ code: databaseRefusals[e.message] ?? "STATE_CONFLICT" });
    // Fastify parser/limit errors (malformed JSON, body too large, media type) are client errors, not outages.
    if (
      typeof e.statusCode === "number" &&
      e.statusCode >= 400 &&
      e.statusCode < 500
    )
      return reply
        .code(e.statusCode)
        .send({ code: clientErrors[e.statusCode] ?? "INVALID_REQUEST" });
    console.error("request failed", e.code ?? e.name);
    return reply.code(503).send({
      code: "SERVICE_UNAVAILABLE",
      error: "요청을 완료하지 못했습니다. 광고 전송은 보류됩니다.",
    });
  });
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("Cache-Control", "private, no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "same-origin")
      .header("X-Frame-Options", "DENY")
      .header("Content-Security-Policy", "frame-ancestors 'none'");
    const host = req.headers.host?.split(":")[0],
      allowed = new URL(process.env.APP_ORIGIN ?? "http://127.0.0.1:4310")
        .hostname;
    if (![allowed, "127.0.0.1", "localhost"].includes(host ?? ""))
      fail("HOST_FORBIDDEN", 403);
    if (
      ["POST", "PATCH", "DELETE"].includes(req.method) &&
      !req.url.startsWith("/v1/web/") &&
      !req.url.startsWith("/v1/provider-events/") &&
      !req.headers.authorization
    ) {
      const origin = req.headers.origin;
      // The Vite dev server origins are accepted only for a local APP_ORIGIN.
      if (
        origin !== process.env.APP_ORIGIN &&
        !(
          localOrigin &&
          (origin === "http://127.0.0.1:5178" ||
            origin === "http://localhost:5178")
        )
      )
        fail("ORIGIN_REQUIRED", 403);
    }
  });
  app.get("/v1/health", async () => {
    await pool.query("SELECT 1");
    return {
      ok: true,
      storage: "postgresql",
      mode: process.env.DEMO_MODE === "true" ? "demo" : "production",
    };
  });
  app.post(
    "/v1/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const i = z
        .object({
          email: z.email(),
          password: z.string().max(200),
          code: z
            .string()
            .regex(/^\d{6}$/)
            .optional(),
        })
        .strict()
        .parse(req.body);
      const secret = await login(i.email, i.password, i.code);
      setSession(reply, secret);
      return { ok: true };
    },
  );
  app.post("/v1/auth/demo", async (_req, reply) => {
    if (process.env.DEMO_MODE !== "true") fail("NOT_FOUND", 404);
    const data = JSON.parse(fs.readFileSync(".local/demo-access.json", "utf8"));
    const secret = await login(data.email, data.password);
    setSession(reply, secret);
    return { ok: true };
  });
  app.post("/v1/auth/logout", async (req, reply) => {
    await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
      hash(req.cookies[cookieName] ?? ""),
    ]);
    reply.clearCookie(cookieName, { path: "/" });
    return { ok: true };
  });
  app.get("/v1/me", async (req) => {
    const ctx = await ctxFor(req);
    if (ctx.role === "api") fail("FORBIDDEN", 403);
    const { rows: tenants } = await pool.query(
      "SELECT t.id,t.name,t.plan,t.status,t.ad_limit,m.role FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE user_id=$1 ORDER BY t.name",
      [ctx.actor],
    );
    const {
      rows: [user],
    } = await pool.query(
      "SELECT name,email,mfa_secret IS NOT NULL AS mfa_enabled FROM users WHERE id=$1",
      [ctx.actor],
    );
    return { ctx, tenants, user };
  });
  app.post("/v1/auth/tenant", async (req) => {
    const ctx = await ctxFor(req),
      i = z.object({ tenant_id: z.uuid() }).strict().parse(req.body);
    if (ctx.role === "api") fail("FORBIDDEN", 403);
    if (
      !(
        await pool.query(
          "SELECT 1 FROM memberships WHERE user_id=$1 AND tenant_id=$2",
          [ctx.actor, i.tenant_id],
        )
      ).rowCount
    )
      fail("FORBIDDEN", 403);
    await pool.query("UPDATE sessions SET tenant_id=$2 WHERE token_hash=$1", [
      hash(req.cookies[cookieName] ?? ""),
      i.tenant_id,
    ]);
    return { ok: true };
  });
  app.post("/v1/auth/mfa/start", async (req) => {
    const ctx = await ctxFor(req);
    if (ctx.role === "api") fail("FORBIDDEN", 403);
    return beginMfa(ctx.actor);
  });
  app.post("/v1/auth/mfa/finish", async (req) => {
    const ctx = await ctxFor(req);
    if (ctx.role === "api") fail("FORBIDDEN", 403);
    await finishMfa(
      ctx.actor,
      z.object({ code: z.string().regex(/^\d{6}$/) }).parse(req.body).code,
    );
    await transaction(ctx.tenant, (db) =>
      audit(db, ctx.tenant, ctx.actor, "mfa.enabled"),
    );
    return { ok: true };
  });
  app.get("/v1/overview", async (req) => {
    const ctx = await ctxFor(req);
    permit(ctx, "read");
    return transaction(ctx.tenant, async (db) => {
      const q = async (sql: string) => (await db.query(sql)).rows;
      return {
        subjects: await q(
          "SELECT s.*,c.masked,c.id AS contact_id,c.verified,ce.id AS email_contact_id,ce.masked AS email_masked,coalesce(cs.state,'UNKNOWN') AS state,coalesce(cs.evidence,'REVIEW_REQUIRED') AS evidence,coalesce(cs.revision,0) AS revision FROM subjects s LEFT JOIN contact_points c ON c.tenant_id=s.tenant_id AND c.subject_id=s.id AND c.channel='sms' AND c.active LEFT JOIN contact_points ce ON ce.tenant_id=s.tenant_id AND ce.subject_id=s.id AND ce.channel='email' AND ce.active LEFT JOIN LATERAL (SELECT x.state,x.evidence,x.revision FROM consent_current x JOIN purposes p ON p.tenant_id=x.tenant_id AND p.id=x.purpose_id WHERE x.tenant_id=s.tenant_id AND x.subject_id=s.id AND x.contact_id=c.id AND p.kind='advertising_reception' AND p.channel='sms' ORDER BY (p.key='ad_sms') DESC,p.key LIMIT 1) cs ON true WHERE s.kind='member' ORDER BY s.external_id",
        ),
        purposes: await q("SELECT * FROM purposes ORDER BY name"),
        notices: await q(
          "SELECT n.*,p.name AS purpose_name FROM notices n JOIN purposes p ON p.tenant_id=n.tenant_id AND p.id=n.purpose_id ORDER BY created_at DESC",
        ),
        templates: await q(
          "SELECT * FROM templates WHERE approved_by IS DISTINCT FROM 'system:reviewed-notice-template-v1' ORDER BY name",
        ),
        messages: await q(
          "SELECT m.*,s.external_id,t.name AS template_name FROM message_jobs m JOIN subjects s ON s.tenant_id=m.tenant_id AND s.id=m.subject_id JOIN templates t ON t.tenant_id=m.tenant_id AND t.id=m.template_id ORDER BY m.created_at DESC LIMIT 100",
        ),
        notifications: await q(
          "SELECT * FROM notification_jobs ORDER BY due_at LIMIT 200",
        ),
        deletions: await q(
          "SELECT * FROM deletion_requests ORDER BY created_at DESC",
        ),
        deletion_tasks: await q("SELECT * FROM deletion_tasks"),
        sites: await q("SELECT * FROM sites ORDER BY created_at"),
        configs: await q("SELECT * FROM web_configs ORDER BY version DESC"),
        scans: await q("SELECT * FROM scans ORDER BY created_at DESC"),
        connectors: await q("SELECT * FROM connectors"),
        controllers: await q("SELECT * FROM controllers"),
        audit: await q(
          "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 50",
        ),
        stats: (
          await q(
            "SELECT (SELECT count(*) FROM subjects WHERE kind='member')::int AS subjects,(SELECT count(*) FROM consent_current WHERE state='GRANTED' AND evidence<>'VERIFIED')::int AS unverified,(SELECT count(*) FROM message_jobs WHERE status IN ('blocked','cancelled'))::int AS blocked,(SELECT count(*) FROM notification_jobs WHERE status NOT IN ('delivered','cancelled') AND due_at<now())::int AS overdue,(SELECT count(*) FROM deletion_requests WHERE status<>'completed')::int AS deletion_pending,(SELECT count(*) FROM outbox WHERE status<>'delivered')::int AS propagation_pending",
          )
        )[0],
      };
    });
  });
  app.post("/v1/subjects", async (req) => {
    const c = await ctxFor(req);
    return transaction(c.tenant, (db) => createSubject(db, c, req.body));
  });
  app.post("/v1/contacts", async (req) => {
    const c = await ctxFor(req);
    return transaction(c.tenant, (db) => addContact(db, c, req.body));
  });
  app.post("/v1/consent-events", async (req) => {
    const c = await ctxFor(req);
    return transaction(c.tenant, (db) => recordConsent(db, c, req.body));
  });
  app.get("/v1/subjects/:id/preferences", async (req) => {
    const c = await ctxFor(req);
    permit(c, "read");
    return transaction(c.tenant, async (db) => {
      const id = z.uuid().parse((req.params as any).id);
      await owned(db, "subjects", id);
      return {
        current: (
          await db.query("SELECT * FROM consent_current WHERE subject_id=$1", [
            id,
          ])
        ).rows,
        events: (
          await db.query(
            "SELECT * FROM consent_events WHERE subject_id=$1 ORDER BY seq DESC",
            [id],
          )
        ).rows,
      };
    });
  });
  app.post("/v1/decisions", async (req) => {
    const c = await ctxFor(req);
    return transaction(c.tenant, (db) => evaluate(db, c, req.body));
  });
  app.post("/v1/messages", async (req) => {
    const c = await ctxFor(req);
    return transaction(c.tenant, (db) => enqueue(db, c, req.body));
  });
  app.post("/v1/worker/run", async (req) => {
    const c = await ctxFor(req);
    permit(c, "messages:send");
    return runTenant(c.tenant);
  });
  app.get("/v1/evidence/:id", async (req, reply) => {
    const c = await ctxFor(req),
      id = z.uuid().parse((req.params as any).id);
    const bundle = await transaction(c.tenant, (db) => evidence(db, c, id));
    if ((req.query as any).format === "csv")
      return reply
        .type("text/csv; charset=utf-8")
        .header(
          "Content-Disposition",
          `attachment; filename="evidence-${id}.csv"`,
        )
        .send(csv(bundle.events));
    return reply
      .header(
        "Content-Disposition",
        `attachment; filename="evidence-${id}.json"`,
      )
      .send(bundle);
  });
  app.post("/v1/deletion-requests", async (req) => {
    const c = await ctxFor(req),
      i = z
        .object({
          subject_id: z.uuid(),
          reason: z.string().min(5).max(1000),
          identity_verified: z.literal(true),
        })
        .strict()
        .parse(req.body);
    return transaction(c.tenant, (db) =>
      requestDeletion(db, c, i.subject_id, i.reason),
    );
  });
  app.post("/v1/deletion-tasks/:id/confirm", async (req) => {
    const c = await ctxFor(req),
      i = z
        .object({ evidence: z.string().min(10).max(2000) })
        .strict()
        .parse(req.body);
    return transaction(c.tenant, (db) =>
      confirmDeletionTask(
        db,
        c,
        z.uuid().parse((req.params as any).id),
        i.evidence,
      ),
    );
  });
  app.post("/v1/notices", async (req) => {
    const c = await ctxFor(req);
    permit(c, "policy:write");
    const i = z
      .object({ purpose_id: z.uuid(), body: z.string().min(20).max(20000) })
      .strict()
      .parse(req.body);
    return transaction(c.tenant, async (db) => {
      await owned(db, "purposes", i.purpose_id);
      const {
        rows: [r],
      } = await db.query(
        "SELECT coalesce(max(version),0)+1 AS v FROM notices WHERE purpose_id=$1",
        [i.purpose_id],
      );
      const id = randomUUID();
      await db.query(
        "INSERT INTO notices(tenant_id,id,purpose_id,version,body,hash) VALUES($1,$2,$3,$4,$5,$6)",
        [c.tenant, id, i.purpose_id, r.v, i.body, hash(i.body)],
      );
      return { id };
    });
  });
  app.post("/v1/notices/:id/publish", async (req) => {
    const c = await ctxFor(req);
    permit(c, "policy:write");
    return transaction(c.tenant, async (db) => {
      const n = await owned(
        db,
        "notices",
        z.uuid().parse((req.params as any).id),
      );
      if (n.status === "published") return { ok: true, already: true };
      const p = await owned(db, "purposes", n.purpose_id);
      if (
        p.kind === "advertising_reception" &&
        (!n.body.includes("광고") || !n.body.includes("철회"))
      )
        fail("NOTICE_WORDING_REVIEW_REQUIRED");
      await db.query(
        "UPDATE notices SET status='published',approved_by=$2,published_at=now() WHERE id=$1",
        [n.id, c.actor],
      );
      await audit(db, c.tenant, c.actor, "notice.published", { id: n.id });
      return { ok: true };
    });
  });
  app.post("/v1/templates", async (req) => {
    const c = await ctxFor(req);
    permit(c, "policy:write");
    const i = z
      .object({
        controller_id: z.uuid(),
        purpose_id: z.uuid(),
        name: z.string().min(1).max(100),
        body: z.string().min(1).max(3000),
        title: z.string().max(100).default(""),
        route: z.enum(["sms", "lms", "mms"]).default("lms"),
        image_id: z.string().max(200).default(""),
      })
      .strict()
      .parse(req.body);
    return transaction(c.tenant, async (db) => {
      await owned(db, "controllers", i.controller_id);
      await owned(db, "purposes", i.purpose_id);
      const id = randomUUID();
      await db.query(
        "INSERT INTO templates(tenant_id,id,controller_id,purpose_id,name,channel,route,message_class,body,title,hash) VALUES($1,$2,$3,$4,$5,'sms',$9,'marketing',$6,$7,$8)",
        [
          c.tenant,
          id,
          i.controller_id,
          i.purpose_id,
          i.name,
          i.body,
          i.title,
          hash(
            i.body +
              "\n" +
              i.title +
              (i.route === "mms" ? "\nimage:" + i.image_id : ""),
          ),
          i.route,
        ],
      );
      await db.query("UPDATE templates SET image_id=$2 WHERE id=$1", [
        id,
        i.image_id,
      ]);
      return {
        id,
        issues: templateIssues({
          ...i,
          message_class: "marketing",
          route: i.route,
        }),
      };
    });
  });
  app.post("/v1/templates/:id/approve", async (req) => {
    const c = await ctxFor(req);
    permit(c, "policy:write");
    return transaction(c.tenant, async (db) => {
      const t = await owned(
          db,
          "templates",
          z.uuid().parse((req.params as any).id),
        ),
        issues = templateIssues(t);
      if (t.status === "approved") return { ok: true, already: true };
      if (issues.length) fail("TEMPLATE_REVIEW_REQUIRED", 400, issues);
      await db.query(
        "UPDATE templates SET status='approved',approved_by=$2 WHERE id=$1",
        [t.id, c.actor],
      );
      await audit(db, c.tenant, c.actor, "template.approved", { id: t.id });
      return { ok: true };
    });
  });
  app.post("/v1/sites", async (req) => {
    const c = await ctxFor(req);
    permit(c, "sites:write");
    const i = z
      .object({
        controller_id: z.uuid(),
        domain: z.string().regex(/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/),
      })
      .strict()
      .parse(req.body);
    return transaction(c.tenant, async (db) => {
      await owned(db, "controllers", i.controller_id);
      if (
        (await db.query("SELECT 1 FROM sites WHERE domain=$1", [i.domain]))
          .rowCount
      )
        fail("SITE_EXISTS", 409);
      const {
        rows: [s],
      } = await db.query(
        "INSERT INTO sites(tenant_id,id,controller_id,domain,verification_token,public_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
        [
          c.tenant,
          randomUUID(),
          i.controller_id,
          i.domain,
          token(),
          `${c.tenant}.${token()}`,
        ],
      );
      await audit(db, c.tenant, c.actor, "site.created", {
        id: s.id,
        domain: s.domain,
      });
      return s;
    });
  });
  app.post("/v1/sites/:id/verify", async (req) => {
    const c = await ctxFor(req);
    permit(c, "sites:write");
    const s = await transaction(c.tenant, (db) =>
      owned(db, "sites", z.uuid().parse((req.params as any).id)),
    );
    if (!(await verifyDomain(s.domain, s.verification_token)))
      fail("DNS_VERIFICATION_NOT_FOUND");
    return transaction(c.tenant, async (db) => {
      await db.query("UPDATE sites SET verified_at=now() WHERE id=$1", [s.id]);
      await audit(db, c.tenant, c.actor, "site.verified", { id: s.id });
      return { verified: true };
    });
  });
  app.post("/v1/sites/:id/scan", async (req) => {
    const c = await ctxFor(req);
    permit(c, "sites:write");
    const s = await transaction(c.tenant, (db) =>
      owned(db, "sites", z.uuid().parse((req.params as any).id)),
    );
    if (!s.verified_at) fail("DOMAIN_UNVERIFIED");
    let result;
    try {
      result = await safeScan(s.domain);
    } catch {
      result = {
        status: "failed",
        warnings: ["SCAN_REJECTED_OR_UNAVAILABLE"],
        requests: [],
      };
    }
    await transaction(c.tenant, (db) =>
      db.query(
        "INSERT INTO scans(tenant_id,id,site_id,status,result) VALUES($1,$2,$3,$4,$5)",
        [c.tenant, randomUUID(), s.id, result.status, JSON.stringify(result)],
      ),
    );
    return result;
  });
  app.post("/v1/sites/:id/browser-scan", async (req) => {
    const c = await ctxFor(req);
    permit(c, "sites:write");
    if (!process.env.SCAN_RUNNER_URL || !process.env.SCAN_RUNNER_TOKEN)
      fail("SCANNER_NOT_CONFIGURED", 503);
    const state = await transaction(c.tenant, async (db) => {
      const site = await owned(
        db,
        "sites",
        z.uuid().parse((req.params as any).id),
      );
      if (!site.verified_at) fail("DOMAIN_UNVERIFIED");
      const {
        rows: [config],
      } = await db.query(
        "SELECT * FROM web_configs WHERE site_id=$1 AND status='published' ORDER BY version DESC LIMIT 1",
        [site.id],
      );
      if (!config) fail("CONFIG_UNAVAILABLE");
      return { site, config };
    });
    const response = await fetch(process.env.SCAN_RUNNER_URL + "/scan", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.SCAN_RUNNER_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        domain: state.site.domain,
        tags: state.config.tags.map((tag: any) => ({
          src: tag.src,
          purpose: tag.purpose,
        })),
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!response.ok) fail("ISOLATED_SCAN_FAILED", 503);
    const result = (await response.json()) as { status: string };
    await transaction(c.tenant, (db) =>
      db.query(
        "INSERT INTO scans(tenant_id,id,site_id,status,result) VALUES($1,$2,$3,$4,$5)",
        [
          c.tenant,
          randomUUID(),
          state.site.id,
          result.status,
          JSON.stringify(result),
        ],
      ),
    );
    return result;
  });
  app.post("/v1/web-configs", async (req) => {
    const c = await ctxFor(req);
    permit(c, "sites:write");
    const i = z
      .object({
        site_id: z.uuid(),
        notice: z.string().min(10).max(5000),
        tags: z
          .array(
            z.object({
              id: z.string().regex(/^[a-z0-9_-]+$/),
              name: z.string().max(100),
              purpose: z.enum(["analytics", "advertising"]),
              type: z.enum(["script", "pixel", "iframe"]),
              src: z.url().refine((s) => s.startsWith("https://")),
              cookies: z
                .array(z.string().regex(/^[a-zA-Z0-9_-]+$/))
                .default([]),
            }),
          )
          .max(50)
          .refine((tags) => new Set(tags.map((t) => t.id)).size === tags.length, {
            message: "DUPLICATE_TAG_ID",
          }),
      })
      .strict()
      .parse(req.body);
    return transaction(c.tenant, async (db) => {
      const s = await owned(db, "sites", i.site_id);
      if (!s.verified_at) fail("DOMAIN_UNVERIFIED");
      const {
        rows: [v],
      } = await db.query(
        "SELECT coalesce(max(version),0)+1 AS n FROM web_configs WHERE site_id=$1",
        [s.id],
      );
      const id = randomUUID();
      await db.query(
        "INSERT INTO web_configs(tenant_id,id,site_id,version,notice,tags) VALUES($1,$2,$3,$4,$5,$6)",
        [c.tenant, id, s.id, v.n, i.notice, JSON.stringify(i.tags)],
      );
      return { id };
    });
  });
  app.post("/v1/web-configs/:id/publish", async (req) => {
    const c = await ctxFor(req);
    permit(c, "policy:write");
    return transaction(c.tenant, async (db) => {
      const v = await owned(
        db,
        "web_configs",
        z.uuid().parse((req.params as any).id),
      );
      if (v.status === "published") return { ok: true, already: true };
      await db.query(
        "UPDATE web_configs SET status='published',published_at=now() WHERE id=$1",
        [v.id],
      );
      await audit(db, c.tenant, c.actor, "web_config.published", { id: v.id });
      return { ok: true };
    });
  });
  app.post("/v1/keys", async (req) => {
    const c = await ctxFor(req);
    permit(c, "org:write");
    const i = z
        .object({
          name: z.string().min(1).max(100),
          scopes: z
            .array(
              z.enum([
                "consent:write",
                "read",
                "decisions",
                "messages:send",
                "evidence:read",
                "deletion:write",
              ]),
            )
            .min(1),
        })
        .strict()
        .parse(req.body),
      secret = "cmp_sk_" + token();
    await transaction(c.tenant, async (db) => {
      await db.query(
        "INSERT INTO api_keys(id,tenant_id,name,token_hash,scopes) VALUES($1,$2,$3,$4,$5)",
        [randomUUID(), c.tenant, i.name, hash(secret), i.scopes],
      );
      await audit(db, c.tenant, c.actor, "api_key.created", { name: i.name });
    });
    return { secret };
  });
  app.get("/v1/keys", async (req) => {
    const c = await ctxFor(req);
    permit(c, "org:write");
    return (
      await pool.query(
        "SELECT id,name,scopes,created_at,revoked_at FROM api_keys WHERE tenant_id=$1 ORDER BY created_at DESC",
        [c.tenant],
      )
    ).rows;
  });
  app.delete("/v1/keys/:id", async (req) => {
    const c = await ctxFor(req);
    permit(c, "org:write");
    const id = z.uuid().parse((req.params as any).id);
    return transaction(c.tenant, async (db) => {
      const {
        rows: [key],
      } = await db.query(
        "SELECT revoked_at FROM api_keys WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [c.tenant, id],
      );
      if (!key) fail("NOT_FOUND", 404);
      // Keep the first revocation time; repeating the call must not rewrite history.
      if (key.revoked_at) return { ok: true, already: true };
      await db.query(
        "UPDATE api_keys SET revoked_at=now() WHERE tenant_id=$1 AND id=$2",
        [c.tenant, id],
      );
      await audit(db, c.tenant, c.actor, "api_key.revoked", { id });
      return { ok: true };
    });
  });
  app.post("/v1/memberships", async (req) => {
    const c = await ctxFor(req);
    permit(c, "org:write");
    const i = z
      .object({
        email: z.email(),
        name: z.string().min(1).max(80),
        password: z.string().min(12).max(200),
        role: z.enum([
          "owner",
          "privacy_officer",
          "marketer",
          "developer",
          "auditor",
        ]),
      })
      .strict()
      .parse(req.body);
    const digest = passwordHash(i.password);
    // User and membership are created together so a failure cannot leave an orphan account.
    return transaction(c.tenant, async (db) => {
      const id = randomUUID();
      await db.query(
        "INSERT INTO users(id,email,password_hash,name) VALUES($1,$2,$3,$4)",
        [id, normalizeEmail(i.email), digest, i.name],
      );
      await db.query(
        "INSERT INTO memberships(user_id,tenant_id,role) VALUES($1,$2,$3)",
        [id, c.tenant, i.role],
      );
      await audit(db, c.tenant, c.actor, "membership.created", {
        user_id: id,
        role: i.role,
      });
      return { id };
    });
  });
  app.post("/v1/plan", async (req) => {
    const c = await ctxFor(req);
    permit(c, "org:write");
    const i = z
      .object({ ad_limit: z.number().int().min(0).max(1000000) })
      .strict()
      .parse(req.body);
    return transaction(c.tenant, async (db) => {
      await db.query("UPDATE tenants SET ad_limit=$2 WHERE id=$1", [
        c.tenant,
        i.ad_limit,
      ]);
      await audit(db, c.tenant, c.actor, "plan.ad_limit_changed", i);
      return { ok: true, ad_limit: i.ad_limit };
    });
  });
  app.post("/v1/connectors/:id/mock-mode", async (req) => {
    const c = await ctxFor(req);
    permit(c, "org:write");
    const i = z
      .object({
        mode: z.enum(["normal", "timeout_before", "timeout_after", "reject"]),
      })
      .strict()
      .parse(req.body);
    const id = z.uuid().parse((req.params as any).id);
    return transaction(c.tenant, async (db) => {
      const r = await db.query(
        "UPDATE connectors SET mode=$2 WHERE id=$1 AND provider='mock'",
        [id, i.mode],
      );
      if (!r.rowCount) fail("NOT_FOUND", 404);
      await audit(db, c.tenant, c.actor, "connector.mock_mode", {
        id,
        mode: i.mode,
      });
      return { ok: true };
    });
  });
  await operationRoutes(app);
  await webRoutes(app);
  app.get("/sdk/cmp.js", async (_req, reply) =>
    reply
      .type("application/javascript")
      .send(fs.readFileSync("packages/web-sdk/cmp.js", "utf8")),
  );
  app.post("/v1/demo/site", async (req) => {
    const c = await ctxFor(req);
    permit(c, "sites:write");
    if (process.env.DEMO_MODE !== "true") fail("NOT_FOUND", 404);
    return transaction(c.tenant, async (db) => {
      const {
          rows: [controller],
        } = await db.query("SELECT id FROM controllers ORDER BY name LIMIT 1"),
        domain = new URL(process.env.APP_ORIGIN!).host;
      if (!controller) fail("CONTROLLER_REQUIRED", 409);
      const {
        rows: [existing],
      } = await db.query("SELECT * FROM sites WHERE domain=$1", [domain]);
      if (existing) return existing;
      const id = randomUUID(),
        key = `${c.tenant}.${token()}`;
      await db.query(
        "INSERT INTO sites(tenant_id,id,controller_id,domain,verification_token,verified_at,public_key) VALUES($1,$2,$3,$4,$5,now(),$6)",
        [c.tenant, id, controller.id, domain, token(), key],
      );
      await db.query(
        "INSERT INTO web_configs(tenant_id,id,site_id,version,notice,tags,status,published_at) VALUES($1,$2,$3,1,$4,$5,'published',now())",
        [
          c.tenant,
          randomUUID(),
          id,
          "분석과 웹 광고 사용을 직접 선택하세요. 이 선택은 문자 광고 수신 동의와 별개입니다.",
          JSON.stringify([
            {
              id: "analytics_demo",
              name: "분석 검증 태그",
              purpose: "analytics",
              type: "script",
              src: process.env.APP_ORIGIN + "/demo/tag.js?kind=analytics",
              cookies: [],
            },
            {
              id: "advertising_demo",
              name: "광고 검증 태그",
              purpose: "advertising",
              type: "script",
              src: process.env.APP_ORIGIN + "/demo/tag.js?kind=advertising",
              cookies: [],
            },
          ]),
        ],
      );
      return { id, public_key: key, domain };
    });
  });
  app.get("/demo/tag.js", async (req, reply) => {
    if (process.env.DEMO_MODE !== "true") fail("NOT_FOUND", 404);
    const kind = z
      .enum(["analytics", "advertising"])
      .parse((req.query as any).kind);
    return reply
      .type("application/javascript")
      .send(
        `window.demoRequests=window.demoRequests||[];window.demoRequests.push('${kind}');document.getElementById('requests').textContent=window.demoRequests.join(', ');`,
      );
  });
  app.get("/demo", async (req, reply) => {
    if (process.env.DEMO_MODE !== "true") fail("NOT_FOUND", 404);
    const key = z
      .string()
      .regex(/^[a-zA-Z0-9_.-]+$/)
      .parse((req.query as any).key);
    return reply
      .type("text/html")
      .send(
        `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>CMP 웹 동의 체험</title><body style="font-family:system-ui;background:#f3f6f4;padding:8vw;color:#173b30"><p>CONSENT OPERATIONS · TEST SITE</p><h1>방문자의 선택이<br>태그 실행을 결정합니다.</h1><p>하단 설정에서 분석과 광고를 선택하세요.</p><p>이 페이지에서 실제 실행된 태그: <strong id="requests">없음</strong></p><p>쿠키 허용은 문자 광고 동의로 확장되지 않습니다.</p><script src="/sdk/cmp.js" data-site="${key}"></script></body></html>`,
      );
  });
  if (fs.existsSync("dist/console")) {
    await app.register(statics, {
      root: path.resolve("dist/console"),
      prefix: "/",
    });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith("/v1")
        ? reply.code(404).send({ code: "NOT_FOUND" })
        : reply.sendFile("index.html"),
    );
  }
  return app;
}
