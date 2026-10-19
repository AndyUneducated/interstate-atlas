// Reads Taiwan's national freeways and provincial highways for build-data.mjs.
//
// Geometry: the National Land Surveying and Mapping Center's centrelines of
// the national and provincial highways, part of the Taiwan e-Map transport
// layer, in TWD97 / TM2 zone 121. Register: the Highway Bureau's table of
// provincial highways, which gives each route's official termini, the
// districts it passes through and its official length. Both are published
// under the Open Government Data License, version 1.
//
// The centreline file numbers every segment the way its sign does - 國1, 台14乙,
// 台16臨29 - so a route is read straight from the number and nothing is matched
// by name or by place.

import * as shapefile from 'shapefile';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCsv } from './csv.mjs';

export const SRC = join(import.meta.dirname, 'src', 'tw');
export const ROADS = join(SRC, 'nlsc-roads');
export const REGISTER = join(SRC, 'thb-list.csv');
export const SECTIONS = join(SRC, 'nfb-sections.json');
export const GANTRIES = join(SRC, 'nfb-gantries.csv');
export const STATIONS = join(SRC, 'nfb-stations.csv');

/**
 * Taiwan's 22 county-level divisions by ISO 3166-2:TW suffix. Three letters,
 * and none of them is a Mexican state's, so the codes share the namespace the
 * other countries' jurisdictions use without colliding.
 */
export const COUNTY_CODE = {
  臺北市: 'TPE', 新北市: 'NWT', 基隆市: 'KEE', 桃園市: 'TAO', 新竹市: 'HSZ', 新竹縣: 'HSQ',
  苗栗縣: 'MIA', 臺中市: 'TXG', 彰化縣: 'CHA', 南投縣: 'NAN', 雲林縣: 'YUN', 嘉義市: 'CYI',
  嘉義縣: 'CYQ', 臺南市: 'TNN', 高雄市: 'KHH', 屏東縣: 'PIF', 宜蘭縣: 'ILA', 花蓮縣: 'HUA',
  臺東縣: 'TTT', 澎湖縣: 'PEN', 金門縣: 'KIN', 連江縣: 'LIE',
};
const county = (name) => COUNTY_CODE[name?.replace(/台/g, '臺')] ?? null;

// The suffix that makes a spur: 台1甲 is the first branch of 台1. The letters are
// the ones the Directorate General of Highways uses in English.
const SUFFIX = { 甲: 'A', 乙: 'B', 丙: 'C', 丁: 'D', 戊: 'E', 己: 'F', 庚: 'G' };
export const SUFFIX_ZH = Object.fromEntries(Object.entries(SUFFIX).map(([zh, en]) => [en, zh]));

/**
 * A segment's route number, or null.
 *
 * 臨 marks a provisional number - 台16臨29 is a temporary road carrying 台16's
 * traffic while the real one is closed - and the Highway Bureau's register
 * does not list those as routes, so neither does the atlas.
 */
export function parseNumber(raw) {
  const m = /^(國|台|臺)(\d+)([甲乙丙丁戊己庚]?)(臨\d+)?$/.exec(String(raw ?? '').trim());
  if (!m || m[4]) return null;
  return {
    system: m[1] === '國' ? 'tw-freeway' : 'tw-provincial',
    base: Number(m[2]),
    suffix: SUFFIX[m[3]] ?? '',
    number: `${Number(m[2])}${SUFFIX[m[3]] ?? ''}`,
  };
}

export function taiwanLabel(system, number) {
  return system === 'tw-freeway' ? `Fwy ${number}` : `PH ${number}`;
}

/**
 * TWD97 / TM2 zone 121 to longitude and latitude.
 *
 * TWD97 is realised on GRS80 and agrees with WGS84 to well under a metre, so
 * the inverse transverse Mercator is the whole conversion. Series to the sixth
 * order in the third flattening (Krüger), good to millimetres across the zone.
 */
const A = 6378137;
const F = 1 / 298.257222101;
const N = F / (2 - F);
const A_HAT = (A / (1 + N)) * (1 + N ** 2 / 4 + N ** 4 / 64);
const BETA = [
  N / 2 - (2 / 3) * N ** 2 + (37 / 96) * N ** 3,
  N ** 2 / 48 + N ** 3 / 15,
  (17 / 480) * N ** 3,
];
const DELTA = [
  2 * N - (2 / 3) * N ** 2 - 2 * N ** 3,
  (7 / 3) * N ** 2 - (8 / 5) * N ** 3,
  (56 / 15) * N ** 3,
];
export function tm2ToLonLat([x, y], lon0 = 121, k0 = 0.9999, fe = 250000) {
  const xi = y / (k0 * A_HAT);
  const eta = (x - fe) / (k0 * A_HAT);
  let xi1 = xi, eta1 = eta;
  for (let j = 1; j <= 3; j++) {
    xi1 -= BETA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    eta1 -= BETA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xi1) / Math.cosh(eta1));
  let phi = chi;
  for (let j = 1; j <= 3; j++) phi += DELTA[j - 1] * Math.sin(2 * j * chi);
  const lon = lon0 + (Math.atan2(Math.sinh(eta1), Math.cos(xi1)) * 180) / Math.PI;
  return [lon, (phi * 180) / Math.PI];
}

/**
 * The Highway Bureau's provincial register, by route number: official
 * termini, the districts in order, the official length in kilometres and the
 * date the row was last revised.
 */
export async function loadRegister() {
  let text;
  try { text = await readFile(REGISTER, 'utf8'); } catch { return null; }
  const rows = parseCsv(text.replace(/^\uFEFF/, ''));
  const out = new Map();
  for (const r of rows) {
    const name = (r['公路名稱'] ?? '').trim();
    const p = parseNumber(name.replace(/線$/, ''));
    if (!p) continue;
    const [from, to] = (r['路線起迄點'] ?? '').split(/\s*-\s*/);
    out.set(p.number, {
      name,
      from: from?.trim() || null,
      to: to?.trim() || null,
      places: (r['經過地名'] ?? '').split('、').map((s) => s.trim()).filter(Boolean),
      km: Number(r['路線里程']) || null,
      updated: (r['更新日期'] ?? '').trim() || null,
    });
  }
  return out;
}

/**
 * The Freeway Bureau's sections, as one row per freeway number: the chainage
 * at its far end, which is the length the Bureau signs, and the places named
 * at 0K and at that end.
 *
 * Chainage runs from 0K at a freeway's start, so the far end's is the length
 * of the mainline. A viaduct that carries a freeway's number beside it (國道1號
 * 汐止五股高架道路) keeps the mainline's chainage and is not a second length.
 */
export async function loadFreewayLengths() {
  let data;
  try { data = JSON.parse(await readFile(SECTIONS, 'utf8')); } catch { return null; }
  const km = (s) => {
    const m = /^(\d+)K\+(\d+)$/.exec(String(s ?? '').trim());
    return m ? Number(m[1]) + Number(m[2]) / 1000 : null;
  };
  const updated = String(data.SrcUpdateTime ?? data.UpdateTime ?? '').slice(0, 10) || null;
  const out = new Map();
  for (const s of data.Sections ?? []) {
    const m = /^國道(\d+)(?:號|([甲乙丙丁]))$/.exec(String(s.RoadName ?? '').trim());
    if (!m) continue;
    const number = `${Number(m[1])}${SUFFIX[m[2]] ?? ''}`;
    const row = out.get(number) ?? { name: s.RoadName, from: null, to: null, min: Infinity, km: 0, places: null, updated };
    for (const [at, place] of [[km(s.SectionMile?.StartKM), s.RoadSection?.Start], [km(s.SectionMile?.EndKM), s.RoadSection?.End]]) {
      if (at == null) continue;
      if (at < row.min) { row.min = at; row.from = place?.trim() || null; }
      if (at > row.km) { row.km = at; row.to = place?.trim() || null; }
    }
    out.set(number, row);
  }
  for (const row of out.values()) { row.km = Math.round(row.km * 100) / 100; delete row.min; }
  return out;
}

const NUMERAL = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const isoDate = (s) => (/^\d{8}$/.test(String(s ?? '').trim()) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);

/**
 * The Freeway Bureau's ETC charging gantries and the toll stations they
 * replaced, or null.
 *
 * The gantry file has a row per gantry and direction, written 國道一號 or
 * 國道三甲, with the section it charges for and the posted price per vehicle
 * class; the two directions of one gantry share its number but for the last
 * letter, and become one point. 國道一號高架 is the 汐止五股 viaduct. The
 * station file is one row per station, with its chainage as signed (9k+350).
 */
export async function loadFreewayTolls() {
  let gantryText, stationText;
  try {
    gantryText = await readFile(GANTRIES, 'utf8');
    stationText = await readFile(STATIONS, 'utf8');
  } catch { return null; }
  const fwyOf = (raw) => {
    const m = /^國道([一二三四五六七八九十]+|\d+)號?([甲乙])?(高架)?\s*$/.exec(String(raw ?? '').trim());
    if (!m) return null;
    const n = NUMERAL[m[1]] ?? Number(m[1]);
    return { number: `${n}${SUFFIX[m[2]] ?? ''}`, elevated: Boolean(m[3]) };
  };
  const gantries = new Map();
  for (const r of parseCsv(gantryText.replace(/^\uFEFF/, ''))) {
    const fwy = fwyOf(r['國道別']);
    const code = (r['編號'] ?? '').trim();
    const lat = Number(r['緯度']), lon = Number(r['經度']);
    if (!fwy || !code || !lat || !lon) continue;
    const id = code.replace(/[NSEW]$/, '');
    const g = gantries.get(id) ?? { id, ...fwy, at: Number(/-(\d+(?:\.\d+)?)/.exec(code)?.[1]) || 0, pts: [], dirs: [] };
    g.pts.push([lon, lat]);
    g.dirs.push({
      dir: (r['方向'] ?? '').trim(),
      from: (r['起點交流道'] ?? '').trim(),
      to: (r['迄點交流道'] ?? '').trim(),
      km: Number(r['收費區設定里程']) || null,
      fares: [r['小型車牌價'], r['大型車牌價'], r['聯結車牌價']].map((v) => Number(v) || null),
    });
    gantries.set(id, g);
  }
  for (const g of gantries.values()) {
    g.coord = [0, 1].map((k) => g.pts.reduce((s, p) => s + p[k], 0) / g.pts.length);
    delete g.pts;
  }
  const stations = [];
  for (const r of parseCsv(stationText.replace(/^\uFEFF/, ''))) {
    const fwy = fwyOf(r['國道別']);
    if (!fwy) continue;
    stations.push({
      name: (r['收費站別'] ?? '').trim(),
      number: fwy.number,
      at: (r['里程數'] ?? '').trim(),
      built: isoDate(r['成立日期']),
      from: isoDate(r['開始收費日期']),
      to: isoDate(r['結束日期']),
      note: (r['備註'] ?? '').trim() || null,
    });
  }
  return { gantries: [...gantries.values()], stations };
}

/**
 * Every numbered segment, grouped by route.
 *
 * The type is what the source's class says about the road: 國道 and the 快速公路
 * (the 1E class, 台61 to 台88) are built to freeway standard; the rest of the
 * provincial network is an ordinary trunk road through every town on it.
 */
export async function loadTaiwan() {
  try { await stat(`${ROADS}.shp`); } catch { return null; }
  const src = await shapefile.open(`${ROADS}.shp`, `${ROADS}.dbf`, { encoding: 'utf-8' });
  const groups = new Map();
  let read = 0, skipped = 0, provisional = 0, edition = null;
  for (let r = await src.read(); !r.done; r = await src.read()) {
    read++;
    const p = r.value.properties;
    if (/臨\d+$/.test(p.ROADNUM ?? '')) { provisional++; continue; }
    const num = parseNumber(p.ROADNUM);
    if (!num || !r.value.geometry) { skipped++; continue; }
    if (p.UPD_YYYYMM && (!edition || p.UPD_YYYYMM > edition)) edition = p.UPD_YYYYMM;
    const lines = r.value.geometry.type === 'MultiLineString' ? r.value.geometry.coordinates : [r.value.geometry.coordinates];
    const cls = String(p.ROADCLASS1 ?? '');
    const props = {
      state: county(p.COUNTY),
      type: cls.startsWith('H') || cls === '1E' ? 'Freeway' : 'Primary',
      name: p.ROADNAME || null,
      bridge: p.BRITUNNAME || null,
    };
    const key = `${num.system}|${num.number}`;
    if (!groups.has(key)) groups.set(key, { ...num, parts: [], names: new Set() });
    const g = groups.get(key);
    if (props.name && !/交流道|匝道|端$/.test(props.name)) g.names.add(props.name);
    for (const line of lines) {
      if (line.length >= 2) g.parts.push({ coords: line.map((c) => tm2ToLonLat(c)), props });
    }
  }
  return { groups, read, skipped, provisional, edition };
}
