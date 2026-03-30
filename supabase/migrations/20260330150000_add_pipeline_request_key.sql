-- =============================================================================
-- Add explicit request idempotency keys for manual and cron pipeline batches
-- =============================================================================

ALTER TABLE public.pipeline_requests
  ADD COLUMN IF NOT EXISTS request_key text;

CREATE UNIQUE INDEX IF NOT EXISTS pipeline_requests_request_key_idx
ON public.pipeline_requests (request_key)
WHERE request_key IS NOT NULL;
