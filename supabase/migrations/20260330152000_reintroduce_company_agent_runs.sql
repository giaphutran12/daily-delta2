-- =============================================================================
-- Reintroduce async TinyFish agent run tracking after rollback cleanup
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.company_agent_runs (
  agent_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_run_id uuid NOT NULL REFERENCES public.company_pipeline_runs(company_run_id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(company_id) ON DELETE CASCADE,
  agent_name text NOT NULL,
  definition_id uuid REFERENCES public.signal_definitions(id) ON DELETE SET NULL,
  tinyfish_run_id text,
  status text NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'running', 'completed', 'failed', 'canceled')
  ),
  findings jsonb,
  error jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (company_run_id, agent_name)
);

CREATE INDEX IF NOT EXISTS company_agent_runs_company_run_idx
ON public.company_agent_runs (company_run_id);

CREATE INDEX IF NOT EXISTS company_agent_runs_company_status_idx
ON public.company_agent_runs (company_id, status, created_at DESC);

ALTER TABLE public.company_agent_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.company_agent_runs FROM anon, authenticated;
GRANT ALL ON TABLE public.company_agent_runs TO service_role;
