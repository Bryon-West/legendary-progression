import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import {
  CreateBetaFeedbackBody,
  CreateBetaFeedbackResponse,
  DeleteBetaFeedbackParams,
  DeleteBetaFeedbackResponse,
  ListBetaFeedbackManagersResponse,
  ListBetaFeedbackResponse,
  GrantBetaFeedbackManagerBody,
  GrantBetaFeedbackManagerResponse,
  RevokeBetaFeedbackManagerParams,
  RevokeBetaFeedbackManagerResponse,
  UpdateBetaFeedbackStatusBody,
  UpdateBetaFeedbackStatusParams,
  UpdateBetaFeedbackStatusResponse,
} from "@workspace/api-zod";
import {
  betaFeedbackRolesTable,
  betaFeedbackTable,
  db,
  profilesTable,
} from "@workspace/db";
import { getBetaFeedbackRole } from "../lib/beta-feedback-permissions";

type AccountRequest = Request & {
  accountUserId?: string;
  accountProfileId?: number;
};

const router: IRouter = Router();

async function roleFor(req: AccountRequest) {
  if (!req.accountProfileId || !req.accountUserId) return null;
  return getBetaFeedbackRole(req.accountProfileId, req.accountUserId);
}

async function requireFeedbackManager(
  req: AccountRequest,
  res: Response,
): Promise<boolean> {
  const role = await roleFor(req);
  if (role === "owner" || role === "manager") return true;
  res.status(403).json({ error: "Feedback manager access required" });
  return false;
}

async function requireFeedbackOwner(
  req: AccountRequest,
  res: Response,
): Promise<boolean> {
  if ((await roleFor(req)) === "owner") return true;
  res.status(403).json({ error: "Feedback owner access required" });
  return false;
}

async function entryWithReporter(feedbackId: number) {
  const [row] = await db
    .select({
      id: betaFeedbackTable.id,
      category: betaFeedbackTable.category,
      description: betaFeedbackTable.description,
      status: betaFeedbackTable.status,
      createdAt: betaFeedbackTable.createdAt,
      reporterName: profilesTable.name,
    })
    .from(betaFeedbackTable)
    .innerJoin(profilesTable, eq(betaFeedbackTable.profileId, profilesTable.id))
    .where(eq(betaFeedbackTable.id, feedbackId))
    .limit(1);
  if (!row) return null;
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get("/beta-feedback", async (request, res): Promise<void> => {
  const req = request as AccountRequest;
  const role = await roleFor(req);
  const rows = await db
    .select({
      id: betaFeedbackTable.id,
      category: betaFeedbackTable.category,
      description: betaFeedbackTable.description,
      status: betaFeedbackTable.status,
      createdAt: betaFeedbackTable.createdAt,
      reporterName: profilesTable.name,
    })
    .from(betaFeedbackTable)
    .innerJoin(profilesTable, eq(betaFeedbackTable.profileId, profilesTable.id))
    .orderBy(desc(betaFeedbackTable.createdAt), desc(betaFeedbackTable.id));
  res.json(ListBetaFeedbackResponse.parse({
    entries: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    canManage: role === "owner" || role === "manager",
    canManageManagers: role === "owner",
  }));
});

router.post("/beta-feedback", async (request, res): Promise<void> => {
  const req = request as AccountRequest;
  const body = CreateBetaFeedbackBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  if (!req.accountProfileId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const description = body.data.description.trim();
  if (description.length < 5 || description.length > 2000) {
    res.status(400).json({ error: "Description must contain 5 to 2000 characters." });
    return;
  }
  const [record] = await db.insert(betaFeedbackTable).values({
    profileId: req.accountProfileId,
    category: body.data.category,
    description,
  }).returning({ id: betaFeedbackTable.id });
  const entry = await entryWithReporter(record.id);
  if (!entry) {
    res.status(500).json({ error: "Feedback was saved but could not be loaded." });
    return;
  }
  res.status(201).json(CreateBetaFeedbackResponse.parse(entry));
});

router.patch("/beta-feedback/:feedbackId/status", async (request, res): Promise<void> => {
  const req = request as AccountRequest;
  if (!(await requireFeedbackManager(req, res))) return;
  const params = UpdateBetaFeedbackStatusParams.safeParse(req.params);
  const body = UpdateBetaFeedbackStatusBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      error: !params.success ? params.error.message : !body.success ? body.error.message : "Invalid request",
    });
    return;
  }
  const [updated] = await db.update(betaFeedbackTable)
    .set({ status: body.data.status })
    .where(eq(betaFeedbackTable.id, params.data.feedbackId))
    .returning({ id: betaFeedbackTable.id });
  if (!updated) {
    res.status(404).json({ error: "Feedback not found" });
    return;
  }
  const entry = await entryWithReporter(updated.id);
  if (!entry) {
    res.status(404).json({ error: "Feedback not found" });
    return;
  }
  res.json(UpdateBetaFeedbackStatusResponse.parse(entry));
});

router.delete("/beta-feedback/:feedbackId", async (request, res): Promise<void> => {
  const req = request as AccountRequest;
  if (!(await requireFeedbackManager(req, res))) return;
  const params = DeleteBetaFeedbackParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db.delete(betaFeedbackTable)
    .where(eq(betaFeedbackTable.id, params.data.feedbackId))
    .returning({ id: betaFeedbackTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Feedback not found" });
    return;
  }
  res.json(DeleteBetaFeedbackResponse.parse({ deleted: true }));
});

router.get("/beta-feedback/managers", async (request, res): Promise<void> => {
  const req = request as AccountRequest;
  if (!(await requireFeedbackOwner(req, res))) return;

  const [managers, assigned, profiles] = await Promise.all([
    db
      .select({
        profileId: betaFeedbackRolesTable.profileId,
        name: profilesTable.name,
        grantedAt: betaFeedbackRolesTable.grantedAt,
      })
      .from(betaFeedbackRolesTable)
      .innerJoin(
        profilesTable,
        eq(betaFeedbackRolesTable.profileId, profilesTable.id),
      )
      .where(eq(betaFeedbackRolesTable.role, "manager"))
      .orderBy(profilesTable.name, betaFeedbackRolesTable.profileId),
    db
      .select({ profileId: betaFeedbackRolesTable.profileId })
      .from(betaFeedbackRolesTable),
    db
      .select({
        profileId: profilesTable.id,
        name: profilesTable.name,
      })
      .from(profilesTable)
      .where(isNotNull(profilesTable.ownerUserId))
      .orderBy(profilesTable.name, profilesTable.id),
  ]);
  const assignedIds = new Set(assigned.map((row) => row.profileId));
  res.json(ListBetaFeedbackManagersResponse.parse({
    managers: managers.map((manager) => ({
      ...manager,
      grantedAt: manager.grantedAt.toISOString(),
    })),
    candidates: profiles.filter((profile) => !assignedIds.has(profile.profileId)),
  }));
});

router.post("/beta-feedback/managers", async (request, res): Promise<void> => {
  const req = request as AccountRequest;
  if (!(await requireFeedbackOwner(req, res))) return;

  const body = GrantBetaFeedbackManagerBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [candidate] = await db
    .select({
      profileId: profilesTable.id,
      name: profilesTable.name,
    })
    .from(profilesTable)
    .where(and(
      eq(profilesTable.id, body.data.targetProfileId),
      isNotNull(profilesTable.ownerUserId),
    ))
    .limit(1);
  if (!candidate) {
    res.status(404).json({ error: "Existing account not found" });
    return;
  }

  const [inserted] = await db
    .insert(betaFeedbackRolesTable)
    .values({
      profileId: candidate.profileId,
      role: "manager",
      grantedByProfileId: req.accountProfileId ?? null,
    })
    .onConflictDoNothing()
    .returning({
      profileId: betaFeedbackRolesTable.profileId,
      grantedAt: betaFeedbackRolesTable.grantedAt,
    });
  if (!inserted) {
    res.status(409).json({ error: "Account already has feedback permission" });
    return;
  }
  res.status(201).json(GrantBetaFeedbackManagerResponse.parse({
    profileId: inserted.profileId,
    name: candidate.name,
    grantedAt: inserted.grantedAt.toISOString(),
  }));
});

router.delete(
  "/beta-feedback/managers/:targetProfileId",
  async (request, res): Promise<void> => {
    const req = request as AccountRequest;
    if (!(await requireFeedbackOwner(req, res))) return;

    const params = RevokeBetaFeedbackManagerParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [revoked] = await db
      .delete(betaFeedbackRolesTable)
      .where(and(
        eq(betaFeedbackRolesTable.profileId, params.data.targetProfileId),
        eq(betaFeedbackRolesTable.role, "manager"),
      ))
      .returning({ profileId: betaFeedbackRolesTable.profileId });
    if (!revoked) {
      res.status(404).json({ error: "Feedback manager not found" });
      return;
    }
    res.json(RevokeBetaFeedbackManagerResponse.parse({ revoked: true }));
  },
);

export default router;
