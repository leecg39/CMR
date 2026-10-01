import "dotenv/config";
import pg from "pg";
import { randomUUID } from "node:crypto";
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 3000,
  statement_timeout: 10000,
});
// A dropped idle connection must not crash the API or worker; the pool discards it and reconnects.
pool.on("error", (e) => console.error("database connection lost", e.message));
export type DB = pg.PoolClient;
export async function transaction<T>(
  tenant: string,
  fn: (db: DB) => Promise<T>,
): Promise<T> {
  const db = await pool.connect();
  let broken = false;
  // pg-pool removes its listener while a client is checked out; without this a terminated
  // backend emits an unhandled 'error' event and kills the process. The failing query still rejects.
  const onError = () => {
    broken = true;
  };
  db.on("error", onError);
  try {
    await db.query("BEGIN");
    await db.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      tenant,
    ]);
    const value = await fn(db);
    await db.query("COMMIT");
    return value;
  } catch (e) {
    if (!broken)
      try {
        await db.query("ROLLBACK");
      } catch {
        // Keep the original failure; discard a connection that could not roll back.
        broken = true;
      }
    throw e;
  } finally {
    db.removeListener("error", onError);
    db.release(broken);
  }
}
export async function audit(
  db: DB,
  tenant: string,
  actor: string,
  action: string,
  details: unknown = {},
) {
  await db.query(
    "INSERT INTO audit_log(tenant_id,id,actor,action,details) VALUES($1,$2,$3,$4,$5)",
    [tenant, randomUUID(), actor, action, JSON.stringify(details)],
  );
}
export async function assertRuntimeRole() {
  const {
    rows: [r],
  } = await pool.query(
    "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
  );
  if (r.rolsuper || r.rolbypassrls)
    throw Error(
      "운영 연결에는 RLS를 우회하지 않는 비소유자 역할이 필요합니다.",
    );
  const { rows: tables } = await pool.query(
    "SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,pg_has_role(current_user,c.relowner,'MEMBER') AS owner_access FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND NOT a.attisdropped) AND c.relname NOT IN ('memberships','sessions','api_keys')",
  );
  if (!tables.length || tables.some((t) => t.owner_access))
    throw Error(
      "운영 연결에는 고객사 테이블 소유자 권한이 없는 역할이 필요합니다.",
    );
  if (tables.some((t) => !t.relrowsecurity || !t.relforcerowsecurity))
    throw Error("고객사 테이블에는 ENABLE/FORCE RLS가 모두 필요합니다.");
}
