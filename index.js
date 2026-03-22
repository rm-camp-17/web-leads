const express = require('express');
const { normalizeFields, isDetailedForm, extractChildren, mapBudget } = require('./field-normalizer');
const hubspot = require('./hubspot');
const db = require('./db');
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
    const result = await routeLead(normalized);
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
// Short form has only: first_name, last_name, email, phone
// Creates: Household + Contact + Contact↔Household association
// Does NOT create children or deals (no child data available)
async function handleShortForm(normalized, rawPayload) {
  const email = normalized.email.toLowerCase();
  console.log(`[short-form] Processing for ${email}`);

  // Idempotency: skip if we already have a pending lead for this email within 6 hours
  const isDupe = await db.isDuplicateShortForm(email);
  if (isDupe) {
    console.log(`[short-form] Duplicate within 6h for ${email}, skipping`);
    return;
  }

  const lastName = normalized.last_name || '';
  const ownerId = CAMP_EXPERTS_OFFICE_ID; // Short form → office until detailed form arrives

  // Step 1: Search for existing household by email/phone
  let household = await hubspot.searchHouseholdByEmailOrPhone(email, normalized.phone);
  let householdId;       // Our internal WF_ ID
  let householdRecordId; // HubSpot record ID

  if (household) {
    householdId = household.properties?.householdid;
    householdRecordId = household.id;
    console.log(`[short-form] Found existing household ${householdRecordId} (${householdId})`);
  } else {
    householdId = `WF_${Date.now()}`;
    const created = await hubspot.createHousehold({
      householdId,
      lastName,
      email,
      phone: normalized.phone,
      numChildren: null,
      country: null,
      zip: null,
      ownerId,
    });
    householdRecordId = created.id;
    console.log(`[short-form] Created household ${householdRecordId} (${householdId})`);
  }

  // Step 2: Create or find contact
  const contactId_gen = `WF_${householdId}_P1`;
  const { data: contactData, isNew: contactIsNew } = await hubspot.createContact({
    firstName: normalized.first_name,
    lastName,
    email,
    phone: normalized.phone,
    contactId: contactId_gen,
    familyId: householdId,
    ownerId,
  });
  const contactId = contactData.id;

  if (contactIsNew) {
    console.log(`[short-form] Created contact ${contactId}`);
  } else {
    console.log(`[short-form] Found existing contact ${contactId} (409 conflict)`);
    // Update with latest info
    await hubspot.updateContact(contactId, {
      firstname: normalized.first_name || undefined,
      lastname: lastName || undefined,
      phone: normalized.phone || undefined,
      family_id: householdId,
      hubspot_owner_id: ownerId,
    });
  }

  // Step 3: Associate Contact ↔ Household
  await hubspot.createAllAssociations({ contactId, householdRecordId });
  console.log(`[short-form] Created Contact↔Household association`);

  // Insert pending lead for timeout handling
  const pendingLead = await db.insertPendingLead({
    email,
    phone: normalized.phone,
    contactId,
    rawPayload: { ...rawPayload, _householdId: householdId, _householdRecordId: householdRecordId },
  });
  console.log(`[short-form] Inserted pending lead ${pendingLead.id}`);

  // Start 4-minute timeout
  setTimeout(() => handleTimeout(pendingLead.id, contactId, householdRecordId, email, normalized), 4 * 60 * 1000);
  console.log(`[short-form] Started 4-minute timeout for ${email}`);
}

// ── Detailed Form Handler ──
// Full flow: Household → Contact → Children → Deals → All 6 associations
async function handleDetailedForm(normalized, rawPayload) {
  const email = normalized.email.toLowerCase();
  console.log(`[detailed-form] Processing for ${email}`);

  // Look up pending lead (may have short form data including household IDs)
  const pendingLead = await db.findPendingLeadByEmail(email);

  const lastName = normalized.last_name || '';
  const children = extractChildren(normalized);

  // Run routing engine first so we have the expert ID for all records
  const routingResult = await routeLead(normalized);
  console.log(`[detailed-form] Routing result:`, routingResult);
  const ownerId = routingResult.expertId;
  const isReturningFamily = routingResult.rule.startsWith('existing_family');
  const familyName = `${normalized.first_name || ''} ${lastName}`.trim() || email;
  const expert = EXPERTS[ownerId];

  // ── STEP 2: Create/find Household ──
  let household = await hubspot.searchHouseholdByEmailOrPhone(email, normalized.phone);
  let householdId;
  let householdRecordId;

  if (household) {
    householdId = household.properties?.householdid;
    householdRecordId = household.id;
    console.log(`[detailed-form] Found existing household ${householdRecordId} (${householdId})`);
    // Update with full data from detailed form
    await hubspot.updateHousehold(householdRecordId, {
      num_children: String(children.length),
      'state___country__if_int_l_': normalized.country || undefined,
      zip: normalized.zip || undefined,
      hubspot_owner_id: ownerId,
    });
  } else {
    householdId = `WF_${Date.now()}`;
    const created = await hubspot.createHousehold({
      householdId,
      lastName,
      email,
      phone: normalized.phone,
      numChildren: children.length,
      country: normalized.country,
      zip: normalized.zip,
      ownerId,
    });
    householdRecordId = created.id;
    console.log(`[detailed-form] Created household ${householdRecordId} (${householdId})`);
  }

  // ── STEP 3: Create/find Contact ──
  const contactId_gen = `WF_${householdId}_P1`;
  const { data: contactData, isNew: contactIsNew } = await hubspot.createContact({
    firstName: normalized.first_name,
    lastName,
    email,
    phone: normalized.phone,
    contactId: contactId_gen,
    familyId: householdId,
    ownerId,
  });
  const contactId = contactData.id;

  if (contactIsNew) {
    console.log(`[detailed-form] Created contact ${contactId}`);
  } else {
    console.log(`[detailed-form] Found existing contact ${contactId} (409 conflict)`);
    await hubspot.updateContact(contactId, {
      firstname: normalized.first_name || undefined,
      lastname: lastName || undefined,
      phone: normalized.phone || undefined,
      mobilephone: normalized.phone || undefined,
      family_id: householdId,
      hubspot_owner_id: ownerId,
    });
  }

  // ── STEP 4 & 5: Create Children + Deals (one deal per child) ──
  const childRecords = [];
  const dealRecords = [];

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const childIdStr = `WF_${householdId}_C${i + 1}`;

    try {
      const childRecord = await hubspot.createChild({
        firstName: child.first_name,
        lastName: child.last_name,
        dob: child.birth_date,
        gender: child.gender,
        householdId,
        budget: mapBudget(child.budget_per_week),
        interests: normalized.description || '',
        childId: childIdStr,
        ownerId,
      });
      childRecords.push(childRecord);
      console.log(`[detailed-form] Created child ${childRecord.id} (${childIdStr})`);

      // Create one deal per child
      const dealRecord = await hubspot.createDeal({
        childFirstName: child.first_name,
        childLastName: child.last_name,
        year: child.interested_year,
        householdId,
        childId: childIdStr,
        ownerId,
      });
      dealRecords.push({ deal: dealRecord, childRecord });
      console.log(`[detailed-form] Created deal ${dealRecord.id} for ${child.first_name}`);
    } catch (err) {
      console.error(`[detailed-form] Error creating child/deal ${i + 1}:`, err.message);
    }
  }

  // ── STEP 6: Create all associations ──
  // Contact ↔ Household (always)
  await hubspot.createAllAssociations({ contactId, householdRecordId });

  // For each child+deal pair, create the remaining associations
  for (const { deal, childRecord } of dealRecords) {
    try {
      await hubspot.createAllAssociations({
        contactId,
        householdRecordId,
        childRecordId: childRecord.id,
        dealRecordId: deal.id,
      });
      console.log(`[detailed-form] Associations created for deal ${deal.id} / child ${childRecord.id}`);
    } catch (err) {
      console.error(`[detailed-form] Association error:`, err.message);
    }
  }

  // ── Notifications (speed to lead — fire in parallel) ──
  await Promise.all([
    sendExpertNotification({
      expertOwnerId: ownerId,
      lead: normalized,
      children,
      isReturningFamily,
    }),

    sendExpertSms({
      expertOwnerId: ownerId,
      familyName,
      location: normalized.zip || normalized.country || 'Unknown',
      isReturningFamily,
    }),

    sendFamilyAcknowledgment({
      email,
      firstName: normalized.first_name,
      expertName: expert?.name || 'Camp Experts',
    }),

    db.logAssignment({
      contactId,
      contactEmail: email,
      contactName: familyName,
      expertOwnerId: ownerId,
      expertName: expert?.name || 'Unknown',
      routingRule: routingResult.rule,
      zip: normalized.zip,
      country: normalized.country,
      phone: normalized.phone,
      rawPayload,
    }),

    // Clean up pending lead if it exists
    pendingLead
      ? db.deletePendingLead(pendingLead.id).then(() =>
          console.log(`[detailed-form] Deleted pending lead ${pendingLead.id}`))
      : Promise.resolve(),
  ]);

  console.log(`[detailed-form] Complete: ${familyName} → ${expert?.name || ownerId}`);
}

// ── 4-Minute Timeout Handler ──
async function handleTimeout(pendingLeadId, contactId, householdRecordId, email, normalized) {
  try {
    const pending = await db.findPendingLeadByEmail(email);
    if (!pending || pending.id !== pendingLeadId) {
      console.log(`[timeout] Pending lead ${pendingLeadId} already processed, skipping`);
      return;
    }

    console.log(`[timeout] No detailed form for ${email}, assigning to office`);
    const expert = EXPERTS[CAMP_EXPERTS_OFFICE_ID];

    // Update household owner to office
    if (householdRecordId) {
      await hubspot.updateHousehold(householdRecordId, {
        hubspot_owner_id: CAMP_EXPERTS_OFFICE_ID,
      }).catch(err => console.error(`[timeout] Failed to update household owner:`, err.message));
    }

    await Promise.all([
      hubspot.setContactOwner(contactId, CAMP_EXPERTS_OFFICE_ID),

      sendExpertNotification({
        expertOwnerId: CAMP_EXPERTS_OFFICE_ID,
        lead: normalized,
        children: [],
      }),

      sendExpertSms({
        expertOwnerId: CAMP_EXPERTS_OFFICE_ID,
        familyName: `${normalized.first_name || ''} ${normalized.last_name || ''}`.trim() || email,
        location: normalized.zip || normalized.country || 'Unknown',
      }),

      db.logAssignment({
        contactId,
        contactEmail: email,
        contactName: `${normalized.first_name || ''} ${normalized.last_name || ''}`.trim(),
        expertOwnerId: CAMP_EXPERTS_OFFICE_ID,
        expertName: expert?.name || 'Camp Experts Office',
        routingRule: 'timeout_fallback',
        phone: normalized.phone,
        rawPayload: normalized,
      }),

      db.deletePendingLead(pendingLeadId),
    ]);

    console.log(`[timeout] Assigned ${email} to Camp Experts Office (timeout)`);

    // Schedule follow-up email 6 minutes later
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
setInterval(async () => {
  try {
    const expired = await db.getExpiredPendingLeads(4);
    for (const lead of expired) {
      console.log(`[cleanup] Found expired pending lead: ${lead.email}`);
      try {
        if (lead.contact_id) {
          await hubspot.setContactOwner(lead.contact_id, CAMP_EXPERTS_OFFICE_ID);
        }
        // Update household owner if we stored the record ID
        const hhRecordId = lead.raw_payload?._householdRecordId;
        if (hhRecordId) {
          await hubspot.updateHousehold(hhRecordId, {
            hubspot_owner_id: CAMP_EXPERTS_OFFICE_ID,
          }).catch(err => console.error(`[cleanup] Failed to update household:`, err.message));
        }

        const expert = EXPERTS[CAMP_EXPERTS_OFFICE_ID];
        await db.logAssignment({
          contactId: lead.contact_id || 'unknown',
          contactEmail: lead.email,
          contactName: null,
          expertOwnerId: CAMP_EXPERTS_OFFICE_ID,
          expertName: expert?.name || 'Camp Experts Office',
          routingRule: 'timeout_fallback_cleanup',
          phone: lead.phone,
          rawPayload: lead.raw_payload,
        });
        await db.deletePendingLead(lead.id);

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
  await db.initDatabase();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Camp Experts Lead Routing Engine running on port ${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
