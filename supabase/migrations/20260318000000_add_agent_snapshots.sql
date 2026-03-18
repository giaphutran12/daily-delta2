CREATE TABLE agent_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  signal_definition_id UUID REFERENCES signal_definitions(id) ON DELETE SET NULL,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  raw_response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_snapshots_company_date ON agent_snapshots(company_id, snapshot_date);
CREATE INDEX idx_snapshots_company_signal_date ON agent_snapshots(company_id, signal_definition_id, snapshot_date);
