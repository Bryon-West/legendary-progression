import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const profilesTable = pgTable("training_profiles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  weightUnit: text("weight_unit", { enum: ["kg", "lb"] })
    .notNull()
    .default("kg"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const exercisesTable = pgTable(
  "exercises",
  {
    id: serial("id").primaryKey(),
    profileId: integer("profile_id").references(() => profilesTable.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    muscleGroup: text("muscle_group").notNull(),
    equipment: text("equipment").notNull(),
    category: text("category", {
      enum: ["strength", "bodyweight", "conditioning", "mobility", "other"],
    })
      .notNull()
      .default("strength"),
    instructions: text("instructions"),
    isCompound: boolean("is_compound").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("exercises_profile_name_idx").on(table.profileId, table.name),
    index("exercises_muscle_group_idx").on(table.muscleGroup),
  ],
);

export const trainingSplitsTable = pgTable("training_splits", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id")
    .notNull()
    .references(() => profilesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  nextDayIndex: integer("next_day_index").notNull().default(0),
  startDate: date("start_date", { mode: "string" })
    .notNull()
    .default(sql`CURRENT_DATE`),
  cycleLengthWeeks: integer("cycle_length_weeks").notNull().default(8),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const splitDaysTable = pgTable(
  "split_days",
  {
    id: serial("id").primaryKey(),
    splitId: integer("split_id")
      .notNull()
      .references(() => trainingSplitsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    dayIndex: integer("day_index").notNull(),
  },
  (table) => [
    uniqueIndex("split_days_split_index_unique").on(
      table.splitId,
      table.dayIndex,
    ),
  ],
);

export const splitDayExercisesTable = pgTable(
  "split_day_exercises",
  {
    id: serial("id").primaryKey(),
    dayId: integer("day_id")
      .notNull()
      .references(() => splitDaysTable.id, { onDelete: "cascade" }),
    exerciseId: integer("exercise_id")
      .notNull()
      .references(() => exercisesTable.id, { onDelete: "restrict" }),
    orderIndex: integer("order_index").notNull().default(0),
    targetSets: integer("target_sets").notNull().default(3),
    minimumWorkingSets: integer("minimum_working_sets").notNull().default(1),
    maximumWorkingSets: integer("maximum_working_sets").notNull().default(5),
    targetRepsMin: integer("target_reps_min").notNull().default(8),
    targetRepsMax: integer("target_reps_max").notNull().default(12),
    targetRir: doublePrecision("target_rir").notNull().default(2),
    targetWeight: doublePrecision("target_weight"),
  },
  (table) => [
    index("split_day_exercises_day_order_idx").on(table.dayId, table.orderIndex),
  ],
);

export const workoutSessionsTable = pgTable(
  "workout_sessions",
  {
    id: serial("id").primaryKey(),
    profileId: integer("profile_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    splitId: integer("split_id").references(() => trainingSplitsTable.id, {
      onDelete: "set null",
    }),
    splitDayId: integer("split_day_id").references(() => splitDaysTable.id, {
      onDelete: "set null",
    }),
    splitName: text("split_name"),
    dayName: text("day_name"),
    status: text("status", { enum: ["active", "completed"] })
      .notNull()
      .default("active"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    totalVolume: doublePrecision("total_volume").notNull().default(0),
    readiness: text("readiness", {
      enum: ["great", "normal", "below_normal", "poor"],
    }),
    mesocycleStartDate: date("mesocycle_start_date", { mode: "string" }),
    mesocycleWeek: integer("mesocycle_week"),
  },
  (table) => [
    index("workout_sessions_profile_started_idx").on(
      table.profileId,
      table.startedAt,
    ),
    uniqueIndex("workout_sessions_one_active_per_profile")
      .on(table.profileId)
      .where(sql`${table.status} = 'active'`),
  ],
);

export const workoutExercisesTable = pgTable(
  "workout_exercises",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => workoutSessionsTable.id, { onDelete: "cascade" }),
    exerciseId: integer("exercise_id")
      .notNull()
      .references(() => exercisesTable.id, { onDelete: "restrict" }),
    exerciseName: text("exercise_name").notNull(),
    muscleGroup: text("muscle_group").notNull(),
    targetRir: doublePrecision("target_rir").notNull().default(2),
    targetSets: integer("target_sets").notNull().default(3),
    minimumWorkingSets: integer("minimum_working_sets").notNull().default(1),
    maximumWorkingSets: integer("maximum_working_sets").notNull().default(5),
    targetRepsMin: integer("target_reps_min").notNull().default(8),
    targetRepsMax: integer("target_reps_max").notNull().default(12),
    targetWeight: doublePrecision("target_weight"),
    orderIndex: integer("order_index").notNull().default(0),
    superseded: boolean("superseded").notNull().default(false),
    skipped: boolean("skipped").notNull().default(false),
    painReported: boolean("pain_reported").notNull().default(false),
    painNote: text("pain_note"),
    category: text("category", {
      enum: ["strength", "bodyweight", "conditioning", "mobility", "other"],
    })
      .notNull()
      .default("strength"),
    isCompound: boolean("is_compound").notNull().default(false),
    recommendedWeight: doublePrecision("recommended_weight"),
    recommendedReps: integer("recommended_reps"),
    recommendationOutcome: text("recommendation_outcome", {
      enum: [
        "increase_load",
        "increase_reps",
        "increase_sets",
        "decrease_sets",
        "maintain",
      ],
    }),
    recommendationRationale: text("recommendation_rationale"),
    substitutedFromExerciseId: integer("substituted_from_exercise_id").references(
      () => exercisesTable.id,
      { onDelete: "set null" },
    ),
  },
  (table) => [
    index("workout_exercises_session_order_idx").on(
      table.sessionId,
      table.orderIndex,
    ),
  ],
);

export const workoutSetsTable = pgTable(
  "workout_sets",
  {
    id: serial("id").primaryKey(),
    workoutExerciseId: integer("workout_exercise_id")
      .notNull()
      .references(() => workoutExercisesTable.id, { onDelete: "cascade" }),
    setNumber: integer("set_number").notNull(),
    setType: text("set_type", { enum: ["work", "warmup"] })
      .notNull()
      .default("work"),
    targetWeight: doublePrecision("target_weight"),
    targetRepsMin: integer("target_reps_min"),
    targetRepsMax: integer("target_reps_max"),
    actualWeight: doublePrecision("actual_weight"),
    actualReps: integer("actual_reps"),
    actualRir: doublePrecision("actual_rir"),
    adaptiveTargetWeight: doublePrecision("adaptive_target_weight"),
    adaptiveTargetReps: integer("adaptive_target_reps"),
    adaptiveTargetRir: doublePrecision("adaptive_target_rir"),
    targetStatus: text("target_status", {
      enum: ["target_met", "above_target", "below_target"],
    }),
    targetExplanation: text("target_explanation"),
    algorithmVersion: text("algorithm_version"),
    completed: boolean("completed").notNull().default(false),
    removed: boolean("removed").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    notes: text("notes"),
  },
  (table) => [
    index("workout_sets_exercise_set_idx").on(
      table.workoutExerciseId,
      table.setType,
      table.setNumber,
    ),
  ],
);

/**
 * Storage contract for a future progression engine.
 * This table is intentionally not written by the initial application.
 */
export const progressionRecommendationsTable = pgTable(
  "progression_recommendations",
  {
    id: serial("id").primaryKey(),
    profileId: integer("profile_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    exerciseId: integer("exercise_id")
      .notNull()
      .references(() => exercisesTable.id, { onDelete: "cascade" }),
    sourceSessionId: integer("source_session_id").references(
      () => workoutSessionsTable.id,
      { onDelete: "set null" },
    ),
    suggestedWeight: doublePrecision("suggested_weight"),
    suggestedRepsMin: integer("suggested_reps_min"),
    suggestedRepsMax: integer("suggested_reps_max"),
    suggestedSets: integer("suggested_sets"),
    recommendationType: text("recommendation_type", {
      enum: [
        "increase_load",
        "increase_reps",
        "increase_sets",
        "decrease_sets",
        "maintain",
      ],
    }),
    rationale: text("rationale"),
    algorithmVersion: text("algorithm_version"),
    status: text("status", {
      enum: ["pending", "accepted", "dismissed", "superseded"],
    })
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("progression_recommendations_profile_exercise_idx").on(
      table.profileId,
      table.exerciseId,
      table.createdAt,
    ),
  ],
);

export const muscleRecoveryTable = pgTable(
  "workout_muscle_recovery",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => workoutSessionsTable.id, { onDelete: "cascade" }),
    muscleGroup: text("muscle_group").notNull(),
    status: text("status", {
      enum: [
        "fully_recovered",
        "slightly_fatigued",
        "still_sore",
        "very_sore",
      ],
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("workout_muscle_recovery_session_idx").on(table.sessionId),
  ],
);