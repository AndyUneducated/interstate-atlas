// Downloads the upstream source data into tools/src/.
//
//   node tools/fetch-source.mjs
//
// These files total roughly 120 MB and are not committed. Both sources are
// free of licence restrictions: Natural Earth is public domain and US Census
// gazetteer files are US Government works.

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw } from 'node:zlib';

const SRC = join(import.meta.dirname, 'src');
const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/10m_cultural';

const FILES = [
  ...['shp', 'dbf', 'prj', 'cpg'].map((e) => ({ url: `${NE}/ne_10m_roads_north_america.${e}`, name: `ne_10m_roads_north_america.${e}` })),
  ...['shp', 'dbf', 'prj'].map((e) => ({ url: `${NE}/ne_10m_populated_places.${e}`, name: `ne_10m_populated_places.${e}` })),
];

const GAZ = {
  url: 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_place_national.zip',
  name: '2023_Gaz_place_national.txt',
};

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

await mkdir(SRC, { recursive: true });

for (const f of FILES) {
  const dest = join(SRC, f.name);
  if (await exists(dest)) { console.log(`have   ${f.name}`); continue; }
  process.stdout.write(`fetch  ${f.name} ... `);
  await download(f.url, dest);
  console.log('ok');
}

const gazDest = join(SRC, GAZ.name);
if (await exists(gazDest)) {
  console.log(`have   ${GAZ.name}`);
} else {
  process.stdout.write(`fetch  ${GAZ.name} ... `);
  const res = await fetch(GAZ.url);
  if (!res.ok) throw new Error(`${res.status} for ${GAZ.url}`);
  const zip = Buffer.from(await res.arrayBuffer());
  // The archive holds a single entry, so read its local header and inflate the
  // payload in place rather than taking on an archive dependency.
  const method = zip.readUInt16LE(8);
  const nameLen = zip.readUInt16LE(26);
  const extraLen = zip.readUInt16LE(28);
  const body = zip.subarray(30 + nameLen + extraLen);
  if (method === 0) await writeFile(gazDest, body);
  else await pipeline(Readable.from(body), createInflateRaw(), createWriteStream(gazDest));
  console.log('ok');
}

console.log('\nsource data ready in tools/src/');
