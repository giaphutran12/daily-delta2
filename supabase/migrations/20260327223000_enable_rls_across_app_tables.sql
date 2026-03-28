-- =============================================================================
-- Enable RLS across app tables and replace broad authenticated grants
-- =============================================================================

-- Shared helper predicates for multi-tenant access checks.
CREATE OR REPLACE FUNCTION public.is_org_member(target_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.organization_id = target_org_id
      AND om.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin(target_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.organization_id = target_org_id
      AND om.user_id = auth.uid()
      AND om.role IN ('owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_company(target_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_tracked_companies otc
    JOIN public.organization_members om
      ON om.organization_id = otc.organization_id
    WHERE otc.company_id = target_company_id
      AND om.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_chat_session(target_session_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.chat_sessions cs
    WHERE cs.session_id = target_session_id
      AND cs.user_id = auth.uid()
      AND public.can_access_company(cs.company_id)
  );
$$;

-- Enable RLS everywhere the app stores tenant data.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_tracked_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signal_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_company_competitors ENABLE ROW LEVEL SECURITY;

-- Remove broad authenticated / anonymous grants introduced by prior migrations.
REVOKE ALL ON TABLE public.users FROM anon, authenticated;
REVOKE ALL ON TABLE public.organizations FROM anon, authenticated;
REVOKE ALL ON TABLE public.organization_members FROM anon, authenticated;
REVOKE ALL ON TABLE public.organization_tracked_companies FROM anon, authenticated;
REVOKE ALL ON TABLE public.companies FROM anon, authenticated;
REVOKE ALL ON TABLE public.signals FROM anon, authenticated;
REVOKE ALL ON TABLE public.reports FROM anon, authenticated;
REVOKE ALL ON TABLE public.signal_definitions FROM anon, authenticated;
REVOKE ALL ON TABLE public.agent_snapshots FROM anon, authenticated;
REVOKE ALL ON TABLE public.invitations FROM anon, authenticated;
REVOKE ALL ON TABLE public.chat_sessions FROM anon, authenticated;
REVOKE ALL ON TABLE public.chat_messages FROM anon, authenticated;
REVOKE ALL ON TABLE public.organization_company_competitors FROM anon, authenticated;

-- Keep service role fully privileged for existing server-side admin clients.
GRANT ALL ON TABLE public.users TO service_role;
GRANT ALL ON TABLE public.organizations TO service_role;
GRANT ALL ON TABLE public.organization_members TO service_role;
GRANT ALL ON TABLE public.organization_tracked_companies TO service_role;
GRANT ALL ON TABLE public.companies TO service_role;
GRANT ALL ON TABLE public.signals TO service_role;
GRANT ALL ON TABLE public.reports TO service_role;
GRANT ALL ON TABLE public.signal_definitions TO service_role;
GRANT ALL ON TABLE public.agent_snapshots TO service_role;
GRANT ALL ON TABLE public.invitations TO service_role;
GRANT ALL ON TABLE public.chat_sessions TO service_role;
GRANT ALL ON TABLE public.chat_messages TO service_role;
GRANT ALL ON TABLE public.organization_company_competitors TO service_role;

-- Minimal authenticated grants. Most writes still flow through service-role APIs.
GRANT SELECT ON TABLE public.users TO authenticated;
GRANT UPDATE (email) ON TABLE public.users TO authenticated;
GRANT SELECT ON TABLE public.organizations TO authenticated;
GRANT SELECT ON TABLE public.organization_members TO authenticated;
GRANT SELECT ON TABLE public.organization_tracked_companies TO authenticated;
GRANT SELECT ON TABLE public.companies TO authenticated;
GRANT SELECT ON TABLE public.signals TO authenticated;
GRANT SELECT ON TABLE public.reports TO authenticated;
GRANT SELECT ON TABLE public.signal_definitions TO authenticated;
GRANT SELECT ON TABLE public.agent_snapshots TO authenticated;
GRANT SELECT ON TABLE public.invitations TO authenticated;
GRANT SELECT ON TABLE public.chat_sessions TO authenticated;
GRANT SELECT ON TABLE public.chat_messages TO authenticated;
GRANT SELECT ON TABLE public.organization_company_competitors TO authenticated;

-- Recreate policies idempotently.
DROP POLICY IF EXISTS users_select_self ON public.users;
CREATE POLICY users_select_self
ON public.users
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS users_update_self ON public.users;
CREATE POLICY users_update_self
ON public.users
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS organizations_select_member_orgs ON public.organizations;
CREATE POLICY organizations_select_member_orgs
ON public.organizations
FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS organization_members_select_member_orgs ON public.organization_members;
CREATE POLICY organization_members_select_member_orgs
ON public.organization_members
FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS tracked_companies_select_member_orgs ON public.organization_tracked_companies;
CREATE POLICY tracked_companies_select_member_orgs
ON public.organization_tracked_companies
FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS companies_select_accessible ON public.companies;
CREATE POLICY companies_select_accessible
ON public.companies
FOR SELECT
TO authenticated
USING (public.can_access_company(company_id));

DROP POLICY IF EXISTS signals_select_accessible ON public.signals;
CREATE POLICY signals_select_accessible
ON public.signals
FOR SELECT
TO authenticated
USING (public.can_access_company(company_id));

DROP POLICY IF EXISTS reports_select_accessible ON public.reports;
CREATE POLICY reports_select_accessible
ON public.reports
FOR SELECT
TO authenticated
USING (public.can_access_company(company_id));

DROP POLICY IF EXISTS snapshots_select_accessible ON public.agent_snapshots;
CREATE POLICY snapshots_select_accessible
ON public.agent_snapshots
FOR SELECT
TO authenticated
USING (public.can_access_company(company_id));

DROP POLICY IF EXISTS signal_definitions_select_accessible ON public.signal_definitions;
CREATE POLICY signal_definitions_select_accessible
ON public.signal_definitions
FOR SELECT
TO authenticated
USING (company_id IS NULL OR public.can_access_company(company_id));

DROP POLICY IF EXISTS invitations_select_admin_orgs ON public.invitations;
CREATE POLICY invitations_select_admin_orgs
ON public.invitations
FOR SELECT
TO authenticated
USING (
  status = 'pending'
  AND public.is_org_admin(organization_id)
);

DROP POLICY IF EXISTS competitors_select_member_orgs ON public.organization_company_competitors;
CREATE POLICY competitors_select_member_orgs
ON public.organization_company_competitors
FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS chat_sessions_select_own ON public.chat_sessions;
CREATE POLICY chat_sessions_select_own
ON public.chat_sessions
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  AND public.can_access_company(company_id)
);

DROP POLICY IF EXISTS chat_messages_select_own_session ON public.chat_messages;
CREATE POLICY chat_messages_select_own_session
ON public.chat_messages
FOR SELECT
TO authenticated
USING (public.can_access_chat_session(session_id));
