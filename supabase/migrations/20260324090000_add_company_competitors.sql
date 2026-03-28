CREATE TABLE IF NOT EXISTS organization_company_competitors (
  organization_id UUID NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  competitor_company_id UUID NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  PRIMARY KEY (organization_id, company_id, competitor_company_id),
  CONSTRAINT company_competitor_not_self CHECK (company_id <> competitor_company_id)
);

CREATE INDEX IF NOT EXISTS idx_occ_company
  ON organization_company_competitors (organization_id, company_id);

CREATE INDEX IF NOT EXISTS idx_occ_competitor
  ON organization_company_competitors (organization_id, competitor_company_id);
