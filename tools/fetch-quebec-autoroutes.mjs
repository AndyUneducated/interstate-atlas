// Fetches the Répertoire des autoroutes du Québec into content/reference/.
//
//   node tools/fetch-quebec-autoroutes.mjs
//
// The American half of the buildout timeline runs on a federal record of when
// each Interstate segment opened. Canada has nothing like it. Highway history
// is provincial, and almost no province publishes when its road opened - the
// National Highway System inventory reports length, travel and condition, but
// never a date.
//
// Québec is the exception, and this page is the whole of it: for every
// autoroute, and for every tronçon within it, the ministry publishes the name,
// the described extent, a length in kilometres and the year it opened to
// traffic. It is the only Canadian source that can date a segment, which is
// why a page that renders its table in JavaScript is worth driving a browser
// for.
//
// Four things about the source shape what can honestly be taken from it:
//
//   * The length column is headed "Long. en km de la description" - it
//     measures the described section, not the tronçon, and the same figure is
//     repeated on every one of that section's segment rows. Per-segment
//     lengths are not published. Adding up rows would multiply the network by
//     however many segments each section happens to have, so lengths are
//     carried on the section and the total is taken there once.
//   * The autoroute number is not text. It is a GIF of the route shield with
//     no alt attribute, so the number has to be read out of the filename. A
//     row whose filename does not parse gets no number rather than a guessed
//     one, and main() reports how many.
//   * An opening year is sometimes a span - the ministry's own year filter
//     offers "1975-1979" as a value. A span is kept as a span. Collapsing it
//     to one year would be inventing a date the ministry declined to give.
//   * Some tronçon cells carry a trailing "Note:" that qualifies the year,
//     and those notes are the answer to whether "ouverture à la circulation"
//     means what the US side means by open to traffic. Two families of them
//     matter: "2e chaussée ouverte en ..." dates a second carriageway years
//     after the segment's own year, and "Ouvert à la circulation sous le nom
//     de ..." says the road already carried traffic under a boulevard name
//     before the year given. They are kept verbatim.
//
// The site is behind a filter that answers a default headless user agent with
// 403, so the context below presents itself as an ordinary French-language
// browser. Nothing else about the request is disguised.

import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const URL = 'https://www.transports.gouv.qc.ca/fr/projets-infrastructures/info-reseau-routier'
  + '/repertoire-autoroutes/Pages/repertoire-des-autoroutes-du-Quebec.aspx';
const OUT = join(import.meta.dirname, '..', 'content', 'reference', 'qc-autoroutes.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)'
  + ' Chrome/131.0.0.0 Safari/537.36';

// Checked rather than assumed: if the ministry relabels or reorders the
// columns, every field below would land one cell out, and silently.
const HEAD = ['No', 'Nom', 'Description', 'Long. en km de la description', 'Ouverture à la circulation'];
const SUBHEAD = ['Tronçon', 'Année'];

// Collapses runs of whitespace, including the non-breaking spaces French
// typography puts before punctuation, and leaves every other character alone.
// Diacritics, the œ ligature and the typographic apostrophes the page mixes
// with ASCII ones all have to survive: the atlas shows these names in both
// language modes, so a mangled character would be on screen.
const text = (s) => String(s ?? '').replace(/[\s\u00a0]+/g, ' ').trim();

// The shield image is the only place the route number appears.
const routeNumber = (src) => /\/r(\d+)\.gif$/i.exec(String(src ?? ''))?.[1] ?? null;

// French decimal comma. Anything that is not purely a number is not a length.
const km = (s) => {
  const t = text(s).replace(/\s/g, '').replace(',', '.');
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

/**
 * One published opening year, in whatever form the ministry gave it.
 *
 * A bare year becomes `year`. A span becomes `yearFrom`/`yearTo` and no
 * `year`, so that nothing downstream can mistake it for a date. Anything else
 * - including an empty cell - keeps the published string and carries no
 * number at all, and is counted as a segment without a year.
 */
const opening = (s) => {
  const raw = text(s);
  if (!raw) return { published: null };
  const one = /^(\d{4})$/.exec(raw);
  if (one) return { published: raw, year: Number(one[1]) };
  const span = /^(\d{4})\s*[-–]\s*(\d{4})$/.exec(raw);
  if (span) return { published: raw, yearFrom: Number(span[1]), yearTo: Number(span[2]) };
  return { published: raw };
};

// The notes are appended to the tronçon description as one cell. Splitting
// them off is reversible - segment + ' ' + note is the published cell - and
// keeps the note where the site can quote it as a qualification of the year.
const NOTE_RE = /\s*(Note\s*:.*)$/s;

/**
 * Mis-decoded French is the failure mode that would show on screen, so the
 * encoding is established from evidence rather than taken on trust: what the
 * server declared, what the document declared, what the browser settled on,
 * and - the only one that actually proves anything - whether the extracted
 * text contains the wreckage of a wrong decode.
 *
 * U+FFFD means bytes were thrown away. The "Ã©" family means UTF-8 bytes were
 * read as Latin-1. Either one makes the whole extraction untrustworthy, so it
 * throws instead of writing a file full of mojibake.
 */
function checkEncoding(strings, declared) {
  const joined = strings.join('\n');
  const replacement = (joined.match(/\uFFFD/g) ?? []).length;
  const mojibake = (joined.match(/[ÃÂ][\u0080-\u00bf]/g) ?? []).length;
  // A positive control: these words are on the page and are spelt with the
  // accents, so seeing them intact proves the round trip, where the absence
  // of damage markers alone would only prove nothing obvious went wrong.
  const accented = ['Répertoire', 'Québec', 'tronçon', 'Année'].filter((w) => joined.includes(w));

  if (replacement || mojibake) {
    throw new Error(`text is mis-decoded: ${replacement} replacement character(s), `
      + `${mojibake} Latin-1 sequence(s); declared ${declared.http} / ${declared.document}`);
  }
  return { ...declared, replacementChars: replacement, latin1Sequences: mojibake, accentedFound: accented };
}

/** The table, the filter menus and the prose, as the browser rendered them. */
async function scrape() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    userAgent: UA,
    locale: 'fr-CA',
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: { 'accept-language': 'fr-CA,fr;q=0.9' },
  });
  const page = await ctx.newPage();

  try {
    const res = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
    if (!res?.ok()) throw new Error(`HTTP ${res?.status()} ${await page.title()}`);
    await page.waitForSelector('#TableauDynamique tbody tr', { timeout: 60000 });

    // The table paginates at ten rows. "tous" is one of its own page-length
    // options, which is cheaper and less brittle than clicking through twenty
    // pages, and it leaves the row count checkable against the count the
    // table itself prints.
    await page.selectOption('select[name="TableauDynamique_length"]', '-1');
    const reported = await page.$eval('#TableauDynamique_info', (el) => {
      const m = /sur\s+([\d\s\u00a0]+)/.exec(el.textContent ?? '');
      return m ? Number(m[1].replace(/\D/g, '')) : null;
    });
    if (reported) {
      await page.waitForFunction(
        (n) => document.querySelectorAll('#TableauDynamique tbody tr').length === n,
        reported,
        { timeout: 60000 },
      );
    }

    const scraped = await page.evaluate(() => {
      const table = document.querySelector('#TableauDynamique');
      const cellText = (c) => (c?.innerText ?? '').trim();

      return {
        head: [...(table.rows[0]?.cells ?? [])].map(cellText),
        subhead: [...(table.rows[1]?.cells ?? [])].map(cellText),
        rows: [...table.tBodies[0].rows].map((r) => ({
          cells: r.cells.length,
          img: r.cells[0]?.querySelector('img')?.getAttribute('src') ?? null,
          alt: r.cells[0]?.querySelector('img')?.getAttribute('alt') ?? null,
          name: cellText(r.cells[1]),
          description: cellText(r.cells[2]),
          length: cellText(r.cells[3]),
          segment: cellText(r.cells[4]),
          year: cellText(r.cells[5]),
        })),
        // The ministry's own filter menus: an independent list of which
        // autoroutes, names and years the directory is supposed to contain,
        // built by the same page from the same data. Comparing the table
        // against them catches a truncated read that would otherwise look
        // like a complete one.
        filters: [...document.querySelectorAll('select')]
          .filter((s) => s.name !== 'TableauDynamique_length')
          .map((s) => [...s.options].map((o) => o.value.trim())),
        paragraphs: [...document.querySelectorAll('p, li')]
          .map((p) => (p.innerText ?? '').trim())
          .filter(Boolean),
        charset: document.characterSet,
        meta: document.querySelector('meta[charset]')?.outerHTML
          ?? document.querySelector('meta[http-equiv="Content-type" i]')?.outerHTML ?? null,
      };
    });

    return { ...scraped, reported, httpCharset: res.headers()['content-type'] ?? null };
  } finally {
    await browser.close();
  }
}

/** Groups the flat rows into autoroutes and their described sections. */
function assemble(rows) {
  const autoroutes = new Map();
  const unnumbered = [];

  for (const row of rows) {
    const num = routeNumber(row.img);
    if (!num) { unnumbered.push(row); continue; }

    const a = autoroutes.get(num) ?? {
      number: Number(num),
      // Recorded because it is where the number came from, and because the
      // page carries an accessibility warning of its own: the image has no
      // alt text, so this filename is the only machine-readable form of the
      // one field that identifies the route.
      signImage: new globalThis.URL(row.img, URL).href,
      sections: new Map(),
    };
    autoroutes.set(num, a);

    const name = text(row.name);
    const description = text(row.description);
    const key = `${name}\u0000${description}`;
    const section = a.sections.get(key) ?? { name, description, lengthKm: km(row.length), segments: [] };
    // The length is a property of the section, repeated down its rows. If two
    // rows of one section ever disagree, the disagreement is recorded rather
    // than resolved by preferring whichever was read first.
    const rowKm = km(row.length);
    if (section.lengthKm != null && rowKm != null && rowKm !== section.lengthKm) {
      section.lengthNote = 'the page gives more than one length for this section: '
        + `${section.lengthKm} and ${rowKm}`;
    }
    a.sections.set(key, section);

    const cell = text(row.segment);
    const note = NOTE_RE.exec(cell)?.[1] ?? null;
    section.segments.push({
      segment: note ? cell.replace(NOTE_RE, '') : cell,
      ...(note ? { note } : {}),
      ...opening(row.year),
    });
  }

  const out = {};
  for (const [num, a] of [...autoroutes].sort((x, y) => Number(x[0]) - Number(y[0]))) {
    out[num] = { ...a, sections: [...a.sections.values()] };
  }
  return { autoroutes: out, unnumbered };
}

function summarise(autoroutes) {
  const sections = Object.values(autoroutes).flatMap((a) => a.sections);
  const segments = sections.flatMap((s) => s.segments);
  const years = segments.flatMap((s) => [s.year, s.yearFrom, s.yearTo].filter(Boolean));

  return {
    autoroutes: Object.keys(autoroutes).length,
    sections: sections.length,
    segments: segments.length,
    segmentsWithYear: segments.filter((s) => s.year != null).length,
    segmentsWithYearSpan: segments.filter((s) => s.yearFrom != null).length,
    // The shortfall, named. A segment lands here when the year cell is empty
    // or holds something this script will not read as a date, and in either
    // case the atlas must leave it out of the timeline rather than place it.
    segmentsWithoutYear: segments.filter((s) => s.year == null && s.yearFrom == null).length,
    segmentsWithNote: segments.filter((s) => s.note).length,
    yearFrom: years.length ? Math.min(...years) : null,
    yearTo: years.length ? Math.max(...years) : null,
    // Summed over sections, each once, because that is the level the ministry
    // publishes a length at.
    lengthKm: Math.round(sections.reduce((t, s) => t + (s.lengthKm ?? 0), 0) * 10) / 10,
    sectionsWithoutLength: sections.filter((s) => s.lengthKm == null).length,
  };
}

async function main() {
  console.log('fetching the Répertoire des autoroutes du Québec...');
  const page = await scrape();

  // Header check before anything is read positionally.
  const head = page.head.map(text);
  const subhead = page.subhead.map(text);
  if (HEAD.some((h, i) => head[i] !== h) || SUBHEAD.some((h, i) => subhead[i] !== h)) {
    throw new Error(`unexpected columns: ${JSON.stringify([head, subhead])}`);
  }
  const wrongWidth = page.rows.filter((r) => r.cells !== 6).length;
  if (wrongWidth) throw new Error(`${wrongWidth} row(s) do not have six cells`);
  if (page.reported && page.rows.length !== page.reported) {
    throw new Error(`the table reports ${page.reported} items but ${page.rows.length} rows were read`);
  }

  const { autoroutes, unnumbered } = assemble(page.rows);
  const coverage = summarise(autoroutes);

  const strings = page.rows.flatMap((r) => [r.name, r.description, r.segment])
    .concat(page.paragraphs, page.head, page.subhead);
  const encoding = checkEncoding(strings, {
    http: page.httpCharset,
    document: page.charset,
    meta: page.meta,
  });

  const para = (re) => page.paragraphs.find((p) => re.test(p)) ?? null;
  const sentence = (p, re) => (p ?? '').split(/(?<=\.)\s+/).map(text).find((s) => re.test(s)) ?? null;

  // Both of these are quoted rather than paraphrased. The numbering paragraph
  // is the one the atlas wants to explain the shield grid with, and it comes
  // with a limit - the ordering principle covers autoroutes 5 to 85 only -
  // that has to be quoted with it so the explainer does not overstate a rule
  // the ministry itself bounded.
  const numbering = para(/principe de numérotation/);
  const intro = para(/permet d[’']accéder aux renseignements/);

  console.log(`  encoding: HTTP ${encoding.http}; document.characterSet ${encoding.document}`);
  console.log(`            ${encoding.meta}`);
  console.log(`            ${encoding.replacementChars} replacement characters, `
    + `${encoding.latin1Sequences} Latin-1 sequences, `
    + `accented controls found: ${encoding.accentedFound.join(' ')}`);
  console.log(`  table reports ${page.reported} items; ${page.rows.length} rows read`);

  // The three filter menus are lists the page builds from the same directory,
  // so they are an independent statement of what it holds. A value offered in
  // a menu but absent from the table means the read came up short, which is
  // the failure a table that paginates at ten rows makes easy to miss.
  const sections = Object.values(autoroutes).flatMap((a) => a.sections);
  const segments = sections.flatMap((s) => s.segments);
  const menu = (re) => page.filters.find((o) => o.length && o.every((v) => re.test(v))) ?? [];
  const offered = {
    numbers: [menu(/^\d{1,3}$/), Object.keys(autoroutes)],
    names: [menu(/^(Autoroute|Route)\b/), sections.map((s) => s.name)],
    years: [menu(/^\d{4}(-\d{4})?$/), segments.map((g) => g.published)],
  };
  for (const [what, [listed, found]] of Object.entries(offered)) {
    const missing = listed.filter((v) => !found.includes(v));
    console.log(`  ${what.padEnd(8)} offered by the page's own filter and missing here: `
      + `${missing.length} of ${listed.length}`
      + `${missing.length ? `   ${missing.slice(0, 10).join(' ')}` : ''}`);
  }

  console.log(`\n  ${coverage.autoroutes} autoroutes, ${coverage.sections} described sections, `
    + `${coverage.segments} segments`);
  console.log(`  ${coverage.segmentsWithYear} segments with a single opening year, `
    + `${coverage.segmentsWithYearSpan} with a span, ${coverage.segmentsWithoutYear} with none`);
  console.log(`  years ${coverage.yearFrom}-${coverage.yearTo}; `
    + `${coverage.lengthKm.toLocaleString('en-CA')} km across the sections, `
    + `${coverage.sectionsWithoutLength} section(s) with no published length`);
  if (unnumbered.length) {
    console.log(`  ${unnumbered.length} row(s) whose shield image gave no number, recorded nowhere:`);
    for (const r of unnumbered.slice(0, 5)) console.log(`    ${r.img} - ${text(r.name)}`);
  }

  console.log('\n  segments per autoroute:');
  for (const [num, a] of Object.entries(autoroutes)) {
    const segs = a.sections.flatMap((s) => s.segments);
    const dated = segs.filter((s) => s.year != null || s.yearFrom != null);
    const ys = dated.flatMap((s) => [s.year, s.yearFrom, s.yearTo].filter(Boolean));
    console.log(`    A-${num.padEnd(4)} ${String(a.sections.length).padStart(2)} section(s)`
      + `  ${String(segs.length).padStart(3)} segment(s)`
      + `  ${ys.length ? `${Math.min(...ys)}-${Math.max(...ys)}` : 'no year'}`
      + `${dated.length < segs.length ? `  <-- ${segs.length - dated.length} undated` : ''}`);
  }

  await mkdir(join(import.meta.dirname, '..', 'content', 'reference'), { recursive: true });
  await writeFile(OUT, `${JSON.stringify({
    source: {
      title: 'Répertoire des autoroutes du Québec',
      publisher: 'Ministère des Transports et de la Mobilité durable du Québec',
      url: URL,
      retrieved: new Date().toISOString().slice(0, 10),
      // Not an open-data release: this is a page on the ministry's own site,
      // with no licence stated on it. Said plainly rather than assumed to be
      // the CC-BY the province attaches to Données Québec.
      licence: 'none stated on the page; the site carries "© Gouvernement du Québec"',
      encoding,
      rowsReportedByPage: page.reported,
      rowsRead: page.rows.length,
      names: 'The names of autoroutes and of tronçons are those attributed by the '
        + 'Commission de toponymie du Québec, as the page states. They are kept in '
        + 'French exactly as published; the ministry publishes no English form, so '
        + 'none is recorded here.',
    },
    measure: {
      column: 'Ouverture à la circulation - Année',
      // The distinction the US side is careful about, and the answer for
      // Québec. The ministry's wording is "ouverture à la circulation", which
      // is the claim FHWA makes when it says open to traffic - not completion
      // and not designation. Its own notes cut the year both ways, and both
      // are worth saying out loud before this drives a timeline.
      means: 'The year the tronçon opened to traffic ("ouverture à la circulation"), '
        + 'not the year it was completed or designated. The notes on the rows show how '
        + 'far that is from completion in both directions: a segment can be dated from '
        + 'the opening of its first carriageway, with "2e chaussée ouverte en ..." putting '
        + 'the second one years or decades later, and several segments carry a note that '
        + 'they still run on one carriageway. In the other direction, a road that already '
        + 'carried traffic as a boulevard is dated from the year it opened as the '
        + 'autoroute: the Autoroute Laurentienne segment is given as 1983 with a note '
        + 'that the same road opened to traffic as Boulevard Laurentien in 1956. The year '
        + 'is therefore when traffic first ran there under the designation the directory '
        + 'files it under, and not a claim that the full autoroute was built.',
      published: intro,
      lengthColumn: 'Long. en km de la description - the length of the described section, '
        + 'repeated on each of its segment rows. The ministry publishes no per-segment '
        + 'length, so lengths here hang on the section and never on the segment.',
      spans: 'Where the ministry gives a span rather than a year ("1975-1979") it is kept '
        + 'as yearFrom and yearTo with no single year, and such a segment is not dated.',
    },
    numbering: {
      // Verbatim, and the limiting sentence pulled out of it verbatim too -
      // extracted from the page rather than transcribed, so that if the
      // ministry ever drops or rewords the limit this field goes null instead
      // of going stale.
      statement: numbering,
      scope: sentence(numbering, /s[’']applique seulement/),
      url: URL,
      note: 'This page states the ordering principle only - odd-numbered autoroutes '
        + 'running south to north, even-numbered west to east - and bounds it to '
        + 'autoroutes 5 to 85. It does not state the three-digit convention (an even '
        + 'first digit for a bypass, an odd one for a spur, the last two digits naming '
        + 'the parent), so that rule is not recorded here and would need its own source.',
    },
    coverage,
    autoroutes,
  }, null, 1)}\n`);

  console.log(`\nwrote ${join('content', 'reference', 'qc-autoroutes.json')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
