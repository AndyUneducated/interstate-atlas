// Speed limits for every route the atlas draws, in three tiers, each labelled:
//
//   posted  - the agencies' own: FHWA's HPMS for the United States, the
//             provinces' National Road Network for Canada. Already joined to
//             each route by build-data.mjs, as a length-weighted mean.
//   osm     - OpenStreetMap's maxspeed, for the four places whose own sources
//             carry none (China, Hong Kong, Taiwan, Mexico). Ways from
//             fetch-osm-speed.mjs are matched to the atlas's geometry by number
//             and by distance, so a limit is only credited to a route it lies on.
//   law     - where neither covers a route, the limit the law sets for that
//             class of road when no sign says otherwise. Only for places with
//             one national rule; American and Canadian limits are set state by
//             state and province by province, so those routes stay unknown.
//
// Writes data/speed.json. The route geometry is not touched.
//
// Usage: node tools/build-speed.mjs

import { createReadStream } from 'node:fs';
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const GEO = join(ROOT, 'data', 'geo');
const OSM = join(import.meta.dirname, 'src', 'osm');
const KM_PER_MI = 1.609344;

// The rule each place's law gives for a road with no sign, by system. Kept
// to rules that are national and unconditional for that class of road.
export const LAW = {
  'cn-expressway': { kph: 120, basis: '道路交通安全法实施条例 第七十八条 (expressway maximum)' },
  'cn-national': { kph: 70, basis: '道路交通安全法实施条例 第四十五条 (highway, one lane each way, unsigned)' },
  'cn-provincial': { kph: 70, basis: '道路交通安全法实施条例 第四十五条 (highway, one lane each way, unsigned)' },
  'tw-provincial': { kph: 50, basis: '道路交通安全規則 第九十三條 (no speed sign)' },
  'hk-route': { kph: 50, basis: 'Road Traffic Ordinance (Cap. 374), default limit unless otherwise indicated' },
};

// Mexico's state abbreviations as OpenStreetMap writes them, to the atlas's.
const MX_PREFIX = {
  AGS: 'AGU', BC: 'BCN', BCN: 'BCN', BCS: 'BCS', CAM: 'CAM', CAMP: 'CAM', CHIH: 'CHH', CHH: 'CHH',
  CHIS: 'CHP', CHP: 'CHP', CDMX: 'CMX', DF: 'CMX', COAH: 'COA', COA: 'COA', COL: 'COL', DGO: 'DUR',
  DUR: 'DUR', EM: 'EM', EDOMEX: 'EM', MEX: 'EM', GRO: 'GRO', GTO: 'GUA', GUA: 'GUA', HGO: 'HID',
  HID: 'HID', JAL: 'JAL', MICH: 'MIC', MIC: 'MIC', MOR: 'MOR', NAY: 'NAY', NL: 'NLE', NLE: 'NLE',
  OAX: 'OAX', PUE: 'PUE', QRO: 'QUE', QUE: 'QUE', QR: 'ROO', QROO: 'ROO', ROO: 'ROO', SIN: 'SIN',
  SLP: 'SLP', SON: 'SON', TAB: 'TAB', TAM: 'TAM', TAMPS: 'TAM', TLAX: 'TLA', TLA: 'TLA', VER: 'VER',
  YUC: 'YUC', ZAC: 'ZAC',
};

/** The key a route is matched under, in the form fetch-osm-speed.mjs writes. */
function keyOf(p) {
  if (p.cc === 'cn') return p.num;
  if (p.cc === 'hk') return `HK${p.num}`;
  if (p.cc === 'tw') return `${p.sys === 'tw-freeway' ? 'F' : 'P'}${p.num}`;
  if (p.cc === 'mx') return String(p.label).toUpperCase();
  return null;
}
function osmKey(cc, ref) {
  if (cc !== 'mx') return ref;
  const [pre, rest] = ref.split('-');
  if (pre === 'MEX') return ref;
  const atlas = MX_PREFIX[pre];
  return atlas ? `${atlas}-${rest}` : null;
}

async function* geoFiles(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* geoFiles(p);
    else if (e.name.endsWith('.json')) yield p;
  }
}

const rad = Math.PI / 180;
function km(a0, a1, b0, b1) {
  const x = (b0 - a0) * Math.cos(((a1 + b1) / 2) * rad);
  return Math.hypot(x, b1 - a1) * 111.32;
}
/** Distance in km from a point to a segment, on a local flat projection. */
function toSeg(px, py, ax, ay, bx, by) {
  const c = Math.cos(py * rad);
  const X = (v) => v * c * 111.32;
  const Y = (v) => v * 111.32;
  const x = X(px), y = Y(py), x1 = X(ax), y1 = Y(ay), x2 = X(bx), y2 = Y(by);
  const dx = x2 - x1, dy = y2 - y1;
  const L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / L)) : 0;
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

const CELL = 0.05;
const cellOf = (x, y) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
const NEAR_KM = 0.35;
const MIN_OSM_COV = 25;

async function main() {
  const routes = new Map();
  const grid = { cn: new Map(), hk: new Map(), tw: new Map(), mx: new Map() };
  const geoIndexed = { cn: 0, hk: 0, tw: 0, mx: 0 };

  for await (const file of geoFiles(GEO)) {
    const fc = JSON.parse(await readFile(file, 'utf8'));
    for (const f of fc.features || []) {
      const p = { ...f.properties };
      if (!p?.id || routes.has(p.id)) continue;
      p.cc ??= String(p.sys).split('-')[0];
      const r = { id: p.id, cc: p.cc, sys: p.sys, km: (p.mi || 0) * KM_PER_MI, bins: new Map() };
      if (p.cc === 'us' && p.hpms?.speed) r.posted = { kph: Math.round(p.hpms.speed.v * KM_PER_MI), cov: p.hpms.speed.cover };
      if (p.cc === 'ca' && p.kph) r.posted = { kph: p.kph, cov: p.kphCov ?? null };
      routes.set(p.id, r);

      const g = grid[p.cc];
      const key = keyOf(p);
      if (!g || !key) continue;
      geoIndexed[p.cc]++;
      const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const line of lines) {
        for (let i = 1; i < line.length; i++) {
          const [ax, ay] = line[i - 1];
          const [bx, by] = line[i];
          const seg = [r, key, ax, ay, bx, by];
          const x0 = Math.floor(Math.min(ax, bx) / CELL), x1 = Math.floor(Math.max(ax, bx) / CELL);
          const y0 = Math.floor(Math.min(ay, by) / CELL), y1 = Math.floor(Math.max(ay, by) / CELL);
          for (let cx = x0; cx <= x1; cx++) {
            for (let cy = y0; cy <= y1; cy++) {
              const k = `${cx},${cy}`;
              if (!g.has(k)) g.set(k, []);
              g.get(k).push(seg);
            }
          }
        }
      }
    }
  }
  console.log(`routes: ${routes.size}; indexed for matching ${JSON.stringify(geoIndexed)}`);

  // Each OSM segment is credited to the nearest route carrying one of its
  // numbers, within a few hundred metres; a way that runs on two numbered
  // routes at once counts for both.
  const editions = {};
  for (const src of ['cn', 'tw', 'mx']) {
    const file = join(OSM, `${src}-speed.ndjson`);
    if (!await stat(file).then(() => true, () => false)) { console.log(`${src}: no OSM file, skipped`); continue; }
    editions[src] = JSON.parse(await readFile(join(OSM, `${src}-speed.json`), 'utf8'));
    let segs = 0, matched = 0;
    const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }) });
    for await (const line of rl) {
      if (!line) continue;
      const [, refs, kph, ...c] = JSON.parse(line);
      const wanted = new Map();
      for (const ref of refs.split(';')) {
        const cc = ref.startsWith('HK') ? 'hk' : src;
        const k = osmKey(cc, ref);
        if (k) (wanted.get(cc) ?? wanted.set(cc, new Set()).get(cc)).add(k);
        // A cuota (D) and a libre road share a number, and the atlas files both under it.
        if (cc === 'mx' && /D$/.test(k ?? '')) wanted.get(cc).add(k.slice(0, -1));
      }
      for (let i = 2; i < c.length; i += 2) {
        const ax = c[i - 2], ay = c[i - 1], bx = c[i], by = c[i + 1];
        const len = km(ax, ay, bx, by);
        if (!len) continue;
        segs++;
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        for (const [cc, keys] of wanted) {
          const g = grid[cc];
          const best = new Map();
          const gx = Math.floor(mx / CELL), gy = Math.floor(my / CELL);
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              for (const s of g.get(`${gx + dx},${gy + dy}`) ?? []) {
                if (!keys.has(s[1])) continue;
                const d = toSeg(mx, my, s[2], s[3], s[4], s[5]);
                if (d > NEAR_KM) continue;
                const was = best.get(s[1]);
                if (!was || d < was.d) best.set(s[1], { d, r: s[0] });
              }
            }
          }
          for (const { r } of best.values()) {
            r.bins.set(kph, (r.bins.get(kph) || 0) + len);
            matched++;
          }
        }
      }
    }
    console.log(`${src}: ${segs} OSM segments, ${matched} credited to a route`);
  }

  // One figure per route: the limit over most of its length, its source, and
  // the share of the road that figure rests on.
  const out = {};
  const BAND = (v) => (v >= 120 ? 120 : v <= 40 ? 40 : Math.round(v / 10) * 10);
  // Measured limits and the law's defaults are kept apart, so a chart can
  // never pass a default off as a sign someone read.
  const summary = {};
  const systems = {};
  const blank = () => ({ km: 0, bySrc: {}, bands: {}, law: {} });
  let cur = null;
  const tally = (cc, src, kph, kmv) => {
    for (const s of [summary[cc], cur]) {
      s.bySrc[src] = (s.bySrc[src] || 0) + kmv;
      const into = src === 'l' ? s.law : s.bands;
      if (kph) into[BAND(kph)] = (into[BAND(kph)] || 0) + kmv;
    }
  };
  const counts = {};
  for (const r of routes.values()) {
    const s = summary[r.cc] ??= blank();
    cur = systems[r.sys] ??= blank();
    s.km += r.km;
    cur.km += r.km;
    let rec = null;
    if (r.posted) {
      const covKm = r.km * Math.min(100, r.posted.cov ?? 100) / 100;
      rec = [r.posted.kph, 'p', r.posted.cov == null ? null : Math.round(r.posted.cov)];
      tally(r.cc, 'p', r.posted.kph, covKm);
      tally(r.cc, 'u', null, r.km - covKm);
    } else if (r.bins.size) {
      const osmKm = [...r.bins.values()].reduce((a, b) => a + b, 0);
      const cov = Math.min(100, Math.round((osmKm / Math.max(r.km, 0.1)) * 100));
      // The limit over the greater part of the road, read off the bins by length.
      const sorted = [...r.bins].sort((a, b) => a[0] - b[0]);
      let acc = 0, median = sorted[0][0];
      for (const [k, v] of sorted) { acc += v; if (acc >= osmKm / 2) { median = k; break; } }
      const scale = osmKm > r.km ? r.km / osmKm : 1;
      const bins = [...r.bins].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v * scale * 10) / 10]).filter(([, v]) => v >= 0.1);
      // A sliver of mapped road does not speak for the rest when the law does.
      rec = cov < MIN_OSM_COV && LAW[r.sys] ? [LAW[r.sys].kph, 'l', cov, bins] : [median, 'o', cov, bins];
      for (const [k, v] of bins) tally(r.cc, 'o', k, v);
      const rest = Math.max(0, r.km - osmKm * scale);
      if (LAW[r.sys]) tally(r.cc, 'l', LAW[r.sys].kph, rest); else tally(r.cc, 'u', null, rest);
    } else if (LAW[r.sys]) {
      rec = [LAW[r.sys].kph, 'l', null];
      tally(r.cc, 'l', LAW[r.sys].kph, r.km);
    } else {
      tally(r.cc, 'u', null, r.km);
    }
    if (rec) out[r.id] = rec;
    const c = counts[r.cc] ??= { p: 0, o: 0, l: 0, u: 0 };
    c[rec ? rec[1] : 'u']++;
  }
  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v / KM_PER_MI)]));
  for (const s of [...Object.values(summary), ...Object.values(systems)]) {
    s.mi = Math.round(s.km / KM_PER_MI);
    delete s.km;
    s.bySrc = round(s.bySrc);
    s.bands = round(s.bands);
    s.law = round(s.law);
  }

  await writeFile(join(ROOT, 'data', 'speed.json'), JSON.stringify({
    generated: new Date().toISOString().slice(0, 10),
    fields: ['kph', 'source (p posted, o OpenStreetMap, l law)', 'coverage %', 'OSM km by limit'],
    law: LAW,
    osm: Object.fromEntries(Object.entries(editions).map(([k, v]) => [k, { timestamp: v.timestamp, ways: v.ways }])),
    summary,
    systems,
    routes: out,
  }));
  console.log('routes by source', JSON.stringify(counts));
  const bySys = {};
  for (const r of routes.values()) {
    const s = bySys[r.sys] ??= { km: 0, measured: 0 };
    s.km += r.km;
    const rec = out[r.id];
    if (rec?.[1] === 'p') s.measured += r.km * Math.min(100, rec[2] ?? 100) / 100;
    if (rec?.[3]) s.measured += r.km * rec[2] / 100;
  }
  for (const [sys, s] of Object.entries(bySys)) console.log(`  ${sys.padEnd(16)} ${Math.round((s.measured / s.km) * 100)}% measured`);
  for (const [cc, s] of Object.entries(summary)) console.log(cc, JSON.stringify(s));
}

main().catch((e) => { console.error(e); process.exit(1); });
