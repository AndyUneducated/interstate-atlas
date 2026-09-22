// Fetches the bridges whose builders wrote down when they built them.
//
//   node tools/fetch-bridges.mjs
//
// This exists because of a hole in the atlas. The American half can say when
// an Interstate opened, and Quebec can say when each autoroute tronçon did,
// and everywhere else in Canada and all of Mexico can say nothing at all. The
// obvious patch is to reach for bridge inventories, which carry a year built,
// and back-date the road from the structure on it.
//
// That patch is refused here. A bridge's year built is a fact about the
// bridge. Treating it as the road's opening year is an inference, and one
// that fails in both directions: a 1998 bridge on a 1960s highway dates a
// replacement, and a road can open before its permanent structures are
// finished. So these are published as bridges - their own layer, their own
// dates, answering their own question - and no opening year is derived from
// them. The gap in the construction timeline stays a gap, and is documented
// as one.
//
// Two inventories, from opposite ends of the continent, and they turn out to
// be the same shape: a route number, a position, a year built, and the
// structure's dimensions.
//
//   Mexico    SICT's bridge inventory for the federal free network. 9,800
//             structures with construction year and, separately, the year of
//             the last reconstruction - which is the distinction the Ontario
//             file also draws and which matters, because conflating them
//             ages every rebuilt bridge to its rebuild.
//   Ontario   The province's Bridge Conditions release. 5,100 structures with
//             year built, the last major and minor rehabilitation, and a
//             condition index going back two decades.
//
// What is not here is as much of the continent as is here. Mexico's toll
// network is run by CAPUFE and FONADIN and is not in SICT's free-network
// inventory, so its bridges - which include most of the long ones - are
// absent. Ontario is one province of thirteen. The United States has the
// National Bridge Inventory, which is a far larger and better source than
// either and is not read here yet.

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fetchCsv } from './csv.mjs';

const OUT = join('content', 'reference', 'bridges.json');

const MX_URL = 'https://repodatos.atdt.gob.mx/api_update/secretaria_comunicaciones'
  + '/puentes_red_federal_carreteras_libres_peaje/puentes_red_federal_libre_2026.csv';
const ON_URL = 'https://data.ontario.ca/dataset/37a472f6-b7ea-4a41-9d4b-64a0c8e5025a'
  + '/resource/703cdf01-ff09-4b86-b017-6e8d87b11fd2'
  + '/download/bridge_condition_open_data_2020_en.csv';

// Nothing older than the first iron bridge on the continent and nothing in
// the future. A year outside this is a data error, not a very old bridge.
const EARLIEST = 1850;
const LATEST = new Date().getFullYear() + 1;

// Mexico writes an absent value three ways and a year as a float.
const BLANK = /^(?:sin dato|s\/d|n\/d|nd|na|n\/a|-|\.)$/i;

const text = (v) => {
  const s = String(v ?? '').trim();
  return s && !BLANK.test(s) ? s : null;
};

const year = (v) => {
  const s = text(v);
  const n = s ? Math.trunc(Number(s)) : NaN;
  return Number.isFinite(n) && n >= EARLIEST && n <= LATEST ? n : null;
};

const number = (v) => {
  const s = text(v)?.replace(/,/g, '');
  const n = s ? Number(s) : NaN;
  return Number.isFinite(n) ? n : null;
};

// Five decimal places is about a metre, which is finer than either publisher
// locates a structure to and far finer than a map layer needs.
const coord = (v, limit) => {
  const n = number(v);
  return n != null && Math.abs(n) <= limit && n !== 0 ? Math.round(n * 1e5) / 1e5 : null;
};

const round = (v, dp = 1) => (v == null ? null : Math.round(v * 10 ** dp) / 10 ** dp);

/** Requires the columns a reader depends on, so a renamed field is not a silent empty. */
function needs(rows, columns, what) {
  if (!rows.length) throw new Error(`${what}: no rows`);
  const missing = columns.filter((c) => !(c in rows[0]));
  if (missing.length) throw new Error(`${what}: columns gone: ${missing.join(', ')}`);
}

// --------------------------------------------------------------- Mexico

const MX_COLS = ['estado', 'nombre_puente', 'carretera', 'ruta', 'ano_construccion',
  'ano_ultima_reconstruccion', 'latitud_geografica', 'longitud_geografica',
  'longitud_total_m', 'ancho_total_m', 'km'];

async function mexico() {
  const { rows, encoding } = await fetchCsv(MX_URL);
  needs(rows, MX_COLS, 'Mexico bridges');

  const bridges = [];
  for (const r of rows) {
    const built = year(r.ano_construccion);
    const lat = coord(r.latitud_geografica, 90);
    const lon = coord(r.longitud_geografica, 180);
    bridges.push({
      name: text(r.nombre_puente),
      // The route the structure carries, as the inventory states it. Left as
      // published rather than normalised against the Red Nacional de Caminos
      // codes, because the two are separate statements and reconciling them
      // is the cross-check's job, not this file's.
      route: text(r.ruta),
      road: text(r.carretera),
      at: text(r.km),
      state: text(r.estado),
      built,
      rebuilt: year(r.ano_ultima_reconstruccion),
      lat,
      lon,
      lengthM: round(number(r.longitud_total_m)),
      widthM: round(number(r.ancho_total_m)),
    });
  }

  return {
    country: 'mx',
    name: { en: 'Mexico, federal free network', es: 'México, red federal libre de peaje' },
    source: 'Secretaría de Infraestructura, Comunicaciones y Transportes, '
      + 'Puentes de la Red Federal de carreteras libres de peaje',
    url: 'https://datos.gob.mx/dataset/puentes-de-la-red-federal-de-carreteras-libres-de-peaje',
    licence: 'Libre Uso MX',
    edition: 2026,
    encoding,
    covers: 'The federal free network only. Bridges on the tolled network are '
      + 'operated by CAPUFE and FONADIN and are not in this inventory, which '
      + 'leaves out most of the longest structures in the country.',
    bridges,
  };
}

// -------------------------------------------------------------- Ontario

// Folded to lower case by the reader, so the ministry's shouting is not
// reproduced here.
const ON_COLS = ['highway name', 'structure name', 'year built', 'latitude', 'longitude',
  'category', 'last major rehab', 'deck / culverts length (m)', 'width total (m)',
  'operation status', 'owner', 'county'];

// The file is a structures inventory, not a bridge list: rather more than half
// of it is culverts. They are kept, because a box culvert under a highway is a
// structure with a build date and the province counts it as one, but the
// category travels with each record so that a bridge layer can be a bridge
// layer.
async function ontario() {
  const { rows } = await fetchCsv(ON_URL);
  needs(rows, ON_COLS, 'Ontario bridges');

  const bridges = rows.map((r) => ({
    name: text(r['structure name']),
    nameFr: text(r['french name']),
    route: text(r['highway name']),
    county: text(r.county),
    kind: text(r.category),
    built: year(r['year built']),
    rebuilt: year(r['last major rehab']),
    lat: coord(r.latitude, 90),
    lon: coord(r.longitude, 180),
    lengthM: round(number(r['deck / culverts length (m)'])),
    widthM: round(number(r['width total (m)'])),
    status: text(r['operation status']),
    owner: text(r.owner),
  }));

  return {
    country: 'ca',
    region: 'ON',
    name: { en: 'Ontario', fr: 'Ontario' },
    source: 'Ontario Ministry of Transportation, Bridge conditions',
    url: 'https://data.ontario.ca/dataset/bridge-conditions',
    licence: 'Open Government Licence – Ontario',
    edition: 2020,
    covers: 'Provincial structures in Ontario, bridges and culverts together, '
      + 'with the category on each record. One province of thirteen: no other '
      + 'Canadian jurisdiction was found publishing a comparable inventory.',
    bridges,
  };
}

/**
 * Records as a field list and rows, the way the atlas carries its route index.
 *
 * Fifteen thousand structures written as objects is four megabytes, most of
 * it repeating the same dozen key names and spelling out the fields that are
 * empty. As columns it is a third of that, and a map layer wants columns
 * anyway.
 */
function columnar(records) {
  const fields = [];
  for (const r of records) for (const k of Object.keys(r)) if (!fields.includes(k)) fields.push(k);
  return { fields, rows: records.map((r) => fields.map((f) => r[f] ?? null)) };
}

/** What can be said about a set of structures without inferring anything. */
function summarise(bridges) {
  const dated = bridges.filter((b) => b.built);
  const placed = bridges.filter((b) => b.lat != null && b.lon != null);
  const byDecade = {};
  for (const b of dated) {
    const decade = Math.floor(b.built / 10) * 10;
    byDecade[decade] = (byDecade[decade] ?? 0) + 1;
  }
  return {
    total: bridges.length,
    dated: dated.length,
    placed: placed.length,
    rebuilt: bridges.filter((b) => b.rebuilt).length,
    oldest: dated.length ? Math.min(...dated.map((b) => b.built)) : null,
    newest: dated.length ? Math.max(...dated.map((b) => b.built)) : null,
    onRoute: new Set(bridges.map((b) => b.route).filter(Boolean)).size,
    byDecade,
  };
}

async function main() {
  const sets = [];
  for (const load of [mexico, ontario]) {
    try {
      const set = await load();
      const s = summarise(set.bridges);
      set.summary = s;
      Object.assign(set, columnar(set.bridges));
      delete set.bridges;
      sets.push(set);
      console.log(`  ${set.country}${set.region ? `-${set.region}` : ''}  `
        + `${String(s.total).padStart(5)} structures`
        + `   ${s.dated} dated ${s.oldest}-${s.newest}`
        + `   ${s.placed} placed   ${s.onRoute} routes named`);
    } catch (e) {
      console.log(`  ${load.name} failed: ${e.message}`);
    }
  }

  await mkdir(join('content', 'reference'), { recursive: true });
  await writeFile(OUT, `${JSON.stringify({
    retrieved: new Date().toISOString().slice(0, 10),
    purpose: 'Bridges, with the year each was built as its owner records it.',
    notInferred: 'A year built is a fact about the structure. It is not used, here '
      + 'or anywhere downstream, to date the opening of the road the structure '
      + 'carries: a new bridge on an old highway dates a replacement, and roads '
      + 'open before their permanent structures are finished. The construction '
      + 'timeline\'s gaps outside the United States and Quebec remain gaps.',
    missing: 'Mexico\'s tolled network, the other twelve Canadian jurisdictions, '
      + 'and the United States, whose National Bridge Inventory is a better source '
      + 'than either of these and is not read yet.',
    sets,
  }, null, 1)}\n`);

  const total = sets.reduce((a, s) => a + s.rows.length, 0);
  console.log(`\nwrote ${OUT}: ${total} structures across ${sets.length} inventories`);
}

export { year, coord };

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
