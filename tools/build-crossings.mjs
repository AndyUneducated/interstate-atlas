// Builds data/crossings.json, the border-crossing layer, from
// content/reference/border-crossings.json and the route geometry already built
// into data/geo/.
//
//   node tools/build-crossings.mjs
//
// Two things are done here rather than in the fetch, because both need the
// atlas's own roads.
//
// Placing the crossings the geocoder could not. An office whose address no
// NRCan candidate could place within reach of the border was recorded with the
// highway its address names. It goes where that highway, as the atlas draws it
// in that province, comes closest to the United States, provided that is within
// MEET_KM of it - which is the point it crosses, for a road that does. A
// highway that never comes that close is not a road to the border and the
// office is left unplaced rather than put somewhere plausible.
//
// The routes near each crossing. Neither CBSA nor INDAABIN says which road a
// crossing is on, so the routes listed with one are every atlas route within
// NEAR_KM of it, nearest first. That is a measurement of distance and is shown
// as one; it is not a statement that the route serves the crossing.

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SYSTEMS, IX } from '../assets/schema.js';
import { usOutline, kmTo } from './border.mjs';

const ROOT = join(import.meta.dirname, '..');
const GEO = join(ROOT, 'data', 'geo');
const OUT = join(ROOT, 'data', 'crossings.json');
const MEET_KM = 2;
const NEAR_KM = 2;
const NEAR_MAX = 4;

const read = async (p) => JSON.parse(await readFile(p, 'utf8'));

/** Every route geometry file, whole-system and per-jurisdiction alike. */
async function geoFiles() {
  const files = [];
  for (const s of SYSTEMS) {
    if (!s.perJuris) { files.push(join(GEO, s.geo)); continue; }
    for (const f of await readdir(join(GEO, s.dir))) if (f.endsWith('.json')) files.push(join(GEO, s.dir, f));
  }
  return files;
}

const linesOf = (g) => (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []);

function bboxOf(lines) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of lines) for (const [x, y] of l) {
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

/** Kilometres from a point to a set of lines, and the nearest point on them. */
function nearest(pt, lines) {
  const kx = 111.32 * Math.cos((pt[1] * Math.PI) / 180);
  const ky = 110.57;
  let best = { km: Infinity, at: null };
  for (const l of lines) {
    for (let i = 1; i < l.length; i++) {
      const ax = (l[i - 1][0] - pt[0]) * kx, ay = (l[i - 1][1] - pt[1]) * ky;
      const bx = (l[i][0] - pt[0]) * kx, by = (l[i][1] - pt[1]) * ky;
      const dx = bx - ax, dy = by - ay;
      const len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
      const km = Math.hypot(ax + t * dx, ay + t * dy);
      if (km < best.km) {
        best = { km, at: [l[i - 1][0] + t * (l[i][0] - l[i - 1][0]), l[i - 1][1] + t * (l[i][1] - l[i - 1][1])] };
      }
    }
  }
  return best;
}

async function main() {
  const ref = await read(join(ROOT, 'content', 'reference', 'border-crossings.json'));
  const index = await read(join(ROOT, 'data', 'index.json'));
  const us = await usOutline();

  // The Canadian routes each highway-located office could be on.
  const wanted = new Map();
  for (const c of ref.crossings) {
    if (c.located.by !== 'highway') continue;
    const ids = index.routes
      .filter((r) => r[IX.st] === c.juris && String(r[IX.num]) === c.located.highway && String(r[IX.sys]).startsWith('c'))
      .map((r) => r[IX.id]);
    for (const id of ids) wanted.set(id, null);
    c._routes = ids;
  }

  const crossings = ref.crossings.map((c) => ({ ...c }));
  const placedBefore = crossings.filter((c) => c.at);
  const routes = [];
  for (const file of await geoFiles()) {
    for (const f of (await read(file)).features) {
      const lines = linesOf(f.geometry);
      if (!lines.length) continue;
      const p = f.properties;
      if (wanted.has(p.id)) wanted.set(p.id, lines);
      routes.push({ id: p.id, label: p.label, sys: p.sys, lines, bbox: bboxOf(lines) });
    }
  }

  // Highway-located offices: where the named highway comes nearest the US.
  const report = [];
  for (const c of crossings) {
    if (c.located.by !== 'highway') continue;
    let best = null;
    for (const id of ref.crossings.find((x) => x.id === c.id)._routes) {
      const lines = wanted.get(id);
      if (!lines) continue;
      for (const l of lines) for (const v of l) {
        const km = kmTo(v, us);
        if (!best || km < best.km) best = { km, at: v, id };
      }
    }
    if (best && best.km <= MEET_KM) {
      c.at = best.at.map((v) => Number(v.toFixed(5)));
      c.located = { ...c.located, precision: 'highway', route: best.id, borderKm: Number(best.km.toFixed(1)) };
      report.push(`  ${c.juris} ${c.located.highway} ${c.name}: on ${best.id}, ${best.km.toFixed(1)} km from the line`);
    } else {
      const far = !best ? `the atlas has no ${c.juris} highway ${c.located.highway}`
        : Number.isFinite(best.km) ? `the atlas's ${c.juris} ${c.located.highway} comes no nearer the US than ${best.km.toFixed(0)} km`
        : `the atlas's ${c.juris} ${c.located.highway} is nowhere near the US border`;
      c.located = { ...c.located, by: 'none', reason: far };
      report.push(`  ${c.juris} ${c.located.highway} ${c.name}: NOT PLACED, ${c.located.reason}`);
    }
  }

  // Nearby routes, for every crossing that has a point.
  const pad = 0.05;
  for (const c of crossings) {
    if (!c.at) continue;
    const near = [];
    for (const r of routes) {
      const [x0, y0, x1, y1] = r.bbox;
      if (c.at[0] < x0 - pad || c.at[0] > x1 + pad || c.at[1] < y0 - pad || c.at[1] > y1 + pad) continue;
      const { km } = nearest(c.at, r.lines);
      if (km <= NEAR_KM) near.push({ id: r.id, label: r.label, sys: r.sys, km: Number(km.toFixed(1)) });
    }
    near.sort((a, b) => a.km - b.km);
    c.near = near.slice(0, NEAR_MAX);
  }

  const shown = crossings.filter((c) => c.at);
  const out = {
    generated: new Date().toISOString().slice(0, 10),
    retrieved: ref.retrieved,
    nearKm: NEAR_KM,
    sources: {
      ca: { title: ref.sources.ca.title, agency: ref.sources.ca.agency, url: ref.sources.ca.url, licence: ref.sources.ca.licence },
      mx: { title: ref.sources.mx.title, agency: ref.sources.mx.agency, url: ref.sources.mx.url, licence: ref.sources.mx.licence },
      geocoder: { agency: ref.sources.ca.geocoder.agency, service: ref.sources.ca.geocoder.service },
    },
    counts: ref.counts,
    unplaced: crossings.filter((c) => !c.at).map((c) => ({ name: c.name, juris: c.juris, reason: c.located.reason ?? 'address names no highway' })),
    type: 'FeatureCollection',
    features: shown.map((c) => ({
      type: 'Feature',
      id: c.id,
      properties: {
        id: c.id,
        name: c.name,
        country: c.country,
        border: c.border,
        counterpart: c.counterpart,
        juris: c.juris,
        by: c.located.by,
        precision: c.located.precision ?? null,
        near: c.near,
      },
      geometry: { type: 'Point', coordinates: c.at },
    })),
  };
  await writeFile(OUT, `${JSON.stringify(out)}\n`);

  const byBorder = {};
  for (const c of shown) byBorder[c.border] = (byBorder[c.border] ?? 0) + 1;
  const withNear = shown.filter((c) => c.near.length).length;
  console.log(`crossings: ${shown.length} of ${crossings.length} placed ${JSON.stringify(byBorder)}`
    + ` (${placedBefore.length} from the fetch, ${shown.length - placedBefore.length} on their highway);`
    + ` ${withNear} have an atlas route within ${NEAR_KM} km`);
  for (const line of report) console.log(line);
}

main().catch((e) => { console.error(e); process.exit(1); });
