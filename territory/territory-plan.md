# Territory & Routing Patch — June 2026

## 1. The "France expert owns Dallas" mystery — solved

The alarming audit numbers (Catherine Visan "6,897 households incl. 3,148 in Dallas";
Laura Toledo "3,839 incl. 1,257 in Northern Virginia, 459 in Seattle, most of Connecticut")
were **not** mis-assigned families. They are a **postal-code collision**: 5-digit European
postal codes are numerically identical to US ZIP prefixes, so a ZIP-based audit (and the
live router, on a blank-country lead) reads a Paris postcode as Dallas.

Verified against the live HubSpot `city` / `state-country` / `cellnumber` fields:

| Real location (from `city`) | EU postcode | Collides with US ZIP3 | Was mislabeled as |
|---|---|---|---|
| **Paris** (Catherine, 3,131) | 75xxx | 750 / 751 | Dallas TX |
| **Neuilly / Boulogne / Levallois** | 92xxx | 921 / 922 / 923 | San Diego / San Bernardino CA |
| **St-Germain-en-Laye** | 78xxx | 781 | San Antonio TX |
| **Milano** (Laura, 1,224) | 20xxx | 200 / 201 | DC / N. Virginia |
| **Monaco** (448) | 980xx | 980 | Seattle WA |
| **Roma / Torino / Como** | 00/10/22xxx | 001 / 101 / 221 | DC / NYC / Arlington |
| **Mougins / Cap d'Ail / Nice** (Riviera) | 06xxx | 060–066 | Connecticut |

Ownership is essentially **correct**: Catherine = 6,341/6,897 country=France (5,387 phones +33);
Laura = 2,376 Italy + 452 Monaco + 304 France-Riviera (1,898 phones +39). No mass reassignment
of these ~10k households is needed.

### The real, forward-looking bug
`checkInternational()` runs before ZIP routing **but only fired when the Country field was
filled in.** Catherine has 361 and Laura 676 households with **blank country** — so a *new*
Paris lead with blank country fell through to `getExpertByZip("75008")` → "750" →
**Lindsey Binstock (Dallas)**. That is the leak this patch closes.

## 2. The patch (code + config only — no live CRM edits)

**`routing-engine.js`**
- New `parsePhoneCC()` — reads the international dialing code from a phone, but **only** when the
  number is dialed internationally (`+` / `00`). A bare US 10-digit number like `330-555-1234`
  is **never** read as "+33 France".
- `checkInternational()` now routes by **phone country code** when the Country field is blank
  (+33→Catherine, +39/+377→Laura, +44→Carrie, +972→Pamela, …). European leads are caught
  *before* the US ZIP table can see their postcode.
- New `looksDomestic()` — used for the fallback decision.
- Final fallback: a US-looking lead with no match is a **jump ball → Lindsey Schwimmer**;
  unresolved international / no-signal stays with the office.

**`routing-config.js`**
- `PHONE_CC_ROUTES` — dialing-code → expert map (the fix above).
- `INACTIVE_OWNER_IDS` — Lara Weinberg, Lisa Dalinka, Julie Rosenberg, Leslie Zeller,
  Heather Messer — merged into `EXCLUDED_OWNER_IDS` so existing-family matching skips them.
- `JUMP_BALL_OWNER_ID` = Lindsey Schwimmer.
- New ZIP-3 rules (see §4).

## 3. Inactive experts

Per Riley: **Lara Weinberg → inactive**, **Lisa Dalinka → ignore (also inactive)**.
Both (plus Julie Rosenberg, Leslie Zeller, Heather Messer) are now excluded from
*existing-family* matching. Effect: when one of Lara's families **resubmits via the website**,
they no longer dead-end on Lara's seat — they route by geography (Bergen County → Dara
Pasternack, Essex → Risa Goldberg, both already covered by existing ZIP rules).
**Existing CRM ownership is left untouched** — nothing is re-routed unless the family resubmits.

> ⚠️ **Flag for Riley:** `Karen Rossow` (87283295, null phone, 6 hh) is still the
> `INTERNATIONAL_ROUTES['Mexico']` target. If she's also inactive, Mexico leads should be
> repointed. Left as-is pending your call.

## 4. Jump balls → Lindsey Schwimmer

> **Note:** the specifics below are the round-1 design; **§8 (round 2) supersedes** the
> jump-ball list and state coverage (whole-state owners now absorb VA/OH/MD/etc.; 26 gap states).

Rule: regions a clear active expert already owns stay with that expert; low-density /
uncovered US regions (mostly sitting on Camp Experts Office today) go to Lindsey.

**Gap fills to the clear local expert** (were unruled): `100/101/102`→Manhattan rotation,
`107`→Michele Gershwin, `108`→Shari Levine, `112/113`→Laurie Karol, `077/078/079`→Risa
Goldberg, `085`→Jennifer Markizon, `189`→Jennifer Markizon.

**Explicit jump balls → Lindsey:** `109` (Rockland/Orange NY, ex-Lara), `020/021/024` (MA),
`080/088` (S/Central NJ), `432` (Columbus OH), `852` (Phoenix AZ), `130` (Syracuse NY).

**Plus the gap fallback** sends every other unmatched US lead to Lindsey. On the map she is
dominant in **28 uncovered states**: AK, AZ, AR, HI, ID, IN, IA, KS, KY, LA, ME, MA, MS, MO,
MT, NE, NV, NH, NM, ND, OK, RI, SD, UT, VT, WV, WY, PR.

> Note: assignments that looked like a clear expert but were actually collisions were **not**
> given to that expert — e.g. Pamela Bank's "472" is **Ramat HaSharon, Israel** (not Indiana),
> and Catherine's "130" is **Marseille** (not Syracuse). Those stay jump balls.

## 5. The map

`territory/territory-map.html` — open in a browser. Self-contained, interactive:
- States colored by the expert who owns that region's ZIP routing (**yellow = jump balls**).
- Metro dots show intra-state splits (NYC, Westchester, LI, Bergen/Essex, Chicago, etc.).
- Hover a state → its full ZIP-3 → expert breakdown; searchable table of all ZIP-3 territories.
- European-collision ZIPs are excluded from US coloring (they route internationally).

## 6. Verification

`scratchpad/verify-patch.js` — 26/26 checks pass: EU leads route to the right European expert
even with blank country; real US Dallas/San Diego still route domestically; the 330 Ohio
area-code is not misread as France; jump balls land on Lindsey; inactive experts are excluded.

## 7. Residual / not addressed
- A European lead with **both** blank country **and** a US-format/blank phone + a colliding ZIP
  is still ambiguous by data alone (rare). It degrades to a US jump ball (Lindsey), not to the
  wrong metro expert.
- No live HubSpot records were modified (per the chosen scope). A reassignment script can be
  prepared separately if you later want to clean genuinely-misrouted US records.

---

## 8. Refinements (round 2)

After walking through it with Riley:

**Whole-state model (new `STATE_ROUTES` layer).** Routing now resolves in this order:
UWS/Manhattan → 5-digit ZIP → 3-digit ZIP (metro) → **whole-state default** → area code →
jump ball. So a single-expert state is owned end-to-end (e.g. **all of Virginia → Lindsey
Binstock**, not just NoVA), while multi-expert states (NY, NJ, PA, FL, IL) keep their ZIP-3
splits. This shrank the jump-ball pool from 28 states to **26** (and pulled Columbus OH →
Ashley, Salisbury MD → Mindy, etc. out of the jump balls).

State owners: VA/DC/NC/TX → Binstock · MD → Mindy · DE → Beth · GA/TN/SC/AL → Tami ·
OH/MI/WI/MN → Ashley · CO/WA/OR → Jaime · CA → Denise · MA/RI → Emily Rothenberg ·
CT → Amanda (Westport/Greenwich carved to Emily Rothenberg).

**Roster corrected against HubSpot `isActive`:**
- **Heather Messer is ACTIVE** — was wrongly benched; now in `EXPERTS` with a Rye Brook
  carve-out (`10573`). *[ASSUMPTION: confirm her exact towns; phone needed for SMS.]*
- **Michelle Burger is INACTIVE** — her Livingston rule (`07039`) was removed; Livingston now
  flows to Risa Goldberg (Essex `070`).
- **Lara Weinberg, Leslie Zeller** inactive (confirmed by HubSpot).
- **Lisa Dalinka, Julie Rosenberg** treated as inactive per Riley, **but HubSpot still shows
  them active** — their seats should be deactivated.
- **Nathalie Amar** + two blank-named seats are active with **0 households** (new/placeholder).

**Monica Hirsch is NOT Westchester.** Her real book is Brazil/São Paulo, Uruguay, Bergen NJ
(Upper Saddle River) and South Florida — profile corrected to Latin America. (She's a Brazil
co-expert alongside Carolina Lautenberg — a future split to consider.)

**New England split (from the records):** CT → Amanda + Emily Rothenberg · MA & RI → Emily
Rothenberg · Boston (`021`) → **Wendy Marks** *[ASSUMPTION: confirm Wendy's NE area]* ·
NH/VT/ME → Lindsey Schwimmer (genuine low-density gaps).

**Still open / flagged:** Wendy's exact NE area, Heather Messer's full town list + SMS phone,
and whether Karen Rossow (Mexico route) is active.
