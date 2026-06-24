// ============================================================
// Camp Experts Lead Routing Configuration
// All routing rules live here — NOT in the database.
// ============================================================

// Expert owner ID → name/email/phone lookup
const EXPERTS = {
  '87283296': { name: 'Karen Meister', email: 'karen@campexperts.com', phone: '+13054943366' },
  '87283278': { name: 'Catherine Visan', email: 'catherine@campexperts.com', phone: '+33603060945' },
  '87283274': { name: 'Beth Goldstein', email: 'beth@campexperts.com', phone: '+16106085678' },
  '87283313': { name: 'Monica Hirsch', email: 'monica@campexperts.com', phone: '+19177179660' },
  '87283276': { name: 'Carolina Lautenberg', email: 'carolina@campexperts.com', phone: '+19546105844' },
  '87283325': { name: 'Wendy Marks', email: 'wendy@campexperts.com', phone: '+19176131691' },
  '87283267': { name: 'Allison Aspis', email: 'allison.aspis@campexperts.com', phone: '+12017596843' },
  '87283293': { name: 'Jennifer Markizon', email: 'jennifer@campexperts.com', phone: '+12156964777' },
  '87283300': { name: 'Laura Toledo', email: 'lauratoledo@campexperts.com', phone: '+33618455997' },
  '87283277': { name: 'Carrie Fleming', email: 'carrie@campexperts.com', phone: '+447801568608' },
  '87283304': { name: 'Lindsey Binstock', email: 'lindsey@campexperts.com', phone: '+12026577320' },
  '87283272': { name: 'Amanda Rothlein', email: 'amanda@campexperts.com', phone: '+15168847640' },
  '87283316': { name: 'Pamela Bank', email: 'pamela@campexperts.com', phone: '+972522212413' },
  '87283269': { name: 'Alyssa Greenberger', email: 'alyssa@campexperts.com', phone: '+19175838369' },
  '87283315': { name: 'Olivia Prebay', email: 'olivia.prebay@campexperts.com', phone: '+33674769202' },
  '87283309': { name: 'Michele Gershwin', email: 'michele@campexperts.com', phone: '+19179299906' },
  '87283320': { name: 'Risa Goldberg', email: 'risa@campexperts.com', phone: '+19732029066' },
  '87283284': { name: 'Emily Rothenberg', email: 'emily.rothenberg@campexperts.com', phone: '+16468314774' },
  '87283324': { name: 'Tami Feldman', email: 'tami@campexperts.com', phone: '+14042720559' },
  '87283280': { name: 'Dara Pasternack', email: 'dara@campexperts.com', phone: '+13109954884' },
  '87283265': { name: 'Alexandra Neff Allenberg', email: 'alex@campexperts.com', phone: '+13059039412' },
  '87283287': { name: 'Emily Salant', email: 'emily@campexperts.com', phone: '+19176869671' },
  '87283318': { name: 'Renee Morris', email: 'renee@campexperts.com', phone: '+18478331327' },
  '87283323': { name: 'Shari Levine', email: 'shari@campexperts.com', phone: '+19143151077' },
  '87283317': { name: 'Pilar Vidal', email: 'pilarvidal@campexperts.com', phone: '+51988478008' },
  '87283301': { name: 'Laurie Karol', email: 'laurie@campexperts.com', phone: '+15166954224' },
  '87283312': { name: 'Mindy Rosen', email: 'mindy@campexperts.com', phone: '+14438120275' },
  '87283297': { name: 'Lana Ast', email: 'lana@campexperts.com', phone: '+19172087665' },
  '87283275': { name: 'Brooke Rotstein', email: 'brooke@campexperts.com', phone: '+13128903366' },
  '87283305': { name: 'Lisa Borg', email: 'lisa@campexperts.com', phone: '+15613022449' },
  '87283314': { name: 'Natasha Kreizman', email: 'natasha@campexperts.com', phone: '+19174479561' },
  '87283307': { name: 'Liz Hochman Mak', email: 'liz@campexperts.com', phone: '+19176129395' },
  '87487512': { name: 'LinaAndMaria', email: 'lina@campexperts.com', phone: '+16467998516' },
  '87283291': { name: 'Jaime Altman', email: 'jaime@campexperts.com', phone: '+13038681386' },
  '87283273': { name: 'Ashley Garson', email: 'ashley@campexperts.com', phone: '+14147883322' },
  '87283289': { name: 'Heather Natter Pasquale', email: 'heather.natter@campexperts.com', phone: '+16462213337' },
  '87283281': { name: 'Denise Gordon', email: 'denise@campexperts.com', phone: '+14083851544' },
  '87283303': { name: 'Lindsey Schwimmer', email: 'lindsey.schwimmer@campexperts.com', phone: '+19543298299' },
  '87283268': { name: 'Alli Sternberg', email: 'allisternberg@campexperts.com', phone: '+13123756497' },
  '87283310': { name: 'Michelle Burger', email: 'michelleburger@campexperts.com', phone: '+18323529156' },
  '87283292': { name: 'Jaymee Rosner', email: 'jaymee@campexperts.com', phone: '+19175187734' },
  '87283295': { name: 'Karen Rossow', email: 'karen.rossow@campexperts.com', phone: null },
  '87283288': { name: 'Fiona Jakobi', email: 'fiona@campexperts.com', phone: '+447850607037' },
  '87283308': { name: 'Melissa Lumaco', email: 'melissa@campexperts.com', phone: '+14242576775' },
  '93194078': { name: 'Heather Messer', email: 'heather.m@campexperts.com', phone: null }, // Rye Brook / Westchester — phone TBD for SMS
  '86362403': { name: 'Camp Experts Office', email: 'office@campexperts.com', phone: '+12122887892' },
};

if (process.env.TEST_MODE === 'true') {
  EXPERTS['86362403'] = { name: 'Riley (Test Mode)', email: 'riley@campexperts.com', phone: '+19124141215' };
}

// Departed / inactive experts — NEVER route new leads to these seats, and skip
// them when matching an "existing family" so a returning family routes by
// geography instead of dead-ending on someone who is no longer here.
// NOTE: this only changes ROUTING. Existing CRM ownership is left untouched —
// per Riley, existing families are only re-routed if they resubmit via the website.
const INACTIVE_OWNER_IDS = [
  '87283299', // Lara Weinberg — inactive (HubSpot isActive=false). Bergen/Essex NJ flows to Dara / Risa.
  '87283302', // Leslie Zeller — inactive (HubSpot isActive=false).
  '87283310', // Michelle Burger — inactive (HubSpot isActive=false). Livingston NJ now flows to Risa (Essex 070).
  '87283306', // Lisa Dalinka — treat as inactive per Riley ("ignore"). NOTE: HubSpot still shows isActive=true — deactivate the seat.
  '87283294', // Julie Rosenberg — treat as inactive per Riley. NOTE: HubSpot still shows isActive=true — deactivate the seat.
];
// (Heather Messer 93194078 is ACTIVE — she gets the Rye Brook carve-out below.)

// Owner IDs to exclude from "existing family" matching:
// hiring/office buckets + every inactive expert above.
const EXCLUDED_OWNER_IDS = ['86337614', '86362403', ...INACTIVE_OWNER_IDS]; // Sam Goldberg / S'More Hires, Camp Experts Office, + inactive experts

// Camp Experts Office fallback (international / no-signal only)
const CAMP_EXPERTS_OFFICE_ID = '86362403';

// Jump-ball owner — domestic leads in low-density / uncovered areas with no
// clear historical expert (previously these landed on Camp Experts Office).
const JUMP_BALL_OWNER_ID = '87283303'; // Lindsey Schwimmer

// Manhattan rotation constants
const WENDY_ID = '87283325';
const ALLISON_ID = '87283267';
const MANHATTAN_ROTATION = 'MANHATTAN_ROTATION';

const UWS_ZIPS = ['10023', '10024', '10025', '10069'];

const MANHATTAN_ZIPS = [
  '10001','10002','10003','10004','10005','10006','10007','10008','10009','10010',
  '10011','10012','10013','10014','10016','10017','10018','10019','10020','10021',
  '10022','10026','10027','10028','10029','10030','10031','10032','10033','10034',
  '10035','10036','10037','10038','10039','10040','10044','10065','10075','10128',
  '10280','10281','10282',
];

// Expert profile URL slugs → owner ID
const EXPERT_SLUGS = {
  'wendy-marks': '87283325',
  'allison-aspis': '87283267',
  'karen-meister': '87283296',
  'catherine-visan': '87283278',
  'beth-goldstein': '87283274',
  'monica-hirsch': '87283313',
  'carolina-lautenberg': '87283276',
  'jennifer-markizon': '87283293',
  'laura-toledo': '87283300',
  'carrie-fleming': '87283277',
  'lindsey-binstock': '87283304',
  'amanda-rothlein': '87283272',
  'pamela-bank': '87283316',
  'alyssa-greenberger': '87283269',
  'olivia-prebay': '87283315',
  'michele-gershwin': '87283309',
  'risa-goldberg': '87283320',
  'emily-rothenberg': '87283284',
  'tami-feldman': '87283324',
  'dara-pasternack': '87283280',
  'alexandra-neff-allenberg': '87283265',
  'emily-salant': '87283287',
  'renee-morris': '87283318',
  'shari-levine': '87283323',
  'pilar-vidal': '87283317',
  'laurie-karol': '87283301',
  'mindy-rosen': '87283312',
  'lana-ast': '87283297',
  'brooke-rotstein': '87283275',
  'lisa-borg': '87283305',
  'natasha-kreizman': '87283314',
  'liz-hochman-mak': '87283307',
  'lina-and-maria': '87487512',
  'jaime-altman': '87283291',
  'ashley-garson': '87283273',
  'heather-natter-pasquale': '87283289',
  'denise-gordon': '87283281',
  'lindsey-schwimmer': '87283303',
  'alli-sternberg': '87283268',
  'michelle-burger': '87283310',
  'jaymee-rosner': '87283292',
  'karen-rossow': '87283295',
  'fiona-jakobi': '87283288',
  'melissa-lumaco': '87283308',
  'heather-messer': '93194078',
};

// International country → owner ID
const INTERNATIONAL_ROUTES = {
  'France': '87283278',
  'Italy': '87283300',
  'Monaco': '87283300',
  'Israel': '87283316',
  'United Kingdom': '87283277',
  'UK': '87283277',
  'England': '87283277',
  'Scotland': '87283277',
  'Wales': '87283277',
  'Ireland': '87283277',
  'Argentina': '87283276',
  'Brazil': '87283276',
  'Chile': '87283276',
  'Peru': '87283317',
  'Venezuela': '87283276',
  'Ecuador': '87283276',
  'Uruguay': '87283276',
  'Paraguay': '87283276',
  'Bolivia': '87283276',
  'Costa Rica': '87283276',
  'Panama': '87283276',
  'Guatemala': '87283276',
  'Honduras': '87283276',
  'El Salvador': '87283276',
  'Dominican Republic': '87283276',
  'Puerto Rico': '87283276',
  'Colombia': '87487512',
  'Mexico': '87283295',
  'Spain': '87283278',
  'Portugal': '87283278',
  'Germany': '87283278',
  'Switzerland': '87283278',
  'Austria': '87283278',
  'Netherlands': '87283278',
  'Belgium': '87283278',
  'Sweden': '87283278',
  'Norway': '87283278',
  'Denmark': '87283278',
  'Turkey': '87283296',
  'Lebanon': '87283277',
  'Saudi Arabia': '87283277',
  'UAE': '87283277',
  'United Arab Emirates': '87283277',
  'Kuwait': '87283277',
  'Qatar': '87283277',
  'Bahrain': '87283277',
  'Jordan': '87283277',
  'Egypt': '87283277',
  'Oman': '87283277',
};

const INTERNATIONAL_FALLBACK = CAMP_EXPERTS_OFFICE_ID;

// ZIP code routing — more specific (5-digit) entries override 3-digit prefixes
const ZIP_ROUTES = {
  // === MANHATTAN (UWS → Beth Goldstein) ===
  '10023': '87283274',
  '10024': '87283274',
  '10025': '87283274',
  '10069': '87283274',

  // === WESTCHESTER / LOWER HUDSON ===
  '105': '87283309',   // Tarrytown, White Plains prefix → Michele Gershwin
  '106': '87283309',   // Northern Westchester prefix
  '10583': '87283287', // Scarsdale → Emily Salant
  '10580': '87283309', // Rye → Michele Gershwin

  // Southern Westchester → Shari Levine
  '10538': '87283323', // Larchmont
  '10543': '87283323', // Mamaroneck
  '10801': '87283323', // New Rochelle
  '10802': '87283323',
  '10804': '87283323',
  '10805': '87283323',

  // === LONG ISLAND ===
  '110': '87283301',   // Nassau → Laurie Karol
  '115': '87283301',   // Nassau → Laurie Karol
  '11050': '87283307', // Port Washington → Liz Hochman Mak
  '117': '87283289',   // Suffolk → Heather Natter Pasquale
  '118': '87283289',
  '119': '87283289',
  '11747': '87283289', // Melville

  // === NORTHERN NEW JERSEY ===
  '076': '87283280',   // Bergen County → Dara Pasternack
  '074': '87283280',
  '072': '87283280',
  '070': '87283320',   // Essex → Risa Goldberg
  '071': '87283320',
  '07090': '87283297', // Westfield → Lana Ast
  '07040': '87283314', // Maplewood → Natasha Kreizman
  // '07039' (Livingston) removed — Michelle Burger inactive; now flows to Essex 070 → Risa Goldberg

  // === CONNECTICUT ===
  '068': '87283272',   // Fairfield County → Amanda Rothlein
  '069': '87283272',
  '06880': '87283284', // Westport → Emily Rothenberg
  '06830': '87283284', // Greenwich → Emily Rothenberg
  '06870': '87283284', // Old Greenwich → Emily Rothenberg

  // === PHILADELPHIA / DELAWARE ===
  '190': '87283293',   // Philly western suburbs → Jennifer Markizon
  '191': '87283274',   // Philly city → Beth Goldstein
  '193': '87283293',   // Chester County → Jennifer Markizon
  '194': '87283293',   // Norristown/Montgomery → Jennifer Markizon
  '197': '87283274',   // Delaware → Beth Goldstein
  '198': '87283274',
  '199': '87283274',
  '160': '87283274',   // Central PA → Beth Goldstein
  '170': '87283274',   // Harrisburg
  '180': '87283274',   // Lehigh Valley

  // === PITTSBURGH ===
  '150': '87283304',   // Pittsburgh → Lindsey Binstock
  '151': '87283304',
  '152': '87283304',

  // === BALTIMORE / MARYLAND ===
  '210': '87283312',   // Baltimore → Mindy Rosen
  '211': '87283312',
  '212': '87283312',
  '214': '87283312',   // Annapolis
  '206': '87283312',   // Southern MD
  '208': '87283312',   // Suburban MD

  // === DC / VIRGINIA ===
  '200': '87283304',   // DC → Lindsey Binstock
  '201': '87283304',
  '220': '87283304',   // Northern Virginia
  '221': '87283304',   // Arlington/Alexandria
  '222': '87283304',   // Fairfax
  '223': '87283304',
  '230': '87283304',   // Richmond
  '231': '87283304',

  // === NORTH CAROLINA ===
  '270': '87283304', '271': '87283304', '272': '87283304', '273': '87283304',
  '274': '87283304', '275': '87283304', '276': '87283304', '277': '87283304',
  '278': '87283304', '279': '87283304', '280': '87283304', '281': '87283304',
  '283': '87283304', '284': '87283304', '285': '87283304', '286': '87283304',
  '287': '87283304', '288': '87283304', '289': '87283304',

  // === TEXAS ===
  '750': '87283304', '751': '87283304', '752': '87283304', '753': '87283304',
  '760': '87283304', '761': '87283304',
  '770': '87283304', '771': '87283304', '772': '87283304', '773': '87283304',
  '774': '87283304', '775': '87283304', '776': '87283304', '777': '87283304',
  '778': '87283304', '779': '87283304',
  '780': '87283304', '781': '87283304', '782': '87283304', '783': '87283304',
  '784': '87283304', '785': '87283304', '786': '87283304', '787': '87283304',
  '788': '87283304', '789': '87283304',
  '790': '87283304', '791': '87283304', '792': '87283304', '793': '87283304',
  '794': '87283304', '795': '87283304', '796': '87283304', '797': '87283304',
  '798': '87283304', '799': '87283304',

  // === ATLANTA / SOUTHEAST ===
  // Georgia → Tami Feldman
  '300': '87283324', '301': '87283324', '302': '87283324', '303': '87283324',
  '304': '87283324', '305': '87283324', '306': '87283324', '307': '87283324',
  '308': '87283324', '309': '87283324', '310': '87283324', '311': '87283324',
  '312': '87283324', '313': '87283324', '314': '87283324', '315': '87283324',
  '316': '87283324', '317': '87283324', '318': '87283324', '319': '87283324',
  // Tennessee → Tami Feldman
  '370': '87283324', '371': '87283324', '372': '87283324', '373': '87283324',
  '374': '87283324', '375': '87283324', '376': '87283324', '377': '87283324',
  '378': '87283324', '379': '87283324', '380': '87283324', '381': '87283324',
  '382': '87283324', '383': '87283324', '384': '87283324', '385': '87283324',
  // South Carolina → Tami Feldman
  '290': '87283324', '291': '87283324', '292': '87283324', '293': '87283324',
  '294': '87283324', '295': '87283324', '296': '87283324', '297': '87283324',
  '298': '87283324', '299': '87283324',
  // Alabama → Tami Feldman
  '350': '87283324', '351': '87283324', '352': '87283324', '354': '87283324',
  '355': '87283324', '356': '87283324', '357': '87283324', '358': '87283324',
  '359': '87283324', '360': '87283324', '361': '87283324', '362': '87283324',
  '363': '87283324', '364': '87283324', '365': '87283324', '366': '87283324',
  '367': '87283324', '368': '87283324',

  // === SOUTH FLORIDA ===
  // South Miami → Alexandra Neff Allenberg
  '33143': '87283265', '33146': '87283265', '33155': '87283265',
  '33156': '87283265', '33133': '87283265', '33134': '87283265',
  // Cooper City area → Lindsey Schwimmer
  '33024': '87283303', '33026': '87283303', '33028': '87283303',
  '33330': '87283303', '33023': '87283303', '33027': '87283303',
  // North Broward / Boca / Palm Beach → Lisa Borg
  '334': '87283305',
  '33060': '87283305', '33062': '87283305', '33063': '87283305',
  '33064': '87283305', '33065': '87283305', '33066': '87283305',
  '33067': '87283305', '33071': '87283305', '33073': '87283305',
  '33076': '87283305', '33428': '87283305', '33431': '87283305',
  '33432': '87283305', '33433': '87283305', '33434': '87283305',
  '33446': '87283305', '33445': '87283305', '33444': '87283305',
  '33483': '87283305', '33484': '87283305', '33486': '87283305',
  '33487': '87283305', '33496': '87283305', '33498': '87283305',
  // South Broward / Miami-Dade / Aventura → Karen Meister
  '331': '87283296', '330': '87283296',
  '33160': '87283296', '33180': '87283296', '33162': '87283296',
  '33154': '87283296', '33019': '87283296', '33020': '87283296',
  '33021': '87283296', '33009': '87283296',

  // === TAMPA / CENTRAL FLORIDA ===
  '335': '87283269', '336': '87283269', '337': '87283269',
  '338': '87283269', '346': '87283269',

  // === CHICAGO / ILLINOIS ===
  '606': '87283268',   // Chicago city → Alli Sternberg
  // North Shore suburbs → Renee Morris
  '600': '87283318',
  '60035': '87283318', // Highland Park
  '60022': '87283318', // Glencoe
  '60043': '87283318', // Kenilworth
  '60091': '87283318', // Wilmette
  '60093': '87283318', // Winnetka
  // Deerfield / Northbrook → Brooke Rotstein
  '60015': '87283275', // Deerfield
  '60062': '87283275', // Northbrook
  '60045': '87283275', // Lake Forest
  // Broader IL suburbs → Renee Morris
  '601': '87283318', '602': '87283318', '603': '87283318',
  '604': '87283318', '605': '87283318',

  // === OHIO / UPPER MIDWEST → Ashley Garson ===
  '440': '87283273', '441': '87283273', '442': '87283273', '443': '87283273',
  '444': '87283273', '445': '87283273', '446': '87283273', '447': '87283273',
  '448': '87283273', '449': '87283273', '450': '87283273', '451': '87283273',
  '452': '87283273', '453': '87283273', '454': '87283273', '455': '87283273',
  '456': '87283273', '457': '87283273', '458': '87283273',
  // Michigan
  '480': '87283273', '481': '87283273', '482': '87283273', '483': '87283273',
  '484': '87283273', '485': '87283273', '486': '87283273', '487': '87283273',
  '488': '87283273', '489': '87283273', '490': '87283273', '491': '87283273',
  '492': '87283273', '493': '87283273', '494': '87283273', '495': '87283273',
  '496': '87283273', '497': '87283273', '498': '87283273', '499': '87283273',
  // Wisconsin
  '530': '87283273', '531': '87283273', '532': '87283273', '534': '87283273',
  '535': '87283273', '537': '87283273', '538': '87283273', '539': '87283273',
  '540': '87283273', '541': '87283273', '542': '87283273', '543': '87283273',
  '544': '87283273', '545': '87283273', '546': '87283273', '547': '87283273',
  '548': '87283273', '549': '87283273',
  // Minnesota
  '550': '87283273', '551': '87283273', '553': '87283273', '554': '87283273',
  '555': '87283273', '556': '87283273', '557': '87283273', '558': '87283273',
  '559': '87283273', '560': '87283273', '561': '87283273', '562': '87283273',
  '563': '87283273', '564': '87283273', '565': '87283273', '566': '87283273',
  '567': '87283273',

  // === COLORADO → Jaime Altman ===
  '800': '87283291', '801': '87283291', '802': '87283291', '803': '87283291',
  '804': '87283291', '805': '87283291', '806': '87283291', '807': '87283291',
  '808': '87283291', '809': '87283291', '810': '87283291', '811': '87283291',
  '812': '87283291', '813': '87283291', '814': '87283291', '815': '87283291',
  '816': '87283291',

  // === PACIFIC NORTHWEST → Jaime Altman ===
  '980': '87283291', '981': '87283291', '982': '87283291', '983': '87283291',
  '984': '87283291', '985': '87283291', '986': '87283291', '988': '87283291',
  '989': '87283291', '990': '87283291', '991': '87283291', '992': '87283291',
  '993': '87283291', '994': '87283291',
  // Oregon
  '970': '87283291', '971': '87283291', '972': '87283291', '973': '87283291',
  '974': '87283291', '975': '87283291', '976': '87283291', '977': '87283291',
  '978': '87283291', '979': '87283291',

  // === CALIFORNIA → Denise Gordon ===
  '900': '87283281', '901': '87283281', '902': '87283281', '903': '87283281',
  '904': '87283281', '905': '87283281', '906': '87283281', '907': '87283281',
  '908': '87283281', '910': '87283281', '911': '87283281', '912': '87283281',
  '913': '87283281', '914': '87283281', '915': '87283281', '916': '87283281',
  '917': '87283281', '918': '87283281', '919': '87283281', '920': '87283281',
  '921': '87283281', '922': '87283281', '923': '87283281', '924': '87283281',
  '925': '87283281', '926': '87283281', '927': '87283281', '928': '87283281',
  '930': '87283281', '931': '87283281', '932': '87283281', '933': '87283281',
  '934': '87283281', '935': '87283281', '936': '87283281', '937': '87283281',
  '938': '87283281', '939': '87283281', '940': '87283281', '941': '87283281',
  '942': '87283281', '943': '87283281', '944': '87283281', '945': '87283281',
  '946': '87283281', '947': '87283281', '948': '87283281', '949': '87283281',
  '950': '87283281', '951': '87283281', '952': '87283281', '953': '87283281',
  '954': '87283281', '955': '87283281', '956': '87283281', '957': '87283281',
  '958': '87283281', '959': '87283281', '960': '87283281', '961': '87283281',

  // === COVERAGE GAP FILLS (no rule before; assigned to the active expert who
  //     already has the clear historical book in that US region) ===
  '100': MANHATTAN_ROTATION, // Manhattan proper (beyond the explicit zip list) → rotation
  '101': MANHATTAN_ROTATION,
  '102': MANHATTAN_ROTATION,
  '107': '87283309', // Yonkers / central Westchester → Michele Gershwin
  '108': '87283323', // New Rochelle / lower Westchester → Shari Levine
  '112': '87283301', // Brooklyn → Laurie Karol
  '113': '87283301', // Queens → Laurie Karol
  '077': '87283320', // Monmouth / NJ shore → Risa Goldberg
  '078': '87283320',
  '079': '87283320',
  '085': '87283293', // Ocean / South-Central NJ → Jennifer Markizon (nearest active book)
  '189': '87283293', // Poconos / NE PA → Jennifer Markizon

  // === NEW ENGLAND co-expert carve-outs (rest of each state set via STATE_ROUTES) ===
  '021': '87283325', // Greater Boston → Wendy Marks  [ASSUMPTION: confirm Wendy's NE area]
  '10573': '93194078', // Rye Brook / Port Chester → Heather Messer  [ASSUMPTION: confirm her exact towns]

  // === JUMP BALLS → Lindsey Schwimmer ===
  // Low-density / orphaned US regions with no clear active expert AND no
  // whole-state owner. The domestic gap fallback sends every OTHER unmatched
  // US lead here too. (Worcester/SE-MA and Columbus OH were removed — they now
  // belong to their state expert: MA → Emily Rothenberg, OH → Ashley Garson.)
  '109': '87283303', // Rockland / Orange County NY (was Lara Weinberg)
  '080': '87283303', // South Jersey (Camden)
  '088': '87283303', // Central NJ (Trenton fringe)
  '852': '87283303', // Phoenix AZ
  '130': '87283303', // Syracuse NY
};

// Phone area code → owner ID (fallback when no zip)
const AREA_CODE_ROUTES = {
  // NYC
  '212': MANHATTAN_ROTATION, '646': MANHATTAN_ROTATION, '917': MANHATTAN_ROTATION,
  '347': MANHATTAN_ROTATION, '718': MANHATTAN_ROTATION, '929': MANHATTAN_ROTATION,
  // Westchester
  '914': '87283309',
  // Long Island
  '516': '87283301', '631': '87283289',
  // NJ
  '201': '87283280', '551': '87283280', '973': '87283320', '862': '87283320',
  '908': '87283297',
  // CT
  '203': '87283272', '475': '87283272', '860': '87283272',
  // Philly
  '215': '87283274', '267': '87283274', '610': '87283293', '484': '87283293',
  // Baltimore/MD
  '410': '87283312', '443': '87283312',
  // DC/VA
  '202': '87283304', '703': '87283304', '571': '87283304',
  // Pittsburgh
  '412': '87283304',
  // NC
  '704': '87283304', '980': '87283304', '919': '87283304', '984': '87283304',
  '336': '87283304', '743': '87283304', '252': '87283304', '910': '87283304',
  '828': '87283304',
  // TX
  '214': '87283304', '469': '87283304', '972': '87283304', '817': '87283304',
  '713': '87283304', '832': '87283304', '281': '87283304', '346': '87283304',
  '210': '87283304', '512': '87283304', '737': '87283304', '915': '87283304',
  '806': '87283304', '940': '87283304', '254': '87283304', '903': '87283304',
  '936': '87283304', '409': '87283304', '361': '87283304', '956': '87283304',
  '979': '87283304', '830': '87283304', '325': '87283304', '432': '87283304',
  // Atlanta/Southeast
  '404': '87283324', '770': '87283324', '678': '87283324', '470': '87283324',
  '706': '87283324', '762': '87283324', '912': '87283324', '229': '87283324',
  '478': '87283324',
  // TN
  '615': '87283324', '629': '87283324', '901': '87283324', '931': '87283324',
  '865': '87283324', '423': '87283324',
  // SC
  '803': '87283324', '843': '87283324', '854': '87283324', '864': '87283324',
  // AL
  '205': '87283324', '251': '87283324', '256': '87283324', '334': '87283324',
  '938': '87283324',
  // South Florida
  '305': '87283296', '786': '87283296', '954': '87283296',
  '561': '87283305',
  // Tampa
  '813': '87283269', '727': '87283269',
  // Chicago
  '312': '87283268', '773': '87283268', '872': '87283268',
  '847': '87283318', '224': '87283318',
  // Ohio
  '216': '87283273', '440': '87283273', '234': '87283273', '330': '87283273',
  '614': '87283273', '380': '87283273', '513': '87283273', '937': '87283273',
  '419': '87283273', '567': '87283273', '740': '87283273',
  // Michigan
  '248': '87283273', '313': '87283273', '586': '87283273', '734': '87283273',
  '517': '87283273', '616': '87283273',
  // Minnesota
  '612': '87283273', '651': '87283273', '763': '87283273', '952': '87283273',
  // Wisconsin
  '414': '87283273', '262': '87283273', '608': '87283273', '920': '87283273',
  // Colorado
  '303': '87283291', '720': '87283291', '719': '87283291', '970': '87283291',
  // PNW
  '206': '87283291', '425': '87283291', '253': '87283291',
  '503': '87283291', '971': '87283291',
  // California
  '310': '87283281', '323': '87283281', '213': '87283281', '818': '87283281',
  '626': '87283281', '424': '87283281', '408': '87283281', '415': '87283281',
  '510': '87283281', '650': '87283281', '925': '87283281', '707': '87283281',
  '805': '87283281', '858': '87283281', '619': '87283281', '949': '87283281',
  '714': '87283281', '562': '87283281', '951': '87283281', '909': '87283281',
  '760': '87283281', '559': '87283281', '209': '87283281', '916': '87283281',
  '279': '87283281', '530': '87283281', '831': '87283281', '661': '87283281',
  '442': '87283281',
};

// International phone country code → owner ID.
// This is the fix for the "European ZIP collision": a Paris family whose phone
// is +33… but whose Country field was left blank used to fall through to the
// US ZIP table, where "75008" looks exactly like Dallas TX ("750"). Matching on
// the dialing code routes them to the correct international expert FIRST,
// regardless of (or in the absence of) the Country field.
// Keys are dialing codes WITHOUT the leading "+"; longest match wins.
const PHONE_CC_ROUTES = {
  '33': '87283278',  // France → Catherine Visan
  '39': '87283300',  // Italy → Laura Toledo
  '377': '87283300', // Monaco → Laura Toledo
  '44': '87283277',  // United Kingdom → Carrie Fleming
  '353': '87283277', // Ireland → Carrie Fleming
  '972': '87283316', // Israel → Pamela Bank
  '34': '87283278',  // Spain → Catherine Visan
  '351': '87283278', // Portugal → Catherine Visan
  '49': '87283278',  // Germany → Catherine Visan
  '41': '87283278',  // Switzerland → Catherine Visan
  '43': '87283278',  // Austria → Catherine Visan
  '31': '87283278',  // Netherlands → Catherine Visan
  '32': '87283278',  // Belgium → Catherine Visan
  '352': '87283278', // Luxembourg → Catherine Visan
  '46': '87283278',  // Sweden → Catherine Visan
  '47': '87283278',  // Norway → Catherine Visan
  '45': '87283278',  // Denmark → Catherine Visan
  '90': '87283296',  // Turkey → Karen Meister
  '55': '87283276',  // Brazil → Carolina Lautenberg
  '54': '87283276',  // Argentina → Carolina Lautenberg
  '56': '87283276',  // Chile → Carolina Lautenberg
  '58': '87283276',  // Venezuela → Carolina Lautenberg
  '51': '87283317',  // Peru → Pilar Vidal
  '57': '87487512',  // Colombia → Lina & Maria
  '971': '87283277', // UAE → Carrie Fleming
  '966': '87283277', // Saudi Arabia → Carrie Fleming
  '965': '87283277', // Kuwait → Carrie Fleming
  '974': '87283277', // Qatar → Carrie Fleming
  '973': '87283277', // Bahrain → Carrie Fleming
  '961': '87283277', // Lebanon → Carrie Fleming
  '962': '87283277', // Jordan → Carrie Fleming
  '968': '87283277', // Oman → Carrie Fleming
  '20': '87283277',  // Egypt → Carrie Fleming
};

// Whole-state default ownership. Applied AFTER the 5-digit and 3-digit ZIP_ROUTES
// rules above, so metro carve-outs always win and the rest of a single-expert
// state still routes to that expert instead of falling to a jump ball.
// (e.g. NoVA 220-223 → Binstock via ZIP_ROUTES; the rest of Virginia → Binstock here.)
// Multi-expert states (NY, NJ, PA, FL, IL) are intentionally absent — they stay
// governed by their ZIP-3 splits. States absent here with no ZIP rule are genuine
// gaps and fall to the jump-ball owner (Lindsey Schwimmer).
const STATE_ROUTES = {
  'VA': '87283304', 'DC': '87283304', 'NC': '87283304', 'TX': '87283304', // Lindsey Binstock
  'MD': '87283312', // Mindy Rosen
  'DE': '87283274', // Beth Goldstein
  'GA': '87283324', 'TN': '87283324', 'SC': '87283324', 'AL': '87283324', // Tami Feldman
  'OH': '87283273', 'MI': '87283273', 'WI': '87283273', 'MN': '87283273', // Ashley Garson
  'CO': '87283291', 'WA': '87283291', 'OR': '87283291', // Jaime Altman
  'CA': '87283281', // Denise Gordon
  'MA': '87283284', 'RI': '87283284', // Emily Rothenberg (New England core; RI adjacent)
  'CT': '87283272', // Amanda Rothlein (Fairfield + Hartford; gold-coast towns carved to Emily Rothenberg via ZIP_ROUTES)
};

// ZIP-3 prefix → US state (USPS SCF allocation). Used only to apply STATE_ROUTES.
// Each entry: [startPrefix, endPrefix, stateAbbrev].
const ZIP3_STATE_RANGES = [
  [10,27,'MA'],[28,29,'RI'],[30,38,'NH'],[39,49,'ME'],[50,59,'VT'],[60,69,'CT'],
  [70,89,'NJ'],[100,149,'NY'],[150,196,'PA'],[197,199,'DE'],[200,205,'DC'],
  [206,219,'MD'],[220,246,'VA'],[247,268,'WV'],[270,289,'NC'],[290,299,'SC'],
  [300,319,'GA'],[398,399,'GA'],[320,349,'FL'],[350,369,'AL'],[370,385,'TN'],
  [386,397,'MS'],[400,427,'KY'],[430,459,'OH'],[460,479,'IN'],[480,499,'MI'],
  [500,528,'IA'],[530,549,'WI'],[550,567,'MN'],[570,577,'SD'],[580,588,'ND'],
  [590,599,'MT'],[600,629,'IL'],[630,658,'MO'],[660,679,'KS'],[680,693,'NE'],
  [700,714,'LA'],[716,729,'AR'],[730,749,'OK'],[750,799,'TX'],[800,816,'CO'],
  [820,831,'WY'],[832,838,'ID'],[840,847,'UT'],[850,865,'AZ'],[870,884,'NM'],
  [889,898,'NV'],[900,961,'CA'],[967,968,'HI'],[970,979,'OR'],[980,994,'WA'],
  [995,999,'AK'],
];

// HubSpot custom object IDs
const HUBSPOT_CHILD_OBJECT_ID = '2-50911061';
const HUBSPOT_HOUSEHOLD_OBJECT_ID = '2-53610744';

// Expert profiles for AI-powered routing fallback
// When ZIP/area code don't match, AI uses these to pick the best expert
const EXPERT_PROFILES = {
  '87283296': { regions: ['South Florida', 'Miami-Dade', 'Aventura', 'Hollywood FL'], specialty: 'South Florida families, Turkish expats' },
  '87283278': { regions: ['France', 'Spain', 'Germany', 'Central Europe'], specialty: 'European families, French-speaking' },
  '87283274': { regions: ['Philadelphia', 'Delaware', 'Central PA', 'UWS Manhattan'], specialty: 'Philadelphia metro, Delaware, Lehigh Valley' },
  '87283313': { regions: ['Brazil', 'Uruguay', 'Latin America', 'Bergen County NJ', 'South Florida'], specialty: 'Latin American families (Brazil/Uruguay), some Bergen NJ & South FL' },
  '87283276': { regions: ['South America', 'Latin America', 'Argentina', 'Brazil'], specialty: 'Latin American families, Spanish-speaking' },
  '87283325': { regions: ['Manhattan'], specialty: 'Manhattan families (rotation)' },
  '87283267': { regions: ['Manhattan'], specialty: 'Manhattan families (rotation)' },
  '87283293': { regions: ['Philadelphia suburbs', 'Chester County', 'Montgomery County PA'], specialty: 'Philly western suburbs' },
  '87283300': { regions: ['Italy', 'Monaco'], specialty: 'Italian families' },
  '87283277': { regions: ['United Kingdom', 'Ireland', 'Middle East', 'Gulf States'], specialty: 'UK, Ireland, Middle East families' },
  '87283304': { regions: ['DC', 'Virginia', 'North Carolina', 'Texas', 'Pittsburgh'], specialty: 'DC/Virginia metro, Carolinas, Texas' },
  '87283272': { regions: ['Connecticut', 'Fairfield County'], specialty: 'Connecticut families' },
  '87283316': { regions: ['Israel'], specialty: 'Israeli families' },
  '87283269': { regions: ['Tampa', 'Central Florida'], specialty: 'Tampa Bay, Central Florida' },
  '87283309': { regions: ['Westchester NY', 'White Plains', 'Tarrytown'], specialty: 'Northern Westchester' },
  '87283320': { regions: ['Northern New Jersey', 'Essex County NJ'], specialty: 'North Jersey, Essex County' },
  '87283284': { regions: ['Westport CT', 'Greenwich CT'], specialty: 'Fairfield County gold coast' },
  '87283324': { regions: ['Georgia', 'Atlanta', 'Tennessee', 'South Carolina', 'Alabama'], specialty: 'Southeast US' },
  '87283280': { regions: ['Bergen County NJ', 'Northern NJ'], specialty: 'Bergen County, North Jersey' },
  '87283265': { regions: ['South Miami', 'Coral Gables', 'Coconut Grove'], specialty: 'South Miami, Coral Gables' },
  '87283287': { regions: ['Scarsdale NY', 'Westchester'], specialty: 'Scarsdale area' },
  '87283318': { regions: ['North Shore Chicago', 'Highland Park IL', 'Illinois suburbs'], specialty: 'Chicago North Shore, broader IL suburbs' },
  '87283323': { regions: ['Southern Westchester', 'Larchmont', 'Mamaroneck', 'New Rochelle'], specialty: 'Southern Westchester' },
  '87283317': { regions: ['Peru', 'South America'], specialty: 'Peruvian families' },
  '87283301': { regions: ['Nassau County', 'Long Island'], specialty: 'Nassau County, Long Island' },
  '87283312': { regions: ['Baltimore', 'Maryland'], specialty: 'Baltimore metro, Maryland' },
  '87283297': { regions: ['Westfield NJ'], specialty: 'Westfield NJ area' },
  '87283275': { regions: ['Deerfield IL', 'Northbrook IL', 'Lake Forest IL'], specialty: 'Chicago North Shore specific suburbs' },
  '87283305': { regions: ['Boca Raton', 'Palm Beach', 'North Broward'], specialty: 'Palm Beach, Boca, North Broward' },
  '87283314': { regions: ['Maplewood NJ'], specialty: 'Maplewood NJ area' },
  '87283307': { regions: ['Port Washington NY', 'Long Island'], specialty: 'Port Washington area' },
  '87487512': { regions: ['Colombia'], specialty: 'Colombian families' },
  '87283291': { regions: ['Colorado', 'Denver', 'Pacific Northwest', 'Washington', 'Oregon'], specialty: 'Colorado, Pacific Northwest' },
  '87283273': { regions: ['Ohio', 'Michigan', 'Wisconsin', 'Minnesota'], specialty: 'Upper Midwest' },
  '87283289': { regions: ['Suffolk County', 'Long Island'], specialty: 'Suffolk County, Eastern Long Island' },
  '87283281': { regions: ['California', 'Los Angeles', 'San Francisco', 'Bay Area'], specialty: 'All of California' },
  '87283303': { regions: ['Cooper City FL', 'Pembroke Pines', 'Southwest Broward', 'National gap coverage'], specialty: 'Southwest Broward County; jump-ball / national gap coverage for low-density & uncovered US areas' },
  '93194078': { regions: ['Rye Brook NY', 'Port Chester', 'Westchester'], specialty: 'Rye Brook / eastern Westchester' },
  '87283268': { regions: ['Chicago city'], specialty: 'City of Chicago proper' },
  '87283310': { regions: ['Livingston NJ'], specialty: 'Livingston NJ area' },
};

module.exports = {
  EXPERTS,
  INACTIVE_OWNER_IDS,
  EXCLUDED_OWNER_IDS,
  CAMP_EXPERTS_OFFICE_ID,
  JUMP_BALL_OWNER_ID,
  WENDY_ID,
  ALLISON_ID,
  MANHATTAN_ROTATION,
  UWS_ZIPS,
  MANHATTAN_ZIPS,
  EXPERT_SLUGS,
  INTERNATIONAL_ROUTES,
  INTERNATIONAL_FALLBACK,
  ZIP_ROUTES,
  STATE_ROUTES,
  ZIP3_STATE_RANGES,
  AREA_CODE_ROUTES,
  PHONE_CC_ROUTES,
  EXPERT_PROFILES,
  HUBSPOT_CHILD_OBJECT_ID,
  HUBSPOT_HOUSEHOLD_OBJECT_ID,
};
