import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import { eq, like } from "drizzle-orm";
import {
  db,
  exercisesTable,
  mesocycleWeeksTable,
  plannedWorkoutsTable,
  profilesTable,
  splitDayExercisesTable,
  splitDaysTable,
  trainingSplitsTable,
  workoutExercisesTable,
  workoutSessionsTable,
  workoutSetsTable,
} from "@workspace/db";
import { createApp } from "../app.ts";
import { calculateSessionVolume, getActiveSession, getWorkoutSummary, getWorkoutTree } from "./hypertrophy.ts";
import { loadingSets } from "./legendary-v22-core.ts";
import { getPrescription } from "./legendary-prescriptions.ts";

const QA_PROFILE_PREFIX = "V23C isolated QA ";
const LB_PER_KG = 2.20462262185;
const toKg = (pounds) => Math.round((pounds / LB_PER_KG) * 10000) / 10000;

async function cleanupProfile(profileId) {
  const splits = await db.select({ id: trainingSplitsTable.id }).from(trainingSplitsTable)
    .where(eq(trainingSplitsTable.profileId, profileId));
  for (const split of splits) {
    await db.delete(trainingSplitsTable).where(eq(trainingSplitsTable.id, split.id));
  }
  await db.delete(workoutSessionsTable).where(eq(workoutSessionsTable.profileId, profileId));
  await db.delete(exercisesTable).where(eq(exercisesTable.profileId, profileId));
  await db.delete(profilesTable).where(eq(profilesTable.id, profileId));
}

async function cleanupAbandonedQAFixtures() {
  const fixtures = await db.select({ id: profilesTable.id, name: profilesTable.name })
    .from(profilesTable).where(like(profilesTable.name, `${QA_PROFILE_PREFIX}%`));
  for (const fixture of fixtures) {
    if (fixture.name.startsWith(QA_PROFILE_PREFIX)) await cleanupProfile(fixture.id);
  }
}

async function createSplit(profileId, name, exerciseIds) {
  const [split] = await db.insert(trainingSplitsTable).values({
    profileId,
    name,
    startDate: "2026-10-01",
    cycleLengthWeeks: 3,
  }).returning();
  const [day] = await db.insert(splitDaysTable).values({
    splitId: split.id,
    name: "QA Day",
    dayIndex: 0,
  }).returning();
  for (const [index, exerciseId] of exerciseIds.entries()) {
    await db.insert(splitDayExercisesTable).values({
      dayId: day.id,
      exerciseId,
      orderIndex: index,
      targetSets: index === 0 ? 3 : 2,
      minimumWorkingSets: 1,
      maximumWorkingSets: 5,
      targetRepsMin: 6,
      targetRepsMax: 30,
      targetRir: 2,
      targetWeight: toKg(index === 0 ? 225 : 50),
    });
  }
  return { split, day };
}

async function createWeekOccurrence(split, day, weekIndex) {
  const scheduleStartDate = weekIndex === 2 ? "2026-10-01" : "2026-10-08";
  const scheduledDate = weekIndex === 2 ? "2026-10-02" : "2026-10-09";
  const [week] = await db.insert(mesocycleWeeksTable).values({
    splitId: split.id,
    weekIndex,
    scheduleStartDate,
    kind: "loading",
    targetRir: 2,
    status: weekIndex === 2 ? "in_progress" : "future",
  }).returning();
  const [occurrence] = await db.insert(plannedWorkoutsTable).values({
    splitId: split.id,
    weekId: week.id,
    splitDayId: day.id,
    scheduledDate,
    originalScheduledDate: scheduledDate,
  }).returning();
  return { week, occurrence };
}

async function createSession({ profileId, split, day, exerciseIds, includeCompletedSet, weekId, plannedWorkoutId }) {
  const [session] = await db.insert(workoutSessionsTable).values({
    profileId,
    splitId: split.id,
    splitDayId: day.id,
    weekId,
    plannedWorkoutId,
    splitName: split.name,
    dayName: day.name,
    startedAt: new Date("2026-10-02T16:00:00.000Z"),
    mesocycleStartDate: "2026-10-01",
    mesocycleWeek: 2,
    targetRirSnapshot: 2,
    weekKindSnapshot: "loading",
  }).returning();

  const [bench, fly] = await db.insert(workoutExercisesTable).values([
    {
      sessionId: session.id,
      exerciseId: exerciseIds[0],
      exerciseName: "QA Bench Press",
      muscleGroup: "chest",
      targetRir: 2,
      targetSets: 4,
      targetRepsMin: 6,
      targetRepsMax: 30,
      targetWeight: toKg(225),
      recommendedWeight: toKg(225),
      orderIndex: 0,
      category: "strength",
      isCompound: true,
    },
    {
      sessionId: session.id,
      exerciseId: exerciseIds[1],
      exerciseName: "QA Cable Fly",
      muscleGroup: "chest",
      targetRir: 2,
      targetSets: 2,
      targetRepsMin: 6,
      targetRepsMax: 30,
      targetWeight: toKg(50),
      recommendedWeight: toKg(50),
      orderIndex: 1,
      category: "strength",
      isCompound: false,
    },
  ]).returning();

  await db.update(workoutSessionsTable).set({
    structureSnapshot: {
      version: "legendary-v2.3b",
      exercises: [
        {
          workoutExerciseId: bench.id,
          exerciseId: exerciseIds[0],
          exerciseName: "QA Bench Press",
          orderIndex: 0,
          sets: 3,
          maximumWorkingSets: 5,
        },
        {
          workoutExerciseId: fly.id,
          exerciseId: exerciseIds[1],
          exerciseName: "QA Cable Fly",
          orderIndex: 1,
          sets: 2,
          maximumWorkingSets: 5,
        },
      ],
    },
  }).where(eq(workoutSessionsTable.id, session.id));

  const sets = [
    {
      workoutExerciseId: bench.id,
      setNumber: 1,
      setType: "work",
      actualWeight: toKg(225),
      actualReps: 8,
      actualRir: 2,
      completed: includeCompletedSet,
      completedAt: includeCompletedSet ? new Date("2026-10-02T16:30:00.000Z") : null,
    },
    ...[2, 3, 4].map((setNumber) => ({
      workoutExerciseId: bench.id,
      setNumber,
      setType: "work",
      targetWeight: toKg(225),
      targetRepsMin: 6,
      targetRepsMax: 30,
    })),
    {
      workoutExerciseId: bench.id,
      setNumber: 1,
      setType: "warmup",
      actualWeight: toKg(250),
      actualReps: 5,
      completed: includeCompletedSet,
      completedAt: includeCompletedSet ? new Date("2026-10-02T16:20:00.000Z") : null,
    },
    {
      workoutExerciseId: bench.id,
      setNumber: 5,
      setType: "work",
      actualWeight: toKg(300),
      actualReps: 12,
      actualRir: 0,
      completed: true,
      removed: true,
      completedAt: new Date("2026-10-02T16:40:00.000Z"),
    },
    {
      workoutExerciseId: fly.id,
      setNumber: 1,
      setType: "work",
      actualWeight: toKg(50),
      actualReps: 10,
      actualRir: 2,
      completed: includeCompletedSet,
      completedAt: includeCompletedSet ? new Date("2026-10-02T16:45:00.000Z") : null,
    },
    {
      workoutExerciseId: fly.id,
      setNumber: 2,
      setType: "work",
      targetWeight: toKg(50),
      targetRepsMin: 6,
      targetRepsMax: 30,
    },
  ];
  await db.insert(workoutSetsTable).values(sets);
  return { session, bench, fly };
}

test("V2.3C keeps removed work in history, isolates Today Only, and builds Keep Changes from the accepted set count", async () => {
  const userId = `v23c-isolated-qa-${randomUUID()}`;
  let profileId;
  let server;
  try {
    const [profile] = await db.insert(profilesTable).values({
      name: `${QA_PROFILE_PREFIX}${randomUUID()}`,
      weightUnit: "lb",
      ownerUserId: userId,
    }).returning();
    profileId = profile.id;

    const [benchExercise, flyExercise] = await db.insert(exercisesTable).values([
      {
        profileId,
        name: "QA Bench Press",
        muscleGroup: "chest",
        equipment: "barbell",
        category: "strength",
        isCompound: true,
      },
      {
        profileId,
        name: "QA Cable Fly",
        muscleGroup: "chest",
        equipment: "cable",
        category: "strength",
      },
    ]).returning();
    const exerciseIds = [benchExercise.id, flyExercise.id];
    server = createServer(createApp({
      authMiddleware: (req, _res, next) => {
        req.auth = { userId };
        next();
      },
    }));
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const api = `http://127.0.0.1:${address.port}/api`;

    const todayOnlyPlan = await createSplit(profileId, "QA Today Only", exerciseIds);
    const todayWeek = await createWeekOccurrence(todayOnlyPlan.split, todayOnlyPlan.day, 2);
    await createWeekOccurrence(todayOnlyPlan.split, todayOnlyPlan.day, 3);
    const todayOnlySession = await createSession({
      profileId,
      ...todayOnlyPlan,
      exerciseIds,
      includeCompletedSet: true,
      weekId: todayWeek.week.id,
      plannedWorkoutId: todayWeek.occurrence.id,
    });

    const removeTodayResponse = await fetch(
      `${api}/workouts/${todayOnlySession.session.id}/exercises/${todayOnlySession.fly.id}/remove`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope: "today_only" }) },
    );
    assert.equal(removeTodayResponse.status, 200);
    const afterRemove = await removeTodayResponse.json();
    assert.deepEqual(afterRemove.exercises.map((exercise) => exercise.id), [todayOnlySession.bench.id]);
    assert.equal(afterRemove.futureChangePending, false);

    const activeWorkout = await getWorkoutTree(todayOnlySession.session.id);
    const expectedVolumeKg = toKg(225) * 8 + toKg(50) * 10;
    assert.ok(Math.abs(activeWorkout.totalVolume - expectedVolumeKg) < 1e-6);
    assert.ok(Math.abs(await calculateSessionVolume(todayOnlySession.session.id) - expectedVolumeKg) < 1e-6);
    assert.deepEqual(activeWorkout.exercises.map((exercise) => exercise.id), [todayOnlySession.bench.id]);
    const historicalWorkout = await getWorkoutTree(todayOnlySession.session.id, true);
    const archivedFly = historicalWorkout.exercises.find((exercise) => exercise.id === todayOnlySession.fly.id);
    assert.equal(archivedFly.sets.find((set) => set.setNumber === 1 && set.setType === "work").completed, true);

    const summary = await getWorkoutSummary(todayOnlySession.session.id);
    assert.equal(summary.exerciseCount, 2);
    assert.equal(summary.workingSetCount, 2);

    const todayChangesResponse = await fetch(`${api}/workouts/${todayOnlySession.session.id}/structure-changes`);
    assert.equal(todayChangesResponse.status, 200);
    const todayChanges = await todayChangesResponse.json();
    assert.ok(todayChanges.changes.some((change) => change.includes("QA Bench Press") && change.includes("3 sets") && change.includes("4 sets")));
    assert.ok(todayChanges.changes.some((change) => change.includes("QA Cable Fly") && change.includes("removed")));

    const missingDecisionResponse = await fetch(`${api}/workouts/${todayOnlySession.session.id}/finish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(missingDecisionResponse.status, 409);
    assert.ok((await missingDecisionResponse.json()).changes.some((change) => change.includes("QA Cable Fly") && change.includes("removed")));

    const todayFinishResponse = await fetch(`${api}/workouts/${todayOnlySession.session.id}/finish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ structureDecision: "today_only" }),
    });
    assert.equal(todayFinishResponse.status, 200);
    const todayFinish = await todayFinishResponse.json();
    assert.equal(todayFinish.workout.status, "completed");
    assert.equal(todayFinish.summary.exerciseCount, 2);
    assert.equal(todayFinish.summary.workingSetCount, 2);
    assert.equal(todayFinish.summary.newPrCount, 2);
    assert.ok(Math.abs(todayFinish.workout.totalVolume - expectedVolumeKg) < 1e-6);
    assert.equal(await getActiveSession(profileId), null);

    const unchangedPlans = await db.select().from(splitDayExercisesTable)
      .where(eq(splitDayExercisesTable.dayId, todayOnlyPlan.day.id))
      .orderBy(splitDayExercisesTable.orderIndex);
    assert.deepEqual(unchangedPlans.map((plan) => [plan.exerciseId, plan.targetSets]), [
      [benchExercise.id, 3],
      [flyExercise.id, 2],
    ]);

    const todayCalendarResponse = await fetch(
      `${api}/mesocycles/calendar?profileId=${profileId}&splitId=${todayOnlyPlan.split.id}&from=2026-10-01&to=2026-10-20`,
    );
    assert.equal(todayCalendarResponse.status, 200);
    const todayCalendar = await todayCalendarResponse.json();
    assert.equal(todayCalendar.find((week) => week.weekIndex === 2).scheduledWorkouts[0].status, "completed");
    assert.equal(todayCalendar.find((week) => week.weekIndex === 3).scheduledWorkouts[0].projectedExercises.length, 2);

    const activeRecordsResponse = await fetch(`${api}/profiles/${profileId}/records`);
    assert.equal(activeRecordsResponse.status, 200);
    const activeRecords = await activeRecordsResponse.json();
    const activeBenchRecords = activeRecords.exercises.find((exercise) => exercise.exerciseId === benchExercise.id);
    assert.equal(activeRecords.weightUnit, "lb");
    assert.equal(activeBenchRecords.history.length, 1);
    assert.equal(activeBenchRecords.history[0].sessionDate, "2026-10-02T16:00:00.000Z");
    assert.equal(activeBenchRecords.history[0].legendaryPerformanceRecord, true);
    assert.ok(Math.abs(activeBenchRecords.history[0].weight - toKg(225)) < 1e-8);
    assert.equal(Math.round(activeBenchRecords.history[0].weight * LB_PER_KG), 225);
    assert.equal(activeBenchRecords.history[0].reps, 8);
    assert.equal(activeBenchRecords.history[0].rir, 2);
    assert.equal(
      activeRecords.exercises.find((exercise) => exercise.exerciseId === flyExercise.id).history.length,
      1,
    );

    const recordsResponse = await fetch(`${api}/profiles/${profileId}/records`);
    assert.equal(recordsResponse.status, 200);
    const recordsBeforeDelete = await recordsResponse.json();
    const benchRecords = recordsBeforeDelete.exercises.find((exercise) => exercise.exerciseId === benchExercise.id);
    assert.equal(benchRecords.history.length, 1);
    assert.equal(benchRecords.history[0].sessionDate, "2026-10-02T16:00:00.000Z");
    assert.equal(benchRecords.history[0].legendaryPerformanceRecord, true);
    assert.ok(Math.abs(benchRecords.history[0].weight - toKg(225)) < 1e-8);
    assert.equal(Math.round(benchRecords.history[0].weight * LB_PER_KG), 225);
    assert.equal(benchRecords.history[0].reps, 8);
    assert.equal(benchRecords.history[0].rir, 2);
    assert.equal(
      recordsBeforeDelete.exercises.find((exercise) => exercise.exerciseId === flyExercise.id).history.length,
      1,
    );

    await db.delete(trainingSplitsTable).where(eq(trainingSplitsTable.id, todayOnlyPlan.split.id));
    const recordsAfterDeleteResponse = await fetch(`${api}/profiles/${profileId}/records`);
    assert.equal(recordsAfterDeleteResponse.status, 200);
    const recordsAfterDelete = await recordsAfterDeleteResponse.json();
    const preservedBenchRecords = recordsAfterDelete.exercises.find((exercise) => exercise.exerciseId === benchExercise.id);
    assert.equal(preservedBenchRecords.history[0].sessionDate, "2026-10-02T16:00:00.000Z");
    assert.equal(preservedBenchRecords.history[0].setId, benchRecords.history[0].setId);

    const keepPlan = await createSplit(profileId, "QA Keep Changes", exerciseIds);
    const keepWeek = await createWeekOccurrence(keepPlan.split, keepPlan.day, 2);
    const futureWeek = await createWeekOccurrence(keepPlan.split, keepPlan.day, 3);
    const keepSession = await createSession({
      profileId,
      ...keepPlan,
      exerciseIds,
      includeCompletedSet: false,
      weekId: keepWeek.week.id,
      plannedWorkoutId: keepWeek.occurrence.id,
    });
    const removeKeepResponse = await fetch(
      `${api}/workouts/${keepSession.session.id}/exercises/${keepSession.fly.id}/remove`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope: "today_only" }) },
    );
    assert.equal(removeKeepResponse.status, 200);
    assert.deepEqual((await removeKeepResponse.json()).exercises.map((exercise) => exercise.id), [keepSession.bench.id]);
    const keepChangesResponse = await fetch(`${api}/workouts/${keepSession.session.id}/structure-changes`);
    assert.equal(keepChangesResponse.status, 200);
    assert.ok((await keepChangesResponse.json()).changes.length > 0);
    const keepFinishResponse = await fetch(`${api}/workouts/${keepSession.session.id}/finish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ structureDecision: "keep" }),
    });
    assert.equal(keepFinishResponse.status, 200);
    const keepFinish = await keepFinishResponse.json();
    assert.equal(keepFinish.workout.status, "completed");
    assert.equal(keepFinish.summary.newPrCount, 0);
    assert.equal(await getActiveSession(profileId), null);

    const keptPlans = await db.select().from(splitDayExercisesTable)
      .where(eq(splitDayExercisesTable.dayId, keepPlan.day.id))
      .orderBy(splitDayExercisesTable.orderIndex);
    assert.deepEqual(keptPlans.map((plan) => [plan.exerciseId, plan.targetSets]), [[benchExercise.id, 4]]);
    assert.equal(keptPlans[0].anchorWeek, 2);
    assert.equal(loadingSets(keptPlans[0].targetSets, 1, keptPlans[0].maximumWorkingSets), 5);
    const generated = await getPrescription(futureWeek.occurrence.id);
    assert.deepEqual(generated.exercises.map((exercise) => [exercise.exerciseId, exercise.targetSets]), [[benchExercise.id, 5]]);
    const keepCalendarResponse = await fetch(
      `${api}/mesocycles/calendar?profileId=${profileId}&splitId=${keepPlan.split.id}&from=2026-10-01&to=2026-10-20`,
    );
    assert.equal(keepCalendarResponse.status, 200);
    const keepCalendar = await keepCalendarResponse.json();
    const futureCalendarWorkout = keepCalendar.find((week) => week.weekIndex === 3).scheduledWorkouts[0];
    assert.equal(futureCalendarWorkout.projectedExercises.length, 1);
    assert.equal(futureCalendarWorkout.projectedExercises[0].exerciseId, benchExercise.id);
    assert.equal(futureCalendarWorkout.projectedExercises[0].targetSets, 5);
  } finally {
    try {
      await cleanupAbandonedQAFixtures();
    } finally {
      if (server?.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
});