// How far a point is from the United States, for placing land border
// crossings.
//
// Measured to the edge of the nearest US state in Natural Earth's 1:10m
// admin-1 file, which the Mexican pipeline already uses for state location.
// At that scale the line is good to about a kilometre, which is fine for what
// it is asked: whether a point said to be a border crossing is anywhere near
// the border at all.

import * as shapefile from 'shapefile';
import { join } from 'node:path';

const NE = join(import.meta.dirname, 'src', 'ne', 'ne_10m_admin_1_states_provinces');

const R = Math.PI / 180;

/** Segments of every US state outline except Hawaii, which borders nothing. */
export async function usOutline() {
  const src = await shapefile.open(`${NE}.shp`, `${NE}.dbf`);
  const segs = [];
  while (true) {
    const r = await src.read();
    if (r.done) break;
    const p = r.value.properties;
    if (p.adm0_a3 !== 'USA' || p.postal === 'HI') continue;
    const g = r.value.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const poly of polys) for (const ring of poly) {
      for (let i = 1; i < ring.length; i++) segs.push([ring[i - 1], ring[i]]);
    }
  }
  return segs;
}

/** Kilometres from a point to the nearest of a set of segments, on a local flat projection. */
export function kmTo(pt, segs) {
  const kx = 111.32 * Math.cos(pt[1] * R);
  const ky = 110.57;
  let best = Infinity;
  for (const [a, b] of segs) {
    // A cheap reject first: nothing over a degree away can be the nearest of interest.
    if (Math.abs(a[1] - pt[1]) > 1.5 && Math.abs(b[1] - pt[1]) > 1.5) continue;
    if (Math.abs(a[0] - pt[0]) > 2.5 && Math.abs(b[0] - pt[0]) > 2.5) continue;
    const ax = (a[0] - pt[0]) * kx, ay = (a[1] - pt[1]) * ky;
    const bx = (b[0] - pt[0]) * kx, by = (b[1] - pt[1]) * ky;
    const dx = bx - ax, dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best) best = d;
  }
  return best;
}
