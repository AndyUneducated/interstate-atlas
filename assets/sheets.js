/* Overlay views: numbering explainer, statistics, buildout timeline, trip
   planner, jurisdiction picker and the about page. */

import { t, getLang, stateName, miles, num, isProvince, ownerLabel } from './i18n.js';
import { app, select, loadState, zoomToState } from './app.js';

let current = null;

export function isSheetOpen() { return current; }

export function closeSheet() {
  document.getElementById('sheet').classList.add('hidden');
  current = null;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function frame(titleKey, subKey, bodyHtml, subVars) {
  return `<div class="sh-hd">
      <div>
        <h2>${t(titleKey)}</h2>
        <p>${t(subKey, subVars)}</p>
      </div>
      <span class="sp"></span>
      <button class="btn btn-ico" id="shClose" type="button" aria-label="Close">
        <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.8"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>
    <div class="sh-bd">${bodyHtml}</div>`;
}

export function openSheet(key) {
  const host = document.getElementById('sheet');
  const inner = document.getElementById('sheetInner');
  current = key;

  const render = {
    numbering: renderNumbering,
    dashboard: renderDashboard,
    planner: renderPlanner,
    states: renderStates,
    provinces: renderProvinces,
    about: renderAbout,
  }[key];
  if (!render) { current = null; return; }

  inner.innerHTML = render();
  host.classList.remove('hidden');
  document.getElementById('shClose').addEventListener('click', closeSheet);
  host.onclick = (e) => { if (e.target.id === 'sheet') closeSheet(); };

  ({
    numbering: wireNumbering,
    dashboard: wireDashboard,
    planner: wirePlanner,
    states: wireStates,
    provinces: wireStates,
    about: () => {},
  }[key])();
}

/* ══════════════════════════════════════════════════════════════════════
   Numbering explainer
   ══════════════════════════════════════════════════════════════════════ */

const LON0 = -125.5;
const LON1 = -66.5;
const LAT0 = 24.0;
const LAT1 = 49.5;
const VW = 620;
const VH = 330;

const xOf = (lon) => ((lon - LON0) / (LON1 - LON0)) * VW;
const yOf = (lat) => VH - ((lat - LAT0) / (LAT1 - LAT0)) * VH;

/**
 * Pick the primary routes of a system and sort them by position.
 *
 * The diagram is drawn from the real mapped positions rather than from a
 * hand-drawn sketch, so the pattern it claims is the pattern in the data: if
 * I-5 did not sit on the west coast, the diagram would show that.
 */
function gridRoutes(sys, orientation) {
  const rows = app.index.filter((r) => r.sys === sys && r.tier === 'primary'
    && r.base != null && r.base < 100 && r.mi > 180);
  const odd = rows.filter((r) => r.base % 2 === 1);
  const even = rows.filter((r) => r.base % 2 === 0);
  const set = orientation === 'ns' ? odd : even;
  // One entry per number: keep the longest where a number appears twice.
  const best = new Map();
  for (const r of set) {
    const prev = best.get(r.base);
    if (!prev || r.mi > prev.mi) best.set(r.base, r);
  }
  return [...best.values()].sort((a, b) => (orientation === 'ns' ? a.cx - b.cx : a.cy - b.cy));
}

function numberingDiagram(sys) {
  const colour = sys === 'interstate' ? '#35e7ff' : '#ffb545';
  const ns = gridRoutes(sys, 'ns');
  const ew = gridRoutes(sys, 'ew');

  const grid = [];
  for (let lon = -120; lon <= -70; lon += 10) {
    grid.push(`<line class="nb-grid-line" x1="${xOf(lon).toFixed(1)}" y1="0" x2="${xOf(lon).toFixed(1)}" y2="${VH}"/>`);
  }
  for (let lat = 25; lat <= 49; lat += 5) {
    grid.push(`<line class="nb-grid-line" x1="0" y1="${yOf(lat).toFixed(1)}" x2="${VW}" y2="${yOf(lat).toFixed(1)}"/>`);
  }

  const lines = [];
  for (const r of ns) {
    const x = xOf(r.cx);
    lines.push(`<line class="nb-route" data-n="${r.base}" data-id="${r.id}" stroke="${colour}"
      x1="${x.toFixed(1)}" y1="14" x2="${x.toFixed(1)}" y2="${VH - 6}"/>`);
    lines.push(`<text class="nb-lab" data-n="${r.base}" x="${x.toFixed(1)}" y="9" text-anchor="middle">${r.base}</text>`);
  }
  for (const r of ew) {
    const y = yOf(r.cy);
    lines.push(`<line class="nb-route" data-n="${r.base}" data-id="${r.id}" stroke="${colour}" opacity="0.8"
      x1="6" y1="${y.toFixed(1)}" x2="${(VW - 20).toFixed(1)}" y2="${y.toFixed(1)}"/>`);
    lines.push(`<text class="nb-lab" data-n="${r.base}" x="${VW - 15}" y="${(y + 3).toFixed(1)}">${r.base}</text>`);
  }

  const west = ns[0];
  const east = ns[ns.length - 1];
  const south = ew[0];
  const north = ew[ew.length - 1];

  return {
    svg: `<svg viewBox="-4 0 ${VW + 30} ${VH + 6}">${grid.join('')}${lines.join('')}</svg>`,
    west, east, south, north,
  };
}

function renderNumbering() {
  const body = `
    <div class="nb-tabs">
      <button class="btn on" data-nb="interstate" type="button">${t('nb.tab.i')}</button>
      <button class="btn" data-nb="us" type="button">${t('nb.tab.us')}</button>
      <button class="btn" data-nb="aux" type="button">${t('nb.tab.aux')}</button>
    </div>
    <div id="nbBody"></div>`;
  return frame('nb.title', 'nb.sub', body);
}

function nbPane(kind) {
  if (kind === 'aux') return nbAuxPane();
  const d = numberingDiagram(kind);
  const zh = getLang() === 'zh';
  const isI = kind === 'interstate';

  const rules = isI
    ? [
      zh ? ['奇数=南北向', `编号自西向东递增。最西是 <b>I-${d.west?.base}</b>，最东是 <b>I-${d.east?.base}</b>。`]
        : ['Odd numbers run north–south', `They climb from west to east: <b>I-${d.west?.base}</b> nearest the Pacific, <b>I-${d.east?.base}</b> nearest the Atlantic.`],
      zh ? ['偶数=东西向', `编号自南向北递增。最南是 <b>I-${d.south?.base}</b>，最北是 <b>I-${d.north?.base}</b>。`]
        : ['Even numbers run east–west', `They climb from south to north: <b>I-${d.south?.base}</b> along the Gulf, <b>I-${d.north?.base}</b> along the northern tier.`],
      zh ? ['尾数 0 与 5', '以 0 或 5 结尾的号码留给贯穿全国的主干线，例如 I-10、I-95、I-5。']
        : ['Multiples of five', 'Numbers ending in 0 or 5 were reserved for the long-haul, coast-to-coast and border-to-border spines.'],
    ]
    : [
      zh ? ['奇数=南北向', `与州际公路<b>完全相反</b>：编号自东向西递增。最东是 <b>US ${d.west && d.east ? d.east.base : ''}</b>… 实际上 US 1 紧贴大西洋岸。`]
        : ['Odd numbers run north–south', 'Deliberately the <b>reverse</b> of the Interstates: numbers climb from east to west, so US 1 hugs the Atlantic.'],
      zh ? ['偶数=东西向', '同样相反：编号自北向南递增。US 2 沿加拿大边境，号码越大越靠南。']
        : ['Even numbers run east–west', 'Also reversed: numbers climb from north to south. US 2 tracks the Canadian border; the high numbers sit near the Gulf.'],
      zh ? ['为什么要相反', '1956 年州际系统开建时，美国国道网已经用了三十年。刻意反向编号，是为了让司机一眼就能分清两套系统，避免在同一走廊上把 US 50 和 I-50 搞混。']
        : ['Why invert it', 'The US route grid was already thirty years old when the Interstates began in 1956. Reversing the new grid meant a driver could never confuse the two systems in the same corridor.'],
    ];

  return `<div class="nb-wrap">
    <div class="nb-viz">${d.svg}
      <p style="margin:10px 2px 0;font-family:var(--mono);font-size:9.5px;color:var(--ink-faint)">
        ${zh ? '每条线的位置来自该公路在本图谱中的实测中心坐标' : 'Each line is placed at the route’s measured centre position in this atlas'}
      </p>
    </div>
    <div class="nb-note">
      <h4>${t(isI ? 'nb.i.h' : 'nb.us.h')}</h4>
      ${rules.map(([k, v], i) => `<div class="nb-rule">
        <span class="nb-rule-n">${i + 1}</span>
        <span class="nb-rule-t"><b>${k}</b><br>${v}</span>
      </div>`).join('')}
    </div>
  </div>`;
}

function nbAuxPane() {
  const zh = getLang() === 'zh';
  // Real examples pulled from the index so the counts are not asserted blindly.
  const aux = app.index.filter((r) => r.sys === 'interstate' && r.tier === 'auxiliary');
  const byParent = new Map();
  for (const r of aux) {
    const parent = String(r.base).slice(-2);
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(r);
  }
  const dup = new Map();
  for (const r of aux) {
    if (!dup.has(r.base)) dup.set(r.base, new Set());
    dup.get(r.base).add(r.st);
  }
  const mostReused = [...dup.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 5);

  return `<div class="nb-wrap">
    <div class="nb-viz" style="padding:18px">
      <svg viewBox="0 0 360 200">
        <line class="nb-grid-line" x1="20" y1="150" x2="340" y2="150"/>
        <text class="nb-lab" x="20" y="168">I-75</text>
        <path class="nb-route" stroke="#35e7ff" d="M20 150 H340" stroke-width="3"/>
        <path class="nb-route" stroke="#6ef7a5" d="M110 150 C130 96 190 96 210 150" stroke-width="2.2"/>
        <text class="nb-lab hot" x="150" y="92">I-275</text>
        <path class="nb-route" stroke="#ffb545" d="M250 150 C262 120 276 108 292 104" stroke-width="2.2"/>
        <text class="nb-lab hot" x="296" y="102">I-175</text>
        <text class="nb-lab" x="20" y="26">${zh ? '偶数首位 → 环线，两端都回到主路' : 'Even first digit → loop, rejoins the parent at both ends'}</text>
        <text class="nb-lab" x="20" y="42">${zh ? '奇数首位 → 支线，只有一端连主路' : 'Odd first digit → spur, meets the parent at one end only'}</text>
      </svg>
    </div>
    <div class="nb-note">
      <h4>${t('nb.aux.h')}</h4>
      <div class="nb-rule"><span class="nb-rule-n">1</span><span class="nb-rule-t">
        <b>${zh ? '后两位是“父路”' : 'The last two digits name the parent'}</b><br>
        ${zh ? 'I-275 服务 I-75，I-405 服务 I-5。' : 'I-275 serves I-75; I-405 serves I-5.'}
      </span></div>
      <div class="nb-rule"><span class="nb-rule-n">2</span><span class="nb-rule-t">
        <b>${zh ? '首位奇偶决定形态' : 'The first digit says loop or spur'}</b><br>
        ${zh ? '偶数首位是绕城环线，两头都接回主路；奇数首位是插入市区的支线，只有一头接主路。'
    : 'An even first digit is a beltway that returns to its parent; an odd one is a spur that dead-ends downtown.'}
      </span></div>
      <div class="nb-rule"><span class="nb-rule-n">3</span><span class="nb-rule-t">
        <b>${zh ? '号码可以在各州重复使用' : 'The numbers are reused between states'}</b><br>
        ${zh ? '这是设计使然，而不是错误。本图谱中重复最多的是：' : 'By design, not by mistake. The most reused in this atlas:'}<br>
        ${mostReused.map(([base, sts]) => `<b>I-${base}</b> — ${sts.size} ${zh ? '个州' : 'states'}`).join('<br>')}
      </span></div>
      <div class="nb-rule"><span class="nb-rule-n">4</span><span class="nb-rule-t">
        <b>${zh ? '本图谱收录' : 'In this atlas'}</b><br>
        ${zh ? `共 <b>${aux.length}</b> 条三位数州际公路。` : `<b>${aux.length}</b> three-digit Interstate routes.`}
      </span></div>
    </div>
  </div>`;
}

function wireNumbering() {
  const body = document.getElementById('nbBody');
  const paint = (kind) => {
    body.innerHTML = nbPane(kind);
    for (const line of body.querySelectorAll('.nb-route[data-id]')) {
      line.addEventListener('mouseenter', () => {
        const n = line.dataset.n;
        for (const el of body.querySelectorAll('.nb-route')) el.classList.toggle('dim', el.dataset.n !== n);
        for (const el of body.querySelectorAll('.nb-lab')) el.classList.toggle('hot', el.dataset.n === n);
        line.classList.add('hot');
      });
      line.addEventListener('mouseleave', () => {
        for (const el of body.querySelectorAll('.nb-route')) el.classList.remove('dim', 'hot');
        for (const el of body.querySelectorAll('.nb-lab')) el.classList.remove('hot');
      });
      line.style.cursor = 'pointer';
      line.addEventListener('click', () => { closeSheet(); select(line.dataset.id); });
    }
  };
  paint('interstate');
  for (const tab of document.querySelectorAll('[data-nb]')) {
    tab.addEventListener('click', () => {
      for (const o of document.querySelectorAll('[data-nb]')) o.classList.toggle('on', o === tab);
      paint(tab.dataset.nb);
    });
  }
}

/* ══════════════════════════════════════════════════════════════════════
   Statistics dashboard
   ══════════════════════════════════════════════════════════════════════ */

const SYS_COLOUR = { interstate: '#35e7ff', us: '#ffb545', state: '#a98bff' };
const CLASS_COLOUR = {
  Freeway: '#35e7ff', Tollway: '#ffb545', Primary: '#6ef7a5', Secondary: '#4f9ad8',
  'Other Paved': '#7a8ca6', Paved: '#7a8ca6', Unpaved: '#b98a5a', Ferry: '#a98bff',
  Trail: '#8a6f4f', Unknown: '#4a5768',
};

function bars(rows, colourOf, maxOverride) {
  const max = maxOverride ?? Math.max(...rows.map((r) => r.v));
  return `<div class="hbars">${rows.map((r) => `
    <div class="hbar"${r.st ? ` data-st="${r.st}" style="cursor:pointer"` : ''}>
      <span class="hbar-k">${esc(r.k)}</span>
      <span class="hbar-t"><i style="width:${((r.v / max) * 100).toFixed(1)}%;background:${colourOf(r)}"></i></span>
      <span class="hbar-v">${num(r.v)}</span>
    </div>`).join('')}</div>`;
}

function renderDashboard() {
  const s = app.stats;
  const totalMi = Object.values(s.bySystem).reduce((a, b) => a + b.mi, 0);
  const totalRoutes = Object.values(s.bySystem).reduce((a, b) => a + b.routes, 0);
  const freewayMi = Object.values(s.bySystem).reduce((a, b) => a + b.gsMi, 0);

  const sysRows = Object.entries(s.bySystem)
    .sort((a, b) => b[1].mi - a[1].mi)
    .map(([k, v]) => ({ k: t(`sys.${k}`), v: v.mi, sys: k }));

  const stateRows = Object.entries(s.byState)
    .sort((a, b) => b[1].mi - a[1].mi)
    .slice(0, 18)
    .map(([st, v]) => ({ k: stateName(st), v: v.mi, st }));

  const classRows = Object.entries(s.byType)
    .sort((a, b) => b[1] - a[1])
    .filter(([, v]) => v > 200)
    .map(([k, v]) => ({ k: t(`comp.${k}`), v, cls: k }));

  const longest = app.index.slice().sort((a, b) => b.mi - a.mi).slice(0, 14);

  return frame('dash.title', 'dash.sub', `
    <div class="dash-top">
      <div class="m"><span class="m-k">${t('dash.totalMi')}</span><div class="m-v">${num(totalMi)}</div></div>
      <div class="m"><span class="m-k">${t('dash.routes')}</span><div class="m-v">${num(totalRoutes)}</div></div>
      <div class="m"><span class="m-k">${t('dash.states')}</span><div class="m-v">${num(Object.keys(s.byState).length)}</div></div>
      <div class="m"><span class="m-k">${t('dash.freeway')}</span><div class="m-v">${num(freewayMi)}</div></div>
    </div>

    <div class="dash-cols">
      <div class="dash-card">
        <h3>${t('dash.bySystem')}</h3>
        <div class="in">${bars(sysRows, (r) => SYS_COLOUR[r.sys])}</div>
      </div>
      <div class="dash-card">
        <h3>${t('dash.byClass')}</h3>
        <div class="in">${bars(classRows, (r) => CLASS_COLOUR[r.cls] || '#4a5768')}</div>
      </div>
      <div class="dash-card">
        <h3>${t('dash.byState')} · ${t('dash.mostMiles')}</h3>
        <div class="in">${bars(stateRows, () => '#1f7fa8')}</div>
      </div>
      <div class="dash-card" style="grid-column:1/-1">
        <h3>${t('dash.longest')}</h3>
        <div class="in" style="padding:0">
          <table class="tbl">
            <thead><tr>
              <th>${t('dash.col.route')}</th>
              <th style="text-align:right">${t('dash.col.mi')}</th>
              <th style="text-align:right">${t('dash.col.states')}</th>
              <th>${t('dash.col.from')}</th>
            </tr></thead>
            <tbody>${longest.map((r) => `<tr data-id="${r.id}">
              <td>${r.label}</td>
              <td class="n">${num(r.mi)}</td>
              <td class="n">${num(r.ns)}</td>
              <td>${ownerLabel(r.sys, r.st)}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>
    </div>`, { n: num(totalRoutes) });
}

function wireDashboard() {
  for (const row of document.querySelectorAll('.tbl tr[data-id]')) {
    row.addEventListener('click', () => { closeSheet(); select(row.dataset.id); });
  }
  for (const bar of document.querySelectorAll('.hbar[data-st]')) {
    bar.addEventListener('click', () => {
      const st = bar.dataset.st;
      closeSheet();
      loadState(st).then(() => zoomToState(st));
    });
  }
}

/* ══════════════════════════════════════════════════════════════════════
   Trip planner
   ══════════════════════════════════════════════════════════════════════ */

function renderPlanner() {
  return frame('tp.title', 'tp.sub', '<div id="tpBody"></div>');
}

function paintPlanner() {
  const host = document.getElementById('tpBody');
  const legs = app.trip.map((id) => app.byId.get(id)).filter(Boolean);

  if (!legs.length) {
    host.innerHTML = `<p class="tp-empty">${esc(t('tp.empty')).replace(/\n/g, '<br>')}</p>`;
    return;
  }

  const totalMi = legs.reduce((s, r) => s + r.mi, 0);
  const freewayMi = legs.reduce((s, r) => s + (r.gs / 100) * r.mi, 0);
  const states = new Set(legs.map((r) => r.st));
  // Freeway miles move faster than everything else; this is a shape-of-the-trip
  // estimate, not a routing engine.
  const hours = (freewayMi / 65) + ((totalMi - freewayMi) / 45);

  host.innerHTML = `<div class="tp-wrap">
    <div class="tp-legs">
      ${legs.map((r, i) => `<div class="tp-leg">
        <span class="tp-leg-rail"></span>
        <span class="tp-leg-n">${i + 1}</span>
        <span class="tp-leg-bd">
          <span class="tp-leg-t">${r.label}</span>
          <span class="tp-leg-s">${miles(r.mi)} · ${ownerLabel(r.sys, r.st)} · ${num(r.gs, r.gs % 1 ? 1 : 0)}% ${t('dt.gradeSep').toLowerCase()}</span>
        </span>
        <button class="tp-leg-x" data-rm="${r.id}" type="button" aria-label="Remove">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>`).join('')}
    </div>
    <div>
      <div class="tp-sum">
        <div class="m"><span class="m-k">${t('tp.total')}</span><div class="m-v">${num(totalMi)}<small>${t('unit.mi')}</small></div></div>
        <div class="m" style="border-top:1px solid var(--line)"><span class="m-k">${t('tp.legs')}</span><div class="m-v">${legs.length}</div></div>
        <div class="m" style="border-top:1px solid var(--line)"><span class="m-k">${t('tp.freeway')}</span><div class="m-v">${Math.round((freewayMi / totalMi) * 100)}<small>%</small></div></div>
        <div class="m" style="border-top:1px solid var(--line)"><span class="m-k">${t('tp.driveEst')}</span><div class="m-v">${t('tp.hours', { h: Math.floor(hours), m: Math.round((hours % 1) * 60) })}</div></div>
      </div>
      <p style="margin:10px 2px;font-size:11px;line-height:1.6;color:var(--ink-faint)">${t('tp.driveNote')}</p>
      <button class="btn" id="tpClear" type="button" style="border:1px solid var(--line);width:100%;justify-content:center">
        <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.8"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>
        <span>${t('tp.clear')}</span>
      </button>
    </div>
  </div>`;

  for (const btn of host.querySelectorAll('[data-rm]')) {
    btn.addEventListener('click', () => {
      app.trip = app.trip.filter((x) => x !== btn.dataset.rm);
      document.getElementById('btnPlanner').classList.toggle('on', app.trip.length > 0);
      paintPlanner();
    });
  }
  document.getElementById('tpClear').addEventListener('click', () => {
    app.trip = [];
    document.getElementById('btnPlanner').classList.remove('on');
    paintPlanner();
  });
}

function wirePlanner() { paintPlanner(); }

/* ══════════════════════════════════════════════════════════════════════
   Jurisdiction picker

   One picker, two tiers. American state routes and Canadian provincial
   highways are the same problem - too much geometry to ship as one file, so
   the reader chooses where to look - and they get the same sheet, filtered to
   the country that asked for it.
   ══════════════════════════════════════════════════════════════════════ */

function renderJurisdictions(sys) {
  const ca = sys === 'provincial';
  const rows = Object.entries(app.stats.byState)
    .filter(([code]) => isProvince(code) === ca)
    .sort((a, b) => stateName(a[0]).localeCompare(stateName(b[0]), getLang() === 'zh' ? 'zh' : 'en'));

  return frame(ca ? 'sys.pickProvince' : 'sys.pickState', `sys.${sys}.meta`, `
    <div class="jur-grid">
      ${rows.map(([code, v]) => `<button class="sys jur" data-load="${code}" type="button">
        <span class="sys-txt">
          <span class="sys-name">${stateName(code)}</span>
          <span class="sys-meta">${num(v[sys] ? v.routes : 0)} · ${miles(v[sys] || 0)}</span>
        </span>
        ${app.stateLoaded.has(code) ? '<span class="pill">on</span>' : ''}
      </button>`).join('')}
    </div>
    ${ca ? `<div class="note" style="margin-top:13px">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6v.1"/></svg>
      <span>${t('ca.municipalWhy')}</span></div>` : ''}`);
}

const renderStates = () => renderJurisdictions('state');
const renderProvinces = () => renderJurisdictions('provincial');

function wireStates() {
  for (const btn of document.querySelectorAll('[data-load]')) {
    btn.addEventListener('click', async () => {
      const st = btn.dataset.load;
      closeSheet();
      await loadState(st);
      zoomToState(st);
    });
  }
}

/* ══════════════════════════════════════════════════════════════════════
   About
   ══════════════════════════════════════════════════════════════════════ */

function renderAbout() {
  const zh = getLang() === 'zh';
  const s = app.stats;
  const totalMi = Object.values(s.bySystem).reduce((a, b) => a + b.mi, 0);

  const en = `
    <p>This atlas draws every numbered highway in three systems — the Interstates, the US numbered routes, and the state route networks of all fifty states plus the District of Columbia and Puerto Rico. That comes to ${num(app.index.length)} routes and ${num(totalMi)} mapped miles.</p>
    <h4>Where the geometry comes from</h4>
    <p>Road centrelines are from <a href="https://www.naturalearthdata.com/downloads/10m-cultural-vectors/roads/" target="_blank" rel="noopener">Natural Earth</a>’s North America roads supplement, a public-domain dataset at 1:1,000,000 scale. Route termini are named against the <a href="https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html" target="_blank" rel="noopener">US Census gazetteer</a>. The basemap is <a href="https://openfreemap.org/" target="_blank" rel="noopener">OpenFreeMap</a> from OpenStreetMap data, and terrain comes from Mapzen tiles on AWS Open Data.</p>
    <h4>What is measured and what is written</h4>
    <p>Length, termini, state-by-state mileage and roadway classification are <strong>measured from the geometry</strong>. They are close but not survey-exact: at 1:1,000,000 a curve is smoothed, so measured mileage typically lands within about 2% of published figures. Where a published mileage exists it is shown alongside the measured one.</p>
    <p>History, construction cost, traffic and pavement condition are <strong>written</strong>, and each figure carries its source. Where no public figure could be found, the row says “no public figure” rather than showing an estimate. Nothing on this site is modelled or inferred to fill a gap.</p>
    <h4>The gaps are real</h4>
    <p>The source data has holes. Some routes lose a stretch where the roadway is filed under a different classification — I-90 is missing the Indiana Toll Road and the Ohio Turnpike, a 420-kilometre hole. Those routes are still drawn as one road, because they are one road, but the missing pavement is left out of both the line and the mileage, and the detail panel says how much is absent.</p>
    <h4>Keyboard</h4>
    <p><b>/</b> or <b>Ctrl-K</b> command palette · <b>F</b> fly the selected route · <b>T</b> 3D terrain · <b>Esc</b> back out.</p>`;

  const cn = `
    <p>本图谱绘制了三套系统中的所有编号公路：州际公路、美国国道，以及全部 50 个州加哥伦比亚特区、波多黎各的州级公路网，共 ${num(app.index.length)} 条路线、${num(totalMi)} 英里制图里程。</p>
    <h4>几何数据来自哪里</h4>
    <p>道路中心线取自 <a href="https://www.naturalearthdata.com/downloads/10m-cultural-vectors/roads/" target="_blank" rel="noopener">Natural Earth</a> 的北美道路增补数据集，公有领域，比例尺 1:1,000,000。起止点地名比对 <a href="https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html" target="_blank" rel="noopener">美国人口普查局地名库</a>。底图为基于 OpenStreetMap 数据的 <a href="https://openfreemap.org/" target="_blank" rel="noopener">OpenFreeMap</a>，地形数据来自 AWS Open Data 上的 Mapzen 瓦片。</p>
    <h4>哪些是实测，哪些是撰写</h4>
    <p>长度、起止点、各州里程、路段等级构成，都是<strong>由几何数据实测得出</strong>。它们接近真实值，但不具备测绘精度：在 1:1,000,000 比例尺下弯道会被平滑处理，实测里程通常与官方公布值相差 2% 以内。凡有官方公布里程的，都与实测值并列显示。</p>
    <p>历史、造价、车流量、路面状况属于<strong>撰写内容</strong>，每个数字都附有来源。凡是找不到公开数据的，该项直接写「无公开数据」，而不是给出估算值。本站不会用建模或推算去填补空缺。</p>
    <h4>断口是真实存在的</h4>
    <p>原始数据存在缺口。有些路线的某些路段在原始数据中被归入了其他分类——例如 I-90 缺失了印第安纳收费公路和俄亥俄收费公路，形成一个 420 公里的断口。这类路线仍作为一条路呈现，因为它们本来就是一条路；但缺失的路段既不画在线上，也不计入里程，详情面板会明确说明缺失了多少。</p>
    <h4>键盘快捷键</h4>
    <p><b>/</b> 或 <b>Ctrl-K</b> 命令面板 · <b>F</b> 巡航所选路线 · <b>T</b> 三维地形 · <b>Esc</b> 返回。</p>`;

  return frame('about.title', 'about.sub',
    `<div class="nb-note" style="max-width:74ch">${zh ? cn : en}</div>`);
}

/* Keep the planner in sync when a route is added from the detail panel. */
export function refreshPlannerIfOpen() {
  if (current === 'planner') paintPlanner();
}
