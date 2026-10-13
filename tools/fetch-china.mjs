// Downloads mainland China's numbered roads from OpenStreetMap into tools/src/cn/.
//
// No authority publishes China's road geometry as open data that can be read
// from outside the country: the national 1:1,000,000 public edition is served
// only through Tianditu, which refuses requests from abroad (D-66). The atlas
// therefore reads OpenStreetMap, through Geofabrik's daily extract, and says
// so wherever a Chinese route is shown.
//
// Three passes over the extract, which is sorted nodes, then ways, then
// relations: the route relations first, for the number a way carries only
// through its relation; then the ways that carry a G or S number; then the
// coordinates of exactly the nodes those ways use, and the cities and towns
// that name a route's ends.
//
// Usage: node tools/fetch-china.mjs [--refresh]

import { createWriteStream } from 'node:fs';
import { mkdir, open, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { blobs, readBlob, walkBlock, kindsOf, headerTimestamp } from './pbf.mjs';
import { parseRef, ROAD_CLASSES } from './china.mjs';

const SRC = join(import.meta.dirname, 'src', 'cn');
const PBF = join(SRC, 'china-latest.osm.pbf');
const URL = 'https://download.geofabrik.de/asia/china-latest.osm.pbf';
const exists = (p) => stat(p).then(() => true, () => false);

async function download() {
  if (!process.argv.includes('--refresh') && await exists(PBF)) {
    console.log(`using ${PBF} (pass --refresh to download a new one)`);
    return;
  }
  await mkdir(SRC, { recursive: true });
  console.log(`fetching ${URL}`);
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${URL}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(`${PBF}.part`));
  const { rename } = await import('node:fs/promises');
  await rename(`${PBF}.part`, PBF);
}

/** A way's numbers: its own ref, then any its route relations give it. */
const refsOf = (raw) => [...new Set(String(raw ?? '').split(/[;,，；]/).map(parseRef).filter(Boolean))];

// A route's relation is often split by province (（四川段）, "(Sichuan
// section)") or, for an expressway, by direction (（北京方向）), and each
// piece carries the whole route's name with its own qualifier.
const SECTION = /\s*[（(][^（）()]*(段|方向|section|direction|towards)[^（）()]*[）)]\s*/gi;
const QUALIFIED = new RegExp(SECTION.source, 'i');
const unqualified = (s) => (s ? s.replace(SECTION, '').trim() || null : null);

/**
 * One description of a national route from all the relations that carry its
 * number: the relation that describes the whole route if there is one, with
 * whatever another relation says filling what it leaves out.
 */
function describe(list) {
  const score = (r) => (r.official ? 4 : 0) + (r.from && r.to ? 2 : 0)
    + (r.name && !QUALIFIED.test(r.name) ? 1 : 0);
  const ranked = [...list].sort((a, b) => score(b) - score(a) || b.members - a.members);
  const pick = (f) => ranked.map((r) => unqualified(r[f])).find(Boolean) ?? null;
  const best = ranked[0];
  const official = pick('official');
  return {
    name: pick('name'), nameEn: pick('nameEn'), official,
    // Ends only from a relation that gives both, so the pair is one route's.
    from: ranked.find((r) => r.from && r.to)?.from ?? null,
    to: ranked.find((r) => r.from && r.to)?.to ?? null,
    network: best.network, members: best.members, relation: best.relation, relations: list.length,
  };
}

async function main() {
  await download();
  const list = await blobs(PBF);
  const fh = await open(PBF, 'r');
  const t0 = Date.now();
  const lap = () => `${Math.round((Date.now() - t0) / 1000)} s`;

  // Which kind of block is where, so the later passes decompress only theirs.
  const header = list.find((b) => b.type === 'OSMHeader');
  const timestamp = header ? headerTimestamp(await readBlob(fh, header)) : null;
  const data = list.filter((b) => b.type === 'OSMData');

  // --- pass 1: route relations ---
  const relRefs = new Map();
  const routeInfo = {};
  const kindOf = new Map();
  for (const b of data) {
    const buf = await readBlob(fh, b);
    const kinds = kindsOf(buf);
    kindOf.set(b, kinds);
    if (!kinds.has('relation')) continue;
    walkBlock(buf, {
      relation(id, tags, members) {
        if (tags.type !== 'route' || tags.route !== 'road') return;
        const ref = parseRef(tags.ref);
        if (!ref) return;
        for (const m of members()) {
          if (m.type !== 1) continue;
          if (!relRefs.has(m.id)) relRefs.set(m.id, new Set());
          relRefs.get(m.id).add(ref);
        }
        // What the relation says about the route as a whole, for the national
        // numbers only: a provincial number recurs in every province.
        if (ref.startsWith('G')) {
          (routeInfo[ref] ??= []).push({
            name: tags['name:zh'] || tags.name || null,
            nameEn: tags['name:en'] || null,
            official: tags.official_name || null,
            from: tags.from || null,
            to: tags.to || null,
            network: tags.network || null,
            members: members().length,
            relation: id,
          });
        }
      },
    });
  }
  for (const [ref, list] of Object.entries(routeInfo)) routeInfo[ref] = describe(list);
  console.log(`pass 1: ${relRefs.size} ways numbered by a route relation, ${Object.keys(routeInfo).length} national routes described (${lap()})`);

  // --- pass 2: numbered ways ---
  const ways = [];
  const classes = {};
  for (const b of data) {
    if (!kindOf.get(b).has('way')) continue;
    walkBlock(await readBlob(fh, b), {
      way(id, tags, refs) {
        const hw = tags.highway;
        if (!ROAD_CLASSES.has(hw)) return;
        const mine = refsOf(tags.ref);
        for (const r of relRefs.get(id) ?? []) if (!mine.includes(r)) mine.push(r);
        if (!mine.length) return;
        classes[hw] = (classes[hw] || 0) + 1;
        ways.push({
          id, hw, refs: mine, nodes: refs(),
          name: tags['name:zh'] || tags.name || null,
          nameEn: tags['name:en'] || null,
          toll: tags.toll === 'yes' ? 1 : tags.toll === 'no' ? 0 : null,
          surface: tags.surface || null,
        });
      },
    });
  }
  console.log(`pass 2: ${ways.length} numbered ways ${JSON.stringify(classes)} (${lap()})`);

  // --- pass 3: their nodes, and the places ---
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
      const v = ids[mid];
      if (v === id) return mid;
      if (v < id) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
  };
  const places = [];
  const PLACE = new Set(['city', 'town']);
  for (const b of data) {
    if (!kindOf.get(b).has('node')) continue;
    walkBlock(await readBlob(fh, b), {
      nodes(nids, lons, lats, tagsAt) {
        // The block is sorted, so walk the wanted ids alongside it.
        let p = nids.length ? find(nids[0]) : -1;
        if (p < 0 && nids.length) {
          let lo = 0, hi = u;
          while (lo < hi) { const mid = (lo + hi) >> 1; if (ids[mid] < nids[0]) lo = mid + 1; else hi = mid; }
          p = lo;
        }
        for (let i = 0; i < nids.length; i++) {
          const id = nids[i];
          while (p < u && ids[p] < id) p++;
          if (p < u && ids[p] === id) { lon[p] = lons[i]; lat[p] = lats[i]; }
          const t = tagsAt(i);
          if (t && PLACE.has(t.place) && (t.name || t['name:zh'])) {
            places.push([
              Math.round(lons[i] * 1e5) / 1e5, Math.round(lats[i] * 1e5) / 1e5, t.place,
              t['name:zh'] || t.name, t['name:en'] || null, Number(t.population) || null,
            ]);
          }
        }
      },
    });
  }
  await fh.close();
  console.log(`pass 3: ${u} nodes looked up, ${places.length} cities and towns (${lap()})`);

  // --- write ---
  const out = createWriteStream(join(SRC, 'roads.ndjson'));
  let written = 0, missing = 0;
  for (const w of ways) {
    const coords = [];
    for (const id of w.nodes) {
      const i = find(id);
      if (i < 0 || Number.isNaN(lon[i])) { missing++; continue; }
      coords.push(Math.round(lon[i] * 1e6) / 1e6, Math.round(lat[i] * 1e6) / 1e6);
    }
    if (coords.length < 4) continue;
    const line = JSON.stringify([w.id, w.hw, w.refs.join(';'), w.name, w.nameEn, w.toll, w.surface, coords]);
    if (!out.write(`${line}\n`)) await new Promise((r) => out.once('drain', r));
    written++;
  }
  await new Promise((r) => out.end(r));
  await writeFile(join(SRC, 'places.json'), JSON.stringify(places));
  await writeFile(join(SRC, 'routes-osm.json'), JSON.stringify(routeInfo));
  const edition = {
    source: 'OpenStreetMap, Geofabrik extract for China',
    url: URL,
    licence: 'Open Database License 1.0',
    attribution: '© OpenStreetMap contributors',
    timestamp: timestamp ? new Date(timestamp * 1000).toISOString() : null,
    retrieved: new Date().toISOString().slice(0, 10),
    ways: written,
    nodesMissing: missing,
    places: places.length,
  };
  await writeFile(join(SRC, 'edition.json'), JSON.stringify(edition, null, 2));
  console.log(`wrote ${written} ways (${missing} node references outside the extract), edition ${edition.timestamp} (${lap()})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
