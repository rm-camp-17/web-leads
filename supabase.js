const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── Pending Leads ──

async function insertPendingLead({ email, phone, contactId, rawPayload }) {
  const { data, error } = await supabase
    .from('pending_leads')
    .insert({
      email,
      phone: phone || null,
      contact_id: contactId || null,
      raw_payload: rawPayload,
    })
    .select()
    .single();

  if (error) throw new Error(`insertPendingLead: ${error.message}`);
  return data;
}

async function findPendingLeadByEmail(email) {
  const { data, error } = await supabase
    .from('pending_leads')
    .select('*')
    .eq('email', email.toLowerCase())
    .eq('processed', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`findPendingLeadByEmail: ${error.message}`);
  return data;
}

// Check for duplicate short-form within 60 seconds
async function isDuplicateShortForm(email) {
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60_000).toISOString();
  const { data, error } = await supabase
    .from('pending_leads')
    .select('id')
    .eq('email', email.toLowerCase())
    .gte('created_at', sixHoursAgo)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`isDuplicateShortForm: ${error.message}`);
  return !!data;
}

async function deletePendingLead(id) {
  const { error } = await supabase
    .from('pending_leads')
    .delete()
    .eq('id', id);

  if (error) throw new Error(`deletePendingLead: ${error.message}`);
}

async function markPendingLeadProcessed(id) {
  const { error } = await supabase
    .from('pending_leads')
    .update({ processed: true })
    .eq('id', id);

  if (error) throw new Error(`markPendingLeadProcessed: ${error.message}`);
}

// ── Assignment Log ──

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
  rawPayload,
}) {
  const { data, error } = await supabase
    .from('assignment_log')
    .insert({
      contact_id: contactId,
      contact_email: contactEmail || null,
      contact_name: contactName || null,
      expert_owner_id: expertOwnerId,
      expert_name: expertName || null,
      routing_rule: routingRule,
      zip: zip || null,
      country: country || null,
      phone: phone || null,
      raw_payload: rawPayload || null,
    })
    .select()
    .single();

  if (error) throw new Error(`logAssignment: ${error.message}`);
  return data;
}

// ── Manhattan Rotation ──

async function getNextManhattanExpert() {
  // Atomically increment counter and return it
  const { data, error } = await supabase.rpc('increment_manhattan_counter');

  if (error) {
    console.error('Manhattan rotation RPC error, falling back to query:', error.message);
    // Fallback: manual increment
    const { data: row } = await supabase
      .from('manhattan_rotation')
      .select('counter')
      .eq('id', 1)
      .single();

    const currentCounter = row?.counter || 0;
    const newCounter = currentCounter + 1;

    await supabase
      .from('manhattan_rotation')
      .update({ counter: newCounter, last_updated: new Date().toISOString() })
      .eq('id', 1);

    // counter % 3: 0,1 → Wendy; 2 → Allison
    const { WENDY_ID, ALLISON_ID } = require('./routing-config');
    return newCounter % 3 < 2 ? WENDY_ID : ALLISON_ID;
  }

  const counter = data;
  const { WENDY_ID, ALLISON_ID } = require('./routing-config');
  return counter % 3 < 2 ? WENDY_ID : ALLISON_ID;
}

// ── Expired Pending Leads (for timeout handler) ──

async function getExpiredPendingLeads(minutesOld = 4) {
  const cutoff = new Date(Date.now() - minutesOld * 60_000).toISOString();
  const { data, error } = await supabase
    .from('pending_leads')
    .select('*')
    .eq('processed', false)
    .lte('created_at', cutoff);

  if (error) throw new Error(`getExpiredPendingLeads: ${error.message}`);
  return data || [];
}

module.exports = {
  supabase,
  insertPendingLead,
  findPendingLeadByEmail,
  isDuplicateShortForm,
  deletePendingLead,
  markPendingLeadProcessed,
  logAssignment,
  getNextManhattanExpert,
  getExpiredPendingLeads,
};
