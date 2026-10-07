import { eq, sql } from "drizzle-orm";
import { betaFeedbackRolesTable, db } from "@workspace/db";
import type { BetaFeedbackRole } from "@workspace/db";

function configuredBootstrapOwnerId(): string | null {
  const ids = (process.env.BETA_FEEDBACK_ADMIN_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.length === 1 ? ids[0] : null;
}

/**
 * The environment value is only an explicit, one-time bootstrap identity.
 * After an owner row exists, permissions come exclusively from the database.
 */
export async function getBetaFeedbackRole(
  profileId: number,
  userId: string | undefined,
): Promise<BetaFeedbackRole | null> {
  const [existing] = await db
    .select({ role: betaFeedbackRolesTable.role })
    .from(betaFeedbackRolesTable)
    .where(eq(betaFeedbackRolesTable.profileId, profileId))
    .limit(1);
  if (existing?.role === "owner") return "owner";

  const bootstrapOwnerId = configuredBootstrapOwnerId();
  if (!userId || !bootstrapOwnerId || userId !== bootstrapOwnerId) {
    return existing?.role ?? null;
  }

  await db.transaction(async (tx) => {
    // Serialize bootstrap attempts so two requests cannot claim the owner slot.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(6840291842)`);
    const [owner] = await tx
      .select({ profileId: betaFeedbackRolesTable.profileId })
      .from(betaFeedbackRolesTable)
      .where(eq(betaFeedbackRolesTable.role, "owner"))
      .limit(1);
    if (owner && owner.profileId !== profileId) return;

    await tx
      .insert(betaFeedbackRolesTable)
      .values({
        profileId,
        role: "owner",
        grantedByProfileId: null,
      })
      .onConflictDoUpdate({
        target: betaFeedbackRolesTable.profileId,
        set: {
          role: "owner",
          grantedByProfileId: null,
          grantedAt: new Date(),
        },
      });
  });

  const [bootstrapped] = await db
    .select({ role: betaFeedbackRolesTable.role })
    .from(betaFeedbackRolesTable)
    .where(eq(betaFeedbackRolesTable.profileId, profileId))
    .limit(1);
  return bootstrapped?.role ?? null;
}
