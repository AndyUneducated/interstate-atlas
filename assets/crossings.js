/* Land border crossings, as a layer that can be switched on over the routes.

   Two registers, one per side of the continent, and neither is the whole
   story. Canada's is the CBSA office directory, filtered to the offices that
   handle highway traffic; the directory gives an address, not a point, so each
   is placed by Natural Resources Canada's geocoder, and the popup says how
   closely. Mexico's is INDAABIN's list of federal border ports, which carries
   coordinates. Neither says which road a crossing is on, so the routes listed
   with one are simply the atlas routes nearest it, and are labelled that way. */

import { t, stateName, distKm, routeLabel, ownerLabel, getUnits } from './i18n.js';
import { app, toast, select } from './app.js';

const SRC = 'xing';
const HIT = `${SRC}-hit`;
const COLOUR = { 'ca-us': '#ff4d6d', 'mx-us': '#9be15d', 'mx-gt': '#4cc9f0', 'mx-bz': '#f9c74f' };

let on = false;
let data = null;
let popup = null;

export function isCrossingsOn() { return on; }

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** True when a crossing is under the pointer, so a route beneath it leaves the click alone. */
export function crossingAt(point) {
  const map = app.map;
  return on && map.getLayer(HIT) ? map.queryRenderedFeatures(point, { layers: [HIT] }).length > 0 : false;
}

/** Keep the crossings above route layers that are added after them. */
export function raiseCrossings() {
  const map = app.map;
  for (const id of [`${SRC}-halo`, SRC, HIT]) if (map?.getLayer(id)) map.moveLayer(id);
}

async function ensureLayers() {
  const map = app.map;
  if (map.getSource(SRC)) return;
  data = await (await fetch('data/crossings.json')).json();
  map.addSource(SRC, { type: 'geojson', data, promoteId: 'id' });
  const colour = ['match', ['get', 'border'], ...Object.entries(COLOUR).flat(), '#ffffff'];
  map.addLayer({
    id: `${SRC}-halo`, type: 'circle', source: SRC,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 5, 10, 13],
      'circle-color': colour, 'circle-opacity': 0.18, 'circle-blur': 0.6,
    },
  });
  map.addLayer({
    id: SRC, type: 'circle', source: SRC,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 2.2, 10, 5.5],
      'circle-color': '#05070c',
      'circle-stroke-color': colour,
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 3, 1.2, 10, 2.4],
    },
  });
  // Invisible and larger, for a target that can be hit at continental zoom.
  map.addLayer({
    id: HIT, type: 'circle', source: SRC,
    paint: { 'circle-radius': 10, 'circle-opacity': 0 },
  });
  map.on('mouseenter', HIT, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', HIT, () => { map.getCanvas().style.cursor = ''; });
  map.on('click', HIT, (e) => {
    const f = e.features?.[0];
    if (f) openCrossing(f.properties.id);
  });
}

export async function toggleCrossings(force) {
  const next = force ?? !on;
  if (next) await ensureLayers();
  on = next;
  for (const id of [`${SRC}-halo`, SRC, HIT]) {
    if (app.map.getLayer(id)) app.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }
  if (!on) closeCrossing();
  document.getElementById('btnCrossings').classList.toggle('on', on);
  toast(on ? t('toast.xingOn', { n: data.features.length }) : t('toast.xingOff'));
}

export function closeCrossing() {
  popup?.remove();
  popup = null;
}

function sourceLine(p) {
  if (p.by === 'source') return t('xing.by.source');
  if (p.by === 'highway') return t('xing.by.highway');
  return t('xing.by.geocode', { precision: t(`xing.precision.${p.precision}`) });
}

function html(p) {
  const where = [
    p.counterpart ? t('xing.opposite', { place: esc(p.counterpart) }) : null,
    p.juris ? esc(stateName(p.juris)) : null,
  ].filter(Boolean).join(' · ');
  const near = (p.near ?? []).map((r) => {
    const meta = app.byId.get(r.id);
    const owner = meta ? ownerLabel(meta.sys, meta.st) : '';
    return `<button class="xg-r" type="button" data-id="${esc(r.id)}">`
      + `<b>${esc(routeLabel(r.label))}</b><span>${esc(owner)}</span><em>${esc(distKm(r.km, 1))}</em></button>`;
  }).join('');
  return `<div class="xg">
    <div class="xg-k" style="--c:${COLOUR[p.border] ?? '#fff'}">${esc(t(`xing.border.${p.border}`))}</div>
    <div class="xg-n">${esc(p.name)}</div>
    ${where ? `<div class="xg-w">${where}</div>` : ''}
    <div class="xg-s">${esc(sourceLine(p))}</div>
    <div class="xg-h">${esc(t('xing.near', { d: distKm(data.nearKm, getUnits() === 'metric' ? 0 : 1) }))}</div>
    ${near || `<div class="xg-none">${esc(t('xing.nearNone'))}</div>`}
    <div class="xg-f">${esc(t('xing.nearNote'))}</div>
  </div>`;
}

function openCrossing(id) {
  const f = data.features.find((x) => x.properties.id === id);
  if (!f) return;
  closeCrossing();
  const p = new maplibregl.Popup({ className: 'xg-pop', maxWidth: '300px', offset: 10 })
    .setLngLat(f.geometry.coordinates)
    .setHTML(html(f.properties))
    .addTo(app.map);
  p.getElement().addEventListener('click', (e) => {
    const b = e.target.closest('.xg-r');
    if (b) select(b.dataset.id);
  });
  p.on('close', () => { if (popup === p) popup = null; });
  popup = p;
}
