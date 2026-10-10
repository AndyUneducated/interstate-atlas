// Writes the README's figures - the badges, the build date and the coverage
// table - from the build's own output, so the page cannot quote a build it
// does not describe.
//
//   node tools/readme-figures.mjs           rewrite README.md in place
//   node tools/readme-figures.mjs --check   fail if README.md is out of date
//
// Each figure sits between a pair of markers, <!-- auto:NAME --> and
// <!-- /auto:NAME -->, and everything between them is replaced. Text outside
// the markers is never touched. A marker in the README with no generator here,
// or a generator with no marker, fails the run rather than being skipped.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SYSTEMS, COUNTRIES } from '../assets/schema.js';

const ROOT = join(import.meta.dirname, '..');
const README = join(ROOT, 'README.md');
const read = async (p) => JSON.parse(await readFile(join(ROOT, p), 'utf8'));

const COUNTRY = {
  us: { flag: '🇺🇸', name: 'US' },
  ca: { flag: '🇨🇦', name: 'CA' },
  mx: { flag: '🇲🇽', name: 'MX' },
};

// The coverage table's wording. {n} is the number of jurisdictions the
// system has routes in, counted from the build.
const COVERAGE = {
  'us-interstate': { name: 'Interstate Highways', note: 'includes Alaska\'s four unsigned A-series and Hawaii\'s H-series' },
  'us-numbered': { name: 'US Numbered Routes', note: 'the pre-1956 grid, numbered opposite to the Interstates' },
  'us-state': { name: 'State Routes', note: 'routes in {n} states and territories, loaded per state' },
  'ca-tch': { name: 'Trans-Canada Highway', note: 'the designation, traced across the provincial highways that carry it' },
  'ca-nhs': { name: 'National Highway System', note: 'Core, Feeder, and Northern and Remote, as designated by Transport Canada' },
  'ca-provincial': { name: 'Provincial & Municipal Routes', note: 'routes in {n} provinces and territories, loaded per jurisdiction' },
  'mx-federal': { name: 'Federal Highways', note: 'numbered roads the federation administers' },
  'mx-state': { name: 'State Highways', note: 'numbered state roads in {n} states, loaded per state; most state roads carry no number' },
};

const fmt = (n) => n.toLocaleString('en-US');
const badge = (label, message, colour, alt = label) =>
  `![${alt}](https://img.shields.io/badge/${encodeURIComponent(label.replace(/-/g, '--'))}-${encodeURIComponent(String(message).replace(/-/g, '--'))}-${colour}?style=flat-square&labelColor=0b1220)`;

async function figures() {
  const stats = await read('data/stats.json');
  const index = await read('data/index.json');
  const pkg = await read('package.json');
  const date = String(index.generated).slice(0, 10);

  const rows = SYSTEMS.map((s) => ({ s, ...stats.bySystem[s.id] })).filter((r) => r.routes);
  const routes = rows.reduce((a, r) => a + r.routes, 0);
  const miles = rows.reduce((a, r) => a + r.mi, 0);
  const juris = Object.keys(stats.byState).length;
  const countries = COUNTRIES.filter((cc) => rows.some((r) => r.s.cc === cc));
  const order = ['us', 'ca', 'mx'].filter((cc) => countries.includes(cc));
  const jurisIn = (id) => Object.values(stats.byState).filter((j) => j[id] > 0).length;
  const deps = Object.keys(pkg.dependencies ?? {}).length;
  const dev = Object.keys(pkg.devDependencies ?? {}).length;

  const table = [
    '| Country | System | Routes | Miles | Notes |',
    '| --- | --- | --- | ---: | --- |',
    ...order.flatMap((cc) => rows.filter((r) => r.s.cc === cc).map((r) => {
      const c = COVERAGE[r.s.id];
      if (!c) throw new Error(`no coverage wording for ${r.s.id}`);
      return `| ${COUNTRY[cc].flag} | ${c.name} | ${fmt(r.routes)} | ${fmt(r.mi)} | ${c.note.replace('{n}', jurisIn(r.s.id))} |`;
    })),
  ];

  return {
    date,
    badges: [
      badge('routes', fmt(routes), 'ffd166'),
      badge('jurisdictions', juris, '4fe3b0'),
      badge('route systems', rows.length, 'ffd166', 'systems'),
      badge('countries', order.map((cc) => COUNTRY[cc].name).join(' · '), 'ff4d6d'),
      badge('languages', 'English · 简体中文', 'a78bfa'),
    ].join('\n'),
    deps: badge('npm dependencies', `${deps} build · ${dev} dev`, 'ff9ecb', 'build deps'),
    summary: `${fmt(routes)} routes across ${juris} states, provinces and territories in ${countries.length} countries, measuring ${fmt(miles)} miles of road, in the build dated ${date}.`,
    coverage: table.join('\n'),
    accuracy: (() => {
      const a = stats.accuracy;
      const pct = (v) => `${v < 0 ? '−' : ''}${Math.abs(v)}%`;
      return `Across the ${fmt(a.routes)} routes where FHWA publishes a length to check against, the median disagreement is ${pct(a.median)}; ${a.within5}% land within 5% and ${a.within10}% within 10%.`;
    })(),
  };
}

async function main() {
  const check = process.argv.includes('--check');
  const before = await readFile(README, 'utf8');
  const values = await figures();
  const seen = new Set();
  const eol = before.includes('\r\n') ? '\r\n' : '\n';
  const after = before.replace(/(<!-- auto:([a-z]+) -->)([\s\S]*?)(<!-- \/auto:\2 -->)/g, (all, open, name, body, close) => {
    if (!(name in values)) throw new Error(`README marker auto:${name} has no generator`);
    seen.add(name);
    const value = values[name].replace(/\n/g, eol);
    const block = /^\r?\n/.test(body);
    return block ? `${open}${eol}${value}${eol}${close}` : `${open}${value}${close}`;
  });
  const missing = Object.keys(values).filter((k) => !seen.has(k));
  if (missing.length) throw new Error(`README has no marker for: ${missing.join(', ')}`);
  if (after === before) { console.log('README figures up to date'); return; }
  if (check) { console.error('README figures are out of date: run node tools/readme-figures.mjs'); process.exit(1); }
  await writeFile(README, after);
  console.log('README figures rewritten from the build');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
