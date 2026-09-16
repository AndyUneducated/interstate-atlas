// Reads US Census TIGER/Line roads into route groups shaped like the Canadian
// and Natural Earth ones, so the rest of the build does not care which source a
// road came from.
//
// TIGER replaces Natural Earth because it is surveyed rather than generalised:
// Natural Earth is drawn at 1:1,000,000, which cuts corners, drops whole
// stretches and puts a road a few hundred metres from where it is. TIGER is the
// geometry the Census actually uses to enumerate the country.
//
// It costs two things. There is no route-number field - the designation is
// written into the road's name, so the name has to be parsed - and each
// direction of a divided highway is drawn as its own centreline, so a naive
// reading doubles every Interstate. Both are handled here and in geo.mjs
// rather than being absorbed into the figures.

import * as shapefile from 'shapefile';
import { mkdir, writeFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { listEntries, extractEntry } from './unzip.mjs';
import { simplify } from './geo.mjs';

export const TIGER_YEAR = 2025;

// FIPS code to postal abbreviation. The road files are published per state and
// carry no state field, so this is also how a road learns where it is.
export const STATES = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO',
  '09': 'CT', 10: 'DE', 11: 'DC', 12: 'FL', 13: 'GA', 15: 'HI',
  16: 'ID', 17: 'IL', 18: 'IN', 19: 'IA', 20: 'KS', 21: 'KY',
  22: 'LA', 23: 'ME', 24: 'MD', 25: 'MA', 26: 'MI', 27: 'MN',
  28: 'MS', 29: 'MO', 30: 'MT', 31: 'NE', 32: 'NV', 33: 'NH',
  34: 'NJ', 35: 'NM', 36: 'NY', 37: 'NC', 38: 'ND', 39: 'OH',
  40: 'OK', 41: 'OR', 42: 'PA', 44: 'RI', 45: 'SC', 46: 'SD',
  47: 'TN', 48: 'TX', 49: 'UT', 50: 'VT', 51: 'VA', 53: 'WA',
  54: 'WV', 55: 'WI', 56: 'WY', 72: 'PR',
};

const SRC = join('tools', 'src', 'tiger');
const url = (fips) =>
  `https://www2.census.gov/geo/tiger/TIGER${TIGER_YEAR}/PRISECROADS/tl_${TIGER_YEAR}_${fips}_prisecroads.zip`;

/* ══════════════════════════════════════════════════════════════════════════
   Reading the designation out of a road's name
   ══════════════════════════════════════════════════════════════════════════ */

// A former alignment, not the road. TIGER keeps "Old US Hwy 395" and "Hst Rte
// 66" under their historic names, and reading those as the current route would
// splice a bypassed 1940s alignment into the middle of the modern one.
const FORMER = /^(?:old|hst|hist|historic)\s+/i;

// A leading cardinal is part of the street name, not the designation: "E State
// Hwy 120" is Highway 120. A *trailing* one marks the two halves of a divided
// carriageway - "US Hwy 101 N" and "US Hwy 101 S" are one road - so both are
// dropped, which is what lets the halves stitch together.
const LEAD_DIR = /^(?:n|s|e|w|ne|nw|se|sw)\s+/i;
const TRAIL_DIR = /\s*\b(?:n|s|e|w|nb|sb|eb|wb)\b\s*$/i;

// What TIGER appends to a number to mean a related but separate route.
const QUALIFIERS = {
  bus: 'business', busn: 'business', bypass: 'bypass', byp: 'bypass',
  alt: 'alternate', trk: 'truck', truck: 'truck', spur: 'spur',
  con: 'connector', conn: 'connector', loop: 'loop', hov: 'hov',
  opt: 'optional', sci: 'scenic', scn: 'scenic',
};

const ROAD_WORD = '(?:hwy|highway|rte|route|rd|road)';
const PATTERNS = [
  // "I- 95", "I- 279 Hov". The space after the hyphen is TIGER's own.
  { system: 'interstate', re: new RegExp(`^i-\\s*(\\d{1,3}[a-z]?)\\b\\s*(.*)$`, 'i') },
  // "US Hwy 1", "US Rte 66", "US Hwy 11/15"
  { system: 'us', re: new RegExp(`^u\\.?s\\.?\\s*${ROAD_WORD}?\\s*(\\d{1,3}[a-z]?(?:/\\d{1,3}[a-z]?)*)\\b\\s*(.*)$`, 'i') },
  // "State Rte 10", "State Hwy 125", "St Rte 44"
  { system: 'state', re: new RegExp(`^(?:state|st)\\s*${ROAD_WORD}\\s*(\\d{1,4}[a-z]?(?:/\\d{1,4}[a-z]?)*)\\b\\s*(.*)$`, 'i') },
  // Puerto Rico signs its routes as "PR-52"; Texas has "FM 1960" farm roads
  // and Hawaii "HI 92". These are the state tier under a local name.
  { system: 'state', re: new RegExp(`^(?:pr|hi)-\\s*(\\d{1,4}[a-z]?)\\b\\s*(.*)$`, 'i') },
];

/**
 * The routes a TIGER road name designates, or an empty list.
 *
 * `rttyp` is TIGER's own classification - I, U, S for the three signed systems,
 * C for county, M for a road carried under its common name, O for anything
 * else - and it is used as a guard rather than as the answer. The name is
 * authoritative about the number; RTTYP is authoritative about whether there is
 * a number to find at all.
 */
export function parseName(fullname, rttyp) {
  const raw = String(fullname ?? '').trim();
  if (!raw) return [];

  // M is a road under its common name and carries no designation; C is a county
  // route, which is a tier this atlas does not have. Both are read for context
  // geometry, never as routes.
  const type = String(rttyp ?? '').trim().toUpperCase();
  if (type === 'M' || type === 'C') return [];

  if (FORMER.test(raw)) return [];
  let name = raw.replace(LEAD_DIR, '').trim();
  name = name.replace(TRAIL_DIR, '').trim();

  for (const { system, re } of PATTERNS) {
    const m = re.exec(name);
    if (!m) continue;

    // Trailing words after the number say which related route this is. An
    // unrecognised trailing word means the name is something else that merely
    // starts like a route - "State Highway Patrol Rd" - so it is not read as a
    // designation at all.
    const rest = (m[2] || '').trim().toLowerCase().replace(/[^a-z]/g, '');
    const qualifier = rest ? QUALIFIERS[rest] : null;
    if (rest && !qualifier) return [];

    // A single feature can carry two numbers where routes run concurrently,
    // which TIGER writes as "US Hwy 11/15".
    return m[1].split('/').map((n) => ({
      system,
      number: n.toUpperCase(),
      qualifier,
    }));
  }
  return [];
}

/* ══════════════════════════════════════════════════════════════════════════
   Fetching and reading
   ══════════════════════════════════════════════════════════════════════════ */

const exists = async (p) => access(p).then(() => true, () => false);

/** Download and unpack one state's roads, unless they are already here. */
export async function fetchState(fips, { force = false } = {}) {
  const st = STATES[fips];
  const base = join(SRC, `${st}`);
  if (!force && await exists(`${base}.shp`) && await exists(`${base}.dbf`)) return base;

  await mkdir(SRC, { recursive: true });
  const zip = `${base}.zip`;
  const res = await fetch(url(fips));
  if (!res.ok) throw new Error(`${st}: HTTP ${res.status} for ${url(fips)}`);
  await writeFile(zip, Buffer.from(await res.arrayBuffer()));

  const entries = await listEntries(zip);
  for (const ext of ['shp', 'dbf']) {
    const e = entries.find((x) => x.name.toLowerCase().endsWith(`.${ext}`));
    if (!e) throw new Error(`${st}: no .${ext} in archive`);
    await extractEntry(zip, e, `${base}.${ext}`);
  }
  await rm(zip);
  return base;
}

/**
 * Read one state's roads into route groups, keyed by system and number.
 *
 * Geometry is thinned on the way in - the source is surveyed to metres and the
 * atlas draws at roughly 1:1,000,000 - but endpoints are never moved, so the
 * stitcher still joins fragment to fragment.
 */
export async function readState(fips, { groups = new Map(), tol = 0.0002 } = {}) {
  const st = STATES[fips];
  const base = await fetchState(fips);
  const src = await shapefile.open(`${base}.shp`, `${base}.dbf`);

  let read = 0;
  let kept = 0;
  while (true) {
    const r = await src.read();
    if (r.done) break;
    read++;

    const p = r.value.properties;
    const g = r.value.geometry;
    if (!g) continue;
    const routes = parseName(p.FULLNAME, p.RTTYP);
    if (!routes.length) continue;

    const parts = g.type === 'LineString' ? [g.coordinates]
      : g.type === 'MultiLineString' ? g.coordinates : [];
    if (!parts.length) continue;

    // S1100 is a primary road - a motorway or a major arterial - and S1200 a
    // secondary one. The distinction is the only thing TIGER says about a
    // road's character, so it stands in for the roadway class.
    const props = {
      type: p.MTFCC === 'S1100' ? 'Primary' : 'Secondary',
      state: st,
      divided: null,
      mtfcc: p.MTFCC,
      name: String(p.FULLNAME ?? '').trim() || null,
    };

    for (const route of routes) {
      // Interstate and US numbers are national, so their pieces are grouped
      // across state lines and stitched into one road. A state route number
      // means nothing outside its state - there are forty-odd Route 1s - so
      // those are grouped per state.
      const key = route.system === 'state'
        ? `state|${route.number}|${st}|${route.qualifier ?? ''}`
        : `${route.system}|${route.number}|${route.qualifier ?? ''}`;

      let grp = groups.get(key);
      if (!grp) {
        grp = {
          system: route.system,
          number: route.number,
          qualifier: route.qualifier,
          st: route.system === 'state' ? st : null,
          parts: [],
          names: new Set(),
        };
        groups.set(key, grp);
      }
      if (props.name) grp.names.add(props.name);
      for (const part of parts) {
        if (part.length < 2) continue;
        grp.parts.push({ coords: part.length > 2 ? simplify(part, tol) : part, props });
      }
      kept++;
    }
  }

  return { groups, read, kept, st };
}
