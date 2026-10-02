import { Router, type IRouter } from "express";
import { and, asc, eq, ilike, isNull, or } from "drizzle-orm";
import {
  AddExerciseToSplitDayBody,
  AddExerciseToSplitDayParams,
  CreateExerciseBody,
  CreateExerciseResponse,
  CreateProfileBody,
  CreateProfileResponse,
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
  AddExerciseToSplitDayResponse,
  UpdateProfileBody,
  UpdateProfileParams,
  UpdateProfileResponse,
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
} from "@workspace/db";
import {
  getExerciseById,
  getExerciseHistory,
  getProfileOverview,
  getSplitTree,
} from "../lib/hypertrophy";

const router: IRouter = Router();

router.get("/profiles", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(profilesTable)
    .orderBy(asc(profilesTable.createdAt), asc(profilesTable.id));
  res.json(ListProfilesResponse.parse(rows));
});

router.post("/profiles", async (req, res): Promise<void> => {
  const parsed = CreateProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [profile] = await db
    .insert(profilesTable)
    .values({ name: parsed.data.name.trim() })
    .returning();
  res.status(201).json(CreateProfileResponse.parse(profile));
});

router.patch("/profiles/:profileId", async (req, res): Promise<void> => {
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
    .set({ name: body.data.name.trim() })
    .where(eq(profilesTable.id, params.data.profileId))
    .returning();
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  res.json(UpdateProfileResponse.parse(profile));
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
    filters.push(ilike(exercisesTable.name, `%${parsed.data.search.trim()}%`));
  }
  if (parsed.data.muscleGroup?.trim()) {
    filters.push(eq(exercisesTable.muscleGroup, parsed.data.muscleGroup.trim()));
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
  const [exercise] = await db
    .insert(exercisesTable)
    .values({
      ...parsed.data,
      name: parsed.data.name.trim(),
      muscleGroup: parsed.data.muscleGroup.trim(),
      equipment: parsed.data.equipment.trim(),
      instructions: parsed.data.instructions?.trim() || null,
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
    .where(eq(trainingSplitsTable.profileId, parsed.data.profileId))
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
  const updates = { ...body.data };
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