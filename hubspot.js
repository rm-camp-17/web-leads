const { HUBSPOT_CHILD_OBJECT_ID, HUBSPOT_HOUSEHOLD_OBJECT_ID } = require('./routing-config');

const BASE_URL = 'https://api.hubapi.com';

function headers() {
  return {
    Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

async function hubspotFetch(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { ...headers(), ...options.headers },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HubSpot API ${options.method || 'GET'} ${path} → ${res.status}: ${body}`);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ── Contact Search ──

async function searchContactByEmail(email) {
  const data = await hubspotFetch('/crm/v3/objects/contacts/search', {
    method: 'POST',
    body: JSON.stringify({
      filterGroups: [{
        filters: [{ propertyName: 'email', operator: 'EQ', value: email }],
      }],
      properties: ['email', 'firstname', 'lastname', 'phone', 'hubspot_owner_id'],
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
      properties: ['email', 'firstname', 'lastname', 'phone', 'hubspot_owner_id'],
    }),
  });
  return data.results?.[0] || null;
}

// ── Contact CRUD ──

async function createContact({ firstName, lastName, email, phone }) {
  const properties = {
    email,
    firstname: firstName || '',
    lastname: lastName || '',
  };
  if (phone) properties.phone = phone;

  const data = await hubspotFetch('/crm/v3/objects/contacts', {
    method: 'POST',
    body: JSON.stringify({ properties }),
  });
  return data;
}

async function updateContact(contactId, properties) {
  const data = await hubspotFetch(`/crm/v3/objects/contacts/${contactId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties }),
  });
  return data;
}

async function setContactOwner(contactId, ownerId) {
  return updateContact(contactId, { hubspot_owner_id: ownerId });
}

// ── Child Custom Object ──

async function createChild({ firstName, lastName, birthDate, gender, interestedYear, budget, sessionLength }) {
  const properties = {
    first_name: firstName || '',
    last_name: lastName || '',
  };
  if (birthDate) properties.birth_date = birthDate;
  if (gender) properties.gender = gender;
  if (interestedYear) properties.interested_year = interestedYear;
  if (budget) properties.budget_per_week = budget;
  if (sessionLength) properties.session_length = sessionLength;

  const data = await hubspotFetch(`/crm/v3/objects/${HUBSPOT_CHILD_OBJECT_ID}`, {
    method: 'POST',
    body: JSON.stringify({ properties }),
  });
  return data;
}

async function associateChildWithContact(childId, contactId) {
  await hubspotFetch(
    `/crm/v4/objects/${HUBSPOT_CHILD_OBJECT_ID}/${childId}/associations/contacts/${contactId}`,
    {
      method: 'PUT',
      body: JSON.stringify([{
        associationCategory: 'USER_DEFINED',
        associationTypeId: 1,
      }]),
    }
  );
}

// ── Deals ──

async function createDeal({ contactId, ownerId, familyName }) {
  const deal = await hubspotFetch('/crm/v3/objects/deals', {
    method: 'POST',
    body: JSON.stringify({
      properties: {
        dealname: `New Lead - ${familyName}`,
        dealstage: 'appointmentscheduled', // "New Lead" stage — adjust pipeline stage ID as needed
        hubspot_owner_id: ownerId,
        pipeline: 'default',
      },
    }),
  });

  // Associate deal with contact
  await hubspotFetch(
    `/crm/v4/objects/deals/${deal.id}/associations/contacts/${contactId}`,
    {
      method: 'PUT',
      body: JSON.stringify([{
        associationCategory: 'HUBSPOT_DEFINED',
        associationTypeId: 3, // deal_to_contact
      }]),
    }
  );

  return deal;
}

// ── Deals for Existing Family Check ──

async function getContactDeals(contactId) {
  const data = await hubspotFetch(
    `/crm/v4/objects/contacts/${contactId}/associations/deals`,
    { method: 'GET' }
  );
  return data.results || [];
}

async function getDeal(dealId) {
  const data = await hubspotFetch(`/crm/v3/objects/deals/${dealId}?properties=hubspot_owner_id`, {
    method: 'GET',
  });
  return data;
}

// ── Household Associations ──

async function getContactHouseholds(contactId) {
  try {
    const data = await hubspotFetch(
      `/crm/v4/objects/contacts/${contactId}/associations/${HUBSPOT_HOUSEHOLD_OBJECT_ID}`,
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
      `/crm/v4/objects/${HUBSPOT_HOUSEHOLD_OBJECT_ID}/${householdId}/associations/contacts`,
      { method: 'GET' }
    );
    return data.results || [];
  } catch {
    return [];
  }
}

module.exports = {
  searchContactByEmail,
  searchContactByPhone,
  createContact,
  updateContact,
  setContactOwner,
  createChild,
  associateChildWithContact,
  createDeal,
  getContactDeals,
  getDeal,
  getContactHouseholds,
  getHouseholdContacts,
};
