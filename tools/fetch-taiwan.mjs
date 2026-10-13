// Downloads the Taiwanese source data into tools/src/tw/.
//
//   node tools/fetch-taiwan.mjs
//
// Two files, both under the Open Government Data License, version 1:
//   - NLSC, 國道及省道(含快速公路以上等級)道路中線 (data.gov.tw 73232): the
//     centrelines of every national freeway and provincial highway, numbered.
//   - Highway Bureau, 省道公路路線圖資 (data.gov.tw 105020): the provincial
//     register, with each route's termini, districts and official length.
//
// The Ministry of Transportation's file server sits behind a CDN that turns
// bare clients away with a 502, so both requests go out as a browser would.

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { listEntries, extractEntry } from './unzip.mjs';
import { SRC, ROADS, REGISTER } from './taiwan.mjs';

const NLSC = 'https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset/03D452C9-B893-4C58-A872-A9D73B58F27F/resource/A6E0ECEB-E8D4-4A7D-B47F-AFC48734F69B/download';
const THB = 'https://www.motc.gov.tw/uploaddowndoc?file=datagov/1476384678033231872.csv&filedisplay=%E7%9C%81%E9%81%93%E5%85%AC%E8%B7%AF%E8%B7%AF%E7%B7%9A%E8%A1%A811502.csv&flag=doc';
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36',
  accept: '*/*',
};

async function get(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  await mkdir(SRC, { recursive: true });

  const zip = join(SRC, 'nlsc.zip');
  await writeFile(zip, await get(NLSC));
  let edition = null;
  for (const e of await listEntries(zip)) {
    const ext = e.name.split('.').pop().toLowerCase();
    if (!['shp', 'shx', 'dbf', 'prj', 'cpg'].includes(ext)) continue;
    // The file name carries the edition as an ROC date: 1150409 is 2026-04-09.
    const m = /_(\d{3})(\d{2})(\d{2})\./.exec(e.name);
    if (m) edition = `${Number(m[1]) + 1911}-${m[2]}-${m[3]}`;
    await extractEntry(zip, e, `${ROADS}.${ext}`);
  }
  await rm(zip, { force: true });
  console.log(`NLSC centrelines, edition ${edition ?? 'unknown'} -> tools/src/tw/nlsc-roads.shp`);

  await writeFile(REGISTER, await get(THB));
  console.log('Highway Bureau provincial register -> tools/src/tw/thb-list.csv');

  await writeFile(join(SRC, 'editions.json'), JSON.stringify({
    centrelines: { source: 'National Land Surveying and Mapping Center, 國道及省道(含快速公路以上等級)道路中線', url: 'https://data.gov.tw/dataset/73232', edition },
    register: { source: 'Highway Bureau, MOTC, 省道公路路線圖資', url: 'https://data.gov.tw/dataset/105020' },
    licence: 'Open Government Data License, version 1.0',
    retrieved: new Date().toISOString().slice(0, 10),
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
