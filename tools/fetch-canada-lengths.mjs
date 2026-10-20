// Sums each province's own lengths per numbered highway into
// content/reference/ca-lengths.json.
//
//   node tools/fetch-canada-lengths.mjs
//
// No Canadian province publishes a length per highway, but six publish the
// sections their highways are divided into, each with its length:
//
//   BC  Landmark Kilometre Inventory, the SEGMENT table of the Excel edition.
//       A segment on two highways is listed once, with the others in Hwy2 and
//       Hwy3; a divided stretch is one segment per direction, paired by
//       Opposite_Segment. Devolved segments stay in the file for five years
//       and are left out, as are ramps and the 900-series pseudo-highways.
//   SK  HIGHWAY_OFFICIAL, KM_TO - KM_FROM of the mainline sections: ROADNAME
//       is the highway (three digits), control section and subsection, then
//       M for mainline, U or D for undivided or divided, A or B for direction.
//   MB  Highway Inventory 2018, LENGTH_KM of the highway (H) subsections in
//       the ahead and undivided directions. Manitoba has published no later
//       edition. A co-route is filed under the lower number only.
//   NB  DTI Highway Network, LINEAR_LEN of the numbered control sections
//       (R + four-digit route + section) of the types that run the road's
//       length; return sections are the other carriageway, and ramps, turning
//       lanes, scales and turnarounds are not the highway.
//   ON  and AB  the section lengths in the traffic reports already read for
//       ca-traffic.json, summed there over the sections with a count.
//
// Each is what the province manages: a stretch handed to a city, or through a
// national park, is in none of them. build-data.mjs decides where the figure
// describes the route the atlas draws.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readWorkbook } from './xlsx.mjs';
import { parseCsv } from './csv.mjs';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'content', 'reference', 'ca-lengths.json');
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36',
  accept: '*/*',
};

async function get(url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 5000 * i));
    }
  }
}
const getJson = async (url) => JSON.parse((await get(url)).toString('utf8'));
const add = (m, k, km) => { if (km > 0) m[k] = (m[k] ?? 0) + km; };
const rounded = (m) => Object.fromEntries(Object.entries(m)
  .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
  .map(([k, v]) => [k, Math.round(v * 10) / 10]));

const LKI_PAGE = 'https://www2.gov.bc.ca/gov/content/transportation/transportation-infrastructure/engineering-standards-guidelines/landmark-kilometre-inventory';

async function britishColumbia() {
  const page = (await get(LKI_PAGE)).toString('utf8');
  const links = [...page.matchAll(/href="([^"]*lki_bc_(\d{6}[a-z]?)\.xlsx)"/gi)]
    .map((m) => ({ url: new URL(m[1], LKI_PAGE).href, edition: m[2] }))
    .sort((a, b) => b.edition.localeCompare(a.edition));
  if (!links.length) throw new Error('BC: no LKI workbook linked from the LKI page');
  const { url, edition } = links[0];
  const sheets = await readWorkbook(await get(url));
  const seg = sheets.find((s) => s.name === 'SEGMENT')?.rows;
  if (!seg) throw new Error('BC: workbook has no SEGMENT sheet');
  const c = Object.fromEntries(seg[0].map((h, i) => [h, i]));
  for (const f of ['Highway_Number', 'Highway_Letter', 'Hwy2', 'Hwy3', 'Direction', 'Length', 'Devolved_Date', 'Opposite_Segment', 'Description']) {
    if (c[f] == null) throw new Error(`BC: SEGMENT has no ${f} column`);
  }
  const routes = {};
  for (const r of seg.slice(1)) {
    const n = r[c.Highway_Number];
    if (!(n > 0) || n >= 900 || r[c.Devolved_Date] != null) continue;
    if (/\b(EXIT|RAMP|ENTRANCE)\b/i.test(r[c.Description] ?? '')) continue;
    // One carriageway of each divided pair: the northbound or eastbound one.
    if (r[c.Opposite_Segment] != null && !['N', 'E', 'B'].includes(r[c.Direction])) continue;
    const own = `${n}${r[c.Highway_Letter] ?? ''}`;
    for (const h of new Set([own, r[c.Hwy2], r[c.Hwy3]].filter((x) => x != null).map(String))) add(routes, h, r[c.Length]);
  }
  return {
    source: 'British Columbia Ministry of Transportation and Transit, Landmark Kilometre Inventory',
    url: LKI_PAGE,
    licence: 'Open Government Licence – British Columbia',
    edition,
    routes: rounded(routes),
  };
}

const SK_LAYER = 'https://services3.arcgis.com/zcv98lgAl8xQ04cW/arcgis/rest/services/HIGHWAY_OFFICIAL/FeatureServer/0';

async function saskatchewan() {
  const info = await getJson(`${SK_LAYER}?f=json`);
  const routes = {};
  for (let off = 0; ; off += 2000) {
    const j = await getJson(`${SK_LAYER}/query?where=1%3D1&outFields=ROADNAME,KM_FROM,KM_TO`
      + `&returnGeometry=false&orderByFields=FID&resultRecordCount=2000&resultOffset=${off}&f=json`);
    if (j.error) throw new Error(`SK: ${j.error.message}`);
    for (const { attributes: a } of j.features) {
      const m = /^(\d{3})\d{4}M[UD]A$/.exec(a.ROADNAME ?? '');
      if (m) add(routes, String(Number(m[1])), a.KM_TO - a.KM_FROM);
    }
    if (!j.exceededTransferLimit) break;
  }
  const edited = info.editingInfo?.dataLastEditDate ?? info.editingInfo?.lastEditDate;
  return {
    source: 'Saskatchewan Ministry of Highways, HIGHWAY_OFFICIAL',
    url: 'https://geohub.saskatchewan.ca/datasets/saskatchewan::highway-official',
    licence: 'Open Government Licence – Canada',
    edition: edited ? new Date(edited).toISOString().slice(0, 10) : null,
    routes: rounded(routes),
  };
}

const MB_LAYER = 'https://services.arcgis.com/mMUesHYPkXjaFGfS/arcgis/rest/services/Manitoba_Highway_Inventory_2018_1/FeatureServer/0';

async function manitoba() {
  const stats = encodeURIComponent(JSON.stringify([{ statisticType: 'sum', onStatisticField: 'LENGTH_KM', outStatisticFieldName: 'km' }]));
  const j = await getJson(`${MB_LAYER}/query?where=1%3D1&groupByFieldsForStatistics=ROAD_NO,ROAD_DIRECTION,ROAD_TYPE`
    + `&outStatistics=${stats}&f=json`);
  if (j.error) throw new Error(`MB: ${j.error.message}`);
  const routes = {};
  for (const { attributes: a } of j.features) {
    // Lettered numbers are city routes named after the city ("001A - Brandon"),
    // two of them 1A, so they are not keyed to one atlas route.
    if (a.ROAD_TYPE !== 'H' || a.ROAD_DIRECTION === 'B' || !/^\d+$/.test(a.ROAD_NO ?? '')) continue;
    add(routes, String(Number(a.ROAD_NO)), a.km);
  }
  return {
    source: 'Manitoba Transportation and Infrastructure, Manitoba Highway Inventory 2018',
    url: 'https://open.canada.ca/data/en/dataset/1783197a-01c5-76eb-fa40-7d9328e65808',
    licence: 'Manitoba Open Data Licence',
    edition: '2018',
    routes: rounded(routes),
  };
}

const NB_VIEW = 'https://gnb.socrata.com/api/views/73ih-yyca';

async function newBrunswick() {
  const meta = await getJson(`${NB_VIEW}.json`);
  const rows = parseCsv((await get(`${NB_VIEW}/rows.csv?accessType=DOWNLOAD`)).toString('utf8'));
  if (!rows.length || !('rcs_nid' in rows[0]) || !('linear_len' in rows[0])) throw new Error('NB: unexpected columns');
  const routes = {};
  for (const r of rows) {
    const m = /^R(\d{4})\d{3}$/.exec(r.rcs_nid ?? '');
    // 1 section, 5 initial and 6 partial initial section; 2 and 7 are the
    // return carriageway, 3 named roads, 4 ramps, 8 to 10 turning lanes.
    if (!m || !['1', '5', '6'].includes(r.sect_type_)) continue;
    if (!['Arterial', 'Collector', 'Local'].includes(r.func_cla_2)) continue;
    add(routes, String(Number(m[1])), Number(r.linear_len));
  }
  return {
    source: 'New Brunswick Department of Transportation and Infrastructure, Highway Network',
    url: 'https://gnb.socrata.com/datasets/73ih-yyca',
    licence: 'Open Government Licence – New Brunswick',
    edition: meta.rowsUpdatedAt ? new Date(meta.rowsUpdatedAt * 1000).toISOString().slice(0, 10) : null,
    routes: rounded(routes),
  };
}

async function fromTraffic() {
  const tr = JSON.parse(await readFile(join(ROOT, 'content', 'reference', 'ca-traffic.json'), 'utf8'));
  const out = {};
  for (const st of ['ON', 'AB']) {
    const p = tr.provinces?.[st];
    if (!p) throw new Error(`${st}: not in ca-traffic.json; run tools/fetch-canada-traffic.mjs`);
    const years = Object.values(p.routes).map((r) => r.year).filter(Boolean);
    out[st] = {
      source: p.source,
      url: p.url,
      licence: p.licence,
      edition: years.length ? String(Math.max(...years)) : null,
      routes: rounded(Object.fromEntries(Object.entries(p.routes).filter(([, r]) => r.km > 0).map(([k, r]) => [k, r.km]))),
    };
  }
  return out;
}

const provinces = {
  BC: await britishColumbia(),
  ...await fromTraffic(),
  SK: await saskatchewan(),
  MB: await manitoba(),
  NB: await newBrunswick(),
};
await mkdir(join(ROOT, 'content', 'reference'), { recursive: true });
await writeFile(OUT, `${JSON.stringify({
  retrieved: new Date().toISOString().slice(0, 10),
  note: 'Each province\'s own section lengths summed per numbered highway: only the road the '
    + 'province manages. A stretch shared by two highways counts under each in British Columbia '
    + 'and under one of them elsewhere.',
  provinces,
}, null, 1)}\n`);
for (const [st, p] of Object.entries(provinces)) {
  console.log(`  ${st}  ${String(Object.keys(p.routes).length).padStart(4)} highways  ${p.edition ?? ''}`);
}
console.log(`wrote ${OUT}`);
