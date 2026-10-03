BEGIN;

-- Existing profiles remain unassigned. New accounts are linked only at login time.
ALTER TABLE training_profiles
  ADD COLUMN IF NOT EXISTS owner_user_id text;
ALTER TABLE training_profiles
  ADD COLUMN IF NOT EXISTS training_experience text;
ALTER TABLE training_profiles
  ADD COLUMN IF NOT EXISTS onboarding_complete boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'training_profiles'::regclass
      AND conname = 'training_profiles_experience_check'
  ) THEN
    ALTER TABLE training_profiles
      ADD CONSTRAINT training_profiles_experience_check
      CHECK (training_experience IS NULL OR training_experience IN ('beginner', 'intermediate', 'advanced'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS training_profiles_owner_user_unique
  ON training_profiles(owner_user_id)
  WHERE owner_user_id IS NOT NULL;

COMMIT;