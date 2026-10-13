/* Highway Atlas — map surface, route selection, search.
   Detail panel, overlay sheets and the flythrough live in their own modules. */

import {
  t, setLang, getLang, stateName, dist, num, lenOf, lenName, isProvince, jurisdictionNames,
  routeLabel, labelAlias, ownerLabel, countryOfJuris, setUnits, getUnits, defaultUnits, lenNum, routeDist,
} from './i18n.js';
import { renderDetail } from './detail.js';
import { openSheet, closeSheet, isSheetOpen } from './sheets.js';
import { startFly, stopFly, isFlying } from './fly.js';
import { openTimelapse } from './timelapse.js';
import { toggleCrossings, crossingAt, raiseCrossings, closeCrossing } from './crossings.js';
import { toggleTolls, tollAt, raiseTolls, closeTollPopup } from './tolls.js';
import { toggleBridges, bridgeAt, raiseBridges, closeBridge } from './bridges.js';
import {
  SYSTEMS, COUNTRIES, TIER_BY_CODE, geoPath, isPerJuris, systemsOf, systemOfCode, countryOf,
  REGIONS as WORLD_REGIONS, regionOf,
} from './schema.js';

/* The route systems, their colours and where their geometry lives, all come
   from `schema.js` so the build scripts and this page cannot drift apart. */

const GEO = 'data/geo';

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
  terrain: false,
  basemap: 'dark',
  legend: true,
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
  // An icon-only button names itself in a tooltip of its own, drawn in CSS
  // beside its shortcut, rather than in the browser's slow plain title.
  for (const el of document.querySelectorAll('[data-i18n-tip]')) {
    const label = t(el.dataset.i18nTip);
    el.dataset.tip = label;
    el.setAttribute('aria-label', label);
    if (el.dataset.key) el.setAttribute('aria-keyshortcuts', el.dataset.key);
  }
  for (const el of document.querySelectorAll('[data-count]')) {
    if (el.dataset.n) el.textContent = num(Number(el.dataset.n));
  }
  document.getElementById('q').placeholder = app.region === 'ea' ? t('search.placeholderEa') : t('search.placeholder');
  document.getElementById('palQ').placeholder = t('pal.placeholder');
  for (const el of document.querySelectorAll('#unitSeg [data-u]')) {
    el.querySelector('b').textContent = t(el.dataset.u === 'metric' ? 'unit.km' : 'unit.mi');
    el.querySelector('small').textContent = t(el.dataset.u === 'metric' ? 'set.unitsMetric' : 'set.unitsImperial');
    el.classList.toggle('on', el.dataset.u === getUnits());
  }
  for (const el of document.querySelectorAll('#langSeg [data-lang]')) {
    el.classList.toggle('on', el.dataset.lang === getLang());
  }
  for (const el of document.querySelectorAll('#themeSeg [data-theme]')) {
    el.classList.toggle('on', el.dataset.theme === document.documentElement.dataset.theme);
  }
  document.getElementById('bootTitle').textContent = t('boot.title');
  document.getElementById('bootSub').textContent = t('boot.sub');
  document.title = getLang() === 'zh'
    ? '北美公路图谱 — 北美国家公路网'
    : 'Highway Atlas — the highway network of North America';
}

export function relabel() {
  closeCrossing();
  closeTollPopup();
  closeBridge();
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
  app.index = raw.routes.map(([id, label, sys, tier, st, mi, base, num, cx, cy, gs, ns, where]) => ({
    id, label, sys: systemOfCode(sys)?.id ?? null, tier: TIER_BY_CODE[tier], st, mi, base, num, cx, cy, gs, ns, where,
    // Pre-lowered haystack so keystroke filtering stays cheap across 11,000
    // rows. The jurisdiction's full name is in it too, so "ontario" and
    // "saskatchewan" find their routes without the user knowing the code. So
    // is the place a shared number is told apart by, so "ON 21 Goderich" picks
    // the right one out of the twenty-two Ontario roads numbered 21.
    // Taiwan and Hong Kong's routes answer to their own signs too: 國1, 台9, 3號幹線.
    hay: `${label} ${labelAlias(label)} ${num} ${st} ${jurisdictionNames(st)} ${where || ''}`.toLowerCase(),
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

// The frame the atlas opens on: the settled band of all three countries, from
// the Canadian corridor down to the Isthmus of Tehuantepec, with no one of them
// at the centre. It is a promise the region jumps then keep: what is off this
// edge - Alaska, the Canadian north, Hawaii, Yucatán's tip - is reachable, not
// missing.
const HOME_BOUNDS = [[-126.5, 15.5], [-58.5, 55.5]];

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
  app.scale = new maplibregl.ScaleControl({ unit: getUnits() });
  map.addControl(app.scale, 'bottom-right');
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
    if (f && !crossingAt(e.point) && !tollAt(e.point) && !bridgeAt(e.point)) select(f.properties.id, { feature: f, fit: false });
  });
  raiseBridges();
  raiseTolls();
  raiseCrossings();
}

export async function enableSystem(sys) {
  const s = app.systems.get(sys);
  s.on = true;
  if (isPerJuris(sys)) {
    renderSystems();
    return;
  }
  if (!app.loaded.has(sys)) {
    const data = await (await fetch(`${GEO}/${geoPath(sys)}`)).json();
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
  if (isPerJuris(sys)) {
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

const JURIS_SYSTEM = { us: 'us-state', ca: 'ca-provincial', mx: 'mx-state' };
function systemOfJurisdiction(code) { return JURIS_SYSTEM[countryOfJuris(code)]; }

export async function loadState(st) {
  if (app.stateLoaded.has(st)) { setStateVisible(st, true); return; }
  const sys = systemOfJurisdiction(st);
  toast(t('toast.loadingState', { state: stateName(st) }));
  const data = await (await fetch(`${GEO}/${geoPath(sys, st)}`)).json();
  app.stateLoaded.add(st);
  addStateLayers(st, data, sys);
  app.systems.get(sys).on = true;
  renderSystems();
  renderResults();
}

function addStateLayers(st, data, sys = 'us-state') {
  const map = app.map;
  const srcId = `st-${st}`;
  const colour = lineColour(sys);
  map.addSource(srcId, { type: 'geojson', data, promoteId: 'id' });
  const width = (m) => ['interpolate', ['linear'], ['zoom'], 4, 0.35 * m, 7, 0.9 * m, 11, 2.4 * m];
  // State routes sit beneath the national systems so those stay legible.
  const under = map.getLayer('rt-us-interstate-glow') ? 'rt-us-interstate-glow' : undefined;
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
    if (f && !crossingAt(e.point) && !tollAt(e.point) && !bridgeAt(e.point)) select(f.properties.id, { feature: f, fit: false });
  });
  raiseBridges();
  raiseTolls();
  raiseCrossings();
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
 * The detail panel's width is fluid, so this measures it rather than naming
 * it. It is counted even when it is closed, so that opening it does not shift
 * a route that was just framed. The left side only has the search box, which
 * sits in the top bar and is already inside the top padding.
 */
export function mapPad({ reserveDetail = true } = {}) {
  if (window.innerWidth <= STACKED) return { top: 90, bottom: 70, left: 30, right: 30 };
  const width = (id) => document.getElementById(id)?.offsetWidth ?? 0;
  const GAP = 28;
  return {
    top: 90,
    bottom: 70,
    left: 50,
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

  for (const b of document.querySelectorAll('#basemap [data-base]')) {
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

/**
 * Take the interface off the map.
 *
 * Every panel here is an overlay on the thing people came to look at, and on a
 * laptop the header, the sidebar and an open detail panel between them cover
 * about half of it. This fades the lot and leaves the map, which is also what
 * you want before a screenshot.
 *
 * Anything modal is closed on the way in rather than hidden, because a sheet
 * faded to nothing but still open would swallow the next Escape and leave the
 * reader pressing a key that appeared to do nothing.
 */
function toggleZen(next = !document.body.classList.contains('zen')) {
  if (next) {
    if (isSheetOpen()) closeSheet();
    closePalette();
  }
  document.body.classList.toggle('zen', next);
  document.getElementById('btnZen').classList.toggle('on', next);
  if (next) toast(t('toast.zen'));
}

export const isZen = () => document.body.classList.contains('zen');

// What each overlay would add, from the build's tally, so the tiles carry a
// number before any overlay's own file has been fetched.
let overlayCounts;
function countOverlays() {
  overlayCounts ??= fetch('data/insights.json').then((r) => r.json()).then((d) => {
    for (const el of document.querySelectorAll('[data-count]')) {
      const n = d.overlays?.[el.dataset.count];
      if (n == null) continue;
      el.dataset.n = n;
      el.textContent = num(n);
    }
  }).catch(() => {});
}

// The panels only. The road colours were chosen against a near-black ground
// and the base maps are drawn for one, so the map stays as it is and the
// light panels sit on it the way paper sits on a light table.
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('ia.theme', theme);
  document.querySelector('meta[name="theme-color"]').content = theme === 'light' ? '#eef2f7' : '#05070c';
  for (const el of document.querySelectorAll('#themeSeg [data-theme]')) {
    el.classList.toggle('on', el.dataset.theme === theme);
  }
}

/* ── region jumps ─────────────────────────────────────────────────────── */

// The opening view frames the settled band of the three countries, which is
// where nearly all of the pavement is. Everything outside it - Alaska, Hawaii,
// Puerto Rico, the Canadian north - is real and mapped but off the edge, and
// nothing on a map hints that it continues past the frame. One tap each. The
// whole continent is a row of its own rather than one country's first button.
const REGIONS = [
  { group: 'na', key: 'na', i18n: 'jump.na', bounds: [[-168, 14], [-52, 71]] },
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
  { group: 'mx', key: 'mx', i18n: 'jump.mx', bounds: [[-117.2, 14.4], [-86.6, 32.8]] },
  { group: 'mx', key: 'mxnorth', i18n: 'jump.mxnorth', bounds: [[-117.2, 22.5], [-97.1, 32.8]] },
  { group: 'mx', key: 'mxcentre', i18n: 'jump.mxcentre', bounds: [[-105.8, 17.8], [-96.2, 22.6]] },
  { group: 'mx', key: 'mxsouth', i18n: 'jump.mxsouth', bounds: [[-98.6, 14.4], [-86.6, 21.7]] },
  { group: 'ea', key: 'ea', i18n: 'jump.ea', bounds: WORLD_REGIONS.ea.bounds },
  { group: 'tw', key: 'tw', i18n: 'jump.tw', bounds: [[119.9, 21.85], [122.05, 25.35]] },
  { group: 'tw', key: 'twnorth', i18n: 'jump.twnorth', bounds: [[120.85, 24.4], [122.0, 25.32]] },
  { group: 'tw', key: 'twcentre', i18n: 'jump.twcentre', bounds: [[120.2, 23.4], [121.45, 24.5]] },
  { group: 'tw', key: 'twsouth', i18n: 'jump.twsouth', bounds: [[120.0, 21.85], [121.0, 23.5]] },
  { group: 'tw', key: 'tweast', i18n: 'jump.tweast', bounds: [[120.85, 22.0], [121.95, 24.9]] },
  { group: 'hk', key: 'hk', i18n: 'jump.hk', bounds: [[113.82, 22.17], [114.42, 22.56]] },
];

// Which of the jump rows belong to each region; the whole-region row leads.
const JUMP_GROUPS = { na: ['na', 'us', 'ca', 'mx'], ea: ['ea', 'tw', 'hk'] };

app.region = 'na';

/** Set the header switch, the jumps, the key and the list to a region. */
function showRegion(region) {
  app.region = region;
  for (const b of document.querySelectorAll('#regionSeg [data-region]')) {
    const on = b.dataset.region === region;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    b.title = on ? t('jump.title') : '';
    if (!on) b.removeAttribute('aria-expanded');
  }
  document.documentElement.dataset.region = region;
  document.getElementById('q').placeholder = region === 'ea' ? t('search.placeholderEa') : t('search.placeholder');
  renderJumps();
  renderLegend();
  if (document.getElementById('results')?.childElementCount) renderResults();
}

function setRegionPop(open) {
  document.getElementById('regionWrap').classList.toggle('open', open);
  document.querySelector('#regionSeg .on')?.setAttribute('aria-expanded', String(open));
}

function flyToRegion(region) {
  showRegion(region);
  app.map.fitBounds(WORLD_REGIONS[region].bounds, { padding: mapPad({ reserveDetail: false }), duration: 2200 });
}

// The two regions are half a world apart, so whichever one the centre of the
// view is nearer to is the one being looked at.
function regionOfView() {
  const { lng } = app.map.getCenter();
  const east = ((lng % 360) + 360) % 360;
  return east > 40 && east < 200 ? 'ea' : 'na';
}

function wireRegions() {
  // The region not on screen is a destination; the one that is opens its
  // places, since flying to where you already are does nothing.
  const wrap = document.getElementById('regionWrap');
  for (const b of document.querySelectorAll('#regionSeg [data-region]')) {
    b.addEventListener('click', () => {
      if (b.dataset.region === app.region) {
        setRegionPop(!wrap.classList.contains('open'));
        return;
      }
      setRegionPop(false);
      flyToRegion(b.dataset.region);
    });
  }
  document.addEventListener('pointerdown', (e) => {
    if (!wrap.contains(e.target)) setRegionPop(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !wrap.classList.contains('open')) return;
    setRegionPop(false);
    e.stopImmediatePropagation();
  }, true);
  app.map.on('moveend', () => {
    const r = regionOfView();
    if (r !== app.region) showRegion(r);
    localStorage.setItem('ia.region', r);
  });
  // A reader who left in East Asia comes back to it.
  if (localStorage.getItem('ia.region') === 'ea') {
    app.map.fitBounds(WORLD_REGIONS.ea.bounds, { padding: mapPad({ reserveDetail: false }), duration: 0 });
  }
  showRegion(regionOfView());
}

function renderJumps() {
  const host = document.getElementById('jumps');
  host.innerHTML = '';
  for (const group of JUMP_GROUPS[app.region] || JUMP_GROUPS.na) {
    const row = document.createElement('div');
    row.className = 'jump-row';
    if (group !== 'na' && group !== 'ea') {
      const label = document.createElement('i');
      label.className = `flagdot flag-${group}`;
      label.title = t(`sys.country.${group}`);
      row.appendChild(label);
    }

    for (const r of REGIONS.filter((x) => x.group === group)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'jump';
      // Addressed by key rather than by position: the row these sit in has
      // grown twice now, and anything counting from the left breaks each time.
      b.dataset.jump = r.key;
      b.textContent = t(r.i18n);
      b.addEventListener('click', async () => {
        setRegionPop(false);
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
  for (const cc of COUNTRIES) {
    const systems = systemsOf(cc);
    if (!systems.length) continue;
    const head = document.createElement('p');
    head.className = 'sys-country';
    head.innerHTML = `<i class="flagdot flag-${cc}"></i>${t(`sys.country.${cc}`)}`;
    host.appendChild(head);

    for (const s of systems) {
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
          <span class="sys-meta">${t(`sys.${s.id}.meta`)}${mi ? ` · ${dist(mi)}` : ''}</span>
        </span>
        <span class="sys-count">${t('sys.routes', { n: (counts[s.id] || 0).toLocaleString() })}</span>`;
      btn.addEventListener('click', () => {
        if (s.perJuris) {
          // The sheet is where these are switched, so the menu that led to
          // it gets out of the way.
          const menu = document.getElementById('menuLayers');
          menu.classList.remove('open');
          menu.querySelector('[aria-haspopup]').setAttribute('aria-expanded', 'false');
          openSheet({ us: 'states', ca: 'provinces', mx: 'mxstates' }[s.cc]);
          return;
        }
        if (app.systems.get(s.id).on) disableSystem(s.id);
        else enableSystem(s.id);
      });
      host.appendChild(btn);
    }
  }
  renderLegend();
}

/**
 * What the colours mean, on the map itself.
 *
 * The map is otherwise unlabelled below zoom 7, and the system switches live
 * in a menu, which left cyan, amber and pink lines and nothing on screen to
 * tell them apart. The key is on unless the reader switches it off.
 *
 * Only the systems actually drawn in the region on screen are listed, so this
 * is a key to what is in front of the reader rather than a second copy of the
 * switches: Taiwan's freeways mean nothing over Ohio.
 */
function renderLegend() {
  const host = document.getElementById('legend');
  if (!host) return;
  const on = SYSTEMS.filter((s) => app.systems.get(s.id).on && regionOf(s.cc) === app.region);
  if (!on.length || !app.legend) { host.innerHTML = ''; host.hidden = true; return; }
  host.hidden = false;
  host.innerHTML = `<p class="lg-h">${t('legend.title')}</p>`
    + on.map((s) => `<p class="lg-r">`
      + `<i class="lg-dot" style="--sys-col:${s.colour}"></i>`
      + `<span>${t(`sys.${s.id}`)}</span></p>`).join('');
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
    // Browsing also keeps to the region on screen: Taiwan's view opening on a
    // list of American highways answers a question nobody looking at it asked.
    if (restrict && (!app.systems.get(r.sys).on || regionOf(countryOf(r.sys)) !== app.region)) continue;
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
  'us-interstate': 'shield-i',
  'us-numbered': 'shield-us',
  'us-state': 'shield-st',
  'ca-tch': 'shield-tch',
  'ca-nhs': 'shield-nhs',
  'ca-provincial': 'shield-pr',
  'mx-federal': 'shield-mxf',
  'mx-state': 'shield-mxs',
  'tw-freeway': 'shield-twf',
  'tw-provincial': 'shield-twp',
  'hk-route': 'shield-hk',
};

// Shields that carry the number alone, with no jurisdiction code to add.
const BARE_SHIELD = new Set(['shield-i', 'shield-us', 'shield-tch', 'shield-mxf', 'shield-twf', 'shield-twp', 'shield-twx', 'shield-hk']);
const STEM = { A: '甲', B: '乙', C: '丙', D: '丁', E: '戊', F: '己', G: '庚' };

// The stylesheet reads system colours as --c-<system id>, so they are defined
// here from the one table rather than restated in CSS.
for (const s of SYSTEMS) document.documentElement.style.setProperty(`--c-${s.id}`, s.colour);

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
  // Mexican numbers are stored as written in the designation, zero-padded
  // (MEX-015D); the shield itself reads 15D.
  const raw = String(r.num ?? '');
  // A freeway known only by its name has no number to put on a sign.
  if (!raw) return `<span class="shield shield-named${big ? ' shield-lg' : ''}" title="${t('dt.nameOnly')}"></span>`;
  // Taiwan's expressways, 台61 and up, are provincial highways on a red
  // shield rather than the blue one, and its spurs are signed 甲 乙 丙.
  if (cls === 'shield-twp' && Number(r.base) >= 61) cls = 'shield-twx';
  const cc = countryOf(r.sys);
  let text = cc === 'mx' ? raw.replace(/^0+(?=\d)/, '') : raw;
  if (cc === 'tw') text = text.replace(/[A-G]$/, (s) => STEM[s]);
  text = text.replace(/[<>&]/g, '');
  const title = cc === 'tw' || cc === 'hk' ? routeLabel(r.label) : `${BARE_SHIELD.has(cls) ? '' : `${r.st} `}${text}`;
  return `<span class="shield ${cls}${big ? ' shield-lg' : ''}" title="${title}">${text}</span>`;
}

function renderResults() {
  const host = document.getElementById('results');
  const { total, rows } = searchRoutes(query);
  document.getElementById('resCount').textContent = rows.length
    ? t('search.count', { n: rows.length.toLocaleString(), total: total.toLocaleString() })
    : '';

  // What the list is, when nobody asked it anything. Unsearched, it is the
  // longest roads in whichever systems are switched on, which is a choice the
  // list was making silently - a reader could reasonably have read the opening
  // list as "the important ones" or as all of them.
  const sort = document.getElementById('resSort');
  if (sort) {
    sort.textContent = query ? t('search.sortMatch') : t('search.sortLong');
    sort.title = query ? t('search.sortMatchWhy') : t('search.sortLongWhy');
  }
  const colMi = document.getElementById('resColMi');
  if (colMi) colMi.textContent = lenName();

  if (!rows.length) {
    host.innerHTML = `<p class="res-empty">${query ? t('search.none') : t('search.hint')}</p>`;
    return;
  }

  const frag = document.createDocumentFragment();
  for (const r of rows) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `res${app.selected === r.id ? ' sel' : ''}`;
    b.dataset.id = r.id;
    // What tells this row from the one under it. A jurisdiction's own route
    // wants the jurisdiction; so does any Canadian route, because the
    // Trans-Canada changes number at nearly every border and five different
    // roads are all signed TCH 1. An American national route wants the shape
    // of its run instead, since its number is unique already. And a route
    // sharing a number inside one jurisdiction adds the place that tells the
    // namesakes apart.
    const cc = countryOf(r.sys);
    const byJurisdiction = isPerJuris(r.sys) || isProvince(r.st) || cc === 'hk';
    const count = cc === 'tw'
      ? (r.ns === 1 ? t('sub.county') : t('sub.counties', { n: r.ns }))
      : (r.ns === 1 ? t('sub.state') : t('sub.states', { n: r.ns }));
    const sub = r.where ? `${stateName(r.st)} · ${r.where}`
      : byJurisdiction ? stateName(r.st)
        : count
          + (r.gs == null ? '' : ` · ${r.gs}% ${t('dt.gradeSep').toLowerCase()}`);
    const written = writtenIds.has(r.id)
      ? `<span class="res-pen" title="${t('search.written')}"></span>` : '';
    b.innerHTML = `${shieldHtml(r)}
      <span class="res-txt">
        <span class="res-name">${r.label}${written}</span>
        <span class="res-sub">${sub}</span>
      </span>
      <span class="res-mi">${lenNum(r.mi)}</span>`;
    b.addEventListener('click', () => { setFind(false); select(r.id); });
    frag.appendChild(b);
  }
  host.innerHTML = '';
  host.appendChild(frag);
  findCursor = -1;
  revealSelected(host);
}

/**
 * Open or close the list under the search box.
 *
 * It comes down when the box is used and goes when a route is chosen or the
 * reader looks elsewhere. Closing keeps the query, so coming back to the box
 * finds the list as it was left.
 */
function setFind(open) {
  const shell = document.getElementById('shell');
  if (shell.classList.contains('open') === open) return;
  shell.classList.toggle('open', open);
  document.getElementById('q').setAttribute('aria-expanded', String(open));
  if (open) revealSelected(document.getElementById('results'));
}

let findCursor = -1;
function moveFindCursor(step) {
  const rows = [...document.querySelectorAll('#results .res')];
  if (!rows.length) return;
  findCursor = Math.max(0, Math.min(rows.length - 1, findCursor + step));
  rows.forEach((r, i) => r.classList.toggle('cursor', i === findCursor));
  rows[findCursor].scrollIntoView({ block: 'nearest' });
}

/**
 * Keep the list pointed at whatever the map is showing.
 *
 * Clicking a road on the map opened its panel and marked its row, but the row
 * could be four hundred pixels below the fold, so the list sat on something
 * unrelated and the two halves of the screen disagreed about what was selected.
 *
 * `block: 'nearest'` is doing real work here: it scrolls only when the row is
 * actually out of view, so choosing a row from the list - which re-renders
 * through this same path - does not yank the list around under the pointer.
 * The brief flash is for the other direction, where the row has just arrived
 * from somewhere off-screen and needs to announce itself.
 */
function revealSelected(host) {
  const sel = host.querySelector('.res.sel');
  if (!sel) return;
  const before = host.scrollTop;
  sel.scrollIntoView({ block: 'nearest' });
  if (host.scrollTop !== before) {
    sel.classList.add('just');
    setTimeout(() => sel.classList.remove('just'), 900);
  }
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

/* ── command palette ──────────────────────────────────────────────────── */

const VIEWS = [
  { key: 'numbering', i18n: 'nav.numbering', icon: 'M4 9h16M4 15h16M10 3v18M16 3v18' },
  { key: 'dashboard', i18n: 'nav.dashboard', icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
  { key: 'timeline', i18n: 'nav.timeline', icon: 'M12 7v5l3.5 2' },
  { key: 'docs', i18n: 'nav.docs', icon: 'M6 3h9l4 4v14H6zM9 12h7M9 16h7' },
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
      () => (v.key === 'timeline' ? openTimelapse() : openSheet(v.key)));
    }
  }

  if (rows.length) {
    section(t('pal.routes'));
    for (const r of rows) {
      item(`<span class="ico-w">${shieldHtml(r)}</span>
        <span class="pal-it-txt"><span class="pal-it-name">${r.label}</span>
        <span class="pal-it-sub">${ownerLabel(r.sys, r.st)}${r.where ? ` · ${r.where}` : ''} · ${routeDist(r.mi)}</span></span>`,
      () => select(r.id));
    }
  }

  if (states.length && q) {
    section(t('pal.states'));
    for (const st of states.slice(0, 8)) {
      item(`<span class="ico-w"><svg viewBox="0 0 24 24"><path d="M12 21s7-6.4 7-11a7 7 0 1 0-14 0c0 4.6 7 11 7 11z"/></svg></span>
        <span class="pal-it-txt"><span class="pal-it-name">${stateName(st)}</span>
        <span class="pal-it-sub">${dist(app.stats.byState[st].mi)}</span></span>`,
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
    setFind(true);
  });
  q.addEventListener('focus', () => setFind(true));
  q.addEventListener('pointerdown', () => setFind(true));
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      setFind(true);
      moveFindCursor(e.key === 'ArrowDown' ? 1 : -1);
      e.preventDefault();
    } else if (e.key === 'Enter') {
      const rows = document.querySelectorAll('#results .res');
      rows[Math.max(findCursor, 0)]?.click();
      if (rows.length) q.blur();
      e.preventDefault();
    } else if (e.key === 'Escape' && document.getElementById('shell').classList.contains('open')) {
      setFind(false);
      q.blur();
      e.stopPropagation();
    }
  });
  document.getElementById('qClear').addEventListener('click', () => {
    q.value = ''; query = ''; document.getElementById('qClear').hidden = true; renderResults(); q.focus();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!document.getElementById('shell').contains(e.target)) setFind(false);
  });

  document.getElementById('langSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-lang]');
    if (!b || b.dataset.lang === getLang()) return;
    setLang(b.dataset.lang);
    localStorage.setItem('ia.lang', getLang());
    relabel();
  });

  document.getElementById('unitSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-u]');
    if (!b || b.dataset.u === getUnits()) return;
    setUnits(b.dataset.u);
    localStorage.setItem('ia.units', getUnits());
    app.scale?.setUnit(getUnits());
    relabel();
  });

  document.getElementById('themeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme]');
    if (b) setTheme(b.dataset.theme);
  });

  document.getElementById('btnLegend').addEventListener('click', () => {
    app.legend = !app.legend;
    localStorage.setItem('ia.legend', app.legend ? '1' : '0');
    document.getElementById('btnLegend').classList.toggle('on', app.legend);
    renderLegend();
  });
  // Every switch in the Layers menu is lit by its own module, some of them
  // only once their data has arrived, so the pressed state follows the class
  // rather than each module having to remember it.
  for (const tg of document.querySelectorAll('.menu-tg')) {
    new MutationObserver(() => tg.setAttribute('aria-pressed', String(tg.classList.contains('on'))))
      .observe(tg, { attributes: true, attributeFilter: ['class'] });
  }

  document.getElementById('basemap').addEventListener('click', (e) => {
    const b = e.target.closest('[data-base]');
    if (b) setBasemap(b.dataset.base);
  });

  document.getElementById('btnTerrain').addEventListener('click', () => toggleTerrain());
  document.getElementById('btnCrossings').addEventListener('click', () => toggleCrossings());
  document.getElementById('btnTolls').addEventListener('click', () => toggleTolls());
  document.getElementById('btnBridges').addEventListener('click', () => toggleBridges());
  document.getElementById('btnZen').addEventListener('click', () => toggleZen());
  document.getElementById('zenOut').addEventListener('click', () => toggleZen(false));
  // A menu closes on a second press, on Escape and on any press outside it.
  // The views menu also closes once a view is picked; the layers menu stays,
  // because layers are switched several at a time.
  const menus = [...document.querySelectorAll('.menu')];
  const setMenu = (menu, open) => {
    menu.classList.toggle('open', open);
    menu.querySelector('[aria-haspopup]').setAttribute('aria-expanded', String(open));
  };
  const toggleMenu = (menu) => {
    const open = !menu.classList.contains('open');
    for (const m of menus) setMenu(m, false);
    setMenu(menu, open);
    if (open && menu.id === 'menuLayers') countOverlays();
  };
  for (const menu of menus) {
    menu.querySelector('[aria-haspopup]').addEventListener('click', () => toggleMenu(menu));
  }
  const MENU_KEYS = { l: 'menuLayers', s: 'menuSettings', m: 'menuMore' };
  document.addEventListener('pointerdown', (e) => {
    for (const m of menus) if (!m.contains(e.target)) setMenu(m, false);
  });
  // An open menu takes the Escape for itself, so closing it does not also
  // drop the selected route behind it.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = menus.filter((m) => m.classList.contains('open'));
    if (!open.length) return;
    for (const m of open) setMenu(m, false);
    e.stopImmediatePropagation();
  });
  for (const it of document.querySelectorAll('#menuMore .menu-it, #btnZen')) {
    it.addEventListener('click', () => { for (const m of menus) setMenu(m, false); });
  }

  for (const [btn, key] of [['btnNumbering', 'numbering'], ['btnDash', 'dashboard'],
    ['btnDocs', 'docs'], ['btnAbout', 'about']]) {
    document.getElementById(btn).addEventListener('click', () => openSheet(key));
  }
  // The buildout view docks over the map instead of opening a sheet, because
  // a modal that covers the map cannot show the map changing.
  // openTimelapse toggles, and it owns the button's lit state so that closing
  // from the scrubber's own dismiss button leaves the two in step.
  document.getElementById('btnTimeline').addEventListener('click', openTimelapse);
  document.getElementById('btnPalette').addEventListener('click', () => openPalette());

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
      // Ahead of the rest, because with the interface hidden it is the only
      // state the reader can see they are in.
      if (isZen()) toggleZen(false);
      else if (isSheetOpen()) closeSheet();
      else if (isFlying()) stopFly();
      else if (app.selected) clearSelection();
      return;
    }
    if (typing) return;
    if (MENU_KEYS[e.key] && !e.metaKey && !e.ctrlKey && !e.altKey && !isZen()) {
      toggleMenu(document.getElementById(MENU_KEYS[e.key]));
      return;
    }
    if (e.key === 'f' && app.selected) startFly(app.selected);
    if (e.key === 't') toggleTerrain();
    if (e.key === '3') toggleTerrain();
    if (e.key === 'z') toggleZen();
  });
}

/* ── start ────────────────────────────────────────────────────────────── */

async function main() {
  setLang(localStorage.getItem('ia.lang') || (navigator.language.startsWith('zh') ? 'zh' : 'en'));
  setUnits(localStorage.getItem('ia.units') || defaultUnits());
  app.legend = localStorage.getItem('ia.legend') !== '0';
  document.getElementById('btnLegend').classList.toggle('on', app.legend);
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
  const startOn = SYSTEMS.filter((s) => s.on && !s.perJuris);
  const payloads = await Promise.all(
    startOn.map((s) => fetch(`${GEO}/${geoPath(s.id)}`).then((r) => r.json())),
  );
  startOn.forEach((s, i) => {
    app.loaded.add(s.id);
    addSystemLayers(s.id, payloads[i]);
  });
  ensureSelectionLayers();
  renderMapLabels();

  boot(86, 'boot.step.ready');
  renderSystems();
  wireRegions();
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
