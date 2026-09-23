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

// The point on segment a-b closest to p, with how far along the segment it
// falls. Same local scaling as perpDist, so the projection is metric rather
// than degree-shaped.
function projectOnSegment(p, a, b) {
  const kx = Math.cos(p[1] * DEG) || 1;
  const ax = a[0] * kx, ay = a[1];
  const dx = b[0] * kx - ax, dy = b[1] - ay;
  if (dx === 0 && dy === 0) return { t: 0, coord: a };
  let t = ((p[0] * kx - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  return { t, coord: [(ax + t * dx) / kx, ay + t * dy] };
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

/**
 * Join lines that continue one another into single lines.
 *
 * A line is extended through an endpoint only where exactly two line ends
 * meet, so a junction stays a junction and nothing is joined across one. The
 * geometry drawn is the same; what changes is how many pieces it is shipped
 * in. A road file split at every node - the RNC is - otherwise arrives as tens
 * of thousands of two-point lines, each of which simplification cannot touch.
 */
export function chainLines(lines) {
  const key = (c) => `${c[0]},${c[1]}`;
  const ends = new Map();
  lines.forEach((l, i) => {
    if (l.length < 2) return;
    for (const k of [key(l[0]), key(l[l.length - 1])]) {
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push(i);
    }
  });
  const used = new Uint8Array(lines.length);
  const next = (k, from) => {
    const at = ends.get(k);
    if (!at || at.length !== 2) return -1;
    const j = at[0] === from ? at[1] : at[0];
    return j === from || used[j] ? -1 : j;
  };
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (used[i] || lines[i].length < 2) continue;
    used[i] = 1;
    let line = lines[i].slice();
    for (const forward of [true, false]) {
      let last = i;
      for (;;) {
        const tip = forward ? line[line.length - 1] : line[0];
        const j = next(key(tip), last);
        if (j < 0) break;
        used[j] = 1;
        const l = lines[j];
        const t = key(tip);
        if (forward) {
          line = line.concat((key(l[0]) === t ? l : l.slice().reverse()).slice(1));
        } else {
          line = (key(l[l.length - 1]) === t ? l : l.slice().reverse()).concat(line.slice(1));
        }
        last = j;
      }
    }
    out.push(line);
  }
  return out;
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
function buildGraph(parts, snapDeg, bridgeKm, { bridgeToAnyNode = false } = {}) {
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

    // A hole is normally bounded by two dead ends, and pairing only those keeps
    // a bridge from cutting a corner between two roads that merely pass close.
    // But where one route simply stops against the flank of another - which is
    // what a junction between two different numbers looks like, and what leaves
    // Alaska's A-1 in two pieces at Delta Junction - the far side of the hole
    // is an ordinary mid-road node. Callers that already know the pieces are
    // one road can say so and have the hole closed anyway.
    const targets = bridgeToAnyNode ? [...degree.keys()] : deadEnds;
    const candidates = [];
    for (const a of deadEnds) {
      for (const b of targets) {
        if (a === b || find(a) === find(b)) continue;
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

export function stitchComponents(parts, snapDeg = 0.0025, bridgeKm = 0, opts = {}) {
  const { nodeCoord, edges, find } = buildGraph(parts, snapDeg, bridgeKm, opts);

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

    const best = farthestPair(adj, nodeCoord);

    let pieces = [];
    let gaps = [];
    let ordered = [];
    const usedEdges = new Set();
    if (best && best.a !== best.b) {
      const path = closeRing(adj, shortestPath(adj, best.a, best.b), best.a, best.b);
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

// A bridged gap costs more than the straight line it spans, so a route is only
// carried across one where there is genuinely no pavement to follow. Without
// the penalty a bridge is always the cheaper option - a straight line between
// two points can never be longer than a road between them - so any bridge
// running parallel to real road would be preferred to the road.
const cost = (e) => (e.bridge ? e.km * 4 + 2 : e.km);

// Dijkstra from one node to every node it can reach, over a binary heap.
//
// The heap matters: this runs three times per route across 11,000 routes, and
// the largest components hold tens of thousands of nodes. Scanning for the
// minimum instead made the whole build quadratic in the size of the biggest
// road in the network.
function dijkstra(adj, start) {
  const dist = new Map([[start, 0]]);
  const prev = new Map();
  const done = new Set();
  const heap = [{ n: start, d: 0 }];

  const push = (item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].d <= heap[i].d) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l].d < heap[m].d) m = l;
        if (r < heap.length && heap[r].d < heap[m].d) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };

  while (heap.length) {
    const { n: cur, d: curD } = pop();
    if (done.has(cur)) continue;
    done.add(cur);
    for (const { to, e } of adj.get(cur) || []) {
      if (done.has(to)) continue;
      const nd = curD + cost(e);
      if (nd < (dist.get(to) ?? Infinity)) {
        dist.set(to, nd);
        prev.set(to, { from: cur, e });
        push({ n: to, d: nd });
      }
    }
  }
  return { dist, prev };
}

/**
 * The route's two ends: the pair of nodes lying farthest apart on the map,
 * found by a geometric double sweep - step out from the component's centre to
 * the most distant node, then from there to the most distant node again.
 *
 * Both halves of this matter, and each replaced a bug that produced a
 * confidently wrong number.
 *
 * *Every node is a candidate.* The original code considered only dead ends,
 * which holds when the dead ends are the ends of the road. On a divided
 * freeway drawn with its ramps, nearly every node has degree three or more and
 * the few degree-one nodes are ramp stubs. Ontario's Highway 401 had exactly
 * two of them, 2 km apart, so an 828 km motorway came back as the 3 km between
 * two off-ramps.
 *
 * *The sweep measures across the map, not along the road.* Sweeping by road
 * distance instead looks more principled and is wrong here, because the
 * longest simple path through a dual carriageway runs out along one side and
 * back down the other. That path repeats no node, so nothing rules it out, and
 * it is close to twice the length of the road: Rhode Island's Interstates came
 * to 141 miles against a published 71. Choosing the ends geographically and
 * then routing between them by road gives the journey rather than the tour.
 *
 * Both sweeps are linear, so this also costs less than the quadratic scan over
 * node pairs it replaced.
 */
function farthestPair(adj, nodeCoord) {
  const nodes = [...adj.keys()];
  if (nodes.length < 2) return null;

  const far = (from) => {
    const origin = nodeCoord[from];
    let node = from;
    let d = -1;
    for (const n of nodes) {
      const v = haversineKm(origin, nodeCoord[n]);
      if (v > d) { node = n; d = v; }
    }
    return { node, d };
  };

  // Starting from the centroid rather than an arbitrary node, so the first
  // sweep lands on a genuine extremity instead of wherever the source happened
  // to begin drawing.
  let cx = 0;
  let cy = 0;
  for (const n of nodes) { cx += nodeCoord[n][0]; cy += nodeCoord[n][1]; }
  const centre = [cx / nodes.length, cy / nodes.length];

  let seed = nodes[0];
  let seedD = -1;
  for (const n of nodes) {
    const v = haversineKm(centre, nodeCoord[n]);
    if (v > seedD) { seed = n; seedD = v; }
  }

  const a = far(seed);
  const b = far(a.node);
  return { a: a.node, b: b.node, d: b.d };
}

function shortestPath(adj, start, goal) {
  const { prev } = dijkstra(adj, start);
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

/**
 * Carry the path the rest of the way round, when the road is a ring.
 *
 * A beltway has no two ends, so asking for the path between its two most
 * separated points returns an arc and files the remaining three-quarters of
 * the road as branches. Indianapolis's I-465 measured 8 miles of a 53-mile
 * loop that way, Atlanta's I-285 29 of 63.
 *
 * So look for a second way back that shares no pavement with the first. On a
 * ring there is one and it is the rest of the ring. On an ordinary road there
 * is none, because removing the road removes the only route between its ends.
 *
 * The case this must not mistake for a ring is a divided highway whose two
 * carriageways join at both ends, where the way back is the other side of the
 * same road: real pavement, but not more of the road, and adding it would
 * report double.
 *
 * So the way back is searched for in a graph with the road just walked taken
 * out of it — not merely the same edges, but the same pavement, because the
 * opposite carriageway is a different edge lying on top of the one already
 * counted. What is left is only road the path has not been down, and a way
 * through it is the rest of the ring or nothing.
 *
 * Both cases turn up. Indianapolis's I-465 arrives as two separate rings and
 * the duplicate is dropped before this runs, leaving one clean loop to close.
 * Baltimore's I-695 arrives as a single component with both carriageways
 * inside it, and striking out only the edges walked left the twin in place as
 * the shortest way home: rejecting it and taking the next way round measured
 * the beltway twice, and accepting it measured 23 miles of a 46-mile road.
 * Striking out the pavement gets one lap of it either way.
 */
function closeRing(adj, path, a, b, tolKm = 0.08) {
  if (!path?.length) return path;
  const out = assemblePath(path).pieces;
  if (!out.length) return path;

  const near = proximityIndex(out, tolKm);
  const walked = new Set(path.map((s) => s.e.i));
  const onPath = new Map();
  const isOnPath = (e) => {
    if (!onPath.has(e.i)) onPath.set(e.i, shareNear([e.coords], near) >= 0.6);
    return onPath.get(e.i);
  };

  const residual = new Map();
  for (const [n, links] of adj) {
    residual.set(n, links.filter((l) => !walked.has(l.e.i) && !isOnPath(l.e)));
  }

  const back = shortestPath(residual, b, a);
  return back?.length ? [...path, ...back] : path;
}

// Sample a polyline every `stepKm`, ending on its last vertex so a short piece
// is still represented.
function sampleLine(piece, stepKm, emit) {
  walkLine(piece, stepKm, emit);
  if (piece.length) emit(piece[piece.length - 1]);
}

/**
 * "Is this point on one of those polylines?", answered many times over.
 *
 * Built once and asked repeatedly, because the callers ask about every edge of
 * a road against the same set of lines, and rebuilding the grid for each would
 * make the comparison quadratic in the size of a city's beltway.
 */
function proximityIndex(pieces, tolKm) {
  const cell = tolKm / 111.32;
  const grid = new Map();
  for (const piece of pieces) {
    sampleLine(piece, tolKm / 2, (c) => {
      const k = `${Math.floor(c[0] / cell)},${Math.floor(c[1] / cell)}`;
      let bucket = grid.get(k);
      if (!bucket) grid.set(k, bucket = []);
      bucket.push(c);
    });
  }
  return (p) => {
    const gx = Math.floor(p[0] / cell);
    const gy = Math.floor(p[1] / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const q of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
          if (haversineKm(p, q) <= tolKm) return true;
        }
      }
    }
    return false;
  };
}

// What fraction of a set of polylines runs within the indexed distance of
// another set, by sampled length. Two carriageways of one road score near 1;
// two roads that merely cross score near 0.
function shareNear(pieces, near) {
  let hit = 0;
  let n = 0;
  for (const piece of pieces) {
    sampleLine(piece, 0.2, (p) => { n++; if (near(p)) hit++; });
  }
  return n ? hit / n : 0;
}

function coincidentShare(pieces, against, tolKm) {
  return shareNear(pieces, proximityIndex(against, tolKm));
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
export function stitchRoute(parts, {
  snapDeg = 0.0025, bridgeKm = 60, minComponentKm = 1.2,
  dedupe = false, dedupeTolKm = 0.08,
} = {}) {
  const first = stitchComponents(parts, snapDeg, 0);
  const keep = new Set();
  for (const comp of first) {
    if (comp.km < minComponentKm) continue;
    for (const e of comp.edges) keep.add(e.i);
  }
  if (!keep.size) return [];
  const survivors = parts.filter((_, i) => keep.has(i));
  const comps = stitchComponents(survivors, snapDeg, bridgeKm)
    .filter((c) => c.km >= minComponentKm);
  return dedupe ? withoutOppositeCarriageways(comps, dedupeTolKm) : comps;
}

/**
 * Walk a polyline emitting a point every `stepKm`, with how far along it each
 * point sits. Sampling by distance rather than by vertex matters because the
 * geometry is thinned before stitching: vertices can be hundreds of metres
 * apart on a straight section, so comparing vertex to vertex misses a
 * carriageway 30 m away.
 */
function walkLine(piece, stepKm, emit) {
  let along = 0;
  let carry = 0;
  for (let i = 1; i < piece.length; i++) {
    const [a, b] = [piece[i - 1], piece[i]];
    const seg = haversineKm(a, b);
    if (seg <= 0) continue;
    for (let d = stepKm - carry; d < seg; d += stepKm) {
      const f = d / seg;
      emit([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], along + d);
    }
    carry = (carry + seg) % stepKm;
    along += seg;
  }
}

/**
 * How far each piece of pavement on a path is actually driven.
 *
 * Some divided highways arrive from TIGER not as two lines but as one, drawn
 * out along one carriageway and back down the other so that it returns to
 * where it started. Albany's I-787 is a single ten-mile road recorded as a
 * nineteen-mile closed loop; Oklahoma City's I-335 the same. There is no
 * second component to discard, because the duplication is inside the path
 * itself, and no amount of graph work helps: the line really is that long.
 *
 * The distinguishing mark is that the two passes are in the same place. So:
 * sample along the path, and for each point ask whether the path comes back
 * within `tolKm` at a point at least `minAlongKm` further along itself. The
 * along-the-path condition is what keeps this from misreading a mountain road.
 * A switchback doubles back within a few hundred metres of itself and is
 * genuine distance driven; a returning carriageway comes back miles later.
 *
 * The answer is per edge rather than a single total because everything the
 * panel says about a route — the miles in each state, the share that is
 * freeway, the share that is tolled — is added up from the edges. Discount
 * only the total and the per-state figures sum to twice the length printed
 * above them: the Capital Beltway read 68 miles with 128 miles of state
 * mileage under it. Where the two passes are separate edges, as they usually
 * are, each gives up half the overlap; they are in the same place, so they
 * are in the same state and the same classification, and the totals come out
 * right either way.
 */
export function drivenEdgeKm(edges, tolKm = 0.08, minAlongKm = 1.6) {
  const step = tolKm / 2;
  const pts = [];
  let along = 0;
  edges.forEach((e, i) => {
    if (e.bridge) return;
    walkLine(e.coords, step, (c, d) => pts.push({ c, along: along + d, e: i }));
    along += e.km;
  });

  const doubled = new Float64Array(edges.length);
  if (pts.length >= 4) {
    const cell = tolKm / 111.32;
    const grid = new Map();
    pts.forEach((p, i) => {
      const k = `${Math.floor(p.c[0] / cell)},${Math.floor(p.c[1] / cell)}`;
      let b = grid.get(k);
      if (!b) grid.set(k, b = []);
      b.push(i);
    });

    for (const p of pts) {
      const gx = Math.floor(p.c[0] / cell);
      const gy = Math.floor(p.c[1] / cell);
      let found = false;
      for (let dx = -1; dx <= 1 && !found; dx++) {
        for (let dy = -1; dy <= 1 && !found; dy++) {
          for (const j of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
            const o = pts[j];
            if (Math.abs(o.along - p.along) < minAlongKm) continue;
            if (haversineKm(p.c, o.c) <= tolKm) { found = true; break; }
          }
        }
      }
      if (found) doubled[p.e] += step;
    }
  }

  // Each overlap is found from both of its sides, so the sampled total counts
  // it twice; half of it is the distance to discount.
  return edges.map((e, i) => (e.bridge ? 0 : Math.max(0, e.km - doubled[i] / 2)));
}

/**
 * Drop the components that are the other side of a road already counted.
 *
 * A divided highway is two centrelines, and whether they end up as one
 * component or two is not about the road but about whether the source files the
 * connecting ramps under the same number. The Canadian network does, so its
 * carriageways join at every interchange. TIGER does not - a ramp is its own
 * named feature - so an American beltway arrives as two separate rings, each
 * the full length of the road, and adding them up reports twice the highway.
 * Columbus's I-270 measured 110 miles of a 55-mile loop, San Antonio's I-410
 * 105 of 53.
 *
 * The test is coincidence rather than shape: sample along the shorter component
 * and ask how much of it runs within 80 m of one already kept. Two carriageways
 * of the same road are within a few tens of metres for nearly their whole
 * length, while the genuinely separate pieces this must not touch - I-95 either
 * side of its missing turnpikes, the two unrelated I-295s - are tens of miles
 * apart. 80 m is wide enough to cover a divided highway's median and far too
 * narrow to reach a different road.
 *
 * Only what is measured changes. The dropped carriageway is still drawn, so the
 * map shows both sides of the road; it is counted once.
 */
function withoutOppositeCarriageways(comps, tolKm = 0.08) {
  if (comps.length < 2) return comps;

  const kept = [];
  const counted = [];

  // Longest first, so the side that is kept is the more completely drawn one.
  for (const comp of [...comps].sort((a, b) => b.km - a.km)) {
    if (kept.length && coincidentShare(comp.pieces, counted, tolKm) >= 0.6) {
      // Counted once, drawn twice: the far carriageway moves to the branches,
      // which are drawn with the route but never measured. Losing it would
      // leave one side of every divided highway missing from the map.
      kept[0].branches.push(...comp.pieces);
      continue;
    }
    kept.push(comp);
    counted.push(...comp.pieces);
  }
  return kept;
}

/**
 * Cut fragments so that every place they meet is capable of being a node.
 *
 * The graph is built from fragment endpoints, so a road that ends against the
 * middle of another one joins nothing — and that is exactly what a junction
 * between two different route numbers looks like in the source. Alaska's A-1
 * failed on it: the Alaska Highway ends on the flank of the Richardson Highway
 * at Delta Junction, the Richardson runs through without a vertex break, and
 * the two halves of the Interstate sat in different components 200 km apart.
 *
 * The named points are cut for a second reason. A declared terminus is a
 * place, not a fragment end, and snapping it to the nearest fragment end put
 * A-3's start 94 km down the Kenai Peninsula from Soldotna. Cutting the
 * pavement at the vertex nearest the place puts a node where the place is.
 *
 * Only `stitchBetween` needs this. A route stitched from its own fragments
 * meets itself end to end, because the source splits one road at its own
 * junctions; it is unioning several numbered routes that produces the T.
 */
export function nodeParts(parts, points = [], joinKm = 0.4) {
  // The cut has to land on the line, not on the nearest vertex. Simplification
  // strips vertices from anything straight, so where the Alaska Highway runs
  // past Tok the pavement is within 100 m of the Tok Cut-Off's last point
  // while the nearest surviving vertex is 5 km down the road. Projecting onto
  // the segment puts the node where the roads actually meet and adds no error:
  // the inserted point already lies on the line being cut.
  const nearestOn = (pt, skip) => {
    let best = null;
    for (let i = 0; i < parts.length; i++) {
      if (i === skip) continue;
      const coords = parts[i].coords;
      for (let j = 0; j < coords.length - 1; j++) {
        const hit = projectOnSegment(pt, coords[j], coords[j + 1]);
        const d = haversineKm(pt, hit.coord);
        if (!best || d < best.d) best = { d, i, j, t: hit.t, coord: hit.coord };
      }
    }
    return best;
  };

  const cuts = parts.map(() => []);
  // A declared terminus is a place, not a fragment end, so it is always cut in:
  // snapping A-3's start to the nearest fragment end put it 94 km down the
  // Kenai Peninsula from Soldotna.
  for (const pt of points) {
    const hit = nearestOn(pt, -1);
    if (hit) cuts[hit.i].push(hit);
  }
  // Where one road stops against the flank of another, which is what a junction
  // between two different numbers looks like in the source.
  for (let i = 0; i < parts.length; i++) {
    const coords = parts[i].coords;
    for (const end of [coords[0], coords[coords.length - 1]]) {
      const hit = nearestOn(end, i);
      if (hit && hit.d <= joinKm) cuts[hit.i].push(hit);
    }
  }

  const out = [];
  for (let i = 0; i < parts.length; i++) {
    if (!cuts[i].length) { out.push(parts[i]); continue; }
    const coords = parts[i].coords;
    const at = cuts[i].sort((a, b) => a.j - b.j || a.t - b.t);
    let run = [coords[0]];
    let k = 0;
    for (let j = 0; j < coords.length - 1; j++) {
      while (k < at.length && at[k].j === j) {
        const { coord } = at[k++];
        if (haversineKm(run[run.length - 1], coord) > 1e-6) run.push(coord);
        if (run.length >= 2) out.push({ ...parts[i], coords: run });
        run = [coord];
      }
      run.push(coords[j + 1]);
    }
    if (run.length >= 2) out.push({ ...parts[i], coords: run });
  }
  return out;
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
  const { nodeCoord, edges, find } = buildGraph(nodeParts(parts, [from, to]),
    snapDeg, bridgeKm, { bridgeToAnyNode: true });

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
