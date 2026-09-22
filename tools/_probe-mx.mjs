// THROWAWAY. Single-pass diagnostic over red_vial.dbf. Delete when done.
import * as shapefile from 'shapefile';
import { writeFile } from 'node:fs/promises';
import { clean, state, routePrefix, normaliseRoute, STATES } from './mexico.mjs';

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

// ── accumulators ────────────────────────────────────────────────────────────
const counts = { read: 0, notOpen: 0, carreteras: 0, numbered: 0, unplaceable: 0,
  suffixD: 0, peajeYes: 0, tollAgree: 0, tollDisagree: 0 };
const administraAll = new Map();
const jurisdiAll = new Map();
const administraCarretera = new Map();
const jurisdiCarretera = new Map();
const administraNumbered = new Map();
const administraByTipo = new Map();   // tipo -> Map(administra -> n)
const tipoAll = new Map();

// group key -> stats
const groups = new Map();
// raw numeric CODIGO -> { fed, nonFed, admin: Map, jur: Map }
const codeXtab = new Map();
// rejected form -> detail
const rej = new Map();
// TIPO_VIAL -> count of non-carretera rows whose CODIGO nonetheless looks route-shaped
const nonCarreteraCodigo = new Map();

const ROUTEISH = /^([A-Z]{2,3})?[\s-]*([0-9]{1,4}|[A-Z]{2,4})[\s-]*([A-Z])?$/;

function rejDetail(form, p, tipo) {
  let d = rej.get(form);
  if (!d) {
    d = { n: 0, nombre: new Map(), jurisdi: new Map(), administra: new Map(),
      tipo: new Map(), condPav: new Map(), carriles: new Map(), km: [], peaje: new Map() };
    rej.set(form, d);
  }
  d.n++;
  bump(d.nombre, clean(p.NOMBRE) ?? '(blank)');
  bump(d.jurisdi, String(p.JURISDI ?? '').trim());
  bump(d.administra, clean(p.ADMINISTRA) ?? '(blank)');
  bump(d.tipo, tipo ?? '(blank)');
  bump(d.condPav, clean(p.COND_PAV) ?? '(blank)');
  bump(d.carriles, String(p.CARRILES ?? '').trim());
  bump(d.peaje, clean(p.PEAJE) ?? '(blank)');
  const L = num(p.LONGITUD);
  if (L != null) d.km.push(L / 1000);
}

const src = await shapefile.openDbf(`${BASE}.dbf`, { encoding: 'utf-8' });
const t0 = Date.now();
for (;;) {
  const r = await src.read();
  if (r.done) break;
  const p = r.value;
  counts.read++;
  if (counts.read % 500000 === 0) {
    console.error(`  ${counts.read} @ ${((Date.now() - t0) / 1000).toFixed(0)}s  rss=${(process.memoryUsage().rss / 1048576).toFixed(0)}MB`);
  }

  const tipo = clean(p.TIPO_VIAL);
  const admin = clean(p.ADMINISTRA);
  const jurRaw = String(p.JURISDI ?? '').trim();
  bump(tipoAll, tipo ?? '(blank)');
  bump(administraAll, admin ?? '(blank)');
  bump(jurisdiAll, jurRaw || '(blank)');
  if (!administraByTipo.has(tipo)) administraByTipo.set(tipo, new Map());
  bump(administraByTipo.get(tipo), admin ?? '(blank)');

  const condicion = clean(p.CONDICION);
  if ((condicion && !OPEN_BY_FOLD.has(fold(condicion))) || fold(clean(p.ESTATUS)) === fold('Deshabilitado')) {
    counts.notOpen++;
    continue;
  }

  if (tipo === 'Carretera') {
    counts.carreteras++;
    bump(administraCarretera, admin ?? '(blank)');
    bump(jurisdiCarretera, jurRaw || '(blank)');
  }

  // parseRoute equivalent, with reject capture
  let parsed = [];
  if (String(tipo ?? '').trim().toLowerCase() === 'carretera') {
    parsed = normaliseRoute(p.CODIGO, (v) => rejDetail(v, p, tipo));
  } else {
    // does CODIGO ever carry a route-shaped value on a NON-carretera? (leak test)
    const c = clean(p.CODIGO);
    if (c && ROUTEISH.test(c.toUpperCase())) bump(nonCarreteraCodigo, tipo ?? '(blank)');
  }

  const jur = state(jurRaw);
  const federal = admin === 'Federal' || jur?.key === FEDERATION;
  const prefix = federal ? 'MEX' : routePrefix(jur);
  const routes = parsed
    .map((x) => ({ ...x, prefix: x.prefix ?? prefix, system: (x.prefix ?? prefix) === 'MEX' ? 'federal' : 'state' }))
    .filter((x) => x.prefix);
  if (parsed.length && !routes.length) counts.unplaceable++;
  if (!routes.length) continue;
  counts.numbered++;
  bump(administraNumbered, admin ?? '(blank)');

  // code cross-tab on the raw normalised number, tier-agnostic
  for (const x of parsed) {
    const key = x.number;
    let ct = codeXtab.get(key);
    if (!ct) { ct = { n: 0, fed: 0, nonFed: 0, admin: new Map(), jur: new Map(), km: 0 }; codeXtab.set(key, ct); }
    ct.n++;
    if (federal) ct.fed++; else ct.nonFed++;
    bump(ct.admin, admin ?? '(blank)');
    bump(ct.jur, jur ? (jur.key === FEDERATION ? 'FED' : jur.code) : (jurRaw || '(blank)'));
    ct.km += (num(p.LONGITUD) ?? 0) / 1000;
  }

  const peaje = clean(p.PEAJE);
  const tolled = peaje == null ? null : /^s[ií]$/i.test(peaje);
  const designatedToll = routes.some((x) => x.toll);
  if (designatedToll) counts.suffixD++;
  if (tolled) counts.peajeYes++;
  if (tolled != null) { if (designatedToll === tolled) counts.tollAgree++; else counts.tollDisagree++; }

  const km = (num(p.LONGITUD) ?? 0) / 1000;
  for (const route of routes) {
    const key = `${route.system}|${route.prefix}-${route.number}`;
    let grp = groups.get(key);
    if (!grp) {
      grp = { system: route.system, prefix: route.prefix, number: route.number,
        segs: 0, km: 0, tipo: new Map(), administra: new Map(), jurisdi: new Map(),
        names: new Map(), peaje: new Map(), pav: new Map(), lanes: new Map() };
      groups.set(key, grp);
    }
    grp.segs++;
    grp.km += km;
    bump(grp.tipo, tipo ?? '(blank)');
    bump(grp.administra, admin ?? '(blank)');
    bump(grp.jurisdi, jur ? (jur.key === FEDERATION ? 'FED' : jur.code) : (jurRaw || '(blank)'));
    bump(grp.names, clean(p.NOMBRE) ?? '(blank)');
    bump(grp.peaje, clean(p.PEAJE) ?? '(blank)');
    bump(grp.pav, clean(p.COND_PAV) ?? '(blank)');
    bump(grp.lanes, String(p.CARRILES ?? '').trim());
  }
}
console.error(`done ${counts.read} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

// ── derive ──────────────────────────────────────────────────────────────────
const stats = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const q = (f) => s[Math.min(s.length - 1, Math.floor(f * s.length))];
  return { n: s.length, sum: +s.reduce((x, y) => x + y, 0).toFixed(3),
    min: +s[0].toFixed(4), p25: +q(0.25).toFixed(4), median: +q(0.5).toFixed(4),
    p75: +q(0.75).toFixed(4), p95: +q(0.95).toFixed(4), max: +s[s.length - 1].toFixed(4) };
};

const all = [...groups.entries()].map(([k, g]) => ({ key: k, ...g,
  tipo: obj(g.tipo), administra: obj(g.administra), jurisdi: obj(g.jurisdi),
  peaje: obj(g.peaje), pav: obj(g.pav), lanes: obj(g.lanes),
  nameCount: g.names.size, topNames: Object.keys(obj(g.names, 6)), km: +g.km.toFixed(3) }));
const fed = all.filter((g) => g.system === 'federal');
const st = all.filter((g) => g.system === 'state');

const digits = (n) => (/^\d+$/.test(n.replace(/[A-Z]$/, '')) ? String(Number(n.replace(/[A-Z]$/, ''))).length : 'alpha');

const byDigits = new Map();
for (const g of st) bump(byDigits, digits(g.number));
const byPrefix = new Map();
for (const g of st) bump(byPrefix, g.prefix);

const thresholds = [0, 1, 5, 10, 25, 50, 100];
const survival = thresholds.map((n) => ({ minKm: n,
  state: st.filter((g) => g.km >= n).length, federal: fed.filter((g) => g.km >= n).length }));
const segSurvival = [1, 2, 3, 5, 10, 20, 50].map((n) => ({ minSegs: n,
  state: st.filter((g) => g.segs >= n).length, federal: fed.filter((g) => g.segs >= n).length }));

// per-prefix survival at a few thresholds
const prefixTable = [...byPrefix.keys()].sort().map((pfx) => {
  const gs = st.filter((g) => g.prefix === pfx);
  const row = { prefix: pfx, groups: gs.length, km: +gs.reduce((a, g) => a + g.km, 0).toFixed(1) };
  for (const n of [1, 5, 10, 25, 50]) row[`ge${n}km`] = gs.filter((g) => g.km >= n).length;
  row.d1 = gs.filter((g) => digits(g.number) === 1).length;
  row.d2 = gs.filter((g) => digits(g.number) === 2).length;
  row.d3 = gs.filter((g) => digits(g.number) === 3).length;
  row.d4 = gs.filter((g) => digits(g.number) === 4).length;
  return row;
});

// federal number set, to test overlap
const fedNums = new Set(fed.map((g) => g.number));
const stateSharingFedNumber = st.filter((g) => fedNums.has(g.number));

const pick = (re) => st.filter((g) => re.test(g.key)).map((g) => ({ key: g.key, segs: g.segs, km: g.km,
  administra: g.administra, jurisdi: g.jurisdi, topNames: g.topNames, tipo: g.tipo, peaje: g.peaje, lanes: g.lanes }));

const out = {
  counts,
  tipoAll: obj(tipoAll),
  administraAll: obj(administraAll),
  jurisdiAll: obj(jurisdiAll),
  administraCarretera: obj(administraCarretera),
  jurisdiCarretera: obj(jurisdiCarretera),
  administraNumbered: obj(administraNumbered),
  administraByTipo: Object.fromEntries([...administraByTipo.entries()].map(([k, v]) => [k ?? '(blank)', obj(v, 8)])),
  nonCarreteraCodigo: obj(nonCarreteraCodigo),
  groupTotals: { all: all.length, federal: fed.length, state: st.length },
  stateTipoComposition: (() => { const m = new Map(); for (const g of st) for (const [k, v] of Object.entries(g.tipo)) bump(m, k, v); return obj(m); })(),
  federalTipoComposition: (() => { const m = new Map(); for (const g of fed) for (const [k, v] of Object.entries(g.tipo)) bump(m, k, v); return obj(m); })(),
  stateKmStats: stats(st.map((g) => g.km)),
  federalKmStats: stats(fed.map((g) => g.km)),
  stateSegStats: stats(st.map((g) => g.segs)),
  stateByDigits: obj(byDigits),
  stateByPrefix: obj(byPrefix),
  prefixTable,
  survival,
  segSurvival,
  singleSegmentStateGroups: st.filter((g) => g.segs === 1).length,
  stateGroupsUnder1km: st.filter((g) => g.km < 1).length,
  stateSharingFedNumber: { n: stateSharingFedNumber.length,
    km: +stateSharingFedNumber.reduce((a, g) => a + g.km, 0).toFixed(1),
    sample: stateSharingFedNumber.slice(0, 40).map((g) => ({ key: g.key, segs: g.segs, km: g.km, administra: g.administra, jurisdi: g.jurisdi, topNames: g.topNames.slice(0, 3) })) },
  stateNotSharingFedNumber: st.filter((g) => !fedNums.has(g.number)).length,
  federalGroups: fed.map((g) => ({ key: g.key, segs: g.segs, km: g.km, administra: g.administra, jurisdi: g.jurisdi })).sort((a, b) => b.km - a.km),
  cmx: pick(/^state\|CMX-/),
  em3043: pick(/^state\|EM-(3043|7\d\d|228|774|775)$/),
  topStateByKm: st.slice().sort((a, b) => b.km - a.km).slice(0, 40).map((g) => ({ key: g.key, segs: g.segs, km: g.km, administra: g.administra, jurisdi: g.jurisdi, topNames: g.topNames.slice(0, 3) })),
  bottomStateByKm: st.slice().sort((a, b) => a.km - b.km).slice(0, 40).map((g) => ({ key: g.key, segs: g.segs, km: g.km, administra: g.administra, jurisdi: g.jurisdi, topNames: g.topNames.slice(0, 3) })),
  rejected: Object.fromEntries([...rej.entries()].map(([k, d]) => [k, {
    n: d.n, km: stats(d.km), tipo: obj(d.tipo), jurisdi: obj(d.jurisdi),
    administra: obj(d.administra), condPav: obj(d.condPav), carriles: obj(d.carriles),
    peaje: obj(d.peaje), nombre: obj(d.nombre, 8), distinctNames: d.nombre.size }])),
  codeXtabSample: [...codeXtab.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 80)
    .map(([k, c]) => ({ number: k, segs: c.n, fed: c.fed, nonFed: c.nonFed, km: +c.km.toFixed(1), admin: obj(c.admin), jur: obj(c.jur, 8) })),
  states: Object.fromEntries(Object.entries(STATES).map(([k, v]) => [k, v.code])),
};
await writeFile('tools/_probe-mx.json', JSON.stringify(out, null, 1));
console.error('wrote tools/_probe-mx.json');
