/* Land border crossings, as a layer that can be switched on over the routes.

   Three registers, and none is the whole story. Canada's is the CBSA office directory, filtered to the offices that
   handle highway traffic; the directory gives an address, not a point, so each
   is placed by Natural Resources Canada's geocoder, and the popup says how
   closely. Mexico's is INDAABIN's list of federal border ports, which carries
   coordinates. The mainland's is the National Office of Port Administration's
   list of highway ports, names only, each placed from OpenStreetMap at its
   border-control point or a feature named for it. None says which road a
   crossing is on, so the routes listed with one are simply the atlas routes
   nearest it, and are labelled that way. */

import { t, stateName, distKm, routeLabel, ownerLabel, getUnits, getLang } from './i18n.js';
import { app, toast, select, renderLegend } from './app.js';

const SRC = 'xing';
const HIT = `${SRC}-hit`;
// Kept off the bridges' year ramp (orange to yellow to green to cyan) and the
// tolls' yellow, since all three can be on over Mexico at once.
// The mainland's land borders share one colour, which the popup's heading
// spells out; Hong Kong and Macao have their own.
const CN_LAND = '#ff4d6d';
const CN_LAND_BORDERS = ['cn-ru', 'cn-mn', 'cn-kp', 'cn-vn', 'cn-la', 'cn-mm', 'cn-np', 'cn-kz', 'cn-kg', 'cn-tj', 'cn-pk'];
const COLOUR = {
  'ca-us': '#ff4d6d', 'mx-us': '#b06cff', 'mx-gt': '#3a56ff', 'mx-bz': '#ff4fd8',
  'cn-hk': '#b06cff', 'cn-mo': '#ff4fd8',
  ...Object.fromEntries(CN_LAND_BORDERS.map((b) => [b, CN_LAND])),
};
const LEGEND = [
  { region: 'na', key: 'ca-us', colour: COLOUR['ca-us'] },
  { region: 'na', key: 'mx-us', colour: COLOUR['mx-us'] },
  { region: 'na', key: 'mx-gt', colour: COLOUR['mx-gt'] },
  { region: 'na', key: 'mx-bz', colour: COLOUR['mx-bz'] },
  { region: 'ea', key: 'cn-land', colour: CN_LAND },
  { region: 'ea', key: 'cn-hk', colour: COLOUR['cn-hk'] },
  { region: 'ea', key: 'cn-mo', colour: COLOUR['cn-mo'] },
];

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
  renderLegend();
  const ea = app.region === 'ea';
  const n = data.features.filter((f) => (f.properties.country === 'cn') === ea).length;
  toast(on ? t(ea ? 'toast.xingOnEa' : 'toast.xingOn', { n }) : t('toast.xingOff'));
}

/** This layer's part of the colour key: the borders that touch the region on screen. */
export function crossingsLegend() {
  const rows = LEGEND.filter((r) => r.region === app.region);
  if (!on || !rows.length) return '';
  return `<div class="lg-b"><p class="lg-h">${t('base.crossings')}</p>`
    + rows.map((r) => `<p class="lg-r"><i class="lg-ring" style="--sys-col:${r.colour}"></i><span>${t(`xing.border.${r.key}`)}</span></p>`).join('')
    + '</div>';
}

export function closeCrossing() {
  popup?.remove();
  popup = null;
}

function sourceLine(p) {
  if (p.by === 'osm') return t(`xing.by.osm.${p.precision}`);
  if (p.by === 'source') return t('xing.by.source');
  if (p.by === 'highway') return t('xing.by.highway');
  return t('xing.by.geocode', { precision: t(`xing.precision.${p.precision}`) });
}

function html(p) {
  const zh = getLang() === 'zh';
  const opposite = zh && p.counterpartZh ? p.counterpartZh : p.counterpart;
  const where = [
    opposite ? t('xing.opposite', { place: esc(opposite) }) : null,
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
    <div class="xg-n">${esc(zh && p.nameZh ? p.nameZh : p.name)}</div>
    ${where ? `<div class="xg-w">${where}</div>` : ''}
    <div class="xg-s">${esc(sourceLine(p))}</div>
    ${p.far ? `<div class="xg-s">${esc(t('xing.far', { d: distKm(p.borderKm, 0) }))}</div>` : ''}
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
