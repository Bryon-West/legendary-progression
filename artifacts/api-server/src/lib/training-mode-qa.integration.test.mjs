import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db, exercisesTable, profilesTable, workoutSessionsTable } from "@workspace/db";
import { createApp } from "../app.ts";

const QA_USER_PREFIX = "training-mode-qa-";

function requestAs(api, userId, path, options = {}) {
  return fetch(`${api}${path}`, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      "x-qa-user-id": userId,
    },
  });
}

test("mode changes are queued during workouts and cancel only the active session", async () => {
  const userId = `${QA_USER_PREFIX}${randomUUID()}`;
  let server;
  let profileId;

  try {
    server = createServer(createApp({
      authMiddleware: (req, _res, next) => {
        req.auth = { userId: req.get("x-qa-user-id") ?? null };
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

    const profilesResponse = await requestAs(api, userId, "/profiles");
    assert.equal(profilesResponse.status, 200);
    const [profile] = await profilesResponse.json();
    profileId = profile.id;
    assert.equal(profile.trainingMode, "legendary_pro");
    assert.equal(profile.pendingTrainingMode, null);

    const initialModeResponse = await requestAs(api, userId, `/profiles/${profileId}/training-mode`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trainingMode: "basic" }),
    });
    assert.equal(initialModeResponse.status, 200);
    assert.equal((await initialModeResponse.json()).profile.trainingMode, "basic");

    const [history] = await db.insert(workoutSessionsTable).values({
      profileId,
      status: "completed",
      trainingMode: "legendary_pro",
    }).returning();
    const [active] = await db.insert(workoutSessionsTable).values({
      profileId,
      status: "active",
      trainingMode: "basic",
    }).returning();

    const missingActionResponse = await requestAs(
      api,
      userId,
      `/profiles/${profileId}/training-mode`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trainingMode: "legendary_pro" }),
      },
    );
    assert.equal(missingActionResponse.status, 409);
    const [unchangedProfile] = await db.select().from(profilesTable)
      .where(eq(profilesTable.id, profileId));
    assert.equal(unchangedProfile.trainingMode, "basic");
    assert.equal(unchangedProfile.pendingTrainingMode, null);

    const keepResponse = await requestAs(api, userId, `/profiles/${profileId}/training-mode`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        trainingMode: "legendary_pro",
        activeSessionAction: "keep_current",
      }),
    });
    assert.equal(keepResponse.status, 200);
    const kept = await keepResponse.json();
    assert.equal(kept.profile.trainingMode, "basic");
    assert.equal(kept.profile.pendingTrainingMode, null);
    assert.equal(kept.activeWorkoutId, active.id);

    const queueResponse = await requestAs(api, userId, `/profiles/${profileId}/training-mode`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        trainingMode: "legendary_pro",
        activeSessionAction: "finish_current",
      }),
    });
    assert.equal(queueResponse.status, 200);
    const queued = await queueResponse.json();
    assert.equal(queued.profile.trainingMode, "basic");
    assert.equal(queued.profile.pendingTrainingMode, "legendary_pro");
    assert.equal(queued.pending, true);
    assert.equal(queued.activeWorkoutId, active.id);

    const cancelResponse = await requestAs(api, userId, `/profiles/${profileId}/training-mode`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        trainingMode: "legendary_pro",
        activeSessionAction: "cancel_today",
      }),
    });
    assert.equal(cancelResponse.status, 200);
    const cancelled = await cancelResponse.json();
    assert.equal(cancelled.profile.trainingMode, "legendary_pro");
    assert.equal(cancelled.profile.pendingTrainingMode, null);
    assert.equal(cancelled.pending, false);
    assert.equal(cancelled.activeWorkoutId, null);

    const remainingSessions = await db.select({
      id: workoutSessionsTable.id,
      status: workoutSessionsTable.status,
    }).from(workoutSessionsTable)
      .where(eq(workoutSessionsTable.profileId, profileId));
    assert.deepEqual(remainingSessions, [{ id: history.id, status: "completed" }]);

    const [finishing] = await db.insert(workoutSessionsTable).values({
      profileId,
      status: "active",
      trainingMode: "legendary_pro",
    }).returning();
    const queueBasicResponse = await requestAs(api, userId, `/profiles/${profileId}/training-mode`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        trainingMode: "basic",
        activeSessionAction: "finish_current",
      }),
    });
    assert.equal(queueBasicResponse.status, 200);
    const profileBeforeFinish = (await db.select().from(profilesTable)
      .where(eq(profilesTable.id, profileId)))[0];
    assert.equal(profileBeforeFinish.trainingMode, "legendary_pro");
    assert.equal(profileBeforeFinish.pendingTrainingMode, "basic");

    const finishResponse = await requestAs(api, userId, `/workouts/${finishing.id}/finish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(finishResponse.status, 200);
    const [profileAfterFinish] = await db.select().from(profilesTable)
      .where(eq(profilesTable.id, profileId));
    assert.equal(profileAfterFinish.trainingMode, "basic");
    assert.equal(profileAfterFinish.pendingTrainingMode, null);
    const [finishedSession] = await db.select({
      status: workoutSessionsTable.status,
      trainingMode: workoutSessionsTable.trainingMode,
    }).from(workoutSessionsTable)
      .where(eq(workoutSessionsTable.id, finishing.id));
    assert.equal(finishedSession.status, "completed");
    assert.equal(finishedSession.trainingMode, "legendary_pro");
  } finally {
    try {
      if (profileId !== undefined) {
        await db.delete(workoutSessionsTable).where(eq(workoutSessionsTable.profileId, profileId));
        await db.delete(exercisesTable).where(eq(exercisesTable.profileId, profileId));
        await db.delete(profilesTable).where(eq(profilesTable.id, profileId));
      }
    } finally {
      if (server?.listening) {
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }
  }
});

test("metric-driven activity sets are recorded without resistance progression in Basic and Pro", async () => {
  const userId = `${QA_USER_PREFIX}metrics-${randomUUID()}`;
  let server;
  let profileId;
  try {
    server = createServer(createApp({
      authMiddleware: (req, _res, next) => {
        req.auth = { userId: req.get("x-qa-user-id") ?? null };
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

    const profileResponse = await requestAs(api, userId, "/profiles");
    assert.equal(profileResponse.status, 200);
    profileId = (await profileResponse.json())[0].id;
    const exerciseResponse = await requestAs(api, userId, "/exercises", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profileId,
        name: `QA cardio ${randomUUID()}`,
        muscleGroup: "Cardio",
        equipment: "Treadmill",
        category: "cardio",
        metricDefinitions: [
          { type: "distance", label: "Distance", unit: "mi", required: true },
          { type: "time", label: "Time", unit: "min", required: true },
        ],
        isCompound: false,
      }),
    });
    assert.equal(exerciseResponse.status, 201);
    const exercise = await exerciseResponse.json();

    for (const trainingMode of ["basic", "legendary_pro"]) {
      const modeResponse = await requestAs(api, userId, `/profiles/${profileId}/training-mode`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trainingMode }),
      });
      assert.equal(modeResponse.status, 200);
      const startResponse = await requestAs(api, userId, "/workouts/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      assert.equal(startResponse.status, 201);
      const session = await startResponse.json();
      assert.equal(session.trainingMode, trainingMode);

      const addResponse = await requestAs(api, userId, `/workouts/${session.id}/exercises`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ exerciseId: exercise.id, targetSets: 1, orderIndex: 0 }),
      });
      assert.equal(addResponse.status, 201);
      const workoutResponse = await requestAs(api, userId, `/workouts/${session.id}`);
      assert.equal(workoutResponse.status, 200);
      const workout = await workoutResponse.json();
      const workoutExercise = workout.exercises.find((item) => item.exerciseId === exercise.id);
      assert.ok(workoutExercise);
      assert.equal(workoutExercise.targetRir, null);
      assert.equal(workoutExercise.recommendedWeight, null);
      assert.equal(workoutExercise.sets.length, 1);
      const set = workoutExercise.sets[0];

      const recoveryResponse = await requestAs(
        api,
        userId,
        `/workouts/${session.id}/exercises/${workoutExercise.id}/recovery`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "reduce_load" }),
        },
      );
      assert.equal(recoveryResponse.status, 400);
      assert.match((await recoveryResponse.json()).error, /only available for resistance exercises/i);

      const completionResponse = await requestAs(api, userId, `/workouts/${session.id}/sets/${set.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ metricValues: [1.5, 20] }),
      });
      assert.equal(completionResponse.status, 200);
      const completion = await completionResponse.json();
      assert.ok(Math.abs(completion.set.metricValues[0] - 2414.016) < 0.001);
      assert.equal(completion.set.metricValues[1], 1200);
      assert.equal(completion.set.actualWeight, null);
      assert.equal(completion.set.actualReps, null);
      assert.equal(completion.set.actualRir, null);

      const feedbackResponse = await requestAs(
        api,
        userId,
        `/workouts/${session.id}/exercises/${workoutExercise.id}/post-feedback`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pump: "good", fatigue: "moderate", discomfort: "none" }),
        },
      );
      assert.equal(feedbackResponse.status, 400);
      assert.match((await feedbackResponse.json()).error, /only available for resistance exercises/i);

      const finishResponse = await requestAs(api, userId, `/workouts/${session.id}/finish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(finishResponse.status, 200);
      const finishedResponse = await requestAs(api, userId, `/workouts/${session.id}`);
      assert.equal(finishedResponse.status, 200);
      const finished = await finishedResponse.json();
      assert.equal(finished.status, "completed");
      assert.deepEqual(finished.exercises[0].sets[0].metricValues, completion.set.metricValues);
    }
  } finally {
    try {
      if (profileId !== undefined) {
        await db.delete(workoutSessionsTable).where(eq(workoutSessionsTable.profileId, profileId));
        await db.delete(exercisesTable).where(eq(exercisesTable.profileId, profileId));
        await db.delete(profilesTable).where(eq(profilesTable.id, profileId));
      }
    } finally {
      if (server?.listening) {
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }
  }
});
