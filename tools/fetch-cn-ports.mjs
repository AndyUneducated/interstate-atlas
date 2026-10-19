// Places the mainland's highway ports (content/reference/cn-ports.json) and
// writes content/reference/cn-crossings.json, for build-crossings.mjs.
//
//   node tools/fetch-cn-ports.mjs
//
// The National Office of Port Administration lists its ports by name and with
// no coordinates, and Tianditu's geocoder refuses requests from abroad, so
// every port is placed from OpenStreetMap, and says so (D-82). In order:
//
//   1. a feature tagged barrier=border_control named for the port, from
//      Overpass;
//   2. failing that, any feature Nominatim finds named for the port and for a
//      port facility (口岸, 通道, 联检, 边检, 国门, 海关).
//
// A candidate counts only within MAX_KM of the country the port faces, measured
// to Natural Earth's 1:10m outline of it, which keeps 黑河口岸 on the Amur from
// being taken for Hekou on the Red River. A name that is exactly the port's
// beats one that begins with it, which beats one that merely contains it; among
// equals the one nearest the line is taken. A port neither finds is left
// unplaced, with the reason.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { countryOutline, kmTo } from './border.mjs';

const ROOT = join(import.meta.dirname, '..');
const LIST = join(ROOT, 'content', 'reference', 'cn-ports.json');
const OUT = join(ROOT, 'content', 'reference', 'cn-crossings.json');
const MAX_KM = 60;
const UA = 'interstate-atlas/1.0';
const CACHE = join(ROOT, 'tools', 'src', 'cn', 'border-controls.json');
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const FACILITY = /口岸|通道|联检|聯檢|边检|边防检查|国门|海关|Port/;
// Named for the port but not where it checks traffic.
const NOT_FACILITY = /医院|酒店|宾馆|饭店|学校|小学|中学|社区|小区|公交|客运站|停车场|加油|市场|超市|银行|公园|广场|管委会|大厦|[路街村]$/;

const A3 = { ru: 'RUS', mn: 'MNG', kp: 'PRK', vn: 'VNM', la: 'LAO', mm: 'MMR', np: 'NPL', kz: 'KAZ', kg: 'KGZ', tj: 'TJK', pk: 'PAK', hk: 'HKG', mo: 'MAC' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** OpenStreetMap's border controls in China, kept in CACHE; --refresh fetches them again. */
async function overpass() {
  if (!process.argv.includes('--refresh')) {
    try { return JSON.parse(await readFile(CACHE, 'utf8')).elements; } catch { /* not fetched yet */ }
  }
  const q = `[out:json][timeout:180];
area["ISO3166-1"="CN"][admin_level=2]->.cn;
(nwr["barrier"="border_control"](area.cn); nwr["amenity"="border_control"](area.cn););
out center tags;`;
  for (const host of OVERPASS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(host, { method: 'POST', body: new URLSearchParams({ data: q }), headers: { 'user-agent': UA } });
      if (res.ok) {
        const body = await res.text();
        await mkdir(dirname(CACHE), { recursive: true });
        await writeFile(CACHE, body);
        return JSON.parse(body).elements;
      }
      console.log(`  overpass ${host} ${res.status}, retrying`);
      await sleep(20000);
    }
  }
  throw new Error('Overpass unavailable');
}

async function nominatim(q) {
  const u = `${NOMINATIM}?${new URLSearchParams({ q, format: 'jsonv2', countrycodes: 'cn', limit: '10', namedetails: '1', 'accept-language': 'zh' })}`;
  await sleep(1100);
  const res = await fetch(u, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return res.json();
}

const namesOf = (t) => [t.name, t['name:zh'], t['name:zh-Hans'], t['name:en'], t.official_name].filter(Boolean);

function keysOf(p) {
  return [p.strict ? null : p.name.replace(/\(.*\)$/, ''), p.full, ...(p.osm ?? [])].filter(Boolean);
}

/** 0 for a name that is the port's, 1 for one that begins with it, 2 for one that contains it. */
function rank(names, keys) {
  let best = Infinity;
  for (const n of names) {
    const bare = n.replace(/^(中华人民共和国|中国)/, '');
    for (const k of keys) {
      if (!n.includes(k)) continue;
      const r = [k, `${k}口岸`, `${k}公路口岸`, `${k}陆路口岸`].includes(bare) ? 0 : bare.startsWith(k) ? 1 : 2;
      if (r < best) best = r;
    }
  }
  return best;
}

function pick(cands, keys, outline, maxKm) {
  let best = null;
  for (const c of cands) {
    const r = rank(c.names, keys);
    if (!Number.isFinite(r)) continue;
    const km = kmTo(c.at, outline);
    if (!(km <= maxKm)) continue;
    if (!best || r < best.r || (r === best.r && km < best.km)) best = { ...c, r, km };
  }
  return best;
}

async function main() {
  const list = JSON.parse(await readFile(LIST, 'utf8'));
  const outlines = {};
  for (const [cc, a3] of Object.entries(A3)) outlines[cc] = await countryOutline([a3]);

  console.log('Overpass: border controls in China');
  const bc = (await overpass()).map((e) => ({
    osm: `${e.type}/${e.id}`,
    names: namesOf(e.tags ?? {}),
    kind: 'border_control',
    at: e.type === 'node' ? [e.lon, e.lat] : [e.center.lon, e.center.lat],
  }));
  console.log(`  ${bc.length} features`);

  const crossings = [];
  const byPrecision = {};
  for (const [i, p] of list.ports.entries()) {
    const id = `cn-${p.juris.toLowerCase()}-${String(i + 1).padStart(2, '0')}`;
    const base = {
      id, country: 'cn', border: `cn-${p.with}`, name: p.en, nameZh: p.name, juris: p.juris,
      ...(p.opp ? { counterpart: p.opp.en, counterpartZh: p.opp.zh } : {}),
    };
    if (p.skip) {
      crossings.push({ ...base, located: { by: 'none', reason: p.skip } });
      continue;
    }
    const keys = keysOf(p);
    const maxKm = p.maxKm ?? MAX_KM;
    let hit = pick(bc, keys, outlines[p.with], maxKm);
    if (!hit) {
      const found = [];
      for (const q of [...new Set([`${p.full ?? p.name}口岸`, `${p.name.replace(/\(.*\)$/, '')}口岸`])]) {
        for (const r of await nominatim(q)) {
          const names = [r.name, ...Object.values(r.namedetails ?? {})].filter(Boolean);
          if (!names.some((n) => FACILITY.test(n)) || names.some((n) => NOT_FACILITY.test(n))) continue;
          found.push({ osm: `${r.osm_type}/${r.osm_id}`, names, kind: `${r.category}=${r.type}`, at: [Number(r.lon), Number(r.lat)] });
        }
      }
      hit = pick(found, keys, outlines[p.with], maxKm);
    }
    if (!hit) {
      crossings.push({ ...base, located: { by: 'none', reason: `OpenStreetMap maps no port facility under this name within ${maxKm} km of the line` } });
      console.log(`  ${p.name}: not placed`);
      continue;
    }
    const precision = /^(\w+=)?border_control$/.test(hit.kind) ? 'border_control' : 'named';
    byPrecision[precision] = (byPrecision[precision] ?? 0) + 1;
    crossings.push({
      ...base,
      at: hit.at.map((v) => Number(v.toFixed(5))),
      located: { by: 'osm', precision, osm: hit.osm, match: hit.names[0], kind: hit.kind, borderKm: Number(hit.km.toFixed(1)), ...(p.far ? { far: p.far } : {}) },
    });
    console.log(`  ${p.name}: ${precision} ${hit.osm} ${hit.names[0]} (${hit.km.toFixed(1)} km)`);
  }

  const out = {
    retrieved: new Date().toISOString().slice(0, 10),
    purpose: 'The mainland\'s highway ports, placed from OpenStreetMap. Written by fetch-cn-ports.mjs; do not edit by hand.',
    source: {
      ...list.source,
      placed: {
        by: 'OpenStreetMap contributors',
        licence: 'Open Database Licence (ODbL)',
        url: 'https://www.openstreetmap.org/copyright',
        rule: `a barrier=border_control feature named for the port, else a feature Nominatim finds named for it and for a port facility; within ${MAX_KM} km of the neighbouring country (Natural Earth 1:10m)`,
      },
      byPrecision,
      unplaced: crossings.filter((c) => !c.at).map((c) => `${c.nameZh}: ${c.located.reason}`),
    },
    crossings,
  };
  await writeFile(OUT, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`cn ports: ${crossings.filter((c) => c.at).length} of ${crossings.length} placed ${JSON.stringify(byPrecision)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
