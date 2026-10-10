// Builds data/bridges.json, the bridge layer, from content/reference/bridges.json.
//
//   node tools/build-bridges.mjs
//
// Two inventories and nothing more: Mexico's federal free network, from SICT,
// and Ontario's provincial structures, from its Ministry of Transportation.
// Neither covers the tolled Mexican network, the rest of Canada or the United
// States, and the layer's sources say so.
//
// A structure is drawn where its owner placed it, with the year its owner
// records. That year is the structure's, not the road's: a new bridge on an old
// highway dates a replacement, so nothing here or downstream reads a road's
// age from it.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeOut } from './write.mjs';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'content', 'reference', 'bridges.json');
const OUT = join(ROOT, 'data', 'bridges.json');

const round = (v) => Number(v.toFixed(5));

// Positional rows, as index.json is: fifteen thousand copies of the same keys
// would be most of the file. Mexico names the road each structure is on, and
// the same few hundred names repeat thousands of times, so they are listed
// once and referred to by position.
const FIELDS = ['lon', 'lat', 'set', 'name', 'route', 'built', 'rebuilt', 'lengthM', 'kind', 'road', 'at'];

async function main() {
  const ref = JSON.parse(await readFile(SRC, 'utf8'));
  const rows = [];
  const sets = [];
  const roads = [];
  const roadIx = new Map();
  let unplaced = 0;

  for (const s of ref.sets) {
    const set = sets.length;
    const F = Object.fromEntries(s.fields.map((f, i) => [f, i]));
    sets.push({
      id: s.region ? s.region.toLowerCase() : s.country, country: s.country, region: s.region ?? null,
      name: s.name, source: s.source, url: s.url, licence: s.licence, edition: s.edition, covers: s.covers,
    });
    for (const r of s.rows) {
      const lat = r[F.lat], lon = r[F.lon];
      if (lat == null || lon == null) { unplaced++; continue; }
      const road = F.road != null ? r[F.road] : null;
      if (road && !roadIx.has(road)) { roadIx.set(road, roads.length); roads.push(road); }
      rows.push([
        round(lon), round(lat), set, r[F.name] ?? null, r[F.route] ?? null,
        r[F.built] ?? null, r[F.rebuilt] != null && r[F.rebuilt] !== r[F.built] ? r[F.rebuilt] : null,
        r[F.lengthM] ?? null, F.kind != null && r[F.kind] ? r[F.kind].toLowerCase() : null,
        road ? roadIx.get(road) : null, F.at != null ? r[F.at] ?? null : null,
      ]);
    }
  }

  await writeOut(OUT, `${JSON.stringify({
    generated: new Date().toISOString().slice(0, 10),
    retrieved: ref.retrieved,
    sets,
    missing: ref.missing,
    roads,
    fields: FIELDS,
    rows,
  })}\n`);
  console.log(`bridges: ${rows.length} structures from ${sets.length} inventories; ${unplaced} without coordinates left out`);
}

main().catch((e) => { console.error(e); process.exit(1); });
