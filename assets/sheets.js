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

  // Every route gets a line; not every route can get a label. East of the
  // Mississippi the spacing between numbers is a few pixels, and labelling all
  // of them turned the top of the diagram into a smear. Labels are placed in
  // order of importance — the multiples of five are the long-haul spines the
  // panel beside this is explaining — and any that would collide with one
  // already placed is dropped. The line stays, so nothing disappears.
  const labeller = (gap) => {
    const placed = [];
    return (pos, weight) => {
      const at = placed.findIndex((p) => Math.abs(p - pos) < gap);
      if (at >= 0) return false;
      placed.push(pos);
      return weight;
    };
  };
  const byRank = (rs) => [...rs].sort((a, b) => (Number(a.base) % 5) - (Number(b.base) % 5));

  const lines = [];
  const labels = [];
  const fitsX = labeller(13);
  for (const r of byRank(ns)) {
    if (fitsX(xOf(r.cx))) {
      labels.push(`<text class="nb-lab" data-n="${r.base}" x="${xOf(r.cx).toFixed(1)}" y="9" text-anchor="middle">${r.base}</text>`);
    }
  }
  for (const r of ns) {
    const x = xOf(r.cx);
    lines.push(`<line class="nb-route" data-n="${r.base}" data-id="${r.id}" stroke="${colour}"
      x1="${x.toFixed(1)}" y1="14" x2="${x.toFixed(1)}" y2="${VH - 6}"><title>${r.label}</title></line>`);
  }
  const fitsY = labeller(9);
  for (const r of byRank(ew)) {
    if (fitsY(yOf(r.cy))) {
      labels.push(`<text class="nb-lab" data-n="${r.base}" x="${VW - 15}" y="${(yOf(r.cy) + 3).toFixed(1)}">${r.base}</text>`);
    }
  }
  for (const r of ew) {
    const y = yOf(r.cy);
    lines.push(`<line class="nb-route" data-n="${r.base}" data-id="${r.id}" stroke="${colour}" opacity="0.8"
      x1="6" y1="${y.toFixed(1)}" x2="${(VW - 20).toFixed(1)}" y2="${y.toFixed(1)}"><title>${r.label}</title></line>`);
  }
  // Labels last, so they sit above every line rather than behind half of them.
  lines.push(...labels);

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
  Trail: '#8a6f4f', Local: '#5c6b7f', Ramp: '#6b7a8f', Winter: '#8fd4ff',
  Unknown: '#4a5768',
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
        <div class="in">${bars(classRows, (r) => CLASS_COLOUR[r.cls] || '#4a5768')}
          <p class="hbar-note">${t('dash.byClass.note')}</p></div>
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
  const juris = Object.keys(s.byState).length;

  // The accuracy sentence is built from the figure the last build measured,
  // not from a claim typed in here, so it cannot quietly stop being true.
  const a = s.accuracy;
  const acc = {
    en: a
      ? `Across the ${num(a.routes)} routes where an official figure exists to check against,
         the median disagreement is ${a.median > 0 ? '+' : ''}${a.median}%, and
         ${a.within5}% land within 5%.`
      : '',
    zh: a
      ? `在有官方里程可供核对的 ${num(a.routes)} 条路线上，实测值与官方值的中位差为
         ${a.median > 0 ? '+' : ''}${a.median}%，其中 ${a.within5}% 的路线差距在 5% 以内。`
      : '',
  };

  const en = `
    <p>This atlas draws every numbered highway in two countries: the Interstates, the US numbered routes and the state route networks of all fifty states plus the District of Columbia and Puerto Rico; and in Canada, the Trans-Canada Highway, Transport Canada’s National Highway System and every numbered provincial and municipal route. That comes to ${num(app.index.length)} routes and ${num(totalMi)} mapped miles across ${juris} states, provinces and territories.</p>
    <h4>Where the geometry comes from</h4>
    <p>American road centrelines are from the <a href="https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html" target="_blank" rel="noopener">US Census TIGER/Line</a> road files, read one state at a time; Canadian ones from Statistics Canada’s <a href="https://www.statcan.gc.ca/en/lode/databases/odr" target="_blank" rel="noopener">National Road Network</a>, read one province at a time. Both are surveyed rather than generalised, and both are thinned here for drawing. Termini are named against the <a href="https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html" target="_blank" rel="noopener">US Census gazetteer</a> and the place names in the Canadian file. The basemap is <a href="https://openfreemap.org/" target="_blank" rel="noopener">OpenFreeMap</a> from OpenStreetMap data, satellite imagery is Esri World Imagery, and terrain comes from Mapzen tiles on AWS Open Data.</p>
    <h4>Three kinds of number, never mixed</h4>
    <p><strong>Measured</strong> — length, termini, mileage by state or province, roadway classification. Computed here from the geometry above, along the single path from one end of the road to the other, so a divided highway is counted once rather than twice. ${acc.en} Where an official figure exists it is shown beside the measured one, and the difference is explained rather than hidden.</p>
        <p><strong>Reported</strong> — traffic, heavy-truck volume, pavement roughness, rutting, cracking, lanes, posted speeds. In the United States these are what the states measured and reported to FHWA under the <a href="https://www.fhwa.dot.gov/policyinformation/hpms.cfm" target="_blank" rel="noopener">Highway Performance Monitoring System</a>, one national collection with one method. Canada has no equivalent: traffic counting is provincial, and each province decides on its own whether to publish. Five do, in bulk and by route — Quebec, Ontario, Alberta, Nova Scotia and New Brunswick — so those routes carry counts and name the province, the year, the method and the licence behind them. The other eight jurisdictions publish through maps, applications and PDFs, or not at all, and their routes carry no traffic figure rather than a borrowed one. British Columbia is the significant absence: it counts continuously but releases only through an interactive map. Everything here is joined to a route by its designation and never by position, and every figure states the share of the road it was measured over.</p>
    <p><strong>Written</strong> — history, construction cost, what a road is like to drive. Each figure carries its source. Where no public figure could be found, the row says so rather than showing an estimate. Nothing here is modelled or inferred to fill a gap.</p>
    <h4>Where the numbers disagree</h4>
    <p>They are meant to. FHWA’s published mileage for an Interstate leaves out pavement it credits to another route: where I-90 runs along the Indiana Toll Road with I-80, those miles are counted under I-80 only, which is why the road measures longer here than the register says. And the register has its own slips — it gives Knoxville’s I-640, a beltway of about seven miles, as 77.29. Both figures are shown, and neither is bent toward the other.</p>
    <h4>The gaps are real</h4>
    <p>A number does not always have pavement under it for its whole length. Sometimes the road is filed under another classification, sometimes it runs concurrently under a different number, and sometimes — Highway 1 to Vancouver Island, Route 138 along the Lower North Shore — the route crosses water by ferry. None of that is drawn or counted, and the detail panel says how much is missing.</p>
    <h4>Keyboard</h4>
    <p><b>/</b> or <b>Ctrl-K</b> command palette · <b>F</b> fly the selected route · <b>T</b> 3D terrain · <b>Z</b> hide the interface · <b>Esc</b> back out.</p>`;

  const cn = `
    <p>本图谱绘制两个国家的全部编号公路：美国的州际公路、美国国道，以及 50 个州加哥伦比亚特区、波多黎各的州级公路网；加拿大的横加公路、加拿大交通部《国家公路系统》，以及全部编号的省级与地方公路。合计 ${num(app.index.length)} 条路线、${num(totalMi)} 英里制图里程，覆盖 ${juris} 个州、省与地区。</p>
    <h4>几何数据来自哪里</h4>
    <p>美国的道路中心线取自 <a href="https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html" target="_blank" rel="noopener">美国人口普查局 TIGER/Line</a> 道路数据，逐州读取；加拿大的取自加拿大统计局《<a href="https://www.statcan.gc.ca/en/lode/databases/odr" target="_blank" rel="noopener">国家道路网</a>》，逐省读取。两者都是实测数据而非小比例尺概化数据，本站为绘图做了抽稀。起止点地名比对 <a href="https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html" target="_blank" rel="noopener">美国人口普查局地名库</a> 与加拿大数据自带的地名。底图为基于 OpenStreetMap 数据的 <a href="https://openfreemap.org/" target="_blank" rel="noopener">OpenFreeMap</a>，卫星影像为 Esri World Imagery，地形数据来自 AWS Open Data 上的 Mapzen 瓦片。</p>
    <h4>三类数字，互不混用</h4>
    <p><strong>实测</strong>——长度、起止点、各州或各省里程、路段等级构成。由上述几何数据在本站算出，沿着从一端到另一端的唯一路径量取，因此分向行驶的公路只计一次，不会算成两次。${acc.zh}凡有官方里程的，都与实测值并列显示，差异会加以说明，而不是藏起来。</p>
        <p><strong>上报</strong>——车流量、货车流量、路面平整度、车辙、裂缝、车道数、限速。在美国，这些是各州自行实测后按《<a href="https://www.fhwa.dot.gov/policyinformation/hpms.cfm" target="_blank" rel="noopener">公路性能监测系统</a>》上报给联邦公路管理局的数据，全国统一口径。加拿大没有对应的全国性采集：交通量调查由各省自行负责，是否公开也由各省自行决定。其中五个省以可批量获取的形式按路线公开——魁北克、安大略、艾伯塔、新斯科舍与新不伦瑞克——因此这些路线带有车流量数据，并注明数据出自哪个省、哪一年、用何种方法、以何种许可发布。其余八个省与地区只通过地图、网页应用或 PDF 发布，或根本不发布，其路线便不显示车流量，而不是借用别处的数字。其中不列颠哥伦比亚省的缺失最为可惜：该省持续开展交通量调查，却只通过交互式地图发布。以上数据一律按公路编号与路线匹配，绝不按位置套用，并且每项都注明覆盖了全线多少比例。</p>
    <p><strong>撰写</strong>——历史、造价、这条路开起来是什么感觉。每个数字都附有来源。凡是找不到公开数据的，该项直接写明，而不是给出估算值。本站不会用建模或推算去填补空缺。</p>
    <h4>数字为什么会互相矛盾</h4>
    <p>这本就是应该的。美国联邦公路管理局公布的州际公路里程，会把共线路段的里程记在另一条路名下：I-90 与 I-80 共用印第安纳收费公路的那段，只计入 I-80，因此本站量得的 I-90 比官方名录更长。名录自身也有疏漏——诺克斯维尔的 I-640 是一条约 7 英里的环路，名录却写作 77.29 英里。两个数字都会显示，也都不会向对方靠拢。</p>
    <h4>断口是真实存在的</h4>
    <p>一个编号并不总能在全线都有路面对应。有时是路段在原始数据中被归入了其他分类，有时是与另一编号共线，有时——比如 1 号公路通往温哥华岛、138 号公路沿下北岸——则是要靠渡轮跨越水域。这些都不绘制、也不计入里程，详情面板会说明缺失了多少。</p>
    <h4>键盘快捷键</h4>
    <p><b>/</b> 或 <b>Ctrl-K</b> 命令面板 · <b>F</b> 巡航所选路线 · <b>T</b> 三维地形 · <b>Z</b> 隐藏界面 · <b>Esc</b> 返回。</p>`;

  return frame('about.title', 'about.sub',
    `<div class="nb-note" style="max-width:74ch">${zh ? cn : en}</div>`);
}

/* Keep the planner in sync when a route is added from the detail panel. */
export function refreshPlannerIfOpen() {
  if (current === 'planner') paintPlanner();
}
