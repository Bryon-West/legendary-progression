import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, exercisesTable, mesocycleWeeksTable, plannedWorkoutsTable, plannedPrescriptionsTable, plannedPrescriptionSetsTable, profilesTable, splitDayExercisesTable, splitDaysTable, trainingSplitsTable, workoutExercisesTable, workoutSessionsTable, workoutSetsTable } from "@workspace/db";
import { getExerciseBaseline } from "./baseline";
import { getProfileLoadIncrement } from "./progression";
import { deloadSets, equivalence, loadingSets, LOAD_NOT_CALCULATED, prescribe, snap, type PerformanceReference } from "./legendary-v22-core";

export type PrescribedExercise = {
  exerciseId: number; exerciseName: string; muscleGroup: string; isCompound: boolean;
  category: string; orderIndex: number; targetSets: number; maximumWorkingSets: number;
  loadIncrement: number; calibrationMode: boolean; baselineStatus: string; rationale: string;
  reference: PerformanceReference | null;
  sets: Array<{ setNumber: number; weight: number | null; expectedReps: number | null; rir: number; reference: PerformanceReference | null }>;
};
export type Prescription = {
  state: "generated" | "calibration" | "load_not_calculated" | "completed";
  plannedWorkoutId: number; splitId: number; weekIndex: number; kind: string;
  targetRir: number; scheduledDate: string; dayName: string;
  sessionId?: number; currentPlannedId?: number; message?: string; exercises: PrescribedExercise[];
};

export async function persistPrescription(bundle: Prescription, sourceSessionId: number | null, connection: any = db) {
  const write = async (tx: any) => {
    const [occurrence] = await tx.select().from(plannedWorkoutsTable).where(eq(plannedWorkoutsTable.id, bundle.plannedWorkoutId)).for("update");
    if (!occurrence || occurrence.status !== "scheduled") return;
    const active = await tx.select({ id: workoutSessionsTable.id }).from(workoutSessionsTable).where(eq(workoutSessionsTable.plannedWorkoutId, occurrence.id)).limit(1);
    if (active.length) return; // A started workout has its own frozen prescription.
    const [saved] = await tx.insert(plannedPrescriptionsTable).values({
      plannedWorkoutId: occurrence.id, sourceSessionId, payload: bundle as unknown as Record<string, unknown>,
    }).onConflictDoUpdate({ target: plannedPrescriptionsTable.plannedWorkoutId, set: {
      sourceSessionId, payload: bundle as unknown as Record<string, unknown>, generatedAt: new Date(),
    } }).returning();
    await tx.delete(plannedPrescriptionSetsTable).where(eq(plannedPrescriptionSetsTable.prescriptionId, saved.id));
    const rows = bundle.exercises.flatMap(e => e.sets.map(s => ({
      prescriptionId: saved.id, exerciseId: e.exerciseId, exerciseOrder: e.orderIndex,
      setNumber: s.setNumber, recommendedWeight: s.weight, expectedReps: s.expectedReps,
      prescribedRir: s.rir, reference: s.reference as unknown as Record<string, unknown> | null,
    })));
    if (rows.length) await tx.insert(plannedPrescriptionSetsTable).values(rows);
  };
  if (connection === db) await db.transaction(write); else await write(connection);
}

export async function getPrescription(plannedId: number, refresh = false): Promise<Prescription> {
  const [selected] = await db.select({ occurrence: plannedWorkoutsTable, week: mesocycleWeeksTable, split: trainingSplitsTable, day: splitDaysTable })
    .from(plannedWorkoutsTable)
    .innerJoin(mesocycleWeeksTable, eq(mesocycleWeeksTable.id, plannedWorkoutsTable.weekId))
    .innerJoin(trainingSplitsTable, eq(trainingSplitsTable.id, plannedWorkoutsTable.splitId))
    .innerJoin(splitDaysTable, eq(splitDaysTable.id, plannedWorkoutsTable.splitDayId))
    .where(eq(plannedWorkoutsTable.id, plannedId)).limit(1);
  if (!selected) throw new Error("Planned workout not found");
  const { occurrence, week, split, day } = selected;
  const [linked] = await db.select().from(workoutSessionsTable).where(eq(workoutSessionsTable.plannedWorkoutId, plannedId)).limit(1);
  const base = { plannedWorkoutId: plannedId, splitId: split.id, weekIndex: week.weekIndex, kind: week.kind, targetRir: week.targetRir, scheduledDate: occurrence.scheduledDate, dayName: day.name,
    ...(linked?.status === "active" ? { sessionId: linked.id } : {}) };
  if (linked?.status === "completed") return { ...base, state: "completed", sessionId: linked.id, exercises: [] };
  const [latest] = await db.select().from(workoutSessionsTable).where(and(
    eq(workoutSessionsTable.splitId, split.id), eq(workoutSessionsTable.splitDayId, day.id),
    eq(workoutSessionsTable.status, "completed"),
    sql`(${workoutSessionsTable.weekKindSnapshot} IS NULL OR ${workoutSessionsTable.weekKindSnapshot}='loading')`,
  )).orderBy(desc(workoutSessionsTable.mesocycleWeek), desc(workoutSessionsTable.id)).limit(1);
  const [current] = await db.select().from(plannedWorkoutsTable)
    .innerJoin(mesocycleWeeksTable, eq(mesocycleWeeksTable.id, plannedWorkoutsTable.weekId))
    .where(and(eq(plannedWorkoutsTable.splitId, split.id), eq(plannedWorkoutsTable.status, "scheduled")))
    .orderBy(asc(mesocycleWeeksTable.weekIndex), asc(plannedWorkoutsTable.scheduledDate), asc(plannedWorkoutsTable.id)).limit(1);
  const [progress] = await db.select({ latestWeek: sql<number>`coalesce(max(${workoutSessionsTable.mesocycleWeek}),0)::integer` })
    .from(workoutSessionsTable).where(and(eq(workoutSessionsTable.splitId, split.id), eq(workoutSessionsTable.status, "completed")));
  if (week.weekIndex > progress.latestWeek + 1) {
    return { ...base, state: "load_not_calculated", currentPlannedId: current?.planned_workouts.id, message: LOAD_NOT_CALCULATED, exercises: [] };
  }
  const [saved] = await db.select().from(plannedPrescriptionsTable).where(eq(plannedPrescriptionsTable.plannedWorkoutId, plannedId)).limit(1);
  if (saved && !refresh) {
    const cached = saved.payload as unknown as Prescription;
    const calibrationIds = cached.exercises.filter(e => e.calibrationMode).map(e => e.exerciseId);
    const newer = calibrationIds.length ? await db.execute(sql`SELECT 1 FROM exercise_baselines
      WHERE profile_id=${split.profileId} AND exercise_id IN (${sql.join(calibrationIds.map(n => sql`${n}`), sql`, `)})
      AND established_at>${saved.generatedAt} AND expires_at>now() LIMIT 1`) : { rows: [] };
    if (linked?.status === "active" || !newer.rows.length) return { ...cached, ...base };
  }
  const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.id, split.profileId)).limit(1);
  if (!profile) throw new Error("Profile not found");
  const weeks = await db.select().from(mesocycleWeeksTable).where(eq(mesocycleWeeksTable.splitId, split.id)).orderBy(asc(mesocycleWeeksTable.weekIndex));
  const finalLoading = weeks.filter(w => w.kind === "loading").at(-1);
  const plans = await db.select({ plan: splitDayExercisesTable, exercise: exercisesTable }).from(splitDayExercisesTable)
    .innerJoin(exercisesTable, eq(exercisesTable.id, splitDayExercisesTable.exerciseId))
    .where(eq(splitDayExercisesTable.dayId, day.id)).orderBy(asc(splitDayExercisesTable.orderIndex));
  const exercises: PrescribedExercise[] = [];
  for (const { plan, exercise } of plans) {
    const baseline = await getExerciseBaseline(split.profileId, exercise.id);
    const recentEnoughForRestart = !split.recalibrateAll || (split.recalibrateSince !== null &&
      baseline.establishedAt !== null && baseline.establishedAt >= split.recalibrateSince);
    let reference: PerformanceReference | null = baseline.status === "active" && recentEnoughForRestart &&
      baseline.lastWeight !== null && baseline.lastReps !== null && baseline.lastRir !== null
      ? { weight: baseline.lastWeight, reps: baseline.lastReps, rir: baseline.lastRir } : null;
    if (reference && baseline.sourceSessionId !== null) {
      const [sourceExercise] = await db.select().from(workoutExercisesTable).where(and(
        eq(workoutExercisesTable.sessionId, baseline.sourceSessionId), eq(workoutExercisesTable.exerciseId, exercise.id),
      )).orderBy(desc(workoutExercisesTable.id)).limit(1);
      reference.prescribedRir = sourceExercise?.targetRir ?? reference.rir;
    }
    const increment = await getProfileLoadIncrement(profile.id, exercise.id, profile.weightUnit);
    const normalWeek = week.kind === "deload" ? finalLoading?.weekIndex ?? week.weekIndex - 1 : week.weekIndex;
    const loadingOffset = weeks.filter(w => w.kind === "loading" && w.weekIndex >= plan.anchorWeek && w.weekIndex < normalWeek).length;
    const normalSets = loadingSets(plan.targetSets, loadingOffset, plan.maximumWorkingSets);
    const targetSets = week.kind === "deload" ? deloadSets(normalSets) : normalSets;
    const result = prescribe(reference, week.targetRir, increment, exercise.progressionType === "load_first" || (exercise.progressionType === null && exercise.isCompound));
    // Deload maintains the final normal reference; it never adds load.
    const weight = week.kind === "deload" && reference ? snap(reference.weight * profile.deloadLoadFraction, increment) : result.weight;
    const estimate = reference && weight !== null ? equivalence(weight, reference, week.targetRir) : null;
    const expectedReps = estimate?.expected == null ? null : Math.max(6, Math.min(30, Math.round(estimate.expected)));
    exercises.push({
      exerciseId: exercise.id, exerciseName: exercise.name, muscleGroup: exercise.muscleGroup,
      isCompound: exercise.isCompound, category: exercise.category, orderIndex: plan.orderIndex,
      targetSets, maximumWorkingSets: plan.maximumWorkingSets, loadIncrement: increment,
      calibrationMode: reference === null, baselineStatus: reference ? "active" : baseline.status === "active" ? "no_baseline" : baseline.status,
      rationale: week.kind === "deload" ? `Intentional recovery: half the final loading week's sets, rounded down, minimum one.${estimate?.warning ? ` ${estimate.warning}` : ""}` : result.rationale,
      reference,
      sets: Array.from({ length: targetSets }, (_, i) => ({
        setNumber: i + 1, weight, expectedReps, rir: week.targetRir, reference,
      })),
    });
  }
  const bundle: Prescription = { ...base, state: exercises.some(e => e.calibrationMode) ? "calibration" : "generated", exercises };
  await persistPrescription(bundle, latest?.id ?? null);
  return bundle;
}

export async function initializePrescriptions(splitId: number) {
  const [week] = await db.select().from(mesocycleWeeksTable).where(eq(mesocycleWeeksTable.splitId, splitId)).orderBy(asc(mesocycleWeeksTable.weekIndex)).limit(1);
  if (!week) return;
  const occurrences = await db.select().from(plannedWorkoutsTable).where(eq(plannedWorkoutsTable.weekId, week.id));
  for (const occurrence of occurrences) await getPrescription(occurrence.id, true);
}

export async function initializeV22Session(sessionId: number, bundle: Prescription, connection: any = db) {
  const run = async (tx: any) => {
    const [session] = await tx.select().from(workoutSessionsTable).where(eq(workoutSessionsTable.id, sessionId)).for("update");
    if (!session || session.status !== "active") throw new Error("Workout unavailable");
    const snapshot = [];
    for (const e of bundle.exercises) {
      const [created] = await tx.insert(workoutExercisesTable).values({
        sessionId, exerciseId: e.exerciseId, exerciseName: e.exerciseName, muscleGroup: e.muscleGroup,
        category: e.category as "strength", isCompound: e.isCompound, orderIndex: e.orderIndex,
        targetSets: e.targetSets, normalSetCount: e.targetSets, maximumWorkingSets: e.maximumWorkingSets,
        targetRepsMin: e.calibrationMode ? null : 6, targetRepsMax: e.calibrationMode ? null : 30,
        targetRir: bundle.targetRir, recommendedWeight: e.sets[0]?.weight ?? null,
        recommendedReps: e.sets[0]?.expectedReps ?? null,
        targetWeight: e.sets[0]?.weight ?? null,
        calibrationMode: e.calibrationMode, calibrationRir: e.calibrationMode ? bundle.targetRir : null,
        baselineStatus: e.baselineStatus as "active", recommendationOutcome: "maintain", recommendationRationale: e.rationale,
      }).returning();
      await tx.insert(workoutSetsTable).values(e.sets.map(s => ({
        workoutExerciseId: created.id, setNumber: s.setNumber, setType: "work" as const,
        targetWeight: s.weight, targetRepsMin: e.calibrationMode ? null : 6, targetRepsMax: e.calibrationMode ? null : 30,
        referenceTargetWeight: s.reference?.weight ?? null, referenceTargetReps: s.reference?.reps ?? null,
        referenceTargetRir: s.reference?.rir ?? bundle.targetRir,
        referenceTargetRepsMin: e.calibrationMode ? null : 6, referenceTargetRepsMax: e.calibrationMode ? null : 30,
        adaptiveTargetWeight: s.weight, adaptiveTargetReps: s.expectedReps, adaptiveTargetRir: bundle.targetRir,
        algorithmVersion: "legendary-v2.2",
      })));
      snapshot.push({ workoutExerciseId: created.id, exerciseId: e.exerciseId, exerciseName: e.exerciseName, orderIndex: e.orderIndex, sets: e.targetSets, maximumWorkingSets: e.maximumWorkingSets });
    }
    await tx.update(workoutSessionsTable).set({ structureSnapshot: { version: "legendary-v2.2", exercises: snapshot } }).where(eq(workoutSessionsTable.id, sessionId));
  };
  if (connection === db) await db.transaction(run); else await run(connection);
}

export async function generateNextOccurrence(sessionId: number) {
  const [source] = await db.select().from(workoutSessionsTable).where(eq(workoutSessionsTable.id, sessionId)).limit(1);
  if (!source || source.status !== "completed" || !source.splitId || !source.splitDayId || !source.mesocycleWeek) return;
  const [next] = await db.select({ occurrence: plannedWorkoutsTable }).from(plannedWorkoutsTable)
    .innerJoin(mesocycleWeeksTable, eq(mesocycleWeeksTable.id, plannedWorkoutsTable.weekId))
    .where(and(eq(plannedWorkoutsTable.splitId, source.splitId), eq(plannedWorkoutsTable.splitDayId, source.splitDayId),
      eq(plannedWorkoutsTable.status, "scheduled"), sql`${mesocycleWeeksTable.weekIndex} > ${source.mesocycleWeek}`))
    .orderBy(asc(mesocycleWeeksTable.weekIndex)).limit(1);
  if (next && source.weekKindSnapshot !== "deload") await getPrescription(next.occurrence.id, true);
  const remaining = await db.select().from(plannedWorkoutsTable).where(and(eq(plannedWorkoutsTable.splitId, source.splitId), eq(plannedWorkoutsTable.status, "scheduled"))).limit(1);
  if (!remaining.length) await db.update(trainingSplitsTable).set({ lifecycleStatus: "completed", endedAt: new Date() })
    .where(and(eq(trainingSplitsTable.id, source.splitId), sql`${trainingSplitsTable.lifecycleStatus} IN ('active','planned')`));
}

export async function invalidateFuturePrescriptions(splitId: number, connection: any = db) {
  await connection.execute(sql`DELETE FROM planned_prescriptions pp USING planned_workouts pw
    WHERE pp.planned_workout_id=pw.id AND pw.split_id=${splitId} AND pw.status='scheduled'
    AND NOT EXISTS(SELECT 1 FROM workout_sessions w WHERE w.planned_workout_id=pw.id)`);
}