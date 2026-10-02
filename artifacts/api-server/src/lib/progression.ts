import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import {
  db,
  exercisesTable,
  muscleRecoveryTable,
  profilesTable,
  workoutExercisesTable,
  workoutSessionsTable,
  workoutSetsTable,
} from "@workspace/db";
import {
  adaptiveRepsForWeight,
  calculateProgression,
  snapToLoadIncrement,
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

export const PROGRESSION_ALGORITHM_VERSION = "legendary-v2.1";

export async function getProfileLoadIncrement(profileId: number, exerciseId: number, weightUnit: "lb" | "kg") {
  const [[profile], [exercise]] = await Promise.all([
    db.select().from(profilesTable).where(eq(profilesTable.id, profileId)).limit(1),
    db.select().from(exercisesTable).where(eq(exercisesTable.id, exerciseId)).limit(1),
  ]);
  if (!profile || !exercise) throw new Error("Profile or exercise not found");
  const displayIncrement = (weightUnit === "lb" ? exercise.loadIncrementLb : exercise.loadIncrementKg) ??
    (weightUnit === "lb" ? profile.loadIncrementLb : profile.loadIncrementKg);
  // All engine loads are canonical kilograms, including the increment itself.
  return weightUnit === "lb" ? displayIncrement / 2.20462262185 : displayIncrement;
}

export async function getRecentExposures(profileId: number, exerciseId: number): Promise<Exposure[][]> {
  const sessions = await db
    .select({ id: workoutSessionsTable.id })
    .from(workoutSessionsTable)
    .innerJoin(workoutExercisesTable, eq(workoutExercisesTable.sessionId, workoutSessionsTable.id))
    .where(and(
      eq(workoutSessionsTable.profileId, profileId),
      eq(workoutSessionsTable.status, "completed"),
      or(
        isNull(workoutSessionsTable.weekKindSnapshot),
        eq(workoutSessionsTable.weekKindSnapshot, "loading"),
      ),
      isNull(workoutSessionsTable.recoveryMode),
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
          sql`${workoutSetsTable.actualReps} > 0`,
          sql`${workoutSetsTable.actualRir} BETWEEN 0 AND 10`,
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
  loadIncrement = 2.5,
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
      or(
        isNull(workoutSessionsTable.weekKindSnapshot),
        eq(workoutSessionsTable.weekKindSnapshot, "loading"),
      ),
      isNull(workoutSessionsTable.recoveryMode),
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
      or(
        isNull(workoutSessionsTable.weekKindSnapshot),
        eq(workoutSessionsTable.weekKindSnapshot, "loading"),
      ),
      isNull(workoutSessionsTable.recoveryMode),
      eq(workoutExercisesTable.exerciseId, exerciseId),
      eq(workoutExercisesTable.skipped, false),
    ))
    .orderBy(desc(workoutSessionsTable.startedAt), desc(workoutSessionsTable.id))
    .limit(1);
  const recommendation = calculateProgression({
    exercise: { ...exercise, loadIncrement },
    exposures,
    recoveryHistory,
    weeklyMuscleSets,
    painReported: painReported || latest?.painReported,
  });
  if (recommendation.recommendedWeight !== null) {
    const previousWeight = recommendation.recommendedWeight;
    recommendation.recommendedWeight = snapToLoadIncrement(previousWeight, loadIncrement);
    if (recommendation.recommendedReps !== null && recommendation.recommendedWeight !== previousWeight) {
      recommendation.recommendedReps = adaptiveRepsForWeight(
        recommendation.recommendedWeight, previousWeight, recommendation.recommendedReps,
        exercise.targetRepsMin, exercise.targetRepsMax, exercise.targetRir,
      ).reps;
    }
  }
  return recommendation;
}