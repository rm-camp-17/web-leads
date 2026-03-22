const twilio = require('twilio');
const { EXPERTS } = require('./routing-config');

async function getTwilioCredentials() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? 'depl ' + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken || !hostname) {
    return null;
  }

  const res = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=twilio',
    {
      headers: {
        'Accept': 'application/json',
        'X-Replit-Token': xReplitToken,
      },
    }
  );

  if (!res.ok) {
    throw new Error(`Twilio connector API returned ${res.status}`);
  }

  const data = await res.json();
  const connection = data.items?.[0];

  if (!connection || !connection.settings.account_sid || !connection.settings.api_key || !connection.settings.api_key_secret) {
    return null;
  }

  return {
    accountSid: connection.settings.account_sid,
    apiKey: connection.settings.api_key,
    apiKeySecret: connection.settings.api_key_secret,
    phoneNumber: connection.settings.phone_number,
  };
}

async function sendExpertSms({ expertOwnerId, familyName, location, isReturningFamily, childrenCount, email }) {
  const expert = EXPERTS[expertOwnerId];
  if (!expert || !expert.phone) {
    console.log(`[sms] No phone number for expert ${expertOwnerId}, skipping SMS`);
    return;
  }

  let creds;
  try {
    creds = await getTwilioCredentials();
  } catch (err) {
    console.log('[sms] Twilio not configured, skipping SMS:', err.message);
    return;
  }

  if (!creds) {
    console.log('[sms] Twilio not configured, skipping SMS');
    return;
  }

  const client = twilio(creds.apiKey, creds.apiKeySecret, { accountSid: creds.accountSid });
  const fromNumber = creds.phoneNumber;

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

  console.log(`[sms] Attempting to send from ${fromNumber} to ${expert.phone}`);
  try {
    const msg = await client.messages.create({
      body,
      from: fromNumber,
      to: expert.phone,
    });
    console.log(`[sms] Text sent to ${expert.name} (${expert.phone}) — SID: ${msg.sid}, status: ${msg.status}`);
  } catch (err) {
    console.error(`[sms] Failed to text ${expert.name}:`, err.message);
    if (err.code) console.error(`[sms] Twilio error code: ${err.code}, moreInfo: ${err.moreInfo || 'n/a'}`);
  }
}

module.exports = { sendExpertSms };
