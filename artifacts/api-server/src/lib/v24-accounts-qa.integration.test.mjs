import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import { eq, like } from "drizzle-orm";
import {
  db,
  exercisesTable,
  profilesTable,
  trainingSplitsTable,
  workoutSessionsTable,
} from "@workspace/db";
import { createApp } from "../app.ts";

const QA_USER_PREFIX = "v24-isolation-qa-";

async function cleanupProfile(profileId) {
  const splits = await db
    .select({ id: trainingSplitsTable.id })
    .from(trainingSplitsTable)
    .where(eq(trainingSplitsTable.profileId, profileId));
  for (const split of splits) {
    await db.delete(trainingSplitsTable).where(eq(trainingSplitsTable.id, split.id));
  }
  await db.delete(workoutSessionsTable).where(eq(workoutSessionsTable.profileId, profileId));
  await db.delete(exercisesTable).where(eq(exercisesTable.profileId, profileId));
  await db.delete(profilesTable).where(eq(profilesTable.id, profileId));
}

async function cleanupQAFixtures() {
  const profiles = await db
    .select({ id: profilesTable.id })
    .from(profilesTable)
    .where(like(profilesTable.ownerUserId, `${QA_USER_PREFIX}%`));
  for (const profile of profiles) await cleanupProfile(profile.id);
}

async function createSplit(profileId, name) {
  const [split] = await db
    .insert(trainingSplitsTable)
    .values({
      profileId,
      name,
      startDate: "2026-10-02",
      cycleLengthWeeks: 3,
    })
    .returning();
  return split;
}

function requestAs(api, userId, path, options = {}) {
  return fetch(`${api}${path}`, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      "x-qa-user-id": userId,
    },
  });
}

test("V2.4 provisions one private profile per account and isolates reset-training", async () => {
  const userA = `${QA_USER_PREFIX}${randomUUID()}-a`;
  const userB = `${QA_USER_PREFIX}${randomUUID()}-b`;
  let server;

  try {
    await cleanupQAFixtures();
    server = createServer(
      createApp({
        authMiddleware: (req, _res, next) => {
          req.auth = { userId: req.get("x-qa-user-id") ?? null };
          next();
        },
      }),
    );
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const api = `http://127.0.0.1:${address.port}/api`;

    const firstAResponse = await requestAs(api, userA, "/profiles");
    assert.equal(firstAResponse.status, 200);
    const profilesA = await firstAResponse.json();
    assert.equal(profilesA.length, 1);
    assert.equal(profilesA[0].onboardingComplete, false);

    const secondAResponse = await requestAs(api, userA, "/profiles");
    assert.equal(secondAResponse.status, 200);
    assert.equal((await secondAResponse.json())[0].id, profilesA[0].id);

    const profilesBResponse = await requestAs(api, userB, "/profiles");
    assert.equal(profilesBResponse.status, 200);
    const profilesB = await profilesBResponse.json();
    assert.equal(profilesB.length, 1);
    assert.notEqual(profilesA[0].id, profilesB[0].id);

    const [profileA] = await db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.ownerUserId, userA));
    const [profileB] = await db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.ownerUserId, userB));
    assert.equal(profileA.id, profilesA[0].id);
    assert.equal(profileB.id, profilesB[0].id);
    assert.equal(profileA.onboardingComplete, false);
    assert.equal(profileB.onboardingComplete, false);

    const duplicateProfileResponse = await requestAs(api, userA, "/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Second profile" }),
    });
    assert.equal(duplicateProfileResponse.status, 409);

    const splitA = await createSplit(profileA.id, `${QA_USER_PREFIX}A plan`);
    const splitB = await createSplit(profileB.id, `${QA_USER_PREFIX}B plan`);

    const ownUpdateResponse = await requestAs(api, userA, `/profiles/${profileA.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Account A",
        weightUnit: "lb",
        trainingExperience: "beginner",
        onboardingComplete: true,
      }),
    });
    assert.equal(ownUpdateResponse.status, 200);
    assert.equal((await ownUpdateResponse.json()).name, "Account A");

    const otherProfileResponse = await requestAs(api, userA, `/profiles/${profileB.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Should not change" }),
    });
    assert.equal(otherProfileResponse.status, 404);

    const ownershipRewriteResponse = await requestAs(api, userA, `/profiles/${profileA.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Account A", ownerUserId: userB }),
    });
    assert.equal(ownershipRewriteResponse.status, 400);

    const otherRecordResponse = await requestAs(api, userA, `/profiles/${profileB.id}/records`);
    assert.equal(otherRecordResponse.status, 404);

    const otherSplitResponse = await requestAs(api, userA, `/splits/${splitB.id}`);
    assert.equal(otherSplitResponse.status, 404);

    const otherResetResponse = await requestAs(api, userA, `/profiles/${profileB.id}/reset-training`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "RESET" }),
    });
    assert.equal(otherResetResponse.status, 404);

    const [preservedOtherSplit] = await db
      .select({ id: trainingSplitsTable.id })
      .from(trainingSplitsTable)
      .where(eq(trainingSplitsTable.id, splitB.id));
    assert.equal(preservedOtherSplit.id, splitB.id);

    const ownResetResponse = await requestAs(api, userA, `/profiles/${profileA.id}/reset-training`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "RESET" }),
    });
    assert.equal(ownResetResponse.status, 204);

    const remainingAPlans = await db
      .select({ id: trainingSplitsTable.id })
      .from(trainingSplitsTable)
      .where(eq(trainingSplitsTable.profileId, profileA.id));
    const remainingBPlans = await db
      .select({ id: trainingSplitsTable.id })
      .from(trainingSplitsTable)
      .where(eq(trainingSplitsTable.profileId, profileB.id));
    assert.equal(remainingAPlans.length, 0);
    assert.deepEqual(remainingBPlans.map((split) => split.id), [splitB.id]);

    const [profileAAfterReset] = await db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.id, profileA.id));
    const [profileBAfterReset] = await db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.id, profileB.id));
    assert.equal(profileAAfterReset.ownerUserId, userA);
    assert.equal(profileAAfterReset.onboardingComplete, true);
    assert.equal(profileBAfterReset.ownerUserId, userB);
    assert.equal(profileBAfterReset.name, "Athlete");
  } finally {
    try {
      await cleanupQAFixtures();
    } finally {
      if (server?.listening) {
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }
  }
});

test("authenticated profile updates persist across refresh, API restart, and re-login", async () => {
  const userId = `v24-profile-update-qa-${randomUUID()}`;
  let apiInstance;

  const startApi = async () => {
    const server = createServer(
      createApp({
        authMiddleware: (req, _res, next) => {
          req.auth = { userId: req.get("x-qa-user-id") ?? null };
          next();
        },
      }),
    );
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    return { server, api: `http://127.0.0.1:${address.port}/api` };
  };

  const stopApi = async () => {
    if (!apiInstance?.server.listening) return;
    const server = apiInstance.server;
    apiInstance = undefined;
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  };

  try {
    apiInstance = await startApi();
    const initialResponse = await requestAs(apiInstance.api, userId, "/profiles");
    assert.equal(initialResponse.status, 200);
    const [profile] = await initialResponse.json();
    assert.ok(profile?.id);

    const updateResponse = await requestAs(apiInstance.api, userId, `/profiles/${profile.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Bryon", trainingExperience: "advanced" }),
    });
    assert.equal(updateResponse.status, 200);
    const updatedProfile = await updateResponse.json();
    assert.equal(updatedProfile.id, profile.id);
    assert.equal(updatedProfile.name, "Bryon");
    assert.equal(updatedProfile.trainingExperience, "advanced");

    const [storedProfile] = await db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.id, profile.id));
    assert.equal(storedProfile.ownerUserId, userId);
    assert.equal(storedProfile.name, "Bryon");
    assert.equal(storedProfile.trainingExperience, "advanced");

    const refreshedResponse = await requestAs(apiInstance.api, userId, "/profiles");
    assert.equal(refreshedResponse.status, 200);
    const [refreshedProfile] = await refreshedResponse.json();
    assert.equal(refreshedProfile.id, profile.id);
    assert.equal(refreshedProfile.name, "Bryon");
    assert.equal(refreshedProfile.trainingExperience, "advanced");

    const loggedOutResponse = await fetch(`${apiInstance.api}/profiles`);
    assert.equal(loggedOutResponse.status, 401);
    await stopApi();

    apiInstance = await startApi();
    const reloggedResponse = await requestAs(apiInstance.api, userId, "/profiles");
    assert.equal(reloggedResponse.status, 200);
    const [reloggedProfile] = await reloggedResponse.json();
    assert.equal(reloggedProfile.id, profile.id);
    assert.equal(reloggedProfile.name, "Bryon");
    assert.equal(reloggedProfile.trainingExperience, "advanced");
  } finally {
    await stopApi();
    const [profile] = await db
      .select({ id: profilesTable.id })
      .from(profilesTable)
      .where(eq(profilesTable.ownerUserId, userId));
    if (profile) await cleanupProfile(profile.id);
  }
});

test("Calendar history is available without a mesocycle and stays account-scoped", async () => {
  const userA = `${QA_USER_PREFIX}calendar-a-${randomUUID()}`;
  const userB = `${QA_USER_PREFIX}calendar-b-${randomUUID()}`;
  let profileA;
  let profileB;
  let apiInstance;
  const startApi = async () => {
    const server = createServer(
      createApp({
        authMiddleware: (req, _res, next) => {
          req.auth = { userId: req.get("x-qa-user-id") ?? null };
          next();
        },
      }),
    );
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    return { server, api: `http://127.0.0.1:${address.port}/api` };
  };
  const stopApi = async () => {
    if (!apiInstance?.server.listening) return;
    const server = apiInstance.server;
    apiInstance = undefined;
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  };
  const insertSession = async (profileId, startedAt, dayName, options = {}) => {
    const start = new Date(startedAt);
    const [session] = await db
      .insert(workoutSessionsTable)
      .values({
        profileId,
        splitId: options.splitId ?? null,
        splitName: options.splitName ?? null,
        dayName,
        status: options.status ?? "completed",
        startedAt: start,
        endedAt: options.status === "active" ? null : new Date(start.getTime() + 45 * 60_000),
        trainingMode: options.trainingMode ?? "basic",
      })
      .returning();
    return session;
  };

  try {
    apiInstance = await startApi();
    const profileAResponse = await requestAs(apiInstance.api, userA, "/profiles");
    const profileBResponse = await requestAs(apiInstance.api, userB, "/profiles");
    assert.equal(profileAResponse.status, 200);
    assert.equal(profileBResponse.status, 200);
    [profileA] = await profileAResponse.json();
    [profileB] = await profileBResponse.json();
    assert.ok(profileA?.id);
    assert.ok(profileB?.id);

    await db.update(profilesTable).set({ trainingMode: "basic" }).where(eq(profilesTable.id, profileA.id));
    await db.update(profilesTable).set({ trainingMode: "legendary_pro" }).where(eq(profilesTable.id, profileB.id));
    const emptyResponse = await requestAs(
      apiInstance.api,
      userA,
      `/workouts/calendar-history?profileId=${profileA.id}`,
    );
    assert.equal(emptyResponse.status, 200);
    assert.deepEqual(await emptyResponse.json(), []);
    const emptyProResponse = await requestAs(
      apiInstance.api,
      userB,
      `/workouts/calendar-history?profileId=${profileB.id}`,
    );
    assert.equal(emptyProResponse.status, 200);
    assert.deepEqual(await emptyProResponse.json(), []);

    const manual = await insertSession(profileA.id, "2026-10-06T18:30:00.000Z", "Manual session");
    const completedSplit = await createSplit(profileA.id, "Completed historical mesocycle");
    await db.update(trainingSplitsTable)
      .set({ lifecycleStatus: "completed" })
      .where(eq(trainingSplitsTable.id, completedSplit.id));
    const completedPlanSession = await insertSession(
      profileA.id,
      "2026-10-07T18:30:00.000Z",
      "Completed plan session",
      { splitId: completedSplit.id, splitName: completedSplit.name, trainingMode: "legendary_pro" },
    );

    const endedSplit = await createSplit(profileA.id, "Ended-early historical mesocycle");
    await db.update(trainingSplitsTable)
      .set({ lifecycleStatus: "ended_early" })
      .where(eq(trainingSplitsTable.id, endedSplit.id));
    const endedPlanSession = await insertSession(
      profileA.id,
      "2026-10-08T18:30:00.000Z",
      "Ended plan session",
      { splitId: endedSplit.id, splitName: endedSplit.name },
    );

    const deletedSplit = await createSplit(profileA.id, "Deleted historical mesocycle");
    const deletedPlanSession = await insertSession(
      profileA.id,
      "2026-10-09T18:30:00.000Z",
      "Preserved session",
      { splitId: deletedSplit.id, splitName: deletedSplit.name },
    );
    await db.delete(trainingSplitsTable).where(eq(trainingSplitsTable.id, deletedSplit.id));
    const [preservedSession] = await db
      .select({ splitId: workoutSessionsTable.splitId })
      .from(workoutSessionsTable)
      .where(eq(workoutSessionsTable.id, deletedPlanSession.id));
    assert.equal(preservedSession.splitId, null);

    await insertSession(profileA.id, "2026-10-10T18:30:00.000Z", "Still in progress", { status: "active" });
    const otherAccountSession = await insertSession(profileB.id, "2026-10-11T18:30:00.000Z", "Other account");

    const ownHistoryResponse = await requestAs(
      apiInstance.api,
      userA,
      `/workouts/calendar-history?profileId=${profileA.id}`,
    );
    assert.equal(ownHistoryResponse.status, 200);
    const ownHistory = await ownHistoryResponse.json();
    assert.deepEqual(ownHistory.map((item) => item.id), [
      manual.id,
      completedPlanSession.id,
      endedPlanSession.id,
      deletedPlanSession.id,
    ]);
    assert.deepEqual(ownHistory.map((item) => item.startedAt.slice(0, 10)), [
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
    ]);
    assert.ok(!ownHistory.some((item) => item.id === otherAccountSession.id));

    const crossAccountResponse = await requestAs(
      apiInstance.api,
      userA,
      `/workouts/calendar-history?profileId=${profileB.id}`,
    );
    assert.equal(crossAccountResponse.status, 404);
    const otherHistoryResponse = await requestAs(
      apiInstance.api,
      userB,
      `/workouts/calendar-history?profileId=${profileB.id}`,
    );
    assert.equal(otherHistoryResponse.status, 200);
    const otherHistory = await otherHistoryResponse.json();
    assert.deepEqual(otherHistory.map((item) => item.id), [otherAccountSession.id]);
  } finally {
    await stopApi();
    if (profileA?.id) await cleanupProfile(profileA.id);
    if (profileB?.id) await cleanupProfile(profileB.id);
  }
});