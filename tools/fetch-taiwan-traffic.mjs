// Downloads Taiwan's traffic counts into content/reference/tw-traffic.json.
//
//   node tools/fetch-taiwan-traffic.mjs
//
// Two publications, both under the Open Government Data License, version 1:
//   - Freeway Bureau, 日交通量參考值 (data.gov.tw 21115): a daily volume for
//     every mainline section between two interchanges, per direction, for a
//     Saturday, a Sunday and a weekday. Not an annual average, and not
//     presented as one.
//   - Highway Bureau, 公路交通量調查統計表 (data.gov.tw 46754): the provincial
//     highway survey, one row per count station and direction, with the
//     section it stands for in kilometre posts, vehicles per day by class,
//     PCU and the station's coordinates.
//
// Each year the newest edition of both is taken. The rows are kept as
// published; build-data.mjs decides what a route's figure is.

import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listEntries, extractEntry } from './unzip.mjs';
import { splitCsv } from './csv.mjs';
import { parseNumber } from './taiwan.mjs';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'content', 'reference', 'tw-traffic.json');
const TMP = join(import.meta.dirname, 'src', 'tw', 'traffic');
const FREEWAY_DATASET = 21115;
const PROVINCIAL_DATASET = 46754;
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36',
  accept: '*/*',
};

async function get(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// The two bureaus write UTF-8 in one year and Big5 in another.
function decode(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('big5').decode(buf);
  }
}

// Spreadsheet numbers, with thousands separators and the odd trailing space.
const num = (s) => {
  const v = Number(String(s ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(v) && String(s ?? '').trim() !== '' ? v : null;
};
// Coordinates written either bare or as E121.88503 / N24.93471.
const coord = (s) => num(String(s ?? '').replace(/^[ENWS]/i, ''));
const rocYear = (s) => Number(s) + 1911;

async function datasetResources(id) {
  const j = JSON.parse(decode(await get(`https://data.gov.tw/api/v2/rest/dataset/${id}`)));
  return j.result?.distribution ?? [];
}

/**
 * The freeway reference values: the newest year's mainline file.
 *
 * A row is one direction of one section, named by the interchanges at its two
 * ends, and the route and direction are written together: 國1南向路段,
 * 國1高架北向路段, 國3甲東向路段.
 */
async function freeway() {
  const res = await datasetResources(FREEWAY_DATASET);
  const mains = res
    .map((d) => ({ d, m: /^(\d+)年.*主線/.exec(d.resourceDescription ?? '') }))
    .filter((x) => x.m)
    .sort((a, b) => Number(b.m[1]) - Number(a.m[1]));
  if (!mains.length) throw new Error('no mainline file in the freeway reference values');
  const { d, m } = mains[0];
  const rows = splitCsv(decode(await get(d.resourceDownloadUrl)));
  const head = rows.shift().map((h) => h.trim());
  const col = (name) => head.indexOf(name);
  const [cRoute, cSect, cSat, cSun, cWk] = ['路線方向', '路段', '週六', '週日', '平日'].map(col);
  if ([cRoute, cSect, cSat, cSun, cWk].some((i) => i < 0)) throw new Error(`freeway columns changed: ${head.join(',')}`);

  const sections = [];
  const unread = new Set();
  for (const r of rows) {
    const rm = /^國(\d+)([甲乙丙丁戊己庚]?)(高架)?([東西南北])向路段$/.exec(r[cRoute]?.trim() ?? '');
    const p = rm ? parseNumber(`國${rm[1]}${rm[2]}`) : null;
    if (!p) { unread.add(r[cRoute]); continue; }
    sections.push([p.number, rm[3] ? 1 : 0, rm[4], r[cSect].trim(), num(r[cSat]), num(r[cSun]), num(r[cWk])]);
  }
  return {
    source: 'Freeway Bureau, MOTC, 日交通量參考值 (主線)',
    agency: 'Freeway Bureau, MOTC',
    url: `https://data.gov.tw/dataset/${FREEWAY_DATASET}`,
    licence: 'Open Government Data License, version 1.0',
    year: rocYear(m[1]),
    file: d.resourceDescription,
    fields: ['number', 'elevated', 'dir', 'section', 'sat', 'sun', 'weekday'],
    sections,
    unread: [...unread],
  };
}

/**
 * The provincial survey: the newest year's archive, one CSV per maintenance
 * district office.
 *
 * The open-data entry is a list of the yearly archives rather than the counts
 * themselves. Each archive holds a workbook and a CSV per office, and the
 * southern office adds a file of its county roads, which carry no 台 number
 * and are left out by the number rather than by the file name.
 */
async function provincial() {
  const res = await datasetResources(PROVINCIAL_DATASET);
  if (!res[0]) throw new Error('provincial survey dataset has no resource');
  const list = splitCsv(decode(await get(res[0].resourceDownloadUrl)));
  const head = list.shift().map((h) => h.trim());
  const cTitle = head.indexOf('Title');
  const cFile = head.findIndex((h) => h.startsWith('FileName'));
  const editions = list
    .map((r) => ({ url: r[cFile], title: r[cTitle], m: /(\d+)年度/.exec(r[cTitle] ?? '') }))
    .filter((x) => x.m && x.url)
    .sort((a, b) => Number(b.m[1]) - Number(a.m[1]));
  if (!editions.length) throw new Error('no yearly archive in the provincial survey list');
  const ed = editions[0];

  await mkdir(TMP, { recursive: true });
  const zip = join(TMP, 'survey.zip');
  await writeFile(zip, await get(ed.url));

  const F = ['county', 'id', 'place', 'stKm', 'stM', 'lon', 'lat', 'route', 'from', 'to',
    'fromK', 'fromM', 'toK', 'toM', 'terrain', 'km', 'width', 'dir'];
  const stations = [];
  const offices = [];
  const skipped = new Set();
  let n = 0;
  for (const e of await listEntries(zip)) {
    if (!/\.csv$/i.test(e.name)) continue;
    const dest = join(TMP, `office-${n++}.csv`);
    await extractEntry(zip, e, dest);
    const rows = splitCsv(decode(await readFile(dest)));
    // Some offices put a title and a "reporting unit" line above the header.
    const at = rows.findIndex((r) => r[0]?.trim() === '縣市別');
    if (at < 0) continue;
    const hd = rows[at].map((h) => h.trim());
    const col = (name) => hd.indexOf(name);
    const cTotal = col('各車種車輛數(輛/日)_合計');
    const cls = ['小型車', '大客車', '大貨車', '全聯結車', '半聯結車', '機車'].map((k) => col(`各車種車輛數(輛/日)_${k}`));
    const cPcu = col('總計_流量(PCU)');
    const cNote = col('備註');
    if (cTotal < 0 || cls.some((i) => i < 0)) throw new Error(`survey columns changed in ${e.name}`);
    let kept = 0;
    for (const r of rows.slice(at + 1)) {
      const p = parseNumber(String(r[7] ?? '').trim().replace(/線$/, '').replace(/^臺/, '台'));
      if (!p || p.system !== 'tw-provincial') { if (r[7]) skipped.add(r[7].trim()); continue; }
      const o = Object.fromEntries(F.map((f, i) => [f, r[i]?.trim() ?? '']));
      const km = (k, m) => (num(k) == null ? null : num(k) + (num(m) ?? 0) / 1000);
      // The Eastern office writes its works office where the others name the
      // station, so there the station is named by the ends of its section.
      const place = !o.place || /工程處$/.test(o.place) ? [o.from, o.to].filter(Boolean).join('–') : o.place;
      stations.push([
        p.number, o.id, place, coord(o.lon), coord(o.lat),
        km(o.fromK, o.fromM), km(o.toK, o.toM), num(o.km), o.dir,
        num(r[cTotal]), ...cls.map((i) => num(r[i])), num(r[cPcu]),
        cNote >= 0 ? (r[cNote]?.trim() || null) : null,
      ]);
      kept++;
    }
    offices.push(kept);
  }
  await rm(TMP, { recursive: true, force: true });
  return {
    source: 'Highway Bureau, MOTC, 公路交通量調查統計表 (平均每日交通量調查統計表 總表2)',
    agency: 'Highway Bureau, MOTC',
    url: `https://data.gov.tw/dataset/${PROVINCIAL_DATASET}`,
    licence: 'Open Government Data License, version 1.0',
    year: rocYear(ed.m[1]),
    edition: ed.title,
    fields: ['number', 'station', 'place', 'lon', 'lat', 'fromKm', 'toKm', 'km', 'dir',
      'total', 'small', 'bus', 'truck', 'fullTrailer', 'semiTrailer', 'moto', 'pcu', 'note'],
    stations,
    offices,
    skipped: [...skipped].slice(0, 40),
  };
}

async function main() {
  const [fw, pv] = [await freeway(), await provincial()];
  const retrieved = new Date().toISOString().slice(0, 10);
  await mkdir(join(ROOT, 'content', 'reference'), { recursive: true });
  await writeFile(OUT, `${JSON.stringify({
    retrieved,
    freeway: fw,
    provincial: pv,
  })}\n`);
  const fwRoutes = new Set(fw.sections.map((s) => s[0]));
  const pvRoutes = new Set(pv.stations.map((s) => s[0]));
  console.log(`freeway ${fw.year}: ${fw.sections.length} section-directions on ${fwRoutes.size} freeways`
    + `${fw.unread.length ? `; unread: ${fw.unread.join(' ')}` : ''}`);
  console.log(`provincial ${pv.year}: ${pv.stations.length} station-directions on ${pvRoutes.size} routes`
    + ` from ${pv.offices.length} offices (${pv.offices.join(', ')}); ${pv.skipped.length} other numbers left out`);
  console.log(`-> ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
