import { getAuth } from "@clerk/express";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import {
  db,
  exerciseBaselinesTable,
  exerciseFeedbackTable,
  exercisesTable,
  mesocycleWeeksTable,
  muscleRecoveryTable,
  plannedPrescriptionSetsTable,
  plannedPrescriptionsTable,
  plannedWorkoutsTable,
  profilesTable,
  splitDayExercisesTable,
  splitDaysTable,
  trainingSplitsTable,
  workoutExercisesTable,
  workoutSessionsTable,
  workoutSetsTable,
} from "@workspace/db";

type Resource =
  | "split"
  | "day"
  | "dayExercise"
  | "week"
  | "plannedWorkout"
  | "session"
  | "workoutExercise"
  | "workoutSet"
  | "exercise"
  | "prescription"
  | "prescriptionSet"
  | "baseline"
  | "recovery"
  | "feedback";

type AuthState = { userId?: string | null };
type AccountRequest = Request & {
  auth?: AuthState;
  accountUserId?: string;
  accountProfileId?: number;
};

const bodyResourceKeys: Record<string, Resource | "profile"> = {
  profileId: "profile",
  splitId: "split",
  sourceSplitId: "split",
  restartFromId: "split",
  dayId: "day",
  splitDayId: "day",
  weekId: "week",
  sourceWeekId: "week",
  plannedId: "plannedWorkout",
  plannedWorkoutId: "plannedWorkout",
  scheduledWorkoutId: "plannedWorkout",
  sessionId: "session",
  workoutSessionId: "session",
  sourceSessionId: "session",
  workoutExerciseId: "workoutExercise",
  setId: "workoutSet",
  workoutSetId: "workoutSet",
  sourceSetId: "workoutSet",
  exerciseId: "exercise",
  substitutedFromExerciseId: "exercise",
  dayExerciseId: "dayExercise",
  splitDayExerciseId: "dayExercise",
  prescriptionId: "prescription",
  plannedPrescriptionId: "prescription",
  prescriptionSetId: "prescriptionSet",
  plannedPrescriptionSetId: "prescriptionSet",
  baselineId: "baseline",
  recoveryId: "recovery",
  feedbackId: "feedback",
};

function idFrom(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function addId(
  refs: Map<Resource | "profile", Set<number>>,
  resource: Resource | "profile",
  value: unknown,
) {
  const id = idFrom(value);
  if (id === null) return;
  const ids = refs.get(resource) ?? new Set<number>();
  ids.add(id);
  refs.set(resource, ids);
}

function collectBodyReferences(
  value: unknown,
  refs: Map<Resource | "profile", Set<number>>,
  rejectIdentityFields: () => void,
) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectBodyReferences(item, refs, rejectIdentityFields);
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (["ownerUserId", "userId", "accountId", "ownerId"].includes(key)) {
      rejectIdentityFields();
    }
    const resource = bodyResourceKeys[key];
    if (resource) addId(refs, resource, nested);
    collectBodyReferences(nested, refs, rejectIdentityFields);
  }
}

function collectPathReferences(pathname: string, refs: Map<Resource | "profile", Set<number>>) {
  const parts = pathname.split("/").filter(Boolean);
  const put = (index: number, resource: Resource | "profile") => {
    if (parts[index] && /^\d+$/.test(parts[index])) addId(refs, resource, parts[index]);
  };

  if (parts[0] === "profiles") {
    put(1, "profile");
    if (parts[2] === "exercises") put(3, "exercise");
  }
  if (parts[0] === "splits") put(1, "split");
  if (parts[0] === "split-days") put(1, "day");
  if (parts[0] === "split-day-exercises") put(1, "dayExercise");
  if (parts[0] === "mesocycles") {
    put(1, "split");
    if (parts[2] === "weeks") put(3, "week");
  }
  if (parts[0] === "planned-workouts") put(1, "plannedWorkout");
  if (parts[0] === "workouts") {
    put(1, "session");
    if (parts[2] === "exercises") put(3, "workoutExercise");
  }
}

async function verifyOwnedIds(
  resource: Resource,
  ids: number[],
  profileId: number,
): Promise<boolean> {
  if (!ids.length) return true;
  let rows: Array<{ id: number }>;
  switch (resource) {
    case "split":
      rows = await db
        .select({ id: trainingSplitsTable.id })
        .from(trainingSplitsTable)
        .where(and(inArray(trainingSplitsTable.id, ids), eq(trainingSplitsTable.profileId, profileId)));
      break;
    case "day":
      rows = await db
        .select({ id: splitDaysTable.id })
        .from(splitDaysTable)
        .innerJoin(trainingSplitsTable, eq(splitDaysTable.splitId, trainingSplitsTable.id))
        .where(and(inArray(splitDaysTable.id, ids), eq(trainingSplitsTable.profileId, profileId)));
      break;
    case "dayExercise":
      rows = await db
        .select({ id: splitDayExercisesTable.id })
        .from(splitDayExercisesTable)
        .innerJoin(splitDaysTable, eq(splitDayExercisesTable.dayId, splitDaysTable.id))
        .innerJoin(trainingSplitsTable, eq(splitDaysTable.splitId, trainingSplitsTable.id))
        .where(and(inArray(splitDayExercisesTable.id, ids), eq(trainingSplitsTable.profileId, profileId)));
      break;
    case "week":
      rows = await db
        .select({ id: mesocycleWeeksTable.id })
        .from(mesocycleWeeksTable)
        .innerJoin(trainingSplitsTable, eq(mesocycleWeeksTable.splitId, trainingSplitsTable.id))
        .where(and(inArray(mesocycleWeeksTable.id, ids), eq(trainingSplitsTable.profileId, profileId)));
      break;
    case "plannedWorkout":
      rows = await db
        .select({ id: plannedWorkoutsTable.id })
        .from(plannedWorkoutsTable)
        .innerJoin(trainingSplitsTable, eq(plannedWorkoutsTable.splitId, trainingSplitsTable.id))
        .where(and(inArray(plannedWorkoutsTable.id, ids), eq(trainingSplitsTable.profileId, profileId)));
      break;
    case "session":
      rows = await db
        .select({ id: workoutSessionsTable.id })
        .from(workoutSessionsTable)
        .where(and(inArray(workoutSessionsTable.id, ids), eq(workoutSessionsTable.profileId, profileId)));
      break;
    case "workoutExercise":
      rows = await db
        .select({ id: workoutExercisesTable.id })
        .from(workoutExercisesTable)
        .innerJoin(workoutSessionsTable, eq(workoutExercisesTable.sessionId, workoutSessionsTable.id))
        .where(and(inArray(workoutExercisesTable.id, ids), eq(workoutSessionsTable.profileId, profileId)));
      break;
    case "workoutSet":
      rows = await db
        .select({ id: workoutSetsTable.id })
        .from(workoutSetsTable)
        .innerJoin(workoutExercisesTable, eq(workoutSetsTable.workoutExerciseId, workoutExercisesTable.id))
        .innerJoin(workoutSessionsTable, eq(workoutExercisesTable.sessionId, workoutSessionsTable.id))
        .where(and(inArray(workoutSetsTable.id, ids), eq(workoutSessionsTable.profileId, profileId)));
      break;
    case "exercise":
      rows = await db
        .select({ id: exercisesTable.id })
        .from(exercisesTable)
        .where(
          and(
            inArray(exercisesTable.id, ids),
            or(isNull(exercisesTable.profileId), eq(exercisesTable.profileId, profileId)),
          ),
        );
      break;
    case "prescription":
      rows = await db
        .select({ id: plannedPrescriptionsTable.id })
        .from(plannedPrescriptionsTable)
        .innerJoin(plannedWorkoutsTable, eq(plannedPrescriptionsTable.plannedWorkoutId, plannedWorkoutsTable.id))
        .innerJoin(trainingSplitsTable, eq(plannedWorkoutsTable.splitId, trainingSplitsTable.id))
        .where(and(inArray(plannedPrescriptionsTable.id, ids), eq(trainingSplitsTable.profileId, profileId)));
      break;
    case "prescriptionSet":
      rows = await db
        .select({ id: plannedPrescriptionSetsTable.id })
        .from(plannedPrescriptionSetsTable)
        .innerJoin(plannedPrescriptionsTable, eq(plannedPrescriptionSetsTable.prescriptionId, plannedPrescriptionsTable.id))
        .innerJoin(plannedWorkoutsTable, eq(plannedPrescriptionsTable.plannedWorkoutId, plannedWorkoutsTable.id))
        .innerJoin(trainingSplitsTable, eq(plannedWorkoutsTable.splitId, trainingSplitsTable.id))
        .where(and(inArray(plannedPrescriptionSetsTable.id, ids), eq(trainingSplitsTable.profileId, profileId)));
      break;
    case "baseline":
      rows = await db
        .select({ id: exerciseBaselinesTable.id })
        .from(exerciseBaselinesTable)
        .where(and(inArray(exerciseBaselinesTable.id, ids), eq(exerciseBaselinesTable.profileId, profileId)));
      break;
    case "recovery":
      rows = await db
        .select({ id: muscleRecoveryTable.id })
        .from(muscleRecoveryTable)
        .innerJoin(workoutSessionsTable, eq(muscleRecoveryTable.sessionId, workoutSessionsTable.id))
        .where(and(inArray(muscleRecoveryTable.id, ids), eq(workoutSessionsTable.profileId, profileId)));
      break;
    case "feedback":
      rows = await db
        .select({ id: exerciseFeedbackTable.id })
        .from(exerciseFeedbackTable)
        .where(and(inArray(exerciseFeedbackTable.id, ids), eq(exerciseFeedbackTable.profileId, profileId)));
      break;
  }
  return new Set(rows.map((row) => row.id)).size === ids.length;
}

export const requireAccountProfile: RequestHandler = async (request, res, next) => {
  const req = request as AccountRequest;
  let userId: string | null | undefined;
  try {
    userId = req.auth && "userId" in req.auth ? req.auth.userId : getAuth(req).userId;
  } catch {
    userId = null;
  }
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    let [profile] = await db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.ownerUserId, userId))
      .limit(1);
    if (!profile) {
      [profile] = await db
        .insert(profilesTable)
        .values({ name: "Athlete", ownerUserId: userId })
        .onConflictDoNothing()
        .returning();
      if (!profile) {
        [profile] = await db
          .select()
          .from(profilesTable)
          .where(eq(profilesTable.ownerUserId, userId))
          .limit(1);
      }
    }
    if (!profile) throw new Error("Could not provision the account profile");

    req.accountUserId = userId;
    req.accountProfileId = profile.id;

    next();
  } catch (error) {
    next(error);
  }
};

export const authorizeAccountResources: RequestHandler = async (request, res, next) => {
  const req = request as AccountRequest;
  const profileId = req.accountProfileId;
  if (!profileId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const refs = new Map<Resource | "profile", Set<number>>();
  collectPathReferences(req.path, refs);
  let rejectedIdentity = false;
  collectBodyReferences(req.query, refs, () => {
    rejectedIdentity = true;
  });
  collectBodyReferences(req.body, refs, () => {
    rejectedIdentity = true;
  });
  if (rejectedIdentity) {
    res.status(400).json({ error: "Account ownership is server-controlled" });
    return;
  }

  const requestedProfileIds = refs.get("profile");
  if (requestedProfileIds && [...requestedProfileIds].some((id) => id !== profileId)) {
    res.status(404).json({ error: "Resource not found" });
    return;
  }

  try {
    const resources = [...refs.entries()].filter(
      (entry): entry is [Resource, Set<number>] => entry[0] !== "profile",
    );
    const checks = await Promise.all(
      resources.map(([resource, ids]) => verifyOwnedIds(resource, [...ids], profileId)),
    );
    if (checks.some((isOwned) => !isOwned)) {
      res.status(404).json({ error: "Resource not found" });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
};

export function requireSameOriginApiRequest(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const origin = req.get("origin");
  const fetchSite = req.get("sec-fetch-site");
  if (fetchSite === "cross-site") {
    res.status(403).json({ error: "Cross-site requests are not allowed" });
    return;
  }
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      res.status(403).json({ error: "Invalid request origin" });
      return;
    }
    const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
    const requestHost = (forwardedHost || req.get("host") || "").toLowerCase();
    if (originHost !== requestHost) {
      res.status(403).json({ error: "Cross-origin requests are not allowed" });
      return;
    }
  }
  next();
}