const twilio = require('twilio');
const { EXPERTS } = require('./routing-config');

let client;
let fromNumber;

try {
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    fromNumber = process.env.TWILIO_FROM_NUMBER;
  }
} catch {
  // Twilio not configured — SMS will be skipped
}

async function sendExpertSms({ expertOwnerId, familyName, location, isReturningFamily }) {
  if (!client || !fromNumber) {
    console.log('[sms] Twilio not configured, skipping SMS');
    return;
  }

  const expert = EXPERTS[expertOwnerId];
  if (!expert || !expert.phone) {
    console.log(`[sms] No phone number for expert ${expertOwnerId}, skipping SMS`);
    return;
  }

  const prefix = isReturningFamily ? 'Returning family' : 'New lead';
  const body = `${prefix}: ${familyName} (${location}). Check your email for details.`;

  try {
    await client.messages.create({
      body,
      from: fromNumber,
      to: expert.phone,
    });
    console.log(`[sms] Text sent to ${expert.name} (${expert.phone})`);
  } catch (err) {
    console.error(`[sms] Failed to text ${expert.name}:`, err.message);
  }
}

module.exports = { sendExpertSms };
