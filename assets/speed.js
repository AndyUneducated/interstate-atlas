/* Speed limits, as a way of colouring the routes already on the map.

   One figure per route, from data/speed.json, in three tiers that are always
   named: the agencies' own posted limits (the United States and Canada),
   OpenStreetMap's where those publish none, and the law's default for the
   class of road where neither covers it. A default is drawn fainter than a
   reading, and a route with no source at all is grey rather than guessed.

   The figure belongs to the whole route, so a road signed 120 for most of its
   length and 80 through a city is drawn 120. The route panel shows the rest. */

import { t, num, getUnits } from './i18n.js';
import { app, toast, renderLegend } from './app.js';

const KM_PER_MI = 1.609344;
export const UNKNOWN = '#7b8494';
/** The colour ramp, in km/h. Most of every network is signed between 90 and
 *  120, so that is where the hues change fastest. */
export const RAMP = [[50, '#3b82f6'], [70, '#06b6d4'], [90, '#22c55e'], [100, '#eab308'], [110, '#f97316'], [120, '#ef4444']];
/** The bands the statistics are kept in, as build-speed.mjs writes them. */
export const BANDS = [40, 50, 60, 70, 80, 90, 100, 110, 120];

let on = false;
let dataPromise = null;
let data = null;
// Every route source on the map and the ids in it, so a source added after the
// switch is thrown is coloured as it arrives, and one switched off is restored.
const sources = new Map();
const saved = new Map();

export function loadSpeed() {
  dataPromise ||= fetch('data/speed.json').then((r) => (r.ok ? r.json() : null)).catch(() => null)
    .then((d) => { data = d; return d; });
  return dataPromise;
}

export const speedOn = () => on;

/** A route's limit: { kph, src: 'p'|'o'|'l', cov, bins }, or null. */
export async function speedOf(id) {
  const d = await loadSpeed();
  const r = d?.routes[id];
  return r ? { kph: r[0], src: r[1], cov: r[2], bins: r[3] || null } : null;
}

export function speedColour(kph) {
  if (!kph) return UNKNOWN;
  if (kph <= RAMP[0][0]) return RAMP[0][1];
  for (let i = 1; i < RAMP.length; i++) {
    const [k1, c1] = RAMP[i];
    if (kph <= k1) {
      const [k0, c0] = RAMP[i - 1];
      return mix(c0, c1, (kph - k0) / (k1 - k0));
    }
  }
  return RAMP.at(-1)[1];
}
function mix(a, b, f) {
  const p = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map((i) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * f).toString(16).padStart(2, '0')).join('')}`;
}

/** A limit in the reader's unit; mph are rounded to the 5 they are signed in. */
export function speedNum(kph) {
  if (getUnits() === 'metric') return num(kph);
  return num(Math.round(kph / KM_PER_MI));
}
export function bandLabel(kph) {
  return getUnits() === 'metric' ? num(kph) : num(Math.round(kph / KM_PER_MI / 5) * 5);
}
export const speedUnit = () => t(getUnits() === 'metric' ? 'unit.kph' : 'unit.mph');

const K = ['coalesce', ['feature-state', 'kph'], 0];
const COLOUR = ['case', ['>', K, 0], ['interpolate', ['linear'], K, ...RAMP.flat()], UNKNOWN];
const FADE = ['match', ['coalesce', ['feature-state', 'src'], 'u'], 'l', 0.5, 'u', 0.3, 1];

function paint(srcId) {
  const map = app.map;
  for (const id of [srcId, `${srcId}-glow`]) {
    if (!map.getLayer(id)) continue;
    if (!saved.has(id)) saved.set(id, { c: map.getPaintProperty(id, 'line-color'), o: map.getPaintProperty(id, 'line-opacity') });
    const was = saved.get(id);
    map.setPaintProperty(id, 'line-color', on ? COLOUR : was.c);
    map.setPaintProperty(id, 'line-opacity', on ? ['*', was.o ?? 1, FADE] : was.o);
  }
}

function stamp(srcId) {
  const ids = sources.get(srcId);
  if (!ids || !data) return;
  for (const id of ids) {
    const r = data.routes[id];
    app.map.setFeatureState({ source: srcId, id }, r ? { kph: r[0], src: r[1] } : { kph: 0, src: 'u' });
  }
}

/** Called for every route source as it is added, with the data it was added with. */
export function trackSource(srcId, fc) {
  sources.set(srcId, (fc.features || []).map((f) => f.properties?.id).filter(Boolean));
  if (on) { stamp(srcId); paint(srcId); }
}

export async function toggleSpeed(force) {
  const next = force ?? !on;
  if (next && !await loadSpeed()) { toast(t('spd.unavailable')); return; }
  on = next;
  for (const srcId of sources.keys()) {
    if (on) stamp(srcId);
    paint(srcId);
  }
  const n = Object.keys(data.routes).length;
  const btn = document.getElementById('btnSpeed');
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', String(on));
  const count = btn.querySelector('[data-count]');
  count.dataset.n = n;
  count.textContent = num(n);
  renderLegend();
  toast(on ? t('toast.speedOn', { n: num(n) }) : t('toast.speedOff'));
}

/** The key, which replaces the system key while the routes are coloured by limit. */
export function speedLegend() {
  const stops = RAMP.map(([k, c], i) => `${c} ${((i / (RAMP.length - 1)) * 100).toFixed(0)}%`).join(', ');
  return `<p class="lg-h">${t('spd.legend')} · ${speedUnit()}</p>
    <div class="lg-ramp" style="background:linear-gradient(90deg, ${stops})"></div>
    <div class="lg-ticks">${RAMP.map(([k]) => `<span>${bandLabel(k)}</span>`).join('')}</div>
    <p class="lg-r"><i class="lg-dot lg-faint" style="--sys-col:${RAMP[2][1]}"></i><span>${t('spd.src.l')}</span></p>
    <p class="lg-r"><i class="lg-dot" style="--sys-col:${UNKNOWN}"></i><span>${t('spd.none')}</span></p>`;
}
