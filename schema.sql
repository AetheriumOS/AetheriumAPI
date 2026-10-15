-- Aetherium secure-code exchange schema.
-- Apply with: wrangler d1 execute aetherium --file=./schema.sql
CREATE TABLE IF NOT EXISTS codes (
  pair_key TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  retrieved INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_codes_created_at ON codes (created_at);
