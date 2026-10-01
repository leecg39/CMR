// Frozen evaluation: do not edit after the baseline has been committed.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import pg from "pg";

const output = process.argv[2];
assert.ok(output, "output JSON path is required");
const suffix = randomBytes(6).toString("hex");
const name = `cmp_research_${suffix}`;
const role = `${name}_app`;
const password = randomBytes(16).toString("hex");
const admin = new pg.Client({ host: process.env.PGHOST ?? "/tmp", database: "postgres" });
let appPool: pg.Pool | undefined;
const checks: string[] = [];
await admin.connect();
try {
  await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`);
  await admin.query(`CREATE DATABASE ${name}`);
  const schema = new pg.Client({ host: process.env.PGHOST ?? "/tmp", database: name });
  await schema.connect();
  try {
    await schema.query([
      "schema.sql", "0002_agreements.sql", "0003_retention.sql", "0004_templates.sql",
    ].map(file => fs.readFileSync(`packages/database/${file}`, "utf8")).join("\n"));
    await schema.query(`GRANT CONNECT ON DATABASE ${name} TO ${role}; GRANT USAGE ON SCHEMA public TO ${role}; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${role}; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}; GRANT EXECUTE ON FUNCTION purge_retained_subject(uuid,uuid) TO ${role};`);
  } finally { await schema.end(); }
  process.env.DATABASE_URL = `postgresql://${role}:${password}@127.0.0.1:5432/${name}`;
  process.env.CMP_MASTER_KEY = randomBytes(32).toString("base64");
  process.env.SESSION_SECRET = randomBytes(32).toString("hex");
  process.env.DEMO_MODE = "false";
  const { pool, transaction, assertRuntimeRole } = await import("../../packages/database/index.js");
  appPool = pool;
  const { fixture, NOW } = await import("../../packages/test-fixtures/index.js");
  const { evaluate, RULESET } = await import("../../packages/policy-engine/index.js");
  const { recordConsent } = await import("../../packages/consent-domain/consent.js");
  await assertRuntimeRole();
  checks.push("non-owner role / FORCE RLS");
  const allowed = await fixture();
  const checkDecision = async (f: Awaited<ReturnType<typeof fixture>>, reasons: string[], now = NOW) => {
    const d = await transaction(f.tenant, db => evaluate(db, f.ctx, f.input, now));
    assert.equal(d.allowed, reasons.length === 0);
    assert.deepEqual(d.reasons, reasons);
    assert.equal(d.ruleset, RULESET);
    assert.equal(d.evaluated_at, now.toISOString());
    const stored = await transaction(f.tenant, async db => (await db.query("SELECT * FROM decisions WHERE id=$1", [d.id])).rows[0]);
    assert.equal(stored.allowed, d.allowed);
    assert.deepEqual(stored.reasons, d.reasons);
    assert.equal(stored.revision, d.revision);
    assert.equal(stored.evaluated_at.toISOString(), d.evaluated_at);
    assert.deepEqual(stored.input, { ...f.input, message_hash: (await transaction(f.tenant, async db => (await db.query("SELECT hash FROM templates WHERE id=$1", [f.template])).rows[0])).hash, connector_id: f.connector, controller_id: f.controller });
    return d;
  };
  assert.equal((await checkDecision(allowed, [])).revision, 1);
  checks.push("allowed decision and persisted evidence");
  for (const [options, reasons, label] of [
    [{ sms: false }, ["RECEPTION_CONSENT_MISSING"], "missing reception consent"],
    [{ legacy: true }, ["EVIDENCE_UNVERIFIED"], "legacy evidence"],
    [{ limit: 0 }, ["QUOTA_EXCEEDED"], "quota exceeded"],
  ] as const) {
    await checkDecision(await fixture(options), [...reasons]);
    checks.push(label);
  }
  for (const [sql, reasons, label] of [
    ["UPDATE subjects SET restricted=true", ["SUBJECT_RESTRICTED"], "restricted subject"],
    ["UPDATE contact_points SET verified=false", ["CONTACT_UNVERIFIED"], "unverified contact"],
    ["UPDATE contact_points SET channel='email'", ["CHANNEL_MISMATCH", "PURPOSE_SCOPE_MISMATCH"], "channel mismatch"],
    ["UPDATE templates SET status='draft'", ["TEMPLATE_UNAPPROVED"], "unapproved template"],
    ["UPDATE connectors SET status='not_configured'", ["PROVIDER_NOT_READY"], "inactive connector"],
    ["UPDATE connectors SET provider='solapi',last_optout_sync=NULL", ["OPTOUT_SYNC_UNVERIFIED"], "stale optout sync"],
    ["UPDATE purposes SET reviewed=false WHERE key='ad_sms'", ["LAWFUL_BASIS_UNREVIEWED"], "unreviewed purpose"],
    ["UPDATE templates SET status='draft'; UPDATE templates SET purpose_id=NULL,status='approved'", ["PURPOSE_SCOPE_MISMATCH", "LAWFUL_BASIS_UNREVIEWED", "RECEPTION_CONSENT_MISSING"], "null purpose"],
    ["UPDATE tenants SET status='inactive' WHERE id=$1", ["TENANT_INACTIVE"], "inactive tenant"],
  ] as const) {
    const f = await fixture();
    await transaction(f.tenant, db => db.query(sql, sql.includes("$1") ? [f.tenant] : undefined));
    await checkDecision(f, [...reasons]);
    checks.push(label);
  }
  await checkDecision(allowed, ["OUTSIDE_DAYTIME"], new Date("2026-09-30T13:00:00Z"));
  checks.push("outside daytime");
  const revoked = await fixture();
  await transaction(revoked.tenant, db => recordConsent(db, revoked.ctx, {
    subject_id: revoked.subject, contact_id: revoked.contact, purpose_id: revoked.purposes.ad_sms,
    action: "revoked", idempotency_key: "research-revoke",
  }, { now: NOW }));
  assert.equal((await checkDecision(revoked, ["CONSENT_WITHDRAWN", "SUPPRESSED"])).revision, 2);
  checks.push("withdrawal / suppression / revision");
  const other = await fixture();
  for (const field of ["subject_id", "contact_id", "template_id"] as const) {
    for (const id of [randomUUID(), other.input[field]]) {
      await assert.rejects(transaction(allowed.tenant, db => evaluate(db, allowed.ctx, { ...allowed.input, [field]: id }, NOW)), (e: any) => e.code === "NOT_FOUND" && e.status === 404);
    }
    checks.push(`missing / foreign ${field}`);
  }
  await assert.rejects(transaction(allowed.tenant, db => evaluate(db, { ...allowed.ctx, role: "viewer" }, allowed.input, NOW)), (e: any) => e.code === "FORBIDDEN");
  checks.push("permission denial");

  const counts: number[] = [];
  const sample = async () => {
    let queries = 0;
    const start = performance.now();
    const decision = await transaction(allowed.tenant, db => evaluate(new Proxy(db, {
      get(target, key, receiver) {
        if (key === "query") return (...args: any[]) => { queries++; return Reflect.apply(target.query, target, args); };
        return Reflect.get(target, key, receiver);
      },
    }), allowed.ctx, allowed.input, NOW));
    const ms = performance.now() - start;
    assert.equal(decision.allowed, true);
    assert.deepEqual(decision.reasons, []);
    assert.equal(decision.revision, 1);
    return { ms, queries };
  };
  for (let i = 0; i < 20; i++) await sample();
  const runs = [];
  for (let run = 0; run < 5; run++) {
    const times: number[] = [];
    for (let batch = 0; batch < 20; batch++) {
      const samples = await Promise.all(Array.from({ length: 5 }, sample));
      samples.forEach(s => { times.push(s.ms); counts.push(s.queries); });
    }
    times.sort((a, b) => a - b);
    runs.push({ samples: 100, concurrency: 5, p50_ms: times[49], p95_ms: times[94], max_ms: times[99] });
  }
  assert.ok(counts.every(n => n === counts[0]), "query count must be stable");
  const p95s = runs.map(r => r.p95_ms).sort((a, b) => a - b);
  const result = {
    source_commit: (await import("node:child_process")).execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    environment: "local PostgreSQL / isolated synthetic DB / not a production SLA",
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    metric_direction: "lower_is_better", metric: counts[0], metric_name: "SQL calls per allowed marketing evaluation",
    transaction_queries_excluded: true, warmup: 20, samples: counts.length, runs,
    median_p95_ms: p95s[2], semantic_checks: checks, passed: true,
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ metric: result.metric, median_p95_ms: result.median_p95_ms, semantic_checks: checks.length, output }));
  if (process.argv[3]) {
    const previous = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
    const baseline = JSON.parse(fs.readFileSync(process.argv[4], "utf8"));
    assert.ok(result.metric < previous.metric, "SQL calls must decrease from the previous best");
    assert.ok(result.median_p95_ms <= baseline.median_p95_ms * 1.2, "p95 latency must stay within 120% of the original baseline");
  }
} finally {
  await appPool?.end();
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.query(`DROP ROLE IF EXISTS ${role}`);
  await admin.end();
}
