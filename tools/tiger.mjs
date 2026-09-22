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
const TRAIL_DIR = /\s*\b(?:n|s|e|w|ne|nw|se|sw|nb|sb|eb|wb)\b\s*$/i;

/**
 * Interstates whose number ends in a letter, as the FHWA register spells them.
 *
 * Five roads in the country are signed this way, and TIGER writes the letter
 * as a separate word for some of them: Texas files the Dallas half of I-35 as
 * "I- 35 E" and Minnesota files part of Minneapolis's as "I- 35 W". That is
 * indistinguishable, as text, from the carriageway markers in the same file -
 * "I- 35 N" is northbound I-35, and there is no such route as I-35N - so the
 * letter cannot be judged on its own. The register settles it: a letter that
 * makes a designation the FHWA lists is part of the number, and every other
 * trailing letter is a direction and gets dropped with the rest of them.
 *
 * Getting this wrong is quiet and expensive. Texas's I-35E and I-35W were
 * folded into I-35 and vanished from the atlas entirely, and Minnesota's
 * I-35W kept only the fragments TIGER happened to spell without the space,
 * measuring nine miles of a forty-two-mile road.
 */
const SUFFIXED = new Set();
export function setSuffixedInterstates(numbers) {
  SUFFIXED.clear();
  for (const n of numbers) SUFFIXED.add(String(n).toUpperCase());
}
const SPACED_SUFFIX = /^(i-?\s*)(\d{1,3})\s+([a-z])\b/i;

// TIGER writes some numbers with a space inside them: Michigan's M-28 as
// "State Hwy M 28", Massachusetts's Route 2A as "State Rte 2 A". Closing the
// space makes the number one token. Two-letter words are left alone, so a
// direction like "12 SW" is not glued into the number.
const SPACED = [
  [/\b([A-Z]) (\d)/gi, '$1$2'],
  [/\b(\d) ([A-Z])(?![A-Za-z])/gi, '$1$2'],
];

// What TIGER appends to a number to mean a related but separate route. The
// abbreviations are not consistent between states, hence the several spellings
// of each.
const QUALIFIERS = {
  bus: 'business', busn: 'business', business: 'business',
  buslp: 'business', businesslp: 'business', busloop: 'business',
  businessloop: 'business', buslp1: 'business',
  bypass: 'bypass', byp: 'bypass', bypss: 'bypass',
  alt: 'alternate', alternate: 'alternate',
  trk: 'truck', truck: 'truck',
  spur: 'spur', spr: 'spur',
  con: 'connector', conn: 'connector', connector: 'connector',
  loop: 'loop', lp: 'loop',
  hov: 'hov', opt: 'optional', sci: 'scenic', scn: 'scenic', scenic: 'scenic',
};

const ROAD_WORD = '(?:hwy|highway|rte|route|rd|road)';
const VARIANT = '(?:loop|lp|spur|spr|byp|bypass|bus|business|alt|alternate|trk|truck|conn|connector)';

// A route number is mostly digits, but not always: Florida signs A1A, Michigan
// signs its trunklines M-28, and a suffixed route is 2A. One optional letter
// either side covers all three without matching words.
const NUM = '[a-z]?\\d{1,4}[a-z]?';

// Ordered: the first pattern that matches wins, so the more specific forms come
// first. Each captures the number in group 1 and any trailing words in the
// last group; `variant` marks the forms that put the variant before the number.
const PATTERNS = [
  // "I- 95", "I- 279 Hov". The space after the hyphen is TIGER's own. Hawaii's
  // Interstates are numbered H-1 to H-3, written variously as "I- H-1" and
  // "I- H1"; both are normalised to H1 so the halves of the road meet.
  { system: 'us-interstate', re: new RegExp(`^i-?\\s*h-?(\\d{1,3})\\b\\s*(.*)$`, 'i'), prefix: 'H' },
  { system: 'us-interstate', re: new RegExp(`^i-?\\s*(\\d{1,3}[a-z]?)\\b\\s*(.*)$`, 'i') },

  // "US Hwy 1", "US Rte 66", "US Hwy 11/15"
  { system: 'us', re: new RegExp(`^u\\.?s\\.?\\s*${ROAD_WORD}?\\s*(${NUM}(?:/${NUM})*)\\b\\s*(.*)$`, 'i') },

  // Texas signs loops and spurs as their own designations - "State Loop 265"
  // is not Highway 265 - and several states write the variant ahead of the
  // number this way.
  { system: 'state', re: new RegExp(`^(?:state|st)\\s+(${VARIANT})\\s*${ROAD_WORD}?\\s*(${NUM})\\b\\s*(.*)$`, 'i'), variant: true },

  // The same, without the word "state": "Bus Rte 209"
  { system: 'state', re: new RegExp(`^(${VARIANT})\\s+(?:rte|route)\\s*(${NUM})\\b\\s*(.*)$`, 'i'), variant: true },

  // "State Rte 10", "State Hwy 125", "St Rte 44"
  { system: 'state', re: new RegExp(`^(?:state|st)\\s*${ROAD_WORD}\\s*(${NUM}(?:/${NUM})*)\\b\\s*(.*)$`, 'i') },

  // A bare "Rte 16", which is how twenty-two states write some of their
  // routes. Only "route", never a bare "Hwy 5" or "Rd 5", which are as often
  // a local road's actual name.
  { system: 'state', re: new RegExp(`^(?:rte|route)\\s*(${NUM}(?:/${NUM})*)\\b\\s*(.*)$`, 'i') },
];

// Conventions that belong to one state, applied only there. Written narrowly on
// purpose: a pattern like "two letters then a number" would read "Ox Rd 12" as
// a state route in every state that has one.
const LOCAL = {
  // Alaska numbers its routes 1-11 and signs them as such; TIGER files the
  // same roads under both "AK Rte 3" and "State Hwy 3".
  AK: [{ system: 'state', re: new RegExp(`^ak\\s*-?\\s*${ROAD_WORD}?\\s*(${NUM})\\b\\s*(.*)$`, 'i') }],

  // Puerto Rico's routes are carreteras, written as "PR- 52", "Carr 156",
  // "Carr PR- 472" and "Carr Estatal 30". A carretera with a name rather than
  // a number - "Carr Naranjos" - is a local road and is not a route.
  PR: [{ system: 'state', re: new RegExp(`^(?:carr\\s*)?(?:pr|estatal|num)?\\s*-?\\s*(${NUM})\\b\\s*(.*)$`, 'i') }],

  // The Farm to Market and Ranch to Market roads are a Texas system of their
  // own, state-maintained and signed on their own shield. FM 1960 and State
  // Highway 1960 are different roads, so the number carries the prefix.
  TX: [
    { system: 'state', re: new RegExp(`^(?:fm|f m)\\s*-?\\s*(${NUM})\\b\\s*(.*)$`, 'i'), prefix: 'FM' },
    { system: 'state', re: new RegExp(`^(?:rm|ranch\\s*rd|ranch\\s*road)\\s*-?\\s*(${NUM})\\b\\s*(.*)$`, 'i'), prefix: 'RM' },
  ],

  HI: [{ system: 'state', re: new RegExp(`^hi\\s*-\\s*(${NUM})\\b\\s*(.*)$`, 'i') }],

  // Missouri's supplemental routes are lettered rather than numbered - Route
  // A, Route AB, Route NN - and there are some 1,600 miles of them. Letters
  // only, so this cannot swallow a road whose name merely begins with "Route".
  MO: [{ system: 'state', re: /^(?:state\s*)?(?:rte|route|hwy|highway)\s+([a-z]{1,3})\b\s*(.*)$/i }],
};

/**
 * The routes a TIGER road name designates, or an empty list.
 *
 * `rttyp` is TIGER's own classification - I, U, S for the three signed systems,
 * C for county, M for a road carried under its common name, O for anything
 * else - and it is used as a guard rather than as the answer. The name is
 * authoritative about the number; RTTYP is authoritative about whether there is
 * a number to find at all.
 *
 * `st` admits the handful of conventions that exist in one state only.
 */
export function parseName(fullname, rttyp, st = null) {
  const raw = String(fullname ?? '').trim();
  if (!raw) return [];

  // M is a road under its common name and carries no designation; C is a county
  // route, which is a tier this atlas does not have. Both are read for context
  // geometry, never as routes.
  const type = String(rttyp ?? '').trim().toUpperCase();
  if (type === 'M' || type === 'C') return [];

  if (FORMER.test(raw)) return [];
  let name = raw.replace(LEAD_DIR, '').trim();
  // Before the trailing direction goes, rescue the few letters that are not one.
  name = name.replace(SPACED_SUFFIX, (m, pre, num, letter) => (
    SUFFIXED.has(`${num}${letter}`.toUpperCase()) ? `${pre}${num}${letter}` : m));
  name = name.replace(TRAIL_DIR, '').trim();
  for (const [re, to] of SPACED) name = name.replace(re, to);

  for (const pat of [...PATTERNS, ...(LOCAL[st] ?? [])]) {
    const m = pat.re.exec(name);
    if (!m) continue;

    // Where the variant comes first the number is in the second group.
    const numbers = pat.variant ? m[2] : m[1];
    const leading = pat.variant ? m[1] : null;
    const rest = (m[m.length - 1] || '').trim().toLowerCase().replace(/[^a-z]/g, '');

    // Trailing words after the number say which related route this is. An
    // unrecognised trailing word means the name is something else that merely
    // starts like a route - "State Highway Patrol Rd" - so it is not read as a
    // designation at all.
    const qualifier = leading ? QUALIFIERS[leading.toLowerCase()] ?? leading.toLowerCase()
      : rest ? QUALIFIERS[rest] : null;
    if (!leading && rest && !qualifier) return [];

    // A single feature can carry two numbers where routes run concurrently,
    // which TIGER writes as "US Hwy 11/15".
    return numbers.split('/').map((n) => ({
      system: pat.system,
      number: `${pat.prefix ?? ''}${n.toUpperCase()}`,
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
export async function readState(fips, { groups = new Map(), tol = 0.0002, context = null } = {}) {
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
    const routes = parseName(p.FULLNAME, p.RTTYP, st);

    const parts = g.type === 'LineString' ? [g.coordinates]
      : g.type === 'MultiLineString' ? g.coordinates : [];
    if (!parts.length) continue;

    // Unnumbered arterials are drawn as faint hairlines under the numbered
    // network, so a city reads as a city rather than as whichever routes
    // happen to pass through it. Only the primary ones, or the context would
    // be denser than the subject.
    if (!routes.length) {
      if (context && p.MTFCC === 'S1100') {
        for (const part of parts) if (part.length >= 2) context.push(part);
      }
      continue;
    }

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
