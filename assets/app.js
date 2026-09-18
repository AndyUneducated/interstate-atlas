/* Highway Atlas — map surface, route selection, search.
   Detail panel, overlay sheets and the flythrough live in their own modules. */

import {
  t, setLang, getLang, stateName, miles, isProvince, jurisdictionNames, routeLabel,
  ownerLabel,
} from './i18n.js';
import { renderDetail } from './detail.js';
import { openSheet, closeSheet, isSheetOpen, refreshPlannerIfOpen } from './sheets.js';
import { startFly, stopFly, isFlying } from './fly.js';
import { openTimelapse } from './timelapse.js';

/**
 * The six route systems, grouped by country.
 *
 * Three American, three Canadian, and the two sets are not translations of
 * each other: Canada has no signed national system, so its tiers are
 * designations rather than shields. `perJuris` marks the two tiers too large
 * to draw at once - 6,750 state routes and several thousand provincial ones -
 * which load a jurisdiction at a time from their own directory.
 */
const SYSTEMS = [
  { id: 'interstate', code: 'i', cc: 'us', colour: '#35e7ff', src: 'data/geo/interstate.json', on: true },
  { id: 'us', code: 'u', cc: 'us', colour: '#ffb545', src: 'data/geo/us.json', on: false },
  { id: 'state', code: 's', cc: 'us', colour: '#a98bff', src: null, dir: 'state', perJuris: true, on: false },
  { id: 'tch', code: 't', cc: 'ca', colour: '#ff4d6d', src: 'data/geo/tch.json', on: true },
  { id: 'nhs', code: 'n', cc: 'ca', colour: '#4fe3b0', src: 'data/geo/nhs.json', on: false },
  { id: 'provincial', code: 'r', cc: 'ca', colour: '#ff9ecb', src: null, dir: 'provincial', perJuris: true, on: false },
];

const SYS_BY_CODE = Object.fromEntries(SYSTEMS.map((s) => [s.code, s.id]));
const PER_JURIS = new Set(SYSTEMS.filter((s) => s.perJuris).map((s) => s.id));

/** True for the tiers that ship one file per state or province. */
function isPerJuris(sys) { return PER_JURIS.has(sys); }

export const app = {
  map: null,
  index: [],
  byId: new Map(),
  stats: null,
  dossiers: new Map(),
  loaded: new Set(),
  systems: new Map(SYSTEMS.map((s) => [s.id, { ...s }])),
  selected: null,
  selectedFeature: null,
  stateLoaded: new Set(),
  trip: [],
  terrain: false,
  basemap: 'dark',
};

/* ── boot ─────────────────────────────────────────────────────────────── */

const bootBar = document.getElementById('bootBar');
const bootStep = document.getElementById('bootStep');
let bootPct = 0;

function boot(pct, stepKey) {
  bootPct = Math.max(bootPct, pct);
  bootBar.style.transform = `scaleX(${bootPct / 100})`;
  if (stepKey) bootStep.textContent = t(stepKey);
}

/* ── i18n plumbing ────────────────────────────────────────────────────── */

function applyStaticStrings() {
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  // Icon-only controls carry their label in the tooltip, which still has to
  // follow the language.
  for (const el of document.querySelectorAll('[data-i18n-title]')) {
    const label = t(el.dataset.i18nTitle);
    el.title = label;
    el.setAttribute('aria-label', label);
  }
  document.getElementById('q').placeholder = t('search.placeholder');
  document.getElementById('palQ').placeholder = t('pal.placeholder');
  document.getElementById('btnLang').title = t('nav.langTitle');
  document.getElementById('bootTitle').textContent = t('boot.title');
  document.getElementById('bootSub').textContent = t('boot.sub');
  document.title = getLang() === 'zh'
    ? '北美公路图谱 — 北美国家公路网'
    : 'Highway Atlas — the highway network of North America';
}

export function relabel() {
  applyStaticStrings();
  renderSystems();
  renderJumps();
  renderResults();
  if (app.selected) renderDetail(app.selected);
  if (isSheetOpen()) openSheet(isSheetOpen());
  renderMapLabels();
}

/* ── data ─────────────────────────────────────────────────────────────── */

async function loadIndex() {
  const res = await fetch('data/index.json');
  const raw = await res.json();
  const tierOf = { p: 'primary', a: 'auxiliary', x: 'special', s: 'state' };
  app.index = raw.routes.map(([id, label, sys, tier, st, mi, base, num, cx, cy, gs, ns, where]) => ({
    id, label, sys: SYS_BY_CODE[sys], tier: tierOf[tier], st, mi, base, num, cx, cy, gs, ns, where,
    // Pre-lowered haystack so keystroke filtering stays cheap across 11,000
    // rows. The jurisdiction's full name is in it too, so "ontario" and
    // "saskatchewan" find their routes without the user knowing the code. So
    // is the place a shared number is told apart by, so "ON 21 Goderich" picks
    // the right one out of the twenty-two Ontario roads numbered 21.
    hay: `${label} ${num} ${st} ${jurisdictionNames(st)} ${where || ''}`.toLowerCase(),
  }));
  for (const r of app.index) app.byId.set(r.id, r);
  app.generated = raw.generated;
}

async function loadStats() {
  app.stats = await (await fetch('data/stats.json')).json();
}

// Only a couple of hundred of the 7,500 routes have a written dossier, so the
// manifest is consulted first. Asking for the file and catching the 404 would
// work too, but it would fill the console with failures on every other route.
let dossierList = null;
function dossierIndex() {
  dossierList ||= fetch('data/dossiers/index.json')
    .then((r) => (r.ok ? r.json() : { ids: [] }))
    .then((d) => new Set(d.ids))
    .catch(() => new Set());
  return dossierList;
}

export async function loadDossier(id) {
  if (app.dossiers.has(id)) return app.dossiers.get(id);
  const have = await dossierIndex();
  if (!have.has(id)) {
    app.dossiers.set(id, null);
    return null;
  }
  try {
    const d = await (await fetch(`data/dossiers/${id}.json`)).json();
    app.dossiers.set(id, d);
    return d;
  } catch {
    app.dossiers.set(id, null);
    return null;
  }
}

/** Ids with written detail, for badging search results. */
export async function dossierIds() { return dossierIndex(); }

/* ── map ──────────────────────────────────────────────────────────────── */

// The frame the atlas opens on. Wide enough to hold the lower 48 and the
// Canadian corridor where the network actually is, and it is a promise the
// region jumps then keep: what is off this edge is reachable, not missing.
const HOME_BOUNDS = [[-126.5, 25.2], [-58.5, 55.5]];

function buildMap() {
  const map = new maplibregl.Map({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/dark',
    bounds: HOME_BOUNDS,
    fitBoundsOptions: { padding: { top: 90, bottom: 60, left: 400, right: 80 } },
    maxZoom: 15,
    minZoom: 2.4,
    attributionControl: { compact: true },
    dragRotate: true,
    pitchWithRotate: true,
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-right');
  app.map = map;
  // Handles for the headless checks in tools/verify.mjs.
  window.__map = map;
  window.__select = select;
  return map;
}

// Route colour by system, with the selected route pushed to near-white so it
// reads against its own glow.
function lineColour(sys) {
  return app.systems.get(sys).colour;
}

/**
 * Line width by zoom and route tier.
 *
 * MapLibre allows only one zoom-driven interpolate per expression, and it has
 * to sit at the top. So the zoom curve is the outer expression and the tier
 * choice happens inside each stop, rather than the other way round. `mult`
 * scales the whole curve for the glow copy underneath.
 */
function tierWidth(mult = 1) {
  const at = (primary, auxiliary, other) => [
    'case',
    ['==', ['get', 'tier'], 'primary'], primary * mult,
    ['==', ['get', 'tier'], 'auxiliary'], auxiliary * mult,
    other * mult,
  ];
  return [
    'interpolate', ['linear'], ['zoom'],
    3, at(1.15, 0.55, 0.4),
    6, at(2.1, 1.2, 0.9),
    10, at(4.2, 2.8, 2.2),
  ];
}

function addSystemLayers(sys, data) {
  const map = app.map;
  const colour = lineColour(sys);
  const srcId = `rt-${sys}`;
  if (map.getSource(srcId)) {
    map.getSource(srcId).setData(data);
    return;
  }
  map.addSource(srcId, { type: 'geojson', data, promoteId: 'id' });

  // A wide, faint copy under the line reads as glow without a blur filter.
  map.addLayer({
    id: `${srcId}-glow`,
    type: 'line',
    source: srcId,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': colour,
      'line-width': tierWidth(4.5),
      'line-opacity': ['case', ['==', ['get', 'tier'], 'primary'], 0.16, 0.08],
      'line-blur': 7,
    },
  });

  map.addLayer({
    id: srcId,
    type: 'line',
    source: srcId,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': colour,
      'line-width': tierWidth(),
      'line-opacity': ['case', ['==', ['get', 'tier'], 'primary'], 0.95, 0.68],
    },
  });

  // Invisible fat line so thin routes are still easy to click.
  map.addLayer({
    id: `${srcId}-hit`,
    type: 'line',
    source: srcId,
    paint: { 'line-color': colour, 'line-opacity': 0, 'line-width': 14 },
  });

  map.addLayer({
    id: `${srcId}-label`,
    type: 'symbol',
    source: srcId,
    minzoom: isPerJuris(sys) ? 7.5 : 5,
    layout: {
      'symbol-placement': 'line',
      'text-field': ['get', 'label'],
      'text-font': ['Noto Sans Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 5, 9.5, 10, 12.5],
      'text-letter-spacing': 0.08,
      'symbol-spacing': 320,
      'text-max-angle': 32,
      'text-padding': 4,
    },
    paint: {
      'text-color': colour,
      'text-halo-color': '#05070c',
      'text-halo-width': 1.7,
      'text-opacity': 0.9,
    },
  });

  for (const id of [`${srcId}-hit`, srcId]) {
    map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
  }
  map.on('click', `${srcId}-hit`, (e) => {
    const f = e.features?.[0];
    if (f) select(f.properties.id, { feature: f, fit: false });
  });
}

export async function enableSystem(sys) {
  const s = app.systems.get(sys);
  s.on = true;
  if (isPerJuris(sys)) {
    renderSystems();
    return;
  }
  if (!app.loaded.has(sys)) {
    const data = await (await fetch(s.src)).json();
    app.loaded.add(sys);
    addSystemLayers(sys, data);
  }
  setSystemVisible(sys, true);
  renderSystems();
  renderResults();
}

function setSystemVisible(sys, on) {
  const map = app.map;
  for (const suffix of ['', '-glow', '-hit', '-label']) {
    const id = `rt-${sys}${suffix}`;
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }
}

function disableSystem(sys) {
  app.systems.get(sys).on = false;
  const def = SYSTEMS.find((s) => s.id === sys);
  if (def?.perJuris) {
    for (const st of app.stateLoaded) {
      if (systemOfJurisdiction(st) === sys) setStateVisible(st, false);
    }
  } else {
    setSystemVisible(sys, false);
  }
  renderSystems();
  renderResults();
}

/* The two numbered-by-jurisdiction tiers - American state routes and Canadian
   provincial highways - are far too large to ship as one file each, so they
   load a jurisdiction at a time. State and province codes do not collide, so
   one registry covers both; only the folder and the owning system differ. */

function systemOfJurisdiction(code) { return isProvince(code) ? 'provincial' : 'state'; }

export async function loadState(st) {
  if (app.stateLoaded.has(st)) { setStateVisible(st, true); return; }
  const sys = systemOfJurisdiction(st);
  toast(t('toast.loadingState', { state: stateName(st) }));
  const dir = SYSTEMS.find((s) => s.id === sys).dir;
  const data = await (await fetch(`data/geo/${dir}/${st}.json`)).json();
  app.stateLoaded.add(st);
  addStateLayers(st, data, sys);
  app.systems.get(sys).on = true;
  renderSystems();
  renderResults();
}

function addStateLayers(st, data, sys = 'state') {
  const map = app.map;
  const srcId = `st-${st}`;
  const colour = lineColour(sys);
  map.addSource(srcId, { type: 'geojson', data, promoteId: 'id' });
  const width = (m) => ['interpolate', ['linear'], ['zoom'], 4, 0.35 * m, 7, 0.9 * m, 11, 2.4 * m];
  // State routes sit beneath the national systems so those stay legible.
  const under = map.getLayer('rt-interstate-glow') ? 'rt-interstate-glow' : undefined;
  map.addLayer({
    id: `${srcId}-glow`, type: 'line', source: srcId,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': colour, 'line-width': width(4), 'line-opacity': 0.07, 'line-blur': 6 },
  }, under);
  map.addLayer({
    id: srcId, type: 'line', source: srcId,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': colour, 'line-width': width(1), 'line-opacity': 0.62 },
  }, under);
  map.addLayer({
    id: `${srcId}-hit`, type: 'line', source: srcId,
    paint: { 'line-color': colour, 'line-opacity': 0, 'line-width': 12 },
  });
  map.addLayer({
    id: `${srcId}-label`, type: 'symbol', source: srcId, minzoom: 7.5,
    layout: {
      'symbol-placement': 'line', 'text-field': ['get', 'label'],
      'text-font': ['Noto Sans Regular'], 'text-size': 10,
      'symbol-spacing': 280, 'text-max-angle': 32,
    },
    paint: { 'text-color': colour, 'text-halo-color': '#05070c', 'text-halo-width': 1.6, 'text-opacity': 0.85 },
  });
  map.on('mouseenter', `${srcId}-hit`, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', `${srcId}-hit`, () => { map.getCanvas().style.cursor = ''; });
  map.on('click', `${srcId}-hit`, (e) => {
    const f = e.features?.[0];
    if (f) select(f.properties.id, { feature: f, fit: false });
  });
}

function setStateVisible(st, on) {
  for (const suffix of ['', '-glow', '-hit', '-label']) {
    const id = `st-${st}${suffix}`;
    if (app.map.getLayer(id)) app.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }
}

function renderMapLabels() {
  // Basemap place labels follow the interface language where the tiles carry a
  // localised name; OpenMapTiles exposes name:zh and name:en.
  const map = app.map;
  if (!map || !map.isStyleLoaded()) return;
  const field = getLang() === 'zh'
    ? ['coalesce', ['get', 'name:zh'], ['get', 'name:zh-Hans'], ['get', 'name']]
    : ['coalesce', ['get', 'name:en'], ['get', 'name']];
  for (const layer of map.getStyle().layers) {
    if (layer.type !== 'symbol') continue;
    if (layer.id.startsWith('rt-') || layer.id.startsWith('st-')) continue;
    try {
      if (map.getLayoutProperty(layer.id, 'text-field') !== undefined) {
        map.setLayoutProperty(layer.id, 'text-field', field);
      }
    } catch { /* layer has no text-field */ }
  }
}

/* ── selection and highlight ──────────────────────────────────────────── */

const SEL_SRC = 'sel';
const TERM_SRC = 'term';

function ensureSelectionLayers() {
  const map = app.map;
  if (map.getSource(SEL_SRC)) return;
  const empty = { type: 'FeatureCollection', features: [] };

  map.addSource(SEL_SRC, { type: 'geojson', data: empty });
  map.addLayer({
    id: 'sel-glow', type: 'line', source: SEL_SRC,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#eafcff',
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 9, 10, 22],
      'line-opacity': 0.2, 'line-blur': 12,
    },
  });
  map.addLayer({
    id: 'sel-base', type: 'line', source: SEL_SRC,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#ffffff',
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 2.1, 10, 5.4],
      'line-opacity': 0.95,
    },
  });
  // Flowing dashes along the selected route; the offset is animated below.
  map.addLayer({
    id: 'sel-flow', type: 'line', source: SEL_SRC,
    layout: { 'line-cap': 'butt' },
    paint: {
      'line-color': '#35e7ff',
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 3.4, 10, 8],
      'line-opacity': 0.85,
      'line-dasharray': [0, 2.6, 1.4],
    },
  });

  map.addSource(TERM_SRC, { type: 'geojson', data: empty });
  map.addLayer({
    id: 'term-halo', type: 'circle', source: TERM_SRC,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 9, 10, 17],
      'circle-color': ['get', 'colour'], 'circle-opacity': 0.16,
      'circle-blur': 0.65,
    },
  });
  map.addLayer({
    id: 'term-dot', type: 'circle', source: TERM_SRC,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 4.2, 10, 6.4],
      'circle-color': '#05070c',
      'circle-stroke-color': ['get', 'colour'],
      'circle-stroke-width': 2.4,
    },
  });
  map.addLayer({
    id: 'term-label', type: 'symbol', source: TERM_SRC,
    layout: {
      'text-field': ['get', 'tag'], 'text-font': ['Noto Sans Regular'],
      'text-size': 10.5, 'text-offset': [0, -1.55], 'text-anchor': 'bottom',
      'text-letter-spacing': 0.16, 'text-allow-overlap': true,
    },
    paint: {
      'text-color': ['get', 'colour'], 'text-halo-color': '#05070c', 'text-halo-width': 2,
    },
  });
}

let flowRaf = null;
const DASH_CYCLE = [
  [0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5],
  [3, 4, 0], [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2],
  [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5],
];

function animateFlow() {
  let i = 0;
  let last = 0;
  const step = (ts) => {
    if (ts - last > 55) {
      last = ts;
      i = (i + 1) % DASH_CYCLE.length;
      if (app.map.getLayer('sel-flow')) {
        app.map.setPaintProperty('sel-flow', 'line-dasharray', DASH_CYCLE[i]);
      }
    }
    flowRaf = requestAnimationFrame(step);
  };
  flowRaf = requestAnimationFrame(step);
}

// The route as loaded, not as drawn.
//
// Anything the map hands back — from a click or from querySourceFeatures — is a
// tile feature: clipped to the tile it came from, split into one LineString per
// line, and with nested properties flattened to JSON strings. That is enough to
// identify a road and not enough to describe one, so highlighting, fitting and
// the termini all have to come from the source data instead. Reading a clipped
// fragment instead would frame the map on whichever piece happened to be under
// the cursor.
function findFeature(id) {
  const meta = app.byId.get(id);
  if (!meta) return null;
  const srcId = isPerJuris(meta.sys) ? `st-${meta.st}` : `rt-${meta.sys}`;
  const src = app.map.getSource(srcId);
  const data = src?._data;
  if (!data?.features) return null;
  return data.features.find((f) => f.properties.id === id) || null;
}

export async function select(id, { feature = null, fit = true } = {}) {
  const meta = app.byId.get(id);
  if (!meta) return;

  if (isPerJuris(meta.sys) && !app.stateLoaded.has(meta.st)) await loadState(meta.st);
  else if (!isPerJuris(meta.sys) && !app.loaded.has(meta.sys)) await enableSystem(meta.sys);

  // A caller may pass the feature it has, but the loaded copy wins when there
  // is one; see findFeature for why a clicked feature cannot be trusted.
  const f = findFeature(id) || feature;
  app.selected = id;
  app.selectedFeature = f;

  ensureSelectionLayers();
  if (f) {
    // Only the mainline pieces are highlighted; branch geometry stays at the
    // system's own styling so the through route is unambiguous.
    const np = f.properties.np ?? f.geometry.coordinates.length;
    const main = f.geometry.coordinates.slice(0, np);
    app.map.getSource(SEL_SRC).setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: main } }],
    });
    setTermini(f);
    if (fit) fitTo(f);
  }

  if (!flowRaf) animateFlow();
  document.getElementById('detail').classList.remove('hidden');
  renderResults();
  renderDetail(id);
}

function propOf(f, key) {
  // GeoJSON sources hand back nested properties as JSON strings once they have
  // been through the tile pipeline.
  const v = f.properties[key];
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return v; }
}

function setTermini(f) {
  const np = f.properties.np ?? f.geometry.coordinates.length;
  const main = f.geometry.coordinates.slice(0, np);
  if (!main.length) return;
  const a = main[0][0];
  const b = main[main.length - 1].at(-1);
  const start = propOf(f, 'start');
  const end = propOf(f, 'end');
  app.map.getSource(TERM_SRC).setData({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: a }, properties: { colour: '#6ef7a5', tag: start?.name ?? 'START' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: b }, properties: { colour: '#ff5d73', tag: end?.name ?? 'END' } },
    ],
  });
}

/** The width below which the panels dock to the bottom instead of the sides. */
export const STACKED = 1080;

/**
 * Padding that lands a route in the gap the panels leave, not under one.
 *
 * The panel widths are fluid, so this measures them rather than naming them -
 * at 1150px the sidebar is 288px wide and reserving the old hard-coded 400
 * would push the route off to the right of the slot it is supposed to sit in.
 * The detail panel is counted even when it is closed, so that opening it does
 * not shift a route that was just framed.
 */
export function mapPad({ reserveDetail = true } = {}) {
  if (window.innerWidth <= STACKED) return { top: 90, bottom: 70, left: 30, right: 30 };
  const width = (id) => document.getElementById(id)?.offsetWidth ?? 0;
  const GAP = 28;
  return {
    top: 90,
    bottom: 70,
    left: document.body.classList.contains('shell-off') ? 40 : width('shell') + GAP,
    right: reserveDetail ? width('detail') + GAP : 80,
  };
}

export function fitTo(f) {
  let minX = 180, minY = 90, maxX = -180, maxY = -90;
  for (const line of f.geometry.coordinates) {
    for (const [x, y] of line) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  app.map.fitBounds([[minX, minY], [maxX, maxY]], {
    padding: mapPad(),
    duration: 1200,
    maxZoom: 11,
  });
}

export function clearSelection() {
  app.selected = null;
  app.selectedFeature = null;
  const empty = { type: 'FeatureCollection', features: [] };
  if (app.map.getSource(SEL_SRC)) app.map.getSource(SEL_SRC).setData(empty);
  if (app.map.getSource(TERM_SRC)) app.map.getSource(TERM_SRC).setData(empty);
  if (flowRaf) { cancelAnimationFrame(flowRaf); flowRaf = null; }
  document.getElementById('detail').classList.add('hidden');
  if (isFlying()) stopFly();
  renderResults();
}

/* ── terrain ──────────────────────────────────────────────────────────── */

// AWS terrain tiles: terrarium encoding, public, no key required. One source
// feeds both the hillshade and the 3D mesh, so it is created on first need by
// whichever asks first.
function ensureDem() {
  if (app.map.getSource('dem')) return;
  app.map.addSource('dem', {
    type: 'raster-dem',
    tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
    encoding: 'terrarium',
    tileSize: 256,
    maxzoom: 13,
    attribution: 'Terrain: Mapzen / AWS Open Data',
  });
}

// Imagery and relief go underneath the basemap's own labels rather than on top
// of everything. Place names then stay legible over both, and stay in the
// language the rest of the map is using.
function firstSymbolLayer() {
  for (const l of app.map.getStyle().layers) if (l.type === 'symbol') return l.id;
  return undefined;
}

// The basemap's labels are pale, having been drawn for a near-black ground.
// Over imagery they vanish, so they get a hard halo for as long as the imagery
// is up. The originals are kept so switching back restores the style exactly
// rather than leaving a halo behind.
const labelHalo = new Map();
function haloLabels(on) {
  const map = app.map;
  for (const l of map.getStyle().layers) {
    if (l.type !== 'symbol') continue;
    if (!labelHalo.has(l.id)) {
      labelHalo.set(l.id, {
        color: map.getPaintProperty(l.id, 'text-halo-color'),
        width: map.getPaintProperty(l.id, 'text-halo-width'),
      });
    }
    const was = labelHalo.get(l.id);
    map.setPaintProperty(l.id, 'text-halo-color', on ? 'rgba(2,5,12,0.9)' : was.color);
    map.setPaintProperty(l.id, 'text-halo-width', on ? 1.7 : was.width);
  }
}

export function setBasemap(mode) {
  const map = app.map;
  if (app.basemap === mode) return;
  app.basemap = mode;

  if (mode === 'satellite' && !map.getSource('sat')) {
    map.addSource('sat', {
      type: 'raster',
      // Esri's public imagery service, addressed row-then-column.
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagery: Esri, Maxar, Earthstar Geographics',
    });
    map.addLayer({
      id: 'sat', type: 'raster', source: 'sat',
      paint: { 'raster-opacity': 0, 'raster-opacity-transition': { duration: 450 } },
    }, firstSymbolLayer());
  }

  if (mode === 'relief' && !map.getLayer('hillshade')) {
    ensureDem();
    map.addLayer({
      id: 'hillshade', type: 'hillshade', source: 'dem',
      paint: {
        // Cool highlights and near-black shadow, so relief reads as relief on a
        // dark ground instead of washing the panel out.
        'hillshade-exaggeration': 0.72,
        'hillshade-shadow-color': '#02040a',
        'hillshade-highlight-color': '#5c9fd6',
        'hillshade-accent-color': '#0b1a2e',
        'hillshade-illumination-anchor': 'viewport',
        'hillshade-illumination-direction': 315,
      },
    }, firstSymbolLayer());
  }

  if (map.getLayer('sat')) map.setPaintProperty('sat', 'raster-opacity', mode === 'satellite' ? 1 : 0);
  if (map.getLayer('hillshade')) {
    map.setLayoutProperty('hillshade', 'visibility', mode === 'relief' ? 'visible' : 'none');
  }
  // Imagery carries its own shading; the drawn ground would only fight it.
  for (const id of ['ctx']) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', mode === 'satellite' ? 'none' : 'visible');
  }
  haloLabels(mode === 'satellite');

  for (const b of document.querySelectorAll('#basemap .seg-b')) {
    b.classList.toggle('on', b.dataset.base === mode);
  }
  toast(t(`toast.base.${mode}`));
}

export function toggleTerrain(force) {
  const map = app.map;
  const next = force ?? !app.terrain;
  if (next) ensureDem();
  app.terrain = next;
  map.setTerrain(next ? { source: 'dem', exaggeration: 1.35 } : null);
  // Relief is only legible from an angle, so tilting turns it on if the map is
  // still flat-shaded; the two controls are otherwise independent.
  // Tilted, the map has a horizon, and without a sky it is a black band. The
  // atmosphere is only worth drawing while there is something to see it above.
  map.setSky(next ? {
    'sky-color': '#071226',
    'horizon-color': '#1f5480',
    'fog-color': '#05070c',
    'sky-horizon-blend': 0.55,
    'horizon-fog-blend': 0.6,
    'fog-ground-blend': 0.4,
  } : {
    'sky-color': '#05070c', 'horizon-color': '#05070c', 'fog-color': '#05070c',
    'sky-horizon-blend': 0, 'horizon-fog-blend': 0, 'fog-ground-blend': 0,
  });

  if (next) {
    if (app.basemap === 'dark') setBasemap('relief');
    if (map.getPitch() < 25) map.easeTo({ pitch: 62, duration: 1100 });
  } else {
    map.easeTo({ pitch: 0, duration: 900 });
  }
  document.getElementById('btnTerrain').classList.toggle('on', next);
  toast(t(next ? 'toast.terrainOn' : 'toast.terrainOff'));
}

/* ── region jumps ─────────────────────────────────────────────────────── */

// The opening view frames the settled band of both countries, which is where
// nearly all of the pavement is. Everything outside it - Alaska, Hawaii,
// Puerto Rico, the Canadian north - is real and mapped but off the edge, and
// nothing on a map hints that it continues past the frame. One tap each.
const REGIONS = [
  { group: 'us', key: 'na', i18n: 'jump.na', bounds: [[-168, 17], [-52, 71]] },
  { group: 'us', key: 'l48', i18n: 'jump.l48', bounds: [[-125.5, 24.2], [-66.4, 49.6]] },
  { group: 'us', key: 'ak', i18n: 'jump.ak', st: 'AK', bounds: [[-169.5, 52.0], [-129.5, 71.5]] },
  { group: 'us', key: 'hi', i18n: 'jump.hi', st: 'HI', bounds: [[-160.4, 18.8], [-154.7, 22.4]] },
  { group: 'us', key: 'pr', i18n: 'jump.pr', st: 'PR', bounds: [[-67.4, 17.85], [-65.2, 18.6]] },
  // Stops at 62°N rather than at the top of the country. Nunavut has no
  // numbered route at all and the two other territories have 24 between them,
  // so framing to 70° spends two thirds of the screen on empty ground and
  // squeezes the corridor every road is in into a strip. The territories have
  // their own jump for anyone who wants them.
  { group: 'ca', key: 'ca', i18n: 'jump.ca', bounds: [[-141, 42], [-52.5, 62]] },
  { group: 'ca', key: 'cawest', i18n: 'jump.cawest', bounds: [[-139, 48.2], [-94, 60.5]] },
  { group: 'ca', key: 'caeast', i18n: 'jump.caeast', bounds: [[-95.5, 41.6], [-52.5, 62]] },
  { group: 'ca', key: 'canorth', i18n: 'jump.canorth', bounds: [[-141, 58], [-61, 71]] },
];

function renderJumps() {
  const host = document.getElementById('jumps');
  host.innerHTML = '';
  for (const group of ['us', 'ca']) {
    const row = document.createElement('div');
    row.className = 'jump-row';
    const label = document.createElement('i');
    label.className = `flagdot flag-${group}`;
    label.title = t(`sys.country.${group}`);
    row.appendChild(label);

    for (const r of REGIONS.filter((x) => x.group === group)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'jump';
      // Addressed by key rather than by position: the row these sit in has
      // grown twice now, and anything counting from the left breaks each time.
      b.dataset.jump = r.key;
      b.textContent = t(r.i18n);
      b.addEventListener('click', async () => {
        app.map.fitBounds(r.bounds, {
          // No route is selected when you jump to a region, so the detail panel
          // is not going to open over the view and needs no room reserved.
          padding: mapPad({ reserveDetail: false }),
          duration: 1500,
        });
        // Flying somewhere with nothing drawn on it is how Alaska came to look
        // absent in the first place. Alaska now has its four Interstates, but
        // Hawaii's and Puerto Rico's networks are state routes, which load per
        // jurisdiction, so bring them along.
        if (r.st && !app.stateLoaded.has(r.st)) await loadState(r.st);
      });
      row.appendChild(b);
    }
    host.appendChild(row);
  }
}

/* ── systems panel ────────────────────────────────────────────────────── */

function renderSystems() {
  const host = document.getElementById('sysList');
  const counts = {};
  for (const r of app.index) counts[r.sys] = (counts[r.sys] || 0) + 1;
  const milesBy = app.stats?.bySystem || {};

  host.innerHTML = '';
  // Grouped by country, because the two sets of tiers are not equivalents of
  // one another and listing all six flat invited reading them as one ladder.
  for (const cc of ['us', 'ca']) {
    const head = document.createElement('p');
    head.className = 'sys-country';
    head.innerHTML = `<i class="flagdot flag-${cc}"></i>${t(`sys.country.${cc}`)}`;
    host.appendChild(head);

    for (const s of SYSTEMS.filter((x) => x.cc === cc)) {
      const live = app.systems.get(s.id);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `sys${live.on ? ' on' : ''}`;
      btn.dataset.sys = s.id;
      btn.style.setProperty('--sys-col', s.colour);
      const mi = milesBy[s.id]?.mi;
      btn.innerHTML = `
        <span class="sys-dot"></span>
        <span class="sys-txt">
          <span class="sys-name">${t(`sys.${s.id}`)}</span>
          <span class="sys-meta">${t(`sys.${s.id}.meta`)}${mi ? ` · ${miles(mi)}` : ''}</span>
        </span>
        <span class="sys-count">${t('sys.routes', { n: (counts[s.id] || 0).toLocaleString() })}</span>`;
      btn.addEventListener('click', () => {
        if (s.perJuris) {
          openSheet(s.id === 'state' ? 'states' : 'provinces');
          return;
        }
        if (app.systems.get(s.id).on) disableSystem(s.id);
        else enableSystem(s.id);
      });
      host.appendChild(btn);
    }
  }
}

/* ── search + results ─────────────────────────────────────────────────── */

let query = '';

// Populated once the manifest arrives; until then results simply carry no
// badge, which is the right default for the 97% of routes that have none.
let writtenIds = new Set();
dossierIds().then((ids) => {
  writtenIds = ids;
  if (document.getElementById('results')?.childElementCount) renderResults();
});

export function searchRoutes(text, { limit = 300, systemsOnly = true } = {}) {
  const q = text.trim().toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  // Browsing follows the map, searching searches everything. Restricting a
  // typed query to the systems currently drawn meant "200" answered "nothing
  // matches" while MT 200 sat in the index, and choosing a result switches its
  // system on regardless.
  const restrict = systemsOnly && !terms.length;
  const out = [];
  for (const r of app.index) {
    if (restrict && !app.systems.get(r.sys).on) continue;
    if (terms.length) {
      let ok = true;
      for (const term of terms) if (!r.hay.includes(term)) { ok = false; break; }
      if (!ok) continue;
    }
    out.push(r);
  }
  // Exact number matches first, then primary routes, then by length.
  const rank = (r) => {
    let s = 0;
    if (q && r.label.toLowerCase() === q) s -= 400;
    if (q && String(r.num).toLowerCase() === q) s -= 300;
    if (r.tier === 'primary') s -= 60;
    else if (r.tier === 'auxiliary') s -= 20;
    return s - Math.min(r.mi, 3000) / 100;
  };
  out.sort((a, b) => rank(a) - rank(b));
  return { total: out.length, rows: out.slice(0, limit) };
}

// One marker class per system. Each is drawn in CSS after the real sign: the
// Interstate's red header band, the US route's white escutcheon, the
// Trans-Canada's green with its maple leaf, and a jurisdiction-tinted marker
// for the two numbered-by-jurisdiction tiers.
const SHIELD_CLASS = {
  interstate: 'shield-i',
  us: 'shield-us',
  state: 'shield-st',
  tch: 'shield-tch',
  nhs: 'shield-nhs',
  provincial: 'shield-pr',
};

// Four Canadian provinces sign a marker distinctive enough to be worth drawing
// rather than tinting: Ontario's crown over the number on its King's Highways,
// Quebec's green autoroute plate, British Columbia's blue-on-white bullet, and
// Alberta's black-on-white rounded shield. The rest sign a plain white square
// or circle that the tinted default already reads as.
//
// Alberta's is the only one of the four drawn from a published specification -
// its sign catalogue gives the colours and the millimetre dimensions. The other
// three are drawn from descriptions, because Ontario's fabrication patterns are
// in a manual that was not retrieved, Quebec's are sold rather than published,
// and British Columbia's catalogue could not be read. None of them is traced.
//
// Quebec is the one that depends on the number rather than the province, since
// an autoroute and a route nationale carry different signs in the same
// province: A-20 is the green plate, Route 132 is not.
const PROV_SHIELD = { ON: 'shield-on', BC: 'shield-bc', AB: 'shield-ab' };

function provincialShield(r) {
  if (r.st === 'QC') return /^A/i.test(String(r.num ?? '')) ? 'shield-qca' : 'shield-qc';
  return PROV_SHIELD[r.st] || 'shield-pr';
}

export function shieldHtml(r, big = false) {
  let cls = SHIELD_CLASS[r.sys] || 'shield-st';
  // A designated route still wears its province's sign - the National Highway
  // System is a designation, not a marker, and nothing is signed "NHS".
  if (cls === 'shield-pr' || cls === 'shield-nhs') cls = provincialShield(r);
  // The number and nothing else. State routes used to read "CA·87" inside the
  // marker, which no real shield does and which no circle that size can hold.
  // Every one of these already has its jurisdiction named beside it.
  const text = String(r.num ?? '').replace(/[<>&]/g, '');
  const prefixed = cls !== 'shield-i' && cls !== 'shield-us' && cls !== 'shield-tch';
  return `<span class="shield ${cls}${big ? ' shield-lg' : ''}" `
    + `title="${prefixed ? `${r.st} ` : ''}${text}">${text}</span>`;
}

function renderResults() {
  const host = document.getElementById('results');
  const { total, rows } = searchRoutes(query);
  document.getElementById('resCount').textContent = rows.length
    ? t('search.count', { n: rows.length.toLocaleString(), total: total.toLocaleString() })
    : '';

  if (!rows.length) {
    host.innerHTML = `<p class="res-empty">${query ? t('search.none') : t('search.hint')}</p>`;
    return;
  }

  const frag = document.createDocumentFragment();
  for (const r of rows) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `res${app.selected === r.id ? ' sel' : ''}`;
    // What tells this row from the one under it. A jurisdiction's own route
    // wants the jurisdiction; so does any Canadian route, because the
    // Trans-Canada changes number at nearly every border and five different
    // roads are all signed TCH 1. An American national route wants the shape
    // of its run instead, since its number is unique already. And a route
    // sharing a number inside one jurisdiction adds the place that tells the
    // namesakes apart.
    const byJurisdiction = isPerJuris(r.sys) || isProvince(r.st);
    const sub = r.where ? `${stateName(r.st)} · ${r.where}`
      : byJurisdiction ? stateName(r.st)
        : `${r.ns === 1 ? t('sub.state') : t('sub.states', { n: r.ns })}`
          + ` · ${r.gs}% ${t('dt.gradeSep').toLowerCase()}`;
    const written = writtenIds.has(r.id)
      ? `<span class="res-pen" title="${t('search.written')}"></span>` : '';
    b.innerHTML = `${shieldHtml(r)}
      <span class="res-txt">
        <span class="res-name">${r.label}${written}</span>
        <span class="res-sub">${sub}</span>
      </span>
      <span class="res-mi">${r.mi.toLocaleString()}</span>`;
    b.addEventListener('click', () => select(r.id));
    frag.appendChild(b);
  }
  host.innerHTML = '';
  host.appendChild(frag);
}

/* ── toast ────────────────────────────────────────────────────────────── */

let toastTimer = null;
export function toast(msg) {
  const el = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2600);
}

/* ── trip ─────────────────────────────────────────────────────────────── */

export function addToTrip(id) {
  const r = app.byId.get(id);
  if (!r) return;
  if (app.trip.includes(id)) { toast(t('toast.tripDup', { route: r.label })); return; }
  app.trip.push(id);
  toast(t('toast.tripAdded', { route: r.label }));
  document.getElementById('btnPlanner').classList.toggle('on', app.trip.length > 0);
  refreshPlannerIfOpen();
}

/* ── command palette ──────────────────────────────────────────────────── */

const VIEWS = [
  { key: 'numbering', i18n: 'nav.numbering', icon: 'M4 9h16M4 15h16M10 3v18M16 3v18' },
  { key: 'dashboard', i18n: 'nav.dashboard', icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
  { key: 'timeline', i18n: 'nav.timeline', icon: 'M12 7v5l3.5 2' },
  { key: 'planner', i18n: 'nav.planner', icon: 'M6 19V7a3 3 0 0 1 6 0v10a3 3 0 0 0 6 0V5' },
  { key: 'about', i18n: 'nav.about', icon: 'M12 11v5M12 7.6v.1' },
];

let palCursor = 0;
let palRows = [];

function renderPalette() {
  const q = document.getElementById('palQ').value.trim().toLowerCase();
  const host = document.getElementById('palList');
  palRows = [];
  host.innerHTML = '';

  const views = VIEWS.filter((v) => !q || t(v.i18n).toLowerCase().includes(q));
  const states = Object.keys(app.stats?.byState || {})
    .filter((st) => !q || stateName(st).toLowerCase().includes(q) || st.toLowerCase() === q)
    .sort();
  const { rows } = searchRoutes(q, { limit: q ? 40 : 12, systemsOnly: false });

  const section = (label) => {
    const d = document.createElement('div');
    d.className = 'pal-sec';
    d.textContent = label;
    host.appendChild(d);
  };
  const item = (html, onPick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pal-it';
    b.innerHTML = html;
    const idx = palRows.length;
    b.addEventListener('click', () => { palRows[idx].pick(); closePalette(); });
    b.addEventListener('mousemove', () => { palCursor = idx; paintPalCursor(); });
    host.appendChild(b);
    palRows.push({ el: b, pick: onPick });
  };

  if (views.length) {
    section(t('pal.views'));
    for (const v of views) {
      item(`<span class="ico-w"><svg viewBox="0 0 24 24"><path d="${v.icon}"/></svg></span>
        <span class="pal-it-txt"><span class="pal-it-name">${t(v.i18n)}</span></span>`,
      () => openSheet(v.key));
    }
  }

  if (rows.length) {
    section(t('pal.routes'));
    for (const r of rows) {
      item(`<span class="ico-w">${shieldHtml(r)}</span>
        <span class="pal-it-txt"><span class="pal-it-name">${r.label}</span>
        <span class="pal-it-sub">${ownerLabel(r.sys, r.st)}${r.where ? ` · ${r.where}` : ''} · ${miles(r.mi)}</span></span>`,
      () => select(r.id));
    }
  }

  if (states.length && q) {
    section(t('pal.states'));
    for (const st of states.slice(0, 8)) {
      item(`<span class="ico-w"><svg viewBox="0 0 24 24"><path d="M12 21s7-6.4 7-11a7 7 0 1 0-14 0c0 4.6 7 11 7 11z"/></svg></span>
        <span class="pal-it-txt"><span class="pal-it-name">${stateName(st)}</span>
        <span class="pal-it-sub">${miles(app.stats.byState[st].mi)}</span></span>`,
      () => loadState(st).then(() => zoomToState(st)));
    }
  }

  palCursor = 0;
  paintPalCursor();
}

function paintPalCursor() {
  palRows.forEach((r, i) => r.el.classList.toggle('cursor', i === palCursor));
  palRows[palCursor]?.el.scrollIntoView({ block: 'nearest' });
}

export function openPalette() {
  document.getElementById('palette').classList.remove('hidden');
  const input = document.getElementById('palQ');
  input.value = '';
  renderPalette();
  input.focus();
}

function closePalette() {
  document.getElementById('palette').classList.add('hidden');
}

export function zoomToState(st) {
  const rows = app.index.filter((r) => r.st === st);
  if (!rows.length) return;
  let minX = 180, minY = 90, maxX = -180, maxY = -90;
  for (const r of rows) {
    minX = Math.min(minX, r.cx); maxX = Math.max(maxX, r.cx);
    minY = Math.min(minY, r.cy); maxY = Math.max(maxY, r.cy);
  }
  const pad = 0.6;
  app.map.fitBounds([[minX - pad, minY - pad], [maxX + pad, maxY + pad]], {
    padding: mapPad({ reserveDetail: false }),
    duration: 1200,
  });
}

/* ── wiring ───────────────────────────────────────────────────────────── */

function wire() {
  const q = document.getElementById('q');
  q.addEventListener('input', () => {
    query = q.value;
    document.getElementById('qClear').hidden = !query;
    renderResults();
  });
  document.getElementById('qClear').addEventListener('click', () => {
    q.value = ''; query = ''; document.getElementById('qClear').hidden = true; renderResults(); q.focus();
  });

  document.getElementById('btnLang').addEventListener('click', () => {
    setLang(getLang() === 'en' ? 'zh' : 'en');
    localStorage.setItem('ia.lang', getLang());
    relabel();
  });

  const setShell = (open) => {
    document.getElementById('shell').classList.toggle('hidden', !open);
    document.body.classList.toggle('shell-off', !open);
  };
  document.getElementById('btnCollapse').addEventListener('click', () => setShell(false));
  document.getElementById('shellOpen').addEventListener('click', () => setShell(true));

  document.getElementById('basemap').addEventListener('click', (e) => {
    const b = e.target.closest('.seg-b');
    if (b) setBasemap(b.dataset.base);
  });

  document.getElementById('btnTerrain').addEventListener('click', () => toggleTerrain());
  document.getElementById('btnPalette').addEventListener('click', openPalette);
  for (const [btn, key] of [['btnNumbering', 'numbering'], ['btnDash', 'dashboard'],
    ['btnPlanner', 'planner'], ['btnAbout', 'about']]) {
    document.getElementById(btn).addEventListener('click', () => openSheet(key));
  }
  // The buildout view docks over the map instead of opening a sheet, because
  // a modal that covers the map cannot show the map changing.
  // openTimelapse toggles, and it owns the button's lit state so that closing
  // from the scrubber's own dismiss button leaves the two in step.
  document.getElementById('btnTimeline').addEventListener('click', openTimelapse);

  document.getElementById('palQ').addEventListener('input', renderPalette);
  document.getElementById('palette').addEventListener('click', (e) => {
    if (e.target.id === 'palette') closePalette();
  });

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
    const palOpen = !document.getElementById('palette').classList.contains('hidden');

    if (palOpen) {
      if (e.key === 'Escape') { closePalette(); e.preventDefault(); }
      if (e.key === 'ArrowDown') { palCursor = Math.min(palCursor + 1, palRows.length - 1); paintPalCursor(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { palCursor = Math.max(palCursor - 1, 0); paintPalCursor(); e.preventDefault(); }
      if (e.key === 'Enter') { palRows[palCursor]?.pick(); closePalette(); e.preventDefault(); }
      return;
    }

    if ((e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) && !typing) {
      openPalette(); e.preventDefault(); return;
    }
    if (e.key === 'Escape') {
      if (isSheetOpen()) closeSheet();
      else if (isFlying()) stopFly();
      else if (app.selected) clearSelection();
      return;
    }
    if (typing) return;
    if (e.key === 'f' && app.selected) startFly(app.selected);
    if (e.key === 't') toggleTerrain();
    if (e.key === '3') toggleTerrain();
  });
}

/* ── start ────────────────────────────────────────────────────────────── */

async function main() {
  setLang(localStorage.getItem('ia.lang') || (navigator.language.startsWith('zh') ? 'zh' : 'en'));
  applyStaticStrings();
  wire();

  boot(8, 'boot.step.index');
  await Promise.all([loadIndex(), loadStats()]);
  boot(34, 'boot.step.map');

  const map = buildMap();
  await new Promise((res) => map.on('load', res));
  boot(58, 'boot.step.geo');

  // Faint hairlines for the unnumbered primary grid, drawn under everything.
  const context = await (await fetch('data/geo/context.json')).json();
  map.addSource('ctx', { type: 'geojson', data: context });
  map.addLayer({
    id: 'ctx', type: 'line', source: 'ctx',
    paint: {
      'line-color': '#7fb2d8',
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.3, 8, 0.7],
      'line-opacity': 0.14,
    },
  });

  // Every system that starts switched on gets drawn, rather than the
  // Interstates alone. The Trans-Canada is also on by default, and loading
  // only the Interstates left its button lit above an empty map - and its
  // routes selectable from search but invisible until something else
  // happened to switch the layer on.
  const startOn = SYSTEMS.filter((s) => s.on && s.src);
  const payloads = await Promise.all(startOn.map((s) => fetch(s.src).then((r) => r.json())));
  startOn.forEach((s, i) => {
    app.loaded.add(s.id);
    addSystemLayers(s.id, payloads[i]);
  });
  ensureSelectionLayers();
  renderMapLabels();

  boot(86, 'boot.step.ready');
  renderSystems();
  renderJumps();
  renderResults();

  boot(100, 'boot.step.ready');
  document.body.classList.remove('is-booting');
  setTimeout(() => document.getElementById('boot').classList.add('done'), 420);

  map.on('click', (e) => {
    // Clicking bare map clears the selection; route layers stop propagation
    // by handling their own click first.
    const hit = map.queryRenderedFeatures(e.point, {
      layers: map.getStyle().layers
        .map((l) => l.id)
        .filter((id) => id.endsWith('-hit')),
    });
    if (!hit.length && app.selected && !isFlying()) clearSelection();
  });
}

main().catch((err) => {
  console.error(err);
  document.getElementById('bootStep').textContent = String(err.message || err);
});
