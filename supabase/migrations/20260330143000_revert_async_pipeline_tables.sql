-- =============================================================================
-- Rollback migration: revert async pipeline schema changes
-- =============================================================================

DROP TABLE IF EXISTS public.company_agent_runs;
DROP TABLE IF EXISTS public.pipeline_request_deliveries;
