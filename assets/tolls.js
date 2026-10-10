/* Toll facilities: a layer over the map and a section in the route panel.

   Canada has no register of its toll facilities, so the seven here were
   assembled one by one from the documents that govern each - a concession
   agreement, a provincial regulation, federal briefing notes, the operators'
   own tariff pages - and every fact carries the document it came from. A fare
   is shown only with the date it took effect.

   Mexico's toll plazas are on the map as the RNC places them: where a toll
   is paid, not where a tolled road begins or ends. Its concession titles are
   in the route panel and not on the map,
   because nothing published says where on the ground a concession begins and
   ends. A grant date is not an opening date: for a title to build, it is the
   earliest the road could have opened, and it is worded that way. */

import { t, getLang, num, distKm, routeLabel } from './i18n.js';
import { app, toast, select } from './app.js';

const SRC = 'toll';
const LINE_HIT = `${SRC}-line-hit`;
const PT_HIT = `${SRC}-pt-hit`;
const LAYERS = [`${SRC}-line-casing`, SRC, `${SRC}-plaza`, `${SRC}-pt`, LINE_HIT, PT_HIT];
const COLOUR = '#ffd166';

let on = false;
let dataPromise = null;
let data = null;
let popup = null;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
const pick = (o) => (o == null ? '' : typeof o === 'string' ? o : o[getLang()] ?? o.en ?? '');

function load() {
  dataPromise ||= fetch('data/tolls.json').then((r) => (r.ok ? r.json() : null)).catch(() => null)
    .then((d) => { data = d; return d; });
  return dataPromise;
}

/** True when a toll facility is under the pointer, so a route beneath it leaves the click alone. */
export function tollAt(point) {
  const map = app.map;
  if (!on || !map.getLayer(PT_HIT)) return false;
  return map.queryRenderedFeatures(point, { layers: [LINE_HIT, PT_HIT] }).length > 0;
}

export function raiseTolls() {
  const map = app.map;
  for (const id of LAYERS) if (map?.getLayer(id)) map.moveLayer(id);
}

async function ensureLayers() {
  const map = app.map;
  if (map.getSource(SRC)) return;
  await load();
  map.addSource(SRC, { type: 'geojson', data, promoteId: 'id' });
  const line = ['==', ['geometry-type'], 'LineString'];
  const plaza = ['==', ['get', 'kind'], 'plaza'];
  const point = ['all', ['==', ['geometry-type'], 'Point'], ['!', plaza]];
  map.addLayer({
    id: `${SRC}-line-casing`, type: 'line', source: SRC, filter: line,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#05070c', 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 5, 10, 11], 'line-opacity': 0.9 },
  });
  map.addLayer({
    id: SRC, type: 'line', source: SRC, filter: line,
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: {
      'line-color': COLOUR,
      'line-width': ['interpolate', ['linear'], ['zoom'], 4, 2.6, 10, 6],
      'line-dasharray': [2, 1.2],
    },
  });
  // Thirteen hundred plazas would bury the map at continental zoom, so they
  // come in once a region fills the screen.
  map.addLayer({
    id: `${SRC}-plaza`, type: 'circle', source: SRC, filter: plaza, minzoom: 5,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 1.8, 10, 4.5],
      'circle-color': COLOUR,
      'circle-stroke-color': '#05070c',
      'circle-stroke-width': 1,
    },
  });
  map.addLayer({
    id: `${SRC}-pt`, type: 'circle', source: SRC, filter: point,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 4, 10, 8],
      'circle-color': '#05070c',
      'circle-stroke-color': COLOUR,
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 4, 2, 10, 3],
    },
  });
  map.addLayer({ id: LINE_HIT, type: 'line', source: SRC, filter: line, paint: { 'line-width': 16, 'line-opacity': 0 } });
  map.addLayer({
    id: PT_HIT, type: 'circle', source: SRC, filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-radius': ['case', plaza, 7, 12], 'circle-opacity': 0 },
  });
  for (const id of [LINE_HIT, PT_HIT]) {
    map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
    map.on('click', id, (e) => {
      const f = e.features?.[0];
      if (!f) return;
      if (f.properties.kind === 'plaza') openPlazaPopup(f.properties, e.lngLat);
      else openTollPopup(f.properties.id, e.lngLat);
    });
  }
}

export async function toggleTolls(force) {
  const next = force ?? !on;
  if (next) await ensureLayers();
  if (next && !data) { toast(t('toll.unavailable')); return; }
  on = next;
  for (const id of LAYERS) {
    if (app.map.getLayer(id)) app.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }
  if (!on) closeTollPopup();
  document.getElementById('btnTolls').classList.toggle('on', on);
  const plazas = data.features.filter((f) => f.properties.kind === 'plaza').length;
  toast(on ? t('toast.tollOn', { n: Object.keys(data.facilities).length, p: num(plazas) }) : t('toast.tollOff'));
}

export function closeTollPopup() {
  popup?.remove();
  popup = null;
}

/* ── shared formatting ─────────────────────────────────────────────────── */

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "1997", "1 August 2025" or "2025年8月1日", from a year or an ISO date. */
export function dateText(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!m) return String(y);
  if (getLang() === 'zh') return `${y}年${m}月${d}日`;
  return `${d} ${MONTHS_EN[m - 1]} ${y}`;
}

function money(amount, currency) {
  return t('toll.money', { amount: num(amount, 2), currency: t(`toll.cur.${currency}`) });
}

function src(source, url) {
  return url
    ? `<a class="tl-src" href="${esc(url)}" target="_blank" rel="noopener">${esc(source)}</a>`
    : `<span class="tl-src">${esc(source)}</span>`;
}

function fareRows(fares) {
  return fares.map((f) => `<li class="tl-fare">
      <b>${esc(money(f.amount, f.currency))}</b>
      <span>${esc(t(f.since ? 'toll.fare.since' : 'toll.fare.from', { date: dateText(f.from) }))}</span>
      ${f.note ? `<em>${esc(pick(f.note))}</em>` : ''}
      ${src(f.source, f.url)}
    </li>`).join('');
}

function factRows(facts) {
  return facts.map((f) => `<li>${esc(pick(f))} ${src(f.source, f.url)}</li>`).join('');
}

/** The full account of one Canadian facility, for the popup and the route panel alike. */
function facilityBody(id, { routes = true } = {}) {
  const f = data.facilities[id];
  const rows = [];
  rows.push(`<div class="tl-op">${esc(pick(f.operator))}</div>`);
  if (f.lengthKm) {
    rows.push(`<div class="tl-meta">${esc(t('toll.length', { d: distKm(f.lengthKm.value, 1) }))} ${src(f.lengthKm.source, f.lengthKm.url)}</div>`);
  }
  if (f.opened) {
    rows.push(`<div class="tl-meta">${esc(t('toll.opened', { date: dateText(f.opened.date) }))} ${src(f.opened.source, f.opened.url)}</div>`);
  }
  if (f.fares.length) rows.push(`<div class="tl-h">${esc(t('toll.fares'))}</div><ul class="tl-list">${fareRows(f.fares)}</ul>`);
  else if (f.fareNote) rows.push(`<div class="tl-h">${esc(t('toll.fares'))}</div><div class="tl-meta">${esc(pick(f.fareNote))}</div>`);
  const facts = [...f.facts, ...(f.fbcl ? [f.fbcl] : [])];
  if (facts.length) rows.push(`<ul class="tl-list tl-facts">${factRows(facts)}</ul>`);
  rows.push(`<div class="tl-f">${esc(drawnNote(f))}</div>`);
  if (routes) {
    const on = Object.entries(data.byRoute).filter(([, v]) => v.some((e) => e.facility === id)).map(([r]) => r);
    if (on.length) {
      rows.push(`<div class="tl-h">${esc(t('toll.routes'))}</div>${on.map((r) => {
        const meta = app.byId.get(r);
        return meta ? `<button class="xg-r" type="button" data-id="${esc(r)}"><b>${esc(routeLabel(meta.label))}</b><span>${esc(meta.where ?? '')}</span><em></em></button>` : '';
      }).join('')}`);
    }
  }
  return rows.join('');
}

function drawnNote(f) {
  const d = f.drawn;
  if (!d) return t('toll.drawn.none');
  if (d.by === 'extent') return t('toll.drawn.extent', { d: distKm(d.km, 1) });
  if (d.by === 'crossing') return t('toll.drawn.crossing');
  return t('toll.drawn.routeEnd');
}

function openTollPopup(id, lngLat) {
  const f = data.facilities[id];
  if (!f) return;
  closeTollPopup();
  const p = new maplibregl.Popup({ className: 'xg-pop tl-pop', maxWidth: '340px', offset: 10 })
    .setLngLat(lngLat)
    .setHTML(`<div class="xg">
      <div class="xg-k" style="--c:${COLOUR}">${esc(t(`toll.kind.${f.kind}`))}</div>
      <div class="xg-n">${esc(pick(f.name))}</div>
      ${facilityBody(id)}
    </div>`)
    .addTo(app.map);
  p.getElement().addEventListener('click', (e) => {
    const b = e.target.closest('.xg-r');
    if (b) select(b.dataset.id);
  });
  p.on('close', () => { if (popup === p) popup = null; });
  popup = p;
}

/** A Mexican toll plaza, from the RNC's own record of it. */
function openPlazaPopup(p, lngLat) {
  closeTollPopup();
  const s = data.sources.mxPlazas;
  const rows = [];
  if (p.admin) rows.push(`<div class="tl-op">${esc(t(`toll.plaza.admin.${p.admin}`))}</div>`);
  if (p.section) rows.push(`<div class="tl-meta" lang="es">${esc(p.section)}${p.subsection ? ` · ${esc(p.subsection)}` : ''}</div>`);
  if (p.mode) rows.push(`<div class="tl-meta">${esc(t(`toll.plaza.mode.${p.mode}`))}${p.dir ? ` · ${esc(t(`toll.plaza.dir.${p.dir}`))}` : ''}</div>`);
  if (p.place && p.place !== 'Definida') rows.push(`<div class="tl-f">${esc(t(`toll.plaza.place.${p.place}`))}</div>`);
  rows.push(`<div class="tl-f">${src(s.title, s.url)} · ${esc(t('toll.plaza.updated', { date: dateText(s.updated) }))}</div>`);
  const pop = new maplibregl.Popup({ className: 'xg-pop tl-pop', maxWidth: '320px', offset: 8 })
    .setLngLat(lngLat)
    .setHTML(`<div class="xg">
      <div class="xg-k" style="--c:${COLOUR}">${esc(t('toll.kind.plaza'))}</div>
      <div class="xg-n" lang="es">${esc(p.name ?? '')}</div>
      ${rows.join('')}
    </div>`)
    .addTo(app.map);
  pop.on('close', () => { if (popup === pop) popup = null; });
  popup = pop;
}

/* ── the route panel ───────────────────────────────────────────────────── */

function titleBody(n, sictNames) {
  const x = data.titles[n];
  const via = sictNames?.length
    ? `<div class="tl-f">${esc(t('toll.mx.byName', { names: sictNames.map((s) => `“${s}”`).join(', ') }))} ${src(data.sources.mxNames.title, data.sources.mxNames.url)}</div>`
    : '';
  const ended = x.ends && x.ends < new Date().toISOString().slice(0, 10);
  return `<div class="tl-item">
    <div class="tl-obj" lang="es">“${esc(x.object)}”</div>
    <div class="tl-op">${esc(x.concessionaire)}</div>
    <div class="tl-meta">${esc(t('toll.mx.granted', { date: dateText(x.granted) }))}${x.ends
      ? ` · ${esc(t(ended ? 'toll.mx.ended' : 'toll.mx.ends', { date: dateText(x.ends) }))}` : ''}</div>
    ${x.builds && x.granted ? `<div class="tl-meta">${esc(t('toll.mx.bound', { date: dateText(x.granted) }))}</div>` : ''}
    ${via}
    <div class="tl-f">${src(t('toll.mx.src'), x.document || data.sources.mx.url)}</div>
  </div>`;
}

/** The toll section's body for a route, or '' when there is nothing to say. */
export async function tollSection(routeId) {
  const d = await load();
  const entries = d?.byRoute[routeId];
  if (!entries?.length) return '';
  const parts = [];
  for (const e of entries) {
    if (e.facility) {
      const f = d.facilities[e.facility];
      parts.push(`<div class="tl-item">
        <div class="tl-name"><b>${esc(pick(f.name))}</b><span>${esc(t(e.on ? 'toll.rel.on' : 'toll.rel.onto'))}</span></div>
        ${facilityBody(e.facility, { routes: false })}
      </div>`);
    }
  }
  const titles = entries.filter((e) => e.title);
  if (titles.length) {
    parts.push(`<p class="srcline">${esc(t('toll.mx.intro'))}</p>`);
    for (const e of titles) parts.push(titleBody(e.title, e.sictNames));
  }
  return `<div class="tl-sect">${parts.join('')}</div>`;
}
