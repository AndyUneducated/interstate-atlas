// Builds data/bridges/us/, the American part of the bridge layer, from FHWA's
// National Bridge Inventory (tools/src/us/, from fetch-nbi.mjs) and the route
// geometry already built into data/geo/.
//
//   node tools/build-us-bridges.mjs
//
// Only the bridges that carry an atlas route are kept (D-84). The inventory
// says which route a structure carries - its record type 1 is "route on the
// structure", with the route's kind (Interstate, US, state) and number - so a
// bridge is kept when the atlas draws a route of that kind and number, in that
// state for a state route, and the bridge lies within MATCH_KM of it. The
// distance test is what keeps a Texas farm-to-market road's bridge off the
// state highway that happens to share its number.
//
// A quarter of a million structures is too many for one file the browser
// loads at once, so they are written a state to a file, with an index of each
// state's extent for the page to load the states in view.

import { createReadStream } from 'node:fs';
import { readFile, readdir, mkdir, rm } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { SYSTEMS, IX } from '../assets/schema.js';
import { STATES } from './tiger.mjs';
import { writeOut } from './write.mjs';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'tools', 'src', 'us');
const GEO = join(ROOT, 'data', 'geo');
const OUT = join(ROOT, 'data', 'bridges', 'us');
const MATCH_KM = 1;
const CELL = 0.1;

const PREFIX = { 1: 'ui', 2: 'uu', 3: 'us' };
const EARLIEST = 1800;
const LATEST = new Date().getFullYear() + 1;

const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const linesOf = (g) => (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []);

/** The quoted-comma CSV FHWA writes: fields in single quotes may hold commas. */
function split(line) {
  const out = [];
  let field = '';
  let quoted = false;
  for (const c of line) {
    if (c === "'") quoted = !quoted;
    else if (c === ',' && !quoted) { out.push(field); field = ''; } else field += c;
  }
  out.push(field);
  return out;
}

/** NBI writes latitude as DDMMSSss and longitude as DDDMMSSss, west positive. */
function dms(s, degDigits) {
  const v = String(s ?? '').trim().padStart(degDigits + 6, '0');
  if (!/^\d+$/.test(v) || Number(v) === 0) return null;
  const d = Number(v.slice(0, degDigits));
  const m = Number(v.slice(degDigits, degDigits + 2));
  const sec = Number(v.slice(degDigits + 2)) / 100;
  if (m >= 60 || sec >= 60) return null;
  return d + m / 60 + sec / 3600;
}

const year = (s) => {
  const n = Number(s);
  return Number.isInteger(n) && n >= EARLIEST && n <= LATEST ? n : null;
};

/** A route's segments bucketed into CELL-degree squares, for a nearest-line query. */
function grid(lines) {
  const cells = new Map();
  for (const l of lines) {
    for (let i = 1; i < l.length; i++) {
      const a = l[i - 1], b = l[i];
      const x0 = Math.floor(Math.min(a[0], b[0]) / CELL), x1 = Math.floor(Math.max(a[0], b[0]) / CELL);
      const y0 = Math.floor(Math.min(a[1], b[1]) / CELL), y1 = Math.floor(Math.max(a[1], b[1]) / CELL);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const k = `${x},${y}`;
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push([a, b]);
      }
    }
  }
  return cells;
}

function kmToGrid(pt, cells) {
  const kx = 111.32 * Math.cos((pt[1] * Math.PI) / 180);
  const ky = 110.57;
  const cx = Math.floor(pt[0] / CELL), cy = Math.floor(pt[1] / CELL);
  let best = Infinity;
  for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) {
    for (const [a, b] of cells.get(`${x},${y}`) ?? []) {
      const ax = (a[0] - pt[0]) * kx, ay = (a[1] - pt[1]) * ky;
      const bx = (b[0] - pt[0]) * kx, by = (b[1] - pt[1]) * ky;
      const dx = bx - ax, dy = by - ay;
      const len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (d < best) best = d;
    }
  }
  return best;
}

async function usGeometry() {
  const lines = new Map();
  for (const s of SYSTEMS.filter((x) => x.cc === 'us')) {
    const files = s.perJuris
      ? (await readdir(join(GEO, s.dir))).filter((f) => f.endsWith('.json')).map((f) => join(GEO, s.dir, f))
      : [join(GEO, s.geo)];
    for (const file of files) {
      for (const f of (await read(file)).features) {
        const l = linesOf(f.geometry);
        if (l.length) lines.set(f.properties.id, [...(lines.get(f.properties.id) ?? []), ...l]);
      }
    }
  }
  return lines;
}

async function main() {
  const edition = await read(join(SRC, 'nbi-edition.json'));
  const index = await read(join(ROOT, 'data', 'index.json'));

  // The atlas routes a bridge's (kind, state, number) can name.
  const byKey = new Map();
  for (const r of index.routes) {
    const sys = r[IX.sys];
    if (!['ui', 'uu', 'us'].includes(sys)) continue;
    const key = sys === 'us' ? `us|${r[IX.st]}|${r[IX.num]}` : `${sys}|${r[IX.num]}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r[IX.id]);
  }
  const geometry = await usGeometry();
  const grids = new Map();
  const gridOf = (id) => {
    if (!grids.has(id)) grids.set(id, geometry.has(id) ? grid(geometry.get(id)) : new Map());
    return grids.get(id);
  };

  const counts = { records: 0, onRoute: 0, noRoute: 0, far: 0, unplaced: 0, kept: 0, culverts: 0 };
  const states = new Map();
  let head = null;
  const rl = createInterface({ input: createReadStream(join(SRC, edition.file)) });
  for await (const line of rl) {
    const f = split(line);
    if (!head) { head = Object.fromEntries(f.map((k, i) => [k.trim(), i])); continue; }
    counts.records++;
    const sys = PREFIX[f[head.ROUTE_PREFIX_005B]];
    if (f[head.RECORD_TYPE_005A] !== '1' || !sys) continue;
    counts.onRoute++;
    const st = STATES[f[head.STATE_CODE_001]];
    const raw = f[head.ROUTE_NUMBER_005D].trim();
    if (!st || !/^\d+$/.test(raw)) { counts.noRoute++; continue; }
    const num = String(Number(raw));
    const ids = byKey.get(sys === 'us' ? `us|${st}|${num}` : `${sys}|${num}`);
    if (!ids) { counts.noRoute++; continue; }
    const lat = dms(f[head.LAT_016], 2);
    const lonW = dms(f[head.LONG_017], 3);
    if (lat == null || lonW == null || lat < 17 || lat > 72 || lonW < 64 || lonW > 180) { counts.unplaced++; continue; }
    const pt = [-lonW, lat];
    let best = null;
    for (const id of ids) {
      const km = kmToGrid(pt, gridOf(id));
      if (km <= MATCH_KM && (!best || km < best.km)) best = { id, km };
    }
    if (!best) { counts.far++; continue; }

    if (!states.has(st)) states.set(st, { routes: [], routeIx: new Map(), rows: [], bbox: [Infinity, Infinity, -Infinity, -Infinity] });
    const s = states.get(st);
    if (!s.routeIx.has(best.id)) { s.routeIx.set(best.id, s.routes.length); s.routes.push(best.id); }
    const built = year(f[head.YEAR_BUILT_027]);
    const rebuilt = year(f[head.YEAR_RECONSTRUCTED_106]);
    const len = Number(f[head.STRUCTURE_LEN_MT_049]);
    const culvert = f[head.STRUCTURE_TYPE_043B] === '19';
    if (culvert) counts.culverts++;
    const lon = Number(pt[0].toFixed(5)), la = Number(lat.toFixed(5));
    s.rows.push([
      lon, la, s.routeIx.get(best.id), built, rebuilt && rebuilt !== built ? rebuilt : null,
      len > 0 ? Math.round(len * 10) / 10 : null, culvert ? 'culvert' : null, f[head.FEATURES_DESC_006A].trim() || null,
    ]);
    s.bbox = [Math.min(s.bbox[0], lon), Math.min(s.bbox[1], la), Math.max(s.bbox[2], lon), Math.max(s.bbox[3], la)];
    counts.kept++;
  }

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const fields = ['lon', 'lat', 'route', 'built', 'rebuilt', 'lengthM', 'kind', 'over'];
  const summary = {};
  for (const [st, s] of [...states].sort()) {
    await writeOut(join(OUT, `${st}.json`), `${JSON.stringify({ fields, routes: s.routes, rows: s.rows })}\n`);
    summary[st] = { n: s.rows.length, bbox: s.bbox };
  }
  await writeOut(join(OUT, 'index.json'), `${JSON.stringify({
    generated: new Date().toISOString().slice(0, 10),
    set: {
      id: 'us', country: 'us', region: null,
      name: { en: 'United States' },
      source: 'Federal Highway Administration, National Bridge Inventory',
      url: 'https://www.fhwa.dot.gov/bridge/nbi.cfm',
      licence: 'public domain',
      edition: edition.year,
      covers: 'Bridges and culverts that carry an Interstate, US route or state route the atlas draws, '
        + `within ${MATCH_KM} km of it. Bridges on county, city and federal-lands roads, and under the routes, are left out.`,
    },
    retrieved: edition.retrieved,
    matchKm: MATCH_KM,
    counts,
    states: summary,
  })}\n`);
  console.log(`US bridges: ${counts.kept} kept of ${counts.onRoute} on Interstate, US and state routes `
    + `(${counts.noRoute} on a route the atlas does not draw, ${counts.far} over ${MATCH_KM} km from it, `
    + `${counts.unplaced} without usable coordinates); ${counts.culverts} culverts; ${states.size} states`);
}

main().catch((e) => { console.error(e); process.exit(1); });
