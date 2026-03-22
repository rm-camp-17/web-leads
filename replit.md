# Camp Experts Lead Routing Engine

## Overview
A Node.js/Express backend service that routes leads from Webflow form submissions to the appropriate Camp Expert within HubSpot. It receives webhooks, normalizes form data, applies routing rules (existing family, requested expert, geographic), and creates CRM records.

## Architecture
- **Runtime**: Node.js 20, Express.js
- **Database**: Replit PostgreSQL (via `pg` package, `DATABASE_URL`)
- **Integrations**: HubSpot (CRM), Resend (email), Twilio (SMS) — all via Replit Connectors (`@replit/connectors-sdk`)
- **Optional**: Anthropic SDK for AI-personalized lead summaries

## Project Structure
| File | Purpose |
|---|---|
| `index.js` | Main entry point; Express routes, webhook handler, timeout logic |
| `routing-engine.js` | Core routing logic (existing family → requested expert → international → domestic) |
| `routing-config.js` | Expert IDs, ZIP/area code mappings, international routes |
| `field-normalizer.js` | Normalizes inconsistent Webflow field names |
| `hubspot.js` | HubSpot CRM API wrapper (via Replit Connectors proxy) |
| `db.js` | PostgreSQL database layer (pending leads, assignment log, Manhattan rotation) |
| `notifications.js` | Email notifications via Resend (via Replit Connectors) |
| `sms.js` | SMS alerts via Twilio (via Replit Connectors) |

## Key Endpoints
- `GET /` — Health check
- `POST /api/webhook/webflow-lead` — Main webhook for Webflow form submissions
- `POST /api/test-routing` — Test routing without HubSpot writes

## Database Tables
- `pending_leads` — Buffer for short-form submissions waiting for detailed form (4-min timeout)
- `assignment_log` — Records every routing decision
- `manhattan_rotation` — Round-robin counter for NYC area leads

## Environment
- Server runs on port 5000 (0.0.0.0)
- Database auto-initializes on startup
- Integrations authenticate via Replit Connectors (no manual API keys needed for HubSpot, Resend, Twilio)
