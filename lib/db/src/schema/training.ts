import {
  boolean,
  check,
  date,
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
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const profilesTable = pgTable("training_profiles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  ownerUserId: text("owner_user_id"),
  trainingMode: text("training_mode", {
    enum: ["basic", "legendary_pro"],
  }).notNull().default("legendary_pro"),
  pendingTrainingMode: text("pending_training_mode", {
    enum: ["basic", "legendary_pro"],
  }),
  trainingExperience: text("training_experience", {
    enum: ["beginner", "intermediate", "advanced"],
  }),
  onboardingComplete: boolean("onboarding_complete").notNull().default(false),
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
}, (table) => [
  uniqueIndex("training_profiles_owner_user_unique")
    .on(table.ownerUserId)
    .where(sql`${table.ownerUserId} IS NOT NULL`),
  check(
    "training_profiles_experience_check",
    sql`${table.trainingExperience} IS NULL OR ${table.trainingExperience} IN ('beginner', 'intermediate', 'advanced')`,
  ),
  check(
    "training_profiles_training_mode_check",
    sql`${table.trainingMode} IN ('basic', 'legendary_pro')`,
  ),
  check(
    "training_profiles_pending_training_mode_check",
    sql`${table.pendingTrainingMode} IS NULL OR ${table.pendingTrainingMode} IN ('basic', 'legendary_pro')`,
  ),
]);

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
}, (table) => [
  foreignKey({
    name: "training_splits_restart_from_id_fkey",
    columns: [table.restartFromId],
    foreignColumns: [table.id],
  }).onDelete("set null"),
  check(
    "training_splits_lifecycle_status_check",
    sql`${table.lifecycleStatus} IN ('planned', 'active', 'paused', 'completed', 'ended_early', 'restarted')`,
  ),
  uniqueIndex("one_active_mesocycle_per_profile")
    .on(table.profileId)
    .where(sql`${table.lifecycleStatus} = 'active'`),
  index("training_splits_visible_profile_idx")
    .on(table.profileId, table.createdAt)
    .where(sql`${table.deletedAt} IS NULL`),
]);

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
    splitId: integer("split_id").notNull(),
    weekIndex: integer("week_index").notNull(),
    scheduleStartDate: date("schedule_start_date", { mode: "string" }),
    kind: text("kind", { enum: ["loading", "deload", "week_off"] }).notNull(),
    targetRir: doublePrecision("target_rir").notNull(),
    status: text("status", { enum: ["future", "in_progress", "completed"] })
      .notNull()
      .default("future"),
    // Frozen program structure and source IDs make copied historical weeks auditable.
    programSnapshot: jsonb("program_snapshot").$type<Record<string, unknown>>(),
    sourceSplitId: integer("source_split_id"),
    sourceWeekId: integer("source_week_id"),
    sourceDescription: text("source_description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "mesocycle_weeks_split_id_fkey",
      columns: [table.splitId],
      foreignColumns: [trainingSplitsTable.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "mesocycle_weeks_source_split_id_fkey",
      columns: [table.sourceSplitId],
      foreignColumns: [trainingSplitsTable.id],
    }).onDelete("set null"),
    unique("mesocycle_weeks_split_index_unique").on(table.splitId, table.weekIndex),
    check(
      "mesocycle_weeks_kind_check",
      sql`${table.kind} IN ('loading', 'deload', 'week_off')`,
    ),
    check(
      "mesocycle_weeks_status_check",
      sql`${table.status} IN ('future', 'in_progress', 'completed')`,
    ),
    index("mesocycle_weeks_split_status_idx").on(table.splitId, table.status),
  ],
);

export const plannedWorkoutsTable = pgTable(
  "planned_workouts",
  {
    id: serial("id").primaryKey(),
    splitId: integer("split_id").notNull(),
    weekId: integer("week_id").notNull(),
    splitDayId: integer("split_day_id").notNull(),
    scheduledDate: date("scheduled_date", { mode: "string" }).notNull(),
    originalScheduledDate: date("original_scheduled_date", { mode: "string" }).notNull(),
    status: text("status", { enum: ["scheduled", "completed", "cancelled"] })
      .notNull()
      .default("scheduled"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "planned_workouts_split_id_fkey",
      columns: [table.splitId],
      foreignColumns: [trainingSplitsTable.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "planned_workouts_week_id_fkey",
      columns: [table.weekId],
      foreignColumns: [mesocycleWeeksTable.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "planned_workouts_split_day_id_fkey",
      columns: [table.splitDayId],
      foreignColumns: [splitDaysTable.id],
    }).onDelete("restrict"),
    check(
      "planned_workouts_status_check",
      sql`${table.status} IN ('scheduled', 'completed', 'cancelled')`,
    ),
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
    weekId: integer("week_id"),
    plannedWorkoutId: integer("planned_workout_id"),
    weekKindSnapshot: text("week_kind_snapshot", {
      enum: ["loading", "deload", "week_off"],
    }),
    targetRirSnapshot: doublePrecision("target_rir_snapshot"),
    recoveryMode: text("recovery_mode", { enum: ["deload", "week_off"] }),
    trainingMode: text("training_mode", {
      enum: ["basic", "legendary_pro"],
    }).notNull().default("legendary_pro"),
    structureSnapshot: jsonb("structure_snapshot").$type<Record<string, unknown>>(),
    structureDecision: text("structure_decision"),
  },
  (table) => [
    foreignKey({
      name: "workout_sessions_week_id_fkey",
      columns: [table.weekId],
      foreignColumns: [mesocycleWeeksTable.id],
    }).onDelete("set null"),
    foreignKey({
      name: "workout_sessions_planned_workout_id_fkey",
      columns: [table.plannedWorkoutId],
      foreignColumns: [plannedWorkoutsTable.id],
    }).onDelete("set null"),
    check(
      "workout_sessions_week_kind_snapshot_check",
      sql`${table.weekKindSnapshot} IN ('loading', 'deload', 'week_off')`,
    ),
    check(
      "workout_sessions_recovery_mode_check",
      sql`${table.recoveryMode} IN ('deload', 'week_off')`,
    ),
    check(
      "workout_sessions_training_mode_check",
      sql`${table.trainingMode} IN ('basic', 'legendary_pro')`,
    ),
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
    targetRir: doublePrecision("target_rir").default(2),
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
    check(
      "workout_exercises_baseline_status_check",
      sql`${table.baselineStatus} IN ('no_baseline', 'active', 'expired')`,
    ),
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
    profileId: integer("profile_id").notNull(),
    exerciseId: integer("exercise_id").notNull(),
    sourceSessionId: integer("source_session_id"),
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
    foreignKey({
      name: "exercise_baselines_profile_id_fkey",
      columns: [table.profileId],
      foreignColumns: [profilesTable.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "exercise_baselines_exercise_id_fkey",
      columns: [table.exerciseId],
      foreignColumns: [exercisesTable.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "exercise_baselines_source_session_id_fkey",
      columns: [table.sourceSessionId],
      foreignColumns: [workoutSessionsTable.id],
    }).onDelete("set null"),
    unique("exercise_baselines_profile_exercise_unique").on(
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
    sourceSessionId: integer("source_session_id"),
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
    foreignKey({
      name: "progression_recommendations_source_session_id_workout_sessions_",
      columns: [table.sourceSessionId],
      foreignColumns: [workoutSessionsTable.id],
    }).onDelete("set null"),
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
    sessionId: integer("session_id").notNull(),
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
    foreignKey({
      name: "workout_muscle_recovery_session_id_fkey",
      columns: [table.sessionId],
      foreignColumns: [workoutSessionsTable.id],
    }).onDelete("cascade"),
    index("workout_muscle_recovery_session_idx").on(table.sessionId),
  ],
);