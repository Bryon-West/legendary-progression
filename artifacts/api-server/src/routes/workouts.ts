import { Router, type IRouter } from "express";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  AddExerciseToWorkoutBody,
  AddExerciseToWorkoutParams,
  AddExerciseToWorkoutResponse,
  CreateWorkoutSetBody,
  CreateWorkoutSetParams,
  CreateWorkoutSetResponse,
  FinishWorkoutResponse,
  FinishWorkoutParams,
  GetActiveWorkoutQueryParams,
  GetActiveWorkoutResponse,
  GetWorkoutParams,
  GetWorkoutResponse,
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
  recommendationForExercise,
} from "../lib/progression";
import { primaryMuscleVolume } from "../lib/volume";

const router: IRouter = Router();

function assessSet(input: {
  reps: number;
  rir: number;
  targetReps: number;
  targetRir: number;
  minReps: number;
  maxReps: number;
}) {
  // The adaptive reps already account for the selected load. Compare capacity
  // at the prescribed effort too: matching reps by going to failure is not met.
  const effortAdjustedDifference = input.reps + input.rir - (input.targetReps + input.targetRir);
  const status = input.reps < input.minReps || effortAdjustedDifference < -0.75
    ? "below_target" as const
    : effortAdjustedDifference > 0.75
      ? "above_target" as const
      : "target_met" as const;
  const result = status === "target_met" ? "Target met" :
    status === "above_target" ? "Above target" : "Below target";
  return {
    status,
    explanation: `${result}. Target: ${input.minReps}-${input.maxReps} reps around ${input.targetRir} RIR; load-adjusted target ${input.targetReps} reps @ ${input.targetRir} RIR. Completed: ${input.reps} reps @ ${input.rir} RIR.`,
  };
}

async function addPlannedWorkingSets(exercise: {
  id: number;
  targetSets: number;
  targetWeight: number | null;
  targetRepsMin: number;
  targetRepsMax: number;
  recommendedWeight?: number | null;
  recommendedReps?: number | null;
  targetRir?: number;
}) {
  const values = Array.from({ length: exercise.targetSets }, (_, index) => ({
    workoutExerciseId: exercise.id,
    setNumber: index + 1,
    setType: "work" as const,
    targetWeight: exercise.recommendedWeight ?? exercise.targetWeight,
    targetRepsMin: exercise.targetRepsMin,
    targetRepsMax: exercise.targetRepsMax,
    adaptiveTargetWeight: exercise.recommendedWeight ?? exercise.targetWeight,
    adaptiveTargetReps: exercise.recommendedReps ?? exercise.targetRepsMin,
    adaptiveTargetRir: exercise.targetRir ?? 2,
    algorithmVersion: PROGRESSION_ALGORITHM_VERSION,
  }));
  if (values.length) await db.insert(workoutSetsTable).values(values);
}

router.get("/workouts", async (req, res): Promise<void> => {
  const parsed = ListWorkoutsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.json(ListWorkoutsResponse.parse(await listWorkoutSummaries(parsed.data.profileId)));
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
  if (selectedDayId !== null) {
    const [selected] = await db
      .select({ day: splitDaysTable, split: trainingSplitsTable })
      .from(splitDaysTable)
      .innerJoin(
        trainingSplitsTable,
        eq(splitDaysTable.splitId, trainingSplitsTable.id),
      )
      .where(eq(splitDaysTable.id, selectedDayId))
      .limit(1);
    if (!selected || selected.split.profileId !== parsed.data.profileId) {
      res.status(404).json({ error: "Workout day not found for this profile" });
      return;
    }
    selectedSplitId = selected.split.id;
  } else {
    const next = await getNextWorkout(parsed.data.profileId);
    selectedDayId = next?.dayId ?? null;
    selectedSplitId = next?.splitId ?? null;
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

  const today = new Date();
  const weekStart = new Date(today);
  weekStart.setUTCHours(0, 0, 0, 0);
  weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
  const currentWeeklySetRows = await db
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
      sql`${workoutSessionsTable.startedAt} >= ${weekStart}`,
    ));
  const weeklyMuscleSets = new Map<string, number>();
  for (const row of currentWeeklySetRows) {
    weeklyMuscleSets.set(row.muscleGroup, (weeklyMuscleSets.get(row.muscleGroup) ?? 0) + 1);
  }
  const cycleWeek = split
    ? Math.min(
        split.cycleLengthWeeks,
        Math.max(1, Math.floor((Date.now() - new Date(`${split.startDate}T00:00:00Z`).getTime()) / 604800000) + 1),
      )
    : null;
  let [session] = await db
    .insert(workoutSessionsTable)
    .values({
      profileId: parsed.data.profileId,
      splitId: split?.id ?? null,
      splitDayId: day?.id ?? null,
      splitName: split?.name ?? null,
      dayName: day?.name ?? null,
      readiness: parsed.data.readiness ?? null,
      mesocycleStartDate: split?.startDate ?? null,
      mesocycleWeek: cycleWeek,
    })
    .returning();
  if (parsed.data.muscleRecovery?.length) {
    await db.insert(muscleRecoveryTable).values(parsed.data.muscleRecovery.map((item) => ({
      sessionId: session.id,
      muscleGroup: item.muscleGroup.trim(),
      status: item.status,
    })));
  }

  if (day) {
    const prescriptions = await db
      .select()
      .from(splitDayExercisesTable)
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
        const recommendation = await recommendationForExercise(
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
            targetRir: prescription.targetRir,
            targetWeight: prescription.targetWeight,
          },
          weeklyMuscleSets.get(exercise.muscleGroup) ?? 0,
          false,
        );
        if (recommendation.outcome === "increase_sets") {
          if (addedSetMuscles.has(exercise.muscleGroup)) {
            recommendation.outcome = "maintain";
            recommendation.targetSets = prescription.targetSets;
            recommendation.rationale = "Only one exercise per primary muscle can receive a volume increase in a workout.";
          } else {
            addedSetMuscles.add(exercise.muscleGroup);
          }
        }
        sessionExercises.push({
          sessionId: session.id,
          exerciseId: exercise.id,
          exerciseName: exercise.name,
          muscleGroup: exercise.muscleGroup,
          targetRir: prescription.targetRir,
          targetSets: recommendation.targetSets,
          minimumWorkingSets: prescription.minimumWorkingSets,
          maximumWorkingSets: prescription.maximumWorkingSets,
          targetRepsMin: prescription.targetRepsMin,
          targetRepsMax: prescription.targetRepsMax,
          targetWeight: prescription.targetWeight,
          orderIndex: prescription.orderIndex,
          category: exercise.category,
          isCompound: exercise.isCompound,
          recommendedWeight: recommendation.recommendedWeight,
          recommendedReps: recommendation.recommendedReps,
          recommendationOutcome: recommendation.outcome,
          recommendationRationale: recommendation.rationale,
        });
      }
    }
    if (sessionExercises.length) {
      const createdExercises = await db
        .insert(workoutExercisesTable)
        .values(sessionExercises)
        .returning();
      for (const exercise of createdExercises) {
        await addPlannedWorkingSets(exercise);
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
    const [created] = await db
      .insert(workoutExercisesTable)
      .values({
        ...body.data,
        sessionId: session.id,
        exerciseName: exercise.name,
        muscleGroup: exercise.muscleGroup,
        minimumWorkingSets: body.data.minimumWorkingSets ?? 1,
        maximumWorkingSets: body.data.maximumWorkingSets ?? 5,
        category: exercise.category,
        isCompound: exercise.isCompound,
        recommendedWeight: body.data.targetWeight ?? null,
        recommendedReps: body.data.targetRepsMin,
        recommendationOutcome: "maintain",
        recommendationRationale: "Added during the active workout.",
      })
      .returning();
    await addPlannedWorkingSets(created);
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
    const [updated] = await db.update(workoutExercisesTable)
      .set({
        ...body.data,
        painNote: body.data.painNote === undefined
          ? exercise.row.painNote
          : body.data.painNote?.trim() || null,
      })
      .where(eq(workoutExercisesTable.id, params.data.workoutExerciseId))
      .returning();
    if (updated.painReported) {
      const movement = await getExerciseById(updated.exerciseId);
      if (movement) {
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
            targetRepsMin: updated.targetRepsMin,
            targetRepsMax: updated.targetRepsMax,
            targetRir: updated.targetRir,
            targetWeight: updated.targetWeight,
          },
          0,
          true,
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
            algorithmVersion: PROGRESSION_ALGORITHM_VERSION,
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
    const replacementRecommendation = await recommendationForExercise(
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
        targetRepsMin: current.targetRepsMin,
        targetRepsMax: current.targetRepsMax,
        targetRir: current.targetRir,
        targetWeight: null,
      },
      0,
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
          targetRir: current.targetRir,
          targetSets: current.targetSets,
          minimumWorkingSets: current.minimumWorkingSets,
          maximumWorkingSets: current.maximumWorkingSets,
          targetRepsMin: current.targetRepsMin,
          targetRepsMax: current.targetRepsMax,
          targetWeight: replacementTargetWeight,
          orderIndex: current.orderIndex,
          category: exercise.category,
          isCompound: exercise.isCompound,
          recommendedWeight: replacementTargetWeight,
          recommendedReps: replacementRecommendation.recommendedReps,
          recommendationOutcome: replacementOutcome,
          recommendationRationale: replacementRationale,
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
          recommendationOutcome: replacementOutcome,
          recommendationRationale: replacementRationale,
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
          targetRepsMin: current.targetRepsMin,
          targetRepsMax: current.targetRepsMax,
          adaptiveTargetWeight: replacementTargetWeight,
          adaptiveTargetReps: replacementRecommendation.recommendedReps,
          adaptiveTargetRir: current.targetRir,
          targetStatus: null,
          targetExplanation: null,
          algorithmVersion: PROGRESSION_ALGORITHM_VERSION,
        })
        .where(and(
          eq(workoutSetsTable.workoutExerciseId, current.id),
          eq(workoutSetsTable.completed, false),
          eq(workoutSetsTable.removed, false),
        ));
    }
    if (body.data.updateMesocycle && session.splitDayId !== null) {
      await db.update(splitDayExercisesTable)
        .set({ exerciseId: exercise.id, targetWeight: replacementTargetWeight })
        .where(and(
          eq(splitDayExercisesTable.dayId, session.splitDayId),
          eq(splitDayExercisesTable.exerciseId, current.exerciseId),
        ));
    }
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
        maximumWorkingSets: workoutExercisesTable.maximumWorkingSets,
        targetRepsMin: workoutExercisesTable.targetRepsMin,
        targetRepsMax: workoutExercisesTable.targetRepsMax,
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
    if (body.data.setType === "work") {
      const [count] = await db.select({ count: sql<number>`count(*)::int` })
        .from(workoutSetsTable)
        .where(and(
          eq(workoutSetsTable.workoutExerciseId, body.data.workoutExerciseId),
          eq(workoutSetsTable.setType, "work"),
          eq(workoutSetsTable.removed, false),
        ));
      if ((count?.count ?? 0) >= row.maximumWorkingSets) {
        res.status(409).json({ error: "Maximum working-set count reached" });
        return;
      }
    }
    const { workoutExerciseId, ...setValues } = body.data;
    const targetWeight = body.data.targetWeight ?? row.recommendedWeight ?? row.targetWeight;
    const initialTarget = adaptiveRepsForWeight(
      body.data.actualWeight ?? targetWeight,
      row.recommendedWeight ?? row.targetWeight,
      row.recommendedReps ?? row.targetRepsMin,
      row.targetRepsMin,
      row.targetRepsMax,
      row.targetRir,
    );
    const actualWeight = body.data.actualWeight ?? null;
    const actualReps = body.data.actualReps ?? null;
    const actualRir = body.data.actualRir ?? null;
    const completed = body.data.completed ?? false;
    if (completed && body.data.setType === "work" && (actualWeight === null || actualReps === null)) {
      res.status(400).json({ error: "Completed working sets require actual weight and reps" });
      return;
    }
    const performance = completed && body.data.setType === "work"
      ? assessSet({
          reps: actualReps!,
          rir: actualRir ?? row.targetRir,
          targetReps: initialTarget.reps,
          targetRir: row.targetRir,
          minReps: row.targetRepsMin,
          maxReps: row.targetRepsMax,
        })
      : null;
    const [created] = await db
      .insert(workoutSetsTable)
      .values({
        ...setValues,
        workoutExerciseId,
        targetWeight,
        targetRepsMin: body.data.targetRepsMin ?? row.targetRepsMin,
        targetRepsMax: body.data.targetRepsMax ?? row.targetRepsMax,
        actualWeight,
        actualReps,
        actualRir,
        completed,
        completedAt: completed ? new Date() : null,
        adaptiveTargetWeight: actualWeight ?? targetWeight,
        adaptiveTargetReps: initialTarget.reps,
        adaptiveTargetRir: row.targetRir,
        targetStatus: performance?.status ?? null,
        targetExplanation: performance?.explanation ?? initialTarget.warning,
        algorithmVersion: PROGRESSION_ALGORITHM_VERSION,
      })
      .returning();
    res.status(201).json(CreateWorkoutSetResponse.parse({
      ...created,
      adaptiveWarning: completed ? null : initialTarget.warning,
    }));
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
    const [current] = await db
      .select({
        set: workoutSetsTable,
        sessionId: workoutExercisesTable.sessionId,
        status: workoutSessionsTable.status,
        exercise: workoutExercisesTable,
      })
      .from(workoutSetsTable)
      .innerJoin(
        workoutExercisesTable,
        eq(workoutSetsTable.workoutExerciseId, workoutExercisesTable.id),
      )
      .innerJoin(
        workoutSessionsTable,
        eq(workoutExercisesTable.sessionId, workoutSessionsTable.id),
      )
      .where(eq(workoutSetsTable.id, params.data.setId))
      .limit(1);
    if (!current || current.sessionId !== params.data.sessionId) {
      res.status(404).json({ error: "Workout set not found" });
      return;
    }
    if (current.status !== "active") {
      res.status(409).json({ error: "Workout is already complete" });
      return;
    }
    const completed = body.data.completed ?? current.set.completed;
    if (current.set.removed) {
      res.status(404).json({ error: "Workout set was removed" });
      return;
    }
    const actualWeight = body.data.actualWeight ?? current.set.actualWeight;
    const actualReps = body.data.actualReps ?? current.set.actualReps;
    const actualRir = body.data.actualRir ?? current.set.actualRir;
    const targetWeight = body.data.targetWeight ?? current.set.targetWeight;
    const selectedWeight = actualWeight ?? targetWeight ?? current.exercise.recommendedWeight;
    const adaptive = adaptiveRepsForWeight(
      selectedWeight,
      current.exercise.recommendedWeight ?? current.exercise.targetWeight,
      current.exercise.recommendedReps ?? current.exercise.targetRepsMin,
      current.exercise.targetRepsMin,
      current.exercise.targetRepsMax,
      current.exercise.targetRir,
    );
    const isRatedWork = current.set.setType === "work";
    if (completed && isRatedWork && (actualWeight === null || actualReps === null)) {
      res.status(400).json({ error: "Completed working sets require actual weight and reps" });
      return;
    }
    const performance = completed && isRatedWork
      ? assessSet({
          reps: actualReps!,
          rir: actualRir ?? current.exercise.targetRir,
          targetReps: adaptive.reps,
          targetRir: current.exercise.targetRir,
          minReps: current.exercise.targetRepsMin,
          maxReps: current.exercise.targetRepsMax,
        })
      : null;
    const [updated] = await db
      .update(workoutSetsTable)
      .set({
        ...body.data,
        actualWeight,
        actualReps,
        actualRir,
        targetWeight,
        adaptiveTargetWeight: selectedWeight,
        adaptiveTargetReps: adaptive.reps,
        adaptiveTargetRir: current.exercise.targetRir,
        targetStatus: performance?.status ?? null,
        targetExplanation: performance?.explanation ?? adaptive.warning,
        algorithmVersion: PROGRESSION_ALGORITHM_VERSION,
        completedAt: completed
          ? current.set.completedAt ?? new Date()
          : null,
      })
      .where(eq(workoutSetsTable.id, params.data.setId))
      .returning();
    res.json(UpdateWorkoutSetResponse.parse({
      ...updated,
      adaptiveWarning: completed ? null : adaptive.warning,
    }));
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
    const [current] = await db.select({
      set: workoutSetsTable,
      exercise: workoutExercisesTable,
      status: workoutSessionsTable.status,
      sessionId: workoutExercisesTable.sessionId,
    })
      .from(workoutSetsTable)
      .innerJoin(workoutExercisesTable, eq(workoutSetsTable.workoutExerciseId, workoutExercisesTable.id))
      .innerJoin(workoutSessionsTable, eq(workoutExercisesTable.sessionId, workoutSessionsTable.id))
      .where(eq(workoutSetsTable.id, params.data.setId))
      .limit(1);
    if (!current || current.sessionId !== params.data.sessionId || current.set.removed) {
      res.status(404).json({ error: "Workout set not found" });
      return;
    }
    if (current.status !== "active") {
      res.status(409).json({ error: "Workout is already complete" });
      return;
    }
    if (current.set.setType === "work") {
      const [count] = await db.select({ count: sql<number>`count(*)::int` })
        .from(workoutSetsTable)
        .where(and(
          eq(workoutSetsTable.workoutExerciseId, current.exercise.id),
          eq(workoutSetsTable.setType, "work"),
          eq(workoutSetsTable.removed, false),
        ));
      if ((count?.count ?? 0) <= current.exercise.minimumWorkingSets) {
        res.status(409).json({ error: "Minimum working-set count reached" });
        return;
      }
    }
    await db.update(workoutSetsTable)
      .set({ removed: true })
      .where(eq(workoutSetsTable.id, current.set.id));
    res.sendStatus(204);
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
    try {
      await db.transaction(async (tx) => {
        const [locked] = await tx.select()
          .from(workoutSessionsTable)
          .where(eq(workoutSessionsTable.id, session.id))
          .for("update")
          .limit(1);
        if (!locked || locked.status !== "active") return;
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
          if (set.actualWeight === null || set.actualReps === null) {
            throw new Error(`Completed working set ${set.id} requires actual weight and reps`);
          }
          const adaptive = set.adaptiveTargetReps === null
            ? adaptiveRepsForWeight(
                set.actualWeight,
                exercise.recommendedWeight ?? exercise.targetWeight,
                exercise.recommendedReps ?? exercise.targetRepsMin,
                exercise.targetRepsMin,
                exercise.targetRepsMax,
                exercise.targetRir,
              )
            : { reps: set.adaptiveTargetReps, warning: null };
          const targetRir = set.adaptiveTargetRir ?? exercise.targetRir;
          const performance = assessSet({
            reps: set.actualReps,
            rir: set.actualRir ?? targetRir,
            targetReps: adaptive.reps,
            targetRir,
            minReps: set.targetRepsMin ?? exercise.targetRepsMin,
            maxReps: set.targetRepsMax ?? exercise.targetRepsMax,
          });
          await tx.update(workoutSetsTable).set({
            adaptiveTargetWeight: set.adaptiveTargetWeight ?? set.actualWeight,
            adaptiveTargetReps: adaptive.reps,
            adaptiveTargetRir: targetRir,
            targetStatus: performance.status,
            targetExplanation: performance.explanation,
            algorithmVersion: set.algorithmVersion ?? PROGRESSION_ALGORITHM_VERSION,
          }).where(eq(workoutSetsTable.id, set.id));
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
        if (locked.splitId !== null && locked.splitDayId !== null) {
          const days = await tx.select()
            .from(splitDaysTable)
            .where(eq(splitDaysTable.splitId, locked.splitId))
            .orderBy(asc(splitDaysTable.dayIndex));
          const currentIndex = days.findIndex((day) => day.id === locked.splitDayId);
          if (days.length && currentIndex >= 0) {
            await tx.update(trainingSplitsTable)
              .set({ nextDayIndex: days[(currentIndex + 1) % days.length].dayIndex })
              .where(eq(trainingSplitsTable.id, locked.splitId));
          }
        }
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Could not validate workout" });
      return;
    }
    const workout = await getWorkoutTree(session.id, true);
    const summary = await getWorkoutSummary(session.id);
    if (!workout || !summary) {
      res.status(500).json({ error: "Could not finish workout" });
      return;
    }
    res.json(FinishWorkoutResponse.parse({
      workout,
      nextWorkout: await getNextWorkout(session.profileId),
    }));
  },
);

export default router;