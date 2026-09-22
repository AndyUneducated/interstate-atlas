// Reading the CSVs that transport ministries publish.
//
// Two problems keep recurring across countries, and both are solved once
// here rather than in each fetcher.
//
// The first is encoding. Latin-1 is common enough in Mexican government CSVs
// that assuming UTF-8 is the classic way to lose every accent in the file, so
// the encoding is established rather than declared.
//
// The second is that these files are written by spreadsheet software, which
// means quoted fields containing commas and newlines, doubled quotes for a
// literal one, CRLF line endings, and a byte order mark on the front that
// will otherwise become part of the first column's name.

/**
 * Decode a CSV the publisher did not label.
 *
 * UTF-8 is tried strictly, and a file that is not valid UTF-8 is read as
 * Windows-1252, the superset of Latin-1 that Excel writes. Which one it
 * turned out to be is returned, so a fetcher can record it.
 */
export function decode(buf) {
  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, ''),
      encoding: 'utf-8',
    };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(buf), encoding: 'windows-1252' };
  }
}

/** A CSV with quoted fields and CRLF line endings, as rows of strings. */
export function splitCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; if (row.some((v) => v !== '')) rows.push(row); row = []; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((v) => v !== '')) rows.push(row); }
  return rows;
}

/**
 * A CSV as objects, keyed by its header row folded to lower case.
 *
 * Folded because the same column is HIGHWAY NAME in one ministry's file and
 * highway_name in another's, and a reader should not have to reproduce a
 * publisher's shouting to find it.
 */
export function parseCsv(text) {
  const rows = splitCsv(text);
  const head = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

/** Fetches a CSV, establishes its encoding, and returns it as objects. */
export async function fetchCsv(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const { text, encoding } = decode(buf);
  return { rows: parseCsv(text), encoding, bytes: buf.length };
}
