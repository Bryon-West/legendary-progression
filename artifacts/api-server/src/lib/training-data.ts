import { and, eq, inArray, sql } from "drizzle-orm";
import { db, trainingSplitsTable, profilesTable, plannedWorkoutsTable, workoutSessionsTable,
  workoutExercisesTable, workoutSetsTable, exerciseBaselinesTable, progressionRecommendationsTable } from "@workspace/db";

/** Archive the program, not the training evidence. Historical FK targets stay intact. */
export async function deleteMesocyclePreservingHistory(splitId: number, profileId: number) {
  await db.transaction(async tx => {
    await tx.select().from(profilesTable).where(eq(profilesTable.id, profileId)).for("update");
    const [split] = await tx.select().from(trainingSplitsTable)
      .where(and(eq(trainingSplitsTable.id, splitId), eq(trainingSplitsTable.profileId, profileId))).for("update");
    if (!split) throw new Error("Mesocycle not found for this profile");
    if (split.deletedAt) return; // Safe retry after the response was lost.
    const active = await tx.select().from(workoutSessionsTable)
      .where(and(eq(workoutSessionsTable.splitId, splitId), eq(workoutSessionsTable.status, "active"))).for("update");
    if (active.length) {
      const performed = await tx.select({ id: workoutSetsTable.id }).from(workoutSetsTable)
        .innerJoin(workoutExercisesTable, eq(workoutExercisesTable.id, workoutSetsTable.workoutExerciseId))
        .where(and(inArray(workoutExercisesTable.sessionId, active.map(s => s.id)), eq(workoutSetsTable.completed, true))).limit(1);
      if (performed.length) throw new Error("Finish the active workout before deleting this mesocycle. Its performed sets will be preserved.");
      // An opened but unused workout has no historical evidence to retain.
      await tx.delete(workoutSessionsTable).where(inArray(workoutSessionsTable.id, active.map(s => s.id)));
    }
    await tx.delete(plannedWorkoutsTable).where(and(eq(plannedWorkoutsTable.splitId, splitId),
      sql`${plannedWorkoutsTable.status} <> 'completed'`));
    await tx.update(trainingSplitsTable).set({ deletedAt: new Date(),
      lifecycleStatus: ["planned", "active", "paused"].includes(split.lifecycleStatus) ? "ended_early" : split.lifecycleStatus,
      endedAt: split.endedAt ?? new Date(), pausedAt: null }).where(eq(trainingSplitsTable.id, splitId));
  });
}

/** This is deliberately separate from plan deletion and requires an exact confirmation. */
export async function resetTrainingData(profileId: number, confirmation: string) {
  if (confirmation !== "RESET") throw new Error("Type RESET to confirm permanent deletion.");
  await db.transaction(async tx => {
    const [profile] = await tx.select().from(profilesTable).where(eq(profilesTable.id, profileId)).for("update");
    if (!profile) throw new Error("Profile not found");
    // Session cascades remove sets, feedback and readiness, but never the exercise library.
    await tx.delete(progressionRecommendationsTable).where(eq(progressionRecommendationsTable.profileId, profileId));
    await tx.delete(exerciseBaselinesTable).where(eq(exerciseBaselinesTable.profileId, profileId));
    await tx.delete(workoutSessionsTable).where(eq(workoutSessionsTable.profileId, profileId));
    const owned = tx.select({ id: trainingSplitsTable.id }).from(trainingSplitsTable).where(eq(trainingSplitsTable.profileId, profileId));
    await tx.delete(plannedWorkoutsTable).where(inArray(plannedWorkoutsTable.splitId, owned));
    await tx.delete(trainingSplitsTable).where(eq(trainingSplitsTable.profileId, profileId));
  });
}