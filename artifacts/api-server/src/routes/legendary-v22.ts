import { Router } from "express";
import { and, asc, eq, sql } from "drizzle-orm";
import { AddLoadingWeekBody, AdjustExerciseRecoveryBody, GetPersonalRecordsParams, GetPersonalRecordsResponse, ReorderWorkoutExerciseBody, RemoveWorkoutExerciseBody, SaveExercisePostFeedbackBody, TransitionMesocycleBody } from "@workspace/api-zod";
import { db, exerciseFeedbackTable, exercisesTable, mesocycleWeeksTable, plannedWorkoutsTable, splitDayExercisesTable, trainingSplitsTable, workoutExercisesTable, workoutSessionsTable, workoutSetsTable } from "@workspace/db";
import { getWorkoutTree } from "../lib/hypertrophy";
import { getProfileLoadIncrement } from "../lib/progression";
import { changeLoadingWeek, transitionLifecycle } from "../lib/legendary-lifecycle";
import { getPrescription, invalidateFuturePrescriptions } from "../lib/legendary-prescriptions";
import { workoutContext } from "../lib/legendary-structure";
import { getPersonalRecords } from "../lib/personal-records";
import { recoveryLoad, recoverySets } from "../lib/legendary-v22-core";
import { isMetricDrivenExercise } from "../lib/exercise-metrics";
const router = Router();
const id = (value: unknown) => {
  const n = Number(value); if (!Number.isSafeInteger(n) || n <= 0) throw new Error("Invalid ID"); return n;
};
const handle = (work: (req: any, res: any) => Promise<void>) => async (req: any, res: any) => {
  try { await work(req, res); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Request failed" }); }
};
async function activeExercise(req: any) {
  const [record] = await db.select({
    exercise: workoutExercisesTable,
    session: workoutSessionsTable,
    exerciseCategory: exercisesTable.category,
  })
    .from(workoutExercisesTable).innerJoin(workoutSessionsTable, eq(workoutSessionsTable.id, workoutExercisesTable.sessionId))
    .innerJoin(exercisesTable, eq(exercisesTable.id, workoutExercisesTable.exerciseId))
    .where(and(eq(workoutExercisesTable.id, id(req.params.workoutExerciseId)), eq(workoutSessionsTable.id, id(req.params.sessionId)))).limit(1);
  if (!record || record.session.status !== "active" || record.exercise.superseded) throw new Error("Exercise is unavailable in an active workout");
  return record;
}
router.get("/planned-workouts/:plannedId/prescription", handle(async (req, res) => { res.json(await getPrescription(id(req.params.plannedId))); }));
router.post("/mesocycles/:splitId/lifecycle", handle(async (req, res) => { res.json(await transitionLifecycle(id(req.params.splitId), TransitionMesocycleBody.parse(req.body))); }));
router.post("/mesocycles/:splitId/weeks", handle(async (req, res) => {
  const input = AddLoadingWeekBody.parse(req.body);
  res.json(await changeLoadingWeek(id(req.params.splitId), input.targetRir, input.profileId));
}));
router.delete("/mesocycles/:splitId/loading-week", handle(async (req, res) => { res.json(await changeLoadingWeek(id(req.params.splitId))); }));
router.delete("/mesocycles/:splitId/delete-unstarted", handle(async (req, res) => {
  const splitId = id(req.params.splitId);
  await db.transaction(async tx => {
    const [split] = await tx.select().from(trainingSplitsTable).where(eq(trainingSplitsTable.id, splitId)).for("update");
    if (!split) throw new Error("Mesocycle not found");
    const history = await tx.select().from(workoutSessionsTable).where(eq(workoutSessionsTable.splitId, splitId)).limit(1);
    if (history.length) throw new Error("This mesocycle has workout data. End it early to preserve its history.");
    await tx.delete(plannedWorkoutsTable).where(eq(plannedWorkoutsTable.splitId, splitId));
    await tx.delete(trainingSplitsTable).where(eq(trainingSplitsTable.id, splitId));
  });
  res.sendStatus(204);
}));
router.get("/profiles/:profileId/records", handle(async (req, res) => {
  const params = GetPersonalRecordsParams.parse(req.params);
  const records = await getPersonalRecords(params.profileId);
  if (!records) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  res.json(GetPersonalRecordsResponse.parse(records));
}));
router.get("/workouts/:sessionId/structure-changes", handle(async (req, res) => { res.json(await workoutContext(id(req.params.sessionId))); }));
router.put("/workouts/:sessionId/exercises/:workoutExerciseId/post-feedback", handle(async (req, res) => {
  const body = SaveExercisePostFeedbackBody.parse(req.body);
  const { exercise, session, exerciseCategory } = await activeExercise(req);
  if (isMetricDrivenExercise(exerciseCategory, exercise.metricDefinitions)) {
    throw new Error("Exercise feedback is only available for resistance exercises");
  }
  const sets = await db.select().from(workoutSetsTable).where(and(eq(workoutSetsTable.workoutExerciseId, exercise.id), eq(workoutSetsTable.setType, "work"), eq(workoutSetsTable.removed, false)));
  if (!sets.length || !sets.every(s => s.completed) || exercise.skipped) throw new Error("Complete the final working set before recording feedback");
  const [feedback] = await db.insert(exerciseFeedbackTable).values({
    ...body, workoutExerciseId: exercise.id, profileId: session.profileId, sessionId: session.id,
    exerciseId: exercise.exerciseId, primaryMuscle: exercise.muscleGroup, splitId: session.splitId, weekId: session.weekId,
  }).onConflictDoUpdate({ target: exerciseFeedbackTable.workoutExerciseId, set: body }).returning();
  res.json(feedback);
}));
router.patch("/workouts/:sessionId/exercises/:workoutExerciseId/order", handle(async (req, res) => {
  const { direction } = ReorderWorkoutExerciseBody.parse(req.body);
  const { exercise, session } = await activeExercise(req);
  await db.transaction(async tx => {
    const [locked] = await tx.select().from(workoutSessionsTable).where(eq(workoutSessionsTable.id, session.id)).for("update");
    if (locked?.status !== "active") throw new Error("Workout is already complete");
    const rows = await tx.select().from(workoutExercisesTable).where(and(eq(workoutExercisesTable.sessionId, session.id), eq(workoutExercisesTable.superseded, false))).orderBy(asc(workoutExercisesTable.orderIndex), asc(workoutExercisesTable.id));
    const index = rows.findIndex(r => r.id === exercise.id), other = direction === "up" ? index - 1 : index + 1;
    if (other >= 0 && other < rows.length) [rows[index], rows[other]] = [rows[other], rows[index]];
    for (let n = 0; n < rows.length; n++) await tx.update(workoutExercisesTable).set({ orderIndex: n }).where(eq(workoutExercisesTable.id, rows[n].id));
  });
  res.json(await getWorkoutTree(session.id));
}));
router.post("/workouts/:sessionId/exercises/:workoutExerciseId/remove", handle(async (req, res) => {
  const body = RemoveWorkoutExerciseBody.parse(req.body);
  const { exercise, session } = await activeExercise(req);
  await db.transaction(async tx => {
    const [locked] = await tx.select().from(workoutSessionsTable).where(eq(workoutSessionsTable.id, session.id)).for("update");
    if (locked?.status !== "active") throw new Error("Workout is already complete");
    // Archive rather than delete: performed work keeps its original attribution.
    await tx.update(workoutExercisesTable).set({ superseded: true }).where(eq(workoutExercisesTable.id, exercise.id));
    // Future structure is changed only by the consolidated Finish decision.
    // Even an explicitly requested future removal remains pending until then.
    const remaining = await tx.select().from(workoutExercisesTable).where(and(eq(workoutExercisesTable.sessionId, session.id), eq(workoutExercisesTable.superseded, false))).orderBy(asc(workoutExercisesTable.orderIndex));
    for (let n = 0; n < remaining.length; n++) await tx.update(workoutExercisesTable).set({ orderIndex: n }).where(eq(workoutExercisesTable.id, remaining[n].id));
  });
  res.json({ ...await getWorkoutTree(session.id), futureChangePending: body.scope === "mesocycle" });
}));
router.post("/workouts/:sessionId/exercises/:workoutExerciseId/recovery", handle(async (req, res) => {
  const { action, persistentChoice } = AdjustExerciseRecoveryBody.parse(req.body);
  const { exercise, session, exerciseCategory } = await activeExercise(req);
  if (isMetricDrivenExercise(exerciseCategory, exercise.metricDefinitions)) {
    throw new Error("Recovery adjustments are only available for resistance exercises");
  }
  const increment = await getProfileLoadIncrement(session.profileId, exercise.exerciseId, (await db.execute(sql`SELECT weight_unit FROM training_profiles WHERE id=${session.profileId}`)).rows[0].weight_unit as "kg" | "lb");
  await db.transaction(async tx => {
    const [locked] = await tx.select().from(workoutSessionsTable).where(eq(workoutSessionsTable.id, session.id)).for("update");
    if (locked?.status !== "active") throw new Error("Workout is already complete");
    const rows = await tx.select().from(workoutSetsTable).where(and(eq(workoutSetsTable.workoutExerciseId, exercise.id), eq(workoutSetsTable.setType, "work"), eq(workoutSetsTable.removed, false))).orderBy(asc(workoutSetsTable.setNumber));
    if (rows.some(s => s.completed) && action !== "train_as_planned") throw new Error("Choose a recovery adjustment before completing working sets");
    if (exercise.recoveryAdjustment && !["pending", "repeat_limited", "train_as_planned"].includes(exercise.recoveryAdjustment)) throw new Error("Today's recovery adjustment has already been applied");
    const normal = rows.length;
    const reduced = action === "reduce_sets" || action === "reduce_both";
    if (reduced && normal > 1) await tx.update(workoutSetsTable).set({ removed: true }).where(eq(workoutSetsTable.id, rows.at(-1)!.id));
    const reduceLoad = action === "reduce_load" || action === "reduce_both";
    if (reduceLoad) for (const row of rows) {
      const weight = row.adaptiveTargetWeight ?? row.targetWeight;
      if (weight !== null) await tx.update(workoutSetsTable).set({
        targetWeight: recoveryLoad(weight, increment), adaptiveTargetWeight: recoveryLoad(weight, increment),
      }).where(eq(workoutSetsTable.id, row.id));
    }
    await tx.update(workoutExercisesTable).set({
      recoveryAdjustment: action, normalSetCount: normal, recoveryPriorSkipped: exercise.skipped,
      targetSets: reduced ? recoverySets(normal) : normal, skipped: action === "skip_today" ? true : exercise.skipped,
      ...(reduceLoad && exercise.recommendedWeight !== null ? { recommendedWeight: recoveryLoad(exercise.recommendedWeight, increment) } : {}),
    }).where(eq(workoutExercisesTable.id, exercise.id));
    if (persistentChoice === "reduce_working_sets" && session.splitDayId && session.splitId) {
      // This is a separate, explicit confirmed choice, not an automatic recovery rewrite.
      await tx.update(splitDayExercisesTable).set({ targetSets: recoverySets(normal), anchorWeek: session.mesocycleWeek ?? 1 })
        .where(and(eq(splitDayExercisesTable.dayId, session.splitDayId), eq(splitDayExercisesTable.exerciseId, exercise.exerciseId)));
      await invalidateFuturePrescriptions(session.splitId, tx);
      const snapshot = (locked.structureSnapshot ?? {}) as Record<string, any>;
      await tx.update(workoutSessionsTable).set({
        structureSnapshot: { ...snapshot, persistentRecoverySets: { ...snapshot.persistentRecoverySets, [String(exercise.id)]: recoverySets(normal) } },
      }).where(eq(workoutSessionsTable.id, session.id));
    }
  });
  res.json(await getWorkoutTree(session.id));
}));
export default router;