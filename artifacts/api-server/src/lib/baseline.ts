import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  exerciseBaselinesTable,
  mesocycleWeeksTable,
  profilesTable,
  trainingSplitsTable,
  workoutExercisesTable,
  workoutSessionsTable,
  workoutSetsTable,
} from "@workspace/db";
import { baselineExpiryAfterPauses } from "./baseline-core";

export async function getExerciseBaseline(profileId: number, exerciseId: number, now = new Date()) {
  const [baseline] = await db.select().from(exerciseBaselinesTable)
    .where(and(
      eq(exerciseBaselinesTable.profileId, profileId),
      eq(exerciseBaselinesTable.exerciseId, exerciseId),
    )).limit(1);
  if (!baseline) return {
    exerciseId,
    status: "no_baseline" as const,
    sourceSessionId: null,
    sourceSetId: null,
    establishedAt: null,
    expiresAt: null,
    pausedWeekOffCount: 0,
    lastWeight: null,
    lastReps: null,
    lastRir: null,
  };

  const weeks = await db.select({
    startDate: trainingSplitsTable.startDate,
    weekIndex: mesocycleWeeksTable.weekIndex,
  }).from(mesocycleWeeksTable)
    .innerJoin(trainingSplitsTable, eq(mesocycleWeeksTable.splitId, trainingSplitsTable.id))
    .where(and(
      eq(trainingSplitsTable.profileId, profileId),
      eq(mesocycleWeeksTable.kind, "week_off"),
    ));
  const weekOffIntervals = weeks.map(({ startDate, weekIndex }) => {
    const start = new Date(`${startDate}T00:00:00.000Z`);
    start.setUTCDate(start.getUTCDate() + (weekIndex - 1) * 7);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    return { startsAt: start.toISOString().slice(0, 10), endsAt: end.toISOString().slice(0, 10) };
  });
  const adjusted = baselineExpiryAfterPauses({
    expiresAt: baseline.expiresAt,
    establishedAt: baseline.establishedAt,
    now,
    pausedWeekOffCount: baseline.pausedWeekOffCount,
    weekOffIntervals,
  });
  if (adjusted.pausedWeekOffCount !== baseline.pausedWeekOffCount) {
    await db.update(exerciseBaselinesTable).set({
      expiresAt: adjusted.expiresAt,
      pausedWeekOffCount: adjusted.pausedWeekOffCount,
      updatedAt: now,
    }).where(eq(exerciseBaselinesTable.id, baseline.id));
  }
  return {
    exerciseId,
    status: adjusted.expiresAt.getTime() >= now.getTime() ? "active" as const : "expired" as const,
    sourceSessionId: baseline.sourceSessionId,
    sourceSetId: baseline.sourceSetId,
    establishedAt: baseline.establishedAt,
    expiresAt: adjusted.expiresAt,
    pausedWeekOffCount: adjusted.pausedWeekOffCount,
    lastWeight: baseline.lastWeight,
    lastReps: baseline.lastReps,
    lastRir: baseline.lastRir,
  };
}

export async function updateBaselinesFromCompletedSession(sessionId: number) {
  const [session] = await db.select().from(workoutSessionsTable)
    .where(eq(workoutSessionsTable.id, sessionId)).limit(1);
  if (!session || session.status !== "completed" ||
    session.weekKindSnapshot === "deload" || session.weekKindSnapshot === "week_off" ||
    session.recoveryMode !== null) return;
  const [profile] = await db.select().from(profilesTable)
    .where(eq(profilesTable.id, session.profileId)).limit(1);
  if (!profile) return;
  const rows = await db.select({
    exerciseId: workoutExercisesTable.exerciseId,
    setId: workoutSetsTable.id,
    weight: workoutSetsTable.actualWeight,
    reps: workoutSetsTable.actualReps,
    rir: workoutSetsTable.actualRir,
    completedAt: workoutSetsTable.completedAt,
  }).from(workoutSetsTable)
    .innerJoin(workoutExercisesTable, eq(workoutSetsTable.workoutExerciseId, workoutExercisesTable.id))
    .where(and(
      eq(workoutExercisesTable.sessionId, sessionId),
      eq(workoutExercisesTable.skipped, false),
      sql`(${workoutExercisesTable.recoveryAdjustment} IS NULL OR ${workoutExercisesTable.recoveryAdjustment}='train_as_planned')`,
      eq(workoutSetsTable.setType, "work"),
      eq(workoutSetsTable.completed, true),
      eq(workoutSetsTable.removed, false),
      sql`${workoutSetsTable.actualReps} > 0`,
      sql`${workoutSetsTable.actualRir} BETWEEN 0 AND 10`,
      sql`${workoutSetsTable.actualWeight} IS NOT NULL`,
    )).orderBy(desc(workoutSetsTable.completedAt), desc(workoutSetsTable.id));
  const latestByExercise = new Map<number, typeof rows[number]>();
  for (const row of rows) if (!latestByExercise.has(row.exerciseId) &&
    row.weight !== null && row.reps !== null && row.rir !== null) {
    latestByExercise.set(row.exerciseId, row);
  }
  for (const [exerciseId, row] of latestByExercise) {
    const establishedAt = row.completedAt ?? session.endedAt ?? new Date();
    const expiresAt = new Date(establishedAt.getTime() + profile.baselineExpiryWeeks * 7 * 86400000);
    await db.insert(exerciseBaselinesTable).values({
      profileId: session.profileId,
      exerciseId,
      sourceSessionId: session.id,
      sourceSetId: row.setId,
      establishedAt,
      expiresAt,
      lastWeight: row.weight!,
      lastReps: row.reps!,
      lastRir: row.rir!,
    }).onConflictDoUpdate({
      target: [exerciseBaselinesTable.profileId, exerciseBaselinesTable.exerciseId],
      setWhere: sql`${exerciseBaselinesTable.establishedAt} <= ${establishedAt}
        AND ${exerciseBaselinesTable.sourceSetId} IS DISTINCT FROM ${row.setId}`,
      set: {
        sourceSessionId: session.id,
        sourceSetId: row.setId,
        establishedAt,
        expiresAt,
        lastWeight: row.weight!,
        lastReps: row.reps!,
        lastRir: row.rir!,
        pausedWeekOffCount: 0,
        updatedAt: new Date(),
      },
    });
  }
}