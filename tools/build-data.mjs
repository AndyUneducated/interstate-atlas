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
  bboxOf, haversineKm, lineLengthKm, roundCoords, simplify, stitchComponents, stitchRoute,
} from './geo.mjs';
import { STATE_CODE, statesTouch } from './states.mjs';

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
    return `I-${parsed.base}${parsed.hawaii ? '' : parsed.suffix}`;
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
    const st = STATE_CODE[e.props.state];
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
  try {
    const p = join(ROOT, 'content', 'reference', 'fhwa-mileage.json');
    return JSON.parse(await readFile(p, 'utf8'));
  } catch {
    console.log('  (no FHWA reference file; run tools/fetch-fhwa.mjs)');
    return null;
  }
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
  for (const r of routes) {
    if (r.system !== 'interstate') continue;
    const entry = ref.routes[`I-${r.number}`] || ref.routes[r.number];
    if (!entry) continue;

    const mine = r.states.map((s) => s.st);
    const known = mine.filter((st) => entry.states[st] != null);
    // A route whose states are absent from the log is something the log does
    // not cover — an unsigned or decommissioned designation still in the
    // geometry. Reporting a partial sum for it would be worse than nothing.
    if (!known.length || known.length < mine.length) continue;

    r.offMi = Math.round(known.reduce((s, st) => s + entry.states[st], 0) * 10) / 10;
    r.offCities = known.flatMap((st) => (entry.cities[st] || []).map((c) => `${c}, ${st}`));
    matched++;
  }
  console.log(`  official mileage matched for ${matched} Interstate routes`);
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
      const stats = compositionOf(comp.edges);
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
        spanMi: r.spanMi,
        gs: r.gradeSeparated, toll: r.tolled, unpaved: r.unpaved, div: r.dividedShare,
        breaks: r.breaks, gapMi: r.gapMi, np: main.length,
        states: r.states, types: r.types,
        start: r.start, end: r.end,
      },
      geometry: { type: 'MultiLineString', coordinates: [...main, ...branches] },
    };
  };

  await mkdir(join(OUT, 'geo', 'state'), { recursive: true });
  const write = (path, data) => writeFile(path, JSON.stringify(data));
  const collection = (feats) => ({ type: 'FeatureCollection', features: feats });

  await write(join(OUT, 'geo', 'interstate.json'),
    collection(routes.filter((r) => r.system === 'interstate').map((r) => featureOf(r, 0.004))));
  await write(join(OUT, 'geo', 'us.json'),
    collection(routes.filter((r) => r.system === 'us').map((r) => featureOf(r, 0.005))));

  const byState = new Map();
  for (const r of routes.filter((x) => x.system === 'state')) {
    if (!byState.has(r._primarySt)) byState.set(r._primarySt, []);
    byState.get(r._primarySt).push(r);
  }
  for (const [st, rs] of byState) {
    await write(join(OUT, 'geo', 'state', `${st}.json`), collection(rs.map((r) => featureOf(r, 0.006))));
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
  await write(join(OUT, 'index.json'), {
    generated: new Date().toISOString().slice(0, 10),
    fields: ['id', 'label', 'sys', 'tier', 'st', 'mi', 'base', 'num', 'cx', 'cy', 'gs', 'ns'],
    routes: routes.map((r) => [
      r.id, r.label, r.system[0], { primary: 'p', auxiliary: 'a', special: 'x', state: 's' }[r.tier],
      r._primarySt, r.offMi ? Math.round(r.offMi) : r.mi, r.base, r.number,
      Math.round(((r.bbox[0] + r.bbox[2]) / 2) * 100) / 100,
      Math.round(((r.bbox[1] + r.bbox[3]) / 2) * 100) / 100,
      r.gradeSeparated, r.states.length,
    ]),
  });

  // Towns of 5,000+ that each Interstate serves, straight from the Route Log.
  // Split out of the geometry because it is only read when a detail panel
  // opens, and it would otherwise add a megabyte to the map payload.
  await write(join(OUT, 'served.json'), Object.fromEntries(
    routes.filter((r) => r.offCities?.length).map((r) => [r.id, r.offCities]),
  ));

  // --- dashboard aggregates ---
  const stats = { bySystem: {}, byState: {}, byType: {}, source: 'Natural Earth 1:1M + US Census gazetteer' };
  for (const r of routes) {
    const s = stats.bySystem[r.system] ||= { routes: 0, mi: 0, gsMi: 0, tollMi: 0 };
    s.routes++;
    s.mi += r.mi;
    s.gsMi += Math.round((r.gradeSeparated / 100) * r.mi);
    s.tollMi += Math.round((r.tolled / 100) * r.mi);
    for (const { st, mi } of r.states) {
      const e = stats.byState[st] ||= { mi: 0, interstate: 0, us: 0, state: 0, routes: 0 };
      e.mi += mi;
      e[r.system] += mi;
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
