/* The route detail panel.

   Two kinds of information share this panel and are deliberately kept
   distinguishable. Measured values - length, termini, state mileage, roadway
   class - are computed from the mapped geometry and carry a provenance note.
   Editorial values - cost, traffic, condition - come from a written dossier and
   each carries its own source line. Where no published figure exists the row
   says so rather than guessing. */

import { t, getLang, stateName, miles, num } from './i18n.js';
import { app, shieldHtml, addToTrip, clearSelection, fitTo, loadDossier } from './app.js';
import { startFly } from './fly.js';

const SECTION_ORDER = [
  'character', 'engineering', 'history', 'money', 'traffic', 'condition', 'drive',
];

const CLASS_COLOUR = {
  Freeway: '#35e7ff',
  Tollway: '#ffb545',
  Primary: '#6ef7a5',
  Secondary: '#4f9ad8',
  'Other Paved': '#7a8ca6',
  Paved: '#7a8ca6',
  Unpaved: '#b98a5a',
  Ferry: '#a98bff',
  Trail: '#8a6f4f',
  Unknown: '#4a5768',
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function prop(f, key) {
  const v = f?.properties?.[key];
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return v; }
}

function pick(obj) {
  if (obj == null) return null;
  if (typeof obj === 'string') return obj;
  return obj[getLang()] ?? obj.en ?? null;
}

/* ── pieces ───────────────────────────────────────────────────────────── */

function terminusRow(kind, place, coord, dossierText) {
  const isFrom = kind === 'from';
  const label = t(isFrom ? 'dt.from' : 'dt.to');
  const written = pick(dossierText);
  let body;
  if (written) {
    body = esc(written);
  } else if (place) {
    body = place.km <= 6
      ? esc(`${place.name}, ${place.st}`)
      : t('dt.nearBy', { place: esc(`${place.name}, ${place.st}`), km: place.km });
  } else {
    body = '—';
  }
  const coords = coord ? `${coord[1].toFixed(4)}°, ${coord[0].toFixed(4)}°` : '';
  return `<div class="term ${isFrom ? 'from' : 'to'}">
    <span class="term-rail"></span>
    <span class="term-dot"></span>
    <span class="term-txt">
      <span class="term-k">${label}</span>
      <span class="term-v">${body}</span>
      ${coords ? `<span class="term-c">${coords}</span>` : ''}
    </span>
  </div>`;
}

function metric(key, value, sub) {
  const na = value == null;
  return `<div class="m">
    <span class="m-k">${t(key)}</span>
    <div class="m-v${na ? ' na' : ''}">${na ? t('dt.unknown') : value}${sub ? `<small>${sub}</small>` : ''}</div>
  </div>`;
}

function compositionBlock(types) {
  const entries = Object.entries(types || {}).filter(([, v]) => v > 0.05).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '';
  const bar = entries.map(([k, v]) =>
    `<i style="width:${v}%;background:${CLASS_COLOUR[k] || '#4a5768'}" title="${esc(t(`comp.${k}`))} ${v}%"></i>`).join('');
  const key = entries.map(([k, v]) =>
    `<span><i style="background:${CLASS_COLOUR[k] || '#4a5768'}"></i>${esc(t(`comp.${k}`))} ${v}%</span>`).join('');
  return `<div class="comp"><div class="comp-bar">${bar}</div><div class="comp-key">${key}</div></div>`;
}

function statesBlock(states) {
  if (!states?.length) return '';
  const max = Math.max(...states.map((s) => s.mi));
  return `<div class="st-rows">${states.map((s) => `
    <div class="st-row">
      <b>${s.st}</b>
      <span class="bar"><i style="width:${Math.max(2, (s.mi / max) * 100)}%"></i></span>
      <em>${num(s.mi)}</em>
    </div>`).join('')}</div>`;
}

function section(key, bodyHtml, open = false) {
  if (!bodyHtml) return '';
  return `<section class="sect${open ? ' open' : ''}">
    <button class="sect-hd" type="button">
      <h3>${t(`sect.${key}`)}</h3>
      <svg class="cv" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5"/></svg>
    </button>
    <div class="sect-bd">${bodyHtml}</div>
  </section>`;
}

function prose(paras) {
  if (!paras?.length) return '';
  return paras.map((p) => `<p>${esc(p)}</p>`).join('');
}

function figuresBlock(figures) {
  if (!figures?.length) return '';
  const rows = figures.map((f) => {
    const label = esc(pick(f.label));
    const value = pick(f.value);
    if (!value) {
      return `<div class="fig"><span class="fig-k">${label}</span>
        <span class="fig-v"><span class="unk">${t('dt.unknown')}</span>
        ${f.why ? `<span class="src">${esc(pick(f.why))}</span>` : ''}</span></div>`;
    }
    // Bold any run of digits so the figure itself carries the emphasis.
    const marked = esc(value).replace(/(\$?[\d][\d,.]*\s?(?:billion|million|bn|m|亿|万)?)/g, '<b>$1</b>');
    return `<div class="fig"><span class="fig-k">${label}</span>
      <span class="fig-v">${marked}${f.source ? `<span class="src">${esc(f.source)}</span>` : ''}</span></div>`;
  }).join('');
  return `<div class="figs">${rows}</div>`;
}

/* ── cities served ────────────────────────────────────────────────────── */

// The Route Log names every urban area of 5,000+ that each Interstate serves.
// One fetch for the whole system, and only once a panel actually asks for it.
let servedPromise = null;
function servedFor(id) {
  servedPromise ||= fetch('data/served.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return servedPromise.then((m) => m[id] || null);
}

function servedBlock(cities) {
  if (!cities?.length) return '';
  const chips = cities.map((c) => `<span class="chip">${esc(c)}</span>`).join('');
  return `<div class="chips">${chips}</div>
    <p class="srcline">${t('served.src')}</p>`;
}

/* ── elevation ────────────────────────────────────────────────────────── */

const elevCache = new Map();

async function elevationFor(id) {
  if (elevCache.has(id)) return elevCache.get(id);
  let data = null;
  try {
    const res = await fetch(`data/elevation/${id}.json`);
    if (res.ok) data = await res.json();
  } catch { /* not generated for this route */ }
  elevCache.set(id, data);
  return data;
}

function elevationSvg(profile) {
  const ft = profile.ft;
  const n = ft.length;
  const W = 400;
  const H = 92;
  const lo = Math.min(...ft);
  const hi = Math.max(...ft);
  const range = Math.max(60, hi - lo);
  const x = (i) => (i / (n - 1)) * W;
  const y = (v) => H - ((v - lo) / range) * (H - 12) - 4;

  let d = `M0 ${y(ft[0]).toFixed(1)}`;
  for (let i = 1; i < n; i++) d += ` L${x(i).toFixed(1)} ${y(ft[i]).toFixed(1)}`;
  const area = `${d} L${W} ${H} L0 ${H} Z`;

  const hiIdx = ft.indexOf(hi);
  const gridY = [0.25, 0.5, 0.75].map((f) =>
    `<line class="grid" x1="0" y1="${(H * f).toFixed(1)}" x2="${W}" y2="${(H * f).toFixed(1)}"/>`).join('');

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="elevFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#35e7ff" stop-opacity="0.34"/>
      <stop offset="100%" stop-color="#35e7ff" stop-opacity="0"/>
    </linearGradient></defs>
    ${gridY}
    <path class="area" d="${area}"/>
    <path class="line" d="${d}"/>
    <circle class="peak" cx="${x(hiIdx).toFixed(1)}" cy="${y(hi).toFixed(1)}" r="2.6"/>
  </svg>`;
}

function elevationBlock(profile) {
  if (!profile || !profile.ft?.length) return `<p class="res-empty" style="padding:6px 0">${t('elev.none')}</p>`;
  const ft = profile.ft;
  const hi = Math.max(...ft);
  const lo = Math.min(...ft);
  const hiMi = Math.round(ft.indexOf(hi) * profile.stepMi);
  const loMi = Math.round(ft.indexOf(lo) * profile.stepMi);
  let climb = 0;
  for (let i = 1; i < ft.length; i++) if (ft[i] > ft[i - 1]) climb += ft[i] - ft[i - 1];
  return `<div class="elev">${elevationSvg(profile)}</div>
    <div class="mgrid" style="margin-top:10px">
      ${metric('elev.high', `${num(hi)}<small>${t('unit.ft')}</small>`, '')}
      ${metric('elev.low', `${num(lo)}<small>${t('unit.ft')}</small>`, '')}
      ${metric('elev.climb', `${num(Math.round(climb))}<small>${t('unit.ft')}</small>`, '')}
    </div>
    <p style="margin:9px 0 0;font-family:var(--mono);font-size:10px;color:var(--ink-faint)">
      ${t('elev.at', { ft: num(hi), mi: num(hiMi) })} · ${t('elev.low')}: ${t('elev.at', { ft: num(lo), mi: num(loMi) })}
    </p>
    <p class="srcline">${t('elev.src', { mi: profile.stepMi })}</p>`;
}

/* ── main render ──────────────────────────────────────────────────────── */

export async function renderDetail(id) {
  const host = document.getElementById('detail');
  const meta = app.byId.get(id);
  if (!meta) return;
  const f = app.selectedFeature;

  const p = f?.properties || {};
  const states = prop(f, 'states') || [];
  const types = prop(f, 'types') || {};
  const start = prop(f, 'start');
  const end = prop(f, 'end');
  const np = p.np ?? f?.geometry.coordinates.length ?? 0;
  const main = f ? f.geometry.coordinates.slice(0, np) : [];
  const startCoord = main[0]?.[0];
  const endCoord = main[main.length - 1]?.at(-1);

  const dossier = await loadDossier(id);
  if (app.selected !== id) return; // selection moved on while fetching

  const title = pick(dossier?.name) || meta.label;
  const subtitle = pick(dossier?.tagline)
    || (meta.sys === 'state' ? stateName(meta.st) : t(`sys.${meta.sys}`));

  // Three lengths can be in play and they answer different questions, so the
  // headline takes the most authoritative available and the provenance section
  // shows the disagreement rather than hiding it.
  const officialMi = dossier?.officialMi ?? p.offMi ?? null;
  const officialSrc = dossier?.mileageSource || (p.offMi != null ? t('src.routelog') : null);
  const gapNote = p.breaks > 0
    ? `<div class="note gap"><svg viewBox="0 0 24 24"><path d="M12 9v4M12 17v.1"/><circle cx="12" cy="12" r="9"/></svg>
       <span>${t('note.gaps', { n: p.breaks, mi: num(p.gapMi) })}</span></div>` : '';

  host.innerHTML = `
    <div class="dt-hd">
      <div class="dt-hd-top">
        ${shieldHtml(meta, true)}
        <div class="dt-titles">
          <h2 class="dt-name">${esc(title)}</h2>
          <p class="dt-sub">${esc(subtitle)}</p>
        </div>
      </div>
      <button class="dt-x" id="dtClose" type="button" aria-label="Close">
        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
      <div class="dt-acts">
        <button class="btn" id="dtFly" type="button">
          <svg viewBox="0 0 24 24"><path d="M3 12h13M12 6l6 6-6 6"/></svg><span>${t('dt.fly')}</span>
        </button>
        <button class="btn" id="dtTrip" type="button">
          <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg><span>${t('dt.addTrip')}</span>
        </button>
        <button class="btn btn-ico" id="dtZoom" type="button" title="${t('dt.zoom')}">
          <svg viewBox="0 0 24 24"><path d="M3 9V3h6M21 15v6h-6M21 9V3h-6M3 15v6h6"/></svg>
        </button>
      </div>
    </div>

    <div class="dt-bd">
      <div class="termini">
        ${terminusRow('from', start, startCoord, dossier?.termini?.start)}
        ${terminusRow('to', end, endCoord, dossier?.termini?.end)}
      </div>

      <div class="mgrid">
        ${metric('dt.length', `${num(officialMi ?? p.mi)}<small>${t('unit.mi')}</small>`)}
        ${metric('dt.states', num(states.length))}
        ${metric('dt.straight', `${num(p.spanMi)}<small>${t('unit.mi')}</small>`)}
        ${metric('dt.gradeSep', `${num(p.gs, p.gs % 1 ? 1 : 0)}<small>%</small>`)}
        ${metric('dt.tolled', `${num(p.toll, p.toll % 1 ? 1 : 0)}<small>%</small>`)}
        ${metric('dt.divided', p.div == null ? null : `${num(p.div, p.div % 1 ? 1 : 0)}<small>%</small>`)}
      </div>

      ${gapNote}
      <div id="dtSections"></div>
    </div>`;

  // ── sections ──
  const sections = document.getElementById('dtSections');
  const parts = [];

  const written = new Map((dossier?.sections || []).map((s) => [s.key, s]));
  let first = true;
  for (const key of SECTION_ORDER) {
    const s = written.get(key);
    if (!s) continue;
    let body = prose(s[getLang()] || s.en);
    if (key === 'money' && dossier?.figures) body += figuresBlock(dossier.figures);
    if (key === 'traffic' && dossier?.trafficFigures) body += figuresBlock(dossier.trafficFigures);
    if (key === 'condition' && dossier?.conditionFigures) body += figuresBlock(dossier.conditionFigures);
    parts.push(section(key, body, first));
    first = false;
  }

  if (!dossier) {
    parts.push(`<div style="padding:14px 16px 0">
      <div class="note"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6v.1"/></svg>
      <span>${t('note.noDossier')}</span></div></div>`);
  }

  parts.push(section('composition', compositionBlock(types), !dossier));
  parts.push(section('statesList', statesBlock(states)));
  parts.push(section('served', '<div id="dtServed"></div>'));
  parts.push(section('elevation', '<div id="dtElev"></div>'));

  // Where the two lengths disagree the reason is usually structural rather
  // than an error, so name the likely cause instead of leaving a bare gap.
  const delta = officialMi ? Math.round(p.mi - officialMi) : 0;
  const lengthRows = officialMi ? `<div class="figs" style="margin-top:11px">
    <div class="fig"><span class="fig-k">${t('len.official')}</span>
      <span class="fig-v"><b>${num(officialMi)}</b> ${t('unit.mi')}
      ${officialSrc ? `<span class="src">${esc(officialSrc)}</span>` : ''}</span></div>
    <div class="fig"><span class="fig-k">${t('len.measured')}</span>
      <span class="fig-v"><b>${num(p.mi)}</b> ${t('unit.mi')}
      <span class="src">${t('len.measuredSrc')}</span></span></div>
    ${Math.abs(delta) >= Math.max(3, officialMi * 0.02) ? `<div class="fig">
      <span class="fig-k">${t('len.delta')}</span>
      <span class="fig-v">${delta > 0 ? '+' : ''}<b>${num(delta)}</b> ${t('unit.mi')}
      <span class="src">${t('len.deltaWhy')}</span></span></div>` : ''}
  </div>` : '';

  parts.push(section('data', `<div class="note">
    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6v.1"/></svg>
    <span>${t('note.derived')}</span></div>${lengthRows}`));

  sections.innerHTML = parts.join('');

  for (const hd of sections.querySelectorAll('.sect-hd')) {
    hd.addEventListener('click', () => hd.closest('.sect').classList.toggle('open'));
  }

  document.getElementById('dtClose').addEventListener('click', clearSelection);
  document.getElementById('dtFly').addEventListener('click', () => startFly(id));
  document.getElementById('dtTrip').addEventListener('click', () => addToTrip(id));
  document.getElementById('dtZoom').addEventListener('click', () => f && fitTo(f));

  elevationFor(id).then((profile) => {
    const slot = document.getElementById('dtElev');
    if (slot && app.selected === id) slot.innerHTML = elevationBlock(profile);
  });

  servedFor(id).then((cities) => {
    const slot = document.getElementById('dtServed');
    if (!slot || app.selected !== id) return;
    const sect = slot.closest('.sect');
    if (!cities?.length) { sect?.remove(); return; }
    slot.innerHTML = servedBlock(cities);
    sect.querySelector('h3').textContent = `${t('sect.served')} · ${cities.length}`;
  });
}
