// Builds data/tolls.json, the toll facility layer and the per-route toll notes,
// from content/reference/tolls-ca.json, content/reference/mx-concessions.json
// and the route geometry already built.
//
//   node tools/build-tolls.mjs
//
// Canada's facilities are drawn. A toll road or bridge is the part of its
// atlas route between the two ends the geocoder placed, and it is drawn only
// if that part measures within LENGTH_TOLERANCE of the length its operator
// publishes - a cut that comes out a different length has found the wrong
// stretch, and is reported rather than shown. A bridge with no length of its
// own is a point: the border crossing it carries, or the end of the route that
// runs onto it.
//
// Mexico's concession titles are not drawn, because nothing publishes where
// a concession begins and ends on the ground. A title is attached to a route
// where it writes the route's federal number, in the states it names, or
// where it writes the name SICT gives that route's road and a person has
// accepted the match in content/reference/mx-concession-matches.json.
//
// Mexico's toll plazas are drawn as points from the RNC's plaza_cobro layer in
// tools/src/mx/, which fetch-mexico.mjs downloads with the road network.
//
// Taiwan's ETC charging gantries are drawn as points from the Freeway Bureau's
// list in tools/src/tw/, one point for both directions of a gantry, and each
// freeway's route panel gets its tolled distance and the toll stations the
// gantries replaced (D-79).

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as shapefile from 'shapefile';
import { geoPath, systemOfCode, IX } from '../assets/schema.js';
import { writeOut } from './write.mjs';
import { loadFreewayTolls } from './taiwan.mjs';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'data', 'tolls.json');
const SNAP_KM = 2;
const LENGTH_TOLERANCE = 0.1;
// A bridge is placed at its Canadian plaza, and a route that runs onto it from
// the far bank reaches it a bridge's length away.
const NEAR_KM = 2;
// A Hong Kong toll point stands on its tunnel's approach, and the route drawn
// through it can be a carriageway's width or two away.
const HK_NEAR_KM = 0.3;

const read = async (p) => JSON.parse(await readFile(join(ROOT, p), 'utf8'));
const linesOf = (g) => (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []);

function km(a, b) {
  const kx = 111.32 * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 110.57);
}

/** The nearest point on a line to pt: segment index, fraction along it, and distance. */
function snap(pt, line) {
  let best = { km: Infinity, i: 0, t: 0, at: line[0] };
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const kx = 111.32 * Math.cos((pt[1] * Math.PI) / 180), ky = 110.57;
    const ax = (a[0] - pt[0]) * kx, ay = (a[1] - pt[1]) * ky;
    const dx = (b[0] - a[0]) * kx, dy = (b[1] - a[1]) * ky;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best.km) best = { km: d, i, t, at: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])] };
  }
  return best;
}

/** The part of one line between two snapped positions, in line order. */
function between(line, p, q) {
  const [s, e] = p.i + p.t <= q.i + q.t ? [p, q] : [q, p];
  return [s.at, ...line.slice(s.i, e.i), e.at];
}

const lengthKm = (line) => line.reduce((sum, v, i) => (i ? sum + km(line[i - 1], v) : 0), 0);
const round = (v) => [Number(v[0].toFixed(5)), Number(v[1].toFixed(5))];

async function main() {
  const ca = await read('content/reference/tolls-ca.json');
  const mx = await read('content/reference/mx-concessions.json');
  const matches = await read('content/reference/mx-concession-matches.json');
  const designations = await read('content/reference/mx-designations.json');
  const crossings = await read('data/crossings.json');
  const index = await read('data/index.json');
  const meta = new Map(index.routes.map((r) => [r[IX.id], r]));

  // Geometry, for the routes the Canadian facilities name.
  const geo = new Map();
  const files = new Map();
  for (const f of ca.facilities) {
    for (const id of [...(f.routes ?? []), f.point?.routeEnd].filter(Boolean)) {
      const r = meta.get(id);
      if (!r) throw new Error(`${f.id}: no atlas route ${id}`);
      const path = geoPath(systemOfCode(r[IX.sys]).id, r[IX.st]);
      if (!files.has(path)) files.set(path, (await read(`data/geo/${path}`)).features);
      const feat = files.get(path).find((x) => x.properties.id === id);
      geo.set(id, linesOf(feat.geometry));
    }
  }

  const features = [];
  const facilities = {};
  const byRoute = {};
  const attach = (route, entry) => { (byRoute[route] ??= []).push(entry); };
  const report = [];

  for (const f of ca.facilities) {
    const rec = {
      name: f.name, kind: f.kind, juris: f.juris, operator: f.operator, facts: f.facts,
      fares: f.fares, fareNote: f.fareNote ?? null, lengthKm: f.lengthKm ?? null, opened: f.opened ?? null,
      fbcl: f.fbcl ? ca.fbcl : null,
    };

    if (f.extent) {
      // The one line, of every line on every route named, that passes within
      // SNAP_KM of both ends.
      let cut = null;
      const lines = f.routes.flatMap((id) => geo.get(id).map((line) => ({ id, line })));
      for (const { id, line } of lines) {
        const p = snap(f.extent.from.at, line), q = snap(f.extent.to.at, line);
        if (p.km > SNAP_KM || q.km > SNAP_KM) continue;
        const part = between(line, p, q);
        if (!cut || p.km + q.km < cut.off) cut = { ids: [id], part, len: lengthKm(part), off: p.km + q.km };
      }
      // Failing that, two lines that meet end to end, one reaching each end.
      // A crossing between provinces is two routes, each numbered by its own
      // side, joined at the boundary - the Confederation Bridge is PE 1 to
      // mid-strait and NB 16 from there.
      if (!cut) {
        for (const a of lines) {
          const p = snap(f.extent.from.at, a.line);
          if (p.km > SNAP_KM) continue;
          for (const b of lines) {
            if (b === a) continue;
            const q = snap(f.extent.to.at, b.line);
            if (q.km > SNAP_KM) continue;
            const ends = (l) => [l[0], l[l.length - 1]];
            let join = null;
            for (const ea of ends(a.line)) for (const eb of ends(b.line)) {
              if (!join || km(ea, eb) < join.gap) join = { ea, eb, gap: km(ea, eb) };
            }
            if (join.gap > 0.5) continue;
            const ja = snap(join.ea, a.line), jb = snap(join.eb, b.line);
            // between() returns line order; each half has to run outward-in.
            const sa = between(a.line, p, ja);
            if (sa[0] !== p.at) sa.reverse();
            const sb = between(b.line, jb, q);
            if (sb[0] !== jb.at) sb.reverse();
            const joined = [...sa, ...sb];
            const off = p.km + q.km + join.gap;
            if (!cut || off < cut.off) cut = { ids: [...new Set([a.id, b.id])], part: joined, len: lengthKm(joined), off };
          }
        }
      }
      const want = f.lengthKm.value;
      if (!cut || Math.abs(cut.len - want) / want > LENGTH_TOLERANCE) {
        report.push(`  ${f.id}: NOT DRAWN, ${cut ? `cut measures ${cut.len.toFixed(1)} km against ${want} published` : `no route passes within ${SNAP_KM} km of both ends`}`);
        rec.drawn = null;
      } else {
        rec.drawn = { routes: cut.ids, km: Number(cut.len.toFixed(1)), by: 'extent' };
        features.push({ type: 'Feature', id: f.id, properties: { id: f.id, kind: f.kind }, geometry: { type: 'LineString', coordinates: cut.part.map(round) } });
        for (const id of cut.ids) attach(id, { facility: f.id, on: true });
        report.push(`  ${f.id}: on ${cut.ids.join(' + ')}, ${cut.len.toFixed(1)} km against ${want} published`);
      }
    } else if (f.point) {
      let at = null;
      if (f.point.crossing) {
        const c = crossings.features.find((x) => x.properties.id === f.point.crossing);
        if (!c) throw new Error(`${f.id}: no crossing ${f.point.crossing}`);
        at = c.geometry.coordinates;
        rec.drawn = { by: 'crossing', precision: c.properties.precision };
      } else if (f.point.routeEnd) {
        // The route's northern end, which for a road that runs onto a bridge
        // into Canada is where the bridge begins.
        const ends = geo.get(f.point.routeEnd).flatMap((l) => [l[0], l[l.length - 1]]);
        at = ends.reduce((a, b) => (b[1] > a[1] ? b : a));
        rec.drawn = { by: 'routeEnd', route: f.point.routeEnd };
      }
      features.push({ type: 'Feature', id: f.id, properties: { id: f.id, kind: f.kind }, geometry: { type: 'Point', coordinates: round(at) } });
      // The routes said to run onto the bridge, kept only if they do come
      // within NEAR_KM of where it was placed.
      const kept = [], dropped = [];
      for (const id of f.routes ?? []) {
        const d = Math.min(...geo.get(id).map((l) => snap(at, l).km));
        (d <= NEAR_KM ? kept : dropped).push(`${id} ${d.toFixed(1)} km`);
        if (d <= NEAR_KM) attach(id, { facility: f.id, on: false });
      }
      report.push(`  ${f.id}: point by ${rec.drawn.by}; routes ${kept.join(', ') || 'none'}${dropped.length ? `; too far: ${dropped.join(', ')}` : ''}`);
    }
    facilities[f.id] = rec;
  }

  // Mexico: by written number, on a route that passes through a named state.
  // The index gives one state per route, the one holding most of it, so a
  // federal road's whole list of states is read off its geometry file.
  const federal = (await read(`data/geo/${geoPath('mx-federal')}`)).features.map((x) => ({
    id: x.properties.id,
    num: String(x.properties.num).replace(/D$/, ''),
    states: (typeof x.properties.states === 'string' ? JSON.parse(x.properties.states) : x.properties.states ?? []).map((s) => s.st),
  }));
  const titles = {};
  let linked = 0;
  for (const x of mx.titles) {
    if (!x.numbers.length || !x.states.length) continue;
    const routes = federal.filter((r) => x.numbers.some((n) => n.replace(/D$/, '') === r.num)
      && r.states.some((s) => x.states.includes(s)));
    if (!routes.length) {
      report.push(`  title ${x.n} (${x.numbers.join(',')} in ${x.states.join('/')}): no atlas route by that number in those states`);
      continue;
    }
    titles[x.n] = { object: x.object, concessionaire: x.concessionaire, granted: x.granted, ends: x.ends, builds: x.builds, document: x.document };
    for (const r of routes) attach(r.id, { title: x.n });
    linked++;
  }

  // Titles that name their road by places, linked through SICT's own road
  // names where a person has accepted the proposal.
  const byName = new Map();
  for (const p of matches.proposals) {
    if (p.approved !== true) continue;
    for (const id of p.routes) {
      const k = `${p.title}|${id}`;
      if (!byName.has(k)) byName.set(k, { title: p.title, route: id, names: [] });
      const names = byName.get(k).names;
      if (!names.includes(p.sict.name)) names.push(p.sict.name);
    }
  }
  const named = new Set();
  for (const { title, route, names } of byName.values()) {
    const x = mx.titles.find((t) => t.n === title);
    if (!meta.has(route)) throw new Error(`concession ${title}: no atlas route ${route}`);
    titles[title] ??= { object: x.object, concessionaire: x.concessionaire, granted: x.granted, ends: x.ends, builds: x.builds, document: x.document };
    if (byRoute[route]?.some((e) => e.title === title)) continue;
    attach(route, { title, sictNames: names });
    named.add(title);
  }
  linked += named.size;

  // Mexico's toll plazas, as the RNC places them. Points only: a plaza is where
  // a toll is paid, not where the tolled road begins or ends. A closed system
  // has a plaza at each entry and exit, so the count is booths, not roads.
  const rnc = await read('tools/src/mx/edition.json');
  const plazaFile = join(ROOT, 'tools', 'src', 'mx', 'plaza_cobro');
  const plazas = await shapefile.open(`${plazaFile}.shp`, `${plazaFile}.dbf`, { encoding: 'utf-8' });
  let plazaCount = 0;
  for (;;) {
    const r = await plazas.read();
    if (r.done) break;
    const p = r.value.properties;
    if (!r.value.geometry) continue;
    const id = `mx-plaza-${p.ID_PLAZA}`;
    const text = (v) => (v && v !== 'N/A' ? String(v).trim() : null);
    features.push({
      type: 'Feature', id,
      properties: {
        id, kind: 'plaza', name: text(p.NOMBRE), admin: text(p.ADMINISTRA),
        section: text(p.SECCION), subsection: text(p.SUBSECCION),
        mode: text(p.MODALIDAD), dir: text(p.FUNCIONAL), place: text(p.CALIREPR),
      },
      geometry: { type: 'Point', coordinates: round(r.value.geometry.coordinates) },
    });
    plazaCount++;
  }

  // Taiwan's freeways, from the Freeway Bureau's own lists. A gantry is where
  // the charge for one section is levied, so a freeway's tolled distance is
  // the sum of its gantries' sections in the direction that has more. Every
  // freeway gets an entry, so one with no gantry says so.
  const twTolls = await loadFreewayTolls();
  const gantries = {};
  const twRoutes = {};
  const twSources = {};
  let gantryCount = 0;
  if (twTolls) {
    const tw = await read('tools/src/tw/editions.json');
    for (const r of index.routes.filter((x) => systemOfCode(x[IX.sys])?.id === 'tw-freeway')) {
      twRoutes[r[IX.id]] = { number: String(r[IX.num]), gantries: 0, viaduct: 0, tolledKm: 0, stations: [] };
    }
    const routeOf = (number) => `tw-fwy-${number.toLowerCase()}`;
    const sums = {};
    for (const g of twTolls.gantries) {
      const route = twRoutes[routeOf(g.number)];
      if (!route) { report.push(`  gantry ${g.id}: no atlas freeway ${g.number}`); continue; }
      const id = `tw-gantry-${g.id}`;
      gantries[id] = { number: g.number, viaduct: g.elevated, at: g.at, dirs: g.dirs };
      features.push({ type: 'Feature', id, properties: { id, kind: 'gantry' }, geometry: { type: 'Point', coordinates: round(g.coord) } });
      gantryCount++;
      for (const d of g.dirs) {
        const k = `${g.number}|${g.elevated ? 'v' : 'm'}|${d.dir}`;
        sums[k] ??= { n: 0, km: 0 };
        sums[k].n++;
        sums[k].km += d.km ?? 0;
      }
    }
    // Counted per direction: the two directions' gantries do not always
    // stand at the same chainage, so a point is not a pair.
    for (const [k, v] of Object.entries(sums)) {
      const [number, line] = k.split('|');
      const route = twRoutes[routeOf(number)];
      if (line === 'v') { route.viaduct = Math.max(route.viaduct, v.n); continue; }
      route.gantries = Math.max(route.gantries, v.n);
      route.tolledKm = Math.max(route.tolledKm, Math.round(v.km * 10) / 10);
    }
    for (const s of twTolls.stations) {
      const route = twRoutes[routeOf(s.number)];
      if (!route) { report.push(`  toll station ${s.name}: no atlas freeway ${s.number}`); continue; }
      route.stations.push({ name: s.name, at: s.at, built: s.built, from: s.from, to: s.to, note: s.note });
    }
    for (const [id, route] of Object.entries(twRoutes)) {
      attach(id, { tw: true });
      report.push(`  ${id}: ${route.gantries} gantries${route.viaduct ? ` + ${route.viaduct} on the viaduct` : ''}, ${route.tolledKm} km tolled, ${route.stations.length} former stations`);
    }
    twSources.twGantries = { title: tw.gantries.source, url: tw.gantries.url, updated: tw.gantries.edition };
    twSources.twStations = { title: tw.stations.source, url: tw.stations.url, updated: tw.stations.edition };
  }

  // Hong Kong's tolled tunnels, from the Transport Department's two toll
  // tables. Each names the toll points it is paid at, and a facility is drawn
  // at their middle; one whose points are not among the traffic features is
  // drawn at the middle of the strategic-route centrelines that carry its
  // name. A backup toll point shares its tunnel's rates and is not a second
  // facility. The fare shown is the private car's (D-80).
  const hkTolls = await read('tools/src/hk/tolls.json').catch(() => null);
  const hk = {};
  if (hkTolls) {
    const hkGeo = (await read(`data/geo/${geoPath('hk-route')}`)).features.map((x) => ({ id: x.properties.id, lines: linesOf(x.geometry) }));
    const centrelines = (await read('tools/src/hk/routes.json')).features;
    const points = new Map(hkTolls.points.map((p) => [p.id, p.at]));
    const slug = (s) => `hk-${s.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    const rows = [...hkTolls.flat.map((r) => ({ ...r, kind: 'flat' })), ...hkTolls.varying.map((r) => ({ ...r, kind: 'varying' }))]
      .filter((r) => !/Backup Toll Point/i.test(r.name));
    for (const r of rows) {
      const id = slug(r.name);
      const f = hk[id] ??= { name: { en: r.name, zh: r.nameZh }, points: new Set(), flat: null, varying: null, updated: null };
      r.points.forEach((p) => f.points.add(p));
      if (r.updated && (!f.updated || r.updated > f.updated)) f.updated = r.updated;
      if (r.vehicle !== 'PC') continue;
      if (r.kind === 'flat') f.flat = { toll: r.toll, concession: r.concession !== r.toll ? r.concession : null, from: r.from };
      else {
        f.varying ??= { from: r.from, A: [Infinity, 0], B: [Infinity, 0] };
        const band = f.varying[r.days];
        if (band) { band[0] = Math.min(band[0], r.toll); band[1] = Math.max(band[1], r.toll); }
      }
    }
    for (const [id, f] of Object.entries(hk)) {
      const found = [...f.points].map((p) => points.get(p)).filter(Boolean);
      let at = null;
      if (found.length) {
        at = [0, 1].map((k) => found.reduce((s, p) => s + p[k], 0) / found.length);
        f.placed = 'point';
      } else {
        const named = centrelines.filter((c) => c.properties.STREET_ENAME === f.name.en.toUpperCase());
        const vs = named.flatMap((c) => linesOf(c.geometry).flat());
        if (vs.length) {
          at = [0, 1].map((k) => vs.reduce((s, p) => s + p[k], 0) / vs.length);
          f.placed = 'name';
        }
      }
      delete f.points;
      if (!at) { report.push(`  ${id}: NOT DRAWN, no toll point and no centreline by its name`); f.placed = null; continue; }
      features.push({ type: 'Feature', id, properties: { id, kind: 'tunnel' }, geometry: { type: 'Point', coordinates: round(at) } });
      // Each tunnel carries one strategic route; the next nearest is a road
      // that meets it at the portal.
      const near = hkGeo.map((r) => ({ id: r.id, km: Math.min(...r.lines.map((l) => snap(at, l).km)) }))
        .sort((a, b) => a.km - b.km).slice(0, 1).filter((r) => r.km <= HK_NEAR_KM);
      for (const r of near) attach(r.id, { hk: id });
      report.push(`  ${id}: by ${f.placed}; routes ${near.map((r) => `${r.id} ${(r.km * 1000).toFixed(0)} m`).join(', ') || 'none'}; car ${f.flat ? `HK$${f.flat.toll}` : `HK$${f.varying.A[0]}-${f.varying.A[1]}`}`);
    }
    twSources.hkTolls = { title: hkTolls.source, url: hkTolls.url, updated: hkTolls.updated, retrieved: hkTolls.retrieved };
  }

  const out = {
    generated: new Date().toISOString().slice(0, 10),
    nearKm: NEAR_KM,
    sources: {
      mx: mx.source,
      mxNames: { title: 'Datos Viales 2025', agency: designations.agency, url: designations.url },
      mxPlazas: { title: rnc.source, url: rnc.programme, updated: rnc.updated, retrieved: rnc.retrieved },
      ...twSources,
    },
    mxRetrieved: mx.retrieved,
    caRetrieved: ca.retrieved,
    facilities,
    titles,
    gantries,
    twRoutes,
    hk,
    byRoute,
    type: 'FeatureCollection',
    features,
  };
  await writeOut(OUT, `${JSON.stringify(out)}\n`);
  const hkDrawn = Object.values(hk).filter((f) => f.placed).length;
  console.log(`tolls: ${features.length - plazaCount - gantryCount - hkDrawn} of ${ca.facilities.length} Canadian facilities drawn;`
    + ` ${plazaCount} Mexican toll plazas; ${gantryCount} Taiwanese gantries; ${hkDrawn} of ${Object.keys(hk).length} Hong Kong tunnels;`
    + ` ${linked} of ${mx.titles.length} Mexican titles linked to ${Object.keys(byRoute).filter((k) => byRoute[k].some((e) => e.title)).length} routes`);
  for (const line of report) console.log(line);
}

main().catch((e) => { console.error(e); process.exit(1); });
