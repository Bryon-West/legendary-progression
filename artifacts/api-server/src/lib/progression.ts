import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  muscleRecoveryTable,
  workoutExercisesTable,
  workoutSessionsTable,
  workoutSetsTable,
} from "@workspace/db";
import {
  adaptiveRepsForWeight,
  calculateProgression,
  type Exposure,
  type ProgressionInput,
  type ProgressionRecommendation,
  type RecoveryObservation,
} from "./progression-core";

export {
  adaptiveRepsForWeight,
  calculateProgression,
  type Exposure,
  type ProgressionInput,
  type ProgressionRecommendation,
  type RecoveryObservation,
} from "./progression-core";

export const PROGRESSION_ALGORITHM_VERSION = "v2.1";

export async function getRecentExposures(profileId: number, exerciseId: number): Promise<Exposure[][]> {
  const sessions = await db
    .select({ id: workoutSessionsTable.id })
    .from(workoutSessionsTable)
    .innerJoin(workoutExercisesTable, eq(workoutExercisesTable.sessionId, workoutSessionsTable.id))
    .where(and(
      eq(workoutSessionsTable.profileId, profileId),
      eq(workoutSessionsTable.status, "completed"),
      eq(workoutExercisesTable.exerciseId, exerciseId),
      eq(workoutExercisesTable.skipped, false),
    ))
    .groupBy(workoutSessionsTable.id, workoutSessionsTable.startedAt)
    .orderBy(desc(workoutSessionsTable.startedAt), desc(workoutSessionsTable.id))
    .limit(3);
  const exposures: Exposure[][] = [];
  for (const session of sessions) {
    const rows = await db
      .select({
        weight: workoutSetsTable.actualWeight,
        reps: workoutSetsTable.actualReps,
        rir: workoutSetsTable.actualRir,
        status: workoutSetsTable.targetStatus,
      })
      .from(workoutSetsTable)
      .innerJoin(workoutExercisesTable, eq(workoutSetsTable.workoutExerciseId, workoutExercisesTable.id))
      .where(and(
        eq(workoutExercisesTable.sessionId, session.id),
        eq(workoutExercisesTable.exerciseId, exerciseId),
        eq(workoutSetsTable.setType, "work"),
        eq(workoutSetsTable.completed, true),
        eq(workoutSetsTable.removed, false),
      ));
    exposures.push(rows.flatMap((row) =>
      row.weight !== null && row.reps !== null && row.rir !== null
        ? [{ weight: row.weight, reps: row.reps, rir: row.rir, status: row.status }]
        : [],
    ));
  }
  return exposures;
}

export async function recommendationForExercise(
  profileId: number,
  exerciseId: number,
  exercise: ProgressionInput["exercise"],
  weeklyMuscleSets: number,
  painReported = false,
): Promise<ProgressionRecommendation> {
  const exposures = await getRecentExposures(profileId, exerciseId);
  const recoveryHistoryRows = await db.select({
    sessionId: workoutSessionsTable.id,
    readiness: workoutSessionsTable.readiness,
    recoverySeverity: sql<number>`max(case
      when ${muscleRecoveryTable.status} in ('still_sore', 'very_sore') then 2
      when ${muscleRecoveryTable.status} = 'slightly_fatigued' then 1
      else 0
    end)::int`,
  })
    .from(muscleRecoveryTable)
    .innerJoin(workoutSessionsTable, eq(muscleRecoveryTable.sessionId, workoutSessionsTable.id))
    .where(and(
      eq(workoutSessionsTable.profileId, profileId),
      eq(workoutSessionsTable.status, "completed"),
      eq(muscleRecoveryTable.muscleGroup, exercise.muscleGroup),
    ))
    .groupBy(
      workoutSessionsTable.id,
      workoutSessionsTable.startedAt,
      workoutSessionsTable.readiness,
    )
    .orderBy(desc(workoutSessionsTable.startedAt), desc(workoutSessionsTable.id))
    .limit(3);
  const recoveryHistory: RecoveryObservation[] = recoveryHistoryRows.map((row) => ({
    readiness: row.readiness,
    muscleRecovery: row.recoverySeverity === 2
      ? "still_sore"
      : row.recoverySeverity === 1
        ? "slightly_fatigued"
        : "fully_recovered",
  }));
  const [latest] = await db.select({ painReported: workoutExercisesTable.painReported })
    .from(workoutExercisesTable)
    .innerJoin(workoutSessionsTable, eq(workoutExercisesTable.sessionId, workoutSessionsTable.id))
    .where(and(
      eq(workoutSessionsTable.profileId, profileId),
      eq(workoutSessionsTable.status, "completed"),
      eq(workoutExercisesTable.exerciseId, exerciseId),
      eq(workoutExercisesTable.skipped, false),
    ))
    .orderBy(desc(workoutSessionsTable.startedAt), desc(workoutSessionsTable.id))
    .limit(1);
  return calculateProgression({
    exercise,
    exposures,
    recoveryHistory,
    weeklyMuscleSets,
    painReported: painReported || latest?.painReported,
  });
}