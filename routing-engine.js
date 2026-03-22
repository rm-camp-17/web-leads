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

function checkInternational(country, phone) {
  if (country && country.toLowerCase() !== 'united states' && country.toLowerCase() !== 'us' && country.toLowerCase() !== 'usa') {
    const expertId = config.INTERNATIONAL_ROUTES[country];
    if (expertId) {
      return { expertId, rule: `international_${country.toLowerCase().replace(/\s+/g, '_')}` };
    }
    return { expertId: config.INTERNATIONAL_FALLBACK, rule: `international_fallback_${country.toLowerCase().replace(/\s+/g, '_')}` };
  }

  if (phone) {
    const cleaned = phone.replace(/[\s()-]/g, '');
    if (cleaned.startsWith('+') && !cleaned.startsWith('+1')) {
      return { expertId: config.INTERNATIONAL_FALLBACK, rule: 'international_phone_prefix' };
    }
  }

  return null;
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

module.exports = { routeLead, testRoute, getExpertByZip };
