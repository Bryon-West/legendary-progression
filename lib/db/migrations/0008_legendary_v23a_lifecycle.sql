BEGIN;
ALTER TABLE training_splits ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
-- Fail explicitly on unsupported states; never rewrite completed performance.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='training_splits'::regclass AND conname='training_splits_lifecycle_status_check') THEN
    ALTER TABLE training_splits ADD CONSTRAINT training_splits_lifecycle_status_check
      CHECK (lifecycle_status IN ('planned','active','paused','completed','ended_early','restarted'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS training_splits_visible_profile_idx
  ON training_splits(profile_id, created_at) WHERE deleted_at IS NULL;
COMMIT;