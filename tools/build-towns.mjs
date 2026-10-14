/**
 * The cities a mainland national route passes, in order along it.
 *
 *   node tools/build-towns.mjs
 *
 * The Route Log names the urban areas each Interstate serves; nothing Chinese
 * and open does that for a national route. The nearest equivalent is the
 * places OpenStreetMap maps as cities (place=city, about 3,200 of them, from
 * the same extract the routes are drawn from: cities, counties, banners and
 * city districts), taken where the route's own line passes within RADIUS_KM
 * of one. Towns are left out: a long expressway passes hundreds, and the
 * Route Log's list is of urban areas, not villages.
 *
 * Writes data/towns.json: { generated, source, radiusKm, routes: { id:
 * [[zh, en], ...] } }, each list in the order the line meets the cities.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const RADIUS_KM = 10;
const STEP_KM = 2;
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

const km = (a, b) => {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(h));
};

// OSM maps a city's districts as cities too (福田区, 罗湖区), so a route
// through Shenzhen would list six of them and never Shenzhen. A district is
// filed under the nearest city of a million or more within 60 km instead,
// which is its own city wherever one is that close. Places with no
// administrative suffix are over a border (老街 is Lào Cai) and are left out.
const PLACES = join(ROOT, 'tools', 'src', 'cn', 'places.json');
if (!existsSync(PLACES)) {
  console.log('no tools/src/cn/places.json: run npm run fetch:cn first; data/towns.json left as it is');
  process.exit(0);
}
const all = (await readJson(PLACES)).filter((p) => p[2] === 'city');
const big = all.filter((p) => /市$/.test(p[3]) && (p[5] ?? 0) >= 1e6);
const parentOf = (d) => {
  let best = null;
  for (const c of big) {
    const dist = km(d, c);
    if (dist <= 60 && (!best || dist < best.dist)) best = { dist, c };
  }
  return best?.c ?? null;
};
const cities = [];
for (const p of all) {
  if (/(?:市|县|旗)$/.test(p[3])) cities.push({ p, as: p });
  else if (/区$/.test(p[3])) {
    const parent = parentOf(p);
    if (parent) cities.push({ p, as: parent });
  }
}
const grid = new Map();
for (const c of cities) {
  const k = `${Math.floor(c.p[0] * 4)},${Math.floor(c.p[1] * 4)}`;
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(c);
}

/** Points every STEP_KM along a line, so a long straight segment is not one sample. */
function* walk(line) {
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const n = Math.max(1, Math.ceil(km(a, b) / STEP_KM));
    for (let s = i === 1 ? 0 : 1; s <= n; s++) yield [a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n];
  }
}

function townsOf(feature) {
  const np = feature.properties.np ?? feature.geometry.coordinates.length;
  const seen = new Map();
  let at = 0;
  for (const line of feature.geometry.coordinates.slice(0, np)) {
    for (const pt of walk(line)) {
      at++;
      const gx = Math.floor(pt[0] * 4);
      const gy = Math.floor(pt[1] * 4);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const c of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
            if (seen.has(c.as) || km(pt, c.p) > RADIUS_KM) continue;
            seen.set(c.as, at);
          }
        }
      }
    }
  }
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([c]) => [c[3], c[4] || c[3]]);
}

const routes = {};
let total = 0;
for (const file of ['expressway', 'national']) {
  for (const f of (await readJson(join(ROOT, 'data', 'geo', 'cn', `${file}.json`))).features) {
    const towns = townsOf(f);
    if (!towns.length) continue;
    routes[f.properties.id] = towns;
    total += towns.length;
  }
}

await writeFile(join(ROOT, 'data', 'towns.json'), `${JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  source: 'OpenStreetMap place=city nodes in the Geofabrik China extract (CN-1)',
  radiusKm: RADIUS_KM,
  routes,
})}\n`);
console.log(`wrote ${Object.keys(routes).length} routes, ${total} cities (${(total / Object.keys(routes).length).toFixed(1)} each)`);
