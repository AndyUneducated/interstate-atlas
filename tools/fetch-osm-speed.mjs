// Reads posted speed limits off OpenStreetMap for the countries whose own
// sources carry none: mainland China and Hong Kong (from the China extract
// fetch-china.mjs already keeps), Taiwan and Mexico (Geofabrik extracts in
// tools/src/osm/).
//
// Only ways that carry both a number the atlas knows and a numeric maxspeed
// are kept, so the output is a sample of each route, not the route: how much
// of each road it covers is measured when build-speed.mjs matches the ways to
// the atlas's own geometry, and printed beside every figure drawn from it.
//
// A way's number is its own ref or one a road route relation gives it, as in
// fetch-china.mjs. Implicit limits ("CN:motorway", "TW:urban") are not read:
// they restate the law, which build-speed.mjs applies itself and labels as such.
//
// The same ways say what else is mapped on them - lane count, toll, bridge or
// tunnel - so a numbered way carrying any of those is kept too, for the
// route figures East Asia's own sources do not publish.
//
// Usage: node tools/fetch-osm-speed.mjs [cn] [tw] [mx]
//   writes tools/src/osm/<cc>-speed.ndjson:
//   [highway, ref;ref, kph, lanes, toll, structure, oneway, lon,lat,...]
//   kph and lanes null where untagged; toll 1, 0 or null; structure 'b'
//   (bridge), 't' (tunnel) or null; oneway 1 for one carriageway of a pair.

import { createWriteStream } from 'node:fs';
import { mkdir, open, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { blobs, readBlob, walkBlock, kindsOf, headerTimestamp } from './pbf.mjs';
import { parseRef } from './china.mjs';

const OSM = join(import.meta.dirname, 'src', 'osm');
const ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified']);

const HK_BOX = [113.82, 22.15, 114.45, 22.57];
const TW_SUFFIX = '甲乙丙丁戊己庚辛壬癸';

/**
 * Each country's numbers, normalised to the key build-speed.mjs gives the
 * atlas's routes: G30 and S301 in China, HK3 in Hong Kong, F1 and P9甲 in
 * Taiwan (freeway and provincial), MEX-015 and SON-003 in Mexico.
 */
const COUNTRIES = {
  cn: {
    pbf: join(import.meta.dirname, 'src', 'cn', 'china-latest.osm.pbf'),
    refs(raw) {
      const out = [];
      for (const tok of String(raw).split(/[;,，；]/)) {
        const r = parseRef(tok);
        if (r) out.push(r);
        // Hong Kong's strategic routes are bare numbers inside the same extract.
        else if (/^\s*([1-9]|10)\s*$/.test(tok)) out.push(`HK${tok.trim()}`);
      }
      return out;
    },
    keep: (ref, lon, lat) => !ref.startsWith('HK')
      || (lon >= HK_BOX[0] && lon <= HK_BOX[2] && lat >= HK_BOX[1] && lat <= HK_BOX[3]),
  },
  tw: {
    pbf: join(OSM, 'taiwan-latest.osm.pbf'),
    refs(raw, hw) {
      const out = [];
      for (const tok of String(raw).split(/[;,，；]/)) {
        const s = tok.replace(/\s+/g, '');
        const m = /^(國道?|台|臺)?(\d{1,2})(號|線)?([甲乙丙丁戊己庚辛壬癸])?(線)?$/.exec(s);
        if (!m) continue;
        const freeway = m[1]?.startsWith('國') || (!m[1] && hw === 'motorway');
        if (freeway && m[4]) continue;
        out.push(`${freeway ? 'F' : 'P'}${Number(m[2])}${m[4] && TW_SUFFIX.includes(m[4]) ? m[4] : ''}`);
      }
      return out;
    },
    keep: () => true,
  },
  mx: {
    pbf: join(OSM, 'mexico-latest.osm.pbf'),
    refs(raw) {
      const out = [];
      for (const tok of String(raw).split(/[;,]/)) {
        const s = tok.trim().toUpperCase();
        let m = /^(?:MEX|FED(?:ERAL)?|CARRETERA FEDERAL)[\s.-]*(\d{1,3})([A-Z])?$/.exec(s);
        if (m) { out.push(`MEX-${m[1].padStart(3, '0')}${m[2] ?? ''}`); continue; }
        m = /^([A-Z]{2,4})[\s.-]+(\d{1,3})([A-Z])?$/.exec(s);
        if (m && m[1] !== 'MEX') out.push(`${m[1]}-${m[2].padStart(3, '0')}${m[3] ?? ''}`);
      }
      return out;
    },
    keep: () => true,
  },
};

/** A maxspeed value in km/h, or null for anything that is not a plain number. */
export function kphOf(raw) {
  if (raw == null) return null;
  const s = String(raw).split(';')[0].trim().toLowerCase();
  const m = /^(\d{1,3})(?:\s*(mph|km\/h|kmh|kph))?$/.exec(s);
  if (!m) return null;
  const v = Number(m[1]) * (m[2] === 'mph' ? 1.609344 : 1);
  return v >= 5 && v <= 140 ? Math.round(v) : null;
}

/** A plain lane count, 1 to 12; "2;3" and the like are not read. */
function lanesOf(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
}

function speedOf(tags) {
  const both = kphOf(tags.maxspeed);
  if (both) return both;
  const f = kphOf(tags['maxspeed:forward']);
  const b = kphOf(tags['maxspeed:backward']);
  if (f && b) return Math.round((f + b) / 2);
  return f || b || null;
}

async function run(cc) {
  const cfg = COUNTRIES[cc];
  if (!await stat(cfg.pbf).then(() => true, () => false)) {
    console.log(`${cc}: ${cfg.pbf} not found, skipped`);
    return;
  }
  const t0 = Date.now();
  const lap = () => `${Math.round((Date.now() - t0) / 1000)} s`;
  const list = await blobs(cfg.pbf);
  const fh = await open(cfg.pbf, 'r');
  const header = list.find((b) => b.type === 'OSMHeader');
  const timestamp = header ? headerTimestamp(await readBlob(fh, header)) : null;
  const data = list.filter((b) => b.type === 'OSMData');

  const relRefs = new Map();
  const kindOf = new Map();
  for (const b of data) {
    const buf = await readBlob(fh, b);
    const kinds = kindsOf(buf);
    kindOf.set(b, kinds);
    if (!kinds.has('relation')) continue;
    walkBlock(buf, {
      relation(id, tags, members) {
        if (tags.type !== 'route' || tags.route !== 'road' || !tags.ref) return;
        for (const m of members()) {
          if (m.type !== 1) continue;
          if (!relRefs.has(m.id)) relRefs.set(m.id, []);
          relRefs.get(m.id).push(tags.ref);
        }
      },
    });
  }
  console.log(`${cc} pass 1: ${relRefs.size} ways numbered by a relation (${lap()})`);

  const ways = [];
  for (const b of data) {
    if (!kindOf.get(b).has('way')) continue;
    walkBlock(await readBlob(fh, b), {
      way(id, tags, refs) {
        if (!ROADS.has(tags.highway)) return;
        const kph = speedOf(tags);
        const lanes = lanesOf(tags.lanes);
        const toll = tags.toll === 'yes' ? 1 : tags.toll === 'no' ? 0 : null;
        const structure = tags.tunnel && !['no', 'culvert'].includes(tags.tunnel) ? 't'
          : tags.bridge && tags.bridge !== 'no' ? 'b' : null;
        if (!kph && !lanes && toll == null && !structure) return;
        const raw = [tags.ref, ...(relRefs.get(id) ?? [])].filter(Boolean).join(';');
        if (!raw) return;
        const mine = [...new Set(cfg.refs(raw, tags.highway))];
        if (!mine.length) return;
        const oneway = tags.oneway === 'yes' || tags.oneway === '1'
          || (tags.highway === 'motorway' && tags.oneway !== 'no') ? 1 : 0;
        ways.push({ hw: tags.highway, refs: mine, kph, lanes, toll, structure, oneway, nodes: refs() });
      },
    });
  }
  console.log(`${cc} pass 2: ${ways.length} numbered ways with a limit, lanes, toll or structure (${lap()})`);

  let n = 0;
  for (const w of ways) n += w.nodes.length;
  const need = new Float64Array(n);
  n = 0;
  for (const w of ways) for (const id of w.nodes) need[n++] = id;
  need.sort();
  let u = 0;
  for (let i = 0; i < need.length; i++) if (i === 0 || need[i] !== need[i - 1]) need[u++] = need[i];
  const ids = need.subarray(0, u);
  const lon = new Float64Array(u).fill(NaN);
  const lat = new Float64Array(u).fill(NaN);
  const find = (id) => {
    let lo = 0, hi = u - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ids[mid] === id) return mid;
      if (ids[mid] < id) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
  };
  for (const b of data) {
    if (!kindOf.get(b).has('node')) continue;
    walkBlock(await readBlob(fh, b), {
      nodes(nids, lons, lats) {
        if (!nids.length) return;
        let lo = 0, hi = u;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (ids[mid] < nids[0]) lo = mid + 1; else hi = mid; }
        let p = lo;
        for (let i = 0; i < nids.length; i++) {
          while (p < u && ids[p] < nids[i]) p++;
          if (p < u && ids[p] === nids[i]) { lon[p] = lons[i]; lat[p] = lats[i]; }
        }
      },
    });
  }
  await fh.close();
  console.log(`${cc} pass 3: ${u} nodes looked up (${lap()})`);

  await mkdir(OSM, { recursive: true });
  const out = createWriteStream(join(OSM, `${cc}-speed.ndjson`));
  let written = 0;
  for (const w of ways) {
    const coords = [];
    for (const id of w.nodes) {
      const i = find(id);
      if (i < 0 || Number.isNaN(lon[i])) continue;
      coords.push(Math.round(lon[i] * 1e5) / 1e5, Math.round(lat[i] * 1e5) / 1e5);
    }
    if (coords.length < 4) continue;
    const refs = w.refs.filter((r) => cfg.keep(r, coords[0], coords[1]));
    if (!refs.length) continue;
    const line = JSON.stringify([w.hw, refs.join(';'), w.kph, w.lanes, w.toll, w.structure, w.oneway, ...coords]);
    if (!out.write(`${line}\n`)) await new Promise((r) => out.once('drain', r));
    written++;
  }
  await new Promise((r) => out.end(r));
  await writeFile(join(OSM, `${cc}-speed.json`), JSON.stringify({
    source: `OpenStreetMap, Geofabrik extract (${cc})`,
    licence: 'Open Database License 1.0',
    attribution: '© OpenStreetMap contributors',
    timestamp: timestamp ? new Date(timestamp * 1000).toISOString() : null,
    fields: ['highway', 'refs', 'kph', 'lanes', 'toll', 'structure', 'oneway', '...coords'],
    ways: written,
  }, null, 2));
  console.log(`${cc}: wrote ${written} ways (${lap()})`);
}

const wanted = process.argv.slice(2).filter((a) => COUNTRIES[a]);
for (const cc of wanted.length ? wanted : Object.keys(COUNTRIES)) await run(cc);
