// Reads the Canadian sources and turns them into route groups shaped exactly
// like the American ones, so the rest of the build does not care which country
// a road is in.
//
// Three tiers, and all three are designations rather than inventions:
//
//   trans-canada  Segments the road file names "Trans-Canada Highway". The
//                 route number changes at nearly every provincial border - 1 in
//                 the west, 17 in Ontario, 20 and 40 in Quebec, 2 in New
//                 Brunswick, 104 and 105 in Nova Scotia - so the name is the
//                 only thing that identifies the corridor end to end.
//
//   nhs           Numbered routes on the National Highway System, per
//                 Transport Canada's register, carrying its Core / Feeder /
//                 Northern and Remote tier.
//
//   provincial    Every other numbered provincial or territorial route.
//
// Canada has no signed national system and no equivalent of the US
// Interstate/US/State hierarchy, so none of that vocabulary is borrowed. What
// it does have is a richer road file: the NRN records lane count, posted speed
// and pavement status per segment, none of which the American source carries.

import * as shapefile from 'shapefile';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { simplify } from './geo.mjs';
import { PROVINCES, roadsegPath } from './fetch-canada.mjs';

const BLANK = new Set(['Unknown', 'None', 'Inconnu', 'Aucun', '', '-1']);
export const clean = (v) => {
  const s = String(v ?? '').trim();
  return s && !BLANK.has(s) ? s : null;
};

export const PR_NAME = {
  BC: 'British Columbia', AB: 'Alberta', SK: 'Saskatchewan', MB: 'Manitoba',
  ON: 'Ontario', QC: 'Quebec', NB: 'New Brunswick', NS: 'Nova Scotia',
  PE: 'Prince Edward Island', NL: 'Newfoundland and Labrador',
  YT: 'Yukon', NT: 'Northwest Territories', NU: 'Nunavut',
};

const TCH_NAME = /^trans[- ]canada highway$/i;

// NRN road classes mapped onto the vocabulary the American side already uses,
// so a composition bar means the same thing on both sides of the border.
const TYPE_OF_CLASS = {
  Freeway: 'Freeway',
  'Expressway / Highway': 'Primary',
  Arterial: 'Primary',
  Collector: 'Secondary',
  Ramp: 'Ramp',
  'Service Lane': 'Secondary',
  'Local / Street': 'Local',
  'Local / Strata': 'Local',
  'Local / Unknown': 'Local',
  'Alleyway / Lane': 'Local',
  'Resource / Recreation': 'Secondary',
  Winter: 'Winter',
  'Winter Road': 'Winter',
};

// NRN traffic direction, read as whether the road is divided.
const DIVIDED = {
  'Same direction': 'Divided',
  'Opposite direction': 'Divided',
  'Both directions': 'Undivided',
};

/**
 * Quebec signs and names its highways in French, and the road file carries
 * both. The French name is the one on the sign, so it leads; the English name
 * rides along as a gloss where it differs.
 */
function routeNames(p) {
  const en = [];
  const fr = [];
  for (let i = 1; i <= 4; i++) {
    const e = clean(p[`RTENAME${i}EN`]);
    const f = clean(p[`RTENAME${i}FR`]);
    if (e) en.push(e);
    if (f) fr.push(f);
  }
  return { en: [...new Set(en)], fr: [...new Set(fr)] };
}

// A signed route number: digits with an optional letter suffix (97A, 28A, 1R),
// or a short all-letter designation (Ontario's QEW). A leading zero is not a
// route number in any province, which is what keeps Nova Scotia's null value
// out; see routeNumbers below.
const ROUTE_NUMBER = /^(?:[1-9]\d{0,3}[A-Z]{0,2}|[A-Z]{2,4})$/;

/**
 * The route numbers on a segment, normalised and filtered.
 *
 * The file is assembled from thirteen provincial and territorial
 * contributions, and they do not agree on what belongs in this field.
 *
 * Yukon and the Northwest Territories write the number as a decimal - "1.0",
 * "37.0". That matched nothing in the federal register, and it split Yukon's
 * Klondike Highway into two unrelated roads, because 608 of its segments say
 * "2.0" and 546 say "2". Trimming the decimal fixes both at once.
 *
 * Newfoundland additionally numbers local access roads hierarchically off the
 * highway they leave - "430-15" is the fifteenth side road off Route 430 - and
 * files those in the same field. There are 2,504 of them against 144 real
 * route numbers, so taken at face value Newfoundland has eighteen times more
 * highways than it has. They are excluded: they are addresses, not routes.
 *
 * Nova Scotia writes "0" for a road that carries no route number at all,
 * rather than leaving the field empty. Read literally that is a single
 * 42,465 km route - 23,200 km of it residential streets and 18,400 km of it
 * logging and recreation roads - and it was five times the province's real
 * numbered network. No province signs a Highway 0, so a leading zero is
 * treated as the absent value it is.
 */
function routeNumbers(p) {
  const out = [];
  for (let i = 1; i <= 5; i++) {
    const n = clean(p[`RTNUMBER${i}`]);
    if (!n) continue;
    const norm = n.replace(/^(\d+)\.0+$/, '$1').toUpperCase();
    if (ROUTE_NUMBER.test(norm)) out.push(norm);
    else rejected.set(norm, (rejected.get(norm) || 0) + 1);
  }
  return [...new Set(out)];
}

// What the filter threw away, so the build can report it rather than hide it.
const rejected = new Map();
export function rejectedNumbers() { return rejected; }

/** Load Transport Canada's register of which numbered routes are designated. */
export async function loadRegister(root) {
  try {
    const ref = JSON.parse(await readFile(join(root, 'content', 'reference', 'canada-nhs.json'), 'utf8'));
    const byPr = new Map();
    for (const [pr, tiers] of Object.entries(ref.register || {})) {
      const m = new Map();
      // Core wins over Feeder wins over Northern where a number appears in
      // more than one, which happens wherever a route changes tier partway.
      for (const tier of ['northern', 'feeder', 'core']) {
        for (const n of tiers[tier] || []) m.set(n, tier);
      }
      byPr.set(pr, m);
    }
    return { byPr, inventory: ref.inventory, source: ref.source };
  } catch {
    console.log('  (no canada-nhs.json; run tools/fetch-canada-nhs.mjs)');
    return null;
  }
}

/**
 * Read one province's road file into route groups.
 *
 * Only numbered routes and the Trans-Canada survive: the NRN is a complete
 * road file down to residential streets, and Ontario alone is 1.4 GB of it.
 * Geometry is thinned on the way in, both to keep the whole country in memory
 * at once and because the source is surveyed to 10 m while the atlas draws at
 * roughly 1:1,000,000. Endpoints are never moved, so stitching still joins.
 */
async function readProvince(pr, register, onProgress) {
  const base = await roadsegPath(pr.toLowerCase());
  if (!base) return null;

  const src = await shapefile.open(`${base}.shp`, `${base}.dbf`);
  const groups = new Map();
  const places = new Map();
  let read = 0;
  let kept = 0;

  while (true) {
    const r = await src.read();
    if (r.done) break;
    read++;
    if (onProgress && read % 200000 === 0) onProgress(pr, read);

    const p = r.value.properties;
    const g = r.value.geometry;
    if (!g) continue;

    const nums = routeNumbers(p);
    const names = routeNames(p);
    if (!nums.length) continue;
    const isTch = names.en.some((n) => TCH_NAME.test(n))
      || names.fr.some((n) => /^(route )?transcanadienne$/i.test(n));

    const rawParts = g.type === 'LineString' ? [g.coordinates]
      : g.type === 'MultiLineString' ? g.coordinates : [];
    if (!rawParts.length) continue;

    // Places come from the road file itself, which records the settlement on
    // each side of every segment. That is better than guessing from a gazetteer
    // the way the American side has to.
    for (const key of ['L_PLACENAM', 'R_PLACENAM']) {
      const name = clean(p[key]);
      if (name) places.set(name, (places.get(name) || 0) + 1);
    }

    const roadclass = clean(p.ROADCLASS);
    const paved = clean(p.PAVSTATUS);
    const lanes = Number(p.NBRLANES) > 0 ? Number(p.NBRLANES) : null;
    const speed = Number(p.SPEED) > 0 ? Number(p.SPEED) : null;
    const props = {
      type: paved === 'Unpaved' ? 'Unpaved' : (TYPE_OF_CLASS[roadclass] || 'Unknown'),
      state: pr,
      // A carriageway carrying one direction of travel belongs to a divided
      // road; one carrying both is undivided. The source says which way a
      // segment is digitised relative to traffic, so "same" and "opposite"
      // are the same fact stated twice, and both mean divided. "Unknown"
      // stays out of the count rather than being read as undivided.
      divided: DIVIDED[clean(p.TRAFFICDIR)] ?? null,
      roadclass,
      lanes,
      speed,
      paved: paved === 'Paved' ? true : paved === 'Unpaved' ? false : null,
      lPlace: clean(p.L_PLACENAM),
      rPlace: clean(p.R_PLACENAM),
      tch: isTch,
      names,
    };

    // Keyed by number and jurisdiction, not by tier. Which tier a route belongs
    // to is a question about the whole road, and it cannot be answered one
    // segment at a time: Quebec's A-20 carries the Trans-Canada from the
    // Ontario border to Riviere-du-Loup and then does not, so tagging it from
    // any single segment would be wrong either way. The tier is decided once
    // the route has been stitched and its length is known.
    //
    // A segment signed as two routes belongs to both, which is why this loops.
    for (const number of nums) {
      const key = `${pr}|${number}`;
      if (!groups.has(key)) {
        groups.set(key, {
          number, pr, country: 'CA',
          nhsTier: register?.get(number) || null,
          parts: [], names: { en: new Set(), fr: new Set() },
        });
      }
      const grp = groups.get(key);
      for (const n of names.en) grp.names.en.add(n);
      for (const n of names.fr) grp.names.fr.add(n);
      for (const part of rawParts) {
        if (part.length < 2) continue;
        // ~90 m: below what a 1:1M drawing can show, and well above the
        // tolerance the stitcher snaps fragment endpoints with.
        grp.parts.push({ coords: part.length > 2 ? simplify(part, 0.0008) : part, props });
      }
      kept++;
    }
  }

  return { groups, places, read, kept };
}

/**
 * Read every jurisdiction.
 *
 * Provinces are processed one at a time and their geometry is released before
 * the next one opens, because the extracted road files come to 5 GB and Ontario
 * and Quebec are 2.4 GB of that between them.
 */
export async function loadCanada(root, { onProvince, only } = {}) {
  const register = await loadRegister(root);
  if (!register) return null;

  const groups = new Map();
  const places = new Map();
  let totalRead = 0;

  const wanted = only ? new Set(only.map((p) => p.toLowerCase())) : null;
  for (const { pr } of PROVINCES) {
    if (wanted && !wanted.has(pr)) continue;
    const PR = pr.toUpperCase();
    const res = await readProvince(PR, register.byPr.get(PR), null);
    if (!res) {
      console.log(`  ${PR}  missing; run tools/fetch-canada.mjs`);
      continue;
    }
    totalRead += res.read;
    for (const [k, v] of res.groups) groups.set(k, v);
    for (const [name, n] of res.places) places.set(`${name}|${PR}`, (places.get(`${name}|${PR}`) || 0) + n);
    let designated = 0;
    for (const v of res.groups.values()) if (v.nhsTier) designated++;
    console.log(`  ${PR}  ${String(res.read).padStart(7)} segments -> `
      + `${String(res.groups.size).padStart(4)} numbered routes  (${designated} on the NHS)`);
    if (onProvince) onProvince(PR, res);
  }

  if (rejected.size) {
    const segs = [...rejected.values()].reduce((a, b) => a + b, 0);
    console.log(`  ignored ${rejected.size} values in the route-number field across ${segs} segments`
      + ' (hierarchical local road numbers, not signed routes)');
  }
  return { groups, places, register, totalRead };
}

/**
 * Which of the three tiers a stitched Canadian route belongs to.
 *
 * The Trans-Canada test is by measured length rather than by designation,
 * because a route can carry the Trans-Canada for part of its run and not the
 * rest. Both thresholds matter: the share stops a route being called
 * Trans-Canada on the strength of one interchange, and the absolute distance
 * stops a short connector qualifying because a third of its 2 km happens to be
 * signed. Whatever the verdict, the exact share is kept and shown, so a route
 * that is half Trans-Canada never has to pretend otherwise.
 */
export function canadaSystem(grp, { tchKm, km }) {
  if (tchKm >= 25 && tchKm / Math.max(km, 1e-9) >= 0.35) return 'ca-tch';
  return grp.nhsTier ? 'ca-nhs' : 'ca-provincial';
}

/** The label a Canadian route carries, in each language. */
export function canadaLabel(grp, system) {
  const { number, pr } = grp;
  if (system === 'ca-tch') return { en: `TCH ${number}`, zh: `横加公路 ${number}` };
  // Quebec signs its freeways as autoroutes - "A-20", not "Route 20" - and the
  // number says which is which: 1-99 and 400 up are autoroutes, 100-399 are
  // ordinary routes. So A-40 and A-440 are freeways while Route 132 and Route
  // 138 are not, and calling either by the other's name would be wrong.
  if (pr === 'QC' && /^\d{1,3}$/.test(number)) {
    const n = Number(number);
    if (n <= 99 || n >= 400) return { en: `A-${number}`, zh: `A-${number}` };
    return { en: `QC ${number}`, zh: `QC ${number}` };
  }
  return { en: `${pr} ${number}`, zh: `${pr} ${number}` };
}
