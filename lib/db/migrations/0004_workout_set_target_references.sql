ALTER TABLE workout_sets
  ADD COLUMN IF NOT EXISTS reference_target_weight double precision,
  ADD COLUMN IF NOT EXISTS reference_target_reps integer,
  ADD COLUMN IF NOT EXISTS reference_target_rir double precision,
  ADD COLUMN IF NOT EXISTS reference_target_reps_min integer,
  ADD COLUMN IF NOT EXISTS reference_target_reps_max integer;

UPDATE workout_sets AS set_row
SET reference_target_weight = CASE
      WHEN exercise.calibration_mode THEN NULL
      ELSE set_row.target_weight
    END,
    reference_target_reps = CASE
      WHEN exercise.calibration_mode THEN NULL
      ELSE COALESCE(exercise.recommended_reps, set_row.target_reps_min)
    END,
    reference_target_rir = COALESCE(set_row.adaptive_target_rir, exercise.target_rir),
    reference_target_reps_min = CASE
      WHEN exercise.calibration_mode THEN NULL
      ELSE set_row.target_reps_min
    END,
    reference_target_reps_max = CASE
      WHEN exercise.calibration_mode THEN NULL
      ELSE set_row.target_reps_max
    END
FROM workout_exercises AS exercise
WHERE exercise.id = set_row.workout_exercise_id
  AND set_row.reference_target_rir IS NULL;