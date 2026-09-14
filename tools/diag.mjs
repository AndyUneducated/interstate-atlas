import * as shapefile from 'shapefile';
import { join } from 'node:path';
import { haversineKm, lineLengthKm, stitchComponents, bboxOf } from './geo.mjs';

const SRC = join(import.meta.dirname, 'src');
// Interstate numbers that are reused by genuinely separate roads: there are two
// I-76s, two I-84s, two I-86s and two I-88s, plus the 35E/35W splits in both
// Minnesota and Texas. A bridge budget large enough to close I-90's 420 km hole
// must still leave every one of these as separate routes.
const TARGETS = new Set(['76', '84', '86', '88', '35E', '35W', '87', '74', '69', '90']);

const src = await shapefile.open(
  join(SRC, 'ne_10m_roads_north_america.shp'),
  join(SRC, 'ne_10m_roads_north_america.dbf'),
);

const groups = new Map();
while (true) {
  const r = await src.read();
  if (r.done) break;
  const p = r.value.properties;
  if (p.country !== 'United States' || p.class !== 'Interstate') continue;
  if (!TARGETS.has(String(p.number))) continue;
  const g = r.value.geometry;
  const parts = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
  if (!groups.has(p.number)) groups.set(p.number, []);
  for (const part of parts) if (part.length >= 2) groups.get(p.number).push({ coords: part, props: p });
}

for (const [num, parts] of groups) {
  console.log(`\n===== I-${num}: ${parts.length} fragments, ${Math.round(parts.reduce((s, p) => s + lineLengthKm(p.coords), 0) / 1.609)} mi total`);
  const states = [...new Set(parts.map((p) => p.props.state))];
  console.log('  states:', states.join(', '));

  const comps0 = stitchComponents(parts, 0.0025);
  console.log(`  proximity snap only: ${comps0.length} components -> `
    + comps0.slice(0, 8).map((c) => Math.round(c.km / 1.609) + 'mi').join(', '));

  for (const bridge of [30, 500]) {
    const comps = stitchComponents(parts, 0.0025, bridge).filter((c) => c.km >= 1.2);
    console.log(`  bridge<=${bridge}km: ${comps.length} route(s)`);
    for (const c of comps.slice(0, 4)) {
      const a = c.mainline[0], b = c.mainline[c.mainline.length - 1];
      console.log(`    ${String(Math.round(c.km / 1.609)).padStart(5)} mi  ${c.pieces.length} piece(s)  gaps: `
        + (c.gaps.length ? c.gaps.map((g) => g + 'km').join(', ') : 'none')
        + `  ends [${a.map((v) => v.toFixed(2))}] -> [${b.map((v) => v.toFixed(2))}]`);
    }
  }

  // Measure how far apart the component endpoints actually are at the default snap.
  const comps = stitchComponents(parts, 0.0015);
  const ends = [];
  comps.forEach((c, i) => {
    ends.push({ i, km: c.km, a: c.mainline[0], b: c.mainline[c.mainline.length - 1] });
  });
  if (ends.length > 1) {
    console.log('  nearest inter-component endpoint gaps:');
    for (let i = 0; i < Math.min(ends.length, 8); i++) {
      let best = null;
      for (let j = 0; j < ends.length; j++) {
        if (i === j) continue;
        for (const p of [ends[i].a, ends[i].b]) {
          for (const q of [ends[j].a, ends[j].b]) {
            const d = haversineKm(p, q);
            if (!best || d < best.d) best = { d, j, p, q };
          }
        }
      }
      console.log(`    comp${i} (${Math.round(ends[i].km / 1.609)}mi) closest to comp${best.j}: `
        + `${best.d.toFixed(2)} km  at [${best.p.map((v) => v.toFixed(3))}] <-> [${best.q.map((v) => v.toFixed(3))}]`);
    }
  }
  console.log('  bbox:', bboxOf(comps.map((c) => c.mainline)).map((v) => v.toFixed(2)).join(', '));
}
