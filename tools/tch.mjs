// Which stretch of a provincial highway carries the Trans-Canada.
//
// The routes come from a hand-kept list (content/reference/tch-routes.json),
// because Canada publishes no register of the system and the road file names
// it unevenly: Ontario and the Prairies name every segment, British Columbia
// never names the Yellowhead, and Quebec's file carries no names at all. The
// list says, per route, whether the NRN's names fix the extent, whether the
// whole route carries it, or which two points bound it.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Off the mainline by more than this, a part is judged on its own. */
const NEAR_KM = 2;
/** Gaps between named stretches, and to the route's ends, closed below this.
 *  Through a city the segments carry street names instead (Regina, Saskatoon,
 *  Sault Ste. Marie run 11 to 19 km); the real breaks are a hundred or more. */
const CLOSE_KM = 25;

export async function loadTchList(root) {
  const doc = JSON.parse(await readFile(join(root, 'content', 'reference', 'tch-routes.json'), 'utf8'));
  return new Map(doc.routes.map((r) => [`${r.pr}|${r.number}`, r]));
}

const toXY = (lat0) => {
  const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180);
  return ([x, y]) => [x * kx, y * 110.57];
};

/** The mainline as one polyline with distance along it, in km. */
function polyline(pieces) {
  const pts = pieces.flat();
  const lat0 = pts.reduce((s, p) => s + p[1], 0) / Math.max(pts.length, 1);
  const xy = toXY(lat0);
  const P = pts.map(xy);
  const S = [0];
  for (let i = 1; i < P.length; i++) S.push(S[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  return { pts, P, S, xy, length: S[S.length - 1] ?? 0 };
}

/** Distance along the polyline of the point nearest `pt`, and how far off it lies. */
function project(line, pt) {
  const [x, y] = line.xy(pt);
  let best = { s: 0, d: Infinity };
  const { P, S } = line;
  for (let i = 1; i < P.length; i++) {
    const [ax, ay] = P[i - 1], [bx, by] = P[i];
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0;
    const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
    if (d < best.d) best = { s: S[i - 1] + t * (S[i] - S[i - 1]), d };
  }
  return best;
}

/** Where the mainline comes closest to another route's geometry. */
function junction(line, other) {
  let best = { i: 0, d: Infinity };
  const O = other.parts.flatMap((p) => p.coords).map(line.xy);
  for (let i = 0; i < line.P.length; i++) {
    const [x, y] = line.P[i];
    for (const [ox, oy] of O) {
      const d = (x - ox) ** 2 + (y - oy) ** 2;
      if (d < best.d) best = { i, d };
    }
  }
  return { s: line.S[best.i], d: Math.sqrt(best.d) };
}

const mid = (coords) => coords[Math.floor(coords.length / 2)];

function merge(intervals, length) {
  const out = [];
  for (const [a, b] of intervals.sort((u, v) => u[0] - v[0])) {
    const last = out[out.length - 1];
    if (last && a - last[1] < CLOSE_KM) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  if (out.length) {
    if (out[0][0] < CLOSE_KM) out[0][0] = 0;
    if (length - out[out.length - 1][1] < CLOSE_KM) out[out.length - 1][1] = length;
  }
  return out;
}

/**
 * One flag per part of `grp`: does it carry the Trans-Canada?
 *
 * `pieces` is the route's mainline, in order, from a first stitch of the whole
 * group. A part is judged by where its midpoint falls along that line; a part
 * well off it (a branch, or a namesake elsewhere in the province) is judged by
 * its own name under "named" and is not Trans-Canada otherwise.
 */
export function tchFlags(grp, entry, pieces, groups) {
  if (entry.extent === 'whole') return { flags: grp.parts.map(() => true), intervals: null };
  const line = polyline(pieces);
  const far = [];

  let intervals;
  if (entry.extent === 'named') {
    const named = [];
    for (const p of grp.parts) {
      if (!p.props.tch) continue;
      const a = project(line, p.coords[0]), b = project(line, p.coords[p.coords.length - 1]);
      if (a.d < NEAR_KM && b.d < NEAR_KM) named.push([Math.min(a.s, b.s), Math.max(a.s, b.s)]);
    }
    intervals = merge(named, line.length);
  } else {
    const at = (end) => {
      if (end.at) return project(line, end.at);
      const other = groups.get(`${grp.pr}|${end.junction}`);
      if (!other) throw new Error(`tch-routes: ${grp.pr} ${grp.number} meets ${end.junction}, which the NRN does not carry`);
      return junction(line, other);
    };
    const a = at(entry.extent.from), b = at(entry.extent.to);
    // An anchor a few kilometres off still projects to the right place on the
    // line, so it is reported rather than fatal; one tens of kilometres off is
    // on the wrong road.
    for (const [end, p] of [[entry.extent.from, a], [entry.extent.to, b]]) {
      if (p.d > 25) throw new Error(`tch-routes: ${grp.pr} ${grp.number} is ${p.d.toFixed(1)} km from ${end.name}`);
      if (p.d > 5) far.push({ anchor: end.name, km: Math.round(p.d * 10) / 10 });
    }
    intervals = [[Math.min(a.s, b.s), Math.max(a.s, b.s)]];
  }

  const flags = grp.parts.map((p) => {
    const m = project(line, mid(p.coords));
    if (m.d >= NEAR_KM) return entry.extent === 'named' ? Boolean(p.props.tch) : false;
    return intervals.some(([a, b]) => m.s >= a - 0.05 && m.s <= b + 0.05);
  });
  return { flags, intervals: intervals.map(([a, b]) => [Math.round(a), Math.round(b)]), length: Math.round(line.length), far };
}
