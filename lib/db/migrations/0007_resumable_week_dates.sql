BEGIN;
ALTER TABLE mesocycle_weeks ADD COLUMN IF NOT EXISTS schedule_start_date date;
COMMIT;