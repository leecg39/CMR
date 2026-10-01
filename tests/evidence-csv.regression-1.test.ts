import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "csv-parse/sync";
import { csv } from "../packages/evidence/index.js";

// Regression: ISSUE-001, CSV exports lost milliseconds from PostgreSQL Date values.
// Found by /qa on 2026-10-01.
// Report: artifacts/qa/2026-10-01/report.md
test("QA 증빙 CSV: JSON과 같은 UTC 시각과 밀리초를 보존한다", () => {
  const rows = [
    {
      id: "event-1",
      action: "granted",
      evidence: "VERIFIED",
      revision: 1,
      occurred_at: new Date("2026-10-01T03:36:00.123Z"),
      received_at: new Date("2026-10-01T03:36:10.703Z"),
    },
    {
      id: "event-2",
      action: "revoked",
      evidence: "VERIFIED",
      revision: 2,
      occurred_at: "2026-10-01T03:37:00.000Z",
      received_at: "2026-10-01T03:37:42.201Z",
    },
  ];
  const exported = parse<Record<string, string>>(csv(rows), {
    columns: true,
    bom: true,
  });
  const json = JSON.parse(JSON.stringify(rows));
  assert.equal(exported.length, 2);
  for (let i = 0; i < rows.length; i++) {
    assert.equal(exported[i].occurred_at, json[i].occurred_at);
    assert.equal(exported[i].received_at, json[i].received_at);
  }
});
