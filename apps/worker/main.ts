import { pool, assertRuntimeRole } from "../../packages/database/index.js";
import { runTenant } from "./jobs.js";
await assertRuntimeRole();
let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));
while (!stopping) {
  try {
    const { rows } = await pool.query("SELECT id FROM tenants");
    for (const t of rows) await runTenant(t.id);
  } catch (e) {
    console.error(
      "worker cycle failed",
      e instanceof Error ? e.message : "unknown",
    );
  }
  await new Promise((r) => setTimeout(r, 5000));
}
await pool.end();
