// Downloads Hong Kong's strategic routes into tools/src/hk/.
//
//   node tools/fetch-hongkong.mjs
//
// Source: Transport Department, Road Network (td_rcd_1638949160594_2844), the
// CENTERLINE layer, from the CSDI portal's file API. The layer is the whole
// territory's road network, about 36,500 centrelines in half a gigabyte of
// pretty-printed GeoJSON drawn to a vertex every 30 cm. It is streamed rather
// than parsed whole, which a string that size would not survive, and only the
// segments with a Strategic Route Number are kept, every sixth vertex of them.

import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { SRC, ROUTES } from './hongkong.mjs';

const DATASET = 'td_rcd_1638949160594_2844';
const URL = `https://portal.csdi.gov.hk/csdi-webpage/file-api?dataset_id=${DATASET}&format=geojson&layer_name=CENTERLINE`;
const META = `https://portal.csdi.gov.hk/geoportal/rest/metadata/item/${DATASET}`;
const RAW = join(SRC, 'centerline.geojson');
// The portal answers bare clients with an error page.
const HEADERS = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36' };

/** Yields each feature of a FeatureCollection without holding the file as one string. */
async function* features(path) {
  let depth = 0, inStr = false, esc = false, buf = '', open = false;
  for await (const chunk of createReadStream(path, { encoding: 'utf8', highWaterMark: 1 << 20 })) {
    let from = open ? 0 : -1;
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (inStr) {
        if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === '{' || c === '[') {
        depth++;
        if (depth === 3 && c === '{') { open = true; from = i; buf = ''; }
      } else if (c === '}' || c === ']') {
        depth--;
        if (depth === 2 && open && c === '}') {
          buf += chunk.slice(from, i + 1);
          open = false; from = -1;
          yield JSON.parse(buf);
          buf = '';
        }
      }
    }
    if (open) buf += chunk.slice(from);
  }
}

async function main() {
  await mkdir(SRC, { recursive: true });
  let have = false;
  try { have = (await stat(RAW)).size > 1e8; } catch {}
  if (!have) {
    console.log('downloading the Road Network centrelines (about 500 MB)...');
    const res = await fetch(URL, { headers: HEADERS });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${URL}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(RAW));
  }
  let edition = null;
  try {
    const meta = await (await fetch(META, { headers: HEADERS })).json();
    edition = (meta._source ?? meta).apiso_Modified_dt?.slice(0, 10) ?? null;
  } catch {}

  const kept = [];
  let n = 0;
  for await (const f of features(RAW)) {
    n++;
    const route = f.properties.ROUTE_NUM;
    if (route == null || route === '') continue;
    const cs = f.geometry.coordinates;
    f.geometry.coordinates = cs.filter((_, j) => j % 6 === 0 || j === cs.length - 1)
      .map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6]);
    kept.push(f);
  }
  await writeFile(ROUTES, JSON.stringify({
    source: 'Transport Department, Road Network (CENTERLINE), CSDI Portal',
    url: `https://portal.csdi.gov.hk/csdi-webpage/dataset/${DATASET}`,
    licence: 'Hong Kong Government open data terms of use',
    retrieved: new Date().toISOString().slice(0, 10),
    edition,
    type: 'FeatureCollection',
    features: kept,
  }));
  await rm(RAW, { force: true });
  console.log(`kept ${kept.length} of ${n} centrelines carrying a Strategic Route Number -> tools/src/hk/routes.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
