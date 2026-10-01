import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import {
  randomBytes,
  randomUUID,
  createHash,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";

// Create synthetic data in a disposable database. Never seed or migrate the working DB.
const suffix = randomBytes(5).toString("hex"),
  database = `cmp_poc_${suffix}`,
  restoredDatabase = `${database}_restore`,
  role = `${database}_app`,
  password = randomBytes(24).toString("hex"),
  output = path.resolve(process.env.CMP_POC_OUTPUT ?? "artifacts/poc/latest");
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "api.log"), "");
const report: {
  started_at: string;
  source_sha256: string;
  checks: { name: string; status: string; details?: unknown }[];
  environment?: unknown;
  browser?: unknown;
  status: string;
  finished_at?: string;
  cleanup?: string;
} = {
  started_at: new Date().toISOString(),
  source_sha256: createHash("sha256")
    .update(
      ["apps", "packages", "scripts", "tests"]
        .flatMap((dir) =>
          fs
            .readdirSync(dir, { recursive: true, encoding: "utf8" })
            .map((file) => path.join(dir, file))
            .filter((file) => fs.statSync(file).isFile()),
        )
        .concat(["package.json", "package-lock.json"])
        .sort()
        .map((file) => file + "\0" + fs.readFileSync(file, "utf8"))
        .join("\0"),
    )
    .digest("hex"),
  checks: [],
  status: "running",
};
const save = () =>
  fs.writeFileSync(
    path.join(output, "http.json"),
    JSON.stringify(report, null, 2),
  );
const check = async (name: string, fn: () => Promise<unknown>) => {
  try {
    const details = await fn();
    report.checks.push({ name, status: "passed", details });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.checks.push({
      name,
      status: "failed",
      details: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    save();
  }
};
const admin = new pg.Client({
  host: process.env.PGHOST ?? "/tmp",
  database: "postgres",
});
let api: ChildProcess | undefined;
let runtimePool: pg.Pool | undefined;
let restoredPool: pg.Pool | undefined;
let createdDb = false;
let createdRestoredDb = false;
let createdRole = false;
async function stopApi() {
  const child = api;
  api = undefined;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}
try {
  await admin.connect();
  const postgres = (await admin.query("SELECT version() AS version")).rows[0]
    .version;
  await admin.query(
    `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`,
  );
  createdRole = true;
  await admin.query(`CREATE DATABASE ${database}`);
  createdDb = true;
  const schema = new pg.Client({
    host: process.env.PGHOST ?? "/tmp",
    database,
  });
  try {
    await schema.connect();
    const files = [
      "schema.sql",
      ...fs
        .readdirSync("packages/database")
        .filter((f) => /^\d{4}_.*\.sql$/.test(f))
        .sort(),
    ];
    for (const file of files)
      await schema.query(
        fs.readFileSync(path.join("packages/database", file), "utf8"),
      );
    await schema.query(
      `GRANT CONNECT ON DATABASE ${database} TO ${role}; GRANT USAGE ON SCHEMA public TO ${role}; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${role}; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}; GRANT EXECUTE ON FUNCTION purge_retained_subject(uuid,uuid) TO ${role};`,
    );
  } finally {
    await schema.end();
  }

  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = (probe.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) =>
    probe.close((e) => (e ? reject(e) : resolve())),
  );
  const origin = `http://127.0.0.1:${port}`;
  Object.assign(process.env, {
    DATABASE_URL: `postgresql://${role}:${password}@127.0.0.1:5432/${database}`,
    CMP_MASTER_KEY: randomBytes(32).toString("base64"),
    SESSION_SECRET: randomBytes(32).toString("hex"),
    DEMO_MODE: "false",
    REQUIRE_MFA: "false",
    SOLAPI_LIVE_ENABLED: "false",
    APP_ORIGIN: origin,
    PORT: String(port),
  });
  const { pool, transaction, assertRuntimeRole, audit } =
    await import("../packages/database/index.js");
  runtimePool = pool;
  const { fixture } = await import("../packages/test-fixtures/index.js");
  const { hash, token } = await import("../packages/consent-domain/common.js");
  const { recordConsent } =
    await import("../packages/consent-domain/consent.js");
  const a = await fixture(),
    b = await fixture();
  const makeKey = async (tenant: string, scopes: string[]) => {
    const secret = token();
    await pool.query(
      "INSERT INTO api_keys(id,tenant_id,name,token_hash,scopes) VALUES($1,$2,'poc',$3,$4)",
      [randomUUID(), tenant, hash(secret), scopes],
    );
    return secret;
  };
  const scopes = ["read", "evidence:read", "consent:write", "sites:write"];
  const keyA = await makeKey(a.tenant, scopes),
    keyB = await makeKey(b.tenant, scopes);
  const readOnly = await makeKey(a.tenant, ["read", "evidence:read"]);
  const request = async (url: string, key?: string, body?: unknown) => {
    const response = await fetch(origin + url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    return { status: response.status, body: await response.json() };
  };
  const startApi = async (demo = false) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "apps/api/server.ts"],
      {
        env: { ...process.env, DEMO_MODE: String(demo) },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    api = child;
    let spawnError: Error | undefined;
    child.on("error", (error) => {
      spawnError = error;
    });
    for (const stream of [child.stdout, child.stderr])
      stream?.on("data", (data) =>
        fs.appendFileSync(path.join(output, "api.log"), data),
      );
    const until = Date.now() + 15000;
    while (Date.now() < until) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null)
        throw Error("PoC API stopped before readiness; see api.log");
      try {
        if ((await request("/v1/health")).status === 200) return;
      } catch {}
      await delay(100);
    }
    throw Error("PoC API readiness timeout; see api.log");
  };
  report.environment = {
    node: process.version,
    postgres,
    synthetic: true,
    real_messages_sent: false,
  };
  await check("비소유자 역할과 모든 고객사 테이블의 FORCE RLS", async () => {
    await assertRuntimeRole();
    const tables = (
      await pool.query(
        "SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id') AND c.relname NOT IN ('memberships','sessions','api_keys') ORDER BY c.relname",
      )
    ).rows;
    assert.ok(tables.length >= 28);
    for (const table of tables)
      assert.ok(
        table.relrowsecurity && table.relforcerowsecurity && !table.owned,
        table.relname,
      );
    return { tables: tables.map((t) => t.relname) };
  });
  await check("테이블 소유자와 FORCE RLS 누락 시 API 시작 거부", async () => {
    const ownerDb = new pg.Client({
      host: process.env.PGHOST ?? "/tmp",
      database,
    });
    await ownerDb.connect();
    const owner = (await ownerDb.query("SELECT current_user AS name")).rows[0]
      .name;
    const ownerIdentifier = '"' + owner.replaceAll('"', '""') + '"';
    const rejectsStartup = async (reason: RegExp) => {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "apps/api/server.ts"],
        {
          env: { ...process.env },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let diagnostic = "";
      child.stdout?.on("data", (data) => {
        diagnostic += data;
      });
      child.stderr?.on("data", (data) => {
        diagnostic += data;
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
      try {
        const [code, signal] = await once(child, "exit");
        assert.equal(
          signal,
          null,
          "guard must reject startup rather than wait for termination",
        );
        assert.equal(code, 1);
        assert.match(diagnostic, reason);
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      await ownerDb.query(`GRANT CREATE ON SCHEMA public TO ${role}`);
      await ownerDb.query(`ALTER TABLE subjects OWNER TO ${role}`);
      await rejectsStartup(/고객사 테이블 소유자 권한/);
      await ownerDb.query(`ALTER TABLE subjects OWNER TO ${ownerIdentifier}`);
      await ownerDb.query("ALTER TABLE subjects NO FORCE ROW LEVEL SECURITY");
      await rejectsStartup(/ENABLE\/FORCE RLS/);
    } finally {
      await ownerDb.query(`ALTER TABLE subjects OWNER TO ${ownerIdentifier}`);
      await ownerDb.query("ALTER TABLE subjects FORCE ROW LEVEL SECURITY");
      await ownerDb.query(
        `GRANT SELECT,INSERT,UPDATE,DELETE ON subjects TO ${role}`,
      );
      await ownerDb.query(`REVOKE CREATE ON SCHEMA public FROM ${role}`);
      await ownerDb.end();
    }
    return { rejected_configs: ["tenant table owner", "FORCE RLS disabled"] };
  });
  await check("동일 외부 ID와 전화번호의 고객사 분리", async () => {
    const contacts = await Promise.all(
      [a, b].map((f) =>
        transaction(f.tenant, async (db) => {
          const subject = (
            await db.query("SELECT * FROM subjects WHERE id=$1", [f.subject])
          ).rows[0];
          assert.equal(subject.external_id, "fixture-member");
          return (
            await db.query(
              "SELECT value_hmac,encrypted FROM contact_points WHERE id=$1",
              [f.contact],
            )
          ).rows[0];
        }),
      ),
    );
    assert.notEqual(contacts[0].value_hmac, contacts[1].value_hmac);
    assert.notEqual(contacts[0].encrypted, contacts[1].encrypted);
  });
  await check("DB 교차 조회·쓰기·외래키 참조와 풀 재사용 격리", async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => {
        const own = i % 2 ? a : b,
          other = i % 2 ? b : a;
        return transaction(own.tenant, async (db) => {
          assert.equal(
            (
              await db.query("SELECT id FROM subjects WHERE id=$1", [
                own.subject,
              ])
            ).rowCount,
            1,
          );
          assert.equal(
            (
              await db.query("SELECT id FROM subjects WHERE id=$1", [
                other.subject,
              ])
            ).rowCount,
            0,
          );
        });
      }),
    );
    await assert.rejects(
      transaction(a.tenant, (db) =>
        db.query("INSERT INTO subjects VALUES($1,$2,'foreign')", [
          b.tenant,
          randomUUID(),
        ]),
      ),
      { code: "42501" },
    );
    await assert.rejects(
      transaction(a.tenant, (db) =>
        db.query(
          "INSERT INTO contact_points(tenant_id,id,subject_id,channel,encrypted,value_hmac,masked) VALUES($1,$2,$3,'sms','x','y','z')",
          [a.tenant, randomUUID(), b.subject],
        ),
      ),
      { code: "23503" },
    );
    assert.equal((await pool.query("SELECT id FROM subjects")).rowCount, 0);
  });
  await check(
    "실패한 철회의 이벤트·상태·거부·통지·outbox 전체 롤백",
    async () => {
      const snapshot = () =>
        transaction(a.tenant, async (db) => {
          const counts: Record<string, unknown> = {};
          for (const table of [
            "consent_events",
            "consent_current",
            "suppressions",
            "notification_jobs",
            "outbox",
            "audit_log",
          ])
            counts[table] = (
              await db.query(`SELECT count(*) FROM ${table}`)
            ).rows[0].count;
          counts.state = (
            await db.query(
              "SELECT state,revision,last_event_id FROM consent_current WHERE contact_id=$1",
              [a.contact],
            )
          ).rows[0];
          return counts;
        });
      const before = await snapshot();
      await assert.rejects(
        transaction(a.tenant, async (db) => {
          await recordConsent(db, a.ctx, {
            subject_id: a.subject,
            contact_id: a.contact,
            purpose_id: a.purposes.ad_sms,
            action: "revoked",
            idempotency_key: "poc-rollback",
          });
          throw Error("poc injected storage failure");
        }),
        /poc injected storage failure/,
      );
      assert.deepEqual(await snapshot(), before);
      return { before, after_equal: true };
    },
  );
  await startApi();
  await check("실제 HTTP 서버의 PostgreSQL 연결과 데모 경로 차단", async () => {
    const health = await request("/v1/health");
    assert.deepEqual(health.body, {
      ok: true,
      storage: "postgresql",
      mode: "production",
    });
    const response = await fetch(origin + "/demo?key=test", {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 404);
    return health.body;
  });
  const revoke = {
    subject_id: a.subject,
    contact_id: a.contact,
    purpose_id: a.purposes.ad_sms,
    action: "revoked",
    idempotency_key: "poc-http-revoke",
  };
  await check(
    "실제 HTTP의 다른 고객사 증빙·회원·수정 차단과 범위 검증",
    async () => {
      for (const [key, other] of [
        [keyA, b],
        [keyB, a],
      ] as const) {
        assert.equal(
          (await request(`/v1/evidence/${other.subject}`, key)).status,
          404,
        );
        assert.equal(
          (await request(`/v1/subjects/${other.subject}/preferences`, key))
            .status,
          404,
        );
        assert.equal(
          (
            await request("/v1/consent-events", key, {
              ...revoke,
              subject_id: other.subject,
              contact_id: other.contact,
              purpose_id: other.purposes.ad_sms,
            })
          ).status,
          404,
        );
      }
      assert.equal(
        (await request("/v1/consent-events", readOnly, revoke)).status,
        403,
      );
      assert.equal(
        (
          await request("/v1/consent-events", keyA, {
            ...revoke,
            tenant_id: b.tenant,
          })
        ).status,
        400,
      );
    },
  );
  let event: any;
  await check(
    "동시 HTTP 재전송 8건이 서버 원장·통지에 한 번만 반영",
    async () => {
      const responses = await Promise.all(
        Array.from({ length: 8 }, () =>
          request("/v1/consent-events", keyA, revoke),
        ),
      );
      for (const response of responses)
        assert.equal(response.status, 200, JSON.stringify(response.body));
      const { duplicate: _duplicate, ...storedEvent } = responses[0].body;
      event = storedEvent;
      assert.ok(event.id && event.received_at && event.seq && event.revision);
      assert.ok(responses.every((r) => r.body.id === event.id));
      await transaction(a.tenant, async (db) => {
        assert.equal(
          (
            await db.query("SELECT count(*) FROM consent_events WHERE id=$1", [
              event.id,
            ])
          ).rows[0].count,
          "1",
        );
        assert.equal(
          (
            await db.query(
              "SELECT count(*) FROM notification_jobs WHERE event_id=$1",
              [event.id],
            )
          ).rows[0].count,
          "1",
        );
      });
      return {
        concurrent_requests: 8,
        unique_event_count: 1,
        event_id: event.id,
        received_at: event.received_at,
        revision: event.revision,
      };
    },
  );
  await check("원장·게시 문구·감사 기록의 직접 수정과 삭제 차단", async () => {
    await transaction(a.tenant, (db) =>
      audit(db, a.tenant, "poc", "poc.immutability"),
    );
    for (const sql of [
      "UPDATE consent_events SET action='granted'",
      "DELETE FROM consent_events",
      "UPDATE notices SET body='tampered'",
      "DELETE FROM notices",
      "UPDATE audit_log SET action='tampered'",
      "DELETE FROM audit_log",
    ])
      await assert.rejects(
        transaction(a.tenant, (db) => db.query(sql)),
        { code: "P0001" },
      );
    return { blocked_mutations: 6 };
  });
  await stopApi();
  await startApi();
  await check(
    "별도 API 프로세스 재시작 후 서버 기록·문구·철회 유지",
    async () => {
      const exported = await request(`/v1/evidence/${a.subject}`, keyA);
      assert.equal(exported.status, 200);
      const bundle = exported.body;
      const savedEvent = bundle.events.find((e: any) => e.id === event.id);
      assert.deepEqual(savedEvent, {
        ...event,
        received_at: event.received_at,
      });
      assert.ok(
        bundle.notices.every(
          (n: any) => typeof n.body === "string" && n.body.length > 0,
        ),
      );
      assert.ok(
        bundle.current.some(
          (s: any) => s.contact_id === a.contact && s.state === "REVOKED",
        ),
      );
      assert.ok(!JSON.stringify(bundle).includes("01000009999"));
      const { sha256, ...unsigned } = bundle;
      assert.equal(hash(JSON.stringify(unsigned)), sha256);
      assert.equal(
        (await request("/v1/consent-events", keyA, revoke)).body.id,
        event.id,
      );
      const untouched = await request(`/v1/evidence/${b.subject}`, keyB);
      assert.ok(
        untouched.body.current.some(
          (s: any) => s.contact_id === b.contact && s.state === "GRANTED",
        ),
      );
      fs.writeFileSync(
        path.join(output, "synthetic-evidence.json"),
        JSON.stringify(bundle, null, 2),
      );
      return {
        event_id: savedEvent.id,
        sha256,
        other_customer_unchanged: true,
      };
    },
  );
  if (process.argv.includes("--recovery")) {
    const { enqueue } = await import("../packages/policy-engine/index.js");
    const { requestDeletion, confirmDeletionTask } =
      await import("../packages/evidence/index.js");
    const { exportJournal } = await import("../packages/evidence/recovery.js");
    const { decrypt } = await import("../packages/consent-domain/common.js");
    const c = await fixture();
    const keyC = await makeKey(c.tenant, [
      "read",
      "evidence:read",
      "decisions",
    ]);
    const job = await transaction(c.tenant, (db) =>
      enqueue(db, c.ctx, {
        ...c.input,
        idempotency_key: "recovery-reservation",
        scheduled_at: "2026-10-02T02:00:00Z",
      }),
    );
    assert.equal(job.status, "queued");
    await stopApi();
    const sourceUrl = process.env.DATABASE_URL!;
    const restoredConnection = new URL(sourceUrl);
    restoredConnection.pathname = `/${restoredDatabase}`;
    const restoredUrl = restoredConnection.toString();
    const root = new pg.Client({
      host: process.env.PGHOST ?? "/tmp",
      database,
    });
    await root.connect();
    const fingerprint = async (db: pg.Client) => {
      const { rows: tables } = await db.query(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
      );
      const result = [];
      for (const { tablename } of tables) {
        const table = '"' + tablename.replaceAll('"', '""') + '"';
        const { rows } = await db.query(
          `SELECT to_jsonb(t)::text AS data FROM public.${table} t ORDER BY to_jsonb(t)::text`,
        );
        result.push({
          table: tablename,
          rows: rows.length,
          sha256: hash(JSON.stringify(rows)),
        });
      }
      return result;
    };
    let original: Awaited<ReturnType<typeof fingerprint>>;
    const backupKey = randomBytes(32),
      nonce = randomBytes(12),
      header = Buffer.from("CMPPOC01");
    const backupPath = path.join(output, "synthetic-backup.enc");
    const journalPath = path.join(output, "deletion-journal.json");
    const backupHash = (data: Buffer) =>
      createHash("sha256").update(data).digest("hex");
    try {
      await check("전체 DB 암호화 백업의 변조 거부와 새 DB 복원", async () => {
        original = await fingerprint(root);
        const plain = execFileSync(
          "pg_dump",
          [
            "--host",
            process.env.PGHOST ?? "/tmp",
            "--dbname",
            database,
            "--format=custom",
            "--no-password",
          ],
          { timeout: 30000, maxBuffer: 8_000_000 },
        );
        const plainHash = backupHash(plain),
          plainSize = plain.length;
        const cipher = createCipheriv("aes-256-gcm", backupKey, nonce);
        cipher.setAAD(header);
        const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
        plain.fill(0);
        const archive = Buffer.concat([
          header,
          nonce,
          cipher.getAuthTag(),
          encrypted,
        ]);
        fs.writeFileSync(backupPath, archive, { mode: 0o600 });
        fs.chmodSync(backupPath, 0o600);
        const decryptArchive = (data: Buffer, key = backupKey) => {
          assert.deepEqual(data.subarray(0, 8), header);
          const decipher = createDecipheriv(
            "aes-256-gcm",
            key,
            data.subarray(8, 20),
          );
          decipher.setAAD(header);
          decipher.setAuthTag(data.subarray(20, 36));
          return Buffer.concat([
            decipher.update(data.subarray(36)),
            decipher.final(),
          ]);
        };
        const changed = Buffer.from(archive);
        changed[changed.length - 1] ^= 1;
        assert.throws(() => decryptArchive(changed));
        assert.throws(() => decryptArchive(archive, randomBytes(32)));
        const restored = decryptArchive(fs.readFileSync(backupPath));
        assert.equal(backupHash(restored), plainHash);
        await admin.query(`CREATE DATABASE ${restoredDatabase}`);
        createdRestoredDb = true;
        try {
          execFileSync(
            "pg_restore",
            [
              "--host",
              process.env.PGHOST ?? "/tmp",
              "--dbname",
              restoredDatabase,
              "--exit-on-error",
              "--single-transaction",
              "--no-password",
            ],
            { input: restored, timeout: 30000, maxBuffer: 1_000_000 },
          );
        } finally {
          restored.fill(0);
        }
        const clone = new pg.Client({
          host: process.env.PGHOST ?? "/tmp",
          database: restoredDatabase,
        });
        try {
          await clone.connect();
          assert.deepEqual(await fingerprint(clone), original);
        } finally {
          await clone.end();
        }
        fs.writeFileSync(
          path.join(output, "backup-table-fingerprints.json"),
          JSON.stringify(original, null, 2),
        );
        return {
          public_tables: original.length,
          dump_bytes: plainSize,
          encrypted_sha256: backupHash(archive),
          encryption: "AES-256-GCM",
          tampering_rejected: true,
          wrong_key_rejected: true,
          plaintext_dump_on_disk: false,
          backup_key_retained: false,
        };
      });
      restoredPool = new pg.Pool({
        connectionString: restoredUrl,
        max: 2,
        statement_timeout: 10000,
      });
      const inRestoredTenant = async (
        tenant: string,
        sql: string,
        args: unknown[] = [],
      ) => {
        const db = await restoredPool!.connect();
        try {
          await db.query("BEGIN");
          await db.query("SELECT set_config('app.tenant_id',$1,true)", [
            tenant,
          ]);
          const result = await db.query(sql, args);
          await db.query("COMMIT");
          return result;
        } catch (error) {
          await db.query("ROLLBACK");
          throw error;
        } finally {
          db.release();
        }
      };
      process.env.DATABASE_URL = restoredUrl;
      await startApi();
      await check(
        "복원 DB의 비소유자 API·고객사 격리·원장 불변성",
        async () => {
          assert.equal(
            (await request(`/v1/evidence/${a.subject}`, keyA)).status,
            200,
          );
          for (const [key, other] of [
            [keyA, b],
            [keyB, a],
          ] as const)
            assert.equal(
              (await request(`/v1/evidence/${other.subject}`, key)).status,
              404,
            );
          const bundle = (await request(`/v1/evidence/${a.subject}`, keyA))
            .body;
          assert.deepEqual(
            bundle.events.find((e: any) => e.id === event.id),
            event,
          );
          const { sha256, ...unsigned } = bundle;
          assert.equal(hash(JSON.stringify(unsigned)), sha256);
          await assert.rejects(
            inRestoredTenant(
              a.tenant,
              "UPDATE consent_events SET action='granted'",
            ),
            { code: "P0001" },
          );
          const {
            rows: [contact],
          } = await inRestoredTenant(
            c.tenant,
            "SELECT encrypted,active,verified FROM contact_points WHERE id=$1",
            [c.contact],
          );
          assert.equal(decrypt(c.tenant, contact.encrypted), "01000009999");
          assert.ok(contact.active && contact.verified);
          assert.equal(
            (
              await inRestoredTenant(
                c.tenant,
                "SELECT status FROM message_jobs WHERE id=$1",
                [job.id],
              )
            ).rows[0].status,
            "queued",
          );
          return {
            api_started_with_non_owner: true,
            cross_customer_http_status: 404,
            immutable_update_rejected: true,
            contact_key_recovered: true,
          };
        },
      );
      await transaction(c.tenant, async (db) => {
        const deletion = await requestDeletion(
          db,
          c.ctx,
          c.subject,
          "합성 복구 PoC의 본인 연락처 삭제 요청",
        );
        const {
          rows: [task],
        } = await db.query(
          "SELECT id FROM deletion_tasks WHERE request_id=$1 AND system='cmp'",
          [deletion.id],
        );
        await confirmDeletionTask(
          db,
          c.ctx,
          task.id,
          "합성 DB의 자체 연락처 암호문 삭제를 확인했습니다.",
        );
      });
      const journal = await exportJournal(c.tenant);
      fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2), {
        mode: 0o600,
      });
      fs.chmodSync(journalPath, 0o600);
      await check(
        "백업 이후 삭제 이력의 재적용·광고 차단·재내보내기 보존",
        async () => {
          const result = execFileSync(
            process.execPath,
            [
              "--import",
              "tsx",
              "scripts/deletion-journal.ts",
              "apply",
              journalPath,
            ],
            { env: { ...process.env }, encoding: "utf8", timeout: 15000 },
          );
          assert.match(result, /reapplied: 1/);
          const {
            rows: [subject],
          } = await inRestoredTenant(
            c.tenant,
            "SELECT restricted,deleted_at FROM subjects WHERE id=$1",
            [c.subject],
          );
          assert.ok(subject.restricted && subject.deleted_at);
          const {
            rows: [contact],
          } = await inRestoredTenant(
            c.tenant,
            "SELECT encrypted,active,verified FROM contact_points WHERE id=$1",
            [c.contact],
          );
          assert.equal(contact.encrypted, "");
          assert.ok(!contact.active && !contact.verified);
          const cancelled = (
            await inRestoredTenant(
              c.tenant,
              "SELECT status,reasons FROM message_jobs WHERE id=$1",
              [job.id],
            )
          ).rows[0];
          assert.equal(cancelled.status, "cancelled");
          assert.deepEqual(cancelled.reasons, ["DELETION_REAPPLIED"]);
          const decision = await request("/v1/decisions", keyC, c.input);
          assert.equal(decision.status, 200);
          assert.equal(decision.body.allowed, false);
          assert.ok(decision.body.reasons.includes("SUBJECT_RESTRICTED"));
          const nextJournal = path.join(
            output,
            "deletion-journal-reexported.json",
          );
          execFileSync(
            process.execPath,
            [
              "--import",
              "tsx",
              "scripts/deletion-journal.ts",
              "export",
              c.tenant,
              nextJournal,
            ],
            { env: { ...process.env }, timeout: 15000 },
          );
          const reexported = JSON.parse(fs.readFileSync(nextJournal, "utf8"));
          assert.deepEqual(
            JSON.parse(reexported.payload).deletions,
            JSON.parse(journal.payload).deletions,
          );
          execFileSync(
            process.execPath,
            [
              "--import",
              "tsx",
              "scripts/deletion-journal.ts",
              "apply",
              nextJournal,
            ],
            { env: { ...process.env }, timeout: 15000 },
          );
          assert.equal(
            (
              await inRestoredTenant(
                c.tenant,
                "SELECT count(*) FROM deletion_journal WHERE subject_id=$1",
                [c.subject],
              )
            ).rows[0].count,
            "1",
          );
          assert.equal(
            (await request(`/v1/evidence/${b.subject}`, keyB)).status,
            200,
          );
          return {
            reapplied: 1,
            reservation_cancelled: true,
            advertising_blocked: true,
            deletion_preserved_in_next_export: true,
            repeated_apply_journal_rows: 1,
          };
        },
      );
    } finally {
      backupKey.fill(0);
      await root.end();
      await stopApi();
      process.env.DATABASE_URL = sourceUrl;
    }
  }
  if (process.argv.includes("--browser")) {
    await stopApi();
    await startApi(true);
    const site = await request("/v1/demo/site", keyA, {});
    assert.equal(site.status, 200);
    report.browser = {
      url: origin + "/demo?key=" + site.body.public_key,
      tenant_id: a.tenant,
      site_id: site.body.id,
    };
    save();
    console.log(`BROWSER_URL ${origin}/demo?key=${site.body.public_key}`);
    console.log(
      `Browser PoC ready (PID ${process.pid}). Press Enter or send SIGUSR2 after verification. Timeout: 20 minutes.`,
    );
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        cleanup();
        resolve();
      };
      const interrupted = () => {
        cleanup();
        reject(Error("Browser PoC interrupted before verification"));
      };
      const cleanup = () => {
        clearTimeout(timer);
        process.stdin.off("data", finish);
        process.off("SIGUSR2", finish);
        process.off("SIGINT", interrupted);
        process.off("SIGTERM", interrupted);
        process.stdin.pause();
      };
      const timer = setTimeout(
        () => {
          cleanup();
          reject(Error("Browser PoC verification timed out"));
        },
        20 * 60 * 1000,
      );
      process.stdin.once("data", finish);
      process.once("SIGUSR2", finish);
      process.once("SIGINT", interrupted);
      process.once("SIGTERM", interrupted);
      process.stdin.resume();
    });
    await check("브라우저 선택의 서버 원본과 마지막 철회 상태", async () => {
      const records = await transaction(a.tenant, async (db) => {
        const source = `web:${site.body.id}:v1`;
        return {
          events: (
            await db.query(
              "SELECT id,subject_id,action,revision,received_at,source FROM consent_events WHERE source=$1 ORDER BY seq",
              [source],
            )
          ).rows,
          current: (
            await db.query(
              "SELECT c.state,p.key,c.revision FROM consent_current c JOIN purposes p ON p.tenant_id=c.tenant_id AND p.id=c.purpose_id WHERE c.subject_id IN(SELECT subject_id FROM consent_events WHERE source=$1) ORDER BY p.key",
              [source],
            )
          ).rows,
        };
      });
      assert.ok(
        records.events.length >= 8,
        "Complete browser checks before ending --browser mode",
      );
      assert.ok(
        records.current.length > 0 &&
          records.current.every((c) => c.state === "REVOKED"),
      );
      fs.writeFileSync(
        path.join(output, "browser-server-records.json"),
        JSON.stringify(records, null, 2),
      );
      return { events: records.events.length, final_states: records.current };
    });
  }
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await stopApi();
  await runtimePool?.end();
  await restoredPool?.end();
  try {
    if (createdRestoredDb)
      await admin.query(`DROP DATABASE ${restoredDatabase} WITH (FORCE)`);
    if (createdDb) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (createdRole) await admin.query(`DROP ROLE ${role}`);
    report.cleanup = createdRestoredDb
      ? "source and restored temporary databases and role removed"
      : "temporary database and role removed";
  } catch (error) {
    report.cleanup = error instanceof Error ? error.message : String(error);
    report.status = "failed";
    process.exitCode = 1;
  }
  await admin.end();
  report.finished_at = new Date().toISOString();
  save();
  console.log(`REPORT ${path.join(output, "http.json")}`);
}
