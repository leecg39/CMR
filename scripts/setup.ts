import pg from "pg";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
const dbName = process.env.CMP_DATABASE_NAME ?? "korean_cmp_local";
if (!/^[a-z_]+$/.test(dbName)) throw Error("invalid database name");
if (fs.existsSync(".env"))
  throw Error(".env가 이미 있습니다. 기존 DB를 덮어쓰지 않습니다.");
const admin = new pg.Client({
  host: process.env.PGHOST ?? "/tmp",
  database: "postgres",
});
await admin.connect();
const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [
  dbName,
]);
if (exists.rowCount)
  throw Error(
    "동일한 데이터베이스가 이미 있습니다. CMP_DATABASE_NAME을 지정하세요.",
  );
const role = `${dbName}_app`,
  pass = randomBytes(24).toString("hex");
await admin.query(
  `CREATE ROLE ${role} LOGIN PASSWORD '${pass}' NOSUPERUSER NOBYPASSRLS`,
);
await admin.query(`CREATE DATABASE ${dbName}`);
await admin.end();
const migrate = new pg.Client({
  host: process.env.PGHOST ?? "/tmp",
  database: dbName,
});
await migrate.connect();
await migrate.query(
  fs.readFileSync("packages/database/schema.sql", "utf8") +
    "\n" +
    fs.readFileSync("packages/database/0002_agreements.sql", "utf8") +
    "\n" +
    fs.readFileSync("packages/database/0003_retention.sql", "utf8") +
    "\n" +
    fs.readFileSync("packages/database/0004_templates.sql", "utf8"),
);
await migrate.query(
  `GRANT CONNECT ON DATABASE ${dbName} TO ${role}; GRANT USAGE ON SCHEMA public TO ${role}; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${role}; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}; GRANT EXECUTE ON FUNCTION purge_retained_subject(uuid,uuid) TO ${role};`,
);
await migrate.end();
fs.writeFileSync(
  ".env",
  `DATABASE_URL=postgresql://${role}:${pass}@127.0.0.1:5432/${dbName}\nCMP_MASTER_KEY=${randomBytes(32).toString("base64")}\nSESSION_SECRET=${randomBytes(32).toString("hex")}\nPORT=4310\nAPP_ORIGIN=http://127.0.0.1:4310\nDEMO_MODE=true\n`,
  { mode: 0o600 },
);
console.log(
  `PostgreSQL ${dbName} 준비 완료. 비소유자 역할과 RLS 사용. 다음: npm run seed`,
);
