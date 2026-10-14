/* The route detail panel.

   Two kinds of information share this panel and are deliberately kept
   distinguishable. Measured values - length, termini, state mileage, roadway
   class - are computed from the mapped geometry and carry a provenance note.
   Editorial values - cost, traffic, condition - come from a written dossier and
   each carries its own source line. Where no published figure exists the row
   says so rather than guessing. */

import {
  t, getLang, stateName, num, isProvince, ownerLabel, lenNum, routeLabel,
  lenOf, lenOfKm, lenUnit, dist, distKm, distAlt, speedKph, speedMph, heightFt, getUnits,
} from './i18n.js';
import { app, shieldHtml, clearSelection, fitTo, loadDossier, routeNames, whereOf } from './app.js';
import { startFly } from './fly.js';
import { tollSection } from './tolls.js';
import { loadSpeed, speedColour, speedNum, speedUnit, bandLabel } from './speed.js';
import { CLASS_COLOUR, SECTION_ORDER, countryOf } from './schema.js';

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
  } else if (place?.tramo) {
    const name = (getLang() === 'zh' && place.nameZh) || place.name || place.nameZh;
    // Mexico's ends are SICT sections; Taiwan's and Hong Kong's are streets.
    const key = place.nameZh !== undefined ? 'dt.onRoad' : 'dt.onTramo';
    body = name ? t(key, { road: esc(name), tramo: esc(name) }) : '—';
  } else if (place?.cn) {
    // A mainland end is named by the nearest city or town OSM maps, in the
    // reader's language, with its province spelt out.
    const name = getLang() === 'zh' ? (place.nameZh || place.name) : (place.name || place.nameZh);
    const at = esc(getLang() === 'zh' ? `${stateName(place.st)}${name}` : `${name}, ${stateName(place.st)}`);
    body = place.km <= 6 ? at : t('dt.nearBy', { place: at, d: distKm(place.km) });
  } else if (place) {
    body = place.km <= 6
      ? esc(`${place.name}, ${place.st}`)
      : t('dt.nearBy', { place: esc(`${place.name}, ${place.st}`), d: distKm(place.km) });
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

/**
 * One figure in the tile grid, with an optional caveat.
 *
 * A tile is three centimetres wide and holds a number, so `sub` has to be a
 * badge and not a sentence: "82%" fits beside the figure, and the sentence that
 * explains what the 82% is goes in `tip`, where it has room. Getting this the
 * wrong way round set a full clause inside a one-third-width tile and stretched
 * the whole row to fit it.
 */
function metric(key, value, sub, tip) {
  const na = value == null;
  // A coverage note belongs to a figure. Printed under "no public figure" it
  // reads as a contradiction: nothing measured, measured over 0% of the route.
  const note = na ? null : sub;
  return `<div class="m"${tip && !na ? ` title="${esc(tip)}"` : ''}>
    <span class="m-k">${t(key)}</span>
    <div class="m-v${na ? ' na' : ''}">${na ? t('dt.unknown') : value}${
  note ? `<small class="m-n">${note}</small>` : ''}</div>
  </div>`;
}

/** How much of the route a figure was measured over, as a badge not a clause. */
const covBadge = (pct) => (pct != null && pct < 98 ? `${num(pct)}%` : null);

/**
 * The length, at the size it is actually read at.
 *
 * Six tiles of equal weight meant that how long the road is — the one figure
 * almost everybody opens a highway page for — sat in the same box, in the same
 * type, as what share of it is tolled. This lifts it out of the grid and the
 * other five stay in it.
 *
 * The headline is the measured length, the same figure every list and total
 * uses, so the road is the same length here as in the row that opened it.
 * The official figure sits beside it where there is one; the provenance
 * section below explains the gap. The other unit sits under the headline one
 * unconditionally: the reader's choice of unit is theirs, but the sign at the
 * side of the road is in whichever unit its country uses.
 */
const HERO_SRC = { mx: 'len.heroRnc', tw: 'len.heroNlsc', hk: 'len.heroTd', cn: 'len.heroOsm' };

const OFFICIAL_KEYS = {
  Official: ['len.heroOfficial', 'len.heroOfficialCovers', 'len.official'],
  Planned: ['len.heroPlanned', 'len.heroPlannedCovers', 'len.planned'],
  Built: ['len.heroBuilt', 'len.heroBuiltCovers', 'len.built'],
};

function heroLength(p, officialMi, ca, covers = 0, kind = 'Official') {
  const [one, many] = OFFICIAL_KEYS[kind];
  return `<div class="mhero">
    <span class="m-k">${t('dt.length')}</span>
    <div class="mhero-row"><div class="mhero-v">${lenNum(p.mi)}<small>${lenUnit()}</small></div>${officialMi != null
    ? `<span class="mhero-off"><b>${lenNum(officialMi)}</b> ${lenUnit()}<br>${covers > 1 ? t(many, { n: covers }) : t(one)}</span>` : ''}</div>
    <span class="mhero-s">${distAlt(p.mi)} · ${t(ca ? 'len.heroNrn' : HERO_SRC[p.cc] ?? 'len.heroTiger')}</span>
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

// The atlas's three-letter codes for Chinese provinces are its own, so a
// reader would not know them; those rows carry the province's name instead.
function statesBlock(states, named = false) {
  if (!states?.length) return '';
  const max = Math.max(...states.map((s) => s.mi));
  return `<div class="st-rows${named ? ' st-named' : ''}">${states.map((s) => `
    <div class="st-row">
      <b>${named ? stateName(s.st) : s.st}</b>
      <span class="bar"><i style="width:${Math.max(2, (s.mi / max) * 100)}%"></i></span>
      <em>${num(lenOf(s.mi))}</em>
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
    // 1 m/km is 63.36 in/mi, the unit the rest of the world reports IRI in.
    const metricIri = getUnits() === 'metric';
    const iri = metricIri ? t('hp.iriValM', { n: num(h.iri.v / 63.36, 2) }) : t('hp.iriVal', { n: num(h.iri.v) });
    rows.push([t('hp.pavement'),
      `<b class="iri-${grade}">${t(`hp.${grade}`)}</b> · ${iri}${cov(h.iri)}`
      + `<br><span class="fig-s">${t(metricIri ? 'hp.iriWhyM' : 'hp.iriWhy')}</span>`]);
  }

  if (h.rutting && h.cracking) {
    rows.push([t('hp.wear'), `${t('hp.wearVal', {
      rut: num(h.rutting.v, 2), crack: num(h.cracking.v, 1),
    })}${cov(h.rutting)}`]);
  }

  if (h.speed) rows.push([t('hp.speed'), `${speedMph(h.speed.v)}${cov(h.speed)}`]);
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
    rows.push([t('ca.tr.speed'), speedKph(tr.speed.v)
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
    rows.push([stateName(st), `<b>${num(lenOfKm(km))}</b> ${lenUnit()}`]);
  }
  if (!rows.length) return '';

  const total = Object.values(by).reduce((s, j) => s + (j[p.nhsTier] ?? 0), 0);
  rows.push([t('ca.inv.national'), `<b>${num(lenOfKm(total))}</b> ${lenUnit()}`]);
  rows.push(['', `<span class="src">${esc(inv.source.title)}, `
    + `${esc(inv.source.publisher)}</span>`]);

  return figBox(t('ca.inv.title'),
    `${t('ca.inv.sub')} ${t('ca.inv.tier', {
      tier: t(`ca.nhs.${p.nhsTier}`), asOf: inv.lengthKm.asOf.slice(0, 4),
    })}`, rows);
}

/**
 * What SICT counted on this road.
 *
 * Mexico publishes counts per station rather than per route, and the stations
 * are points spaced however the survey spaced them, so a mean would weight a
 * city stretch with five stations five times over. The median station and the
 * range are what the figures honestly support.
 */
function mexicanTraffic(p) {
  const tr = p.mxTraffic;
  const meta = app.stats?.mxTraffic;
  if (!tr || !meta) return '';
  const rows = [[t('hp.traffic'), t('hp.trafficVal', { n: num(tr.median) })]];
  if (tr.stations > 1 && tr.max > tr.min) {
    rows.push([t('mx.tr.range'), t('mx.tr.rangeVal', { min: num(tr.min), max: num(tr.max) })]);
  }
  if (tr.truckShare != null) {
    rows.push([t('mx.tr.trucks'), t('mx.tr.trucksVal', { pct: num(tr.truckShare, 1) })]);
  }
  rows.push(['', `<span class="src"><a href="${esc(meta.url)}" target="_blank" rel="noopener">`
    + `${esc(meta.agency ?? meta.source)}</a> · ${esc(meta.licence)}</span>`]);
  return figBox(t('mx.tr.title'), t('mx.tr.sub', { n: num(tr.stations), year: tr.year }), rows);
}

/**
 * What Taiwan's two highway agencies count on this road.
 *
 * The Freeway Bureau's figures are reference volumes per section, with the
 * unit and the method unstated, so they are given as the bureau names them and
 * never called AADT. The Highway Bureau's are a survey, weighted here by the
 * length of road each station stands for.
 */
function taiwanTraffic(p) {
  const tr = p.twTraffic;
  const meta = app.stats?.twTraffic?.[tr?.kind];
  if (!tr || !meta) return '';
  const day = (n) => t('hp.trafficVal', { n: num(n) });
  const rows = [];
  let sub;
  if (tr.kind === 'freeway') {
    rows.push([t('tw.tr.busiest'), `${day(tr.max)}<span class="fig-s"> · ${esc(tr.maxAt)}</span>`]);
    rows.push([t('tw.tr.median'), day(tr.weekday)]);
    rows.push([t('tw.tr.sat'), day(tr.sat)]);
    rows.push([t('tw.tr.sun'), day(tr.sun)]);
    if (tr.elevated) {
      rows.push([t('tw.tr.elevated'), `${day(tr.elevated.weekday)}`
        + `<span class="fig-s"> · ${t('tw.tr.sections', { n: num(tr.elevated.sections) })}</span>`]);
    }
    sub = t('tw.tr.subFwy', { n: num(tr.sections), year: tr.year });
  } else {
    rows.push([t('hp.traffic'), day(tr.adt)]);
    if (tr.stations > 1) rows.push([t('tw.tr.busiestStation'), `${day(tr.max)}<span class="fig-s"> · ${esc(tr.maxAt)}</span>`]);
    if (tr.heavyShare != null) rows.push([t('mx.tr.trucks'), `<b>${num(tr.heavyShare, 1)}%</b>`]);
    if (tr.motoShare != null) rows.push([t('tw.tr.moto'), `<b>${num(tr.motoShare, 1)}%</b>`]);
    sub = t('tw.tr.subPv', { n: num(tr.stations), year: tr.year })
      + (tr.cover != null && tr.cover < 90 ? ` ${t('tw.tr.partial', { pct: num(tr.cover) })}` : '');
  }
  rows.push(['', `<span class="src"><a href="${esc(meta.url)}" target="_blank" rel="noopener">`
    + `${esc(meta.agency)}</a> · ${esc(meta.licence)}</span>`]);
  return figBox(t(tr.kind === 'freeway' ? 'tw.tr.titleFwy' : 'tw.tr.titlePv'), sub, rows);
}

function hongKongTraffic(hk, census) {
  const tr = hk?.traffic;
  if (!tr || !census) return '';
  const day = (n) => t('hp.trafficVal', { n: num(n) });
  const at = ([road, from, to]) => `<span class="fig-s"> · ${esc(road)}, ${esc(from)} – ${esc(to)}</span>`;
  const rows = [[t('hk.tr.median'), day(tr.median)]];
  if (tr.stations > 1) {
    rows.push([t('tw.tr.busiestStation'), `${day(tr.max)}${at(tr.maxAt)}`]);
    const low = tr.list.reduce((a, b) => (b[5] < a[5] ? b : a));
    rows.push([t('hk.tr.quietest'), `${day(low[5])}${at([low[2], low[3], low[4]])}`]);
  }
  rows.push(['', `<span class="src"><a href="${esc(census.url)}" target="_blank" rel="noopener">`
    + `${esc(census.source)}</a></span>`]);
  return figBox(t('hk.tr.title'), t('hk.tr.sub', { n: num(tr.stations), core: num(tr.core), year: tr.year }), rows);
}

let hkRoutesPromise = null;
function loadHkRoutes() {
  hkRoutesPromise ||= fetch('data/hk-routes.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return hkRoutesPromise;
}

/**
 * The ends an authority lists for the route, under the two drawn ones.
 *
 * A mainland route's are the plan's, as its OSM relation is tagged; a
 * Taiwanese provincial highway's are the Highway Bureau's register. Both are
 * quoted, not matched to the geometry, so they do not say which drawn end is
 * which, and they are in the script the authority wrote them in.
 */
function listedEnds(p, names) {
  const cn = p.cc === 'cn';
  const from = cn ? p.osm?.from : p.reg?.from;
  const to = cn ? p.osm?.to : p.reg?.to;
  const full = cn ? names?.full : null;
  if (!from && !to && !full) return '';
  const ends = [from, to].filter(Boolean).join(' — ');
  const body = [full, ends].filter(Boolean).map((s) => esc(s)).join(getLang() === 'zh' ? '：' : ' · ');
  return `<div class="term-list"><span class="term-k">${t(cn ? 'dt.plannedEnds' : 'dt.registerEnds')}</span>
    <span class="term-v" lang="zh">${body}</span></div>`;
}

/**
 * The roads a route runs along, as its source names them, less the route's
 * own names, bare numbers (219国道) and pairs of ends (喀纳斯 - 东兴), which
 * the header and the termini already say. A Hong Kong route's are the whole
 * list from its reference file, in the order its exits run and in both
 * languages, where the road file keeps four English names.
 */
function roadsBlock(p, own, hk) {
  const listed = hk?.roads?.map(([en, zh]) => (getLang() === 'zh' ? zh : en));
  const roads = (listed ?? p.named ?? []).filter((n) => !own.includes(n)
    && !/^\d+\s*(?:国道|省道)$|^[GSX]\d+$/.test(n) && !/\s[-－–—]\s/.test(n));
  if (!roads.length) return '';
  return `<div class="figs ca-facts"><div class="fig"><span class="fig-k">${t('ea.roads')}</span>
    <span class="fig-v">${roads.map((n) => esc(n)).join(' · ')}</span></div></div>`;
}

/** What the RNC records about a Mexican route that is not a measurement. */
function mxFacts(p) {
  if (p.cc !== 'mx') return '';
  const rows = [];
  if (p.admin?.length) {
    rows.push([t('mx.admin'), p.admin.map((a) => esc(t(`mx.admin.${a}`))).join(' · ')]);
  }
  if (p.invNum) rows.push([t('mx.invNum'), `<span class="fig-s">${t('mx.invNumWhy')}</span>`]);
  if (p.pavedShare != null && p.pavedShare < 99.5) {
    rows.push([t('ca.paved'), `<b>${num(p.pavedShare, 1)}%</b>`]);
  }
  if (p.div != null) {
    rows.push([t('dt.divided'), `<b>${num(p.div, p.div % 1 ? 1 : 0)}%</b>`
      + (p.divCov != null && p.divCov < 98
        ? `<span class="fig-s"> · ${t('ca.coverage', { pct: num(p.divCov) })}</span>` : '')]);
  }
  if (p.named?.length) rows.push([t('mx.tramos'), p.named.map((n) => esc(n)).join(' · ')]);
  if (p.located != null) {
    rows.push(['', `<span class="fig-s">${t('mx.located', { pct: num(p.located) })}</span>`]);
  }
  rows.push(['', `<span class="fig-s">${t('mx.note.derived')}</span>`]);
  return `<div class="figs ca-facts">${rows.map(([k, v]) =>
    `<div class="fig"><span class="fig-k">${k}</span><span class="fig-v">${v}</span></div>`).join('')}</div>`;
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
      : t('ca.tchShare', { d: distKm(p.tchKm), pct: num(p.tchShare, 1) })]);
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

/* ── dates ────────────────────────────────────────────────────────────── */

// Québec's directory dates each tronçon's opening; the Year Book dates the
// Trans-Canada's Act, agreements and openings; the Interstate system has its
// Acts and milestones, as do the East Asian systems their plans and openings.
// All of them sit in the network-wide history file rather than in a dossier,
// so they are fetched only for those routes and only once. A system's event
// belongs to the whole system, so every route in it carries it.
const kindIs = (k) => (e) => e.kind === k;
const SYSTEM_HISTORY = {
  'ca-tch': kindIs('tch'),
  'us-interstate': (e) => e.system === true && !e.kind,
  'cn-expressway': kindIs('cnx'),
  'cn-national': kindIs('cnn'),
  'tw-freeway': kindIs('twf'),
  'tw-provincial': kindIs('twp'),
  'hk-route': kindIs('hk'),
};
let historyPromise = null;
function historyEvents(id, sys) {
  historyPromise ||= fetch('data/timeline.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return historyPromise.then((h) => (h.events || []).filter((e) =>
    (e.kind === 'qc' && e.id === id) || SYSTEM_HISTORY[sys]?.(e)));
}

/** The years a route was designated and finished, and what happened between. */
function chronoBlock(dossier, events) {
  const years = [
    dossier?.designatedYear != null && ['chron.designated', dossier.designatedYear],
    dossier?.completedYear != null && ['chron.completed', dossier.completedYear],
  ].filter(Boolean);
  if (!years.length && !events.length) return '';
  const head = years.length ? `<div class="mgrid">${years.map(([k, y]) => metric(k, String(y), '')).join('')}</div>` : '';
  const list = events.length ? `<ol class="chron">${events.map((e) => `<li>
      <b>${e.year}</b><span>${esc(pick(e))}${e.source ? `<small class="src">${esc(e.source)}</small>` : ''}</span>
    </li>`).join('')}</ol>` : '';
  return head + list;
}

/* ── speed limit ──────────────────────────────────────────────────────── */

/**
 * The route's limit as a sign, with where it came from beside it.
 *
 * A sign is drawn the way the country draws one - the American white
 * rectangle, everyone else's red ring - because that is how a limit is
 * recognised at a glance. A default the law sets is drawn dashed, being a rule
 * and not a sign anyone put up, and a route with no source gets a blank sign
 * and the reason there is none.
 */
function speedBlock(d, id, p) {
  const r = d.routes[id];
  const kph = r?.[0];
  const src = r?.[1] ?? 'u';
  const cov = r?.[2];
  const bins = r?.[3];
  const cc = p.cc ?? countryOf(p.sys);
  const v = kph ? speedNum(kph) : '—';
  const sign = cc === 'us'
    ? `<span class="spd-sign spd-us spd-${src}"><small>SPEED<br>LIMIT</small><b>${v}</b></span>`
    : `<span class="spd-sign spd-ring spd-${src}"><b>${v}</b></span>`;
  const badge = src === 'u' ? '' : `<span class="spd-badge spd-b-${src}">${t(`spd.src.${src}`)}</span>`;
  let why;
  if (src === 'p') why = t(`spd.why.p.${cc}`) + (cov != null && cov < 98 ? ` ${t('ca.coverage', { pct: num(cov) })}` : '');
  else if (src === 'o') why = t('spd.why.o', { pct: num(cov) });
  else if (src === 'l') {
    why = t('spd.why.l', { basis: esc(d.law[p.sys]?.basis ?? '') })
      + (cov ? ` ${t('spd.why.lPart', { pct: num(cov) })}` : '');
  } else why = t(['us', 'ca', 'mx'].includes(cc) ? `spd.none.${cc}` : 'spd.none.osm');
  const total = bins?.reduce((a, [, km]) => a + km, 0) || 0;
  const mixHtml = bins?.length > 1 ? `<p class="spd-mix-h">${t('spd.mix')}</p>
    <div class="spd-bar">${bins.slice().sort((a, b) => a[0] - b[0]).map(([k, km]) =>
      `<i style="flex:${km};background:${speedColour(k)}" title="${bandLabel(k)} ${speedUnit()} · ${distKm(km)}"></i>`).join('')}</div>
    <ul class="stack-key">${bins.slice(0, 5).map(([k, km]) => `<li><i style="background:${speedColour(k)}"></i>${speedNum(k)} ${speedUnit()}
      <b>${distKm(km)}</b><small>${num((km / total) * 100)}%</small></li>`).join('')}</ul>` : '';
  return `<div class="spd">
    ${sign}
    <div class="spd-t">
      <p class="spd-v">${kph ? `<b>${v}</b> ${speedUnit()}` : t('spd.none')} ${badge}</p>
      <p class="spd-why">${why}</p>
    </div>
  </div>${mixHtml}`;
}

/* ── cities served ────────────────────────────────────────────────────── */

// The Route Log names every urban area of 5,000+ that each Interstate serves.
// One fetch for the whole system, and only once a panel actually asks for it.
let servedPromise = null;
function servedFor(id) {
  servedPromise ||= fetch('data/served.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return servedPromise.then((m) => m[id] || null);
}

// A mainland national route's cities come from OpenStreetMap instead, as
// [zh, en] pairs in the order the line meets them.
let townsPromise = null;
function townsFor(id) {
  townsPromise ||= fetch('data/towns.json').then((r) => (r.ok ? r.json() : { routes: {} })).catch(() => ({ routes: {} }));
  return townsPromise.then((m) => m.routes[id]?.map(([zh, en]) => (getLang() === 'zh' ? zh : en)) ?? null);
}

// East Asian routes' lanes, toll share and structures, read from
// OpenStreetMap's tags along each route by tools/build-speed.mjs.
let osmAttrsPromise = null;
function loadOsmAttrs() {
  osmAttrsPromise ||= fetch('data/osm-attrs.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return osmAttrsPromise;
}

function servedBlock(cities, src = 'served.src') {
  if (!cities?.length) return '';
  const chips = cities.map((c) => `<span class="chip">${esc(c)}</span>`).join('');
  return `<div class="chips">${chips}</div>
    <p class="srcline">${t(src)}</p>`;
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
  const metricUnits = getUnits() === 'metric';
  const tile = (f) => (metricUnits
    ? `${num(f * 0.3048)}<small>${t('unit.m')}</small>`
    : `${num(f)}<small>${t('unit.ft')}</small>`);
  const pos = (i) => t(metricUnits ? 'elev.pos.km' : 'elev.pos.mi', { n: num(lenOf(i * profile.stepMi)) });
  let climb = 0;
  for (let i = 1; i < ft.length; i++) if (ft[i] > ft[i - 1]) climb += ft[i] - ft[i - 1];
  return `<div class="elev">${elevationSvg(profile)}</div>
    <div class="mgrid" style="margin-top:10px">
      ${metric('elev.high', tile(hi), '')}
      ${metric('elev.low', tile(lo), '')}
      ${metric('elev.climb', tile(Math.round(climb)), '')}
    </div>
    <p style="margin:9px 0 0;font-family:var(--mono);font-size:10px;color:var(--ink-faint)">
      ${t('elev.at', { h: heightFt(hi), pos: pos(ft.indexOf(hi)) })} · ${t('elev.low')}: ${t('elev.at', { h: heightFt(lo), pos: pos(ft.indexOf(lo)) })}
    </p>
    <p class="srcline">${t('elev.src', { d: dist(profile.stepMi, profile.stepMi < 1 ? 1 : 0) })}</p>`;
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
  const mx = p.cc === 'mx';

  // The number and the name carry the same weight: the shield is the number,
  // and the name sits beside it at the size a title is read at. A route known
  // only by its number has its number spelt out there instead. The other
  // language's name is under it, then whose road it is.
  const names = routeNames(meta);
  const title = pick(dossier?.name) || names?.main || routeLabel(meta.label);
  const aka = [...(dossier?.aka || []).map(pick), ...(names?.alt ?? [])].filter((n) => n && n !== title);
  const where = whereOf(meta);
  const owner = where ? `${ownerLabel(meta.sys, meta.st)} · ${where}` : ownerLabel(meta.sys, meta.st);
  const subtitle = [names?.other && names.other !== title ? names.other : null, owner].filter(Boolean)
    .map((s, i, all) => (i === 0 && all.length > 1 ? `<span class="dt-other">${esc(s)}</span>` : esc(s))).join(' · ');
  const tagline = pick(dossier?.tagline);

  // Three lengths can be in play and they answer different questions, so the
  // headline takes the most authoritative available and the provenance section
  // shows the disagreement rather than hiding it. A mainland route's is the
  // plan's listed length, which includes what is planned but not yet built.
  const plan = p.cc === 'cn' ? p.plan : null;
  const planKm = plan?.km ?? plan?.builtKm ?? null;
  const officialMi = dossier?.officialMi ?? p.offMi ?? (planKm ? planKm / 1.609344 : null);
  const officialSrc = dossier?.mileageSource || (planKm && dossier?.officialMi == null
    ? t(plan.km ? 'cn.listedSrc' : 'cn.builtSrc')
    : p.offMi == null ? null
      : p.offSrc === 'thb' ? t('src.thb', { date: p.reg?.updated ?? '' }) : t('src.routelog'));
  const heroKind = planKm && dossier?.officialMi == null ? (plan.km ? 'Planned' : 'Built') : 'Official';
  const ea = p.cc === 'tw' || p.cc === 'hk' || p.cc === 'cn';
  const osm = ea ? (await loadOsmAttrs())?.routes?.[id] ?? null : null;
  const hkData = p.cc === 'hk' ? await loadHkRoutes() : null;
  const hk = hkData?.routes?.[id] ?? null;
  if (app.selected !== id) return;
  const gapNote = p.breaks > 0
    ? `<div class="note gap"><svg viewBox="0 0 24 24"><path d="M12 9v4M12 17v.1"/><circle cx="12" cy="12" r="9"/></svg>
       <span>${t(ca ? 'note.gaps.ca' : ea ? 'note.gaps.ea' : 'note.gaps', { n: p.breaks, d: dist(p.gapMi) })}</span></div>` : '';

  host.innerHTML = `
    <div class="dt-hd">
      <div class="dt-hd-top">
        ${shieldHtml(meta, true)}
        <span class="dt-bar" aria-hidden="true"></span>
        <div class="dt-titles">
          <h2 class="dt-name">${esc(title)}</h2>
          <p class="dt-sub">${subtitle}</p>
        </div>
      </div>
      ${tagline ? `<p class="dt-tag">${esc(tagline)}</p>` : ''}
      ${aka.length ? `<div class="dt-aka"><span class="dt-aka-k">${t('dt.aka')}</span>${
    aka.map((n) => `<span class="dt-aka-n">${esc(n)}</span>`).join('')}</div>` : ''}
      <button class="dt-x" id="dtClose" type="button" aria-label="Close">
        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
      <div class="dt-acts">
        <button class="btn" id="dtFly" type="button">
          <svg viewBox="0 0 24 24"><path d="M3 12h13M12 6l6 6-6 6"/></svg><span>${t('dt.fly')}</span>
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
        ${dossier?.termini ? '' : listedEnds(p, names)}
      </div>

      ${heroLength(p, officialMi, ca, dossier?.officialCovers?.length ?? (planKm ? plan.pieces : 0), heroKind)}

      <div class="mgrid">
        ${p.cc === 'hk'
    // Hong Kong is one jurisdiction, so its first tile is what the census
    // counted on the route instead of how many it crosses.
    ? metric('hk.tr.tile', hk?.traffic ? `${num(hk.traffic.median)}<small>${t('unit.vpd')}</small>` : null, '',
      hk?.traffic ? t('hk.tr.tileTip', { year: hk.traffic.year, n: num(hk.traffic.stations) }) : null)
    : metric(ca || p.cc === 'cn' ? 'dt.provinces' : p.cc === 'tw' ? 'ea.counties' : 'dt.states', num(states.length))}
        ${metric('dt.straight', `${num(lenOf(p.spanMi))}<small>${lenUnit()}</small>`)}
        ${ea
          // Taiwan's centrelines are classed freeway, expressway or ordinary
          // road, so the freeway share is measured. Hong Kong's say nothing
          // about a road's standard. Neither records lanes or structures, so
          // those are OpenStreetMap's, read along the route; the lane count
          // says what share of the road it was read over. The share on
          // bridges and in tunnels is the figure Chinese sources give a road.
          ? `${metric('dt.gradeSep', p.gs == null ? null : `${num(p.gs, p.gs % 1 ? 1 : 0)}<small>%</small>`)}
             ${metric('ea.structures', osm ? `${num(osm[2] + osm[3], 1)}<small>%</small>` : null,
            '', osm ? t('ea.structTip', { b: num(osm[2], 1), t: num(osm[3], 1) }) : null)}
             ${metric('hp.lanes', osm?.[0] == null ? null : num(osm[0], osm[0] % 1 ? 1 : 0),
            covBadge(osm?.[1]), osm?.[0] == null ? null : t('ea.osmTip', { pct: num(osm[1]) }))}`
          : mx
          // The RNC has no functional class, so it cannot say what share of a
          // road is freeway. The tile it would have gone in carries the toll
          // share instead, which the RNC does record, segment by segment.
          ? `${metric('mx.toll', p.mxToll == null ? null : `${num(p.mxToll, p.mxToll % 1 ? 1 : 0)}<small>%</small>`,
            covBadge(p.mxTollCov), t('mx.tollWhy'))}
             ${metric('mx.lanes', p.lanes == null ? null : num(p.lanes, p.lanes % 1 ? 1 : 0),
            covBadge(p.lanesCov),
            p.lanesCov != null && p.lanesCov < 98 ? t('ca.coverage', { pct: num(p.lanesCov) }) : null)}`
          : `${metric('dt.gradeSep', `${num(p.gs, p.gs % 1 ? 1 : 0)}<small>%</small>`)}
        ${ca
          // The Canadian source carries lane counts and posted speeds, which
          // the American one does not; it carries no toll attribute at all, so
          // a tolled share would be a flat and false zero rather than a
          // measurement. Each tile says what share of the route it was
          // measured over, because these attributes are optional at source
          // and an average over a tenth of a road is not an average of it.
          ? `${metric('ca.lanes', p.lanes == null ? null : num(p.lanes, p.lanes % 1 ? 1 : 0),
            covBadge(p.lanesCov),
            p.lanesCov != null && p.lanesCov < 98 ? t('ca.coverage', { pct: num(p.lanesCov) }) : null)}
             ${metric('ca.speed', p.kph == null ? null : (getUnits() === 'metric'
            ? `${num(p.kph)}<small>${t('unit.kph')}</small>`
            : `${num(lenOfKm(p.kph))}<small>${t('unit.mph')}</small>`),
            covBadge(p.kphCov),
            // Averaged along the road, so a route signed at 100 for most of its
            // length and 110 for the rest reads 104 - a number no sign shows.
            // Too long for the tile, so it is the tile's tooltip instead.
            [t('ca.speedAvg'),
              p.kphCov != null && p.kphCov < 98 ? t('ca.coverage', { pct: num(p.kphCov) }) : '',
            ].filter(Boolean).join(' '))}`
          // TIGER carries no lane attribute, so the American lane count is the
          // states' own, and says what share of the road it was counted over.
          // Posted speeds are reported far more patchily, so they sit in the
          // measured block below rather than in a tile this size.
          : `${metric('dt.tolled', `${num(p.toll, p.toll % 1 ? 1 : 0)}<small>%</small>`)}
             ${metric('hp.lanes', p.hpms?.lanes ? num(p.hpms.lanes.v, p.hpms.lanes.v % 1 ? 1 : 0) : null,
            covBadge(p.hpms?.lanes?.cover),
            p.hpms?.lanes && p.hpms.lanes.cover < 98 ? t('ca.coverage', { pct: num(p.hpms.lanes.cover) }) : null)}`}`}
      </div>

      ${p.unsigned ? `<div class="figs ca-facts">
        <div class="fig"><span class="fig-k">${t('dt.unsigned')}</span>
        <span class="fig-v">${t('dt.unsignedWhy')}</span></div></div>` : ''}
      ${p.nameOnly ? `<div class="figs ca-facts">
        <div class="fig"><span class="fig-k">${t('dt.nameOnly')}</span>
        <span class="fig-v">${t('dt.nameOnlyWhy')}</span></div></div>` : ''}
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

  // How much of a mountain road is bridge or tunnel is the short account of
  // what building it took, and OpenStreetMap tags both along the whole route.
  const structFigure = osm && (osm[2] || osm[3]) ? figuresBlock([{
    label: { en: 'On bridges and in tunnels', zh: '桥隧比' },
    value: {
      en: `${num(osm[2], 1)}% of the route is bridge and ${num(osm[3], 1)}% is tunnel`,
      zh: `桥梁约占全线 ${num(osm[2], 1)}%，隧道约占 ${num(osm[3], 1)}%`,
    },
    source: 'OpenStreetMap, bridge and tunnel tags on the ways the route follows',
  }]) : '';

  const written = new Map((dossier?.sections || []).map((s) => [s.key, s]));
  let first = true;
  // Where nothing is written about a road's character, what its source says it
  // runs along is the start of one, and it is not a measurement.
  const roads = p.cc === 'mx' || ca ? '' : roadsBlock(p, [title, names?.main, names?.other, names?.full, ...aka].filter(Boolean), hk);
  for (const key of SECTION_ORDER) {
    const s = written.get(key);
    if (!s && !(key === 'money' && costFigure) && !(key === 'character' && roads)
      && !(key === 'engineering' && structFigure)) continue;
    let body = s ? prose(s[getLang()] || s.en) : '';
    if (key === 'character') body += roads;
    if (key === 'engineering') body += structFigure;
    if (key === 'money') body += figuresBlock(dossier?.figures) + costFigure;
    if (key === 'traffic' && dossier?.trafficFigures) body += figuresBlock(dossier.trafficFigures);
    if (key === 'condition' && dossier?.conditionFigures) body += figuresBlock(dossier.conditionFigures);
    parts.push(section(key, body, first));
    first = false;
  }
  const hasHistory = meta.st === 'QC' || p.sys in SYSTEM_HISTORY;
  parts.push(section('chrono', hasHistory ? '<div id="dtChron"></div>' : chronoBlock(dossier, dossier?.timeline || [])));
  parts.push(section('speed', '<div id="dtSpeed"></div>'));

  if (!dossier) {
    parts.push(`<div style="padding:14px 16px 0">
      <div class="note"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6v.1"/></svg>
      <span>${t('note.noDossier')}</span></div></div>`);
  }

  // The tiles above carry the headline figures; the full measured breakdown
  // is long enough to push everything else off the panel, so it waits behind
  // its heading.
  parts.push(section('measured', [
    hpmsFacts(p), provincialTraffic(p), mexicanTraffic(p), taiwanTraffic(p), hongKongTraffic(hk, hkData?.census),
    caFacts(p), mxFacts(p), caInventory(p),
  ].join('').trim()));
  parts.push(section('composition', compositionBlock(types), !dossier));
  // Hong Kong is one jurisdiction, so a breakdown by it says nothing.
  if (p.cc !== 'hk') {
    parts.push(section(p.cc === 'tw' ? 'countiesList' : p.cc === 'cn' ? 'provincesList' : 'statesList', statesBlock(states, p.cc === 'cn')));
  }
  parts.push(section('tolls', '<div id="dtTolls"></div>'));
  parts.push(section('served', '<div id="dtServed"></div>'));
  parts.push(section('elevation', '<div id="dtElev"></div>'));

  // Where the two lengths disagree the reason is usually structural rather
  // than an error, so name the likely cause instead of leaving a bare gap.
  // An official figure for a road the atlas splits in pieces is compared with
  // the pieces it covers, not with this one.
  const covered = dossier?.coveredMi != null ? dossier
    : heroKind !== 'Official' && plan.pieces > 1 ? { coveredMi: plan.drawnMi, officialCovers: { length: plan.pieces } } : null;
  const measuredMi = covered?.coveredMi ?? p.mi;
  const delta = officialMi ? Math.round(measuredMi - officialMi) : 0;
  const lengthRows = officialMi ? `<div class="figs" style="margin-top:11px">
    <div class="fig"><span class="fig-k">${t(OFFICIAL_KEYS[heroKind][2])}</span>
      <span class="fig-v"><b>${num(lenOf(officialMi))}</b> ${lenUnit()}
      ${officialSrc ? `<span class="src">${esc(officialSrc)}</span>` : ''}</span></div>
    <div class="fig"><span class="fig-k">${t('len.measured')}</span>
      <span class="fig-v"><b>${num(lenOf(measuredMi))}</b> ${lenUnit()}
      <span class="src">${covered ? t('len.measuredCovers', { n: covered.officialCovers.length }) : t('len.measuredSrc')}</span></span></div>
    ${Math.abs(delta) >= Math.max(3, officialMi * 0.02) ? `<div class="fig">
      <span class="fig-k">${t('len.delta')}</span>
      <span class="fig-v">${delta > 0 ? '+' : ''}<b>${num(lenOf(delta))}</b> ${lenUnit()}
      <span class="src">${t(heroKind !== 'Official' ? 'cn.deltaWhy'
    : p.offSrc === 'thb' && !dossier?.officialMi ? 'tw.deltaWhy' : 'len.deltaWhy')}</span></span></div>` : ''}
  </div>` : '';

  // Every page says where its numbers came from, and for a Canadian route
  // that is a different survey with different attributes - including one it
  // does not have, which is worth saying out loud so a reader does not read
  // the absent toll share as a road with no tolls on it.
  const info = (key) => `<div class="note">
    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6v.1"/></svg>
    <span>${t(key)}</span></div>`;
  parts.push(section('data',
    info({ ca: 'ca.note.derived', mx: 'mx.note.derived', tw: 'ea.note.tw', hk: 'ea.note.hk', cn: 'cn.note' }[p.cc] ?? 'note.derived')
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
  document.getElementById('dtZoom').addEventListener('click', () => f && fitTo(f));

  loadSpeed().then((d) => {
    const slot = document.getElementById('dtSpeed');
    if (!slot || app.selected !== id) return;
    if (!d) { slot.closest('.sect')?.remove(); return; }
    slot.innerHTML = speedBlock(d, id, p);
  });

  if (hasHistory) {
    historyEvents(id, p.sys).then((opened) => {
      const slot = document.getElementById('dtChron');
      if (!slot || app.selected !== id) return;
      const seen = new Set();
      const events = [...(dossier?.timeline || []), ...opened]
        .filter((e) => !seen.has(`${e.year}|${e.en}`) && seen.add(`${e.year}|${e.en}`))
        .sort((a, b) => a.year - b.year);
      const html = chronoBlock(dossier, events);
      if (!html) { slot.closest('.sect')?.remove(); return; }
      slot.innerHTML = html;
    });
  }

  elevationFor(id).then((profile) => {
    const slot = document.getElementById('dtElev');
    if (slot && app.selected === id) slot.innerHTML = elevationBlock(profile);
  });

  tollSection(id).then((html) => {
    const slot = document.getElementById('dtTolls');
    if (!slot || app.selected !== id) return;
    if (!html) { slot.closest('.sect')?.remove(); return; }
    slot.innerHTML = html;
  });

  (p.cc === 'cn' ? townsFor(id).then((c) => [c, 'served.srcOsm']) : servedFor(id).then((c) => [c, 'served.src'])).then(([listed, src]) => {
    const slot = document.getElementById('dtServed');
    if (!slot || app.selected !== id) return;
    const sect = slot.closest('.sect');
    // Taiwan's register lists the districts a provincial highway passes, the
    // nearest thing it has to the Route Log's list of towns served.
    const cities = listed?.length ? listed : p.reg?.places ?? null;
    if (!cities?.length) { sect?.remove(); return; }
    slot.innerHTML = servedBlock(cities, listed?.length ? src : 'served.srcThb');
    sect.querySelector('h3').textContent = `${t('sect.served')} · ${cities.length}`;
  });
}
