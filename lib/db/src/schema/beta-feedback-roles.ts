import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { profilesTable } from "./training";

export type BetaFeedbackRole = "owner" | "manager";

export const betaFeedbackRolesTable = pgTable("beta_feedback_roles", {
  profileId: integer("profile_id")
    .primaryKey()
    .references(() => profilesTable.id, { onDelete: "cascade" }),
  role: text("role").$type<BetaFeedbackRole>().notNull(),
  grantedByProfileId: integer("granted_by_profile_id"),
  grantedAt: timestamp("granted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  foreignKey({
    name: "beta_feedback_roles_granted_by_profile_fk",
    columns: [table.grantedByProfileId],
    foreignColumns: [profilesTable.id],
  }).onDelete("set null"),
  check(
    "beta_feedback_roles_role_check",
    sql`${table.role} IN ('owner', 'manager')`,
  ),
  uniqueIndex("beta_feedback_one_owner_idx")
    .on(table.role)
    .where(sql`${table.role} = 'owner'`),
]);

export const insertBetaFeedbackRoleSchema = createInsertSchema(
  betaFeedbackRolesTable,
).omit({
  grantedAt: true,
});

export type InsertBetaFeedbackRole = z.infer<
  typeof insertBetaFeedbackRoleSchema
>;
export type BetaFeedbackRoleRecord = typeof betaFeedbackRolesTable.$inferSelect;
