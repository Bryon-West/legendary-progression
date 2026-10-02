import assert from "node:assert/strict";

// This check creates its own profile; it never changes existing athlete data.
const base = "http://localhost:80/api";
const name = `V2 API QA ${Date.now()}`;
let profileId;
const checks = [];
async function api(path, method = "GET", data, expected = 200) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const text = await response.text();
  let result;
  try { result = text ? JSON.parse(text) : undefined; } catch { result = text; }
  assert.equal(response.status, expected, `${method} ${path}: ${text}`);
  return result;
}
const work = (exercise) => exercise.sets.filter((set) => set.setType === "work" && !set.removed);
const prescription = (exerciseId, orderIndex) => ({
  exerciseId, orderIndex, targetSets: 3, minimumWorkingSets: 2,
  maximumWorkingSets: 4, targetRepsMin: 6, targetRepsMax: 8,
  targetRir: 2, targetWeight: 225 / 2.20462262185,
});
async function log(session, set, actualWeight, actualReps, actualRir = 2) {
  return api(`/workouts/${session.id}/sets/${set.id}`, "PATCH", {
    actualWeight, actualReps, actualRir, completed: true,
  });
}
try {
  const profile = await api("/profiles", "POST", { name }, 201);
  profileId = profile.id;
  console.log(`QA_PROFILE_ID=${profileId}\nQA_PROFILE_NAME=${name}`);
  assert.equal(profile.weightUnit, "kg");
  const exercises = [];
  for (const [exerciseName, muscleGroup, isCompound] of [
    ["Bench", "Chest", true], ["Row", "Back", true],
    ["Squat", "Quads", true], ["Replacement row", "Back", false],
  ]) {
    exercises.push(await api("/exercises", "POST", {
      profileId, name: `${name} ${exerciseName}`, muscleGroup,
      equipment: isCompound ? "Barbell" : "Cable", category: "strength", isCompound,
    }, 201));
  }
  const created = await api("/splits", "POST", { profileId, name: `${name} mesocycle` }, 201);
  let plan = await api(`/splits/${created.id}`, "PUT", {
    name: created.name, startDate: new Date().toISOString().slice(0, 10),
    cycleLengthWeeks: 8,
    days: [0, 1].map((dayIndex) => ({
      name: `Day ${dayIndex + 1}`, dayIndex,
      exercises: exercises.slice(0, 3).map((exercise, index) => prescription(exercise.id, index)),
    })),
  });
  assert.equal(plan.days.length, 2);
  assert.match(plan.startDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(plan.days[0].exercises[0].minimumWorkingSets, 2);
  plan = await api(`/splits/${plan.id}`, "PUT", {
    name: `${plan.name} edited`, startDate: plan.startDate, cycleLengthWeeks: 8,
    days: plan.days.map((day) => ({
      id: day.id, name: day.name, dayIndex: day.dayIndex,
      exercises: day.exercises.map((item) => ({
        id: item.id, ...prescription(item.exerciseId, item.orderIndex),
      })),
    })),
  });
  assert.ok(plan.name.endsWith("edited"));
  assert.equal((await api(`/splits/${plan.id}`)).name, plan.name);
  checks.push("Atomic mesocycle create/edit, metadata, and set bounds");

  let session = await api("/workouts/start", "POST", {
    profileId, splitDayId: plan.days[0].id, readiness: "normal",
    muscleRecovery: [{ muscleGroup: "Chest", status: "fully_recovered" }],
  }, 201);
  assert.equal(session.readiness, "normal");
  assert.ok(session.mesocycleWeek >= 1);
  for (const set of work(session.exercises[0])) {
    await log(session, set, 225 / 2.20462262185, 6);
  }
  for (const exercise of session.exercises.slice(1)) {
    await api(`/workouts/${session.id}/exercises/${exercise.id}/feedback`, "PATCH", { skipped: true });
  }
  await api(`/workouts/${session.id}/finish`, "POST");
  checks.push("Readiness/recovery and previous-performance exposure");

  session = await api("/workouts/start", "POST", {
    profileId, readiness: "great",
    muscleRecovery: [{ muscleGroup: "Chest", status: "fully_recovered" }],
  }, 201);
  assert.equal(session.splitDayId, plan.days[1].id);
  let bench = session.exercises.find((exercise) => exercise.exerciseId === exercises[0].id);
  const extra = await api(`/workouts/${session.id}/sets`, "POST", {
    workoutExerciseId: bench.id, setType: "work", setNumber: 4,
  }, 201);
  await api(`/workouts/${session.id}/sets`, "POST", {
    workoutExerciseId: bench.id, setType: "work", setNumber: 5,
  }, 409);
  await api(`/workouts/${session.id}/sets/${extra.id}`, "DELETE", undefined, 204);
  await api(`/workouts/${session.id}/sets/${work(bench)[2].id}`, "DELETE", undefined, 204);
  await api(`/workouts/${session.id}/sets/${work(bench)[1].id}`, "DELETE", undefined, 409);
  await api(`/workouts/${session.id}/sets`, "POST", {
    workoutExerciseId: bench.id, setType: "work", setNumber: 5,
  }, 201);
  const warmup = await api(`/workouts/${session.id}/sets`, "POST", {
    workoutExerciseId: bench.id, setType: "warmup", setNumber: 1,
  }, 201);
  const warmupLogged = await log(session, warmup, 20, 10);
  assert.equal(warmupLogged.targetStatus, null);
  checks.push("Add/remove working sets, enforce bounds, and unrated warmups");

  session = await api(`/workouts/${session.id}`);
  bench = session.exercises.find((exercise) => exercise.exerciseId === exercises[0].id);
  const benchSets = work(bench);
  const selected = bench.recommendedWeight ?? bench.targetWeight;
  const original = await api(`/workouts/${session.id}/sets/${benchSets[0].id}`, "PATCH", { actualWeight: selected });
  const heavier = await api(`/workouts/${session.id}/sets/${benchSets[0].id}`, "PATCH", { actualWeight: selected + 2.5 });
  assert.ok(heavier.adaptiveTargetReps <= original.adaptiveTargetReps);
  const outside = await api(`/workouts/${session.id}/sets/${benchSets[0].id}`, "PATCH", { actualWeight: selected * 2 });
  assert.ok(outside.adaptiveWarning || outside.targetExplanation, "Out-of-range load must explain without blocking");
  const reset = await api(`/workouts/${session.id}/sets/${benchSets[0].id}`, "PATCH", { actualWeight: selected });
  const reps = reset.adaptiveTargetReps;
  assert.ok(Number.isInteger(reps) && reps >= 6 && reps <= 8);
  const statuses = [];
  const atFailure = await log(session, benchSets[0], selected, reps, 0);
  assert.equal(atFailure.targetStatus, "below_target", "Matching reps with substantially less reserve is below target");
  statuses.push(await log(session, benchSets[0], selected, reps, 2));
  statuses.push(await log(session, benchSets[1], selected, reps + 2, 2));
  statuses.push(await log(session, benchSets[2], selected, Math.max(1, reps - 2), 1));
  assert.deepEqual(statuses.map((set) => set.targetStatus), ["target_met", "above_target", "below_target"]);
  assert.ok(statuses.every((set) => set.targetExplanation && set.algorithmVersion));
  checks.push("History-based load/reps adaptation, free load selection, and stored three-way set statuses");

  const squat = session.exercises.find((exercise) => exercise.exerciseId === exercises[2].id);
  await log(session, work(squat)[0], 50, 6);
  await api(`/workouts/${session.id}/exercises/${squat.id}/feedback`, "PATCH", { skipped: true });
  const row = session.exercises.find((exercise) => exercise.exerciseId === exercises[1].id);
  await log(session, work(row)[0], 10, 8);
  const painful = await api(`/workouts/${session.id}/exercises/${row.id}/feedback`, "PATCH", {
    painReported: true, painNote: "QA discomfort feedback",
  });
  assert.equal(painful.recommendationOutcome, "maintain");
  assert.equal(work(painful)[0].actualWeight, 10, "Pain feedback must preserve completed values");
  assert.equal(work(painful)[0].actualReps, 8);
  const replacement = await api(`/workouts/${session.id}/exercises/${row.id}`, "PATCH", {
    exerciseId: exercises[3].id, updateMesocycle: true,
  });
  assert.equal(replacement.targetWeight, null, "Cold substitution cannot inherit the old movement load");
  assert.equal(replacement.recommendedWeight, null);
  await log(session, work(replacement)[0], 12, 8);
  const updatedPlan = await api(`/splits/${plan.id}`);
  assert.equal(updatedPlan.days[1].exercises[1].exerciseId, exercises[3].id);
  assert.equal(updatedPlan.days[1].exercises[1].targetWeight, null);
  checks.push("Skip, separate pain feedback, logged substitution lineage, and permanent mesocycle substitution");

  const finished = await api(`/workouts/${session.id}/finish`, "POST");
  assert.equal(finished.workout.status, "completed");
  assert.equal((await api(`/workouts/active?profileId=${profileId}`)).workout, null);
  assert.equal(finished.nextWorkout.dayId, plan.days[0].id);
  assert.equal((await api(`/workouts/${session.id}/finish`, "POST")).nextWorkout.dayId, plan.days[0].id);
  const expected = finished.workout.exercises.filter((exercise) => !exercise.skipped)
    .flatMap((exercise) => exercise.sets)
    .filter((set) => set.setType === "work" && set.completed && !set.removed)
    .reduce((total, set) => total + set.actualWeight * set.actualReps, 0);
  assert.ok(Math.abs(expected - finished.workout.totalVolume) < 1e-7);
  const muscleTotal = finished.workout.muscleTotals.reduce((total, item) => total + item.totalWeightLifted, 0);
  assert.equal(muscleTotal, finished.workout.totalVolume, "Muscle totals must sum exactly");
  assert.equal(finished.workout.muscleTotals.find((item) => item.muscleGroup === "Back").totalWeightLifted, 176);
  assert.ok(!finished.workout.muscleTotals.some((item) => item.muscleGroup === "Quads"));
  const history = await api(`/workouts?profileId=${profileId}`);
  assert.ok(history.some((item) => item.id === session.id));
  checks.push("Finish/history: exact primary-muscle reconciliation, warmup/skip/remove exclusion, closes/advances exactly once");

  await api(`/profiles/${profileId}`, "PATCH", { weightUnit: "lb" });
  assert.equal((await api("/profiles")).find((item) => item.id === profileId).weightUnit, "lb");
  const afterUnit = await api(`/workouts/${session.id}`);
  assert.equal(afterUnit.totalVolume, finished.workout.totalVolume, "Changing display units cannot rewrite canonical history");
  checks.push("Unit preference persists without rewriting canonical data");
  console.log(checks.map((check) => `PASS: ${check}`).join("\n"));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (profileId) console.log(`QA cleanup required: profile ${profileId}, exact name ${name}`);
}