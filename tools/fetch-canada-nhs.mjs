// Fetches Canada's National Highway System into tools/src/ca/ and its published
// inventory into content/reference/.
//
//   node tools/fetch-canada-nhs.mjs
//
// The NHS is the designated national network, agreed jointly by the federal,
// provincial and territorial governments through the Council of Ministers. It
// is the closest Canadian counterpart to the US Interstate register: a
// designated network with a published inventory, rather than a signed route
// system with its own markers.
//
// Two reasons this comes from Transport Canada rather than from the road file
// already downloaded by fetch-canada.mjs:
//
//   * The NRN carries route numbers but no designation, so nothing in it says
//     which roads are on the NHS.
//   * Statistics Canada does publish NHS layers, but they are empty for Yukon
//     and the Northwest Territories, which between them hold 1,644 km of
//     designated core network. Transport Canada's own layer is complete and
//     additionally carries the Core / Feeder / Northern and Remote tier that
//     the inventory reports against.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SRC = join(import.meta.dirname, 'src', 'ca');
const REF = join(import.meta.dirname, '..', 'content', 'reference');
const LAYER = 'https://maps-cartes.services.geo.ca/server_serveur/rest/services/TC/canada_national_highway_system_en/MapServer/0';
const PAGE = 1000;
const HEADERS = { 'user-agent': 'highway-atlas/1.0 (open data build script)' };

const BLANK = new Set(['Unknown', 'None', 'Inconnu', 'Aucun', '']);
export const clean = (v) => {
  const s = String(v ?? '').trim();
  return s && !BLANK.has(s) ? s : null;
};

// Long names in the source, short codes everywhere else. "QC/NL" marks segments
// on the Quebec-Labrador boundary, which the inventory reports under Quebec.
const JURIS = {
  'British Columbia': 'BC',
  Alberta: 'AB',
  Saskatchewan: 'SK',
  Manitoba: 'MB',
  Ontario: 'ON',
  Quebec: 'QC',
  'QC/NL': 'QC',
  'New Brunswick': 'NB',
  'Nova Scotia': 'NS',
  'Prince Edward Island': 'PE',
  'Newfoundland and Labrador': 'NL',
  'Yukon Territory': 'YT',
  'Northwest Territories': 'NT',
  Nunavut: 'NU',
};

const FIELDS = [
  'rtnumber1', 'rtnumber2', 'rtnumber3', 'rtnumber4', 'rtnumber5',
  'rtename1', 'rtename2', 'rtename3', 'rtename4',
  'roadclass', 'nbrlanes', 'pavstatus', 'pavsurf', 'unpavsurf', 'speed',
  'trafficdir', 'structtype', 'l_placenam', 'r_placenam', 'l_stname_c',
  'datasetnam', 'desc_en', 'roadjuris', 'accuracy', 'credate', 'revdate',
].join(',');

async function page(offset) {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: FIELDS,
    returnGeometry: 'true',
    outSR: '4326',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE),
    orderByFields: 'OBJECTID',
    f: 'geojson',
  });
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(`${LAYER}/query?${params}`, { headers: HEADERS });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const body = await res.json();
      if (body.error) throw new Error(body.error.message || 'service error');
      return body.features || [];
    } catch (e) {
      if (attempt === 4) throw e;
      await new Promise((r) => setTimeout(r, attempt * 2500));
    }
  }
  return [];
}

/**
 * Canada's National Highway System inventory.
 *
 * Transcribed from the Council of Ministers' annual report, which publishes
 * only as a PDF. Every figure carries the year it describes, because they are
 * not all the same year: the length inventory is a December snapshot while
 * travel and collision counts lag a year behind it.
 *
 * This is the Canadian counterpart to the FHWA tables the US side is built on,
 * and it covers the same ground - how long, how busy, how safe, how much it
 * cost, what condition it is in - but it reports by network tier and
 * jurisdiction rather than per route, so it is presented that way too.
 */
const INVENTORY = {
  source: {
    title: "Canada's National Highway System Annual Report 2017",
    publisher: 'Council of Ministers Responsible for Transportation and Highway Safety',
    url: 'https://comt.ca/Reports/NHS%20Annual%202017.pdf',
    designation: 'Transport Canada, National Highway System',
    designationUrl: 'https://tc.canada.ca/en/corporate-services/policies/national-highway-system',
    note: 'The 2005 expanded NHS has three categories: Core routes are the key interprovincial and international corridors; Feeder routes link other population and economic centres to the Core; Northern and Remote routes are the primary means of access to northern areas and resources.',
  },
  lengthKm: {
    asOf: '2017-12-31',
    byJurisdiction: {
      NL: { core: 1007.6, feeder: 298.0, northern: 1161.0, total: 2466.6 },
      PE: { core: 208.7, feeder: 189.5, northern: 0, total: 398.2 },
      NS: { core: 904.7, feeder: 294.3, northern: 0, total: 1199.0 },
      NB: { core: 994.6, feeder: 818.4, northern: 0, total: 1813.0 },
      QC: { core: 3436.9, feeder: 770.9, northern: 1435.6, total: 5643.4 },
      ON: { core: 6134.8, feeder: 682.0, northern: 0, total: 6816.8 },
      MB: { core: 985.2, feeder: 740.6, northern: 368.2, total: 2094.0 },
      SK: { core: 2451.2, feeder: 0, northern: 236.3, total: 2687.5 },
      AB: { core: 4088.5, feeder: 215.5, northern: 196.5, total: 4500.6 },
      BC: { core: 5869.3, feeder: 446.7, northern: 724.0, total: 7040.0 },
      YT: { core: 1068.6, feeder: 0, northern: 947.9, total: 2016.5 },
      NT: { core: 575.6, feeder: 0, northern: 847.2, total: 1422.8 },
      NU: { core: 0, feeder: 0, northern: 0, total: 0 },
    },
    national: { core: 27725.7, feeder: 4455.9, northern: 5916.7, total: 38098.4 },
    shareOfPublicRoadNetworkPct: 3.7,
    note: 'Nunavut has no NHS mileage: no highway connects any Nunavut community to another, or to the rest of Canada.',
  },
  travel: {
    year: 2016,
    unit: 'millions of vehicle-kilometres',
    byTier: { core: 132409, feeder: 7659, northern: 978, total: 141046 },
    truckTotal: 20000,
    changeSince2005Pct: 18,
    truckChangeSince2005Pct: 8,
    northernTruckChangeSince2005Pct: 81,
  },
  safety: {
    year: 2016,
    collisions: 79000,
    fatalities: 440,
    injuries: 23000,
    collisionsPerBillionVehicleKm: 653,
    note: 'Collision rates run 17% higher on the Feeder network and 23% higher on the Northern and Remote network than on the Core network.',
  },
  investment: {
    fiscalYear: '2017/18',
    annualBillionCad: 3.9,
    since2006BillionCad: 43,
    splitBillionCad: { provincialTerritorial: 37.1, federal: 5.1, other: 0.8 },
  },
  pavement: {
    year: 2017,
    goodConditionPct: 73,
    unpavedKm: 1700,
    unpavedPct: 4,
    note: 'Pavement condition has improved steadily since 2006, and the unpaved share of the network has more than halved.',
  },
  bridges: {
    year: 2017,
    count: 10805,
    underTenYearsOld: 2346,
    note: 'The number of bridges less than ten years old doubled between 2006 and 2017, reflecting increased investment and new construction.',
  },
  trade: {
    note: 'Since 2006 over $4 trillion in Canada-US trade has crossed border crossings on the NHS. Tourism at those crossings is worth about $12 billion a year.',
  },
};

async function main() {
  await mkdir(SRC, { recursive: true });
  await mkdir(REF, { recursive: true });

  const res = await fetch(`${LAYER}/query?where=1%3D1&returnCountOnly=true&f=json`, { headers: HEADERS });
  const { count } = await res.json();
  console.log(`Transport Canada National Highway System: ${count} segments\n`);

  const features = [];
  for (let offset = 0; offset < count; offset += PAGE) {
    const batch = await page(offset);
    features.push(...batch);
    process.stdout.write(`\r  ${String(Math.min(offset + PAGE, count)).padStart(6)}/${count}  `
      + `${String(Math.round((features.length / count) * 100)).padStart(3)}%`);
    if (!batch.length) break;
  }
  console.log(`\n  ${features.length} segments retrieved`);

  await writeFile(join(SRC, 'nhs.geojson'), JSON.stringify({
    type: 'FeatureCollection',
    source: {
      title: "Canada's National Highway System",
      publisher: 'Transport Canada',
      url: LAYER,
      licence: 'Open Government Licence - Canada',
      retrieved: new Date().toISOString().slice(0, 10),
    },
    features,
  }));

  // The register: which numbered routes are designated, and at which tier.
  // Derived from the layer rather than transcribed, so it stays in step with it.
  const register = {};
  const tierKm = {};
  for (const f of features) {
    const p = f.properties;
    const pr = JURIS[p.datasetnam];
    if (!pr) continue;
    const tier = { Core: 'core', Feeder: 'feeder', 'Northern and Remote': 'northern' }[p.desc_en];
    if (!tier) continue;
    (tierKm[pr] ||= { core: 0, feeder: 0, northern: 0 });
    const nums = [p.rtnumber1, p.rtnumber2, p.rtnumber3, p.rtnumber4, p.rtnumber5].map(clean).filter(Boolean);
    const slot = (register[pr] ||= { core: new Set(), feeder: new Set(), northern: new Set() });
    for (const n of nums) slot[tier].add(n);
  }

  const sortNums = (set) => [...set].sort(
    (a, b) => (Number.parseInt(a, 10) || 1e9) - (Number.parseInt(b, 10) || 1e9) || a.localeCompare(b),
  );
  const out = {};
  for (const [pr, slot] of Object.entries(register)) {
    out[pr] = { core: sortNums(slot.core), feeder: sortNums(slot.feeder), northern: sortNums(slot.northern) };
  }

  await writeFile(join(REF, 'canada-nhs.json'), `${JSON.stringify({
    source: {
      title: "Canada's National Highway System",
      publisher: 'Transport Canada',
      note: 'NHS as officially accepted by the Council of Ministers, mapping by Transport Canada.',
      url: LAYER,
      licence: 'Open Government Licence - Canada',
      retrieved: new Date().toISOString().slice(0, 10),
      segments: features.length,
    },
    register: out,
    inventory: INVENTORY,
  }, null, 2)}\n`);

  console.log('\ndesignated route numbers by jurisdiction:');
  for (const [pr, r] of Object.entries(out).sort()) {
    console.log(`  ${pr}  core ${String(r.core.length).padStart(3)}   feeder ${String(r.feeder.length).padStart(3)}`
      + `   northern ${String(r.northern.length).padStart(3)}`);
  }
  console.log('\nwrote tools/src/ca/nhs.geojson and content/reference/canada-nhs.json');
}

main().catch((e) => { console.error(e); process.exit(1); });
