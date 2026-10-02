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
  StartWorkoutBody,
  StartWorkoutResponse,
  SubstituteWorkoutExerciseBody,
  SubstituteWorkoutExerciseParams,
  SubstituteWorkoutExerciseResponse,
  UpdateWorkoutSetBody,
  UpdateWorkoutSetParams,
  UpdateWorkoutSetResponse,
} from "@workspace/api-zod";
import {
  db,
  exercisesTable,
  profilesTable,
  splitDayExercisesTable,
  splitDaysTable,
  trainingSplitsTable,
  workoutExercisesTable,
  workoutSessionsTable,
  workoutSetsTable,
} from "@workspace/db";
import {
  calculateSessionVolume,
  getActiveSession,
  getExerciseById,
  getNextWorkout,
  getWorkoutSummary,
  getWorkoutTree,
  listWorkoutSummaries,
} from "../lib/hypertrophy";

const router: IRouter = Router();

async function addPlannedWorkingSets(exercise: {
  id: number;
  targetSets: number;
  targetWeight: number | null;
  targetRepsMin: number;
  targetRepsMax: number;
}) {
  const values = Array.from({ length: exercise.targetSets }, (_, index) => ({
    workoutExerciseId: exercise.id,
    setNumber: index + 1,
    setType: "work" as const,
    targetWeight: exercise.targetWeight,
    targetRepsMin: exercise.targetRepsMin,
    targetRepsMax: exercise.targetRepsMax,
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

  let [session] = await db
    .insert(workoutSessionsTable)
    .values({
      profileId: parsed.data.profileId,
      splitId: split?.id ?? null,
      splitDayId: day?.id ?? null,
      splitName: split?.name ?? null,
      dayName: day?.name ?? null,
    })
    .returning();

  if (day) {
    const prescriptions = await db
      .select()
      .from(splitDayExercisesTable)
      .where(eq(splitDayExercisesTable.dayId, day.id))
      .orderBy(asc(splitDayExercisesTable.orderIndex));
    const sessionExercises = [];
    for (const prescription of prescriptions) {
      const [exercise] = await db
        .select()
        .from(exercisesTable)
        .where(eq(exercisesTable.id, prescription.exerciseId))
        .limit(1);
      if (exercise) {
        sessionExercises.push({
          sessionId: session.id,
          exerciseId: exercise.id,
          exerciseName: exercise.name,
          muscleGroup: exercise.muscleGroup,
          targetRir: prescription.targetRir,
          targetSets: prescription.targetSets,
          targetRepsMin: prescription.targetRepsMin,
          targetRepsMax: prescription.targetRepsMax,
          targetWeight: prescription.targetWeight,
          orderIndex: prescription.orderIndex,
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
          targetRepsMin: current.targetRepsMin,
          targetRepsMax: current.targetRepsMax,
          targetWeight: current.targetWeight,
          orderIndex: current.orderIndex,
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
          substitutedFromExerciseId: current.exerciseId,
        })
        .where(eq(workoutExercisesTable.id, current.id))
        .returning();
      await db
        .update(workoutSetsTable)
        .set({
          targetWeight: current.targetWeight,
          targetRepsMin: current.targetRepsMin,
          targetRepsMax: current.targetRepsMax,
        })
        .where(eq(workoutSetsTable.workoutExerciseId, current.id));
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
    const { workoutExerciseId, ...setValues } = body.data;
    const [created] = await db
      .insert(workoutSetsTable)
      .values({
        ...setValues,
        workoutExerciseId,
        targetWeight: body.data.targetWeight ?? row.targetWeight,
        targetRepsMin: body.data.targetRepsMin ?? row.targetRepsMin,
        targetRepsMax: body.data.targetRepsMax ?? row.targetRepsMax,
        actualWeight: body.data.actualWeight ?? null,
        actualReps: body.data.actualReps ?? null,
        actualRir: body.data.actualRir ?? null,
        completed: body.data.completed ?? false,
        completedAt: body.data.completed ? new Date() : null,
      })
      .returning();
    res.status(201).json(CreateWorkoutSetResponse.parse(created));
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
    const [updated] = await db
      .update(workoutSetsTable)
      .set({
        ...body.data,
        completedAt: completed
          ? current.set.completedAt ?? new Date()
          : null,
      })
      .where(eq(workoutSetsTable.id, params.data.setId))
      .returning();
    res.json(UpdateWorkoutSetResponse.parse(updated));
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
    if (session.status === "active") {
      const volume = await calculateSessionVolume(session.id);
      await db.transaction(async (tx) => {
        await tx
          .update(workoutSessionsTable)
          .set({ status: "completed", endedAt: new Date(), totalVolume: volume })
          .where(
            and(
              eq(workoutSessionsTable.id, session.id),
              eq(workoutSessionsTable.status, "active"),
            ),
          );
        if (session.splitId !== null && session.splitDayId !== null) {
          const days = await tx
            .select()
            .from(splitDaysTable)
            .where(eq(splitDaysTable.splitId, session.splitId))
            .orderBy(asc(splitDaysTable.dayIndex));
          const currentIndex = days.findIndex(
            (day) => day.id === session.splitDayId,
          );
          if (days.length && currentIndex >= 0) {
            const nextIndex = (currentIndex + 1) % days.length;
            await tx
              .update(trainingSplitsTable)
              .set({ nextDayIndex: days[nextIndex].dayIndex })
              .where(eq(trainingSplitsTable.id, session.splitId));
          }
        }
      });
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