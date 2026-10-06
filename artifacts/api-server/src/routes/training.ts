import { Router, type IRouter } from "express";
import { and, asc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import {
  AddExerciseToSplitDayBody,
  AddExerciseToSplitDayParams,
  CreateExerciseBody,
  CreateExerciseResponse,
  CreateSplitBody,
  CreateSplitResponse,
  CreateSplitDayBody,
  CreateSplitDayParams,
  GetExerciseHistoryParams,
  GetExerciseHistoryResponse,
  GetOverviewResponse,
  GetOverviewQueryParams,
  GetSplitParams,
  GetSplitResponse,
  ListExercisesQueryParams,
  ListExercisesResponse,
  ListProfilesResponse,
  ListSplitsQueryParams,
  ListSplitsResponse,
  RemoveExerciseFromSplitDayParams,
  SaveMesocycleBody,
  SaveMesocycleParams,
  SaveMesocycleResponse,
  AddExerciseToSplitDayResponse,
  UpdateProfileBody,
  UpdateProfileParams,
  UpdateProfileResponse,
  UpdateProfileTrainingModeBody,
  UpdateProfileTrainingModeParams,
  UpdateProfileTrainingModeResponse,
  UpdateSplitBody,
  UpdateSplitParams,
  UpdateSplitResponse,
  UpdateSplitDayBody,
  UpdateSplitDayResponse,
  UpdateSplitDayExerciseBody,
  UpdateSplitDayExerciseParams,
  UpdateSplitDayExerciseResponse,
  UpdateSplitDayParams,
  CreateSplitDayResponse,
} from "@workspace/api-zod";
import {
  db,
  exercisesTable,
  profilesTable,
  splitDayExercisesTable,
  splitDaysTable,
  trainingSplitsTable,
  workoutSessionsTable,
} from "@workspace/db";
import {
  getExerciseById,
  getExerciseHistory,
  getProfileOverview,
  getSplitTree,
} from "../lib/hypertrophy";
import { validateMetricDefinitions } from "../lib/exercise-metrics";

const router: IRouter = Router();

router.get("/profiles", async (req, res): Promise<void> => {
  const accountUserId = (req as typeof req & { accountUserId?: string }).accountUserId;
  if (!accountUserId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const rows = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.ownerUserId, accountUserId))
    .orderBy(asc(profilesTable.createdAt), asc(profilesTable.id));
  res.json(ListProfilesResponse.parse(rows));
});

router.post("/profiles", async (_req, res): Promise<void> => {
  res.status(409).json({ error: "Each account has one training profile. Edit your existing profile." });
});

router.patch("/profiles/:profileId", async (req, res): Promise<void> => {
  const accountUserId = (req as typeof req & { accountUserId?: string }).accountUserId;
  if (!accountUserId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const params = UpdateProfileParams.safeParse(req.params);
  const body = UpdateProfileBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      error: !params.success ? params.error.message : !body.success ? body.error.message : "Invalid request",
    });
    return;
  }
  const [profile] = await db
    .update(profilesTable)
    .set({
      ...(body.data.name !== undefined ? { name: body.data.name.trim() } : {}),
      ...(body.data.weightUnit !== undefined ? { weightUnit: body.data.weightUnit } : {}),
      ...(body.data.trainingExperience !== undefined ? { trainingExperience: body.data.trainingExperience } : {}),
      ...(body.data.onboardingComplete !== undefined ? { onboardingComplete: body.data.onboardingComplete } : {}),
    })
    .where(and(
      eq(profilesTable.id, params.data.profileId),
      eq(profilesTable.ownerUserId, accountUserId),
    ))
    .returning();
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  res.json(UpdateProfileResponse.parse(profile));
});

router.patch("/profiles/:profileId/training-mode", async (req, res): Promise<void> => {
  const accountUserId = (req as typeof req & { accountUserId?: string }).accountUserId;
  if (!accountUserId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const params = UpdateProfileTrainingModeParams.safeParse(req.params);
  const body = UpdateProfileTrainingModeBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      error: !params.success ? params.error.message : !body.success ? body.error.message : "Invalid request",
    });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [profile] = await tx.select().from(profilesTable)
      .where(and(
        eq(profilesTable.id, params.data.profileId),
        eq(profilesTable.ownerUserId, accountUserId),
      ))
      .for("update")
      .limit(1);
    if (!profile) return { kind: "not_found" as const };

    const [session] = await tx.select({ id: workoutSessionsTable.id })
      .from(workoutSessionsTable)
      .where(and(
        eq(workoutSessionsTable.profileId, profile.id),
        eq(workoutSessionsTable.status, "active"),
      ))
      .for("update")
      .limit(1);
    const activeWorkoutId = session?.id ?? null;
    if (activeWorkoutId !== null) {
      const action = body.data.activeSessionAction;
      if (!action) return { kind: "active_requires_choice" as const, activeWorkoutId };
      if (action === "keep_current") {
        const [updated] = await tx.update(profilesTable)
          .set({ pendingTrainingMode: null })
          .where(eq(profilesTable.id, profile.id))
          .returning();
        return { kind: "ok" as const, profile: updated, activeWorkoutId, pending: false };
      }
      if (action === "finish_current") {
        const [updated] = await tx.update(profilesTable)
          .set({ pendingTrainingMode: body.data.trainingMode })
          .where(eq(profilesTable.id, profile.id))
          .returning();
        return { kind: "ok" as const, profile: updated, activeWorkoutId, pending: true };
      }
      await tx.delete(workoutSessionsTable)
        .where(and(
          eq(workoutSessionsTable.id, activeWorkoutId),
          eq(workoutSessionsTable.profileId, profile.id),
          eq(workoutSessionsTable.status, "active"),
        ));
      const [updated] = await tx.update(profilesTable)
        .set({ trainingMode: body.data.trainingMode, pendingTrainingMode: null })
        .where(eq(profilesTable.id, profile.id))
        .returning();
      return { kind: "ok" as const, profile: updated, activeWorkoutId: null, pending: false };
    }

    const [updated] = await tx.update(profilesTable)
      .set({ trainingMode: body.data.trainingMode, pendingTrainingMode: null })
      .where(eq(profilesTable.id, profile.id))
      .returning();
    return { kind: "ok" as const, profile: updated, activeWorkoutId: null, pending: false };
  });

  if (result.kind === "not_found") {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  if (result.kind === "active_requires_choice") {
    res.status(409).json({ error: "Choose how to handle the active workout before changing modes." });
    return;
  }
  res.json(UpdateProfileTrainingModeResponse.parse({
    profile: result.profile,
    activeWorkoutId: result.activeWorkoutId,
    pending: result.pending,
  }));
});

router.get("/overview", async (req, res): Promise<void> => {
  const parsed = GetOverviewQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const overview = await getProfileOverview(parsed.data.profileId);
  if (!overview) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  res.json(GetOverviewResponse.parse(overview));
});

router.get("/exercises", async (req, res): Promise<void> => {
  const parsed = ListExercisesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const filters = [
    or(
      isNull(exercisesTable.profileId),
      eq(exercisesTable.profileId, parsed.data.profileId),
    ),
  ];
  if (parsed.data.search?.trim()) {
    const search = `%${parsed.data.search.trim()}%`;
    filters.push(or(
      ilike(exercisesTable.name, search),
      ilike(exercisesTable.muscleGroup, search),
        ilike(exercisesTable.equipment, search),
        ilike(exercisesTable.category, search),
      sql<boolean>`EXISTS (
        SELECT 1 FROM unnest(${exercisesTable.aliases}) AS lookup(alias)
        WHERE lookup.alias ILIKE ${search}
      )`,
        sql<boolean>`EXISTS (
          SELECT 1 FROM unnest(${exercisesTable.secondaryMuscles}) AS lookup(muscle)
          WHERE lookup.muscle ILIKE ${search}
        )`,
    ));
  }
  if (parsed.data.muscleGroup?.trim()) {
    filters.push(eq(exercisesTable.muscleGroup, parsed.data.muscleGroup.trim()));
  }
    if (parsed.data.category) {
      filters.push(eq(exercisesTable.category, parsed.data.category));
    }
  const exercises = await db
    .select()
    .from(exercisesTable)
    .where(and(...filters))
    .orderBy(asc(exercisesTable.muscleGroup), asc(exercisesTable.name));
  res.json(ListExercisesResponse.parse(exercises));
});

router.post("/exercises", async (req, res): Promise<void> => {
  const parsed = CreateExerciseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.metricDefinitions) {
    try {
      validateMetricDefinitions(parsed.data.metricDefinitions);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid metric configuration" });
      return;
    }
  }
  const [exercise] = await db
    .insert(exercisesTable)
    .values({
      ...parsed.data,
      name: parsed.data.name.trim(),
      muscleGroup: parsed.data.muscleGroup.trim(),
      equipment: parsed.data.equipment.trim(),
      instructions: parsed.data.instructions?.trim() || null,
      metricDefinitions: parsed.data.metricDefinitions?.map((metric) => ({
        ...metric,
        label: metric.label.trim(),
      })) ?? null,
    })
    .returning();
  res.status(201).json(CreateExerciseResponse.parse(exercise));
});

router.get(
  "/profiles/:profileId/exercises/:exerciseId/history",
  async (req, res): Promise<void> => {
    const parsed = GetExerciseHistoryParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const history = await getExerciseHistory(
      parsed.data.profileId,
      parsed.data.exerciseId,
    );
    res.json(GetExerciseHistoryResponse.parse(history));
  },
);

router.get("/splits", async (req, res): Promise<void> => {
  const parsed = ListSplitsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const splits = await db
    .select({ id: trainingSplitsTable.id })
    .from(trainingSplitsTable)
    .where(and(eq(trainingSplitsTable.profileId, parsed.data.profileId), isNull(trainingSplitsTable.deletedAt)))
    .orderBy(asc(trainingSplitsTable.createdAt), asc(trainingSplitsTable.id));
  const results = [];
  for (const split of splits) {
    const tree = await getSplitTree(split.id);
    if (tree) results.push(tree);
  }
  res.json(ListSplitsResponse.parse(results));
});

router.post("/splits", async (req, res): Promise<void> => {
  const parsed = CreateSplitBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [split] = await db
    .insert(trainingSplitsTable)
    .values({ ...parsed.data, name: parsed.data.name.trim() })
    .returning();
  const tree = await getSplitTree(split.id);
  res.status(201).json(CreateSplitResponse.parse(tree));
});

router.get("/splits/:splitId", async (req, res): Promise<void> => {
  const params = GetSplitParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const split = await getSplitTree(params.data.splitId);
  if (!split) {
    res.status(404).json({ error: "Split not found" });
    return;
  }
  res.json(GetSplitResponse.parse(split));
});

router.patch("/splits/:splitId", async (req, res): Promise<void> => {
  const params = UpdateSplitParams.safeParse(req.params);
  const body = UpdateSplitBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      error: !params.success ? params.error.message : !body.success ? body.error.message : "Invalid request",
    });
    return;
  }
  const updates: {
    name?: string;
    nextDayIndex?: number;
    startDate?: string;
    cycleLengthWeeks?: number;
  } = {
    ...(body.data.name !== undefined ? { name: body.data.name } : {}),
    ...(body.data.nextDayIndex !== undefined ? { nextDayIndex: body.data.nextDayIndex } : {}),
    ...(body.data.cycleLengthWeeks !== undefined ? { cycleLengthWeeks: body.data.cycleLengthWeeks } : {}),
    ...(body.data.startDate !== undefined
      ? { startDate: body.data.startDate }
      : {}),
  };
  if (updates.name !== undefined) updates.name = updates.name.trim();
  if (updates.nextDayIndex !== undefined) {
    const days = await db
      .select({ id: splitDaysTable.id })
      .from(splitDaysTable)
      .where(eq(splitDaysTable.splitId, params.data.splitId));
    updates.nextDayIndex = days.length
      ? Math.min(updates.nextDayIndex, days.length - 1)
      : 0;
  }
  const [updated] = await db
    .update(trainingSplitsTable)
    .set(updates)
    .where(eq(trainingSplitsTable.id, params.data.splitId))
    .returning({ id: trainingSplitsTable.id });
  if (!updated) {
    res.status(404).json({ error: "Split not found" });
    return;
  }
  res.json(UpdateSplitResponse.parse(await getSplitTree(updated.id)));
});

router.put("/splits/:splitId", async (req, res): Promise<void> => {
  const params = SaveMesocycleParams.safeParse(req.params);
  const body = SaveMesocycleBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      error: !params.success ? params.error.message : !body.success ? body.error.message : "Invalid request",
    });
    return;
  }
  const splitId = params.data.splitId;
  const [current] = await db
    .select()
    .from(trainingSplitsTable)
    .where(eq(trainingSplitsTable.id, splitId))
    .limit(1);
  if (!current) {
    res.status(404).json({ error: "Mesocycle not found" });
    return;
  }
  const suppliedDayIds = body.data.days.flatMap((day) => day.id === undefined ? [] : [day.id]);
  const suppliedExerciseIds = body.data.days.flatMap((day) =>
    day.exercises.flatMap((item) => item.id === undefined ? [] : [item.id]),
  );
  if (
    new Set(suppliedDayIds).size !== suppliedDayIds.length ||
    new Set(suppliedExerciseIds).size !== suppliedExerciseIds.length ||
    new Set(body.data.days.map((day) => day.dayIndex)).size !== body.data.days.length ||
    body.data.days.some((day) => day.exercises.some(
      (item) => item.minimumWorkingSets > item.maximumWorkingSets ||
        item.targetSets < item.minimumWorkingSets ||
        item.targetSets > item.maximumWorkingSets ||
        item.targetRepsMin > item.targetRepsMax,
    ))
  ) {
    res.status(400).json({ error: "Mesocycle contains duplicate IDs or invalid exercise boundaries" });
    return;
  }

  try {
    await db.transaction(async (tx) => {
      const existingDays = await tx
        .select()
        .from(splitDaysTable)
        .where(eq(splitDaysTable.splitId, splitId));
      const knownDayIds = new Set(existingDays.map((day) => day.id));
      if (suppliedDayIds.some((id) => !knownDayIds.has(id))) {
        throw new Error("A supplied day ID does not belong to this mesocycle");
      }
      const existingPrescriptions = existingDays.length
        ? await tx.select().from(splitDayExercisesTable)
          .where(eq(splitDayExercisesTable.dayId, existingDays[0].id))
        : [];
      const allPrescriptions = existingDays.length
        ? await Promise.all(existingDays.slice(1).map((day) =>
            tx.select().from(splitDayExercisesTable)
              .where(eq(splitDayExercisesTable.dayId, day.id)),
          ))
        : [];
      const ownedExerciseIds = new Set([
        ...existingPrescriptions.map((item) => item.id),
        ...allPrescriptions.flat().map((item) => item.id),
      ]);
      if (suppliedExerciseIds.some((id) => !ownedExerciseIds.has(id))) {
        throw new Error("A supplied prescription ID does not belong to this mesocycle");
      }
      const exerciseIds = body.data.days.flatMap((day) => day.exercises.map((item) => item.exerciseId));
      if (exerciseIds.length) {
        const availableExercises = await tx.select({
          id: exercisesTable.id,
          profileId: exercisesTable.profileId,
        }).from(exercisesTable).where(inArray(exercisesTable.id, exerciseIds));
        if (availableExercises.length !== new Set(exerciseIds).size ||
          availableExercises.some((exercise) => exercise.profileId !== null && exercise.profileId !== current.profileId)) {
          throw new Error("An exercise is unavailable to this profile");
        }
      }
      const selectedOldDayId = existingDays.find((day) => day.dayIndex === current.nextDayIndex)?.id;
      await tx.update(trainingSplitsTable).set({
        name: body.data.name.trim(),
        startDate: body.data.startDate,
        cycleLengthWeeks: body.data.cycleLengthWeeks,
      }).where(eq(trainingSplitsTable.id, splitId));
      // Avoid transient collisions on the unique (split_id, day_index) index.
      for (const day of existingDays) {
        await tx.update(splitDaysTable).set({ dayIndex: -day.id - 1 }).where(eq(splitDaysTable.id, day.id));
      }
      const retainedDays: Array<{ id: number; dayIndex: number }> = [];
      for (const draft of body.data.days) {
        let dayId = draft.id;
        if (dayId === undefined) {
          const [created] = await tx.insert(splitDaysTable).values({
            splitId,
            name: draft.name.trim(),
            dayIndex: -1_000_000 - draft.dayIndex,
          }).returning({ id: splitDaysTable.id });
          dayId = created.id;
        } else {
          await tx.update(splitDaysTable).set({
            name: draft.name.trim(),
            dayIndex: -1_000_000 - draft.dayIndex,
          }).where(eq(splitDaysTable.id, dayId));
        }
        retainedDays.push({ id: dayId, dayIndex: draft.dayIndex });
        const original = await tx.select().from(splitDayExercisesTable).where(eq(splitDayExercisesTable.dayId, dayId));
        const originalPrescriptionIds = new Set(original.map((item) => item.id));
        if (draft.exercises.some((item) => item.id !== undefined && !originalPrescriptionIds.has(item.id))) {
          throw new Error("A supplied prescription ID must belong to its supplied day");
        }
        const keepPrescriptionIds: number[] = [];
        for (const item of draft.exercises) {
          const values = {
            dayId,
            exerciseId: item.exerciseId,
            orderIndex: item.orderIndex,
            targetSets: item.targetSets,
            minimumWorkingSets: item.minimumWorkingSets,
            maximumWorkingSets: item.maximumWorkingSets,
            targetRepsMin: item.targetRepsMin,
            targetRepsMax: item.targetRepsMax,
            targetRir: item.targetRir,
            targetWeight: item.targetWeight,
          };
          if (item.id === undefined) {
            await tx.insert(splitDayExercisesTable).values(values);
          } else {
            await tx.update(splitDayExercisesTable).set(values)
              .where(and(eq(splitDayExercisesTable.id, item.id), eq(splitDayExercisesTable.dayId, dayId)));
            keepPrescriptionIds.push(item.id);
          }
        }
        for (const old of original) {
          if (!keepPrescriptionIds.includes(old.id) && !draft.exercises.some((item) => item.id === old.id)) {
            await tx.delete(splitDayExercisesTable).where(eq(splitDayExercisesTable.id, old.id));
          }
        }
      }
      for (const day of existingDays) {
        if (!retainedDays.some((retained) => retained.id === day.id)) {
          await tx.delete(splitDaysTable).where(eq(splitDaysTable.id, day.id));
        }
      }
      for (const { id: dayId, dayIndex } of retainedDays) {
        await tx.update(splitDaysTable).set({ dayIndex })
          .where(eq(splitDaysTable.id, dayId));
      }
      const firstDayIndex = retainedDays.length
        ? Math.min(...retainedDays.map((day) => day.dayIndex))
        : 0;
      const nextDayIndex = selectedOldDayId === undefined
        ? firstDayIndex
        : retainedDays.find((day) => day.id === selectedOldDayId)?.dayIndex ??
          firstDayIndex;
      await tx.update(trainingSplitsTable).set({ nextDayIndex }).where(eq(trainingSplitsTable.id, splitId));
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to save mesocycle" });
    return;
  }
  res.json(SaveMesocycleResponse.parse(await getSplitTree(splitId)));
});

router.post("/splits/:splitId/days", async (req, res): Promise<void> => {
  const params = CreateSplitDayParams.safeParse(req.params);
  const body = CreateSplitDayBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      error: !params.success ? params.error.message : !body.success ? body.error.message : "Invalid request",
    });
    return;
  }
  const [split] = await db
    .select({ id: trainingSplitsTable.id })
    .from(trainingSplitsTable)
    .where(eq(trainingSplitsTable.id, params.data.splitId))
    .limit(1);
  if (!split) {
    res.status(404).json({ error: "Split not found" });
    return;
  }
  const [day] = await db
    .insert(splitDaysTable)
    .values({
      splitId: params.data.splitId,
      name: body.data.name.trim(),
      dayIndex: body.data.dayIndex,
    })
    .returning();
  const tree = await getSplitTree(params.data.splitId);
  const created = tree?.days.find((item) => item.id === day.id);
  res.status(201).json(CreateSplitDayResponse.parse(created));
});

router.patch("/split-days/:dayId", async (req, res): Promise<void> => {
  const params = UpdateSplitDayParams.safeParse(req.params);
  const body = UpdateSplitDayBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      error: !params.success ? params.error.message : !body.success ? body.error.message : "Invalid request",
    });
    return;
  }
  const [current] = await db
    .select()
    .from(splitDaysTable)
    .where(eq(splitDaysTable.id, params.data.dayId))
    .limit(1);
  if (!current) {
    res.status(404).json({ error: "Workout day not found" });
    return;
  }

  if (body.data.dayIndex !== undefined && body.data.dayIndex !== current.dayIndex) {
    const days = await db
      .select()
      .from(splitDaysTable)
      .where(eq(splitDaysTable.splitId, current.splitId))
      .orderBy(asc(splitDaysTable.dayIndex));
    const reordered = days.filter((day) => day.id !== current.id);
    const targetIndex = Math.max(0, Math.min(body.data.dayIndex, days.length - 1));
    reordered.splice(targetIndex, 0, current);
    await db.transaction(async (tx) => {
      for (const [index, day] of reordered.entries()) {
        await tx
          .update(splitDaysTable)
          .set({ dayIndex: 10_000 + index })
          .where(eq(splitDaysTable.id, day.id));
      }
      for (const [index, day] of reordered.entries()) {
        await tx
          .update(splitDaysTable)
          .set({ dayIndex: index })
          .where(eq(splitDaysTable.id, day.id));
      }
    });
  }
  if (body.data.name !== undefined) {
    await db
      .update(splitDaysTable)
      .set({ name: body.data.name.trim() })
      .where(eq(splitDaysTable.id, current.id));
  }
  const tree = await getSplitTree(current.splitId);
  res.json(
    UpdateSplitDayResponse.parse(
      tree?.days.find((day) => day.id === current.id),
    ),
  );
});

router.post(
  "/split-days/:dayId/exercises",
  async (req, res): Promise<void> => {
    const params = AddExerciseToSplitDayParams.safeParse(req.params);
    const body = AddExerciseToSplitDayBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success ? params.error.message : !body.success ? body.error.message : "Invalid request",
      });
      return;
    }
    const minSets = body.data.minimumWorkingSets ?? 1;
    const maxSets = body.data.maximumWorkingSets ?? 5;
    if (
      minSets > maxSets ||
      body.data.targetSets < minSets ||
      body.data.targetSets > maxSets ||
      body.data.targetRepsMin > body.data.targetRepsMax
    ) {
      res.status(400).json({ error: "Prescription sets and rep ranges must be within their configured bounds" });
      return;
    }
    const [day] = await db
      .select()
      .from(splitDaysTable)
      .where(eq(splitDaysTable.id, params.data.dayId))
      .limit(1);
    if (!day) {
      res.status(404).json({ error: "Workout day not found" });
      return;
    }
    const [split] = await db
      .select()
      .from(trainingSplitsTable)
      .where(eq(trainingSplitsTable.id, day.splitId))
      .limit(1);
    const exercise = await getExerciseById(body.data.exerciseId);
    if (!exercise || (exercise.profileId !== null && exercise.profileId !== split?.profileId)) {
      res.status(404).json({ error: "Exercise not found for this profile" });
      return;
    }
    const [created] = await db
      .insert(splitDayExercisesTable)
      .values({ ...body.data, dayId: day.id })
      .returning();
    res
      .status(201)
      .json(AddExerciseToSplitDayResponse.parse({ ...created, exercise }));
  },
);

router.patch(
  "/split-day-exercises/:dayExerciseId",
  async (req, res): Promise<void> => {
    const params = UpdateSplitDayExerciseParams.safeParse(req.params);
    const body = UpdateSplitDayExerciseBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success ? params.error.message : !body.success ? body.error.message : "Invalid request",
      });
      return;
    }
    const updates = body.data;
    const [current] = await db.select().from(splitDayExercisesTable)
      .where(eq(splitDayExercisesTable.id, params.data.dayExerciseId))
      .limit(1);
    if (!current) {
      res.status(404).json({ error: "Exercise prescription not found" });
      return;
    }
    const minimumWorkingSets = updates.minimumWorkingSets ?? current.minimumWorkingSets;
    const maximumWorkingSets = updates.maximumWorkingSets ?? current.maximumWorkingSets;
    const targetSets = updates.targetSets ?? current.targetSets;
    const targetRepsMin = updates.targetRepsMin ?? current.targetRepsMin;
    const targetRepsMax = updates.targetRepsMax ?? current.targetRepsMax;
    if (
      minimumWorkingSets > maximumWorkingSets ||
      targetSets < minimumWorkingSets ||
      targetSets > maximumWorkingSets ||
      targetRepsMin > targetRepsMax
    ) {
      res.status(400).json({ error: "Prescription sets and rep ranges must be within their configured bounds" });
      return;
    }
    const [updated] = await db
      .update(splitDayExercisesTable)
      .set(updates)
      .where(eq(splitDayExercisesTable.id, params.data.dayExerciseId))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Exercise prescription not found" });
      return;
    }
    const exercise = await getExerciseById(updated.exerciseId);
    res.json(UpdateSplitDayExerciseResponse.parse({ ...updated, exercise }));
  },
);

router.delete(
  "/split-day-exercises/:dayExerciseId",
  async (req, res): Promise<void> => {
    const params = RemoveExerciseFromSplitDayParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [deleted] = await db
      .delete(splitDayExercisesTable)
      .where(eq(splitDayExercisesTable.id, params.data.dayExerciseId))
      .returning({ id: splitDayExercisesTable.id });
    if (!deleted) {
      res.status(404).json({ error: "Exercise prescription not found" });
      return;
    }
    res.sendStatus(204);
  },
);

export default router;