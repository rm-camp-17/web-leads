const cron = require('node-cron');
const Anthropic = require('@anthropic-ai/sdk');
const sb = require('./db');
const { getResendClient } = require('./notifications');

const RILEY_EMAIL = 'riley@campexperts.com';

let anthropic;
try {
  if (process.env.ANTHROPIC_API_KEY) {
    anthropic = new Anthropic();
  }
} catch {}

async function summarizeErrors(errors) {
  if (!anthropic || errors.length === 0) return null;

  const errorLines = errors.map((e, i) => {
    const ts = new Date(e.created_at).toLocaleString('en-US', { timeZone: 'America/New_York' });
    let ctx = e.context ? { ...e.context } : {};
    if (ctx.email) ctx.email = ctx.email.replace(/^(.{2}).*@/, '$1***@');
    if (ctx.stack) delete ctx.stack;
    const ctxStr = Object.keys(ctx).length > 0 ? JSON.stringify(ctx) : 'no additional context';
    return `${i + 1}. [${ts}] Source: ${e.source} | Error: ${e.error_message} | Context: ${ctxStr}`;
  }).join('\n');

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `You are summarizing errors from a camp placement lead routing system for a non-technical business owner named Riley. The system receives family inquiry forms from a website, creates records in HubSpot (contacts, households, children, deals), routes leads to camp experts, and sends notification emails and SMS messages.

Here are the errors that occurred:

${errorLines}

Write a brief, plain-language summary explaining:
1. How many errors occurred and what categories they fall into
2. What each error means in practical terms (e.g., "A lead from Jane Doe failed to create a child record in HubSpot, which means their inquiry wasn't fully processed")
3. Whether any families might need manual follow-up
4. Any patterns you notice (e.g., same type of error repeating)

Keep it concise and actionable. Use bullet points. Do not use technical jargon.`,
      }],
    });
    return response.content[0]?.text || null;
  } catch (err) {
    console.error('[error-monitor] AI summarization failed:', err.message);
    return null;
  }
}

function buildErrorReportHtml(errors, aiSummary) {
  const errorRows = errors.map(e => {
    const ts = new Date(e.created_at).toLocaleString('en-US', { timeZone: 'America/New_York' });
    const ctx = e.context || {};
    const contextStr = ctx.email || ctx.familyName || ctx.formName || '';
    return `<tr>
      <td style="padding:6px 10px;border:1px solid #ddd;">${esc(ts)}</td>
      <td style="padding:6px 10px;border:1px solid #ddd;">${esc(e.source)}</td>
      <td style="padding:6px 10px;border:1px solid #ddd;">${esc(e.error_message)}</td>
      <td style="padding:6px 10px;border:1px solid #ddd;">${esc(contextStr)}</td>
    </tr>`;
  }).join('');

  return `
<div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;color:#333;">
  <h2 style="color:#c0392b;">Web Leads System — Error Report</h2>
  <p><strong>${errors.length} error${errors.length !== 1 ? 's' : ''}</strong> detected since the last report.</p>

  ${aiSummary ? `
  <div style="background:#fef9e7;padding:12px 16px;border-radius:6px;margin-bottom:20px;border-left:4px solid #f39c12;">
    <strong>Summary:</strong>
    <div style="white-space:pre-wrap;margin-top:8px;">${esc(aiSummary)}</div>
  </div>
  ` : ''}

  <table style="border-collapse:collapse;width:100%;font-size:13px;">
    <thead>
      <tr style="background:#f5f5f5;">
        <th style="padding:6px 10px;border:1px solid #ddd;text-align:left;">Time (ET)</th>
        <th style="padding:6px 10px;border:1px solid #ddd;text-align:left;">Source</th>
        <th style="padding:6px 10px;border:1px solid #ddd;text-align:left;">Error</th>
        <th style="padding:6px 10px;border:1px solid #ddd;text-align:left;">Lead</th>
      </tr>
    </thead>
    <tbody>
      ${errorRows}
    </tbody>
  </table>

  <p style="color:#888;font-size:12px;margin-top:16px;">— Camp Experts Lead System (automated report)</p>
</div>`;
}

function buildAllClearHtml() {
  return `
<div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;color:#333;">
  <h2 style="color:#27ae60;">Web Leads System — All Clear</h2>
  <p>No errors detected since the last report. The web leads system is functioning correctly.</p>
  <p style="color:#888;font-size:12px;margin-top:16px;">— Camp Experts Lead System (automated report)</p>
</div>`;
}

async function runErrorReport() {
  const reportTime = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  console.log(`[error-monitor] Running scheduled error report at ${reportTime}`);

  try {
    const errors = await sb.getUnreportedErrors();

    let subject, html, text;

    if (errors.length > 0) {
      const errorsForAi = errors.slice(0, 50);
      const aiSummary = await summarizeErrors(errorsForAi);
      subject = `Web Leads Alert: ${errors.length} error${errors.length !== 1 ? 's' : ''} detected`;
      html = buildErrorReportHtml(errors, aiSummary);
      text = `${errors.length} error(s) detected.\n\n${aiSummary || ''}\n\nErrors:\n${errors.map(e => `- [${e.source}] ${e.error_message}`).join('\n')}`;
    } else {
      subject = 'Web Leads Status: All Clear';
      html = buildAllClearHtml();
      text = 'No errors detected since the last report. The web leads system is functioning correctly.';
    }

    const resend = await getResendClient();
    await resend.emails.send({
      from: 'Camp Experts System <office@connections.campexpert.com>',
      to: RILEY_EMAIL,
      subject,
      html,
      text,
    });

    console.log(`[error-monitor] Report sent to ${RILEY_EMAIL} (${errors.length} errors)`);

    if (errors.length > 0) {
      await sb.markErrorsReported(errors.map(e => e.id));
      console.log(`[error-monitor] Marked ${errors.length} errors as reported`);
    }
  } catch (err) {
    console.error('[error-monitor] Failed to send error report:', err.message);
  }
}

function startErrorMonitoring() {
  cron.schedule('0 9 * * *', () => {
    runErrorReport().catch(err => console.error('[error-monitor] 9am report failed:', err.message));
  }, { timezone: 'America/New_York' });

  cron.schedule('0 17 * * *', () => {
    runErrorReport().catch(err => console.error('[error-monitor] 5pm report failed:', err.message));
  }, { timezone: 'America/New_York' });

  console.log('[error-monitor] Scheduled error reports at 9:00 AM and 5:00 PM ET daily');
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { startErrorMonitoring, runErrorReport };
