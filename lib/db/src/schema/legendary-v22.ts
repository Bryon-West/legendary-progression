import { pgTable, serial, integer, jsonb, timestamp, text, index, doublePrecision, uniqueIndex } from "drizzle-orm/pg-core";
import { plannedWorkoutsTable, workoutSessionsTable, workoutExercisesTable, profilesTable, exercisesTable, trainingSplitsTable, mesocycleWeeksTable } from "./training";
export const plannedPrescriptionsTable = pgTable("planned_prescriptions", {
  id: serial("id").primaryKey(),
  plannedWorkoutId: integer("planned_workout_id").notNull().unique().references(() => plannedWorkoutsTable.id, { onDelete: "cascade" }),
  sourceSessionId: integer("source_session_id").references(() => workoutSessionsTable.id, { onDelete: "set null" }),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const exerciseFeedbackTable = pgTable("exercise_feedback", {
  id: serial("id").primaryKey(),
  workoutExerciseId: integer("workout_exercise_id").notNull().unique().references(() => workoutExercisesTable.id, { onDelete: "cascade" }),
  profileId: integer("profile_id").notNull().references(() => profilesTable.id, { onDelete: "cascade" }),
  sessionId: integer("session_id").notNull().references(() => workoutSessionsTable.id, { onDelete: "cascade" }),
  exerciseId: integer("exercise_id").notNull().references(() => exercisesTable.id),
  primaryMuscle: text("primary_muscle").notNull(),
  splitId: integer("split_id").references(() => trainingSplitsTable.id, { onDelete: "set null" }),
  weekId: integer("week_id").references(() => mesocycleWeeksTable.id, { onDelete: "set null" }),
  pump: text("pump").notNull(),
  fatigue: text("fatigue").notNull(),
  discomfort: text("discomfort").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("exercise_feedback_recovery_idx").on(t.profileId, t.exerciseId, t.createdAt)]);
export const plannedPrescriptionSetsTable = pgTable("planned_prescription_sets", {
  id: serial("id").primaryKey(),
  prescriptionId: integer("prescription_id").notNull().references(() => plannedPrescriptionsTable.id, { onDelete: "cascade" }),
  exerciseId: integer("exercise_id").notNull().references(() => exercisesTable.id),
  exerciseOrder: integer("exercise_order").notNull(),
  setNumber: integer("set_number").notNull(),
  recommendedWeight: doublePrecision("recommended_weight"),
  expectedReps: integer("expected_reps"),
  prescribedRir: doublePrecision("prescribed_rir").notNull(),
  reference: jsonb("reference").$type<Record<string, unknown>>(),
}, t => [uniqueIndex("prescription_exercise_set_unique").on(t.prescriptionId, t.exerciseOrder, t.setNumber)]);