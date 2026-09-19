// Downloads the Canadian source data into tools/src/ca/.
//
//   node tools/fetch-canada.mjs
//
// Source: Statistics Canada's National Road Network (NRN), published per
// province and territory under the Open Government Licence - Canada. It is the
// authoritative national road file: every segment carries its route numbers,
// its route names in English and French, road class, lane count, speed limit,
// pavement status and the places on either side.
//
// The archives total about 1.5 GB because each one ships an English and a
// French copy of the same shapefiles. Only the English road-segment layer is
// extracted - the French route names are fields inside it, not a separate file
// - and the archive is deleted once unpacked. Shapefiles are uncompressed, so
// what lands on disk is still far larger than what came down the wire: about
// 5.4 GB, most of it Ontario, Quebec and Alberta.

import { mkdir, writeFile, stat, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { listEntries, extractEntry } from './unzip.mjs';

const SRC = join(import.meta.dirname, 'src', 'ca');
const BASE = 'https://geo.statcan.gc.ca/nrn_rrn';

// Ordered smallest first, so a broken run still leaves most of the country
// usable and the expensive provinces are attempted last.
export const PROVINCES = [
  { pr: 'nu', name: 'Nunavut', mb: 3 },
  { pr: 'yt', name: 'Yukon', mb: 5 },
  { pr: 'nt', name: 'Northwest Territories', mb: 9 },
  { pr: 'pe', name: 'Prince Edward Island', mb: 12 },
  { pr: 'nl', name: 'Newfoundland and Labrador', mb: 26 },
  { pr: 'mb', name: 'Manitoba', mb: 54 },
  { pr: 'nb', name: 'New Brunswick', mb: 55 },
  { pr: 'ns', name: 'Nova Scotia', mb: 112 },
  { pr: 'sk', name: 'Saskatchewan', mb: 124 },
  { pr: 'bc', name: 'British Columbia', mb: 136 },
  { pr: 'ab', name: 'Alberta', mb: 203 },
  { pr: 'qc', name: 'Quebec', mb: 329 },
  { pr: 'on', name: 'Ontario', mb: 417 },
];

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

/** The extracted road layer for a province, whose version is in its filename. */
export async function roadsegPath(pr) {
  const dir = join(SRC, pr);
  try {
    const { readdir } = await import('node:fs/promises');
    const found = (await readdir(dir)).find((f) => /ROADSEG\.shp$/i.test(f));
    return found ? join(dir, found.replace(/\.shp$/i, '')) : null;
  } catch {
    return null;
  }
}

async function download(url, dest, label, mb) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const total = Number(res.headers.get('content-length')) || mb * 1024 * 1024;
  let seen = 0;
  let lastShown = 0;
  const tick = new TransformStream({
    transform(chunk, ctrl) {
      seen += chunk.length;
      const pct = Math.floor((seen / total) * 100);
      if (pct >= lastShown + 5) {
        lastShown = pct;
        process.stdout.write(`\r  ${label}  ${String(pct).padStart(3)}%  ${(seen / 1048576).toFixed(0)}/${(total / 1048576).toFixed(0)} MB   `);
      }
      ctrl.enqueue(chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body.pipeThrough(tick)), createWriteStream(dest));
}

async function fetchProvince(p) {
  const dir = join(SRC, p.pr);
  if (await roadsegPath(p.pr)) { console.log(`have   ${p.pr.toUpperCase()}  ${p.name}`); return; }

  await mkdir(dir, { recursive: true });
  const zip = join(SRC, `${p.pr}.zip`);
  const label = `${p.pr.toUpperCase().padEnd(3)} ${p.name.padEnd(26)}`;
  if (!(await exists(zip))) {
    await download(`${BASE}/${p.pr}/nrn_rrn_${p.pr}_SHAPE.zip`, zip, label, p.mb);
  }

  process.stdout.write(`\r  ${label}  unpacking...                    `);
  const entries = await listEntries(zip);
  const wanted = entries.filter((e) => /_en\/.*ROADSEG\.(shp|shx|dbf|prj)$/i.test(e.name));
  if (!wanted.length) throw new Error(`no English road layer inside ${p.pr}.zip`);
  for (const e of wanted) {
    await extractEntry(zip, e, join(dir, e.name.split('/').pop()));
  }
  await rm(zip, { force: true });
  console.log(`\r  ${label}  ok  (${wanted.length} files)                    `);
}

async function main() {
  await mkdir(SRC, { recursive: true });
  await rm(join(SRC, 'probe'), { recursive: true, force: true });

  console.log(`fetching Statistics Canada National Road Network - ${PROVINCES.length} jurisdictions\n`);
  const failed = [];
  for (const p of PROVINCES) {
    try {
      await fetchProvince(p);
    } catch (e) {
      failed.push(p.pr);
      console.log(`\r  ${p.pr.toUpperCase()}  FAILED: ${e.message}`);
    }
  }

  // Provenance travels with the data: the site cites its sources, and the
  // edition number is part of the citation.
  const editions = {};
  for (const p of PROVINCES) {
    const base = await roadsegPath(p.pr);
    if (!base) continue;
    const m = /NRN_([A-Z]{2})_(\d+)_(\d+)_ROADSEG$/.exec(base.split(/[\\/]/).pop());
    if (m) editions[p.pr] = `${m[2]}.${m[3]}`;
  }
  await writeFile(join(SRC, 'editions.json'), JSON.stringify({
    source: 'Statistics Canada, National Road Network (NRN)',
    licence: 'Open Government Licence - Canada',
    retrieved: new Date().toISOString().slice(0, 10),
    editions,
  }, null, 2));

  console.log(`\nCanadian source data ready in tools/src/ca/  (${Object.keys(editions).length}/${PROVINCES.length} jurisdictions)`);
  if (failed.length) {
    console.log(`missing: ${failed.join(', ')} - re-run to retry`);
    process.exitCode = 1;
  }
}

// Run only when invoked directly; build-data.mjs imports PROVINCES and
// roadsegPath from here.
if (process.argv[1] && /fetch-canada\.mjs$/.test(process.argv[1])) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
