import { readFile } from "node:fs/promises";

type ExerciseSeed = {
  name: string;
  muscleGroup: string;
  equipment: string;
  category: "strength" | "bodyweight" | "conditioning" | "mobility" | "other";
  isCompound: boolean;
  instructions?: string;
  secondaryMuscles: string[];
  aliases: string[];
  defaultRepMin: number;
  defaultRepMax: number;
  loadIncrementLb: number | null;
  loadIncrementKg: number | null;
};

type ExistingExercise = { id: number; name: string; equipment: string };

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const equipmentKey = (value: string) => {
  const key = normalize(value);
  return key === "dumbbell" ? "dumbbells" : key;
};

async function main() {
  const { pool } = await import(new URL("../../lib/db/src/index.ts", import.meta.url).href);
  const fileUrl = new URL("../../lib/db/exercise-library-v21.json", import.meta.url);
  const catalog = JSON.parse(await readFile(fileUrl, "utf8")) as ExerciseSeed[];
  const canonicalNames = new Map<string, string>();

  for (const exercise of catalog) {
    if (exercise.defaultRepMin < 1 || exercise.defaultRepMax < exercise.defaultRepMin) {
      throw new Error(`Invalid rep range for catalog exercise "${exercise.name}".`);
    }
    for (const name of [exercise.name, ...exercise.aliases]) {
      const key = normalize(name);
      const owner = canonicalNames.get(key);
      if (owner && owner !== exercise.name) {
        throw new Error(`Catalog name/alias "${name}" collides between "${owner}" and "${exercise.name}".`);
      }
      canonicalNames.set(key, exercise.name);
    }
  }

  const client = await pool.connect();
  let inserted = 0;
  let matched = 0;
  let metadataUpdated = 0;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('legendary-exercise-library-v21'))");

    const existingResult = await client.query(
      "SELECT id, name, equipment FROM exercises WHERE profile_id IS NULL ORDER BY id",
    );
    const existingRows = existingResult.rows as ExistingExercise[];

    for (const exercise of catalog) {
      const acceptedNames = new Set([exercise.name, ...exercise.aliases].map(normalize));
      const matches = existingRows.filter((row) => {
        if (!acceptedNames.has(normalize(row.name))) return false;
        const existingEquipment = equipmentKey(row.equipment);
        const catalogEquipment = equipmentKey(exercise.equipment);
        if (existingEquipment === catalogEquipment) return true;

        // Legacy records sometimes say only "Machine". Match that ambiguity
        // only for an exact canonical name, never across a named apparatus alias.
        return (
          existingEquipment === "machine" &&
          ["selectorizedmachine", "plateloadedmachine"].includes(catalogEquipment) &&
          normalize(row.name) === normalize(exercise.name)
        );
      });

      if (matches.length === 0) {
        await client.query(
          `INSERT INTO exercises (
             profile_id, name, muscle_group, equipment, category, instructions, is_compound,
             secondary_muscles, aliases, default_rep_min, default_rep_max,
             load_increment_lb, load_increment_kg
           ) VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            exercise.name,
            exercise.muscleGroup,
            exercise.equipment,
            exercise.category,
            exercise.instructions ?? null,
            exercise.isCompound,
            exercise.secondaryMuscles,
            exercise.aliases,
            exercise.defaultRepMin,
            exercise.defaultRepMax,
            exercise.loadIncrementLb,
            exercise.loadIncrementKg,
          ],
        );
        inserted += 1;
        continue;
      }

      matched += matches.length;
      for (const row of matches) {
        const result = await client.query(
          `UPDATE exercises
           SET secondary_muscles = CASE
                 WHEN cardinality(secondary_muscles) = 0 AND cardinality($2::text[]) > 0 THEN $2::text[]
                 ELSE secondary_muscles
               END,
               aliases = CASE
                 WHEN $9::boolean AND NOT EXISTS (
                   SELECT 1
                   FROM unnest(aliases) AS existing_alias(value)
                   WHERE regexp_replace(lower(existing_alias.value), '[^a-z0-9]', '', 'g') = $10
                 ) THEN CASE
                   WHEN cardinality(aliases) = 0 AND cardinality($3::text[]) > 0
                     THEN array_append($3::text[], $8::text)
                   ELSE array_append(aliases, $8::text)
                 END
                 WHEN cardinality(aliases) = 0 AND cardinality($3::text[]) > 0 THEN $3::text[]
                 ELSE aliases
               END,
               default_rep_min = CASE
                 WHEN default_rep_min = 8 AND default_rep_max = 12
                      AND (default_rep_min <> $4 OR default_rep_max <> $5) THEN $4
                 ELSE default_rep_min
               END,
               default_rep_max = CASE
                 WHEN default_rep_min = 8 AND default_rep_max = 12
                      AND (default_rep_min <> $4 OR default_rep_max <> $5) THEN $5
                 ELSE default_rep_max
               END,
               load_increment_lb = COALESCE(load_increment_lb, $6),
               load_increment_kg = COALESCE(load_increment_kg, $7)
           WHERE id = $1
             AND (
               (cardinality(secondary_muscles) = 0 AND cardinality($2::text[]) > 0)
               OR (cardinality(aliases) = 0 AND cardinality($3::text[]) > 0)
               OR (
                 $9::boolean
                 AND NOT EXISTS (
                   SELECT 1
                   FROM unnest(aliases) AS existing_alias(value)
                   WHERE regexp_replace(lower(existing_alias.value), '[^a-z0-9]', '', 'g') = $10
                 )
               )
               OR (
                 default_rep_min = 8 AND default_rep_max = 12
                 AND (default_rep_min <> $4 OR default_rep_max <> $5)
               )
               OR (load_increment_lb IS NULL AND $6::double precision IS NOT NULL)
               OR (load_increment_kg IS NULL AND $7::double precision IS NOT NULL)
             )`,
          [
            row.id,
            exercise.secondaryMuscles,
            exercise.aliases,
            exercise.defaultRepMin,
            exercise.defaultRepMax,
            exercise.loadIncrementLb,
            exercise.loadIncrementKg,
            exercise.name,
            normalize(row.name) !== normalize(exercise.name),
            normalize(exercise.name),
          ],
        );
        if ((result.rowCount ?? 0) > 0) metadataUpdated += 1;
      }
    }

    await client.query("COMMIT");
    console.info(
      `Legendary exercise library seed complete: ${catalog.length} catalog entries, ${inserted} inserted, ${matched} existing global row(s) matched, ${metadataUpdated} existing row(s) had metadata filled.`,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("Legendary exercise library seed failed:", error);
  process.exitCode = 1;
});