const { ReplitConnectors } = require('@replit/connectors-sdk');
const { HUBSPOT_CHILD_OBJECT_ID, HUBSPOT_HOUSEHOLD_OBJECT_ID } = require('./routing-config');

const connectors = new ReplitConnectors();

async function hubspotFetch(path, options = {}) {
  const method = options.method || 'GET';
  const fetchOptions = { method };

  if (options.body) {
    fetchOptions.body = options.body;
    fetchOptions.headers = { 'Content-Type': 'application/json' };
  }

  const res = await connectors.proxy("hubspot", path, fetchOptions);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HubSpot API ${method} ${path} → ${res.status}: ${body}`);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

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

async function createDeal({ contactId, ownerId, familyName }) {
  const deal = await hubspotFetch('/crm/v3/objects/deals', {
    method: 'POST',
    body: JSON.stringify({
      properties: {
        dealname: `New Lead - ${familyName}`,
        dealstage: 'appointmentscheduled',
        hubspot_owner_id: ownerId,
        pipeline: 'default',
      },
    }),
  });

  await hubspotFetch(
    `/crm/v4/objects/deals/${deal.id}/associations/contacts/${contactId}`,
    {
      method: 'PUT',
      body: JSON.stringify([{
        associationCategory: 'HUBSPOT_DEFINED',
        associationTypeId: 3,
      }]),
    }
  );

  return deal;
}

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
