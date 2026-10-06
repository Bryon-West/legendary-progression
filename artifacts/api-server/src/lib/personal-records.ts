import { asc, eq } from "drizzle-orm";
import {
  db,
  profilesTable,
  workoutExercisesTable,
  workoutSessionsTable,
  workoutSetsTable,
} from "@workspace/db";
import {
  derivePersonalRecords,
  type PersonalRecordCandidate,
} from "./personal-records-core";

export async function getPersonalRecords(profileId: number) {
  const [profile] = await db
    .select({ weightUnit: profilesTable.weightUnit })
    .from(profilesTable)
    .where(eq(profilesTable.id, profileId))
    .limit(1);
  if (!profile) return null;

  const candidates: PersonalRecordCandidate[] = await db
    .select({
      exerciseId: workoutExercisesTable.exerciseId,
      exerciseName: workoutExercisesTable.exerciseName,
      category: workoutExercisesTable.category,
      sessionId: workoutSessionsTable.id,
      sessionDate: workoutSessionsTable.startedAt,
      sessionStatus: workoutSessionsTable.status,
      setId: workoutSetsTable.id,
      setNumber: workoutSetsTable.setNumber,
      setType: workoutSetsTable.setType,
      completed: workoutSetsTable.completed,
      removed: workoutSetsTable.removed,
      skipped: workoutExercisesTable.skipped,
      actualWeight: workoutSetsTable.actualWeight,
      actualReps: workoutSetsTable.actualReps,
      actualRir: workoutSetsTable.actualRir,
    })
    .from(workoutSetsTable)
    .innerJoin(workoutExercisesTable, eq(workoutExercisesTable.id, workoutSetsTable.workoutExerciseId))
    .innerJoin(workoutSessionsTable, eq(workoutSessionsTable.id, workoutExercisesTable.sessionId))
    .where(eq(workoutSessionsTable.profileId, profileId))
    .orderBy(
      asc(workoutSessionsTable.startedAt),
      asc(workoutSessionsTable.id),
      asc(workoutSetsTable.setNumber),
      asc(workoutSetsTable.id),
    );

  return {
    profileId,
    weightUnit: profile.weightUnit,
    // Workout-set weights are stored in canonical kilograms; weightUnit is only
    // the profile's preferred display unit for clients.
    exercises: derivePersonalRecords(candidates, "kg"),
  };
}