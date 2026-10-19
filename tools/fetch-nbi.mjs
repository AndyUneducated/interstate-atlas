// Fetches FHWA's National Bridge Inventory, all states in one delimited file,
// into tools/src/us/ for build-us-bridges.mjs.
//
//   node tools/fetch-nbi.mjs [year]
//
// The archive is about 53 MB and the file inside it some 400 MB, with every
// one of the country's 620,000-odd highway bridges; neither is kept in the
// repository. The year defaults to the latest FHWA has posted, tried from this
// one back.

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { listEntries, extractEntry } from './unzip.mjs';

const DIR = join(import.meta.dirname, 'src', 'us');
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36' };
const url = (y) => `https://www.fhwa.dot.gov/bridge/nbi/${y}hwybronefiledel.zip`;

async function main() {
  await mkdir(DIR, { recursive: true });
  const asked = Number(process.argv[2]);
  const years = asked ? [asked] : [0, 1, 2].map((d) => new Date().getFullYear() - d);
  for (const y of years) {
    const res = await fetch(url(y), { headers: UA });
    if (!res.ok) { console.log(`  ${y}: ${res.status}`); continue; }
    const zip = join(DIR, `nbi-${y}.zip`);
    await writeFile(zip, Buffer.from(await res.arrayBuffer()));
    const entry = (await listEntries(zip)).find((e) => /AllStates\.txt$/i.test(e.name));
    if (!entry) throw new Error(`${zip}: no all-states file inside`);
    const out = join(DIR, `nbi-${y}.txt`);
    await extractEntry(zip, entry, out);
    await rm(zip);
    await writeFile(join(DIR, 'nbi-edition.json'), `${JSON.stringify({ year: y, url: url(y), retrieved: new Date().toISOString().slice(0, 10), file: `nbi-${y}.txt` }, null, 1)}\n`);
    console.log(`NBI ${y} → ${out}`);
    return;
  }
  throw new Error('no NBI file found');
}

main().catch((e) => { console.error(e); process.exit(1); });
