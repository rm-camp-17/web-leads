const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
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
        lead_source TEXT,
        lead_source_detail JSONB,
        raw_payload JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_assignment_log_expert ON assignment_log(expert_owner_id);
      CREATE INDEX IF NOT EXISTS idx_assignment_log_created ON assignment_log(created_at);
      CREATE INDEX IF NOT EXISTS idx_assignment_log_rule ON assignment_log(routing_rule);

      CREATE TABLE IF NOT EXISTS manhattan_rotation (
        id INTEGER PRIMARY KEY DEFAULT 1,
        counter INTEGER DEFAULT 0,
        last_updated TIMESTAMPTZ DEFAULT NOW()
      );

      INSERT INTO manhattan_rotation (id, counter)
      VALUES (1, 0)
      ON CONFLICT (id) DO NOTHING;

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

      CREATE TABLE IF NOT EXISTS error_log (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        source TEXT NOT NULL,
        error_message TEXT NOT NULL,
        context JSONB,
        reported BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_error_log_created ON error_log(created_at);
      CREATE INDEX IF NOT EXISTS idx_error_log_reported ON error_log(reported);
    `);

    await addColumnIfNotExists(client, 'assignment_log', 'lead_source', 'TEXT');
    await addColumnIfNotExists(client, 'assignment_log', 'lead_source_detail', 'JSONB');

    await client.query('CREATE INDEX IF NOT EXISTS idx_assignment_log_lead_source ON assignment_log(lead_source)');

    console.log('[db] Database tables initialized');
  } finally {
    client.release();
  }
}

async function addColumnIfNotExists(client, table, column, type) {
  const { rows } = await client.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = $1 AND column_name = $2
  `, [table, column]);
  if (rows.length === 0) {
    await client.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    console.log(`[db] Added column ${column} to ${table}`);
  }
}

async function insertPendingLead({ email, phone, contactId, rawPayload }) {
  const { rows } = await pool.query(
    `INSERT INTO pending_leads (email, phone, contact_id, raw_payload)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [email, phone || null, contactId || null, JSON.stringify(rawPayload)]
  );
  return rows[0];
}

async function findPendingLeadByEmail(email) {
  const { rows } = await pool.query(
    `SELECT * FROM pending_leads
     WHERE email = $1 AND processed = false
     ORDER BY created_at DESC
     LIMIT 1`,
    [email.toLowerCase()]
  );
  return rows[0] || null;
}

async function isDuplicateShortForm(email) {
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60_000).toISOString();
  const { rows } = await pool.query(
    `SELECT id FROM pending_leads
     WHERE email = $1 AND created_at >= $2
     LIMIT 1`,
    [email.toLowerCase(), sixHoursAgo]
  );
  return rows.length > 0;
}

async function isDuplicateDetailedForm(email) {
  const sixMinutesAgo = new Date(Date.now() - 6 * 60_000).toISOString();
  const { rows } = await pool.query(
    `SELECT id FROM assignment_log
     WHERE contact_email = $1 AND created_at >= $2
     LIMIT 1`,
    [email.toLowerCase(), sixMinutesAgo]
  );
  return rows.length > 0;
}

async function deletePendingLead(id) {
  await pool.query('DELETE FROM pending_leads WHERE id = $1', [id]);
}

async function markPendingLeadProcessed(id) {
  await pool.query('UPDATE pending_leads SET processed = true WHERE id = $1', [id]);
}

async function logAssignment({
  contactId,
  contactEmail,
  contactName,
  expertOwnerId,
  expertName,
  routingRule,
  zip,
  country,
  phone,
  leadSource,
  leadSourceDetail,
  rawPayload,
}) {
  const { rows } = await pool.query(
    `INSERT INTO assignment_log
     (contact_id, contact_email, contact_name, expert_owner_id, expert_name, routing_rule, zip, country, phone, lead_source, lead_source_detail, raw_payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      contactId,
      contactEmail || null,
      contactName || null,
      expertOwnerId,
      expertName || null,
      routingRule,
      zip || null,
      country || null,
      phone || null,
      leadSource || null,
      leadSourceDetail ? JSON.stringify(leadSourceDetail) : null,
      rawPayload ? JSON.stringify(rawPayload) : null,
    ]
  );
  return rows[0];
}

async function getNextManhattanExpert() {
  const { WENDY_ID, ALLISON_ID } = require('./routing-config');

  try {
    const { rows } = await pool.query('SELECT increment_manhattan_counter() AS counter');

    if (rows.length > 0) {
      const counter = rows[0].counter;
      return counter % 3 < 2 ? WENDY_ID : ALLISON_ID;
    }
  } catch (err) {
    console.error('Manhattan rotation RPC error, falling back to manual increment:', err.message);
  }

  const { rows: fallbackRows } = await pool.query(
    'SELECT counter FROM manhattan_rotation WHERE id = 1'
  );
  const currentCounter = fallbackRows[0]?.counter || 0;
  const newCounter = currentCounter + 1;
  await pool.query(
    'UPDATE manhattan_rotation SET counter = $1, last_updated = NOW() WHERE id = 1',
    [newCounter]
  );
  return newCounter % 3 < 2 ? WENDY_ID : ALLISON_ID;
}

async function getExpiredPendingLeads(minutesOld = 12) {
  const cutoff = new Date(Date.now() - minutesOld * 60_000).toISOString();
  const { rows } = await pool.query(
    `SELECT * FROM pending_leads
     WHERE processed = false AND created_at <= $1`,
    [cutoff]
  );
  return rows || [];
}

async function logError({ source, errorMessage, context }) {
  try {
    await pool.query(
      `INSERT INTO error_log (source, error_message, context)
       VALUES ($1, $2, $3)`,
      [source, errorMessage, context ? JSON.stringify(context) : null]
    );
  } catch (err) {
    console.error('[db] Failed to log error to error_log table:', err.message);
  }
}

async function getUnreportedErrors(limit = 100) {
  const { rows } = await pool.query(
    `SELECT * FROM error_log
     WHERE reported = false
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

async function markErrorsReported(ids) {
  if (!ids || ids.length === 0) return;
  await pool.query(
    `UPDATE error_log SET reported = true WHERE id = ANY($1)`,
    [ids]
  );
}

module.exports = {
  pool,
  initDatabase,
  insertPendingLead,
  findPendingLeadByEmail,
  isDuplicateShortForm,
  isDuplicateDetailedForm,
  deletePendingLead,
  markPendingLeadProcessed,
  logAssignment,
  getNextManhattanExpert,
  getExpiredPendingLeads,
  logError,
  getUnreportedErrors,
  markErrorsReported,
};
