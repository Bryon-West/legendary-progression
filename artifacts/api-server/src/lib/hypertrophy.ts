import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import {
  db,
  exercisesTable,
  muscleRecoveryTable,
  profilesTable,
  splitDayExercisesTable,
  splitDaysTable,
  trainingSplitsTable,
  workoutExercisesTable,
  workoutSessionsTable,
  workoutSetsTable,
} from "@workspace/db";
import { adaptiveRepsForWeight } from "./progression";
import { primaryMuscleVolume } from "./volume";

export async function getSplitTree(splitId: number) {
  const [split] = await db
    .select()
    .from(trainingSplitsTable)
    .where(eq(trainingSplitsTable.id, splitId))
    .limit(1);
  if (!split) return null;

  const days = await db
    .select()
    .from(splitDaysTable)
    .where(eq(splitDaysTable.splitId, splitId))
    .orderBy(asc(splitDaysTable.dayIndex));

  const resultDays = [];
  for (const day of days) {
    const prescriptions = await db
      .select()
      .from(splitDayExercisesTable)
      .where(eq(splitDayExercisesTable.dayId, day.id))
      .orderBy(asc(splitDayExercisesTable.orderIndex));
    const exercises = [];
    for (const prescription of prescriptions) {
      const [exercise] = await db
        .select()
        .from(exercisesTable)
        .where(eq(exercisesTable.id, prescription.exerciseId))
        .limit(1);
      if (exercise) exercises.push({ ...prescription, exercise });
    }
    resultDays.push({ ...day, exercises });
  }
  const elapsed = Math.max(
    0,
    Math.floor((Date.now() - new Date(`${split.startDate}T00:00:00Z`).getTime()) / 604800000),
  );
  return {
    ...split,
    currentWeek: Math.min(split.cycleLengthWeeks, elapsed + 1),
    days: resultDays,
  };
}

export async function getWorkoutTree(
  sessionId: number,
  includeSuperseded = false,
) {
  const [session] = await db
    .select()
    .from(workoutSessionsTable)
    .where(eq(workoutSessionsTable.id, sessionId))
    .limit(1);
  if (!session) return null;

  const rows = await db
    .select()
    .from(workoutExercisesTable)
    .where(eq(workoutExercisesTable.sessionId, sessionId))
    .orderBy(asc(workoutExercisesTable.orderIndex), asc(workoutExercisesTable.id));
  const selectedRows = includeSuperseded
    ? rows
    : rows.filter((row) => !row.superseded);

  const exercises = [];
  for (const row of selectedRows) {
    const sets = await db
      .select()
      .from(workoutSetsTable)
      .where(eq(workoutSetsTable.workoutExerciseId, row.id))
      .orderBy(asc(workoutSetsTable.setType), asc(workoutSetsTable.setNumber));
    exercises.push({
      ...row,
      sets: sets.map((set) => ({
        ...set,
        adaptiveWarning: !set.completed && set.actualWeight !== null
          ? adaptiveRepsForWeight(
              set.actualWeight,
              row.recommendedWeight ?? row.targetWeight,
              row.recommendedReps ?? row.targetRepsMin,
              row.targetRepsMin,
              row.targetRepsMax,
              row.targetRir,
            ).warning ?? set.targetExplanation
          : null,
      })),
    });
  }

  const muscleRecovery = await db
    .select({
      muscleGroup: muscleRecoveryTable.muscleGroup,
      status: muscleRecoveryTable.status,
    })
    .from(muscleRecoveryTable)
    .where(eq(muscleRecoveryTable.sessionId, sessionId));
  const totalRows = await db
    .select({
      muscleGroup: workoutExercisesTable.muscleGroup,
      actualWeight: workoutSetsTable.actualWeight,
      actualReps: workoutSetsTable.actualReps,
    })
    .from(workoutSetsTable)
    .innerJoin(
      workoutExercisesTable,
      eq(workoutSetsTable.workoutExerciseId, workoutExercisesTable.id),
    )
    .where(
      and(
        eq(workoutExercisesTable.sessionId, sessionId),
        eq(workoutExercisesTable.skipped, false),
        eq(workoutSetsTable.setType, "work"),
        eq(workoutSetsTable.completed, true),
        eq(workoutSetsTable.removed, false),
      ),
    )
    .orderBy(asc(workoutExercisesTable.orderIndex), asc(workoutExercisesTable.id), asc(workoutSetsTable.setNumber));
  const groupedVolume = primaryMuscleVolume(totalRows.flatMap((row) =>
    row.actualWeight !== null && row.actualReps !== null
      ? [{ muscleGroup: row.muscleGroup, weight: row.actualWeight, reps: row.actualReps }]
      : [],
  ));
  const muscleTotals = groupedVolume.muscleTotals;
  if (session.status === "completed" && muscleTotals.length) {
    const prefix = muscleTotals.slice(0, -1).reduce((total, item) => total + item.totalWeightLifted, 0);
    const last = muscleTotals[muscleTotals.length - 1];
    last.totalWeightLifted = session.totalVolume - prefix;
    let total = muscleTotals.reduce((sum, item) => sum + item.totalWeightLifted, 0);
    for (let attempt = 0; total !== session.totalVolume && attempt < 3; attempt++) {
      last.totalWeightLifted += session.totalVolume - total;
      total = muscleTotals.reduce((sum, item) => sum + item.totalWeightLifted, 0);
    }
  }
  const totalVolume = session.status === "completed"
    ? session.totalVolume
    : groupedVolume.totalVolume;
  return {
    id: session.id,
    profileId: session.profileId,
    splitId: session.splitId,
    splitDayId: session.splitDayId,
    splitName: session.splitName,
    dayName: session.dayName,
    status: session.status,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    totalVolume,
    readiness: session.readiness,
    mesocycleStartDate: session.mesocycleStartDate,
    mesocycleWeek: session.mesocycleWeek,
    muscleRecovery,
    muscleTotals,
    exercises,
  };
}

export async function calculateSessionVolume(sessionId: number) {
  const [result] = await db
    .select({
      volume: sql<number>`coalesce(sum(${workoutSetsTable.actualWeight} * ${workoutSetsTable.actualReps}), 0)::float`,
    })
    .from(workoutSetsTable)
    .innerJoin(
      workoutExercisesTable,
      eq(workoutSetsTable.workoutExerciseId, workoutExercisesTable.id),
    )
    .where(
      and(
        eq(workoutExercisesTable.sessionId, sessionId),
        eq(workoutSetsTable.setType, "work"),
        eq(workoutSetsTable.completed, true),
        eq(workoutSetsTable.removed, false),
        eq(workoutExercisesTable.skipped, false),
      ),
    );
  return result?.volume ?? 0;
}

export async function getWorkoutSummary(sessionId: number) {
  const [session] = await db
    .select()
    .from(workoutSessionsTable)
    .where(eq(workoutSessionsTable.id, sessionId))
    .limit(1);
  if (!session) return null;

  const exercises = await db
    .select({
      id: workoutExercisesTable.id,
      superseded: workoutExercisesTable.superseded,
      skipped: workoutExercisesTable.skipped,
    })
    .from(workoutExercisesTable)
    .where(eq(workoutExercisesTable.sessionId, sessionId));
  const performedSupersededExercises = await db
    .select({ id: workoutExercisesTable.id })
    .from(workoutExercisesTable)
    .innerJoin(
      workoutSetsTable,
      eq(workoutSetsTable.workoutExerciseId, workoutExercisesTable.id),
    )
    .where(
      and(
        eq(workoutExercisesTable.sessionId, sessionId),
        eq(workoutExercisesTable.superseded, true),
        eq(workoutExercisesTable.skipped, false),
        eq(workoutSetsTable.setType, "work"),
        eq(workoutSetsTable.completed, true),
        eq(workoutSetsTable.removed, false),
      ),
    )
    .groupBy(workoutExercisesTable.id);
  const [setCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workoutSetsTable)
    .innerJoin(
      workoutExercisesTable,
      eq(workoutSetsTable.workoutExerciseId, workoutExercisesTable.id),
    )
    .where(
      and(
        eq(workoutExercisesTable.sessionId, sessionId),
        eq(workoutSetsTable.setType, "work"),
        eq(workoutSetsTable.completed, true),
        eq(workoutSetsTable.removed, false),
        eq(workoutExercisesTable.skipped, false),
      ),
    );
  const workoutTree = await getWorkoutTree(sessionId, true);

  return {
    id: session.id,
    profileId: session.profileId,
    splitName: session.splitName,
    dayName: session.dayName,
    status: "completed" as const,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    totalVolume: session.totalVolume,
    exerciseCount:
      exercises.filter((exercise) => !exercise.superseded && !exercise.skipped).length +
      performedSupersededExercises.length,
    workingSetCount: setCount?.count ?? 0,
    muscleTotals: workoutTree?.muscleTotals ?? [],
    mesocycleWeek: session.mesocycleWeek,
    readiness: session.readiness,
  };
}

export async function getNextWorkout(profileId: number) {
  const [split] = await db
    .select()
    .from(trainingSplitsTable)
    .where(eq(trainingSplitsTable.profileId, profileId))
    .orderBy(asc(trainingSplitsTable.createdAt), asc(trainingSplitsTable.id))
    .limit(1);
  if (!split) return null;

  const days = await db
    .select()
    .from(splitDaysTable)
    .where(eq(splitDaysTable.splitId, split.id))
    .orderBy(asc(splitDaysTable.dayIndex));
  if (!days.length) return null;

  const day = days.find((item) => item.dayIndex === split.nextDayIndex) ?? days[0];
  const [count] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(splitDayExercisesTable)
    .where(eq(splitDayExercisesTable.dayId, day.id));

  return {
    splitId: split.id,
    splitName: split.name,
    dayId: day.id,
    dayName: day.name,
    dayIndex: day.dayIndex,
    exerciseCount: count?.count ?? 0,
  };
}

export async function getProfileOverview(profileId: number) {
  const [profile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.id, profileId))
    .limit(1);
  if (!profile) return null;

  const [active] = await db
    .select({ id: workoutSessionsTable.id })
    .from(workoutSessionsTable)
    .where(
      and(
        eq(workoutSessionsTable.profileId, profileId),
        eq(workoutSessionsTable.status, "active"),
      ),
    )
    .limit(1);
  const activeWorkout = active ? await getWorkoutTree(active.id) : null;

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setUTCHours(0, 0, 0, 0);
  weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
  const thisWeek = await db
    .select()
    .from(workoutSessionsTable)
    .where(
      and(
        eq(workoutSessionsTable.profileId, profileId),
        eq(workoutSessionsTable.status, "completed"),
        gte(workoutSessionsTable.startedAt, weekStart),
      ),
    );
  const recent = await db
    .select({ id: workoutSessionsTable.id })
    .from(workoutSessionsTable)
    .where(
      and(
        eq(workoutSessionsTable.profileId, profileId),
        eq(workoutSessionsTable.status, "completed"),
      ),
    )
    .orderBy(desc(workoutSessionsTable.startedAt))
    .limit(4);
  const recentWorkouts = [];
  for (const item of recent) {
    const summary = await getWorkoutSummary(item.id);
    if (summary) recentWorkouts.push(summary);
  }
  const weeklyMuscleSets = await db
    .select({
      muscleGroup: workoutExercisesTable.muscleGroup,
      workingSetCount: sql<number>`count(*)::int`,
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
    .where(and(
      eq(workoutSessionsTable.profileId, profileId),
      eq(workoutSetsTable.setType, "work"),
      eq(workoutSetsTable.completed, true),
      eq(workoutSetsTable.removed, false),
      eq(workoutExercisesTable.skipped, false),
      gte(workoutSessionsTable.startedAt, weekStart),
    ))
    .groupBy(workoutExercisesTable.muscleGroup)
    .orderBy(asc(workoutExercisesTable.muscleGroup));
  const previouslyTrainedMuscleRows = await db
    .select({ muscleGroup: workoutExercisesTable.muscleGroup })
    .from(workoutSetsTable)
    .innerJoin(
      workoutExercisesTable,
      eq(workoutSetsTable.workoutExerciseId, workoutExercisesTable.id),
    )
    .innerJoin(
      workoutSessionsTable,
      eq(workoutExercisesTable.sessionId, workoutSessionsTable.id),
    )
    .where(and(
      eq(workoutSessionsTable.profileId, profileId),
      eq(workoutSessionsTable.status, "completed"),
      eq(workoutSetsTable.setType, "work"),
      eq(workoutSetsTable.completed, true),
      eq(workoutSetsTable.removed, false),
      eq(workoutExercisesTable.skipped, false),
    ))
    .groupBy(workoutExercisesTable.muscleGroup)
    .orderBy(asc(workoutExercisesTable.muscleGroup));

  return {
    profile,
    activeWorkout,
    nextWorkout: await getNextWorkout(profileId),
    workoutsThisWeek: thisWeek.length,
    volumeThisWeek: thisWeek.reduce((total, item) => total + item.totalVolume, 0),
    recentWorkouts,
    weeklyMuscleSets,
    previouslyTrainedMuscles: previouslyTrainedMuscleRows.map((row) => row.muscleGroup),
  };
}

export async function listWorkoutSummaries(profileId: number) {
  const sessions = await db
    .select({ id: workoutSessionsTable.id })
    .from(workoutSessionsTable)
    .where(
      and(
        eq(workoutSessionsTable.profileId, profileId),
        eq(workoutSessionsTable.status, "completed"),
      ),
    )
    .orderBy(desc(workoutSessionsTable.startedAt))
    .limit(100);
  const results = [];
  for (const session of sessions) {
    const summary = await getWorkoutSummary(session.id);
    if (summary) results.push(summary);
  }
  return results;
}

export async function getExerciseHistory(profileId: number, exerciseId: number) {
  return db
    .select({
      sessionId: workoutSessionsTable.id,
      sessionDate: workoutSessionsTable.startedAt,
      dayName: workoutSessionsTable.dayName,
      setNumber: workoutSetsTable.setNumber,
      setType: workoutSetsTable.setType,
      targetWeight: workoutSetsTable.targetWeight,
      targetRepsMin: workoutSetsTable.targetRepsMin,
      targetRepsMax: workoutSetsTable.targetRepsMax,
      actualWeight: workoutSetsTable.actualWeight,
      actualReps: workoutSetsTable.actualReps,
      actualRir: workoutSetsTable.actualRir,
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
    .where(
      and(
        eq(workoutSessionsTable.profileId, profileId),
        eq(workoutSessionsTable.status, "completed"),
        eq(workoutExercisesTable.exerciseId, exerciseId),
        eq(workoutExercisesTable.skipped, false),
        eq(workoutSetsTable.completed, true),
        eq(workoutSetsTable.removed, false),
      ),
    )
    .orderBy(desc(workoutSessionsTable.startedAt), asc(workoutSetsTable.setNumber))
    .limit(60);
}

export async function getExerciseById(exerciseId: number) {
  const [exercise] = await db
    .select()
    .from(exercisesTable)
    .where(eq(exercisesTable.id, exerciseId))
    .limit(1);
  return exercise ?? null;
}

export async function getActiveSession(profileId: number) {
  const [session] = await db
    .select({ id: workoutSessionsTable.id })
    .from(workoutSessionsTable)
    .where(
      and(
        eq(workoutSessionsTable.profileId, profileId),
        eq(workoutSessionsTable.status, "active"),
      ),
    )
    .limit(1);
  return session ? getWorkoutTree(session.id) : null;
}

export async function getDayExerciseCount(dayId: number) {
  const [count] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(splitDayExercisesTable)
    .where(eq(splitDayExercisesTable.dayId, dayId));
  return count?.count ?? 0;
}

export async function getCompletedWeekIds(profileId: number, start: Date) {
  const sessions = await db
    .select({ id: workoutSessionsTable.id })
    .from(workoutSessionsTable)
    .where(
      and(
        eq(workoutSessionsTable.profileId, profileId),
        eq(workoutSessionsTable.status, "completed"),
        gte(workoutSessionsTable.startedAt, start),
      ),
    );
  return sessions.map((session) => session.id);
}

export async function countWorkoutSets(sessionId: number) {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workoutSetsTable)
    .innerJoin(
      workoutExercisesTable,
      eq(workoutSetsTable.workoutExerciseId, workoutExercisesTable.id),
    )
    .where(eq(workoutExercisesTable.sessionId, sessionId));
  return result?.count ?? 0;
}