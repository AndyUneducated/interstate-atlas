// Reads mainland China's numbered roads for build-data.mjs.
//
// The geometry is OpenStreetMap's (D-66), extracted by fetch-china.mjs into
// tools/src/cn/roads.ndjson: every way that carries a G or S number, on its
// own ref or through a route relation, with its road class and toll tag.
//
// The numbers are read as the national standard writes them (GB/T 917, the
// 2013 and 2022 national highway network plans): a national expressway is G
// with one or two digits, or four for its spurs, rings and links; an ordinary
// national highway is G with three; a provincial road is S, numbered by each
// province on its own, so S203 in Hebei and S203 in Yunnan are two roads.

import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

export const SRC = join(import.meta.dirname, 'src', 'cn');

/** The OSM road classes a numbered route can run on. Links, construction and
 *  proposals are not road a route can be driven on today. */
export const ROAD_CLASSES = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'track',
]);

/**
 * The province-level divisions, by ISO 3166-2:CN suffix, to the three-letter
 * codes the atlas files them under. ISO's own two letters would collide with
 * American states - SC, HI, GA's neighbour - so these are three, and none is a
 * Mexican state's or a Taiwanese county's.
 */
export const PROVINCE_CODE = {
  BJ: 'BEJ', TJ: 'TJN', HE: 'HEB', SX: 'SXI', NM: 'NMG', LN: 'LIA', JL: 'JIL', HL: 'HLJ',
  SH: 'SHH', JS: 'JSU', ZJ: 'ZHJ', AH: 'ANH', FJ: 'FUJ', JX: 'JXI', SD: 'SHD', HA: 'HEN',
  HB: 'HUB', HN: 'HUN', GD: 'GDG', GX: 'GXI', HI: 'HAI', CQ: 'CHQ', SC: 'SCH', GZ: 'GZH',
  YN: 'YNN', XZ: 'XIZ', SN: 'SHA', GS: 'GSU', QH: 'QHI', NX: 'NXA', XJ: 'XJG',
};

const FULLWIDTH = (s) => s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

/**
 * One ref token, normalised, or null if it is not a current G or S number.
 *
 * Mappers mark a superseded number with 旧 or "old", or in brackets after the
 * current one; the three-digit G0xx numbers are the expressway numbering the
 * 2009 standard replaced.
 */
export function parseRef(raw) {
  if (!raw) return null;
  let s = FULLWIDTH(String(raw)).trim();
  if (/旧|old|原/i.test(s)) return null;
  s = s.split(/[（(]/)[0].replace(/\s+/g, '').toUpperCase();
  const m = /^([GS])(\d{1,4})([A-Z]\d{0,2})?$/.exec(s);
  if (!m) return null;
  const [, letter, digits, suffix = ''] = m;
  if (digits.startsWith('0') && digits.length < 4) return null;
  if (suffix && digits.length > 2) return null;
  return `${letter}${digits}${suffix}`;
}

/** Which system a number belongs to, and whether it is a main line or a spur. */
export function classify(ref) {
  const m = /^([GS])(\d+)([A-Z]\d*)?$/.exec(ref);
  if (!m) return null;
  const [, letter, digits, suffix] = m;
  const expressway = digits.length <= 2 || digits.length === 4;
  if (letter === 'G') {
    return expressway
      ? { system: 'cn-expressway', tier: digits.length <= 2 && !suffix ? 'primary' : 'auxiliary' }
      : { system: 'cn-national', tier: Number(digits) < 500 ? 'primary' : 'auxiliary' };
  }
  return { system: 'cn-provincial', tier: 'state', expressway };
}

export const chinaLabel = (ref) => ref;

/**
 * The road class an OSM way is mapped as, in the atlas's shared vocabulary.
 *
 * A motorway is a freeway whether or not it is tagged toll=yes. The tag is on
 * under a third of the expressway network's length, on roads that are tolled
 * almost throughout, so a toll share read from it would measure the mapping
 * rather than the road (D-69).
 */
function typeOf(hw, surface) {
  if (/^(unpaved|gravel|dirt|ground|earth|sand|grass|compacted|fine_gravel|mud)$/.test(surface ?? '')) return 'Unpaved';
  if (hw === 'motorway') return 'Freeway';
  if (hw === 'trunk' || hw === 'primary') return 'Primary';
  if (hw === 'secondary') return 'Secondary';
  if (hw === 'track') return 'Unpaved';
  return 'Other Paved';
}

/**
 * The town or city a route's end is at, from the places mapped in the same
 * extract.
 *
 * A city wins over a town a few kilometres nearer, as the American gazetteer
 * lookup leans toward larger places. Within 30 km the nearest place names the
 * end; where there is none - the Tibetan plateau, the Taklamakan - the search
 * widens to 120 km and the panel says how far away the place is.
 * The name travels in both scripts where the map has both.
 */
export function placeFinder(places, locate) {
  const grid = new Map();
  for (const p of places) {
    const k = `${Math.floor(p[0] * 4)},${Math.floor(p[1] * 4)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  }
  const R = 6371;
  const km = (a, b) => {
    const dLat = ((b[1] - a[1]) * Math.PI) / 180;
    const dLon = ((b[0] - a[0]) * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2
      + Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const search = (pt, cells, maxKm) => {
    const gx = Math.floor(pt[0] * 4), gy = Math.floor(pt[1] * 4);
    let best = null;
    for (let dx = -cells; dx <= cells; dx++) {
      for (let dy = -cells; dy <= cells; dy++) {
        for (const p of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
          const d = km(pt, p);
          if (d > maxKm) continue;
          const score = d - (p[2] === 'city' ? 8 : 0);
          if (!best || score < best.score) best = { score, d, p };
        }
      }
    }
    return best;
  };
  return (pt) => {
    if (!pt) return null;
    const best = search(pt, 2, 30) ?? search(pt, 6, 120);
    if (!best) return null;
    const [lon, lat, , zh, en] = best.p;
    return {
      name: en || zh, nameZh: zh, st: locate([lon, lat]) ?? locate.near([lon, lat], 0.2),
      km: Math.round(best.d * 10) / 10, cn: true,
    };
  };
}

/**
 * Every numbered way, grouped by route.
 *
 * `locate` files a way in a province by its middle point. National numbers
 * cross provinces and are one route each; a provincial number is one route per
 * province that uses it.
 */
export async function loadChina(locate) {
  const file = join(SRC, 'roads.ndjson');
  try { await stat(file); } catch { return null; }
  const edition = JSON.parse(await readFile(join(SRC, 'edition.json'), 'utf8'));
  const info = JSON.parse(await readFile(join(SRC, 'routes-osm.json'), 'utf8'));
  const places = JSON.parse(await readFile(join(SRC, 'places.json'), 'utf8'));
  const groups = new Map();
  let read = 0, unplaced = 0;
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    const [, hw, refs, name, nameEn, , surface, flat] = JSON.parse(line);
    read++;
    const coords = [];
    for (let i = 0; i < flat.length; i += 2) coords.push([flat[i], flat[i + 1]]);
    const mid = coords[Math.floor(coords.length / 2)];
    // Off the generalised coastline, the province within about 20 km; beyond
    // that the way is outside mainland China - the extract runs over its
    // borders - and is not read.
    const st = locate(mid) ?? locate.near(mid, 0.2);
    if (!st) { unplaced++; continue; }
    const props = { state: st, type: typeOf(hw, surface), name: nameEn || name || null, nameZh: name || null };
    for (const ref of refs.split(';')) {
      const c = classify(ref);
      if (!c) continue;
      const key = c.system === 'cn-provincial' ? `${c.system}|${ref}|${st}` : `${c.system}|${ref}`;
      if (!groups.has(key)) {
        groups.set(key, {
          ...c, number: ref, base: Number(ref.replace(/^\D+/, '').replace(/\D.*$/, '')) || null,
          st: c.system === 'cn-provincial' ? st : null, parts: [], names: new Map(),
        });
      }
      const g = groups.get(key);
      g.parts.push({ coords, props });
      // A motorway's own name is the expressway's; a street's is only a street.
      for (const n of String(name ?? '').split(';').map((s) => s.trim()).filter(Boolean)) {
        if (hw !== 'motorway' || /高速|环/.test(n)) g.names.set(n, (g.names.get(n) || 0) + 1);
      }
    }
  }
  return { groups, read, unplaced, edition, info, places };
}
