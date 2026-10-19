// Downloads the Taiwanese source data into tools/src/tw/.
//
//   node tools/fetch-taiwan.mjs
//
// Two files, both under the Open Government Data License, version 1:
//   - NLSC, 國道及省道(含快速公路以上等級)道路中線 (data.gov.tw 73232): the
//     centrelines of every national freeway and provincial highway, numbered.
//   - Highway Bureau, 省道公路路線圖資 (data.gov.tw 105020): the provincial
//     register, with each route's termini, districts and official length.
// And one under the same licence, republished by the ministry's TDX platform:
//   - Freeway Bureau, 路段基本資訊 v2.0 (data.gov.tw 37652): every freeway
//     section with its chainage, which gives each freeway's signed length.
//     The Bureau's own server times out from outside Taiwan; TDX serves the
//     same rows, and answers a handful of requests a day without a key.
// And two from the Freeway Bureau's download page, same licence:
//   - 國道計費門架座標及里程牌價表 (data.gov.tw 21165): every ETC charging
//     gantry, with its position, the section it charges and its posted prices.
//   - 收費站成立時間表 (data.gov.tw 118759): the toll stations the gantries
//     replaced, with the dates each opened, began charging and closed.
//
// The Ministry of Transportation's file server sits behind a CDN that turns
// bare clients away with a 502, so both requests go out as a browser would.

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { listEntries, extractEntry } from './unzip.mjs';
import { SRC, ROADS, REGISTER, SECTIONS, GANTRIES, STATIONS } from './taiwan.mjs';

const NLSC = 'https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset/03D452C9-B893-4C58-A872-A9D73B58F27F/resource/A6E0ECEB-E8D4-4A7D-B47F-AFC48734F69B/download';
const NFB = 'https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/Section/Freeway?$format=JSON';
const GANTRY = 'https://www.freeway.gov.tw/Download_File_Direct.ashx?id=112&FileConditionsID=1';
const STATION = 'https://www.freeway.gov.tw/Download_File_Direct.ashx?id=398&FileConditionsID=1';
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

  const sections = await get(NFB);
  await writeFile(SECTIONS, sections);
  const sectionsAt = JSON.parse(sections.toString('utf8')).SrcUpdateTime?.slice(0, 10) ?? null;
  console.log(`Freeway Bureau sections, ${sectionsAt ?? 'undated'} -> tools/src/tw/nfb-sections.json`);

  await writeFile(GANTRIES, await get(GANTRY));
  await writeFile(STATIONS, await get(STATION));
  // The files carry no date; the catalogue's record of each says when it changed.
  const modified = async (id) => JSON.parse((await get(`https://data.gov.tw/api/v2/rest/dataset/${id}`)).toString('utf8'))
    .result?.modifiedDate?.slice(0, 10) ?? null;
  const gantriesAt = await modified(21165);
  const stationsAt = await modified(118759);
  console.log('Freeway Bureau gantries and toll stations -> tools/src/tw/nfb-gantries.csv, nfb-stations.csv');

  await writeFile(join(SRC, 'editions.json'), JSON.stringify({
    centrelines: { source: 'National Land Surveying and Mapping Center, 國道及省道(含快速公路以上等級)道路中線', url: 'https://data.gov.tw/dataset/73232', edition },
    register: { source: 'Highway Bureau, MOTC, 省道公路路線圖資', url: 'https://data.gov.tw/dataset/105020' },
    sections: { source: 'Freeway Bureau, MOTC, 路段基本資訊 v2.0, via TDX', url: 'https://data.gov.tw/dataset/37652', edition: sectionsAt },
    gantries: { source: 'Freeway Bureau, MOTC, 國道計費門架座標及里程牌價表', url: 'https://data.gov.tw/dataset/21165', edition: gantriesAt },
    stations: { source: 'Freeway Bureau, MOTC, 收費站成立時間表', url: 'https://data.gov.tw/dataset/118759', edition: stationsAt },
    licence: 'Open Government Data License, version 1.0',
    retrieved: new Date().toISOString().slice(0, 10),
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
