// Samples an elevation profile along each curated route.
//
//   node tools/build-elevation.mjs            # routes with a published dossier
//   node tools/build-elevation.mjs i-70 i-80  # named routes, by route id
//   node tools/build-elevation.mjs --all      # every primary Interstate and US route
//   node tools/build-elevation.mjs --east-asia  # every mainland national route, Taiwan, Hong Kong
//   node tools/build-elevation.mjs --north-america  # every Interstate, US route, Trans-Canada,
//                                                   # NHS route and Mexican federal route
//
// Run it after `npm run build`: the dossier list is read from data/dossiers/,
// where each profile is already filed under the route id the site looks up.
//
// Heights come from the Terrain Tiles public dataset on S3, which packs metres
// above sea level into the RGB channels of a PNG. It is open data and needs no
// key, which is what makes this work on a static site: the sampling happens
// here, once, and the page only ever loads a small array of numbers.
//
// Tiles are cached under tools/cache/ and that directory is gitignored, so a
// rerun costs nothing but the first run is slow.

import { mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { PNG } from 'pngjs';
import { KM_PER_MI, SYSTEMS, IX } from '../assets/schema.js';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'data', 'elevation');
const CACHE = join(ROOT, 'tools', 'cache', 'terrain');
const TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

// Zoom 9 is about 300 m per pixel at these latitudes: fine enough to catch a
// mountain pass, coarse enough that a transcontinental route needs only a few
// hundred tiles.
const Z = 9;
const SAMPLES = 220;
const M_TO_FT = 3.280839895;

// The only dry land below sea level that the atlas's routes cross, as [west,
// south, east, north]. Anywhere else a reading under zero is the bed of the
// water a bridge, tunnel or ferry crosses: the tiles carry bathymetry.
const BELOW_SEA_LEVEL = [
  [88.3, 42.3, 90.6, 43.3], // Turpan Depression
  [-116.7, 31.9, -114.9, 33.9], // Salton Trough, Imperial and Mexicali valleys, Laguna Salada
  [-117.5, 35.8, -116.3, 36.9], // Death Valley
  [-90.4, 29.8, -89.8, 30.1], // New Orleans
  [-121.9, 37.8, -121.3, 38.3], // Sacramento-San Joaquin Delta islands
];
const onDryBasin = (lon, lat) => BELOW_SEA_LEVEL.some(([w, s, e, n]) => lon >= w && lon <= e && lat >= s && lat <= n);

const lon2x = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

const tiles = new Map();
let fetched = 0;
let cached = 0;

async function tile(tx, ty) {
  const key = `${tx}/${ty}`;
  if (tiles.has(key)) return tiles.get(key);

  const file = join(CACHE, String(Z), String(tx), `${ty}.png`);
  let buf = null;
  if (existsSync(file)) {
    buf = await readFile(file);
    cached++;
  } else {
    const res = await fetch(`${TILE_URL}/${Z}/${tx}/${ty}.png`);
    if (!res.ok) { tiles.set(key, null); return null; }
    buf = Buffer.from(await res.arrayBuffer());
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, buf);
    fetched++;
  }

  let png = null;
  try { png = PNG.sync.read(buf); } catch { /* corrupt tile */ }
  tiles.set(key, png);
  return png;
}

// Terrarium packs height as (R * 256 + G + B / 256) - 32768, in metres.
async function elevationAt(lon, lat) {
  const fx = lon2x(lon, Z);
  const fy = lat2y(lat, Z);
  const png = await tile(Math.floor(fx), Math.floor(fy));
  if (!png) return null;
  const px = Math.min(png.width - 1, Math.floor((fx % 1) * png.width));
  const py = Math.min(png.height - 1, Math.floor((fy % 1) * png.height));
  const i = (py * png.width + px) * 4;
  return png.data[i] * 256 + png.data[i + 1] + png.data[i + 2] / 256 - 32768;
}

/**
 * Samples over water (null) take the line between the readings on either
 * bank, which is roughly a bridge deck and never below the water's surface.
 */
function bridgeWater(ft) {
  for (let i = 0; i < ft.length; i++) {
    if (ft[i] != null) continue;
    let j = i;
    while (j < ft.length && ft[j] == null) j++;
    const a = ft[i - 1] ?? ft[j] ?? 0;
    const b = ft[j] ?? a;
    for (let k = i; k < j; k++) ft[k] = Math.max(0, Math.round(a + ((b - a) * (k - i + 1)) / (j - i + 1)));
    i = j;
  }
  return ft;
}

function haversineKm(a, b) {
  const R = 6371.0088;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const la1 = (a[1] * Math.PI) / 180;
  const la2 = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Walk the mainline and return `n` points spaced evenly by distance. */
function sampleAlong(coords, n) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversineKm(coords[i - 1], coords[i]));
  const total = cum[cum.length - 1];
  if (!total) return [];

  const out = [];
  let seg = 1;
  for (let s = 0; s < n; s++) {
    const target = (s / (n - 1)) * total;
    while (seg < cum.length - 1 && cum[seg] < target) seg++;
    const span = cum[seg] - cum[seg - 1] || 1;
    const f = (target - cum[seg - 1]) / span;
    const a = coords[seg - 1];
    const b = coords[seg];
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return { points: out, totalKm: total };
}

async function profileFor(feature) {
  const np = feature.properties.np ?? feature.geometry.coordinates.length;
  const main = feature.geometry.coordinates.slice(0, np).flat();
  if (main.length < 2) return null;

  const { points, totalKm } = sampleAlong(main, SAMPLES);
  if (!points?.length) return null;

  const ft = [];
  for (const [lon, lat] of points) {
    const m = await elevationAt(lon, lat);
    // Carry the last good reading across a missing tile rather than punching
    // a hole in the chart.
    if (m == null) ft.push(ft[ft.length - 1] ?? 0);
    else if (m < 0 && !onDryBasin(lon, lat)) ft.push(null);
    else ft.push(Math.round(m * M_TO_FT));
  }
  bridgeWater(ft);
  if (ft.every((v) => v === 0)) return null;

  return {
    ft,
    stepMi: Math.round((totalKm / KM_PER_MI / (SAMPLES - 1)) * 100) / 100,
    source: 'Terrain Tiles (AWS Open Data), zoom 9',
  };
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  // East Asia's routes have no dossiers yet, so they are profiled by system:
  // the mainland's national network, and everything in Taiwan and Hong Kong.
  const eastAsia = args.includes('--east-asia');
  const EA_SYSTEMS = new Set(['cn-expressway', 'cn-national', 'tw-freeway', 'tw-provincial', 'hk-route']);
  // North America's national tiers; the state and provincial ones stay
  // without, being tens of thousands of routes a reader opens one at a time.
  const northAmerica = args.includes('--north-america');
  const NA_SYSTEMS = new Set(['us-interstate', 'us-numbered', 'ca-tch', 'ca-nhs', 'mx-federal']);
  const named = args.filter((a) => !a.startsWith('--'));

  // A dossier's filename is not its route id - the content build resolves it
  // by number and place - so the list comes from what that build published.
  let wanted = new Set(named);
  if (!named.length && !eastAsia && !northAmerica) {
    const manifest = join(ROOT, 'data', 'dossiers', 'index.json');
    if (!existsSync(manifest)) throw new Error('data/dossiers/index.json is missing: run npm run build first');
    wanted = new Set(JSON.parse(await readFile(manifest, 'utf8')).ids);
  }

  const features = [];
  for (const s of SYSTEMS) {
    const files = s.perJuris
      ? (await readdir(join(ROOT, 'data', 'geo', s.dir))).map((f) => join(s.dir, f))
      : [s.geo];
    for (const file of files) {
      const fc = JSON.parse(await readFile(join(ROOT, 'data', 'geo', file), 'utf8'));
      for (const f of fc.features) {
        const p = f.properties;
        const inAll = all && (s.id === 'us-numbered' || (s.id === 'us-interstate' && p.tier === 'primary'));
        if (inAll || (eastAsia && EA_SYSTEMS.has(s.id)) || (northAmerica && NA_SYSTEMS.has(s.id)) || wanted.has(p.id)) features.push(f);
      }
    }
  }
  const found = new Set(features.map((f) => f.properties.id));
  const unknown = [...wanted].filter((id) => !found.has(id));
  if (unknown.length) console.log(`no geometry for: ${unknown.join(', ')}`);

  console.log(`sampling ${features.length} routes at ${SAMPLES} points each (zoom ${Z})`);
  await mkdir(OUT, { recursive: true });

  for (const [i, f] of features.entries()) {
    const profile = await profileFor(f);
    if (profile) await writeFile(join(OUT, `${f.properties.id}.json`), JSON.stringify(profile));
    if ((i + 1) % 20 === 0 || i === features.length - 1) {
      console.log(`  ${i + 1}/${features.length}  tiles: ${fetched} fetched, ${cached} cached`);
    }
  }

  // A profile filed under an id the build no longer assigns would never be
  // asked for again, so it is removed rather than left to look current.
  const index = JSON.parse(await readFile(join(ROOT, 'data', 'index.json'), 'utf8'));
  const routeIds = new Set(index.routes.map((r) => r[IX.id]));
  const ids = [];
  for (const file of await readdir(OUT)) {
    if (!file.endsWith('.json') || file === 'index.json') continue;
    const id = file.replace(/\.json$/, '');
    if (routeIds.has(id)) ids.push(id);
    else await rm(join(OUT, file));
  }

  // A manifest, for the same reason the dossiers have one: a profile exists for
  // a couple of hundred routes out of 21,000, and without a list to check first
  // every other route would ask for a file that is not there.
  ids.sort();
  await writeFile(join(OUT, 'index.json'), JSON.stringify({ ids }));
  console.log(`wrote ${ids.length} elevation profiles and their manifest`);
}

main().catch((e) => { console.error(e); process.exit(1); });
