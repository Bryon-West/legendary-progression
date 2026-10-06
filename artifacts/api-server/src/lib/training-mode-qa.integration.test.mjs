import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db, profilesTable, workoutSessionsTable } from "@workspace/db";
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
