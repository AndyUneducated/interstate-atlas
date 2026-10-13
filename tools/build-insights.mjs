// Writes data/insights.json: the figures behind the views on the Data &
// sources sheet that the documents themselves cannot carry, read from the
// built geometry and the crosscheck files.
//
//   node tools/build-insights.mjs
//
// For each system, the share of its mileage that carries each attribute; the
// routes with the most unbridged gap; measured length against the FHWA Route
// Log; and the three registers' crosscheck verdicts. Nothing here is a new
// figure, only a tally of ones the build already published.

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SYSTEMS } from '../assets/schema.js';

const ROOT = join(import.meta.dirname, '..');
const read = async (p) => JSON.parse(await readFile(join(ROOT, p), 'utf8'));
const pct = (v) => (v == null ? 0 : Math.max(0, Math.min(1, v / 100)));

// One column per attribute. A getter returns the share of a route's length
// that carries the attribute, or undefined where the country's sources do not
// publish it at all, which is drawn as "not published" rather than as zero.
const FIELDS = {
  official: {
    us: (p, s) => (s === 'us-interstate' ? (p.offMi != null ? 1 : 0) : undefined),
    tw: (p, s) => (s === 'tw-provincial' ? (p.offMi != null ? 1 : 0) : undefined),
  },
  cost: { us: (p, s) => (s === 'us-interstate' ? (p.offCostK || p.offCostWhole ? 1 : 0) : undefined) },
  traffic: { us: (p) => pct(p.hpms?.aadt?.cover), ca: (p) => (p.traffic ? 1 : 0), mx: (p) => (p.mxTraffic ? 1 : 0) },
  lanes: { us: (p) => pct(p.hpms?.lanes?.cover), ca: (p) => pct(p.lanesCov), mx: (p) => pct(p.lanesCov) },
  speed: { us: (p) => pct(p.hpms?.speed?.cover), ca: (p) => pct(p.kphCov) },
  condition: { us: (p) => pct(p.hpms?.iri?.cover) },
  tolls: { us: (p) => pct(p.hpms?.cover), mx: (p) => pct(p.mxTollCov) },
  divided: { ca: (p) => pct(p.divCov), mx: (p) => pct(p.divCov) },
  termini: { all: (p) => (p.start && p.end ? 1 : 0) },
  continuous: { all: (p) => (p.breaks ? 0 : 1) },
  // Elevation profiles are sampled for the dossier routes, so one column serves both.
  dossier: { all: (p, s, x) => (x.dossiers.has(p.id) ? 1 : 0) },
};

async function features() {
  const out = [];
  for (const s of SYSTEMS) {
    const files = s.perJuris
      ? (await readdir(join(ROOT, 'data', 'geo', s.dir))).filter((f) => f.endsWith('.json')).map((f) => `${s.dir}/${f}`)
      : [s.geo];
    for (const f of files) for (const ft of (await read(`data/geo/${f}`)).features) out.push([s, ft.properties]);
  }
  return out;
}

async function main() {
  const x = { dossiers: new Set((await read('data/dossiers/index.json')).ids) };
  const all = await features();

  const coverage = SYSTEMS.map((s) => {
    const rows = all.filter(([sys]) => sys === s).map(([, p]) => p);
    const mi = rows.reduce((a, p) => a + p.mi, 0);
    const cells = {};
    for (const [k, by] of Object.entries(FIELDS)) {
      const get = by.all ?? by[s.cc];
      const probe = get && rows.length ? get(rows[0], s.id, x) : undefined;
      cells[k] = probe === undefined ? null
        : Math.round((rows.reduce((a, p) => a + p.mi * get(p, s.id, x), 0) / (mi || 1)) * 1000) / 10;
    }
    return { system: s.id, cc: s.cc, routes: rows.length, mi: Math.round(mi), cells };
  });

  const gaps = all.map(([s, p]) => ({ id: p.id, label: p.label, system: s.id, st: p.st, mi: p.mi, gapMi: p.gapMi ?? 0, breaks: p.breaks ?? 0 }))
    .filter((r) => r.gapMi > 0)
    .sort((a, b) => b.gapMi - a.gapMi)
    .slice(0, 20);
  const broken = SYSTEMS.map((s) => {
    const rows = all.filter(([sys]) => sys === s).map(([, p]) => p);
    return { system: s.id, routes: rows.length, broken: rows.filter((p) => p.breaks > 0).length, gapMi: Math.round(rows.reduce((a, p) => a + (p.gapMi ?? 0), 0)) };
  });

  // Measured against the Route Log, as the per-route percentage difference.
  const BINS = [-Infinity, -25, -10, -5, -2, 2, 5, 10, 25, Infinity];
  const lengths = BINS.slice(0, -1).map((lo, i) => ({ lo, hi: BINS[i + 1], n: 0 }));
  const outliers = [];
  for (const [s, p] of all) {
    if (s.id !== 'us-interstate' || p.offMi == null || !p.offMi) continue;
    const d = (p.mi / p.offMi - 1) * 100;
    lengths.find((b) => d >= b.lo && d < b.hi).n++;
    outliers.push({ id: p.id, label: p.label, st: p.st, mi: p.mi, offMi: p.offMi, d: Math.round(d * 10) / 10 });
  }
  outliers.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));

  const us = await read('content/reference/us-crosscheck.json');
  const mx = await read('content/reference/mx-crosscheck.json');
  const tch = await read('content/reference/tch-crosscheck.json');
  const tchAgree = tch.listed.filter((r) => r.namedKm && Math.abs(r.tchKm / r.namedKm - 1) <= 0.05).length;

  // The Layers menu shows what each overlay would add before its file is fetched.
  const overlays = {
    crossings: (await read('data/crossings.json')).features.length,
    tolls: (await read('data/tolls.json')).features.length,
    bridges: (await read('data/bridges.json')).rows.length,
  };

  const out = {
    overlays,
    coverage,
    fields: Object.keys(FIELDS),
    gaps,
    broken,
    lengths: { bins: lengths.map((b) => ({ ...b, lo: Number.isFinite(b.lo) ? b.lo : null, hi: Number.isFinite(b.hi) ? b.hi : null })), outliers: outliers.slice(0, 8) },
    crosscheck: {
      usState: us.total['us-state'],
      usNumbered: us.total['us-numbered'],
      mxState: mx.total.state,
      mxFederal: mx.total.federal,
      tch: { listed: tch.listed.length, agree: tchAgree, notListed: tch.notListed.length },
    },
  };
  await writeFile(join(ROOT, 'data', 'insights.json'), JSON.stringify(out));
  console.log(`insights: ${coverage.length} systems × ${out.fields.length} fields, ${gaps.length} worst gaps`);
}

main().catch((e) => { console.error(e); process.exit(1); });
