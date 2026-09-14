// Samples an elevation profile along each curated route.
//
//   node tools/build-elevation.mjs            # routes that have a dossier
//   node tools/build-elevation.mjs i-70 i-80  # named routes
//   node tools/build-elevation.mjs --all      # every primary Interstate and US route
//
// Heights come from the Terrain Tiles public dataset on S3, which packs metres
// above sea level into the RGB channels of a PNG. It is open data and needs no
// key, which is what makes this work on a static site: the sampling happens
// here, once, and the page only ever loads a small array of numbers.
//
// Tiles are cached under tools/cache/ and that directory is gitignored, so a
// rerun costs nothing but the first run is slow.

import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { PNG } from 'pngjs';

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
  const m = png.data[i] * 256 + png.data[i + 1] + png.data[i + 2] / 256 - 32768;
  // Open ocean reads as a large negative; treat it as sea level rather than
  // letting it drag the axis down.
  return m < -420 ? 0 : m;
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
    ft.push(m == null ? (ft[ft.length - 1] ?? 0) : Math.round(m * M_TO_FT));
  }
  if (ft.every((v) => v === 0)) return null;

  return {
    ft,
    stepMi: Math.round((totalKm / 1.609344 / (SAMPLES - 1)) * 100) / 100,
    source: 'Terrain Tiles (AWS Open Data), zoom 9',
  };
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const named = args.filter((a) => !a.startsWith('--'));

  let wanted = new Set(named);
  if (!named.length) {
    try {
      const files = await readdir(join(ROOT, 'content', 'dossiers'));
      wanted = new Set(files.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')));
    } catch { wanted = new Set(); }
  }

  const sources = ['interstate', 'us'];
  const features = [];
  for (const s of sources) {
    const fc = JSON.parse(await readFile(join(ROOT, 'data', 'geo', `${s}.json`), 'utf8'));
    for (const f of fc.features) {
      const p = f.properties;
      if (all ? (p.tier === 'primary' || p.sys === 'us') : wanted.has(p.id)) features.push(f);
    }
  }
  // State-route dossiers live in per-state files; only load what is asked for.
  const stateWanted = [...wanted].filter((id) => !id.startsWith('i-') && !id.startsWith('us-'));
  if (stateWanted.length) {
    const dir = join(ROOT, 'data', 'geo', 'state');
    for (const file of await readdir(dir)) {
      const fc = JSON.parse(await readFile(join(dir, file), 'utf8'));
      for (const f of fc.features) if (wanted.has(f.properties.id)) features.push(f);
    }
  }

  console.log(`sampling ${features.length} routes at ${SAMPLES} points each (zoom ${Z})`);
  await mkdir(OUT, { recursive: true });

  let written = 0;
  for (const [i, f] of features.entries()) {
    const profile = await profileFor(f);
    if (!profile) continue;
    await writeFile(join(OUT, `${f.properties.id}.json`), JSON.stringify(profile));
    written++;
    if ((i + 1) % 20 === 0 || i === features.length - 1) {
      console.log(`  ${i + 1}/${features.length}  tiles: ${fetched} fetched, ${cached} cached`);
    }
  }

  console.log(`wrote ${written} elevation profiles`);
}

main().catch((e) => { console.error(e); process.exit(1); });
