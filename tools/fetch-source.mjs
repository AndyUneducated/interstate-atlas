// Downloads the US Census place gazetteer into tools/src/.
//
//   node tools/fetch-source.mjs
//
// About 6 MB, not committed, a US Government work and so free of licence
// restriction. It is the name-and-coordinate list the build uses to say which
// places a route passes through and where its ends are.
//
// This script used to pull Natural Earth's road and populated-place layers too.
// TIGER/Line replaced them as the geometry source and nothing reads them now,
// so they are no longer fetched.

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw } from 'node:zlib';

const SRC = join(import.meta.dirname, 'src');

const GAZ = {
  url: 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_place_national.zip',
  name: '2023_Gaz_place_national.txt',
};

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

await mkdir(SRC, { recursive: true });

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
