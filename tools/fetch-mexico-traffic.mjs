// Fetches Mexico's national traffic counts from SICT's Datos Viales.
//
//   node tools/fetch-mexico-traffic.mjs
//
// Source: the Secretaría de Infraestructura, Comunicaciones y Transportes,
// through the national open-data portal. Two CSV resources: the current survey
// year on its own, and a twelve-year panel carrying an `ejercicio` column.
// Between them they cover about 73,000 km of the paved national network, which
// is most of the road Mexico counts traffic on and none of the state network
// it does not.
//
// The measure is TDPA - tránsito diario promedio anual - which is AADT under
// another name, so it sits beside the American and Canadian figures without
// conversion. What comes with it is better than either: nine vehicle classes
// per site, from motorcycles through the five-axle tractor configurations, and
// the peak-hour and directional factors behind them.
//
// Three things about this data shape everything below, and each one is a way
// the figures could be made to say more than they know.
//
// These are points, not sections. Every row is one counting station at one
// kilometre post, with a latitude and a longitude. The American HPMS join
// produces a length-weighted average per route because HPMS describes
// sections; doing the same here would mean assuming the traffic between two
// stations, which is exactly the interpolation this atlas does not do. So the
// station observations are kept as observations. The per-route block carries a
// station count and the range across those stations, labelled as such, and
// there is deliberately no route-level mean pretending to be length-weighted.
//
// Some of the figures are inferred rather than counted. SICT states that in
// the 2024 survey the TDPA at 2,206 sites was obtained by statistical
// inference from the site's historical behaviour rather than from a count that
// year. No column in either resource distinguishes those rows - the field list
// is checked against the documented one on every run, and nothing in it is a
// method flag - so the atlas cannot mark them individually. What it can do is
// say how many there are, which is what `inferred` below is for.
//
// The numbers are revised backwards. The portal warns that a historical figure
// can change in a later update, so a year alone does not identify a figure.
// Everything here therefore carries the retrieval date as well, and the
// licence requires it in that form anyway.
//
// One more thing worth knowing before reading a Mexican place name out of
// this file. The two resources are not encoded alike: the survey-year CSV is
// UTF-8 and keeps its accents, while the panel has been flattened to ASCII
// with spaces turned into underscores, so "Acámbaro" is "Acambaro" in one and
// the same road is "Acceso a Pabellon de Arteaga" in one and
// "Acceso_a_Pabellon_de_Arteaga" in the other. The survey-year file also
// carries a residue of a Latin-1 round trip somewhere upstream: a small number
// of values contain the double-encoded forms of ü and of a typographic dash.
// Both are reported by this script rather than silently repaired, because a
// repair that guesses is how mojibake becomes permanent.

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normaliseRoute, state } from './mexico.mjs';

const OUT = join('content', 'reference', 'mx-traffic.json');

const PORTAL = 'https://www.datos.gob.mx';
const DATASET = 'datos_viales';

// The columns the publisher documents. Checked rather than assumed: if a
// column appears that is not here, it might be the method flag the inferred
// sites need, and the run says so instead of ignoring it.
const PANEL_COLUMNS = [
  'estado', 'carretera', 'clave', 'ruta', 'punto_generador', 'km', 'te', 'sc',
  'tdpa', 'm', 'a', 'b', 'c2', 'c3', 't3s2', 't3s3', 't3s2r4', 'otros',
  'aa', 'bb', 'cc', 'k', 'd', 'latitud', 'longitud', 'ejercicio',
];

// The nine classes, in the order the publisher lists them: motorcycles, cars,
// buses, then the truck and tractor configurations by axle count.
const CLASSES = ['m', 'a', 'b', 'c2', 'c3', 't3s2', 't3s3', 't3s2r4', 'otros'];

// The same nine rolled up into the three the Mexican design standards use.
// Named separately in the two resources - aa/bb/cc in the panel, a1/b1/c in
// the survey year - and verified here rather than trusted: cc is the share of
// everything from c2 rightwards, which is the truck share this atlas shows
// beside the American and Canadian ones.
const ROLLUP = { cars: ['aa', 'a1'], buses: ['bb', 'b1'], trucks: ['cc', 'c'] };

// Double-encoded UTF-8: the bytes of an accented character read as Latin-1 and
// written back out as UTF-8. "Ã¼" for ü, "â€“" for an en dash.
const DOUBLE_ENCODED = /Ã.|â€./g;

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[\s,]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/**
 * Decode a CSV the publisher did not label.
 *
 * Latin-1 is common enough in Mexican government CSVs that assuming UTF-8 is
 * the classic way to lose every accent in the file, so the encoding is
 * established rather than declared: UTF-8 is tried strictly, and a file that
 * is not valid UTF-8 is read as Windows-1252, which is the superset of Latin-1
 * that Excel writes. Which one it turned out to be is recorded in the output.
 */
function decode(buf) {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, ''), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(buf), encoding: 'windows-1252' };
  }
}

/** A CSV with quoted fields and CRLF line endings, as rows of strings. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; if (row.some((v) => v !== '')) rows.push(row); row = []; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((v) => v !== '')) rows.push(row); }

  const head = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

/**
 * The two resources the dataset publishes, as the portal currently lists them.
 *
 * Resolved rather than written down, so that the annual re-publication needs
 * no code change, and so that the download URL the licence requires citing is
 * the one actually used.
 */
async function resolveResources() {
  const res = await fetch(`${PORTAL}/api/3/action/package_show?id=${DATASET}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from the datos.gob.mx catalogue`);
  const pkg = (await res.json()).result;
  const named = (re) => (pkg.resources ?? []).find((r) => re.test(r.name ?? ''));
  return {
    pkg,
    // "Datos viales (2013-2024)" against "Datos viales (2024)": the panel is
    // the one whose name spans two years.
    panel: named(/\(\s*\d{4}\s*[-\u2013]\s*\d{4}\s*\)/),
    survey: named(/\(\s*\d{4}\s*\)/),
  };
}

/**
 * Fetch one resource, preferring the file the catalogue points at.
 *
 * The catalogue's URL is the canonical one and the one that gets cited. The
 * portal also keeps its own copy of the same rows behind a dump endpoint on
 * its own host, which is the fallback when the file host cannot be reached -
 * it is the same publisher and the same load, and the run records which of the
 * two the figures came from so that a reader is never left guessing.
 */
async function fetchResource(resource, label) {
  const attempts = [
    { via: 'publisher', url: resource.url },
    { via: 'portal', url: `${PORTAL}/datastore/dump/${resource.id}` },
  ];
  const failures = [];
  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const { text, encoding } = decode(buf);
      console.log(`  ${label.padEnd(18)} ${(buf.length / 1048576).toFixed(1)} MB, ${encoding}`
        + `${attempt.via === 'portal' ? '  (via the portal copy)' : ''}`);
      return { rows: parseCsv(text), encoding, via: attempt.via, url: attempt.url, bytes: buf.length, text };
    } catch (e) {
      failures.push(`${attempt.via}: ${e.message}`);
    }
  }
  throw new Error(failures.join('; '));
}

/**
 * A counting station's identity.
 *
 * There is no station id in the file. What identifies a site is where it is:
 * the road, the section key and the kilometre post, with the generator point
 * it is measured against. Coordinates alone will not do - a site that was
 * re-surveyed carries a slightly different fix from one year to the next.
 */
const stationKey = (r) => [r.estado, r.carretera, r.clave, r.punto_generador, r.km].join('|');

// SICT writes the route as MEX-045 throughout, so the prefix is normally
// there. A value that arrives without one is a federal number, which is what
// a bare carretera number means, and what the road file's CODIGO holds too.
const routeOf = (value) => normaliseRoute(value).map((r) => `${r.prefix ?? 'MEX'}-${r.number}`);

// Folded rather than spread: a spread over a hundred thousand values
// overflows the call stack, and the panel has more than that.
const least = (values) => values.reduce((a, b) => (b < a ? b : a), Infinity);
const most = (values) => values.reduce((a, b) => (b > a ? b : a), -Infinity);

const median = (values) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

/** The rolled-up share under whichever of its two names this resource uses. */
const rollup = (row, which) => {
  for (const key of ROLLUP[which]) if (row[key] != null && row[key] !== '') return num(row[key]);
  return null;
};

const round = (v, dp) => (v == null ? null : Number(v.toFixed(dp)));

async function main() {
  const { pkg, panel, survey } = await resolveResources();
  if (!panel || !survey) throw new Error('the catalogue no longer lists both Datos Viales resources');

  console.log('fetching SICT Datos Viales\n');
  const got = {
    survey: await fetchResource(survey, survey.name),
    panel: await fetchResource(panel, panel.name),
  };

  // Does anything in either resource distinguish the statistically inferred
  // sites from the counted ones? If a column ever appears that is not in the
  // documented list, it is worth looking at before the next release.
  const columns = [...new Set(got.panel.rows.length ? Object.keys(got.panel.rows[0]) : [])]
    .filter((c) => c !== '_id');
  const undocumented = columns.filter((c) => !PANEL_COLUMNS.includes(c));
  const missing = PANEL_COLUMNS.filter((c) => !columns.includes(c));

  // The survey-year resource is the one worth keeping station by station: it
  // has the accents, the punctuation and the k and d factors, and it is the
  // edition SICT documents. The panel is read for how the count has moved.
  const latest = String(most(got.panel.rows.map((r) => num(r.ejercicio) ?? 0)));
  const stations = [];
  const seen = new Set();
  let noCoords = 0;
  let noTdpa = 0;
  let classesOff = 0;
  let rollupOff = 0;

  for (const r of got.survey.rows) {
    const tdpa = num(r.tdpa);
    // A site that appears in the survey with no volume against it. Left out
    // rather than carried as a zero, which would read as a road nobody uses.
    if (tdpa == null) { noTdpa++; continue; }
    const routes = routeOf(r.ruta);
    const st = state(r.estado);
    const lat = num(r.latitud);
    const lon = num(r.longitud);
    if (lat == null || lon == null) noCoords++;
    seen.add(stationKey(r));

    const shares = CLASSES.map((c) => num(r[c]));
    const total = shares.reduce((a, v) => a + (v ?? 0), 0);
    if (shares.some((v) => v != null) && Math.abs(total - 100) > 1) classesOff++;
    // cc is published as the truck share; it should be the nine classes from
    // c2 rightwards. Checked, because if it ever stops being that the atlas
    // would be showing a car share as a truck one.
    const trucks = rollup(r, 'trucks');
    const fromClasses = CLASSES.slice(3).reduce((a, c) => a + (num(r[c]) ?? 0), 0);
    if (trucks != null && Math.abs(trucks - fromClasses) > 0.5) rollupOff++;

    stations.push([
      st?.code ?? null,
      routes[0] ?? null,
      r.carretera || null,
      r.clave ? String(num(r.clave) ?? r.clave) : null,
      r.punto_generador || null,
      round(num(r.km), 1),
      num(r.te),
      num(r.sc),
      tdpa,
      ...shares,
      trucks,
      round(num(r["k'"] ?? r.k), 3),
      round(num(r.d), 3),
      lat,
      lon,
    ]);
  }

  // Per year, so the retroactive revisions have something to be visible
  // against and so the panel's own coverage is on the record.
  const years = {};
  const byRouteYear = new Map();
  for (const r of got.panel.rows) {
    const year = String(num(r.ejercicio) ?? '');
    if (!year) continue;
    const tdpa = num(r.tdpa);
    const y = years[year] ??= { rows: 0, stations: new Set(), tdpa: [] };
    y.rows++;
    y.stations.add(stationKey(r));
    if (tdpa != null) y.tdpa.push(tdpa);

    for (const id of routeOf(r.ruta)) {
      const key = `${id}|${year}`;
      if (!byRouteYear.has(key)) byRouteYear.set(key, { id, year, values: [] });
      if (tdpa != null) byRouteYear.get(key).values.push(tdpa);
    }
  }
  for (const [year, y] of Object.entries(years)) {
    years[year] = { rows: y.rows, stations: y.stations.size, tdpaMedian: median(y.tdpa) };
  }

  /*
   * The per-route block, and what it deliberately is not.
   *
   * It is a count of the stations on a route and the spread of what they read.
   * It is not a length-weighted average, because nothing here has a length:
   * turning point counts into a figure for a whole road means assuming the
   * traffic on the pavement between them, and the assumption would be invisible
   * in the result. A road counted in two places near a city and nowhere else
   * would come out as a busy road end to end.
   *
   * The median is an observation - it is the reading of one of the stations -
   * rather than a number arrived at by arithmetic over the road.
   */
  const routes = {};
  for (const { id, year, values } of byRouteYear.values()) {
    if (!values.length) continue;
    const r = routes[id] ??= { method: 'stations', trend: {} };
    r.trend[year] = [values.length, median(values)];
    if (year === latest) {
      r.stations = values.length;
      r.year = Number(year);
      r.tdpaMin = least(values);
      r.tdpaMedian = median(values);
      r.tdpaMax = most(values);
    }
  }

  const mojibake = (got.survey.text.match(DOUBLE_ENCODED) ?? []).length;
  const retrieved = new Date().toISOString().slice(0, 10);

  await mkdir(join('content', 'reference'), { recursive: true });
  await writeFile(OUT, `${JSON.stringify({
    source: 'Secretaría de Infraestructura, Comunicaciones y Transportes (SICT), Datos viales',
    agency: 'SICT',
    url: `${PORTAL}/dataset/${DATASET}`,
    downloaded: { survey: got.survey.url, panel: got.panel.url, via: got.survey.via },
    licence: 'Términos de Libre Uso MX',
    // The licence asks for the dataset name, the agency's acronym, the URL the
    // data was taken from and the date it was taken, in that form. Assembled
    // here so that the site cannot show the figures without it.
    citation: `Datos viales, SICT, ${PORTAL}/dataset/${DATASET}, ${retrieved}`,
    measure: 'TDPA (tránsito diario promedio anual), equivalent to AADT',
    method: 'stations',
    retrieved,
    updated: pkg?.metadata_modified?.slice(0, 10) ?? null,
    coverageKm: 73000,
    note: 'Point counting stations on the paved national network, not sections. '
      + 'Figures are per station, at the kilometre post given; no route-level '
      + 'average is computed, because averaging points into a road means '
      + 'assuming the traffic on the pavement between them. The per-route block '
      + 'is a station count and the spread across those stations.',
    limitations: {
      inferred: {
        sites: 2206,
        year: 2024,
        flaggedInData: false,
        source: 'SICT, Datos Viales 2024',
        note: 'SICT obtained the TDPA at these sites by statistical inference '
          + 'from their historical behaviour rather than from a count in the '
          + 'survey year. Neither resource carries a column identifying which '
          + 'rows they are, so they cannot be marked individually.',
      },
      revision: 'The publisher warns that historical figures may change in later '
        + 'updates, so a figure is identified by the date it was retrieved as '
        + 'well as by its year.',
      // The two resources describe the same survey year and do not agree about
      // how much of it they have. Recorded rather than reconciled: which of
      // the two is right is not something this end can establish.
      blankTdpa: {
        rows: noTdpa,
        of: got.survey.rows.length,
        note: 'Rows in the survey-year resource with the TDPA column empty. The '
          + 'same year in the twelve-year panel carries a value on every row, '
          + 'so the two resources disagree about the survey\'s own coverage.',
      },
      encoding: {
        survey: got.survey.encoding,
        panel: got.panel.encoding,
        doubleEncodedValues: mojibake,
        note: 'The panel resource is flattened to ASCII with underscores for '
          + 'spaces, so its place names lose their accents and their '
          + 'punctuation; the survey-year resource keeps both. A few values in '
          + 'the survey-year resource arrive double-encoded from upstream and '
          + 'are passed through unrepaired.',
      },
      undocumentedColumns: undocumented,
      missingColumns: missing,
    },
    latest: Number(latest),
    years,
    // Positional rows, as index.json is, rather than ten thousand copies of
    // the same twenty-three keys.
    fields: ['st', 'route', 'road', 'clave', 'point', 'km', 'te', 'sc', 'tdpa',
      ...CLASSES, 'trucks', 'k', 'd', 'lat', 'lon'],
    fieldNotes: {
      te: 'the publisher\'s code for where the count sits relative to the '
        + 'generator point; the code list is not published with the data and is '
        + 'passed through unread',
      sc: 'the publisher\'s code for direction of circulation. Two thirds of '
        + 'rows carry one value and the rest split into two near-equal groups, '
        + 'which is what a two-way count and a pair of directional ones would '
        + 'look like, but the code list is not published and nothing here '
        + 'depends on the reading',
      k: 'peak-hour factor',
      d: 'directional factor',
      trucks: 'the published rollup of the six truck and tractor classes',
    },
    stations,
    routes,
  }, null, 1)}\n`);

  const total = Object.values(years).reduce((a, y) => a + y.rows, 0);
  console.log(`\n  panel        ${total} rows, ${Object.keys(years).length} years`);
  for (const [year, y] of Object.entries(years).sort()) {
    console.log(`    ${year}  ${String(y.rows).padStart(6)} rows  ${String(y.stations).padStart(6)} stations`
      + `  median TDPA ${y.tdpaMedian?.toLocaleString()}`);
  }
  console.log(`\n  survey ${latest}  ${got.survey.rows.length} rows -> ${stations.length} station`
    + ` observations at ${seen.size} distinct sites`);
  if (noTdpa) console.log(`    ${noTdpa} rows carry no TDPA and are left out`);
  if (noCoords) console.log(`    ${noCoords} without coordinates`);
  if (classesOff) console.log(`    ${classesOff} whose nine class shares do not sum to 100`);
  console.log(`    published truck share disagrees with the classes behind it on ${rollupOff} rows`);
  console.log(`    ${mojibake} double-encoded values, passed through as they came`);
  if (undocumented.length) console.log(`    columns not in the documented list: ${undocumented.join(', ')}`);
  if (missing.length) console.log(`    documented columns not present: ${missing.join(', ')}`);

  const withLatest = Object.values(routes).filter((r) => r.stations).length;
  console.log(`\nwrote ${OUT}: ${stations.length} stations across ${Object.keys(routes).length} routes`
    + ` (${withLatest} counted in ${latest})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
