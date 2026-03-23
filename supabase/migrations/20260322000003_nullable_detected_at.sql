-- Allow detected_at to be NULL when the agent doesn't find a date for the signal
ALTER TABLE signals ALTER COLUMN detected_at DROP NOT NULL;
