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
  adaptiveRepsForWeight as legacyAdaptiveReps,
  calculateProgression,
  snapToLoadIncrement,
  type Exposure,
  type ProgressionInput,
  type ProgressionRecommendation,
  type RecoveryObservation,
} from "./progression-core";
import { getExerciseBaseline } from "./baseline";
import { equivalence, prescribe } from "./legendary-v22-core";

export {
  calculateProgression,
  type Exposure,
  type ProgressionInput,
  type ProgressionRecommendation,
  type RecoveryObservation,
} from "./progression-core";

export const PROGRESSION_ALGORITHM_VERSION = "legendary-v2.3b";
export function adaptiveRepsForWeight(selectedWeight: number | null, baseWeight: number | null, baseReps: number, minReps: number, maxReps: number, targetRir = 2) {
  if (minReps !== 6 || maxReps !== 30) return legacyAdaptiveReps(selectedWeight, baseWeight, baseReps, minReps, maxReps, targetRir);
  if (selectedWeight === null || baseWeight === null) return { reps: null, warning: null };
  const estimate = equivalence(selectedWeight, { weight: baseWeight, reps: baseReps, rir: targetRir }, targetRir);
  return { reps: estimate.expected === null ? null : Math.max(6, Math.min(30, Math.round(estimate.expected))), warning: estimate.warning };
}

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
      sql`(${workoutExercisesTable.recoveryAdjustment} IS NULL OR ${workoutExercisesTable.recoveryAdjustment}='train_as_planned')`,
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
        sql`(${workoutExercisesTable.recoveryAdjustment} IS NULL OR ${workoutExercisesTable.recoveryAdjustment}='train_as_planned')`,
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
  if (exercise.targetRepsMin === 6 && exercise.targetRepsMax === 30) {
    const baseline = await getExerciseBaseline(profileId, exerciseId);
    const reference = baseline.status === "active" && baseline.lastWeight !== null && baseline.lastReps !== null && baseline.lastRir !== null
      ? { weight: baseline.lastWeight, reps: baseline.lastReps, rir: baseline.lastRir, prescribedRir: baseline.lastRir } : null;
    if (reference && baseline.sourceSessionId) {
      const [source] = await db.select().from(workoutExercisesTable).where(and(eq(workoutExercisesTable.sessionId, baseline.sourceSessionId), eq(workoutExercisesTable.exerciseId, exerciseId))).limit(1);
      reference.prescribedRir = source?.targetRir ?? reference.rir;
    }
    const result = prescribe(reference, exercise.targetRir, loadIncrement, !!exercise.isCompound);
    return { recommendedWeight: result.weight, recommendedReps: result.reps,
      targetSets: exercise.targetSets, outcome: "maintain", rationale: result.rationale };
  }
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