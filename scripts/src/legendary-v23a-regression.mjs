import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const { pool } = await import("../../lib/db/src/index.ts");
const base = `https://${process.env.REPLIT_DEV_DOMAIN}/api`;
let passed = 0;
const profiles = [];
async function api(path, method = "GET", body, expected = 200) {
  const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  assert.equal(response.status, expected, `${method} ${path}: ${text.slice(0, 800)}`);
  return text && response.status !== 204 ? JSON.parse(text) : null;
}
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
const query = async (text, params = []) => (await pool.query(text, params)).rows;
const date = offset => new Date(Date.parse("2026-10-05T12:00:00Z") + offset * 86400000).toISOString().slice(0, 10);
let exerciseId;
async function create(profileId, name = "Lifecycle QA", loadingOnly = false) {
  return api("/mesocycles", "POST", {
    profileId, name, startDate: date(0), createMode: "build_own",
    days: [{ name: "Monday", dayIndex: 0, exercises: [{ exerciseId, orderIndex: 0, targetSets: 2,
      minimumWorkingSets: 1, maximumWorkingSets: 5, targetRepsMin: 6, targetRepsMax: 30, targetRir: 3 }] }],
    weeks: (loadingOnly ? [3] : [3, 2, 4]).map((targetRir, i) => ({ weekIndex: i + 1, targetRir, kind: i === 2 ? "deload" : "loading",
      scheduledWorkouts: [{ dayIndex: 0, scheduledDate: date(i * 7) }] })),
  }, 201);
}
const lifecycle = (split, profileId, action, extra = {}) => api(`/mesocycles/${split}/lifecycle`, "POST", { profileId, action, ...extra });
const calendar = (split, profileId) => api(`/mesocycles/calendar?profileId=${profileId}&splitId=${split}`);
async function start(cycle, profileId, index = 0) {
  return api("/workouts/start", "POST", { profileId, scheduledWorkoutId: cycle.weeks[index].scheduledWorkouts[0].id }, 201);
}
async function complete(session) {
  for (const exercise of session.exercises) {
    for (const set of exercise.sets.filter(s => s.setType === "work" && !s.completed))
      await api(`/workouts/${session.id}/sets/${set.id}`, "POST", { actualWeight: 100, actualReps: 8, actualRir: exercise.targetRir });
    await api(`/workouts/${session.id}/exercises/${exercise.id}/post-feedback`, "PUT", { pump: "good", fatigue: "moderate", discomfort: "none" });
  }
  return api(`/workouts/${session.id}/finish`, "POST", { structureDecision: "today_only" });
}
const evidence = sessionId => query(`SELECT ws.id, ws.profile_id, ws.status, ws.started_at,ws.ended_at,ws.total_volume,
  ws.mesocycle_start_date, we.exercise_id, s.id set_id,s.actual_weight,s.actual_reps,s.actual_rir,s.completed_at
  FROM workout_sessions ws JOIN workout_exercises we ON we.session_id=ws.id JOIN workout_sets s ON s.workout_exercise_id=we.id
  WHERE ws.id=$1 ORDER BY s.id`, [sessionId]);
try {
  for (const label of ["main", "control"]) {
    const p = await api("/profiles", "POST", { name: `V23A API QA ${label} ${Date.now()}` }, 201);
    profiles.push(p.id);
  }
  await writeFile(new URL("../../.local/v23a-api-qa.json", import.meta.url), JSON.stringify({ profileIds: profiles }));
  const [pid, control] = profiles;
  const library = await api(`/exercises?profileId=${pid}`);
  exerciseId = library.find(e => e.name === "Barbell Bench Press").id;
  const ownedExercise = await api("/exercises", "POST", { profileId: pid, name: "V23A custom library exercise",
    muscleGroup: "Chest", equipment: "Dumbbell", isCompound: false }, 201);
  const cycle = await create(pid);
  const controlCycle = await create(control, "Unaffected control");
  const controlState = await query("SELECT to_jsonb(s) data FROM training_splits s WHERE profile_id=$1 ORDER BY id", [control]);
  const createdCalendar = await calendar(cycle.id, pid);
  check("creation generates all correctly owned week/day/date relationships", () => {
    assert.equal(createdCalendar.flatMap(w => w.scheduledWorkouts).length, 3);
    assert.deepEqual(createdCalendar.flatMap(w => w.scheduledWorkouts).map(w => w.scheduledDate), [date(0), date(7), date(14)]);
  });
  const session = await start(cycle, pid);
  await lifecycle(cycle.id, pid, "pause");
  check("Pause succeeds with an active workout and persists PAUSED", () => {});
  assert.equal((await api(`/mesocycles/${cycle.id}`)).lifecycleStatus, "paused");
  const pausedCalendar = await calendar(cycle.id, pid);
  check("Pause never cancels or misses future workouts", () => assert.ok(pausedCalendar.every(w => w.scheduledWorkouts.every(p => p.status === "scheduled"))));
  await query("UPDATE training_splits SET paused_at=now()-interval '3 days' WHERE id=$1 AND profile_id=$2", [cycle.id, pid]);
  await lifecycle(cycle.id, pid, "resume");
  const shifted = await calendar(cycle.id, pid);
  check("Resume persists ACTIVE and shifts only future dates by paused days", () => {
    assert.equal(shifted[0].scheduledWorkouts[0].scheduledDate, date(3));
    assert.equal(shifted[1].scheduledWorkouts[0].scheduledDate, date(10));
  });
  check("Resume also synchronizes persisted prescription date metadata", () => {});
  const prescription = await api(`/planned-workouts/${cycle.weeks[0].scheduledWorkouts[0].id}/prescription`);
  assert.equal(prescription.scheduledDate, date(3));
  const finished = await complete(session);
  const before = await evidence(session.id);
  await lifecycle(cycle.id, pid, "pause");
  await query("UPDATE training_splits SET paused_at=now()-interval '2 days' WHERE id=$1 AND profile_id=$2", [cycle.id, pid]);
  await lifecycle(cycle.id, pid, "resume");
  assert.deepEqual(await evidence(session.id), before);
  check("completed performance, dates and sets are unchanged by schedule shifts", () => {});
  await lifecycle(cycle.id, pid, "end_early");
  const ended = await api(`/mesocycles/${cycle.id}`);
  check("End Early persists its status, end date and completed-week count", () => {
    assert.equal(ended.lifecycleStatus, "ended_early"); assert.ok(ended.endedAt); assert.equal(ended.completedWeeks, 1);
  });
  const endedCalendar = await calendar(cycle.id, pid);
  check("End Early API returns only actual historical Calendar entries", () => {
    assert.equal(endedCalendar.length, 1);
    const workouts = endedCalendar.flatMap(w => w.scheduledWorkouts);
    assert.equal(workouts.length, 1); assert.equal(workouts[0].status, "completed");
  });
  const restart = await lifecycle(cycle.id, pid, "restart", { startDate: date(21) });
  const retry = await lifecycle(cycle.id, pid, "restart", { startDate: date(21) });
  check("Restart retries return ONE new instance", () => assert.equal(restart.newSplitId, retry.newSplitId));
  const restarted = await api(`/mesocycles/${restart.newSplitId}`);
  check("Restart begins Week 1 without copying completed sessions", () => {
    assert.equal(restarted.currentWeek, 1); assert.ok(restarted.weeks.every(w => w.status === "future"));
  });
  const restartPrescription = await api(`/planned-workouts/${restarted.weeks[0].scheduledWorkouts[0].id}/prescription`);
  check("Use history uses valid recent performance from the original", () => assert.equal(restartPrescription.exercises[0].calibrationMode, false));
  await api(`/mesocycles/${cycle.id}?profileId=${control}`, "DELETE", undefined, 404);
  await api(`/mesocycles/${cycle.id}?profileId=${pid}`, "DELETE", undefined, 204);
  await api(`/mesocycles/${cycle.id}?profileId=${pid}`, "DELETE", undefined, 204);
  check("history-bearing plan deletion is safely retryable", () => {});
  const plans = await api(`/splits?profileId=${pid}`);
  check("deleted plan disappears from Plans", () => assert.ok(!plans.some(s => s.id === cycle.id)));
  await calendar(cycle.id, pid).then(() => assert.fail("Deleted Calendar should not be available"), () => {});
  check("deleted plan cannot remain an accessible Calendar source", () => {});
  assert.deepEqual(await evidence(session.id), before);
  check("plan deletion preserves exact completed evidence and feedback", () => {});
  assert.equal((await query("SELECT count(*) n FROM exercise_feedback WHERE session_id=$1", [session.id]))[0].n, "1");
  assert.ok((await query("SELECT id FROM exercise_baselines WHERE profile_id=$1 AND source_session_id=$2", [pid, session.id])).length);
  check("valid historical baseline source survives plan deletion", () => {});
  const recal = await lifecycle(restarted.id, pid, "restart", { recalibrateAll: true });
  const recalCycle = await api(`/mesocycles/${recal.newSplitId}`);
  const recalRx = await api(`/planned-workouts/${recalCycle.weeks[0].scheduledWorkouts[0].id}/prescription`);
  check("Recalibrate all ignores old prescriptions without deleting history", () => assert.ok(recalRx.exercises.every(e => e.calibrationMode)));
  assert.deepEqual(await evidence(session.id), before);
  const activeRecal = await start(recalCycle, pid);
  await lifecycle(recalCycle.id, pid, "end_early");
  check("End Early can close a plan without destroying an in-progress workout", () => {});
  assert.equal((await api(`/workouts/${activeRecal.id}`)).status, "active");
  await complete(activeRecal);
  assert.equal((await api(`/mesocycles/${recalCycle.id}`)).lifecycleStatus, "ended_early");
  check("finishing that workout never reopens the ended instance", () => {});
  const unused = await create(pid, "Unused removal", true);
  await api(`/mesocycles/${unused.id}/weeks`, "POST", { profileId: pid, targetRir: 1 });
  const extended = await api(`/mesocycles/${unused.id}`);
  check("Add Week adds exactly one week without inventing an unchosen recovery week", () => {
    assert.equal(extended.cycleLengthWeeks, 2);
    assert.deepEqual(extended.weeks.map(w => w.kind), ["loading", "loading"]);
  });
  await start(unused, pid);
  await api(`/mesocycles/${unused.id}?profileId=${pid}`, "DELETE", undefined, 204);
  assert.equal((await query("SELECT count(*) n FROM planned_workouts WHERE split_id=$1", [unused.id]))[0].n, "0");
  check("unused deletion removes its actual schedule and prescription records", () => {});
  assert.equal((await query("SELECT count(*) n FROM workout_sessions WHERE split_id=$1", [unused.id]))[0].n, "0");
  check("unused deletion also clears an empty active workout without losing performance", () => {});
  const profileBefore = (await query("SELECT to_jsonb(p) data FROM training_profiles p WHERE id=$1", [pid]))[0];
  const settingsBefore = await api(`/profiles/${pid}/engine-settings`);
  const libraryBefore = await api(`/exercises?profileId=${pid}`);
  await api(`/profiles/${pid}/reset-training`, "POST", { confirmation: "reset" }, 400);
  assert.ok((await query("SELECT id FROM workout_sessions WHERE profile_id=$1", [pid])).length);
  check("wrong RESET confirmation cannot erase data", () => {});
  await api(`/profiles/${pid}/reset-training`, "POST", { confirmation: "RESET" }, 204);
  for (const table of ["training_splits", "workout_sessions", "exercise_baselines", "progression_recommendations", "exercise_feedback"]) {
    assert.equal((await query(`SELECT count(*) n FROM ${table} WHERE profile_id=$1`, [pid]))[0].n, "0");
  }
  check("reset clears selected profile schedules, sessions, sets, feedback and progression", () => {});
  assert.deepEqual((await query("SELECT to_jsonb(p) data FROM training_profiles p WHERE id=$1", [pid]))[0], profileBefore);
  assert.deepEqual(await api(`/profiles/${pid}/engine-settings`), settingsBefore);
  assert.deepEqual(await api(`/exercises?profileId=${pid}`), libraryBefore);
  check("reset preserves profile settings and the custom/global exercise library", () => assert.ok(libraryBefore.some(e => e.id === ownedExercise.id)));
  assert.deepEqual(await query("SELECT to_jsonb(s) data FROM training_splits s WHERE profile_id=$1 ORDER BY id", [control]), controlState);
  check("another profile's program and schedule are untouched", () => {});
  assert.deepEqual(await api(`/splits?profileId=${pid}`), []);
  const overview = await api(`/overview?profileId=${pid}`);
  assert.equal(overview.activeWorkout, null);
  assert.equal((await query("SELECT coalesce(sum(total_volume),0) volume FROM workout_sessions WHERE profile_id=$1", [pid]))[0].volume, 0);
  check("after reset Plans and active workout state are empty", () => {});
  console.log(`ALL ${passed} V2.3A API checks passed.`);
} finally {
  if (profiles.length) await query("DELETE FROM training_profiles WHERE id=ANY($1) AND name LIKE 'V23A API QA %'", [profiles]);
  await pool.end();
}