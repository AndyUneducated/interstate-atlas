// THROWAWAY. Pass 2: full per-group table + federal/state name overlap. Delete when done.
import * as shapefile from 'shapefile';
import { writeFile } from 'node:fs/promises';
import { clean, state, routePrefix, normaliseRoute } from './mexico.mjs';

const BASE = 'tools/src/mx/red_vial';
const FEDERATION = '33';
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]/g, '');
const OPEN_BY_FOLD = new Set(['En operación', 'En construcción - abierto'].map(fold));
const num = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? n : null; };
const bump = (m, k, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
const obj = (m, limit = 0) => {
  const e = [...m.entries()].sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(limit ? e.slice(0, limit) : e);
};

const groups = new Map();
// how many numbered carreteras per jurisdiction carry a parseable CODIGO vs not
const codigoFill = new Map(); // jurCode -> {numbered, rejected, blank, total, km*}

const src = await shapefile.openDbf(`${BASE}.dbf`, { encoding: 'utf-8' });
const t0 = Date.now();
let read = 0;
for (;;) {
  const r = await src.read();
  if (r.done) break;
  const p = r.value;
  read++;
  if (read % 1000000 === 0) console.error(`  ${read} @ ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  const tipo = clean(p.TIPO_VIAL);
  if (tipo !== 'Carretera') continue;
  const condicion = clean(p.CONDICION);
  if ((condicion && !OPEN_BY_FOLD.has(fold(condicion))) || fold(clean(p.ESTATUS)) === fold('Deshabilitado')) continue;

  const admin = clean(p.ADMINISTRA);
  const jurRaw = String(p.JURISDI ?? '').trim();
  const jur = state(jurRaw);
  const federal = admin === 'Federal' || jur?.key === FEDERATION;
  const km = (num(p.LONGITUD) ?? 0) / 1000;

  let wasRejected = false;
  const parsed = normaliseRoute(p.CODIGO, () => { wasRejected = true; });
  const jk = federal ? 'FED' : (jur?.code ?? `?${jurRaw}`);
  let cf = codigoFill.get(jk);
  if (!cf) { cf = { total: 0, km: 0, numbered: 0, numberedKm: 0, rejected: 0, rejectedKm: 0, blank: 0, blankKm: 0 }; codigoFill.set(jk, cf); }
  cf.total++; cf.km += km;
  if (parsed.length) { cf.numbered++; cf.numberedKm += km; }
  else if (wasRejected) { cf.rejected++; cf.rejectedKm += km; }
  else { cf.blank++; cf.blankKm += km; }

  const prefix = federal ? 'MEX' : routePrefix(jur);
  const routes = parsed
    .map((x) => ({ ...x, prefix: x.prefix ?? prefix, system: (x.prefix ?? prefix) === 'MEX' ? 'federal' : 'state' }))
    .filter((x) => x.prefix);

  for (const route of routes) {
    const key = `${route.system}|${route.prefix}-${route.number}`;
    let g = groups.get(key);
    if (!g) {
      g = { system: route.system, prefix: route.prefix, number: route.number, segs: 0, km: 0,
        administra: new Map(), jurisdi: new Map(), names: new Map(), peaje: new Map(), lanes: new Map() };
      groups.set(key, g);
    }
    g.segs++; g.km += km;
    bump(g.administra, admin ?? '(blank)');
    bump(g.jurisdi, jur ? (jur.key === FEDERATION ? 'FED' : jur.code) : (jurRaw || '(blank)'));
    bump(g.names, clean(p.NOMBRE) ?? '(blank)');
    bump(g.peaje, clean(p.PEAJE) ?? '(blank)');
    bump(g.lanes, String(p.CARRILES ?? '').trim());
  }
}
console.error(`done ${read} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

// federal name sets, folded, for overlap testing
const fedNames = new Map(); // number -> Set(foldedName)
for (const [k, g] of groups) {
  if (g.system !== 'federal') continue;
  fedNames.set(g.number, new Set([...g.names.keys()].map(fold).filter((x) => x && x !== fold('(blank)'))));
}

const rows = [...groups.entries()].map(([key, g]) => {
  const adminEntries = [...g.administra.entries()].sort((a, b) => b[1] - a[1]);
  const nameKeys = [...g.names.keys()];
  const fn = fedNames.get(g.number);
  const shared = fn ? nameKeys.filter((n) => fn.has(fold(n))) : [];
  const sharedSegs = shared.reduce((a, n) => a + g.names.get(n), 0);
  return {
    key, system: g.system, prefix: g.prefix, number: g.number,
    segs: g.segs, km: +g.km.toFixed(3),
    administra: obj(g.administra),
    adminDominant: adminEntries[0]?.[0] ?? null,
    adminPure: adminEntries.length === 1,
    jurisdi: obj(g.jurisdi),
    nNames: g.names.size,
    names: Object.keys(obj(g.names, 4)),
    ramalNames: nameKeys.filter((n) => /^(ramal|acceso|ent\.|e\.c\.|entronque|km\.)/i.test(n)).length,
    hasFedTwin: !!fn,
    sharedNameCount: shared.length,
    sharedNameSegs: sharedSegs,
    sharedNames: shared.slice(0, 3),
    peaje: obj(g.peaje), lanes: obj(g.lanes),
  };
});

await writeFile('tools/_probe-mx2.json', JSON.stringify({
  codigoFill: Object.fromEntries([...codigoFill.entries()].sort((a, b) => b[1].total - a[1].total)
    .map(([k, v]) => [k, { ...v, km: +v.km.toFixed(1), numberedKm: +v.numberedKm.toFixed(1), rejectedKm: +v.rejectedKm.toFixed(1), blankKm: +v.blankKm.toFixed(1) }])),
  rows,
}, null, 1));
console.error('wrote tools/_probe-mx2.json');
