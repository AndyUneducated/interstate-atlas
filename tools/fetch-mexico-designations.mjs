// Fetches Mexico's published list of designated highways from SICT's Datos
// Viales, state by state, into content/reference/.
//
//   node tools/fetch-mexico-designations.mjs
//   node tools/fetch-mexico-designations.mjs --check
//
// Why a second Mexican source exists at all
// ─────────────────────────────────────────
// The road file - INEGI's Red Nacional de Caminos - is the geometry, and its
// CODIGO column is the only route number in it. How completely that column is
// filled in varies enormously by state: 93% of Chihuahua's carretera
// kilometres carry a parseable number against 0.7% of Tlaxcala's. Read from
// the road file alone there is no way to tell which of two explanations is
// true, and they mean opposite things:
//
//   the numbers exist and INEGI did not record them, in which case the atlas
//   is missing data and should say so apologetically; or
//
//   the numbers were never assigned, in which case the atlas is complete and
//   the absence is a fact about Mexico worth stating.
//
// INEGI's own technical document leans towards the first reading - §6.1 item 7
// says state and municipal codes were compiled with state governments "en la
// medida de lo posible" - but it does not settle it.
//
// This source settles it. Datos Viales is compiled by a different part of a
// different ministry, by field survey rather than by cartographic compilation,
// and every highway in it carries an official RUTA key. Where it agrees with
// the road file that a road has no number, two independent agencies say so.
//
// What this is not: a kilometre inventory. Datos Viales covers the roughly
// 73,000 km network SICT counts traffic on, so a road absent from it is not
// thereby undesignated. It is an authoritative list of designations, and it is
// read here for designations only. Lengths and geometry stay with the RNC.
//
// The shape of the source
// ───────────────────────
// One PDF per federal entity, thirty-two of them, plus an introduction volume
// and one further volume that this script does not read - the permanent
// counting stations in the 2024 edition, the toll plazas in the 2025 one.
// Each state volume opens with an index that groups the state's highways under
// headings and gives each one an official key:
//
//   RED FEDERAL LIBRE                                    free federal
//   RED FEDERAL DE CUOTA                                 tolled federal
//   RED FEDERAL INTEGRADA POR TRAMOS LIBRES Y DE CUOTA   federal, part tolled
//   RED ESTATAL LIBRE                                    free state
//   RED ESTATAL DE CUOTA                                 tolled state
//   CARRETERAS INTEGRADAS POR TRAMOS FEDERALES Y          one road, two
//     ESTATALES                                            jurisdictions
//
// The headings are parsed rather than matched against that list, because a
// list written down here is a list that silently stops being true. Anything
// unrecognised is reported and its roads are carried with no jurisdiction
// rather than filed under a guess.
//
// Reading a PDF table, and why the naive way is wrong
// ──────────────────────────────────────────────────
// The index is typeset in two columns. Taken in the order the text appears in
// the file, the two columns interleave - road 1 is followed by road 49 - so
// the layout has to be reconstructed from coordinates rather than trusted.
// The column boundaries come from the repeated "NO. INDICE CARRETERA" header
// on each page, so a state typeset in one column or three needs no special
// case, and the RUTA cell is identified by sitting under that column's own
// RUTA header rather than by being last on its line.
//
// Reading the keys
// ────────────────
// Most keys are one designation: MEX-180, VER-065, GTO-110D. Three other
// forms appear and each says something.
//
//   VER, OAX, TLAX      a state highway with no number. This is the finding.
//   MEX-D, GRO-D        tolled, and still no number.
//   HGO-051-VER-113     one road carrying a different number in each of two
//                       states, which is the Trans-Canada problem in Spanish.
//   MEX-OAX-161         federal and state jointly, with one number. Which of
//                       the two prefixes owns the 161 is not stated, so it is
//                       recorded as shared and not resolved.
//
// The raw key is always kept. The parse is a convenience, and every key that
// names more than one prefix is flagged so that nothing downstream can quietly
// treat a guess as a designation. Numbers are normalised through the same
// function the road file goes through, so that MEX-15D out of one source and
// MEX-015D out of the other are the same road.

import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { normaliseRoute, state } from './mexico.mjs';

const SITE = 'https://micrs.sct.gob.mx';
const PAGE = `${SITE}/index.php/infraestructura/direccion-general-de-servicios-tecnicos/datos-viales`;
const SRC = join(import.meta.dirname, 'src', 'mx', 'dv');
const OUT = join('content', 'reference', 'mx-designations.json');

// The heading that marks an index page and opens a column. Only the "NO.
// INDICE" half is matched: the 2024 edition sets the whole heading as one run
// of text, and the 2025 edition splits "CARRETERA" into a run of its own, so
// requiring both would see no index at all in the newer volumes.
const INDEX_HEAD = /^NO\.?\s*INDICE/i;
const RUTA_HEAD = /^RUTA$/i;
// Page furniture: a row made of nothing but page numbers and the word Índice.
// Recognised by content rather than by position, because the 2024 volumes
// carry the word and the 2025 volumes carry only the number. A real road row
// always has a name, so this cannot swallow one.
const FURNITURE = /^(?:Índice|\d+)(?:\s+(?:Índice|\d+))*$/i;
// Headings arrive wrapped in dashes: ---RED ESTATAL LIBRE---
const SECTION = /^-{2,}\s*(.+?)\s*-{2,}$/;

// Rows sit on a shared baseline to within a fraction of a point; 2 is slack.
const ROW_TOLERANCE = 2;
// A RUTA cell starts under its column's RUTA heading. Observed spread is well
// under a point, so 20 is generous without reaching the next column.
const RUTA_TOLERANCE = 20;

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

const size = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

/**
 * The jurisdiction and toll status a heading states.
 *
 * Derived from the words rather than matched against a list of headings, so
 * that a heading this script has never seen still lands in the right place if
 * it is made of the same vocabulary. One that is not returns nulls and gets
 * reported.
 */
function readSection(title) {
  const t = fold(title);
  const federal = /\bFEDERAL(ES)?\b/.test(t);
  const estatal = /\bESTATAL(ES)?\b/.test(t);
  const juris = federal && estatal ? 'mixed' : federal ? 'federal' : estatal ? 'state' : null;

  // "TRAMOS LIBRES Y DE CUOTA" is one road that is partly tolled, and has to
  // be tested before the bare LIBRE and CUOTA it contains.
  const toll = /LIBRES?\s+Y\s+DE\s+CUOTA/.test(t) ? 'mixed'
    : /\bDE\s+CUOTA\b/.test(t) ? 'toll'
    : /\bLIBRE\b/.test(t) ? 'free'
    : null;

  return { juris, toll, recognised: juris != null };
}

/**
 * The designations a RUTA key names.
 *
 * Walks the hyphen-separated tokens keeping track of the prefix in force, so
 * that HGO-051-VER-113 comes apart into its two designations and TAB-VER comes
 * apart into two prefixes carrying no number at all. Each prefix-and-number
 * pair is then put through the road file's own normaliser, which is what makes
 * the two sources comparable.
 */
function readKey(ruta) {
  const raw = String(ruta ?? '').trim();
  if (!raw) return { raw, routes: [], prefixes: [], shared: false, numbered: false };

  const prefixes = [];
  const pairs = [];
  let prefix = null;
  let toll = false;

  for (const token of fold(raw).split('-').map((t) => t.trim()).filter(Boolean)) {
    if (/^\d+[A-Z]?$/.test(token)) {
      if (prefix) pairs.push(`${prefix}-${token}`);
      if (/D$/.test(token)) toll = true;
    } else if (/^[A-Z]$/.test(token)) {
      // A letter on its own: the D of MEX-D, a toll road with no number.
      if (token === 'D') toll = true;
    } else {
      prefix = token;
      if (!prefixes.includes(prefix)) prefixes.push(prefix);
    }
  }

  const routes = pairs.flatMap((p) => normaliseRoute(p));
  return {
    raw,
    routes,
    prefixes,
    // More than one prefix and fewer numbers than prefixes means the source
    // has not said which prefix the number belongs to.
    shared: prefixes.length > 1 && routes.length < prefixes.length,
    numbered: routes.length > 0,
    toll,
  };
}

/**
 * The state volumes one edition's landing page lists.
 *
 * The filenames are not parsed against a pattern, because the publisher
 * changes it: the 2024 edition names its volumes `30_VER_DV2024.pdf` and the
 * 2025 edition names the same state `30_DV2025_Veracruz.pdf` - abbreviation
 * swapped for the spelled-out name and the order reversed. So only the two
 * things that have stayed put are relied on, the two-digit INEGI key that
 * starts the filename and the DVyyyy token somewhere inside it, and whatever
 * else is in there is carried along as a label.
 */
async function resolveVolumes(year) {
  const res = await fetch(`${PAGE}/${year}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from the Datos Viales ${year} page`);
  const html = await res.text();

  const found = new Map();
  for (const m of html.matchAll(/["']([^"']*Datos_Viales_(\d{4})\/(\d{2})_([^"'/]+?)\.pdf)["']/gi)) {
    const [, href, folder, key, tail] = m;
    // 00 is the introduction, and 33 is a volume of its own that has been the
    // permanent counting stations in one edition and the toll plazas in the
    // next. Neither is a federal entity and neither carries a highway index.
    const st = state(key);
    if (!st || st.code === 'FED') continue;
    const edition = Number(/DV(\d{4})/i.exec(tail)?.[1] ?? folder);
    const label = tail.replace(/_?DV\d{4}_?/i, '') || key;
    found.set(key, {
      key,
      state: st,
      label,
      edition,
      url: href.startsWith('http') ? href : `${SITE}${href.startsWith('/') ? '' : '/'}${href}`,
      file: join(SRC, `${key}_${label}_DV${edition}.pdf`),
    });
  }
  return [...found.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * The most recent edition on the site.
 *
 * Found by asking rather than by being told, so that the next December's
 * publication is picked up without an edit. Walks back from this year because
 * an edition is named for the year it is published in, not the year it counts
 * traffic for, so the current year's volume may not exist yet.
 */
async function latestEdition(from) {
  for (let year = from; year >= 2024; year--) {
    try {
      const volumes = await resolveVolumes(year);
      if (volumes.length) return { year, volumes };
    } catch { /* that edition is not published under this path */ }
  }
  throw new Error('no Datos Viales edition could be resolved');
}

/** The volume on disk, downloaded if it is not there yet. */
async function pdfBytes(vol) {
  try {
    const st = await stat(vol.file);
    if (st.size > 0) return { data: await readFile(vol.file), bytes: st.size, cached: true };
  } catch { /* not downloaded yet */ }

  const res = await fetch(vol.url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const data = Buffer.from(await res.arrayBuffer());
  if (!data.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw new Error(`not a PDF (${data.length} bytes; the host may have served an error page)`);
  }
  await mkdir(SRC, { recursive: true });
  await writeFile(vol.file, data);
  return { data, bytes: data.length, cached: false };
}

/**
 * One page's text as rows of cells, laid out by coordinate.
 *
 * Returns null for a page that is not part of the index, which is how the
 * caller knows where the index stops.
 */
async function readIndexPage(page) {
  const items = (await page.getTextContent()).items
    .filter((it) => it.str && it.str.trim())
    .map((it) => ({ text: it.str.trim(), x: it.transform[4], y: it.transform[5] }));

  const heads = items.filter((it) => INDEX_HEAD.test(it.text)).sort((a, b) => a.x - b.x);
  if (!heads.length) return null;

  // Each heading opens a column that runs to the next heading's left edge. The
  // first is nudged left so that a cell typeset a point or two outside it is
  // not pushed into nowhere.
  const bounds = heads.map((h, i) => ({
    from: i === 0 ? h.x - 10 : h.x,
    to: heads[i + 1]?.x ?? Infinity,
    ruta: null,
  }));
  for (const r of items.filter((it) => RUTA_HEAD.test(it.text))) {
    const col = bounds.find((b) => r.x >= b.from && r.x < b.to);
    if (col) col.ruta = r.x;
  }

  const headY = Math.max(...heads.map((h) => h.y));
  const rows = [];
  for (const col of bounds) {
    const byRow = new Map();
    for (const it of items) {
      // Above the heading is the running title; the heading row itself is not
      // data. The running footer is dropped below, by what it says.
      if (it.y >= headY - ROW_TOLERANCE) continue;
      if (it.x < col.from || it.x >= col.to) continue;
      const key = [...byRow.keys()].find((y) => Math.abs(y - it.y) <= ROW_TOLERANCE) ?? it.y;
      (byRow.get(key) ?? byRow.set(key, []).get(key)).push(it);
    }
    for (const [y, cells] of [...byRow].sort((a, b) => b[0] - a[0])) {
      rows.push({ y, cells: cells.sort((a, b) => a.x - b.x), ruta: col.ruta });
    }
  }
  return rows;
}

/**
 * The index of one state volume, as roads under headings.
 *
 * Anything that does not parse is collected rather than dropped, because a
 * silently skipped row in a source read for completeness is the one failure
 * mode that would make the whole exercise say the opposite of the truth.
 */
async function readVolume(vol, data) {
  const doc = await getDocument({ data: new Uint8Array(data), useSystemFonts: true }).promise;
  const roads = [];
  const sections = [];
  const odd = [];
  let section = null;
  let pages = 0;

  for (let p = 1; p <= doc.numPages; p++) {
    const rows = await readIndexPage(await doc.getPage(p));
    // The index is the front matter. Once it has started and stopped, the rest
    // of the volume is traffic tables and maps.
    if (!rows) { if (pages) break; else continue; }
    pages++;

    for (const { cells, ruta } of rows) {
      const joined = cells.map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim();
      if (FURNITURE.test(joined)) continue;
      const head = SECTION.exec(joined);
      if (head) {
        section = { title: head[1], ...readSection(head[1]) };
        sections.push(section);
        continue;
      }

      // The RUTA cell is the one under this column's RUTA heading. A row whose
      // rightmost cell is not there is a wrapped name, not a keyed road.
      const last = cells[cells.length - 1];
      const keyed = cells.length > 1 && ruta != null && Math.abs(last.x - ruta) <= RUTA_TOLERANCE;
      if (!keyed) { odd.push({ page: p, text: joined }); continue; }

      const name = cells.slice(0, -1).map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim();
      const m = /^(\d+)\s+(.+)$/.exec(name);
      if (!m || !section) { odd.push({ page: p, text: joined }); continue; }

      roads.push({ index: Number(m[1]), name: m[2], section, key: readKey(last.text) });
    }
  }

  return { roads, sections, odd, indexPages: pages, pages: doc.numPages };
}

const tally = (roads) => {
  const numbered = roads.filter((r) => r.key.numbered).length;
  return { roads: roads.length, numbered, unnumbered: roads.length - numbered };
};

async function main() {
  const check = process.argv.includes('--check');
  const asked = Number(process.argv.find((a) => /^\d{4}$/.test(a)));

  const { year, volumes } = asked
    ? { year: asked, volumes: await resolveVolumes(asked) }
    : await latestEdition(new Date().getUTCFullYear());

  console.log(`SICT Datos Viales ${year}: ${volumes.length} state volumes listed\n`);
  if (volumes.length !== 32) {
    console.log(`  note: 32 federal entities expected, ${volumes.length} found\n`);
  }
  if (check) {
    for (const v of volumes) console.log(`  ${v.key} ${v.state.name.padEnd(22)} ${v.url}`);
    return;
  }

  const rows = [];
  const states = {};
  const unrecognised = new Map();
  const unparsed = [];
  let shared = 0;

  for (const vol of volumes) {
    let got;
    try {
      got = await pdfBytes(vol);
    } catch (e) {
      console.log(`  ${vol.key} ${vol.state.name.padEnd(22)} download failed: ${e.message}`);
      states[vol.key] = { state: vol.state.name, code: vol.state.code, error: e.message };
      continue;
    }

    const { roads, sections, odd, indexPages, pages } = await readVolume(vol, got.data);
    for (const s of sections) {
      if (!s.recognised) unrecognised.set(s.title, (unrecognised.get(s.title) ?? 0) + 1);
    }
    for (const o of odd) unparsed.push({ state: vol.state.code, ...o });

    const byJuris = {};
    for (const juris of ['federal', 'state', 'mixed', null]) {
      const of = roads.filter((r) => r.section.juris === juris);
      if (of.length) byJuris[juris ?? 'unclassified'] = tally(of);
    }

    for (const r of roads) {
      if (r.key.shared) shared++;
      rows.push([
        vol.state.code,
        r.index,
        r.section.juris,
        r.section.toll,
        r.name,
        r.key.raw,
        r.key.routes.map((x) => `${x.prefix}-${x.number}`),
        r.key.shared || null,
      ]);
    }

    states[vol.key] = {
      state: vol.state.name,
      code: vol.state.code,
      url: vol.url,
      pages,
      indexPages,
      ...tally(roads),
      byJuris,
      unparsedRows: odd.length,
    };

    const st = byJuris.state ?? { roads: 0, numbered: 0 };
    console.log(`  ${vol.key} ${vol.state.name.padEnd(22)} ${String(roads.length).padStart(4)} roads`
      + `  state tier ${String(st.roads).padStart(3)}, ${String(st.numbered).padStart(3)} numbered`
      + `  ${size(got.bytes).padStart(7)}${got.cached ? ' (cached)' : ''}`
      + `${odd.length ? `  ${odd.length} rows unparsed` : ''}`);
  }

  const stateTier = rows.filter((r) => r[2] === 'state');
  const numberedStates = Object.values(states)
    .filter((s) => (s.byJuris?.state?.numbered ?? 0) > 0).length;
  const retrieved = new Date().toISOString().slice(0, 10);

  await mkdir(join('content', 'reference'), { recursive: true });
  await writeFile(OUT, `${JSON.stringify({
    source: 'Secretaría de Infraestructura, Comunicaciones y Transportes (SICT), '
      + `Dirección General de Servicios Técnicos, Datos Viales ${year}`,
    agency: 'SICT',
    url: `${PAGE}/${year}`,
    licence: null,
    // The machine-readable traffic release of the same programme carries Libre
    // Uso MX. These PDFs carry no licence statement that could be found on
    // them or on the page that lists them, so none is claimed here.
    licenceNote: 'No licence statement appears on the per-state PDFs or on the page '
      + 'listing them. The Datos Viales traffic release on datos.gob.mx carries '
      + 'Términos de Libre Uso MX; whether it extends to these volumes is not stated.',
    citation: `Datos Viales ${year}, SICT, ${PAGE}/${year}, ${retrieved}`,
    edition: year,
    retrieved,
    read: 'The highway index at the front of each state volume. The traffic tables '
      + 'inside the volumes, and the separate volume published alongside them, are '
      + 'not read here.',
    coverageKm: 73000,
    purpose: 'An independent statement of which Mexican highways carry a route '
      + 'designation, against which the Red Nacional de Caminos CODIGO column can '
      + 'be checked. Read for designations only; lengths and geometry stay with the RNC.',
    limitations: {
      notAnInventory: 'Datos Viales covers the network SICT surveys traffic on, about '
        + '73,000 km. A highway absent from it is not thereby undesignated, so this '
        + 'source can confirm that a number exists but cannot prove that none does.',
      sharedKeys: {
        rows: shared,
        note: 'Keys naming more than one jurisdiction without a number for each, such '
          + 'as MEX-OAX-161. The source does not say which prefix the number belongs '
          + 'to, so these are flagged rather than resolved.',
      },
      unparsedRows: {
        rows: unparsed.length,
        note: 'Index rows that did not resolve to a numbered road under a heading. '
          + 'Listed in full rather than dropped, so that the completeness claim this '
          + 'file exists to support can be audited.',
        rowsByState: Object.fromEntries(
          Object.entries(unparsed.reduce((a, o) => ({ ...a, [o.state]: (a[o.state] ?? 0) + 1 }), {}))),
        sample: unparsed.slice(0, 40),
      },
      unrecognisedSections: Object.fromEntries(unrecognised),
      alsoPublished: 'Each edition includes an introduction volume and one further '
        + 'volume, neither read by this script: traffic recorded at the permanent '
        + 'counting stations in the 2024 edition, the toll plazas in the 2025 one.',
      editionYear: 'Editions are named for the year they are published in, not the '
        + 'year they describe, and the designations here are those the named edition '
        + 'lists. Anything joining this to the traffic release should establish the '
        + 'data year from the publisher rather than from the edition number.',
    },
    finding: {
      statesWithNumberedStateRoutes: numberedStates,
      statesTotal: Object.keys(states).length,
      stateTierRoads: stateTier.length,
      stateTierNumbered: stateTier.filter((r) => r[6].length).length,
      note: 'Where this source and the Red Nacional de Caminos agree that a state '
        + 'highway carries no number, two agencies working from different methods '
        + 'say the same thing, and the absence of a number is a fact about the road '
        + 'rather than a gap in the data.',
    },
    fields: ['st', 'index', 'juris', 'toll', 'name', 'ruta', 'routes', 'shared'],
    states,
    roads: rows,
  }, null, 1)}\n`);

  console.log(`\nwrote ${OUT}: ${rows.length} designated highways across ${Object.keys(states).length} states`);
  console.log(`  state tier: ${stateTier.length} roads, ${stateTier.filter((r) => r[6].length).length} numbered`
    + `, in ${numberedStates} of ${Object.keys(states).length} states`);
  if (shared) console.log(`  ${shared} keys name two jurisdictions without a number for each`);
  if (unparsed.length) console.log(`  ${unparsed.length} index rows did not parse and are listed in the output`);
  for (const [title, n] of unrecognised) console.log(`  unrecognised heading (${n}x): ${title}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
