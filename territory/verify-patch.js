// Verifies the EU-collision routing patch without HubSpot/network.
const cfg = require('../routing-config');
const eng = require('../routing-engine');

const N = id => (cfg.EXPERTS[id] && cfg.EXPERTS[id].name) || id;
let pass = 0, fail = 0;

// Decide the international-or-domestic outcome the way routeLead would, minus
// existing-family / AI / Manhattan-rotation (which need network).
function decide(lead) {
  const intl = eng.checkInternational(lead.country, lead.phone);
  if (intl) return { ...intl, owner: N(intl.expertId) };
  if (lead.zip) {
    const z = eng.getExpertByZip(lead.zip);
    if (z) return { ...z, owner: N(z.expertId === cfg.MANHATTAN_ROTATION ? cfg.WENDY_ID : z.expertId) };
  }
  // (area-code path omitted here; tested separately)
  if (eng.looksDomestic(lead)) return { expertId: cfg.JUMP_BALL_OWNER_ID, rule: 'jump_ball_us_gap', owner: N(cfg.JUMP_BALL_OWNER_ID) };
  return { expertId: cfg.CAMP_EXPERTS_OFFICE_ID, rule: 'fallback_no_match', owner: N(cfg.CAMP_EXPERTS_OFFICE_ID) };
}

function check(desc, lead, expectId) {
  const r = decide(lead);
  const ok = r.expertId === expectId;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${desc}\n        -> ${r.owner} [${r.rule}]${ok ? '' : `  (expected ${N(expectId)})`}`);
}

console.log('=== EU collision: the bug we are fixing ===');
check('Paris fam, BLANK country, +33 phone, zip 75008 (looks like Dallas)',
  { country: '', phone: '+33 6 03 06 09 45', zip: '75008' }, '87283278'); // Catherine
check('Paris fam, country=France, zip 75016',
  { country: 'France', phone: '', zip: '75016' }, '87283278');
check('Milan fam, BLANK country, +39 phone, zip 20121 (looks like N. Virginia)',
  { country: '', phone: '+39 02 1234 5678', zip: '20121' }, '87283300'); // Laura
check('Monaco fam, country=Monaco, +377 phone, zip 98000 (looks like Seattle)',
  { country: 'Monaco', phone: '+377 99 99 99 99', zip: '98000' }, '87283300');
check('Riviera fam (Cap d Ail), BLANK country, +33 phone, zip 06320 (looks like CT)',
  { country: '', phone: '+33 4 93 00 00 00', zip: '06320' }, '87283278'); // France by phone

console.log('\n=== Must NOT over-trigger: real US leads still route domestically ===');
check('Real Dallas fam, US +1 phone, zip 75201',
  { country: '', phone: '+1 214 555 1212', zip: '75201' }, '87283304'); // Lindsey Binstock
check('Real Dallas fam, country=United States, bare 10-digit phone, zip 75201',
  { country: 'United States', phone: '(214) 555-1212', zip: '75201' }, '87283304');
check('Ohio 330 area-code US number must NOT be read as +33 France',
  { country: '', phone: '3305551234', zip: '' }, cfg.JUMP_BALL_OWNER_ID); // no zip -> falls to domestic gap (area-code tested below)
check('Real San Diego fam, US phone, zip 92101',
  { country: '', phone: '+1 619 555 1212', zip: '92101' }, '87283281'); // Denise Gordon (CA)

console.log('\n=== Jump balls -> Lindsey Schwimmer (87283303) ===');
check('Montana (uncovered), country US, zip 59001',
  { country: 'United States', phone: '', zip: '59001' }, cfg.JUMP_BALL_OWNER_ID);
check('Rockland NY 109 (ex-Lara Weinberg)',
  { country: '', phone: '', zip: '10901' }, cfg.JUMP_BALL_OWNER_ID);
check('Phoenix AZ 852',
  { country: '', phone: '', zip: '85254' }, cfg.JUMP_BALL_OWNER_ID);

console.log('\n=== New clear-expert gap fills ===');
check('Brooklyn 112 -> Laurie Karol', { country: '', phone: '', zip: '11215' }, '87283301');
check('Yonkers 107 -> Michele Gershwin', { country: '', phone: '', zip: '10701' }, '87283309');
check('NJ shore 077 -> Risa Goldberg', { country: '', phone: '', zip: '07720' }, '87283320');

console.log('\n=== International unresolved -> office; UK -> Carrie ===');
check('UK family, country=UK', { country: 'UK', phone: '+44 20 7946 0000', zip: 'SW1A 1AA' }, '87283277');
check('Unknown country, intl phone +49 (Germany)', { country: '', phone: '+49 30 123456', zip: '' }, '87283278');

console.log('\n=== Area-code guard (direct) ===');
(async () => {
  const ohio = await eng.testRoute ? null : null;
  // parsePhoneCC sanity
  const a = eng.parsePhoneCC('3305551234'); // bare US 10-digit
  const b = eng.parsePhoneCC('+33 6 03 06 09 45'); // France
  const c = eng.parsePhoneCC('+1 214 555 1212'); // US
  const d = eng.parsePhoneCC('+377 99 99 99 99'); // Monaco (longest match)
  console.log('parsePhoneCC("3305551234") =', JSON.stringify(a), a === null ? 'PASS (not intl)' : 'FAIL');
  (a === null) ? pass++ : fail++;
  console.log('parsePhoneCC("+33...")     =', JSON.stringify(b), b && b.expertId === '87283278' ? 'PASS' : 'FAIL');
  (b && b.expertId === '87283278') ? pass++ : fail++;
  console.log('parsePhoneCC("+1 214...")  =', JSON.stringify(c), c && c.isUs ? 'PASS' : 'FAIL');
  (c && c.isUs) ? pass++ : fail++;
  console.log('parsePhoneCC("+377...")    =', JSON.stringify(d), d && d.expertId === '87283300' ? 'PASS (Monaco>3-digit match)' : 'FAIL');
  (d && d.expertId === '87283300') ? pass++ : fail++;

  console.log('\n=== Inactive experts excluded from existing-family matching ===');
  for (const id of ['87283299', '87283306', '87283294', '87283302', '93194078']) {
    const ok = cfg.EXCLUDED_OWNER_IDS.includes(id);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${N(id)} (${id}) excluded`);
    ok ? pass++ : fail++;
  }

  console.log(`\n================  ${pass} passed, ${fail} failed  ================`);
  process.exit(fail ? 1 : 0);
})();
