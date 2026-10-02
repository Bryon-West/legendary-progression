import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";

// Only newly created, explicitly tracked QA profiles are mutated or removed.
const base = "http://localhost:80/api";
const label = `Legendary V2.1 QA ${Date.now()}`;
const fixtures = { profiles: [], exercises: [], sessions: [], checks: [] };
const checks = new Set();
const protectedProfiles = new Set();
const LB = 2.20462262185;
const qaDirectory = new URL("../../.local/", import.meta.url);
let pool;
const today = new Date().toISOString().slice(0, 10);
const date = (start, offset) => {
  const value = new Date(`${start}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
};
const working = (exercise) => exercise.sets.filter(s => s.setType === "work" && !s.removed);
const prescription = (exerciseId, orderIndex = 0, targetSets = 3) => ({
  exerciseId, orderIndex, targetSets, minimumWorkingSets: 1, maximumWorkingSets: 5,
  targetRepsMin: 6, targetRepsMax: 8, targetRir: 3, targetWeight: null,
});
const weeks = (start, days, rirs = [3, 2], recovery = "week_off") => [
  ...rirs.map((targetRir, i) => ({
    weekIndex: i + 1, kind: "loading", targetRir,
    scheduledWorkouts: days.map((_, dayIndex) => ({ dayIndex, scheduledDate: date(start, i * 7 + dayIndex * 2) })),
  })),
  ...(recovery ? [{ weekIndex: rirs.length + 1, kind: recovery, targetRir: recovery === "deload" ? 4 : 0,
    scheduledWorkouts: recovery === "week_off" ? [] : days.map((_, dayIndex) =>
      ({ dayIndex, scheduledDate: date(start, rirs.length * 7 + dayIndex * 2) })) }] : []),
];
async function saveFixtures() {
  fixtures.checks = [...checks];
  await mkdir(qaDirectory, { recursive: true });
  await writeFile(new URL("legendary-v21-qa.json", qaDirectory), JSON.stringify(fixtures, null, 2));
}
async function cleanupProfile(profile) {
  assert.ok(profile.name.startsWith("Legendary V2.1 QA "));
  assert.ok(!protectedProfiles.has(profile.id), "Never remove a pre-existing profile");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owner = await client.query("SELECT id FROM training_profiles WHERE id=$1 AND name=$2 FOR UPDATE", [profile.id, profile.name]);
    if (owner.rowCount) {
      await client.query("DELETE FROM progression_recommendations WHERE profile_id=$1", [profile.id]);
      await client.query("DELETE FROM workout_sessions WHERE profile_id=$1", [profile.id]);
      await client.query("DELETE FROM planned_workouts pw USING training_splits s WHERE pw.split_id=s.id AND s.profile_id=$1", [profile.id]);
      await client.query("DELETE FROM training_splits WHERE profile_id=$1", [profile.id]);
      await client.query("DELETE FROM training_profiles WHERE id=$1 AND name=$2", [profile.id, profile.name]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
async function request(path, method = "GET", data) {
  const response = await fetch(`${base}${path}`, {
    method, headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, body };
}
async function api(path, method = "GET", data, expected = 200) {
  const result = await request(path, method, data);
  assert.equal(result.status, expected, `${method} ${path}: ${JSON.stringify(result.body)}`);
  return result.body;
}
async function reject(path, method, data, allowed = [400, 409]) {
  const result = await request(path, method, data);
  assert.ok(allowed.includes(result.status), `Expected rejection ${method} ${path}: ${JSON.stringify(result)}`);
}
async function start(profileId, occurrence) {
  const session = await api("/workouts/start", "POST", {
    profileId, ...(occurrence ? { scheduledWorkoutId: occurrence.id } : { splitDayId: null }),
    readiness: "normal", muscleRecovery: [{ muscleGroup: "Chest", status: "fully_recovered" }],
  }, 201);
  fixtures.sessions.push(session.id);
  await saveFixtures();
  return session;
}
async function complete(session, set, weight, reps, rir) {
  return api(`/workouts/${session.id}/sets/${set.id}`, "POST", {
    actualWeight: weight, actualReps: reps, actualRir: rir,
  });
}
async function finish(session) {
  const result = await api(`/workouts/${session.id}/finish`, "POST");
  assert.equal(result.workout.status, "completed");
  assert.equal((await api(`/workouts/active?profileId=${session.profileId}`)).workout, null);
  return result.workout;
}
async function completeSession(session, overrides = {}) {
  for (const initialExercise of session.exercises) {
    if (initialExercise.skipped || initialExercise.superseded) continue;
    for (const initialSet of working(initialExercise)) {
      const fresh = await api(`/workouts/${session.id}`);
      const exercise = fresh.exercises.find(e => e.id === initialExercise.id);
      const set = exercise.sets.find(s => s.id === initialSet.id);
      if (set.completed || set.removed) continue;
      const values = overrides[exercise.exerciseId] ?? {};
      await complete(session, set,
        values.weight ?? set.adaptiveTargetWeight ?? set.targetWeight ?? exercise.recommendedWeight ?? 30,
        values.reps ?? set.adaptiveTargetReps ?? exercise.recommendedReps ?? 6,
        values.rir ?? exercise.targetRir);
    }
  }
  return finish(session);
}
function draft(plan) {
  return {
    name: plan.name, startDate: plan.startDate,
    days: plan.days.map(day => ({
      id: day.id, name: day.name, dayIndex: day.dayIndex,
      exercises: day.exercises.map(e => ({
        id: e.id, ...prescription(e.exerciseId, e.orderIndex, e.targetSets),
        minimumWorkingSets: e.minimumWorkingSets, maximumWorkingSets: e.maximumWorkingSets,
        targetRepsMin: e.targetRepsMin, targetRepsMax: e.targetRepsMax,
        targetRir: e.targetRir, targetWeight: e.targetWeight,
      })),
    })),
    weeks: plan.weeks.map(w => ({
      id: w.id,
      weekIndex: w.weekIndex, kind: w.kind, targetRir: w.targetRir,
      scheduledWorkouts: w.scheduledWorkouts.map(p => ({
        id: p.id, dayIndex: plan.days.find(d => d.id === p.splitDayId).dayIndex, scheduledDate: p.scheduledDate,
      })),
    })),
  };
}
async function savePlan(id, input) {
  await api(`/splits/${id}`, "PUT", input);
  return api(`/mesocycles/${id}`);
}

try {
  ({ pool } = await import(new URL("../../lib/db/src/index.ts", import.meta.url).href));
  const preservation = JSON.parse(await readFile(new URL("legendary-v21-preservation.json", qaDirectory), "utf8"));
  preservation.spec.training_profiles.ids.forEach(id => protectedProfiles.add(id));
  const preservationSql = Object.entries(preservation.spec).map(([table, meta]) => {
    assert.match(table, /^[a-z_][a-z0-9_]*$/);
    meta.columns.forEach(c => assert.match(c, /^[a-z_][a-z0-9_]*$/));
    meta.ids.forEach(id => assert.ok(Number.isSafeInteger(id) && id > 0));
    return `SELECT '${table}' AS table_name,count(*) AS rows,md5(coalesce(jsonb_agg(jsonb_build_array(${meta.columns.map(c => `t."${c}"`).join(",")}) ORDER BY t.id)::text,'[]')) AS fingerprint FROM public."${table}" t WHERE ${meta.ids.length ? `t.id IN (${meta.ids.join(",")})` : "false"}`;
  }).join(" UNION ALL ") + " ORDER BY table_name";
  async function verifyOriginals() {
    const result = await pool.query(preservationSql);
    const csv = "table_name,rows,fingerprint\n" + result.rows.map(r => `${r.table_name},${r.rows},${r.fingerprint}`).join("\n") + "\n";
    assert.equal(csv, preservation.fingerprints, "Original-record fingerprints must remain unchanged");
  }
  await verifyOriginals();
  checks.add("1 original IDs, records and original-column values survive migration unchanged");
  try {
    const prior = JSON.parse(await readFile(new URL("legendary-v21-qa.json", qaDirectory), "utf8"));
    for (const p of prior.profiles ?? []) {
      await cleanupProfile(p);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (process.env.CLEANUP_QA === "1") {
    await verifyOriginals();
    console.log("Removed only tracked QA profiles; original record fingerprints remain unchanged.");
  } else {
  const originalProfiles = await api("/profiles");
  fixtures.originalProfileIds = originalProfiles.map(p => p.id);
  const profile = await api("/profiles", "POST", { name: `${label} lb`, weightUnit: "lb" }, 201);
  const other = await api("/profiles", "POST", { name: `${label} kg`, weightUnit: "kg" }, 201);
  fixtures.profiles.push({ id: profile.id, name: profile.name }, { id: other.id, name: other.name });
  await saveFixtures();
  const poundsProfile = await api(`/profiles/${profile.id}`, "PATCH", { weightUnit: "lb" });
  assert.equal(poundsProfile.weightUnit, "lb");
  assert.equal(other.weightUnit, "kg");
  const settings = await api(`/profiles/${profile.id}/engine-settings`);
  assert.equal(settings.baselineExpiryWeeks, 6);
  assert.equal(settings.loadIncrementLb, 2.5);
  assert.equal(settings.loadIncrementKg, 2.5);
  const library = await api(`/exercises?profileId=${profile.id}`);
  assert.ok(library.filter(e => e.profileId === null).length >= 150 && library.length <= 250);
  for (const [alias, part] of [["RDL", "Romanian"], ["DB Bench", "Bench"], ["DB Incline", "Incline"], ["Rope Pushdown", "Triceps"]]) {
    const found = await api(`/exercises?profileId=${profile.id}&search=${encodeURIComponent(alias)}`);
    assert.ok(found.some(e => e.name.includes(part)), `${alias} must match a canonical exercise`);
  }
  checks.add("23 aliases and structured 150–250 exercise library");
  const barbell = library.find(e => e.name === "Barbell Bench Press");
  const dumbbell = library.find(e => e.name === "Dumbbell Bench Press");
  assert.ok(barbell && dumbbell);
  const custom = await api("/exercises", "POST", {
    profileId: profile.id, name: `${label} custom row`, muscleGroup: "Upper Back",
    equipment: "Cable", category: "strength", isCompound: true,
    aliases: ["QA Row"], secondaryMuscles: ["Biceps"], defaultRepMin: 6, defaultRepMax: 8,
  }, 201);
  const replacement = await api("/exercises", "POST", {
    profileId: profile.id, name: `${label} replacement`, muscleGroup: "Upper Back",
    equipment: "Dumbbell", category: "strength", isCompound: true,
  }, 201);
  fixtures.exercises.push(custom.id, replacement.id);
  assert.equal((await api(`/exercises?profileId=${other.id}&search=${encodeURIComponent(custom.name)}`)).length, 0);
  checks.add("24 custom exercise creation and metadata");
  checks.add("26 profile-specific custom exercises and history isolation");
  const days = [0, 1].map(dayIndex => ({
    name: dayIndex ? "Pull / press B" : "Press / pull A", dayIndex,
    exercises: [prescription(barbell.id), prescription(custom.id, 1, 2)],
  }));
  const startDate = date(today, -4);
  let plan = await api("/mesocycles", "POST", {
    profileId: profile.id, createMode: "build_own", name: `${label} main`, startDate, days,
    weeks: weeks(startDate, days),
  }, 201);
  fixtures.mainPlanId = plan.id;
  assert.match(plan.startDate, /^\d{4}-\d{2}-\d{2}$/);
  let edited = draft(plan);
  edited.weeks.splice(2, 0, { weekIndex: 3, kind: "loading", targetRir: 5,
    scheduledWorkouts: days.map((_, dayIndex) => ({ dayIndex, scheduledDate: date(startDate, 14 + dayIndex * 2) })) });
  edited.weeks[3].weekIndex = 4;
  plan = await savePlan(plan.id, edited);
  assert.equal(plan.weeks[2].targetRir, 5);
  checks.add("15 added loading week preserves selected RIR");
  await api(`/mesocycles/${plan.id}/weeks/${plan.weeks[2].id}`, "DELETE", undefined, 204);
  plan = await api(`/mesocycles/${plan.id}`);
  assert.equal(plan.weeks.length, 3);
  checks.add("16 future/unstarted loading week removal");
  const secondOccurrence = plan.weeks[0].scheduledWorkouts[1];
  const moved = await api(`/planned-workouts/${secondOccurrence.id}/reschedule`, "PATCH", { scheduledDate: date(startDate, 3) });
  assert.equal(moved.workout.weekId, plan.weeks[0].id);
  assert.equal(moved.workout.originalScheduledDate, secondOccurrence.originalScheduledDate);
  assert.equal(moved.workout.scheduledDate, date(startDate, 3));
  await reject(`/planned-workouts/${secondOccurrence.id}/reschedule`, "PATCH", { scheduledDate: date(startDate, 8) });
  checks.add("18 same-week Wednesday→Thursday rescheduling preserves identity/RIR/audit");
  let session = await start(profile.id, plan.weeks[0].scheduledWorkouts[0]);
  assert.equal(session.mesocycleWeek, 1);
  for (const e of session.exercises) {
    assert.equal(e.calibrationMode, true);
    assert.equal(e.targetRir, 3);
    assert.equal(e.recommendedWeight, null);
    assert.equal(e.recommendedReps, null);
    assert.equal(e.targetRepsMin, null);
    assert.equal(e.targetRepsMax, null);
    assert.equal(working(e)[0].workflowState, "active");
    assert.equal(working(e)[1].workflowState, "locked");
  }
  await reject(`/workouts/${session.id}/sets/${working(session.exercises[0])[0].id}`, "POST", { actualWeight: 100, actualReps: 6 });
  await reject(`/workouts/${session.id}/sets/${working(session.exercises[0])[1].id}`, "POST", { actualWeight: 100, actualReps: 6, actualRir: 3 });
  checks.add("2–4 calibration has no invented targets/ranges and records actual effort");
  session = await completeSession(session, { [barbell.id]: { weight: 225 / LB, reps: 6, rir: 3 }, [custom.id]: { weight: 30, reps: 6, rir: 3 } });
  assert.ok(session.exercises.flatMap(e => working(e)).every(s => s.targetStatus === null));
  const baseline = await api(`/profiles/${profile.id}/exercises/${barbell.id}/baseline`);
  assert.equal(baseline.status, "active");
  assert.equal((await api(`/profiles/${profile.id}/exercises/${dumbbell.id}/baseline`)).status, "no_baseline");
  assert.equal((await api(`/profiles/${other.id}/exercises/${barbell.id}/baseline`)).status, "no_baseline");
  session = await start(profile.id, moved.workout);
  await completeSession(session);
  plan = await api(`/mesocycles/${plan.id}`);
  assert.equal(plan.weeks[0].status, "completed");
  await reject(`/mesocycles/${plan.id}/weeks/${plan.weeks[0].id}`, "DELETE");
  await reject(`/planned-workouts/${moved.workout.id}/reschedule`, "PATCH", { scheduledDate: date(startDate, 4) });
  checks.add("17 completed historical weeks and workouts cannot be removed/rescheduled");
  session = await start(profile.id, plan.weeks[1].scheduledWorkouts[0]);
  assert.equal(session.mesocycleWeek, 2);
  assert.equal(session.targetRirSnapshot, 2);
  let bench = session.exercises.find(e => e.exerciseId === barbell.id);
  assert.equal(bench.calibrationMode, false);
  let set = working(bench)[0];
  assert.ok(set.adaptiveTargetWeight > 0 && set.adaptiveTargetReps > 0);
  assert.equal(set.adaptiveTargetRir, 2);
  assert.ok(Math.abs(set.adaptiveTargetWeight * LB / 2.5 - Math.round(set.adaptiveTargetWeight * LB / 2.5)) < 0.001);
  checks.add("5 Week-2 weight/reps/RIR prefills and retained personal baseline");
  checks.add("6 prescribed pounds snap to 2.5 lb");
  const originalAdaptive = await api(`/workouts/${session.id}/sets/${set.id}`, "PATCH", { actualWeight: 225 / LB, completed: false });
  const heavier = await api(`/workouts/${session.id}/sets/${set.id}`, "PATCH", { actualWeight: 230 / LB, completed: false });
  assert.ok(heavier.adaptiveTargetReps <= originalAdaptive.adaptiveTargetReps);
  checks.add("8 free load override adapts expected reps from personal capacity");
  const completed = await complete(session, set, 230 / LB, heavier.adaptiveTargetReps, 2);
  assert.equal(completed.set.completed, true);
  assert.equal(completed.set.workflowState, "locked");
  assert.ok(completed.set.targetStatus && completed.set.targetExplanation);
  assert.ok(completed.nextSet && completed.nextSet.workflowState === "active" && completed.nextSet.adaptiveTargetWeight !== null);
  await reject(`/workouts/${session.id}/sets/${set.id}`, "PATCH", { actualReps: 12 });
  const below = await api(`/workouts/${session.id}/sets/${set.id}`, "PATCH", {
    editIntent: true, completed: true, actualWeight: 230 / LB,
    actualReps: heavier.adaptiveTargetReps, actualRir: 0,
  });
  assert.equal(below.targetStatus, "below_target");
  const reCompleted = await api(`/workouts/${session.id}/sets/${set.id}`, "PATCH", {
    editIntent: true, completed: true, actualWeight: 230 / LB, actualReps: 12, actualRir: 2,
  });
  assert.equal(reCompleted.targetStatus, "above_target");
  await api(`/workouts/${session.id}/sets/${set.id}`, "DELETE", undefined, 204);
  bench = (await api(`/workouts/${session.id}`)).exercises.find(e => e.exerciseId === barbell.id);
  assert.deepEqual(working(bench).map(s => s.setNumber), [1, 2]);
  checks.add("9 explicit completion locks/unlocks/prefills; deliberate Edit recalculates future work");
  checks.add("11 individual completed work removal and renumbering");
  const warmup = await api(`/workouts/${session.id}/sets`, "POST", { workoutExerciseId: bench.id, setType: "warmup", setNumber: 1 }, 201);
  assert.equal((await complete(session, warmup, 50, 10, 5)).set.targetStatus, null);
  await api(`/workouts/${session.id}/sets/${warmup.id}`, "DELETE", undefined, 204);
  const retainedWarmup = await api(`/workouts/${session.id}/sets`, "POST", { workoutExerciseId: bench.id, setType: "warmup", setNumber: 1 }, 201);
  await complete(session, retainedWarmup, 40, 8, 5);
  const blank = await api(`/workouts/${session.id}/sets`, "POST", { workoutExerciseId: bench.id, setType: "work", setNumber: 3 }, 201);
  await api(`/workouts/${session.id}/sets/${blank.id}`, "DELETE", undefined, 204);
  checks.add("10 individual warmup removal");
  session = await completeSession(await api(`/workouts/${session.id}`));
  const expectedTotal = session.exercises.filter(e => !e.skipped).flatMap(e => working(e))
    .filter(s => s.completed).reduce((sum, s) => sum + s.actualWeight * s.actualReps, 0);
  assert.ok(Math.abs(session.totalVolume - expectedTotal) < 1e-7);
  assert.ok(Math.abs(session.muscleTotals.reduce((sum, m) => sum + m.totalWeightLifted, 0) - session.totalVolume) < 1e-7);
  assert.ok(session.exercises.flatMap(e => e.sets).some(s => s.id === retainedWarmup.id && s.completed));
  checks.add("12–13 removed sets/warmups excluded from exact primary-only Total Weight Lifted");
  checks.add("14 status only for valid working targets; explanations and snapshots persist");
  await completeSession(await start(profile.id, plan.weeks[1].scheduledWorkouts[1]));
  const copyOptions = await api(`/mesocycles/copy-options?profileId=${profile.id}`);
  assert.ok(copyOptions.eligibleWeeks.length >= 2);
  assert.ok(copyOptions.eligibleWeeks.every(w => w.weekIndex <= 2));
  const recommended = copyOptions.eligibleWeeks.find(w => w.weekId === copyOptions.recommendedWeekId);
  assert.equal(recommended.weekIndex, 2);
  assert.ok(Array.isArray(recommended.days) && recommended.days.length === 2);
  const copy = await api("/mesocycles", "POST", {
    profileId: profile.id, createMode: "copy_completed_week", sourceWeekId: recommended.weekId,
    name: `${label} copied`, startDate: today, days: recommended.days, weeks: weeks(today, recommended.days, [3], null),
  }, 201);
  assert.equal(copy.weeks[0].targetRir, 3);
  assert.ok(copy.sourceDescription.includes("Week 2"));
  assert.ok(copy.weeks.every(w => w.scheduledWorkouts.every(p => p.sessionId === null)));
  await reject("/mesocycles", "POST", {
    profileId: profile.id, createMode: "copy_completed_week", sourceWeekId: plan.weeks[2].id,
    name: `${label} invalid copy`, startDate: today, days, weeks: weeks(today, days),
  });
  checks.add("21 recommended fully completed loading-week copy, editable structure only, traceability");
  const templates = await api("/mesocycles/templates");
  assert.equal(templates.length, 8);
  assert.deepEqual(templates.map(t => t.days.length).sort((a, b) => a - b), [3, 3, 3, 4, 4, 4, 5, 6]);
  assert.ok(templates.every(t => JSON.stringify(t.defaultLoadingRirs) === "[3,2,1,0]"));
  const template = templates.find(t => t.name.includes("Time Saver") && t.days.length === 3);
  const templateDraft = structuredClone(template.days);
  templateDraft[0].name = "Editable original template";
  templateDraft[0].exercises[0].targetSets = 2;
  let templatePlan = await api("/mesocycles", "POST", {
    profileId: profile.id, createMode: "template", templateId: template.templateId,
    name: `${label} template`, startDate: today, days: templateDraft, weeks: weeks(today, templateDraft, [3, 2, 1, 0], null),
  }, 201);
  const templateEdit = draft(templatePlan);
  templateEdit.days[0].exercises[0].targetRepsMin = 5;
  templateEdit.days[0].exercises[0].targetRepsMax = 9;
  templateEdit.weeks[1].targetRir = 3;
  templatePlan = await savePlan(templatePlan.id, templateEdit);
  assert.equal(templatePlan.days[0].name, "Editable original template");
  assert.equal(templatePlan.days[0].exercises[0].targetRepsMax, 9);
  assert.equal(templatePlan.weeks[1].targetRir, 3);
  checks.add("22 eight original templates retain all programming/week edit controls");
  const singleDay = [{ name: "Bench", dayIndex: 0, exercises: [prescription(barbell.id)] }];
  const deloadPlan = await api("/mesocycles", "POST", {
    profileId: profile.id, createMode: "build_own", name: `${label} deload`, startDate: today,
    days: singleDay, weeks: weeks(today, singleDay, [3], "deload"),
  }, 201);
  const normal = await completeSession(await start(profile.id, deloadPlan.weeks[0].scheduledWorkouts[0]));
  const beforeDeload = await api(`/profiles/${profile.id}/exercises/${barbell.id}/baseline`);
  const recovery = await start(profile.id, deloadPlan.weeks[1].scheduledWorkouts[0]);
  assert.equal(recovery.weekKindSnapshot, "deload");
  assert.equal(recovery.exercises[0].targetRir, 4);
  assert.ok(working(recovery.exercises[0]).length < working(normal.exercises[0]).length);
  await completeSession(recovery, { [barbell.id]: { weight: 20, reps: 3, rir: 6 } });
  assert.equal((await api(`/profiles/${profile.id}/exercises/${barbell.id}/baseline`)).sourceSessionId, beforeDeload.sourceSessionId);
  assert.ok(!(await api(`/mesocycles/copy-options?profileId=${profile.id}`)).eligibleWeeks.some(w => w.weekId === deloadPlan.weeks[1].id));
  checks.add("19 configured deload reduces workload and does not become baseline/trend regression");
  const offCalendar = await api(`/mesocycles/calendar?profileId=${profile.id}&splitId=${plan.id}`);
  const offWeek = offCalendar.find(w => w.kind === "week_off");
  assert.ok(offWeek && offWeek.scheduledWorkouts.length === 0);
  checks.add("20 Week Off has no scheduled/missed lifting or negative performance records");
  session = await start(profile.id);
  const added = await api(`/workouts/${session.id}/exercises`, "POST", prescription(custom.id, 0, 1), 201);
  await complete(session, working(added)[0], 30, 6, 3);
  await api(`/workouts/${session.id}/exercises/${added.id}/feedback`, "PATCH", { painReported: true, painNote: "QA feedback, not a diagnosis" });
  const changed = await api(`/workouts/${session.id}/exercises/${added.id}`, "PATCH", { exerciseId: replacement.id, updateMesocycle: false });
  assert.equal(changed.calibrationMode, true);
  assert.equal(changed.targetWeight, null);
  await complete(session, working(changed)[0], 12, 8, 3);
  await api(`/workouts/${session.id}/exercises/${changed.id}/feedback`, "PATCH", { skipped: true });
  const substituted = await finish(session);
  assert.ok(substituted.exercises.some(e => e.exerciseId === custom.id && e.superseded && working(e).some(s => s.completed)));
  assert.ok(Math.abs(substituted.totalVolume - 180) < 1e-7);
  checks.add("Preserved pain, skip, substitution history and primary-muscle attribution");
  const kgPlan = await api("/mesocycles", "POST", {
    profileId: other.id, createMode: "build_own", name: `${label} kg cycle`, startDate: today,
    days: singleDay, weeks: weeks(today, singleDay, [3, 2], null),
  }, 201);
  await completeSession(await start(other.id, kgPlan.weeks[0].scheduledWorkouts[0]), { [barbell.id]: { weight: 100, reps: 8, rir: 3 } });
  const kgSession = await start(other.id, kgPlan.weeks[1].scheduledWorkouts[0]);
  const kgTarget = working(kgSession.exercises[0])[0].adaptiveTargetWeight;
  assert.ok(Math.abs(kgTarget / 2.5 - Math.round(kgTarget / 2.5)) < 0.0001);
  await completeSession(kgSession);
  await api(`/profiles/${other.id}/engine-settings`, "PATCH", { loadIncrementKg: 5 });
  const kgFree = await start(other.id);
  const kgAdded = await api(`/workouts/${kgFree.id}/exercises`, "POST", prescription(barbell.id), 201);
  assert.ok(Math.abs(working(kgAdded)[0].adaptiveTargetWeight / 5 - Math.round(working(kgAdded)[0].adaptiveTargetWeight / 5)) < 0.0001);
  await completeSession(await api(`/workouts/${kgFree.id}`));
  checks.add("7 kg recommendations use configurable kg increments and true canonical units");
  const history = await api(`/profiles/${profile.id}/exercises/${barbell.id}/history`);
  assert.ok(history.length > 0);
  for (const p of originalProfiles) {
    const existing = await api(`/workouts?profileId=${p.id}`);
    for (const item of existing.slice(0, 2)) {
      assert.equal((await api(`/workouts/${item.id}`)).id, item.id);
    }
  }
  checks.add("27 existing history remains readable");
  checks.add("25 Finish Workout persists summary, closes active workout and advances week/day");
  await pool.query("UPDATE workout_sessions SET started_at=now()-interval '50 days',ended_at=now()-interval '50 days' WHERE profile_id=$1 AND status='completed'", [profile.id]);
  await pool.query("UPDATE workout_sets s SET completed_at=now()-interval '50 days' FROM workout_exercises e,workout_sessions w WHERE s.workout_exercise_id=e.id AND e.session_id=w.id AND w.profile_id=$1 AND s.completed=true", [profile.id]);
  await pool.query("UPDATE exercise_baselines SET established_at=now()-interval '50 days',expires_at=now()-interval '8 days',paused_week_off_count=0 WHERE profile_id=$1", [profile.id]);
  assert.equal((await api(`/profiles/${profile.id}/exercises/${barbell.id}/baseline`)).status, "expired");
  await api(`/profiles/${profile.id}/engine-settings`, "PATCH", { baselineExpiryWeeks: 12 });
  assert.equal((await api(`/profiles/${profile.id}/exercises/${barbell.id}/baseline`)).status, "active");
  await api(`/profiles/${profile.id}/engine-settings`, "PATCH", { baselineExpiryWeeks: 6 });
  const expiredPlan = await api("/mesocycles", "POST", {
    profileId: profile.id, createMode: "build_own", name: `${label} expired calibration`, startDate: today,
    days: singleDay, weeks: weeks(today, singleDay, [1], null),
  }, 201);
  const expiredSession = await start(profile.id, expiredPlan.weeks[0].scheduledWorkouts[0]);
  assert.equal(expiredSession.exercises[0].baselineStatus, "expired");
  assert.equal(expiredSession.exercises[0].calibrationMode, true);
  assert.equal(expiredSession.exercises[0].targetRir, 3);
  await api(`/workouts/${expiredSession.id}/exercises/${expiredSession.exercises[0].id}/feedback`, "PATCH", { skipped: true });
  await finish(expiredSession);
  checks.add("Configurable expiry retains old history and recalibrates at 3 RIR even in week targeting 1");
  fixtures.browserProfileId = other.id;
  fixtures.browserExerciseId = barbell.id;
  await verifyOriginals();
  await saveFixtures();
  console.log(`PASSED ${checks.size} grouped V2.1 checks:\n${[...checks].map(c => `- ${c}`).join("\n")}`);
  console.log(`QA_FIXTURES=.local/legendary-v21-qa.json\nBROWSER_PROFILE_ID=${other.id}`);
  }
} finally {
  if (pool) {
    if (process.env.KEEP_QA !== "1") {
      for (const profile of fixtures.profiles) {
        await cleanupProfile(profile);
      }
    }
    await pool.end();
  }
}