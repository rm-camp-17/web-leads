const { ReplitConnectors } = require('@replit/connectors-sdk');
const { HUBSPOT_CHILD_OBJECT_ID, HUBSPOT_HOUSEHOLD_OBJECT_ID } = require('./routing-config');
function safeLogError(params) {
  try { require('./db').logError(params); } catch {}
}

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

async function createContact({ firstName, lastName, email, phone, ownerId }) {
  const properties = {
    email,
    firstname: firstName || '',
    lastname: lastName || '',
  };
  if (phone) properties.phone = phone;
  if (ownerId) properties.hubspot_owner_id = ownerId;

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

async function searchHouseholdByEmail(email) {
  if (!email) return null;
  try {
    const data = await hubspotFetch(`/crm/v3/objects/${HUBSPOT_HOUSEHOLD_OBJECT_ID}/search`, {
      method: 'POST',
      body: JSON.stringify({
        filterGroups: [{
          filters: [{ propertyName: 'emailaddress', operator: 'EQ', value: email }]
        }],
        properties: ['householdid', 'household_name', 'emailaddress', 'cellnumber', 'zip'],
        limit: 1,
      }),
    });
    return data.results && data.results.length > 0 ? data.results[0] : null;
  } catch (err) {
    console.error('[hubspot] Household search by email failed:', err.message);
    safeLogError({ source: 'hubspot-search-household', errorMessage: err.message, context: { email } });
    return null;
  }
}

async function createHousehold({ householdId, familyName, email, phone, zip, country, numChildren, ownerId }) {
  const properties = {
    householdid: householdId,
  };
  if (familyName) properties.household_name = familyName;
  if (familyName) properties.familyname = familyName;
  if (email) properties.emailaddress = email;
  if (phone) properties.cellnumber = phone;
  if (zip) properties.zip = zip;
  if (country && !['Usa', 'USA', 'Us'].includes(country)) {
    properties.state___country__if_int_l_ = country;
  }
  if (numChildren) properties.num_children = String(numChildren);
  if (ownerId) properties.hubspot_owner_id = ownerId;

  const data = await hubspotFetch(`/crm/v3/objects/${HUBSPOT_HOUSEHOLD_OBJECT_ID}`, {
    method: 'POST',
    body: JSON.stringify({ properties }),
  });
  return data;
}

async function updateHousehold(householdRecordId, properties) {
  const data = await hubspotFetch(`/crm/v3/objects/${HUBSPOT_HOUSEHOLD_OBJECT_ID}/${householdRecordId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties }),
  });
  return data;
}

async function createChild({ firstName, lastName, birthDate, gender, interestedYear, budget, sessionLength, age, ownerId }) {
  const childId = `CH_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || '';
  const properties = {
    child_id: childId,
    first_name: fullName,
    child_first_name: firstName || '',
    last_name: lastName || '',
  };
  if (birthDate) properties.dob = birthDate;
  if (age !== undefined && age !== null) properties.age = String(age);
  if (gender) properties.gender = gender.toLowerCase();
  if (budget) properties.budget_per_week = budget;
  if (ownerId) properties.hubspot_owner_id = ownerId;

  const data = await hubspotFetch(`/crm/v3/objects/${HUBSPOT_CHILD_OBJECT_ID}`, {
    method: 'POST',
    body: JSON.stringify({ properties }),
  });
  return data;
}

async function associateObjects(fromObjectType, fromId, toObjectType, toId, associationTypeId, category = 'USER_DEFINED') {
  await hubspotFetch(
    `/crm/v4/objects/${fromObjectType}/${fromId}/associations/${toObjectType}/${toId}`,
    {
      method: 'PUT',
      body: JSON.stringify([{
        associationCategory: category,
        associationTypeId: associationTypeId,
      }]),
    }
  );
}

async function associateChildWithContact(childId, contactId) {
  await associateObjects('contacts', contactId, HUBSPOT_CHILD_OBJECT_ID, childId, 78);
}

async function associateContactWithHousehold(contactId, householdId) {
  await associateObjects('contacts', contactId, HUBSPOT_HOUSEHOLD_OBJECT_ID, householdId, 112);
}

async function associateChildWithHousehold(childId, householdId) {
  await associateObjects(HUBSPOT_CHILD_OBJECT_ID, childId, HUBSPOT_HOUSEHOLD_OBJECT_ID, householdId, 110);
}

async function associateDealWithHousehold(dealId, householdId) {
  await associateObjects('deals', dealId, HUBSPOT_HOUSEHOLD_OBJECT_ID, householdId, 170);
}

async function associateDealWithChild(dealId, childId) {
  await associateObjects('deals', dealId, HUBSPOT_CHILD_OBJECT_ID, childId, 153);
}

async function associateDealWithContact(dealId, contactId) {
  await associateObjects('deals', dealId, 'contacts', contactId, 3, 'HUBSPOT_DEFINED');
}

async function createDeal({ contactId, ownerId, dealName, householdId, childId, year }) {
  const properties = {
    dealname: dealName,
    dealstage: 'appointmentscheduled',
    hubspot_owner_id: ownerId,
    pipeline: 'default',
  };
  if (year) properties.year1 = year;
  if (householdId) properties.associated_household_id = householdId;
  if (childId) properties.associated_child_id = childId;

  const deal = await hubspotFetch('/crm/v3/objects/deals', {
    method: 'POST',
    body: JSON.stringify({ properties }),
  });

  const associationPromises = [];
  if (contactId) associationPromises.push(associateDealWithContact(deal.id, contactId));
  if (householdId) associationPromises.push(associateDealWithHousehold(deal.id, householdId));
  if (childId) associationPromises.push(associateDealWithChild(deal.id, childId));

  await Promise.all(associationPromises);

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
  } catch (err) {
    safeLogError({ source: 'hubspot-get-contact-households', errorMessage: err.message, context: { contactId } });
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
  } catch (err) {
    safeLogError({ source: 'hubspot-get-household-contacts', errorMessage: err.message, context: { householdId } });
    return [];
  }
}

module.exports = {
  searchContactByEmail,
  searchContactByPhone,
  searchHouseholdByEmail,
  createContact,
  updateContact,
  setContactOwner,
  createHousehold,
  updateHousehold,
  createChild,
  associateChildWithContact,
  associateContactWithHousehold,
  associateChildWithHousehold,
  associateDealWithContact,
  associateDealWithHousehold,
  associateDealWithChild,
  createDeal,
  getContactDeals,
  getDeal,
  getContactHouseholds,
  getHouseholdContacts,
};
