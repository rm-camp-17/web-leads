-- Supabase schema for Camp Experts Lead Routing Engine
-- Run this in the Supabase SQL Editor to set up the required tables.

-- Pending leads buffer (short form → waiting for detailed form)
CREATE TABLE IF NOT EXISTS pending_leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  phone TEXT,
  contact_id TEXT,
  raw_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_pending_leads_email ON pending_leads(email);
CREATE INDEX IF NOT EXISTS idx_pending_leads_created ON pending_leads(created_at);

-- Assignment log (every routing decision is recorded)
CREATE TABLE IF NOT EXISTS assignment_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id TEXT NOT NULL,
  contact_email TEXT,
  contact_name TEXT,
  expert_owner_id TEXT NOT NULL,
  expert_name TEXT,
  routing_rule TEXT NOT NULL,
  zip TEXT,
  country TEXT,
  phone TEXT,
  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assignment_log_expert ON assignment_log(expert_owner_id);
CREATE INDEX IF NOT EXISTS idx_assignment_log_created ON assignment_log(created_at);
CREATE INDEX IF NOT EXISTS idx_assignment_log_rule ON assignment_log(routing_rule);

-- Manhattan rotation counter (singleton row)
CREATE TABLE IF NOT EXISTS manhattan_rotation (
  id INTEGER PRIMARY KEY DEFAULT 1,
  counter INTEGER DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO manhattan_rotation (id, counter)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

-- Atomic increment function for Manhattan rotation
CREATE OR REPLACE FUNCTION increment_manhattan_counter()
RETURNS INTEGER AS $$
DECLARE
  new_counter INTEGER;
BEGIN
  UPDATE manhattan_rotation
  SET counter = counter + 1, last_updated = NOW()
  WHERE id = 1
  RETURNING counter INTO new_counter;
  RETURN new_counter;
END;
$$ LANGUAGE plpgsql;
