// Writes data/mx-lengths.json: SICT's free federal network per route number,
// as the route panel reads it. From content/reference/mx-lengths.json.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const ref = JSON.parse(await readFile(join(ROOT, 'content', 'reference', 'mx-lengths.json'), 'utf8'));

await writeFile(join(ROOT, 'data', 'mx-lengths.json'), JSON.stringify({
  source: ref.source,
  agency: ref.agency,
  url: ref.url,
  licence: ref.licence,
  edition: ref.edition.match(/\d{4}/g)?.at(-1) ?? ref.edition,
  fields: ['km', 'branchKm', 'states'],
  routes: Object.fromEntries(Object.entries(ref.routes).map(([n, r]) => [n, [r.km, r.branchKm, r.states.length]])),
}));
console.log(`data/mx-lengths.json: ${Object.keys(ref.routes).length} routes`);
