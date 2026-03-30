-- =============================================================================
-- Track pipeline requests and per-company runs for durable Inngest orchestration
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.pipeline_requests (
  request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_event_id text NOT NULL UNIQUE,
  source text NOT NULL CHECK (source IN ('cron', 'manual', 'refresh')),
  status text NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'running', 'finalizing', 'completed', 'completed_with_errors')
  ),
  requested_company_count integer NOT NULL DEFAULT 0 CHECK (requested_company_count >= 0),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.company_pipeline_runs (
  company_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(company_id) ON DELETE CASCADE,
  requested_source text NOT NULL CHECK (requested_source IN ('cron', 'manual', 'refresh')),
  status text NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'running', 'completed', 'failed')
  ),
  rerun_requested boolean NOT NULL DEFAULT false,
  requested_event_sent boolean NOT NULL DEFAULT false,
  report_id uuid REFERENCES public.reports(report_id) ON DELETE SET NULL,
  signal_count integer NOT NULL DEFAULT 0 CHECK (signal_count >= 0),
  error text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.pipeline_request_companies (
  request_company_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.pipeline_requests(request_id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(company_id) ON DELETE CASCADE,
  company_run_id uuid REFERENCES public.company_pipeline_runs(company_run_id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'running', 'waiting_for_rerun', 'completed', 'failed')
  ),
  report_id uuid REFERENCES public.reports(report_id) ON DELETE SET NULL,
  signal_count integer NOT NULL DEFAULT 0 CHECK (signal_count >= 0),
  error text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (request_id, company_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS company_pipeline_runs_one_active_per_company_idx
ON public.company_pipeline_runs (company_id)
WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS company_pipeline_runs_company_idx
ON public.company_pipeline_runs (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pipeline_request_companies_request_idx
ON public.pipeline_request_companies (request_id);

CREATE INDEX IF NOT EXISTS pipeline_request_companies_company_run_idx
ON public.pipeline_request_companies (company_run_id);

CREATE INDEX IF NOT EXISTS pipeline_requests_source_status_idx
ON public.pipeline_requests (source, status, created_at DESC);

ALTER TABLE public.pipeline_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_pipeline_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_request_companies ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.pipeline_requests FROM anon, authenticated;
REVOKE ALL ON TABLE public.company_pipeline_runs FROM anon, authenticated;
REVOKE ALL ON TABLE public.pipeline_request_companies FROM anon, authenticated;

GRANT ALL ON TABLE public.pipeline_requests TO service_role;
GRANT ALL ON TABLE public.company_pipeline_runs TO service_role;
GRANT ALL ON TABLE public.pipeline_request_companies TO service_role;
