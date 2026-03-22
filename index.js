const express = require('express');
const { normalizeFields, isDetailedForm, extractChildren } = require('./field-normalizer');
const hubspot = require('./hubspot');
const sb = require('./db');
const { routeLead } = require('./routing-engine');
const { sendExpertNotification, sendFamilyAcknowledgment, sendTimeoutFollowUp } = require('./notifications');
const { sendExpertSms } = require('./sms');
const { EXPERTS, CAMP_EXPERTS_OFFICE_ID } = require('./routing-config');

const app = express();
app.use(express.json());

// Health check
app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'Camp Experts Lead Routing Engine' });
});

// ── Main Webhook Endpoint ──
app.post('/api/webhook/webflow-lead', async (req, res) => {
  try {
    const rawPayload = req.body;
    console.log('[webhook] Received payload:', JSON.stringify(rawPayload));

    const normalized = normalizeFields(rawPayload);
    const email = (normalized.email || '').toLowerCase();

    if (!email) {
      console.warn('[webhook] No email in payload, skipping');
      return res.status(400).json({ error: 'Missing email' });
    }

    if (isDetailedForm(normalized)) {
      await handleDetailedForm(normalized, rawPayload);
    } else {
      await handleShortForm(normalized, rawPayload);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[webhook] Error:', err.message, err.stack);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Test Routing Endpoint (no HubSpot writes) ──
app.post('/api/test-routing', async (req, res) => {
  try {
    const normalized = normalizeFields(req.body);
    const children = extractChildren(normalized);
    const { routeLead: testRoute } = require('./routing-engine');
    const result = await testRoute(normalized);
    const expert = EXPERTS[result.expertId];

    res.json({
      input: {
        email: normalized.email,
        zip: normalized.zip,
        country: normalized.country,
        phone: normalized.phone,
        source_url: normalized.source_url,
        is_detailed: isDetailedForm(normalized),
        children_count: children.length,
      },
      routing: {
        expertId: result.expertId,
        expertName: expert?.name || 'Unknown',
        expertEmail: expert?.email || 'Unknown',
        rule: result.rule,
      },
    });
  } catch (err) {
    console.error('[test-routing] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Short Form Handler ──
async function handleShortForm(normalized, rawPayload) {
  const email = normalized.email.toLowerCase();
  console.log(`[short-form] Processing for ${email}`);

  // Idempotency: skip if we already have a pending lead for this email within 6 hours
  const isDupe = await sb.isDuplicateShortForm(email);
  if (isDupe) {
    console.log(`[short-form] Duplicate within 6h for ${email}, skipping`);
    return;
  }

  // Search for existing contact in HubSpot
  let contact = await hubspot.searchContactByEmail(email);
  if (!contact && normalized.phone) {
    contact = await hubspot.searchContactByPhone(normalized.phone);
  }

  // Create contact if not found
  let contactId;
  if (!contact) {
    const created = await hubspot.createContact({
      firstName: normalized.first_name,
      lastName: normalized.last_name,
      email,
      phone: normalized.phone,
    });
    contactId = created.id;
    console.log(`[short-form] Created HubSpot contact ${contactId}`);
  } else {
    contactId = contact.id;
    console.log(`[short-form] Found existing HubSpot contact ${contactId}`);
  }

  // Insert pending lead
  const pendingLead = await sb.insertPendingLead({
    email,
    phone: normalized.phone,
    contactId,
    rawPayload,
  });
  console.log(`[short-form] Inserted pending lead ${pendingLead.id}`);

  // Start 10-minute timeout
  const pendingId = pendingLead.id;
  setTimeout(() => handleTimeout(pendingId, contactId, email, normalized), 4 * 60 * 1000);
  console.log(`[short-form] Started 4-minute timeout for ${email}`);
}

// ── Detailed Form Handler ──
async function handleDetailedForm(normalized, rawPayload) {
  const email = normalized.email.toLowerCase();
  console.log(`[detailed-form] Processing for ${email}`);

  // Look up pending lead
  const pendingLead = await sb.findPendingLeadByEmail(email);

  // Find or create contact in HubSpot
  let contact = await hubspot.searchContactByEmail(email);
  let contactId;

  if (!contact) {
    const created = await hubspot.createContact({
      firstName: normalized.first_name,
      lastName: normalized.last_name,
      email,
      phone: normalized.phone,
    });
    contactId = created.id;
    console.log(`[detailed-form] Created HubSpot contact ${contactId}`);
  } else {
    contactId = contact.id;
    console.log(`[detailed-form] Found existing HubSpot contact ${contactId}`);
  }

  // Update contact with location details
  const updateProps = {};
  if (normalized.zip) updateProps.zip = normalized.zip;
  if (normalized.country) updateProps.country = normalized.country;
  if (normalized.address) updateProps.address = normalized.address;
  if (normalized.city) updateProps.city = normalized.city;

  if (Object.keys(updateProps).length > 0) {
    await hubspot.updateContact(contactId, updateProps);
    console.log(`[detailed-form] Updated contact ${contactId} with location data`);
  }

  // Create child records
  const children = extractChildren(normalized);
  for (const child of children) {
    try {
      const created = await hubspot.createChild({
        firstName: child.first_name,
        lastName: child.last_name,
        birthDate: child.birth_date,
        gender: child.gender,
        interestedYear: child.interested_year,
        budget: child.budget_per_week,
        sessionLength: child.session_length,
      });
      await hubspot.associateChildWithContact(created.id, contactId);
      console.log(`[detailed-form] Created and associated child ${created.id}`);
    } catch (err) {
      console.error(`[detailed-form] Error creating child record:`, err.message);
    }
  }

  // Run routing engine
  const routingResult = await routeLead(normalized);
  console.log(`[detailed-form] Routing result:`, routingResult);

  const isReturningFamily = routingResult.rule.startsWith('existing_family');
  const familyName = `${normalized.first_name || ''} ${normalized.last_name || ''}`.trim() || email;
  const expert = EXPERTS[routingResult.expertId];

  // Set contact owner (must happen before deal)
  await hubspot.setContactOwner(contactId, routingResult.expertId);

  // Speed to lead: fire notification, deal creation, logging, and family acknowledgment in parallel
  await Promise.all([
    // Expert notification (the conversion-critical moment)
    sendExpertNotification({
      expertOwnerId: routingResult.expertId,
      lead: normalized,
      children,
      isReturningFamily,
    }),

    // SMS alert to expert's phone
    sendExpertSms({
      expertOwnerId: routingResult.expertId,
      familyName,
      location: normalized.zip || normalized.country || 'Unknown',
      isReturningFamily,
    }),

    // Family acknowledgment — let them know their expert by name
    sendFamilyAcknowledgment({
      email,
      firstName: normalized.first_name,
      expertName: expert?.name || 'Camp Experts',
    }),

    // Create deal
    hubspot.createDeal({
      contactId,
      ownerId: routingResult.expertId,
      familyName,
    }).then(() => console.log(`[detailed-form] Created deal for ${familyName}`)),

    // Log assignment
    sb.logAssignment({
      contactId,
      contactEmail: email,
      contactName: familyName,
      expertOwnerId: routingResult.expertId,
      expertName: expert?.name || 'Unknown',
      routingRule: routingResult.rule,
      zip: normalized.zip,
      country: normalized.country,
      phone: normalized.phone,
      rawPayload,
    }),

    // Clean up pending lead if it exists
    pendingLead
      ? sb.deletePendingLead(pendingLead.id).then(() =>
          console.log(`[detailed-form] Deleted pending lead ${pendingLead.id}`))
      : Promise.resolve(),
  ]);

  console.log(`[detailed-form] Complete: ${familyName} → ${expert?.name || routingResult.expertId}`);
}

// ── 4-Minute Timeout Handler ──
async function handleTimeout(pendingLeadId, contactId, email, normalized) {
  try {
    // Check if the pending lead still exists (not yet processed by detailed form)
    const pending = await sb.findPendingLeadByEmail(email);
    if (!pending || pending.id !== pendingLeadId) {
      console.log(`[timeout] Pending lead ${pendingLeadId} already processed, skipping`);
      return;
    }

    console.log(`[timeout] No detailed form for ${email}, assigning to office`);

    // Assign to Camp Experts Office and notify them
    const expert = EXPERTS[CAMP_EXPERTS_OFFICE_ID];

    await Promise.all([
      hubspot.setContactOwner(contactId, CAMP_EXPERTS_OFFICE_ID),

      // Notify the office so they can follow up manually
      sendExpertNotification({
        expertOwnerId: CAMP_EXPERTS_OFFICE_ID,
        lead: normalized,
        children: [],
      }),

      // Text the office
      sendExpertSms({
        expertOwnerId: CAMP_EXPERTS_OFFICE_ID,
        familyName: `${normalized.first_name || ''} ${normalized.last_name || ''}`.trim() || email,
        location: normalized.zip || normalized.country || 'Unknown',
      }),

      sb.logAssignment({
        contactId,
        contactEmail: email,
        contactName: `${normalized.first_name || ''} ${normalized.last_name || ''}`.trim(),
        expertOwnerId: CAMP_EXPERTS_OFFICE_ID,
        expertName: expert?.name || 'Camp Experts Office',
        routingRule: 'timeout_fallback',
        phone: normalized.phone,
        rawPayload: normalized,
      }),

      sb.deletePendingLead(pendingLeadId),
    ]);

    console.log(`[timeout] Assigned ${email} to Camp Experts Office (timeout)`);

    // Schedule follow-up email to the family 6 minutes after timeout
    setTimeout(() => {
      sendTimeoutFollowUp({
        email,
        firstName: normalized.first_name,
      }).catch(err => console.error(`[timeout-followup] Error for ${email}:`, err.message));
    }, 6 * 60 * 1000);
    console.log(`[timeout] Scheduled follow-up email to ${email} in 6 minutes`);
  } catch (err) {
    console.error(`[timeout] Error handling timeout for ${email}:`, err.message);
  }
}

// ── Periodic cleanup: check for expired pending leads ──
// Runs every 5 minutes as a safety net in case a setTimeout was lost (e.g., server restart)
setInterval(async () => {
  try {
    const expired = await sb.getExpiredPendingLeads(4);
    for (const lead of expired) {
      console.log(`[cleanup] Found expired pending lead: ${lead.email}`);
      try {
        if (lead.contact_id) {
          await hubspot.setContactOwner(lead.contact_id, CAMP_EXPERTS_OFFICE_ID);
        }
        const expert = EXPERTS[CAMP_EXPERTS_OFFICE_ID];
        await sb.logAssignment({
          contactId: lead.contact_id || 'unknown',
          contactEmail: lead.email,
          contactName: null,
          expertOwnerId: CAMP_EXPERTS_OFFICE_ID,
          expertName: expert?.name || 'Camp Experts Office',
          routingRule: 'timeout_fallback_cleanup',
          phone: lead.phone,
          rawPayload: lead.raw_payload,
        });
        await sb.deletePendingLead(lead.id);
        // Schedule follow-up email to the family 6 minutes later
        const leadEmail = lead.email;
        const leadFirstName = lead.raw_payload?.first_name || lead.raw_payload?.First_Name;
        setTimeout(() => {
          sendTimeoutFollowUp({ email: leadEmail, firstName: leadFirstName })
            .catch(err => console.error(`[cleanup-followup] Error for ${leadEmail}:`, err.message));
        }, 6 * 60 * 1000);
        console.log(`[cleanup] Processed expired lead ${lead.email}`);
      } catch (err) {
        console.error(`[cleanup] Error processing expired lead ${lead.email}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[cleanup] Error checking expired leads:', err.message);
  }
}, 5 * 60 * 1000);

// ── Start Server ──
const PORT = process.env.PORT || 5000;

async function start() {
  await sb.initDatabase();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Camp Experts Lead Routing Engine running on port ${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
