/* Bridges, as a layer that can be switched on over the routes.

   Two inventories, and they are not the continent: Mexico's federal free
   network from SICT, and Ontario's provincial structures, culverts among them,
   from its Ministry of Transportation. Each structure is coloured by the year
   its owner says it was built. That year belongs to the structure; a bridge
   built in 1998 on a road opened in 1952 dates a replacement, so the popup
   never offers it as the road's age. */

import { t, num, getUnits } from './i18n.js';
import { app, toast } from './app.js';

const SRC = 'bridge';
const HIT = `${SRC}-hit`;
const LAYERS = [SRC, HIT];
const UNDATED = '#8a8f98';

let on = false;
let dataPromise = null;
let data = null;
let popup = null;

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
      return d;
    });
  return dataPromise;
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
        ['interpolate', ['linear'], built, 1930, '#ff7b54', 1965, '#ffd166', 1995, '#9be15d', 2025, '#4cc9f0']],
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
  toast(on ? t('toast.bridgeOn', { n: num(data.rows.length) }) : t('toast.bridgeOff'));
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
    ? `${num(len, len < 100 ? 1 : 0)} m`
    : `${num(len * 3.28084)} ft`;
  const where = [
    r[F.route] ? t('bridge.route', { r: esc(r[F.route]) }) : null,
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
  if (len != null) rows.push(t('bridge.length', { d: metres }));
  const kind = r[F.kind] ? t(`bridge.kind.${r[F.kind]}`) : t('bridge.kind.bridge');
  return `<div class="xg">
    <div class="xg-k" style="--c:#ffd166">${esc(kind)}</div>
    <div class="xg-n">${esc(r[F.name] ?? '')}</div>
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
