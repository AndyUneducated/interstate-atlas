// Reads rows out of an .xlsx workbook.
//
// Two of the provincial traffic feeds publish only as a spreadsheet - Ontario's
// AADT extract and Alberta's per-highway weighted volumes - so the build needs
// to be able to open one. A full spreadsheet library would be a large
// dependency for the small part of the format these two files use, and an
// .xlsx is a zip of XML that the project can already unzip.
//
// What this handles: shared and inline strings, numbers, and the sparse-column
// layout Excel writes when a cell is empty. What it does not handle: formulas
// (the cached value is read instead, which is what the file was published to
// convey), dates as serial numbers, and styles. Neither file needs them.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listEntries, extractEntry } from './unzip.mjs';

/** Decode the five XML entities Excel writes, and nothing else. */
const unescapeXml = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, '&');

/**
 * The shared-string table, in order.
 *
 * Excel stores every distinct string once and refers to it by index. A cell's
 * text can be split across several <r> runs when part of it is styled
 * differently, so the runs are concatenated rather than the first one taken.
 */
function sharedStrings(xml) {
  const out = [];
  for (const [, si] of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    let text = '';
    for (const [, t] of si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) text += t;
    out.push(unescapeXml(text));
  }
  return out;
}

/** "BC" -> 28. Column letters are base-26 with no zero. */
function columnIndex(ref) {
  const letters = /^([A-Z]+)/.exec(ref)?.[1] ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** One worksheet as an array of rows, each an array of strings and numbers. */
function sheetRows(xml, strings) {
  const rows = [];
  for (const [, attrs, body] of xml.matchAll(/<row([^>]*)>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const [, cellAttrs, cell] of body.matchAll(/<c([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /r="([A-Z]+\d+)"/.exec(cellAttrs)?.[1];
      const type = /t="([^"]+)"/.exec(cellAttrs)?.[1];
      const at = ref ? columnIndex(ref) : row.length;

      let value = null;
      if (type === 'inlineStr') {
        let text = '';
        for (const [, t] of (cell ?? '').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) text += t;
        value = unescapeXml(text);
      } else {
        const raw = /<v[^>]*>([\s\S]*?)<\/v>/.exec(cell ?? '')?.[1];
        if (raw != null) {
          value = type === 's' ? (strings[Number(raw)] ?? null) : unescapeXml(raw);
          // A bare <v> is a number in the file's own notation; keeping it a
          // string here would make every caller parse it again.
          if (type !== 's' && value !== null && value !== '' && !Number.isNaN(Number(value))) {
            value = Number(value);
          }
        }
      }
      row[at] = value;
    }
    // Excel omits empty rows' contents but still numbers them, so a sparse
    // sheet does not silently shift its data upward.
    const at = Number(/r="(\d+)"/.exec(attrs)?.[1] ?? rows.length + 1) - 1;
    rows[at] = row;
  }
  return [...rows].map((r) => r ?? []);
}

/**
 * Every worksheet in a workbook, keyed by the file's own sheet order.
 *
 * Sheet names live in workbook.xml and the rows in separate parts, related by
 * an id; the relationship file is not read here because both published files
 * put sheet N of the workbook in worksheets/sheetN.xml, and a mismatch would
 * show up immediately as a sheet with no recognisable columns.
 */
export async function readWorkbook(buffer) {
  const dir = await mkdtemp(join(tmpdir(), 'xlsx-'));
  try {
    const path = join(dir, 'book.xlsx');
    await writeFile(path, buffer);
    const entries = await listEntries(path);

    const read = async (name) => {
      const entry = entries.find((e) => e.name === name);
      if (!entry) return null;
      const dest = join(dir, name.replace(/[/\\]/g, '_'));
      await extractEntry(path, entry, dest);
      return readFile(dest, 'utf8');
    };

    const strings = sharedStrings((await read('xl/sharedStrings.xml')) ?? '');
    const names = [...((await read('xl/workbook.xml')) ?? '')
      .matchAll(/<sheet[^>]*name="([^"]*)"/g)].map((m) => unescapeXml(m[1]));

    const sheets = [];
    for (const entry of entries
      .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
      .sort((a, b) => Number(/(\d+)/.exec(a.name)[1]) - Number(/(\d+)/.exec(b.name)[1]))) {
      const xml = await read(entry.name);
      sheets.push({
        name: names[sheets.length] ?? entry.name,
        rows: xml ? sheetRows(xml, strings) : [],
      });
    }
    return sheets;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Fetch and open a workbook in one step. */
export async function fetchWorkbook(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return readWorkbook(Buffer.from(await res.arrayBuffer()));
}
