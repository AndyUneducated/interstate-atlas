// Fetches the land border crossings of Canada and Mexico into
// content/reference/border-crossings.json.
//
//   node tools/fetch-border-crossings.mjs
//
// Two national lists, one from each side that publishes one.
//
// Canada
// ──────
// The CBSA Directory of Offices, an open-licence CSV of every designated CBSA
// location. Most of them are not crossings: warehouses, marine ports and
// sufferance facilities are listed alongside the land ports. Each office lists
// the services it offers, and the highway crossings are the ones offering
// HWY/B, CBSA's own code for a Highway/Land Border Office.
//
// The directory gives an address and no coordinates. Each office is placed by
// putting that address through Natural Resources Canada's geolocation service,
// and NRCan's own word for how it found the point is kept: a house number
// interpolated along a street, the middle of a named street, an intersection,
// or only a place name. That is recorded per crossing and shown, because a
// geocoded address is the CBSA office rather than the line on the ground and
// the two are not always the same building.
//
// Taken at its first answer the geocoder is wrong a fifth of the time, and
// wrong by hundreds of kilometres. Rural offices are addressed as a highway and
// a village - "Hwy 30, Gretna, MB" - and NRCan reads that as house 30 on a
// Gretna Bay in Winnipeg, or settles for a lake of the same name in another
// province. So every candidate it returns, for the address, the office name and
// the town, is held to three tests: it is in the office's own province, it is
// named for the office's town or for the office itself, and it is within
// ACCEPT_KM of the United States. The most precise one that passes wins.
// Without the name test, "Lansdowne (Thousand Islands Bridge)" lands on a
// bridge road on Walpole Island, 560 km west and also on the border.
//
// An office none of whose candidates pass is not placed here. Its address
// nearly always names the highway it stands on, and that is recorded instead;
// tools/build-crossings.mjs puts the crossing where that highway, as the atlas
// draws it, meets the border.
//
// Where the office names a US counterpart that the US Bureau of Transportation
// Statistics also places, the two are compared as a check. BTS places a US port
// of entry, which can cover several crossings - Buffalo-Niagara Falls is one
// port and four bridges - so it is too coarse to place a crossing with, but a
// geocode more than CHECK_KM from its own counterpart is reported.
//
// Mexico
// ──────
// INDAABIN's list of federal border ports, the Instituto de Administración y
// Avalúos de Bienes Nacionales being the agency that holds the federal
// property they stand on. It is georeferenced. It is a list of properties, so
// one row can be two crossings - "Nogales I y II" - and it also lists inland
// facilities that are not at the line: the Centros de Atención Integral al
// Tránsito Fronterizo, which are checkpoints tens of kilometres back, and the
// CIITEV vehicle-permit offices. Those are left out. Mexico's southern border
// is included, and which neighbour each port faces is read from INDAABIN's
// region: Península faces Belize, Chiapas and Tabasco face Guatemala.
//
// How many crossings there are
// ────────────────────────────
// The sources do not agree, and nothing here tries to make them. INDAABIN's
// count is of properties. IMT Publicación Técnica 437 counts 52 border bridges
// on the northern line. NADBank's 2019 port-of-entry study says in print that
// it found the published inventories in conflict, and after reconciling them
// settled on 59 crossings, 55 open and 4 closed. Each count is recorded with
// its source.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { usOutline, kmTo } from './border.mjs';
import { loadStateLocator } from './mx-states.mjs';

const ROOT = join(import.meta.dirname, '..');
const OUT = join('content', 'reference', 'border-crossings.json');
const CACHE = join(import.meta.dirname, 'src', 'borders');
const GEOCODES = join(CACHE, 'nrcan-geocodes.json');

const CBSA = 'https://www.cbsa-asfc.gc.ca/data/offices-bureaux-en.csv';
const CBSA_PAGE = 'https://open.canada.ca/data/en/dataset/1018c301-d359-4077-8d9b-4e9fbe6a223f';
const NRCAN = 'https://geogratis.gc.ca/services/geolocation/en/locate';
const BTS = 'https://data.bts.gov/resource/keg4-3bc2.json';
const INDAABIN_PKG = 'https://www.datos.gob.mx/api/3/action/package_show?id=puertos_fronterizos_centros_atencion_transito_fronterizo';
const INDAABIN_PAGE = 'https://www.datos.gob.mx/dataset/puertos_fronterizos_centros_atencion_transito_fronterizo';

const CHECK_KM = 25;
// A highway border office stands at the line. Beaver Creek's is the one CBSA
// office set back from it, 30 km up the Alaska Highway, and at this distance it
// falls to its highway, which puts the crossing where the road actually crosses.
const ACCEPT_KM = 5;
const today = new Date().toISOString().slice(0, 10);

/** RFC 4180, quoted newlines included: CBSA's notes columns carry them. */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...data] = rows;
  return data.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

/** The CBSA file is not consistently UTF-8; a replacement character means it was not. */
async function text(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const utf8 = new TextDecoder('utf-8').decode(buf);
  return utf8.includes('\ufffd') ? new TextDecoder('windows-1252').decode(buf) : utf8;
}

// The geolocation service answers 500 when asked too quickly, and recovers.
const json = async (url, tries = 5) => {
  for (let i = 1; ; i++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (i >= tries || res.status < 500) throw new Error(`${url}: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 1500 * i));
  }
};

const haversineKm = ([x1, y1], [x2, y2]) => {
  const r = Math.PI / 180;
  const a = Math.sin(((y2 - y1) * r) / 2) ** 2
    + Math.cos(y1 * r) * Math.cos(y2 * r) * Math.sin(((x2 - x1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
};

// NRCan's qualifiers, in the words the atlas shows.
const PRECISION = {
  INTERPOLATED_POSITION: 'address',
  INTERPOLATED_CENTROID: 'street',
};
function precisionOf(hit) {
  if (/Intersection$/.test(hit.type)) return 'intersection';
  if (/Geoname$/.test(hit.type)) return 'place';
  return PRECISION[hit.qualifier] ?? 'place';
}
const RANK = { address: 0, intersection: 1, street: 2, place: 3 };

const PROVINCE = {
  NB: 'New Brunswick', QC: 'Quebec', ON: 'Ontario', MB: 'Manitoba', SK: 'Saskatchewan',
  AB: 'Alberta', BC: 'British Columbia', YT: 'Yukon',
};
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
// For comparing place names: Saint and St, hyphens and spaces, all one.
const placeKey = (s) => fold(s).replace(/[^a-z]+/g, ' ').replace(/\bsainte\b/g, 'ste').replace(/\bsaint\b/g, 'st').replace(/ /g, '');

/** The highway an address is on: "Hwy 30", "Highway #4 South", "Route 221", "I-91". */
const HIGHWAY = /\b(?:hwy|highway|route|rte|autoroute|i)\s*[#-]?\s*(\d{1,4})\b/i;

async function geocoder() {
  await mkdir(CACHE, { recursive: true });
  let cache = {};
  try { cache = JSON.parse(await readFile(GEOCODES, 'utf8')); } catch { /* first run */ }
  let asked = 0;
  return {
    /** Every candidate NRCan offers for a query, not only its first. */
    async locate(q) {
      if (!Array.isArray(cache[q])) {
        const hits = await json(`${NRCAN}?q=${encodeURIComponent(q)}`);
        cache[q] = hits
          .filter((h) => h.geometry?.coordinates)
          .map((h) => ({ title: h.title, type: h.type, qualifier: h.qualifier, at: h.geometry.coordinates }));
        asked++;
        if (asked % 20 === 0) await writeFile(GEOCODES, `${JSON.stringify(cache, null, 1)}\n`);
        await new Promise((r) => setTimeout(r, 250));
      }
      return cache[q];
    },
    async save() {
      await writeFile(GEOCODES, `${JSON.stringify(cache, null, 1)}\n`);
      return asked;
    },
  };
}

const usKey = (s) => String(s ?? '').toUpperCase().replace(/\(.*?\)/g, ' ').replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
const US_STATE = {
  Alaska: 'AK', Idaho: 'ID', Maine: 'ME', Michigan: 'MI', Minnesota: 'MN', Montana: 'MT', 'New Hampshire': 'NH',
  'New York': 'NY', 'North Dakota': 'ND', Vermont: 'VT', Washington: 'WA',
};

async function canada() {
  const rows = parseCsv(await text(CBSA));
  const offices = rows.filter((r) => /\bHWY\/B\b/.test(r.Services));

  // US ports BTS places on the northern border, keyed as CBSA writes them: "Madawaska ME".
  const bts = await json(`${BTS}?$select=port_name,state,latitude,longitude&$where=border='US-Canada Border'&$group=port_name,state,latitude,longitude&$limit=500`);
  const btsAt = new Map(bts.map((p) => [usKey(`${p.port_name} ${US_STATE[p.state] ?? p.state}`), [Number(p.longitude), Number(p.latitude)]]));

  const geo = await geocoder();
  const us = await usOutline();
  const out = [];
  const unplaced = [];
  const checks = [];
  for (const o of offices) {
    const pr = o['Physical Address Province'];
    const city = o['Physical Address City'];
    const line1 = o['Physical Address Line 1'];
    const queries = [
      [line1, city, pr].filter(Boolean).join(', '),
      `${o['Office Name']}, ${pr}`,
      city ? `${city}, ${pr}` : null,
    ].filter((q, i, all) => q && all.indexOf(q) === i);

    // The candidate has to be named for the office's town or for the office.
    const places = [city, o['Office Name'].replace(/\(.*?\)|:.*$/g, '')].map(placeKey).filter((p) => p.length >= 3);
    const candidates = [];
    for (const q of queries) {
      for (const h of await geo.locate(q)) {
        if (PROVINCE[pr] && !fold(h.title).includes(fold(PROVINCE[pr]))) continue;
        if (!places.some((p) => placeKey(h.title).includes(p))) continue;
        const km = kmTo(h.at, us);
        if (km > ACCEPT_KM) continue;
        candidates.push({ ...h, query: q, precision: precisionOf(h), km });
      }
    }
    candidates.sort((a, b) => RANK[a.precision] - RANK[b.precision] || a.km - b.km);
    const hit = candidates[0];

    const id = `ca-${o['Office Name'].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    const counterpart = o['US port'] || null;
    const base = { id, country: 'ca', border: 'ca-us', name: o['Office Name'], counterpart, juris: pr || null };

    if (!hit) {
      const highway = HIGHWAY.exec(line1 ?? '')?.[1] ?? null;
      if (!highway) {
        unplaced.push(o['Office Name']);
        out.push({ ...base, at: null, located: { by: 'none', address: queries[0] }, checkKm: null });
        continue;
      }
      out.push({ ...base, at: null, located: { by: 'highway', highway, address: queries[0] }, checkKm: null });
      continue;
    }

    const at = hit.at.map((v) => Number(v.toFixed(5)));
    const usPort = btsAt.get(usKey(counterpart));
    const offKm = usPort ? haversineKm(at, usPort) : null;
    if (offKm != null && offKm > CHECK_KM) checks.push(`${o['Office Name']}: ${offKm.toFixed(0)} km from ${counterpart}`);
    out.push({
      ...base,
      at,
      located: { by: 'geocode', precision: hit.precision, query: hit.query, match: hit.title, borderKm: Number(hit.km.toFixed(1)) },
      checkKm: offKm != null ? Number(offKm.toFixed(1)) : null,
    });
  }
  const asked = await geo.save();
  const placed = out.filter((c) => c.at);
  const byHighway = out.filter((c) => c.located.by === 'highway');
  console.log(`  CBSA: ${rows.length} offices, ${offices.length} offer HWY/B; ${placed.length} geocoded,`
    + ` ${byHighway.length} left to their highway, ${unplaced.length} neither (${asked} new geocodes)`);
  const byPrecision = {};
  for (const c of placed) byPrecision[c.located.precision] = (byPrecision[c.located.precision] ?? 0) + 1;
  console.log(`        precision ${JSON.stringify(byPrecision)}; ${placed.filter((c) => c.checkKm != null).length} checked against BTS`);
  for (const c of checks) console.log(`        CHECK ${c}`);
  for (const c of byHighway) console.log(`        highway ${c.juris} ${c.located.highway}: ${c.name}`);
  if (unplaced.length) console.log(`        unplaced: ${unplaced.join(', ')}`);

  return {
    crossings: out,
    source: {
      title: 'Directory of CBSA Offices',
      agency: 'Canada Border Services Agency',
      url: CBSA_PAGE,
      file: CBSA,
      licence: 'Open Government Licence – Canada',
      filter: 'offices whose services include HWY/B (Highway/Land Border Office)',
      offices: rows.length,
      highway: offices.length,
      geocoder: {
        agency: 'Natural Resources Canada', service: 'Geolocation Service', url: NRCAN,
        accept: `a candidate in the office's province within ${ACCEPT_KM} km of the US, measured to Natural Earth 1:10m state outlines`,
        geocoded: placed.length,
        byHighway: byHighway.length,
      },
      check: {
        against: 'US ports of entry placed by the US Bureau of Transportation Statistics, Border Crossing Entry Data (public domain)',
        url: 'https://data.bts.gov/Research-and-Statistics/Border-Crossing-Entry-Data/keg4-3bc2',
        thresholdKm: CHECK_KM,
        checked: placed.filter((c) => c.checkKm != null).length,
        over: checks,
      },
      byPrecision,
      unplaced,
    },
  };
}

// INDAABIN's regions, and the neighbour each faces.
const FACES = (region) => (/^Pen[ií]nsula/i.test(region) ? 'mx-bz' : /^(Chiapas|Tabasco)/i.test(region) ? 'mx-gt' : 'mx-us');

async function mexico() {
  const pkg = (await json(INDAABIN_PKG)).result;
  // The resource that carries coordinates. The quarterly lists that follow it
  // dropped the latitude and longitude columns, so they are not used even when newer.
  let chosen = null;
  for (const r of pkg.resources.filter((x) => /csv/i.test(x.format))) {
    const rows = parseCsv(await text(r.url));
    if (rows.length && 'latitud' in rows[0] && 'longitud' in rows[0]) { chosen = { r, rows }; break; }
  }
  if (!chosen) throw new Error('no INDAABIN resource carries coordinates any more');
  const { r, rows } = chosen;

  const kept = rows.filter((x) => /^Puerto Fronterizo\b/i.test(x.denominacion));
  const left = rows.filter((x) => !kept.includes(x)).map((x) => x.denominacion);
  // INDAABIN's regions are its own administrative districts, not states -
  // Coahuila's and Nuevo León's ports are filed under other names - so the
  // state is read off the point. A port sits on the line, and Natural Earth's
  // generalised line can leave it just outside Mexico, so a miss is retried a
  // little way off in each direction before the state is left blank.
  const locate = await loadStateLocator();
  const stateAt = ([x, y]) => {
    for (const d of [0, 0.01, 0.02, 0.04]) {
      for (const [dx, dy] of d ? [[0, -d], [0, d], [-d, 0], [d, 0], [-d, -d], [d, -d], [-d, d], [d, d]] : [[0, 0]]) {
        const code = locate([x + dx, y + dy]);
        if (code) return code;
      }
    }
    return null;
  };
  const crossings = kept.map((x) => {
    const at = [Number(Number(x.longitud).toFixed(5)), Number(Number(x.latitud).toFixed(5))];
    return {
      id: `mx-${x.rfi}`,
      country: 'mx',
      border: FACES(x.region),
      name: x.denominacion.replace(/^Puerto Fronterizo\s+(de\s+)?/i, ''),
      counterpart: null,
      juris: stateAt(at),
      region: x.region,
      rfi: x.rfi,
      at,
      located: { by: 'source' },
      checkKm: null,
    };
  });
  const byBorder = {};
  for (const c of crossings) byBorder[c.border] = (byBorder[c.border] ?? 0) + 1;
  console.log(`  INDAABIN: ${rows.length} rows, ${crossings.length} border ports ${JSON.stringify(byBorder)}; left out: ${left.join('; ')}`);

  return {
    crossings,
    source: {
      title: pkg.title,
      agency: 'Instituto de Administración y Avalúos de Bienes Nacionales (INDAABIN)',
      url: INDAABIN_PAGE,
      file: r.url,
      resource: r.name,
      licence: pkg.license_title,
      filter: 'rows named Puerto Fronterizo; inland CAITF checkpoints and CIITEV vehicle-permit offices left out',
      rows: rows.length,
      leftOut: left,
      byBorder,
      unit: 'federal border-port properties; one property can hold more than one crossing, as "Nogales I y II" does',
    },
  };
}

async function main() {
  console.log('fetching border crossings\n');
  const ca = await canada();
  const mx = await mexico();

  await writeFile(join(ROOT, OUT), `${JSON.stringify({
    retrieved: today,
    purpose: 'Land border crossings of Canada and Mexico, from each country\'s published list.',
    sources: { ca: ca.source, mx: mx.source },
    counts: {
      note: 'Published counts of Mexico\'s northern crossings disagree, and each is a count of something different. None is preferred.',
      published: [
        { count: mx.source.byBorder['mx-us'] ?? 0, of: 'federal border-port properties on the US border', source: 'INDAABIN, Puertos fronterizos (2025 list)', url: INDAABIN_PAGE },
        { count: 52, of: 'border bridges', source: 'Instituto Mexicano del Transporte, Publicación Técnica 437', url: 'https://www.imt.mx/archivos/Publicaciones/PublicacionTecnica/pt437.pdf' },
        { count: 59, of: 'crossings after reconciling conflicting inventories, 55 operating and 4 closed', source: 'North American Development Bank, Port of Entry Study, December 2019', url: 'https://nadbank.org/hubfs/publicaciones-y-estudios/december_2019_port_of_entry_study_final_report_spanish_version_clean.pdf' },
      ],
    },
    crossings: [...ca.crossings, ...mx.crossings],
  }, null, 1)}\n`);
  console.log(`\nwrote ${OUT}: ${ca.crossings.length + mx.crossings.length} crossings`);
}

main().catch((e) => { console.error(e); process.exit(1); });
