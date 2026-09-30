import fs from "node:fs";
import { exportJournal, applyJournal } from "../packages/evidence/recovery.js";
import { pool } from "../packages/database/index.js";
const [mode, argument, file] = process.argv.slice(2);
try {
  if (mode === "export" && argument && file) {
    fs.writeFileSync(
      file,
      JSON.stringify(await exportJournal(argument), null, 2),
      { mode: 0o600 },
    );
    console.log(
      "삭제 이력을 별도 파일에 저장했습니다. 백업과 분리 보관하세요.",
    );
  } else if (mode === "apply" && argument) {
    console.log(
      await applyJournal(JSON.parse(fs.readFileSync(argument, "utf8"))),
    );
  } else
    throw Error(
      "Usage: npx tsx scripts/deletion-journal.ts export TENANT_ID FILE | apply FILE",
    );
} finally {
  await pool.end();
}
