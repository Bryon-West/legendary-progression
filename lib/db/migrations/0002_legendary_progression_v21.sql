-- Legendary Progression V2.1: normalized week identity and planned occurrences.
-- Additive only: existing IDs, user fields, workout records, and prescriptions remain intact.
BEGIN;

ALTER TABLE training_profiles
  ADD COLUMN IF NOT EXISTS baseline_expiry_weeks integer NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS load_increment_lb double precision NOT NULL DEFAULT 2.5,
  ADD COLUMN IF NOT EXISTS load_increment_kg double precision NOT NULL DEFAULT 2.5,
  ADD COLUMN IF NOT EXISTS deload_set_fraction double precision NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS deload_load_fraction double precision NOT NULL DEFAULT 0.9,
  ADD COLUMN IF NOT EXISTS deload_rir double precision NOT NULL DEFAULT 4;

ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS secondary_muscles text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS default_rep_min integer NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS default_rep_max integer NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS load_increment_lb double precision,
  ADD COLUMN IF NOT EXISTS load_increment_kg double precision;

CREATE TABLE IF NOT EXISTS mesocycle_weeks (
  id serial PRIMARY KEY,
  split_id integer NOT NULL REFERENCES training_splits(id) ON DELETE CASCADE,
  week_index integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('loading', 'deload', 'week_off')),
  target_rir double precision NOT NULL,
  status text NOT NULL DEFAULT 'future' CHECK (status IN ('future', 'in_progress', 'completed')),
  program_snapshot jsonb,
  source_split_id integer REFERENCES training_splits(id) ON DELETE SET NULL,
  source_week_id integer,
  source_description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mesocycle_weeks_split_index_unique UNIQUE (split_id, week_index)
);
CREATE INDEX IF NOT EXISTS mesocycle_weeks_split_status_idx
  ON mesocycle_weeks(split_id, status);

CREATE TABLE IF NOT EXISTS planned_workouts (
  id serial PRIMARY KEY,
  split_id integer NOT NULL REFERENCES training_splits(id) ON DELETE CASCADE,
  week_id integer NOT NULL REFERENCES mesocycle_weeks(id) ON DELETE RESTRICT,
  split_day_id integer NOT NULL REFERENCES split_days(id) ON DELETE RESTRICT,
  scheduled_date date NOT NULL,
  original_scheduled_date date NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS planned_workouts_split_date_idx
  ON planned_workouts(split_id, scheduled_date);
CREATE INDEX IF NOT EXISTS planned_workouts_week_idx ON planned_workouts(week_id);

CREATE TABLE IF NOT EXISTS exercise_baselines (
  id serial PRIMARY KEY,
  profile_id integer NOT NULL REFERENCES training_profiles(id) ON DELETE CASCADE,
  exercise_id integer NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  source_session_id integer REFERENCES workout_sessions(id) ON DELETE SET NULL,
  source_set_id integer,
  established_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  last_weight double precision NOT NULL,
  last_reps integer NOT NULL,
  last_rir double precision NOT NULL,
  paused_week_off_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exercise_baselines_profile_exercise_unique UNIQUE (profile_id, exercise_id)
);
CREATE INDEX IF NOT EXISTS exercise_baselines_expiry_idx
  ON exercise_baselines(profile_id, expires_at);

ALTER TABLE workout_sessions
  ADD COLUMN IF NOT EXISTS week_id integer REFERENCES mesocycle_weeks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS planned_workout_id integer REFERENCES planned_workouts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS week_kind_snapshot text CHECK (week_kind_snapshot IN ('loading', 'deload', 'week_off')),
  ADD COLUMN IF NOT EXISTS target_rir_snapshot double precision,
  ADD COLUMN IF NOT EXISTS recovery_mode text CHECK (recovery_mode IN ('deload', 'week_off'));

-- Calibration sessions must represent the absence of any target rather than fake values.
ALTER TABLE workout_exercises
  ALTER COLUMN target_reps_min DROP NOT NULL,
  ALTER COLUMN target_reps_max DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS calibration_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS calibration_rir double precision,
  ADD COLUMN IF NOT EXISTS baseline_status text CHECK (baseline_status IN ('no_baseline', 'active', 'expired'));

-- Preserve every legacy cycle length. Seed prescriptions as snapshots of legacy RIR;
-- never rewrite old targets or results.
INSERT INTO mesocycle_weeks (split_id, week_index, kind, target_rir, status)
SELECT s.id, w.week_index, 'loading',
       COALESCE((
         SELECT AVG(e.target_rir)
         FROM split_days d
         JOIN split_day_exercises e ON e.day_id = d.id
         WHERE d.split_id = s.id
       ), 2),
       CASE
         WHEN w.week_index < COALESCE((
           SELECT MAX(ws.mesocycle_week)
           FROM workout_sessions ws
           WHERE ws.split_id = s.id AND ws.status = 'completed'
         ), 0) THEN 'completed'
         WHEN w.week_index = COALESCE((
           SELECT MAX(ws.mesocycle_week)
           FROM workout_sessions ws
           WHERE ws.split_id = s.id AND ws.status = 'completed'
         ), 0) THEN 'in_progress'
         ELSE 'future'
       END
FROM training_splits s
CROSS JOIN LATERAL generate_series(1, GREATEST(1, s.cycle_length_weeks)) AS w(week_index)
ON CONFLICT (split_id, week_index) DO NOTHING;

-- Legacy plans gain occurrences without changing their reusable split-day structure.
-- Dates remain calendar DATE values and are not converted through timestamps.
INSERT INTO planned_workouts
  (split_id, week_id, split_day_id, scheduled_date, original_scheduled_date)
SELECT s.id, mw.id, d.id,
       s.start_date + ((mw.week_index - 1) * 7) + d.day_index,
       s.start_date + ((mw.week_index - 1) * 7) + d.day_index
FROM training_splits s
JOIN mesocycle_weeks mw ON mw.split_id = s.id
JOIN split_days d ON d.split_id = s.id
WHERE NOT EXISTS (
  SELECT 1 FROM planned_workouts existing
  WHERE existing.week_id = mw.id AND existing.split_day_id = d.id
)
ON CONFLICT DO NOTHING;

UPDATE workout_sessions ws
SET week_id = mw.id,
    week_kind_snapshot = COALESCE(ws.week_kind_snapshot, 'loading'),
    target_rir_snapshot = COALESCE(ws.target_rir_snapshot, mw.target_rir)
FROM mesocycle_weeks mw
WHERE ws.split_id = mw.split_id
  AND ws.mesocycle_week = mw.week_index
  AND ws.week_id IS NULL;

UPDATE workout_sessions ws
SET planned_workout_id = (
  SELECT pw.id
  FROM planned_workouts pw
  WHERE pw.split_id = ws.split_id
    AND pw.week_id = ws.week_id
    AND pw.split_day_id = ws.split_day_id
  ORDER BY ABS(pw.scheduled_date - ws.started_at::date), pw.id
  LIMIT 1
)
WHERE ws.planned_workout_id IS NULL
  AND ws.week_id IS NOT NULL
  AND ws.split_day_id IS NOT NULL;

UPDATE planned_workouts pw
SET status = 'completed'
WHERE EXISTS (
  SELECT 1 FROM workout_sessions ws
  WHERE ws.planned_workout_id = pw.id AND ws.status = 'completed'
);

COMMIT;