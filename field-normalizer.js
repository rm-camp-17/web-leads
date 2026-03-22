// Webflow field name normalization
// Webflow forms use inconsistent field names across different pages.

const FIELD_MAP = {
  // First name
  'first_name': 'first_name',
  'First Name': 'first_name',
  'First_Name': 'first_name',
  // Last name
  'last_name': 'last_name',
  'Last Name': 'last_name',
  'Last_Name': 'last_name',
  // Email
  'email': 'email',
  'Email': 'email',
  // Phone
  'phone': 'phone',
  'Phone Number': 'phone',
  'Phone_Number': 'phone',
  // Zip
  'zip': 'zip',
  'ZIP Code': 'zip',
  'ZIP_Code': 'zip',
  'Zip Code': 'zip',
  // Country
  'country': 'country',
  'Select Country': 'country',
  'Country': 'country',
  // Address
  'Street Address': 'address',
  'street_address': 'address',
  'address': 'address',
  // City
  'city': 'city',
  'City': 'city',
};

// Fields that indicate this is a "detailed" form (has child/location data)
const DETAILED_FORM_FIELDS = [
  'child_1_first_name',
  'zip',
  'description',
  'child_1_birth_date',
];

function normalizeFields(payload) {
  const normalized = {};

  for (const [key, value] of Object.entries(payload)) {
    const mappedKey = FIELD_MAP[key];
    if (mappedKey) {
      normalized[mappedKey] = typeof value === 'string' ? value.trim() : value;
    } else {
      // Pass through unmapped fields as-is (child fields, description, source_url, etc.)
      normalized[key] = typeof value === 'string' ? value.trim() : value;
    }
  }

  return normalized;
}

function isDetailedForm(payload) {
  // After normalization, check if any detailed-form indicator fields are present and non-empty
  return DETAILED_FORM_FIELDS.some((field) => {
    const value = payload[field];
    return value && String(value).trim().length > 0;
  });
}

// Extract child records from the normalized payload
// Children are numbered: child_1_*, child_2_*, etc.
function extractChildren(payload) {
  const children = [];
  for (let i = 1; i <= 10; i++) {
    const prefix = `child_${i}_`;
    const firstName = payload[`${prefix}first_name`];
    if (!firstName) break; // No more children

    children.push({
      first_name: firstName,
      last_name: payload[`${prefix}last_name`] || payload.last_name || '',
      birth_date: payload[`${prefix}birth_date`] || '',
      gender: payload[`${prefix}gender`] || '',
      interested_year: payload[`${prefix}interested_year`] || '',
      budget_per_week: payload[`${prefix}budget_per_week`] || '',
      session_length: payload[`${prefix}session_length`] || '',
    });
  }
  return children;
}

// Budget string → numeric value for HubSpot
const BUDGET_MAP = {
  '$': '1500',
  '$$': '2500',
  '$$$': '3500',
};

function mapBudget(value) {
  if (!value) return '';
  const mapped = BUDGET_MAP[value.trim()];
  return mapped || value; // Pass through if already numeric
}

module.exports = { normalizeFields, isDetailedForm, extractChildren, mapBudget };
