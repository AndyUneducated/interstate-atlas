/* Bridges, as a layer that can be switched on over the routes.

   Four inventories, and they are not the continent: Mexico's federal free
   network from SICT, the provincial structures of Ontario and Quebec, culverts
   among them, from their transport ministries, and FHWA's National Bridge
   Inventory, kept to the bridges that carry an atlas route and loaded a state
   at a time once the map is close enough to draw them. Each structure is coloured by the year
   its owner says it was built. That year belongs to the structure; a bridge
   built in 1998 on a road opened in 1952 dates a replacement, so the popup
   never offers it as the road's age. */

import { t, num, getUnits } from './i18n.js';
import { app, toast, renderLegend } from './app.js';
import { regionOf } from './schema.js';

const SRC = 'bridge';
const HIT = `${SRC}-hit`;
const LAYERS = [SRC, HIT];
const UNDATED = '#8a8f98';
const STOPS = [[1930, '#ff7b54'], [1965, '#ffd166'], [1995, '#9be15d'], [2025, '#4cc9f0']];
const COUNTRIES = ['mx', 'ca', 'us'];
// The American inventory is a file per state, too many structures to draw at
// continental zoom; the states in view load from here in.
const US_MIN_ZOOM = 7;

let on = false;
let dataPromise = null;
let data = null;
let popup = null;
let us = null;
const usLoaded = new Set();

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function load() {
  dataPromise ||= fetch('data/bridges.json').then((r) => (r.ok ? r.json() : null)).catch(() => null)
    .then((d) => {
      if (!d) return null;
      const F = Object.fromEntries(d.fields.map((f, i) => [f, i]));
      d.geojson = {
        type: 'FeatureCollection',
        features: d.rows.map((r, i) => ({
          type: 'Feature', id: i,
          properties: { i, built: r[F.built] ?? -1 },
          geometry: { type: 'Point', coordinates: [r[F.lon], r[F.lat]] },
        })),
      };
      d.F = F;
      data = d;
      return fetch('data/bridges/us/index.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
    })
    .then((u) => {
      if (u && data) {
        us = { ...u, set: data.sets.length };
        data.sets.push(u.set);
      }
      return data;
    });
  return dataPromise;
}

/** Adds the American states in view to the layer, once each. */
async function loadUsInView() {
  const map = app.map;
  if (!on || !us || app.region !== 'na' || map.getZoom() < US_MIN_ZOOM) return;
  const b = map.getBounds();
  const want = Object.entries(us.states).filter(([st, s]) => !usLoaded.has(st)
    && s.bbox[0] <= b.getEast() && s.bbox[2] >= b.getWest() && s.bbox[1] <= b.getNorth() && s.bbox[3] >= b.getSouth());
  if (!want.length) return;
  for (const [st] of want) usLoaded.add(st);
  const files = await Promise.all(want.map(([st]) => fetch(`data/bridges/us/${st}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
  const F = data.F;
  for (const file of files) {
    if (!file) continue;
    const G = Object.fromEntries(file.fields.map((f, i) => [f, i]));
    for (const r of file.rows) {
      const row = new Array(data.fields.length).fill(null);
      row[F.lon] = r[G.lon]; row[F.lat] = r[G.lat]; row[F.set] = us.set;
      row[F.route] = app.byId.get(file.routes[r[G.route]])?.label ?? null;
      row[F.built] = r[G.built]; row[F.rebuilt] = r[G.rebuilt]; row[F.lengthM] = r[G.lengthM];
      row[F.kind] = r[G.kind]; row[F.over] = r[G.over];
      const i = data.rows.length;
      data.rows.push(row);
      data.geojson.features.push({
        type: 'Feature', id: i,
        properties: { i, built: row[F.built] ?? -1 },
        geometry: { type: 'Point', coordinates: [row[F.lon], row[F.lat]] },
      });
    }
  }
  map.getSource(SRC)?.setData(data.geojson);
}

/** True when a bridge is under the pointer, so a route beneath it leaves the click alone. */
export function bridgeAt(point) {
  const map = app.map;
  return on && map.getLayer(HIT) ? map.queryRenderedFeatures(point, { layers: [HIT] }).length > 0 : false;
}

export function raiseBridges() {
  const map = app.map;
  for (const id of LAYERS) if (map?.getLayer(id)) map.moveLayer(id);
}

async function ensureLayers() {
  const map = app.map;
  if (map.getSource(SRC)) return;
  await load();
  if (!data) return;
  map.addSource(SRC, { type: 'geojson', data: data.geojson });
  const built = ['get', 'built'];
  map.addLayer({
    id: SRC, type: 'circle', source: SRC,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 1.1, 7, 2.4, 12, 5],
      'circle-color': ['case', ['<', built, 0], UNDATED,
        ['interpolate', ['linear'], built, ...STOPS.flat()]],
      'circle-stroke-color': '#05070c',
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 6, 0, 9, 0.8],
    },
  });
  map.addLayer({ id: HIT, type: 'circle', source: SRC, minzoom: 6, paint: { 'circle-radius': 7, 'circle-opacity': 0 } });
  map.on('mouseenter', HIT, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', HIT, () => { map.getCanvas().style.cursor = ''; });
  map.on('click', HIT, (e) => {
    const f = e.features?.[0];
    if (f) openBridge(f.properties.i, e.lngLat);
  });
  let wasNear = map.getZoom() >= US_MIN_ZOOM;
  map.on('moveend', () => {
    if (!on) return;
    loadUsInView();
    const near = map.getZoom() >= US_MIN_ZOOM;
    if (near !== wasNear) { wasNear = near; renderLegend(); }
  });
}

export async function toggleBridges(force) {
  const next = force ?? !on;
  if (next) await ensureLayers();
  if (next && !data) { toast(t('bridge.unavailable')); return; }
  on = next;
  for (const id of LAYERS) {
    if (app.map.getLayer(id)) app.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }
  if (!on) closeBridge();
  document.getElementById('btnBridges').classList.toggle('on', on);
  renderLegend();
  const usTotal = us ? Object.values(us.states).reduce((a, s) => a + s.n, 0) : 0;
  const shown = data.rows.filter((r) => r[data.F.set] !== us?.set).length;
  toast(on ? t('toast.bridgeOn', { n: num(shown), us: num(usTotal) }) : t('toast.bridgeOff'));
  if (on) loadUsInView();
}

/** This layer's part of the colour key: empty while it is off, or over a region it has no bridges in. */
export function bridgesLegend() {
  if (!on || !COUNTRIES.some((cc) => regionOf(cc) === app.region)) return '';
  const [y0] = STOPS[0];
  const [y1] = STOPS.at(-1);
  const at = (y) => (((y - y0) / (y1 - y0)) * 100).toFixed(1);
  const ramp = STOPS.map(([y, c]) => `${c} ${at(y)}%`).join(', ');
  // Older structures take the first colour, so the first tick reads as "or earlier".
  return `<div class="lg-b"><p class="lg-h">${t('lg.bridges')}</p>
    <div class="lg-ramp" style="background:linear-gradient(90deg, ${ramp})"></div>
    <div class="lg-ticks lg-at">${STOPS.map(([y], i) => `<span style="left:${at(y)}%">${i ? y : `≤${y}`}</span>`).join('')}</div>
    <p class="lg-r"><i class="lg-pt" style="--sys-col:${UNDATED}"></i><span>${t('bridge.undated')}</span></p>
    ${app.region === 'na' && us && app.map.getZoom() < US_MIN_ZOOM ? `<p class="lg-r"><span>${t('bridge.usZoom')}</span></p>` : ''}</div>`;
}

export function closeBridge() {
  popup?.remove();
  popup = null;
}

function html(r) {
  const F = data.F;
  const set = data.sets[r[F.set]];
  const len = r[F.lengthM];
  const metres = getUnits() === 'metric'
    ? `${num(len, len < 100 ? 1 : 0)} ${t('unit.m')}`
    : `${num(len * 3.28084)} ${t('unit.ft')}`;
  const where = [
    r[F.route] && r[F.name] ? t('bridge.route', { r: esc(r[F.route]) }) : null,
    r[F.road] != null ? `<span lang="es">${esc(data.roads[r[F.road]])}</span>` : null,
    r[F.at] ? t('bridge.at', { km: esc(r[F.at]) }) : null,
  ].filter(Boolean).join(' · ');
  const rows = [];
  if (r[F.built] != null) {
    rows.push(t('bridge.built', { y: r[F.built] })
      + (r[F.rebuilt] != null ? ` · ${t('bridge.rebuilt', { y: r[F.rebuilt] })}` : ''));
  } else {
    rows.push(t('bridge.undated'));
  }
  if (F.over != null && r[F.over]) rows.push(t('bridge.over', { o: r[F.over] }));
  if (len != null) rows.push(t('bridge.length', { d: metres }));
  const kind = r[F.kind] ? t(`bridge.kind.${r[F.kind]}`) : t('bridge.kind.bridge');
  return `<div class="xg">
    <div class="xg-k" style="--c:#ffd166">${esc(kind)}</div>
    <div class="xg-n">${esc(r[F.name] ?? (r[F.route] ? t('bridge.route', { r: r[F.route] }) : ''))}</div>
    ${where ? `<div class="xg-w">${where}</div>` : ''}
    ${rows.map((x) => `<div class="xg-s">${esc(x)}</div>`).join('')}
    <div class="xg-f">${esc(t('bridge.note'))}</div>
    <div class="xg-f"><a href="${esc(set.url)}" target="_blank" rel="noopener">${esc(set.source)}</a> · ${esc(set.licence)}</div>
  </div>`;
}

function openBridge(i, lngLat) {
  const r = data.rows[i];
  if (!r) return;
  closeBridge();
  const p = new maplibregl.Popup({ className: 'xg-pop', maxWidth: '300px', offset: 8 })
    .setLngLat(lngLat)
    .setHTML(html(r))
    .addTo(app.map);
  p.on('close', () => { if (popup === p) popup = null; });
  popup = p;
}
