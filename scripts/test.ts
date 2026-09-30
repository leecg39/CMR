import pg from "pg";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
const suffix = randomBytes(5).toString("hex"),
  name = `cmp_test_${suffix}`,
  role = `${name}_app`,
  password = randomBytes(16).toString("hex");
const admin = new pg.Client({
  host: process.env.PGHOST ?? "/tmp",
  database: "postgres",
});
await admin.connect();
try {
  await admin.query(
    `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`,
  );
  await admin.query(`CREATE DATABASE ${name}`);
  const db = new pg.Client({
    host: process.env.PGHOST ?? "/tmp",
    database: name,
  });
  await db.connect();
  await db.query(
    fs.readFileSync("packages/database/schema.sql", "utf8") +
      "\n" +
      fs.readFileSync("packages/database/0002_agreements.sql", "utf8") +
      "\n" +
      fs.readFileSync("packages/database/0003_retention.sql", "utf8") +
      "\n" +
      fs.readFileSync("packages/database/0004_templates.sql", "utf8"),
  );
  await db.query(
    `GRANT CONNECT ON DATABASE ${name} TO ${role}; GRANT USAGE ON SCHEMA public TO ${role}; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${role}; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}; GRANT EXECUTE ON FUNCTION purge_retained_subject(uuid,uuid) TO ${role};`,
  );
  await db.end();
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--test",
      "--test-concurrency=1",
      ...fs
        .readdirSync("tests")
        .filter((f) => f.endsWith(".test.ts"))
        .map((f) => "tests/" + f),
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: `postgresql://${role}:${password}@127.0.0.1:5432/${name}`,
        CMP_MASTER_KEY: randomBytes(32).toString("base64"),
        SESSION_SECRET: randomBytes(32).toString("hex"),
        DEMO_MODE: "false",
        APP_ORIGIN: "http://127.0.0.1:4310",
      },
    },
  );
  process.exitCode = await new Promise<number>((resolve) =>
    child.on("exit", (c) => resolve(c ?? 1)),
  );
} finally {
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.query(`DROP ROLE IF EXISTS ${role}`);
  await admin.end();
}
