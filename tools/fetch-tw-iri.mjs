// Downloads the Highway Bureau's provincial pavement roughness into
// content/reference/tw-iri.json.
//
//   node tools/fetch-tw-iri.mjs
//
// 公路養護鋪面檢測資料 (data.gov.tw 98064), under the Open Government Data
// License, version 1: one average IRI in m/km per provincial highway for the
// year's survey, and one for the whole network. It is not per segment, so a
// route gets one figure for its whole length and nothing says where on it the
// rough stretches are. The Freeway Bureau publishes nothing like it.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { splitCsv } from './csv.mjs';
import { SUFFIX } from './taiwan.mjs';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'content', 'reference', 'tw-iri.json');
const DATASET = 98064;
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36',
  accept: '*/*',
};

// The ministry's download host answers 502 now and then; a retry is enough.
async function get(url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      return new TextDecoder('utf-8').decode(await res.arrayBuffer()).replace(/^\uFEFF/, '');
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 5000 * i));
    }
  }
}

const meta = JSON.parse(await get(`https://data.gov.tw/api/v2/rest/dataset/${DATASET}`)).result;
const dist = meta.distribution.find((d) => /csv/i.test(d.resourceFormat));
if (!dist) throw new Error(`dataset ${DATASET} has no CSV resource`);
const text = await get(dist.resourceDownloadUrl);
if (!/^RoadNumber/.test(text)) throw new Error(`unexpected file: ${text.slice(0, 120)}`);

const routes = {};
let network = null;
const skipped = [];
for (const [raw = '', val] of splitCsv(text).slice(1)) {
  if (!raw.trim()) continue;
  const v = Number(val);
  if (!Number.isFinite(v)) { skipped.push(raw); continue; }
  if (raw === '全部') { network = v; continue; }
  const m = /^(\d+)([甲乙丙丁戊己庚]?)$/.exec(raw.trim());
  if (!m) { skipped.push(raw); continue; }
  routes[m[1] + (m[2] ? SUFFIX[m[2]] : '')] = v;
}

await mkdir(join(ROOT, 'content', 'reference'), { recursive: true });
await writeFile(OUT, `${JSON.stringify({
  source: {
    title: meta.title,
    agency: '交通部公路局',
    agencyEn: 'Highway Bureau, MOTC',
    url: `https://data.gov.tw/dataset/${DATASET}`,
    licence: 'Open Government Data License, version 1',
    modified: meta.modifiedDate?.slice(0, 10) ?? null,
    retrieved: new Date().toISOString().slice(0, 10),
  },
  unit: 'm/km',
  network,
  routes,
}, null, 1)}\n`);
console.log(`tw-iri: ${Object.keys(routes).length} routes, network ${network} m/km`
  + (skipped.length ? `; skipped ${skipped.join(', ')}` : ''));
