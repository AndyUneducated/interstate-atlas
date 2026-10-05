// Reads SICT's register of federal road concession titles into
// content/reference/mx-concessions.json.
//
//   node tools/fetch-mx-concessions.mjs
//
// The register is an HTML table on SICT's Dirección General de Desarrollo
// Carretero site, one row per title: what was conceded, the states, the
// concessionaire, the date granted and the date it ends. It is not a list of
// toll roads. Some titles are for building a new road and tolling it; others
// are contracts to operate and maintain a free road that already existed, or
// to run one border bridge.
//
// Two things it does not give, and this does not supply:
//
// When a road opened. A title is granted before construction starts, so for a
// title to build a road its grant date bounds the opening from below - the
// road opened no earlier than that - and says nothing more. For a title over a
// road that already existed it bounds nothing, and is not used that way.
//
// Which road. The description names the road in words: "la carretera Peñón-
// Texcoco", "el Libramiento de Irapuato". A route number appears in only a few
// rows, and only those are tied to an atlas route, by that number in the states
// the row names. The rest are kept here, unlinked, rather than matched by name.

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { state } from './mexico.mjs';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'content', 'reference', 'mx-concessions.json');
const PAGE = 'https://micrs.sct.gob.mx/infraestructura/direccion-general-de-desarrollo-carretero/titulos-de-concesion/';
const ORIGIN = 'https://micrs.sct.gob.mx';

// "carretera federal 2", "carretera federal número Mex 2", "mex-85".
const NUMBER = /(?:carretera\s+federal\s+(?:n[úu]mero\s+|no\.?\s*)?(?:m[eé]x[\s.-]*)?|\bm[eé]x[\s.-]*)(\d{1,3})(\s*D\b)?/gi;
// A title that begins by building something. One that begins by operating,
// modernising or rehabilitating a road was granted over a road already there.
const BUILDS = /^\W*(?:\(i\)\s*)?constru/i;

async function page() {
  const res = await fetch(PAGE, { headers: { 'user-agent': 'Mozilla/5.0 (highway-atlas data build)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${PAGE}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const utf8 = new TextDecoder('utf-8').decode(buf);
  return utf8.includes('\uFFFD') ? new TextDecoder('windows-1252').decode(buf) : utf8;
}

const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"').replace(/\uFFFD/g, '').replace(/\s+/g, ' ').trim();

/** dd/mm/yyyy to ISO, or null for a cell that is blank or malformed. */
function isoDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

/** The states a row names, as atlas codes; "Varios" names none. */
function states(cell) {
  const out = [];
  for (const part of cell.split(/,|\s+y\s+/i)) {
    const name = part.replace(/^\s*(?:CD\.|Edo\.)\s*de\s*/i, (m) => (/cd/i.test(m) ? 'Ciudad de ' : 'Estado de ')).trim();
    const s = state(name);
    if (s?.code && s.code !== 'FED' && !out.includes(s.code)) out.push(s.code);
  }
  return out;
}

async function main() {
  const html = await page();
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]))
    .filter((r) => r.length >= 5);
  const [head, ...body] = rows;
  if (!/OBJETO/i.test(text(head[0])) || !/OTORGAMIENTO/i.test(text(head[3]))) {
    throw new Error('the register table has changed shape; check the column order');
  }

  const unnamed = [];
  const titles = body.map((r, i) => {
    const object = text(r[0]);
    const numbers = [];
    for (const m of object.matchAll(NUMBER)) {
      const n = m[1].padStart(3, '0') + (m[2] ? 'D' : '');
      if (!numbers.includes(n)) numbers.push(n);
    }
    const entidad = text(r[1]);
    const codes = states(entidad);
    if (!codes.length && !/^varios$/i.test(entidad)) unnamed.push(entidad);
    const doc = /href="([^"]+)"/.exec(r[5] ?? '')?.[1] ?? null;
    return {
      n: i + 1,
      object,
      entidad,
      states: codes,
      concessionaire: text(r[2]),
      granted: isoDate(text(r[3])),
      ends: isoDate(text(r[4])),
      builds: BUILDS.test(object),
      numbers,
      document: doc ? new URL(doc, ORIGIN).href : null,
    };
  });

  const out = {
    retrieved: new Date().toISOString().slice(0, 10),
    source: {
      title: 'Títulos de Concesión',
      agency: 'Secretaría de Infraestructura, Comunicaciones y Transportes (SICT), Dirección General de Desarrollo Carretero',
      url: PAGE,
      licence: 'none stated on the page',
    },
    note: 'A grant date bounds an opening from below only for a title to build; it is not an opening date. '
      + 'Titles are tied to atlas routes only where the description writes a federal route number.',
    counts: {
      titles: titles.length,
      builds: titles.filter((x) => x.builds).length,
      numbered: titles.filter((x) => x.numbers.length).length,
    },
    titles,
  };
  await writeFile(OUT, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`concessions: ${out.counts.titles} titles, ${out.counts.builds} to build, ${out.counts.numbered} name a route number`);
  for (const x of titles.filter((t) => t.numbers.length)) {
    console.log(`  ${x.numbers.join(',')} ${x.states.join('/')} ${x.granted} ${x.builds ? 'builds' : 'operates'}: ${x.object.slice(0, 110)}`);
  }
  if (unnamed.length) console.log(`  states not recognised: ${[...new Set(unnamed)].join('; ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
