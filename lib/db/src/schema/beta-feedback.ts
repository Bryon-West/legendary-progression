import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { profilesTable } from "./training";

export type BetaFeedbackCategory = "bug" | "missing" | "suggestion" | "confusing";
export type BetaFeedbackStatus = "reported" | "planned" | "fixed";

export const betaFeedbackTable = pgTable("beta_feedback", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id")
    .notNull()
    .references(() => profilesTable.id, { onDelete: "cascade" }),
  category: text("category").$type<BetaFeedbackCategory>().notNull(),
  description: text("description").notNull(),
  status: text("status").$type<BetaFeedbackStatus>().notNull().default("reported"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check(
    "beta_feedback_category_check",
    sql`${table.category} IN ('bug', 'missing', 'suggestion', 'confusing')`,
  ),
  check(
    "beta_feedback_status_check",
    sql`${table.status} IN ('reported', 'planned', 'fixed')`,
  ),
  index("beta_feedback_created_at_idx").on(table.createdAt),
]);

export const insertBetaFeedbackSchema = createInsertSchema(betaFeedbackTable).omit({
  id: true,
  profileId: true,
  status: true,
  createdAt: true,
});

export type InsertBetaFeedback = z.infer<typeof insertBetaFeedbackSchema>;
export type BetaFeedback = typeof betaFeedbackTable.$inferSelect;
