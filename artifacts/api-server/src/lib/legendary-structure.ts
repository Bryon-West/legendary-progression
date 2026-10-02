import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, exerciseFeedbackTable, exercisesTable, muscleRecoveryTable, splitDayExercisesTable, trainingSplitsTable, workoutExercisesTable, workoutSessionsTable, workoutSetsTable } from "@workspace/db";
import { invalidateFuturePrescriptions } from "./legendary-prescriptions";
type OriginalExercise = { workoutExerciseId: number; exerciseId: number; exerciseName: string; orderIndex: number; sets: number; maximumWorkingSets: number };
export async function structuralState(sessionId: number, connection: any = db) {
  const [session] = await connection.select().from(workoutSessionsTable).where(eq(workoutSessionsTable.id, sessionId));
  if (!session) throw new Error("Workout not found");
  const rows: Array<typeof workoutExercisesTable.$inferSelect> = await connection.select().from(workoutExercisesTable)
    .where(eq(workoutExercisesTable.sessionId, sessionId)).orderBy(asc(workoutExercisesTable.orderIndex), asc(workoutExercisesTable.id));
  const snapshot = session.structureSnapshot as { exercises?: OriginalExercise[]; persistentRecoverySets?: Record<string, number> } | null;
  let originals = snapshot?.exercises ?? [];
  if (!snapshot?.exercises && session.splitDayId) {
    // Existing active sessions predate the new snapshot. Compare against their
    // preserved program without rewriting any historical session or set.
    const plans = await connection.select({ plan: splitDayExercisesTable, exercise: exercisesTable }).from(splitDayExercisesTable)
      .innerJoin(exercisesTable, eq(exercisesTable.id, splitDayExercisesTable.exerciseId))
      .where(eq(splitDayExercisesTable.dayId, session.splitDayId)).orderBy(asc(splitDayExercisesTable.orderIndex));
    originals = plans.flatMap(({ plan, exercise }: any) => {
      const row = rows.find(r => r.exerciseId === plan.exerciseId && r.substitutedFromExerciseId === null)
        ?? rows.find(r => r.substitutedFromExerciseId === plan.exerciseId);
      return row ? [{ workoutExerciseId: row.id, exerciseId: plan.exerciseId, exerciseName: exercise.name,
        orderIndex: plan.orderIndex, sets: row.normalSetCount ?? row.targetSets, maximumWorkingSets: plan.maximumWorkingSets }] : [];
    });
  }
  const actual = [];
  for (const e of rows.filter(r => !r.superseded)) {
    const sets: Array<typeof workoutSetsTable.$inferSelect> = await connection.select().from(workoutSetsTable).where(and(eq(workoutSetsTable.workoutExerciseId, e.id), eq(workoutSetsTable.setType, "work"), eq(workoutSetsTable.removed, false)));
    const setReduction = ["reduce_sets", "reduce_both"].includes(e.recoveryAdjustment ?? "") ? Math.max(0, (e.normalSetCount ?? e.targetSets) - e.targetSets) : 0;
    actual.push({ ...e, programSets: snapshot?.persistentRecoverySets?.[String(e.id)] ?? Math.max(1, sets.length + setReduction) });
  }
  const changes: string[] = [];
  if (snapshot || originals.length) {
    for (const original of originals) {
      const current = actual.find(e => e.id === original.workoutExerciseId);
      if (!current) {
        const replaced = actual.find(e => e.substitutedFromExerciseId === original.exerciseId);
        changes.push(replaced ? `${original.exerciseName}: replaced with ${replaced.exerciseName}` : `${original.exerciseName}: removed`);
        continue;
      }
      if (current.exerciseId !== original.exerciseId) changes.push(`${original.exerciseName}: replaced with ${current.exerciseName}`);
      if (current.programSets !== original.sets && !snapshot?.persistentRecoverySets?.[String(current.id)])
        changes.push(`${original.exerciseName}: ${original.sets} sets → ${current.programSets} sets`);
      if (current.orderIndex !== original.orderIndex) changes.push(`${original.exerciseName}: moved #${original.orderIndex + 1} → #${current.orderIndex + 1}`);
    }
    for (const current of actual) {
      if (!originals.some(e => e.workoutExerciseId === current.id) &&
        !originals.some(e => e.exerciseId === current.substitutedFromExerciseId))
        changes.push(`${current.exerciseName}: added (${current.programSets} sets)`);
    }
  }
  return { session, originals, actual, changes };
}

export async function applyAcceptedStructure(sessionId: number, decision: "keep" | "today_only", tx: any) {
  const state = await structuralState(sessionId, tx);
  if (!state.session.splitDayId || !state.session.splitId || !state.changes.length || decision !== "keep") {
    await tx.update(workoutSessionsTable).set({ structureDecision: "today_only" }).where(eq(workoutSessionsTable.id, sessionId));
    return;
  }
  // This table is future program structure, never performed workout records.
  await tx.delete(splitDayExercisesTable).where(eq(splitDayExercisesTable.dayId, state.session.splitDayId));
  if (state.actual.length) await tx.insert(splitDayExercisesTable).values(state.actual.map((e, index) => ({
    dayId: state.session.splitDayId, exerciseId: e.exerciseId, orderIndex: index,
    targetSets: e.programSets, minimumWorkingSets: 1, maximumWorkingSets: Math.max(e.maximumWorkingSets, e.programSets),
    anchorWeek: state.session.mesocycleWeek ?? 1, targetRir: state.session.targetRirSnapshot ?? e.targetRir,
    targetRepsMin: 6, targetRepsMax: 30, targetWeight: null,
  })));
  await tx.update(workoutSessionsTable).set({ structureDecision: "keep" }).where(eq(workoutSessionsTable.id, sessionId));
  await invalidateFuturePrescriptions(state.session.splitId, tx);
}

export async function workoutContext(sessionId: number) {
  const state = await structuralState(sessionId);
  const feedback = await db.select().from(exerciseFeedbackTable).where(eq(exerciseFeedbackTable.sessionId, sessionId));
  const recovery = [];
  for (const exercise of state.actual) {
    const [muscle] = await db.select().from(muscleRecoveryTable).where(and(
      eq(muscleRecoveryTable.sessionId, sessionId), eq(muscleRecoveryTable.muscleGroup, exercise.muscleGroup),
    )).limit(1);
    const recent = await db.select({ action: workoutExercisesTable.recoveryAdjustment, sessionId: workoutSessionsTable.id })
      .from(workoutExercisesTable).innerJoin(workoutSessionsTable, eq(workoutSessionsTable.id, workoutExercisesTable.sessionId))
      .where(and(eq(workoutSessionsTable.profileId, state.session.profileId), eq(workoutSessionsTable.status, "completed"),
        eq(workoutExercisesTable.exerciseId, exercise.exerciseId),
        sql`(${workoutSessionsTable.weekKindSnapshot} IS NULL OR ${workoutSessionsTable.weekKindSnapshot}='loading')`))
      .orderBy(desc(workoutSessionsTable.id)).limit(2);
    const priorFeedback = await db.select().from(exerciseFeedbackTable).where(and(
      eq(exerciseFeedbackTable.profileId, state.session.profileId), eq(exerciseFeedbackTable.primaryMuscle, exercise.muscleGroup),
      sql`${exerciseFeedbackTable.sessionId} <> ${sessionId}`,
    )).orderBy(desc(exerciseFeedbackTable.createdAt)).limit(2);
    recovery.push({
      workoutExerciseId: exercise.id, muscleGroup: exercise.muscleGroup, status: muscle?.status ?? null,
      action: exercise.recoveryAdjustment,
      repeatLimited: (recent.length === 2 && recent.every(r => r.action && r.action !== "train_as_planned")) ||
        (priorFeedback.length === 2 && priorFeedback.every(r => ["high", "too_much"].includes(r.fatigue))),
    });
  }
  return { changes: state.changes, feedback, recovery };
}