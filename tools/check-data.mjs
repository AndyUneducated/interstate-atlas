// Checks that the built data in data/ agrees with itself.
//
//   node tools/check-data.mjs
//
// Every file under data/ is written by a different build script, at a
// different time, and each one refers to routes by id. A rebuild of one that
// changes an id, or drops a route, leaves the others pointing at nothing - and
// the page does not fail, it just shows less. So this reads everything back
// and fails on:
//
//   - a route id used twice in the index;
//   - a geometry file with routes the index lacks, or the reverse, or a
//     per-jurisdiction file no route in the index belongs to;
//   - a route under half a mile beside a longer piece of the same number,
//     which build-data drops as a remnant;
//   - a route filed in no state, province or territory;
//   - an id in dossiers, elevation, timeline, tolls, crossings or the served
//     places that is not in the index.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { SYSTEMS, IX, geoPath, systemOfCode, countryOf } from '../assets/schema.js';

const ROOT = join(import.meta.dirname, '..');
const DATA = join(ROOT, 'data');
const read = async (p) => JSON.parse(await readFile(join(DATA, p), 'utf8'));

const errors = [];
const fail = (msg) => errors.push(msg);

const index = await read('index.json');
const ids = new Set();
for (const r of index.routes) {
  if (ids.has(r[IX.id])) fail(`index: ${r[IX.id]} appears twice`);
  ids.add(r[IX.id]);
}
const byId = new Map(index.routes.map((r) => [r[IX.id], r]));

// Geometry against the index, file by file.
const expected = new Map();
for (const r of index.routes) {
  const s = systemOfCode(r[IX.sys]);
  const path = geoPath(s.id, s.perJuris ? r[IX.st] : undefined);
  if (!expected.has(path)) expected.set(path, new Set());
  expected.get(path).add(r[IX.id]);
}
const files = [];
for (const s of SYSTEMS) {
  if (!s.perJuris) { files.push(geoPath(s.id)); continue; }
  for (const f of await readdir(join(DATA, 'geo', s.dir))) if (f.endsWith('.json')) files.push(`${s.dir}/${f}`);
}
for (const path of files) {
  const want = expected.get(path) ?? new Set();
  if (!want.size) { fail(`geo/${path}: no route in the index belongs here (left by an earlier build?)`); continue; }
  const got = new Set((await read(`geo/${path}`)).features.map((f) => f.properties.id));
  for (const id of got) if (!want.has(id)) fail(`geo/${path}: ${id} is not in the index under this file`);
  for (const id of want) if (!got.has(id)) fail(`geo/${path}: ${id} is in the index but not in the file`);
}
for (const path of expected.keys()) if (!files.includes(path)) fail(`geo/${path}: missing, though the index files routes here`);

// Remnants and unplaced routes.
const longest = new Map();
// Keyed as build-data keys a route: Canadian numbers are provincial in every
// tier, though the NHS and Trans-Canada ship as one file each.
const keyOf = (r) => {
  const s = systemOfCode(r[IX.sys]);
  return `${r[IX.sys]}|${r[IX.num]}|${s.perJuris || countryOf(s.id) === 'ca' ? r[IX.st] : ''}`;
};
for (const r of index.routes) longest.set(keyOf(r), Math.max(longest.get(keyOf(r)) ?? 0, r[IX.mi]));
for (const r of index.routes) {
  if (r[IX.mi] === 0 && longest.get(keyOf(r)) > 0) fail(`index: ${r[IX.id]} is under half a mile beside a longer ${r[IX.label]}`);
  if (!/^[A-Z]{2,3}$/.test(r[IX.st] ?? '') || r[IX.st] === 'MX' || r[IX.st] === 'XX') fail(`index: ${r[IX.id]} is filed in no jurisdiction (${r[IX.st]})`);
}

// Every other file's route ids.
const refs = (label, list) => { for (const id of list) if (!byId.has(id)) fail(`${label}: ${id} is not in the index`); };
refs('dossiers/index.json', (await read('dossiers/index.json')).ids);
const elev = (await read('elevation/index.json')).ids;
refs('elevation/index.json', elev);
const elevFiles = (await readdir(join(DATA, 'elevation'))).filter((f) => f !== 'index.json').map((f) => f.replace(/\.json$/, ''));
for (const id of elevFiles) if (!elev.includes(id)) fail(`elevation/${id}.json: not in elevation/index.json`);
for (const id of elev) if (!elevFiles.includes(id)) fail(`elevation/index.json: ${id} has no profile file`);
const timeline = await read('timeline.json');
refs('timeline.json routes', timeline.routes.map((r) => r.id));
refs('timeline.json events', timeline.events.map((e) => e.id).filter(Boolean));
refs('tolls.json', Object.keys((await read('tolls.json')).byRoute));
refs('crossings.json', (await read('crossings.json')).features.flatMap((f) => (f.properties.near ?? []).map((n) => n.id)));
refs('served.json', Object.keys(await read('served.json')));

if (errors.length) {
  for (const e of errors) console.error(`  ${e}`);
  console.error(`check-data: ${errors.length} problem${errors.length === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log(`check-data: ${index.routes.length} routes, ${files.length} geometry files and every cross-file reference agree`);
