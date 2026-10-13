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
