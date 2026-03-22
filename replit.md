# Camp Experts Lead Routing Engine

## Overview
A Node.js/Express backend service that routes leads from Webflow form submissions to the appropriate Camp Expert within HubSpot. It receives webhooks, normalizes form data, applies a 6-step routing priority chain, creates CRM records (Households, Contacts, Children, Deals with full associations), and sends notifications.

## Architecture
- **Runtime**: Node.js 20, Express.js
- **Database**: Replit PostgreSQL (via `pg` package, `DATABASE_URL`)
- **Integrations**: HubSpot (CRM), Resend (email), Twilio (SMS) — all via Replit Connectors (`@replit/connectors-sdk`)
- **Optional**: Anthropic SDK for AI-personalized lead summaries and AI routing fallback

## Project Structure
| File | Purpose |
|---|---|
| `index.js` | Main entry point; Express routes, webhook handlers, timeout logic |
| `routing-engine.js` | 6-step routing: existing family → requested expert → international → domestic → AI → fallback |
| `routing-config.js` | Expert IDs, ZIP/area code mappings, international routes, expert profiles for AI |
| `field-normalizer.js` | Normalizes Webflow field names, extracts children, budget mapping, lead source attribution |
| `hubspot.js` | HubSpot CRM API wrapper (Households, Contacts, Children, Deals, 6 association types) |
| `db.js` | PostgreSQL database layer (pending leads, assignment log with lead source, Manhattan rotation) |
| `notifications.js` | Email notifications via Resend (expert, family, timeout, internal form forwarding) |
| `sms.js` | SMS alerts via Twilio |

## Key Endpoints
- `GET /` — Health check
- `POST /api/webhook/webflow-lead` — Main webhook for lead form submissions (short + detailed)
- `POST /api/webhook/webflow-internal` — Internal forms (team apps, contact forms) → forwarded to Riley
- `POST /api/test-routing` — Test routing without HubSpot writes

## HubSpot Objects Created Per Lead
- **Household** (custom `2-53610744`) — created on short form, updated on detailed form
- **Contact** — created or found by email/phone
- **Child** (custom `2-50911061`) — one per child, with calculated age and mapped budget
- **Deal** — one per child, named `"{ChildName} | {Year}"`
- 6 association types per child: Contact↔Household (112), Child↔Household (110), Contact↔Child (78), Deal↔Household (170), Deal↔Child (153), Deal→Contact (3)

## Database Tables
- `pending_leads` — Buffer for short-form submissions waiting for detailed form (4-min timeout)
- `assignment_log` — Records every routing decision, includes `lead_source` and `lead_source_detail` (JSONB)
- `manhattan_rotation` — Round-robin counter for NYC area leads (2:1 Wendy:Allison ratio)

## Environment
- Server runs on port 5000 (0.0.0.0)
- Database auto-initializes on startup with column migrations
- Integrations authenticate via Replit Connectors (no manual API keys needed for HubSpot, Resend, Twilio)
