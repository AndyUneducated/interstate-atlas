// Cross-checks the route numbers the atlas carries for Mexico against the ones
// SICT publishes, and writes content/reference/mx-crosscheck.json.
//
// The atlas numbers Mexican roads from CODIGO in INEGI's Red Nacional de
// Caminos. SICT's Datos Viales index keys every road it counts traffic on with
// a RUTA of its own (content/reference/mx-designations.json). The two agencies
// number independently, so where both give a road a number the two can be
// compared, and where they differ neither can be called wrong from here.
//
// What is compared
// ────────────────
// Every numbered key in the SICT index, per state:
//
//   federal   MEX-nnn against the federal routes the atlas runs through that
//             state, on the number alone.
//
//   state     the state's own prefix against the atlas's state routes. SICT's
//             prefixes are its own - CHIH, EM, QR - and each is assigned to
//             the state whose volume it appears in most, as the traffic join
//             in build-data.mjs does.
//
// On both tiers the D of a toll road is dropped from both sides, because
// CODIGO very nearly never carries it (see readRedVial in mexico.mjs) and the
// comparison would otherwise report every autopista as missing.
//
// A state key is also checked by name, because the same number on both sides
// does not make it the same road. SICT names a road by its termini, "Culiacán
// - Altata"; the RNC names each segment the same way. A key matches an atlas
// route when every terminus SICT gives is found in one of the route's segment
// names, compared with accents, spaces and punctuation removed so that "El
// Dorado" and "Eldorado" meet. Parenthesised text - (Cuota), T. C. (Toluca -
// Palmillas), E.C. (San Luis Río Colorado - Golfo de Santa Clara) - is dropped
// from both sides first, since it names the road being left rather than this
// one, and left in it matches every spur off a busy road.
//
// That gives each state key one of four verdicts:
//
//   agree            same number, and the names match
//   otherNumber      the names match a route the atlas numbers differently
//   numberOnly       the number exists but no name matches anywhere
//   notFound         neither
//
// numberOnly is not a disagreement. It is most often a name that one source
// spells out and the other abbreviates, and it is reported so that it can be
// looked at rather than counted either way.
//
// What is not compared: roads the atlas carries that SICT does not list. The
// SICT index covers the roads SICT counts traffic on, not the network, so an
// atlas route missing from it says nothing.

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const OUT = join('content', 'reference', 'mx-crosscheck.json');
const read = async (p) => JSON.parse(await readFile(join(ROOT, p), 'utf8'));

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
const squash = (s) => fold(s).replace(/[^A-Z]/g, '');
const unbracket = (s) => String(s ?? '').replace(/\([^)]*\)/g, ' ');
const bare = (n) => n.replace(/D$/, '');

// Words that say what kind of road a name is rather than where it goes.
const FILLER = /^(?:RAMAL A|ACCESO A|ENT\.?|EST\.?|E\.? ?C\.?|T\.? ?C\.?|LIBRAMIENTO(?: DE)?|CARRETERA)\s+/;

/** The places a SICT road name runs between, squashed for comparison. */
function termini(name) {
  return fold(unbracket(name))
    .split(/\s+-\s+/)
    .map((t) => squash(t.trim().replace(FILLER, '')))
    .filter((t) => t.length >= 4);
}

const matches = (ends, names) => ends.length > 0 && names.some((n) => ends.every((e) => n.includes(e)));

async function main() {
  const sict = await read('content/reference/mx-designations.json');
  const F = Object.fromEntries(sict.fields.map((f, i) => [f, i]));

  const votes = new Map();
  for (const r of sict.roads) for (const k of r[F.routes]) {
    const [pre] = k.split('-');
    if (pre === 'MEX' || pre === 'null') continue;
    const v = votes.get(pre) ?? votes.set(pre, new Map()).get(pre);
    v.set(r[F.st], (v.get(r[F.st]) ?? 0) + 1);
  }
  const owner = new Map([...votes].map(([p, v]) => [p, [...v].sort((a, b) => b[1] - a[1])[0][0]]));

  // st -> num -> SICT names, per tier
  const keys = { state: new Map(), federal: new Map() };
  for (const r of sict.roads) for (const k of r[F.routes]) {
    const [pre, num] = k.split('-');
    if (!/^\d/.test(num ?? '')) continue;
    const tier = pre === 'MEX' ? 'federal' : owner.get(pre) === r[F.st] ? 'state' : null;
    if (!tier) continue;
    const byNum = keys[tier].get(r[F.st]) ?? keys[tier].set(r[F.st], new Map()).get(r[F.st]);
    const n = bare(num);
    (byNum.get(n) ?? byNum.set(n, []).get(n)).push(r[F.name]);
  }

  const federal = new Map();
  for (const f of (await read('data/geo/mx/federal.json')).features) {
    for (const s of f.properties.states) {
      (federal.get(s.st) ?? federal.set(s.st, new Set()).get(s.st)).add(bare(f.properties.num));
    }
  }

  // st -> num -> squashed segment names, merged over every piece of the number
  const state = new Map();
  for (const file of await readdir(join(ROOT, 'data', 'geo', 'mx', 'state'))) {
    for (const f of (await read(join('data', 'geo', 'mx', 'state', file))).features) {
      const p = f.properties;
      const names = [...(p.named ?? []), p.start?.name, p.end?.name].filter(Boolean).map((n) => squash(unbracket(n)));
      const byNum = state.get(p.st) ?? state.set(p.st, new Map()).get(p.st);
      const num = bare(p.num);
      byNum.set(num, [...(byNum.get(num) ?? []), ...names]);
    }
  }

  const byState = {};
  const disagreements = [];
  const total = { state: {}, federal: { present: 0, absent: 0 } };
  const states = [...new Set([...keys.state.keys(), ...keys.federal.keys()])].sort();

  for (const st of states) {
    const row = byState[st] = { state: { agree: 0, otherNumber: 0, numberOnly: 0, notFound: 0 }, federal: { present: 0, absent: [] } };

    for (const [num, names] of keys.state.get(st) ?? []) {
      const ends = names.map(termini);
      const ours = state.get(st) ?? new Map();
      const hit = (segs) => ends.some((e) => matches(e, segs));
      const elsewhere = [...ours].filter(([n, segs]) => n !== num && hit(segs)).map(([n]) => n).sort();
      const verdict = ours.has(num) && hit(ours.get(num)) ? 'agree'
        : elsewhere.length ? 'otherNumber'
        : ours.has(num) ? 'numberOnly'
        : 'notFound';
      row.state[verdict]++;
      total.state[verdict] = (total.state[verdict] ?? 0) + 1;
      if (verdict !== 'agree') {
        disagreements.push({ st, sict: num, name: [...new Set(names)].join(' / '), verdict, atlas: elsewhere.length ? elsewhere : null });
      }
    }

    for (const num of [...(keys.federal.get(st) ?? new Map()).keys()].sort()) {
      if (federal.get(st)?.has(num)) { row.federal.present++; total.federal.present++; }
      else { row.federal.absent.push(`MEX-${num}`); total.federal.absent++; }
    }
  }

  await writeFile(join(ROOT, OUT), `${JSON.stringify({
    purpose: 'Route numbers in the atlas (INEGI RNC CODIGO) checked against SICT Datos Viales RUTA keys, per state.',
    sources: {
      atlas: 'data/geo/mx, built from INEGI Red Nacional de Caminos',
      sict: { file: 'content/reference/mx-designations.json', edition: sict.edition, citation: sict.citation },
    },
    method: [
      'The toll suffix D is dropped on both sides: the RNC very nearly never carries it.',
      'Federal keys are compared on the number alone.',
      'State keys are compared on the number and on the termini SICT names, which must all appear in one of the atlas route\'s segment names. Parenthesised text is dropped from both before comparing.',
      'Roads the atlas carries and SICT does not list are not compared: the SICT index covers counted roads, not the network.',
    ],
    verdicts: {
      agree: 'same number, names match',
      otherNumber: 'names match an atlas route with a different number',
      numberOnly: 'the number exists in the atlas but no name matches',
      notFound: 'no atlas route with this number or these names',
    },
    total,
    byState,
    disagreements,
  }, null, 1)}\n`);

  console.log(`wrote ${OUT}`);
  console.log(`  state keys: ${Object.entries(total.state).map(([k, v]) => `${v} ${k}`).join(', ')}`);
  console.log(`  federal keys: ${total.federal.present} present, ${total.federal.absent} absent`);
  const worst = Object.entries(byState)
    .map(([st, r]) => [st, r.state.otherNumber, Object.values(r.state).reduce((a, b) => a + b, 0)])
    .filter(([, o]) => o > 0)
    .sort((a, b) => b[1] - a[1]);
  console.log(`  otherNumber by state: ${worst.map(([st, o, n]) => `${st} ${o}/${n}`).join(', ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
