const { Resend } = require('resend');
const { EXPERTS } = require('./routing-config');

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendExpertNotification({ expertOwnerId, lead, children }) {
  const expert = EXPERTS[expertOwnerId];
  if (!expert) {
    console.error(`No expert found for owner ID: ${expertOwnerId}`);
    return;
  }

  const familyName = `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Unknown';
  const location = lead.zip || lead.country || 'Not provided';

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

  const sourceInfo = lead.source_url ? `\nSource Page: ${lead.source_url}` : '';

  const text = `New Lead Assigned to You

Family: ${familyName}
Email: ${lead.email || 'N/A'}
Phone: ${lead.phone || 'N/A'}
Zip: ${lead.zip || 'N/A'}
Country: ${lead.country || 'N/A'}
${sourceInfo}

Children:
${childDetails}

Parent Notes:
${lead.description || 'None provided'}
`;

  const html = `
<h2>New Lead Assigned to You</h2>
<table style="border-collapse:collapse;font-family:Arial,sans-serif;">
  <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Family:</td><td>${esc(familyName)}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Email:</td><td><a href="mailto:${esc(lead.email || '')}">${esc(lead.email || 'N/A')}</a></td></tr>
  <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Phone:</td><td>${esc(lead.phone || 'N/A')}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Zip:</td><td>${esc(lead.zip || 'N/A')}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Country:</td><td>${esc(lead.country || 'N/A')}</td></tr>
  ${lead.source_url ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Source Page:</td><td>${esc(lead.source_url)}</td></tr>` : ''}
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
    await resend.emails.send({
      from: 'Camp Experts <office@campexperts.com>',
      to: expert.email,
      subject: `New Lead: ${familyName} - ${location}`,
      text,
      html,
    });
    console.log(`Notification sent to ${expert.name} (${expert.email})`);
  } catch (err) {
    console.error(`Failed to send notification to ${expert.email}:`, err.message);
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

module.exports = { sendExpertNotification };
