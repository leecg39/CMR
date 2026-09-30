import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { fixture, NOW } from "../packages/test-fixtures/index.js";
import { pool, transaction } from "../packages/database/index.js";
import { evaluate } from "../packages/policy-engine/index.js";
after(() => pool.end());
test("판단 엔진 로컬 부하 측정: 100건, 동시성 5, 실제 PostgreSQL", async (t) => {
  const f = await fixture(),
    times: number[] = [];
  for (let batch = 0; batch < 20; batch++)
    await Promise.all(
      Array.from({ length: 5 }, async () => {
        const start = performance.now();
        const d = await transaction(f.tenant, (db) =>
          evaluate(db, f.ctx, f.input, NOW),
        );
        assert.equal(d.allowed, true);
        times.push(performance.now() - start);
      }),
    );
  times.sort((a, b) => a - b);
  const result = {
    environment: "local PostgreSQL, synthetic fixture; not a production SLA",
    samples: times.length,
    concurrency: 5,
    p50_ms: Number(times[49].toFixed(2)),
    p95_ms: Number(times[94].toFixed(2)),
    max_ms: Number(times[99].toFixed(2)),
  };
  fs.mkdirSync("artifacts", { recursive: true });
  fs.writeFileSync(
    "artifacts/performance.json",
    JSON.stringify(result, null, 2),
  );
  t.diagnostic(JSON.stringify(result));
});
