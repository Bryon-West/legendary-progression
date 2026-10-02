ALTER TABLE split_days
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;