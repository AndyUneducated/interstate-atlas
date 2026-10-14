// Reads the Transport Department's Annual Traffic Census into
// content/reference/hk-census.json.
//
//   node tools/fetch-hk-census.mjs
//
// The census is the only published count of traffic on Hong Kong's roads. It
// is a PDF of six hundred pages, and the part the atlas reads is Appendix B,
// one row per counting station:
//
//   Stn No  Stn Type  Road Type  Road Name  From  To  AADT prev  AADT year  change
//
// It names each station's road, not its route number, so a station is joined
// to a route by tools/build-hk-traffic.mjs through the roads each route is
// made of. Here the table is only read.
//
// Reading the table
// ─────────────────
// Names wrap within their column ("Island Eastern" over "Corridor"), so a row
// is everything from one station number down to the next, and each fragment
// goes to the column whose header it sits under. The headers are found on
// every page rather than assumed, so a page set a few points to one side is
// still read. A figure the department estimated rather than counted carries
// an asterisk, which is kept as a flag.

import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const SITE = 'https://www.td.gov.hk';
const LIST = `${SITE}/en/publications_and_press_releases/publications/free_publications/atci2/index.html`;
const SRC = join(import.meta.dirname, 'src', 'hk');
const OUT = join('content', 'reference', 'hk-census.json');

const html = async (url) => {
  const r = await fetch(url, { headers: { 'User-Agent': 'interstate-atlas/1.0' } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
};

// The newest edition is the first one the index links to.
const list = await html(LIST);
const edition = list.match(/href="([^"]*free_publications\/atc(\d{4})\/index\.html)"/);
if (!edition) throw new Error('no census edition linked from the index');
const year = Number(edition[2]);
const page = new URL(edition[1], SITE).href;
const pdfHref = (await html(page)).match(/href="([^"]*Annual[^"]*Traffic[^"]*Census[^"]*\.pdf)"/i)?.[1];
if (!pdfHref) throw new Error(`${page}: no census PDF linked`);
const pdfUrl = new URL(pdfHref.replace(/ /g, '%20'), SITE).href;

await mkdir(SRC, { recursive: true });
const pdfFile = join(SRC, `atc-${year}.pdf`);
const have = await stat(pdfFile).then((s) => s.size > 1e6).catch(() => false);
if (!have) {
  console.log(`downloading ${pdfUrl}`);
  const r = await fetch(pdfUrl);
  if (!r.ok) throw new Error(`${pdfUrl}: HTTP ${r.status}`);
  await writeFile(pdfFile, Buffer.from(await r.arrayBuffer()));
}

const doc = await getDocument({ data: new Uint8Array(await readFile(pdfFile)), verbosity: 0 }).promise;
const num = (s) => {
  const v = s.replace(/[*,\s]/g, '');
  return /^\d+$/.test(v) ? Number(v) : null;
};
const stations = [];
let inB = false;
for (let i = 1; i <= doc.numPages; i++) {
  const items = (await (await doc.getPage(i)).getTextContent()).items
    .filter((it) => it.str.trim())
    .map((it) => ({ x: it.transform[4], y: it.transform[5], s: it.str.trim() }));
  const title = items.find((it) => /^Appendix [A-Z]\b/.test(it.s));
  if (title) inB = /^Appendix B\b/.test(title.s);
  if (!inB) continue;
  const head = (re) => items.find((it) => re.test(it.s));
  const hName = head(/^Road Name$/), hFrom = head(/^From$/), hTo = head(/^To$/);
  const hPrev = head(new RegExp(`^${year - 1}$`)), hYear = head(new RegExp(`^${year}$`));
  if (!hName || !hFrom || !hTo || !hPrev || !hYear) continue;
  const below = items.filter((it) => it.y < hName.y - 2);
  // Numbers are right-aligned under headers that sit to their right.
  const col = (x) => (x < hName.x - 65 ? 'stn' : x < hName.x - 28 ? 'stype' : x < hName.x - 3 ? 'rtype'
    : x < hFrom.x - 3 ? 'road' : x < hTo.x - 3 ? 'from' : x < hPrev.x - 25 ? 'to'
      : x < hYear.x - 25 ? 'prev' : x < hYear.x + 30 ? 'aadt' : 'chg');
  const starts = below.filter((it) => col(it.x) === 'stn' && /^\d{4}$/.test(it.s)).sort((a, b) => b.y - a.y);
  starts.forEach((st, k) => {
    const lo = starts[k + 1]?.y ?? -Infinity;
    const cells = {};
    for (const it of below.filter((v) => v.y <= st.y + 1 && v.y > lo + 1).sort((a, b) => b.y - a.y || a.x - b.x)) {
      const c = col(it.x);
      cells[c] = cells[c] ? `${cells[c]} ${it.s}` : it.s;
    }
    const aadt = num(cells.aadt ?? '');
    if (aadt == null) return;
    stations.push([
      Number(st.s), cells.stype ?? null, cells.rtype ?? null,
      (cells.road ?? '').replace(/\s+/g, ' '), (cells.from ?? '').replace(/\s+/g, ' '), (cells.to ?? '').replace(/\s+/g, ' '),
      num(cells.prev ?? ''), aadt, /\*/.test(cells.aadt ?? '') ? 1 : 0,
    ]);
  });
}
if (stations.length < 1000) throw new Error(`only ${stations.length} stations read from Appendix B`);

await writeFile(OUT, `${JSON.stringify({
  source: `Transport Department, The Annual Traffic Census ${year}, Appendix B`,
  url: pdfUrl,
  year,
  retrieved: new Date().toISOString().slice(0, 10),
  note: 'Annual average daily traffic, both directions. Station type A is a core station, counted all year; other types are counted for part of it and expanded. est=1 marks a figure the department estimated.',
  fields: ['stn', 'stnType', 'roadType', 'road', 'from', 'to', `aadt${year - 1}`, `aadt${year}`, 'est'],
  stations,
}, null, 0).replace(/\],\[/g, '],\n[')}\n`);
console.log(`${stations.length} stations, ${year}`);
