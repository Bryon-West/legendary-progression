import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { pool } = await import("../../lib/db/src/index.ts");
const fixtures = JSON.parse(await readFile(new URL("../../.local/v22-api-qa.json", import.meta.url), "utf8"));
const ids = [...new Set([...(fixtures.profileIds ?? [fixtures.profileId]), ...process.argv.slice(2).map(Number)])];
assert.ok(ids.length && ids.every(id => Number.isSafeInteger(id) && id > 0), "Explicit synthetic profile IDs are required");
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const synthetic = (await client.query(`SELECT id FROM training_profiles WHERE id=ANY($1)
    AND (name LIKE 'V22 API QA %' OR name LIKE 'V22 Browser QA %') FOR UPDATE`, [ids])).rows;
  const present = (await client.query("SELECT id FROM training_profiles WHERE id=ANY($1)", [ids])).rows;
  assert.equal(synthetic.length, present.length, "Refusing to delete a profile without the exact synthetic test prefix");
  const removed = await client.query("DELETE FROM training_profiles WHERE id=ANY($1) RETURNING id", [synthetic.map(p => p.id)]);
  await client.query("COMMIT");
  console.log(`Removed ${removed.rowCount} explicitly recorded synthetic profiles and their test-only records.`);
} catch (error) { await client.query("ROLLBACK"); throw error; }
finally { client.release(); await pool.end(); }