/* Interstate Atlas — map surface, route selection, search.
   Detail panel, overlay sheets and the flythrough live in their own modules. */

import { t, setLang, getLang, stateName, miles } from './i18n.js';
import { renderDetail } from './detail.js';
import { openSheet, closeSheet, isSheetOpen, refreshPlannerIfOpen } from './sheets.js';
import { startFly, stopFly, isFlying } from './fly.js';

const SYSTEMS = [
  { id: 'interstate', code: 'i', colour: '#35e7ff', src: 'data/geo/interstate.json', on: true },
  { id: 'us', code: 'u', colour: '#ffb545', src: 'data/geo/us.json', on: false },
  { id: 'state', code: 's', colour: '#a98bff', src: null, on: false },
];

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
  document.getElementById('q').placeholder = t('search.placeholder');
  document.getElementById('palQ').placeholder = t('pal.placeholder');
  document.getElementById('btnLang').title = t('nav.langTitle');
  document.getElementById('bootTitle').textContent = t('boot.title');
  document.getElementById('bootSub').textContent = t('boot.sub');
  document.title = getLang() === 'zh'
    ? '美国公路图谱 — 美国国家公路网'
    : 'Interstate Atlas — the highway network of the United States';
}

export function relabel() {
  applyStaticStrings();
  renderSystems();
  renderResults();
  if (app.selected) renderDetail(app.selected);
  if (isSheetOpen()) openSheet(isSheetOpen());
  renderMapLabels();
}

/* ── data ─────────────────────────────────────────────────────────────── */

async function loadIndex() {
  const res = await fetch('data/index.json');
  const raw = await res.json();
  const sysOf = { i: 'interstate', u: 'us', s: 'state' };
  const tierOf = { p: 'primary', a: 'auxiliary', x: 'special', s: 'state' };
  app.index = raw.routes.map(([id, label, sys, tier, st, mi, base, num, cx, cy, gs, ns]) => ({
    id, label, sys: sysOf[sys], tier: tierOf[tier], st, mi, base, num, cx, cy, gs, ns,
    // Pre-lowered haystack so keystroke filtering stays cheap across 7,500 rows.
    hay: `${label} ${num} ${st}`.toLowerCase(),
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

const US_BOUNDS = [[-125.5, 24.2], [-66.4, 49.6]];

function buildMap() {
  const map = new maplibregl.Map({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/dark',
    bounds: US_BOUNDS,
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
    minzoom: sys === 'state' ? 7.5 : 5,
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

async function enableSystem(sys) {
  const s = app.systems.get(sys);
  s.on = true;
  if (sys === 'state') {
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
  if (sys === 'state') {
    for (const st of app.stateLoaded) setStateVisible(st, false);
  } else {
    setSystemVisible(sys, false);
  }
  renderSystems();
  renderResults();
}

/* state routes load one jurisdiction at a time */

export async function loadState(st) {
  if (app.stateLoaded.has(st)) { setStateVisible(st, true); return; }
  toast(t('toast.loadingState', { state: stateName(st) }));
  const data = await (await fetch(`data/geo/state/${st}.json`)).json();
  app.stateLoaded.add(st);
  addStateLayers(st, data);
  app.systems.get('state').on = true;
  renderSystems();
  renderResults();
}

function addStateLayers(st, data) {
  const map = app.map;
  const srcId = `st-${st}`;
  const colour = lineColour('state');
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
  const srcId = meta.sys === 'state' ? `st-${meta.st}` : `rt-${meta.sys}`;
  const src = app.map.getSource(srcId);
  const data = src?._data;
  if (!data?.features) return null;
  return data.features.find((f) => f.properties.id === id) || null;
}

export async function select(id, { feature = null, fit = true } = {}) {
  const meta = app.byId.get(id);
  if (!meta) return;

  if (meta.sys === 'state' && !app.stateLoaded.has(meta.st)) await loadState(meta.st);
  else if (meta.sys !== 'state' && !app.loaded.has(meta.sys)) await enableSystem(meta.sys);

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
  const wide = window.innerWidth > 900;
  app.map.fitBounds([[minX, minY], [maxX, maxY]], {
    padding: { top: 90, bottom: 70, left: wide ? 400 : 30, right: wide ? 470 : 30 },
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

export function toggleTerrain(force) {
  const map = app.map;
  const next = force ?? !app.terrain;
  if (next && !map.getSource('dem')) {
    // AWS terrain tiles: terrarium encoding, public, no key required.
    map.addSource('dem', {
      type: 'raster-dem',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 13,
      attribution: 'Terrain: Mapzen / AWS Open Data',
    });
  }
  app.terrain = next;
  map.setTerrain(next ? { source: 'dem', exaggeration: 1.35 } : null);
  if (next && map.getPitch() < 25) map.easeTo({ pitch: 58, duration: 1100 });
  if (!next) map.easeTo({ pitch: 0, duration: 900 });
  document.getElementById('btnTerrain').classList.toggle('on', next);
  toast(t(next ? 'toast.terrainOn' : 'toast.terrainOff'));
}

/* ── systems panel ────────────────────────────────────────────────────── */

function renderSystems() {
  const host = document.getElementById('sysList');
  const counts = {};
  for (const r of app.index) counts[r.sys] = (counts[r.sys] || 0) + 1;
  const milesBy = app.stats?.bySystem || {};

  host.innerHTML = '';
  for (const s of SYSTEMS) {
    const live = app.systems.get(s.id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `sys${live.on ? ' on' : ''}`;
    btn.dataset.sys = s.id;
    const mi = milesBy[s.id]?.mi;
    btn.innerHTML = `
      <span class="sys-dot"></span>
      <span class="sys-txt">
        <span class="sys-name">${t(`sys.${s.id}`)}</span>
        <span class="sys-meta">${t(`sys.${s.id}.meta`)}${mi ? ` · ${miles(mi)}` : ''}</span>
      </span>
      <span class="sys-count">${t('sys.routes', { n: (counts[s.id] || 0).toLocaleString() })}</span>`;
    btn.addEventListener('click', () => {
      if (s.id === 'state') {
        openSheet('states');
        return;
      }
      if (app.systems.get(s.id).on) disableSystem(s.id);
      else enableSystem(s.id);
    });
    host.appendChild(btn);
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
  const out = [];
  for (const r of app.index) {
    if (systemsOnly && !app.systems.get(r.sys).on) continue;
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

export function shieldHtml(r, big = false) {
  const cls = r.sys === 'interstate' ? 'shield-i' : r.sys === 'us' ? 'shield-us' : 'shield-st';
  const text = r.sys === 'state' ? `${r.st}·${r.num}` : r.num;
  return `<span class="shield ${cls}${big ? ' shield-lg' : ''}">${text}</span>`;
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
    const sub = r.sys === 'state'
      ? stateName(r.st)
      : `${r.ns} ${t('dt.states').toLowerCase()} · ${r.gs}% ${t('dt.gradeSep').toLowerCase()}`;
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
        <span class="pal-it-sub">${r.sys === 'state' ? stateName(r.st) : t(`sys.${r.sys}`)} · ${miles(r.mi)}</span></span>`,
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
    padding: { top: 90, bottom: 70, left: window.innerWidth > 900 ? 400 : 30, right: 80 },
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

  document.getElementById('btnCollapse').addEventListener('click', () => {
    document.getElementById('shell').classList.toggle('hidden');
  });

  document.getElementById('btnTerrain').addEventListener('click', () => toggleTerrain());
  document.getElementById('btnPalette').addEventListener('click', openPalette);
  for (const [btn, key] of [['btnNumbering', 'numbering'], ['btnDash', 'dashboard'],
    ['btnTimeline', 'timeline'], ['btnPlanner', 'planner'], ['btnAbout', 'about']]) {
    document.getElementById(btn).addEventListener('click', () => openSheet(key));
  }

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

  const interstate = await (await fetch('data/geo/interstate.json')).json();
  app.loaded.add('interstate');
  addSystemLayers('interstate', interstate);
  ensureSelectionLayers();
  renderMapLabels();

  boot(86, 'boot.step.ready');
  renderSystems();
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
