// Freeways TIGER records by name alone, turned into routes.
//
// TIGER has no route-number field: a road is a route only if its name says so.
// Most limited-access roads do - "I- 95", "State Rte 17" - but the Garden State
// Parkway, the Kentucky parkways, the Oklahoma turnpikes and the New York
// parkways carry a name and nothing else, and the atlas drew them only as
// context hairlines, so whole freeways were missing from the map.
//
// content/reference/us-named-freeways.json says which of those names are a
// signed route under another name (the Natcher Parkway is I-165) and which
// spellings are one road. Every other name becomes a route of its own,
// labelled by its name. A named piece is added only where no numbered route
// already runs alongside it, since TIGER often names one carriageway of an
// Interstate and numbers the other.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const NEAR_KM = 0.4;
const CELL = 0.01;
const KM_PER_DEG = 111.32;

const ABBREV = {
  pkwy: 'Parkway', tpke: 'Turnpike', expy: 'Expressway', fwy: 'Freeway', cswy: 'Causeway',
  hwy: 'Highway', dr: 'Drive', blvd: 'Boulevard', brg: 'Bridge', byp: 'Bypass', spr: 'Spur',
  con: 'Connector', trl: 'Trail', ave: 'Avenue', rd: 'Road', ln: 'Lane', mem: 'Memorial',
};
// Not before "Street": in "S Street Viaduct" the letter is the street's name.
const LEAD_DIR = /^(?:n|s|e|w|ne|nw|se|sw)\s+(?!st\b|street\b)/i;
const TRAIL_DIR = /\s+(?:n|s|e|w|ne|nw|se|sw|nb|sb|eb|wb)$/i;

const deaccent = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const keyOf = (name) => deaccent(name).replace(LEAD_DIR, '').replace(TRAIL_DIR, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const labelOf = (name) => name.replace(LEAD_DIR, '').replace(TRAIL_DIR, '')
  .split(/\s+/).map((w) => ABBREV[w.toLowerCase()] ?? w).join(' ');

/**
 * A grid of the numbered network's segments, for "is anything already here",
 * kept to the cells round the named pieces: the whole country's would not fit.
 */
function segmentGrid(groups, named) {
  const wanted = new Set();
  for (const { coords } of named) {
    for (const [x, y] of coords) {
      const cx = Math.floor(x / CELL);
      const cy = Math.floor(y / CELL);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) wanted.add(`${cx + dx},${cy + dy}`);
    }
  }
  const grid = new Map();
  const add = (cx, cy, seg) => {
    const k = `${cx},${cy}`;
    if (!wanted.has(k)) return;
    let a = grid.get(k);
    if (!a) grid.set(k, (a = []));
    a.push(seg);
  };
  for (const g of groups.values()) {
    for (const { coords } of g.parts) {
      for (let i = 1; i < coords.length; i++) {
        const a = coords[i - 1];
        const b = coords[i];
        const seg = [a[0], a[1], b[0], b[1]];
        const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / CELL));
        const seen = new Set();
        for (let k = 0; k <= n; k++) {
          const cx = Math.floor((a[0] + ((b[0] - a[0]) * k) / n) / CELL);
          const cy = Math.floor((a[1] + ((b[1] - a[1]) * k) / n) / CELL);
          if (seen.has(`${cx},${cy}`)) continue;
          seen.add(`${cx},${cy}`);
          add(cx, cy, seg);
        }
      }
    }
  }
  return grid;
}

function nearNetwork(grid, [x, y]) {
  const cos = Math.cos((y * Math.PI) / 180);
  const cx = Math.floor(x / CELL);
  const cy = Math.floor(y / CELL);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (const [ax, ay, bx, by] of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
        const vx = (bx - ax) * cos;
        const vy = by - ay;
        const px = (x - ax) * cos;
        const py = y - ay;
        const len = vx * vx + vy * vy;
        const t = len ? Math.max(0, Math.min(1, (px * vx + py * vy) / len)) : 0;
        if (Math.hypot(px - t * vx, py - t * vy) * KM_PER_DEG < NEAR_KM) return true;
      }
    }
  }
  return false;
}

function covered(grid, coords) {
  const step = Math.max(1, Math.floor(coords.length / 8));
  let near = 0;
  let n = 0;
  for (let i = 0; i < coords.length; i += step) {
    n++;
    if (nearNetwork(grid, coords[i])) near++;
  }
  return near / n > 0.5;
}

/**
 * Add the named primary roads to `groups`, keyed the way tiger.mjs keys its
 * own, so the stitching loop treats them like any other route.
 */
export async function addNamedFreeways(root, groups, named) {
  const ref = JSON.parse(await readFile(join(root, 'content', 'reference', 'us-named-freeways.json'), 'utf8'));
  const alias = new Map();
  for (const r of ref.routes) {
    const m = /^(I|PR)[- ](\w+)$/.exec(r.route);
    const target = m[1] === 'I'
      ? { system: 'us-interstate', number: m[2], key: `us-interstate|${m[2]}|` }
      : { system: 'us-state', number: m[2], key: `us-state|${m[2]}|${r.st}|` };
    for (const n of r.names) alias.set(`${r.st}|${keyOf(n)}`, target);
  }
  const relabel = new Map();
  for (const r of ref.names) for (const n of r.names) relabel.set(`${r.st}|${keyOf(n)}`, r.label);

  const grid = segmentGrid(groups, named);
  let added = 0;
  let skipped = 0;
  const byRoute = new Map();
  for (const piece of named) {
    if (covered(grid, piece.coords)) { skipped++; continue; }
    const k = `${piece.st}|${keyOf(piece.name)}`;
    const props = { type: 'Primary', state: piece.st, divided: null, mtfcc: 'S1100', name: piece.name };
    const target = alias.get(k);
    let grp;
    if (target) {
      grp = groups.get(target.key);
      if (!grp) {
        grp = { system: target.system, number: target.number, qualifier: null,
          st: target.system === 'us-state' ? piece.st : null, parts: [], names: new Set() };
        groups.set(target.key, grp);
      }
    } else {
      const label = relabel.get(k) ?? labelOf(piece.name);
      const slug = keyOf(label).replace(/ /g, '-');
      const key = `us-state|${slug}|${piece.st}|named`;
      grp = groups.get(key);
      if (!grp) {
        grp = { system: 'us-state', number: slug, qualifier: null, st: piece.st,
          parts: [], names: new Set(), label, nameOnly: true };
        groups.set(key, grp);
      }
    }
    grp.names.add(piece.name);
    grp.parts.push({ coords: piece.coords, props });
    byRoute.set(grp, (byRoute.get(grp) ?? 0) + 1);
    added++;
  }
  const nameOnly = [...byRoute.keys()].filter((g) => g.nameOnly).length;
  console.log(`  named primary roads: ${added} pieces added (${nameOnly} freeways known by name, `
    + `${byRoute.size - nameOnly} filed under their signed number); ${skipped} already covered by a numbered route`);
}
