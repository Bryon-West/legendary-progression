import { Router, type IRouter } from "express";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  AddExerciseToWorkoutBody,
  AddExerciseToWorkoutParams,
  AddExerciseToWorkoutResponse,
  CreateWorkoutSetBody,
  CreateWorkoutSetParams,
  CreateWorkoutSetResponse,
  CompleteWorkoutSetBody,
  CompleteWorkoutSetParams,
  CompleteWorkoutSetResponse,
  FinishWorkoutResponse,
  FinishWorkoutBody,
  FinishWorkoutParams,
  GetActiveWorkoutQueryParams,
  GetActiveWorkoutResponse,
  GetWorkoutParams,
  GetWorkoutResponse,
  ListWorkoutCalendarHistoryQueryParams,
  ListWorkoutCalendarHistoryResponse,
  ListWorkoutsQueryParams,
  ListWorkoutsResponse,
  RemoveWorkoutSetParams,
  StartWorkoutBody,
  StartWorkoutResponse,
  SubstituteWorkoutExerciseBody,
  SubstituteWorkoutExerciseParams,
  SubstituteWorkoutExerciseResponse,
  UpdateWorkoutSetBody,
  UpdateWorkoutSetParams,
  UpdateWorkoutSetResponse,
  UpdateWorkoutExerciseBody,
  UpdateWorkoutExerciseParams,
  UpdateWorkoutExerciseResponse,
} from "@workspace/api-zod";
import {
  db,
  exercisesTable,
  profilesTable,
  muscleRecoveryTable,
  mesocycleWeeksTable,
  plannedWorkoutsTable,
  splitDayExercisesTable,
  splitDaysTable,
  trainingSplitsTable,
  workoutExercisesTable,
  workoutSessionsTable,
  workoutSetsTable,
} from "@workspace/db";
import {
  getActiveSession,
  getExerciseById,
  getNextWorkout,
  getWorkoutSummary,
  getWorkoutTree,
  listWorkoutSummaries,
} from "../lib/hypertrophy";
import {
  adaptiveRepsForWeight,
  PROGRESSION_ALGORITHM_VERSION,
  getProfileLoadIncrement,
  recommendationForExercise,
} from "../lib/progression";
import { primaryMuscleVolume } from "../lib/volume";
import { getExerciseBaseline, updateBaselinesFromCompletedSession } from "../lib/baseline";
import { getPrescription, initializeV22Session, generateNextOccurrence, type Prescription } from "../lib/legendary-prescriptions";
import { activateMesocycle } from "../lib/legendary-lifecycle";
import { applyAcceptedStructure, structuralState } from "../lib/legendary-structure";
import { getPersonalRecords } from "../lib/personal-records";
import { equivalence, performanceStatus, prescribe } from "../lib/legendary-v22-core";
import {
  canEditSet,
  calibrationTargets,
  classifySetAtReference,
  recommendationAfterCompletedWork,
  sequentialSetStates,
  type CompletedWorkAnchor,
  type SetTargetReference,
} from "../lib/workout-core";
import {
  isLegacyResistanceMetricModel,
  isMetricDrivenExercise,
  normalizeMetricValues,
  normalizedMetricValuesAreComplete,
  type MetricDefinition,
} from "../lib/exercise-metrics";

const router: IRouter = Router();

function assessSet(input: {
  reps: number;
  rir: number;
  actualWeight: number;
  reference: SetTargetReference;
  prescribedRir?: number;
}) {
  if (input.reference.repsMin === 6 && input.reference.repsMax === 30) {
    const result = performanceStatus({ weight: input.actualWeight, reps: input.reps, rir: input.rir },
      input.reference.weight !== null && input.reference.reps !== null
        ? { weight: input.reference.weight, reps: input.reference.reps, rir: input.reference.rir } : null,
      input.prescribedRir ?? input.reference.rir);
    return result.status ? { status: result.status, explanation: result.explanation! } : null;
  }
  const status = classifySetAtReference({
    actualWeight: input.actualWeight,
    actualReps: input.reps,
    actualRir: input.rir,
    reference: input.reference,
  });
  if (status === null) return null;
  const result = status === "target_met" ? "Target met" :
    status === "above_target" ? "Above target" : "Below target";
  return {
    status,
    explanation: `${result}. Target: ${input.reference.repsMin}-${input.reference.repsMax} reps around ${input.reference.rir} RIR; reference ${input.reference.weight} × ${input.reference.reps}. Completed: ${input.actualWeight} × ${input.reps} @ ${input.rir} RIR.`,
  };
}

async function recalculatePendingSetTargets(
  tx: any,
  exercise: typeof workoutExercisesTable.$inferSelect,
  options: { loadIncrement: number; allowIncrease: boolean },
) {
  const targetRir = exercise.targetRir;
  if (targetRir === null) return;
  const rows = await tx.select().from(workoutSetsTable)
    .where(eq(workoutSetsTable.workoutExerciseId, exercise.id));
  const calibrationMode = exercise.calibrationMode ||
    exercise.targetRepsMin === null || exercise.targetRepsMax === null;
  const baseline: SetTargetReference = {
    weight: calibrationMode ? null : exercise.recommendedWeight ?? exercise.targetWeight,
    reps: calibrationMode ? null : exercise.recommendedReps ?? exercise.targetRepsMin,
    rir: targetRir,
    repsMin: calibrationMode ? null : exercise.targetRepsMin,
    repsMax: calibrationMode ? null : exercise.targetRepsMax,
  };
  const latest = rows.filter((row: typeof workoutSetsTable.$inferSelect) =>
    row.setType === "work" && row.completed && !row.removed &&
    row.actualWeight !== null && row.actualReps !== null && row.actualRir !== null,
  ).sort((a: typeof workoutSetsTable.$inferSelect, b: typeof workoutSetsTable.$inferSelect) =>
    b.setNumber - a.setNumber || b.id - a.id,
  )[0];
  const anchor: CompletedWorkAnchor | null = latest ? {
    actualWeight: latest.actualWeight,
    actualReps: latest.actualReps,
    actualRir: latest.actualRir,
    targetStatus: latest.targetStatus,
    reference: {
      weight: latest.referenceTargetWeight,
      reps: latest.referenceTargetReps,
      rir: latest.referenceTargetRir ?? targetRir,
      repsMin: latest.referenceTargetRepsMin,
      repsMax: latest.referenceTargetRepsMax,
    },
  } : null;
  if (!calibrationMode && baseline.repsMin === 6 && baseline.repsMax === 30) {
    // V2.3B freezes the set-specific prescription within the active workout.
    // Evaluate each completed set against its own stored reference; only the
    // next planned exposure may derive a new prescription from completed work.
    const v23bRows = rows.filter((r: typeof workoutSetsTable.$inferSelect) => r.setType === "work");
    if (v23bRows.some((r: typeof workoutSetsTable.$inferSelect) => r.algorithmVersion === "legendary-v2.3b")) return;
    const source = latest ?? rows.find((r: typeof workoutSetsTable.$inferSelect) => r.setType === "work" && !r.removed);
    const reference = latest && latest.actualWeight !== null && latest.actualReps !== null && latest.actualRir !== null
      ? { weight: latest.actualWeight, reps: latest.actualReps, rir: latest.actualRir, prescribedRir: targetRir }
      : source?.referenceTargetWeight != null && source?.referenceTargetReps != null
        ? { weight: source.referenceTargetWeight, reps: source.referenceTargetReps, rir: source.referenceTargetRir ?? targetRir } : null;
    const held = reference && latest ? prescribe(reference, targetRir, options.loadIncrement, exercise.isCompound, true) : null;
    for (const row of rows.filter((r: typeof workoutSetsTable.$inferSelect) => r.setType === "work" && !r.completed && !r.removed)) {
      const userOverride = row.targetWeight !== exercise.recommendedWeight ? row.targetWeight : null;
      const selectedWeight = row.actualWeight ?? userOverride ?? held?.weight ?? row.adaptiveTargetWeight ?? row.targetWeight;
      const estimate = reference && selectedWeight !== null ? equivalence(selectedWeight, reference, targetRir) : null;
      await tx.update(workoutSetsTable).set({
        referenceTargetWeight: reference?.weight ?? null, referenceTargetReps: reference?.reps ?? null,
        referenceTargetRir: reference?.rir ?? targetRir, referenceTargetRepsMin: 6, referenceTargetRepsMax: 30,
        targetRepsMin: 6, targetRepsMax: 30, targetWeight: selectedWeight, adaptiveTargetWeight: selectedWeight,
        adaptiveTargetReps: estimate?.expected == null ? null : Math.max(6, Math.min(30, Math.round(estimate.expected))),
        adaptiveTargetRir: targetRir, targetStatus: null, targetExplanation: estimate?.warning ?? null,
        algorithmVersion: PROGRESSION_ALGORITHM_VERSION,
      }).where(eq(workoutSetsTable.id, row.id));
    }
    return;
  }
  let recommendation = recommendationAfterCompletedWork({
    calibrationMode,
    allowIncrease: options.allowIncrease,
    baseline,
    anchor,
    loadIncrement: options.loadIncrement,
  });
  if (!calibrationMode && baseline.repsMin === 6 && baseline.repsMax === 30 && anchor &&
    anchor.actualWeight !== null && anchor.actualReps !== null && anchor.actualRir !== null) {
    const next = prescribe({ weight: anchor.actualWeight, reps: anchor.actualReps, rir: anchor.actualRir, prescribedRir: targetRir },
      targetRir, options.loadIncrement, exercise.isCompound, true);
    recommendation = { weight: next.weight, reps: next.reps, rir: targetRir, repsMin: 6, repsMax: 30 };
  }
  const pending = rows.filter((row: typeof workoutSetsTable.$inferSelect) =>
    row.setType === "work" && !row.completed && !row.removed,
  );
  for (const row of pending) {
    const prescriptionOverride = row.targetWeight !== row.referenceTargetWeight
      ? row.targetWeight
      : null;
    const selectedWeight = row.actualWeight ?? prescriptionOverride ?? recommendation.weight;
    const adaptive = calibrationMode || recommendation.weight === null ||
      recommendation.reps === null || recommendation.repsMin === null || recommendation.repsMax === null
      ? { reps: null, warning: null }
      : adaptiveRepsForWeight(
          selectedWeight,
          recommendation.weight,
          recommendation.reps,
          recommendation.repsMin,
          recommendation.repsMax,
          recommendation.rir,
        );
    await tx.update(workoutSetsTable).set({
      referenceTargetWeight: recommendation.weight,
      referenceTargetReps: recommendation.reps,
      referenceTargetRir: recommendation.rir,
      referenceTargetRepsMin: recommendation.repsMin,
      referenceTargetRepsMax: recommendation.repsMax,
      targetRepsMin: recommendation.repsMin,
      targetRepsMax: recommendation.repsMax,
      targetWeight: prescriptionOverride === null ? recommendation.weight : row.targetWeight,
      adaptiveTargetWeight: calibrationMode ? null : selectedWeight,
      adaptiveTargetReps: adaptive.reps,
      adaptiveTargetRir: recommendation.rir,
      targetStatus: null,
      targetExplanation: adaptive.warning,
      algorithmVersion: calibrationMode ? null : PROGRESSION_ALGORITHM_VERSION,
    }).where(eq(workoutSetsTable.id, row.id));
  }
}

async function allowAutomaticIncrease(tx: any, sessionId: number, exercise: typeof workoutExercisesTable.$inferSelect, readiness: string | null) {
  if (exercise.painReported || readiness === "poor" || readiness === "below_normal") return false;
  const [recovery] = await tx.select({ status: muscleRecoveryTable.status })
    .from(muscleRecoveryTable)
    .where(and(
      eq(muscleRecoveryTable.sessionId, sessionId),
      eq(muscleRecoveryTable.muscleGroup, exercise.muscleGroup),
    )).limit(1);
  return recovery?.status !== "still_sore" && recovery?.status !== "very_sore";
}

async function addPlannedWorkingSets(exercise: {
  id: number;
  targetSets: number;
  category?: string;
  metricDefinitions?: unknown;
  targetWeight: number | null;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  trainingMode?: "basic" | "legendary_pro";
  calibrationMode?: boolean;
  recommendedWeight?: number | null;
  recommendedReps?: number | null;
  targetRir?: number | null;
}) {
  const basic = exercise.trainingMode === "basic";
  const metricDriven = isMetricDrivenExercise(
    exercise.category ?? "",
    exercise.metricDefinitions,
  );
  const values = Array.from({ length: exercise.targetSets }, (_, index) => ({
    workoutExerciseId: exercise.id,
    setNumber: index + 1,
    setType: "work" as const,
    targetWeight: metricDriven || exercise.calibrationMode ? null : exercise.recommendedWeight ?? exercise.targetWeight,
    targetRepsMin: metricDriven || exercise.calibrationMode ? null : exercise.targetRepsMin,
    targetRepsMax: metricDriven || exercise.calibrationMode ? null : exercise.targetRepsMax,
    referenceTargetWeight: basic || metricDriven || exercise.calibrationMode
      ? null
      : exercise.recommendedWeight ?? exercise.targetWeight,
    referenceTargetReps: basic || metricDriven || exercise.calibrationMode
      ? null
      : exercise.recommendedReps ?? exercise.targetRepsMin,
    referenceTargetRir: basic || metricDriven ? null : exercise.targetRir ?? 3,
    referenceTargetRepsMin: basic || metricDriven || exercise.calibrationMode ? null : exercise.targetRepsMin,
    referenceTargetRepsMax: basic || metricDriven || exercise.calibrationMode ? null : exercise.targetRepsMax,
    adaptiveTargetWeight: basic || metricDriven || exercise.calibrationMode ? null : exercise.recommendedWeight ?? exercise.targetWeight,
    adaptiveTargetReps: basic || metricDriven || exercise.calibrationMode
      ? null
      : exercise.recommendedReps ?? exercise.targetRepsMin,
    adaptiveTargetRir: basic || metricDriven ? null : exercise.targetRir ?? 2,
    algorithmVersion: basic || metricDriven ? null : PROGRESSION_ALGORITHM_VERSION,
  }));
  if (values.length) await db.insert(workoutSetsTable).values(values);
}

async function currentProgramSnapshot(splitId: number) {
  const days = await db.select().from(splitDaysTable)
    .where(and(
      eq(splitDaysTable.splitId, splitId),
      eq(splitDaysTable.isArchived, false),
    )).orderBy(asc(splitDaysTable.dayIndex));
  const result = [];
  for (const day of days) {
    const prescriptions = await db.select().from(splitDayExercisesTable)
      .where(eq(splitDayExercisesTable.dayId, day.id))
      .orderBy(asc(splitDayExercisesTable.orderIndex));
    result.push({
      dayIndex: day.dayIndex,
      name: day.name,
      exercises: prescriptions.map((item) => ({
        exerciseId: item.exerciseId,
        orderIndex: item.orderIndex,
        targetSets: item.targetSets,
        minimumWorkingSets: item.minimumWorkingSets,
        maximumWorkingSets: item.maximumWorkingSets,
        targetRepsMin: item.targetRepsMin,
        targetRepsMax: item.targetRepsMax,
        targetRir: item.targetRir,
        targetWeight: item.targetWeight,
      })),
    });
  }
  return { version: 1, days: result };
}

router.get("/workouts", async (req, res): Promise<void> => {
  const parsed = ListWorkoutsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.json(ListWorkoutsResponse.parse(await listWorkoutSummaries(parsed.data.profileId)));
});

router.get("/workouts/calendar-history", async (req, res): Promise<void> => {
  const parsed = ListWorkoutCalendarHistoryQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const sessions = await db
    .select({
      id: workoutSessionsTable.id,
      dayName: workoutSessionsTable.dayName,
      startedAt: workoutSessionsTable.startedAt,
    })
    .from(workoutSessionsTable)
    .where(and(
      eq(workoutSessionsTable.profileId, parsed.data.profileId),
      eq(workoutSessionsTable.status, "completed"),
    ))
    .orderBy(asc(workoutSessionsTable.startedAt), asc(workoutSessionsTable.id));
  res.json(ListWorkoutCalendarHistoryResponse.parse(sessions));
});

router.get("/workouts/active", async (req, res): Promise<void> => {
  const parsed = GetActiveWorkoutQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.json(
    GetActiveWorkoutResponse.parse({
      workout: await getActiveSession(parsed.data.profileId),
    }),
  );
});

router.post("/workouts/start", async (req, res): Promise<void> => {
  const parsed = StartWorkoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await getActiveSession(parsed.data.profileId);
  if (existing) {
    res.status(201).json(StartWorkoutResponse.parse(existing));
    return;
  }

  let selectedDayId = parsed.data.splitDayId ?? null;
  let selectedSplitId: number | null = null;
  let plannedWorkoutId = parsed.data.scheduledWorkoutId ?? null;
  let selectedWeek: typeof mesocycleWeeksTable.$inferSelect | null = null;
  if (plannedWorkoutId !== null) {
    const [selected] = await db.select({
      occurrence: plannedWorkoutsTable,
      week: mesocycleWeeksTable,
      split: trainingSplitsTable,
    }).from(plannedWorkoutsTable)
      .innerJoin(mesocycleWeeksTable, eq(plannedWorkoutsTable.weekId, mesocycleWeeksTable.id))
      .innerJoin(trainingSplitsTable, eq(plannedWorkoutsTable.splitId, trainingSplitsTable.id))
      .where(eq(plannedWorkoutsTable.id, plannedWorkoutId))
      .limit(1);
    if (!selected || selected.split.profileId !== parsed.data.profileId) {
      res.status(404).json({ error: "Planned workout not found for this profile" });
      return;
    }
    if (selected.occurrence.status !== "scheduled" || selected.week.kind === "week_off") {
      res.status(409).json({ error: "This planned workout is not available to start" });
      return;
    }
    if (parsed.data.splitDayId !== undefined &&
      parsed.data.splitDayId !== selected.occurrence.splitDayId) {
      res.status(400).json({ error: "The selected workout day does not match the planned occurrence" });
      return;
    }
    selectedDayId = selected.occurrence.splitDayId;
    selectedSplitId = selected.split.id;
    selectedWeek = selected.week;
  }
  if (selectedDayId !== null && selectedSplitId === null) {
    const [selected] = await db
      .select({ day: splitDaysTable, split: trainingSplitsTable })
      .from(splitDaysTable)
      .innerJoin(
        trainingSplitsTable,
        eq(splitDaysTable.splitId, trainingSplitsTable.id),
      )
      .where(and(
        eq(splitDaysTable.id, selectedDayId),
        eq(splitDaysTable.isArchived, false),
      ))
      .limit(1);
    if (!selected || selected.split.profileId !== parsed.data.profileId) {
      res.status(404).json({ error: "Workout day not found for this profile" });
      return;
    }
    selectedSplitId = selected.split.id;
  } else if (selectedDayId === null) {
    const next = await getNextWorkout(parsed.data.profileId);
    selectedDayId = next?.dayId ?? null;
    selectedSplitId = next?.splitId ?? null;
    plannedWorkoutId = next?.plannedWorkoutId ?? null;
    if (plannedWorkoutId !== null) {
      const [planned] = await db.select({
        occurrence: plannedWorkoutsTable,
        week: mesocycleWeeksTable,
      }).from(plannedWorkoutsTable)
        .innerJoin(mesocycleWeeksTable, eq(plannedWorkoutsTable.weekId, mesocycleWeeksTable.id))
        .where(eq(plannedWorkoutsTable.id, plannedWorkoutId)).limit(1);
      selectedWeek = planned?.week ?? null;
    }
  }

  if (selectedSplitId === null && selectedDayId === null) {
    const [foundProfile] = await db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.id, parsed.data.profileId))
      .limit(1);
    if (!foundProfile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }
  }

  const [split] = selectedSplitId
    ? await db
        .select()
        .from(trainingSplitsTable)
        .where(eq(trainingSplitsTable.id, selectedSplitId))
        .limit(1)
    : [];
  const [day] = selectedDayId
    ? await db
        .select()
        .from(splitDaysTable)
        .where(eq(splitDaysTable.id, selectedDayId))
        .limit(1)
    : [];
  const [profile] = await db.select().from(profilesTable)
    .where(eq(profilesTable.id, parsed.data.profileId)).limit(1);
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  const currentWeeklySetRows = profile.trainingMode === "legendary_pro" && selectedWeek
    ? await db
    .select({ muscleGroup: workoutExercisesTable.muscleGroup })
    .from(workoutSetsTable)
    .innerJoin(workoutExercisesTable, eq(workoutSetsTable.workoutExerciseId, workoutExercisesTable.id))
    .innerJoin(workoutSessionsTable, eq(workoutExercisesTable.sessionId, workoutSessionsTable.id))
    .where(and(
      eq(workoutSessionsTable.profileId, parsed.data.profileId),
      eq(workoutSetsTable.setType, "work"),
      eq(workoutSetsTable.completed, true),
      eq(workoutSetsTable.removed, false),
      eq(workoutExercisesTable.skipped, false),
      eq(workoutSessionsTable.weekId, selectedWeek.id),
      eq(workoutSessionsTable.weekKindSnapshot, "loading"),
      sql`${workoutSetsTable.actualReps} > 0`,
    ))
    : [];
  const weeklyMuscleSets = new Map<string, number>();
  for (const row of currentWeeklySetRows) {
    weeklyMuscleSets.set(row.muscleGroup, (weeklyMuscleSets.get(row.muscleGroup) ?? 0) + 1);
  }
  const weekKind = profile.trainingMode === "legendary_pro" ? selectedWeek?.kind ?? null : null;
  const weekTargetRir = profile.trainingMode === "legendary_pro" ? selectedWeek?.targetRir ?? null : null;
  const frozenSnapshot = profile.trainingMode === "basic"
    ? split ? await currentProgramSnapshot(split.id) : null
    : selectedWeek && split &&
    (selectedWeek.status === "future" || selectedWeek.programSnapshot === null)
    ? await currentProgramSnapshot(split.id)
    : selectedWeek?.programSnapshot ?? null;
  let v22Bundle: Prescription | null = null;
  if (plannedWorkoutId !== null && profile.trainingMode === "legendary_pro") {
    try {
      v22Bundle = await getPrescription(plannedWorkoutId);
      if (v22Bundle.state === "load_not_calculated") {
        res.status(409).json({ error: v22Bundle.message, ...v22Bundle }); return;
      }
      if (split && !["active", "planned"].includes(split.lifecycleStatus)) {
        res.status(409).json({ error: "Resume this mesocycle before starting a workout." }); return;
      }
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Unable to prepare prescription" }); return; }
  }
  let session: typeof workoutSessionsTable.$inferSelect;
  try {
    session = await db.transaction(async (tx) => {
      const [lockedProfile] = await tx.select({ trainingMode: profilesTable.trainingMode })
        .from(profilesTable)
        .where(eq(profilesTable.id, parsed.data.profileId))
        .for("update")
        .limit(1);
      if (!lockedProfile || lockedProfile.trainingMode !== profile.trainingMode) {
        throw new Error("Training mode changed while starting. Please retry.");
      }
      if (split && v22Bundle) await activateMesocycle(split.id, tx);
      if (profile.trainingMode === "legendary_pro" && selectedWeek && split && frozenSnapshot) {
        await tx.update(mesocycleWeeksTable).set({
          ...(selectedWeek.status === "future" ? { status: "in_progress" as const } : {}),
          programSnapshot: frozenSnapshot,
        }).where(and(
          eq(mesocycleWeeksTable.id, selectedWeek.id),
        ));
      } else if (profile.trainingMode === "legendary_pro" && selectedWeek && selectedWeek.status === "future") {
        await tx.update(mesocycleWeeksTable).set({ status: "in_progress" })
          .where(and(
            eq(mesocycleWeeksTable.id, selectedWeek.id),
            eq(mesocycleWeeksTable.status, "future"),
          ));
      }
      const [created] = await tx.insert(workoutSessionsTable)
        .values({
          profileId: parsed.data.profileId,
          splitId: split?.id ?? null,
          splitDayId: day?.id ?? null,
          splitName: split?.name ?? null,
          dayName: day?.name ?? null,
          readiness: profile.trainingMode === "legendary_pro" ? parsed.data.readiness ?? null : null,
          mesocycleStartDate: profile.trainingMode === "legendary_pro" ? split?.startDate ?? null : null,
          mesocycleWeek: profile.trainingMode === "legendary_pro" ? selectedWeek?.weekIndex ?? null : null,
          weekId: profile.trainingMode === "legendary_pro" ? selectedWeek?.id ?? null : null,
          plannedWorkoutId,
          weekKindSnapshot: profile.trainingMode === "legendary_pro" ? weekKind : null,
          targetRirSnapshot: profile.trainingMode === "legendary_pro" ? weekTargetRir : null,
          recoveryMode: profile.trainingMode === "legendary_pro" && weekKind === "deload" ? "deload" : null,
          trainingMode: profile.trainingMode,
        }).returning();
      if (v22Bundle) await initializeV22Session(created.id, v22Bundle, tx);
      return created;
    });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Unable to start workout" });
    return;
  }
  if (profile.trainingMode === "legendary_pro" && parsed.data.muscleRecovery?.length) {
    await db.insert(muscleRecoveryTable).values(parsed.data.muscleRecovery.map((item) => ({
      sessionId: session.id,
      muscleGroup: item.muscleGroup.trim(),
      status: item.status,
    })));
  }

  if (day && !v22Bundle) {
    const snapshot = frozenSnapshot as {
      days?: Array<{
        dayIndex: number;
        name: string;
        exercises: Array<{
          exerciseId: number;
          orderIndex: number;
          targetSets: number;
          minimumWorkingSets: number;
          maximumWorkingSets: number;
          targetRepsMin: number;
          targetRepsMax: number;
          targetRir: number;
          targetWeight: number | null;
        }>;
      }>;
    } | null;
    const snapshotDay = snapshot?.days?.find((candidate) => candidate.dayIndex === day.dayIndex);
    const snapshotDayName = profile.trainingMode === "legendary_pro" ? snapshotDay?.name ?? day.name : day.name;
    await db.update(workoutSessionsTable).set({ dayName: snapshotDayName })
      .where(eq(workoutSessionsTable.id, session.id));
    const prescriptions = profile.trainingMode === "basic"
      ? await db.select().from(splitDayExercisesTable)
        .where(eq(splitDayExercisesTable.dayId, day.id))
        .orderBy(asc(splitDayExercisesTable.orderIndex))
      : snapshotDay
      ? snapshotDay.exercises
      : await db.select().from(splitDayExercisesTable)
        .where(eq(splitDayExercisesTable.dayId, day.id))
        .orderBy(asc(splitDayExercisesTable.orderIndex));
    const sessionExercises = [];
    const addedSetMuscles = new Set<string>();
    for (const prescription of prescriptions) {
      const [exercise] = await db
        .select()
        .from(exercisesTable)
        .where(eq(exercisesTable.id, prescription.exerciseId))
        .limit(1);
      if (exercise) {
        if (profile.trainingMode === "basic") {
          const metricDriven = isMetricDrivenExercise(
            exercise.category,
            exercise.metricDefinitions,
          );
          sessionExercises.push({
            sessionId: session.id,
            exerciseId: exercise.id,
            exerciseName: exercise.name,
            muscleGroup: exercise.muscleGroup,
            targetRir: null,
            targetSets: prescription.targetSets,
            minimumWorkingSets: prescription.minimumWorkingSets,
            maximumWorkingSets: prescription.maximumWorkingSets,
            targetRepsMin: metricDriven ? null : prescription.targetRepsMin,
            targetRepsMax: metricDriven ? null : prescription.targetRepsMax,
            targetWeight: metricDriven ? null : prescription.targetWeight,
            orderIndex: prescription.orderIndex,
            category: exercise.category,
            metricDefinitions: exercise.metricDefinitions ?? null,
            isCompound: exercise.isCompound,
            recommendedWeight: null,
            recommendedReps: null,
            recommendationOutcome: null,
            recommendationRationale: null,
            calibrationMode: false,
            calibrationRir: null,
            baselineStatus: null,
          });
          continue;
        }
        if (isMetricDrivenExercise(exercise.category, exercise.metricDefinitions)) {
          sessionExercises.push({
            sessionId: session.id,
            exerciseId: exercise.id,
            exerciseName: exercise.name,
            muscleGroup: exercise.muscleGroup,
            targetRir: null,
            targetSets: prescription.targetSets,
            minimumWorkingSets: prescription.minimumWorkingSets,
            maximumWorkingSets: prescription.maximumWorkingSets,
            targetRepsMin: null,
            targetRepsMax: null,
            targetWeight: null,
            orderIndex: prescription.orderIndex,
            category: exercise.category,
            metricDefinitions: exercise.metricDefinitions,
            isCompound: exercise.isCompound,
            recommendedWeight: null,
            recommendedReps: null,
            recommendationOutcome: null,
            recommendationRationale: null,
            calibrationMode: false,
            calibrationRir: null,
            baselineStatus: null,
          });
          continue;
        }
        const baseline = await getExerciseBaseline(parsed.data.profileId, exercise.id);
        const calibrationMode = baseline.status !== "active";
        const deload = weekKind === "deload";
        const calibration = calibrationMode ? calibrationTargets() : null;
        const targetRir = calibration?.targetRir ?? (deload
          ? profile.deloadRir
          : weekTargetRir ?? prescription.targetRir);
        const loadIncrement = await getProfileLoadIncrement(profile.id, exercise.id, profile.weightUnit);
        const recommendation = calibrationMode ? {
          recommendedWeight: null,
          recommendedReps: null,
          targetSets: prescription.targetSets,
          outcome: "maintain" as const,
          rationale: "First working exposure is calibration; choose a load near 3 RIR.",
        } : await recommendationForExercise(
          parsed.data.profileId,
          exercise.id,
          {
            category: exercise.category,
            equipment: exercise.equipment,
            isCompound: exercise.isCompound,
            targetSets: prescription.targetSets,
            minimumWorkingSets: prescription.minimumWorkingSets,
            maximumWorkingSets: prescription.maximumWorkingSets,
            muscleGroup: exercise.muscleGroup,
            targetRepsMin: prescription.targetRepsMin,
            targetRepsMax: prescription.targetRepsMax,
            targetRir,
            targetWeight: prescription.targetWeight,
          },
          weeklyMuscleSets.get(exercise.muscleGroup) ?? 0,
          false,
          loadIncrement,
        );
        let targetSets = recommendation.targetSets;
        if (deload) {
          targetSets = Math.max(1, Math.round(prescription.targetSets * profile.deloadSetFraction));
        }
        if (recommendation.outcome === "increase_sets") {
          if (addedSetMuscles.has(exercise.muscleGroup)) {
            recommendation.outcome = "maintain";
            recommendation.targetSets = prescription.targetSets;
            targetSets = prescription.targetSets;
            recommendation.rationale = "Only one exercise per primary muscle can receive a volume increase in a workout.";
          } else {
            addedSetMuscles.add(exercise.muscleGroup);
          }
        }
        let recommendedWeight = recommendation.recommendedWeight;
        if (deload && recommendedWeight !== null) {
          recommendedWeight = Math.round(
            recommendedWeight * profile.deloadLoadFraction / loadIncrement,
          ) * loadIncrement;
        }
        sessionExercises.push({
          sessionId: session.id,
          exerciseId: exercise.id,
          exerciseName: exercise.name,
          muscleGroup: exercise.muscleGroup,
          targetRir,
          targetSets,
          minimumWorkingSets: prescription.minimumWorkingSets,
          maximumWorkingSets: prescription.maximumWorkingSets,
          targetRepsMin: calibrationMode ? null : prescription.targetRepsMin,
          targetRepsMax: calibrationMode ? null : prescription.targetRepsMax,
          targetWeight: calibrationMode ? null : prescription.targetWeight,
          orderIndex: prescription.orderIndex,
          category: exercise.category,
          metricDefinitions: exercise.metricDefinitions ?? null,
          isCompound: exercise.isCompound,
          recommendedWeight,
          recommendedReps: recommendation.recommendedReps,
          recommendationOutcome: recommendation.outcome,
          recommendationRationale: recommendation.rationale,
          calibrationMode,
          calibrationRir: calibrationMode ? 3 : null,
          baselineStatus: baseline.status,
        });
      }
    }
    if (sessionExercises.length) {
      const createdExercises = await db
        .insert(workoutExercisesTable)
        .values(sessionExercises)
        .returning();
      for (const exercise of createdExercises) {
        await addPlannedWorkingSets({ ...exercise, trainingMode: profile.trainingMode });
      }
    }
  }
  const workout = await getWorkoutTree(session.id);
  if (!workout) {
    res.status(500).json({ error: "Could not create workout" });
    return;
  }
  res.status(201).json(StartWorkoutResponse.parse(workout));
});

router.get("/workouts/:sessionId", async (req, res): Promise<void> => {
  const params = GetWorkoutParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const workout = await getWorkoutTree(params.data.sessionId, true);
  if (!workout) {
    res.status(404).json({ error: "Workout not found" });
    return;
  }
  res.json(GetWorkoutResponse.parse(workout));
});

router.post(
  "/workouts/:sessionId/exercises",
  async (req, res): Promise<void> => {
    const params = AddExerciseToWorkoutParams.safeParse(req.params);
    const body = AddExerciseToWorkoutBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success ? params.error.message : !body.success ? body.error.message : "Invalid request",
      });
      return;
    }
    const [session] = await db
      .select()
      .from(workoutSessionsTable)
      .where(eq(workoutSessionsTable.id, params.data.sessionId))
      .limit(1);
    if (!session) {
      res.status(404).json({ error: "Workout not found" });
      return;
    }
    if (session.status !== "active") {
      res.status(409).json({ error: "Workout is already complete" });
      return;
    }
    const exercise = await getExerciseById(body.data.exerciseId);
    if (!exercise || (exercise.profileId !== null && exercise.profileId !== session.profileId)) {
      res.status(404).json({ error: "Exercise not found for this profile" });
      return;
    }
    const [profile] = await db.select().from(profilesTable)
      .where(eq(profilesTable.id, session.profileId)).limit(1);
    const [week] = session.weekId
      ? await db.select().from(mesocycleWeeksTable).where(eq(mesocycleWeeksTable.id, session.weekId)).limit(1)
      : [];
    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }
    let created: typeof workoutExercisesTable.$inferSelect;
    if (session.trainingMode === "basic") {
      const metricDriven = isMetricDrivenExercise(
        exercise.category,
        exercise.metricDefinitions,
      );
      [created] = await db.insert(workoutExercisesTable)
        .values({
          sessionId: session.id,
          exerciseId: exercise.id,
          exerciseName: exercise.name,
          muscleGroup: exercise.muscleGroup,
          targetRir: null,
          targetSets: body.data.targetSets,
          minimumWorkingSets: body.data.minimumWorkingSets ?? 1,
          maximumWorkingSets: body.data.maximumWorkingSets ?? 5,
          targetRepsMin: metricDriven ? null : body.data.targetRepsMin ?? exercise.defaultRepMin,
          targetRepsMax: metricDriven ? null : body.data.targetRepsMax ?? exercise.defaultRepMax,
          targetWeight: metricDriven ? null : body.data.targetWeight ?? null,
          orderIndex: body.data.orderIndex,
          category: exercise.category,
          metricDefinitions: exercise.metricDefinitions ?? null,
          isCompound: exercise.isCompound,
          recommendedWeight: null,
          recommendedReps: null,
          recommendationOutcome: null,
          recommendationRationale: null,
          calibrationMode: false,
          calibrationRir: null,
          baselineStatus: null,
        })
        .returning();
    } else if (isMetricDrivenExercise(exercise.category, exercise.metricDefinitions)) {
      [created] = await db.insert(workoutExercisesTable)
        .values({
          ...body.data,
          sessionId: session.id,
          exerciseName: exercise.name,
          muscleGroup: exercise.muscleGroup,
          targetRir: null,
          minimumWorkingSets: body.data.minimumWorkingSets ?? 1,
          maximumWorkingSets: body.data.maximumWorkingSets ?? 5,
          targetRepsMin: null,
          targetRepsMax: null,
          targetWeight: null,
          category: exercise.category,
          metricDefinitions: exercise.metricDefinitions,
          isCompound: exercise.isCompound,
          recommendedWeight: null,
          recommendedReps: null,
          recommendationOutcome: null,
          recommendationRationale: null,
          calibrationMode: false,
          calibrationRir: null,
          baselineStatus: null,
        })
        .returning();
    } else {
      const baseline = await getExerciseBaseline(session.profileId, exercise.id);
      const calibrationMode = baseline.status !== "active";
      const targetRir = body.data.targetRir ?? week?.targetRir ?? session.targetRirSnapshot ?? 3;
      const recommendation = calibrationMode ? {
        recommendedWeight: null,
        recommendedReps: null,
        targetSets: body.data.targetSets,
        outcome: "maintain" as const,
        rationale: `First working exposure is calibration; choose a load near ${targetRir} RIR.`,
      } : await recommendationForExercise(
        session.profileId,
        exercise.id,
        {
          category: exercise.category,
          equipment: exercise.equipment,
          isCompound: exercise.isCompound,
          muscleGroup: exercise.muscleGroup,
          targetSets: body.data.targetSets,
          minimumWorkingSets: body.data.minimumWorkingSets ?? 1,
          maximumWorkingSets: body.data.maximumWorkingSets ?? 5,
          targetRepsMin: 6,
          targetRepsMax: 30,
          targetRir,
          targetWeight: body.data.targetWeight ?? null,
        },
        0,
        false,
        await getProfileLoadIncrement(profile.id, exercise.id, profile.weightUnit),
      );
      [created] = await db.insert(workoutExercisesTable)
        .values({
          ...body.data,
          sessionId: session.id,
          exerciseName: exercise.name,
          muscleGroup: exercise.muscleGroup,
          minimumWorkingSets: body.data.minimumWorkingSets ?? 1,
          maximumWorkingSets: body.data.maximumWorkingSets ?? 5,
          category: exercise.category,
          metricDefinitions: exercise.metricDefinitions ?? null,
          isCompound: exercise.isCompound,
          targetRir,
          targetRepsMin: calibrationMode ? null : 6,
          targetRepsMax: calibrationMode ? null : 30,
          targetWeight: calibrationMode ? null : body.data.targetWeight ?? null,
          recommendedWeight: recommendation.recommendedWeight,
          recommendedReps: recommendation.recommendedReps,
          recommendationOutcome: "maintain",
          recommendationRationale: recommendation.rationale,
          calibrationMode,
          calibrationRir: calibrationMode ? targetRir : null,
          baselineStatus: baseline.status,
        })
        .returning();
    }
    await addPlannedWorkingSets({ ...created, trainingMode: session.trainingMode });
    const workout = await getWorkoutTree(session.id);
    const result = workout?.exercises.find((item) => item.id === created.id);
    res
      .status(201)
      .json(AddExerciseToWorkoutResponse.parse(result));
  },
);

router.patch(
  "/workouts/:sessionId/exercises/:workoutExerciseId/feedback",
  async (req, res): Promise<void> => {
    const params = UpdateWorkoutExerciseParams.safeParse(req.params);
    const body = UpdateWorkoutExerciseBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success ? params.error.message : !body.success ? body.error.message : "Invalid request",
      });
      return;
    }
    const [exercise] = await db.select({
      row: workoutExercisesTable,
      status: workoutSessionsTable.status,
      profileId: workoutSessionsTable.profileId,
      trainingMode: workoutSessionsTable.trainingMode,
    })
      .from(workoutExercisesTable)
      .innerJoin(workoutSessionsTable, eq(workoutExercisesTable.sessionId, workoutSessionsTable.id))
      .where(and(
        eq(workoutExercisesTable.id, params.data.workoutExerciseId),
        eq(workoutExercisesTable.sessionId, params.data.sessionId),
      ))
      .limit(1);
    if (!exercise) {
      res.status(404).json({ error: "Workout exercise not found" });
      return;
    }
    if (exercise.status !== "active") {
      res.status(409).json({ error: "Workout is already complete" });
      return;
    }
    if (exercise.trainingMode === "basic" &&
      (body.data.painReported === true || Boolean(body.data.painNote?.trim()))) {
      res.status(400).json({ error: "Exercise discomfort tracking is unavailable in Basic mode" });
      return;
    }
    const [updated] = await db.update(workoutExercisesTable)
      .set({
        ...body.data,
        painNote: body.data.painNote === undefined
          ? exercise.row.painNote
          : body.data.painNote?.trim() || null,
      })
      .where(eq(workoutExercisesTable.id, params.data.workoutExerciseId))
      .returning();
    if (exercise.trainingMode === "legendary_pro" && updated.painReported) {
      const movement = await getExerciseById(updated.exerciseId);
      if (movement) {
        const [feedbackProfile] = await db.select().from(profilesTable)
          .where(eq(profilesTable.id, exercise.profileId)).limit(1);
        const safeRecommendation = await recommendationForExercise(
          exercise.profileId,
          movement.id,
          {
            category: movement.category,
            equipment: movement.equipment,
            isCompound: movement.isCompound,
            muscleGroup: updated.muscleGroup,
            targetSets: updated.targetSets,
            minimumWorkingSets: updated.minimumWorkingSets,
            maximumWorkingSets: updated.maximumWorkingSets,
            targetRepsMin: updated.targetRepsMin ?? 8,
            targetRepsMax: updated.targetRepsMax ?? 12,
            targetRir: updated.targetRir!,
            targetWeight: updated.targetWeight,
          },
          0,
          true,
          feedbackProfile
            ? await getProfileLoadIncrement(feedbackProfile.id, movement.id, feedbackProfile.weightUnit)
            : 2.5,
        );
        const targetSets = updated.recommendationOutcome === "increase_sets"
          ? Math.max(updated.minimumWorkingSets, updated.targetSets - 1)
          : updated.targetSets;
        await db.update(workoutExercisesTable)
          .set({
            targetSets,
            recommendedWeight: safeRecommendation.recommendedWeight,
            recommendedReps: safeRecommendation.recommendedReps,
            recommendationOutcome: "maintain",
            recommendationRationale: safeRecommendation.rationale,
          })
          .where(eq(workoutExercisesTable.id, updated.id));
        await db.update(workoutSetsTable)
          .set({
            targetWeight: safeRecommendation.recommendedWeight,
            adaptiveTargetWeight: safeRecommendation.recommendedWeight,
            adaptiveTargetReps: safeRecommendation.recommendedReps,
            adaptiveTargetRir: updated.targetRir,
            referenceTargetWeight: updated.calibrationMode ? null : safeRecommendation.recommendedWeight,
            referenceTargetReps: updated.calibrationMode ? null : safeRecommendation.recommendedReps,
            referenceTargetRir: updated.targetRir,
            referenceTargetRepsMin: updated.calibrationMode ? null : updated.targetRepsMin,
            referenceTargetRepsMax: updated.calibrationMode ? null : updated.targetRepsMax,
            algorithmVersion: updated.calibrationMode ? null : PROGRESSION_ALGORITHM_VERSION,
          })
          .where(and(
            eq(workoutSetsTable.workoutExerciseId, updated.id),
            eq(workoutSetsTable.setType, "work"),
            eq(workoutSetsTable.completed, false),
            eq(workoutSetsTable.removed, false),
          ));
      }
    }
    const workout = await getWorkoutTree(params.data.sessionId, true);
    const result = workout?.exercises.find((item) => item.id === updated.id);
    res.json(UpdateWorkoutExerciseResponse.parse(result));
  },
);

router.patch(
  "/workouts/:sessionId/exercises/:workoutExerciseId",
  async (req, res): Promise<void> => {
    const params = SubstituteWorkoutExerciseParams.safeParse(req.params);
    const body = SubstituteWorkoutExerciseBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success ? params.error.message : !body.success ? body.error.message : "Invalid request",
      });
      return;
    }
    const [session] = await db
      .select()
      .from(workoutSessionsTable)
      .where(eq(workoutSessionsTable.id, params.data.sessionId))
      .limit(1);
    if (!session) {
      res.status(404).json({ error: "Workout not found" });
      return;
    }
    if (session.status !== "active") {
      res.status(409).json({ error: "Workout is already complete" });
      return;
    }
    const [current] = await db
      .select()
      .from(workoutExercisesTable)
      .where(
        and(
          eq(workoutExercisesTable.id, params.data.workoutExerciseId),
          eq(workoutExercisesTable.sessionId, session.id),
          eq(workoutExercisesTable.superseded, false),
        ),
      )
      .limit(1);
    const exercise = await getExerciseById(body.data.exerciseId);
    if (!current || !exercise || (exercise.profileId !== null && exercise.profileId !== session.profileId)) {
      res.status(404).json({ error: "Workout exercise or replacement not found" });
      return;
    }
    const replacementMetricDriven = isMetricDrivenExercise(
      exercise.category,
      exercise.metricDefinitions,
    );
    if (session.trainingMode === "basic") {
      const targetRepsMin = current.targetRepsMin ?? 8;
      const targetRepsMax = current.targetRepsMax ?? 12;
      const [loggedSetCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(workoutSetsTable)
        .where(and(
          eq(workoutSetsTable.workoutExerciseId, current.id),
          sql`(${workoutSetsTable.completed} = true OR ${workoutSetsTable.actualWeight} IS NOT NULL OR ${workoutSetsTable.actualReps} IS NOT NULL OR ${workoutSetsTable.metricValues} IS NOT NULL)`,
        ));
      let replacement;
      if ((loggedSetCount?.count ?? 0) > 0) {
        await db.update(workoutExercisesTable)
          .set({ superseded: true })
          .where(eq(workoutExercisesTable.id, current.id));
        [replacement] = await db.insert(workoutExercisesTable).values({
          sessionId: current.sessionId,
          exerciseId: exercise.id,
          exerciseName: exercise.name,
          muscleGroup: exercise.muscleGroup,
          targetRir: null,
          targetSets: current.targetSets,
          minimumWorkingSets: current.minimumWorkingSets,
          maximumWorkingSets: current.maximumWorkingSets,
          targetRepsMin: replacementMetricDriven ? null : targetRepsMin,
          targetRepsMax: replacementMetricDriven ? null : targetRepsMax,
          targetWeight: replacementMetricDriven ? null : current.targetWeight,
          orderIndex: current.orderIndex,
          category: exercise.category,
          metricDefinitions: exercise.metricDefinitions ?? null,
          isCompound: exercise.isCompound,
          recommendedWeight: null,
          recommendedReps: null,
          recommendationOutcome: "maintain",
          recommendationRationale: null,
          calibrationMode: false,
          calibrationRir: null,
          baselineStatus: "no_baseline",
          substitutedFromExerciseId: current.exerciseId,
        }).returning();
        await addPlannedWorkingSets({
          ...replacement,
          trainingMode: "basic",
        });
      } else {
        [replacement] = await db.update(workoutExercisesTable)
          .set({
            exerciseId: exercise.id,
            exerciseName: exercise.name,
            muscleGroup: exercise.muscleGroup,
            category: exercise.category,
            metricDefinitions: exercise.metricDefinitions ?? null,
            isCompound: exercise.isCompound,
            targetRepsMin,
            targetRepsMax,
            targetRir: null,
            recommendedWeight: null,
            recommendedReps: null,
            recommendationOutcome: "maintain",
            recommendationRationale: null,
            calibrationMode: false,
            calibrationRir: null,
            baselineStatus: "no_baseline",
            substitutedFromExerciseId: current.exerciseId,
          })
          .where(eq(workoutExercisesTable.id, current.id))
          .returning();
        await db.update(workoutSetsTable)
          .set({
            targetWeight: replacementMetricDriven ? null : current.targetWeight,
            targetRepsMin: replacementMetricDriven ? null : targetRepsMin,
            targetRepsMax: replacementMetricDriven ? null : targetRepsMax,
            metricValues: null,
            referenceTargetWeight: null,
            referenceTargetReps: null,
            referenceTargetRir: null,
            referenceTargetRepsMin: null,
            referenceTargetRepsMax: null,
            adaptiveTargetWeight: null,
            adaptiveTargetReps: null,
            adaptiveTargetRir: null,
            targetStatus: null,
            targetExplanation: null,
            algorithmVersion: null,
          })
          .where(eq(workoutSetsTable.workoutExerciseId, current.id));
      }
      const workout = await getWorkoutTree(session.id);
      const result = workout?.exercises.find((item) => item.id === replacement?.id);
      res.json(SubstituteWorkoutExerciseResponse.parse(result));
      return;
    }
    const baseline = await getExerciseBaseline(session.profileId, exercise.id);
    const calibrationMode = baseline.status !== "active";
    const [profile] = await db.select().from(profilesTable)
      .where(eq(profilesTable.id, session.profileId)).limit(1);
    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }
    if (replacementMetricDriven) {
      const [loggedSetCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(workoutSetsTable)
        .where(and(
          eq(workoutSetsTable.workoutExerciseId, current.id),
          sql`(${workoutSetsTable.completed} = true OR ${workoutSetsTable.actualWeight} IS NOT NULL OR ${workoutSetsTable.actualReps} IS NOT NULL OR ${workoutSetsTable.actualRir} IS NOT NULL OR ${workoutSetsTable.metricValues} IS NOT NULL)`,
        ));
      let replacement;
      const values = {
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        muscleGroup: exercise.muscleGroup,
        category: exercise.category,
        metricDefinitions: exercise.metricDefinitions ?? null,
        isCompound: exercise.isCompound,
        targetRir: null,
        targetRepsMin: null,
        targetRepsMax: null,
        targetWeight: null,
        recommendedWeight: null,
        recommendedReps: null,
        recommendationOutcome: null,
        recommendationRationale: null,
        calibrationMode: false,
        calibrationRir: null,
        baselineStatus: null,
        substitutedFromExerciseId: current.exerciseId,
      };
      if ((loggedSetCount?.count ?? 0) > 0) {
        await db.update(workoutExercisesTable)
          .set({ superseded: true })
          .where(eq(workoutExercisesTable.id, current.id));
        [replacement] = await db.insert(workoutExercisesTable)
          .values({
            ...values,
            sessionId: current.sessionId,
            targetSets: current.targetSets,
            minimumWorkingSets: current.minimumWorkingSets,
            maximumWorkingSets: current.maximumWorkingSets,
            orderIndex: current.orderIndex,
          })
          .returning();
        await addPlannedWorkingSets({
          ...replacement,
          trainingMode: "legendary_pro",
        });
      } else {
        [replacement] = await db.update(workoutExercisesTable)
          .set({
            ...values,
            painReported: false,
            painNote: null,
          })
          .where(eq(workoutExercisesTable.id, current.id))
          .returning();
        await db.update(workoutSetsTable)
          .set({
            metricValues: null,
            targetWeight: null,
            targetRepsMin: null,
            targetRepsMax: null,
            referenceTargetWeight: null,
            referenceTargetReps: null,
            referenceTargetRir: null,
            referenceTargetRepsMin: null,
            referenceTargetRepsMax: null,
            adaptiveTargetWeight: null,
            adaptiveTargetReps: null,
            adaptiveTargetRir: null,
            targetStatus: null,
            targetExplanation: null,
            algorithmVersion: null,
          })
          .where(and(
            eq(workoutSetsTable.workoutExerciseId, current.id),
            eq(workoutSetsTable.completed, false),
            eq(workoutSetsTable.removed, false),
          ));
      }
      const workout = await getWorkoutTree(session.id);
      const result = workout?.exercises.find((item) => item.id === replacement.id);
      res.json(SubstituteWorkoutExerciseResponse.parse(result));
      return;
    }
    const targetRir = session.targetRirSnapshot ?? current.targetRir;
    if (targetRir === null) {
      res.status(409).json({ error: "Legendary Pro workout is missing its RIR snapshot" });
      return;
    }
    const replacementRecommendation = calibrationMode
      ? {
          recommendedWeight: null,
          recommendedReps: null,
          targetSets: current.targetSets,
          outcome: "maintain" as const,
          rationale: `This substituted movement has no active baseline; calibrate the load at approximately ${targetRir} RIR.`,
        }
      : await recommendationForExercise(
          session.profileId,
          exercise.id,
          {
            category: exercise.category,
            equipment: exercise.equipment,
            isCompound: exercise.isCompound,
            muscleGroup: exercise.muscleGroup,
            targetSets: current.targetSets,
            minimumWorkingSets: current.minimumWorkingSets,
            maximumWorkingSets: current.maximumWorkingSets,
            targetRepsMin: 6,
            targetRepsMax: 30,
            targetRir,
            targetWeight: null,
          },
          0,
          false,
          await getProfileLoadIncrement(profile.id, exercise.id, profile.weightUnit),
        );
    const replacementTargetWeight = replacementRecommendation.recommendedWeight;
    const replacementOutcome = replacementRecommendation.outcome === "increase_sets" ||
      replacementRecommendation.outcome === "decrease_sets"
      ? "maintain"
      : replacementRecommendation.outcome;
    const replacementRationale = replacementOutcome === replacementRecommendation.outcome
      ? replacementRecommendation.rationale
      : "The replacement keeps the current set count; volume changes are not applied during substitution.";
    const [loggedSetCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(workoutSetsTable)
      .where(
        and(
          eq(workoutSetsTable.workoutExerciseId, current.id),
          sql`(${workoutSetsTable.completed} = true OR ${workoutSetsTable.actualWeight} IS NOT NULL OR ${workoutSetsTable.actualReps} IS NOT NULL OR ${workoutSetsTable.actualRir} IS NOT NULL)`,
        ),
      );

    let replacement;
    if ((loggedSetCount?.count ?? 0) > 0) {
      await db
        .update(workoutExercisesTable)
        .set({ superseded: true })
        .where(eq(workoutExercisesTable.id, current.id));
      [replacement] = await db
        .insert(workoutExercisesTable)
        .values({
          sessionId: current.sessionId,
          exerciseId: exercise.id,
          exerciseName: exercise.name,
          muscleGroup: exercise.muscleGroup,
          targetRir,
          targetSets: current.targetSets,
          minimumWorkingSets: current.minimumWorkingSets,
          maximumWorkingSets: current.maximumWorkingSets,
          targetRepsMin: calibrationMode ? null : current.targetRepsMin ?? 8,
          targetRepsMax: calibrationMode ? null : current.targetRepsMax ?? 12,
          targetWeight: replacementTargetWeight,
          orderIndex: current.orderIndex,
          category: exercise.category,
          isCompound: exercise.isCompound,
          recommendedWeight: replacementTargetWeight,
          recommendedReps: replacementRecommendation.recommendedReps,
          recommendationOutcome: replacementOutcome,
          recommendationRationale: replacementRationale,
          calibrationMode,
          calibrationRir: calibrationMode ? targetRir : null,
          baselineStatus: baseline.status,
          substitutedFromExerciseId: current.exerciseId,
        })
        .returning();
      await addPlannedWorkingSets(replacement);
    } else {
      [replacement] = await db
        .update(workoutExercisesTable)
        .set({
          exerciseId: exercise.id,
          exerciseName: exercise.name,
          muscleGroup: exercise.muscleGroup,
          category: exercise.category,
          isCompound: exercise.isCompound,
          targetWeight: replacementTargetWeight,
          recommendedWeight: replacementTargetWeight,
          recommendedReps: replacementRecommendation.recommendedReps,
          targetRir,
          targetRepsMin: calibrationMode ? null : current.targetRepsMin ?? 8,
          targetRepsMax: calibrationMode ? null : current.targetRepsMax ?? 12,
          recommendationOutcome: replacementOutcome,
          recommendationRationale: replacementRationale,
          calibrationMode,
          calibrationRir: calibrationMode ? targetRir : null,
          baselineStatus: baseline.status,
          painReported: false,
          painNote: null,
          substitutedFromExerciseId: current.exerciseId,
        })
        .where(eq(workoutExercisesTable.id, current.id))
        .returning();
      await db
        .update(workoutSetsTable)
        .set({
          targetWeight: replacementTargetWeight,
          targetRepsMin: calibrationMode ? null : current.targetRepsMin ?? 8,
          targetRepsMax: calibrationMode ? null : current.targetRepsMax ?? 12,
          adaptiveTargetWeight: replacementTargetWeight,
          adaptiveTargetReps: replacementRecommendation.recommendedReps,
          adaptiveTargetRir: targetRir,
          referenceTargetWeight: calibrationMode ? null : replacementTargetWeight,
          referenceTargetReps: calibrationMode
            ? null
            : replacementRecommendation.recommendedReps ?? current.targetRepsMin ?? 8,
          referenceTargetRir: targetRir,
          referenceTargetRepsMin: calibrationMode ? null : current.targetRepsMin ?? 8,
          referenceTargetRepsMax: calibrationMode ? null : current.targetRepsMax ?? 12,
          targetStatus: null,
          targetExplanation: null,
          algorithmVersion: calibrationMode ? null : PROGRESSION_ALGORITHM_VERSION,
        })
        .where(and(
          eq(workoutSetsTable.workoutExerciseId, current.id),
          eq(workoutSetsTable.completed, false),
          eq(workoutSetsTable.removed, false),
        ));
    }
    // Replacement belongs to today's structure until the single Finish decision.
    const workout = await getWorkoutTree(session.id);
    const result = workout?.exercises.find((item) => item.id === replacement.id);
    res.json(
      SubstituteWorkoutExerciseResponse.parse(result),
    );
  },
);

router.post(
  "/workouts/:sessionId/sets",
  async (req, res): Promise<void> => {
    const params = CreateWorkoutSetParams.safeParse(req.params);
    const body = CreateWorkoutSetBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success ? params.error.message : !body.success ? body.error.message : "Invalid request",
      });
      return;
    }
    const [row] = await db
      .select({
        sessionId: workoutExercisesTable.sessionId,
        status: workoutSessionsTable.status,
        targetWeight: workoutExercisesTable.targetWeight,
        recommendedWeight: workoutExercisesTable.recommendedWeight,
        recommendedReps: workoutExercisesTable.recommendedReps,
        targetRir: workoutExercisesTable.targetRir,
        calibrationMode: workoutExercisesTable.calibrationMode,
        maximumWorkingSets: workoutExercisesTable.maximumWorkingSets,
        targetRepsMin: workoutExercisesTable.targetRepsMin,
        targetRepsMax: workoutExercisesTable.targetRepsMax,
        category: workoutExercisesTable.category,
        metricDefinitions: workoutExercisesTable.metricDefinitions,
        weekKindSnapshot: workoutSessionsTable.weekKindSnapshot,
        trainingMode: workoutSessionsTable.trainingMode,
      })
      .from(workoutExercisesTable)
      .innerJoin(
        workoutSessionsTable,
        eq(workoutExercisesTable.sessionId, workoutSessionsTable.id),
      )
      .where(eq(workoutExercisesTable.id, body.data.workoutExerciseId))
      .limit(1);
    if (!row || row.sessionId !== params.data.sessionId) {
      res.status(404).json({ error: "Workout exercise not found" });
      return;
    }
    if (row.status !== "active") {
      res.status(409).json({ error: "Workout is already complete" });
      return;
    }
    if (body.data.completed) {
      res.status(400).json({ error: "Create a blank set, then complete it through the sequential completion endpoint" });
      return;
    }
    if (body.data.setType === "work") {
      const [count] = await db.select({ count: sql<number>`count(*)::int` })
        .from(workoutSetsTable)
        .where(and(
          eq(workoutSetsTable.workoutExerciseId, body.data.workoutExerciseId),
          eq(workoutSetsTable.setType, "work"),
          eq(workoutSetsTable.removed, false),
        ));
      if ((count?.count ?? 0) >= row.maximumWorkingSets) {
        res.status(400).json({ error: "Maximum working-set count reached" });
        return;
      }
    }
    const { workoutExerciseId, ...setValues } = body.data;
    const metricDriven = isMetricDrivenExercise(row.category, row.metricDefinitions);
    const targetWeight = metricDriven ? null : body.data.targetWeight ?? row.recommendedWeight ?? row.targetWeight;
    const basic = row.trainingMode === "basic";
    const initialTarget = basic || metricDriven
      ? { reps: null, warning: null }
      : adaptiveRepsForWeight(
          body.data.actualWeight ?? targetWeight,
          row.recommendedWeight ?? row.targetWeight,
          row.recommendedReps ?? row.targetRepsMin ?? 8,
          row.targetRepsMin ?? 8,
          row.targetRepsMax ?? 12,
          row.targetRir!,
        );
    const actualWeight = metricDriven ? null : body.data.actualWeight ?? null;
    const actualReps = metricDriven ? null : body.data.actualReps ?? null;
    const actualRir = basic || metricDriven ? null : body.data.actualRir ?? null;
    const completed = body.data.completed ?? false;
    const calibration = !basic && !metricDriven && (row.calibrationMode || row.weekKindSnapshot === "deload" ||
      row.targetRepsMin === null || row.targetRepsMax === null);
    if (completed && body.data.setType === "work" && (actualWeight === null || actualReps === null)) {
      res.status(400).json({ error: "Completed working sets require actual weight and reps" });
      return;
    }
    const existingSets = await db.select().from(workoutSetsTable)
      .where(eq(workoutSetsTable.workoutExerciseId, body.data.workoutExerciseId))
      .orderBy(asc(workoutSetsTable.setNumber), asc(workoutSetsTable.id));
    const v23b = existingSets.some(s => s.algorithmVersion === "legendary-v2.3b");
    const previousWork = existingSets.filter(s => s.setType === "work" && !s.removed).at(-1);
    const estimatedReps = Math.max(6, (previousWork?.adaptiveTargetReps ??
      previousWork?.actualReps ?? row.recommendedReps ?? 6) - 1);
    const reference: SetTargetReference | null = basic || metricDriven ? null : {
      weight: row.calibrationMode ? null : row.recommendedWeight ?? row.targetWeight,
      reps: row.calibrationMode ? null : row.recommendedReps ?? row.targetRepsMin,
      rir: row.targetRir!,
      repsMin: row.calibrationMode ? null : row.targetRepsMin,
      repsMax: row.calibrationMode ? null : row.targetRepsMax,
    };
    const performance = !basic && !metricDriven && completed && body.data.setType === "work" && !calibration && !v23b && reference
      ? assessSet({
          reps: actualReps!,
          rir: actualRir ?? row.targetRir!,
          actualWeight: actualWeight ?? targetWeight ?? 0,
          reference,
          prescribedRir: row.targetRir!,
        })
      : null;
    const [created] = await db
      .insert(workoutSetsTable)
      .values({
        ...setValues,
        workoutExerciseId,
        targetWeight: calibration ? null : targetWeight,
        targetRepsMin: metricDriven || calibration ? null : body.data.targetRepsMin ?? row.targetRepsMin,
        targetRepsMax: metricDriven || calibration ? null : body.data.targetRepsMax ?? row.targetRepsMax,
        referenceTargetWeight: basic || metricDriven || v23b ? null : reference?.weight ?? null,
        referenceTargetReps: basic || metricDriven || v23b ? null : reference?.reps ?? null,
        referenceTargetRir: basic || metricDriven ? null : reference?.rir ?? null,
        referenceTargetRepsMin: basic || metricDriven || v23b ? null : reference?.repsMin ?? null,
        referenceTargetRepsMax: basic || metricDriven || v23b ? null : reference?.repsMax ?? null,
        actualWeight,
        actualReps,
        actualRir,
        completed,
        completedAt: completed ? new Date() : null,
        adaptiveTargetWeight: basic || metricDriven || calibration || body.data.setType === "warmup" ? null : actualWeight ?? targetWeight,
        adaptiveTargetReps: basic || metricDriven || calibration || body.data.setType === "warmup" ? null : v23b ? estimatedReps : initialTarget.reps,
        adaptiveTargetRir: basic || metricDriven ? null : row.targetRir,
        targetStatus: performance?.status ?? null,
        targetExplanation: basic || metricDriven ? null : performance?.explanation ?? (calibration || body.data.setType === "warmup"
          ? null
          : initialTarget.warning),
        algorithmVersion: basic || metricDriven || calibration || body.data.setType === "warmup" ? null : PROGRESSION_ALGORITHM_VERSION,
      })
      .returning();
    const siblingSets = await db.select().from(workoutSetsTable)
      .where(eq(workoutSetsTable.workoutExerciseId, body.data.workoutExerciseId));
    res.status(201).json(CreateWorkoutSetResponse.parse({
      ...created,
      adaptiveWarning: completed || calibration || created.setType === "warmup" ? null : initialTarget.warning,
      workflowState: sequentialSetStates(siblingSets).get(created.id) ?? "unlocked",
    }));
  },
);

router.post(
  "/workouts/:sessionId/sets/:setId",
  async (req, res): Promise<void> => {
    const params = CompleteWorkoutSetParams.safeParse(req.params);
    const body = CompleteWorkoutSetBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: !params.success ? params.error.message : body.error?.message ?? "Invalid request" });
      return;
    }
    const [candidate] = await db.select({
      exerciseId: workoutExercisesTable.exerciseId,
      category: workoutExercisesTable.category,
      metricDefinitions: workoutExercisesTable.metricDefinitions,
      profileId: workoutSessionsTable.profileId,
      trainingMode: workoutSessionsTable.trainingMode,
    }).from(workoutSetsTable)
      .innerJoin(workoutExercisesTable, eq(workoutSetsTable.workoutExerciseId, workoutExercisesTable.id))
      .innerJoin(workoutSessionsTable, eq(workoutExercisesTable.sessionId, workoutSessionsTable.id))
      .where(eq(workoutSetsTable.id, params.data.setId))
      .limit(1);
    if (!candidate) {
      res.status(404).json({ error: "Workout set not found" });
      return;
    }
    const [profile] = await db.select({ weightUnit: profilesTable.weightUnit })
      .from(profilesTable).where(eq(profilesTable.id, candidate.profileId)).limit(1);
    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }
    const candidateMetricDriven = isMetricDrivenExercise(
      candidate.category,
      candidate.metricDefinitions,
    );
    const loadIncrement = candidate.trainingMode === "basic" || candidateMetricDriven ? 0 : await getProfileLoadIncrement(
      candidate.profileId,
      candidate.exerciseId,
      profile.weightUnit,
    );
    try {
      const result = await db.transaction(async (tx) => {
        const [current] = await tx.select({
          set: workoutSetsTable,
          exercise: workoutExercisesTable,
          sessionStatus: workoutSessionsTable.status,
          sessionId: workoutExercisesTable.sessionId,
          profileId: workoutSessionsTable.profileId,
          readiness: workoutSessionsTable.readiness,
          trainingMode: workoutSessionsTable.trainingMode,
        }).from(workoutSetsTable)
          .innerJoin(workoutExercisesTable, eq(workoutSetsTable.workoutExerciseId, workoutExercisesTable.id))
          .innerJoin(workoutSessionsTable, eq(workoutExercisesTable.sessionId, workoutSessionsTable.id))
          .where(eq(workoutSetsTable.id, params.data.setId))
          .for("update")
          .limit(1);
        if (!current || current.sessionId !== params.data.sessionId || current.set.removed) {
          throw new Error("Workout set not found");
        }
        if (current.sessionStatus !== "active") throw new Error("Workout is already complete");
        if (current.set.completed) throw new Error("Completed set cannot be edited without explicit edit intent");
        const basic = current.trainingMode === "basic";
        const metricDriven = isMetricDrivenExercise(
          current.exercise.category,
          current.exercise.metricDefinitions,
        );
        const metricValues = metricDriven
          ? normalizeMetricValues(
              body.data.metricValues,
              current.exercise.metricDefinitions as MetricDefinition[],
              profile.weightUnit,
              true,
            )
          : null;
        const actualWeight = metricDriven ? null : body.data.actualWeight ?? null;
        const actualReps = metricDriven ? null : body.data.actualReps ?? null;
        const actualRir = basic || metricDriven ? null : body.data.actualRir ?? null;
        if (!metricDriven && (actualWeight === null || actualReps === null)) {
          throw new Error("Completed working sets require actual weight and reps");
        }
        if (!basic && !metricDriven && actualRir === null) {
          throw new Error("Completed Legendary Pro working sets require RIR");
        }
        if (current.set.setType === "work") {
          const rows = await tx.select().from(workoutSetsTable)
            .where(eq(workoutSetsTable.workoutExerciseId, current.exercise.id));
          if (sequentialSetStates(rows).get(current.set.id) === "locked") {
            throw new Error("Complete the earlier working set before this set");
          }
        }
        const calibration = !basic && !metricDriven && (current.exercise.calibrationMode ||
          current.set.referenceTargetRepsMin === null || current.set.referenceTargetRepsMax === null);
        const reference: SetTargetReference | null = basic || metricDriven ? null : {
          weight: calibration ? null : current.set.referenceTargetWeight ??
            current.exercise.recommendedWeight ?? current.exercise.targetWeight,
          reps: calibration ? null : current.set.referenceTargetReps ??
            current.exercise.recommendedReps ?? current.exercise.targetRepsMin,
          rir: calibration ? 3 : current.set.referenceTargetRir ?? current.exercise.targetRir!,
          repsMin: calibration ? null : current.set.referenceTargetRepsMin ??
            current.set.targetRepsMin ?? current.exercise.targetRepsMin,
          repsMax: calibration ? null : current.set.referenceTargetRepsMax ??
            current.set.targetRepsMax ?? current.exercise.targetRepsMax,
        };
        const adaptive = basic || metricDriven || current.set.setType !== "work" || calibration || !reference ||
          reference.weight === null || reference.reps === null ||
          reference.repsMin === null || reference.repsMax === null
          ? { reps: null, warning: null }
          : adaptiveRepsForWeight(
              actualWeight!,
              reference.weight,
              reference.reps,
              reference.repsMin,
              reference.repsMax,
              reference.rir,
            );
        const performance = !basic && !metricDriven && current.set.setType === "work" && adaptive.reps !== null && reference
          ? assessSet({
              reps: actualReps!,
              rir: actualRir!,
              actualWeight: actualWeight!,
              reference,
              prescribedRir: current.exercise.targetRir!,
            })
          : null;
        const [updated] = await tx.update(workoutSetsTable).set({
          actualWeight,
          actualReps,
          actualRir,
          metricValues,
          notes: body.data.notes === undefined ? current.set.notes : body.data.notes,
          completed: true,
          completedAt: new Date(),
          adaptiveTargetWeight: !basic && !metricDriven && current.set.setType === "work" && !current.exercise.calibrationMode
            ? actualWeight
            : null,
          adaptiveTargetReps: basic || metricDriven ? null : current.set.algorithmVersion === "legendary-v2.3b"
            ? current.set.adaptiveTargetReps : adaptive.reps,
          adaptiveTargetRir: basic || metricDriven ? null : current.exercise.targetRir,
          targetStatus: performance?.status ?? null,
          targetExplanation: basic || metricDriven ? null : performance?.explanation ?? null,
          algorithmVersion: basic || metricDriven ? null : current.set.algorithmVersion ??
            (performance ? PROGRESSION_ALGORITHM_VERSION : null),
        }).where(eq(workoutSetsTable.id, current.set.id)).returning();
        if (!basic && !metricDriven && current.set.setType === "work") {
          await recalculatePendingSetTargets(tx, current.exercise, {
            loadIncrement,
            allowIncrease: await allowAutomaticIncrease(
              tx,
              current.sessionId,
              current.exercise,
              current.readiness,
            ),
          });
        }
        const siblingSets = await tx.select().from(workoutSetsTable)
        .where(eq(workoutSetsTable.workoutExerciseId, current.exercise.id));
        const workflow = sequentialSetStates(siblingSets);
        const nextSet = siblingSets.find((set) =>
          set.setType === "work" && workflow.get(set.id) === "active",
        );
        return { updated, nextSet, workflow };
      });
      res.json(CompleteWorkoutSetResponse.parse({
        set: {
          ...result.updated,
          adaptiveWarning: null,
          workflowState: result.workflow.get(result.updated.id) ?? "locked",
        },
        nextSet: result.nextSet ? {
          ...result.nextSet,
          adaptiveWarning: null,
          workflowState: result.workflow.get(result.nextSet.id) ?? "locked",
        } : null,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to complete workout set";
      res.status(/not found/i.test(message) ? 404 : 409).json({ error: message });
    }
  },
);

router.patch(
  "/workouts/:sessionId/sets/:setId",
  async (req, res): Promise<void> => {
    const params = UpdateWorkoutSetParams.safeParse(req.params);
    const body = UpdateWorkoutSetBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success ? params.error.message : !body.success ? body.error.message : "Invalid request",
      });
      return;
    }
    const [candidate] = await db.select({
      exerciseId: workoutExercisesTable.exerciseId,
      category: workoutExercisesTable.category,
      metricDefinitions: workoutExercisesTable.metricDefinitions,
      profileId: workoutSessionsTable.profileId,
      trainingMode: workoutSessionsTable.trainingMode,
    }).from(workoutSetsTable)
      .innerJoin(workoutExercisesTable, eq(workoutSetsTable.workoutExerciseId, workoutExercisesTable.id))
      .innerJoin(workoutSessionsTable, eq(workoutExercisesTable.sessionId, workoutSessionsTable.id))
      .where(eq(workoutSetsTable.id, params.data.setId)).limit(1);
    if (!candidate) {
      res.status(404).json({ error: "Workout set not found" });
      return;
    }
    const [profile] = await db.select().from(profilesTable)
      .where(eq(profilesTable.id, candidate.profileId)).limit(1);
    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }
    const candidateMetricDriven = isMetricDrivenExercise(
      candidate.category,
      candidate.metricDefinitions,
    );
    const loadIncrement = candidate.trainingMode === "basic" || candidateMetricDriven
      ? 0
      : await getProfileLoadIncrement(profile.id, candidate.exerciseId, profile.weightUnit);
    try {
      const result = await db.transaction(async (tx) => {
        const [current] = await tx.select({
          set: workoutSetsTable,
          sessionId: workoutExercisesTable.sessionId,
          status: workoutSessionsTable.status,
          readiness: workoutSessionsTable.readiness,
          trainingMode: workoutSessionsTable.trainingMode,
          exercise: workoutExercisesTable,
        }).from(workoutSetsTable)
          .innerJoin(workoutExercisesTable, eq(workoutSetsTable.workoutExerciseId, workoutExercisesTable.id))
          .innerJoin(workoutSessionsTable, eq(workoutExercisesTable.sessionId, workoutSessionsTable.id))
          .where(eq(workoutSetsTable.id, params.data.setId))
          .for("update")
          .limit(1);
        if (!current || current.sessionId !== params.data.sessionId || current.set.removed) {
          throw new Error("Workout set not found");
        }
        if (current.status !== "active") throw new Error("Workout is already complete");
        const metricDriven = isMetricDrivenExercise(
          current.exercise.category,
          current.exercise.metricDefinitions,
        );
        if (metricDriven) {
          const definitions = current.exercise.metricDefinitions as MetricDefinition[];
          const completed = body.data.completed ?? current.set.completed;
          const requestedChanges = Object.keys(body.data).filter((key) => key !== "editIntent");
          if (current.set.completed && requestedChanges.length > 0 &&
            !canEditSet(current.set.completed, body.data.editIntent)) {
            throw new Error("Explicit editIntent is required to modify a completed set");
          }
          if (current.set.completed && completed !== true) {
            throw new Error("A completed set must remain completed when explicitly edited");
          }
          if (!current.set.completed && current.set.setType === "work") {
            const siblings = await tx.select().from(workoutSetsTable)
              .where(eq(workoutSetsTable.workoutExerciseId, current.exercise.id));
            if (sequentialSetStates(siblings).get(current.set.id) === "locked") {
              throw new Error("Complete the earlier working set before editing this set");
            }
          }
          const metricValues = body.data.metricValues === undefined
            ? current.set.metricValues
            : normalizeMetricValues(
                body.data.metricValues ?? definitions.map(() => null),
                definitions,
                profile.weightUnit,
                false,
              );
          const valuesToCheck = metricValues ?? definitions.map(() => null);
          if (completed && !normalizedMetricValuesAreComplete(valuesToCheck, definitions)) {
            throw new Error("Complete all required exercise metrics before saving this set");
          }
          const { editIntent: _editIntent, ...updates } = body.data;
          const [updated] = await tx.update(workoutSetsTable).set({
            ...updates,
            actualWeight: null,
            actualReps: null,
            actualRir: null,
            metricValues,
            adaptiveTargetWeight: null,
            adaptiveTargetReps: null,
            adaptiveTargetRir: null,
            targetStatus: null,
            targetExplanation: null,
            algorithmVersion: null,
            completed,
            completedAt: completed ? current.set.completedAt ?? new Date() : null,
          }).where(eq(workoutSetsTable.id, params.data.setId)).returning();
          const siblings = await tx.select().from(workoutSetsTable)
            .where(eq(workoutSetsTable.workoutExerciseId, current.exercise.id));
          return { updated, workflow: sequentialSetStates(siblings) };
        }
        if (current.trainingMode === "basic") {
          const completed = body.data.completed ?? current.set.completed;
          const requestedChanges = Object.keys(body.data).filter((key) => key !== "editIntent");
          if (current.set.completed && requestedChanges.length > 0 &&
            !canEditSet(current.set.completed, body.data.editIntent)) {
            throw new Error("Explicit editIntent is required to modify a completed set");
          }
          if (current.set.completed && completed !== true) {
            throw new Error("A completed set must remain completed when explicitly edited");
          }
          if (!current.set.completed && current.set.setType === "work") {
            const siblings = await tx.select().from(workoutSetsTable)
              .where(eq(workoutSetsTable.workoutExerciseId, current.exercise.id));
            if (sequentialSetStates(siblings).get(current.set.id) === "locked") {
              throw new Error("Complete the earlier working set before editing this set");
            }
          }
          const actualWeight = body.data.actualWeight === undefined
            ? current.set.actualWeight : body.data.actualWeight;
          const actualReps = body.data.actualReps === undefined
            ? current.set.actualReps : body.data.actualReps;
          if (completed && (actualWeight === null || actualReps === null)) {
            throw new Error("Completed sets require actual weight and reps");
          }
          const { editIntent: _editIntent, ...updates } = body.data;
          const [updated] = await tx.update(workoutSetsTable).set({
            ...updates,
            actualWeight,
            actualReps,
            actualRir: null,
            adaptiveTargetWeight: null,
            adaptiveTargetReps: null,
            adaptiveTargetRir: null,
            targetStatus: null,
            targetExplanation: null,
            algorithmVersion: null,
            completedAt: completed ? current.set.completedAt ?? new Date() : null,
          }).where(eq(workoutSetsTable.id, params.data.setId)).returning();
          const siblings = await tx.select().from(workoutSetsTable)
            .where(eq(workoutSetsTable.workoutExerciseId, current.exercise.id));
          return { updated, workflow: sequentialSetStates(siblings) };
        }
        const completed = body.data.completed ?? current.set.completed;
        const requestedChanges = Object.keys(body.data).filter((key) => key !== "editIntent");
        if (current.set.completed && requestedChanges.length > 0 &&
          !canEditSet(current.set.completed, body.data.editIntent)) {
          throw new Error("Explicit editIntent is required to modify a completed set");
        }
        if (current.set.completed && completed !== true) {
          throw new Error("A completed set must remain completed when explicitly edited");
        }
        if (!current.set.completed && current.set.setType === "work") {
          const siblings = await tx.select().from(workoutSetsTable)
            .where(eq(workoutSetsTable.workoutExerciseId, current.exercise.id));
          if (sequentialSetStates(siblings).get(current.set.id) === "locked") {
            throw new Error("Complete the earlier working set before editing this set");
          }
        }
        const actualWeight = body.data.actualWeight === undefined
          ? current.set.actualWeight : body.data.actualWeight;
        const actualReps = body.data.actualReps === undefined
          ? current.set.actualReps : body.data.actualReps;
        const actualRir = body.data.actualRir === undefined
          ? current.set.actualRir : body.data.actualRir;
        const targetWeight = body.data.targetWeight === undefined
          ? current.set.targetWeight : body.data.targetWeight;
        const calibration = current.exercise.calibrationMode ||
          current.set.referenceTargetRepsMin === null || current.set.referenceTargetRepsMax === null;
        const reference: SetTargetReference = {
          weight: calibration ? null : current.set.referenceTargetWeight ??
            current.exercise.recommendedWeight ?? current.exercise.targetWeight,
          reps: calibration ? null : current.set.referenceTargetReps ??
            current.exercise.recommendedReps ?? current.exercise.targetRepsMin,
          rir: calibration ? 3 : current.set.referenceTargetRir ?? current.exercise.targetRir!,
          repsMin: calibration ? null : current.set.referenceTargetRepsMin ??
            current.set.targetRepsMin ?? current.exercise.targetRepsMin,
          repsMax: calibration ? null : current.set.referenceTargetRepsMax ??
            current.set.targetRepsMax ?? current.exercise.targetRepsMax,
        };
        const selectedWeight = actualWeight ?? targetWeight ??
          current.set.adaptiveTargetWeight ?? reference.weight;
        const adaptive = current.set.setType !== "work" || calibration ||
          reference.weight === null || reference.reps === null ||
          reference.repsMin === null || reference.repsMax === null
          ? { reps: null, warning: null }
          : adaptiveRepsForWeight(
              selectedWeight,
              reference.weight,
              reference.reps,
              reference.repsMin,
              reference.repsMax,
              reference.rir,
            );
        if (completed && current.set.setType === "work" &&
          (actualWeight === null || actualReps === null || actualRir === null)) {
          throw new Error("Completed working sets require actual weight, reps, and RIR");
        }
        const performance = completed && current.set.setType === "work" &&
          !calibration && adaptive.reps !== null &&
          actualWeight !== null && actualReps !== null && actualRir !== null
          ? assessSet({ reps: actualReps, rir: actualRir, actualWeight, reference, prescribedRir: current.exercise.targetRir! })
          : null;
        const { editIntent: _editIntent, ...updates } = body.data;
        const [updated] = await tx.update(workoutSetsTable).set({
          ...updates,
          actualWeight,
          actualReps,
          actualRir,
          targetWeight,
          adaptiveTargetWeight: calibration || current.set.setType !== "work" ? null : selectedWeight,
          adaptiveTargetReps: current.set.algorithmVersion === "legendary-v2.3b"
            ? current.set.adaptiveTargetReps : adaptive.reps,
          adaptiveTargetRir: current.exercise.targetRir!,
          targetStatus: performance?.status ?? null,
          targetExplanation: performance?.explanation ?? (completed ? null : adaptive.warning),
          algorithmVersion: current.set.algorithmVersion ??
            (performance ? PROGRESSION_ALGORITHM_VERSION : null),
          completedAt: completed ? current.set.completedAt ?? new Date() : null,
        }).where(eq(workoutSetsTable.id, params.data.setId)).returning();
        if (completed && current.set.setType === "work") {
          await recalculatePendingSetTargets(tx, current.exercise, {
            loadIncrement,
            allowIncrease: await allowAutomaticIncrease(
              tx,
              current.sessionId,
              current.exercise,
              current.readiness,
            ),
          });
        }
        const siblings = await tx.select().from(workoutSetsTable)
          .where(eq(workoutSetsTable.workoutExerciseId, current.exercise.id));
        return { updated, workflow: sequentialSetStates(siblings) };
      });
      res.json(UpdateWorkoutSetResponse.parse({
        ...result.updated,
        adaptiveWarning: result.updated.completed ? null : result.updated.targetExplanation,
        workflowState: result.workflow.get(result.updated.id) ?? "locked",
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update workout set";
      const status = /not found/i.test(message) ? 404 : /require actual|must remain completed/i.test(message) ? 400 : 409;
      res.status(status).json({ error: message });
    }
  },
);

router.delete(
  "/workouts/:sessionId/sets/:setId",
  async (req, res): Promise<void> => {
    const params = RemoveWorkoutSetParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [candidate] = await db.select({
      exerciseId: workoutExercisesTable.exerciseId,
      profileId: workoutSessionsTable.profileId,
    }).from(workoutSetsTable)
      .innerJoin(workoutExercisesTable, eq(workoutSetsTable.workoutExerciseId, workoutExercisesTable.id))
      .innerJoin(workoutSessionsTable, eq(workoutExercisesTable.sessionId, workoutSessionsTable.id))
      .where(eq(workoutSetsTable.id, params.data.setId)).limit(1);
    if (!candidate) {
      res.status(404).json({ error: "Workout set not found" });
      return;
    }
    const [profile] = await db.select().from(profilesTable)
      .where(eq(profilesTable.id, candidate.profileId)).limit(1);
    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }
    const loadIncrement = await getProfileLoadIncrement(profile.id, candidate.exerciseId, profile.weightUnit);
    try {
      await db.transaction(async (tx) => {
        const [current] = await tx.select({
          set: workoutSetsTable,
          exercise: workoutExercisesTable,
          status: workoutSessionsTable.status,
          sessionId: workoutExercisesTable.sessionId,
          readiness: workoutSessionsTable.readiness,
          trainingMode: workoutSessionsTable.trainingMode,
        }).from(workoutSetsTable)
          .innerJoin(workoutExercisesTable, eq(workoutSetsTable.workoutExerciseId, workoutExercisesTable.id))
          .innerJoin(workoutSessionsTable, eq(workoutExercisesTable.sessionId, workoutSessionsTable.id))
          .where(eq(workoutSetsTable.id, params.data.setId))
          .for("update")
          .limit(1);
        if (!current || current.sessionId !== params.data.sessionId || current.set.removed) {
          throw new Error("Workout set not found");
        }
        if (current.status !== "active") throw new Error("Workout is already complete");
        let rows = await tx.select().from(workoutSetsTable)
          .where(eq(workoutSetsTable.workoutExerciseId, current.exercise.id));
        if (current.set.setType === "work") {
          const count = rows.filter((row) => row.setType === "work" && !row.removed).length;
          if (count <= current.exercise.minimumWorkingSets) {
            throw new Error("Minimum working-set count reached");
          }
        }
        await tx.update(workoutSetsTable).set({ removed: true })
          .where(eq(workoutSetsTable.id, current.set.id));
        rows = rows.filter((row) => row.id !== current.set.id && !row.removed);
        for (const setType of ["work", "warmup"] as const) {
          const sameType = rows.filter((row) => row.setType === setType)
            .sort((left, right) => left.setNumber - right.setNumber || left.id - right.id);
          for (const [index, row] of sameType.entries()) {
            const setNumber = index + 1;
            if (row.setNumber !== setNumber) {
              await tx.update(workoutSetsTable).set({ setNumber })
                .where(eq(workoutSetsTable.id, row.id));
            }
          }
        }
        if (current.trainingMode !== "basic" && current.set.setType === "work") {
          await recalculatePendingSetTargets(tx, current.exercise, {
            loadIncrement,
            allowIncrease: await allowAutomaticIncrease(
              tx,
              current.sessionId,
              current.exercise,
              current.readiness,
            ),
          });
        }
      });
      res.sendStatus(204);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to remove set";
      const status = /not found/i.test(message) ? 404 : /minimum/i.test(message) ? 409 :
        /complete/i.test(message) ? 409 : 400;
      res.status(status).json({ error: message });
    }
  },
);

router.post(
  "/workouts/:sessionId/finish",
  async (req, res): Promise<void> => {
    const params = FinishWorkoutParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [session] = await db
      .select()
      .from(workoutSessionsTable)
      .where(eq(workoutSessionsTable.id, params.data.sessionId))
      .limit(1);
    if (!session) {
      res.status(404).json({ error: "Workout not found" });
      return;
    }
    const finishBody = FinishWorkoutBody.safeParse(req.body ?? {});
    if (!finishBody.success) { res.status(400).json({ error: finishBody.error.message }); return; }
    const structural = session.trainingMode === "legendary_pro"
      ? await structuralState(session.id)
      : { changes: [] };
    if (session.status === "active" && structural.changes.length && !finishBody.data.structureDecision) {
      res.status(409).json({ error: "Confirm Today Only or Keep for Rest of Mesocycle.", changes: structural.changes }); return;
    }
    try {
      await db.transaction(async (tx) => {
        const [lockedProfile] = await tx.select()
          .from(profilesTable)
          .where(eq(profilesTable.id, session.profileId))
          .for("update")
          .limit(1);
        if (!lockedProfile) throw new Error("Profile not found");
        const [locked] = await tx.select()
          .from(workoutSessionsTable)
          .where(eq(workoutSessionsTable.id, session.id))
          .for("update")
          .limit(1);
        if (!locked || locked.status !== "active") return;
        if (locked.profileId !== lockedProfile.id || locked.trainingMode !== session.trainingMode) {
          throw new Error("Workout mode snapshot changed unexpectedly.");
        }
        if (locked.trainingMode === "legendary_pro") {
          await applyAcceptedStructure(session.id, finishBody.data.structureDecision ?? "today_only", tx);
        }
        const rows = await tx.select({
          set: workoutSetsTable,
          exercise: workoutExercisesTable,
        })
          .from(workoutSetsTable)
          .innerJoin(workoutExercisesTable, eq(workoutSetsTable.workoutExerciseId, workoutExercisesTable.id))
          .where(eq(workoutExercisesTable.sessionId, session.id))
          .orderBy(
            asc(workoutExercisesTable.orderIndex),
            asc(workoutExercisesTable.id),
            asc(workoutSetsTable.setNumber),
          );
        for (const row of rows) {
          const set = row.set;
          const exercise = row.exercise;
          if (!set.completed || set.removed || set.setType !== "work" || exercise.skipped) continue;
          if (isMetricDrivenExercise(exercise.category, exercise.metricDefinitions)) {
            const definitions = exercise.metricDefinitions as MetricDefinition[];
            if (!normalizedMetricValuesAreComplete(set.metricValues ?? definitions.map(() => null), definitions)) {
              throw new Error(`Completed working set ${set.id} is missing a required exercise metric`);
            }
            continue;
          }
          if (set.actualWeight === null || set.actualReps === null) {
            throw new Error(`Completed working set ${set.id} requires actual weight and reps`);
          }
        }
        const completedSets = rows.filter((row) =>
          row.set.completed && !row.set.removed && row.set.setType === "work" && !row.exercise.skipped,
        );
        const { totalVolume } = primaryMuscleVolume(completedSets.flatMap((row) =>
          row.set.actualWeight !== null && row.set.actualReps !== null
            ? [{
                muscleGroup: row.exercise.muscleGroup,
                weight: row.set.actualWeight,
                reps: row.set.actualReps,
              }]
            : [],
        ));
        const [closed] = await tx.update(workoutSessionsTable)
          .set({ status: "completed", endedAt: new Date(), totalVolume })
          .where(and(
            eq(workoutSessionsTable.id, session.id),
            eq(workoutSessionsTable.status, "active"),
          ))
          .returning({ id: workoutSessionsTable.id });
        if (!closed) return;
        if (locked.plannedWorkoutId !== null) {
          await tx.update(plannedWorkoutsTable).set({ status: "completed" })
            .where(eq(plannedWorkoutsTable.id, locked.plannedWorkoutId));
        }
        if (locked.weekId !== null) {
          const planned = await tx.select({ status: plannedWorkoutsTable.status })
            .from(plannedWorkoutsTable)
            .where(eq(plannedWorkoutsTable.weekId, locked.weekId));
          if (planned.length > 0 && planned.every((item) => item.status === "completed")) {
            await tx.update(mesocycleWeeksTable).set({ status: "completed" })
              .where(eq(mesocycleWeeksTable.id, locked.weekId));
          }
        }
        if (locked.splitId !== null && locked.splitDayId !== null) {
          const days = await tx.select()
            .from(splitDaysTable)
            .where(and(
              eq(splitDaysTable.splitId, locked.splitId),
              eq(splitDaysTable.isArchived, false),
            ))
            .orderBy(asc(splitDaysTable.dayIndex));
          const currentIndex = days.findIndex((day) => day.id === locked.splitDayId);
          if (days.length && currentIndex >= 0) {
            await tx.update(trainingSplitsTable)
              .set({ nextDayIndex: days[(currentIndex + 1) % days.length].dayIndex })
              .where(eq(trainingSplitsTable.id, locked.splitId));
          }
        }
        if (lockedProfile.pendingTrainingMode !== null) {
          await tx.update(profilesTable)
            .set({
              trainingMode: lockedProfile.pendingTrainingMode,
              pendingTrainingMode: null,
            })
            .where(eq(profilesTable.id, lockedProfile.id));
        }
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Could not validate workout" });
      return;
    }
    if (session.trainingMode === "legendary_pro") {
      await updateBaselinesFromCompletedSession(session.id);
      await generateNextOccurrence(session.id);
    }
    const workout = await getWorkoutTree(session.id, true);
    const summary = await getWorkoutSummary(session.id);
    if (!workout || !summary) {
      res.status(500).json({ error: "Could not finish workout" });
      return;
    }
    const records = await getPersonalRecords(session.profileId);
    const newPrCount = records?.exercises.reduce((count, exercise) =>
      count + exercise.history.filter((entry) =>
        entry.sessionId === session.id &&
        (entry.heaviestLoadRecord || entry.legendaryPerformanceRecord),
      ).length, 0) ?? 0;
    res.json(FinishWorkoutResponse.parse({
      workout,
      nextWorkout: await getNextWorkout(session.profileId),
      summary: {
        exerciseCount: summary.exerciseCount,
        workingSetCount: summary.workingSetCount,
        newPrCount,
      },
    }));
  },
);

export default router;