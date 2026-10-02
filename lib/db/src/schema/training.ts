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
  baselineExpiryWeeks: integer("baseline_expiry_weeks").notNull().default(6),
  loadIncrementLb: doublePrecision("load_increment_lb").notNull().default(2.5),
  loadIncrementKg: doublePrecision("load_increment_kg").notNull().default(2.5),
  deloadSetFraction: doublePrecision("deload_set_fraction").notNull().default(0.5),
  deloadLoadFraction: doublePrecision("deload_load_fraction").notNull().default(0.9),
  deloadRir: doublePrecision("deload_rir").notNull().default(4),
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
    progressionType: text("progression_type"),
    secondaryMuscles: text("secondary_muscles").array().notNull().default(sql`'{}'::text[]`),
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    defaultRepMin: integer("default_rep_min").notNull().default(8),
    defaultRepMax: integer("default_rep_max").notNull().default(12),
    loadIncrementLb: doublePrecision("load_increment_lb"),
    loadIncrementKg: doublePrecision("load_increment_kg"),
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
  lifecycleStatus: text("lifecycle_status").notNull().default("planned"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  restartFromId: integer("restart_from_id"),
  recalibrateAll: boolean("recalibrate_all").notNull().default(false),
  recalibrateSince: timestamp("recalibrate_since", { withTimezone: true }),
  programAnchorWeek: integer("program_anchor_week").notNull().default(1),
  programmingVersion: text("programming_version").notNull().default("legendary-v2.1"),
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
    isArchived: boolean("is_archived").notNull().default(false),
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
    anchorWeek: integer("anchor_week").notNull().default(1),
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

export const mesocycleWeeksTable = pgTable(
  "mesocycle_weeks",
  {
    id: serial("id").primaryKey(),
    splitId: integer("split_id")
      .notNull()
      .references(() => trainingSplitsTable.id, { onDelete: "cascade" }),
    weekIndex: integer("week_index").notNull(),
    scheduleStartDate: date("schedule_start_date", { mode: "string" }),
    kind: text("kind", { enum: ["loading", "deload", "week_off"] }).notNull(),
    targetRir: doublePrecision("target_rir").notNull(),
    status: text("status", { enum: ["future", "in_progress", "completed"] })
      .notNull()
      .default("future"),
    // Frozen program structure and source IDs make copied historical weeks auditable.
    programSnapshot: jsonb("program_snapshot").$type<Record<string, unknown>>(),
    sourceSplitId: integer("source_split_id").references(
      () => trainingSplitsTable.id,
      { onDelete: "set null" },
    ),
    sourceWeekId: integer("source_week_id"),
    sourceDescription: text("source_description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("mesocycle_weeks_split_index_unique").on(table.splitId, table.weekIndex),
    index("mesocycle_weeks_split_status_idx").on(table.splitId, table.status),
  ],
);

export const plannedWorkoutsTable = pgTable(
  "planned_workouts",
  {
    id: serial("id").primaryKey(),
    splitId: integer("split_id")
      .notNull()
      .references(() => trainingSplitsTable.id, { onDelete: "cascade" }),
    weekId: integer("week_id")
      .notNull()
      .references(() => mesocycleWeeksTable.id, { onDelete: "restrict" }),
    splitDayId: integer("split_day_id")
      .notNull()
      .references(() => splitDaysTable.id, { onDelete: "restrict" }),
    scheduledDate: date("scheduled_date", { mode: "string" }).notNull(),
    originalScheduledDate: date("original_scheduled_date", { mode: "string" }).notNull(),
    status: text("status", { enum: ["scheduled", "completed", "cancelled"] })
      .notNull()
      .default("scheduled"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("planned_workouts_split_date_idx").on(table.splitId, table.scheduledDate),
    index("planned_workouts_week_idx").on(table.weekId),
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
    weekId: integer("week_id").references(() => mesocycleWeeksTable.id, {
      onDelete: "set null",
    }),
    plannedWorkoutId: integer("planned_workout_id").references(
      () => plannedWorkoutsTable.id,
      { onDelete: "set null" },
    ),
    weekKindSnapshot: text("week_kind_snapshot", {
      enum: ["loading", "deload", "week_off"],
    }),
    targetRirSnapshot: doublePrecision("target_rir_snapshot"),
    recoveryMode: text("recovery_mode", { enum: ["deload", "week_off"] }),
    structureSnapshot: jsonb("structure_snapshot").$type<Record<string, unknown>>(),
    structureDecision: text("structure_decision"),
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
    targetRepsMin: integer("target_reps_min").default(8),
    targetRepsMax: integer("target_reps_max").default(12),
    targetWeight: doublePrecision("target_weight"),
    orderIndex: integer("order_index").notNull().default(0),
    superseded: boolean("superseded").notNull().default(false),
    recoveryAdjustment: text("recovery_adjustment"),
    normalSetCount: integer("normal_set_count"),
    recoveryPriorSkipped: boolean("recovery_prior_skipped"),
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
    calibrationMode: boolean("calibration_mode").notNull().default(false),
    calibrationRir: doublePrecision("calibration_rir"),
    baselineStatus: text("baseline_status", {
      enum: ["no_baseline", "active", "expired"],
    }),
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
    referenceTargetWeight: doublePrecision("reference_target_weight"),
    referenceTargetReps: integer("reference_target_reps"),
    referenceTargetRir: doublePrecision("reference_target_rir"),
    referenceTargetRepsMin: integer("reference_target_reps_min"),
    referenceTargetRepsMax: integer("reference_target_reps_max"),
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

export const exerciseBaselinesTable = pgTable(
  "exercise_baselines",
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
    sourceSetId: integer("source_set_id"),
    establishedAt: timestamp("established_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastWeight: doublePrecision("last_weight").notNull(),
    lastReps: integer("last_reps").notNull(),
    lastRir: doublePrecision("last_rir").notNull(),
    pausedWeekOffCount: integer("paused_week_off_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("exercise_baselines_profile_exercise_unique").on(
      table.profileId,
      table.exerciseId,
    ),
    index("exercise_baselines_expiry_idx").on(table.profileId, table.expiresAt),
  ],
);

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