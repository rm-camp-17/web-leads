const hubspot = require('./hubspot');
const supabase = require('./db');
const config = require('./routing-config');

let Anthropic;
let anthropic;
try {
  Anthropic = require('@anthropic-ai/sdk');
  if (process.env.ANTHROPIC_API_KEY) {
    anthropic = new Anthropic();
  }
} catch {
}

async function routeLead(lead) {
  try {
    if (process.env.TEST_MODE === 'true') {
      console.log('[routing] TEST_MODE active — routing to Riley via Office ID');
      return { expertId: config.CAMP_EXPERTS_OFFICE_ID, rule: 'test_mode_override' };
    }

    const existingResult = await checkExistingFamily(lead.email, lead.phone);
    if (existingResult) return existingResult;

    const requestedResult = checkRequestedExpert(lead.source_url);
    if (requestedResult) return requestedResult;

    const internationalResult = checkInternational(lead.country, lead.phone);
    if (internationalResult) return internationalResult;

    const domesticResult = await checkDomestic(lead.zip, lead.phone);
    if (domesticResult) return domesticResult;

    const aiResult = await checkAiRouting(lead);
    if (aiResult) return aiResult;

    // Nothing matched. A US-looking lead in an uncovered area is a "jump ball"
    // → Lindsey Schwimmer. Anything else (unresolved international / no signal)
    // stays with the office.
    if (looksDomestic(lead)) {
      return { expertId: config.JUMP_BALL_OWNER_ID, rule: 'jump_ball_us_gap' };
    }
    return { expertId: config.CAMP_EXPERTS_OFFICE_ID, rule: 'fallback_no_match' };
  } catch (err) {
    console.error('Routing engine error, falling back to office:', err.message);
    return { expertId: config.CAMP_EXPERTS_OFFICE_ID, rule: 'fallback_error' };
  }
}

async function checkExistingFamily(email, phone) {
  let ownerFromDeals = null;
  if (email) {
    const contact = await hubspot.searchContactByEmail(email);
    if (contact) {
      ownerFromDeals = await getOwnerFromContactDeals(contact.id);
      if (ownerFromDeals) return ownerFromDeals;

      ownerFromDeals = await getOwnerFromHousehold(contact.id);
      if (ownerFromDeals) return ownerFromDeals;
    }
  }

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

function checkRequestedExpert(sourceUrl) {
  if (!sourceUrl) return null;

  const url = sourceUrl.toLowerCase();
  const match = url.match(/\/(?:experts|team)\/([a-z0-9-]+)/);
  if (!match) return null;

  const slug = match[1];
  const expertId = config.EXPERT_SLUGS[slug];
  if (expertId) {
    return { expertId, rule: `requested_expert_${slug}` };
  }
  return null;
}

const US_COUNTRY_NAMES = [
  'united states', 'united states of america', 'us', 'u.s.', 'u.s.a.', 'usa', 'america',
];

// Parse an international dialing code from a phone number.
// Returns null for bare/US-format numbers (so US area-code routing still runs);
// { isUs:true } for +1 numbers; { cc, expertId } for recognised intl numbers.
// IMPORTANT: a 10-digit US number like 330-555-1234 must NOT be read as "+33"
// (France) — we only treat a number as international when it is dialed that way
// (leading "+" or "00").
function parsePhoneCC(phone) {
  if (!phone) return null;
  const digits = String(phone).trim().replace(/[\s()\-\.]/g, '');
  let intl = null;
  if (digits.startsWith('+')) intl = digits.slice(1);
  else if (digits.startsWith('00')) intl = digits.slice(2);
  if (!intl || !/^\d+$/.test(intl)) return null;
  if (intl.startsWith('1') && intl.length >= 11) return { cc: '1', isUs: true };
  for (const len of [3, 2]) {
    const cc = intl.slice(0, len);
    if (config.PHONE_CC_ROUTES[cc]) return { cc, isUs: false, expertId: config.PHONE_CC_ROUTES[cc] };
  }
  return { cc: intl.slice(0, 2), isUs: false, expertId: null };
}

function isUsCountry(country) {
  return !!country && US_COUNTRY_NAMES.includes(country.trim().toLowerCase());
}

function checkInternational(country, phone) {
  // 1) An explicit non-US country always wins.
  if (country && country.trim()) {
    if (isUsCountry(country)) return null; // US — hand off to domestic routing
    const expertId = config.INTERNATIONAL_ROUTES[country.trim()];
    if (expertId) {
      return { expertId, rule: `international_${country.trim().toLowerCase().replace(/\s+/g, '_')}` };
    }
    // Unknown non-US country label — try the phone dialing code before the office.
    const byPhone = parsePhoneCC(phone);
    if (byPhone && byPhone.expertId) {
      return { expertId: byPhone.expertId, rule: `international_phone_cc_${byPhone.cc}` };
    }
    return { expertId: config.INTERNATIONAL_FALLBACK, rule: `international_fallback_${country.trim().toLowerCase().replace(/\s+/g, '_')}` };
  }

  // 2) Country is blank — fall back to the phone dialing code.
  // This is the fix for European ZIPs that collide with US prefixes
  // (e.g. Paris 75008 vs Dallas 750): a +33 phone routes to the France expert
  // BEFORE the US ZIP table ever sees "75008".
  const byPhone = parsePhoneCC(phone);
  if (byPhone && !byPhone.isUs) {
    if (byPhone.expertId) {
      return { expertId: byPhone.expertId, rule: `international_phone_cc_${byPhone.cc}` };
    }
    return { expertId: config.INTERNATIONAL_FALLBACK, rule: 'international_phone_prefix' };
  }

  return null;
}

// Does this lead look like a US (domestic) lead? Used to decide whether an
// unmatched lead is a domestic "jump ball" (→ Lindsey) or unresolved
// international (→ office).
function looksDomestic(lead) {
  if (isUsCountry(lead.country)) return true;
  const pc = parsePhoneCC(lead.phone);
  if (pc) {
    if (pc.isUs) return true;
    return false; // a recognised international dialing code → not domestic
  }
  if (lead.phone) {
    const d = String(lead.phone).replace(/[\s()+\-\.]/g, '');
    if (d.length === 10 || (d.length === 11 && d.startsWith('1'))) return true;
  }
  // No international signal at all + a US-format ZIP → treat as domestic.
  if (lead.zip && /^\d{5}$/.test(String(lead.zip).replace(/[\s-]/g, '').substring(0, 5))) return true;
  return false;
}

async function checkDomestic(zip, phone) {
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

  if (phone) {
    const result = await getExpertByAreaCode(phone);
    if (result) return result;
  }

  return null;
}

function getExpertByZip(zip) {
  if (!zip) return null;

  const cleanZip = zip.replace(/[\s-]/g, '').substring(0, 5);

  if (config.UWS_ZIPS.includes(cleanZip)) {
    return { expertId: '87283274', rule: 'manhattan_uws' };
  }

  if (config.MANHATTAN_ZIPS.includes(cleanZip)) {
    return { expertId: config.MANHATTAN_ROTATION, rule: 'manhattan_rotation' };
  }

  if (config.ZIP_ROUTES[cleanZip]) {
    return { expertId: config.ZIP_ROUTES[cleanZip], rule: `zip_exact_${cleanZip}` };
  }

  const prefix3 = cleanZip.substring(0, 3);
  if (config.ZIP_ROUTES[prefix3]) {
    return { expertId: config.ZIP_ROUTES[prefix3], rule: `zip_prefix_${prefix3}` };
  }

  // Whole-state default (single-expert states) — applied only after metro rules miss.
  const state = zip3ToState(prefix3);
  if (state && config.STATE_ROUTES[state]) {
    return { expertId: config.STATE_ROUTES[state], rule: `state_${state}` };
  }

  return null;
}

// Map a 3-digit ZIP prefix to its US state via the SCF allocation table.
function zip3ToState(prefix3) {
  const n = parseInt(prefix3, 10);
  if (Number.isNaN(n)) return null;
  for (const [a, b, st] of config.ZIP3_STATE_RANGES) if (n >= a && n <= b) return st;
  return null;
}

async function getExpertByAreaCode(phone) {
  if (!phone) return null;

  const cleaned = phone.replace(/[\s()+\-\.]/g, '');
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

async function checkAiRouting(lead) {
  if (!anthropic) return null;

  const hasSignal = lead.zip || lead.phone || lead.city || lead.address || lead.description;
  if (!hasSignal) {
    console.log('[ai-routing] No routing signal available, skipping AI');
    return null;
  }

  try {
    const profileSummary = Object.entries(config.EXPERT_PROFILES)
      .map(([id, p]) => `${id}: regions=[${p.regions.join(', ')}], specialty="${p.specialty}"`)
      .join('\n');

    const leadInfo = [
      lead.zip ? `ZIP: ${lead.zip}` : null,
      lead.phone ? `Phone: ${lead.phone}` : null,
      lead.city ? `City: ${lead.city}` : null,
      lead.address ? `Address: ${lead.address}` : null,
      lead.country ? `Country: ${lead.country}` : null,
      lead.description ? `Description: ${lead.description}` : null,
    ].filter(Boolean).join('\n');

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 50,
      messages: [{
        role: 'user',
        content: `You are a lead routing assistant. Given the lead data below, pick the best expert based on geographic proximity and specialty. Reply with ONLY the expert's owner ID (a number like "87283296") or "NONE" if no good match.

Lead data:
${leadInfo}

Expert profiles:
${profileSummary}

Reply with the owner ID only.`,
      }],
    });

    const aiAnswer = (response.content[0]?.text || '').trim();

    if (aiAnswer === 'NONE' || !config.EXPERTS[aiAnswer]) {
      console.log(`[ai-routing] AI returned "${aiAnswer}", no match`);
      return null;
    }

    console.log(`[ai-routing] AI picked expert ${aiAnswer} (${config.EXPERTS[aiAnswer]?.name})`);
    return { expertId: aiAnswer, rule: `ai_routing_${aiAnswer}` };
  } catch (err) {
    console.error('[ai-routing] AI routing failed:', err.message);
    return null;
  }
}

async function testRoute(lead) {
  return routeLead(lead);
}

module.exports = { routeLead, testRoute, getExpertByZip, checkInternational, looksDomestic, parsePhoneCC };
