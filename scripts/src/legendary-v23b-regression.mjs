import assert from "node:assert/strict";
const { pool } = await import("../../lib/db/src/index.ts");
const base = "http://localhost:80/api";
let profileId;
async function api(path, method = "GET", body, expected = 200) {
  const response = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  assert.equal(response.status, expected, `${method} ${path}: ${text.slice(0, 700)}`);
  return text && response.status !== 204 ? JSON.parse(text) : null;
}
try {
  const profile = await api("/profiles", "POST", { name: `V23B synthetic ${Date.now()}` }, 201);
  profileId = profile.id;
  await api(`/profiles/${profileId}`, "PATCH", { weightUnit: "lb" });
  await api(`/profiles/${profileId}/engine-settings`, "PATCH", {
    loadIncrementLb: 5, loadIncrementKg: 2.26796185,
  });
  const library = await api(`/exercises?profileId=${profileId}`);
  const bench = library.find((exercise) => exercise.name === "Barbell Bench Press");
  assert.ok(bench, "Barbell Bench Press exists in the exercise library");

  const date = new Date().toISOString().slice(0, 10);
  const addDays = (days) => {
    const next = new Date(`${date}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + days);
    return next.toISOString().slice(0, 10);
  };
  const cycle = await api("/mesocycles", "POST", {
    profileId, name: "V2.3B progression regression", startDate: date, createMode: "build_own",
    days: [{ name: "Bench day", dayIndex: 0, exercises: [{
      exerciseId: bench.id, orderIndex: 0, targetSets: 3, minimumWorkingSets: 1,
      maximumWorkingSets: 5, targetRepsMin: 6, targetRepsMax: 30, targetRir: 3,
      targetWeight: null,
    }] }],
    weeks: [3, 2].map((targetRir, index) => ({
      weekIndex: index + 1, kind: "loading", targetRir,
      scheduledWorkouts: [{ dayIndex: 0, scheduledDate: addDays(index * 7) }],
    })),
  }, 201);
  assert.deepEqual(cycle.weeks.map((week) => week.targetRir), [3, 2], "week RIR targets persist");

  const first = await api("/workouts/start", "POST", {
    profileId, scheduledWorkoutId: cycle.weeks[0].scheduledWorkouts[0].id,
  }, 201);
  const exercise = first.exercises[0];
  assert.equal(exercise.targetRir, 3, "week 1 workout uses stored 3 RIR");
  assert.equal(exercise.calibrationMode, true, "a new exercise has no invented calibration load");
  const kgFor225 = 225 / 2.20462262185;
  const achieved = [8, 7, 6];
  const sets = exercise.sets.filter((set) => set.setType === "work");
  assert.equal(sets.length, 3);
  for (const [index, set] of sets.entries()) {
    await api(`/workouts/${first.id}/sets/${set.id}`, "POST", {
      actualWeight: kgFor225, actualReps: achieved[index], actualRir: 3,
    });
  }
  await api(`/workouts/${first.id}/exercises/${exercise.id}/post-feedback`, "PUT", {
    pump: "good", fatigue: "moderate", discomfort: "none",
  });
  await api(`/workouts/${first.id}/finish`, "POST", { structureDecision: "today_only" });

  const nextPlannedId = cycle.weeks[1].scheduledWorkouts[0].id;
  const prescription = await api(`/planned-workouts/${nextPlannedId}/prescription`);
  const generated = prescription.exercises[0].sets;
  assert.equal(prescription.targetRir, 2);
  assert.deepEqual(generated.map((set) => Math.round(set.expectedReps)), [8, 7, 6, 6],
    "next-week sets preserve their own achieved rep benchmarks");
  assert.equal(generated[3].referenceKind, "new_set_estimate");
  assert.equal(generated[3].reference, null, "the automatically added set has no fabricated direct history");
  assert.ok(generated.every((set) => Math.abs(set.weight * 2.20462262185 - 230) < 0.01),
    `225 lb references with approved +5 lb progression persist 230 lb loads: ${JSON.stringify(generated.map(({weight, expectedReps, referenceKind}) => ({lb: weight * 2.20462262185, expectedReps, referenceKind})))}`);

  const saved = (await pool.query(`
    SELECT set_number,recommended_weight,expected_reps,prescribed_rir
    FROM planned_prescription_sets
    WHERE prescription_id=(SELECT id FROM planned_prescriptions WHERE planned_workout_id=$1)
    ORDER BY set_number
  `, [nextPlannedId])).rows;
  assert.deepEqual(saved.map((set) => Math.round(set.expected_reps)), [8, 7, 6, 6],
    "database rows store the set-specific rep targets");
  assert.ok(saved.every((set) => Math.abs(Number(set.recommended_weight) * 2.20462262185 - 230) < 0.01));
  assert.ok(saved.every((set) => set.prescribed_rir === 2));

  const reopened = await api("/workouts/start", "POST", {
    profileId, scheduledWorkoutId: nextPlannedId,
  }, 201);
  assert.equal(reopened.exercises[0].targetRir, 2);
  assert.deepEqual(reopened.exercises[0].sets.filter((set) => set.setType === "work")
    .map((set) => Math.round(set.adaptiveTargetReps)), [8, 7, 6, 6],
  "opening the next workout reads the same saved set targets");
  const reopenedSets = reopened.exercises[0].sets.filter((set) => set.setType === "work");
  await api(`/workouts/${reopened.id}/sets/${reopenedSets[0].id}`, "PATCH", {
    actualWeight: 235 / 2.20462262185,
  });
  const afterLoadAdjustment = await api(`/workouts/${reopened.id}`);
  assert.equal(afterLoadAdjustment.exercises[0].sets[0].adaptiveTargetReps, 8,
    "changing the selected load in-session does not lower the prescribed rep benchmark");
  const kgFor230 = 230 / 2.20462262185;
  const firstResult = await api(`/workouts/${reopened.id}/sets/${reopenedSets[0].id}`, "POST", {
    actualWeight: kgFor230, actualReps: 7, actualRir: 3,
  });
  assert.equal(firstResult.set.targetStatus, "target_met",
    "230 x 7 at comparable RIR is evaluated as equivalent to the 225 x 8 reference");
  const secondResult = await api(`/workouts/${reopened.id}/sets/${reopenedSets[1].id}`, "POST", {
    actualWeight: kgFor230, actualReps: 8, actualRir: 3,
  });
  assert.equal(secondResult.set.targetStatus, "above_target",
    "230 x 8 at comparable RIR is evaluated above the 225 x 7 reference");
  const afterReload = await api(`/workouts/${reopened.id}`);
  assert.deepEqual(afterReload.exercises[0].sets.filter((set) => set.setType === "work")
    .slice(0, 2).map((set) => set.targetStatus), ["target_met", "above_target"],
  "completed-set evaluations persist when the workout is reloaded");
  console.log("All V2.3B API/database workout prescription checks passed.");
} finally {
  if (profileId) await pool.query("DELETE FROM training_profiles WHERE id=$1", [profileId]);
  await pool.end();
}