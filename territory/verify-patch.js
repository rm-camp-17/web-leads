// Verifies the routing patch without HubSpot/network. Run: node territory/verify-patch.js
const cfg = require('../routing-config');
const eng = require('../routing-engine');

const N = id => (cfg.EXPERTS[id] && cfg.EXPERTS[id].name) || id;
let pass = 0, fail = 0;

function decide(lead) {
  const intl = eng.checkInternational(lead.country, lead.phone);
  if (intl) return { ...intl, owner: N(intl.expertId) };
  if (lead.zip) {
    const z = eng.getExpertByZip(lead.zip);
    if (z) return { ...z, owner: N(z.expertId === cfg.MANHATTAN_ROTATION ? cfg.WENDY_ID : z.expertId) };
  }
  if (eng.looksDomestic(lead)) return { expertId: cfg.JUMP_BALL_OWNER_ID, rule: 'jump_ball_us_gap', owner: N(cfg.JUMP_BALL_OWNER_ID) };
  return { expertId: cfg.CAMP_EXPERTS_OFFICE_ID, rule: 'fallback_no_match', owner: N(cfg.CAMP_EXPERTS_OFFICE_ID) };
}
function check(desc, lead, expectId) {
  const r = decide(lead);
  const ok = r.expertId === expectId;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${desc}\n        -> ${r.owner} [${r.rule}]${ok ? '' : `  (expected ${N(expectId)})`}`);
}

console.log('=== EU collision fix (route by phone CC when country blank) ===');
check('Paris, blank country, +33, zip 75008', { country: '', phone: '+33 6 03 06 09 45', zip: '75008' }, '87283278');
check('Milan, blank country, +39, zip 20121', { country: '', phone: '+39 02 1234 5678', zip: '20121' }, '87283300');
check('Monaco, country=Monaco, zip 98000', { country: 'Monaco', phone: '+377 99 99 99 99', zip: '98000' }, '87283300');

console.log('\n=== Real US still routes domestically; no over-trigger ===');
check('Dallas, US +1 phone, zip 75201', { country: '', phone: '+1 214 555 1212', zip: '75201' }, '87283304');
check('Ohio 330 area code must NOT be read as +33', { country: '', phone: '3305551234', zip: '' }, cfg.JUMP_BALL_OWNER_ID);

console.log('\n=== Whole-state default (the "all of Virginia → Binstock" fix) ===');
check('VA Blacksburg 24060 (no metro rule)', { country: '', phone: '', zip: '24060' }, '87283304'); // state_VA
check('VA Norfolk 23510', { country: '', phone: '', zip: '23510' }, '87283304');
check('VA NoVA 22101 (metro rule still wins)', { country: '', phone: '', zip: '22101' }, '87283304');
check('OH Columbus 43215 (was a jump ball)', { country: '', phone: '', zip: '43215' }, '87283273'); // Ashley, state_OH
check('MD Salisbury 21801', { country: '', phone: '', zip: '21801' }, '87283312'); // Mindy, state_MD

console.log('\n=== New England split ===');
check('MA Northampton 01060', { country: '', phone: '', zip: '01060' }, '87283284'); // Emily Rothenberg
check('MA Boston 02108 → Wendy (carve-out)', { country: '', phone: '', zip: '02108' }, '87283325');
check('RI Providence 02906', { country: '', phone: '', zip: '02906' }, '87283284'); // Emily Rothenberg
check('CT Fairfield 06824 (Amanda)', { country: '', phone: '', zip: '06824' }, '87283272');
check('CT Westport 06880 (Emily Rothenberg carve-out)', { country: '', phone: '', zip: '06880' }, '87283284');
check('NH Concord 03301 → jump ball (no NE state owner)', { country: '', phone: '', zip: '03301' }, cfg.JUMP_BALL_OWNER_ID);

console.log('\n=== Roster fixes ===');
check('Rye Brook 10573 → Heather Messer (active)', { country: '', phone: '', zip: '10573' }, '93194078');
check('Livingston 07039 → Risa (Michelle Burger inactive)', { country: '', phone: '', zip: '07039' }, '87283320');

console.log('\n=== Inactive list ===');
[['87283299','Lara Weinberg',true],['87283302','Leslie Zeller',true],['87283310','Michelle Burger',true],
 ['87283306','Lisa Dalinka',true],['87283294','Julie Rosenberg',true],['93194078','Heather Messer',false]].forEach(([id,nm,shouldExclude]) => {
  const excluded = cfg.EXCLUDED_OWNER_IDS.includes(id);
  const ok = excluded === shouldExclude;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${nm} ${shouldExclude ? 'excluded' : 'ACTIVE (not excluded)'}`);
});

console.log(`\n================  ${pass} passed, ${fail} failed  ================`);
process.exit(fail ? 1 : 0);
