-- =============================================================================
-- Add delivery_email column to users
-- =============================================================================
-- users.email is the IDENTITY email (matches auth + invitation records).
-- users.delivery_email is the OPTIONAL custom address for report delivery.
-- The pipeline uses: COALESCE(delivery_email, email) as the recipient.
-- =============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS delivery_email TEXT;

COMMENT ON COLUMN users.delivery_email IS
  'Custom report delivery address. When set, overrides users.email for all outgoing pipeline/report emails. users.email remains the canonical identity email.';
