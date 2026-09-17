/* The route detail panel.

   Two kinds of information share this panel and are deliberately kept
   distinguishable. Measured values - length, termini, state mileage, roadway
   class - are computed from the mapped geometry and carry a provenance note.
   Editorial values - cost, traffic, condition - come from a written dossier and
   each carries its own source line. Where no published figure exists the row
   says so rather than guessing. */

import {
  t, getLang, stateName, miles, num, isProvince, ownerLabel,
} from './i18n.js';
import { app, shieldHtml, addToTrip, clearSelection, fitTo, loadDossier } from './app.js';
import { startFly } from './fly.js';

const SECTION_ORDER = [
  'character', 'engineering', 'history', 'money', 'traffic', 'condition', 'drive',
];

const CLASS_COLOUR = {
  Freeway: '#35e7ff',
  Tollway: '#ffb545',
  Primary: '#6ef7a5',
  Secondary: '#4f9ad8',
  'Other Paved': '#7a8ca6',
  Paved: '#7a8ca6',
  Unpaved: '#b98a5a',
  Ferry: '#a98bff',
  Trail: '#8a6f4f',
  Unknown: '#4a5768',
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function prop(f, key) {
  const v = f?.properties?.[key];
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return v; }
}

function pick(obj) {
  if (obj == null) return null;
  if (typeof obj === 'string') return obj;
  return obj[getLang()] ?? obj.en ?? null;
}

/* ── pieces ───────────────────────────────────────────────────────────── */

/**
 * One end of a route.
 *
 * The label follows the route's own orientation. A road that runs east to west
 * has a western end, not a "southern / western end", and the vaguer wording
 * was reading as hedging on routes where the answer is not in doubt. The
 * orientation is measured off the mainline endpoints rather than inferred from
 * the number's parity, so it is also right for the state, provincial and
 * Canadian routes that follow no parity rule.
 */
function terminusRow(kind, place, coord, dossierText, axis) {
  const isFrom = kind === 'from';
  const label = t(`dt.${isFrom ? 'from' : 'to'}${axis || ''}`);
  const written = pick(dossierText);
  let body;
  if (written) {
    body = esc(written);
  } else if (place) {
    body = place.km <= 6
      ? esc(`${place.name}, ${place.st}`)
      : t('dt.nearBy', { place: esc(`${place.name}, ${place.st}`), km: place.km });
  } else {
    body = '—';
  }
  const ll = Array.isArray(coord) && Number.isFinite(coord[0]) && Number.isFinite(coord[1]) ? coord : null;
  const coords = ll ? `${ll[1].toFixed(4)}°, ${ll[0].toFixed(4)}°` : '';
  return `<div class="term ${isFrom ? 'from' : 'to'}">
    <span class="term-rail"></span>
    <span class="term-dot"></span>
    <span class="term-txt">
      <span class="term-k">${label}</span>
      <span class="term-v">${body}</span>
      ${coords ? `<span class="term-c">${coords}</span>` : ''}
    </span>
  </div>`;
}

function metric(key, value, sub) {
  const na = value == null;
  // A coverage note belongs to a figure. Printed under "no public figure" it
  // reads as a contradiction: nothing measured, measured over 0% of the route.
  const note = na ? null : sub;
  return `<div class="m">
    <span class="m-k">${t(key)}</span>
    <div class="m-v${na ? ' na' : ''}">${na ? t('dt.unknown') : value}${note ? `<small>${note}</small>` : ''}</div>
  </div>`;
}

function compositionBlock(types) {
  const entries = Object.entries(types || {}).filter(([, v]) => v > 0.05).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '';
  const bar = entries.map(([k, v]) =>
    `<i style="width:${v}%;background:${CLASS_COLOUR[k] || '#4a5768'}" title="${esc(t(`comp.${k}`))} ${v}%"></i>`).join('');
  const key = entries.map(([k, v]) =>
    `<span><i style="background:${CLASS_COLOUR[k] || '#4a5768'}"></i>${esc(t(`comp.${k}`))} ${v}%</span>`).join('');
  return `<div class="comp"><div class="comp-bar">${bar}</div><div class="comp-key">${key}</div></div>`;
}

function statesBlock(states) {
  if (!states?.length) return '';
  const max = Math.max(...states.map((s) => s.mi));
  return `<div class="st-rows">${states.map((s) => `
    <div class="st-row">
      <b>${s.st}</b>
      <span class="bar"><i style="width:${Math.max(2, (s.mi / max) * 100)}%"></i></span>
      <em>${num(s.mi)}</em>
    </div>`).join('')}</div>`;
}

/**
 * What the states reported about this road, where they reported anything.
 *
 * Every other figure on this page is read off a map. These were collected by
 * driving the road, which makes them the only answer here to the questions
 * people actually ask about a highway: how busy is it, and what state is the
 * surface in. Each one states the share of the route it covers, because the
 * states collect pavement condition thoroughly on the National Highway System
 * and patchily elsewhere, and an average over a fifth of a road is not the
 * road's average.
 */
function hpmsFacts(p) {
  const h = p.hpms;
  if (!h) return '';
  const rows = [];
  // Every figure here is measured over a different share of the road, and
  // spelling that out on each line buried the figures under five repetitions
  // of the same sentence. The share is a badge instead, explained once above.
  const cov = (m) => (m && m.cover < 98
    ? ` <span class="fig-cov" title="${esc(t('ca.coverage', { pct: num(m.cover) }))}">${num(m.cover)}%</span>`
    : '');

  if (h.aadt) {
    rows.push([t('hp.traffic'),
      `${t('hp.trafficVal', { n: num(h.aadt.v) })}${cov(h.aadt)}`
      + (h.aadtMax && h.aadtMax > h.aadt.v * 1.2
        ? `<br><span class="fig-s">${t('hp.peak', { n: num(h.aadtMax) })}</span>` : '')]);
  }

  if (h.truck && h.aadt?.v > 0) {
    rows.push([t('hp.trucks'),
      `${t('hp.trucksVal', {
        n: num(h.truck.v),
        pct: num(Math.round((h.truck.v / h.aadt.v) * 1000) / 10, 1),
      })}${cov(h.truck)}`]);
  }

  // FHWA's own thresholds for pavement ride quality, so the number is given a
  // meaning rather than left as an index nobody reads in inches per mile.
  if (h.iri) {
    const grade = h.iri.v < 95 ? 'good' : h.iri.v <= 170 ? 'fair' : 'poor';
    rows.push([t('hp.pavement'),
      `<b class="iri-${grade}">${t(`hp.${grade}`)}</b> · ${t('hp.iriVal', { n: num(h.iri.v) })}${cov(h.iri)}`
      + `<br><span class="fig-s">${t('hp.iriWhy')}</span>`]);
  }

  if (h.rutting && h.cracking) {
    rows.push([t('hp.wear'), `${t('hp.wearVal', {
      rut: num(h.rutting.v, 2), crack: num(h.cracking.v, 1),
    })}${cov(h.rutting)}`]);
  }

  if (h.speed) rows.push([t('hp.speed'), `${num(h.speed.v)} ${t('unit.mph')}${cov(h.speed)}`]);
  if (h.improved) rows.push([t('hp.improved'), t('hp.improvedVal', { n: h.improved })]);
  if (h.futureAadt && h.aadtMax && h.futureAadt > h.aadtMax) {
    rows.push([t('hp.future'), t('hp.futureVal', { n: num(h.futureAadt) })]);
  }

  if (!rows.length) return '';
  const badged = rows.some(([, v]) => v.includes('fig-cov'));
  return figBox(t('hp.title'),
    `${t('hp.sub', { year: app.stats?.hpmsYear ?? '' })}`
    + (badged ? ` ${t('hp.covWhy')}` : '')
    + (h.cover < 90 ? ` ${t('hp.partial', { pct: num(h.cover) })}` : ''), rows);
}

/**
 * What the province measured about this road, for the provinces that publish it.
 *
 * The American counterpart above is one federal collection with one method, so
 * it can be presented as a single block with a single caveat. This cannot.
 * Canada has no national traffic collection: five provinces publish route-level
 * counts in bulk and eight do not, and the five do not agree on method, on
 * currency, or on licence. So the block names the province, the year, the
 * method and the terms every time, and the eight that publish nothing get no
 * block rather than a blank one - the About page is where the absence is
 * explained, because it is a fact about Canada and not about this road.
 */
function provincialTraffic(p) {
  const tr = p.traffic;
  const meta = app.stats?.caTraffic;
  if (!tr || !meta) return '';

  const rows = [];
  const cov = (m) => (m && m.cover != null && m.cover < 98
    ? ` <span class="fig-cov" title="${esc(t('ca.coverage', { pct: num(m.cover) }))}">${num(m.cover)}%</span>`
    : '');

  if (tr.aadt) {
    rows.push([t('hp.traffic'),
      `${t('hp.trafficVal', { n: num(tr.aadt.v) })}${cov(tr.aadt)}`
      // Only where the busiest point is meaningfully above the average, so a
      // road of even flow is not given a second figure that says nothing.
      + (tr.aadtMax && tr.aadtMax > tr.aadt.v * 1.2
        ? `<br><span class="fig-s">${t('hp.peak', { n: num(tr.aadtMax) })}</span>` : '')]);
  }

  // The provinces publish heavy vehicles as a share of the flow, where HPMS
  // publishes a count. Shown as the share it is, not converted into a count
  // that nobody counted.
  if (tr.truck) {
    rows.push([t('hp.trucks'),
      `${t('ca.tr.trucksVal', { pct: num(tr.truck.v, 1) })}${cov(tr.truck)}`]);
  }

  // Nova Scotia alone publishes speeds, and publishes the 85th percentile -
  // the speed most of the traffic is at or below - which is a different thing
  // from the American pages' posted limit and is labelled as one.
  if (tr.speed) {
    rows.push([t('ca.tr.speed'), `${num(tr.speed.v)}<small>km/h</small>`
      + `<br><span class="fig-s">${t('ca.tr.speedWhy')}</span>`]);
  }

  if (!rows.length) return '';

  // One line per province behind the figures, each with its own terms. Ontario
  // publishes these for public use but states no licence, and saying so is the
  // point: the reader can then decide what the figure is worth.
  const notes = [];
  for (const st of tr.from ?? []) {
    const m = meta[st];
    if (!m) continue;
    rows.push(['', `<span class="src">${m.url
      ? `<a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.source)}</a>`
      : esc(m.source)} · ${esc(m.licence)}</span>`]);
    // What the province says about its own figures - which road gets credited
    // for a concurrency, which highways it leaves out, how it combines
    // directions. These change the meaning of the number above them, so they
    // are translated rather than passed through from the source in English.
    const note = t(`ca.tr.note.${st}`);
    if (note && note !== `ca.tr.note.${st}`) notes.push(note);
  }
  if (notes.length) rows.push(['', `<span class="fig-s">${notes.map(esc).join(' ')}</span>`]);

  const span = tr.yearTo && tr.yearTo !== tr.year ? `${tr.year}–${tr.yearTo}` : String(tr.year ?? '');
  const how = tr.stations
    ? t('ca.tr.stations', { n: num(tr.stations) })
    : t('ca.tr.weighted');
  return figBox(t('ca.tr.title'),
    `${t('ca.tr.sub', { year: span, how })}`
    + (rows.some(([, v]) => v.includes('fig-cov')) ? ` ${t('hp.covWhy')}` : '')
    + (tr.cover < 90 ? ` ${t('hp.partial', { pct: num(tr.cover) })}` : ''), rows);
}

/**
 * What Canada publishes about the network this road belongs to.
 *
 * The national report counts kilometres by tier and province, never by route,
 * so this cannot be made into a figure about this highway and is not presented
 * as one. It is here because it is the only published measure of the thing a
 * Canadian route's designation places it inside.
 */
function caInventory(p) {
  const inv = app.stats?.canada;
  if (p.cc !== 'ca' || !p.nhsTier || !inv?.lengthKm) return '';
  const by = inv.lengthKm.byJurisdiction || {};
  const rows = [];
  for (const { st } of p.states ?? []) {
    const km = by[st]?.[p.nhsTier];
    if (km == null) continue;
    rows.push([stateName(st), `<b>${num(km)}</b> ${t('unit.km')}`]);
  }
  if (!rows.length) return '';

  const total = Object.values(by).reduce((s, j) => s + (j[p.nhsTier] ?? 0), 0);
  rows.push([t('ca.inv.national'), `<b>${num(Math.round(total))}</b> ${t('unit.km')}`]);
  rows.push(['', `<span class="src">${esc(inv.source.title)}, `
    + `${esc(inv.source.publisher)}</span>`]);

  return figBox(t('ca.inv.title'),
    `${t('ca.inv.sub')} ${t('ca.inv.tier', {
      tier: t(`ca.nhs.${p.nhsTier}`), asOf: inv.lengthKm.asOf.slice(0, 4),
    })}`, rows);
}

function figBox(title, sub, rows) {
  return `<div class="figs fig-box">
    <div class="figs-h">${title}</div>
    <div class="fig-s">${sub}</div>
    ${rows.map(([k, v]) => `<div class="fig"><span class="fig-k">${k}</span><span class="fig-v">${v}</span></div>`).join('')}
  </div>`;
}

/**
 * The facts a Canadian route has and an American one does not.
 *
 * Two of these are classifications rather than measurements and matter more
 * than any number on the road: whether Transport Canada counts the route in
 * the National Highway System, and whether it carries the Trans-Canada. The
 * paved share and the divided share are worth stating plainly because outside
 * the settled band a designated highway is not necessarily paved, and the
 * American source records neither.
 */
function caFacts(p) {
  if (p.cc !== 'ca') return '';
  const rows = [];

  // The designation, which is a decision by Transport Canada rather than
  // anything measurable off the road, and the reason behind it.
  if (p.nhsTier) {
    rows.push([t('ca.nhs'),
      `<b>${t(`ca.nhs.${p.nhsTier}`)}</b><br><span class="fig-s">${t(`ca.nhs.${p.nhsTier}Why`)}</span>`]);
  }
  // The Trans-Canada is a route carried by other highways rather than a
  // highway of its own, so the useful figure is how much of this road it uses.
  if (p.tchKm > 0) {
    rows.push([t('ca.tch'), p.tchShare >= 99
      ? t('ca.tchAll')
      : t('ca.tchShare', { km: num(p.tchKm), pct: num(p.tchShare, 1) })]);
  }
  if (p.pavedShare != null && p.pavedShare < 99.5) {
    rows.push([t('ca.paved'), `<b>${num(p.pavedShare, 1)}%</b>`]);
  }
  // Only the Canadian source says whether a road is divided; TIGER carries no
  // such attribute, so this is one figure the American pages cannot show.
  if (p.div != null) {
    rows.push([t('dt.divided'), `<b>${num(p.div, p.div % 1 ? 1 : 0)}%</b>`
      + (p.divCov != null && p.divCov < 98
        ? `<span class="fig-s"> · ${t('ca.coverage', { pct: num(p.divCov) })}</span>` : '')]);
  }
  if (p.named?.length) {
    rows.push([t('ca.named'), p.named.map((n) => esc(n)).join(' · ')]);
  }
  if (!rows.length) return '';
  return `<div class="figs ca-facts">${rows.map(([k, v]) =>
    `<div class="fig"><span class="fig-k">${k}</span><span class="fig-v">${v}</span></div>`).join('')}</div>`;
}

function section(key, bodyHtml, open = false) {
  if (!bodyHtml) return '';
  return `<section class="sect${open ? ' open' : ''}">
    <button class="sect-hd" type="button">
      <h3>${t(`sect.${key}`)}</h3>
      <svg class="cv" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5"/></svg>
    </button>
    <div class="sect-bd">${bodyHtml}</div>
  </section>`;
}

function prose(paras) {
  if (!paras?.length) return '';
  return paras.map((p) => `<p>${esc(p)}</p>`).join('');
}

/* The cost table is denominated in thousands, which reads badly at either end
   of its range: $146,455 thousand for I-4 and $7,963,000 thousand for I-95.
   Scale it to whichever unit keeps the number legible. */
function usd(thousands) {
  if (thousands >= 1e6) return `$${(thousands / 1e6).toFixed(2)} billion`;
  if (thousands >= 1e3) return `$${Math.round(thousands / 1e3).toLocaleString()} million`;
  return `$${Math.round(thousands).toLocaleString()},000`;
}

function usdZh(thousands) {
  // Chinese groups by 万 and 亿; at these magnitudes 亿 is the natural unit.
  const yi = (thousands * 1000) / 1e8;
  return yi >= 1 ? `${yi.toFixed(2)} 亿美元` : `${Math.round((thousands * 1000) / 1e4).toLocaleString()} 万美元`;
}

function figuresBlock(figures) {
  if (!figures?.length) return '';
  const rows = figures.map((f) => {
    const label = esc(pick(f.label));
    const value = pick(f.value);
    if (!value) {
      return `<div class="fig"><span class="fig-k">${label}</span>
        <span class="fig-v"><span class="unk">${t('dt.unknown')}</span>
        ${f.why ? `<span class="src">${esc(pick(f.why))}</span>` : ''}</span></div>`;
    }
    // Bold any run of digits so the figure itself carries the emphasis.
    const marked = esc(value).replace(/(\$?[\d][\d,.]*\s?(?:billion|million|bn|m|亿|万)?)/g, '<b>$1</b>');
    return `<div class="fig"><span class="fig-k">${label}</span>
      <span class="fig-v">${marked}${f.source ? `<span class="src">${esc(f.source)}</span>` : ''}</span></div>`;
  }).join('');
  return `<div class="figs">${rows}</div>`;
}

/* ── cities served ────────────────────────────────────────────────────── */

// The Route Log names every urban area of 5,000+ that each Interstate serves.
// One fetch for the whole system, and only once a panel actually asks for it.
let servedPromise = null;
function servedFor(id) {
  servedPromise ||= fetch('data/served.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return servedPromise.then((m) => m[id] || null);
}

function servedBlock(cities) {
  if (!cities?.length) return '';
  const chips = cities.map((c) => `<span class="chip">${esc(c)}</span>`).join('');
  return `<div class="chips">${chips}</div>
    <p class="srcline">${t('served.src')}</p>`;
}

/* ── elevation ────────────────────────────────────────────────────────── */

const elevCache = new Map();

// Profiles are sampled for the curated routes only, so the manifest is checked
// before asking for a file, exactly as the dossiers are.
let elevList = null;
function elevationIndex() {
  elevList ||= fetch('data/elevation/index.json')
    .then((r) => (r.ok ? r.json() : { ids: [] }))
    .then((d) => new Set(d.ids))
    .catch(() => new Set());
  return elevList;
}

async function elevationFor(id) {
  if (elevCache.has(id)) return elevCache.get(id);
  let data = null;
  if ((await elevationIndex()).has(id)) {
    try {
      const res = await fetch(`data/elevation/${id}.json`);
      if (res.ok) data = await res.json();
    } catch { /* leave the panel to report the absence */ }
  }
  elevCache.set(id, data);
  return data;
}

function elevationSvg(profile) {
  const ft = profile.ft;
  const n = ft.length;
  const W = 400;
  const H = 92;
  const lo = Math.min(...ft);
  const hi = Math.max(...ft);
  const range = Math.max(60, hi - lo);
  const x = (i) => (i / (n - 1)) * W;
  const y = (v) => H - ((v - lo) / range) * (H - 12) - 4;

  let d = `M0 ${y(ft[0]).toFixed(1)}`;
  for (let i = 1; i < n; i++) d += ` L${x(i).toFixed(1)} ${y(ft[i]).toFixed(1)}`;
  const area = `${d} L${W} ${H} L0 ${H} Z`;

  const hiIdx = ft.indexOf(hi);
  const gridY = [0.25, 0.5, 0.75].map((f) =>
    `<line class="grid" x1="0" y1="${(H * f).toFixed(1)}" x2="${W}" y2="${(H * f).toFixed(1)}"/>`).join('');

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="elevFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#35e7ff" stop-opacity="0.34"/>
      <stop offset="100%" stop-color="#35e7ff" stop-opacity="0"/>
    </linearGradient></defs>
    ${gridY}
    <path class="area" d="${area}"/>
    <path class="line" d="${d}"/>
    <circle class="peak" cx="${x(hiIdx).toFixed(1)}" cy="${y(hi).toFixed(1)}" r="2.6"/>
  </svg>`;
}

function elevationBlock(profile) {
  if (!profile || !profile.ft?.length) return `<p class="res-empty" style="padding:6px 0">${t('elev.none')}</p>`;
  const ft = profile.ft;
  const hi = Math.max(...ft);
  const lo = Math.min(...ft);
  const hiMi = Math.round(ft.indexOf(hi) * profile.stepMi);
  const loMi = Math.round(ft.indexOf(lo) * profile.stepMi);
  let climb = 0;
  for (let i = 1; i < ft.length; i++) if (ft[i] > ft[i - 1]) climb += ft[i] - ft[i - 1];
  return `<div class="elev">${elevationSvg(profile)}</div>
    <div class="mgrid" style="margin-top:10px">
      ${metric('elev.high', `${num(hi)}<small>${t('unit.ft')}</small>`, '')}
      ${metric('elev.low', `${num(lo)}<small>${t('unit.ft')}</small>`, '')}
      ${metric('elev.climb', `${num(Math.round(climb))}<small>${t('unit.ft')}</small>`, '')}
    </div>
    <p style="margin:9px 0 0;font-family:var(--mono);font-size:10px;color:var(--ink-faint)">
      ${t('elev.at', { ft: num(hi), mi: num(hiMi) })} · ${t('elev.low')}: ${t('elev.at', { ft: num(lo), mi: num(loMi) })}
    </p>
    <p class="srcline">${t('elev.src', { mi: profile.stepMi })}</p>`;
}

/* ── main render ──────────────────────────────────────────────────────── */

export async function renderDetail(id) {
  const host = document.getElementById('detail');
  const meta = app.byId.get(id);
  if (!meta) return;
  const f = app.selectedFeature;

  const p = f?.properties || {};
  const states = prop(f, 'states') || [];
  const types = prop(f, 'types') || {};
  const start = prop(f, 'start');
  const end = prop(f, 'end');
  // The geometry is written as a MultiLineString, but it does not always arrive
  // as one: a feature read back from the map's tiles can come through as a
  // single LineString, whose coordinates are points rather than lines. Taken at
  // face value that makes the first "line" a bare [lon, lat] pair and the
  // terminus row reads a latitude off a number. Normalise to a list of lines.
  const coords = f?.geometry?.coordinates || [];
  const lines = Array.isArray(coords[0]?.[0]) ? coords : (coords.length ? [coords] : []);
  const np = Math.min(p.np ?? lines.length, lines.length) || lines.length;
  const main = lines.slice(0, np);
  const startCoord = main[0]?.[0];
  const endCoord = main[main.length - 1]?.at(-1);

  // Which way the road runs, from its own endpoints. Only used to pick the
  // wording for the two terminus labels; an ambiguous route keeps the
  // both-ways phrasing rather than being forced into one.
  const axis = (() => {
    if (!startCoord || !endCoord) return '';
    const dLon = Math.abs(endCoord[0] - startCoord[0]) * Math.cos((startCoord[1] * Math.PI) / 180);
    const dLat = Math.abs(endCoord[1] - startCoord[1]);
    if (dLon > dLat * 1.6) return 'EW';
    if (dLat > dLon * 1.6) return 'NS';
    return '';
  })();

  const dossier = await loadDossier(id);
  if (app.selected !== id) return; // selection moved on while fetching

  // Which country's source this route came from decides which metrics exist,
  // and the two sources do not carry the same attributes. Nothing is inferred
  // across the border: an absent attribute reads as absent.
  const ca = p.cc === 'ca' || isProvince(meta.st);

  const title = pick(dossier?.name) || meta.label;
  // A route that shares its number says where it is, so the panel is not
  // ambiguous about which of the namesakes is open.
  const subtitle = pick(dossier?.tagline)
    || (meta.where
      ? `${ownerLabel(meta.sys, meta.st)} · ${meta.where}`
      : ownerLabel(meta.sys, meta.st));

  // Three lengths can be in play and they answer different questions, so the
  // headline takes the most authoritative available and the provenance section
  // shows the disagreement rather than hiding it.
  const officialMi = dossier?.officialMi ?? p.offMi ?? null;
  const officialSrc = dossier?.mileageSource || (p.offMi != null ? t('src.routelog') : null);
  const gapNote = p.breaks > 0
    ? `<div class="note gap"><svg viewBox="0 0 24 24"><path d="M12 9v4M12 17v.1"/><circle cx="12" cy="12" r="9"/></svg>
       <span>${t(ca ? 'note.gaps.ca' : 'note.gaps', { n: p.breaks, mi: num(p.gapMi) })}</span></div>` : '';

  host.innerHTML = `
    <div class="dt-hd">
      <div class="dt-hd-top">
        ${shieldHtml(meta, true)}
        <div class="dt-titles">
          <h2 class="dt-name">${esc(title)}</h2>
          <p class="dt-sub">${esc(subtitle)}</p>
        </div>
      </div>
      <button class="dt-x" id="dtClose" type="button" aria-label="Close">
        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
      <div class="dt-acts">
        <button class="btn" id="dtFly" type="button">
          <svg viewBox="0 0 24 24"><path d="M3 12h13M12 6l6 6-6 6"/></svg><span>${t('dt.fly')}</span>
        </button>
        <button class="btn" id="dtTrip" type="button">
          <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg><span>${t('dt.addTrip')}</span>
        </button>
        <button class="btn btn-ico" id="dtZoom" type="button" title="${t('dt.zoom')}">
          <svg viewBox="0 0 24 24"><path d="M3 9V3h6M21 15v6h-6M21 9V3h-6M3 15v6h6"/></svg>
        </button>
      </div>
    </div>

    <div class="dt-bd">
      <div class="termini">
        ${terminusRow('from', start, startCoord, dossier?.termini?.start, axis)}
        ${terminusRow('to', end, endCoord, dossier?.termini?.end, axis)}
      </div>

      <div class="mgrid">
        ${metric('dt.length', `${num(officialMi ?? p.mi)}<small>${t('unit.mi')}</small>`)}
        ${metric(ca ? 'dt.provinces' : 'dt.states', num(states.length))}
        ${metric('dt.straight', `${num(p.spanMi)}<small>${t('unit.mi')}</small>`)}
        ${metric('dt.gradeSep', `${num(p.gs, p.gs % 1 ? 1 : 0)}<small>%</small>`)}
        ${ca
          // The Canadian source carries lane counts and posted speeds, which
          // the American one does not; it carries no toll attribute at all, so
          // a tolled share would be a flat and false zero rather than a
          // measurement. Each tile says what share of the route it was
          // measured over, because these attributes are optional at source
          // and an average over a tenth of a road is not an average of it.
          ? `${metric('ca.lanes', p.lanes == null ? null : num(p.lanes, p.lanes % 1 ? 1 : 0),
            p.lanesCov != null && p.lanesCov < 98 ? t('ca.coverage', { pct: num(p.lanesCov) }) : null)}
             ${metric('ca.speed', p.kph == null ? null : `${num(p.kph)}<small>km/h</small>`,
            // Averaged along the road, so a route signed at 100 for most of its
            // length and 110 for the rest reads 104 - a number no sign shows.
            // The tile says so rather than passing the mean off as a limit.
            [t('ca.speedAvg'),
              p.kphCov != null && p.kphCov < 98 ? t('ca.coverage', { pct: num(p.kphCov) }) : '',
            ].filter(Boolean).join(' '))}`
          // TIGER carries no lane attribute, so the American lane count is the
          // states' own, and says what share of the road it was counted over.
          // Posted speeds are reported far more patchily, so they sit in the
          // measured block below rather than in a tile this size.
          : `${metric('dt.tolled', `${num(p.toll, p.toll % 1 ? 1 : 0)}<small>%</small>`)}
             ${metric('hp.lanes', p.hpms?.lanes ? num(p.hpms.lanes.v, p.hpms.lanes.v % 1 ? 1 : 0) : null,
            p.hpms?.lanes && p.hpms.lanes.cover < 98 ? t('ca.coverage', { pct: num(p.hpms.lanes.cover) }) : null)}`}
      </div>

      ${hpmsFacts(p)}
      ${provincialTraffic(p)}
      ${caFacts(p)}
      ${caInventory(p)}
      ${p.unsigned ? `<div class="figs ca-facts">
        <div class="fig"><span class="fig-k">${t('dt.unsigned')}</span>
        <span class="fig-v">${t('dt.unsignedWhy')}</span></div></div>` : ''}
      ${gapNote}
      <div id="dtSections"></div>
    </div>`;

  // ── sections ──
  const sections = document.getElementById('dtSections');
  const parts = [];

  // FHWA's 1991 route-by-route accounting is the only published construction
  // cost for most of these roads. It is derived data rather than written, so it
  // is built here and folded into the money section whether or not a dossier
  // exists — which is what gives an otherwise undocumented Interstate a real,
  // citable cost instead of a blank.
  const costFigure = p.offCostK ? figuresBlock([{
    label: { en: 'Interstate Construction cost', zh: '州际公路建设计划造价' },
    value: {
      en: `${usd(p.offCostK)} in then-year dollars, state and federal funds combined`,
      zh: `${usdZh(p.offCostK)}（当年币值，含州与联邦资金）`,
    },
    source: 'FHWA, Estimated Cost of Individual Interstate Routes (1991 Interstate Cost Estimate)',
  }, {
    label: { en: 'What that figure covers', zh: '该数字的涵盖范围' },
    value: {
      en: 'Preliminary engineering, right-of-way and construction paid for with Interstate '
        + 'Construction funds, with obligations counted to the end of 1989. It excludes work done since, '
        + 'and it excludes any toll road folded into the system without those funds.'
        + (p.offCostWhole
          ? ' This is the published total for the whole route as the table defined it, used here because '
            + 'at least one state this route crosses has no line of its own — usually because that '
            + 'stretch was not built with those funds.'
          : ''),
      zh: '以州际公路建设专项资金支付的前期设计、征地与施工费用，债务计至 1989 年底。'
        + '不含此后的工程，也不含未动用该资金而并入系统的收费公路。'
        + (p.offCostWhole
          ? '此处采用的是该表所定义的整条路线公布总额，因为本路线经过的至少一个州在表中没有单独条目——'
            + '通常是因为那段路并非由该资金修建。'
          : ''),
    },
    source: 'FHWA, Interstate System engineering data, notes to the cost tables',
  }]) : '';

  const written = new Map((dossier?.sections || []).map((s) => [s.key, s]));
  let first = true;
  for (const key of SECTION_ORDER) {
    const s = written.get(key);
    if (!s && !(key === 'money' && costFigure)) continue;
    let body = s ? prose(s[getLang()] || s.en) : '';
    if (key === 'money') body += figuresBlock(dossier?.figures) + costFigure;
    if (key === 'traffic' && dossier?.trafficFigures) body += figuresBlock(dossier.trafficFigures);
    if (key === 'condition' && dossier?.conditionFigures) body += figuresBlock(dossier.conditionFigures);
    parts.push(section(key, body, first));
    first = false;
  }

  if (!dossier) {
    parts.push(`<div style="padding:14px 16px 0">
      <div class="note"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6v.1"/></svg>
      <span>${t('note.noDossier')}</span></div></div>`);
  }

  parts.push(section('composition', compositionBlock(types), !dossier));
  parts.push(section('statesList', statesBlock(states)));
  parts.push(section('served', '<div id="dtServed"></div>'));
  parts.push(section('elevation', '<div id="dtElev"></div>'));

  // Where the two lengths disagree the reason is usually structural rather
  // than an error, so name the likely cause instead of leaving a bare gap.
  const delta = officialMi ? Math.round(p.mi - officialMi) : 0;
  const lengthRows = officialMi ? `<div class="figs" style="margin-top:11px">
    <div class="fig"><span class="fig-k">${t('len.official')}</span>
      <span class="fig-v"><b>${num(officialMi)}</b> ${t('unit.mi')}
      ${officialSrc ? `<span class="src">${esc(officialSrc)}</span>` : ''}</span></div>
    <div class="fig"><span class="fig-k">${t('len.measured')}</span>
      <span class="fig-v"><b>${num(p.mi)}</b> ${t('unit.mi')}
      <span class="src">${t('len.measuredSrc')}</span></span></div>
    ${Math.abs(delta) >= Math.max(3, officialMi * 0.02) ? `<div class="fig">
      <span class="fig-k">${t('len.delta')}</span>
      <span class="fig-v">${delta > 0 ? '+' : ''}<b>${num(delta)}</b> ${t('unit.mi')}
      <span class="src">${t('len.deltaWhy')}</span></span></div>` : ''}
  </div>` : '';

  // Every page says where its numbers came from, and for a Canadian route
  // that is a different survey with different attributes - including one it
  // does not have, which is worth saying out loud so a reader does not read
  // the absent toll share as a road with no tolls on it.
  const info = (key) => `<div class="note">
    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6v.1"/></svg>
    <span>${t(key)}</span></div>`;
  parts.push(section('data',
    info(ca ? 'ca.note.derived' : 'note.derived')
    + (ca ? info('ca.tolls') : '')
    // The measured figures come from somewhere else entirely, so they get
    // their own provenance rather than sheltering under the map's.
    + (p.hpms ? info('hp.note') : '') + lengthRows));

  sections.innerHTML = parts.join('');

  for (const hd of sections.querySelectorAll('.sect-hd')) {
    hd.addEventListener('click', () => hd.closest('.sect').classList.toggle('open'));
  }

  document.getElementById('dtClose').addEventListener('click', clearSelection);
  document.getElementById('dtFly').addEventListener('click', () => startFly(id));
  document.getElementById('dtTrip').addEventListener('click', () => addToTrip(id));
  document.getElementById('dtZoom').addEventListener('click', () => f && fitTo(f));

  elevationFor(id).then((profile) => {
    const slot = document.getElementById('dtElev');
    if (slot && app.selected === id) slot.innerHTML = elevationBlock(profile);
  });

  servedFor(id).then((cities) => {
    const slot = document.getElementById('dtServed');
    if (!slot || app.selected !== id) return;
    const sect = slot.closest('.sect');
    if (!cities?.length) { sect?.remove(); return; }
    slot.innerHTML = servedBlock(cities);
    sect.querySelector('h3').textContent = `${t('sect.served')} · ${cities.length}`;
  });
}
