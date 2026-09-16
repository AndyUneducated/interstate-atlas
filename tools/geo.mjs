// Geometry helpers shared by the build scripts.

const R_EARTH_KM = 6371.0088;
const DEG = Math.PI / 180;

export function haversineKm(a, b) {
  const lat1 = a[1] * DEG;
  const lat2 = b[1] * DEG;
  const dLat = lat2 - lat1;
  const dLon = (b[0] - a[0]) * DEG;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function lineLengthKm(coords) {
  let km = 0;
  for (let i = 1; i < coords.length; i++) km += haversineKm(coords[i - 1], coords[i]);
  return km;
}

// Perpendicular distance from p to segment a-b, in an equirectangular projection
// scaled at the local latitude so the tolerance behaves like metres rather than degrees.
function perpDist(p, a, b, kx) {
  const px = p[0] * kx, py = p[1];
  const ax = a[0] * kx, ay = a[1];
  const bx = b[0] * kx, by = b[1];
  const dx = bx - ax, dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Iterative Douglas-Peucker. `tolDeg` is a latitude-degree tolerance.
export function simplify(coords, tolDeg) {
  if (coords.length <= 2) return coords.slice();
  const kx = Math.cos(((coords[0][1] + coords[coords.length - 1][1]) / 2) * DEG) || 1;
  const keep = new Uint8Array(coords.length);
  keep[0] = keep[coords.length - 1] = 1;
  const stack = [[0, coords.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    let far = -1, farD = tolDeg;
    for (let i = lo + 1; i < hi; i++) {
      const d = perpDist(coords[i], coords[lo], coords[hi], kx);
      if (d > farD) { farD = d; far = i; }
    }
    if (far > 0) {
      keep[far] = 1;
      stack.push([lo, far], [far, hi]);
    }
  }
  const out = [];
  for (let i = 0; i < coords.length; i++) if (keep[i]) out.push(coords[i]);
  return out;
}

export function roundCoords(coords, decimals = 4) {
  const m = 10 ** decimals;
  const out = [];
  let prev = null;
  for (const c of coords) {
    const p = [Math.round(c[0] * m) / m, Math.round(c[1] * m) / m];
    if (prev && p[0] === prev[0] && p[1] === prev[1]) continue;
    out.push(p);
    prev = p;
  }
  return out.length >= 2 ? out : coords.slice(0, 2).map((c) => [Math.round(c[0] * m) / m, Math.round(c[1] * m) / m]);
}

export function bboxOf(lines) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const line of lines) {
    for (const [x, y] of line) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

export function bboxDistanceKm(a, b) {
  // 0 when the boxes overlap, otherwise the gap between them.
  const dx = Math.max(0, Math.max(a[0] - b[2], b[0] - a[2]));
  const dy = Math.max(0, Math.max(a[1] - b[3], b[1] - a[3]));
  if (dx === 0 && dy === 0) return 0;
  const lat = (a[1] + a[3] + b[1] + b[3]) / 4;
  return Math.hypot(dx * Math.cos(lat * DEG), dy) * 111.32;
}

/**
 * Stitch a bag of polylines into a connected route.
 *
 * Highway data arrives as thousands of unordered fragments, but the flythrough
 * and the elevation profile both need a single path that runs end to end. So we
 * snap fragment endpoints onto a grid to build a graph, split it into
 * geographically separate components, and inside each component take the
 * shortest path between the two most widely separated dead ends as the
 * mainline. Everything left over is kept as branch geometry: still drawn, but
 * not treated as part of the through route.
 */
function buildGraph(parts, snapDeg, bridgeKm) {
  const buckets = new Map();
  const nodeCoord = [];

  // Endpoints that should be the same node are rarely bit-identical: the source
  // splits routes at state lines and the two sides disagree by a few metres.
  // Rounding coordinates onto a grid is not enough, because two points a metre
  // apart still land in different cells whenever they straddle a cell boundary.
  // So bucket by cell but match against the 3x3 neighbourhood by real distance.
  const nodeOf = (c) => {
    const cx = Math.floor(c[0] / snapDeg);
    const cy = Math.floor(c[1] / snapDeg);
    const tolKm = snapDeg * 111.32;
    let best = null;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const id of buckets.get(`${cx + dx},${cy + dy}`) || []) {
          const d = haversineKm(c, nodeCoord[id]);
          if (d <= tolKm && (!best || d < best.d)) best = { d, id };
        }
      }
    }
    if (best) return best.id;
    const id = nodeCoord.length;
    nodeCoord.push(c);
    const k = `${cx},${cy}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(id);
    return id;
  };

  const edges = parts.map((p, i) => {
    const a = nodeOf(p.coords[0]);
    const b = nodeOf(p.coords[p.coords.length - 1]);
    return { i, a, b, coords: p.coords, km: lineLengthKm(p.coords), props: p.props };
  });

  // Union-find over the snapped nodes.
  const parent = new Int32Array(nodeCoord.length);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (x, y) => { const rx = find(x), ry = find(y); if (rx !== ry) { parent[rx] = ry; return true; } return false; };
  for (const e of edges) union(e.a, e.b);

  // Bridge genuine holes in the source data.
  //
  // Beyond float noise the data has real breaks, usually where a route crosses
  // a metro area or a river and the urban carriageway is filed under another
  // classification: I-95 breaks for 5 km at Richmond, I-80 for 4.6 km at Omaha,
  // and I-90 loses the Indiana Toll Road and Ohio Turnpike outright, a 420 km
  // hole. Left unbridged, I-95 reports 953 miles instead of 1,884 and its
  // northern terminus lands in Virginia rather than Maine.
  //
  // Bridges are added as edges in the graph rather than stitched on afterwards,
  // so the end-to-end path still falls out of one shortest-path search and the
  // pieces come back in travel order. They are flagged, never drawn, and never
  // counted as pavement: a straight line across Richmond would be a road that
  // does not exist. Only the camera crosses them.
  if (bridgeKm > 0) {
    const degree = new Map();
    for (const e of edges) {
      degree.set(e.a, (degree.get(e.a) || 0) + 1);
      degree.set(e.b, (degree.get(e.b) || 0) + 1);
    }
    const deadEnds = [...degree.keys()].filter((n) => degree.get(n) === 1);

    const candidates = [];
    for (let i = 0; i < deadEnds.length; i++) {
      for (let j = i + 1; j < deadEnds.length; j++) {
        const a = deadEnds[i], b = deadEnds[j];
        if (find(a) === find(b)) continue;
        const km = haversineKm(nodeCoord[a], nodeCoord[b]);
        if (km <= bridgeKm) candidates.push({ a, b, km });
      }
    }
    // Shortest candidate first, so a hole is closed by the nearest dead ends
    // rather than by whichever pair happened to be tested earliest.
    candidates.sort((x, y) => x.km - y.km);
    let bridgeId = edges.length;
    for (const c of candidates) {
      if (find(c.a) === find(c.b)) continue;
      union(c.a, c.b);
      edges.push({
        i: bridgeId++, a: c.a, b: c.b, km: c.km, bridge: true,
        coords: [nodeCoord[c.a], nodeCoord[c.b]],
        props: { type: 'Gap', state: null, divided: null },
      });
    }
  }

  return { nodeCoord, edges, find };
}

export function stitchComponents(parts, snapDeg = 0.0025, bridgeKm = 0) {
  const { nodeCoord, edges, find } = buildGraph(parts, snapDeg, bridgeKm);

  const groups = new Map();
  for (const e of edges) {
    const root = find(e.a);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(e);
  }

  const components = [];
  for (const compEdges of groups.values()) {
    const adj = new Map();
    for (const e of compEdges) {
      if (!adj.has(e.a)) adj.set(e.a, []);
      if (!adj.has(e.b)) adj.set(e.b, []);
      adj.get(e.a).push({ to: e.b, e });
      adj.get(e.b).push({ to: e.a, e });
    }

    // Prefer dead ends as candidate termini; a ring road has none, so fall back
    // to every node in the component.
    let terminals = [...adj.keys()].filter((n) => adj.get(n).length === 1);
    if (terminals.length < 2) terminals = [...adj.keys()];

    let best = null;
    for (let i = 0; i < terminals.length; i++) {
      for (let j = i + 1; j < terminals.length; j++) {
        const d = haversineKm(nodeCoord[terminals[i]], nodeCoord[terminals[j]]);
        if (!best || d > best.d) best = { d, a: terminals[i], b: terminals[j] };
      }
    }

    let pieces = [];
    let gaps = [];
    let ordered = [];
    const usedEdges = new Set();
    if (best && best.a !== best.b) {
      const path = shortestPath(adj, best.a, best.b);
      if (path) {
        for (const step of path) usedEdges.add(step.e.i);
        // The path in travel order, which a set cannot express. Anything that
        // asks a question about the ends of the road - which settlement it
        // starts at - needs the order, not just the membership.
        ordered = path.map((s) => s.e).filter((e) => !e.bridge);
        ({ pieces, gaps } = assemblePath(path));
      }
    }
    if (!pieces.length) {
      const longest = compEdges.filter((e) => !e.bridge).sort((x, y) => y.km - x.km)[0];
      if (!longest) continue;
      pieces = [longest.coords.slice()];
      usedEdges.add(longest.i);
      ordered = [longest];
    }

    const pavement = compEdges.filter((e) => !e.bridge);
    // Two different lengths, and they answer two different questions.
    //
    // `edges` is every piece of pavement in the component: both carriageways
    // of a divided highway, every ramp, every service lane. `pathEdges` is
    // the road you would drive from one end to the other, once.
    //
    // Anything presented as the length of a route has to come from the second.
    // The National Road Network draws each direction of a divided highway as
    // its own centreline, so summing the first made Ontario's Highway 401
    // 1,819 km against its published 828, and made Nova Scotia's per-province
    // bars total seven times the length of the routes above them.
    const onPath = pavement.filter((e) => usedEdges.has(e.i));
    components.push({
      pieces,
      mainline: pieces.flat(),
      gaps: gaps.sort((a, b) => b - a),
      branches: pavement.filter((e) => !usedEdges.has(e.i)).map((e) => e.coords),
      edges: pavement,
      pathEdges: ordered.length ? ordered : pavement,
      km: pavement.reduce((s, e) => s + e.km, 0),
      pathKm: onPath.reduce((s, e) => s + e.km, 0),
    });
  }

  components.sort((a, b) => b.km - a.km);
  return components;
}

function shortestPath(adj, start, goal) {
  // Dijkstra; components are small enough that a linear scan for the minimum is fine.
  const dist = new Map([[start, 0]]);
  const prev = new Map();
  const visited = new Set();
  while (true) {
    let cur = null, curD = Infinity;
    for (const [n, d] of dist) if (!visited.has(n) && d < curD) { cur = n; curD = d; }
    if (cur === null) return null;
    if (cur === goal) break;
    visited.add(cur);
    for (const { to, e } of adj.get(cur) || []) {
      if (visited.has(to)) continue;
      const nd = curD + e.km;
      if (nd < (dist.get(to) ?? Infinity)) { dist.set(to, nd); prev.set(to, { from: cur, e }); }
    }
  }
  const steps = [];
  let n = goal;
  while (n !== start) {
    const p = prev.get(n);
    if (!p) return null;
    steps.push({ from: p.from, to: n, e: p.e });
    n = p.from;
  }
  return steps.reverse();
}

// Walk the chosen path, emitting one continuous piece per run of real pavement
// and breaking whenever the path steps across a bridged gap.
function assemblePath(steps) {
  const pieces = [];
  const gaps = [];
  let cur = [];
  for (const { from, e } of steps) {
    if (e.bridge) {
      gaps.push(Math.round(e.km * 100) / 100);
      if (cur.length >= 2) pieces.push(cur);
      cur = [];
      continue;
    }
    // Each fragment has its own winding direction; flip it when needed so the
    // assembled piece stays continuous.
    const coords = e.a === from ? e.coords : e.coords.slice().reverse();
    const startIdx = cur.length ? 1 : 0;
    for (let i = startIdx; i < coords.length; i++) cur.push(coords[i]);
  }
  if (cur.length >= 2) pieces.push(cur);
  return { pieces, gaps };
}

/**
 * Stitch a route in two passes.
 *
 * The source carries stray slivers - zero-length stubs and short orphans left
 * over from digitising. They matter more than their size suggests: a stub is a
 * dead end, so the search for the two most widely separated dead ends can latch
 * onto one and stop there. That is why I-90's eastern end came out on a stub
 * near Albany instead of in Boston.
 *
 * So find the components first with no bridging, discard the slivers, then
 * stitch what survives with the bridge budget applied.
 */
export function stitchRoute(parts, { snapDeg = 0.0025, bridgeKm = 60, minComponentKm = 1.2 } = {}) {
  const first = stitchComponents(parts, snapDeg, 0);
  const keep = new Set();
  for (const comp of first) {
    if (comp.km < minComponentKm) continue;
    for (const e of comp.edges) keep.add(e.i);
  }
  if (!keep.size) return [];
  const survivors = parts.filter((_, i) => keep.has(i));
  return stitchComponents(survivors, snapDeg, bridgeKm).filter((c) => c.km >= minComponentKm);
}

/**
 * Stitch a bag of polylines and return the path between two given points.
 *
 * `stitchRoute` infers a route's ends from its geometry, which is right when
 * the geometry is the route. It is wrong for a designation that overlays part
 * of something longer: Alaska's unsigned Interstates are defined as stretches
 * of the state routes they share pavement with, so A-3 is the Soldotna-to-
 * Anchorage half of a state route that continues to Homer in one direction and
 * the Yukon in the other. Here the termini are the input and the alignment
 * falls out of the shortest path between them, so the road still comes from
 * the source rather than being traced by hand.
 */
export function stitchBetween(parts, from, to, { snapDeg = 0.0025, bridgeKm = 60 } = {}) {
  if (!parts.length) return null;
  const { nodeCoord, edges, find } = buildGraph(parts, snapDeg, bridgeKm);

  const adj = new Map();
  for (const e of edges) {
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a).push({ to: e.b, e });
    adj.get(e.b).push({ to: e.a, e });
  }

  const nearest = (pt) => {
    let best = null;
    for (const n of adj.keys()) {
      const d = haversineKm(pt, nodeCoord[n]);
      if (!best || d < best.d) best = { d, n };
    }
    return best;
  };
  const a = nearest(from);
  const b = nearest(to);
  if (!a || !b || a.n === b.n) return null;
  if (find(a.n) !== find(b.n)) return { disconnected: true, snapKm: [a.d, b.d] };

  const path = shortestPath(adj, a.n, b.n);
  if (!path) return null;
  const { pieces, gaps } = assemblePath(path);
  if (!pieces.length) return null;

  const used = new Set(path.map((s) => s.e.i));
  const onPath = path.map((s) => s.e).filter((e) => !e.bridge);
  return {
    pieces,
    mainline: pieces.flat(),
    gaps: gaps.sort((x, y) => y - x),
    branches: [],
    edges: onPath,
    // Already a single path from one terminus to the other, so the two
    // measures coincide here; named for the caller's benefit.
    pathEdges: onPath,
    km: onPath.reduce((s, e) => s + e.km, 0),
    pathKm: onPath.reduce((s, e) => s + e.km, 0),
    // How far the declared termini sat from the nearest point of real
    // pavement. A large number means the declaration and the geometry
    // disagree, which the build reports rather than quietly accepting.
    snapKm: [Math.round(a.d * 10) / 10, Math.round(b.d * 10) / 10],
    usedEdges: used,
  };
}

export function cumulativeKm(coords) {
  const out = [0];
  for (let i = 1; i < coords.length; i++) out.push(out[i - 1] + haversineKm(coords[i - 1], coords[i]));
  return out;
}

// Resample a path to evenly spaced points, used for elevation sampling.
export function resample(coords, stepKm) {
  const cum = cumulativeKm(coords);
  const total = cum[cum.length - 1];
  if (total === 0) return [coords[0]];
  const out = [];
  let seg = 1;
  for (let d = 0; d <= total; d += stepKm) {
    while (seg < cum.length - 1 && cum[seg] < d) seg++;
    const t = (d - cum[seg - 1]) / Math.max(1e-9, cum[seg] - cum[seg - 1]);
    out.push([
      coords[seg - 1][0] + t * (coords[seg][0] - coords[seg - 1][0]),
      coords[seg - 1][1] + t * (coords[seg][1] - coords[seg - 1][1]),
    ]);
  }
  return out;
}
