import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  CreateMesocycleBody,
  CreateMesocycleResponse,
  GetExerciseBaselineParams,
  GetExerciseBaselineResponse,
  GetMesocycleCalendarQueryParams,
  GetMesocycleCalendarResponse,
  GetMesocycleCopyOptionsQueryParams,
  GetMesocycleCopyOptionsResponse,
  GetMesocycleParams,
  GetMesocycleResponse,
  GetProfileEngineSettingsParams,
  GetProfileEngineSettingsResponse,
  ListMesocycleTemplatesResponse,
  RemoveMesocycleWeekParams,
  ReschedulePlannedWorkoutBody,
  ReschedulePlannedWorkoutParams,
  ReschedulePlannedWorkoutResponse,
  SaveMesocycleBody,
  SaveMesocycleParams,
  SaveMesocycleResponse,
  UpdateProfileEngineSettingsBody,
  UpdateProfileEngineSettingsParams,
  UpdateProfileEngineSettingsResponse,
} from "@workspace/api-zod";
import {
  db,
  exerciseBaselinesTable,
  exercisesTable,
  mesocycleWeeksTable,
  plannedWorkoutsTable,
  profilesTable,
  splitDayExercisesTable,
  splitDaysTable,
  trainingSplitsTable,
  workoutSessionsTable,
} from "@workspace/db";
import { getExerciseBaseline } from "../lib/baseline";
import {
  adaptiveRepsForWeight,
  getProfileLoadIncrement,
  recommendationForExercise,
} from "../lib/progression";
import {
  fixedWeekRange,
  isCopyEligibleWeek,
  isDateInsideWeek,
  recoverySpacingWarning,
  selectRecommendedCopyWeek,
} from "../lib/workout-core";

const router: IRouter = Router();
const DAY_MS = 86400000;
const CALIBRATION_INSTRUCTION = "Choose a weight you believe you can perform at approximately 3 RIR.";

type DayPlan = {
  id?: number;
  name: string;
  dayIndex: number;
  exercises: Array<{
    id?: number;
    exerciseId: number;
    orderIndex: number;
    targetSets: number;
    minimumWorkingSets: number;
    maximumWorkingSets: number;
    targetRepsMin: number;
    targetRepsMax: number;
    targetRir: number;
    targetWeight?: number | null;
  }>;
};
type WeekPlan = {
  id?: number;
  weekIndex: number;
  kind: "loading" | "deload" | "week_off";
  targetRir: number;
  scheduledWorkouts: Array<{ dayIndex: number; scheduledDate: string; id?: number }>;
};

function plusDays(date: string, count: number) {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + count);
  return result.toISOString().slice(0, 10);
}

function dateDayDelta(from: string, to: string) {
  return Math.round((new Date(`${to}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) / 86_400_000);
}

function snapshotFromDays(days: Array<{
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
}>) {
  return {
    version: 1,
    days: days.map((day) => ({
      dayIndex: day.dayIndex,
      name: day.name,
      exercises: [...day.exercises]
        .sort((left, right) => left.orderIndex - right.orderIndex)
        .map((exercise) => ({ ...exercise })),
    })),
  };
}

function snapshotDays(snapshot: unknown): DayPlan[] {
  if (!snapshot || typeof snapshot !== "object" || !("days" in snapshot) ||
    !Array.isArray((snapshot as { days?: unknown }).days)) return [];
  const days = (snapshot as { days: unknown[] }).days;
  return days.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const day = value as Partial<DayPlan>;
    if (typeof day.name !== "string" || typeof day.dayIndex !== "number" || !Array.isArray(day.exercises)) return [];
    const exercises = day.exercises.filter((item) =>
      item && typeof item.exerciseId === "number" && typeof item.orderIndex === "number" &&
      typeof item.targetSets === "number" && typeof item.minimumWorkingSets === "number" &&
      typeof item.maximumWorkingSets === "number" && typeof item.targetRepsMin === "number" &&
      typeof item.targetRepsMax === "number" && typeof item.targetRir === "number",
    ).map((item) => ({
      exerciseId: item.exerciseId,
      orderIndex: item.orderIndex,
      targetSets: item.targetSets,
      minimumWorkingSets: item.minimumWorkingSets,
      maximumWorkingSets: item.maximumWorkingSets,
      targetRepsMin: item.targetRepsMin,
      targetRepsMax: item.targetRepsMax,
      targetRir: item.targetRir,
      targetWeight: item.targetWeight ?? null,
    }));
    return exercises.length === day.exercises.length
      ? [{ dayIndex: day.dayIndex, name: day.name, exercises }]
      : [];
  });
}

async function getMesocycleTree(splitId: number) {
  const [split] = await db.select().from(trainingSplitsTable)
    .where(eq(trainingSplitsTable.id, splitId)).limit(1);
  if (!split) return null;
  const days = await db.select().from(splitDaysTable)
    .where(and(eq(splitDaysTable.splitId, splitId), eq(splitDaysTable.isArchived, false)))
    .orderBy(asc(splitDaysTable.dayIndex));
  const daysWithExercises = [];
  for (const day of days) {
    const rows = await db.select().from(splitDayExercisesTable)
      .where(eq(splitDayExercisesTable.dayId, day.id))
      .orderBy(asc(splitDayExercisesTable.orderIndex));
    const exercises = [];
    for (const prescription of rows) {
      const [exercise] = await db.select().from(exercisesTable)
        .where(eq(exercisesTable.id, prescription.exerciseId)).limit(1);
      if (exercise) exercises.push({ ...prescription, exercise });
    }
    daysWithExercises.push({ ...day, exercises });
  }
  const weeks = await db.select().from(mesocycleWeeksTable)
    .where(eq(mesocycleWeeksTable.splitId, splitId))
    .orderBy(asc(mesocycleWeeksTable.weekIndex));
  const populatedWeeks = [];
  for (const week of weeks) {
    const occurrences = await db.select({
      occurrence: plannedWorkoutsTable,
      dayName: splitDaysTable.name,
      sessionId: workoutSessionsTable.id,
    }).from(plannedWorkoutsTable)
      .innerJoin(splitDaysTable, eq(plannedWorkoutsTable.splitDayId, splitDaysTable.id))
      .leftJoin(workoutSessionsTable, eq(workoutSessionsTable.plannedWorkoutId, plannedWorkoutsTable.id))
      .where(eq(plannedWorkoutsTable.weekId, week.id))
      .orderBy(asc(plannedWorkoutsTable.scheduledDate), asc(plannedWorkoutsTable.id));
    populatedWeeks.push({
      ...week,
      scheduledWorkouts: occurrences.map(({ occurrence, dayName, sessionId }) => ({
        id: occurrence.id,
        splitId: occurrence.splitId,
        weekId: occurrence.weekId,
        weekIndex: week.weekIndex,
        splitDayId: occurrence.splitDayId,
        dayName,
        scheduledDate: occurrence.scheduledDate,
        originalScheduledDate: occurrence.originalScheduledDate,
        status: occurrence.status,
        sessionId,
      })),
    });
  }
  const currentWeek = weeks.find((week) => week.status === "in_progress")?.weekIndex ??
    weeks.find((week) => week.status === "future")?.weekIndex ?? 1;
  return {
    id: split.id,
    profileId: split.profileId,
    name: split.name,
    nextDayIndex: split.nextDayIndex,
    startDate: split.startDate,
    cycleLengthWeeks: split.cycleLengthWeeks,
    currentWeek,
    days: daysWithExercises,
    weeks: populatedWeeks,
    sourceDescription: weeks.find((week) => week.sourceDescription)?.sourceDescription ?? null,
  };
}

async function assertExerciseOwnership(exerciseIds: number[], profileId: number) {
  const unique = [...new Set(exerciseIds)];
  const rows = unique.length
    ? await db.select({ id: exercisesTable.id, profileId: exercisesTable.profileId })
      .from(exercisesTable).where(inArray(exercisesTable.id, unique))
    : [];
  if (rows.length !== unique.length ||
    rows.some((row) => row.profileId !== null && row.profileId !== profileId)) {
    throw new Error("An exercise is unavailable to this profile");
  }
}

function validateDraft(days: DayPlan[], weeks: WeekPlan[], startDate: string, enforceWeekDates = true) {
  if (!days.length || !weeks.length) throw new Error("A complete draft needs at least one workout day and week");
  if (new Set(days.map((day) => day.dayIndex)).size !== days.length) {
    throw new Error("Workout day indexes must be unique");
  }
  if (new Set(weeks.map((week) => week.weekIndex)).size !== weeks.length) {
    throw new Error("Week indexes must be unique");
  }
  const ordered = [...weeks].sort((a, b) => a.weekIndex - b.weekIndex);
  ordered.forEach((week, index) => {
    if (week.weekIndex !== index + 1) throw new Error("Weeks must be ordered contiguously starting at Week 1");
    if (week.kind === "week_off" && week.scheduledWorkouts.length) {
      throw new Error("Week Off cannot contain scheduled lifting workouts");
    }
    if (week.kind !== "week_off" && !week.scheduledWorkouts.length) {
      throw new Error("Loading and deload weeks need at least one scheduled workout");
    }
    const range = fixedWeekRange(startDate, week.weekIndex);
    for (const occurrence of week.scheduledWorkouts) {
      if (!days.some((day) => day.dayIndex === occurrence.dayIndex)) {
        throw new Error("A planned workout references a missing workout day");
      }
      if (enforceWeekDates && !isDateInsideWeek(occurrence.scheduledDate, range.startDate, range.endDate)) {
        throw new Error(`Workout date ${occurrence.scheduledDate} is outside its fixed mesocycle week`);
      }
    }
  });
}

const templateLayouts: Array<{ id: string; name: string; description: string; days: Array<{ name: string; exercises: Array<[string, number, number, number]> }> }> = [
  { id: "legendary-full-body-3", name: "Legendary Full Body — 3 Day", description: "Balanced full-body training with alternating emphasis.", days: [
    { name: "Full Body A", exercises: [["Barbell Bench Press", 3, 6, 10], ["Barbell Back Squat", 3, 6, 10], ["Seated Cable Row", 3, 8, 12], ["Romanian Deadlift", 2, 8, 12], ["Cable Lateral Raise", 2, 12, 20]] },
    { name: "Full Body B", exercises: [["Incline Dumbbell Press", 3, 8, 12], ["Leg Press", 3, 8, 12], ["Lat Pulldown", 3, 8, 12], ["Seated Leg Curl", 2, 10, 15], ["Dumbbell Curl", 2, 10, 15]] },
    { name: "Full Body C", exercises: [["Dumbbell Bench Press", 3, 8, 12], ["Romanian Deadlift", 3, 6, 10], ["Chest-Supported Dumbbell Row", 3, 8, 12], ["Leg Extension", 2, 10, 15], ["Cable Rope Triceps Pushdown", 2, 10, 15]] },
  ] },
  { id: "legendary-upper-lower-4", name: "Legendary Upper/Lower — 4 Day", description: "Twice-weekly upper and lower emphasis with balanced compounds and accessories.", days: [
    { name: "Upper A", exercises: [["Barbell Bench Press", 3, 6, 10], ["Lat Pulldown", 3, 8, 12], ["Seated Cable Row", 3, 8, 12], ["Seated Dumbbell Shoulder Press", 2, 8, 12], ["Cable Rope Triceps Pushdown", 2, 10, 15], ["Dumbbell Curl", 2, 10, 15]] },
    { name: "Lower A", exercises: [["Barbell Back Squat", 3, 6, 10], ["Romanian Deadlift", 3, 6, 10], ["Leg Press", 2, 10, 15], ["Seated Leg Curl", 2, 10, 15], ["Standing Calf Raise", 3, 10, 15]] },
    { name: "Upper B", exercises: [["Incline Dumbbell Press", 3, 8, 12], ["Chest-Supported Lat Row", 3, 8, 12], ["Cable Chest Fly", 2, 12, 20], ["Cable Lateral Raise", 3, 12, 20], ["Face Pull", 2, 12, 20], ["Overhead Cable Triceps Extension", 2, 10, 15]] },
    { name: "Lower B", exercises: [["Barbell Front Squat", 3, 6, 10], ["Barbell Hip Thrust", 3, 8, 12], ["Leg Extension", 2, 10, 15], ["Lying Leg Curl", 3, 10, 15], ["Seated Calf Raise", 3, 10, 15]] },
  ] },
  { id: "legendary-push-pull-4", name: "Legendary Push/Pull — 4 Day", description: "Alternating upper-body push and pull sessions with supporting leg work.", days: [
    { name: "Push A", exercises: [["Barbell Bench Press", 3, 6, 10], ["Seated Dumbbell Shoulder Press", 3, 8, 12], ["Cable Chest Fly", 2, 12, 20], ["Cable Lateral Raise", 3, 12, 20], ["Cable Rope Triceps Pushdown", 3, 10, 15], ["Leg Press", 3, 8, 12]] },
    { name: "Pull A", exercises: [["Lat Pulldown", 3, 8, 12], ["Barbell Bent-Over Row", 3, 6, 10], ["Face Pull", 2, 12, 20], ["Dumbbell Curl", 3, 10, 15], ["Romanian Deadlift", 3, 6, 10], ["Seated Leg Curl", 2, 10, 15]] },
    { name: "Push B", exercises: [["Incline Dumbbell Press", 3, 8, 12], ["Machine Shoulder Press", 3, 8, 12], ["Pec Deck Fly", 2, 12, 20], ["Machine Lateral Raise", 3, 12, 20], ["Overhead Cable Triceps Extension", 3, 10, 15], ["Leg Extension", 3, 10, 15]] },
    { name: "Pull B", exercises: [["Pull-Up", 3, 6, 10], ["Seated Cable Row", 3, 8, 12], ["Chest-Supported Dumbbell Row", 2, 8, 12], ["Rope Cable Hammer Curl", 3, 10, 15], ["Barbell Hip Thrust", 3, 8, 12], ["Standing Calf Raise", 3, 10, 15]] },
  ] },
  { id: "legendary-ppl-3", name: "Legendary PPL — 3 Day", description: "Push, pull, and legs with balanced weekly set distribution.", days: [
    { name: "Push", exercises: [["Barbell Bench Press", 3, 6, 10], ["Incline Dumbbell Press", 3, 8, 12], ["Seated Dumbbell Shoulder Press", 2, 8, 12], ["Cable Lateral Raise", 3, 12, 20], ["Cable Rope Triceps Pushdown", 3, 10, 15]] },
    { name: "Pull", exercises: [["Lat Pulldown", 3, 8, 12], ["Barbell Bent-Over Row", 3, 6, 10], ["Seated Cable Row", 2, 8, 12], ["Face Pull", 2, 12, 20], ["Dumbbell Curl", 3, 10, 15]] },
    { name: "Legs", exercises: [["Barbell Back Squat", 3, 6, 10], ["Romanian Deadlift", 3, 6, 10], ["Leg Press", 2, 10, 15], ["Seated Leg Curl", 2, 10, 15], ["Standing Calf Raise", 3, 10, 15]] },
  ] },
  { id: "legendary-ppl-6", name: "Legendary PPL — 6 Day", description: "Two rotating push, pull, and legs sessions with manageable per-day volume.", days: [
    { name: "Push A", exercises: [["Barbell Bench Press", 3, 6, 10], ["Seated Dumbbell Shoulder Press", 3, 8, 12], ["Cable Lateral Raise", 3, 12, 20], ["Cable Rope Triceps Pushdown", 3, 10, 15]] },
    { name: "Pull A", exercises: [["Lat Pulldown", 3, 8, 12], ["Barbell Bent-Over Row", 3, 6, 10], ["Face Pull", 2, 12, 20], ["Dumbbell Curl", 3, 10, 15]] },
    { name: "Legs A", exercises: [["Barbell Back Squat", 3, 6, 10], ["Romanian Deadlift", 3, 6, 10], ["Leg Extension", 2, 10, 15], ["Standing Calf Raise", 3, 10, 15]] },
    { name: "Push B", exercises: [["Incline Dumbbell Press", 3, 8, 12], ["Machine Shoulder Press", 2, 8, 12], ["Pec Deck Fly", 3, 12, 20], ["Overhead Cable Triceps Extension", 3, 10, 15]] },
    { name: "Pull B", exercises: [["Pull-Up", 3, 6, 10], ["Chest-Supported Lat Row", 3, 8, 12], ["Cable Rear Delt Fly", 2, 12, 20], ["Rope Cable Hammer Curl", 3, 10, 15]] },
    { name: "Legs B", exercises: [["Leg Press", 3, 8, 12], ["Barbell Hip Thrust", 3, 8, 12], ["Lying Leg Curl", 3, 10, 15], ["Seated Calf Raise", 3, 10, 15]] },
  ] },
  { id: "legendary-hypertrophy-5", name: "Legendary Hypertrophy — 5 Day", description: "Five focused sessions distributing upper and lower body work across the week.", days: [
    { name: "Chest & Back", exercises: [["Barbell Bench Press", 3, 6, 10], ["Incline Dumbbell Press", 3, 8, 12], ["Lat Pulldown", 3, 8, 12], ["Seated Cable Row", 3, 8, 12], ["Cable Chest Fly", 2, 12, 20]] },
    { name: "Lower A", exercises: [["Barbell Back Squat", 3, 6, 10], ["Romanian Deadlift", 3, 6, 10], ["Leg Press", 2, 10, 15], ["Standing Calf Raise", 3, 10, 15]] },
    { name: "Shoulders & Arms", exercises: [["Seated Dumbbell Shoulder Press", 3, 8, 12], ["Cable Lateral Raise", 3, 12, 20], ["Face Pull", 2, 12, 20], ["Dumbbell Curl", 3, 10, 15], ["Cable Rope Triceps Pushdown", 3, 10, 15]] },
    { name: "Lower B", exercises: [["Barbell Front Squat", 3, 6, 10], ["Barbell Hip Thrust", 3, 8, 12], ["Seated Leg Curl", 3, 10, 15], ["Leg Extension", 2, 10, 15]] },
    { name: "Upper", exercises: [["Dumbbell Bench Press", 3, 8, 12], ["Chest-Supported Dumbbell Row", 3, 8, 12], ["Machine Shoulder Press", 2, 8, 12], ["Cable Rear Delt Fly", 2, 12, 20], ["Incline Dumbbell Curl", 2, 10, 15], ["Overhead Cable Triceps Extension", 2, 10, 15]] },
  ] },
  { id: "legendary-time-saver-3", name: "Legendary Time Saver — 3 Day", description: "Efficient full-body sessions emphasizing compound patterns and a few accessories.", days: [
    { name: "Efficient A", exercises: [["Barbell Bench Press", 3, 6, 10], ["Leg Press", 3, 8, 12], ["Lat Pulldown", 3, 8, 12], ["Dumbbell Romanian Deadlift", 2, 8, 12], ["Cable Lateral Raise", 2, 12, 20]] },
    { name: "Efficient B", exercises: [["Incline Dumbbell Press", 3, 8, 12], ["Barbell Back Squat", 3, 6, 10], ["Seated Cable Row", 3, 8, 12], ["Lying Leg Curl", 2, 10, 15], ["Dumbbell Curl", 2, 10, 15]] },
    { name: "Efficient C", exercises: [["Dumbbell Bench Press", 3, 8, 12], ["Barbell Hip Thrust", 3, 8, 12], ["Pull-Up", 3, 6, 10], ["Leg Extension", 2, 10, 15], ["Cable Rope Triceps Pushdown", 2, 10, 15]] },
  ] },
  { id: "legendary-time-saver-4", name: "Legendary Time Saver — 4 Day", description: "Compact upper/lower split with concise sessions and balanced weekly frequency.", days: [
    { name: "Upper A", exercises: [["Barbell Bench Press", 3, 6, 10], ["Lat Pulldown", 3, 8, 12], ["Seated Cable Row", 2, 8, 12], ["Cable Lateral Raise", 2, 12, 20], ["Cable Rope Triceps Pushdown", 2, 10, 15]] },
    { name: "Lower A", exercises: [["Barbell Back Squat", 3, 6, 10], ["Romanian Deadlift", 3, 6, 10], ["Leg Extension", 2, 10, 15], ["Standing Calf Raise", 2, 10, 15]] },
    { name: "Upper B", exercises: [["Incline Dumbbell Press", 3, 8, 12], ["Chest-Supported Lat Row", 3, 8, 12], ["Machine Shoulder Press", 2, 8, 12], ["Face Pull", 2, 12, 20], ["Dumbbell Curl", 2, 10, 15]] },
    { name: "Lower B", exercises: [["Leg Press", 3, 8, 12], ["Barbell Hip Thrust", 3, 8, 12], ["Seated Leg Curl", 3, 10, 15], ["Seated Calf Raise", 2, 10, 15]] },
  ] },
];

async function resolveTemplateLayouts() {
  const catalog = await db.select().from(exercisesTable).where(isNull(exercisesTable.profileId));
  const byName = new Map<string, typeof catalog[number]>();
  for (const exercise of catalog) {
    byName.set(exercise.name.toLowerCase(), exercise);
    for (const alias of exercise.aliases) byName.set(alias.toLowerCase(), exercise);
  }
  const templates = [];
  for (const layout of templateLayouts) {
    const days: DayPlan[] = [];
    let complete = true;
    for (const [dayIndex, day] of layout.days.entries()) {
      const exercises = [];
      for (const [orderIndex, [name, targetSets, targetRepsMin, targetRepsMax]] of day.exercises.entries()) {
        const exercise = byName.get(name.toLowerCase());
        if (!exercise) {
          complete = false;
          break;
        }
        exercises.push({
          exerciseId: exercise.id,
          orderIndex,
          targetSets,
          minimumWorkingSets: Math.max(1, targetSets - 1),
          maximumWorkingSets: Math.min(20, targetSets + 2),
          targetRepsMin,
          targetRepsMax,
          targetRir: 2,
          targetWeight: null,
        });
      }
      days.push({ name: day.name, dayIndex, exercises });
    }
    if (complete) templates.push({
      templateId: layout.id,
      name: layout.name,
      description: layout.description,
      days,
      defaultLoadingRirs: [3, 2, 1, 0],
    });
  }
  return templates;
}

async function validateCopyWeek(profileId: number, weekId: number) {
  const [row] = await db.select({
    week: mesocycleWeeksTable,
    split: trainingSplitsTable,
  }).from(mesocycleWeeksTable)
    .innerJoin(trainingSplitsTable, eq(mesocycleWeeksTable.splitId, trainingSplitsTable.id))
    .where(and(
      eq(mesocycleWeeksTable.id, weekId),
      eq(trainingSplitsTable.profileId, profileId),
    )).limit(1);
  if (!row || !isCopyEligibleWeek(row.week) || !row.week.programSnapshot) {
    throw new Error("Only fully completed loading weeks with a structural snapshot can be copied");
  }
  return row;
}

router.get("/profiles/:profileId/engine-settings", async (req, res): Promise<void> => {
  const params = GetProfileEngineSettingsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [profile] = await db.select().from(profilesTable)
    .where(eq(profilesTable.id, params.data.profileId)).limit(1);
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  res.json(GetProfileEngineSettingsResponse.parse({
    profileId: profile.id,
    baselineExpiryWeeks: profile.baselineExpiryWeeks,
    loadIncrementLb: profile.loadIncrementLb,
    loadIncrementKg: profile.loadIncrementKg,
    deloadSetFraction: profile.deloadSetFraction,
    deloadLoadFraction: profile.deloadLoadFraction,
    deloadRir: profile.deloadRir,
  }));
});

router.patch("/profiles/:profileId/engine-settings", async (req, res): Promise<void> => {
  const params = UpdateProfileEngineSettingsParams.safeParse(req.params);
  const body = UpdateProfileEngineSettingsBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : body.error?.message ?? "Invalid request" });
    return;
  }
  const profile = await db.transaction(async (tx) => {
    const [previous] = await tx.select().from(profilesTable)
      .where(eq(profilesTable.id, params.data.profileId)).for("update").limit(1);
    if (!previous) return undefined;
    const [updated] = await tx.update(profilesTable).set(body.data)
      .where(eq(profilesTable.id, previous.id)).returning();
    if (body.data.baselineExpiryWeeks !== undefined &&
      body.data.baselineExpiryWeeks !== previous.baselineExpiryWeeks) {
      const difference = body.data.baselineExpiryWeeks - previous.baselineExpiryWeeks;
      await tx.update(exerciseBaselinesTable).set({
        expiresAt: sql`${exerciseBaselinesTable.expiresAt} + ${difference} * interval '7 days'`,
        updatedAt: new Date(),
      }).where(eq(exerciseBaselinesTable.profileId, previous.id));
    }
    return updated;
  });
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  res.json(UpdateProfileEngineSettingsResponse.parse({
    profileId: profile.id,
    baselineExpiryWeeks: profile.baselineExpiryWeeks,
    loadIncrementLb: profile.loadIncrementLb,
    loadIncrementKg: profile.loadIncrementKg,
    deloadSetFraction: profile.deloadSetFraction,
    deloadLoadFraction: profile.deloadLoadFraction,
    deloadRir: profile.deloadRir,
  }));
});

router.get("/mesocycles/templates", async (_req, res): Promise<void> => {
  const templates = await resolveTemplateLayouts();
  res.json(ListMesocycleTemplatesResponse.parse(templates));
});

router.get("/mesocycles/copy-options", async (req, res): Promise<void> => {
  const query = GetMesocycleCopyOptionsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const candidates = await db.select({
    week: mesocycleWeeksTable,
    split: trainingSplitsTable,
  }).from(mesocycleWeeksTable)
    .innerJoin(trainingSplitsTable, eq(mesocycleWeeksTable.splitId, trainingSplitsTable.id))
    .where(eq(trainingSplitsTable.profileId, query.data.profileId));
  const eligible = [];
  for (const row of candidates) {
    if (!isCopyEligibleWeek(row.week) || !row.week.programSnapshot) continue;
    const sessions = await db.select({ endedAt: workoutSessionsTable.endedAt })
      .from(workoutSessionsTable)
      .where(and(
        eq(workoutSessionsTable.weekId, row.week.id),
        eq(workoutSessionsTable.status, "completed"),
      ));
    const scheduled = await db.select({ id: plannedWorkoutsTable.id, status: plannedWorkoutsTable.status })
      .from(plannedWorkoutsTable)
      .where(eq(plannedWorkoutsTable.weekId, row.week.id));
    const completedOccurrenceIds = await db.select({ id: workoutSessionsTable.plannedWorkoutId })
      .from(workoutSessionsTable)
      .where(and(
        eq(workoutSessionsTable.weekId, row.week.id),
        eq(workoutSessionsTable.status, "completed"),
      ));
    const completedIds = new Set(completedOccurrenceIds.map((item) => item.id));
    const fullyCompleted = scheduled.length > 0 && scheduled.every((item) =>
      item.status === "completed" && completedIds.has(item.id),
    );
    if (!fullyCompleted) continue;
    const completedAt = sessions.reduce<Date | null>((latest, session) =>
      !session.endedAt || (latest && latest > session.endedAt) ? latest : session.endedAt, null);
    eligible.push({
      weekId: row.week.id,
      splitId: row.split.id,
      mesocycleName: row.split.name,
      weekIndex: row.week.weekIndex,
      completedAt: completedAt ?? row.week.createdAt,
      description: `${row.split.name} — Week ${row.week.weekIndex}`,
      kind: row.week.kind,
      status: row.week.status,
      days: snapshotDays(row.week.programSnapshot),
    });
  }
  const copyReady = eligible.filter((week) => week.days.length > 0);
  const recommended = selectRecommendedCopyWeek(copyReady);
  res.json(GetMesocycleCopyOptionsResponse.parse({
    recommendedWeekId: recommended?.weekId ?? null,
    eligibleWeeks: copyReady.map(({ weekId, splitId, mesocycleName, weekIndex, completedAt, description, days }) =>
      ({ weekId, splitId, mesocycleName, weekIndex, completedAt, description, days })),
  }));
});

router.post("/mesocycles", async (req, res): Promise<void> => {
  const body = CreateMesocycleBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const draft = body.data;
  try {
    validateDraft(draft.days as DayPlan[], draft.weeks as WeekPlan[], draft.startDate);
    const [profile] = await db.select().from(profilesTable)
      .where(eq(profilesTable.id, draft.profileId)).limit(1);
    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }
    await assertExerciseOwnership(
      draft.days.flatMap((day) => day.exercises.map((exercise) => exercise.exerciseId)),
      profile.id,
    );
    let sourceDescription = draft.sourceDescription ?? null;
    let sourceSplitId: number | null = null;
    if (draft.createMode === "template") {
      if (!draft.templateId || !(await resolveTemplateLayouts()).some((template) => template.templateId === draft.templateId)) {
        res.status(400).json({ error: "A valid editable templateId is required for template creation" });
        return;
      }
    }
    if (draft.createMode === "copy_completed_week") {
      if (!draft.sourceWeekId) {
        res.status(400).json({ error: "sourceWeekId is required when copying a completed week" });
        return;
      }
      const source = await validateCopyWeek(draft.profileId, draft.sourceWeekId);
      sourceDescription = sourceDescription ?? `${source.split.name} — Week ${source.week.weekIndex}`;
      sourceSplitId = source.split.id;
    }
    const cycleLengthWeeks = draft.cycleLengthWeeks ?? draft.weeks.length;
    const split = await db.transaction(async (tx) => {
      const [createdSplit] = await tx.insert(trainingSplitsTable).values({
        profileId: draft.profileId,
        name: draft.name.trim(),
        startDate: draft.startDate,
        cycleLengthWeeks,
      }).returning();
      const dayIds = new Map<number, number>();
      for (const day of draft.days) {
        const [createdDay] = await tx.insert(splitDaysTable).values({
          splitId: createdSplit.id,
          name: day.name.trim(),
          dayIndex: day.dayIndex,
        }).returning();
        dayIds.set(day.dayIndex, createdDay.id);
        for (const item of day.exercises) {
          await tx.insert(splitDayExercisesTable).values({
            dayId: createdDay.id,
            exerciseId: item.exerciseId,
            orderIndex: item.orderIndex,
            targetSets: item.targetSets,
            minimumWorkingSets: item.minimumWorkingSets,
            maximumWorkingSets: item.maximumWorkingSets,
            targetRepsMin: item.targetRepsMin,
            targetRepsMax: item.targetRepsMax,
            targetRir: item.targetRir,
            targetWeight: item.targetWeight ?? null,
          });
        }
      }
      const snapshot = snapshotFromDays(draft.days.map((day) => ({
        dayIndex: day.dayIndex,
        name: day.name,
        exercises: day.exercises.map((exercise) => ({
          ...exercise,
          targetWeight: exercise.targetWeight ?? null,
        })),
      })));
      for (const week of draft.weeks) {
        const [createdWeek] = await tx.insert(mesocycleWeeksTable).values({
          splitId: createdSplit.id,
          weekIndex: week.weekIndex,
          kind: week.kind,
          targetRir: week.targetRir,
          status: "future",
          programSnapshot: snapshot,
          sourceSplitId,
          sourceWeekId: draft.createMode === "copy_completed_week" ? draft.sourceWeekId : null,
          sourceDescription,
        }).returning();
        for (const occurrence of week.scheduledWorkouts) {
          const dayId = dayIds.get(occurrence.dayIndex);
          if (!dayId) throw new Error("Occurrence references an unknown dayIndex");
          await tx.insert(plannedWorkoutsTable).values({
            splitId: createdSplit.id,
            weekId: createdWeek.id,
            splitDayId: dayId,
            scheduledDate: occurrence.scheduledDate,
            originalScheduledDate: occurrence.scheduledDate,
          });
        }
      }
      return createdSplit;
    });
    const tree = await getMesocycleTree(split.id);
    res.status(201).json(CreateMesocycleResponse.parse(tree));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to create mesocycle" });
  }
});

router.put("/splits/:splitId", async (req, res): Promise<void> => {
  const params = SaveMesocycleParams.safeParse(req.params);
  const body = SaveMesocycleBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : body.error?.message ?? "Invalid request" });
    return;
  }
  const splitId = params.data.splitId;
  const draft = body.data;
  try {
    validateDraft(draft.days as DayPlan[], draft.weeks as WeekPlan[], draft.startDate, false);
    const [split] = await db.select().from(trainingSplitsTable)
      .where(eq(trainingSplitsTable.id, splitId)).limit(1);
    if (!split) {
      res.status(404).json({ error: "Mesocycle not found" });
      return;
    }
    await assertExerciseOwnership(
      draft.days.flatMap((day) => day.exercises.map((exercise) => exercise.exerciseId)),
      split.profileId,
    );
    await db.transaction(async (tx) => {
      const existingWeeks = await tx.select().from(mesocycleWeeksTable)
        .where(eq(mesocycleWeeksTable.splitId, splitId));
      const suppliedWeekIds = draft.weeks.flatMap((week) => week.id === undefined ? [] : [week.id]);
      const existingWeekIds = new Set(existingWeeks.map((week) => week.id));
      if (new Set(suppliedWeekIds).size !== suppliedWeekIds.length ||
        suppliedWeekIds.some((id) => !existingWeekIds.has(id))) {
        throw new Error("Invalid or duplicate mesocycle week ID");
      }
      const preservedWeekIds = new Set<number>();
      const submittedWeeksById = new Map(draft.weeks.flatMap((week) =>
        week.id === undefined ? [] : [[week.id, week] as const]));
      for (const week of existingWeeks) {
        const hasActiveSession = await tx.select({ id: workoutSessionsTable.id })
          .from(workoutSessionsTable)
          .where(and(
            eq(workoutSessionsTable.weekId, week.id),
            eq(workoutSessionsTable.status, "active"),
          )).limit(1);
        const protectedWeek = week.status !== "future" || hasActiveSession.length > 0;
        const submitted = submittedWeeksById.get(week.id);
        if (protectedWeek) {
          if (!submitted) throw new Error("Started or completed weeks cannot be removed");
          if (submitted.weekIndex !== week.weekIndex || submitted.kind !== week.kind ||
            submitted.targetRir !== week.targetRir) {
            throw new Error("Started or completed week programming is protected");
          }
          if (draft.startDate !== split.startDate) {
            throw new Error("The mesocycle start date cannot change after a week has started");
          }
          preservedWeekIds.add(week.id);
        }
      }
      const allDays = await tx.select().from(splitDaysTable).where(eq(splitDaysTable.splitId, splitId));
      const dayIndexById = new Map(allDays.map((day) => [day.id, day.dayIndex]));
      for (const weekId of preservedWeekIds) {
        const originalOccurrences = await tx.select().from(plannedWorkoutsTable)
          .where(eq(plannedWorkoutsTable.weekId, weekId));
        const submitted = submittedWeeksById.get(weekId)!;
        if (submitted.scheduledWorkouts.length !== originalOccurrences.length) {
          throw new Error("Started or completed week schedules are protected");
        }
        for (const occurrence of originalOccurrences) {
          const requested = submitted.scheduledWorkouts.find((item) => item.id === occurrence.id);
          const submittedDay = draft.days.find((day) => day.id === occurrence.splitDayId);
          if (!requested || requested.scheduledDate !== occurrence.scheduledDate ||
            dayIndexById.get(occurrence.splitDayId) !== requested.dayIndex ||
            submittedDay?.dayIndex !== dayIndexById.get(occurrence.splitDayId)) {
            throw new Error("Started or completed week schedules are protected");
          }
        }
      }

      const existingDays = await tx.select().from(splitDaysTable)
        .where(and(eq(splitDaysTable.splitId, splitId), eq(splitDaysTable.isArchived, false)));
      const knownDayIds = new Set(existingDays.map((day) => day.id));
      const suppliedDayIds = draft.days.flatMap((day) => day.id === undefined ? [] : [day.id]);
      if (new Set(suppliedDayIds).size !== suppliedDayIds.length ||
        suppliedDayIds.some((id) => !knownDayIds.has(id))) throw new Error("Invalid or duplicate workout day ID");
      const allPrescriptionRows = existingDays.length
        ? await tx.select().from(splitDayExercisesTable)
          .where(inArray(splitDayExercisesTable.dayId, existingDays.map((day) => day.id)))
        : [];
      const allPrescriptionIds = new Set(allPrescriptionRows.map((row) => row.id));
      const submittedPrescriptionIds = draft.days.flatMap((day) =>
        day.exercises.flatMap((exercise) => exercise.id === undefined ? [] : [exercise.id]));
      if (new Set(submittedPrescriptionIds).size !== submittedPrescriptionIds.length ||
        submittedPrescriptionIds.some((id) => !allPrescriptionIds.has(id))) {
        throw new Error("Invalid or duplicate exercise prescription ID");
      }

      // Keep day identifiers referenced by completed history; archive removed days rather than delete/rewrite them.
      for (const day of existingDays) {
        await tx.update(splitDaysTable).set({ dayIndex: -day.id - 1 })
          .where(eq(splitDaysTable.id, day.id));
      }
      const resolvedDays = new Map<number, number>();
      const retainedIds = new Set<number>();
      for (const day of draft.days) {
        let dayId = day.id;
        if (dayId === undefined) {
          const [created] = await tx.insert(splitDaysTable).values({
            splitId,
            name: day.name.trim(),
            dayIndex: -1_000_000 - day.dayIndex,
            isArchived: false,
          }).returning({ id: splitDaysTable.id });
          dayId = created.id;
        } else {
          await tx.update(splitDaysTable).set({
            name: day.name.trim(),
            dayIndex: -1_000_000 - day.dayIndex,
            isArchived: false,
          }).where(eq(splitDaysTable.id, dayId));
          retainedIds.add(dayId);
        }
        resolvedDays.set(day.dayIndex, dayId);
        const previous = await tx.select().from(splitDayExercisesTable)
          .where(eq(splitDayExercisesTable.dayId, dayId));
        const keep = new Set<number>();
        for (const exercise of day.exercises) {
          const values = {
            dayId,
            exerciseId: exercise.exerciseId,
            orderIndex: exercise.orderIndex,
            targetSets: exercise.targetSets,
            minimumWorkingSets: exercise.minimumWorkingSets,
            maximumWorkingSets: exercise.maximumWorkingSets,
            targetRepsMin: exercise.targetRepsMin,
            targetRepsMax: exercise.targetRepsMax,
            targetRir: exercise.targetRir,
            targetWeight: exercise.targetWeight ?? null,
          };
          if (exercise.id !== undefined) {
            if (!previous.some((item) => item.id === exercise.id)) {
              throw new Error("Exercise prescription ID belongs to another day");
            }
            await tx.update(splitDayExercisesTable).set(values)
              .where(and(eq(splitDayExercisesTable.id, exercise.id), eq(splitDayExercisesTable.dayId, dayId)));
            keep.add(exercise.id);
          } else {
            await tx.insert(splitDayExercisesTable).values(values);
          }
        }
        for (const row of previous) if (!keep.has(row.id) &&
          !day.exercises.some((exercise) => exercise.id === row.id)) {
          await tx.delete(splitDayExercisesTable).where(eq(splitDayExercisesTable.id, row.id));
        }
      }
      const removedDayIds = existingDays.filter((day) => !retainedIds.has(day.id)).map((day) => day.id);
      if (removedDayIds.length) await tx.update(splitDaysTable)
        .set({ isArchived: true })
        .where(inArray(splitDaysTable.id, removedDayIds));
      for (const day of draft.days) {
        await tx.update(splitDaysTable).set({ dayIndex: day.dayIndex })
          .where(eq(splitDaysTable.id, resolvedDays.get(day.dayIndex)!));
      }

      const submittedWeekIdsSet = new Set(suppliedWeekIds);
      // Stage indexes first so inserting/reordering weeks cannot transiently collide with the unique index.
      for (const week of existingWeeks) await tx.update(mesocycleWeeksTable)
        .set({ weekIndex: week.weekIndex + 10000 })
        .where(eq(mesocycleWeeksTable.id, week.id));
      for (const week of existingWeeks) if (!submittedWeekIdsSet.has(week.id)) {
        if (preservedWeekIds.has(week.id)) throw new Error("Started or completed weeks cannot be removed");
        await tx.delete(plannedWorkoutsTable).where(eq(plannedWorkoutsTable.weekId, week.id));
        await tx.delete(mesocycleWeeksTable).where(eq(mesocycleWeeksTable.id, week.id));
      }

      const snapshot = snapshotFromDays(draft.days.map((day) => ({
        dayIndex: day.dayIndex,
        name: day.name,
        exercises: day.exercises.map((exercise) => ({
          ...exercise,
          targetWeight: exercise.targetWeight ?? null,
        })),
      })));
      for (const week of draft.weeks) {
        const existing = week.id === undefined
          ? undefined
          : existingWeeks.find((row) => row.id === week.id);
        let weekId: number;
        if (!existing) {
          const [created] = await tx.insert(mesocycleWeeksTable).values({
            splitId,
            weekIndex: week.weekIndex,
            kind: week.kind,
            targetRir: week.targetRir,
            status: "future",
            programSnapshot: snapshot,
          }).returning({ id: mesocycleWeeksTable.id });
          weekId = created.id;
        } else {
          weekId = existing.id;
          await tx.update(mesocycleWeeksTable).set({
            weekIndex: week.weekIndex,
            kind: week.kind,
            targetRir: week.targetRir,
            ...(existing.status === "future" ? { programSnapshot: snapshot } : {}),
          }).where(eq(mesocycleWeeksTable.id, weekId));
        }
        if (existing && preservedWeekIds.has(existing.id)) continue;
        const currentOccurrences = await tx.select().from(plannedWorkoutsTable)
          .where(eq(plannedWorkoutsTable.weekId, weekId));
        const submittedIds = week.scheduledWorkouts.flatMap((item) => item.id === undefined ? [] : [item.id]);
        if (new Set(submittedIds).size !== submittedIds.length ||
          submittedIds.some((id) => !currentOccurrences.some((row) => row.id === id))) {
          throw new Error("Invalid or duplicate planned workout ID");
        }
        for (const occurrence of week.scheduledWorkouts) {
          const splitDayId = resolvedDays.get(occurrence.dayIndex);
          if (!splitDayId) throw new Error("Occurrence references an unknown workout day");
          const match = occurrence.id === undefined
            ? null
            : currentOccurrences.find((row) => row.id === occurrence.id);
          if (match) {
            const previousWeekIndex = existing?.weekIndex ?? week.weekIndex;
            const range = fixedWeekRange(draft.startDate, week.weekIndex);
            const scheduledDate = (week.weekIndex !== previousWeekIndex || draft.startDate !== split.startDate) &&
              occurrence.scheduledDate === match.scheduledDate
              ? plusDays(
                  match.scheduledDate,
                  dateDayDelta(split.startDate, draft.startDate) +
                    (week.weekIndex - previousWeekIndex) * 7,
                )
              : occurrence.scheduledDate;
            if (!isDateInsideWeek(scheduledDate, range.startDate, range.endDate)) {
              throw new Error("Planned workout date must remain inside its fixed week");
            }
            await tx.update(plannedWorkoutsTable).set({
              splitDayId,
              scheduledDate,
            }).where(eq(plannedWorkoutsTable.id, match.id));
          } else {
            const range = fixedWeekRange(draft.startDate, week.weekIndex);
            if (!isDateInsideWeek(occurrence.scheduledDate, range.startDate, range.endDate)) {
              throw new Error("Planned workout date must remain inside its fixed week");
            }
            await tx.insert(plannedWorkoutsTable).values({
              splitId,
              weekId,
              splitDayId,
              scheduledDate: occurrence.scheduledDate,
              originalScheduledDate: occurrence.scheduledDate,
            });
          }
        }
        for (const old of currentOccurrences) if (!submittedIds.includes(old.id)) {
          await tx.delete(plannedWorkoutsTable).where(eq(plannedWorkoutsTable.id, old.id));
        }
      }
      const oldNextDay = split.nextDayIndex;
      const nextDay = draft.days.some((day) => day.dayIndex === oldNextDay) ? oldNextDay : 0;
      await tx.update(trainingSplitsTable).set({
        name: draft.name.trim(),
        startDate: draft.startDate,
        cycleLengthWeeks: draft.cycleLengthWeeks ?? draft.weeks.length,
        nextDayIndex: nextDay,
      }).where(eq(trainingSplitsTable.id, splitId));
      if (draft.sourceDescription !== undefined) {
        for (const week of draft.weeks) {
          const existing = week.id === undefined
            ? undefined
            : existingWeeks.find((row) => row.id === week.id);
          if (!existing || !preservedWeekIds.has(existing.id)) {
            await tx.update(mesocycleWeeksTable).set({ sourceDescription: draft.sourceDescription })
              .where(and(
                eq(mesocycleWeeksTable.splitId, splitId),
                eq(mesocycleWeeksTable.weekIndex, week.weekIndex),
              ));
          }
        }
      }
    });
    const tree = await getMesocycleTree(splitId);
    res.json(SaveMesocycleResponse.parse(tree));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save mesocycle";
    const status = /started|completed|protected|active workout/i.test(message) ? 409 : 400;
    res.status(status).json({ error: message });
  }
});

router.delete("/mesocycles/:splitId/weeks/:weekId", async (req, res): Promise<void> => {
  const params = RemoveMesocycleWeekParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [week] = await db.select().from(mesocycleWeeksTable)
    .where(and(
      eq(mesocycleWeeksTable.id, params.data.weekId),
      eq(mesocycleWeeksTable.splitId, params.data.splitId),
    )).limit(1);
  if (!week) {
    res.status(404).json({ error: "Mesocycle week not found" });
    return;
  }
  try {
    await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(mesocycleWeeksTable)
        .where(and(
          eq(mesocycleWeeksTable.id, week.id),
          eq(mesocycleWeeksTable.splitId, week.splitId),
        )).for("update").limit(1);
      if (!locked || locked.status !== "future") {
        throw new Error("Started or completed weeks cannot be removed");
      }
      const sessions = await tx.select({ id: workoutSessionsTable.id })
        .from(workoutSessionsTable).where(eq(workoutSessionsTable.weekId, locked.id)).limit(1);
      if (sessions.length) throw new Error("A week with a workout session cannot be removed");
      const allWeeks = await tx.select().from(mesocycleWeeksTable)
        .where(eq(mesocycleWeeksTable.splitId, locked.splitId))
        .orderBy(asc(mesocycleWeeksTable.weekIndex));
      for (const following of allWeeks.filter((item) => item.weekIndex > locked.weekIndex)) {
        if (following.status !== "future") {
          throw new Error("Removing this week would renumber a started or completed week");
        }
        const hasSession = await tx.select({ id: workoutSessionsTable.id })
          .from(workoutSessionsTable).where(eq(workoutSessionsTable.weekId, following.id)).limit(1);
        if (hasSession.length) {
          throw new Error("Removing this week would renumber a week with workout history");
        }
      }
      await tx.delete(plannedWorkoutsTable).where(eq(plannedWorkoutsTable.weekId, locked.id));
      await tx.delete(mesocycleWeeksTable).where(eq(mesocycleWeeksTable.id, locked.id));
      const remaining = allWeeks.filter((item) => item.id !== locked.id);
      for (const item of remaining) await tx.update(mesocycleWeeksTable)
        .set({ weekIndex: item.weekIndex + 10000 }).where(eq(mesocycleWeeksTable.id, item.id));
      for (const [index, item] of remaining.entries()) {
        const nextIndex = index + 1;
        await tx.update(mesocycleWeeksTable)
          .set({ weekIndex: nextIndex }).where(eq(mesocycleWeeksTable.id, item.id));
        const shift = nextIndex - item.weekIndex;
        if (shift !== 0) {
          const occurrences = await tx.select().from(plannedWorkoutsTable)
            .where(eq(plannedWorkoutsTable.weekId, item.id));
          for (const occurrence of occurrences) await tx.update(plannedWorkoutsTable)
            .set({ scheduledDate: plusDays(occurrence.scheduledDate, shift * 7) })
            .where(eq(plannedWorkoutsTable.id, occurrence.id));
        }
      }
      await tx.update(trainingSplitsTable).set({ cycleLengthWeeks: remaining.length })
        .where(eq(trainingSplitsTable.id, locked.splitId));
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to remove week";
    res.status(/started|completed|history|session|renumber/i.test(message) ? 409 : 400).json({ error: message });
    return;
  }
  res.sendStatus(204);
});

router.get("/mesocycles/calendar", async (req, res): Promise<void> => {
  const query = GetMesocycleCalendarQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const [split] = await db.select().from(trainingSplitsTable)
    .where(and(
      eq(trainingSplitsTable.id, query.data.splitId),
      eq(trainingSplitsTable.profileId, query.data.profileId),
    )).limit(1);
  if (!split) {
    res.status(404).json({ error: "Mesocycle not found for this profile" });
    return;
  }
  const tree = await getMesocycleTree(split.id);
  const profile = await db.select().from(profilesTable).where(eq(profilesTable.id, split.profileId)).limit(1);
  const profileSettings = profile[0];
  const rangeStart = query.data.from ?? "0001-01-01";
  const rangeEnd = query.data.to ?? "9999-12-31";
  const result = [];
  for (const week of tree?.weeks ?? []) {
    const fixedRange = fixedWeekRange(split.startDate, week.weekIndex);
    if (fixedRange.endDate < rangeStart || fixedRange.startDate > rangeEnd) continue;
    const workouts = [];
    for (const occurrence of week.scheduledWorkouts) {
      const projectedExercises = [];
      const day = tree?.days.find((item) => item.id === occurrence.splitDayId);
      for (const prescription of day?.exercises ?? []) {
        const baseline = await getExerciseBaseline(split.profileId, prescription.exerciseId);
        const validBaseline = baseline.status === "active";
        const exercise = prescription.exercise;
        let targetSets = prescription.targetSets;
        let targetWeight: number | null = null;
        let targetRepsMin: number | null = null;
        let targetRepsMax: number | null = null;
        let recommendationExplanation: string | null = null;
        let calibrationMode = !validBaseline;
        let calibrationRir: 3 | null = calibrationMode ? 3 : null;
        if (week.kind === "deload") {
          targetSets = Math.max(1, Math.round(targetSets * (profileSettings?.deloadSetFraction ?? 0.5)));
        }
        let targetRir = week.kind === "deload"
          ? profileSettings?.deloadRir ?? 4
          : week.targetRir;
        if (validBaseline) {
          const increment = await getProfileLoadIncrement(
            split.profileId,
            exercise.id,
            profileSettings?.weightUnit ?? "kg",
          );
          const recommendation = await recommendationForExercise(
            split.profileId,
            exercise.id,
            {
              category: exercise.category,
              equipment: exercise.equipment,
              isCompound: exercise.isCompound,
              muscleGroup: exercise.muscleGroup,
              targetSets,
              minimumWorkingSets: prescription.minimumWorkingSets,
              maximumWorkingSets: prescription.maximumWorkingSets,
              targetRepsMin: prescription.targetRepsMin,
              targetRepsMax: prescription.targetRepsMax,
              targetRir,
              targetWeight: prescription.targetWeight,
            },
            0,
            false,
            increment,
          );
          targetWeight = recommendation.recommendedWeight;
          targetRepsMin = recommendation.recommendedReps;
          targetRepsMax = recommendation.recommendedReps;
          recommendationExplanation = recommendation.rationale;
          calibrationMode = false;
          calibrationRir = null;
        }
        if (week.kind === "deload" && targetWeight !== null) {
          targetWeight *= profileSettings?.deloadLoadFraction ?? 0.9;
          if (profileSettings?.weightUnit === "lb") {
            targetWeight = Math.round(targetWeight / (exercise.loadIncrementLb ?? profileSettings.loadIncrementLb)) *
              (exercise.loadIncrementLb ?? profileSettings.loadIncrementLb);
          } else {
            targetWeight = Math.round(targetWeight / (exercise.loadIncrementKg ?? profileSettings?.loadIncrementKg ?? 2.5)) *
              (exercise.loadIncrementKg ?? profileSettings?.loadIncrementKg ?? 2.5);
          }
        }
        if (profileSettings?.weightUnit === "lb" && targetWeight !== null) targetWeight /= 2.2046226218;
        projectedExercises.push({
          exerciseId: exercise.id,
          exerciseName: exercise.name,
          targetSets,
          targetRepsMin,
          targetRepsMax,
          targetWeight,
          targetRir,
          baselineStatus: baseline.status,
          calibrationMode,
          calibrationRir,
          calibrationInstruction: calibrationMode ? CALIBRATION_INSTRUCTION : null,
          recommendationExplanation,
        });
      }
      const relativeState = occurrence.scheduledDate < new Date().toISOString().slice(0, 10)
        ? "past"
        : occurrence.scheduledDate === new Date().toISOString().slice(0, 10) ? "today" : "future";
      workouts.push({
        ...occurrence,
        weekKind: week.kind,
        targetRir: week.targetRir,
        isToday: relativeState === "today",
        relativeState,
        projectedExercises,
      });
    }
    result.push({
      weekId: week.id,
      weekIndex: week.weekIndex,
      kind: week.kind,
      targetRir: week.targetRir,
      status: week.status,
      startDate: fixedRange.startDate,
      endDate: fixedRange.endDate,
      scheduledWorkouts: workouts,
    });
  }
  res.json(GetMesocycleCalendarResponse.parse(result));
});

// Static calendar/templates/copy URLs must precede the numeric detail route.
router.get("/mesocycles/:splitId", async (req, res): Promise<void> => {
  const params = GetMesocycleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const tree = await getMesocycleTree(params.data.splitId);
  if (!tree) {
    res.status(404).json({ error: "Mesocycle not found" });
    return;
  }
  res.json(GetMesocycleResponse.parse(tree));
});

router.patch("/planned-workouts/:plannedWorkoutId/reschedule", async (req, res): Promise<void> => {
  const params = ReschedulePlannedWorkoutParams.safeParse(req.params);
  const body = ReschedulePlannedWorkoutBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : body.error?.message ?? "Invalid request" });
    return;
  }
  const [current] = await db.select({
    occurrence: plannedWorkoutsTable,
    week: mesocycleWeeksTable,
    split: trainingSplitsTable,
    day: splitDaysTable,
  }).from(plannedWorkoutsTable)
    .innerJoin(mesocycleWeeksTable, eq(plannedWorkoutsTable.weekId, mesocycleWeeksTable.id))
    .innerJoin(trainingSplitsTable, eq(plannedWorkoutsTable.splitId, trainingSplitsTable.id))
    .innerJoin(splitDaysTable, eq(plannedWorkoutsTable.splitDayId, splitDaysTable.id))
    .where(eq(plannedWorkoutsTable.id, params.data.plannedWorkoutId)).limit(1);
  if (!current) {
    res.status(404).json({ error: "Planned workout not found" });
    return;
  }
  const range = fixedWeekRange(current.split.startDate, current.week.weekIndex);
  if (current.week.status !== "future" || current.occurrence.status !== "scheduled" ||
    !isDateInsideWeek(body.data.scheduledDate, range.startDate, range.endDate)) {
    res.status(409).json({ error: "Only future-week workouts may move and dates must remain within the fixed week" });
    return;
  }
  const oldDate = current.occurrence.scheduledDate;
  const delta = Math.round((new Date(`${body.data.scheduledDate}T00:00:00Z`).getTime() -
    new Date(`${oldDate}T00:00:00Z`).getTime()) / DAY_MS);
  await db.transaction(async (tx) => {
    await tx.update(plannedWorkoutsTable).set({ scheduledDate: body.data.scheduledDate })
      .where(eq(plannedWorkoutsTable.id, current.occurrence.id));
    if (body.data.shiftFollowing) {
      const following = await tx.select().from(plannedWorkoutsTable)
        .where(and(
          eq(plannedWorkoutsTable.weekId, current.week.id),
          sql`${plannedWorkoutsTable.scheduledDate} > ${oldDate}`,
          eq(plannedWorkoutsTable.status, "scheduled"),
        )).orderBy(asc(plannedWorkoutsTable.scheduledDate));
      for (const item of following) {
        const shifted = plusDays(item.scheduledDate, delta);
        if (isDateInsideWeek(shifted, range.startDate, range.endDate)) {
          await tx.update(plannedWorkoutsTable).set({ scheduledDate: shifted })
            .where(eq(plannedWorkoutsTable.id, item.id));
        }
      }
    }
  });
  const neighbors = await db.select({ scheduledDate: plannedWorkoutsTable.scheduledDate })
    .from(plannedWorkoutsTable)
    .where(and(
      eq(plannedWorkoutsTable.weekId, current.week.id),
      sql`${plannedWorkoutsTable.id} <> ${current.occurrence.id}`,
      eq(plannedWorkoutsTable.status, "scheduled"),
    ));
  const warning = neighbors.map((row) => recoverySpacingWarning(body.data.scheduledDate, row.scheduledDate))
    .find((value) => value !== null) ?? null;
  const updated = {
    id: current.occurrence.id,
    splitId: current.occurrence.splitId,
    weekId: current.week.id,
    weekIndex: current.week.weekIndex,
    splitDayId: current.occurrence.splitDayId,
    dayName: current.day.name,
    scheduledDate: body.data.scheduledDate,
    originalScheduledDate: current.occurrence.originalScheduledDate,
    status: current.occurrence.status,
    sessionId: null,
  };
  res.json(ReschedulePlannedWorkoutResponse.parse({
    workout: updated,
    recoveryWarning: warning !== null,
    warningMessage: warning,
  }));
});

router.get("/profiles/:profileId/exercises/:exerciseId/baseline", async (req, res): Promise<void> => {
  const params = GetExerciseBaselineParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const baseline = await getExerciseBaseline(params.data.profileId, params.data.exerciseId);
  res.json(GetExerciseBaselineResponse.parse(baseline));
});

export default router;