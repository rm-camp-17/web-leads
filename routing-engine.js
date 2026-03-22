const hubspot = require('./hubspot');
const supabase = require('./db');
const config = require('./routing-config');
const Anthropic = require('@anthropic-ai/sdk');

let anthropic;
try {
  if (process.env.ANTHROPIC_API_KEY) {
    anthropic = new Anthropic();
  }
} catch {};

// Main entry point: takes a normalized lead, returns { expertId, rule }
async function routeLead(lead) {
  try {
    // Step 1: Existing family match
    const existingResult = await checkExistingFamily(lead.email, lead.phone);
    if (existingResult) return existingResult;

    // Step 2: Requested expert (from profile page URL)
    const requestedResult = checkRequestedExpert(lead.source_url);
    if (requestedResult) return requestedResult;

    // Step 3: International routing
    const internationalResult = checkInternational(lead.country, lead.phone);
    if (internationalResult) return internationalResult;

    // Step 4: Domestic US routing by zip, then phone area code
    const domesticResult = await checkDomestic(lead.zip, lead.phone);
    if (domesticResult) return domesticResult;

    // Step 5: AI-powered routing (when geographic rules don't match)
    const aiResult = await tryAiRouting(lead);
    if (aiResult) return aiResult;

    // Step 6: Fallback
    return { expertId: config.CAMP_EXPERTS_OFFICE_ID, rule: 'fallback_no_match' };
  } catch (err) {
    console.error('Routing engine error, falling back to office:', err.message);
    return { expertId: config.CAMP_EXPERTS_OFFICE_ID, rule: 'fallback_error' };
  }
}

// Step 1: Check if the contact or household already has an assigned expert
async function checkExistingFamily(email, phone) {
  // Search by email first
  let ownerFromDeals = null;
  if (email) {
    const contact = await hubspot.searchContactByEmail(email);
    if (contact) {
      ownerFromDeals = await getOwnerFromContactDeals(contact.id);
      if (ownerFromDeals) return ownerFromDeals;

      // Check household associations
      ownerFromDeals = await getOwnerFromHousehold(contact.id);
      if (ownerFromDeals) return ownerFromDeals;
    }
  }

  // Search by phone
  if (phone) {
    const contact = await hubspot.searchContactByPhone(phone);
    if (contact) {
      ownerFromDeals = await getOwnerFromContactDeals(contact.id);
      if (ownerFromDeals) return ownerFromDeals;

      ownerFromDeals = await getOwnerFromHousehold(contact.id);
      if (ownerFromDeals) return ownerFromDeals;
    }
  }

  return null;
}

async function getOwnerFromContactDeals(contactId) {
  const dealAssociations = await hubspot.getContactDeals(contactId);
  for (const assoc of dealAssociations) {
    const dealId = assoc.toObjectId;
    try {
      const deal = await hubspot.getDeal(dealId);
      const ownerId = deal?.properties?.hubspot_owner_id;
      if (ownerId && !config.EXCLUDED_OWNER_IDS.includes(ownerId)) {
        return { expertId: ownerId, rule: 'existing_family_deal' };
      }
    } catch {
      // Deal may have been deleted; skip
    }
  }
  return null;
}

async function getOwnerFromHousehold(contactId) {
  const households = await hubspot.getContactHouseholds(contactId);
  for (const hh of households) {
    const householdId = hh.toObjectId;
    const members = await hubspot.getHouseholdContacts(householdId);
    for (const member of members) {
      const memberId = member.toObjectId;
      if (String(memberId) === String(contactId)) continue;
      const result = await getOwnerFromContactDeals(memberId);
      if (result) {
        return { expertId: result.expertId, rule: 'existing_family_household' };
      }
    }
  }
  return null;
}

// Step 2: Check if the form came from an expert's profile page
function checkRequestedExpert(sourceUrl) {
  if (!sourceUrl) return null;

  const url = sourceUrl.toLowerCase();
  // Match /experts/slug or /team/slug
  const match = url.match(/\/(?:experts|team)\/([a-z0-9-]+)/);
  if (!match) return null;

  const slug = match[1];
  const expertId = config.EXPERT_SLUGS[slug];
  if (expertId) {
    return { expertId, rule: `requested_expert_${slug}` };
  }
  return null;
}

// Step 3: International routing
function checkInternational(country, phone) {
  // Check country field
  if (country && country.toLowerCase() !== 'united states' && country.toLowerCase() !== 'us' && country.toLowerCase() !== 'usa') {
    const expertId = config.INTERNATIONAL_ROUTES[country];
    if (expertId) {
      return { expertId, rule: `international_${country.toLowerCase().replace(/\s+/g, '_')}` };
    }
    return { expertId: config.INTERNATIONAL_FALLBACK, rule: `international_fallback_${country.toLowerCase().replace(/\s+/g, '_')}` };
  }

  // Check phone for non-US country code
  if (phone) {
    const cleaned = phone.replace(/[\s()-]/g, '');
    if (cleaned.startsWith('+') && !cleaned.startsWith('+1')) {
      return { expertId: config.INTERNATIONAL_FALLBACK, rule: 'international_phone_prefix' };
    }
  }

  return null;
}

// Step 4: Domestic US routing by zip or phone area code
async function checkDomestic(zip, phone) {
  // Try zip first
  if (zip) {
    const result = getExpertByZip(zip);
    if (result) {
      if (result.expertId === config.MANHATTAN_ROTATION) {
        const rotatedId = await supabase.getNextManhattanExpert();
        return { expertId: rotatedId, rule: 'manhattan_rotation' };
      }
      return result;
    }
  }

  // Fallback to phone area code
  if (phone) {
    const result = await getExpertByAreaCode(phone);
    if (result) return result;
  }

  return null;
}

function getExpertByZip(zip) {
  if (!zip) return null;

  const cleanZip = zip.replace(/[\s-]/g, '').substring(0, 5);

  // Check UWS first
  if (config.UWS_ZIPS.includes(cleanZip)) {
    return { expertId: '87283274', rule: 'manhattan_uws' };
  }

  // Check Manhattan rotation
  if (config.MANHATTAN_ZIPS.includes(cleanZip)) {
    return { expertId: config.MANHATTAN_ROTATION, rule: 'manhattan_rotation' };
  }

  // Check exact 5-digit zip (most specific)
  if (config.ZIP_ROUTES[cleanZip]) {
    return { expertId: config.ZIP_ROUTES[cleanZip], rule: `zip_exact_${cleanZip}` };
  }

  // Check 3-digit prefix
  const prefix3 = cleanZip.substring(0, 3);
  if (config.ZIP_ROUTES[prefix3]) {
    return { expertId: config.ZIP_ROUTES[prefix3], rule: `zip_prefix_${prefix3}` };
  }

  return null;
}

async function getExpertByAreaCode(phone) {
  if (!phone) return null;

  const cleaned = phone.replace(/[\s()+\-\.]/g, '');
  // Extract area code: handle +1XXXXXXXXXX, 1XXXXXXXXXX, or XXXXXXXXXX
  let areaCode;
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    areaCode = cleaned.substring(1, 4);
  } else if (cleaned.length === 10) {
    areaCode = cleaned.substring(0, 3);
  } else {
    return null;
  }

  const expertId = config.AREA_CODE_ROUTES[areaCode];
  if (!expertId) return null;

  if (expertId === config.MANHATTAN_ROTATION) {
    const rotatedId = await supabase.getNextManhattanExpert();
    return { expertId: rotatedId, rule: 'area_code_manhattan_rotation' };
  }

  return { expertId, rule: `area_code_${areaCode}` };
}

// Step 5: AI-powered routing when geographic rules don't match
async function tryAiRouting(lead) {
  if (!anthropic) return null;

  // Build lead summary
  const leadParts = [];
  if (lead.zip) leadParts.push(`ZIP: ${lead.zip}`);
  if (lead.country) leadParts.push(`Country: ${lead.country}`);
  if (lead.phone) leadParts.push(`Phone: ${lead.phone}`);
  if (lead.city) leadParts.push(`City: ${lead.city}`);
  if (lead.address) leadParts.push(`Address: ${lead.address}`);
  if (lead.description) leadParts.push(`Notes: ${lead.description}`);

  if (leadParts.length === 0) return null;

  // Build expert options (exclude office, Manhattan rotation entries, and experts without profiles)
  const expertOptions = [];
  for (const [id, profile] of Object.entries(config.EXPERT_PROFILES)) {
    const expert = config.EXPERTS[id];
    if (!expert || id === config.CAMP_EXPERTS_OFFICE_ID) continue;
    expertOptions.push(`ID:${id} | ${expert.name} | Regions: ${profile.regions.join(', ')} | Specialty: ${profile.specialty}`);
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: `You are a lead routing assistant for Camp Experts, a summer camp placement service. A new lead came in but didn't match any geographic routing rules. Pick the BEST expert based on geographic proximity and specialty match.

Lead info:
${leadParts.join('\n')}

Available experts:
${expertOptions.join('\n')}

Reply with ONLY the expert ID number (e.g., 87283304) of the best match. If no expert is a reasonable match, reply "NONE".`,
      }],
    });

    const answer = (response.content[0]?.text || '').trim();

    if (answer === 'NONE') return null;

    // Extract the ID from the response
    const idMatch = answer.match(/\d{8,}/);
    if (!idMatch) return null;

    const expertId = idMatch[0];
    if (config.EXPERTS[expertId] && expertId !== config.CAMP_EXPERTS_OFFICE_ID) {
      console.log(`[routing] AI routing matched: ${config.EXPERTS[expertId].name} (${expertId})`);
      return { expertId, rule: `ai_routing_${expertId}` };
    }

    return null;
  } catch (err) {
    console.error('[routing] AI routing failed, skipping:', err.message);
    return null;
  }
}

// Test-only export: run routing without HubSpot side effects
async function testRoute(lead) {
  return routeLead(lead);
}

module.exports = { routeLead, testRoute, getExpertByZip };
