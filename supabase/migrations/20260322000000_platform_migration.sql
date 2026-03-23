-- =============================================================================
-- Platform Migration: Companies & Signals become platform-owned entities
-- =============================================================================
-- This migration shifts from org-owned companies/signals to platform-owned.
-- Companies are shared resources; orgs "track" them via a junction table.
-- Signal definitions lose org ownership; defaults are locked platform-level.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Create junction table: organization_tracked_companies
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_tracked_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  tracked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tracked_by UUID,
  UNIQUE(organization_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_otc_org ON organization_tracked_companies(organization_id);
CREATE INDEX IF NOT EXISTS idx_otc_company ON organization_tracked_companies(company_id);

-- ---------------------------------------------------------------------------
-- 2. Companies: add platform columns, migrate data, drop org ownership
-- ---------------------------------------------------------------------------

-- Add new columns
ALTER TABLE companies ADD COLUMN IF NOT EXISTS added_by UUID;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS platform_status TEXT NOT NULL DEFAULT 'active';

-- Populate added_by from existing user_id
UPDATE companies SET added_by = user_id WHERE added_by IS NULL AND user_id IS NOT NULL;

-- Migrate existing org→company relationships to tracking junction table
INSERT INTO organization_tracked_companies (organization_id, company_id, tracked_by)
SELECT organization_id, company_id, user_id
FROM companies
WHERE organization_id IS NOT NULL
ON CONFLICT (organization_id, company_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. De-duplicate companies by domain
--    For each domain with multiple records, keep the one with the most
--    metadata filled in. Re-point FKs and create tracking entries for all
--    orgs that had duplicates.
-- ---------------------------------------------------------------------------

-- Step 3a: Identify canonical company per domain (most metadata wins)
CREATE TEMP TABLE canonical_companies AS
SELECT DISTINCT ON (domain)
  company_id AS canonical_id,
  domain
FROM companies
WHERE tracking_status = 'active'
ORDER BY domain,
  -- Prefer records with more metadata filled in
  (CASE WHEN description IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN industry IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN founding_year IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN headquarters IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN company_size IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN detected_products IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN careers_url IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN blog_url IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN pricing_url IS NOT NULL THEN 1 ELSE 0 END) DESC,
  created_at ASC;  -- tie-break: oldest record

-- Step 3b: Build mapping of duplicate → canonical
CREATE TEMP TABLE company_merge_map AS
SELECT c.company_id AS old_id, cc.canonical_id AS new_id
FROM companies c
JOIN canonical_companies cc ON c.domain = cc.domain
WHERE c.company_id != cc.canonical_id;

-- Step 3c: Ensure tracking entries exist for orgs that tracked duplicates
INSERT INTO organization_tracked_companies (organization_id, company_id, tracked_by)
SELECT otc.organization_id, cmm.new_id, otc.tracked_by
FROM organization_tracked_companies otc
JOIN company_merge_map cmm ON otc.company_id = cmm.old_id
ON CONFLICT (organization_id, company_id) DO NOTHING;

-- Step 3d: Re-point signals from duplicate to canonical
UPDATE signals SET company_id = cmm.new_id
FROM company_merge_map cmm
WHERE signals.company_id = cmm.old_id;

-- Step 3e: Re-point reports from duplicate to canonical
UPDATE reports SET company_id = cmm.new_id
FROM company_merge_map cmm
WHERE reports.company_id = cmm.old_id;

-- Step 3f: Re-point agent_snapshots from duplicate to canonical
UPDATE agent_snapshots SET company_id = cmm.new_id
FROM company_merge_map cmm
WHERE agent_snapshots.company_id = cmm.old_id;

-- Step 3g: Re-point signal_definitions (company-scoped) from duplicate to canonical
UPDATE signal_definitions SET company_id = cmm.new_id
FROM company_merge_map cmm
WHERE signal_definitions.company_id = cmm.old_id;

-- Step 3h: Delete tracking entries for duplicate companies
DELETE FROM organization_tracked_companies
WHERE company_id IN (SELECT old_id FROM company_merge_map);

-- Step 3i: Delete duplicate companies
DELETE FROM companies
WHERE company_id IN (SELECT old_id FROM company_merge_map);

-- Cleanup temp tables
DROP TABLE IF EXISTS canonical_companies;
DROP TABLE IF EXISTS company_merge_map;

-- Step 3j: Add unique constraint on domain (prevent future duplicates)
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_domain_unique ON companies(domain);

-- ---------------------------------------------------------------------------
-- 4. Drop org/user ownership columns from companies
-- ---------------------------------------------------------------------------
ALTER TABLE companies DROP COLUMN IF EXISTS organization_id;
ALTER TABLE companies DROP COLUMN IF EXISTS user_id;

-- ---------------------------------------------------------------------------
-- 5. Signal definitions: add platform columns, drop org ownership
-- ---------------------------------------------------------------------------

-- Add new columns
ALTER TABLE signal_definitions ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE signal_definitions ADD COLUMN IF NOT EXISTS created_by UUID;

-- Mark existing global defaults as platform defaults
UPDATE signal_definitions
SET is_default = true
WHERE scope = 'global' AND company_id IS NULL;

-- De-duplicate default signal definitions (keep one per signal_type)
-- After removing org_id, we'll have N copies of each default (one per org).
-- Keep the oldest, delete the rest.
DELETE FROM signal_definitions
WHERE id NOT IN (
  SELECT DISTINCT ON (signal_type) id
  FROM signal_definitions
  WHERE is_default = true
  ORDER BY signal_type, created_at ASC
)
AND is_default = true;

-- Drop org ownership
ALTER TABLE signal_definitions DROP COLUMN IF EXISTS organization_id;

-- ---------------------------------------------------------------------------
-- 6. Reports: drop org ownership columns
-- ---------------------------------------------------------------------------
ALTER TABLE reports DROP COLUMN IF EXISTS organization_id;

-- ---------------------------------------------------------------------------
-- 7. Organizations: rename company_limit to tracking_limit
-- ---------------------------------------------------------------------------
ALTER TABLE organizations RENAME COLUMN company_limit TO tracking_limit;
