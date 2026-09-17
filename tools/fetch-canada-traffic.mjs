// Fetches per-route traffic figures from the provinces that publish them.
//
//   node tools/fetch-canada-traffic.mjs
//
// The American half of this atlas can say how busy a road is because HPMS is a
// single national collection every state reports into. Canada has no such
// thing. Traffic counting is provincial, and each province decides on its own
// whether to publish, in what form, and under what terms. So this is five
// separate feeds in five separate shapes, and the result is deliberately
// partial: five of thirteen jurisdictions, covering most of the country's
// traffic but nothing like all of its road.
//
// What is not here, and why, because the gaps are part of the answer:
//
//   British Columbia  counts continuously and publishes the current year only
//                     through an interactive map, with no bulk download; the
//                     open-data catalogue's copy stops at 2010.
//   Saskatchewan      publishes as a PDF map.
//   Manitoba          publishes through a web application and a PDF.
//   NL, PEI, NT,      no machine-readable traffic publication found.
//   YT, NU
//
// Every figure here is joined to a route by the province's own route number -
// or, in New Brunswick, by the route encoded in its control-section key, which
// is checked against the routes the atlas already has rather than trusted. None
// of it is joined by position, so a wrong geometry cannot pick up a real count.

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lineLengthKm } from './geo.mjs';
import { fetchWorkbook } from './xlsx.mjs';

const OUT = join('content', 'reference', 'ca-traffic.json');

// Rounded the way the underlying measure is actually carried, matching how the
// HPMS figures are rounded so the two read as the same kind of number.
const STEPS = { aadt: 100, truck: 0.1, speed: 1 };

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[\s,]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/**
 * Accumulates length-weighted measures for one route.
 *
 * Each measure keeps its own denominator. A province may count traffic
 * everywhere and truck share only on the sections with a classifier, and
 * carrying the two lengths separately is what lets the site say that the truck
 * figure describes a fifth of the road rather than presenting it as the whole.
 */
class Route {
  constructor() {
    this.km = 0; this.n = 0; this.w = {}; this.d = {}; this.years = new Set();
    this.peak = 0;
  }

  add(km, values, year) {
    // A count with no length behind it still counts as an observation, but it
    // cannot be weighted; those provinces are averaged per station instead.
    this.km += km ?? 0;
    this.n += 1;
    if (year) this.years.add(year);
    // The busiest place on a road is often the only thing about its traffic
    // anybody remembers - Highway 401 averages well under a hundred thousand
    // across its length and carries half a million through Toronto - so the
    // maximum is kept beside the mean rather than averaged away.
    if (values.aadt > this.peak) this.peak = values.aadt;
    for (const [k, v] of Object.entries(values)) {
      if (v == null) continue;
      const weight = km ?? 1;
      this.w[k] = (this.w[k] ?? 0) + v * weight;
      this.d[k] = (this.d[k] ?? 0) + weight;
    }
  }

  finish({ weighted = true } = {}) {
    const out = { n: this.n };
    if (weighted && this.km > 0) out.km = Math.round(this.km * 10) / 10;
    // To the hundred, like the averages, so it reads as the estimate it is.
    if (this.peak > 0) out.aadtMax = Math.round(this.peak / 100) * 100;
    const years = [...this.years].sort();
    if (years.length) {
      out.year = years[years.length - 1];
      if (years.length > 1) out.yearFrom = years[0];
    }
    for (const [k, w] of Object.entries(this.w)) {
      const d = this.d[k];
      if (!d) continue;
      const step = STEPS[k] ?? 1;
      const dp = Math.max(0, -Math.floor(Math.log10(step)));
      out[k] = {
        v: Number((Math.round((w / d) / step) * step).toFixed(dp)),
        // Only meaningful where the rows had lengths; for point counts the
        // denominator is a station count, which the panel says instead.
        cover: weighted && this.km > 0
          ? Math.min(100, Math.round((d / this.km) * 100))
          : null,
      };
    }
    return out;
  }
}

const collect = () => new Map();
const into = (acc, key) => {
  if (!acc.has(key)) acc.set(key, new Route());
  return acc.get(key);
};
const finish = (acc, opts) => Object.fromEntries(
  [...acc].map(([k, r]) => [k, r.finish(opts)]).filter(([, v]) => v.aadt),
);

// ---------------------------------------------------------------- Quebec

// The route number is not a column. It is the first five characters of the RTSS
// linear reference - Quebec's own segment identifier - which the published data
// dictionary documents as the route. Codes at or above 1000 are the access and
// service roads the ministry also maintains, which this atlas does not carry.
const qcRoute = (rtss) => {
  const code = Number(String(rtss ?? '').slice(0, 5));
  return code > 0 && code < 1000 ? String(code) : null;
};

async function quebec() {
  const fields = ['rtss_debut', 'djma_annee_1', 'val_djma_annee_1', 'val_cam_annee_1'];
  const acc = collect();
  let start = 0;
  const page = 5000;

  for (;;) {
    const url = 'https://ws.mapserver.transports.gouv.qc.ca/swtq'
      + '?service=wfs&version=2.0.0&request=getfeature&typename=ms:circulation_routier'
      + `&srsname=EPSG:4326&outputformat=geojson&propertyname=${fields.join(',')}`
      + `&count=${page}&startindex=${start}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const feats = (await res.json()).features ?? [];
    if (!feats.length) break;

    for (const f of feats) {
      const route = qcRoute(f.properties.rtss_debut);
      const aadt = num(f.properties.val_djma_annee_1);
      if (!route || !aadt) continue;
      // Lengths come from the drawn section, not from the chainage columns,
      // whose start and end can sit on different RTSS segments.
      const km = f.geometry?.type === 'LineString'
        ? lineLengthKm(f.geometry.coordinates)
        : (f.geometry?.coordinates ?? []).reduce((a, c) => a + lineLengthKm(c), 0);
      if (!(km > 0)) continue;
      into(acc, route).add(km, {
        aadt,
        truck: num(f.properties.val_cam_annee_1),
      }, num(f.properties.djma_annee_1));
    }
    if (feats.length < page) break;
    start += feats.length;
  }

  return {
    name: { en: 'Quebec', fr: 'Québec' },
    source: 'Ministère des Transports et de la Mobilité durable, Débit de circulation',
    url: 'https://www.donneesquebec.ca/recherche/dataset/debit-de-circulation',
    licence: 'CC-BY 4.0',
    measure: 'DJMA (débit journalier moyen annuel)',
    method: 'weighted',
    routes: finish(acc),
  };
}

// ---------------------------------------------------------------- Ontario

// Ontario signs the Queen Elizabeth Way rather than numbering it, and files it
// under "QEW"; everything else in the sheet is a number.
const ON_YEAR = 2024;

async function ontario() {
  const url = 'https://www.library.mto.gov.on.ca/SydneyPLUS/TechPubs/Theme.aspx'
    + '?f=files%2FProvincial+Highways+Traffic+Volumes+2024+AADT+Only.xlsx&m=resource&r=702797';
  const [sheet] = await fetchWorkbook(url);
  const acc = collect();

  for (const row of sheet.rows.slice(1)) {
    const [hwy, , , dist, aadt] = row;
    const km = num(dist);
    const v = num(aadt);
    if (!km || !v) continue;
    const label = String(hwy ?? '').trim().toUpperCase();
    const route = label === 'QEW' ? 'QEW' : (num(label) != null ? String(num(label)) : null);
    if (!route) continue;
    into(acc, route).add(km, { aadt: v }, ON_YEAR);
  }

  return {
    name: { en: 'Ontario', fr: 'Ontario' },
    source: 'Ontario Ministry of Transportation, Provincial Highways Traffic Volumes',
    url: 'https://www.library.mto.gov.on.ca/SydneyPLUS/TechPubs/Portal/tp/tvSplash.aspx',
    // The ministry publishes these for public use but states no licence on the
    // page, unlike the other four. Said plainly rather than implied.
    licence: 'no licence stated by the publisher',
    measure: 'AADT',
    method: 'weighted',
    note: 'Where two Ontario highways overlap, the ministry credits the volume '
      + 'to the lower-numbered one, or to the freeway where a freeway and a '
      + 'non-freeway meet. Highway 407 is absent: the tolled section is operated '
      + 'under concession and excluded from the ministry\'s figures, and its '
      + 'operator reports average workday trips, which is not a daily volume '
      + 'and is not shown here as one.',
    routes: finish(acc),
  };
}

// ---------------------------------------------------------------- Alberta

// The report is a formatted document rather than a table: three title rows, a
// two-line header, and a blank row between highways. Only the detail rows are
// read - the ones carrying a section length - and the per-highway weighted mean
// is recomputed here, so the summary rows' own conventions do not have to be
// guessed at. Columns from the length rightward are in fixed positions; the
// two before it shift by one when a highway carries a letter suffix.
const AB_COL = { hwy: 1, suffix: 2, len: 10, waadt: 11, commercial: 18 };
const AB_YEAR = 2025;

async function alberta() {
  const url = 'https://open.alberta.ca/dataset/06a254aa-4cec-4d89-9d93-34845b4873f1'
    + '/resource/777c6e10-ce41-40c5-a3de-bf8af81626eb'
    + '/download/tec-traffic-volume-highway-network-2025.xlsx';
  const [sheet] = await fetchWorkbook(url);
  const acc = collect();

  for (const row of sheet.rows) {
    const hwy = num(row[AB_COL.hwy]);
    const km = num(row[AB_COL.len]);
    const aadt = num(row[AB_COL.waadt]);
    if (!hwy || !km || !aadt) continue;
    const suffix = String(row[AB_COL.suffix] ?? '').trim();
    const route = `${hwy}${/^[A-Za-z]$/.test(suffix) ? suffix.toUpperCase() : ''}`;
    into(acc, route).add(km, {
      aadt,
      truck: num(row[AB_COL.commercial]),
    }, AB_YEAR);
  }

  return {
    name: { en: 'Alberta', fr: 'Alberta' },
    source: 'Alberta Transportation and Economic Corridors, '
      + 'Traffic volumes on links in the highway network',
    url: 'https://open.alberta.ca/opendata/traffic-volumes-on-links-in-the-highway-network',
    licence: 'Open Government Licence – Alberta',
    measure: 'WAADT (weighted annual average daily traffic)',
    method: 'weighted',
    routes: finish(acc),
  };
}

// ------------------------------------------------------------ Nova Scotia

// Nova Scotia is the one province that counts a direction at a time, and its
// file says so: a blank direction is a two-way count, a filled one is half the
// road. On the Halifax Circumferential the northbound and southbound counts of
// one section are separate rows about eighteen months apart, so averaging the
// rows would report a road of 60,000 vehicles a day as one of 30,000. The two
// directions are added instead, each taken from the most recent time it was
// counted, and a location that has only ever been counted one way is left out
// rather than doubled.
const PAIRS = [['N', 'S'], ['E', 'W']];

/** The two-way volume at one count location, or null if it cannot be formed. */
function twoWay(rows) {
  const latest = (list) => list
    .sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')))
    .at(-1);

  // A two-way count needs nothing adding to it, and is preferred when present.
  const both = rows.filter((r) => !String(r.direction ?? '').trim());
  if (both.length) {
    const row = latest(both);
    const aadt = num(row.aadt) ?? num(row.adt);
    return aadt ? { rows: [row], aadt } : null;
  }

  const byDir = new Map();
  for (const r of rows) {
    const d = String(r.direction ?? '').trim().toUpperCase();
    if (!byDir.has(d)) byDir.set(d, []);
    byDir.get(d).push(r);
  }
  for (const [a, b] of PAIRS) {
    if (!byDir.has(a) || !byDir.has(b)) continue;
    const half = [latest(byDir.get(a)), latest(byDir.get(b))];
    const vs = half.map((r) => num(r.aadt) ?? num(r.adt));
    if (vs.some((v) => v == null)) continue;
    // Truck share and speed are proportions and a rate, so they average across
    // the two halves rather than adding like the volume does.
    return { rows: half, aadt: vs[0] + vs[1] };
  }
  return null;
}

/** The direction markers the province appends, which must not split a location. */
const nsLocation = (row) => String(row.description ?? '')
  .toUpperCase()
  .replace(/\((?:NB|SB|EB|WB)\)/g, '')
  .replace(/\(SPEED[^)]*\)?/g, '')
  .replace(/[^A-Z0-9]+/g, ' ')
  .trim();

async function novaScotia() {
  const res = await fetch('https://data.novascotia.ca/resource/8524-ec3n.json?$limit=50000');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = await res.json();

  // Location within section, so the two directions of one count meet.
  const places = new Map();
  for (const row of rows) {
    if (num(row.highway) == null) continue;
    const key = `${row.highway}|${row.section}|${nsLocation(row)}`;
    if (!places.has(key)) places.set(key, []);
    places.get(key).push(row);
  }

  // Each section contributes once, at the mean of its locations, so that a
  // section counted in five places does not outweigh a longer one counted in
  // two.
  const sections = new Map();
  let dropped = 0;
  for (const [key, list] of places) {
    const combined = twoWay(list);
    if (!combined?.aadt) { dropped += 1; continue; }
    const [hwy, section] = key.split('|');
    const sk = `${hwy}|${section}`;
    if (!sections.has(sk)) sections.set(sk, []);
    sections.get(sk).push(combined);
  }

  const acc = collect();
  for (const [sk, list] of sections) {
    const [hwy] = sk.split('|');
    const used = list.flatMap((c) => c.rows);
    const km = num(used[0].section_length);
    if (!km) continue;
    const mean = (vs) => (vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null);
    const over = (pick) => mean(used.map(pick).filter((v) => v != null));
    // The oldest count behind the figure, since that is the point past which it
    // stops being current - not the newest, which would flatter it.
    const years = used.map((r) => num(String(r.date ?? '').slice(0, 4))).filter(Boolean);
    into(acc, String(num(hwy))).add(km, {
      aadt: mean(list.map((c) => c.aadt)),
      truck: over((r) => num(r.ptrucks)),
      speed: over((r) => num(r._85pct)),
    }, years.length ? Math.min(...years) : null);
  }
  console.log(`      (NS: ${sections.size} sections, ${dropped} locations counted`
    + ' in one direction only and left out)');

  return {
    name: { en: 'Nova Scotia', fr: 'Nouvelle-Écosse' },
    source: 'Nova Scotia Department of Public Works, '
      + 'Traffic Volumes – Provincial Highway System',
    url: 'https://data.novascotia.ca/Roads-Driving-and-Transport/'
      + 'Traffic-Volumes-Provincial-Highway-System/8524-ec3n',
    licence: 'Open Government Licence – Nova Scotia',
    measure: 'AADT',
    method: 'weighted',
    note: 'The province counts one direction at a time. Opposite directions are '
      + 'added, each from the most recent time it was counted, to give a '
      + 'two-way volume comparable with the other provinces; a location counted '
      + 'in one direction only is excluded. Speeds are the 85th percentile.',
    routes: finish(acc),
  };
}

// ---------------------------------------------------------- New Brunswick

// New Brunswick's counts carry no route column, only a control-section key of
// the form R0133001. The four digits after the R are the route and the last
// three the section, which is not documented in the dataset - so the decoding
// is verified rather than assumed: main() checks the decoded numbers against
// the New Brunswick routes the atlas already has, and reports the match rate.
const nbRoute = (id) => {
  const m = /^R(\d{4})(\d{3})$/.exec(String(id ?? '').trim());
  const route = m ? Number(m[1]) : null;
  return route > 0 ? String(route) : null;
};

const NB_YEAR = 2023;

async function newBrunswick() {
  const res = await fetch('https://gnb.socrata.com/resource/gdx2-xdus.json'
    + '?$select=rcs_nid,aadt,valid_year,funcclass&$limit=50000');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = await res.json();

  const acc = collect();
  for (const row of rows) {
    const route = nbRoute(row.rcs_nid);
    const aadt = num(row.aadt);
    if (!route || !aadt) continue;
    // Point counts, so there is no length to weight by; each station counts
    // once and the panel reports how many there were.
    into(acc, route).add(null, { aadt }, num(row.valid_year) ?? NB_YEAR);
  }

  return {
    name: { en: 'New Brunswick', fr: 'Nouveau-Brunswick' },
    source: 'New Brunswick Department of Transportation and Infrastructure, '
      + 'AADT counts at point locations on the DTI highway network',
    url: 'https://gnb.socrata.com/datasets/gdx2-xdus',
    licence: 'Open Government Licence – New Brunswick',
    measure: 'AADT',
    // The only one of the five that is a station average rather than a
    // length-weighted one, because the counts are points with no extent.
    method: 'stations',
    routes: finish(acc, { weighted: false }),
  };
}

const PROVINCES = {
  QC: quebec, ON: ontario, AB: alberta, NS: novaScotia, NB: newBrunswick,
};

/**
 * The route numbers the atlas already holds for a province, if it has been
 * built.
 *
 * Every province here is joined on a route number that was read out of a field
 * that was not quite designed to be read that way - Quebec's out of a linear
 * reference, New Brunswick's out of a control-section key, Alberta's out of a
 * column that shifts. Checking the result against the road network means a feed
 * that changes shape shows up as a match rate falling through the floor, rather
 * than as traffic counts quietly landing on the wrong roads or on none.
 */
async function atlasRoutes() {
  try {
    const idx = JSON.parse(await readFile(join('data', 'index.json'), 'utf8'));
    const col = Object.fromEntries(idx.fields.map((f, i) => [f, i]));
    const byProvince = new Map();
    for (const row of idx.routes) {
      const st = row[col.st];
      if (!byProvince.has(st)) byProvince.set(st, new Set());
      byProvince.get(st).add(String(row[col.num]));
    }
    return byProvince;
  } catch {
    return null; // Not built yet, which is fine on a first run.
  }
}

async function main() {
  const known = await atlasRoutes();
  const out = {};
  for (const [code, load] of Object.entries(PROVINCES)) {
    try {
      const data = await load();
      out[code] = data;
      const ids = Object.keys(data.routes);
      const busiest = Object.entries(data.routes)
        .sort((a, b) => (b[1].aadt?.v ?? 0) - (a[1].aadt?.v ?? 0))[0];

      let check = '';
      const have = known?.get(code);
      if (have?.size) {
        const hit = ids.filter((id) => have.has(id));
        const share = Math.round((hit.length / ids.length) * 100);
        data.matched = { of: ids.length, onNetwork: hit.length };
        const missing = ids.filter((id) => !have.has(id));
        check = `   ${share}% on the network`
          + (missing.length ? `, unmatched: ${missing.slice(0, 8).join(' ')}` : '');
        if (share < 80) check += '   <-- CHECK THE JOIN';
      }

      console.log(`  ${code}  ${String(ids.length).padStart(4)} routes`
        + `   busiest ${busiest?.[0]} at ${busiest?.[1].aadt?.v?.toLocaleString()}${check}`);
    } catch (e) {
      console.log(`  ${code}  failed: ${e.message}`);
    }
  }

  await mkdir(join('content', 'reference'), { recursive: true });
  await writeFile(OUT, `${JSON.stringify({
    source: 'Provincial open data; see each province for its own source and licence',
    retrieved: new Date().toISOString().slice(0, 10),
    note: 'Canada has no national equivalent to the United States\' HPMS. These '
      + 'are the five provinces that publish route-level traffic counts in bulk, '
      + 'each in its own form and under its own terms. British Columbia, '
      + 'Saskatchewan and Manitoba publish only through maps, applications or '
      + 'PDFs; the remaining jurisdictions do not publish machine-readable '
      + 'counts. Figures are joined to routes by the province\'s route number, '
      + 'never by position.',
    provinces: out,
  }, null, 1)}\n`);

  const routes = Object.values(out).reduce((a, p) => a + Object.keys(p.routes).length, 0);
  console.log(`\nwrote ${OUT}: ${routes} route records across ${Object.keys(out).length} provinces`);
}

export { nbRoute, qcRoute };

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
