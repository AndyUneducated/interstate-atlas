// Sums SICT's paved federal network per route number into
// content/reference/mx-lengths.json.
//
//   node tools/fetch-mexico-lengths.mjs
//
// Red Federal Pavimentada lists every tramo of the free federal network with
// its effective length, its state and its route number. A route's tramos
// include its branches (ramales), which the atlas does not draw as the route,
// so they are summed apart. The toll roads (the D routes) are not in the file,
// and a route is listed state by state, so the sum is the whole route's free
// network, not the stretch any one atlas piece draws. That is why the figure
// is shown in the provenance section and never as the headline length.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fetchCsv } from './csv.mjs';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'content', 'reference', 'mx-lengths.json');
const DATASET = 'https://www.datos.gob.mx/dataset/red_federal_pavimentada';
const URL = 'https://repodatos.atdt.gob.mx/api_update/secretaria_comunicaciones/red_federal_pavimentada/red_federal_pavimentada_2024.csv';
const COLS = ['periodo', 'estado', 'ramal', 'ruta', 'long_efectiva'];

const { rows } = await fetchCsv(URL);
const missing = COLS.filter((c) => !(c in (rows[0] ?? {})));
if (missing.length) throw new Error(`Red Federal Pavimentada: no column ${missing.join(', ')}`);

const routes = {};
const periods = new Set();
let total = 0;
let unnumbered = 0;
for (const r of rows) {
  const km = Number(r.long_efectiva);
  if (!(km > 0)) continue;
  total += km;
  periods.add(r.periodo.trim());
  if (!/^\d+$/.test(r.ruta.trim())) { unnumbered += km; continue; }
  const n = String(Number(r.ruta));
  const e = (routes[n] ??= { km: 0, branchKm: 0, states: new Set() });
  e.km += km;
  if (r.ramal.trim() !== 'sin dato') e.branchKm += km;
  e.states.add(r.estado.trim());
}

const round = (v) => Math.round(v * 10) / 10;
const out = {
  retrieved: new Date().toISOString().slice(0, 10),
  purpose: 'SICT\'s free federal network summed per route number. Written by fetch-mexico-lengths.mjs; do not edit by hand.',
  source: 'SICT, Red Federal Pavimentada',
  agency: 'Secretaría de Infraestructura, Comunicaciones y Transportes',
  url: DATASET,
  file: URL,
  licence: 'CC BY 4.0',
  edition: [...periods].join('; '),
  totalKm: round(total),
  unnumberedKm: round(unnumbered),
  routes: Object.fromEntries(Object.entries(routes)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([n, e]) => [n, { km: round(e.km), branchKm: round(e.branchKm), states: [...e.states].sort() }])),
};
await mkdir(join(ROOT, 'content', 'reference'), { recursive: true });
await writeFile(OUT, `${JSON.stringify(out, null, 1)}\n`);
console.log(`mx lengths: ${Object.keys(out.routes).length} routes, ${out.totalKm} km (${out.unnumberedKm} unnumbered), ${out.edition}`);
