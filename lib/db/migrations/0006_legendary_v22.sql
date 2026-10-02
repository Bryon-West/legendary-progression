BEGIN;
ALTER TABLE training_splits ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'planned';
ALTER TABLE training_splits ADD COLUMN IF NOT EXISTS paused_at timestamptz;
ALTER TABLE training_splits ADD COLUMN IF NOT EXISTS ended_at timestamptz;
ALTER TABLE training_splits ADD COLUMN IF NOT EXISTS restart_from_id integer REFERENCES training_splits(id) ON DELETE SET NULL;
ALTER TABLE training_splits ADD COLUMN IF NOT EXISTS recalibrate_all boolean NOT NULL DEFAULT false;
ALTER TABLE training_splits ADD COLUMN IF NOT EXISTS recalibrate_since timestamptz;
ALTER TABLE training_splits ADD COLUMN IF NOT EXISTS program_anchor_week integer NOT NULL DEFAULT 1;
ALTER TABLE training_splits ADD COLUMN IF NOT EXISTS programming_version text NOT NULL DEFAULT 'legendary-v2.1';
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS progression_type text;
ALTER TABLE split_day_exercises ADD COLUMN IF NOT EXISTS anchor_week integer NOT NULL DEFAULT 1;
UPDATE exercises SET progression_type = CASE WHEN is_compound THEN 'load_first' ELSE 'rep_first' END WHERE progression_type IS NULL;
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS structure_snapshot jsonb;
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS structure_decision text;
ALTER TABLE workout_exercises ADD COLUMN IF NOT EXISTS recovery_adjustment text;
ALTER TABLE workout_exercises ADD COLUMN IF NOT EXISTS normal_set_count integer;
ALTER TABLE workout_exercises ADD COLUMN IF NOT EXISTS recovery_prior_skipped boolean;
CREATE TABLE IF NOT EXISTS planned_prescriptions (
  id serial PRIMARY KEY,
  planned_workout_id integer NOT NULL UNIQUE REFERENCES planned_workouts(id) ON DELETE CASCADE,
  source_session_id integer REFERENCES workout_sessions(id) ON DELETE SET NULL,
  payload jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS exercise_feedback (
  id serial PRIMARY KEY,
  workout_exercise_id integer NOT NULL UNIQUE REFERENCES workout_exercises(id) ON DELETE CASCADE,
  profile_id integer NOT NULL REFERENCES training_profiles(id) ON DELETE CASCADE,
  session_id integer NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise_id integer NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
  primary_muscle text NOT NULL,
  split_id integer REFERENCES training_splits(id) ON DELETE SET NULL,
  week_id integer REFERENCES mesocycle_weeks(id) ON DELETE SET NULL,
  pump text NOT NULL,
  fatigue text NOT NULL,
  discomfort text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS planned_prescription_sets (
  id serial PRIMARY KEY,
  prescription_id integer NOT NULL REFERENCES planned_prescriptions(id) ON DELETE CASCADE,
  exercise_id integer NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
  exercise_order integer NOT NULL,
  set_number integer NOT NULL,
  recommended_weight double precision,
  expected_reps integer,
  prescribed_rir double precision NOT NULL,
  reference jsonb,
  UNIQUE(prescription_id,exercise_order,set_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_mesocycle_per_profile ON training_splits(profile_id) WHERE lifecycle_status='active';
CREATE INDEX IF NOT EXISTS exercise_feedback_recovery_idx ON exercise_feedback(profile_id,exercise_id,created_at);
-- Only new lifecycle fields are initialized. Existing performance and program fields remain untouched.
UPDATE training_splits s SET lifecycle_status='active' WHERE EXISTS (
  SELECT 1 FROM workout_sessions w WHERE w.split_id=s.id AND w.status='active'
);
COMMIT;