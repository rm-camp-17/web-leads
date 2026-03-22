const { Resend } = require('resend');
const Anthropic = require('@anthropic-ai/sdk');
const { EXPERTS } = require('./routing-config');

async function getResendCredentials() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? 'depl ' + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken || !hostname) {
    throw new Error('Replit connector token not found');
  }

  const res = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=resend',
    {
      headers: {
        'Accept': 'application/json',
        'X-Replit-Token': xReplitToken,
      },
    }
  );

  if (!res.ok) {
    throw new Error(`Resend connector API returned ${res.status}`);
  }

  const data = await res.json();
  const connection = data.items?.[0];

  if (!connection || !connection.settings.api_key) {
    throw new Error('Resend not connected');
  }
  return { apiKey: connection.settings.api_key, fromEmail: connection.settings.from_email };
}

async function getResendClient() {
  const { apiKey } = await getResendCredentials();
  return new Resend(apiKey);
}

let anthropic;
try {
  if (process.env.ANTHROPIC_API_KEY) {
    anthropic = new Anthropic();
  }
} catch {
}

async function generatePersonalNote(lead, children) {
  if (!anthropic) {
    return lead.description ? lead.description.trim() : null;
  }

  // Build a comprehensive summary of all lead data for the AI
  const parts = [];

  if (lead.zip) parts.push(`Location: ZIP ${lead.zip}`);
  if (lead.country && lead.country.toLowerCase() !== 'united states') parts.push(`Country: ${lead.country}`);
  if (lead.city) parts.push(`City: ${lead.city}`);

  if (children && children.length > 0) {
    for (const child of children) {
      const childParts = [];
      if (child.first_name) childParts.push(child.first_name);
      if (child.birth_date) {
        const age = calculateAge(child.birth_date);
        childParts.push(`age ${age}`);
      }
      if (child.gender) childParts.push(child.gender.toLowerCase());
      if (child.budget_per_week) childParts.push(`budget: ${child.budget_per_week}/week`);
      if (child.session_length) childParts.push(`wants ${child.session_length}`);
      if (child.interested_year) childParts.push(`for ${child.interested_year}`);
      parts.push(`Child: ${childParts.join(', ')}`);
    }
  }

  if (lead.description && lead.description.trim()) {
    parts.push(`Parent notes: "${lead.description.trim()}"`);
  }

  if (parts.length === 0) return null;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `You are writing a brief internal briefing for a camp placement expert. Here is everything we know about a new family inquiry:

${parts.join('\n')}

Write 2-3 short sentences that give the expert a quick, actionable overview of this family's needs. Include the most important details: child age/gender, what they're looking for, budget level, session preference, and any notable concerns or interests from the parent's notes. Be warm but professional. Do not start with "The family" or "This parent" — start directly with what matters. Keep it under 60 words.`,
      }],
    });
    return response.content[0]?.text || (lead.description ? lead.description.trim() : null);
  } catch (err) {
    console.error('AI personalization failed, using raw description:', err.message);
    return lead.description ? lead.description.trim() : null;
  }
}

async function sendExpertNotification({ expertOwnerId, lead, children, isReturningFamily, leadSource }) {
  const expert = EXPERTS[expertOwnerId];
  if (!expert) {
    console.error(`No expert found for owner ID: ${expertOwnerId}`);
    return;
  }

  const familyName = `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Unknown';
  const location = lead.zip || lead.country || 'Not provided';

  const personalNote = await generatePersonalNote(lead, children);

  let childDetails = 'None provided';
  if (children && children.length > 0) {
    childDetails = children.map((child, i) => {
      const age = child.birth_date ? calculateAge(child.birth_date) : 'Unknown';
      return [
        `  Child ${i + 1}: ${child.first_name} ${child.last_name}`,
        `    Age: ${age} (DOB: ${child.birth_date || 'N/A'})`,
        `    Gender: ${child.gender || 'N/A'}`,
        `    Interested Year: ${child.interested_year || 'N/A'}`,
        `    Budget/Week: ${child.budget_per_week || 'N/A'}`,
        `    Session Length: ${child.session_length || 'N/A'}`,
      ].join('\n');
    }).join('\n\n');
  }

  // Build source attribution line
  let sourceInfo = '';
  if (leadSource && leadSource.lead_source) {
    sourceInfo = `\nSource: ${leadSource.lead_source}`;
    if (leadSource.utm_campaign) sourceInfo += ` (campaign: ${leadSource.utm_campaign})`;
  } else if (lead.source_url) {
    sourceInfo = `\nSource Page: ${lead.source_url}`;
  }
  const returningLabel = isReturningFamily ? ' (Returning Family)' : '';

  const subjectPrefix = isReturningFamily ? 'Returning Family' : 'New Lead';
  const subject = `${subjectPrefix}: ${familyName} - ${location}`;

  const text = `${subjectPrefix} Assigned to You${returningLabel}

Family: ${familyName}
Email: ${lead.email || 'N/A'}
Phone: ${lead.phone || 'N/A'}
Zip: ${lead.zip || 'N/A'}
Country: ${lead.country || 'N/A'}
${sourceInfo}

${personalNote ? `Quick Summary: ${personalNote}\n` : ''}
Children:
${childDetails}

Parent Notes:
${lead.description || 'None provided'}
`;

  const html = `
${isReturningFamily ? '<p style="background:#fff3cd;padding:8px 12px;border-radius:4px;font-weight:bold;color:#856404;">Returning Family — previously worked with you</p>' : ''}
<h2>${esc(subjectPrefix)} Assigned to You</h2>

${personalNote ? `
<div style="background:#e8f4f8;padding:10px 14px;border-radius:6px;margin-bottom:16px;border-left:3px solid #2b6cb0;">
  <strong>At a Glance:</strong> ${esc(personalNote)}
</div>
` : ''}

<table style="border-collapse:collapse;font-family:Arial,sans-serif;">
  <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Family:</td><td>${esc(familyName)}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Email:</td><td><a href="mailto:${esc(lead.email || '')}">${esc(lead.email || 'N/A')}</a></td></tr>
  <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Phone:</td><td>${esc(lead.phone || 'N/A')}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Zip:</td><td>${esc(lead.zip || 'N/A')}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Country:</td><td>${esc(lead.country || 'N/A')}</td></tr>
  ${leadSource && leadSource.lead_source
    ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Source:</td><td>${esc(leadSource.lead_source)}${leadSource.utm_campaign ? ` (campaign: ${esc(leadSource.utm_campaign)})` : ''}</td></tr>`
    : lead.source_url
      ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Source Page:</td><td>${esc(lead.source_url)}</td></tr>`
      : ''}
</table>

${children && children.length > 0 ? `
<h3>Children</h3>
${children.map((child, i) => {
  const age = child.birth_date ? calculateAge(child.birth_date) : 'Unknown';
  return `
<table style="border-collapse:collapse;font-family:Arial,sans-serif;margin-bottom:12px;">
  <tr><td colspan="2" style="font-weight:bold;padding:4px 0;">Child ${i + 1}: ${esc(child.first_name)} ${esc(child.last_name)}</td></tr>
  <tr><td style="padding:2px 12px 2px 16px;">Age:</td><td>${age} (DOB: ${esc(child.birth_date || 'N/A')})</td></tr>
  <tr><td style="padding:2px 12px 2px 16px;">Gender:</td><td>${esc(child.gender || 'N/A')}</td></tr>
  <tr><td style="padding:2px 12px 2px 16px;">Interested Year:</td><td>${esc(child.interested_year || 'N/A')}</td></tr>
  <tr><td style="padding:2px 12px 2px 16px;">Budget/Week:</td><td>${esc(child.budget_per_week || 'N/A')}</td></tr>
  <tr><td style="padding:2px 12px 2px 16px;">Session Length:</td><td>${esc(child.session_length || 'N/A')}</td></tr>
</table>`;
}).join('')}
` : '<p><em>No child details provided.</em></p>'}

<h3>Parent Notes</h3>
<p>${esc(lead.description || 'None provided')}</p>
`;

  try {
    const resend = await getResendClient();
    await resend.emails.send({
      from: 'Camp Experts <office@campexperts.com>',
      to: expert.email,
      subject,
      text,
      html,
    });
    console.log(`Notification sent to ${expert.name} (${expert.email})`);
  } catch (err) {
    console.error(`Failed to send notification to ${expert.email}:`, err.message);
  }
}

async function sendFamilyAcknowledgment({ email, firstName, expertName }) {
  const name = firstName || 'there';

  const html = `
<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#333;">
  <p>Hi ${esc(name)},</p>

  <p>Thank you so much for reaching out to us. We're excited to help your family find the perfect camp experience.</p>

  <p>Your dedicated Camp Expert, <strong>${esc(expertName)}</strong>, has received your information and will be reaching out to you shortly. ${esc(expertName.split(' ')[0])} will take the time to understand your family's needs and help match you with programs that are the right fit.</p>

  <p>In the meantime, feel free to reply to this email if you have any questions at all.</p>

  <p>
    Warm regards,<br/>
    The Camp Experts Team
  </p>
</div>
`;

  const text = `Hi ${name},

Thank you so much for reaching out to us. We're excited to help your family find the perfect camp experience.

Your dedicated Camp Expert, ${expertName}, has received your information and will be reaching out to you shortly. ${expertName.split(' ')[0]} will take the time to understand your family's needs and help match you with programs that are the right fit.

In the meantime, feel free to reply to this email if you have any questions at all.

Warm regards,
The Camp Experts Team`;

  try {
    const resend = await getResendClient();
    await resend.emails.send({
      from: 'Camp Experts <hey@campexperts.com>',
      to: email,
      subject: `We've got you covered, ${name}`,
      text,
      html,
    });
    console.log(`Family acknowledgment sent to ${email}`);
  } catch (err) {
    console.error(`Failed to send family acknowledgment to ${email}:`, err.message);
  }
}

async function sendTimeoutFollowUp({ email, firstName }) {
  const name = firstName || 'there';

  const html = `
<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#333;">
  <p>Hi ${esc(name)},</p>

  <p>We noticed you started reaching out to us and wanted to make sure everything is okay. Finding the right camp is one of those decisions that can feel overwhelming, but it doesn't have to be.</p>

  <p>Camp is such a special experience for families. Our experts are all parents themselves who have been through this process, and they genuinely love helping other families navigate it. There's nothing quite like watching your child come home from a summer that changed them for the better.</p>

  <p>If you had any trouble with the form, or if you'd just prefer to chat, we're here. You can reply to this email or give us a call — no pressure at all. We'd love the chance to help.</p>

  <p>
    Warmly,<br/>
    The Camp Experts Team
  </p>
</div>
`;

  const text = `Hi ${name},

We noticed you started reaching out to us and wanted to make sure everything is okay. Finding the right camp is one of those decisions that can feel overwhelming, but it doesn't have to be.

Camp is such a special experience for families. Our experts are all parents themselves who have been through this process, and they genuinely love helping other families navigate it. There's nothing quite like watching your child come home from a summer that changed them for the better.

If you had any trouble with the form, or if you'd just prefer to chat, we're here. You can reply to this email or give us a call — no pressure at all. We'd love the chance to help.

Warmly,
The Camp Experts Team`;

  try {
    const resend = await getResendClient();
    await resend.emails.send({
      from: 'Camp Experts <hey@campexperts.com>',
      to: email,
      subject: `We're here whenever you're ready`,
      text,
      html,
    });
    console.log(`Timeout follow-up sent to ${email}`);
  } catch (err) {
    console.error(`Failed to send timeout follow-up to ${email}:`, err.message);
  }
}

function calculateAge(birthDateStr) {
  const birth = new Date(birthDateStr);
  if (isNaN(birth.getTime())) return 'Unknown';
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = {
  sendExpertNotification,
  sendFamilyAcknowledgment,
  sendTimeoutFollowUp,
};
