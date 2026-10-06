import {
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { plannedWorkoutsTable, workoutSessionsTable, workoutExercisesTable, profilesTable, exercisesTable, trainingSplitsTable, mesocycleWeeksTable } from "./training";

export const plannedPrescriptionsTable = pgTable("planned_prescriptions", {
  id: serial("id").primaryKey(),
  plannedWorkoutId: integer("planned_workout_id")
    .notNull()
    .unique("planned_prescriptions_planned_workout_id_key"),
  sourceSessionId: integer("source_session_id"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    name: "planned_prescriptions_planned_workout_id_fkey",
    columns: [table.plannedWorkoutId],
    foreignColumns: [plannedWorkoutsTable.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "planned_prescriptions_source_session_id_fkey",
    columns: [table.sourceSessionId],
    foreignColumns: [workoutSessionsTable.id],
  }).onDelete("set null"),
]);

export const exerciseFeedbackTable = pgTable("exercise_feedback", {
  id: serial("id").primaryKey(),
  workoutExerciseId: integer("workout_exercise_id")
    .notNull()
    .unique("exercise_feedback_workout_exercise_id_key"),
  profileId: integer("profile_id").notNull(),
  sessionId: integer("session_id").notNull(),
  exerciseId: integer("exercise_id").notNull(),
  primaryMuscle: text("primary_muscle").notNull(),
  splitId: integer("split_id"),
  weekId: integer("week_id"),
  pump: text("pump").notNull(),
  fatigue: text("fatigue").notNull(),
  discomfort: text("discomfort").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    name: "exercise_feedback_workout_exercise_id_fkey",
    columns: [table.workoutExerciseId],
    foreignColumns: [workoutExercisesTable.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "exercise_feedback_profile_id_fkey",
    columns: [table.profileId],
    foreignColumns: [profilesTable.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "exercise_feedback_session_id_fkey",
    columns: [table.sessionId],
    foreignColumns: [workoutSessionsTable.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "exercise_feedback_exercise_id_fkey",
    columns: [table.exerciseId],
    foreignColumns: [exercisesTable.id],
  }).onDelete("restrict"),
  foreignKey({
    name: "exercise_feedback_split_id_fkey",
    columns: [table.splitId],
    foreignColumns: [trainingSplitsTable.id],
  }).onDelete("set null"),
  foreignKey({
    name: "exercise_feedback_week_id_fkey",
    columns: [table.weekId],
    foreignColumns: [mesocycleWeeksTable.id],
  }).onDelete("set null"),
  index("exercise_feedback_recovery_idx").on(
    table.profileId,
    table.exerciseId,
    table.createdAt,
  ),
]);

export const plannedPrescriptionSetsTable = pgTable("planned_prescription_sets", {
  id: serial("id").primaryKey(),
  prescriptionId: integer("prescription_id").notNull(),
  exerciseId: integer("exercise_id").notNull(),
  exerciseOrder: integer("exercise_order").notNull(),
  setNumber: integer("set_number").notNull(),
  recommendedWeight: doublePrecision("recommended_weight"),
  expectedReps: integer("expected_reps"),
  prescribedRir: doublePrecision("prescribed_rir").notNull(),
  reference: jsonb("reference").$type<Record<string, unknown>>(),
}, (table) => [
  foreignKey({
    name: "planned_prescription_sets_prescription_id_fkey",
    columns: [table.prescriptionId],
    foreignColumns: [plannedPrescriptionsTable.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "planned_prescription_sets_exercise_id_fkey",
    columns: [table.exerciseId],
    foreignColumns: [exercisesTable.id],
  }).onDelete("restrict"),
  unique("planned_prescription_sets_prescription_id_exercise_order_se_key").on(
    table.prescriptionId,
    table.exerciseOrder,
    table.setNumber,
  ),
]);