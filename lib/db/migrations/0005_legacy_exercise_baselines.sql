-- Initialize the new baseline table from existing valid personal working sets.
-- Do not invent missing effort, include warmups/recovery, or overwrite baselines.
INSERT INTO exercise_baselines
  (profile_id, exercise_id, source_session_id, source_set_id,
   established_at, expires_at, last_weight, last_reps, last_rir)
SELECT DISTINCT ON (w.profile_id, e.exercise_id)
  w.profile_id, e.exercise_id, w.id, s.id,
  COALESCE(s.completed_at, w.ended_at, w.started_at),
  COALESCE(s.completed_at, w.ended_at, w.started_at)
    + p.baseline_expiry_weeks * interval '7 days',
  s.actual_weight, s.actual_reps, s.actual_rir
FROM workout_sessions w
JOIN training_profiles p ON p.id = w.profile_id
JOIN workout_exercises e ON e.session_id = w.id
JOIN workout_sets s ON s.workout_exercise_id = e.id
WHERE w.status = 'completed'
  AND (w.week_kind_snapshot IS NULL OR w.week_kind_snapshot = 'loading')
  AND w.recovery_mode IS NULL
  AND e.skipped = false
  AND s.set_type = 'work'
  AND s.completed = true
  AND s.removed = false
  AND s.actual_weight IS NOT NULL AND s.actual_weight >= 0
  AND s.actual_reps > 0
  AND s.actual_rir BETWEEN 0 AND 10
ORDER BY w.profile_id, e.exercise_id,
  COALESCE(s.completed_at, w.ended_at, w.started_at) DESC, s.id DESC
ON CONFLICT (profile_id, exercise_id) DO NOTHING;