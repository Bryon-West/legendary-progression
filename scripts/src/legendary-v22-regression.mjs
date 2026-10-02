import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const { pool } = await import("../../lib/db/src/index.ts");
const base = `https://${process.env.REPLIT_DEV_DOMAIN}/api`;
const kg = pounds => pounds / 2.20462262185;
const passed = [];
async function request(path, method = "GET", data, expected = 200) {
  const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
  const text = await response.text();
  assert.equal(response.status, expected, `${method} ${path}: ${text.slice(0, 700)}`);
  return text ? JSON.parse(text) : null;
}
function check(name, work) { work(); passed.push(name); console.log(`PASS ${name}`); }
const dayNames = ["Monday", "Wednesday", "Friday"];
let profileId, splitId;
const qaFile = new URL("../../.local/v22-api-qa.json", import.meta.url);
const previousQA = await readFile(qaFile, "utf8").then(JSON.parse).catch(() => ({}));
const profileIds = previousQA.profileIds ?? (previousQA.profileId ? [previousQA.profileId] : []);
if (!previousQA.passed?.length && profileIds.length) {
  await pool.query("DELETE FROM training_profiles WHERE id=ANY($1) AND name LIKE 'V22 API QA %'", [profileIds]);
  profileIds.splice(0);
}
try {
  const profile = await request("/profiles", "POST", { name: `V22 API QA ${Date.now()}` }, 201);
  profileId = profile.id;
  profileIds.push(profileId);
  await writeFile(qaFile, JSON.stringify({ profileId, profileIds }));
  await request(`/profiles/${profileId}`, "PATCH", { weightUnit: "lb" });
  const library = await request(`/exercises?profileId=${profileId}`);
  const compound = library.find(e => e.name === "Barbell Bench Press");
  const isolation = library.find(e => e.name === "Cable Lateral Raise");
  const replacement = library.find(e => e.name === "Cable Chest Fly");
  assert.ok(compound && isolation && replacement);
  const startDate = "2026-10-05";
  const date = n => new Date(Date.parse(`${startDate}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  const days = dayNames.map((name, dayIndex) => ({ name, dayIndex, exercises: [compound, isolation].map((e, orderIndex) => ({
    exerciseId: e.id, orderIndex, targetSets: 2, minimumWorkingSets: 1, maximumWorkingSets: 5, targetRepsMin: 6, targetRepsMax: 30, targetRir: 3,
  })) }));
  const weeks = [3, 2, 1, 0, 4].map((targetRir, index) => ({
    weekIndex: index + 1, targetRir, kind: index === 4 ? "deload" : "loading",
    scheduledWorkouts: days.map(d => ({ dayIndex: d.dayIndex, scheduledDate: date(index * 7 + d.dayIndex * 2) })),
  }));
  const cycle = await request("/mesocycles", "POST", { profileId, name: "V22 exact progression QA", startDate, createMode: "build_own", days, weeks }, 201);
  splitId = cycle.id;
  const occurrence = (w, d) => cycle.weeks[w - 1].scheduledWorkouts.find(o => o.splitDayId === cycle.days[d].id);
  const prescription = (w, d) => request(`/planned-workouts/${occurrence(w, d).id}/prescription`);
  let p = await prescription(1, 0);
  check("Week 1 independent calibration at prescribed RIR", () => {
    assert.ok(p.exercises.every(e => e.calibrationMode && e.sets.every(s => s.weight === null && s.expectedReps === null && s.rir === 3)));
  });
  p = await prescription(3, 0);
  check("far future has no fabricated loads", () => { assert.equal(p.state, "load_not_calculated"); assert.deepEqual(p.exercises, []); });
  await request("/workouts/start", "POST", { profileId, scheduledWorkoutId: occurrence(3, 0).id }, 409);
  let session;
  const start = (w, d, recovery) => request("/workouts/start", "POST", {
    profileId, scheduledWorkoutId: occurrence(w, d).id, ...(recovery ? { muscleRecovery: recovery } : {}),
  }, 201);
  const complete = async (workout, excluded = []) => {
    let current = workout;
    for (const exercise of workout.exercises.filter(e => !e.superseded && !e.skipped && !excluded.includes(e.id))) {
      for (const set of exercise.sets.filter(s => s.setType === "work" && !s.removed && !s.completed).sort((a, b) => a.setNumber - b.setNumber)) {
        const pounds = exercise.exerciseId === compound.id ? 225 : 20;
        await request(`/workouts/${workout.id}/sets/${set.id}`, "POST", {
          actualWeight: kg(pounds), actualReps: exercise.exerciseId === compound.id ? 8 : 12, actualRir: exercise.targetRir,
        });
      }
      await request(`/workouts/${workout.id}/exercises/${exercise.id}/post-feedback`, "PUT", { pump: "good", fatigue: "moderate", discomfort: "none" });
    }
    current = await request(`/workouts/${workout.id}`);
    return current;
  };
  const finish = (sid, structureDecision = "today_only") => request(`/workouts/${sid}/finish`, "POST", { structureDecision });
  session = await start(1, 0);
  const activePrescription = await prescription(1, 0);
  check("active planned workouts expose the stable session identity for Resume", () => assert.equal(activePrescription.sessionId, session.id));
  const resumed = await start(1, 0);
  check("Resume returns the original active session without duplicating it", () => assert.equal(resumed.id, session.id));
  check("all initial working-set rows exist and RIR is configured", () => {
    assert.ok(session.exercises.every(e => e.sets.filter(s => s.setType === "work").length === 2 && e.calibrationRir === 3));
  });
  const warmup = await request(`/workouts/${session.id}/sets`, "POST", { workoutExerciseId: session.exercises[0].id, setType: "warmup", setNumber: 1 }, 201);
  await request(`/workouts/${session.id}/sets/${warmup.id}`, "POST", { actualWeight: kg(50), actualReps: 5, actualRir: 5 });
  session = await complete(session);
  check("completed rows keep the prescribed RIR, separately from source reference RIR", () => {
    assert.ok(session.exercises.every(e => e.sets.filter(s => s.setType === "work" && s.completed).every(s => s.adaptiveTargetRir === e.targetRir)));
  });
  const firstFinish = await finish(session.id);
  check("working sets count toward lifted weight while warmups are excluded", () => {
    assert.ok(Math.abs(firstFinish.workout.totalVolume - kg(2 * 225 * 8 + 2 * 20 * 12)) < 0.0001);
  });
  const immediate = (await pool.query(`SELECT e.exercise_id,count(*)::int n FROM planned_prescription_sets e
    JOIN planned_prescriptions pp ON pp.id=e.prescription_id WHERE pp.planned_workout_id=$1 GROUP BY e.exercise_id`, [occurrence(2, 0).id])).rows;
  check("finish immediately persists ALL next-week rows before any future-page request", () => {
    assert.equal(immediate.length, 2); assert.ok(immediate.every(e => e.n === 3));
  });
  p = await prescription(2, 0);
  check("compound load-first and isolation rep-first prescriptions", () => {
    assert.ok(p.exercises.find(e => e.exerciseId === compound.id).sets[0].weight > kg(225));
    assert.ok(Math.abs(p.exercises.find(e => e.exerciseId === isolation.id).sets[0].weight - kg(20)) < 0.00001);
  });
  const beforeRepeat = await request(`/profiles/${profileId}/exercises/${compound.id}/baseline`);
  await finish(session.id);
  const repeated = await request(`/profiles/${profileId}/exercises/${compound.id}/baseline`);
  check("Finish is idempotent and does not reset the normal baseline", () => assert.deepEqual(awaitableBaseline(repeated), awaitableBaseline(beforeRepeat)));
  for (const d of [1, 2]) { session = await start(1, d); await complete(session); await finish(session.id); }
  for (const d of [0, 1, 2]) { p = await prescription(2, d); assert.ok(p.exercises.every(e => e.sets.length === 3)); }
  check("all corresponding Week 2 days have three persisted sets", () => assert.equal(p.weekIndex, 2));
  const normalIso = await request(`/profiles/${profileId}/exercises/${isolation.id}/baseline`);
  check("exercise baselines remain independent", () => {
    assert.equal(normalIso.exerciseId, isolation.id);
    assert.notEqual(normalIso.sourceSetId, beforeRepeat.sourceSetId);
    assert.ok(Math.abs(p.exercises.find(e => e.exerciseId === isolation.id).reference.weight - kg(20)) < 0.00001);
  });
  session = await start(2, 0, [{ muscleGroup: isolation.muscleGroup, status: "still_sore" }]);
  const isoRow = session.exercises.find(e => e.exerciseId === isolation.id);
  const context = await request(`/workouts/${session.id}/structure-changes`);
  check("recovery is evaluated at next exposure, not auto-applied", () => {
    assert.equal(context.recovery.find(r => r.workoutExerciseId === isoRow.id).status, "still_sore");
    assert.equal(isoRow.targetSets, 3); assert.equal(isoRow.recoveryAdjustment, null);
  });
  session = await request(`/workouts/${session.id}/exercises/${isoRow.id}/recovery`, "POST", { action: "reduce_sets" });
  check("temporary recovery removes one set and preserves RIR", () => {
    const adjusted = session.exercises.find(e => e.id === isoRow.id);
    assert.equal(adjusted.recoveryAdjustment, "reduce_sets"); assert.equal(adjusted.targetSets, 2); assert.equal(adjusted.targetRir, 2);
  });
  const compRow = session.exercises.find(e => e.exerciseId === compound.id);
  await request(`/workouts/${session.id}/sets`, "POST", { workoutExerciseId: compRow.id, setType: "work", setNumber: 4 }, 201);
  session = await request(`/workouts/${session.id}`);
  await complete(session);
  let changed = await request(`/workouts/${session.id}/structure-changes`);
  const currentRows = await request(`/workouts/${session.id}`);
  check("Week 2 target snapshots and explanations use prescribed 2 RIR, not source 3 RIR", () => {
    const first = currentRows.exercises.find(e => e.exerciseId === compound.id).sets.find(s => s.setType === "work" && s.setNumber === 1);
    assert.equal(first.referenceTargetRir, 3); assert.equal(first.adaptiveTargetRir, 2); assert.equal(first.actualRir, 2);
    assert.match(first.targetExplanation, /prescribed 2 RIR/);
  });
  check("Finish preflight consolidates only intentional structural changes", () => {
    assert.ok(changed.changes.some(s => /3 sets → 4 sets/.test(s)));
    assert.ok(!changed.changes.some(s => /Lateral.*3 sets → 2 sets/.test(s)));
  });
  await request(`/workouts/${session.id}/finish`, "POST", {}, 409);
  await finish(session.id, "keep");
  p = await prescription(3, 0);
  check("accepted Week 2 four sets progress to FIVE Week 3 sets", () => assert.equal(p.exercises.find(e => e.exerciseId === compound.id).sets.length, 5));
  const isoAfter = await request(`/profiles/${profileId}/exercises/${isolation.id}/baseline`);
  check("temporary set recovery does not reset the normal baseline", () => {
    assert.equal(isoAfter.sourceSetId, normalIso.sourceSetId); assert.equal(p.exercises.find(e => e.exerciseId === isolation.id).sets.length, 4);
  });
  session = await start(2, 1);
  const moveIso = session.exercises.find(e => e.exerciseId === isolation.id);
  await request(`/workouts/${session.id}/exercises/${moveIso.id}/order`, "PATCH", { direction: "up" });
  session = await request(`/workouts/${session.id}`);
  check("exercise reordering persists on reload", () => assert.equal(session.exercises.filter(e => !e.superseded)[0].id, moveIso.id));
  const row = session.exercises.find(e => e.exerciseId === compound.id);
  await request(`/workouts/${session.id}/sets`, "POST", { workoutExerciseId: row.id, setType: "work", setNumber: 4 }, 201);
  session = await request(`/workouts/${session.id}`); await complete(session); await finish(session.id, "today_only");
  p = await prescription(3, 1);
  check("Today Only does not alter future structure or another day's accepted anchor", () => assert.equal(p.exercises.find(e => e.exerciseId === compound.id).sets.length, 4));
  session = await start(2, 2, [{ muscleGroup: isolation.muscleGroup, status: "still_sore" }]);
  const original = session.exercises.find(e => e.exerciseId === compound.id);
  await request(`/workouts/${session.id}/sets/${original.sets[0].id}`, "POST", { actualWeight: kg(225), actualReps: 8, actualRir: 2 });
  await request(`/workouts/${session.id}/exercises/${original.id}`, "PATCH", { exerciseId: replacement.id, updateMesocycle: false });
  session = await request(`/workouts/${session.id}`);
  const originalRow = session.exercises.find(e => e.id === original.id);
  check("substitution preserves performed sets under the original exercise", () => {
    assert.ok(originalRow?.superseded); assert.equal(originalRow.sets[0].actualReps, 8);
  });
  const iso = session.exercises.find(e => e.exerciseId === isolation.id);
  session = await request(`/workouts/${session.id}/exercises/${iso.id}/recovery`, "POST", { action: "reduce_load" });
  const beforeLoadBaseline = await request(`/profiles/${profileId}/exercises/${isolation.id}/baseline`);
  await complete(session);
  const removeRow = session.exercises.find(e => e.exerciseId === isolation.id);
  session = await request(`/workouts/${session.id}/exercises/${removeRow.id}/remove`, "POST", { scope: "today_only" });
  await finish(session.id, "today_only");
  const historical = await request(`/workouts/${session.id}`);
  check("exercise removal retains completed historical performance", () => assert.ok(historical.exercises.some(e => e.id === removeRow.id && e.sets.some(s => s.completed))));
  const reducedLoadBaseline = await request(`/profiles/${profileId}/exercises/${isolation.id}/baseline`);
  check("temporary recovery load reduction does not lower the normal baseline", () => assert.equal(reducedLoadBaseline.sourceSetId, beforeLoadBaseline.sourceSetId));
  await request(`/mesocycles/${splitId}/lifecycle`, "POST", { profileId, action: "pause" });
  const paused = await request(`/mesocycles/${splitId}`);
  check("Pause preserves current week and completed history", () => { assert.equal(paused.lifecycleStatus, "paused"); assert.equal(paused.currentWeek, 3); });
  await request(`/mesocycles/${splitId}/lifecycle`, "POST", { profileId, action: "resume" });
  await request(`/mesocycles/${splitId}/weeks`, "POST", { profileId, targetRir: 2 });
  let extended = await request(`/mesocycles/${splitId}`);
  check("Add Week inserts configurable loading before the anchored Deload", () => {
    assert.equal(extended.weeks.at(-1).kind, "deload"); assert.equal(extended.weeks.at(-2).targetRir, 2);
  });
  await request(`/mesocycles/${splitId}/loading-week`, "DELETE", undefined);
  extended = await request(`/mesocycles/${splitId}`);
  check("Remove final unstarted loading keeps Deload final", () => assert.equal(extended.weeks.at(-1).weekIndex, 5));
  for (const w of [3, 4]) for (const d of [0, 1, 2]) {
    const adjustment = w === 3 && d === 2 ? "skip_today" : w === 4 && d === 0 ? "reduce_sets" : null;
    const repeatedRecovery = w === 4 && d === 1;
    session = await start(w, d, adjustment || repeatedRecovery ? [{ muscleGroup: isolation.muscleGroup, status: "still_sore" }] : undefined);
    const ex = session.exercises.find(e => e.exerciseId === isolation.id);
    const prior = await request(`/profiles/${profileId}/exercises/${isolation.id}/baseline`);
    if (adjustment) session = await request(`/workouts/${session.id}/exercises/${ex.id}/recovery`, "POST", { action: adjustment });
    if (repeatedRecovery) {
      const context = await request(`/workouts/${session.id}/structure-changes`);
      check("repeated consecutive limited recovery surfaces confirmation", () => assert.equal(context.recovery.find(r => r.workoutExerciseId === ex.id).repeatLimited, true));
      session = await request(`/workouts/${session.id}/exercises/${ex.id}/recovery`, "POST", { action: "train_as_planned", persistentChoice: "keep_current_volume" });
    }
    await complete(session); await finish(session.id);
    if (adjustment === "skip_today") {
      const after = await request(`/profiles/${profileId}/exercises/${isolation.id}/baseline`);
      check("recovery skip is not a failure and does not overwrite strength history", () => assert.equal(after.sourceSetId, prior.sourceSetId));
    }
  }
  p = await prescription(5, 0);
  check("final loading five sets becomes TWO Deload sets", () => assert.equal(p.exercises.find(e => e.exerciseId === compound.id).sets.length, 2));
  await request(`/mesocycles/${splitId}/loading-week`, "DELETE", undefined, 400);
  check("completed loading weeks cannot be removed", () => assert.equal(extended.weeks[0].status, "completed"));
  const compNormal = await request(`/profiles/${profileId}/exercises/${compound.id}/baseline`);
  for (const d of [0, 1, 2]) { session = await start(5, d); await complete(session); await finish(session.id); }
  const final = await request(`/mesocycles/${splitId}`);
  check("final Deload completes lifecycle without lowering normal baseline", () => assert.equal(final.lifecycleStatus, "completed"));
  const postDeload = await request(`/profiles/${profileId}/exercises/${compound.id}/baseline`);
  assert.equal(postDeload.sourceSetId, compNormal.sourceSetId);
  await request(`/mesocycles/${splitId}/delete-unstarted`, "DELETE", undefined, 400);
  check("Delete is protected when completed history exists", () => assert.ok(final.weeks.every(w => w.status === "completed")));
  const restarted = await request(`/mesocycles/${splitId}/lifecycle`, "POST", { profileId, action: "restart", recalibrateAll: true, startDate: "2026-11-09" });
  const clone = await request(`/mesocycles/${restarted.newSplitId}`);
  p = await request(`/planned-workouts/${clone.weeks[0].scheduledWorkouts[0].id}/prescription`);
  check("Restart creates a linked new instance with optional full recalibration", () => {
    assert.notEqual(clone.id, splitId); assert.equal(clone.restartFromId, splitId); assert.ok(p.exercises.every(e => e.calibrationMode));
  });
  await request(`/mesocycles/${clone.id}/lifecycle`, "POST", { profileId, action: "end_early" });
  check("End Early keeps the original completed history", () => assert.equal(final.weeks[0].scheduledWorkouts[0].status, "completed"));
  const anew = await request(`/mesocycles/${clone.id}/lifecycle`, "POST", { profileId, action: "restart", recalibrateAll: false });
  check("ended-early cycles can be restarted using personal history", () => assert.ok(anew.newSplitId > clone.id));
  const nextCycle = await request(`/mesocycles/${anew.newSplitId}`);
  const structureOf = c => c.days.map(d => d.exercises.map(e => ({ exerciseId: e.exerciseId, orderIndex: e.orderIndex, targetSets: e.targetSets })));
  session = await request("/workouts/start", "POST", { profileId, scheduledWorkoutId: nextCycle.weeks[0].scheduledWorkouts.find(o => o.splitDayId === nextCycle.days[0].id).id }, 201);
  // Simulate a pre-update active session, not an original user's record.
  await pool.query("UPDATE workout_sessions SET structure_snapshot=NULL WHERE id=$1 AND profile_id=$2", [session.id, profileId]);
  const untouchedCompound = session.exercises.find(e => e.exerciseId === compound.id);
  const untouchedIso = session.exercises.find(e => e.exerciseId === isolation.id);
  await request(`/workouts/${session.id}/exercises/${untouchedCompound.id}`, "PATCH", { exerciseId: replacement.id, updateMesocycle: true });
  await request(`/workouts/${session.id}/exercises/${untouchedIso.id}/remove`, "POST", { scope: "mesocycle" });
  const pending = await request(`/mesocycles/${anew.newSplitId}`);
  check("in-place replacement and removal defer ALL future edits until Finish", () => assert.deepEqual(structureOf(pending), structureOf(nextCycle)));
  const legacyChanges = await request(`/workouts/${session.id}/structure-changes`);
  check("existing active sessions detect replacement before the first performed set", () => {
    assert.ok(legacyChanges.changes.some(s => /Bench Press: replaced with/.test(s)));
    assert.ok(legacyChanges.changes.some(s => /Lateral Raise: removed/.test(s)));
  });
  session = await request(`/workouts/${session.id}`); await complete(session); await finish(session.id, "today_only");
  const todayOnlyCycle = await request(`/mesocycles/${anew.newSplitId}`);
  check("Today Only preserves future structure after both a requested replacement and removal", () => assert.deepEqual(structureOf(todayOnlyCycle), structureOf(nextCycle)));
  session = await request("/workouts/start", "POST", { profileId, scheduledWorkoutId: nextCycle.weeks[0].scheduledWorkouts.find(o => o.splitDayId === nextCycle.days[1].id).id,
    muscleRecovery: [{ muscleGroup: isolation.muscleGroup, status: "still_sore" }] }, 201);
  const permanentIso = session.exercises.find(e => e.exerciseId === isolation.id);
  const permanentComp = session.exercises.find(e => e.exerciseId === compound.id);
  session = await request(`/workouts/${session.id}/exercises/${permanentIso.id}/recovery`, "POST", { action: "reduce_sets", persistentChoice: "reduce_working_sets" });
  await request(`/workouts/${session.id}/sets`, "POST", { workoutExerciseId: permanentComp.id, setType: "work", setNumber: permanentComp.sets.length + 1 }, 201);
  session = await request(`/workouts/${session.id}`); await complete(session); await finish(session.id, "keep");
  const nextPermanent = await request(`/planned-workouts/${nextCycle.weeks[1].scheduledWorkouts.find(o => o.splitDayId === nextCycle.days[1].id).id}/prescription`);
  check("keeping another structural change does not undo confirmed permanent recovery volume", () => {
    assert.equal(nextPermanent.exercises.find(e => e.exerciseId === isolation.id).sets.length, permanentIso.sets.filter(s => s.setType === "work").length);
  });
  await writeFile(qaFile, JSON.stringify({ profileId, profileIds, splitId, newSplitId: anew.newSplitId, passed }, null, 2));
  console.log(`ALL ${passed.length} API regression checks passed. QA profile: ${profileId}; only synthetic records were used.`);
} finally { await pool.end(); }
function awaitableBaseline(value) { return { sourceSetId: value.sourceSetId, lastWeight: value.lastWeight, lastReps: value.lastReps, lastRir: value.lastRir }; }