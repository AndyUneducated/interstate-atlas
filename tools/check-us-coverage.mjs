// Cross-checks the American US and state route numbers the atlas carries
// against the ones the states report to HPMS, and writes
// content/reference/us-crosscheck.json.
//
// HPMS (content/reference/hpms.json) lists every route a state reports, by
// signing system and number. The atlas draws what TIGER's primary and
// secondary roads file names (D-47). Every HPMS key of a mile or more that the
// atlas lacks is given one verdict:
//
//   otherSystem   the atlas has the number in that state under another system:
//                 HPMS files Missouri's I-44 as state route 44, Alabama's US 31
//                 as state route 31
//   notInTiger    no TIGER primary or secondary road in that state carries the
//                 number: a farm-to-market, secondary or S-road the atlas
//                 leaves out by scope
//   short         TIGER carries it, but no stretch of it reaches half a mile,
//                 which D-42 leaves out for a state number
//   inTiger       TIGER carries a longer stretch and no route came of it; each
//                 is listed, and the coverage table counts them unexplained
//
// Needs the TIGER files the build downloads (tools/src/tiger/).
//
//   node tools/check-us-coverage.mjs

import * as shapefile from 'shapefile';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseName, STATES } from './tiger.mjs';
import { haversineKm } from './geo.mjs';

const ROOT = join(import.meta.dirname, '..');
const read = async (p) => JSON.parse(await readFile(join(ROOT, p), 'utf8'));
const SHORT_KM = 0.805;
const SYSTEMS = ['us-interstate', 'us-numbered', 'us-state'];

const atlas = new Map();
const add = (st, sys, num) => {
  if (!atlas.has(st)) atlas.set(st, new Set());
  atlas.get(st).add(`${sys}|${String(num).toUpperCase()}`);
};
for (const f of ['interstate', 'numbered']) {
  for (const { properties: p } of (await read(`data/geo/us/${f}.json`)).features) {
    for (const s of p.states ?? [{ st: p.st }]) add(s.st, p.sys, p.num);
  }
}
for (const f of await readdir(join(ROOT, 'data', 'geo', 'us', 'state'))) {
  for (const { properties: p } of (await read(`data/geo/us/state/${f}`)).features) add(p.st, p.sys, p.num);
}

// The longest connected stretch of each number TIGER files, per state, over
// every primary and secondary road whose name parses to the mainline: a
// bypass or spur ("State Hwy 127 Byp") is a different route.
const SNAP_KM = 0.03;
function longestStretch(pieces) {
  const parent = pieces.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const a = pieces[i];
      const b = pieces[j];
      if ([a.from, a.to].some((x) => [b.from, b.to].some((y) => haversineKm(x, y) < SNAP_KM))) parent[find(i)] = find(j);
    }
  }
  const km = new Map();
  pieces.forEach((p, i) => km.set(find(i), (km.get(find(i)) ?? 0) + p.km));
  return Math.max(0, ...km.values());
}
const tigerKm = new Map();
for (const st of Object.values(STATES)) {
  const base = join(ROOT, 'tools', 'src', 'tiger', st);
  const src = await shapefile.open(`${base}.shp`, `${base}.dbf`, { encoding: 'utf-8' });
  const pieces = new Map();
  for (;;) {
    const r = await src.read();
    if (r.done) break;
    const p = r.value.properties;
    const routes = parseName(p.FULLNAME, p.RTTYP, st).filter((rt) => !rt.qualifier);
    if (!routes.length) continue;
    const g = r.value.geometry;
    const parts = g?.type === 'LineString' ? [g.coordinates] : g?.type === 'MultiLineString' ? g.coordinates : [];
    for (const part of parts) {
      if (part.length < 2) continue;
      let km = 0;
      for (let i = 1; i < part.length; i++) km += haversineKm(part[i - 1], part[i]);
      for (const rt of routes) {
        const k = `${rt.system}|${String(rt.number).toUpperCase()}`;
        if (!pieces.has(k)) pieces.set(k, []);
        pieces.get(k).push({ from: part[0], to: part[part.length - 1], km });
      }
    }
  }
  tigerKm.set(st, { pieces, longest: new Map() });
}
const stretch = (st, key) => {
  const t = tigerKm.get(st);
  if (!t?.pieces.has(key)) return 0;
  if (!t.longest.has(key)) t.longest.set(key, longestStretch(t.pieces.get(key)));
  return t.longest.get(key);
};

const hpms = (await read('content/reference/hpms.json')).states;
const total = {};
const byState = {};
const listed = [];
for (const [st, routes] of Object.entries(hpms)) {
  for (const [k, v] of Object.entries(routes)) {
    const [sys, num] = k.split('|');
    if (sys === 'us-interstate' || v.mi < 1) continue;
    const key = `${sys}|${num.toUpperCase()}`;
    const t = (total[sys] ??= { reported: 0, covered: 0, otherSystem: 0, notInTiger: 0, short: 0, inTiger: 0 });
    const s = ((byState[st] ??= {})[sys] ??= { reported: 0, covered: 0, otherSystem: 0, notInTiger: 0, short: 0, inTiger: 0 });
    t.reported++;
    s.reported++;
    let verdict = 'covered';
    // Texas reports its loops and spurs by the bare number; the atlas keeps the
    // word, as TIGER and the signs do (LOOP1604).
    const spelled = st === 'TX' && sys === 'us-state' && /^\d+$/.test(num)
      && ['LOOP', 'SPUR'].some((w) => atlas.get(st)?.has(`${sys}|${w}${num}`));
    if (!atlas.get(st)?.has(key) && !spelled) {
      const km = stretch(st, key);
      verdict = SYSTEMS.some((o) => o !== sys && atlas.get(st)?.has(`${o}|${num.toUpperCase()}`)) ? 'otherSystem'
        : !km ? 'notInTiger'
          : km < SHORT_KM ? 'short' : 'inTiger';
      if (verdict !== 'notInTiger') {
        listed.push({ st, system: sys, number: num, hpmsMi: v.mi, verdict, tigerLongestKm: Math.round(km * 10) / 10 });
      }
    }
    t[verdict]++;
    s[verdict]++;
  }
}

await writeFile(join(ROOT, 'content', 'reference', 'us-crosscheck.json'), `${JSON.stringify({
  purpose: 'Which US and state route numbers the states report to HPMS the atlas draws, and why the rest are absent.',
  sources: {
    atlas: 'data/geo/us, built from TIGER/Line primary and secondary roads',
    hpms: 'content/reference/hpms.json',
    tiger: 'tools/src/tiger, the same files the build reads',
  },
  method: [
    'An HPMS key is counted when it measures a mile or more; shorter keys are mostly coding remnants.',
    'A key is covered when the atlas has a route of that system and number in that state. A bare Texas number also matches the atlas loop or spur of that number, since Texas reports those without the word.',
    `TIGER is read for the mainline only (a bypass or spur is another route), and its pieces are joined where their ends meet within ${SNAP_KM * 1000} m; a longest stretch under ${SHORT_KM} km (half a mile) is short.`,
    'Keys judged notInTiger are counted, not listed: there are ten thousand of them.',
  ],
  verdicts: {
    covered: 'the atlas has the route',
    otherSystem: 'the atlas has the number in that state under another system',
    notInTiger: 'no TIGER primary or secondary road in that state carries the number (D-47)',
    short: 'TIGER carries it on under half a mile of road (D-42)',
    inTiger: 'TIGER carries more than half a mile and the atlas has no route; unexplained',
  },
  total,
  byState,
  listed,
}, null, 1)}\n`);
console.log('wrote content/reference/us-crosscheck.json');
for (const [sys, t] of Object.entries(total)) console.log(`  ${sys}: ${JSON.stringify(t)}`);
