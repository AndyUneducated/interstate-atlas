// Writes content/reference/hk-osm-names.json: the English and Chinese names
// OpenStreetMap gives Hong Kong's main roads.
//
//   node tools/fetch-hk-names.mjs
//
// The Annual Traffic Census is published in English only, and names its
// stations by road. To give those roads in Chinese, build-hk-traffic.mjs looks
// them up here. OSM is the only bilingual source of Hong Kong road names that
// can be read whole; the Lands Department's street index has no bulk file.
// Overpass servers are often overloaded, so each is tried in turn.

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = join(import.meta.dirname, '..', 'content', 'reference', 'hk-osm-names.json');
const SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const QUERY = `[out:json][timeout:180];
(way(22.15,113.82,22.57,114.45)["highway"~"^(motorway|trunk|primary|secondary|tertiary)(_link)?$"]["name:en"]["name:zh"];);
out tags;`;

let elements = null;
for (const url of SERVERS) {
  try {
    const r = await fetch(url, {
      method: 'POST',
      body: new URLSearchParams({ data: QUERY }),
      headers: { 'User-Agent': 'interstate-atlas/1.0' },
    });
    if (!r.ok) { console.log(`${url}: HTTP ${r.status}`); continue; }
    elements = (await r.json()).elements;
    break;
  } catch (e) {
    console.log(`${url}: ${e.message}`);
  }
}
if (!elements) throw new Error('no Overpass server answered');

const names = {};
for (const e of elements) {
  const en = e.tags['name:en'];
  const zh = e.tags['name:zh'];
  if (en && zh && !names[en]) names[en] = zh;
}
const sorted = Object.fromEntries(Object.entries(names).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(OUT, `${JSON.stringify({
  source: 'OpenStreetMap contributors, name:en and name:zh on Hong Kong motorway to tertiary ways',
  licence: 'ODbL 1.0',
  retrieved: new Date().toISOString().slice(0, 10),
  names: sorted,
}, null, 1)}\n`);
console.log(`hk-osm-names: ${Object.keys(sorted).length} names`);
