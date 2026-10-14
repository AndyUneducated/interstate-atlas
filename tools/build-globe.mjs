// The dotted globe on the region switch: a point on an even grid over the
// sphere wherever Natural Earth has land, written as a small module the page
// imports. The page projects and spins it itself; this only decides where land is.
//
// Committed, like the base-map previews: it is part of the interface, and the
// shapefile it comes from is not in the repository.
//
// Usage: node tools/build-globe.mjs

import * as shapefile from 'shapefile';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const NE = join(import.meta.dirname, 'src', 'ne', 'ne_10m_admin_1_states_provinces');
const OUT = join(import.meta.dirname, '..', 'assets', 'globe-dots.js');
const STEP = 2.6;

// The atlas's own countries, so the globe can light the region it is turned to.
const REGION_OF = { USA: 1, CAN: 1, MEX: 1, CHN: 2, TWN: 2, HKG: 2 };

const features = [];
const src = await shapefile.open(`${NE}.shp`, `${NE}.dbf`, { encoding: 'utf-8' });
for (;;) {
  const { done, value } = await src.read();
  if (done) break;
  const g = value.geometry;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const rings = polys.flat();
  let x0 = 180, x1 = -180, y0 = 90, y1 = -90;
  for (const ring of rings) for (const [x, y] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  features.push({ rings, x0, x1, y0, y1, region: REGION_OF[value.properties.adm0_a3] || 0 });
}

// Even-odd over a province's rings, so a lake inside it reads as water.
// The region of the province the point is in, 0 outside the atlas, or null at sea.
function land(x, y) {
  for (const f of features) {
    if (x < f.x0 || x > f.x1 || y < f.y0 || y > f.y1) continue;
    let inside = false;
    for (const p of f.rings) {
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const [xi, yi] = p[i];
        const [xj, yj] = p[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    if (inside) return f.region;
  }
  return null;
}

// Rows of equal latitude, with fewer points toward the poles, so the dots are
// as far apart at 60°N as at the equator.
const dots = [];
for (let lat = -58; lat <= 82; lat += STEP) {
  const step = STEP / Math.cos((lat * Math.PI) / 180);
  for (let lon = -180 + step / 2; lon < 180; lon += step) {
    const region = land(lon, lat);
    if (region != null) dots.push(Math.round(lon * 10), Math.round(lat * 10), region);
  }
}

await writeFile(OUT, `// Written by tools/build-globe.mjs from Natural Earth (public domain).\n// Triples: longitude and latitude in tenths of a degree, then 1 for North America, 2 for East Asia, 0 elsewhere.\nexport const LAND = [${dots.join(',')}];\n`);
console.log(`${dots.length / 3} land dots → assets/globe-dots.js`);
