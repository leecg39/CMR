import "dotenv/config";
import pg from "pg";
import { randomUUID } from "node:crypto";
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 3000,
  statement_timeout: 10000,
});
export type DB = pg.PoolClient;
export async function transaction<T>(
  tenant: string,
  fn: (db: DB) => Promise<T>,
): Promise<T> {
  const db = await pool.connect();
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
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
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
}
