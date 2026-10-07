import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  betaFeedbackRolesTable,
  betaFeedbackTable,
  db,
  profilesTable,
} from "@workspace/db";
import { createApp } from "../app.ts";

const QA_USER_PREFIX = "beta-feedback-qa-";

function requestAs(api, userId, path, options = {}) {
  return fetch(`${api}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers ?? {}),
      "x-qa-user-id": userId,
    },
  });
}

test("feedback roles persist, stay feedback-scoped, and only an owner can manage managers", async () => {
  const reporterUserId = `${QA_USER_PREFIX}${randomUUID()}`;
  const viewerUserId = `${QA_USER_PREFIX}${randomUUID()}`;
  const ownerUserId = `${QA_USER_PREFIX}${randomUUID()}`;
  const managerUserId = `${QA_USER_PREFIX}${randomUUID()}`;
  const priorAdminIds = process.env.BETA_FEEDBACK_ADMIN_USER_IDS;
  let server;
  let reporterProfileId;
  let viewerProfileId;
  let ownerProfileId;
  let managerProfileId;
  let feedbackId;

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

    const profilesFor = async (userId) => {
      const response = await requestAs(api, userId, "/profiles");
      assert.equal(response.status, 200);
      return (await response.json())[0].id;
    };
    reporterProfileId = await profilesFor(reporterUserId);
    viewerProfileId = await profilesFor(viewerUserId);
    ownerProfileId = await profilesFor(ownerUserId);
    managerProfileId = await profilesFor(managerUserId);

    const renameResponse = await requestAs(api, reporterUserId, `/profiles/${reporterProfileId}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "QA Reporter" }),
    });
    assert.equal(renameResponse.status, 200);

    const createResponse = await requestAs(api, reporterUserId, "/beta-feedback", {
      method: "POST",
      body: JSON.stringify({ category: "suggestion", description: "Make the new plan template easier to find." }),
    });
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();
    feedbackId = created.id;
    assert.equal(created.reporterName, "QA Reporter");
    assert.equal(created.status, "reported");
    assert.deepEqual(Object.keys(created).sort(), [
      "category",
      "createdAt",
      "description",
      "id",
      "reporterName",
      "status",
    ]);

    const invalidCreate = await requestAs(api, reporterUserId, "/beta-feedback", {
      method: "POST",
      body: JSON.stringify({ category: "other", description: "Invalid category" }),
    });
    assert.equal(invalidCreate.status, 400);

    const viewerListResponse = await requestAs(api, viewerUserId, "/beta-feedback");
    assert.equal(viewerListResponse.status, 200);
    const viewerList = await viewerListResponse.json();
    assert.equal(viewerList.canManage, false);
    assert.equal(viewerList.canManageManagers, false);
    assert.ok(viewerList.entries.some((entry) => entry.id === feedbackId));
    assert.equal(JSON.stringify(viewerList).includes("ownerUserId"), false);
    assert.equal(JSON.stringify(viewerList).includes("email"), false);
    assert.equal(JSON.stringify(viewerList).includes("clerk"), false);

    const forbiddenStatus = await requestAs(api, viewerUserId, `/beta-feedback/${feedbackId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "fixed" }),
    });
    assert.equal(forbiddenStatus.status, 403);
    const forbiddenDelete = await requestAs(api, viewerUserId, `/beta-feedback/${feedbackId}`, {
      method: "DELETE",
    });
    assert.equal(forbiddenDelete.status, 403);
    const forbiddenManagerList = await requestAs(api, viewerUserId, "/beta-feedback/managers");
    assert.equal(forbiddenManagerList.status, 403);
    const forbiddenManagerGrant = await requestAs(api, viewerUserId, "/beta-feedback/managers", {
      method: "POST",
      body: JSON.stringify({ targetProfileId: managerProfileId }),
    });
    assert.equal(forbiddenManagerGrant.status, 403);
    const [unchanged] = await db.select().from(betaFeedbackTable)
      .where(eq(betaFeedbackTable.id, feedbackId));
    assert.equal(unchanged.status, "reported");

    // The single configured identity bootstraps exactly one persistent owner.
    process.env.BETA_FEEDBACK_ADMIN_USER_IDS = ownerUserId;
    const ownerManagerListResponse = await requestAs(api, ownerUserId, "/beta-feedback/managers");
    assert.equal(ownerManagerListResponse.status, 200);
    const available = await ownerManagerListResponse.json();
    assert.ok(available.candidates.some((profile) => profile.profileId === managerProfileId));
    assert.equal(JSON.stringify(available).includes("ownerUserId"), false);
    assert.equal(JSON.stringify(available).includes("email"), false);
    assert.equal(JSON.stringify(available).includes("clerk"), false);

    const grantResponse = await requestAs(api, ownerUserId, "/beta-feedback/managers", {
      method: "POST",
      body: JSON.stringify({ targetProfileId: managerProfileId }),
    });
    assert.equal(grantResponse.status, 201);
    const granted = await grantResponse.json();
    assert.equal(granted.profileId, managerProfileId);
    assert.equal(granted.name, "Athlete");
    assert.ok(granted.grantedAt);
    assert.equal(JSON.stringify(granted).includes("ownerUserId"), false);
    assert.equal(JSON.stringify(granted).includes("email"), false);
    assert.equal(JSON.stringify(granted).includes("clerk"), false);

    // The allowlist is no longer needed after the owner row is persisted.
    delete process.env.BETA_FEEDBACK_ADMIN_USER_IDS;
    const ownerListResponse = await requestAs(api, ownerUserId, "/beta-feedback");
    assert.equal(ownerListResponse.status, 200);
    const ownerList = await ownerListResponse.json();
    assert.equal(ownerList.canManage, true);
    assert.equal(ownerList.canManageManagers, true);

    const duplicateGrant = await requestAs(api, ownerUserId, "/beta-feedback/managers", {
      method: "POST",
      body: JSON.stringify({ targetProfileId: managerProfileId }),
    });
    assert.equal(duplicateGrant.status, 409);

    const managerListResponse = await requestAs(api, managerUserId, "/beta-feedback");
    assert.equal(managerListResponse.status, 200);
    const managerList = await managerListResponse.json();
    assert.equal(managerList.canManage, true);
    assert.equal(managerList.canManageManagers, false);

    const updateResponse = await requestAs(api, managerUserId, `/beta-feedback/${feedbackId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "planned" }),
    });
    assert.equal(updateResponse.status, 200);
    assert.equal((await updateResponse.json()).status, "planned");

    const invalidStatus = await requestAs(api, managerUserId, `/beta-feedback/${feedbackId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "in_progress" }),
    });
    assert.equal(invalidStatus.status, 400);

    const managerForbiddenList = await requestAs(api, managerUserId, "/beta-feedback/managers");
    assert.equal(managerForbiddenList.status, 403);
    const managerForbiddenGrant = await requestAs(api, managerUserId, "/beta-feedback/managers", {
      method: "POST",
      body: JSON.stringify({ targetProfileId: viewerProfileId }),
    });
    assert.equal(managerForbiddenGrant.status, 403);
    const managerForbiddenRevoke = await requestAs(api, managerUserId, `/beta-feedback/managers/${ownerProfileId}`, {
      method: "DELETE",
    });
    assert.equal(managerForbiddenRevoke.status, 403);

    // A feedback manager does not gain access to another account's training profile.
    const foreignProfileResponse = await requestAs(api, managerUserId, `/profiles/${reporterProfileId}`);
    assert.equal(foreignProfileResponse.status, 404);

    // Owner role cannot be removed through the manager-revocation endpoint.
    const ownerRevokeAttempt = await requestAs(api, ownerUserId, `/beta-feedback/managers/${ownerProfileId}`, {
      method: "DELETE",
    });
    assert.equal(ownerRevokeAttempt.status, 404);
    const [persistentOwner] = await db.select().from(betaFeedbackRolesTable)
      .where(eq(betaFeedbackRolesTable.profileId, ownerProfileId));
    assert.equal(persistentOwner.role, "owner");

    const deleteResponse = await requestAs(api, managerUserId, `/beta-feedback/${feedbackId}`, {
      method: "DELETE",
    });
    assert.equal(deleteResponse.status, 200);
    assert.deepEqual(await deleteResponse.json(), { deleted: true });
    feedbackId = undefined;

    const revokeResponse = await requestAs(api, ownerUserId, `/beta-feedback/managers/${managerProfileId}`, {
      method: "DELETE",
    });
    assert.equal(revokeResponse.status, 200);
    assert.deepEqual(await revokeResponse.json(), { revoked: true });
    const revokedManagerList = await requestAs(api, managerUserId, "/beta-feedback");
    assert.equal(revokedManagerList.status, 200);
    const revoked = await revokedManagerList.json();
    assert.equal(revoked.canManage, false);
    assert.equal(revoked.canManageManagers, false);
    const revokedStatus = await requestAs(api, managerUserId, `/beta-feedback/${created.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "fixed" }),
    });
    assert.equal(revokedStatus.status, 403);

    const ownerStillActive = await requestAs(api, ownerUserId, "/beta-feedback/managers");
    assert.equal(ownerStillActive.status, 200);
    assert.deepEqual((await ownerStillActive.json()).managers, []);
  } finally {
    if (priorAdminIds === undefined) delete process.env.BETA_FEEDBACK_ADMIN_USER_IDS;
    else process.env.BETA_FEEDBACK_ADMIN_USER_IDS = priorAdminIds;
    try {
      if (feedbackId !== undefined) {
        await db.delete(betaFeedbackTable).where(eq(betaFeedbackTable.id, feedbackId));
      }
      for (const profileId of [reporterProfileId, viewerProfileId, ownerProfileId, managerProfileId]) {
        if (profileId !== undefined) {
          await db.delete(profilesTable).where(eq(profilesTable.id, profileId));
        }
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
