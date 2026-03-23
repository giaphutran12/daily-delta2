-- =============================================================================
-- Fix RLS permissions for new/modified tables
-- =============================================================================
-- The service role key bypasses RLS, but the tables need proper grants
-- for the service_role and authenticated roles.
-- =============================================================================

-- Disable RLS on organization_tracked_companies (service handles auth)
ALTER TABLE organization_tracked_companies DISABLE ROW LEVEL SECURITY;

-- Grant full access to service_role (used by admin client)
GRANT ALL ON organization_tracked_companies TO service_role;
GRANT ALL ON organization_tracked_companies TO authenticated;

-- Ensure the same for other tables that may have been affected
GRANT ALL ON companies TO service_role;
GRANT ALL ON signal_definitions TO service_role;
GRANT ALL ON reports TO service_role;
GRANT ALL ON signals TO service_role;
GRANT ALL ON agent_snapshots TO service_role;
GRANT ALL ON organizations TO service_role;
GRANT ALL ON organization_members TO service_role;
GRANT ALL ON users TO service_role;
GRANT ALL ON invitations TO service_role;
