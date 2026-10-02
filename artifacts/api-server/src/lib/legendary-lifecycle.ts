import { and, asc, eq, sql } from "drizzle-orm";
import { db, mesocycleWeeksTable, plannedWorkoutsTable, splitDayExercisesTable, splitDaysTable, trainingSplitsTable, workoutSessionsTable } from "@workspace/db";
import { initializePrescriptions, invalidateFuturePrescriptions } from "./legendary-prescriptions";
export function plusDays(date: string, count: number) {
  const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + count); return d.toISOString().slice(0, 10);
}
export async function activateMesocycle(splitId: number, connection: any = db) {
  const run = async (tx: any) => {
    const [split] = await tx.select().from(trainingSplitsTable).where(eq(trainingSplitsTable.id, splitId));
    if (!split || split.deletedAt || !["planned", "active"].includes(split.lifecycleStatus)) throw new Error("Resume a paused mesocycle, or restart a closed mesocycle before training.");
    await tx.execute(sql`SELECT id FROM training_profiles WHERE id=${split.profileId} FOR UPDATE`);
    await tx.update(trainingSplitsTable).set({ lifecycleStatus: "paused", pausedAt: new Date() })
      .where(and(eq(trainingSplitsTable.profileId, split.profileId), eq(trainingSplitsTable.lifecycleStatus, "active"), sql`${trainingSplitsTable.id}<>${splitId}`));
    await tx.update(trainingSplitsTable).set({ lifecycleStatus: "active", pausedAt: null }).where(eq(trainingSplitsTable.id, splitId));
  };
  if (connection === db) await db.transaction(run); else await run(connection);
}
export async function transitionLifecycle(splitId: number, input: { profileId: number; action: string; recalibrateAll?: boolean; startDate?: string }) {
  let newId: number | null = null;
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM training_profiles WHERE id=${input.profileId} FOR UPDATE`);
    const [split] = await tx.select().from(trainingSplitsTable).where(and(eq(trainingSplitsTable.id, splitId), eq(trainingSplitsTable.profileId, input.profileId))).for("update");
    if (!split || split.deletedAt) throw new Error("Mesocycle not found for this profile");
    if (input.action === "restart" && split.lifecycleStatus === "restarted") {
      const [existing] = await tx.select().from(trainingSplitsTable).where(eq(trainingSplitsTable.restartFromId, splitId)).orderBy(asc(trainingSplitsTable.id)).limit(1);
      if (!existing || existing.deletedAt) throw new Error("This instance was already restarted. Restart its latest visible instance.");
      newId = existing.id;
      return;
    }
    const active = await tx.select().from(workoutSessionsTable).where(and(eq(workoutSessionsTable.profileId, input.profileId), eq(workoutSessionsTable.status, "active"))).limit(1);
    if (active.length && ["activate", "restart"].includes(input.action)) throw new Error("Finish the active workout before activating or restarting a mesocycle.");
    if (input.action === "activate") { await activateMesocycle(splitId, tx); return; }
    if (input.action === "pause") {
      if (split.lifecycleStatus !== "active") throw new Error("Only an active mesocycle can be paused");
      await tx.update(trainingSplitsTable).set({ lifecycleStatus: "paused", pausedAt: new Date() }).where(eq(trainingSplitsTable.id, splitId));
      return;
    }
    if (input.action === "resume") {
      if (split.lifecycleStatus !== "paused") throw new Error("Only a paused mesocycle can be resumed");
      const shift = Math.max(0, Math.floor((Date.now() - (split.pausedAt?.getTime() ?? Date.now())) / 86400000));
      if (shift) {
        // Completed dates and historical session snapshots are deliberately not touched.
        await tx.execute(sql`UPDATE planned_workouts SET scheduled_date=scheduled_date+${shift}::integer
          WHERE split_id=${splitId} AND status='scheduled'`);
        await tx.execute(sql`UPDATE mesocycle_weeks SET schedule_start_date=COALESCE(schedule_start_date,
          (SELECT start_date FROM training_splits WHERE id=${splitId})+(week_index-1)*7)+${shift}::integer
          WHERE split_id=${splitId} AND status<>'completed'`);
        await tx.execute(sql`UPDATE planned_prescriptions pp SET payload=jsonb_set(pp.payload,'{scheduledDate}',to_jsonb(pw.scheduled_date::text))
          FROM planned_workouts pw WHERE pp.planned_workout_id=pw.id AND pw.split_id=${splitId} AND pw.status='scheduled'`);
      }
      await tx.update(trainingSplitsTable).set({ lifecycleStatus: "paused" }).where(eq(trainingSplitsTable.id, splitId));
      // Resume uses the same serialized one-active invariant as activation.
      await tx.update(trainingSplitsTable).set({ lifecycleStatus: "paused", pausedAt: new Date() })
        .where(and(eq(trainingSplitsTable.profileId, input.profileId), eq(trainingSplitsTable.lifecycleStatus, "active")));
      await tx.update(trainingSplitsTable).set({ lifecycleStatus: "active", pausedAt: null }).where(eq(trainingSplitsTable.id, splitId));
      return;
    }
    if (!["end_early", "restart"].includes(input.action)) throw new Error("Invalid lifecycle action");
    if (input.action === "end_early" && ["ended_early", "restarted", "completed"].includes(split.lifecycleStatus)) throw new Error("This instance is already closed");
    await tx.update(plannedWorkoutsTable).set({ status: "cancelled" }).where(and(eq(plannedWorkoutsTable.splitId, splitId), eq(plannedWorkoutsTable.status, "scheduled")));
    await tx.update(trainingSplitsTable).set({
      lifecycleStatus: input.action === "restart" ? "restarted" : "ended_early",
      endedAt: split.endedAt ?? new Date(), pausedAt: null,
    }).where(eq(trainingSplitsTable.id, splitId));
    if (input.action !== "restart") return;
    const startDate = input.startDate ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || Number.isNaN(new Date(`${startDate}T00:00:00Z`).getTime())) throw new Error("Invalid start date");
    const [created] = await tx.insert(trainingSplitsTable).values({
      profileId: split.profileId, name: `${split.name} (restart)`, startDate, cycleLengthWeeks: split.cycleLengthWeeks,
      restartFromId: split.id, recalibrateAll: !!input.recalibrateAll, recalibrateSince: input.recalibrateAll ? new Date() : null,
      programmingVersion: "legendary-v2.2",
    }).returning();
    newId = created.id;
    const days = await tx.select().from(splitDaysTable).where(and(eq(splitDaysTable.splitId, splitId), eq(splitDaysTable.isArchived, false))).orderBy(asc(splitDaysTable.dayIndex));
    const dayMap = new Map<number, number>();
    for (const day of days) {
      const [newDay] = await tx.insert(splitDaysTable).values({ splitId: created.id, name: day.name, dayIndex: day.dayIndex }).returning();
      dayMap.set(day.id, newDay.id);
      const exercises = await tx.select().from(splitDayExercisesTable).where(eq(splitDayExercisesTable.dayId, day.id)).orderBy(asc(splitDayExercisesTable.orderIndex));
      if (exercises.length) await tx.insert(splitDayExercisesTable).values(exercises.map(({ id, dayId, ...e }) => ({ ...e, anchorWeek: 1, targetRepsMin: 6, targetRepsMax: 30, dayId: newDay.id })));
    }
    const weeks = await tx.select().from(mesocycleWeeksTable).where(eq(mesocycleWeeksTable.splitId, splitId)).orderBy(asc(mesocycleWeeksTable.weekIndex));
    for (const week of weeks) {
      const [newWeek] = await tx.insert(mesocycleWeeksTable).values({ splitId: created.id, weekIndex: week.weekIndex, kind: week.kind, targetRir: week.targetRir }).returning();
      const occurrences = await tx.select().from(plannedWorkoutsTable).where(eq(plannedWorkoutsTable.weekId, week.id));
      for (const occurrence of occurrences) {
        // Original day offsets survive inserted weeks and pause/reschedule shifts.
        const daysFromOriginalStart = Math.round((Date.parse(occurrence.originalScheduledDate) - Date.parse(split.startDate)) / 86400000);
        const offset = ((daysFromOriginalStart % 7) + 7) % 7;
        const scheduledDate = plusDays(startDate, (week.weekIndex - 1) * 7 + offset);
        const dayId = dayMap.get(occurrence.splitDayId);
        if (dayId) await tx.insert(plannedWorkoutsTable).values({ splitId: created.id, weekId: newWeek.id, splitDayId: dayId, scheduledDate, originalScheduledDate: scheduledDate });
      }
    }
    await activateMesocycle(created.id, tx);
  });
  if (newId) await initializePrescriptions(newId);
  const [split] = await db.select().from(trainingSplitsTable).where(eq(trainingSplitsTable.id, newId ?? splitId));
  return { ...split, newSplitId: newId };
}

export async function changeLoadingWeek(splitId: number, addRir?: number, claimedProfileId?: number) {
  await db.transaction(async tx => {
    const [split] = await tx.select().from(trainingSplitsTable).where(eq(trainingSplitsTable.id, splitId)).for("update");
    if (!split || split.deletedAt || (claimedProfileId !== undefined && split.profileId !== claimedProfileId)) throw new Error("Mesocycle not found for this profile");
    if (!["active", "planned", "paused"].includes(split.lifecycleStatus)) throw new Error("Closed mesocycles cannot change loading weeks");
    const weeks = await tx.select().from(mesocycleWeeksTable).where(eq(mesocycleWeeksTable.splitId, splitId)).orderBy(asc(mesocycleWeeksTable.weekIndex));
    const loading = weeks.filter(w => w.kind === "loading");
    let recovery = weeks.at(-1)?.kind !== "loading" ? weeks.at(-1) : undefined;
    if (recovery?.status !== "future" && recovery) throw new Error("Started recovery weeks cannot be shifted");
    if (recovery) {
      const linked = await tx.select().from(workoutSessionsTable).where(eq(workoutSessionsTable.weekId, recovery.id)).limit(1);
      if (linked.length) throw new Error("Started recovery weeks cannot be shifted");
    }
    if (addRir !== undefined) {
      if (!Number.isFinite(addRir) || addRir < 0 || addRir > 10) throw new Error("Choose an RIR from 0 to 10");
      const nextIndex = (loading.at(-1)?.weekIndex ?? 0) + 1;
      if (recovery) {
        await tx.update(mesocycleWeeksTable).set({ weekIndex: recovery.weekIndex + 1, scheduleStartDate: recovery.scheduleStartDate ? plusDays(recovery.scheduleStartDate, 7) : null }).where(eq(mesocycleWeeksTable.id, recovery.id));
        await tx.execute(sql`UPDATE planned_workouts SET scheduled_date=scheduled_date+7 WHERE week_id=${recovery.id} AND status='scheduled'`);
      }
      const [week] = await tx.insert(mesocycleWeeksTable).values({ splitId, weekIndex: nextIndex, kind: "loading", targetRir: addRir }).returning();
      const sourceWeek = loading.at(-1);
      const source = sourceWeek ? await tx.select().from(plannedWorkoutsTable).where(eq(plannedWorkoutsTable.weekId, sourceWeek.id)) : [];
      for (const occurrence of source) {
        const date = plusDays(occurrence.scheduledDate, 7);
        await tx.insert(plannedWorkoutsTable).values({ splitId, weekId: week.id, splitDayId: occurrence.splitDayId, scheduledDate: date, originalScheduledDate: date });
      }
    } else {
      const last = loading.at(-1);
      if (!last || loading.length <= 1) throw new Error("Keep at least one loading week");
      const linked = await tx.select().from(workoutSessionsTable).where(eq(workoutSessionsTable.weekId, last.id)).limit(1);
      if (last.status !== "future" || linked.length) throw new Error("Started or completed loading weeks cannot be removed");
      await tx.delete(plannedWorkoutsTable).where(eq(plannedWorkoutsTable.weekId, last.id));
      await tx.delete(mesocycleWeeksTable).where(eq(mesocycleWeeksTable.id, last.id));
      if (recovery) {
        await tx.update(mesocycleWeeksTable).set({ weekIndex: recovery.weekIndex - 1, scheduleStartDate: recovery.scheduleStartDate ? plusDays(recovery.scheduleStartDate, -7) : null }).where(eq(mesocycleWeeksTable.id, recovery.id));
        await tx.execute(sql`UPDATE planned_workouts SET scheduled_date=scheduled_date-7 WHERE week_id=${recovery.id} AND status='scheduled'`);
      }
    }
    await tx.execute(sql`UPDATE training_splits SET cycle_length_weeks=(SELECT count(*) FROM mesocycle_weeks WHERE split_id=${splitId}) WHERE id=${splitId}`);
    await invalidateFuturePrescriptions(splitId, tx);
  });
  return { splitId, changed: true };
}