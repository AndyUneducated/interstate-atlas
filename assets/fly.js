/* Route flythrough.

   The camera tracks a point moving along the route's mainline while a bright
   head and a fading trail are drawn behind it. Bearing is taken from a point
   some distance ahead rather than from the immediate next vertex, otherwise
   every small wiggle in the geometry snaps the camera around.

   Where the source data has a hole the route arrives as several pieces. The
   trail is drawn per piece so nothing is invented, but the camera flies across
   the gap so a drive still feels continuous. */

import { t, num } from './i18n.js';
import { app, toast, shieldHtml } from './app.js';

const TRAIL_SRC = 'fly-trail';
const HEAD_SRC = 'fly-head';

let state = null;
let raf = null;

const R_EARTH_MI = 3958.8;
const DEG = Math.PI / 180;

function distMi(a, b) {
  const lat1 = a[1] * DEG, lat2 = b[1] * DEG;
  const s = Math.sin((lat2 - lat1) / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(((b[0] - a[0]) * DEG) / 2) ** 2;
  return 2 * R_EARTH_MI * Math.asin(Math.min(1, Math.sqrt(s)));
}

function bearing(a, b) {
  const lat1 = a[1] * DEG, lat2 = b[1] * DEG;
  const dLon = (b[0] - a[0]) * DEG;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

/** Flatten the mainline pieces into one distance-indexed track. */
function buildTrack(pieces) {
  const pts = [];
  let cum = 0;
  pieces.forEach((piece, pi) => {
    piece.forEach((c, i) => {
      if (pts.length) {
        const prev = pts[pts.length - 1];
        const step = distMi(prev.c, c);
        // A jump between pieces is a hole in the data, not pavement. It still
        // advances the camera, but it is flagged so the trail breaks there.
        cum += step;
        pts.push({ c, mi: cum, piece: pi, jump: i === 0 });
      } else {
        pts.push({ c, mi: 0, piece: pi, jump: false });
      }
    });
  });
  return pts;
}

function ensureLayers() {
  const map = app.map;
  const empty = { type: 'FeatureCollection', features: [] };
  if (!map.getSource(TRAIL_SRC)) {
    // lineMetrics is what makes ['line-progress'] available, and the trail's
    // fade is expressed as a gradient along that progress.
    map.addSource(TRAIL_SRC, { type: 'geojson', data: empty, lineMetrics: true });
    map.addLayer({
      id: 'fly-trail-glow', type: 'line', source: TRAIL_SRC,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#8ef4ff', 'line-width': 20, 'line-opacity': 0.2, 'line-blur': 14 },
    });
    map.addLayer({
      id: 'fly-trail', type: 'line', source: TRAIL_SRC,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-width': 5,
        'line-opacity': 0.95,
        // Fade the tail out along the travelled line.
        'line-gradient': [
          'interpolate', ['linear'], ['line-progress'],
          0, 'rgba(53,231,255,0)', 0.55, 'rgba(53,231,255,0.5)', 1, '#eafcff',
        ],
      },
    });
  }
  if (!map.getSource(HEAD_SRC)) {
    map.addSource(HEAD_SRC, { type: 'geojson', data: empty });
    map.addLayer({
      id: 'fly-head-halo', type: 'circle', source: HEAD_SRC,
      paint: { 'circle-radius': 26, 'circle-color': '#35e7ff', 'circle-opacity': 0.16, 'circle-blur': 0.8 },
    });
    map.addLayer({
      id: 'fly-head', type: 'circle', source: HEAD_SRC,
      paint: {
        'circle-radius': 6.5, 'circle-color': '#eafcff',
        'circle-stroke-color': '#35e7ff', 'circle-stroke-width': 2.5,
      },
    });
  }
}

function setVisible(on) {
  for (const id of ['fly-trail', 'fly-trail-glow', 'fly-head', 'fly-head-halo']) {
    if (app.map.getLayer(id)) app.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }
}

function pointAt(track, mi) {
  // Track is short enough that a linear scan per frame is cheaper than the
  // bookkeeping needed to cache an index.
  let i = 1;
  while (i < track.length - 1 && track[i].mi < mi) i++;
  const a = track[i - 1];
  const b = track[i];
  const span = Math.max(1e-6, b.mi - a.mi);
  const f = Math.min(1, Math.max(0, (mi - a.mi) / span));
  return {
    c: [a.c[0] + (b.c[0] - a.c[0]) * f, a.c[1] + (b.c[1] - a.c[1]) * f],
    idx: i,
  };
}

/** Trail geometry for everything travelled so far, split at data holes. */
function trailUpTo(track, idx, head) {
  const lines = [];
  let cur = [];
  for (let i = 0; i < idx; i++) {
    if (track[i].jump && cur.length) { lines.push(cur); cur = []; }
    cur.push(track[i].c);
  }
  cur.push(head);
  if (cur.length >= 2) lines.push(cur);
  return lines.filter((l) => l.length >= 2);
}

function lookAheadBearing(track, mi, aheadMi) {
  const here = pointAt(track, mi).c;
  const there = pointAt(track, Math.min(track[track.length - 1].mi, mi + aheadMi)).c;
  if (distMi(here, there) < 0.05) return null;
  return bearing(here, there);
}

function smoothBearing(prev, next) {
  if (prev == null) return next;
  let delta = ((next - prev + 540) % 360) - 180;
  return (prev + delta * 0.08 + 360) % 360;
}

/* ── panel ────────────────────────────────────────────────────────────── */

function renderPanel() {
  const el = document.getElementById('fly');
  const meta = app.byId.get(state.id);
  const total = state.total;
  el.innerHTML = `
    <div class="fly-top">
      <span class="fly-sh">${shield(meta)}</span>
      <span class="fly-txt">
        <span class="fly-t">${meta.label}</span>
        <span class="fly-s" id="flySub"></span>
      </span>
      <span class="fly-acts">
        <button class="btn btn-ico" id="flyPause" type="button" title="${t('tl.pause')}">
          <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.8"><path d="M9 5v14M15 5v14"/></svg>
        </button>
        <button class="btn btn-ico" id="flyRestart" type="button" title="${t('fly.restart')}">
          <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.8"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/></svg>
        </button>
        <button class="btn btn-ico" id="flyExit" type="button" title="${t('fly.exit')}">
          <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.8"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </span>
    </div>
    <div class="fly-bar"><i id="flyFill" style="width:0%"></i><b id="flyDot" style="left:0%"></b></div>
    <div class="fly-readout">
      <span class="fly-r"><span class="fly-r-k">${t('fly.mile')}</span><span class="fly-r-v" id="flyMile">0</span></span>
      <span class="fly-r"><span class="fly-r-k">${t('fly.remaining')}</span><span class="fly-r-v" id="flyLeft">${num(Math.round(total))}</span></span>
      <span class="fly-r"><button class="fly-r-k" id="flySpeedBtn" type="button" style="padding:0;letter-spacing:.15em">${t('fly.speed')}</button><span class="fly-r-v" id="flySpeed">1×</span></span>
    </div>`;

  document.getElementById('flyExit').addEventListener('click', stopFly);
  document.getElementById('flyRestart').addEventListener('click', () => { state.mi = 0; state.paused = false; });
  document.getElementById('flyPause').addEventListener('click', togglePause);
  document.getElementById('flySpeedBtn').addEventListener('click', cycleSpeed);
  document.getElementById('flySpeed').addEventListener('click', cycleSpeed);
  el.classList.add('on');
}

// The one marker renderer, shared with the sidebar. This used to draw its own
// and set a state route's text to "CA·87", which no real sign does and which
// overflowed the marker at three digits.
const shield = (meta) => shieldHtml(meta);

const SPEEDS = [1, 2, 4, 0.5];

function cycleSpeed() {
  if (!state) return;
  state.speed = SPEEDS[(SPEEDS.indexOf(state.speed) + 1) % SPEEDS.length];
  document.getElementById('flySpeed').textContent = `${state.speed}×`;
}

function togglePause() {
  if (!state) return;
  state.paused = !state.paused;
  const btn = document.getElementById('flyPause');
  btn.innerHTML = state.paused
    ? '<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.8"><path d="M7 4l13 8-13 8z"/></svg>'
    : '<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.8"><path d="M9 5v14M15 5v14"/></svg>';
}

/* ── loop ─────────────────────────────────────────────────────────────── */

function frame(ts) {
  if (!state) return;
  const dt = Math.min(0.06, (ts - state.last) / 1000);
  state.last = ts;

  if (!state.paused) state.mi += state.miPerSec * state.speed * dt;

  const total = state.total;
  if (state.mi >= total) {
    state.mi = total;
    state.paused = true;
  }

  const at = pointAt(state.track, state.mi);
  const bear = lookAheadBearing(state.track, state.mi, Math.max(2.5, total * 0.012));
  if (bear != null) state.bearing = smoothBearing(state.bearing, bear);

  app.map.getSource(HEAD_SRC).setData({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: at.c } }],
  });
  const lines = trailUpTo(state.track, at.idx, at.c);
  app.map.getSource(TRAIL_SRC).setData({
    type: 'FeatureCollection',
    features: lines.map((l) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: l } })),
  });

  app.map.jumpTo({
    center: at.c,
    bearing: state.bearing ?? 0,
    zoom: state.zoom,
    pitch: state.pitch,
  });

  const pct = (state.mi / total) * 100;
  document.getElementById('flyFill').style.width = `${pct}%`;
  document.getElementById('flyDot').style.left = `${pct}%`;
  document.getElementById('flyMile').textContent = num(Math.round(state.mi));
  document.getElementById('flyLeft').textContent = num(Math.round(total - state.mi));
  document.getElementById('flySub').textContent = `${Math.round(pct)}% · ${num(Math.round(state.mi))} / ${num(Math.round(total))} ${t('unit.mi')}`;

  raf = requestAnimationFrame(frame);
}

/* ── api ──────────────────────────────────────────────────────────────── */

export function isFlying() { return !!state; }

export function startFly(id) {
  const f = app.selectedFeature;
  const meta = app.byId.get(id);
  if (!f || !meta) return;

  const np = f.properties.np ?? f.geometry.coordinates.length;
  const pieces = f.geometry.coordinates.slice(0, np).filter((p) => p.length >= 2);
  if (!pieces.length) { toast(t('toast.noPath')); return; }

  const track = buildTrack(pieces);
  const total = track[track.length - 1].mi;
  if (!(total > 1)) { toast(t('toast.noPath')); return; }

  stopFly({ keepSelection: true });
  ensureLayers();
  setVisible(true);

  // Longer routes get a wider view and a longer run, but the run time is
  // capped so a 2,400-mile Interstate still finishes inside about 80 seconds
  // instead of taking a real-world afternoon.
  const zoom = total > 1500 ? 7.4 : total > 600 ? 8.2 : total > 150 ? 9.2 : 10.4;
  const durationSec = Math.min(80, Math.max(22, 18 + total / 40));
  state = {
    id, track, total, mi: 0, last: performance.now(),
    bearing: null, zoom, pitch: 62, paused: false,
    speed: 1, miPerSec: total / durationSec,
  };

  app.map.easeTo({ center: track[0].c, zoom, pitch: 62, bearing: 0, duration: 1200 });
  renderPanel();
  document.getElementById('shell').classList.add('hidden');
  setTimeout(() => {
    if (!state) return;
    state.last = performance.now();
    raf = requestAnimationFrame(frame);
  }, 1250);
}

export function stopFly({ keepSelection = false } = {}) {
  if (raf) { cancelAnimationFrame(raf); raf = null; }
  state = null;
  const empty = { type: 'FeatureCollection', features: [] };
  if (app.map?.getSource(TRAIL_SRC)) app.map.getSource(TRAIL_SRC).setData(empty);
  if (app.map?.getSource(HEAD_SRC)) app.map.getSource(HEAD_SRC).setData(empty);
  setVisible(false);
  document.getElementById('fly').classList.remove('on');
  if (!keepSelection) {
    document.getElementById('shell').classList.remove('hidden');
    app.map?.easeTo({ pitch: app.terrain ? 55 : 0, duration: 900 });
  }
}
