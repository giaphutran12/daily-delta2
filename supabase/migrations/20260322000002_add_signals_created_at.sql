-- Add created_at to signals table to track when the signal was discovered by the pipeline
ALTER TABLE signals ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
