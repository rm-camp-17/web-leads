const { ReplitConnectors } = require('@replit/connectors-sdk');
const { HUBSPOT_CHILD_OBJECT_ID, HUBSPOT_HOUSEHOLD_OBJECT_ID } = require('./routing-config');

const connectors = new ReplitConnectors();

// Object type IDs (numeric, unambiguous)
const OBJ = {
  CONTACT: '0-1',
  DEAL: '0-3',
  HOUSEHOLD: HUBSPOT_HOUSEHOLD_OBJECT_ID,   // 2-53610744
  CHILD: HUBSPOT_CHILD_OBJECT_ID,           // 2-50911061
};

// Association type IDs (from migration config)
const ASSOC = {
  CONTACT_HOUSEHOLD: { id: 112, category: 'USER_DEFINED' },
  CHILD_HOUSEHOLD:   { id: 110, category: 'USER_DEFINED' },
  CONTACT_CHILD:     { id: 78,  category: 'USER_DEFINED' },
  DEAL_HOUSEHOLD:    { id: 170, category: 'USER_DEFINED' },
  DEAL_CHILD:        { id: 153, category: 'USER_DEFINED' },
  DEAL_CONTACT:      { id: 3,   category: 'HUBSPOT_DEFINED' },
};

// ── Low-level API helper ──

async function hubspotFetch(path, options = {}) {
  const method = options.method || 'GET';
  const fetchOptions = { method };

  if (options.body) {
    fetchOptions.body = options.body;
    fetchOptions.headers = { 'Content-Type': 'application/json' };
  }

  const res = await connectors.proxy("hubspot", path, fetchOptions);

  // Return raw response when caller needs to inspect status (e.g. 409 conflict)
  if (options.rawResponse) return res;

  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`HubSpot API ${method} ${path} → ${res.status}: ${body}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ── Association helper ──

async function associate(fromType, fromId, toType, toId, assocSpec) {
  await hubspotFetch(
    `/crm/v4/objects/${fromType}/${fromId}/associations/${toType}/${toId}`,
    {
      method: 'PUT',
      body: JSON.stringify([{
        associationCategory: assocSpec.category,
        associationTypeId: assocSpec.id,
      }]),
    }
  );
}

// ── Household (p_household) — 2-53610744 ──

async function searchHouseholdByEmailOrPhone(email, phone) {
  const filterGroups = [];
  if (email) {
    filterGroups.push({
      filters: [{ propertyName: 'emailaddress', operator: 'EQ', value: email }],
    });
  }
  if (phone) {
    filterGroups.push({
      filters: [{ propertyName: 'cellnumber', operator: 'EQ', value: phone }],
    });
  }
  if (filterGroups.length === 0) return null;

  const data = await hubspotFetch(`/crm/v3/objects/${OBJ.HOUSEHOLD}/search`, {
    method: 'POST',
    body: JSON.stringify({
      filterGroups,
      properties: ['householdid', 'household_name', 'emailaddress', 'cellnumber', 'hubspot_owner_id'],
    }),
  });
  return data.results?.[0] || null;
}

async function createHousehold({ householdId, lastName, email, phone, numChildren, country, zip, ownerId }) {
  const properties = {
    household_name: `${lastName} Family`,
    familyname: lastName,
    householdid: householdId,
    hubspot_owner_id: ownerId,
  };
  if (email) properties.emailaddress = email;
  if (phone) properties.cellnumber = phone;
  if (numChildren != null) properties.num_children = String(numChildren);
  if (country) properties['state___country__if_int_l_'] = country;
  if (zip) properties.zip = zip;

  const data = await hubspotFetch(`/crm/v3/objects/${OBJ.HOUSEHOLD}`, {
    method: 'POST',
    body: JSON.stringify({ properties }),
  });
  return data;
}

async function updateHousehold(recordId, properties) {
  return hubspotFetch(`/crm/v3/objects/${OBJ.HOUSEHOLD}/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties }),
  });
}

// ── Contact (standard) — 0-1 ──

async function searchContactByEmail(email) {
  const data = await hubspotFetch('/crm/v3/objects/contacts/search', {
    method: 'POST',
    body: JSON.stringify({
      filterGroups: [{
        filters: [{ propertyName: 'email', operator: 'EQ', value: email }],
      }],
      properties: ['email', 'firstname', 'lastname', 'phone', 'hubspot_owner_id', 'family_id'],
    }),
  });
  return data.results?.[0] || null;
}

async function searchContactByPhone(phone) {
  const data = await hubspotFetch('/crm/v3/objects/contacts/search', {
    method: 'POST',
    body: JSON.stringify({
      filterGroups: [{
        filters: [{ propertyName: 'phone', operator: 'EQ', value: phone }],
      }],
      properties: ['email', 'firstname', 'lastname', 'phone', 'hubspot_owner_id', 'family_id'],
    }),
  });
  return data.results?.[0] || null;
}

async function createContact({ firstName, lastName, email, phone, contactId, familyId, ownerId }) {
  const properties = {
    firstname: firstName || '',
    lastname: lastName || '',
    contact_id: contactId,
    family_id: familyId,
    is_primary_contact: 'true',
    role: 'Parent',
  };
  if (email) properties.email = email;
  if (phone) {
    properties.phone = phone;
    properties.mobilephone = phone;
  }
  if (ownerId) properties.hubspot_owner_id = ownerId;

  // HubSpot returns 409 if a contact with this email already exists
  const res = await hubspotFetch('/crm/v3/objects/contacts', {
    method: 'POST',
    body: JSON.stringify({ properties }),
    rawResponse: true,
  });

  if (res.ok) {
    const text = await res.text();
    return { data: JSON.parse(text), isNew: true };
  }

  if (res.status === 409) {
    // Extract existing contact ID from conflict response
    const body = await res.text();
    const parsed = JSON.parse(body);
    const existingId = parsed.message?.match(/Existing ID:\s*(\d+)/)?.[1];
    if (existingId) {
      return { data: { id: existingId }, isNew: false };
    }
    throw new Error(`Contact 409 conflict but could not extract existing ID: ${body}`);
  }

  const body = await res.text();
  throw new Error(`HubSpot API POST /crm/v3/objects/contacts → ${res.status}: ${body}`);
}

async function updateContact(contactId, properties) {
  return hubspotFetch(`/crm/v3/objects/contacts/${contactId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties }),
  });
}

async function setContactOwner(contactId, ownerId) {
  return updateContact(contactId, { hubspot_owner_id: ownerId });
}

// ── Child (p_children) — 2-50911061 ──

function calculateAge(dobString) {
  const dob = new Date(dobString);
  if (isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

async function createChild({ firstName, lastName, dob, gender, householdId, budget, interests, childId, ownerId }) {
  const properties = {
    first_name: firstName || '',
    last_name: lastName || '',
    associated_household_id: householdId,
    child_id: childId,
    clientid_access: childId,
    hubspot_owner_id: ownerId,
  };
  if (dob) {
    properties.dob = dob;
    const age = calculateAge(dob);
    if (age != null) properties.age = String(age);
  }
  if (gender) properties.gender = gender;
  if (budget) properties.budget_per_week = budget;
  if (interests) properties.interests = interests;

  const data = await hubspotFetch(`/crm/v3/objects/${OBJ.CHILD}`, {
    method: 'POST',
    body: JSON.stringify({ properties }),
  });
  return data;
}

// ── Deal (standard) — 0-3 ──

async function createDeal({ childFirstName, childLastName, year, householdId, childId, ownerId }) {
  const dealName = `${childFirstName} ${childLastName} | ${year || new Date().getFullYear()}`;
  const properties = {
    dealname: dealName,
    pipeline: 'default',
    dealstage: 'appointmentscheduled',
    associated_household_id: householdId,
    associated_child_id: childId,
    hubspot_owner_id: ownerId,
  };
  if (year) properties.year1 = year;

  const data = await hubspotFetch('/crm/v3/objects/deals', {
    method: 'POST',
    body: JSON.stringify({ properties }),
  });
  return data;
}

// ── Association convenience functions ──

async function createAllAssociations({ contactId, householdRecordId, childRecordId, dealRecordId }) {
  // Contact ↔ Household (type 112)
  await associate(OBJ.CONTACT, contactId, OBJ.HOUSEHOLD, householdRecordId, ASSOC.CONTACT_HOUSEHOLD);

  if (childRecordId) {
    // Child ↔ Household (type 110)
    await associate(OBJ.CHILD, childRecordId, OBJ.HOUSEHOLD, householdRecordId, ASSOC.CHILD_HOUSEHOLD);
    // Contact ↔ Child (type 78)
    await associate(OBJ.CONTACT, contactId, OBJ.CHILD, childRecordId, ASSOC.CONTACT_CHILD);
  }

  if (dealRecordId) {
    // Deal ↔ Household (type 170)
    await associate(OBJ.DEAL, dealRecordId, OBJ.HOUSEHOLD, householdRecordId, ASSOC.DEAL_HOUSEHOLD);
    // Deal → Contact (type 3, HUBSPOT_DEFINED — direction matters)
    await associate(OBJ.DEAL, dealRecordId, OBJ.CONTACT, contactId, ASSOC.DEAL_CONTACT);

    if (childRecordId) {
      // Deal ↔ Child (type 153)
      await associate(OBJ.DEAL, dealRecordId, OBJ.CHILD, childRecordId, ASSOC.DEAL_CHILD);
    }
  }
}

// ── Routing engine helpers (existing family lookups) ──

async function getContactDeals(contactId) {
  const data = await hubspotFetch(
    `/crm/v4/objects/${OBJ.CONTACT}/${contactId}/associations/${OBJ.DEAL}`,
    { method: 'GET' }
  );
  return data.results || [];
}

async function getDeal(dealId) {
  return hubspotFetch(`/crm/v3/objects/deals/${dealId}?properties=hubspot_owner_id`, {
    method: 'GET',
  });
}

async function getContactHouseholds(contactId) {
  try {
    const data = await hubspotFetch(
      `/crm/v4/objects/${OBJ.CONTACT}/${contactId}/associations/${OBJ.HOUSEHOLD}`,
      { method: 'GET' }
    );
    return data.results || [];
  } catch {
    return [];
  }
}

async function getHouseholdContacts(householdId) {
  try {
    const data = await hubspotFetch(
      `/crm/v4/objects/${OBJ.HOUSEHOLD}/${householdId}/associations/${OBJ.CONTACT}`,
      { method: 'GET' }
    );
    return data.results || [];
  } catch {
    return [];
  }
}

module.exports = {
  // Household
  searchHouseholdByEmailOrPhone,
  createHousehold,
  updateHousehold,
  // Contact
  searchContactByEmail,
  searchContactByPhone,
  createContact,
  updateContact,
  setContactOwner,
  // Child
  createChild,
  // Deal
  createDeal,
  // Associations
  createAllAssociations,
  // Routing engine helpers
  getContactDeals,
  getDeal,
  getContactHouseholds,
  getHouseholdContacts,
};
