/* The Interstate buildout, docked over the live map.

   Two things are true at once here and the control has to say both.

   FHWA published the mileage open to traffic at the end of every calendar
   year from 1960 to 1997. That series is complete, authoritative and is what
   the headline figures and the curve are drawn from: 10,440 miles open in
   1960, 42,787 by 1997.

   What nobody published is the date each individual route opened. There is no
   per-route or per-segment opening date for the system in any machine-readable
   source, and this atlas does not invent figures, so the map can only light up
   the routes whose completion year is separately documented in the written
   content. That is a minority of them.

   So the curve is the whole system and the map is a documented sample, and the
   panel says so rather than letting the sparse map imply the system was small.
   The alternative - interpolating opening dates from the national curve - would
   produce a map that looked complete and was fiction.

   The scrub track is the curve. Dragging along the shape of the buildout is
   both the control and the reading: the near-vertical 1960s, the long taper
   after 1980, and the fact that the last few hundred miles took fifteen years
   are all legible in the line you are dragging on. */

import { t, num, getLang } from './i18n.js';
import { app, toast, enableSystem, select } from './app.js';

/* The scrubber only ever filters the Interstate layers - it is a buildout of
   that system and of nothing else - so it names them directly rather than
   walking the registry. */
const I = 'rt-us-interstate';
const SYSTEM_LAYERS = [I, `${I}-glow`, `${I}-label`];
const FLASH_SRC = 'tl-flash';
const GHOST = 'tl-ghost';

let on = false;
let state = null;

export function isTimelapseOn() { return on; }

/* ── the curve ─────────────────────────────────────────────────────────── */

const VW = 1000;
const VH = 100;

/**
 * Draw the mileage curve as the scrub track.
 *
 * Two paths over the same points: the whole curve drawn faintly, and the part
 * up to the current year drawn bright and filled. The x axis is the year and
 * the y axis is miles open, both linear, so the shape is the real one - no
 * smoothing that would flatten the 1960s.
 */
function curvePaths(rows, year, domain) {
  const x0 = domain?.min ?? rows[0][0];
  const x1 = domain?.max ?? rows[rows.length - 1][0];
  const lastYr = rows[rows.length - 1][0];
  const lastOpen = rows[rows.length - 1][1];
  const max = rows[rows.length - 1][2]; // designated system: the ceiling
  const xOf = (yr) => ((yr - x0) / Math.max(x1 - x0, 1)) * VW;
  const yOf = (mi) => VH - (mi / max) * VH;

  const pts = rows.map(([yr, open]) => [xOf(yr), yOf(open)]);
  // FHWA's table ends in 1997. Years after that stay on the playhead because
  // other dated openings exist; the mileage series does not continue, so the
  // line holds the last published figure rather than being guessed onward.
  if (x1 > lastYr) pts.push([xOf(x1), yOf(lastOpen)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');

  // The filled part stops at the current year, interpolated between the two
  // bracketing years so the fill edge tracks the playhead exactly.
  const clamped = Math.min(Math.max(year, x0), x1);
  const upto = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] <= clamped) upto.push(pts[i]);
  }
  if (clamped > lastYr) upto.push([xOf(clamped), yOf(lastOpen)]);
  if (upto.length < 2) upto.push(pts[0], pts[Math.min(1, pts.length - 1)]);
  const last = upto[upto.length - 1];
  const area = `${upto.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('')}`
    + `L${last[0].toFixed(1)} ${VH}L${upto[0][0].toFixed(1)} ${VH}Z`;

  return { line, area, x: last[0], y: last[1], xOf, y0: x0, y1: x1 };
}

/** Mileage open at a year, and the designated total, from the published table. */
function atYear(rows, year) {
  let row = null;
  for (const r of rows) if (r[0] <= year) row = r;
  return row;
}

/* ── map ───────────────────────────────────────────────────────────────── */

/**
 * The system as it stands today, drawn faint and unfiltered underneath.
 *
 * Without it the early years are an almost empty screen: 1961 has one route
 * whose completion is documented, so the map went dark and the reader lost any
 * sense of where in the country the lit road was. The ghost is not a claim
 * about what existed in the year on the playhead - it is the finished network,
 * there to be filled in, and the panel says as much.
 */
function ensureGhostLayer() {
  const map = app.map;
  if (map.getLayer(GHOST) || !map.getLayer(I)) return;
  map.addLayer({
    id: GHOST,
    type: 'line',
    source: I,
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
    paint: {
      'line-color': '#35e7ff',
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.8, 8, 1.6],
      'line-opacity': 0.16,
    },
    // Under the live layers, so a route that lights up is not dimmed by its
    // own ghost lying on top of it.
  }, map.getLayer(`${I}-glow`) ? `${I}-glow` : I);
}

function ghost(show) {
  const map = app.map;
  if (map?.getLayer(GHOST)) {
    map.setLayoutProperty(GHOST, 'visibility', show ? 'visible' : 'none');
  }
}

function ensureFlashLayers() {
  const map = app.map;
  if (map.getSource(FLASH_SRC)) return;
  map.addSource(FLASH_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  // New pavement arrives white and hot and cools into the network colour. The
  // glow is a separate wider line because a single line cannot both read as a
  // road and throw light.
  map.addLayer({
    id: `${FLASH_SRC}-glow`,
    type: 'line',
    source: FLASH_SRC,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#ffffff',
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 9, 8, 20],
      'line-opacity': 0,
      'line-blur': 10,
    },
  });
  map.addLayer({
    id: FLASH_SRC,
    type: 'line',
    source: FLASH_SRC,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#ffffff',
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 2.2, 8, 4.5],
      'line-opacity': 0,
    },
  });
}

/** Light up the routes documented as finished in this year, then let them cool. */
function flash(ids) {
  const map = app.map;
  if (!map?.getSource(FLASH_SRC)) return;
  const src = map.getSource(I);
  const all = src?._data?.features || [];
  const features = all.filter((f) => ids.includes(f.properties.id));
  map.getSource(FLASH_SRC).setData({ type: 'FeatureCollection', features });
  if (!features.length) return;

  const start = performance.now();
  const dur = 1400;
  const step = (now) => {
    if (!on) return;
    const k = Math.min(1, (now - start) / dur);
    // Hold briefly at full, then ease out, so a route that opens is seen even
    // at one year per 420 ms.
    const a = k < 0.25 ? 1 : 1 - ((k - 0.25) / 0.75) ** 0.7;
    if (map.getLayer(FLASH_SRC)) {
      map.setPaintProperty(FLASH_SRC, 'line-opacity', a);
      map.setPaintProperty(`${FLASH_SRC}-glow`, 'line-opacity', a * 0.5);
    }
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function applyYear(year) {
  const map = app.map;
  if (!map?.getLayer(I)) return;
  const open = state.routes.filter((r) => r.year <= year);
  const ids = open.map((r) => r.id);
  for (const layer of SYSTEM_LAYERS) {
    if (map.getLayer(layer)) map.setFilter(layer, ['in', ['get', 'id'], ['literal', ids]]);
  }
  const fresh = state.routes.filter((r) => r.year === year).map((r) => r.id);
  if (fresh.length) flash(fresh);
  return open;
}

/* ── panel ─────────────────────────────────────────────────────────────── */

function paint() {
  const { year, rows } = state;
  const open = applyYear(year) || [];
  const row = atYear(rows, year);
  const el = document.getElementById('tlapse');

  const { line, area, x, y } = curvePaths(rows, year, { min: state.min, max: state.max });
  el.querySelector('.tlx-year').textContent = year;
  el.querySelector('.tlx-area').setAttribute('d', area);
  el.querySelector('.tlx-line').setAttribute('d', line);
  const head = el.querySelector('.tlx-head');
  head.setAttribute('cx', x.toFixed(1));
  head.setAttribute('cy', y.toFixed(1));
  el.querySelector('.tlx-rule').setAttribute('x1', x.toFixed(1));
  el.querySelector('.tlx-rule').setAttribute('x2', x.toFixed(1));

  // The published figure, which covers the whole system.
  el.querySelector('.tlx-open').innerHTML = row
    ? `${num(Math.round(row[1]))}<small>${t('unit.mi')}</small>`
    : `<span class="na">${t('tlx.before')}</span>`;
  el.querySelector('.tlx-pct').textContent = row
    ? `${Math.round((row[1] / row[2]) * 100)}%`
    : '';
  // What the map is actually able to show.
  el.querySelector('.tlx-shown').textContent = num(open.length);
  state.syncRange?.();
  paintEvents(year);
}

/**
 * What is on the record for this year.
 *
 * The written content carries several hundred sourced events and they are the
 * best thing in the timeline - the year the numbering plan was adopted, the
 * year a turnpike was folded into the system. Scrubbing past them silently
 * would waste them, so the year's entries surface as the playhead reaches
 * them and clear themselves when it moves on.
 */
function paintEvents(year) {
  const host = document.getElementById('tlxEvents');
  if (!host) return;
  // Dragging the scrubber calls this on every pointer move, and rebuilding the
  // same markup restarted the entrance animation on each one, so a slow drag
  // across a year strobed. Only touch the DOM when what it would say changes -
  // which includes the language, since these entries are written in both.
  const lang = getLang();
  const key = `${year}|${lang}`;
  if (state.evKey === key) return;
  state.evKey = key;

  const hits = state.events.filter((e) => e.year === year)
    .sort((a, b) => (a.system ? 0 : 1) - (b.system ? 0 : 1) || (a.kind === 'qc' ? 0 : 1) - (b.kind === 'qc' ? 0 : 1));
  if (!hits.length) { host.hidden = true; host.innerHTML = ''; return; }
  host.hidden = false;
  host.innerHTML = hits.slice(0, 3).map((e) => `
    <div class="tlx-ev${e.system ? ' sys' : ''}">
      ${e.id && !e.system ? `<button class="tlx-ev-go" data-go="${e.id}" type="button">${esc(labelOf(e.id))}</button>` : ''}
      <p>${esc(e[lang] || e.en)}</p>
      ${e.source ? `<span class="src">${esc(e.source)}</span>` : ''}
    </div>`).join('')
    + (hits.length > 3 ? `<p class="tlx-ev-more">${t('tlx.more', { n: hits.length - 3 })}</p>` : '');

  for (const b of host.querySelectorAll('[data-go]')) {
    // Opening the road an entry is about is an act of reading, and playback
    // would otherwise carry on and take the entry off the screen mid-sentence.
    b.addEventListener('click', () => { pause(); select(b.dataset.go); });
  }
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const labelOf = (id) => app.byId.get(id)?.label || id;

function setYear(year) {
  state.year = Math.min(Math.max(Math.round(year), state.min), state.max);
  // Scrubbing back off the end puts the control back into "play" rather than
  // leaving it offering to rewind a run that is no longer at its end.
  if (state.year < state.max) document.getElementById('tlapse')?.classList.remove('ended');
  paint();
}

/* A year of nothing much, a year a documented route opened, and a year with
   something on the record are three different amounts of reading, and were
   all given the same 460 ms. The events in particular were unreadable: the
   panel carries several hundred sourced notes and playback flicked through
   them faster than a sentence can be read, which made them decoration. */
const STEP_MS = 420;
const OPEN_MS = 820;
const EVENT_MS = 2100;

function dwell(year) {
  if (state.events.some((e) => e.year === year)) return EVENT_MS;
  if (state.routes.some((r) => r.year === year)) return OPEN_MS;
  return STEP_MS;
}

/**
 * Run the years forward, and stop at the end.
 *
 * This used to wrap straight back to 1956, which meant a reader who looked away
 * came back to an empty map and no way to tell whether they were watching the
 * start or the end of the run. It now finishes on the completed network and
 * stays there, which is also the state worth leaving on screen. Pressing play
 * on a finished run rewinds, so the control never does nothing.
 */
function play() {
  if (state.timer) return;
  if (state.year >= state.max) setYear(state.min);
  const el = document.getElementById('tlapse');
  el.classList.add('playing');
  el.classList.remove('ended');
  const tick = () => {
    if (!on) return;
    setYear(state.year + 1);
    if (state.year >= state.max) { pause(); el.classList.add('ended'); return; }
    state.timer = setTimeout(tick, dwell(state.year));
  };
  state.timer = setTimeout(tick, dwell(state.year));
}

function pause() {
  if (!state.timer) return;
  clearTimeout(state.timer);
  state.timer = null;
  document.getElementById('tlapse').classList.remove('playing');
}

const togglePlay = () => (state.timer ? pause() : play());

/* ── open and close ────────────────────────────────────────────────────── */

export async function openTimelapse() {
  if (on) { closeTimelapse(); return; }

  const tl = await loadTimeline();
  if (!tl?.routes?.length || !tl.mileage?.open?.length) {
    toast(t('tlx.unavailable'));
    return;
  }

  // The Interstates have to be drawn for there to be anything to animate.
  if (!app.loaded.has('us-interstate')) await enableSystem('us-interstate');

  const rows = tl.mileage.open;
  const routes = tl.routes.filter((r) => r.year).sort((a, b) => a.year - b.year);
  const events = tl.events || [];
  const qcYears = events.filter((e) => e.kind === 'qc').map((e) => e.year);
  const tchYears = events.filter((e) => e.kind === 'tch').map((e) => e.year);
  state = {
    rows,
    routes,
    events,
    source: tl.mileage.source,
    coverage: tl.coverage,
    // Starts at the Act rather than at the first data point, so the scrubber
    // opens on the year the system was authorised and the reader arrives
    // before anything has been built rather than part-way in. Québec openings
    // stretch the far end past 1997, where FHWA's mileage series stops, and
    // the Trans-Canada Highway Act pulls the start back to 1949.
    // Older system-wide notes (some nineteenth-century) stay as events but
    // do not pull the axis back before either programme.
    min: Math.min(1956, rows[0][0], routes[0]?.year ?? 1956, ...qcYears, ...tchYears),
    max: Math.max(rows[rows.length - 1][0], routes[routes.length - 1]?.year ?? 0, ...qcYears),
    year: 0,
    timer: null,
    evKey: null,
  };
  state.year = state.min;

  on = true;
  ensureGhostLayer();
  ensureFlashLayers();
  ghost(true);
  render();
  document.body.classList.add('tlapse-on');
  lightButton(true);
  setYear(state.min);
  play();
}

// The toolbar button and the scrubber can each be the thing that closes it, so
// the lit state is set here rather than by whichever one was clicked.
function lightButton(lit) {
  document.getElementById('btnTimeline')?.classList.toggle('on', lit);
}

export function closeTimelapse() {
  if (!on) return;
  pause();
  on = false;
  state = null;
  document.body.classList.remove('tlapse-on');
  lightButton(false);
  document.getElementById('tlapse').innerHTML = '';
  const map = app.map;
  if (!map) return;
  ghost(false);
  for (const layer of SYSTEM_LAYERS) {
    if (map.getLayer(layer)) map.setFilter(layer, null);
  }
  if (map.getSource(FLASH_SRC)) {
    map.getSource(FLASH_SRC).setData({ type: 'FeatureCollection', features: [] });
  }
}

let timelineData = null;
async function loadTimeline() {
  if (timelineData) return timelineData;
  try {
    timelineData = await (await fetch('data/timeline.json')).json();
  } catch {
    timelineData = null;
  }
  return timelineData;
}

function render() {
  const el = document.getElementById('tlapse');
  const { rows, min, max } = state;
  const { line, area } = curvePaths(rows, min, { min, max });
  const ticks = [1960, 1970, 1980, 1990, 1997, 2010, 2025].filter((y) => y >= min && y <= max);
  const y0 = min;
  const y1 = max;

  el.innerHTML = `
    <div class="tlx-l">
      <button class="tlx-play" id="tlxPlay" type="button" aria-label="${t('tl.play')}">
        <svg class="i-play" viewBox="0 0 24 24"><path d="M8 5l12 7-12 7z"/></svg>
        <svg class="i-pause" viewBox="0 0 24 24"><path d="M9 5v14M16 5v14"/></svg>
        <svg class="i-replay" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.2 4.3v4.6h4.6"/>
        </svg>
      </button>
      <b class="tlx-year">${min}</b>
    </div>

    <div class="tlx-c">
      <svg class="tlx-svg" viewBox="0 0 ${VW} ${VH}" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="tlxFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#35e7ff" stop-opacity="0.55"/>
            <stop offset="100%" stop-color="#35e7ff" stop-opacity="0.04"/>
          </linearGradient>
        </defs>
        <path class="tlx-ghost" d="${line}"/>
        <path class="tlx-area" d="${area}" fill="url(#tlxFill)"/>
        <path class="tlx-line" d="${line}"/>
        <line class="tlx-rule" x1="0" y1="0" x2="0" y2="${VH}"/>
        <circle class="tlx-head" cx="0" cy="${VH}" r="4.5"/>
      </svg>
      <input class="tlx-range" id="tlxRange" type="range"
        min="${min}" max="${max}" value="${min}" step="1"
        aria-label="${t('tl.title')}">
      <div class="tlx-ticks">
        ${ticks.map((y) => `<span style="left:${(((y - y0) / (y1 - y0)) * 100).toFixed(2)}%">${y}</span>`).join('')}
      </div>
    </div>

    <div class="tlx-r">
      <div class="tlx-m">
        <span class="tlx-k">${t('tlx.open')}</span>
        <span class="tlx-v tlx-open">—</span>
        <span class="tlx-s"><span class="tlx-pct"></span> ${t('tlx.ofSystem')}</span>
      </div>
      <div class="tlx-m">
        <span class="tlx-k">${t('tlx.shown')}</span>
        <span class="tlx-v tlx-shown">0</span>
        <span class="tlx-s">${t('tlx.shownOf', { n: num(state.routes.length) })}</span>
      </div>
      <div class="tlx-btns">
        <button class="tlx-i" id="tlxWhy" type="button" aria-label="${t('tlx.why')}">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6v.1"/></svg>
        </button>
        <button class="tlx-i" id="tlxClose" type="button" aria-label="${t('tlx.close')}">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
    </div>

    <!-- What the record says about the year under the playhead. -->
    <div class="tlx-events" id="tlxEvents" hidden></div>

    <!-- The two figures above measure different things, and a reader who does
         not know that will read the sparse map as a small system. -->
    <div class="tlx-note" id="tlxNote" hidden>
      <p>${t('tlx.note', {
    total: num(state.coverage?.interstates ?? 0),
    n: num(state.routes.length),
    qc: num(state.coverage?.quebec?.dated ?? 0),
  })}</p>
      <p class="src">${esc(state.source?.publisher)} — ${esc(state.source?.title)}</p>
    </div>`;

  const range = document.getElementById('tlxRange');
  range.addEventListener('input', () => { pause(); setYear(Number(range.value)); });
  document.getElementById('tlxPlay').addEventListener('click', togglePlay);
  document.getElementById('tlxClose').addEventListener('click', closeTimelapse);
  document.getElementById('tlxWhy').addEventListener('click', () => {
    const note = document.getElementById('tlxNote');
    note.hidden = !note.hidden;
    document.getElementById('tlxWhy').classList.toggle('on', !note.hidden);
  });
  // Keep the native input and the drawn playhead in step when playback moves
  // the year rather than the pointer.
  state.syncRange = () => { range.value = state.year; };
}
