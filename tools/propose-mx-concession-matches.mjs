// Proposes atlas routes for the SICT concession titles that name their road
// by places rather than by number, and writes each proposal with its evidence
// to content/reference/mx-concession-matches.json for a person to accept or
// reject. build-tolls.mjs attaches only the proposals marked approved.
//
//   node tools/propose-mx-concession-matches.mjs
//
// The bridge from a place name to a route number is SICT's own: the road
// index of its Datos Viales volumes, which gives every road it surveys a name
// ("Santa Ana - Sonoita") and a route key ("MEX-002D"), and its count
// stations, which name the place each count was taken. Two kinds of evidence:
//
//   road    the title's pair of places, or the whole name of a road, is the
//           name SICT gives a road in one of the title's states;
//   points  both places of the title's pair are count points on one SICT road
//           in those states. Weaker: the title's stretch is then a part of
//           that road, not necessarily all of it.
//
// Spelling is compared after accents, case, punctuation and SICT's
// abbreviations are levelled, and is otherwise exact: Sonoyta and Sonoita are
// different words here. A decision already recorded is kept when the
// proposals are regenerated.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'content', 'reference', 'mx-concession-matches.json');
const MAX_WORDS = 7;

const read = async (p) => JSON.parse(await readFile(join(ROOT, p), 'utf8'));

const ABBR = [
  [/\bcd\.?(?=\s)/g, 'ciudad'], [/\bsta\.?(?=\s)/g, 'santa'], [/\bsto\.?(?=\s)/g, 'santo'],
  [/\bgral\.?(?=\s)/g, 'general'], [/\blib\.?(?=\s)/g, 'libramiento'], [/\bmpo\.?(?=\s)/g, 'municipio'],
  [/\b(?:entr?\.|entronque)(?=\s)/g, 'ent'], [/\bedo\.?(?=\s)/g, 'estado'],
];

/** Lower case, no accents, SICT abbreviations spelled out, hyphens as " - ". */
function norm(s) {
  let x = ` ${String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()} `;
  x = x.replace(/\((?:cuota|libre|alta|baja|directa)\)/g, ' ');
  for (const [re, to] of ABBR) x = x.replace(re, to);
  x = x.replace(/\s*-\s*/g, ' - ').replace(/[^a-z0-9 -]/g, ' ').replace(/\s+/g, ' ');
  return x.trim();
}

const pairKey = (a, b) => [a, b].sort().join(' | ');

/** Every pair of places the title writes as "A-B", including the two ends of a chain "A-B-C". */
function pairsOf(text) {
  const parts = norm(text).split(' - ');
  const out = [];
  const lefts = (s) => { const w = s.split(' '); return Array.from({ length: Math.min(MAX_WORDS, w.length) }, (_, k) => w.slice(w.length - k - 1).join(' ')); };
  const rights = (s) => { const w = s.split(' '); return Array.from({ length: Math.min(MAX_WORDS, w.length) }, (_, k) => w.slice(0, k + 1).join(' ')); };
  for (let i = 0; i + 1 < parts.length; i++) {
    for (const a of lefts(parts[i])) for (const b of rights(parts[i + 1])) out.push([a, b, i, i + 1]);
  }
  // A chain's two outer ends, where the middle part is a single place.
  for (let i = 0; i + 2 < parts.length; i++) {
    for (const a of lefts(parts[i])) for (const b of rights(parts[i + 2])) out.push([a, b, i, i + 2]);
  }
  return out;
}

async function main() {
  const mx = await read('content/reference/mx-concessions.json');
  const des = await read('content/reference/mx-designations.json');
  const traffic = await read('content/reference/mx-traffic.json');
  const federal = (await read('data/geo/mx/federal.json')).features.map((x) => ({
    id: x.properties.id,
    num: String(x.properties.num).replace(/D$/, ''),
    states: (typeof x.properties.states === 'string' ? JSON.parse(x.properties.states) : x.properties.states ?? []).map((s) => s.st),
  }));
  let previous = new Map();
  try {
    for (const m of (await read('content/reference/mx-concession-matches.json')).proposals) previous.set(`${m.title}|${m.sict.st}|${m.sict.name}`, m);
  } catch { /* first run */ }

  const F = Object.fromEntries(des.fields.map((f, i) => [f, i]));
  const roads = des.roads.map((r) => {
    const name = r[F.name];
    const n = norm(name);
    const ends = n.split(' - ');
    return { st: r[F.st], juris: r[F.juris], toll: r[F.toll], name, n, key: r[F.ruta], keys: r[F.routes] ?? [], pair: ends.length === 2 ? pairKey(ends[0], ends[1]) : null };
  });

  // Count points by SICT road, from the stations.
  const T = Object.fromEntries(traffic.fields.map((f, i) => [f, i]));
  const points = new Map();
  for (const s of traffic.stations) {
    const p = String(s[T.point]);
    if (/^\s*(?:t\.|x\.|plaza|lim)/i.test(p)) continue;
    const k = `${s[T.st]}|${norm(s[T.road])}`;
    if (!points.has(k)) points.set(k, new Map());
    points.get(k).set(norm(p), p);
  }

  const proposals = [];
  const unmatched = [];
  for (const x of mx.titles) {
    if (x.numbers.length || !x.states.length) continue;
    const text = norm(x.object);
    const pairs = pairsOf(x.object);
    const inStates = roads.filter((r) => x.states.includes(r.st));
    const found = new Map();
    const add = (r, via, evidence) => {
      const k = `${r.st}|${r.name}`;
      if (!found.has(k) || (found.get(k).via === 'points' && via === 'road')) found.set(k, { r, via, evidence });
    };
    for (const r of inStates) {
      // The road's whole name written in the title.
      if (r.n.length >= 8 && ` ${text} `.includes(` ${r.n} `)) add(r, 'road', `the title writes "${r.name}"`);
      // The title's pair, in either order.
      if (r.pair) for (const [a, b] of pairs) if (pairKey(a, b) === r.pair) add(r, 'road', `the title's "${a} - ${b}" is SICT's "${r.name}"`);
      // Both places of a pair counted on this road.
      const pts = points.get(`${r.st}|${r.n}`);
      if (pts) for (const [a, b] of pairs) {
        if (a !== b && pts.has(a) && pts.has(b)) add(r, 'points', `"${pts.get(a)}" and "${pts.get(b)}" are both count points on SICT's "${r.name}"`);
      }
    }
    if (!found.size) { unmatched.push(x.n); continue; }
    for (const { r, via, evidence } of found.values()) {
      const nums = [...new Set((r.keys.length ? r.keys : [r.key]).filter((k) => /^MEX-/.test(k)).map((k) => k.replace(/^MEX-0*/, '').replace(/D$/, '').padStart(3, '0')))];
      const routes = federal.filter((f) => nums.includes(f.num) && f.states.includes(r.st)).map((f) => f.id);
      const prior = previous.get(`${x.n}|${r.st}|${r.name}`);
      proposals.push({
        title: x.n,
        object: x.object,
        via,
        evidence,
        sict: { st: r.st, name: r.name, key: r.key, juris: r.juris, toll: r.toll },
        routes,
        note: routes.length ? null : r.juris === 'state' ? 'a state road; concessions here are federal' : 'no atlas federal route by that number in this state',
        approved: prior?.approved ?? null,
      });
    }
  }

  const out = {
    generated: new Date().toISOString().slice(0, 10),
    method: 'Place names in each title are compared with the road names in SICT Datos Viales 2025 (content/reference/mx-designations.json) and the count points in SICT Datos Viales (content/reference/mx-traffic.json), in the states the title names. "road": the title writes the name SICT gives the road. "points": both places of a pair the title writes are count points on one SICT road. A proposal is attached to its routes only when approved is true.',
    counts: { titlesWithoutNumber: mx.titles.filter((x) => !x.numbers.length).length, proposed: new Set(proposals.map((p) => p.title)).size, unmatched: unmatched.length },
    unmatched,
    proposals,
  };
  await writeFile(OUT, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`${out.counts.proposed} titles with proposals, ${proposals.length} proposals; ${unmatched.length} titles unmatched`);
  for (const p of proposals) console.log(`  ${p.title}\t${p.via}\t${p.sict.st} ${p.sict.key}\t${p.routes.join(',') || '-'}\t${p.evidence}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
