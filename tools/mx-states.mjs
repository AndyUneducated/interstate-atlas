// Which Mexican state a point lies in.
//
// The Red Nacional de Caminos cannot answer this for its own federal network.
// JURISDI records who holds legal authority over a segment, and for every
// federal segment that is the federation - "Fed." - so a highway crossing
// eight states arrives with no statement of where it is. The state tier is
// fine, because a state road's authority and its location are the same state.
// The federal tier is the one that needs this.
//
// The boundaries are Natural Earth's 1:10,000,000 admin-1 layer, which is
// public domain and small, and which carries ISO 3166-2 codes that match the
// ones mexico.mjs already uses. Its lines are generalised to about a
// kilometre, so a segment within a kilometre of a state line can be credited
// to the neighbour. That affects how a federal route's length is divided
// between states and nothing else: the route, its number and its length are
// all INEGI's, and the division is labelled as located rather than recorded.
//
// INEGI's own Marco Geoestadístico would be the authoritative choice and is
// over a gigabyte; for dividing mileage between states it would move numbers
// in the second decimal place.

import { mkdir, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import * as shapefile from 'shapefile';
import { listEntries, extractEntry } from './unzip.mjs';

const SRC = join(import.meta.dirname, 'src', 'ne');
const NAME = 'ne_10m_admin_1_states_provinces';
const URL = `https://naciscdn.org/naturalearth/10m/cultural/${NAME}.zip`;

export const BOUNDARY_SOURCE = {
  name: 'Natural Earth, Admin 1 – States, Provinces, 1:10m',
  url: 'https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/',
  licence: 'Public domain',
  use: 'Locating federal highway segments within states, because the road file '
    + 'records the federation as their jurisdiction rather than the state they are in.',
};

const exists = (p) => stat(p).then(() => true, () => false);

async function ensure() {
  const shp = join(SRC, `${NAME}.shp`);
  if (await exists(shp)) return join(SRC, NAME);
  await mkdir(SRC, { recursive: true });
  const zip = join(SRC, `${NAME}.zip`);
  if (!await exists(zip)) {
    console.log(`  fetching ${URL}`);
    const res = await fetch(URL);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${URL}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(zip));
  }
  for (const e of await listEntries(zip)) {
    const m = /\.(shp|shx|dbf|prj|cpg)$/i.exec(e.name);
    if (m && e.name.includes(NAME)) await extractEntry(zip, e, join(SRC, `${NAME}.${m[1].toLowerCase()}`));
  }
  return join(SRC, NAME);
}

const inRing = (ring, x, y) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

// Outer ring in, holes out.
const inPolygon = (rings, x, y) => inRing(rings[0], x, y) && !rings.slice(1).some((h) => inRing(h, x, y));

/**
 * Load Mexico's states and return a locator.
 *
 * The locator answers with the ISO suffix - AGU, CHH - or null for a point in
 * no state, which along the coast and the northern border is the right answer
 * rather than a failure: the generalised coastline sits inland of some coastal
 * road, and those segments stay unlocated rather than being pushed into the
 * nearest state.
 */
export async function loadStateLocator() {
  const base = await ensure();
  const src = await shapefile.open(`${base}.shp`, `${base}.dbf`, { encoding: 'utf-8' });
  const states = [];
  for (;;) {
    const r = await src.read();
    if (r.done) break;
    const p = r.value.properties;
    // The attribute table pads its fixed-width strings with NULs rather than
    // spaces, so "MX-SON" arrives as "MX-SON\0\0" and matches nothing.
    const field = (v) => String(v ?? '').replace(/\0/g, '').trim();
    if (field(p.iso_a2) !== 'MX') continue;
    // Mexico City is still filed under DIF, the Distrito Federal it was until
    // 2016; ISO and the rest of the atlas call it CMX.
    const iso = field(p.iso_3166_2).replace(/^MX-/, '');
    const code = iso === 'DIF' ? 'CMX' : iso;
    if (!/^[A-Z]{3}$/.test(code)) continue;
    const g = r.value.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const rings of polys) {
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [x, y] of rings[0]) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      states.push({ code, rings, box: [x0, y0, x1, y1] });
    }
  }
  const codes = new Set(states.map((s) => s.code));
  if (codes.size !== 32) throw new Error(`expected 32 Mexican states in the boundary file, found ${codes.size}`);

  // A coarse grid over the bounding boxes, so a lookup tests a handful of
  // polygons rather than all of them.
  const grid = new Map();
  for (const s of states) {
    for (let gx = Math.floor(s.box[0]); gx <= Math.floor(s.box[2]); gx++) {
      for (let gy = Math.floor(s.box[1]); gy <= Math.floor(s.box[3]); gy++) {
        const k = `${gx},${gy}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(s);
      }
    }
  }

  return ([x, y]) => {
    for (const s of grid.get(`${Math.floor(x)},${Math.floor(y)}`) ?? []) {
      if (x < s.box[0] || x > s.box[2] || y < s.box[1] || y > s.box[3]) continue;
      if (inPolygon(s.rings, x, y)) return s.code;
    }
    return null;
  };
}
