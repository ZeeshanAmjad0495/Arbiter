-- Phase 1: artifacts carry their risk tier so the review queue can route them.
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS risk_tier text NOT NULL DEFAULT 'medium'
  CHECK (risk_tier IN ('low', 'medium', 'high'));
