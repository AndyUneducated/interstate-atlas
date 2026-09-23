// Fetches per-route figures from FHWA's Highway Performance Monitoring System.
//
//   node tools/fetch-hpms.mjs
//
// HPMS is what the states report to FHWA each year about every mile of the
// federal-aid network: traffic counts, pavement roughness, lane counts, speed
// limits, when the road was last worked on. It is the authoritative answer to
// most of what this atlas wants to say about a road beyond where it goes, and
// it is the only source here that is measured rather than mapped.
//
// The 2024 national release is 19.5 million sections and 49 GB as published,
// which is not a build dependency anyone should take on. But the same data sits
// behind a query API that will group and sum server-side, and the atlas needs
// only one row per route per state - about 25,000 rows, a few megabytes. So the
// arithmetic is done at their end and only the answer travels.
//
// Nothing here is spatial. HPMS names the route it is describing, so its
// figures are joined to this atlas's routes by designation - state, system,
// number - and never by position. That means a wrong geometry cannot silently
// attach itself to the right traffic count, and vice versa.

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { STATES } from './tiger.mjs';

// The reporting year these figures describe, which the site states rather than
// letting a 2024 traffic count read as today's.
export const HPMS_YEAR = 2024;

const BASE = 'https://data.transportation.gov/resource/42um-tgh5.json';
const OUT = join('content', 'reference', 'hpms.json');

// HPMS's own code for how a route is signed. 5 is an off-Interstate business
// marker, which this atlas folds into the Interstate it belongs to; 6 and above
// are county, township and municipal, which it does not carry.
const SIGNING = { 2: 'us-interstate', 3: 'us-numbered', 4: 'us-state', 5: 'us-interstate' };

/**
 * Where `route_signing` is not usable, read the designation out of `route_id`.
 *
 * The signing field is reported by the states and four of them do not report
 * it in a way that can be read. Texas fills it for its Interstates and leaves
 * it blank for the 338,000 miles of everything else; Massachusetts does the
 * same; Maryland marks its entire network "not signed" while still numbering
 * it. In each case the designation is sitting in the route identifier instead,
 * in a format that state uses consistently.
 *
 * Only these are listed, because a route identifier means whatever its state
 * decided it means. Tennessee's is a fifteen-character string whose interior
 * is mostly stable and occasionally is not, and a format that is nearly right
 * is worse here than no format: it would attach real traffic counts to the
 * wrong road. Tennessee is left unmatched and reported as such.
 */
// Each entry also carries the filter that keeps the query to numbered roads.
// Local roads share the route_id field - Texas has 488,504 distinct values and
// Massachusetts 209,082, nearly all of them residential streets - so without a
// filter the result is a page of local roads and no highways at all.
const starts = (cols) => `(${cols.map((c) => `starts_with(route_id,'${c}')`).join(' OR ')})`;

const ID_FORMATS = {
  // "IH0010-KG", "US0083-KG", "SH0016-KG", "FM1960-KG". The trailing letters
  // distinguish carriageways and frontage roads, which are summed together.
  TX: {
    re: /^(IH|US|SH|FM|RM|SL|SS|BI|BU|BS)(\d{4})/,
    map: {
      IH: 'us-interstate', BI: 'us-interstate', US: 'us-numbered', BU: 'us-numbered',
      SH: 'us-state', FM: 'us-state', RM: 'us-state', SL: 'us-state', SS: 'us-state', BS: 'us-state',
    },
    // Texas's farm and ranch roads are a system of their own, so their numbers
    // carry the prefix, matching how the geometry reads them.
    prefix: { FM: 'FM', RM: 'RM' },
    where: starts(['IH', 'US', 'SH', 'FM', 'RM', 'SL', 'SS', 'BI', 'BU', 'BS']),
  },
  // "I90 EB", "US20 WB", "SR28 NB"
  MA: {
    re: /^(I|US|SR)(\d{1,4})/,
    map: { I: 'us-interstate', US: 'us-numbered', SR: 'us-state' },
    where: starts(['I', 'US', 'SR']),
  },
  // "03000IS00695--2-----", "18000MD00005--2-----": five digits of county,
  // then the type, then the number.
  MD: {
    re: /^\d{5}(IS|US|MD)(\d{5})/,
    map: { IS: 'us-interstate', US: 'us-numbered', MD: 'us-state' },
    where: "(route_id like '_____IS%' OR route_id like '_____US%' "
      + "OR route_id like '_____MD%')",
  },
};

/** The route a `route_id` names, for the states whose format is known. */
function fromRouteId(st, id) {
  const fmt = ID_FORMATS[st];
  if (!fmt) return null;
  const m = fmt.re.exec(String(id ?? '').trim().toUpperCase());
  if (!m) return null;
  const system = fmt.map[m[1]];
  if (!system) return null;
  const number = String(Number(m[2]) || m[2]);
  if (!number || number === '0') return null;
  return { system, number: `${fmt.prefix?.[m[1]] ?? ''}${number}` };
}

// Functional class 1 and 2 are the Interstates and the other freeways and
// expressways - the roads built to motorway standard. This is FHWA's own
// classification and replaces guessing from a road's name.
const FREEWAY_CLASSES = '(1,2)';

/**
 * One measure of a route, as a numerator and the length that reported it.
 *
 * Coverage is uneven and unevenly distributed: pavement roughness is collected
 * on the NHS and patchily elsewhere, so a route's roughness may describe a
 * tenth of it. Carrying the denominator is what lets the site say how much of
 * the road a figure covers, rather than presenting a tenth as the whole.
 */
const WEIGHTED = {
  aadt: 'aadt',
  truck: 'aadt_combination',
  iri: 'iri',
  lanes: 'through_lanes',
  speed: 'speed_limit',
  rutting: 'rutting',
  cracking: 'cracking_percent',
};

/**
 * How precisely each measure is worth reporting, in the measure's own unit.
 *
 * Exported because the build averages these a second time, across the states a
 * route runs through, and has to round the same way; a rut rounded to the inch
 * in either place is a rut reported as nothing.
 */
export const STEPS = {
  aadt: 100, truck: 10, iri: 1, lanes: 0.1, speed: 1, rutting: 0.01, cracking: 0.1,
};

const select = (keys) => [
  keys,
  'sum(sectionlength) as mi',
  'count(*) as sections',
  ...Object.entries(WEIGHTED).flatMap(([name, col]) => [
    `sum(case(${col} IS NOT NULL, ${col}*sectionlength, true, 0)) as ${name}_w`,
    `sum(case(${col} IS NOT NULL, sectionlength, true, 0)) as ${name}_mi`,
  ]),
  'max(aadt) as aadt_max',
  `sum(case(f_system in ${FREEWAY_CLASSES}, sectionlength, true, 0)) as freeway_mi`,
  'sum(case(toll_id IS NOT NULL, sectionlength, true, 0)) as toll_mi',
  'sum(case(nhs > 0, sectionlength, true, 0)) as nhs_mi',
  'sum(number_signals) as signals',
  'max(year_last_improvement) as improved',
  'max(year_last_construction) as constructed',
  'max(future_aadt) as future_aadt',
].join(',');

const url = (fips, byId) => `${BASE}?` + Object.entries(byId ? {
  $select: select('route_id'),
  $where: `stateid=${Number(fips)} AND ${ID_FORMATS[STATES[fips]].where}`,
  $group: 'route_id',
  $limit: '50000',
} : {
  $select: select('route_signing,route_number'),
  $where: `stateid=${Number(fips)} AND route_number IS NOT NULL `
    + 'AND route_signing in (2,3,4,5)',
  $group: 'route_signing,route_number',
  $limit: '20000',
}).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

const n = (v) => (v == null || v === '' ? null : Number(v));
const year = (v) => (v ? Number(String(v).slice(0, 4)) || null : null);

// A weighted mean, with the share of the route it was measured over. Rounded to
// the step the underlying measure actually carries: traffic to the hundred,
// roughness and speeds to the whole unit, rut depth to the hundredth of an inch.
// A rut is a tenth of an inch deep, so rounding it like a speed limit would
// report every road in the country as perfectly flat.
function mean(row, name, mi, { step = 1 } = {}) {
  const w = row[`${name}_w`];
  const known = row[`${name}_mi`];
  if (!w || !known || known <= 0) return null;
  const dp = Math.max(0, -Math.floor(Math.log10(step)));
  return {
    v: Number((Math.round((w / known) / step) * step).toFixed(dp)),
    cover: Math.min(100, Math.round((known / Math.max(mi, 1e-9)) * 100)),
  };
}

/**
 * Add one HPMS row into the running totals for a route.
 *
 * Several rows land on one route and have to be combined rather than picked
 * between: a business route reports under its parent's number, and Texas gives
 * each carriageway and frontage road of a highway its own identifier. Summing
 * the numerators and their denominators separately means the combined figure is
 * still a length-weighted mean over everything that reported it.
 */
function accumulate(into, row) {
  const mi = n(row.mi) ?? 0;
  if (mi <= 0) return;
  into.mi = (into.mi ?? 0) + mi;
  into.sections = (into.sections ?? 0) + (n(row.sections) ?? 0);
  for (const name of Object.keys(WEIGHTED)) {
    into[`${name}_w`] = (into[`${name}_w`] ?? 0) + (n(row[`${name}_w`]) ?? 0);
    into[`${name}_mi`] = (into[`${name}_mi`] ?? 0) + (n(row[`${name}_mi`]) ?? 0);
  }
  for (const f of ['freeway_mi', 'toll_mi', 'nhs_mi', 'signals']) {
    into[f] = (into[f] ?? 0) + (n(row[f]) ?? 0);
  }
  into.aadt_max = Math.max(into.aadt_max ?? 0, n(row.aadt_max) ?? 0);
  into.future_aadt = Math.max(into.future_aadt ?? 0, n(row.future_aadt) ?? 0);
  for (const f of ['improved', 'constructed']) {
    const y = year(row[f]);
    if (y && (!into[f] || y > into[f])) into[f] = y;
  }
}

/** Turn the running totals into the record the build reads. */
function finish(acc) {
  const mi = acc.mi ?? 0;
  const share = (v) => (mi > 0 ? Math.round(((v ?? 0) / mi) * 1000) / 10 : null);
  return {
    mi: Math.round(mi * 10) / 10,
    sections: acc.sections,
    aadt: mean(acc, 'aadt', mi, { step: STEPS.aadt }),
    aadtMax: acc.aadt_max || null,
    truck: mean(acc, 'truck', mi, { step: STEPS.truck }),
    iri: mean(acc, 'iri', mi, { step: STEPS.iri }),
    lanes: mean(acc, 'lanes', mi, { step: STEPS.lanes }),
    speed: mean(acc, 'speed', mi, { step: STEPS.speed }),
    rutting: mean(acc, 'rutting', mi, { step: STEPS.rutting }),
    cracking: mean(acc, 'cracking', mi, { step: STEPS.cracking }),
    freeway: share(acc.freeway_mi),
    tolled: share(acc.toll_mi),
    nhs: share(acc.nhs_mi),
    signals: acc.signals || null,
    improved: acc.improved ?? null,
    constructed: acc.constructed ?? null,
    futureAadt: acc.future_aadt || null,
  };
}

async function fetchState(fips) {
  const st = STATES[fips];
  const byId = Boolean(ID_FORMATS[st]);
  const res = await fetch(url(fips, byId));
  if (!res.ok) throw new Error(`${st}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const rows = await res.json();
  const acc = new Map();

  for (const row of rows) {
    const route = byId
      ? fromRouteId(st, row.route_id)
      : (() => {
        const system = SIGNING[Number(row.route_signing)];
        const number = String(row.route_number ?? '').trim();
        return system && number && number !== '0' ? { system, number } : null;
      })();
    if (!route) continue;
    const key = `${route.system}|${route.number}`;
    if (!acc.has(key)) acc.set(key, {});
    accumulate(acc.get(key), row);
  }

  const out = {};
  for (const [key, a] of acc) if ((a.mi ?? 0) > 0) out[key] = finish(a);
  return { rows: out, byId };
}

async function main() {
  const fipsList = Object.keys(STATES);
  const byState = {};
  let routes = 0;

  for (const fips of fipsList) {
    const st = STATES[fips];
    try {
      const { rows, byId } = await fetchState(fips);
      byState[st] = rows;
      routes += Object.keys(rows).length;
      console.log(`  ${st}  ${String(Object.keys(rows).length).padStart(4)} routes`
        + (byId ? '   (read from route_id)' : ''));
    } catch (e) {
      console.log(`  ${st}  failed: ${e.message}`);
      byState[st] = {};
    }
  }

  await mkdir(join('content', 'reference'), { recursive: true });
  await writeFile(OUT, `${JSON.stringify({
    source: `FHWA Highway Performance Monitoring System, ${HPMS_YEAR} release`,
    year: HPMS_YEAR,
    url: 'https://data.transportation.gov/Roadways-and-Bridges/HPMS-Spatial-All-Sections-2024/42um-tgh5',
    retrieved: new Date().toISOString().slice(0, 10),
    note: 'Aggregated per route per state from section-level records. Each '
      + 'measure carries the share of the route\'s reported length it was '
      + 'measured over; HPMS collects pavement condition on the National '
      + 'Highway System and patchily elsewhere.',
    states: byState,
  }, null, 1)}\n`);

  console.log(`\nwrote ${OUT}: ${routes} route records across ${Object.keys(byState).length} states`);
}

// Only fetch when run directly. The build imports this module for STEPS.
if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
