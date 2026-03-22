const express = require('express');
const { normalizeFields, isDetailedForm, extractChildren, mapBudget, extractLeadSource, normalizeCountry } = require('./field-normalizer');

function isDomesticCountry(c) {
  return !c || ['Usa', 'USA', 'Us', 'us', 'usa'].includes(c);
}
const hubspot = require('./hubspot');
const sb = require('./db');
const { routeLead } = require('./routing-engine');
const { sendExpertNotification, sendFamilyAcknowledgment, sendTimeoutFollowUp, sendInternalFormNotification } = require('./notifications');
const { sendExpertSms } = require('./sms');
const { EXPERTS, CAMP_EXPERTS_OFFICE_ID } = require('./routing-config');

const app = express();
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'Camp Experts Lead Routing Engine' });
});

app.post('/api/webhook/webflow-lead', async (req, res) => {
  try {
    const rawPayload = req.body;
    console.log('[webhook] Received payload:', JSON.stringify(rawPayload));

    const formData = rawPayload.data || rawPayload;
    const normalized = normalizeFields(formData);
    if (normalized.country) normalized.country = normalizeCountry(normalized.country);
    const email = (normalized.email || '').toLowerCase();

    if (!email) {
      console.warn('[webhook] No email in payload, skipping');
      return res.status(400).json({ error: 'Missing email' });
    }

    if (isDetailedForm(normalized)) {
      await handleDetailedForm(normalized, formData);
    } else {
      await handleShortForm(normalized, formData);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[webhook] Error:', err.message, err.stack);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const INTERNAL_FORM_NAMES = [
  'Camp Experts Team Application',
  'Contact 6 Form',
  'Email Form',
  'Email Form 2',
];

app.post('/api/webhook/webflow-internal', async (req, res) => {
  try {
    const payload = req.body;
    const formName = payload._formName || payload.formName || payload['Form Name'] || 'Unknown Form';
    console.log(`[internal] Received "${formName}" submission`);

    await sendInternalFormNotification({ formName, payload });

    res.json({ success: true });
  } catch (err) {
    console.error('[internal] Error:', err.message, err.stack);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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

function calculateAge(birthDateStr) {
  const birth = new Date(birthDateStr);
  if (isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

async function handleShortForm(normalized, rawPayload) {
  const email = normalized.email.toLowerCase();
  console.log(`[short-form] Processing for ${email}`);

  const isDupe = await sb.isDuplicateShortForm(email);
  if (isDupe) {
    console.log(`[short-form] Duplicate within 6h for ${email}, skipping`);
    return;
  }

  let contact = await hubspot.searchContactByEmail(email);
  if (!contact && normalized.phone) {
    contact = await hubspot.searchContactByPhone(normalized.phone);
  }

  let contactId;
  if (!contact) {
    const created = await hubspot.createContact({
      firstName: normalized.first_name,
      lastName: normalized.last_name,
      email,
      phone: normalized.phone,
      ownerId: CAMP_EXPERTS_OFFICE_ID,
    });
    contactId = created.id;
    console.log(`[short-form] Created HubSpot contact ${contactId}`);
  } else {
    contactId = contact.id;
    console.log(`[short-form] Found existing HubSpot contact ${contactId}`);
  }

  const familyName = `${normalized.first_name || ''} ${normalized.last_name || ''}`.trim() || email;
  let householdRecordId;
  try {
    const existingHousehold = await hubspot.searchHouseholdByEmail(email);
    if (existingHousehold) {
      householdRecordId = existingHousehold.id;
      console.log(`[short-form] Found existing Household ${householdRecordId}`);
    } else {
      const householdId = `WF_${Date.now()}`;
      const household = await hubspot.createHousehold({
        householdId,
        familyName,
        email,
        phone: normalized.phone,
        ownerId: CAMP_EXPERTS_OFFICE_ID,
      });
      householdRecordId = household.id;
      console.log(`[short-form] Created Household ${householdRecordId}`);
    }

    await hubspot.associateContactWithHousehold(contactId, householdRecordId);
    console.log(`[short-form] Associated Contact ${contactId} ↔ Household ${householdRecordId}`);
  } catch (err) {
    console.error(`[short-form] Error creating household:`, err.message);
  }

  const pendingPayload = {
    ...rawPayload,
    _contactId: contactId,
    _householdRecordId: householdRecordId || null,
  };

  const pendingLead = await sb.insertPendingLead({
    email,
    phone: normalized.phone,
    contactId,
    rawPayload: pendingPayload,
  });
  console.log(`[short-form] Inserted pending lead ${pendingLead.id}`);

  const pendingId = pendingLead.id;
  setTimeout(() => handleTimeout(pendingId, contactId, email, normalized), 4 * 60 * 1000);
  console.log(`[short-form] Started 4-minute timeout for ${email}`);
}

async function handleDetailedForm(normalized, rawPayload) {
  const email = normalized.email.toLowerCase();
  console.log(`[detailed-form] Processing for ${email}`);

  const pendingLead = await sb.findPendingLeadByEmail(email);

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

  const children = extractChildren(normalized);
  const leadSource = extractLeadSource(normalized);

  const routingResult = await routeLead(normalized);
  console.log(`[detailed-form] Routing result:`, routingResult);

  const isReturningFamily = routingResult.rule.startsWith('existing_family');
  const familyName = `${normalized.first_name || ''} ${normalized.last_name || ''}`.trim() || email;
  const expert = EXPERTS[routingResult.expertId];

  let householdRecordId = pendingLead?.raw_payload?._householdRecordId || null;

  if (householdRecordId) {
    try {
      const hhUpdate = {
        zip: normalized.zip || undefined,
        num_children: children.length ? String(children.length) : undefined,
        hubspot_owner_id: routingResult.expertId,
      };
      if (!isDomesticCountry(normalized.country)) hhUpdate.state___country__if_int_l_ = normalized.country;
      await hubspot.updateHousehold(householdRecordId, hhUpdate);
      console.log(`[detailed-form] Updated Household ${householdRecordId}`);
    } catch (err) {
      console.error(`[detailed-form] Error updating household:`, err.message);
    }
  } else {
    try {
      const existingHousehold = await hubspot.searchHouseholdByEmail(email);
      if (existingHousehold) {
        householdRecordId = existingHousehold.id;
        console.log(`[detailed-form] Found existing Household ${householdRecordId}`);
        const hhUpdate2 = {
          zip: normalized.zip || undefined,
          num_children: children.length ? String(children.length) : undefined,
          hubspot_owner_id: routingResult.expertId,
        };
        if (!isDomesticCountry(normalized.country)) hhUpdate2.state___country__if_int_l_ = normalized.country;
        await hubspot.updateHousehold(householdRecordId, hhUpdate2);
      } else {
        const householdId = `WF_${Date.now()}`;
        const household = await hubspot.createHousehold({
          householdId,
          familyName,
          email,
          phone: normalized.phone,
          zip: normalized.zip,
          country: normalized.country,
          numChildren: children.length,
          ownerId: routingResult.expertId,
        });
        householdRecordId = household.id;
        console.log(`[detailed-form] Created Household ${householdRecordId}`);
      }
      await hubspot.associateContactWithHousehold(contactId, householdRecordId);
    } catch (err) {
      console.error(`[detailed-form] Error creating household:`, err.message);
    }
  }

  const updateProps = { hubspot_owner_id: routingResult.expertId };
  if (normalized.zip) updateProps.zip = normalized.zip;
  if (normalized.country) updateProps.country = normalized.country;
  if (normalized.address) updateProps.address = normalized.address;
  if (normalized.city) updateProps.city = normalized.city;

  await hubspot.updateContact(contactId, updateProps);
  console.log(`[detailed-form] Updated contact ${contactId} with owner and location`);

  const childDealPromises = children.map(async (child) => {
    try {
      const budget = child.budget_per_week || '';
      const age = child.birth_date ? calculateAge(child.birth_date) : null;
      const year = child.interested_year || new Date().getFullYear().toString();

      const created = await hubspot.createChild({
        firstName: child.first_name,
        lastName: child.last_name,
        birthDate: child.birth_date,
        gender: child.gender,
        interestedYear: child.interested_year,
        budget: budget,
        sessionLength: child.session_length,
        age: age,
        ownerId: routingResult.expertId,
      });
      console.log(`[detailed-form] Created child ${created.id}`);

      const assocPromises = [];
      assocPromises.push(hubspot.associateChildWithContact(created.id, contactId));
      if (householdRecordId) {
        assocPromises.push(hubspot.associateChildWithHousehold(created.id, householdRecordId));
      }
      await Promise.all(assocPromises);

      const dealName = `${child.first_name} ${child.last_name} | ${year}`;
      const deal = await hubspot.createDeal({
        contactId,
        ownerId: routingResult.expertId,
        dealName,
        householdId: householdRecordId || null,
        childId: created.id,
      });
      console.log(`[detailed-form] Created deal ${deal.id} for ${dealName}`);

      return { childId: created.id, dealId: deal.id };
    } catch (err) {
      console.error(`[detailed-form] Error creating child/deal for ${child.first_name}:`, err.message);
      return null;
    }
  });

  const childDealResults = await Promise.all(childDealPromises);

  await Promise.all([
    sendExpertNotification({
      expertOwnerId: routingResult.expertId,
      lead: normalized,
      children,
      isReturningFamily,
      leadSource,
    }),

    sendExpertSms({
      expertOwnerId: routingResult.expertId,
      familyName,
      location: normalized.zip || normalized.country || 'Unknown',
      isReturningFamily,
    }),

    sendFamilyAcknowledgment({
      email,
      firstName: normalized.first_name,
      expertName: expert?.name || 'Camp Experts',
    }),

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
      leadSource: leadSource.lead_source || null,
      leadSourceDetail: leadSource,
      rawPayload,
    }),

    pendingLead
      ? sb.deletePendingLead(pendingLead.id).then(() =>
          console.log(`[detailed-form] Deleted pending lead ${pendingLead.id}`))
      : Promise.resolve(),
  ]);

  console.log(`[detailed-form] Complete: ${familyName} → ${expert?.name || routingResult.expertId}`);
}

async function handleTimeout(pendingLeadId, contactId, email, normalized) {
  try {
    const pending = await sb.findPendingLeadByEmail(email);
    if (!pending || pending.id !== pendingLeadId) {
      console.log(`[timeout] Pending lead ${pendingLeadId} already processed, skipping`);
      return;
    }

    console.log(`[timeout] No detailed form for ${email}, assigning to office`);

    const expert = EXPERTS[CAMP_EXPERTS_OFFICE_ID];
    const familyName = `${normalized.first_name || ''} ${normalized.last_name || ''}`.trim() || email;
    const householdRecordId = pending.raw_payload?._householdRecordId;

    const promises = [
      hubspot.setContactOwner(contactId, CAMP_EXPERTS_OFFICE_ID),

      sendExpertNotification({
        expertOwnerId: CAMP_EXPERTS_OFFICE_ID,
        lead: normalized,
        children: [],
      }),

      sendExpertSms({
        expertOwnerId: CAMP_EXPERTS_OFFICE_ID,
        familyName,
        location: normalized.zip || normalized.country || 'Unknown',
      }),

      sb.logAssignment({
        contactId,
        contactEmail: email,
        contactName: familyName,
        expertOwnerId: CAMP_EXPERTS_OFFICE_ID,
        expertName: expert?.name || 'Camp Experts Office',
        routingRule: 'timeout_fallback',
        phone: normalized.phone,
        rawPayload: normalized,
      }),

      sb.deletePendingLead(pendingLeadId),
    ];

    if (householdRecordId) {
      promises.push(
        hubspot.updateHousehold(householdRecordId, { hubspot_owner_id: CAMP_EXPERTS_OFFICE_ID })
          .catch(err => console.error(`[timeout] Failed to update household owner:`, err.message))
      );
    }

    await Promise.all(promises);

    console.log(`[timeout] Assigned ${email} to Camp Experts Office (timeout)`);

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
