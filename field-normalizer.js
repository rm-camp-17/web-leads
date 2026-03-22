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

// Extract lead source attribution from form data
// Webflow can pass UTM params, referrer, and page URL as hidden fields
function extractLeadSource(payload) {
  const source = {};

  // Source URL (the page the form was on)
  const sourceUrl = payload.source_url || payload.source || payload.Source || payload['Source URL'] || payload.page_url || null;
  if (sourceUrl) source.source_url = sourceUrl;

  // UTM parameters (commonly passed as hidden fields in Webflow forms)
  const utmFields = {
    utm_source: ['utm_source', 'UTM Source', 'UTM_Source'],
    utm_medium: ['utm_medium', 'UTM Medium', 'UTM_Medium'],
    utm_campaign: ['utm_campaign', 'UTM Campaign', 'UTM_Campaign'],
    utm_term: ['utm_term', 'UTM Term', 'UTM_Term'],
    utm_content: ['utm_content', 'UTM Content', 'UTM_Content'],
  };

  for (const [normalized, variants] of Object.entries(utmFields)) {
    for (const variant of variants) {
      if (payload[variant] && String(payload[variant]).trim()) {
        source[normalized] = String(payload[variant]).trim();
        break;
      }
    }
  }

  // Try to parse UTM params from source_url if not provided as separate fields
  if (sourceUrl && !source.utm_source) {
    try {
      const url = new URL(sourceUrl);
      for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
        const val = url.searchParams.get(key);
        if (val) source[key] = val;
      }
    } catch {
      // Not a valid URL, skip
    }
  }

  // Referrer
  const referrer = payload.referrer || payload.Referrer || payload.referring_url || null;
  if (referrer) source.referrer = referrer;

  // Form ID / form name (Webflow sometimes includes these)
  const formName = payload._formName || payload.formName || payload['Form Name'] || null;
  if (formName) source.form_name = formName;

  // Derive a human-readable lead_source label
  if (source.utm_source) {
    source.lead_source = source.utm_source;
    if (source.utm_medium) source.lead_source += ` / ${source.utm_medium}`;
  } else if (source.source_url) {
    try {
      const url = new URL(source.source_url);
      source.lead_source = `website: ${url.pathname}`;
    } catch {
      source.lead_source = 'website';
    }
  } else {
    source.lead_source = 'webflow_form';
  }

  return source;
}

const COUNTRY_MAP = {
  'united states': 'Usa',
  'united states of america': 'Usa',
  'us': 'Usa',
  'u.s.': 'Usa',
  'u.s.a.': 'Usa',
  'america': 'Usa',
  'usa': 'Usa',
  'united kingdom': 'UK',
  'great britain': 'UK',
  'england': 'UK',
  'scotland': 'UK',
  'wales': 'UK',
  'northern ireland': 'UK',
};

function normalizeCountry(value) {
  if (!value) return value;
  const lower = value.trim().toLowerCase();
  return COUNTRY_MAP[lower] || value.trim();
}

module.exports = { normalizeFields, isDetailedForm, extractChildren, mapBudget, extractLeadSource, normalizeCountry };
