const { EXPERTS } = require('./routing-config');

const QUO_API_URL = 'https://api.openphone.com/v1/messages';
const QUO_API_KEY = process.env.QUO_API_KEY;
const QUO_FROM_PHONE_NUMBER_ID = process.env.QUO_FROM_NUMBER || '';

async function sendExpertSms({ expertOwnerId, familyName, location, isReturningFamily, childrenCount, email }) {
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
    lines.push(`🔁 Returning Family: ${familyName}`);
  } else {
    lines.push(`🏕️ New Lead: ${familyName}`);
  }
  lines.push(`📍 ${location}`);
  if (childrenCount) lines.push(`👧 ${childrenCount} ${childrenCount === 1 ? 'child' : 'children'}`);
  if (email) lines.push(`✉️ ${email}`);
  lines.push('');
  lines.push('Full details in your email.');
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
      return;
    }

    console.log(`[sms] Text sent to ${expert.name} (${expert.phone}) via Quo`);
  } catch (err) {
    console.error(`[sms] Failed to text ${expert.name}:`, err.message);
  }
}

module.exports = { sendExpertSms };
