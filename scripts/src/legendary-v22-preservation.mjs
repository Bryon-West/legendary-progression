import { readFile, writeFile } from "node:fs/promises";
const { pool } = await import("../../lib/db/src/index.ts");
const file = new URL("../../.local/legendary-v22-preservation.json", import.meta.url);
try {
  if (process.argv.includes("--capture")) {
    const { rows } = await pool.query("SELECT table_name,json_agg(column_name ORDER BY ordinal_position) columns FROM information_schema.columns WHERE table_schema='public' GROUP BY table_name ORDER BY table_name");
    const spec = [];
    for (const t of rows) {
      const ids = (await pool.query(`SELECT id FROM "${t.table_name}" ORDER BY id`)).rows.map(r => r.id);
      spec.push({ table: t.table_name, columns: t.columns, ids });
    }
    const hashes = [];
    for (const t of spec) hashes.push((await pool.query(`SELECT count(*) n,md5(coalesce(jsonb_agg(jsonb_build_array(${t.columns.map(c => `"${c}"`).join(",")}) ORDER BY id)::text,'[]')) hash FROM "${t.table}" WHERE id=ANY($1)`, [t.ids])).rows[0]);
    await writeFile(file, JSON.stringify({ spec, hashes }, null, 2));
    console.log("Captured original-record fingerprints without recording personal data.");
  } else {
    const data = JSON.parse(await readFile(file, "utf8"));
    for (let i = 0; i < data.spec.length; i++) {
      const t = data.spec[i];
      const value = (await pool.query(`SELECT count(*) n,md5(coalesce(jsonb_agg(jsonb_build_array(${t.columns.map(c => `"${c}"`).join(",")}) ORDER BY id)::text,'[]')) hash FROM "${t.table}" WHERE id=ANY($1)`, [t.ids])).rows[0];
      if (JSON.stringify(value) !== JSON.stringify(data.hashes[i])) throw new Error(`Original records changed in ${t.table}`);
    }
    console.log("All pre-V2.2 record fingerprints are unchanged.");
  }
} finally { await pool.end(); }