// Downloads Hong Kong's tunnel and bridge tolls into tools/src/hk/tolls.json.
//
//   node tools/fetch-hk-tolls.mjs
//
// Source: Transport Department, Road Network (td_rcd_1638949160594_2844), three
// parts of it: the flat toll table (TUN_BRIDGE_TOLL), the time-varying one
// (TUN_BRIDGE_TV_TOLL), and the toll points among the traffic features
// (TRAFFIC_FEATURES, type 3), which the tables name by FEATURE_ID. The tables
// come from the CSDI portal's file API; the points from its map service, which
// answers a query where the file API would send the whole layer.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SRC } from './hongkong.mjs';

const DATASET = 'td_rcd_1638949160594_2844';
const FILE = (layer) => `https://portal.csdi.gov.hk/csdi-webpage/file-api?dataset_id=${DATASET}&format=geojson&layer_name=${layer}`;
const SERVICE = `https://portal.csdi.gov.hk/server/rest/services/common/${DATASET}/MapServer`;
const HEADERS = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36' };

async function json(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

const day = (s) => (/^\d{8}$/.test(String(s ?? '')) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);

async function main() {
  await mkdir(SRC, { recursive: true });
  const flat = (await json(FILE('TUN_BRIDGE_TOLL'))).features.map((f) => f.properties);
  const varying = (await json(FILE('TUN_BRIDGE_TV_TOLL'))).features.map((f) => f.properties);
  const layers = (await json(`${SERVICE}?f=json`)).layers;
  const tf = layers.find((l) => l.name === 'TRAFFIC_FEATURES');
  const points = (await json(`${SERVICE}/${tf.id}/query?where=FEATURE_TYPE%3D3&outFields=FEATURE_ID,REMARKS&outSR=4326&f=geojson`)).features
    .map((f) => ({ id: f.properties.FEATURE_ID, remarks: f.properties.REMARKS ?? null, at: f.geometry.coordinates }));

  const row = (p) => ({
    name: p.TUNNEL_BRIDGE_NAME, nameZh: p.TUNNEL_BRIDGE_CHINESE_NAME,
    points: [p.FEATURE_ID_1, p.FEATURE_ID_2].filter((v) => v != null),
    from: day(p.EFFECTIVE_DATE), vehicle: p.VEHICLE_CLASS_DESCRIPTION,
    toll: p.GAZETTED_TOLL ?? null, concession: p.CONCESSION_TOLL ?? null,
    updated: day(p.LAST_UPDATED_DATE),
  });
  const updated = [...flat, ...varying].map((p) => day(p.LAST_UPDATED_DATE)).filter(Boolean).sort().pop() ?? null;
  await writeFile(join(SRC, 'tolls.json'), JSON.stringify({
    source: 'Transport Department, Road Network: toll tables and toll points',
    url: `https://portal.csdi.gov.hk/csdi-webpage/dataset/${DATASET}`,
    licence: 'Hong Kong Government open data terms of use',
    retrieved: new Date().toISOString().slice(0, 10),
    updated,
    flat: flat.map(row),
    varying: varying.map((p) => ({ ...row(p), days: p.DAY_OF_WEEK, start: p.START_TIME, end: p.END_TIME })),
    points,
  }));
  console.log(`${flat.length} flat and ${varying.length} time-varying toll rows, ${points.length} toll points -> tools/src/hk/tolls.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
