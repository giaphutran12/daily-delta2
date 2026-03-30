-- =============================================================================
-- Reintroduce request-scoped digest delivery tracking after rollback cleanup
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.pipeline_request_deliveries (
  delivery_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.pipeline_requests(request_id) ON DELETE CASCADE,
  recipient_email text NOT NULL,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (request_id, recipient_email)
);

CREATE INDEX IF NOT EXISTS pipeline_request_deliveries_request_idx
ON public.pipeline_request_deliveries (request_id);

ALTER TABLE public.pipeline_request_deliveries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.pipeline_request_deliveries FROM anon, authenticated;
GRANT ALL ON TABLE public.pipeline_request_deliveries TO service_role;
