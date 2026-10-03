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