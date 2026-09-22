// Fetches per-route traffic figures from the provinces that publish them.
//
//   node tools/fetch-canada-traffic.mjs
//
// The American half of this atlas can say how busy a road is because HPMS is a
// single national collection every state reports into. Canada has no such
// thing. Traffic counting is provincial, and each province decides on its own
// whether to publish, in what form, and under what terms. So this is seven
// separate feeds in seven separate shapes, and the result is still partial:
// seven of thirteen jurisdictions.
//
// What is not here, and why, because the gaps are part of the answer:
//
//   British Columbia  counts continuously at some 900 sites and publishes none
//                     of it in bulk. The open-data catalogue holds four files,
//                     annual volumes to 2010 and monthly permanent-counter
//                     volumes to June 2011, none touched since 2022. The live
//                     programme is catalogued with the licence "Access Only"
//                     and a single resource that is an application URL, so the
//                     province has explicitly published it as viewer-only.
//   Saskatchewan      publishes an annual traffic volume map as a PDF and
//                     nothing else; a search of its GeoHub records API for
//                     "traffic" returns nothing. The map does distinguish
//                     continuous-classifier sites and carries truck AADT for
//                     them, so there is a truck source here worth reading if
//                     PDF map extraction ever becomes worth the risk.
//   Manitoba          publishes through a web application, plus flow-map PDFs
//                     for 2004-2019 and 2023 - the province states that none
//                     were produced for 2020, 2021 or 2022 - and truck flow
//                     maps for 2008 and 2013 only.
//   NL, YT, NU        no traffic publication found. Newfoundland's own
//                     departmental annual reports enumerate its data holdings
//                     and contain no traffic series; Yukon collects counts but
//                     releases them only on request; Nunavut has no
//                     inter-community highway to count.
//
// Two of those gaps were wrong and are now filled. The Northwest Territories
// publishes a per-highway series back to 2011 through its Bureau of
// Statistics, and Prince Edward Island publishes four years of AADT as
// queryable tables rather than only through the viewer its website advertises.
// Both were previously recorded here as having nothing, which is the kind of
// mistake that turns into a permanent hole because nobody looks twice.
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
//
// A jurisdiction may override the volume step, and one has to. Rounding to the
// hundred suits roads carrying tens of thousands, but the Northwest
// Territories counts in tens - the Tłı̨chǫ Highway averages thirty vehicles a
// day - and rounding that to the nearest hundred reports an open highway as
// carrying nobody. The territory publishes to the nearest ten, so that is what
// it is kept at.
const STEPS = { aadt: 100, summer: 100, winter: 100, truck: 0.1, speed: 1 };

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

  finish({ weighted = true, steps = null } = {}) {
    const S = steps ? { ...STEPS, ...steps } : STEPS;
    const out = { n: this.n };
    if (weighted && this.km > 0) out.km = Math.round(this.km * 10) / 10;
    // On the same step as the averages, so it reads as the estimate it is.
    if (this.peak > 0) out.aadtMax = Math.round(this.peak / S.aadt) * S.aadt;
    const years = [...this.years].sort();
    if (years.length) {
      out.year = years[years.length - 1];
      if (years.length > 1) out.yearFrom = years[0];
    }
    for (const [k, w] of Object.entries(this.w)) {
      const d = this.d[k];
      if (!d) continue;
      const step = S[k] ?? 1;
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

/**
 * A route's traffic over several years.
 *
 * Kept apart from Route because the two answer different questions. Route
 * describes one year in as much detail as the province supplies; this
 * describes one measure across years.
 *
 * Every point carries how many observations are behind it, because in a long
 * series that is not a detail. Alberta's history runs from 1962, and the set
 * of sites counted in 1962 is not the set counted in 2025: the early years
 * are a handful of busy places and the later ones are the whole province. A
 * mean over that reports Highway 2 as carrying 14,700 in 1962 and 7,100 in
 * 1980, which is not a road that got quieter, it is a road that acquired
 * rural counting sites. So the count travels with the figure, and where there
 * are no lengths to weight by the figure is a median, which a shifting set of
 * sites moves far less than it moves a mean.
 *
 * Where the province does publish lengths - Quebec, Prince Edward Island -
 * the series is length-weighted, matching how that province's headline figure
 * is built so the two are the same kind of number.
 */
class Series {
  constructor() { this.byYear = new Map(); }

  add(year, value, weight = 1) {
    if (!year || value == null) return;
    if (!this.byYear.has(year)) this.byYear.set(year, []);
    this.byYear.get(year).push([value, weight]);
  }

  finish({ step = STEPS.aadt, median = false } = {}) {
    const out = {};
    for (const [year, points] of [...this.byYear].sort((a, b) => a[0] - b[0])) {
      let v;
      if (median) {
        const s = points.map(([x]) => x).sort((a, b) => a - b);
        const mid = s.length >> 1;
        v = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
      } else {
        const d = points.reduce((a, [, w]) => a + w, 0);
        if (!d) continue;
        v = points.reduce((a, [x, w]) => a + x * w, 0) / d;
      }
      out[year] = [points.length, Math.round(v / step) * step];
    }
    return Object.keys(out).length > 1 ? out : null;
  }
}

const trend = (acc, key) => {
  if (!acc.has(key)) acc.set(key, new Series());
  return acc.get(key);
};

/** Hangs each route's series off the route record the province already built. */
function withTrend(routes, series, opts) {
  for (const [id, s] of series) {
    const t = s.finish(opts);
    if (t && routes[id]) routes[id].trend = t;
  }
  return routes;
}

// ---------------------------------------------------------------- Quebec

// The route number is not a column. It is the first five characters of the RTSS
// linear reference - Quebec's own segment identifier - which the published data
// dictionary documents as the route. Codes at or above 1000 are the access and
// service roads the ministry also maintains, which this atlas does not carry.
const qcRoute = (rtss) => {
  const code = Number(String(rtss ?? '').slice(0, 5));
  return code > 0 && code < 1000 ? String(code) : null;
};

// Quebec publishes more than the one annual figure the atlas was reading.
// Each section carries ten years of it, and three measures rather than one:
// DJMA over the whole year, DJME over June to September and DJMH over
// December to March. On a road into the Laurentians or along the Gaspé the
// summer figure is the one that describes the traffic anybody experiences,
// and the annual mean is the one that hides it - so both seasons are kept.
const QC_YEARS = 10;

async function quebec() {
  const fields = [
    'rtss_debut', 'val_cam_annee_1', 'val_djme_annee_1', 'val_djmh_annee_1',
    ...Array.from({ length: QC_YEARS }, (_, i) => [`djma_annee_${i + 1}`, `val_djma_annee_${i + 1}`]).flat(),
  ];
  const acc = collect();
  const series = new Map();
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
        summer: num(f.properties.val_djme_annee_1),
        winter: num(f.properties.val_djmh_annee_1),
        truck: num(f.properties.val_cam_annee_1),
      }, num(f.properties.djma_annee_1));

      // The ten columns are positions, not years: each section states the year
      // its own column one describes, and they do not all state the same one.
      for (let i = 1; i <= QC_YEARS; i++) {
        trend(series, route).add(
          num(f.properties[`djma_annee_${i}`]),
          num(f.properties[`val_djma_annee_${i}`]),
          km,
        );
      }
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
    seasons: {
      summer: 'DJME (débit journalier moyen estival), June to September',
      winter: 'DJMH (débit journalier moyen hivernal), December to March',
    },
    note: 'Volumes are the total across both directions, as the ministry publishes '
      + 'them. The ten-year series is built from each section\'s own year labels '
      + 'rather than from the column positions, because the columns are positions '
      + 'and sections were not all last counted in the same year.',
    routes: withTrend(finish(acc), series),
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

/**
 * Alberta's traffic volume history, 1962 to 2025.
 *
 * The longest series any jurisdiction in this atlas publishes, on either side
 * of any border, and it is a formatted report rather than a table: title
 * rows, a year row that does not line up with the columns it labels, and one
 * row per counting site rather than per highway.
 *
 * Only columns the year row actually labels are read, and the label has to
 * agree with the column's position - column k is year 1955 + k - so a layout
 * that shifts fails loudly instead of moving six decades of traffic one year
 * sideways.
 *
 * That rule also settles the first column, which is a trap. The workbook is
 * titled 1962-2025 and there is an unlabelled AADT column sitting immediately
 * before 1963, which invites reading it as 1962. It is not. 1963 carries 275
 * values, 1964 carries 346, and the count climbs smoothly to about 6,950 by
 * 2025 as the counting programme grew - while the unlabelled column carries
 * 7,089 of the file's 7,094 rows, every site at once. It is a summary of each
 * site rather than a year, the file does not say what it summarises, and
 * reading it as 1962 would invent a year in which Alberta counted its whole
 * network and then stopped. So the series here begins at 1963, despite the
 * title on the cover.
 *
 * These are sites, not sections: there is no length in the file, so each
 * point is a median across the sites counted on that highway that year. The
 * headline Alberta figure is length-weighted and comes from a different
 * collection, so the last point of the series is not the same measure.
 */
const AB_HISTORY = 'https://open.alberta.ca/dataset/38bf49b8-78fa-4480-8044-7635b252f13a'
  + '/resource/042d5491-0f0f-4cf3-b9c8-85e7567318a4'
  + '/download/tec-traffic-volume-history-complete.xlsx';
const AB_HIST_COL = { hwy: 1, suffix: 2, first: 7 };
const AB_EPOCH = 1955;

async function albertaHistory() {
  const [sheet] = await fetchWorkbook(AB_HISTORY);
  const years = sheet.rows.find((r) => num(r[AB_HIST_COL.first + 1]) === AB_EPOCH + AB_HIST_COL.first + 1);
  if (!years) throw new Error('no year row; the history layout has changed');

  const dated = new Map();
  for (let k = AB_HIST_COL.first; k < years.length; k++) {
    const label = num(years[k]);
    if (label == null) continue;
    if (label !== AB_EPOCH + k) {
      throw new Error(`year row says ${label} in column ${k}, expected ${AB_EPOCH + k}`);
    }
    dated.set(k, label);
  }
  if (dated.size < 50) throw new Error(`only ${dated.size} years labelled; expected the full history`);

  const series = new Map();
  for (const row of sheet.rows) {
    const hwy = num(row[AB_HIST_COL.hwy]);
    if (!hwy) continue;
    const suffix = String(row[AB_HIST_COL.suffix] ?? '').trim();
    const route = `${hwy}${/^[A-Za-z]$/.test(suffix) ? suffix.toUpperCase() : ''}`;
    for (const [k, year] of dated) {
      const aadt = num(row[k]);
      if (aadt) trend(series, route).add(year, aadt);
    }
  }
  return series;
}

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
    trendFrom: 'Traffic volume history, a separate collection of counting sites with '
      + 'no section lengths. The workbook is titled 1962-2025 but only labels its '
      + 'columns from 1963, and the unlabelled column before them holds a value for '
      + 'almost every site in the file rather than for the few counted that early, '
      + 'so it is a per-site summary and is not read as a year. Each point is the '
      + 'median across the sites '
      + 'counted on that highway that year, with the number of them, because the '
      + 'set of sites grew enormously over the period and a mean would read that '
      + 'growth as a change in traffic. The last point is not the length-weighted '
      + 'figure above and will not equal it.',
    routes: withTrend(finish(acc), await albertaHistory(), { median: true }),
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

// --------------------------------------------------- Northwest Territories

// One table, one column per highway, one row per year. Two things about it
// have to be read out of the sheet rather than assumed.
//
// The column headings carry their footnote markers welded on. The Tłı̨chǫ
// Highway, number 9, is headed "Highway 92" because footnote 2 records that
// it opened on 30 November 2021 - and an atlas that read that heading as
// written would invent a Highway 92 and hang a real series off it. The sheet
// also lists every highway it covers, in full, with its name and its extent,
// so the headings are resolved against that list and a heading that does not
// land on a listed highway is refused.
//
// And every value in it is an estimate. Footnote 3 says so: the territory
// rounds to the nearest ten and models the gaps, because the counter network
// is 22 portable units on the numbered highways and the 2024 report puts
// useable coverage at about 85%. So this is the publisher's own estimate,
// published as one, and it is labelled that way rather than set beside the
// counted figures as though it were the same kind of number.
const NT_TABLE = 'Table 107-Estimated Traffic on Northwest Territories Highways, 2011 to 2024.xlsx';
const NT_DESCRIBED = /^Highway\s+(\d+)\s*-\s*(.+)$/;
// To the ten, which is what the territory itself publishes to.
const NT_STEPS = { aadt: 10 };

async function northwestTerritories() {
  const [sheet] = await fetchWorkbook(`https://www.statsnwt.ca/Transportation/${encodeURIComponent(NT_TABLE)}`);
  const flat = sheet.rows.map((r) => r.map((c) => String(c ?? '').replace(/\s+/g, ' ').trim()));

  // The authoritative set of highways, from the sheet's own description block.
  const described = new Map();
  for (const row of flat) {
    for (const cell of row) {
      const m = NT_DESCRIBED.exec(cell);
      if (m) described.set(m[1], m[2]);
    }
  }
  if (!described.size) throw new Error('the sheet no longer lists its highways; headings cannot be checked');

  // The heading row is the one that opens the table.
  const head = flat.findIndex((r) => r[0]?.toLowerCase() === 'date');
  if (head < 0) throw new Error('no Date heading row');

  // A heading is the word Highway, its number, and possibly a footnote marker
  // welded to the number. The whole number is tried first and then the number
  // without its last digit, so "92" resolves to 9 and "10" stays 10.
  //
  // The word has to be there. The first column's heading is the bare string
  // "3" - its label went into a merged cell and only its footnote survived -
  // and a match loose enough to read that as a highway number reads it as
  // Highway 3, which silently files the Mackenzie Highway's traffic under the
  // Yellowknife Highway and averages the two together.
  const column = new Map();
  for (let c = 1; c < flat[head].length; c++) {
    const digits = /highway\s*(\d+)/i.exec(flat[head][c])?.[1];
    if (!digits) continue;
    const id = [digits, digits.slice(0, -1)].find((d) => d && described.has(d));
    if (id) column.set(c, id);
  }
  // Whichever described highway no heading claimed is the one whose label was
  // lost to the merged cell. Its column is found by looking at the body rather
  // than by counting from the edge: exactly one unclaimed column should carry
  // numbers, and that is it.
  const unclaimed = [...described.keys()].filter((id) => ![...column.values()].includes(id));
  const spare = [...Array(flat[head].length).keys()].slice(1)
    .filter((c) => !column.has(c) && flat.slice(head + 1).some((r) => num(r[0]) && num(r[c]) != null));
  if (unclaimed.length === 1 && spare.length === 1) column.set(spare[0], unclaimed[0]);

  const twice = [...column.values()].filter((id, i, all) => all.indexOf(id) !== i);
  if (twice.length) throw new Error(`two columns claim highway ${twice.join(', ')}`);
  if (column.size !== described.size) {
    throw new Error(`${described.size} highways described but ${column.size} columns resolved`);
  }

  const acc = collect();
  const series = new Map();
  let latest = 0;
  for (const row of flat.slice(head + 1)) {
    const year = num(row[0]);
    if (!year || year < 1900) continue;
    latest = Math.max(latest, year);
    for (const [c, id] of column) {
      // "-" is nil and ".." is not available; neither is a zero.
      const aadt = num(row[c]);
      if (aadt == null) continue;
      trend(series, id).add(year, aadt);
    }
  }
  for (const row of flat.slice(head + 1)) {
    if (num(row[0]) !== latest) continue;
    for (const [c, id] of column) {
      const aadt = num(row[c]);
      // Point-in-time territorial figures with no section length behind them.
      if (aadt != null) into(acc, id).add(null, { aadt }, latest);
    }
  }

  return {
    name: { en: 'Northwest Territories', fr: 'Territoires du Nord-Ouest' },
    source: 'GNWT Bureau of Statistics, Estimated Traffic on Northwest Territories Highways '
      + '(Department of Infrastructure)',
    url: 'https://www.statsnwt.ca/Transportation/',
    licence: 'Open Government Licence – Northwest Territories',
    measure: 'AADT',
    method: 'territorial estimate',
    estimated: true,
    note: 'Every figure is the territory\'s own estimate, rounded to the nearest ten. '
      + 'The counter network is small and the annual Highway Traffic Report puts '
      + 'useable coverage near 85%, with the remainder modelled from previous years, '
      + 'ferry movements and weigh scales. Shown as the estimate it is published as, '
      + 'and not weighted by length, which the table does not carry.',
    highways: Object.fromEntries(described),
    routes: withTrend(finish(acc, { weighted: false, steps: NT_STEPS }), series, { step: NT_STEPS.aadt }),
  };
}

// ------------------------------------------------- Prince Edward Island

// Four years, each published as its own table rather than as a series, and
// none of them visible from the province's own traffic page - which offers an
// interactive viewer covering 2015 to 2022 and does not mention that four of
// those years are also queryable. The tables carry a section length, which is
// what lets these be weighted like the larger provinces rather than averaging
// sections of unequal length.
//
// The four years are not the same shape, so no field name is written down
// here: each layer is asked what it holds. 2015 calls its length column
// Length_in_Metres and the others call it Length_Metres, and - the one that
// matters - only 2018 carries a Route_Number column at all.
//
// For the three years without one the route is read out of Road_ID, whose
// first three digits are the route and whose last two are the section. That
// decoding is verified rather than assumed, against the one year that
// publishes both: over 644 rows of 2018 it agrees on 643. The exception is
// Road_ID 26601 against Route_Number 239, where the province's own two
// columns disagree with each other; 2018 is taken from the published route
// number, so the disagreement affects only whichever earlier-year rows carry
// the same identifier, and it is reported rather than decided.
//
// The province states an annual cadence and has not met it: nothing after 2018
// has been released, though the viewer has it. That is recorded rather than
// smoothed over, because a four-year-old figure presented without its date
// would read as current.
const PE_YEARS = {
  2015: 'OD0063_2015_Traffic_Volumes',
  2016: 'OD0064_2016_Traffic_Volumes',
  2017: 'OD0065_2017_Traffic_Volumes',
  2018: 'OD0068_2018_Traffic_Volumes',
};
const PE_HOST = 'https://services9.arcgis.com/zow9Ot3ujGSyJI3C/arcgis/rest/services';
const PE_ROAD_ID = /^(\d{3})(\d{2})$/;

const peRoute = (roadId) => {
  const m = PE_ROAD_ID.exec(String(roadId ?? '').trim());
  const route = m ? Number(m[1]) : null;
  return route > 0 ? String(route) : null;
};

async function princeEdwardIsland() {
  const acc = collect();
  const series = new Map();
  const latest = Math.max(...Object.keys(PE_YEARS).map(Number));
  const derived = [];

  for (const [year, service] of Object.entries(PE_YEARS)) {
    const layer = `${PE_HOST}/${service}/FeatureServer/0`;
    const meta = await (await fetch(`${layer}?f=json`)).json();
    if (meta.error) throw new Error(`${year}: ${meta.error.message}`);
    const has = new Set((meta.fields ?? []).map((f) => f.name));

    const lengthField = ['Length_Metres', 'Length_in_Metres'].find((f) => has.has(f));
    if (!lengthField) throw new Error(`${year}: no length column`);
    const routeField = has.has('Route_Number') ? 'Route_Number' : null;
    if (!routeField) derived.push(Number(year));

    // The geometry is carried as a string field that dwarfs the data, so it is
    // left behind: the join is on the route number, as everywhere else here.
    const fields = [routeField ?? 'Road_ID', 'Annual_Average_Daily_Traffic', lengthField];
    const res = await fetch(`${layer}/query?where=1%3D1&f=json&returnGeometry=false`
      + `&outFields=${fields.join(',')}&resultRecordCount=5000`);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${year}`);
    const body = await res.json();
    if (body.error) throw new Error(`${year}: ${body.error.message}`);

    for (const { attributes: a } of body.features ?? []) {
      const route = routeField
        ? (num(a[routeField]) != null ? String(num(a[routeField])) : null)
        : peRoute(a.Road_ID);
      const aadt = num(a.Annual_Average_Daily_Traffic);
      const km = (num(a[lengthField]) ?? 0) / 1000;
      if (!route || !aadt || !(km > 0)) continue;
      trend(series, route).add(Number(year), aadt, km);
      if (Number(year) === latest) into(acc, route).add(km, { aadt }, latest);
    }
  }

  return {
    name: { en: 'Prince Edward Island', fr: 'Île-du-Prince-Édouard' },
    source: 'Prince Edward Island Department of Transportation and Infrastructure, '
      + 'Traffic Volumes',
    url: 'https://www.princeedwardisland.ca/en/service/view-pei-traffic-volumes',
    licence: 'Open Government Licence – Prince Edward Island',
    measure: 'AADT',
    method: 'weighted',
    routeFrom: derived.length
      ? `Route_Number where published (${latest}); read from the first three digits of `
        + `Road_ID for ${derived.join(', ')}, a decoding checked against ${latest} `
        + 'where both columns exist and agreeing on 643 of 644 rows'
      : 'Route_Number',
    note: 'Published one year at a time as four separate tables, 2015 to 2018. The '
      + 'province states an annual cadence but has released nothing since, although '
      + 'its own viewer covers through 2022, so the latest figure here is '
      + `${latest} and should be read as that year rather than as current.`,
    routes: withTrend(finish(acc), series),
  };
}

const PROVINCES = {
  QC: quebec, ON: ontario, AB: alberta, NS: novaScotia, NB: newBrunswick,
  PE: princeEdwardIsland, NT: northwestTerritories,
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
      + 'are the jurisdictions that publish route-level traffic in bulk, each in '
      + 'its own form and under its own terms. British Columbia, Saskatchewan and '
      + 'Manitoba publish only through maps, applications or PDFs; Newfoundland, '
      + 'Yukon and Nunavut publish nothing. Figures are joined to routes by the '
      + 'jurisdiction\'s own route number, never by position. Northwest '
      + 'Territories figures are the territory\'s published estimates rather than '
      + 'counts, and are marked as such.',
    provinces: out,
  }, null, 1)}\n`);

  const routes = Object.values(out).reduce((a, p) => a + Object.keys(p.routes).length, 0);
  console.log(`\nwrote ${OUT}: ${routes} route records across ${Object.keys(out).length} provinces`);
}

export { nbRoute, qcRoute };

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
