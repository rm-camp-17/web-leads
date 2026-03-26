const { EXPERTS } = require('./routing-config');
function safeLogError(params) {
  try { require('./db').logError(params); } catch {}
}

const QUO_API_URL = 'https://api.openphone.com/v1/messages';
const QUO_API_KEY = process.env.QUO_API_KEY;
const QUO_FROM_PHONE_NUMBER_ID = process.env.QUO_FROM_NUMBER || '';

function calculateAge(birthDate) {
  if (!birthDate) return null;
  const dob = new Date(birthDate);
  if (isNaN(dob)) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

function formatChildLine(child) {
  const parts = [child.first_name];
  const age = calculateAge(child.birth_date);
  if (age !== null) parts.push(`age ${age}`);
  else if (child.birth_date) parts.push(`DOB ${child.birth_date}`);
  if (child.gender) parts.push(child.gender);
  if (child.session_length) parts.push(child.session_length);
  if (child.interested_year) parts.push(`for ${child.interested_year}`);
  return parts.join(', ');
}

async function sendExpertSms({ expertOwnerId, familyName, phone, city, zip, country, isReturningFamily, children, email, description }) {
  const expert = EXPERTS[expertOwnerId];
  if (!expert || !expert.phone) {
    console.log(`[sms] No phone number for expert ${expertOwnerId}, skipping SMS`);
    return;
  }

  if (!QUO_API_KEY) {
    console.log('[sms] Quo not configured (missing QUO_API_KEY), skipping SMS');
    return;
  }

  if (!QUO_FROM_PHONE_NUMBER_ID) {
    console.log('[sms] Quo not configured (missing QUO_FROM_NUMBER), skipping SMS');
    return;
  }

  const lines = [];

  if (isReturningFamily) {
    lines.push(`🏕️ NEW WEB LEAD - RETURNING FAMILY`);
  } else {
    lines.push(`🏕️ NEW WEB LEAD`);
  }
  lines.push(`New family just came in — go get 'em!`);
  lines.push('');

  lines.push(`Parent: ${familyName}`);
  if (phone) lines.push(`Phone: ${phone}`);
  if (email) lines.push(`Email: ${email}`);
  const locationParts = [city, zip].filter(Boolean);
  if (locationParts.length) lines.push(`Location: ${locationParts.join(', ')}`);
  lines.push('');

  if (children && children.length > 0) {
    lines.push(children.length === 1 ? `Child:` : `Children:`);
    for (const child of children) {
      lines.push(`  ${formatChildLine(child)}`);
    }
  }

  if (description) {
    lines.push('');
    lines.push(`Notes: ${description}`);
  }

  const body = lines.join('\n');

  console.log(`[sms] Attempting to send from ${QUO_FROM_PHONE_NUMBER_ID} to ${expert.phone}`);
  try {
    const res = await fetch(QUO_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': QUO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: body,
        from: QUO_FROM_PHONE_NUMBER_ID,
        to: [expert.phone],
      }),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      console.error(`[sms] Quo API returned ${res.status}: ${errorBody}`);
      safeLogError({ source: 'sms', errorMessage: `Quo API ${res.status}: ${errorBody}`, context: { expertName: expert.name, familyName } });
      return;
    }

    console.log(`[sms] Text sent to ${expert.name} (${expert.phone}) via Quo`);
  } catch (err) {
    console.error(`[sms] Failed to text ${expert.name}:`, err.message);
    safeLogError({ source: 'sms', errorMessage: err.message, context: { expertName: expert.name, familyName } });
  }
}

module.exports = { sendExpertSms };
