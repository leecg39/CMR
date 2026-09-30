import { buildApp } from "./app.js";
import { assertRuntimeRole, pool } from "../../packages/database/index.js";
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)
  throw Error("SESSION_SECRET must be configured");
if (Buffer.from(process.env.CMP_MASTER_KEY ?? "", "base64").length !== 32)
  throw Error("CMP_MASTER_KEY must be configured");
await assertRuntimeRole();
const app = await buildApp();
await app.listen({ port: Number(process.env.PORT ?? 4310), host: "127.0.0.1" });
console.log(`CMP: ${process.env.APP_ORIGIN ?? "http://127.0.0.1:4310"}`);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
