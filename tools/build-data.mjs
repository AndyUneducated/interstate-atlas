// Turns the Natural Earth North America roads shapefile into the route atlas
// the site consumes: per-system GeoJSON for the map plus a metadata index.
//
//   node tools/build-data.mjs
//
// Source (public domain): ne_10m_roads_north_america at 1:1,000,000 scale,
// with US Census gazetteer places used to name route termini.
//
// Every number written here comes from the shapefile's own attributes or from
// the geometry. Editorial figures - cost, traffic, condition - are not invented
// here; they live in content/ with their sources attached.

import * as shapefile from 'shapefile';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  bboxOf, haversineKm, lineLengthKm, roundCoords, simplify, stitchBetween, stitchComponents,
  stitchRoute,
} from './geo.mjs';
import { STATE_CODE, statesTouch } from './states.mjs';
import { canadaLabel, canadaSystem, loadCanada, PR_NAME } from './canada.mjs';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'tools', 'src');
const OUT = join(ROOT, 'data');
const KM_PER_MI = 1.609344;

// Route-number prefixes that mark a signed variant rather than a through route.
const QUALIFIERS = [
  ['ALT', 'alternate'], ['BUS', 'business'], ['BYP', 'bypass'], ['TRK', 'truck'],
  ['BR', 'business'], ['B', 'business'], ['U', 'unsigned'],
];

function parseNumber(raw) {
  const num = String(raw ?? '').trim().toUpperCase();
  if (!num) return null;
  const plain = /^(\d+)([A-Z]*)$/.exec(num);
  if (plain) return { base: plain[1], suffix: plain[2] || '', qualifier: null, raw: num };
  const hawaii = /^H(\d+)$/.exec(num);
  if (hawaii) return { base: num, suffix: '', qualifier: null, raw: num, hawaii: true };
  for (const [prefix, kind] of QUALIFIERS) {
    if (num.startsWith(prefix) && /^\d/.test(num.slice(prefix.length))) {
      const rest = /^(\d+)([A-Z]*)$/.exec(num.slice(prefix.length));
      if (rest) return { base: rest[1], suffix: rest[2] || '', qualifier: kind, raw: num };
    }
  }
  return { base: num, suffix: '', qualifier: null, raw: num, malformed: true };
}

// Primary routes carry one or two digits; three digits mean an auxiliary. The
// distinction drives more than styling: auxiliary Interstate numbers are reused
// from state to state by design, so I-295 is eight unrelated roads.
function tierOf(system, parsed) {
  if (system === 'state') return 'state';
  if (parsed.qualifier || parsed.malformed) return 'special';
  if (parsed.hawaii) return parsed.base.length <= 2 ? 'primary' : 'auxiliary';
  return parsed.base.length <= 2 ? 'primary' : 'auxiliary';
}

function labelFor(system, parsed, stateCode) {
  if (system === 'interstate') {
    if (parsed.qualifier === 'business') return `Business I-${parsed.base}${parsed.suffix}`;
    // Hawaii's Interstates are signed and published as H-1, H-2, H-3 rather
    // than as I-H1, so they carry the hyphen and drop the I.
    if (parsed.hawaii) return parsed.base.replace(/^([A-Z]+)(\d)/, '$1-$2');
    return `I-${parsed.base}${parsed.suffix}`;
  }
  if (system === 'us') {
    const tag = { alternate: ' Alt', business: ' Bus', bypass: ' Byp', truck: ' Trk', unsigned: '' };
    return `US ${parsed.base}${parsed.suffix}${tag[parsed.qualifier] ?? ''}`;
  }
  return `${stateCode} ${parsed.raw}`;
}

async function loadPlaces() {
  // Census gazetteer: ~32k US places, public domain. Land area stands in for
  // prominence so a terminus reads "Miami" rather than a neighbouring village.
  const text = await readFile(join(SRC, '2023_Gaz_place_national.txt'), 'latin1');
  const places = [];
  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split('\t');
    if (f.length < 12) continue;
    const lat = Number(f[10]);
    const lon = Number(f[11]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    places.push({
      name: f[3].trim().replace(/\s+(city|town|village|borough|CDP|municipality|comunidad|zona urbana)$/i, ''),
      st: f[0].trim(),
      area: Number(f[8]) || 0,
      lat,
      lon,
    });
  }
  return places;
}

function buildPlaceIndex(places) {
  const grid = new Map();
  for (const p of places) {
    const k = `${Math.floor(p.lat)},${Math.floor(p.lon)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  }
  return grid;
}

function nearestPlace(grid, coord) {
  const [lon, lat] = coord;
  let best = null;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      for (const p of grid.get(`${Math.floor(lat) + dy},${Math.floor(lon) + dx}`) || []) {
        const km = haversineKm(coord, [p.lon, p.lat]);
        // Nudge toward larger places without letting a distant city win.
        const score = km - Math.min(6, Math.sqrt(p.area) * 0.5);
        if (!best || score < best.score) best = { score, km, p };
      }
    }
  }
  if (!best) return null;
  return { name: best.p.name, st: best.p.st, km: Math.round(best.km * 10) / 10 };
}

function orientMainline(pieces) {
  // US practice signs routes south to north and west to east; present them that
  // way regardless of how the source fragments happened to wind.
  const flat = pieces.flat();
  const a = flat[0];
  const b = flat[flat.length - 1];
  const northSouth = Math.abs(b[1] - a[1]) >= Math.abs(b[0] - a[0]);
  const forward = northSouth ? b[1] > a[1] : b[0] > a[0];
  if (forward) return pieces;
  return pieces.slice().reverse().map((p) => p.slice().reverse());
}

function compositionOf(edges) {
  const byType = new Map();
  const byState = new Map();
  let divided = 0, dividedKnown = 0, total = 0;
  for (const e of edges) {
    total += e.km;
    byType.set(e.props.type || 'Unknown', (byType.get(e.props.type || 'Unknown') || 0) + e.km);
    // The American source names its states in full; the Canadian one is read
    // per jurisdiction and already carries the two-letter code.
    const raw = e.props.state;
    const st = STATE_CODE[raw] || (/^[A-Z]{2}$/.test(raw || '') ? raw : null);
    if (st) byState.set(st, (byState.get(st) || 0) + e.km);
    if (e.props.divided === 'Divided') { divided += e.km; dividedKnown += e.km; }
    else if (e.props.divided === 'Undivided') dividedKnown += e.km;
  }
  const pct = (v) => Math.round((v / Math.max(1e-9, total)) * 1000) / 10;
  const types = {};
  for (const [t, km] of [...byType.entries()].sort((a, b) => b[1] - a[1])) types[t] = pct(km);
  return {
    types,
    states: [...byState.entries()].sort((a, b) => b[1] - a[1])
      .map(([st, km]) => ({ st, mi: Math.max(1, Math.round(km / KM_PER_MI)) })),
    stateSet: new Set(byState.keys()),
    gradeSeparated: pct((byType.get('Freeway') || 0) + (byType.get('Tollway') || 0)),
    tolled: pct(byType.get('Tollway') || 0),
    unpaved: pct(byType.get('Unpaved') || 0),
    dividedShare: dividedKnown > 0 ? Math.round((divided / dividedKnown) * 1000) / 10 : null,
  };
}

/**
 * Decide which stitched pieces of one route number are the same road.
 *
 * Distance cannot make this call. I-90's genuine hole - the Indiana Toll Road
 * and Ohio Turnpike are missing from the source - is 421 km wide, while the two
 * unrelated I-74s sit 208 km apart. But the states each piece runs through do
 * settle it: I-90's pieces meet at the Indiana/Ohio line, and the I-74 pieces
 * (Illinois-Ohio versus North Carolina) share no border at all.
 *
 * Auxiliary numbers are exempt, because reuse is designed into them: I-295 is
 * eight separate roads in Maine, New Jersey, Virginia, Florida, Rhode Island,
 * Washington DC and North Carolina.
 */
async function loadOfficial() {
  const read = async (name) => {
    try {
      return JSON.parse(await readFile(join(ROOT, 'content', 'reference', name), 'utf8'));
    } catch {
      console.log(`  (no ${name}; run tools/fetch-fhwa.mjs)`);
      return null;
    }
  };
  const [mileage, cost] = await Promise.all([read('fhwa-mileage.json'), read('fhwa-cost.json')]);
  return mileage ? { mileage, cost } : null;
}

/**
 * Put FHWA's official mileage next to the measured geometry.
 *
 * The Route Log records mileage per route per state, which is the right grain
 * to join on. A main route's states are all one road, so the states this route
 * touches sum to its official length. An auxiliary number is reused across
 * states, so the same sum — taken only over the states this particular road
 * runs through — picks out that road and ignores its namesakes.
 *
 * Only Interstates are covered: there is no equivalent federal register for US
 * Routes, which AASHTO delegates to the states.
 */
function attachOfficial(routes, ref) {
  if (!ref) return;
  let matched = 0;
  let costed = 0;

  // Both FHWA tables are keyed by route and state, so both join the same way:
  // add up only the states this particular road runs through. A route whose
  // states are missing from a table is something that table does not cover —
  // an unsigned or renumbered designation still present in the geometry — and
  // a partial sum for it would be worse than nothing, so it gets neither.
  const sumOverStates = (entry, mine) => {
    if (!entry) return null;
    const known = mine.filter((st) => entry.states[st] != null);
    if (!known.length || known.length < mine.length) return null;
    return { known, value: known.reduce((s, st) => s + entry.states[st], 0) };
  };

  // Both tables key a route by its signed designation, which is not quite how
  // the numbers arrive here: Hawaii's three Interstates are signed H-1, H-2 and
  // H-3 and filed that way by FHWA, but reach this point as H1, H2 and H3.
  // Without the hyphen none of them join, which costs the atlas the single
  // best-documented construction cost in the system.
  const lookup = (table, number) => {
    if (!table) return null;
    const hyphenated = String(number).replace(/^([A-Z]+)(\d)/, '$1-$2');
    return table[`I-${number}`] || table[number] || table[hyphenated] || null;
  };

  for (const r of routes) {
    if (r.system !== 'interstate') continue;
    const mine = r.states.map((s) => s.st);

    const miEntry = lookup(ref.mileage.routes, r.number);
    const mi = sumOverStates(miEntry, mine);
    if (mi) {
      r.offMi = Math.round(mi.value * 10) / 10;
      r.offCities = mi.known.flatMap((st) => (miEntry.cities[st] || []).map((c) => `${c}, ${st}`));
      matched++;
    }

    // Cost needs one more case than mileage. The cost table omits a state
    // wherever that state's mileage was not paid for with Interstate
    // Construction funds, so I-90 has no Indiana row (the Indiana Toll Road
    // was folded in) and I-95 has no District of Columbia row. Summing the
    // remaining states would then quietly understate the route.
    //
    // So: sum this route's own states when every one of them is present, which
    // is both the accurate answer and the one that excludes spending on
    // mileage since renumbered away (I-80's total still carries the Oregon
    // I-80N that is now I-84). Otherwise, when the two state sets agree apart
    // from a state or two, fall back to the published whole-route total and
    // record that that is what is being shown.
    const costEntry = lookup(ref.cost?.routes, r.number);
    const cost = sumOverStates(costEntry, mine);
    if (cost) {
      r.offCostK = Math.round(cost.value);
      costed++;
    } else if (costEntry?.total != null) {
      const tbl = Object.keys(costEntry.states);
      const shared = mine.filter((st) => tbl.includes(st)).length;
      if (shared >= tbl.length - 1 && shared >= mine.length - 2 && shared / tbl.length >= 0.8) {
        r.offCostK = Math.round(costEntry.total);
        r.offCostWhole = true;
        costed++;
      }
    }
  }
  console.log(`  official mileage matched for ${matched} Interstate routes`);
  console.log(`  official construction cost matched for ${costed} Interstate routes`);
}

function clusterByCorridor(pieces, tier) {
  if (tier === 'primary' && pieces.length > 1) {
    const clusters = [];
    for (const piece of pieces.sort((a, b) => b.km - a.km)) {
      const host = clusters.find((c) => statesTouch(c.stateSet, piece.stateSet));
      if (host) {
        host.members.push(piece);
        for (const st of piece.stateSet) host.stateSet.add(st);
      } else {
        clusters.push({ members: [piece], stateSet: new Set(piece.stateSet) });
      }
    }
    return clusters.map((c) => c.members);
  }
  return pieces.map((p) => [p]);
}

/**
 * Build Alaska's four Interstates.
 *
 * They are the only Interstates that cannot be read out of a signed-route
 * dataset, because they are unsigned: no marker, no atlas entry, no `class =
 * Interstate` row anywhere in the source. Alaska is otherwise the emptiest part
 * of the map - it has no US routes either, so at any zoom that shows the whole
 * state there was nothing drawn on it at all.
 *
 * So they are declared in content/reference/alaska-interstates.json as the
 * state routes they overlay plus their termini, and assembled here out of that
 * same state-route geometry. Nothing is drawn by hand.
 */
async function buildAlaskaInterstates(groups, placeGrid) {
  let spec;
  try {
    spec = JSON.parse(await readFile(join(ROOT, 'content', 'reference', 'alaska-interstates.json'), 'utf8'));
  } catch {
    console.log('  (no alaska-interstates.json; skipping)');
    return [];
  }

  const out = [];
  for (const [number, def] of Object.entries(spec.routes)) {
    // Only Alaskan pavement: the component numbers are state-route numbers, and
    // state routes are numbered per state, so route 1 exists in 40 states.
    const parts = def.components.flatMap((num) => {
      const g = groups.get(`state|${num}|AK`);
      return g ? g.parts : [];
    });
    if (!parts.length) {
      console.log(`  ${number}: no Alaska geometry for state routes ${def.components.join(', ')}`);
      continue;
    }

    const comp = stitchBetween(parts, def.from, def.to, { bridgeKm: 60 });
    if (!comp || comp.disconnected) {
      console.log(`  ${number}: termini do not connect through the component routes`);
      continue;
    }
    if (Math.max(...comp.snapKm) > 25) {
      console.log(`  ${number}: declared terminus is ${Math.max(...comp.snapKm)} km off the pavement; skipped`);
      continue;
    }

    const stats = compositionOf(comp.edges);
    const flat = comp.pieces.flat();
    out.push({
      key: `interstate|${number}`,
      system: 'interstate',
      tier: 'primary',
      number,
      base: null,
      label: number,
      qualifier: null,
      unsigned: true,
      mi: Math.round(comp.pieces.reduce((s, p) => s + lineLengthKm(p), 0) / KM_PER_MI),
      pavedMi: Math.round(comp.km / KM_PER_MI),
      spanMi: Math.round(haversineKm(flat[0], flat[flat.length - 1]) / KM_PER_MI),
      bbox: bboxOf(comp.pieces).map((v) => Math.round(v * 1000) / 1000),
      states: stats.states,
      types: stats.types,
      gradeSeparated: stats.gradeSeparated,
      tolled: stats.tolled,
      unpaved: stats.unpaved,
      dividedShare: stats.dividedShare,
      breaks: comp.pieces.length - 1,
      gapMi: Math.round(comp.gaps.reduce((s, g) => s + g, 0) / KM_PER_MI),
      // The declaration names the termini, so use those rather than whatever
      // settlement happens to sit nearest the last coordinate.
      start: { name: def.termini[0], st: 'AK', km: comp.snapKm[0] },
      end: { name: def.termini[1], st: 'AK', km: comp.snapKm[1] },
      _pieces: comp.pieces,
      _branches: [],
      _primarySt: 'AK',
    });
  }

  if (out.length) {
    console.log(`  ${out.length} unsigned Alaska Interstates: `
      + out.map((r) => `${r.label} ${r.mi}mi`).join(', '));
  }
  return out;
}

/**
 * What the Canadian road file records that the American one does not.
 *
 * The NRN carries lane count, posted speed and pavement status on every
 * segment. Those are length-weighted here rather than averaged flat, so a
 * 200 km two-lane run is not outvoted by a dozen short six-lane pieces through
 * a city. Anything the source leaves blank stays blank: the share of the route
 * each figure is actually based on travels with it, so a speed limit measured
 * over 12% of a road can be presented as exactly that.
 */
function canadaMetrics(edges) {
  let km = 0, tchKm = 0;
  let laneKm = 0, laneWeighted = 0;
  let speedKm = 0, speedWeighted = 0;
  let pavedKm = 0, pavedKnown = 0;
  for (const e of edges) {
    km += e.km;
    if (e.props.tch) tchKm += e.km;
    if (e.props.lanes) { laneKm += e.km; laneWeighted += e.props.lanes * e.km; }
    if (e.props.speed) { speedKm += e.km; speedWeighted += e.props.speed * e.km; }
    if (e.props.paved === true) { pavedKm += e.km; pavedKnown += e.km; }
    else if (e.props.paved === false) pavedKnown += e.km;
  }
  const share = (v) => Math.round((v / Math.max(km, 1e-9)) * 1000) / 10;
  return {
    km,
    tchKm: Math.round(tchKm),
    tchShare: share(tchKm),
    lanes: laneKm > 0 ? Math.round((laneWeighted / laneKm) * 10) / 10 : null,
    lanesCoverage: share(laneKm),
    speedKph: speedKm > 0 ? Math.round(speedWeighted / speedKm) : null,
    speedCoverage: share(speedKm),
    pavedShare: pavedKnown > 0 ? Math.round((pavedKm / pavedKnown) * 1000) / 10 : null,
    pavedCoverage: share(pavedKnown),
  };
}

/** The settlement at one end of a Canadian route, from the road file itself. */
function canadaTerminus(edges, atStart) {
  const e = atStart ? edges[0] : edges[edges.length - 1];
  const name = e?.props.lPlace || e?.props.rPlace;
  if (!name) return null;
  // The file records places as "Yukon, Unorganized" and the like for land
  // outside any municipality, which is a jurisdiction rather than a place.
  if (/unorganized|unincorporated|not applicable/i.test(name)) return null;
  const st = e.props.state;
  return { name: name.replace(/\s*\((RM|MD|ID|County|Municipality)[^)]*\)$/i, ''), st, km: 0 };
}

/**
 * Build Canada.
 *
 * Structurally the same job as the American side and deliberately written to
 * mirror it, so a Canadian route carries the same fields, gets the same
 * treatment and lands in the same index. The differences are all in the
 * source: route numbers restart at every provincial border, so every route is
 * keyed by jurisdiction; there is no national signed system to key against;
 * and the tier has to be measured rather than read, because carrying the
 * Trans-Canada is something a road does for part of its length.
 */
/**
 * How close two endpoints must be before they are treated as the same node,
 * for the Canadian sources. About 22 m, against 275 m on the American side.
 *
 * The two numbers differ because the two sources do. Natural Earth is
 * generalised to 1:1,000,000 and splits routes at state lines where the two
 * sides disagree by a couple of hundred metres, so it needs the loose
 * tolerance. The National Road Network is surveyed to 10 m and draws each
 * direction of a divided highway as its own centreline, often within 30 m of
 * the other - and at 275 m the two carriageways weld into one graph at every
 * point they pass close, after which the through path zigzags between them and
 * cuts every corner. That is what had Highway 401 at 773 km and Highway 17 at
 * 657 km of a 1,965 km road.
 *
 * Measured against published lengths, tightening this to 22 m takes 401 to
 * 821 km against 828, Highway 17 to 1,967 against 1,965, and Highway 11 to
 * 1,733 against 1,785.
 */
const CA_SNAP = 0.0002;

async function buildCanada() {
  const src = await loadCanada(ROOT);
  if (!src) return { routes: [], register: null };

  const routes = [];
  let done = 0;
  for (const grp of src.groups.values()) {
    if (++done % 600 === 0) console.log(`  stitching ${done}/${src.groups.size}`);

    const onNetwork = Boolean(grp.nhsTier);
    const firstPass = stitchRoute(grp.parts, {
      snapDeg: CA_SNAP,
      bridgeKm: onNetwork ? 60 : 30,
      minComponentKm: 1.5,
    });
    if (!firstPass.length) continue;

    // A designated route is one road, and its breaks are holes in the data or
    // genuine ferry crossings - British Columbia's Highway 1 reaches Vancouver
    // Island by ferry - so rebuild it as one corridor. An undesignated number
    // that comes out in pieces is more often two unrelated stretches, so those
    // are kept apart and numbered.
    const clusters = onNetwork && firstPass.length > 1
      ? [firstPass]
      : firstPass.map((c) => [c]);

    for (const members of clusters) {
      let comps = members;
      if (members.length > 1) {
        const parts = members.flatMap((m) => m.edges.map((e) => ({ coords: e.coords, props: e.props })));
        // 120 km spans the longest crossing a Canadian designated route
        // actually makes - Highway 1's ferry from Horseshoe Bay to Nanaimo is
        // about 50 - while refusing the absurd ones. A 1,000 km budget here
        // had the stitcher bridge Highway 17 across 726 km of Lake Superior
        // and report 230 km of a 1,965 km road.
        comps = stitchComponents(parts, CA_SNAP, 120).sort((a, b) => b.km - a.km);
      }
      // Whatever will not join stays as its own route rather than being
      // dropped. Keeping only the longest piece silently deleted road.
      for (const comp of comps) {
      if (!comp || comp.km < 1.5) continue;

      // Measured over the road as driven, not over every centreline in the
      // corridor: the source draws each direction of a divided highway
      // separately, so the two carriageways would otherwise both be counted.
      const stats = compositionOf(comp.pathEdges);
      const extra = canadaMetrics(comp.pathEdges);
      const system = canadaSystem(grp, extra);
      const pieces = orientMainline(comp.pieces);
      const flat = pieces.flat();
      const label = canadaLabel(grp, system);
      const names = [...grp.names.en].filter((n) => !/^trans[- ]canada/i.test(n));

      routes.push({
        // Same shape as the American keys - system, number, jurisdiction - so
        // id assignment, deduplication and per-jurisdiction splitting all work
        // on Canadian routes without knowing they are Canadian. No province
        // code collides with a state code, so the slugs stay unambiguous.
        key: `${system}|${grp.number}|${grp.pr}`,
        // Lower case to match the country codes the interface switches on,
        // in the system table and in the region jumps.
        country: 'ca',
        system,
        tier: system === 'provincial' ? 'state' : 'primary',
        number: grp.number,
        base: Number.parseInt(grp.number, 10) || null,
        label: label.en,
        labelZh: label.zh,
        qualifier: null,
        nhsTier: grp.nhsTier,
        tchKm: extra.tchKm,
        tchShare: extra.tchShare,
        lanes: extra.lanes,
        lanesCoverage: extra.lanesCoverage,
        speedKph: extra.speedKph,
        speedCoverage: extra.speedCoverage,
        pavedShare: extra.pavedShare,
        named: names.slice(0, 4),
        mi: Math.round(pieces.reduce((s, p) => s + lineLengthKm(p), 0) / KM_PER_MI),
        pavedMi: Math.round(comp.km / KM_PER_MI),
        spanMi: Math.round(haversineKm(flat[0], flat[flat.length - 1]) / KM_PER_MI),
        bbox: bboxOf([...pieces, ...comp.branches]).map((v) => Math.round(v * 1000) / 1000),
        states: stats.states,
        types: stats.types,
        gradeSeparated: stats.gradeSeparated,
        // The NRN has no toll attribute on road segments; toll points are a
        // separate layer. Reporting zero would read as "no tolls", which is
        // not what the source says, so it reports nothing.
        tolled: null,
        unpaved: stats.unpaved,
        dividedShare: stats.dividedShare,
        breaks: comp.pieces.length - 1,
        gapMi: Math.round(comp.gaps.reduce((s, g) => s + g, 0) / KM_PER_MI),
        start: canadaTerminus(comp.pathEdges, true),
        end: canadaTerminus(comp.pathEdges, false),
        _pieces: pieces,
        _branches: comp.branches,
        _primarySt: grp.pr,
      });
      }
    }
  }

  const by = { tch: 0, nhs: 0, provincial: 0 };
  for (const r of routes) by[r.system]++;
  console.log(`  ${routes.length} Canadian routes: Trans-Canada ${by.tch}, `
    + `National Highway System ${by.nhs}, provincial ${by.provincial}`);
  return { routes, register: src.register };
}

async function main() {
  console.log('reading roads shapefile...');
  const src = await shapefile.open(
    join(SRC, 'ne_10m_roads_north_america.shp'),
    join(SRC, 'ne_10m_roads_north_america.dbf'),
  );

  const groups = new Map();
  const contextLines = [];
  let read = 0;

  while (true) {
    const r = await src.read();
    if (r.done) break;
    const p = r.value.properties;
    read++;
    if (p.country !== 'United States') continue;
    const g = r.value.geometry;
    if (!g) continue;
    const rawParts = g.type === 'LineString' ? [g.coordinates]
      : g.type === 'MultiLineString' ? g.coordinates : [];

    const system = p.class === 'Interstate' ? 'interstate'
      : p.class === 'Federal' ? 'us'
        : p.class === 'State' ? 'state' : null;

    if (!system || p.number == null) {
      if (['Freeway', 'Tollway', 'Primary'].includes(p.type)) {
        for (const part of rawParts) if (part.length >= 2) contextLines.push(part);
      }
      continue;
    }

    const parsed = parseNumber(p.number);
    if (!parsed) continue;
    const tier = tierOf(system, parsed);
    const st = STATE_CODE[p.state] || 'XX';
    // State routes and signed variants repeat from state to state, so they are
    // keyed per state. Interstates and US routes are keyed nationally.
    const key = (system === 'state' || tier === 'special')
      ? `${system}|${parsed.raw}|${st}`
      : `${system}|${parsed.raw}`;
    if (!groups.has(key)) groups.set(key, { system, parsed, tier, parts: [] });
    for (const part of rawParts) {
      if (part.length < 2) continue;
      groups.get(key).parts.push({ coords: part, props: p });
    }
  }

  console.log(`read ${read} features -> ${groups.size} route groups`);
  console.log('loading gazetteer places...');
  const places = await loadPlaces();
  const placeGrid = buildPlaceIndex(places);
  console.log(`  ${places.length} places`);

  console.log('stitching routes...');
  const routes = [];
  const merges = [];
  let done = 0;

  for (const [key, grp] of groups) {
    if (++done % 900 === 0) console.log(`  ${done}/${groups.size}`);

    const firstPass = stitchRoute(grp.parts, { bridgeKm: grp.tier === 'state' ? 40 : 60 });
    if (!firstPass.length) continue;
    for (const piece of firstPass) {
      const comp = compositionOf(piece.edges);
      piece.stateSet = comp.stateSet;
    }

    const clusters = clusterByCorridor(firstPass, grp.tier);

    for (const members of clusters) {
      // Re-stitch the whole corridor at once with a budget wide enough to span
      // its holes, so the end-to-end path still comes out of a single search
      // and the pieces arrive in travel order.
      let comp;
      if (members.length > 1) {
        const parts = members.flatMap((m) => m.edges.map((e) => ({ coords: e.coords, props: e.props })));
        const restitched = stitchComponents(parts, 0.0025, 1000);
        comp = restitched.sort((a, b) => b.km - a.km)[0];
        const gapMi = Math.round(comp.gaps.reduce((s, g) => s + g, 0) / KM_PER_MI);
        merges.push({ key, pieces: members.length, mi: Math.round(comp.km / KM_PER_MI), gapMi });
      } else {
        comp = members[0];
      }
      if (!comp || comp.km < 1.2) continue;

      const pieces = orientMainline(comp.pieces);
      // Over the driven path, so the per-state mileage sums to the length
      // shown above it rather than to the length of every ramp as well.
      const stats = compositionOf(comp.pathEdges);
      const primarySt = stats.states[0]?.st || 'XX';
      const flat = pieces.flat();
      const bbox = bboxOf([...pieces, ...comp.branches]);

      routes.push({
        key,
        system: grp.system,
        tier: grp.tier,
        number: grp.parsed.raw,
        base: Number(grp.parsed.base) || null,
        label: labelFor(grp.system, grp.parsed, primarySt),
        qualifier: grp.parsed.qualifier || null,
        // Two different questions. `mi` is how far you drive end to end, the
        // mainline only. `pavedMi` adds the spurs and old alignments filed
        // under the same number, which is what the source's total describes.
        mi: Math.round(pieces.reduce((s, p) => s + lineLengthKm(p), 0) / KM_PER_MI),
        pavedMi: Math.round(comp.km / KM_PER_MI),
        spanMi: Math.round(haversineKm(flat[0], flat[flat.length - 1]) / KM_PER_MI),
        bbox: bbox.map((v) => Math.round(v * 1000) / 1000),
        states: stats.states,
        types: stats.types,
        gradeSeparated: stats.gradeSeparated,
        tolled: stats.tolled,
        unpaved: stats.unpaved,
        dividedShare: stats.dividedShare,
        breaks: comp.pieces.length - 1,
        gapMi: Math.round(comp.gaps.reduce((s, g) => s + g, 0) / KM_PER_MI),
        start: nearestPlace(placeGrid, flat[0]),
        end: nearestPlace(placeGrid, flat[flat.length - 1]),
        _pieces: pieces,
        _branches: comp.branches,
        _primarySt: primarySt,
      });
    }
  }

  console.log('composing unsigned Alaska Interstates...');
  routes.push(...await buildAlaskaInterstates(groups, placeGrid));

  console.log('\nreading Canadian road network...');
  const canada = await buildCanada();
  routes.push(...canada.routes);

  // Stable, readable ids. Interstates and US routes are unique nationally
  // unless the number is genuinely reused, in which case the state breaks the
  // tie (i-84-or versus i-84-ct).
  const byKey = new Map();
  for (const r of routes) {
    if (!byKey.has(r.key)) byKey.set(r.key, []);
    byKey.get(r.key).push(r);
  }
  for (const [key, rs] of byKey) {
    const [system, number, st] = key.split('|');
    const slug = `${system === 'interstate' ? 'i' : system === 'us' ? 'us' : st.toLowerCase()}-${number.toLowerCase()}`;
    rs.sort((a, b) => b.mi - a.mi);
    rs.forEach((r, i) => {
      if (rs.length === 1) { r.id = slug.replace(/[^a-z0-9-]/g, ''); return; }
      // Interstate and US numbers repeat across states, so the state tells the
      // namesakes apart. A state-route slug already opens with its state, so
      // repeating it would read as ca-1-ca; those fall back to an index.
      const sameState = rs.filter((o) => o._primarySt === r._primarySt);
      r.id = system === 'state'
        ? `${slug}-${i + 1}`
        : `${slug}-${r._primarySt.toLowerCase()}${sameState.length > 1 ? `-${sameState.indexOf(r) + 1}` : ''}`;
      r.id = r.id.replace(/[^a-z0-9-]/g, '');
    });
  }
  const used = new Map();
  for (const r of routes) {
    const n = (used.get(r.id) || 0) + 1;
    used.set(r.id, n);
    if (n > 1) r.id = `${r.id}-${n}`;
  }

  // Tell namesakes apart by where they are.
  //
  // A number is not unique inside a jurisdiction. Kentucky 80 arrives in five
  // disconnected stretches, and Ontario files county roads under the same
  // numbers as its provincial highways, so "ON 4" is Highway 4 plus some
  // thirty-five unrelated county roads that share the digit. The ids are
  // distinct, but the labels were not, so a search for a number returned a
  // column of identical rows and the reader had to click each one to find out
  // which road it was.
  //
  // The disambiguator is the route's own terminus, which is measured rather
  // than assigned, so nothing here invents a name for a road.
  for (const rs of byKey.values()) {
    if (rs.length < 2) continue;
    for (const r of rs) {
      const p = r.start?.name && r.start.name !== r.end?.name ? r.start : (r.end || r.start);
      if (p?.name) r.where = p.name;
    }
    // Where two siblings would end up with the same disambiguator it says
    // nothing, so fall back to naming both ends.
    const seen = new Map();
    for (const r of rs) seen.set(r.where, (seen.get(r.where) || 0) + 1);
    for (const r of rs) {
      if (r.where && seen.get(r.where) > 1 && r.start?.name && r.end?.name) {
        r.where = `${r.start.name} – ${r.end.name}`;
      }
    }
  }

  attachOfficial(routes, await loadOfficial());

  routes.sort((a, b) => b.mi - a.mi);
  console.log(`built ${routes.length} routes (${merges.length} corridors rebuilt across data gaps)`);

  // --- geometry ---
  // Full metrics ride along in the feature properties. The detail panel then
  // needs no second request, and the geometry it already has is the same
  // geometry the flythrough animates. `np` counts the leading linestrings that
  // form the mainline in travel order; anything after them is branch geometry.
  const featureOf = (r, tolDeg) => {
    const main = r._pieces.map((l) => roundCoords(simplify(l, tolDeg), 4)).filter((l) => l.length >= 2);
    const branches = r._branches.map((l) => roundCoords(simplify(l, tolDeg), 4)).filter((l) => l.length >= 2);
    return {
      type: 'Feature',
      id: r.id,
      properties: {
        id: r.id, sys: r.system, tier: r.tier, label: r.label, st: r._primarySt,
        num: r.number, base: r.base, mi: r.mi, pavedMi: r.pavedMi, offMi: r.offMi ?? null,
        offCostK: r.offCostK ?? null, offCostWhole: r.offCostWhole ?? null, spanMi: r.spanMi,
        gs: r.gradeSeparated, toll: r.tolled, unpaved: r.unpaved, div: r.dividedShare,
        breaks: r.breaks, gapMi: r.gapMi, np: main.length,
        states: r.states, types: r.types,
        start: r.start, end: r.end,
        where: r.where ?? null,
        unsigned: r.unsigned ?? null,
        // Canada only: the designation tier, how much of the route carries the
        // Trans-Canada, and the three things the NRN records that the American
        // source does not. Each is null everywhere it does not apply, so the
        // detail panel can simply ask.
        cc: r.country ?? null,
        nhsTier: r.nhsTier ?? null,
        tchKm: r.tchKm ?? null, tchShare: r.tchShare ?? null,
        lanes: r.lanes ?? null, lanesCov: r.lanesCoverage ?? null,
        kph: r.speedKph ?? null, kphCov: r.speedCoverage ?? null,
        pavedShare: r.pavedShare ?? null,
        named: r.named ?? null,
      },
      geometry: { type: 'MultiLineString', coordinates: [...main, ...branches] },
    };
  };

  await mkdir(join(OUT, 'geo', 'state'), { recursive: true });
  await mkdir(join(OUT, 'geo', 'provincial'), { recursive: true });
  const write = (path, data) => writeFile(path, JSON.stringify(data));
  const collection = (feats) => ({ type: 'FeatureCollection', features: feats });

  await write(join(OUT, 'geo', 'interstate.json'),
    collection(routes.filter((r) => r.system === 'interstate').map((r) => featureOf(r, 0.004))));
  await write(join(OUT, 'geo', 'us.json'),
    collection(routes.filter((r) => r.system === 'us').map((r) => featureOf(r, 0.005))));
  await write(join(OUT, 'geo', 'tch.json'),
    collection(routes.filter((r) => r.system === 'tch').map((r) => featureOf(r, 0.004))));
  await write(join(OUT, 'geo', 'nhs.json'),
    collection(routes.filter((r) => r.system === 'nhs').map((r) => featureOf(r, 0.005))));

  // The two big per-jurisdiction tiers load one jurisdiction at a time: all of
  // them at once is 6,750 state routes and several thousand provincial ones,
  // which is far more than any one view needs.
  for (const [system, dir, tol] of [['state', 'state', 0.006], ['provincial', 'provincial', 0.006]]) {
    const byJuris = new Map();
    for (const r of routes.filter((x) => x.system === system)) {
      if (!byJuris.has(r._primarySt)) byJuris.set(r._primarySt, []);
      byJuris.get(r._primarySt).push(r);
    }
    for (const [st, rs] of byJuris) {
      await write(join(OUT, 'geo', dir, `${st}.json`), collection(rs.map((r) => featureOf(r, tol))));
    }
  }

  await write(join(OUT, 'geo', 'context.json'), collection([{
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'MultiLineString',
      coordinates: contextLines.map((l) => roundCoords(simplify(l, 0.02), 3)).filter((l) => l.length >= 2),
    },
  }]));

  // The index is deliberately lean: it exists so search and the dashboard can
  // reach all 7,500 routes without pulling any geometry. Detail lives in the
  // feature properties, fetched with the geometry when a system is switched on.
  const SYS_CODE = {
    interstate: 'i', us: 'u', state: 's', tch: 't', nhs: 'n', provincial: 'r',
  };
  await write(join(OUT, 'index.json'), {
    generated: new Date().toISOString().slice(0, 10),
    fields: ['id', 'label', 'sys', 'tier', 'st', 'mi', 'base', 'num', 'cx', 'cy', 'gs', 'ns', 'where'],
    routes: routes.map((r) => [
      r.id, r.label, SYS_CODE[r.system], { primary: 'p', auxiliary: 'a', special: 'x', state: 's' }[r.tier],
      r._primarySt, r.offMi ? Math.round(r.offMi) : r.mi, r.base, r.number,
      Math.round(((r.bbox[0] + r.bbox[2]) / 2) * 100) / 100,
      Math.round(((r.bbox[1] + r.bbox[3]) / 2) * 100) / 100,
      // Only set where a number is shared, so it costs nothing on the
      // overwhelming majority of routes that need no disambiguation.
      r.gradeSeparated, r.states.length, r.where ?? null,
    ]),
  });

  // Towns of 5,000+ that each Interstate serves, straight from the Route Log.
  // Split out of the geometry because it is only read when a detail panel
  // opens, and it would otherwise add a megabyte to the map payload.
  await write(join(OUT, 'served.json'), Object.fromEntries(
    routes.filter((r) => r.offCities?.length).map((r) => [r.id, r.offCities]),
  ));

  // --- dashboard aggregates ---
  const stats = {
    bySystem: {},
    byState: {},
    byType: {},
    sources: {
      us: 'Natural Earth 1:1M roads, US Census gazetteer, FHWA Route Log',
      ca: 'Statistics Canada National Road Network, Transport Canada National Highway System',
    },
    canada: canada.register?.inventory ?? null,
  };
  for (const r of routes) {
    const s = stats.bySystem[r.system] ||= { routes: 0, mi: 0, gsMi: 0, tollMi: 0 };
    s.routes++;
    s.mi += r.mi;
    s.gsMi += Math.round((r.gradeSeparated / 100) * r.mi);
    s.tollMi += Math.round((r.tolled / 100) * r.mi);
    for (const { st, mi } of r.states) {
      // Per-system buckets are created on demand rather than declared, because
      // the six systems are not shared between the two countries and naming
      // them here once meant every Canadian mile landed on an absent key.
      const e = stats.byState[st] ||= { cc: r.country ?? 'us', mi: 0, routes: 0 };
      e.mi += mi;
      e[r.system] = (e[r.system] || 0) + mi;
      e.routes++;
    }
    for (const [t, share] of Object.entries(r.types)) {
      stats.byType[t] = (stats.byType[t] || 0) + Math.round((share / 100) * r.mi);
    }
  }
  await write(join(OUT, 'stats.json'), stats);

  console.log('\n--- summary ---');
  for (const [sys, s] of Object.entries(stats.bySystem)) {
    console.log(`${sys.padEnd(11)} ${String(s.routes).padStart(5)} routes ${String(s.mi).padStart(7)} mi`
      + `  grade-separated ${String(Math.round((s.gsMi / s.mi) * 100)).padStart(3)}%  tolled ${Math.round((s.tollMi / s.mi) * 100)}%`);
  }
  console.log('\nlongest routes  (measured mainline vs FHWA Route Log):');
  for (const r of routes.slice(0, 22)) {
    const off = r.offMi ? `${String(Math.round(r.offMi)).padStart(5)}` : '    -';
    const err = r.offMi ? `${(((r.mi - r.offMi) / r.offMi) * 100).toFixed(1).padStart(5)}%` : '      ';
    console.log(`  ${r.label.padEnd(9)} ${String(r.mi).padStart(5)} vs ${off}${err}`
      + ` ${String(r.states.length).padStart(2)}st brk=${String(r.breaks).padStart(2)}  `
      + `${r.start?.name ?? '?'}, ${r.start?.st ?? '?'} -> ${r.end?.name ?? '?'}, ${r.end?.st ?? '?'}`);
  }

  // How closely the stitched geometry tracks the official register, across
  // every route the register covers. This is the pipeline's accuracy check:
  // the geometry is 1:1M generalised, so a few per cent under is expected,
  // and anything wilder means the stitcher took a wrong turn.
  const checked = routes.filter((r) => r.offMi > 5).map((r) => ({
    r, err: ((r.mi - r.offMi) / r.offMi) * 100,
  }));
  if (checked.length) {
    const errs = checked.map((c) => c.err).sort((a, b) => a - b);
    const pct = (q) => errs[Math.floor((errs.length - 1) * q)].toFixed(1);
    const within = (n) => Math.round((errs.filter((e) => Math.abs(e) <= n).length / errs.length) * 100);
    console.log(`\naccuracy vs FHWA over ${checked.length} routes:`);
    console.log(`  median ${pct(0.5)}%   p10 ${pct(0.1)}%   p90 ${pct(0.9)}%`);
    console.log(`  within 5%: ${within(5)}%   within 10%: ${within(10)}%   within 25%: ${within(25)}%`);
    const worst = checked.sort((a, b) => Math.abs(b.err) - Math.abs(a.err)).slice(0, 12);
    console.log('  largest disagreements:');
    for (const { r, err } of worst) {
      console.log(`    ${r.id.padEnd(12)} ${String(r.mi).padStart(5)} vs ${String(Math.round(r.offMi)).padStart(5)}`
        + ` ${err.toFixed(0).padStart(5)}%  ${r.states.map((s) => s.st).join('/')}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
