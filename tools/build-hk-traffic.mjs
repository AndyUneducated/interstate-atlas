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
    // [station, type, road, from, to, AADT, estimated]
    stations.push([n, s[1], s[3], s[4], s[5], s[AADT], s[8]]);
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
      maxAt: [top[2], top[3], top[4]],
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
