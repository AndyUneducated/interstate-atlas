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

const ROUTE_RE = /^(?:I|A|H|PRI)-\d+[A-Z]?$/;

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

  // A single-state main route has no separate TOTAL row to read.
  for (const r of Object.values(routes)) {
    if (r.continuous && r.total == null) {
      const sum = Object.values(r.states).reduce((s, v) => s + v, 0);
      r.total = sum ? Math.round(sum * 100) / 100 : null;
    }
  }
  return routes;
}

async function grab(name) {
  const res = await fetch(`${BASE}/${name}.cfm`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.text();
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

  await mkdir(OUT, { recursive: true });
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
