// Writes data/docs.json, the "Data & sources" page, from the two documents
// that are its source of truth and their Chinese mirrors:
//
//   docs/DATA-SOURCES.md  §2-§6   sources, coverage, decisions, open issues
//   docs/ACCURACY.md      §1-§6   what each kind of figure means, known gaps
//   docs/zh/…                     the same sections in Chinese
//
//   node tools/build-docs.mjs           rewrite data/docs.json
//   node tools/build-docs.mjs --check   fail if it is out of date
//
// The page is parsed from the documents rather than written for it, so it
// cannot say something the documents do not. The mirror is held to the same
// shape: every section, table and row, and every ID in the first column, must
// match the English, or the run fails and names the first difference. The
// coverage table itself is left out; the page draws it from data/coverage.json.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'data', 'docs.json');

/** Which numbered sections of which document make each tab. */
const TABS = [
  { id: 'sources', doc: 'DATA-SOURCES.md', sections: [2, 3] },
  { id: 'coverage', doc: 'DATA-SOURCES.md', sections: [4] },
  { id: 'decisions', doc: 'DATA-SOURCES.md', sections: [5] },
  { id: 'issues', doc: 'DATA-SOURCES.md', sections: [6] },
  { id: 'accuracy', doc: 'ACCURACY.md', sections: [1, 2, 3, 4, 5, 6] },
];

const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

/** Markdown into the few block kinds the documents use. */
function blocks(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || /^-{3,}$/.test(line.trim())) { i++; continue; }
    if (line.startsWith('<!-- auto:coverage -->')) {
      while (i < lines.length && !lines[i].startsWith('<!-- /auto:coverage -->')) i++;
      i++;
      out.push({ t: 'coverage' });
      continue;
    }
    const h = /^(#{2,4})\s+(.*)$/.exec(line);
    if (h) { out.push({ t: 'h', level: h[1].length, text: h[2] }); i++; continue; }
    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(cells(lines[i++]));
      const [head, rule, ...body] = rows;
      out.push({ t: 'table', head, align: rule.map((c) => (c.endsWith(':') ? 'r' : 'l')), rows: body });
      continue;
    }
    if (/^(\d+\.|-)\s/.test(line)) {
      const ordered = /^\d+\./.test(line);
      const items = [];
      while (i < lines.length && lines[i].trim() && !lines[i].startsWith('|') && !/^#/.test(lines[i])) {
        if (/^(\d+\.|-)\s/.test(lines[i])) items.push(lines[i].replace(/^(\d+\.|-)\s+/, ''));
        else items[items.length - 1] += ` ${lines[i].trim()}`;
        i++;
      }
      out.push({ t: ordered ? 'ol' : 'ul', items });
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#|\||<!--|-{3,}$)/.test(lines[i].trim())) para.push(lines[i++].trim());
    out.push({ t: 'p', text: para.join(' ') });
  }
  return out;
}

/** The numbered `## N.` sections of a document, each as blocks. */
async function sections(path) {
  const lines = (await readFile(path, 'utf8')).split(/\r?\n/);
  const out = new Map();
  let cur = null;
  for (const line of lines) {
    const m = /^## (\d+)\.\s+(.*)$/.exec(line);
    if (m) { cur = { n: Number(m[1]), title: m[2], lines: [] }; out.set(cur.n, cur); continue; }
    if (cur) cur.lines.push(line);
  }
  return out;
}

async function tabs(lang) {
  const dir = lang === 'zh' ? join(ROOT, 'docs', 'zh') : join(ROOT, 'docs');
  const cache = new Map();
  const out = {};
  for (const tab of TABS) {
    if (!cache.has(tab.doc)) cache.set(tab.doc, await sections(join(dir, tab.doc)));
    const secs = cache.get(tab.doc);
    out[tab.id] = tab.sections.map((n) => {
      const s = secs.get(n);
      if (!s) throw new Error(`${lang} ${tab.doc} has no section ${n}`);
      return { n, title: s.title, blocks: blocks(s.lines) };
    });
  }
  return out;
}

const ID = /^(?:[A-Z]{1,2}-\d+|[\u{1F1E6}-\u{1F1FF}\s]+)$/u;

/** The first way the mirror's shape differs from the English, if any. */
function compare(en, zh) {
  for (const tab of TABS) {
    for (let s = 0; s < en[tab.id].length; s++) {
      const a = en[tab.id][s].blocks, b = zh[tab.id][s].blocks;
      const where = `${tab.doc} §${en[tab.id][s].n}`;
      if (a.length !== b.length) return `${where}: ${a.length} blocks in English, ${b.length} in Chinese`;
      for (let k = 0; k < a.length; k++) {
        if (a[k].t !== b[k].t) return `${where}, block ${k + 1}: ${a[k].t} in English, ${b[k].t} in Chinese`;
        if (a[k].t !== 'table') continue;
        if (a[k].rows.length !== b[k].rows.length || a[k].head.length !== b[k].head.length) {
          return `${where}, table "${a[k].head[0]}": ${a[k].rows.length}×${a[k].head.length} in English, ${b[k].rows.length}×${b[k].head.length} in Chinese`;
        }
        for (let r = 0; r < a[k].rows.length; r++) {
          const x = a[k].rows[r][0], y = b[k].rows[r][0];
          if (ID.test(x) && x !== y) return `${where}: row ${r + 1} is ${x} in English, ${y} in Chinese`;
        }
      }
    }
  }
  return null;
}

async function main() {
  const check = process.argv.includes('--check');
  const en = await tabs('en');
  const zh = await tabs('zh');
  const diff = compare(en, zh);
  if (diff) { console.error(`build-docs: the Chinese mirror has drifted: ${diff}`); process.exit(1); }
  const json = `${JSON.stringify({ en, zh })}\n`;
  const before = await readFile(OUT, 'utf8').catch(() => '');
  if (json === before) { console.log('docs page up to date'); return; }
  if (check) { console.error('docs page is out of date: run node tools/build-docs.mjs'); process.exit(1); }
  await writeFile(OUT, json);
  console.log('docs page written from docs/');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
