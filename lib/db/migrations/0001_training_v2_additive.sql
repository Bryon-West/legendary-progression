-- Additive hypertrophy tracker V2 migration. Existing rows and identifiers are preserved.
BEGIN;
ALTER TABLE training_profiles
  ADD COLUMN IF NOT EXISTS weight_unit text NOT NULL DEFAULT 'kg';

ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'strength',
  ADD COLUMN IF NOT EXISTS is_compound boolean NOT NULL DEFAULT false;

ALTER TABLE training_splits
  ADD COLUMN IF NOT EXISTS start_date date NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS cycle_length_weeks integer NOT NULL DEFAULT 8;

ALTER TABLE split_day_exercises
  ADD COLUMN IF NOT EXISTS minimum_working_sets integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS maximum_working_sets integer NOT NULL DEFAULT 5;

ALTER TABLE workout_sessions
  ADD COLUMN IF NOT EXISTS readiness text,
  ADD COLUMN IF NOT EXISTS mesocycle_start_date date,
  ADD COLUMN IF NOT EXISTS mesocycle_week integer;

ALTER TABLE workout_exercises
  ADD COLUMN IF NOT EXISTS minimum_working_sets integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS maximum_working_sets integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS superseded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS skipped boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pain_reported boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pain_note text,
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'strength',
  ADD COLUMN IF NOT EXISTS is_compound boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recommended_weight double precision,
  ADD COLUMN IF NOT EXISTS recommended_reps integer,
  ADD COLUMN IF NOT EXISTS recommendation_outcome text,
  ADD COLUMN IF NOT EXISTS recommendation_rationale text,
  ADD COLUMN IF NOT EXISTS substituted_from_exercise_id integer REFERENCES exercises(id) ON DELETE SET NULL;

ALTER TABLE workout_sets
  ADD COLUMN IF NOT EXISTS adaptive_target_weight double precision,
  ADD COLUMN IF NOT EXISTS adaptive_target_reps integer,
  ADD COLUMN IF NOT EXISTS adaptive_target_rir double precision,
  ADD COLUMN IF NOT EXISTS target_status text,
  ADD COLUMN IF NOT EXISTS target_explanation text,
  ADD COLUMN IF NOT EXISTS algorithm_version text,
  ADD COLUMN IF NOT EXISTS removed boolean NOT NULL DEFAULT false;

ALTER TABLE progression_recommendations
  ADD COLUMN IF NOT EXISTS suggested_sets integer,
  ADD COLUMN IF NOT EXISTS recommendation_type text;

CREATE TABLE IF NOT EXISTS workout_muscle_recovery (
  id serial PRIMARY KEY,
  session_id integer NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  muscle_group text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workout_muscle_recovery_session_idx
  ON workout_muscle_recovery(session_id);

-- New bounds must accommodate every existing prescription, including larger plans.
UPDATE split_day_exercises
  SET maximum_working_sets = GREATEST(maximum_working_sets, target_sets);
UPDATE workout_exercises
  SET maximum_working_sets = GREATEST(maximum_working_sets, target_sets);

COMMIT;