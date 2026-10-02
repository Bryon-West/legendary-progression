-- Idempotent development seed for the hypertrophy workout tracker.
DO $seed$
DECLARE
  v_profile integer;
  v_split integer;
  v_push integer;
  v_pull integer;
  v_legs integer;
  v_bench integer;
  v_incline integer;
  v_lateral integer;
  v_pressdown integer;
  v_pulldown integer;
  v_row integer;
  v_face_pull integer;
  v_curl integer;
  v_squat integer;
  v_rdl integer;
  v_leg_press integer;
  v_leg_curl integer;
  v_calf integer;
  v_session integer;
  v_workout_exercise integer;
BEGIN
  SELECT id INTO v_profile
  FROM training_profiles
  WHERE name = 'Sample Athlete'
  ORDER BY id
  LIMIT 1;

  IF v_profile IS NULL THEN
    INSERT INTO training_profiles (name)
    VALUES ('Sample Athlete')
    RETURNING id INTO v_profile;
  END IF;

  INSERT INTO exercises (profile_id, name, muscle_group, equipment, is_compound)
  SELECT NULL, seed.name, seed.muscle_group, seed.equipment, seed.is_compound
  FROM (VALUES
    ('Barbell Bench Press', 'Chest', 'Barbell', true),
    ('Incline Dumbbell Press', 'Chest', 'Dumbbells', true),
    ('Cable Lateral Raise', 'Shoulders', 'Cable', false),
    ('Triceps Rope Pressdown', 'Triceps', 'Cable', false),
    ('Lat Pulldown', 'Back', 'Cable', true),
    ('Chest-Supported Row', 'Back', 'Dumbbells', true),
    ('Face Pull', 'Rear delts', 'Cable', false),
    ('Dumbbell Curl', 'Biceps', 'Dumbbells', false),
    ('Barbell Back Squat', 'Quads', 'Barbell', true),
    ('Romanian Deadlift', 'Hamstrings', 'Barbell', true),
    ('Leg Press', 'Quads', 'Machine', true),
    ('Seated Leg Curl', 'Hamstrings', 'Machine', false),
    ('Standing Calf Raise', 'Calves', 'Machine', false)
  ) AS seed(name, muscle_group, equipment, is_compound)
  WHERE NOT EXISTS (
    SELECT 1
    FROM exercises existing
    WHERE existing.profile_id IS NULL
      AND lower(existing.name) = lower(seed.name)
      AND existing.muscle_group = seed.muscle_group
  );

  SELECT id INTO v_bench FROM exercises WHERE profile_id IS NULL AND name = 'Barbell Bench Press' ORDER BY id LIMIT 1;
  SELECT id INTO v_incline FROM exercises WHERE profile_id IS NULL AND name = 'Incline Dumbbell Press' ORDER BY id LIMIT 1;
  SELECT id INTO v_lateral FROM exercises WHERE profile_id IS NULL AND name = 'Cable Lateral Raise' ORDER BY id LIMIT 1;
  SELECT id INTO v_pressdown FROM exercises WHERE profile_id IS NULL AND name = 'Triceps Rope Pressdown' ORDER BY id LIMIT 1;
  SELECT id INTO v_pulldown FROM exercises WHERE profile_id IS NULL AND name = 'Lat Pulldown' ORDER BY id LIMIT 1;
  SELECT id INTO v_row FROM exercises WHERE profile_id IS NULL AND name = 'Chest-Supported Row' ORDER BY id LIMIT 1;
  SELECT id INTO v_face_pull FROM exercises WHERE profile_id IS NULL AND name = 'Face Pull' ORDER BY id LIMIT 1;
  SELECT id INTO v_curl FROM exercises WHERE profile_id IS NULL AND name = 'Dumbbell Curl' ORDER BY id LIMIT 1;
  SELECT id INTO v_squat FROM exercises WHERE profile_id IS NULL AND name = 'Barbell Back Squat' ORDER BY id LIMIT 1;
  SELECT id INTO v_rdl FROM exercises WHERE profile_id IS NULL AND name = 'Romanian Deadlift' ORDER BY id LIMIT 1;
  SELECT id INTO v_leg_press FROM exercises WHERE profile_id IS NULL AND name = 'Leg Press' ORDER BY id LIMIT 1;
  SELECT id INTO v_leg_curl FROM exercises WHERE profile_id IS NULL AND name = 'Seated Leg Curl' ORDER BY id LIMIT 1;
  SELECT id INTO v_calf FROM exercises WHERE profile_id IS NULL AND name = 'Standing Calf Raise' ORDER BY id LIMIT 1;

  SELECT id INTO v_split
  FROM training_splits
  WHERE profile_id = v_profile AND name = 'Push / Pull / Legs'
  ORDER BY id
  LIMIT 1;

  IF v_split IS NULL THEN
    INSERT INTO training_splits (profile_id, name, next_day_index)
    VALUES (v_profile, 'Push / Pull / Legs', 0)
    RETURNING id INTO v_split;

    INSERT INTO split_days (split_id, name, day_index)
    VALUES
      (v_split, 'Push A', 0),
      (v_split, 'Pull A', 1),
      (v_split, 'Legs A', 2);
  END IF;

  SELECT id INTO v_push FROM split_days WHERE split_id = v_split AND day_index = 0 LIMIT 1;
  SELECT id INTO v_pull FROM split_days WHERE split_id = v_split AND day_index = 1 LIMIT 1;
  SELECT id INTO v_legs FROM split_days WHERE split_id = v_split AND day_index = 2 LIMIT 1;

  INSERT INTO split_day_exercises
    (day_id, exercise_id, order_index, target_sets, target_reps_min, target_reps_max, target_rir, target_weight)
  SELECT seed.day_id, seed.exercise_id, seed.order_index, seed.target_sets, seed.rep_min, seed.rep_max, seed.rir, seed.weight
  FROM (VALUES
    (v_push, v_bench, 0, 3, 8, 12, 2.0, 50.0),
    (v_push, v_incline, 1, 3, 8, 12, 2.0, 18.0),
    (v_push, v_lateral, 2, 3, 12, 15, 2.0, 7.0),
    (v_push, v_pressdown, 3, 3, 10, 15, 1.0, 18.0),
    (v_pull, v_pulldown, 0, 3, 8, 12, 2.0, 45.0),
    (v_pull, v_row, 1, 3, 8, 12, 2.0, 22.0),
    (v_pull, v_face_pull, 2, 3, 12, 20, 2.0, 16.0),
    (v_pull, v_curl, 3, 3, 10, 15, 1.0, 10.0),
    (v_legs, v_squat, 0, 3, 6, 10, 2.0, 60.0),
    (v_legs, v_rdl, 1, 3, 8, 12, 2.0, 50.0),
    (v_legs, v_leg_press, 2, 3, 10, 15, 2.0, 100.0),
    (v_legs, v_leg_curl, 3, 3, 10, 15, 1.0, 30.0),
    (v_legs, v_calf, 4, 4, 10, 15, 1.0, 40.0)
  ) AS seed(day_id, exercise_id, order_index, target_sets, rep_min, rep_max, rir, weight)
  WHERE seed.day_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM split_day_exercises existing
      WHERE existing.day_id = seed.day_id AND existing.exercise_id = seed.exercise_id
    );

  IF NOT EXISTS (
    SELECT 1 FROM workout_sessions
    WHERE profile_id = v_profile
      AND split_day_id = v_push
      AND status = 'completed'
  ) THEN
    INSERT INTO workout_sessions
      (profile_id, split_id, split_day_id, split_name, day_name, status, started_at, ended_at)
    VALUES
      (v_profile, v_split, v_push, 'Push / Pull / Legs', 'Push A', 'completed',
       now() - interval '3 days' - interval '1 hour', now() - interval '3 days')
    RETURNING id INTO v_session;

    INSERT INTO workout_exercises
      (session_id, exercise_id, exercise_name, muscle_group, target_rir, target_sets,
       target_reps_min, target_reps_max, target_weight, order_index)
    VALUES
      (v_session, v_bench, 'Barbell Bench Press', 'Chest', 2, 3, 8, 12, 50, 0)
    RETURNING id INTO v_workout_exercise;
    INSERT INTO workout_sets
      (workout_exercise_id, set_number, set_type, target_weight, target_reps_min, target_reps_max,
       actual_weight, actual_reps, actual_rir, completed, completed_at)
    VALUES
      (v_workout_exercise, 1, 'work', 50, 8, 12, 50, 10, 2, true, now() - interval '3 days' - interval '55 minutes'),
      (v_workout_exercise, 2, 'work', 50, 8, 12, 50, 9, 2, true, now() - interval '3 days' - interval '50 minutes'),
      (v_workout_exercise, 3, 'work', 50, 8, 12, 50, 8, 1, true, now() - interval '3 days' - interval '45 minutes');

    INSERT INTO workout_exercises
      (session_id, exercise_id, exercise_name, muscle_group, target_rir, target_sets,
       target_reps_min, target_reps_max, target_weight, order_index)
    VALUES
      (v_session, v_incline, 'Incline Dumbbell Press', 'Chest', 2, 3, 8, 12, 18, 1)
    RETURNING id INTO v_workout_exercise;
    INSERT INTO workout_sets
      (workout_exercise_id, set_number, set_type, target_weight, target_reps_min, target_reps_max,
       actual_weight, actual_reps, actual_rir, completed, completed_at)
    VALUES
      (v_workout_exercise, 1, 'work', 18, 8, 12, 18, 10, 2, true, now() - interval '3 days' - interval '38 minutes'),
      (v_workout_exercise, 2, 'work', 18, 8, 12, 18, 9, 1, true, now() - interval '3 days' - interval '33 minutes'),
      (v_workout_exercise, 3, 'work', 18, 8, 12, 18, 8, 1, true, now() - interval '3 days' - interval '28 minutes');

    INSERT INTO workout_exercises
      (session_id, exercise_id, exercise_name, muscle_group, target_rir, target_sets,
       target_reps_min, target_reps_max, target_weight, order_index)
    VALUES
      (v_session, v_lateral, 'Cable Lateral Raise', 'Shoulders', 2, 3, 12, 15, 7, 2)
    RETURNING id INTO v_workout_exercise;
    INSERT INTO workout_sets
      (workout_exercise_id, set_number, set_type, target_weight, target_reps_min, target_reps_max,
       actual_weight, actual_reps, actual_rir, completed, completed_at)
    VALUES
      (v_workout_exercise, 1, 'work', 7, 12, 15, 7, 15, 2, true, now() - interval '3 days' - interval '22 minutes'),
      (v_workout_exercise, 2, 'work', 7, 12, 15, 7, 14, 1, true, now() - interval '3 days' - interval '17 minutes'),
      (v_workout_exercise, 3, 'work', 7, 12, 15, 7, 12, 1, true, now() - interval '3 days' - interval '12 minutes');

    INSERT INTO workout_exercises
      (session_id, exercise_id, exercise_name, muscle_group, target_rir, target_sets,
       target_reps_min, target_reps_max, target_weight, order_index)
    VALUES
      (v_session, v_pressdown, 'Triceps Rope Pressdown', 'Triceps', 1, 3, 10, 15, 18, 3)
    RETURNING id INTO v_workout_exercise;
    INSERT INTO workout_sets
      (workout_exercise_id, set_number, set_type, target_weight, target_reps_min, target_reps_max,
       actual_weight, actual_reps, actual_rir, completed, completed_at)
    VALUES
      (v_workout_exercise, 1, 'work', 18, 10, 15, 18, 14, 2, true, now() - interval '3 days' - interval '8 minutes'),
      (v_workout_exercise, 2, 'work', 18, 10, 15, 18, 12, 1, true, now() - interval '3 days' - interval '4 minutes'),
      (v_workout_exercise, 3, 'work', 18, 10, 15, 18, 11, 1, true, now() - interval '3 days');

    UPDATE workout_sessions
    SET total_volume = (
      SELECT coalesce(sum(actual_weight * actual_reps), 0)::float
      FROM workout_sets sets
      INNER JOIN workout_exercises items ON items.id = sets.workout_exercise_id
      WHERE items.session_id = v_session AND sets.set_type = 'work' AND sets.completed = true
    )
    WHERE id = v_session;

    UPDATE training_splits SET next_day_index = 1 WHERE id = v_split;
  END IF;
END;
$seed$;