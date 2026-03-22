# Camp Experts Lead Routing Engine — System Documentation

## Overview

The Camp Experts Lead Routing Engine is a Node.js application that receives form submissions from the Camp Experts Webflow website, routes leads to the appropriate camp placement expert, creates records in HubSpot, and sends notifications to both the expert and the family.

---

## Architecture

```
Webflow Site (campexperts.com)
  │
  ├─ Lead Forms ──────────► POST /api/webhook/webflow-lead
  │   (Initial Request Info     │
  │    Step Form,               ├─ Short form? → Create Household + Contact → Start 4-min timer
  │    Request Info Form)       └─ Detailed form? → Route → Create all HubSpot records → Notify
  │
  └─ Internal Forms ──────► POST /api/webhook/webflow-internal
      (Team Application,        │
       Contact Form,            └─ Forward email to Riley (riley@campexperts.com)
       Email Forms)

                                  ┌─────────────────────────────┐
                                  │     External Services       │
                                  ├─────────────────────────────┤
                                  │ HubSpot  — CRM records      │
                                  │ Resend   — Email delivery    │
                                  │ Twilio   — SMS alerts        │
                                  │ Anthropic — AI routing/notes │
                                  │ PostgreSQL — State + logging │
                                  └─────────────────────────────┘
```

---

## Webflow Integration

### How Forms Connect to the Server

A JavaScript snippet in the Webflow site's **footer custom code** intercepts all form submissions. It runs in the browser's capturing phase (before Webflow's own handler), so Webflow's native form submission still works normally — data appears in the Webflow dashboard as usual.

The script:
1. Captures all form field values from the DOM
2. Adds attribution data (source URL, UTM params, referrer, form name)
3. Routes to the correct webhook endpoint based on the form's `data-name` attribute
4. Fires the webhook via `sendBeacon` (non-blocking, doesn't slow down the page)

### Form Routing Map

| Form Name | Endpoint | What Happens |
|---|---|---|
| Initial Request Info Step Form | `/api/webhook/webflow-lead` | Lead routing engine (short form) |
| Request Info Form | `/api/webhook/webflow-lead` | Lead routing engine (detailed form) |
| Camp Experts Test Form | `/api/webhook/webflow-lead` | Lead routing engine (testing) |
| Camp Experts Team Application | `/api/webhook/webflow-internal` | Email forwarded to Riley |
| Contact 6 Form | `/api/webhook/webflow-internal` | Email forwarded to Riley |
| Email Form / Email Form 2 | `/api/webhook/webflow-internal` | Email forwarded to Riley |
| Filter / Filters | Skipped | Not a submission form |

### UTM Attribution Tracking

The footer script captures UTM parameters from the visitor's landing URL and persists them in `sessionStorage` so they survive navigation between pages. When a form is submitted, the UTMs are included in the webhook payload.

**Example flow:**
```
Visitor clicks Google Ad → campexperts.com/get-started?utm_source=google&utm_medium=cpc
  → Script stores utm_source=google, utm_medium=cpc in sessionStorage
  → Visitor navigates to /request-info and fills out form
  → Webhook payload includes: { ..., utm_source: "google", utm_medium: "cpc", source_url: "https://campexperts.com/request-info" }
```

### Webflow Custom Code

**Head code** includes:
- CSS for font smoothing, slider transitions, and filter preloader
- HubSpot tracking script (`js.hs-scripts.com/50530609.js`) — tracks page views and ties website activity to HubSpot contacts
- Finsweet autovideo attribute
- Google Ads tag (`AW-17731234684`) + GA4 (`G-X2WZCGFLM0`)
- Meta Pixel (`1539406774061480`)

**Footer code** includes:
- Swiper slider bundle
- Filter preloader button handler
- Lead routing webhook interceptor with UTM capture (described above)

**Note:** The old Pardot tracking code (`piAId = '1078882'`, `go.campexperts.com/pd.js`) was removed from both head and footer and replaced with HubSpot tracking.

---

## Lead Processing Flow

### Two-Step Form Submission

Families typically submit two forms in sequence:

1. **Short form** (Initial Request Info Step Form): Just `first_name`, `last_name`, `email`, `phone`
2. **Detailed form** (Request Info Form): All of the above plus child data, ZIP, country, description

### Short Form Handler (`handleShortForm`)

When the short form arrives:
1. **Dedup check** — Skip if a pending lead exists for this email within 6 hours
2. **Search HubSpot** for existing household by email/phone
3. **Create Household** (if new) with `householdid = WF_{timestamp}`, assigned to Camp Experts Office
4. **Create Contact** linked to household, assigned to Camp Experts Office
5. **Associate** Contact ↔ Household (type 112, USER_DEFINED)
6. **Insert pending lead** in PostgreSQL with a 4-minute timeout

### Detailed Form Handler (`handleDetailedForm`)

When the detailed form arrives:
1. **Look up pending lead** (may have been created by short form)
2. **Extract children** from numbered fields (`child_1_*`, `child_2_*`, ... up to 10)
3. **Extract lead source** (UTM params, source URL, referrer, form name)
4. **Run routing engine** to determine the expert assignment
5. **Create/update Household** with full data (ZIP, country, number of children)
6. **Create/update Contact** with expert as owner
7. **For each child:**
   - Create Child record with age (calculated from DOB), gender, budget, interests
   - Create Deal (`"{ChildName} | {Year}"`, pipeline: default, stage: appointmentscheduled)
8. **Create all associations** (6 per child+deal pair):
   - Contact ↔ Household (type 112)
   - Child ↔ Household (type 110)
   - Contact ↔ Child (type 78)
   - Deal ↔ Household (type 170)
   - Deal ↔ Child (type 153)
   - Deal → Contact (type 3, HUBSPOT_DEFINED)
9. **Fire notifications in parallel:**
   - Expert email (with AI briefing)
   - Expert SMS
   - Family acknowledgment email
   - Log assignment to database
   - Delete pending lead (if exists)

### 4-Minute Timeout Handler

If no detailed form arrives within 4 minutes of a short form:
1. Assign household and contact to Camp Experts Office
2. Send expert notification to the office
3. Send SMS to the office
4. Log as `timeout_fallback`
5. Schedule a follow-up email to the family 6 minutes later

### Periodic Cleanup

Every 5 minutes, a background job checks for expired pending leads older than 4 minutes and processes them as timeouts.

---

## Routing Engine

The routing engine (`routing-engine.js`) determines which expert a lead should be assigned to. It runs through 6 sequential checks, returning the first match:

### Priority 1: Existing Family

Searches HubSpot by contact email and phone to find an existing relationship:
- Checks if the contact has any deals with a non-excluded owner
- Falls back to checking other contacts in the same household
- Returns rule: `existing_family_deal` or `existing_family_household`
- **Excluded owners:** Sam Goldberg/S'More Hires (`86337614`), Camp Experts Office (`86362403`)

### Priority 2: Requested Expert (URL-based)

Parses `source_url` for `/experts/{slug}` or `/team/{slug}` patterns and matches against the `EXPERT_SLUGS` map. Returns rule: `requested_expert_{slug}`

### Priority 3: International Routing

If `country` is not US/USA:
- Matches against `INTERNATIONAL_ROUTES` map (45+ countries configured)
- Returns rule: `international_{country}`
- Fallback for unknown countries: Camp Experts Office (`international_fallback_{country}`)
- Also detects non-US phone prefixes (numbers starting with `+` but not `+1`)

### Priority 4: Domestic US Routing

**ZIP code matching (in order):**
1. **UWS Manhattan** (10023, 10024, 10025, 10069) → Beth Goldstein
2. **Manhattan rotation** (all other Manhattan ZIPs) → alternates Wendy Marks / Allison Aspis (2:1 ratio via PostgreSQL counter)
3. **Exact 5-digit ZIP** (e.g., 10583 → Emily Salant in Scarsdale)
4. **3-digit ZIP prefix** (e.g., 601 → Renee Morris for IL suburbs)

**Phone area code fallback** (if no ZIP match):
- Extracts 3-digit area code from phone number
- NYC area codes (212, 646, 917, 347, 718, 929) trigger Manhattan rotation
- Other area codes map to specific experts

### Priority 5: AI-Powered Routing

When geographic rules don't match, Claude Haiku analyzes the lead data (ZIP, phone, city, address, description) against expert profiles and picks the best match based on geographic proximity and specialty.

- Expert profiles include regions and specialties (defined in `EXPERT_PROFILES`)
- Returns rule: `ai_routing_{expertId}`
- Falls through to fallback if AI returns "NONE" or fails

### Priority 6: Fallback

Returns Camp Experts Office. Rule: `fallback_no_match`

### Manhattan Rotation Logic

Manhattan leads alternate between Wendy Marks and Allison Aspis using an atomic counter in PostgreSQL:
- Counter increments on each Manhattan assignment
- Formula: `counter % 3 < 2 ? WENDY : ALLISON` (2:1 ratio favoring Wendy)
- Shared between ZIP-based and area-code-based Manhattan routing

---

## Notifications

### Expert Email (`sendExpertNotification`)

Sent to the assigned expert immediately when a detailed form is processed.

**Subject:** `"[New Lead|Returning Family]: {FamilyName} - {Location}"`

**Contents:**
- AI-generated briefing ("At a Glance") — uses Claude Haiku to summarize ALL lead data:
  - Child ages, genders, budget levels, session preferences
  - Location (ZIP, city, country)
  - Parent notes/description
  - Keeps it under 60 words, warm but professional
- Family contact info (name, email, phone, ZIP, country)
- Lead source attribution (UTM source/medium/campaign, or source page URL)
- Child details table (name, age, DOB, gender, year, budget, session length)
- Raw parent notes
- Returning family indicator (highlighted yellow box)

**Sent from:** `Camp Experts <office@campexperts.com>`

### Expert SMS (`sendExpertSms`)

Short text alert via Twilio:
```
New lead: Nichole Hoskinson (60178). Check your email for details.
```
or
```
Returning family: Jennifer Cunningham (23236). Check your email for details.
```

### Family Acknowledgment (`sendFamilyAcknowledgment`)

Sent to the family's email confirming their expert assignment:

**Subject:** `"We've got you covered, {FirstName}"`

**Contents:** Warm message naming their dedicated Camp Expert and encouraging them to reply with any questions.

**Sent from:** `Camp Experts <hey@campexperts.com>`

### Timeout Follow-Up (`sendTimeoutFollowUp`)

Sent 6 minutes after a short form times out (10 minutes total after initial submission):

**Subject:** `"We're here whenever you're ready"`

**Contents:** Gentle nudge encouraging the family to complete the form or reach out directly.

### Internal Form Notification (`sendInternalFormNotification`)

For non-lead forms (team applications, contact forms, email signups):

**Sent to:** `riley@campexperts.com`

**Subject:** `"{FormName}: New Submission"`

**Contents:** Clean table of all submitted fields with source URL.

---

## Lead Source Attribution

### How It Works

The `extractLeadSource()` function in `field-normalizer.js` extracts attribution data from every webhook payload:

1. **UTM parameters** — checks for `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` (handles multiple field name variants from Webflow)
2. **Source URL parsing** — if UTMs aren't in separate fields, parses them from the source URL query string
3. **Referrer** — the referring page URL
4. **Form name** — which Webflow form was submitted

### Derived `lead_source` Label

A human-readable label is derived:
- With UTMs: `"google / cpc"` (source / medium)
- Without UTMs but with URL: `"website: /get-started"` (pathname)
- No attribution: `"webflow_form"`

### Where It's Stored

| Location | Fields |
|---|---|
| `assignment_log.lead_source` | Human-readable label (e.g., `"google / cpc"`) |
| `assignment_log.lead_source_detail` | Full JSONB object with all UTM params, source URL, referrer |
| Expert notification email | Shown as "Source:" row in the contact info table |
| `assignment_log.raw_payload` | Complete original webhook payload |

---

## HubSpot Data Model

### Custom Objects

| Object | Type ID | Purpose |
|---|---|---|
| Household (`p_household`) | `2-53610744` | Family unit, owns email/phone/ZIP |
| Child (`p_children`) | `2-50911061` | Individual camper with age, gender, budget |
| Contact (standard) | `0-1` | Parent, linked to household |
| Deal (standard) | `0-3` | One deal per child per year |

### Association Types

| Association | Type ID | Category |
|---|---|---|
| Contact ↔ Household | 112 | USER_DEFINED |
| Child ↔ Household | 110 | USER_DEFINED |
| Contact ↔ Child | 78 | USER_DEFINED |
| Deal ↔ Household | 170 | USER_DEFINED |
| Deal ↔ Child | 153 | USER_DEFINED |
| Deal → Contact | 3 | HUBSPOT_DEFINED |

### Key Properties

**Household:** `householdid` (WF_ prefix), `household_name`, `familyname`, `emailaddress`, `cellnumber`, `num_children`, `state___country__if_int_l_`, `zip`, `hubspot_owner_id`

**Contact:** `firstname`, `lastname`, `email`, `phone`, `mobilephone`, `contact_id`, `family_id`, `is_primary_contact`, `role`, `hubspot_owner_id`

**Child:** `first_name`, `last_name`, `dob`, `age`, `gender`, `associated_household_id`, `child_id`, `clientid_access`, `budget_per_week`, `interests`, `hubspot_owner_id`

**Deal:** `dealname` ("{ChildFirst} {ChildLast} | {Year}"), `pipeline` (default), `dealstage` (appointmentscheduled), `associated_household_id`, `associated_child_id`, `year1`, `hubspot_owner_id`

### Budget Mapping

| Form Value | Stored Value |
|---|---|
| `$` | `1500` |
| `$$` | `2500` |
| `$$$` | `3500` |

---

## Database Schema (PostgreSQL)

### `pending_leads`

Tracks short form submissions waiting for a detailed form to arrive.

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| email | TEXT | Indexed |
| phone | TEXT | |
| contact_id | TEXT | HubSpot record ID |
| raw_payload | JSONB | Full webhook data + internal IDs |
| created_at | TIMESTAMPTZ | Indexed, auto-set |
| processed | BOOLEAN | Default false |

### `assignment_log`

Permanent record of every lead assignment for analytics and debugging.

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| contact_id | TEXT | HubSpot record ID |
| contact_email | TEXT | |
| contact_name | TEXT | |
| expert_owner_id | TEXT | Indexed |
| expert_name | TEXT | |
| routing_rule | TEXT | Indexed — which routing path was taken |
| zip | TEXT | |
| country | TEXT | |
| phone | TEXT | |
| lead_source | TEXT | Indexed — human-readable attribution label |
| lead_source_detail | JSONB | Full UTM params, source URL, referrer |
| raw_payload | JSONB | Complete original webhook payload |
| created_at | TIMESTAMPTZ | Indexed |

### `manhattan_rotation`

Singleton table for Manhattan expert rotation counter.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | Always 1 |
| counter | INTEGER | Incremented atomically |
| last_updated | TIMESTAMPTZ | |

### Routing Rule Values

| Rule | Meaning |
|---|---|
| `existing_family_deal` | Matched via existing deal owner |
| `existing_family_household` | Matched via household member's deal |
| `requested_expert_{slug}` | Came from expert profile page URL |
| `international_{country}` | Country-based routing |
| `international_fallback_{country}` | Unknown international country |
| `international_phone_prefix` | Non-US phone prefix detected |
| `manhattan_uws` | UWS ZIP match |
| `manhattan_rotation` | Manhattan ZIP or area code rotation |
| `zip_exact_{5digit}` | Exact 5-digit ZIP match |
| `zip_prefix_{3digit}` | 3-digit ZIP prefix match |
| `area_code_{areacode}` | Phone area code match |
| `area_code_manhattan_rotation` | NYC area code → Manhattan rotation |
| `ai_routing_{expertId}` | AI picked best expert |
| `fallback_no_match` | No routing criteria matched |
| `fallback_error` | Routing engine error |
| `timeout_fallback` | 4-minute timeout (short form only) |
| `timeout_fallback_cleanup` | Caught by periodic cleanup job |

---

## Expert Configuration

44 experts are configured in `routing-config.js` with:
- **HubSpot Owner ID** (e.g., `87283296`)
- **Name** (e.g., "Karen Meister")
- **Email** (e.g., `karen@campexperts.com`)
- **Phone** (e.g., `+13054943366`)

Geographic assignments are defined in three maps:
- **`ZIP_ROUTES`** — ~200 entries mapping exact 5-digit ZIPs and 3-digit prefixes to expert IDs
- **`AREA_CODE_ROUTES`** — ~90 entries mapping phone area codes to expert IDs
- **`INTERNATIONAL_ROUTES`** — ~45 entries mapping country names to expert IDs
- **`EXPERT_PROFILES`** — Regions and specialties for AI-powered routing fallback

---

## API Endpoints

### `POST /api/webhook/webflow-lead`

Main webhook for lead form submissions. Accepts the raw Webflow form payload as JSON.

- Normalizes field names (handles Webflow's inconsistent naming)
- Detects short vs. detailed form based on presence of child/ZIP/description fields
- Returns `200 { success: true }` on success
- Returns `400 { error: 'Missing email' }` if no email in payload
- Returns `500` on server error

### `POST /api/webhook/webflow-internal`

Webhook for non-lead forms (team applications, contact forms, email signups). Forwards submissions to Riley via email.

- Returns `200 { success: true }` on success

### `POST /api/test-routing`

Test endpoint that runs the routing engine without creating any HubSpot records.

- Input: Webflow form payload
- Output: `{ input: {...}, routing: { expertId, expertName, expertEmail, rule } }`
- Useful for validating routing before submission

### `GET /`

Health check. Returns `{ status: 'ok', service: 'Camp Experts Lead Routing Engine' }`.

---

## File Structure

```
web-leads/
├── index.js              — Express server, webhook handlers, timeout logic
├── routing-engine.js     — 6-step routing priority chain + AI fallback
├── routing-config.js     — Expert profiles, ZIP/area code/country maps
├── field-normalizer.js   — Webflow field normalization, child extraction, lead source parsing
├── notifications.js      — Email notifications (expert, family, timeout, internal)
├── sms.js                — Twilio SMS alerts to experts
├── hubspot.js            — HubSpot API wrapper (CRUD for all 4 object types + associations)
├── db.js                 — PostgreSQL (pending leads, assignment log, Manhattan rotation)
├── package.json
├── .replit               — Replit deployment config
└── SYSTEM-DOCUMENTATION.md  — This file
```

---

## Environment & Deployment

- **Platform:** Replit (autoscale deployment)
- **Runtime:** Node.js 20
- **Port:** 5000 (mapped to external port 80)
- **Database:** Replit PostgreSQL (via `DATABASE_URL`)
- **HubSpot:** Connected via Replit Connectors (proxy-based auth)
- **Resend:** Connected via Replit Connectors (email delivery)
- **Twilio:** Connected via Replit Connectors (SMS delivery)
- **Anthropic:** API key via `ANTHROPIC_API_KEY` environment variable
- **HubSpot Portal ID:** 50530609
