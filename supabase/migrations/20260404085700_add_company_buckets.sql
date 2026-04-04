CREATE TABLE IF NOT EXISTS public.company_buckets (
  bucket_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_company_buckets_org_name_unique
ON public.company_buckets (organization_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_company_buckets_org_sort
ON public.company_buckets (organization_id, sort_order, created_at);

ALTER TABLE public.organization_tracked_companies
ADD COLUMN IF NOT EXISTS bucket_id UUID REFERENCES public.company_buckets(bucket_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_otc_bucket_id
ON public.organization_tracked_companies (bucket_id);

ALTER TABLE public.company_buckets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.company_buckets FROM anon, authenticated;
GRANT ALL ON TABLE public.company_buckets TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.company_buckets TO authenticated;

DROP POLICY IF EXISTS company_buckets_select_member_orgs ON public.company_buckets;
CREATE POLICY company_buckets_select_member_orgs
ON public.company_buckets
FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS company_buckets_insert_member_orgs ON public.company_buckets;
CREATE POLICY company_buckets_insert_member_orgs
ON public.company_buckets
FOR INSERT
TO authenticated
WITH CHECK (public.is_org_member(organization_id));

DROP POLICY IF EXISTS company_buckets_update_member_orgs ON public.company_buckets;
CREATE POLICY company_buckets_update_member_orgs
ON public.company_buckets
FOR UPDATE
TO authenticated
USING (public.is_org_member(organization_id))
WITH CHECK (public.is_org_member(organization_id));

DROP POLICY IF EXISTS company_buckets_delete_member_orgs ON public.company_buckets;
CREATE POLICY company_buckets_delete_member_orgs
ON public.company_buckets
FOR DELETE
TO authenticated
USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS tracked_companies_update_member_orgs ON public.organization_tracked_companies;
CREATE POLICY tracked_companies_update_member_orgs
ON public.organization_tracked_companies
FOR UPDATE
TO authenticated
USING (public.is_org_member(organization_id))
WITH CHECK (public.is_org_member(organization_id));
