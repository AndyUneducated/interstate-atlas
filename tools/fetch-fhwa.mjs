// Scrapes the FHWA Route Log and Finder List into a committed reference file.
//
//   node tools/fetch-fhwa.mjs
//
// The Route Log is the official record of the Interstate System: for every
// route it gives the mileage in each state, as reported by the states and
// reviewed by FHWA, plus the towns of 5,000+ that the route serves. That makes
// it the one source that can put an authoritative number next to every one of
// the ~3,500 Interstate designations, rather than only the curated few.
//
// The output is committed rather than fetched at build time, so builds stay
// offline and reproducible and so the retrieval date is pinned next to the
// numbers it describes.

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const BASE = 'https://www.fhwa.dot.gov/planning/national_highway_system/interstate_highway_system/routefinder';
const OUT = join(import.meta.dirname, '..', 'content', 'reference');

const ST = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO',
  Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID',
  Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA',
  Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
  Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'N. Carolina': 'NC', 'North Dakota': 'ND', 'N. Dakota': 'ND',
  Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI',
  'South Carolina': 'SC', 'S. Carolina': 'SC', 'South Dakota': 'SD', 'S. Dakota': 'SD',
  Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA',
  Washington: 'WA', 'West Virginia': 'WV', 'W. Virginia': 'WV', Wisconsin: 'WI',
  Wyoming: 'WY', 'District of Columbia': 'DC', 'Dist. of Columbia': 'DC',
  'Puerto Rico': 'PR',
};

const strip = (s) => s
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&#\d+;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const num = (s) => {
  const v = parseFloat(strip(s).replace(/,/g, ''));
  return Number.isFinite(v) ? v : null;
};

// Most designations are plain, but Texas runs three branches of I-69 that the
// log files as "I-69 Central", "I-69 East" and "I-69 West". They are separate
// roads with separate TOTAL rows, so the pattern has to admit the suffix;
// without it their totals land on I-69 and the last one read wins.
const ROUTE_RE = /^(?:I|A|H|PRI)-\d+[A-Z]?(?: (?:Central|East|West|North|South))?$/;

/**
 * Both tables share a layout: a header cell naming the route, then one row per
 * state it runs through, then (in table 1 only) a TOTAL row.
 *
 * `continuous` distinguishes the two tables, and the distinction matters. A
 * main route with rows for Ohio and Indiana is one road crossing a state line,
 * so its states sum to a route length. An auxiliary route with rows for
 * California and Oregon is two unrelated roads that happen to share a number,
 * so summing them would be meaningless. Per-state mileage is therefore the
 * atom here; callers add up only the states their route actually touches.
 */
function parseTable(html, continuous) {
  const routes = {};
  let current = null;

  for (const rowMatch of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<(t[hd])([^>]*)>([\s\S]*?)<\/\1>/gi)]
      .map((m) => ({ attrs: m[2], html: m[3], text: strip(m[3]) }));
    if (!cells.length) continue;

    let i = 0;
    // Routes spanning several states carry a rowspan; single-state routes do
    // not, so match on the text rather than the attribute. No state name can
    // be mistaken for a designation.
    if (ROUTE_RE.test(cells[0].text)) {
      current = cells[0].text;
      routes[current] ||= { total: null, states: {}, cities: {}, continuous };
      i = 1;
    }
    if (!current) continue;

    const label = cells[i]?.text || '';
    if (/^TOTAL$/i.test(label)) {
      routes[current].total = num(cells[i + 1]?.html || '');
      continue;
    }
    const code = ST[label];
    if (!code) continue;

    const miles = num(cells[i + 1]?.html || '');
    if (miles != null) routes[current].states[code] = miles;

    // Table 1 separates towns with commas, table 2 with semicolons.
    const cityCell = cells[cells.length - 1]?.text || '';
    if (cityCell && cityCell !== '-') {
      const names = cityCell.split(/[;,]/)
        .map((c) => c.trim().replace(/\*$/, '').trim())
        .filter((c) => c.length > 2 && /^[A-Za-z]/.test(c));
      if (names.length) routes[current].cities[code] = names;
    }
  }

  for (const r of Object.values(routes)) {
    const sum = Math.round(Object.values(r.states).reduce((s, v) => s + v, 0) * 100) / 100;
    // A single-state main route has no separate TOTAL row to read.
    if (r.continuous && r.total == null) r.total = sum || null;
    // The log's own totals do not always equal its own state rows: I-57's
    // total omits the Arkansas mileage designated after the total was struck.
    // Record both rather than silently preferring one, and note it, so nothing
    // downstream has to guess which number it is looking at.
    if (r.total != null && Math.abs(r.total - sum) > 0.5) {
      r.sumOfStates = sum;
      r.note = 'published total does not equal the sum of its own state rows';
    }
  }
  return routes;
}

async function grab(name) {
  const res = await fetch(`${BASE}/${name}.cfm`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.text();
}

const COST_URL = 'https://www.fhwa.dot.gov/highwayhistory/data/page03.cfm';

/**
 * Parse "Estimated Cost of Individual Interstate Routes" from FHWA's
 * Interstate System engineering data.
 *
 * This is the only published per-route cost accounting for the system. It is
 * drawn from the 1991 Interstate Cost Estimate and gives, for each route in
 * each state, the state-plus-federal cost of Interstate Construction work:
 * preliminary engineering, right-of-way and construction. Figures are in
 * thousands of dollars and are not inflation-adjusted.
 *
 * Its limits matter as much as its contents, and are recorded alongside it:
 * it counts only IC-funded work, so the turnpikes folded into the system are
 * absent; obligations are cut off at the end of 1989; and the route
 * descriptions reflect the extents of that time, which is why I-40 is
 * described as ending at Benson rather than Wilmington.
 */
function parseCosts(html) {
  const start = html.search(/Estimated Cost of Individual/i);
  if (start < 0) throw new Error('cost table not found on the page');

  const routes = {};
  let current = null;

  for (const m of html.slice(start).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...m[1].matchAll(/<(t[hd])[^>]*>([\s\S]*?)<\/\1>/gi)].map((c) => strip(c[2]));
    if (!cells.length) continue;

    // A route header is a single wide cell naming the route and its extent.
    const head = cells[0].match(/^Interstate Route\s+([A-Z]*-?[\dA-Z]+)\s*[-–]\s*(.+)$/i);
    if (head) {
      const num = head[1].replace(/^-/, '');
      const key = /^(H|A|PRI)-/i.test(num) ? num.toUpperCase() : `I-${num}`;
      current = key;
      routes[key] ||= { description: head[2].trim(), states: {}, total: null };
      continue;
    }
    // Aggregate rows the table uses for unassigned spending.
    if (/^(Misc Routes|Other Costs|Total)/i.test(cells[0])) { current = null; continue; }
    if (!current) continue;

    const code = ST[cells[0]];
    if (!code) continue;
    // Columns: state, remaining, obligations, unconverted, cost in state,
    // total across all states (present only on a route's last state row).
    const inState = num(cells[4] ?? '');
    const allStates = num(cells[5] ?? '');
    if (inState != null) routes[current].states[code] = inState;
    if (allStates != null) routes[current].total = allStates;
  }

  // Single-state routes carry their total on the same row, and a few omit it.
  for (const r of Object.values(routes)) {
    if (r.total == null) {
      const sum = Object.values(r.states).reduce((s, v) => s + v, 0);
      r.total = sum || null;
    }
  }
  return routes;
}

async function main() {
  console.log('fetching FHWA Route Log...');
  const [t1, t2] = await Promise.all([grab('table01'), grab('table02')]);

  const main1 = parseTable(t1, true);
  const aux = parseTable(t2, false);
  const routes = { ...main1, ...aux };

  const seg = (o) => Object.values(o).reduce((s, r) => s + Object.keys(r.states).length, 0);
  const miles = (o) => Object.values(o).reduce(
    (s, r) => s + Object.values(r.states).reduce((a, b) => a + b, 0), 0);
  console.log(`  main routes: ${Object.keys(main1).length} designations, ${seg(main1)} state segments`);
  console.log(`  auxiliary routes: ${Object.keys(aux).length} designations, ${seg(aux)} state segments`);
  console.log(`  system mileage implied: ${Math.round(miles(main1) + miles(aux)).toLocaleString()} mi`);

  const noted = Object.entries(routes).filter(([, r]) => r.note);
  if (noted.length) {
    console.log(`\n  ${noted.length} route(s) where the log disagrees with itself:`);
    for (const [k, r] of noted) {
      console.log(`    ${k.padEnd(10)} published ${r.total}  vs  states sum ${r.sumOfStates}`);
    }
  }

  console.log('\nfetching FHWA per-route cost table...');
  const costRes = await fetch(COST_URL);
  if (!costRes.ok) throw new Error(`cost page: HTTP ${costRes.status}`);
  const costs = parseCosts(await costRes.text());
  const costTotal = Object.values(costs).reduce((s, r) => s + (r.total || 0), 0);
  console.log(`  ${Object.keys(costs).length} routes, `
    + `${Object.values(costs).reduce((s, r) => s + Object.keys(r.states).length, 0)} state segments`);
  console.log(`  sum of route totals: $${(costTotal / 1e6).toFixed(1)} billion `
    + `(1991 ICE reported $124.3bn for PE + ROW + construction)`);

  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, 'fhwa-cost.json'), JSON.stringify({
    source: {
      en: 'FHWA, Estimated Cost of Individual Interstate Routes (1991 Interstate Cost Estimate)',
      zh: '美国联邦公路管理局《各条州际公路造价估算》（1991 年州际公路造价估算）',
    },
    url: COST_URL,
    unit: 'thousands of US dollars, state plus federal, not inflation-adjusted',
    covers: 'Interstate Construction funds only: preliminary engineering, right-of-way and construction. '
      + 'Obligations are cut off at 31 December 1989. Turnpikes folded into the system without IC funds are '
      + 'absent, and route extents are those of 1989-91.',
    retrieved: new Date().toISOString().slice(0, 10),
    routes: costs,
  }, null, 0));
  console.log('wrote content/reference/fhwa-cost.json');

  await writeFile(join(OUT, 'fhwa-mileage.json'), JSON.stringify({
    source: {
      en: 'FHWA Route Log and Finder List, Tables 1 and 2',
      zh: '美国联邦公路管理局《州际公路路线名录》表 1、表 2',
    },
    url: `${BASE}/`,
    asOf: 'January 2026',
    retrieved: new Date().toISOString().slice(0, 10),
    routes,
  }, null, 0));

  console.log(`wrote content/reference/fhwa-mileage.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
