// Writes data/hk-routes.json: each Hong Kong route's roads, in English and
// Chinese, and the traffic the Annual Traffic Census counted on them.
//
//   node tools/build-hk-traffic.mjs
//
// Reads content/reference/hk-routes.json, which lists each route's roads and
// the census stations on its own carriageway, and content/reference/
// hk-census.json, which tools/fetch-hk-census.mjs reads out of the census.
// The census names stations by road and by the streets at either end, never
// by route number, so which stations are a route's is decided in the
// reference file, where it can be checked, and not guessed here.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const ref = JSON.parse(await readFile(join(ROOT, 'content', 'reference', 'hk-routes.json'), 'utf8'));
const census = JSON.parse(await readFile(join(ROOT, 'content', 'reference', 'hk-census.json'), 'utf8'));
const byStn = new Map(census.stations.map((s) => [s[0], s]));
const AADT = census.fields.indexOf(`aadt${census.year}`);

// The census is in English only, and abbreviates: "Waterloo Rd & FO <K44>".
// A road it names is given in Chinese where the curated route roads or OSM's
// bilingual names (hk-osm-names.json) know it, and left untranslated where
// not; the streets at a station's ends are not translated at all, since most
// are descriptions ("Slip rds to & from Lin Cheung Rd") rather than names.
const osmNames = JSON.parse(await readFile(join(ROOT, 'content', 'reference', 'hk-osm-names.json'), 'utf8')).names;
const ABBR = { rd: 'road', st: 'street', hwy: 'highway', ave: 'avenue', int: 'interchange', tnl: 'tunnel', n: 'north', s: 'south', e: 'east', w: 'west' };
const key = (s) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean).map((w) => ABBR[w] ?? w).join('');
const zhByKey = new Map(Object.entries(osmNames).map(([en, zh]) => [key(en), zh]));
for (const r of Object.values(ref.routes)) for (const [en, zh] of r.roads ?? []) zhByKey.set(key(en), zh);
for (const [en, zh] of Object.entries(ref.zhExtra ?? {})) zhByKey.set(key(en), zh);
function zhRoad(name) {
  const bare = name.replace(/\s*<[^>]*>/g, '').trim();
  const flyover = bare.match(/^(.*?)\s*(&\s*)?FO$/);
  if (flyover) {
    const z = zhRoad(flyover[1]);
    return z ? `${z}${flyover[2] ? '及' : ''}天橋` : null;
  }
  const direct = zhByKey.get(key(bare));
  if (direct) return direct;
  for (const [sep, join] of [[' - ', '－'], [' & ', '及']]) {
    if (!bare.includes(sep)) continue;
    const parts = bare.split(sep).map(zhRoad);
    return parts.every(Boolean) ? parts.join(join) : null;
  }
  return null;
}
const untranslated = new Set();

const median = (v) => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

const routes = {};
const missing = [];
for (const [id, r] of Object.entries(ref.routes)) {
  const stations = [];
  for (const n of r.census ?? []) {
    const s = byStn.get(n);
    if (!s) { missing.push(`${id}:${n}`); continue; }
    // [station, type, road, from, to, AADT, estimated, road in Chinese]
    const zh = zhRoad(s[3]);
    if (!zh) untranslated.add(s[3]);
    stations.push([n, s[1], s[3], s[4], s[5], s[AADT], s[8], zh]);
  }
  const counts = stations.map((s) => s[5]);
  const top = stations.reduce((a, b) => (b[5] > (a?.[5] ?? -1) ? b : a), null);
  routes[id] = {
    roads: r.roads,
    traffic: stations.length ? {
      year: census.year,
      stations: stations.length,
      core: stations.filter((s) => s[1] === 'A').length,
      median: median(counts),
      max: top[5],
      maxAt: [top[2], top[3], top[4], top[7]],
      list: stations,
    } : null,
  };
}
if (missing.length) throw new Error(`stations not in the ${census.year} census: ${missing.join(' ')}`);

await writeFile(join(ROOT, 'data', 'hk-routes.json'), JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  census: { source: census.source, url: census.url, year: census.year },
  routes,
}));
console.log(`hk-routes: ${Object.keys(routes).length} routes, ${Object.values(routes).reduce((n, r) => n + (r.traffic?.stations ?? 0), 0)} stations`);
if (untranslated.size) console.log(`  no Chinese name for ${untranslated.size} census roads: ${[...untranslated].join(' | ')}`);
