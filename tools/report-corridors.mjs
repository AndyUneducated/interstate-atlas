// Lists every Interstate and US route number that still resolves to more than
// one piece after the automatic 60 km bridging, with the gap that separates
// them. Some of these holes are missing data that should be closed (I-90 loses
// the Indiana Toll Road); others are genuinely different roads that share a
// number (there are two I-76s). No threshold can tell those apart, so the
// decision is recorded by hand in content/corridors.json and this report is
// what that decision is based on.

import * as shapefile from 'shapefile';
import { join } from 'node:path';
import { haversineKm, stitchRoute, bboxOf } from './geo.mjs';

const SRC = join(import.meta.dirname, 'src');
const src = await shapefile.open(
  join(SRC, 'ne_10m_roads_north_america.shp'),
  join(SRC, 'ne_10m_roads_north_america.dbf'),
);

const groups = new Map();
while (true) {
  const r = await src.read();
  if (r.done) break;
  const p = r.value.properties;
  if (p.country !== 'United States') continue;
  if (p.class !== 'Interstate' && p.class !== 'Federal') continue;
  if (p.number == null) continue;
  const num = String(p.number).toUpperCase();
  if (!/^\d+[A-Z]?$/.test(num)) continue; // skip business/alt/bypass variants
  const key = `${p.class === 'Interstate' ? 'I' : 'US'}-${num}`;
  const g = r.value.geometry;
  const parts = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
  if (!groups.has(key)) groups.set(key, []);
  for (const part of parts) if (part.length >= 2) groups.get(key).push({ coords: part, props: p });
}

const rows = [];
for (const [key, parts] of groups) {
  const comps = stitchRoute(parts, { bridgeKm: 60 });
  if (comps.length < 2) continue;
  const withMeta = comps.map((c) => {
    const bbox = bboxOf([c.mainline, ...c.branches]);
    const states = [...new Set(c.edges.map((e) => e.props.state))];
    return { mi: Math.round(c.km / 1.609344), bbox, states, c };
  });
  // Smallest gap from each piece to any other piece.
  let minGap = Infinity;
  for (let i = 0; i < comps.length; i++) {
    for (let j = i + 1; j < comps.length; j++) {
      for (const p of [comps[i].mainline[0], comps[i].mainline.at(-1)]) {
        for (const q of [comps[j].mainline[0], comps[j].mainline.at(-1)]) {
          minGap = Math.min(minGap, haversineKm(p, q));
        }
      }
    }
  }
  rows.push({ key, n: comps.length, minGap, withMeta, totalMi: withMeta.reduce((s, w) => s + w.mi, 0) });
}

rows.sort((a, b) => a.minGap - b.minGap);
console.log(`${rows.length} numbers resolve to more than one piece at bridge<=60km\n`);
console.log('closest gap | number | pieces | total mi | piece mileages and states');
for (const r of rows) {
  const desc = r.withMeta
    .sort((a, b) => b.mi - a.mi)
    .map((w) => `${w.mi}mi[${w.states.map((s) => s.slice(0, 4)).join(',')}]`)
    .join(' + ');
  console.log(`${String(Math.round(r.minGap)).padStart(6)} km | ${r.key.padEnd(7)} | ${String(r.n).padStart(2)} | `
    + `${String(r.totalMi).padStart(5)} | ${desc.slice(0, 150)}`);
}
