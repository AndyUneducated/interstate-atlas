/* Overlay views: numbering explainer, statistics, jurisdiction picker and
   the about page. */

import {
  t, getLang, stateName, dist, num, lenOf, lenUnit, isProvince, ownerLabel,
  countryOfJuris, lenNum, routeLabel,
} from './i18n.js';
import { app, select, loadState, zoomToState, shieldHtml } from './app.js';
import { SYSTEMS, CLASS_COLOUR, countryOf } from './schema.js';
import { loadSpeed, speedColour, bandLabel, speedUnit, BANDS, UNKNOWN } from './speed.js';

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
    states: renderStates,
    provinces: renderProvinces,
    mxstates: renderMxStates,
    cnprovinces: renderCnProvinces,
    about: renderAbout,
    docs: renderDocs,
  }[key];
  if (!render) { current = null; return; }

  inner.innerHTML = render();
  host.classList.remove('hidden');
  document.getElementById('shClose').addEventListener('click', closeSheet);
  host.onclick = (e) => { if (e.target.id === 'sheet') closeSheet(); };

  ({
    numbering: wireNumbering,
    dashboard: wireDashboard,
    states: wireStates,
    provinces: wireStates,
    mxstates: wireStates,
    cnprovinces: wireStates,
    about: wireAbout,
    docs: wireDocs,
  }[key])();
}

/* ══════════════════════════════════════════════════════════════════════
   Numbering explainer
   ══════════════════════════════════════════════════════════════════════ */

const VW = 620;
const VH = 330;

// The lower 48, and the band of the St Lawrence that Québec's autoroutes sit
// in. Two boxes rather than one continental frame: at continental scale the
// Québec grid collapses into the top-right corner and the thing the diagram is
// there to show stops being legible.
const US_BOX = { lon0: -125.5, lon1: -66.5, lat0: 24.0, lat1: 49.5 };
const QC_BOX = { lon0: -79.8, lon1: -66.2, lat0: 44.9, lat1: 49.3 };

const xOf = (lon, b = US_BOX) => ((lon - b.lon0) / (b.lon1 - b.lon0)) * VW;
const yOf = (lat, b = US_BOX) => VH - ((lat - b.lat0) / (b.lat1 - b.lat0)) * VH;

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

/**
 * Québec's two-digit autoroutes, which are the one Canadian set with a grid to
 * draw.
 *
 * Scoped to the two-digit numbers on purpose. The ministry's own directory says
 * the ordering principle "s'applique seulement aux autoroutes 5 à 85", so
 * drawing the 400–999 series on the same axes would illustrate a rule that
 * Québec does not claim for them.
 */
function qcAutoroutes(orientation) {
  const rows = app.index.filter((r) => r.st === 'QC' && /^A-\d+$/.test(r.label)
    && r.base != null && r.base >= 5 && r.base <= 85);
  const set = rows.filter((r) => (orientation === 'ns' ? r.base % 2 === 1 : r.base % 2 === 0));
  const best = new Map();
  for (const r of set) {
    const prev = best.get(r.base);
    if (!prev || r.mi > prev.mi) best.set(r.base, r);
  }
  return [...best.values()].sort((a, b) => (orientation === 'ns' ? a.cx - b.cx : a.cy - b.cy));
}

/** The extent the given routes actually occupy, padded so nothing sits on the edge. */
function boxOf(routes, pad = 0.6) {
  const xs = routes.map((r) => r.cx);
  const ys = routes.map((r) => r.cy);
  return {
    lon0: Math.min(...xs) - pad, lon1: Math.max(...xs) + pad,
    lat0: Math.min(...ys) - pad, lat1: Math.max(...ys) + pad,
  };
}

function numberingDiagram(sys, opts = {}) {
  const box = opts.box ?? US_BOX;
  const colour = opts.colour ?? (sys === 'us-interstate' ? '#35e7ff' : '#ffb545');
  const pick = opts.pick ?? ((o) => gridRoutes(sys, o));
  const ns = pick('ns');
  const ew = pick('ew');

  // A graticule at whatever spacing gives the box a handful of lines, so the
  // Québec frame is not either bare or a grid of solid fill.
  const grid = [];
  const lonStep = opts.lonStep ?? 10;
  const latStep = opts.latStep ?? 5;
  for (let lon = Math.ceil(box.lon0 / lonStep) * lonStep; lon <= box.lon1; lon += lonStep) {
    const x = xOf(lon, box).toFixed(1);
    grid.push(`<line class="nb-grid-line" x1="${x}" y1="0" x2="${x}" y2="${VH}"/>`);
  }
  for (let lat = Math.ceil(box.lat0 / latStep) * latStep; lat <= box.lat1; lat += latStep) {
    const y = yOf(lat, box).toFixed(1);
    grid.push(`<line class="nb-grid-line" x1="0" y1="${y}" x2="${VW}" y2="${y}"/>`);
  }

  // Every route gets a line; not every route can get a label. East of the
  // Mississippi the spacing between numbers is a few pixels, and labelling all
  // of them turned the top of the diagram into a smear. Labels are placed in
  // order of importance — the multiples of five are the long-haul spines the
  // panel beside this is explaining — and any that would collide with one
  // already placed is dropped. The line stays, so nothing disappears.
  // Reports whether the position was still free, and claims it if so. It used
  // to return a `weight` argument that no call site ever passed, so it answered
  // undefined every time and the diagram has been running without any labels at
  // all. The ranking it was presumably meant to carry is done by `byRank`.
  const labeller = (gap) => {
    const placed = [];
    return (pos) => {
      if (placed.some((p) => Math.abs(p - pos) < gap)) return false;
      placed.push(pos);
      return true;
    };
  };
  const byRank = (rs) => [...rs].sort((a, b) => (Number(a.base) % 5) - (Number(b.base) % 5));

  const lines = [];
  const labels = [];
  const fitsX = labeller(opts.gapX ?? 13);
  for (const r of byRank(ns)) {
    if (fitsX(xOf(r.cx, box))) {
      labels.push(`<text class="nb-lab" data-n="${r.base}" x="${xOf(r.cx, box).toFixed(1)}" y="9" text-anchor="middle">${r.base}</text>`);
    }
  }
  for (const r of ns) {
    const x = xOf(r.cx, box);
    lines.push(`<line class="nb-route" data-n="${r.base}" data-id="${r.id}" stroke="${colour}"
      x1="${x.toFixed(1)}" y1="14" x2="${x.toFixed(1)}" y2="${VH - 6}"><title>${r.label}</title></line>`);
  }
  const fitsY = labeller(opts.gapY ?? 9);
  for (const r of byRank(ew)) {
    if (fitsY(yOf(r.cy, box))) {
      labels.push(`<text class="nb-lab" data-n="${r.base}" x="${VW - 15}" y="${(yOf(r.cy, box) + 3).toFixed(1)}">${r.base}</text>`);
    }
  }
  for (const r of ew) {
    const y = yOf(r.cy, box);
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

/* The page is a country first and a system second. Which country it opens on
   follows the map: whoever is looking at Taiwan is not asking about Ohio. */
const NB_COUNTRIES = [
  { cc: 'us', tabs: ['us-interstate', 'us-numbered', 'aux'], sample: (r) => r.label === 'I-95' },
  { cc: 'ca', tabs: ['ca'], sample: (r) => r.sys === 'ca-tch' && r.num === '1' },
  { cc: 'cn', tabs: ['cn-expressway', 'cn-national', 'cn-provincial'], sample: (r) => r.id === 'cn-g4' },
  { cc: 'tw', tabs: ['tw-freeway', 'tw-provincial'], sample: (r) => r.id === 'tw-fwy-1' },
  { cc: 'hk', tabs: ['hk-route'], sample: (r) => r.id === 'hk-9' },
];
const NB_TAB_KEY = { 'us-interstate': 'nb.tab.i', 'us-numbered': 'nb.tab.us', aux: 'nb.tab.aux', ca: 'nb.tab.ca' };
const NB_CC_SYS = { us: 'us-interstate', ca: 'ca-tch', cn: 'cn-expressway', tw: 'tw-freeway', hk: 'hk-route' };
const regionOfCc = (cc) => (['cn', 'tw', 'hk'].includes(cc) ? 'ea' : 'na');

// Rough boxes, enough to tell which country the middle of the view is over.
function nbCountryInView() {
  const c = app.map?.getCenter();
  if (app.region === 'ea') {
    if (c && c.lng > 119.2 && c.lng < 122.4 && c.lat > 21.7 && c.lat < 25.6) return 'tw';
    if (c && c.lng > 113.8 && c.lng < 114.5 && c.lat > 22.1 && c.lat < 22.6) return 'hk';
    return 'cn';
  }
  if (c && ((c.lat > 49.2 && c.lng > -141) || (c.lat > 45.3 && c.lng > -80 && c.lng < -52))) return 'ca';
  return 'us';
}

let nbCountry = null;
let nbOpenedFor = null;
const nbTabOf = {};

function renderNumbering() {
  // Reopened for the same view - a language switch rebuilds the sheet - the
  // reader stays where they were; opened over a different country, it follows.
  const here = nbCountryInView();
  if (here !== nbOpenedFor) { nbCountry = here; nbOpenedFor = here; }
  const order = [...NB_COUNTRIES].sort((a, b) => (regionOfCc(b.cc) === app.region) - (regionOfCc(a.cc) === app.region));
  const rail = order.map((c) => {
    const row = app.index.find(c.sample);
    return `<button class="nb-cc${c.cc === nbCountry ? ' on' : ''}" data-cc="${c.cc}" type="button" style="--cc:var(--c-${NB_CC_SYS[c.cc]})">
      <span class="nb-cc-shield">${row ? shieldHtml(row, true) : ''}</span>
      <span class="nb-cc-t"><i class="flagdot flag-${c.cc}"></i><b>${t(`sys.country.${c.cc}`)}</b>
        <small>${c.tabs.length > 1 ? t('nb.systems', { n: c.tabs.length }) : t(NB_TAB_KEY[c.tabs[0]] || `sys.${c.tabs[0]}`)}</small></span>
    </button>`;
  }).join('');
  const body = `
    <div class="nb-rail" role="tablist">${rail}</div>
    <div class="nb-tabs" id="nbTabs"></div>
    <div id="nbBody"></div>`;
  return frame('nb.title', 'nb.sub', body);
}

function nbPane(kind) {
  if (kind === 'aux') return nbAuxPane();
  if (kind === 'ca') return nbCanadaPane();
  if (kind === 'cn-provincial') return nbProvincialPane();
  if (PLATES[kind]) return nbPlatePane(kind);
  const d = numberingDiagram(kind);
  const zh = getLang() === 'zh';
  const isI = kind === 'us-interstate';

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

  return `${anatomy(kind)}<div class="nb-wrap">
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
  const aux = app.index.filter((r) => r.sys === 'us-interstate' && r.tier === 'auxiliary');
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

  return `${anatomy('aux')}<div class="nb-wrap">
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

/* Canada is not a third grid, and the panel would be lying if it drew one.
   Numbering is a provincial power, there is no federal numbering authority, and
   the thirteen answers run from written into regulation to a ministry saying in
   public that no system exists. So the pane is built around that spread rather
   than around a rule: one diagram, because exactly one province has a grid, and
   a ladder that says what each of the others actually publishes. */

const CA_LADDER = [
  ['QC', 'stated', { en: 'Parity, direction and the three-digit rule, all published by the ministry', zh: '奇偶、方向与三位数规则，均由交通部公布' }],
  ['MB', 'codified', { en: 'The power to number is in the Act and the numbers are in regulation — but there is no pattern to codify', zh: '编号权限写进法案、号码写进条例——但没有任何模式可供成文' }],
  ['PE', 'codified', { en: 'Road classes are set in regulation, naming each road rather than a number range', zh: '道路等级由条例设定，逐条列名而非划定号段' }],
  ['NB', 'stated', { en: 'Arterial 1–99, collector 100–199, local 200–999', zh: '干线 1–99、集散 100–199、地方 200–999' }],
  ['NS', 'stated', { en: '100-series arterial, trunk 1–66, collector 200–399', zh: '100 系为干线、1–66 为主干、200–399 为集散' }],
  ['AB', 'stated', { en: 'Two series, 1–216 and 500–986, assigned by Ministerial Order. The directional logic is not in any document I could find', zh: '1–216 与 500–986 两个序列，由部长令指定。方向性逻辑查不到任何文件依据' }],
  ['ON', 'observed', { en: '400-series means freeway, and many are the old number plus 400 — described by historians, not by the ministry', zh: '400 系代表高速公路，多数是旧号加 400——此说出自研究者而非交通部' }],
  ['SK', 'observed', { en: '600s north–south, 700s east–west. No government statement of it', zh: '600 系南北向、700 系东西向。政府未作任何表述' }],
  ['NL', 'observed', { en: 'Numbers cluster by region, east to west. No parity or directional rule', zh: '号码按区域自东向西聚集。无奇偶或方向规则' }],
  ['YT', 'observed', { en: 'Fourteen highways, numbered 1–11, 14–15 and 37. No rule', zh: '十四条地区公路，编号 1–11、14–15 与 37。无规则' }],
  ['NT', 'observed', { en: 'Ten highways, numbered 1–10, each also named. No rule', zh: '十条公路，编号 1–10，各有名称。无规则' }],
  ['BC', 'denied', { en: 'Technical Circular T-06/96 sets out the numbering criteria and contains no geographic rule at all. The ministry: “there isn’t one”', zh: '技术通告 T-06/96 规定了编号准则，其中没有任何地理规则。交通部原话：“并不存在”' }],
  ['NU', 'none', { en: 'There are roads, but none of them carry a number', zh: '有道路，但没有一条带编号' }],
];

const CA_LEVEL_COLOUR = {
  codified: '#6ef7a5', stated: '#35e7ff', observed: '#ffb545', denied: '#ff6b8a', none: '#7a8ca6',
};

function nbCanadaPane() {
  const zh = getLang() === 'zh';
  // Framed to the autoroutes themselves. A guessed box left most of the panel
  // empty with everything knotted around Montréal, because that is where the
  // network is; letting the data set the frame spends the width on the part
  // that has something in it.
  const qc = [...qcAutoroutes('ns'), ...qcAutoroutes('ew')];
  const d = numberingDiagram('ca-provincial', {
    box: qc.length ? boxOf(qc) : QC_BOX,
    colour: '#a98bff', pick: qcAutoroutes, lonStep: 2, latStep: 1,
    gapX: 22, gapY: 13,
  });

  // The Trans-Canada's numbers, read out of the atlas rather than recited, so
  // the claim that it changes number at provincial lines is shown in the data.
  const tch = new Map();
  for (const r of app.index) {
    if (r.sys !== 'ca-tch' || !r.st) continue;
    const prev = tch.get(r.st);
    if (!prev || r.mi > prev.mi) tch.set(r.st, r);
  }
  // Distinct numbers, longest first. Listing one entry per jurisdiction repeated
  // the shared ones back at the reader — "TCH 1, TCH 1, TCH 16, TCH 16" — which
  // undercut the very point the sentence is making.
  const byNum = new Map();
  for (const r of tch.values()) {
    const prev = byNum.get(r.num);
    if (!prev || r.mi > prev.mi) byNum.set(r.num, r);
  }
  const tchNums = [...byNum.values()].sort((a, b) => b.mi - a.mi).map((r) => `<b>${r.label}</b>`);
  const distinct = byNum.size;

  const rules = [
    [zh ? '没有全国性网格' : 'There is no national grid',
      zh ? `编号是省级权力，不存在联邦编号机构。横加公路本身就是证据：它在本图谱收录的 ${tch.size} 个省区里用了 <b>${distinct}</b> 种不同编号——${tchNums.slice(0, 6).join('、')}……`
        : `Numbering is a provincial power and no federal numbering authority exists. The Trans-Canada is its own proof: across the ${tch.size} jurisdictions in this atlas it carries <b>${distinct}</b> different numbers — ${tchNums.slice(0, 6).join(', ')}…`],
    [zh ? '同一条路，过境换号' : 'One road, two numbers',
      zh ? '登普斯特公路在育空是 <b>5 号</b>，越过地区界线就变成西北地区 <b>8 号</b>。没有任何机构负责阻止这种事。'
        : 'The Dempster Highway is <b>Yukon 5</b> on one side of the territorial line and <b>Northwest Territories 8</b> on the other. There is no body whose job it is to prevent that.'],
    [zh ? '魁北克是唯一的例外' : 'Québec is the one exception',
      zh ? '偶数东西向（平行于圣劳伦斯河），奇数南北向。交通部注明该原则<b>仅适用于 5 至 85 号</b>。'
        : 'Even numbers run east–west, parallel to the St Lawrence; odd numbers run north–south. The ministry bounds the principle: <i>“Ce principe s’applique seulement aux autoroutes 5 à 85.”</i>'],
    [zh ? '但方向究竟朝哪边，官方自己说反了' : 'Which way they climb, the ministry gets backwards',
      zh ? `《高速公路名录》写的是「奇数自南向北、偶数自西向东」，但路网本身恰好相反：奇数<b>自西向东</b>递增（加蒂诺的 A-5 到里维耶尔迪吕的 A-85），偶数<b>自南向北</b>递增。左图按实测坐标绘制，因此呈现的是路网的答案而非文本的答案。这类分歧本站选择保留而非抹平。`
        : 'The <i>Répertoire</i> pairs odd with south-to-north and even with west-to-east. The network is the other way round: odd climbs <b>west to east</b>, from A-5 at Gatineau to A-85 at Rivière-du-Loup, and even climbs <b>south to north</b>. The diagram is drawn from measured positions, so it shows the network’s answer rather than the sentence’s. The disagreement is kept here rather than tidied away.'],
    [zh ? '三位数的规则和美国一模一样' : 'Three digits work just like the Interstates',
      zh ? '<b>偶数打头是绕城、奇数打头是支线</b>，后两位指明母路——A-440 绕行 A-40，A-720 是 A-20 的支线。此条出自交通部关于路线编号的官方播客，而非《名录》页面，后者并未提及。'
        : 'An <b>even first digit is a bypass, an odd one a spur</b>, and the last two digits name the parent — A-440 detours A-40, A-720 is an antenna off A-20. This one comes from the ministry’s own podcast on route numbers, not from the <i>Répertoire</i>, which does not mention it.'],
    [zh ? '不列颠哥伦比亚官方否认有系统' : 'British Columbia says there is no system',
      zh ? '交通部技术通告 T-06/96 是编号的官方文件，通篇没有任何地理或奇偶规则，只写明“编号主要取决于该公路的功能分级”。部门自己的说法更直接：看起来没有逻辑，是因为真的没有。'
        : 'Technical Circular T-06/96 is the official document on numbering. It contains no geographic or parity rule whatsoever — its entire stated criterion is that “highway numbering decisions are largely determined by the functional classifications of the highway”. The ministry puts it more bluntly: there is no logical connection because there isn’t one.'],
  ];

  return `${anatomy('ca')}<div class="nb-wrap ca">
    <div class="nb-viz">${d.svg}
      <p style="margin:10px 2px 0;font-family:var(--mono);font-size:9.5px;color:var(--ink-faint)">${t('nb.ca.cap')}</p>
    </div>
    <div class="nb-note">
      <h4>${t('nb.ca.h')}</h4>
      ${rules.map(([k, v], i) => `<div class="nb-rule">
        <span class="nb-rule-n">${i + 1}</span>
        <span class="nb-rule-t"><b>${k}</b><br>${v}</span>
      </div>`).join('')}

      <h4 style="margin-top:16px">${t('nb.ca.ladder')}</h4>
      <div class="nb-ladder">
        ${CA_LADDER.map(([st, level, note]) => `<div class="nb-lad">
          <span class="nb-lad-st">${st}</span>
          <span class="nb-lad-lv" style="--lv:${CA_LEVEL_COLOUR[level]}">${t(`nb.ca.lv.${level}`)}</span>
          <span class="nb-lad-n">${note[zh ? 'zh' : 'en']}</span>
        </div>`).join('')}
      </div>
      <p class="nb-src">${zh
    ? '来源：魁北克《公路网功能分级》、《魁北克高速公路名录》与交通部播客《De A720 à R136》；BC 交通部技术通告 T-06/96（1997 年 2 月 14 日生效）；曼尼托巴《公路与运输法》CCSM c. H40 及 M.R. 415/88；新不伦瑞克运输与基建厅；新斯科舍公共工程厅。标为“仅为观察到的模式”者，指本站未能找到任何政府文件陈述该规则。'
    : 'Sources: Québec’s Classification fonctionnelle du réseau routier, the Répertoire des autoroutes du Québec and the ministry podcast De A720 à R136; BC Ministry of Transportation Technical Circular T-06/96, in force 14 February 1997; Manitoba’s Highways and Transportation Act CCSM c. H40 and M.R. 415/88; NBDTI; Nova Scotia Public Works. “Pattern only” means no government document stating the rule could be found.'}</p>
    </div>
  </div>`;
}

/* ── number plates: the real lines, coloured by what their number says ──── */

const fourDigit = (p) => {
  const m = /^G(\d\d)(\d)\d$/.exec(String(p.num ?? ''));
  return m && m[1][0] !== '9' ? m[2] : null;
};
const twoDigit = (p) => (/^G\d\d$/.test(String(p.num ?? '')) ? Number(p.num.slice(1)) : null);
const unsuffixed = (p) => /^\d+$/.test(String(p.num ?? ''));
const L = (en, zh) => ({ en, zh });

/* Each class is a rule and a colour. `arrow` asks for the direction the
   numbers climb to be measured from the atlas's own positions and drawn;
   `orient` asks for each line's actual run to be checked against the rule. */
const PLATES = {
  'cn-expressway': {
    file: 'cn/expressway.json', centre: [116.4, 39.9],
    classes: [
      { key: 'radial', colour: '#ff5a7a', test: (p) => /^G\d$/.test(p.num), arrow: 'radial',
        h: L('One digit: out of Beijing', '一位数：首都放射线'),
        p: L('G1 to G7 leave the capital and are numbered clockwise from the north-east - G1 to Harbin, G4 to Hong Kong and Macau, G7 to Ürümqi.',
          'G1 至 G7 从北京出发，自东北方向起顺时针编号：G1 通哈尔滨，G4 通港澳，G7 通乌鲁木齐。') },
      { key: 'ns', colour: '#35e7ff', test: (p) => twoDigit(p) != null && twoDigit(p) < 90 && twoDigit(p) % 2 === 1, arrow: 'x', orient: 'ns',
        h: L('Odd two digits: north–south', '两位奇数：南北纵线'),
        p: L('Numbered from east to west.', '自东向西编号。') },
      { key: 'ew', colour: '#ffd166', test: (p) => twoDigit(p) != null && twoDigit(p) < 90 && twoDigit(p) % 2 === 0, arrow: 'y', orient: 'ew',
        h: L('Even two digits: east–west', '两位偶数：东西横线'),
        p: L('Numbered from north to south.', '自北向南编号。') },
      { key: 'ring', colour: '#a98bff', test: (p) => /^G9\d$/.test(p.num),
        h: L('9 and a digit: regional rings', '9 字头两位数：地区环线'),
        p: L('Loops around a whole region rather than a city - G94 around the Pearl River Delta, G98 around Hainan.',
          '环绕整个地区而非单座城市，例如 G94 珠三角环线、G98 海南地区环线。') },
      { key: 'city', colour: '#6ef7a5', test: (p) => fourDigit(p) === '0',
        h: L('Parent + 0 + n: city ring', '主线号 + 0 + 序号：城市绕城环线'),
        p: L('G4201 is the ring around Chengdu, hung off G42.', 'G4201 是挂在 G42 名下的成都绕城高速。') },
      { key: 'link', colour: '#ff9f68', test: (p) => fourDigit(p) === '1',
        h: L('Parent + 1 + n: connector', '主线号 + 1 + 序号：联络线'),
        p: L('A link between lines, named after the line it leaves - G1511 leaves G15.', '连接两条线路的联络线，以其所出的主线命名，例如 G1511 出自 G15。') },
      { key: 'par', colour: '#f06bff', test: (p) => fourDigit(p) === '2',
        h: L('Parent + 2 + n: parallel', '主线号 + 2 + 序号：并行线'),
        p: L('A second road along a busy corridor - G0421 runs beside G4; a one-digit parent is padded with a zero.',
          '为繁忙走廊另建的平行线路，例如 G0421 与 G4 并行；一位数的主线前面补 0。') },
      { key: 'other', colour: '#7a8ca6', test: () => true,
        h: L('Everything else', '其余编号'),
        p: L('A third digit of 3 and up, the G99xx series and lettered codes. No published rule for these was found.',
          '第三位为 3 及以上、G99 开头的四位数，以及带字母的编号。本站未找到成文规则。') },
    ],
  },
  'cn-national': {
    file: 'cn/national.json', centre: [116.4, 39.9],
    classes: [
      { key: 'radial', colour: '#ff5a7a', test: (p) => /^G1\d\d$/.test(p.num), arrow: 'radial',
        h: L('1xx: out of Beijing', '1 字头：首都放射线'),
        p: L('The ordinary roads follow the expressways\' pattern a digit higher: G101 onwards leave the capital, clockwise.',
          '普通国道沿用高速的模式，只是多一位：G101 起从北京放射，顺时针编号。') },
      { key: 'ns', colour: '#35e7ff', test: (p) => /^G2\d\d$/.test(p.num), arrow: 'x', orient: 'ns',
        h: L('2xx: north–south', '2 字头：南北纵线'),
        p: L('Broadly east to west from G201 in the north-east. Numbers added later sit among the old ones, so the order is loose - which the measured fit beside this shows.',
          '从东北的 G201 起，大体自东向西编号。后来增补的号码插在其间，顺序因此松散，旁边的实测吻合度反映的正是这一点。') },
      { key: 'ew', colour: '#ffd166', test: (p) => /^G3\d\d$/.test(p.num), arrow: 'y', orient: 'ew',
        h: L('3xx: east–west', '3 字头：东西横线'),
        p: L('Broadly north to south from G301 in Heilongjiang, loosened the same way.', '从黑龙江的 G301 起，大体自北向南编号，后补号码同样打乱了顺序。') },
      { key: 'link', colour: '#ff9f68', test: (p) => /^G[5-9]\d\d$/.test(p.num),
        h: L('5xx and up: connectors', '5 字头及以上：联络线'),
        p: L('Short links between the grid lines.', '连接纵横干线的联络线。') },
      { key: 'other', colour: '#7a8ca6', test: () => true, h: L('Everything else', '其余编号'), p: L('', '') },
    ],
  },
  'tw-freeway': {
    file: 'tw/freeway.json',
    classes: [
      { key: 'ns', colour: '#35e7ff', test: (p) => unsuffixed(p) && p.base % 2 === 1, arrow: 'x', orient: 'ns',
        h: L('Odd: north–south', '奇数：南北向'),
        p: L('Freeways 1 and 3 run the length of the west, Freeway 5 crosses to Yilan on the east.', '国道 1 号、3 号纵贯西部，国道 5 号通往东部的宜兰。') },
      { key: 'ew', colour: '#ffd166', test: (p) => unsuffixed(p) && p.base % 2 === 0, arrow: 'y', orient: 'ew',
        h: L('Even: east–west', '偶数：东西向'),
        p: L('Short cross-island links, numbered from north to south.', '较短的东西向连络道，自北向南编号。') },
      { key: 'branch', colour: '#f06bff', test: () => true,
        h: L('A suffix: a branch', '加“甲”：支线'),
        p: L('甲, the first of the ten heavenly stems, marks the first branch - 3甲 off Freeway 3.', '天干“甲”表示第一条支线，例如国道 3 号甲线。') },
    ],
  },
  'tw-provincial': {
    file: 'tw/provincial.json',
    classes: [
      { key: 'ew', colour: '#ffd166', test: (p) => unsuffixed(p) && p.base >= 62 && p.base % 2 === 0, arrow: 'y', orient: 'ew',
        h: L('62–88, even: east–west expressways', '62–88 偶数：东西向快速公路'),
        p: L('Twelve short expressways from the coast inland, numbered strictly from north to south.', '十二条由海岸通往内陆的快速公路，严格自北向南编号。') },
      { key: 'coast', colour: '#35e7ff', test: (p) => unsuffixed(p) && p.base >= 61 && p.base % 2 === 1, orient: 'ns',
        h: L('61 and up, odd: north–south', '61 以上奇数：南北向'),
        p: L('Provincial Highway 61 is the west-coast expressway.', '台 61 线即西部滨海快速公路。') },
      { key: 'trunk', colour: '#6ef7a5', test: (p) => unsuffixed(p) && p.base < 61, orient: (p) => (p.base % 2 ? 'ns' : 'ew'),
        h: L('1–39: the older trunk roads', '1–39：传统省道干线'),
        p: L('Mostly odd for north–south and even for east–west, with exceptions: Highway 7 is the Northern Cross-Island Highway.',
          '大体奇数南北、偶数东西，但有例外：台 7 线就是东西向的北部横贯公路。') },
      { key: 'branch', colour: '#f06bff', test: () => true,
        h: L('A suffix: a branch', '加天干：支线'),
        p: L('甲 乙 丙 丁 … in order, so Highway 9 has branches 9甲 to 9戊.', '依天干甲、乙、丙、丁……排序，例如台 9 线有甲线至戊线。') },
    ],
  },
  'hk-route': {
    file: 'hk/routes.json', perRoute: true,
    classes: [
      { key: 'route', colour: '#f06bff', test: () => true,
        h: L('1 to 10: a name, not a position', '1 至 10 号：只是代号'),
        p: L('The number says nothing about direction or place. Route 1 runs from Aberdeen through the Cross-Harbour Tunnel to Sha Tin; Route 9 is the circuit of the New Territories.',
          '编号不表示方向，也不表示位置。1 号干线从香港仔经海底隧道到沙田；9 号干线是环绕新界的环迴线。') },
    ],
  },
};
const HK_PALETTE = ['#35e7ff', '#ffd166', '#ff5a7a', '#6ef7a5', '#a98bff', '#ff9f68', '#f06bff', '#5aa9ff', '#9be15d', '#ff9ecb'];

const geoCache = new Map();
function geoOf(file) {
  if (!geoCache.has(file)) geoCache.set(file, fetch(`data/geo/${file}`).then((r) => r.json()));
  return geoCache.get(file);
}
const linesOf = (g) => (g?.type === 'LineString' ? [g.coordinates] : g?.type === 'MultiLineString' ? g.coordinates : []);

/** Spearman's rank correlation, enough to say whether numbers climb with position. */
function rankCorr(xs, ys) {
  const rank = (v) => {
    const idx = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(v.length);
    idx.forEach(([, i], k) => { r[i] = k; });
    return r;
  };
  const a = rank(xs);
  const b = rank(ys);
  const n = a.length;
  const ma = (n - 1) / 2;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - ma); da += (a[i] - ma) ** 2; db += (b[i] - ma) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

function nbPlatePane(kind) {
  const spec = PLATES[kind];
  const zh = getLang() === 'zh';
  const counts = {};
  for (const r of app.index) {
    if (r.sys !== kind) continue;
    const c = spec.classes.find((x) => x.test(r))?.key;
    counts[c] = (counts[c] || 0) + 1;
  }
  const cards = spec.classes.filter((c) => counts[c.key]).map((c) => `
    <button class="nb-cls" type="button" data-c="${c.key}" style="--k:${c.colour}">
      <span class="nb-cls-hd"><i></i><b>${c.h[zh ? 'zh' : 'en']}</b><em>${num(counts[c.key])}</em></span>
      ${c.p[zh ? 'zh' : 'en'] ? `<span class="nb-cls-p">${c.p[zh ? 'zh' : 'en']}</span>` : ''}
      <span class="nb-fit" data-fit="${c.key}"></span>
    </button>`).join('');
  return `${anatomy(kind)}<div class="nb-wrap nb-wrap-plate">
    <div class="nb-plate" data-plate="${kind}">
      <div class="nb-read" aria-live="polite"></div>
      <p class="nb-load">${t('nb.loading')}</p>
    </div>
    <div class="nb-note">
      <h4>${t('nb.plate.h', { sys: t(`sys.${kind}`) })}</h4>
      <p class="nb-hint">${t('nb.plate.hint')}</p>
      <div class="nb-clss">${cards}</div>
    </div>
  </div>`;
}

async function drawPlate(kind, host) {
  const spec = PLATES[kind];
  let gj;
  try { gj = await geoOf(spec.file); } catch { host.querySelector('.nb-load').textContent = t('nb.loadFail'); return; }
  if (!host.isConnected) return;
  const zh = getLang() === 'zh';
  const classOf = (p) => spec.classes.find((c) => c.test(p)) || spec.classes[spec.classes.length - 1];

  let lon0 = 180, lon1 = -180, lat0 = 90, lat1 = -90;
  for (const f of gj.features) {
    for (const line of linesOf(f.geometry)) {
      for (const [x, y] of line) {
        if (x < lon0) lon0 = x; if (x > lon1) lon1 = x;
        if (y < lat0) lat0 = y; if (y > lat1) lat1 = y;
      }
    }
  }
  const k = Math.cos(((lat0 + lat1) / 2) * Math.PI / 180);
  const aspect = ((lon1 - lon0) * k) / (lat1 - lat0);
  const W = aspect >= 1.1 ? 640 : Math.round(470 * aspect);
  const H = aspect >= 1.1 ? Math.round(640 / aspect) : 470;
  const pad = 10;
  const TOP = 26;
  const RIGHT = 46;
  const s = Math.min((W - 2 * pad) / ((lon1 - lon0) * k), (H - 2 * pad) / (lat1 - lat0));
  const px = (lon) => pad + (lon - lon0) * k * s;
  const py = (lat) => TOP + pad + (lat1 - lat) * s;

  // Paths, thinned to what the plate can show, and each line's actual run.
  const fit = {};
  const paths = [];
  gj.features.forEach((f) => {
    const p = f.properties;
    const cls = classOf(p);
    let d = '';
    let bx0 = 180, bx1 = -180, by0 = 90, by1 = -90;
    for (const line of linesOf(f.geometry)) {
      let lx = null, ly = null;
      for (const [x, y] of line) {
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
        if (y < by0) by0 = y; if (y > by1) by1 = y;
        const X = px(x), Y = py(y);
        if (lx !== null && Math.abs(X - lx) + Math.abs(Y - ly) < 1.1) continue;
        d += `${lx === null ? 'M' : 'L'}${X.toFixed(1)} ${Y.toFixed(1)}`;
        lx = X; ly = Y;
      }
    }
    if (!d) return;
    const want = typeof cls.orient === 'function' ? cls.orient(p) : cls.orient;
    if (want) {
      const runs = (by1 - by0) > (bx1 - bx0) * k ? 'ns' : 'ew';
      fit[cls.key] ??= { ok: 0, n: 0, miss: [] };
      fit[cls.key].n++;
      if (runs === want) fit[cls.key].ok++;
      else fit[cls.key].miss.push(routeLabel(p.label));
    }
    const colour = spec.perRoute ? HK_PALETTE[(Number(p.base) - 1) % HK_PALETTE.length] : cls.colour;
    const name = zh ? (p.plan?.short || p.named?.find((n) => /[\u4e00-\u9fff]/.test(n)) || '') : (p.plan?.en || p.named?.find((n) => !/[\u4e00-\u9fff]/.test(n)) || '');
    const order = spec.classes.length - spec.classes.indexOf(cls);
    paths.push([order, `<path class="nb-route nb-geo" data-id="${esc(p.id)}" data-c="${cls.key}" data-label="${esc(routeLabel(p.label))}" data-name="${esc(name)}"
      stroke="${colour}" stroke-width="${p.tier === 'primary' ? 1.9 : 1.2}" d="${d}"/>`]);
    if (spec.perRoute) {
      const mid = linesOf(f.geometry)[0]?.[Math.floor(linesOf(f.geometry)[0].length / 2)];
      if (mid) paths.push([99, `<text class="nb-hk" x="${px(mid[0]).toFixed(1)}" y="${(py(mid[1]) - 5).toFixed(1)}" fill="${colour}">${esc(p.num)}</text>`]);
    }
  });
  paths.sort((a, b) => a[0] - b[0]);

  // The direction each class climbs, measured rather than asserted.
  const marks = [];
  const defs = [];
  const fitText = {};
  for (const cls of spec.classes) {
    if (!cls.arrow) continue;
    const best = new Map();
    for (const r of app.index) {
      if (r.sys !== kind || r.tier !== 'primary' || classOf(r) !== cls) continue;
      const prev = best.get(r.base);
      if (!prev || r.mi > prev.mi) best.set(r.base, r);
    }
    const rows = [...best.values()].sort((a, b) => a.base - b.base);
    if (rows.length < 3) continue;
    defs.push(`<marker id="nbA-${kind}-${cls.key}" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L8 4L0 8z" fill="${cls.colour}"/></marker>`);
    const first = routeLabel(rows[0].label);
    const last = routeLabel(rows[rows.length - 1].label);
    if (cls.arrow === 'radial') {
      const [cx0, cy0] = [px(spec.centre[0]), py(spec.centre[1])];
      let prev = null;
      const angs = rows.map((r) => {
        let a = Math.atan2(py(r.cy) - cy0, px(r.cx) - cx0);
        if (prev !== null) { while (a - prev > Math.PI) a -= 2 * Math.PI; while (a - prev < -Math.PI) a += 2 * Math.PI; }
        prev = a;
        return a;
      });
      const a0 = angs[0];
      const a1 = angs[angs.length - 1];
      const R = 30;
      const pt = (a, rr = R) => [cx0 + Math.cos(a) * rr, cy0 + Math.sin(a) * rr];
      const [x0, y0] = pt(a0);
      const [x1, y1] = pt(a1);
      const sweep = a1 > a0 ? 1 : 0;
      const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
      const [lx0, ly0] = pt(a0, R + 13);
      const [lx1, ly1] = pt(a1, R + 13);
      marks.push(`<g class="nb-mark" data-c="${cls.key}">
        <circle cx="${cx0.toFixed(1)}" cy="${cy0.toFixed(1)}" r="3.2" fill="${cls.colour}"/>
        <path d="M${x0.toFixed(1)} ${y0.toFixed(1)}A${R} ${R} 0 ${large} ${sweep} ${x1.toFixed(1)} ${y1.toFixed(1)}" stroke="${cls.colour}" class="nb-arc" marker-end="url(#nbA-${kind}-${cls.key})"/>
        <text x="${lx0.toFixed(1)}" y="${(ly0 + 3).toFixed(1)}" text-anchor="middle" fill="${cls.colour}">${esc(first)}</text>
        <text x="${lx1.toFixed(1)}" y="${(ly1 + 3).toFixed(1)}" text-anchor="middle" fill="${cls.colour}">${esc(last)}</text>
      </g>`);
      fitText[cls.key] = sweep ? t('nb.fit.cw') : t('nb.fit.ccw');
      continue;
    }
    const along = cls.arrow === 'x' ? (r) => r.cx : (r) => r.cy;
    const rho = rankCorr(rows.map((r) => r.base), rows.map(along));
    const lo = Math.min(...rows.map(along));
    const hi = Math.max(...rows.map(along));
    // Climbing means the arrow runs from the low numbers' side to the high.
    const up = rho >= 0;
    if (cls.arrow === 'x') {
      const xa = px(up ? lo : hi), xb = px(up ? hi : lo);
      const y = 13;
      marks.push(`<g class="nb-mark" data-c="${cls.key}">
        <line x1="${xa.toFixed(1)}" y1="${y}" x2="${xb.toFixed(1)}" y2="${y}" stroke="${cls.colour}" marker-end="url(#nbA-${kind}-${cls.key})"/>
        <text x="${(xa + (xb > xa ? -4 : 4)).toFixed(1)}" y="${y + 3}" text-anchor="${xb > xa ? 'end' : 'start'}" fill="${cls.colour}">${esc(first)}</text>
        <text x="${(xb + (xb > xa ? 9 : -9)).toFixed(1)}" y="${y + 3}" text-anchor="${xb > xa ? 'start' : 'end'}" fill="${cls.colour}">${esc(last)}</text>
      </g>`);
      fitText[cls.key] = t(up ? 'nb.fit.e' : 'nb.fit.w', { r: Math.abs(rho).toFixed(2) });
    } else {
      // Latitude runs up the page, so a positive correlation climbs northward.
      const ya = py(up ? lo : hi), yb = py(up ? hi : lo);
      const x = W + 16;
      marks.push(`<g class="nb-mark" data-c="${cls.key}">
        <line x1="${x}" y1="${ya.toFixed(1)}" x2="${x}" y2="${yb.toFixed(1)}" stroke="${cls.colour}" marker-end="url(#nbA-${kind}-${cls.key})"/>
        <text x="${x}" y="${(ya + (yb > ya ? -6 : 12)).toFixed(1)}" text-anchor="middle" fill="${cls.colour}">${esc(first)}</text>
        <text x="${x}" y="${(yb + (yb > ya ? 16 : -10)).toFixed(1)}" text-anchor="middle" fill="${cls.colour}">${esc(last)}</text>
      </g>`);
      fitText[cls.key] = t(up ? 'nb.fit.n' : 'nb.fit.s', { r: Math.abs(rho).toFixed(2) });
    }
  }

  host.querySelector('.nb-load')?.remove();
  host.insertAdjacentHTML('beforeend', `<svg viewBox="0 0 ${W + RIGHT} ${H + TOP}" class="nb-plate-svg">
    <defs>${defs.join('')}</defs>
    <g class="nb-geos">${paths.map((x) => x[1]).join('')}</g>${marks.join('')}</svg>`);

  for (const cls of spec.classes) {
    const el = host.closest('.nb-wrap')?.querySelector(`[data-fit="${cls.key}"]`);
    if (!el) continue;
    const parts = [];
    if (fitText[cls.key]) parts.push(fitText[cls.key]);
    const f = fit[cls.key];
    if (f) {
      parts.push(t('nb.fit.orient', { ok: f.ok, n: f.n }));
      if (f.miss.length && f.miss.length <= 4) parts.push(`${t('nb.fit.except')} ${f.miss.map(esc).join(zh ? '、' : ', ')}`);
    }
    if (parts.length) el.innerHTML = `${f ? `<i class="nb-fit-bar"><i style="width:${(100 * f.ok / f.n).toFixed(0)}%"></i></i>` : ''}${parts.join(' · ')}`;
  }
  wirePlate(host);
}

function wirePlate(host) {
  const wrap = host.closest('.nb-wrap');
  const read = host.querySelector('.nb-read');
  const geos = [...host.querySelectorAll('.nb-geo')];
  let iso = null;
  const paintIso = () => {
    for (const g of geos) g.classList.toggle('dim', !!iso && g.dataset.c !== iso);
    for (const m of host.querySelectorAll('.nb-mark')) m.classList.toggle('dim', !!iso && m.dataset.c !== iso);
    for (const c of wrap.querySelectorAll('.nb-cls')) c.classList.toggle('on', c.dataset.c === iso);
  };
  for (const c of wrap.querySelectorAll('.nb-cls')) {
    c.addEventListener('click', () => { iso = iso === c.dataset.c ? null : c.dataset.c; paintIso(); });
  }
  host.addEventListener('mouseover', (e) => {
    const g = e.target.closest('.nb-geo');
    if (!g) return;
    for (const x of geos) x.classList.toggle('hot', x.dataset.id === g.dataset.id);
    read.innerHTML = `<b>${esc(g.dataset.label)}</b>${g.dataset.name ? ` <span>${esc(g.dataset.name)}</span>` : ''}`;
    read.classList.add('on');
  });
  host.addEventListener('mouseleave', () => {
    for (const x of geos) x.classList.remove('hot');
    read.classList.remove('on');
  });
  host.addEventListener('click', (e) => {
    const g = e.target.closest('.nb-geo');
    if (!g) return;
    closeSheet();
    select(g.dataset.id);
  });
}

/* Provincial roads are numbered by thirty-one provinces at once, so the pane
   counts the series rather than drawing five thousand lines. */
const CN_SERIES = [
  ['radial', /^S1\d\d$/, '#ff5a7a', L('S1xx: out of the provincial capital', 'S1 字头：省会放射线')],
  ['ns', /^S2\d\d$/, '#35e7ff', L('S2xx: north–south', 'S2 字头：南北纵线')],
  ['ew', /^S3\d\d$/, '#ffd166', L('S3xx: east–west', 'S3 字头：东西横线')],
  ['hi', /^S[4-9]\d\d$/, '#ff9f68', L('S4xx and up: connectors and province-specific series', 'S4 字头及以上：联络线与各省自定序列')],
  ['xway', /^S\d{1,2}$|^S\d{4}$/, '#6ef7a5', L('One, two or four digits: provincial expressways', '一、二或四位数：省级高速公路')],
];

function nbProvincialPane() {
  const zh = getLang() === 'zh';
  const rows = app.index.filter((r) => r.sys === 'cn-provincial');
  const tally = CN_SERIES.map(([key, re, colour, label]) => {
    const hit = rows.filter((r) => re.test(String(r.num ?? '')));
    return { key, colour, label, n: hit.length, mi: hit.reduce((s, r) => s + r.mi, 0) };
  });
  const other = rows.length - tally.reduce((s, x) => s + x.n, 0);
  const max = Math.max(...tally.map((x) => x.n), 1);
  // The same number in many provinces: each one numbers its own.
  const where = new Map();
  for (const r of rows) {
    if (!where.has(r.num)) where.set(r.num, new Set());
    where.get(r.num).add(r.st);
  }
  const shared = [...where.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 6);
  const provinces = new Set(rows.map((r) => r.st)).size;
  return `${anatomy('cn-provincial')}<div class="nb-wrap nb-wrap-plate">
    <div class="nb-viz nb-series">
      ${tally.map((x) => `<div class="nb-ser" style="--k:${x.colour}">
        <span class="nb-ser-k">${x.label[zh ? 'zh' : 'en']}</span>
        <span class="nb-ser-bar"><i style="width:${(100 * x.n / max).toFixed(1)}%"></i></span>
        <span class="nb-ser-v">${num(x.n)}<small>${dist(x.mi)}</small></span>
      </div>`).join('')}
      ${other ? `<p class="nb-src">${t('nb.cn.other', { n: num(other) })}</p>` : ''}
      <h4 class="nb-ser-h">${t('nb.cn.shared')}</h4>
      <div class="nb-shared">${shared.map(([n, sts]) => `<span><b>${esc(n)}</b>${t('nb.cn.inN', { n: sts.size })}</span>`).join('')}</div>
    </div>
    <div class="nb-note">
      <h4>${t('nb.cn.h')}</h4>
      <div class="nb-rule"><span class="nb-rule-n">1</span><span class="nb-rule-t">
        <b>${zh ? '与国道同一套规则，缩到一省之内' : 'The national rule, shrunk to a province'}</b><br>
        ${zh ? '1 字头从省会放射，2 字头南北、3 字头东西，只是中心换成了省会，范围换成了省界。'
    : 'Radials out of the provincial capital in the 100s, north–south in the 200s, east–west in the 300s - the national pattern, centred on the capital and bounded by the province.'}
      </span></div>
      <div class="nb-rule"><span class="nb-rule-n">2</span><span class="nb-rule-t">
        <b>${zh ? '每个省各编各的' : 'Every province numbers its own'}</b><br>
        ${zh ? `本图谱收录 ${provinces} 个省级行政区的省道。号码只在省内唯一，所以同一个 S301 会在许多省份同时出现。`
    : `Provincial roads from ${provinces} provinces are in this atlas. A number is unique only inside its province, so the same S301 turns up in province after province.`}
      </span></div>
      <div class="nb-rule"><span class="nb-rule-n">3</span><span class="nb-rule-t">
        <b>${zh ? '位数区分高速与普通省道' : 'The digit count tells an expressway'}</b><br>
        ${zh ? '省级高速用一、二或四位数（S15、S1511），普通省道用三位数（S301）。' : 'Provincial expressways take one, two or four digits (S15, S1511); ordinary provincial roads take three (S301).'}
      </span></div>
    </div>
  </div>`;
}

/* ── number anatomy: one real number taken apart ────────────────────────── */

const ANATOMY = {
  'us-interstate': [
    ['I-95', [['I-', '#8fb4ff', L('Interstate', '州际公路')], ['9', '#35e7ff', L('odd: north–south', '奇数：南北向')], ['5', '#ffd166', L('ends in 5: a long-haul spine', '尾数 5：长途主干线')]]],
    ['I-80', [['I-', '#8fb4ff', L('Interstate', '州际公路')], ['8', '#35e7ff', L('even: east–west, high = north', '偶数：东西向，号大在北')], ['0', '#ffd166', L('ends in 0: coast to coast', '尾数 0：横贯东西海岸')]]],
  ],
  'us-numbered': [
    ['US 1', [['US ', '#8fb4ff', L('US Route', '美国国道')], ['1', '#35e7ff', L('odd and lowest: the Atlantic edge', '奇数且最小：贴着大西洋岸')]]],
    ['US 50', [['US ', '#8fb4ff', L('US Route', '美国国道')], ['5', '#35e7ff', L('even: east–west, high = south', '偶数：东西向，号大在南')], ['0', '#ffd166', L('ends in 0: transcontinental', '尾数 0：横贯大陆')]]],
  ],
  aux: [
    ['I-275', [['2', '#6ef7a5', L('even first digit: a loop, both ends on the parent', '首位偶数：环线，两端都接主路')], ['75', '#35e7ff', L('the parent: I-75', '母路：I-75')]]],
    ['I-175', [['1', '#ffb545', L('odd first digit: a spur, one end only', '首位奇数：支线，只接一端')], ['75', '#35e7ff', L('the parent: I-75', '母路：I-75')]]],
  ],
  ca: [
    ['A-440', [['A-', '#8fb4ff', L('Québec autoroute', '魁北克高速公路')], ['4', '#6ef7a5', L('even first digit: a bypass', '首位偶数：绕行线')], ['40', '#35e7ff', L('the parent: A-40', '母路：A-40')]]],
    ['A-720', [['A-', '#8fb4ff', L('Québec autoroute', '魁北克高速公路')], ['7', '#ffb545', L('odd first digit: a spur', '首位奇数：支线')], ['20', '#35e7ff', L('the parent: A-20', '母路：A-20')]]],
  ],
  'cn-expressway': [
    ['G4', [['G', '#2fd37a', L('national (国家)', '国家级')], ['4', '#ff5a7a', L('one digit: the 4th radial out of Beijing', '一位数：第 4 条首都放射线')]]],
    ['G45', [['G', '#2fd37a', L('national', '国家级')], ['45', '#35e7ff', L('odd: north–south, numbered east to west', '奇数：南北纵线，自东向西编号')]]],
    ['G4201', [['G', '#2fd37a', L('national', '国家级')], ['42', '#ffd166', L('parent: G42, Shanghai–Chengdu', '主线：G42 沪蓉高速')], ['0', '#6ef7a5', L('0: a city ring', '0：城市绕城环线')], ['1', '#8fb4ff', L('the first such ring', '序号')]]],
    ['G0421', [['G', '#2fd37a', L('national', '国家级')], ['04', '#ff5a7a', L('parent: G4, padded to two digits', '主线：G4，补零为两位')], ['2', '#f06bff', L('2: a parallel line', '2：并行线')], ['1', '#8fb4ff', L('sequence', '序号')]]],
  ],
  'cn-national': [
    ['G109', [['G', '#ff5a5a', L('national road', '国道')], ['1', '#ff5a7a', L('1: out of Beijing', '1：首都放射线')], ['09', '#8fb4ff', L('9th, clockwise', '顺时针第 9 条')]]],
    ['G219', [['G', '#ff5a5a', L('national road', '国道')], ['2', '#35e7ff', L('2: north–south', '2：南北纵线')], ['19', '#8fb4ff', L('sequence, east to west', '序号，自东向西')]]],
    ['G318', [['G', '#ff5a5a', L('national road', '国道')], ['3', '#ffd166', L('3: east–west', '3：东西横线')], ['18', '#8fb4ff', L('sequence, north to south', '序号，自北向南')]]],
  ],
  'cn-provincial': [
    ['S301', [['S', '#f4c542', L('provincial (省)', '省道')], ['3', '#ffd166', L('3: east–west', '3：东西横线')], ['01', '#8fb4ff', L('sequence within the province', '省内序号')]]],
    ['S15', [['S', '#f4c542', L('provincial', '省道')], ['15', '#6ef7a5', L('two digits: a provincial expressway', '两位数：省级高速')]]],
  ],
  'tw-freeway': [
    ['国道3号甲线', [['国道', '#5aa9ff', L('National Freeway', '国道（高速公路）')], ['3', '#35e7ff', L('odd: north–south', '奇数：南北向')], ['甲', '#f06bff', L('甲: the first branch', '甲：第一条支线')]]],
  ],
  'tw-provincial': [
    ['台74线', [['台', '#ff9f68', L('Provincial Highway', '省道')], ['74', '#ffd166', L('even, 62–88: an east–west expressway', '62–88 偶数：东西向快速公路')]]],
    ['台9丁线', [['台', '#ff9f68', L('Provincial Highway', '省道')], ['9', '#6ef7a5', L('the east-coast trunk road', '东部纵贯干线')], ['丁', '#f06bff', L('丁: the fourth branch', '丁：第四条支线')]]],
  ],
  'hk-route': [
    ['Route 9', [['Route ', '#f06bff', L('Hong Kong trunk route', '香港干线')], ['9', '#ffd166', L('a label: the New Territories circuit', '只是代号：新界环迴线')]]],
  ],
};

function anatomy(kind) {
  const ex = ANATOMY[kind];
  if (!ex) return '';
  const zh = getLang() === 'zh';
  return `<div class="nb-ana">
    <span class="nb-ana-k">${t('nb.anatomy')}</span>
    <div class="nb-ana-chips">${ex.map(([code], i) => `<button type="button" class="nb-ana-chip${i ? '' : ' on'}" data-ana="${i}">${esc(code)}</button>`).join('')}</div>
    ${ex.map(([, parts], i) => `<div class="nb-ana-code${i ? '' : ' on'}" data-ana="${i}">
      ${parts.map(([txt, colour, cap]) => `<span class="nb-ana-p" style="--k:${colour}"><b>${esc(txt.trim())}</b><small>${cap[zh ? 'zh' : 'en']}</small></span>`).join('')}
    </div>`).join('')}
  </div>`;
}

function wirePane(body) {
  for (const chip of body.querySelectorAll('.nb-ana-chip')) {
    chip.addEventListener('click', () => {
      for (const el of body.querySelectorAll('[data-ana]')) el.classList.toggle('on', el.dataset.ana === chip.dataset.ana);
    });
  }
  const plate = body.querySelector('.nb-plate');
  if (plate) drawPlate(plate.dataset.plate, plate);
}

function wireNumbering() {
  const body = document.getElementById('nbBody');
  const tabsHost = document.getElementById('nbTabs');
  const paint = (kind) => {
    nbTabOf[nbCountry] = kind;
    body.innerHTML = nbPane(kind);
    wirePane(body);
    for (const line of body.querySelectorAll('.nb-viz .nb-route[data-id]')) {
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
  // Switching language rebuilds the whole sheet, so the country and the tab
  // within it are kept rather than thrown back to the first.
  const showCountry = (cc) => {
    nbCountry = cc;
    for (const b of document.querySelectorAll('.nb-cc')) b.classList.toggle('on', b.dataset.cc === cc);
    const c = NB_COUNTRIES.find((x) => x.cc === cc);
    const kind = c.tabs.includes(nbTabOf[cc]) ? nbTabOf[cc] : c.tabs[0];
    tabsHost.hidden = c.tabs.length < 2;
    tabsHost.innerHTML = c.tabs.map((k) => `<button class="btn${k === kind ? ' on' : ''}" data-nb="${k}" type="button">${t(NB_TAB_KEY[k] || `sys.${k}`)}</button>`).join('');
    for (const tab of tabsHost.querySelectorAll('[data-nb]')) {
      tab.addEventListener('click', () => {
        for (const o of tabsHost.querySelectorAll('[data-nb]')) o.classList.toggle('on', o === tab);
        paint(tab.dataset.nb);
      });
    }
    paint(kind);
  };
  for (const b of document.querySelectorAll('.nb-cc')) b.addEventListener('click', () => showCountry(b.dataset.cc));
  showCountry(nbCountry);
}

/* ══════════════════════════════════════════════════════════════════════
   Statistics dashboard
   ══════════════════════════════════════════════════════════════════════ */

/* Straight off the system registry, so a country added to the atlas cannot
   reach the dashboard without a colour. The Canadian tiers used to fall
   through this table and draw their bars with `undefined` as a fill. */
const SYS_COLOUR = Object.fromEntries(SYSTEMS.map((s) => [s.id, s.colour]));
/** Each country by the colour of its top tier, which is how the map shows it. */
const DASH_CC = ['us', 'ca', 'mx', 'cn', 'tw', 'hk'];
const CC_COLOUR = Object.fromEntries(DASH_CC.map((cc) => [cc, SYSTEMS.find((s) => s.cc === cc)?.colour]));

function bars(rows, colourOf, maxOverride) {
  const max = maxOverride ?? Math.max(...rows.map((r) => r.v));
  return `<div class="hbars">${rows.map((r) => `
    <div class="hbar"${r.st ? ` data-st="${r.st}" style="cursor:pointer"` : ''}>
      <span class="hbar-k">${esc(r.k)}</span>
      <span class="hbar-t"><i style="width:${((r.v / max) * 100).toFixed(1)}%;background:${colourOf(r)}"></i></span>
      <span class="hbar-v">${num(r.v)}${r.suffix || ''}</span>
    </div>`).join('')}</div>`;
}

/* The page holds the whole atlas and each country in turn. A rail of country
   cards picks which; every chart below is drawn again for the choice and the
   headline figures count across from the last one, so switching reads as
   the same page changing its subject rather than a new page. */
let dashCc = 'all';
const dashPrev = {};

function countryTotals() {
  const s = app.stats;
  return DASH_CC.map((cc) => {
    const systems = SYSTEMS.filter((x) => x.cc === cc && s.bySystem[x.id])
      .map((x) => ({ id: x.id, colour: x.colour, ...s.bySystem[x.id] }));
    return { cc, systems, mi: systems.reduce((a, x) => a + x.mi, 0), routes: systems.reduce((a, x) => a + x.routes, 0) };
  }).filter((c) => c.mi > 0);
}

function renderDashboard() {
  const countries = countryTotals();
  const world = countries.reduce((a, c) => a + c.mi, 0);
  const C = 2 * Math.PI * 15.5;
  const card = (cc, mi, routes, colour, label) => `
    <button class="dash-cc${cc === dashCc ? ' on' : ''}" type="button" data-cc="${cc}" style="--cc:${colour}">
      <svg class="dash-ring" viewBox="0 0 36 36" aria-hidden="true"><circle class="bg" cx="18" cy="18" r="15.5"/>
        <circle class="fg" cx="18" cy="18" r="15.5" stroke-dasharray="${((mi / world) * C).toFixed(2)} ${C.toFixed(2)}"/></svg>
      <span class="dash-cc-t">${cc === 'all' ? '' : `<i class="flagdot flag-${cc}"></i>`}<b>${label}</b>
        <small>${num(lenOf(mi))} ${lenUnit()}</small><em>${cc === 'all' ? t('dash.nRoutes', { n: num(routes) }) : `${num((mi / world) * 100, mi / world < 0.1 ? 1 : 0)}%`}</em></span>
    </button>`;
  const rail = card('all', world, countries.reduce((a, c) => a + c.routes, 0), '#35e7ff', t('dash.all'))
    + countries.map((c) => card(c.cc, c.mi, c.routes, CC_COLOUR[c.cc], t(`sys.country.${c.cc}`))).join('');
  return frame('dash.title', 'dash.sub', `
    <div class="dash-rail" role="tablist">${rail}</div>
    <div id="dashBody" class="dash-body">${dashBody(dashCc)}</div>`,
  { n: num(countries.reduce((a, c) => a + c.routes, 0)) });
}

function dashBody(cc) {
  const s = app.stats;
  const all = cc === 'all';
  const inCc = (sysId) => all || countryOf(sysId) === cc;
  const sysStats = Object.entries(s.bySystem).filter(([id]) => inCc(id)).map(([, v]) => v);
  const totalMi = sysStats.reduce((a, b) => a + b.mi, 0);
  const totalRoutes = sysStats.reduce((a, b) => a + b.routes, 0);
  const freewayMi = sysStats.reduce((a, b) => a + b.gsMi, 0);
  const index = all ? app.index : app.index.filter((r) => countryOf(r.sys) === cc);

  // One row per country, each a bar as long as its network and split into its
  // systems, so the country split and the system split read off one chart.
  // A single country gets a row per system instead, on the same idea.
  const countries = all
    ? countryTotals()
    : SYSTEMS.filter((x) => x.cc === cc && s.bySystem[x.id]).map((x) => ({
      cc, sys: x.id, systems: [{ id: x.id, colour: x.colour, ...s.bySystem[x.id] }],
      mi: s.bySystem[x.id].mi, routes: s.bySystem[x.id].routes,
    }));
  const maxCc = Math.max(...countries.map((c) => c.mi));

  // Each country ranked against itself: Texas, Ontario and Veracruz are not
  // on the same scale, and one mixed list was American below its third row.
  const stateRowsOf = (c, n = 8) => Object.entries(s.byState)
    .filter(([, v]) => v.cc === c)
    .sort((a, b) => b[1].mi - a[1].mi)
    .slice(0, n)
    .map(([st, v]) => ({ k: stateName(st), v: lenOf(v.mi), st, cc: v.cc }));
  const tollMi = sysStats.reduce((a, b) => a + (b.tollMi || 0), 0);
  const stateCount = Object.values(s.byState).filter((v) => all || v.cc === cc).length;

  // The shape of each system: how many routes, how long the typical one is,
  // and how much of it is freeway or tolled.
  const profile = SYSTEMS.filter((x) => s.bySystem[x.id] && inCc(x.id)).map((x) => {
    const b = s.bySystem[x.id];
    const own = app.index.filter((r) => r.sys === x.id);
    const lens = own.map((r) => r.mi).sort((p, q) => p - q);
    const longestOwn = own.reduce((m, r) => (!m || r.mi > m.mi ? r : m), null);
    return {
      id: x.id, cc: x.cc, colour: x.colour, routes: b.routes, mi: b.mi,
      median: lens.length ? lens[Math.floor(lens.length / 2)] : 0,
      gs: b.mi ? (b.gsMi / b.mi) * 100 : 0,
      toll: b.mi ? ((b.tollMi || 0) / b.mi) * 100 : 0,
      longest: longestOwn,
    };
  });

  // Route lengths fall over three orders of magnitude, so the buckets do too.
  const EDGES = [0, 10, 25, 50, 100, 250, 500, 1000, Infinity];
  // Stacked by country for the whole atlas, by system inside one country.
  const keys = all ? DASH_CC : SYSTEMS.filter((x) => x.cc === cc && s.bySystem[x.id]).map((x) => x.id);
  const keyOf = all ? (r) => countryOf(r.sys) : (r) => r.sys;
  const colourOfKey = all ? (k) => CC_COLOUR[k] : (k) => SYS_COLOUR[k];
  const nameOfKey = all ? (k) => t(`sys.country.${k}`) : (k) => t(`sys.${k}`);
  const hist = EDGES.slice(0, -1).map((lo, i) => {
    const hi = EDGES[i + 1];
    const by = Object.fromEntries(keys.map((k) => [k, 0]));
    for (const r of index) if (r.mi >= lo && r.mi < hi) by[keyOf(r)] += 1;
    return { lo, hi, by, n: Object.values(by).reduce((a, b) => a + b, 0) };
  });
  const histMax = Math.max(1, ...hist.map((h) => h.n));
  const edgeLabel = (v) => num(Math.round(lenOf(v) / (v >= 100 ? 10 : 1)) * (v >= 100 ? 10 : 1));

  const widest = index.slice().sort((a, b) => b.ns - a.ns || b.mi - a.mi).slice(0, 10);
  // The length check is made against official figures that exist for some
  // countries only, so it stays with the whole-atlas view.
  const acc = all ? s.accuracy : null;
  const accX = (pct) => 50 + Math.max(-25, Math.min(25, pct)) * 2;

  const types = all ? s.byType : s.byTypeCc?.[cc];
  const classTotal = types ? Object.values(types).reduce((a, b) => a + b, 0) : 0;
  const classRows = types ? Object.entries(types)
    .sort((a, b) => b[1] - a[1])
    .filter(([, v]) => v / classTotal > 0.002)
    .map(([k, v]) => ({ k: t(`comp.${k}`), v, cls: k })) : [];

  const longest = index.slice().sort((a, b) => b.mi - a.mi).slice(0, 14);
  const pctOf = (v, whole) => { const p = (v / whole) * 100; return num(p, p < 10 ? 1 : 0); };
  const tile = (key, label, v, unit = '') => `<div class="m"><span class="m-k">${label}</span><div class="m-v"><span data-tile="${key}" data-to="${v}">${num(v)}</span>${unit ? `<small>${unit}</small>` : ''}</div></div>`;
  const stateCols = all ? ['us', 'ca', 'mx', 'cn', 'tw'] : (stateCount > 1 ? [cc] : []);

  return `
    <div class="dash-top">
      ${tile('mi', t('dash.totalMi'), lenOf(totalMi), lenUnit())}
      ${tile('routes', t('dash.routes'), totalRoutes)}
      ${tile('states', t('dash.states'), stateCount)}
      ${tile('fwy', t('dash.freeway'), lenOf(freewayMi), lenUnit())}
      ${tile('toll', t('dash.tolled'), lenOf(tollMi), lenUnit())}
      ${acc ? `<div class="m" title="${esc(t('dash.accWhy', { n: num(acc.routes) }))}"><span class="m-k">${t('dash.accTile')}</span><div class="m-v">${acc.within5}<small>%</small></div></div>` : ''}
    </div>

    <div class="dash-card dash-wide">
      <h3>${t(all ? 'dash.bySystem' : 'dash.bySystemIn', { cc: t(`sys.country.${cc}`) })}</h3>
      <div class="in">
        <div class="cc-rows">${countries.map((c) => `
          <div class="cc-row">
            <div class="cc-hd">${c.sys ? `<i class="lg-dot" style="--sys-col:${SYS_COLOUR[c.sys]}"></i><b>${t(`sys.${c.sys}`)}</b>` : `<span class="flagdot flag-${c.cc}"></span><b>${t(`sys.country.${c.cc}`)}</b>`}
              <span>${num(lenOf(c.mi))} ${lenUnit()} · ${pctOf(c.mi, totalMi)}% · ${t('dash.nRoutes', { n: num(c.routes) })}</span></div>
            <div class="stack" style="width:${((c.mi / maxCc) * 100).toFixed(1)}%">${c.systems.map((x) => `<i style="flex:${x.mi};background:${x.colour}" title="${esc(t(`sys.${x.id}`))} · ${num(lenOf(x.mi))} ${lenUnit()}"></i>`).join('')}</div>
            <ul class="stack-key">${c.systems.map((x) => `<li><i style="background:${x.colour}"></i>${t(`sys.${x.id}`)}
              <b>${num(lenOf(x.mi))}</b><small>${pctOf(x.mi, c.mi)}%</small></li>`).join('')}</ul>
          </div>`).join('')}</div>
      </div>
    </div>

    <div class="dash-cols">
      ${classRows.length ? `<div class="dash-card">
        <h3>${t('dash.byClass')}</h3>
        <div class="in">
          <div class="stack stack-tall">${classRows.map((r) => `<i style="flex:${r.v};background:${CLASS_COLOUR[r.cls] || '#4a5768'}" title="${esc(r.k)}"></i>`).join('')}</div>
          <ul class="stack-key stack-key-col">${classRows.map((r) => `<li><i style="background:${CLASS_COLOUR[r.cls] || '#4a5768'}"></i>${r.k}
            <b>${num(lenOf(r.v))}</b><small>${pctOf(r.v, classTotal)}%</small></li>`).join('')}</ul>
          <p class="hbar-note">${t('dash.byClass.note')}</p></div>
      </div>` : ''}
      <div class="dash-card">
        <h3>${t('dash.lengths')}</h3>
        <div class="in">
          <div class="hist" role="img">${hist.map((h) => `
            <div class="hist-c" title="${num(h.n)}">
              <span class="hist-n">${num(h.n)}</span>
              <div class="hist-b" style="height:${((h.n / histMax) * 100).toFixed(1)}%">${[...keys].reverse().map((k) => (h.by[k]
                ? `<i style="flex:${h.by[k]};background:${colourOfKey(k)}"></i>` : '')).join('')}</div>
              <span class="hist-k">${h.hi === Infinity ? `${edgeLabel(h.lo)}+` : edgeLabel(h.hi)}</span>
            </div>`).join('')}</div>
          <ul class="stack-key">${keys.map((k) => `<li><i style="background:${colourOfKey(k)}"></i>${nameOfKey(k)}</li>`).join('')}</ul>
          <p class="hbar-note">${t('dash.lengths.note', { u: lenUnit() })}</p>
        </div>
      </div>
    </div>

    <div class="dash-card dash-wide" style="margin-top:20px">
      <h3>${t('dash.profile')}</h3>
      <div class="dc-tbl-w"><table class="tbl dash-prof">
        <thead><tr><th>${t('dash.profile.sys')}</th><th class="r">${t('dash.routes')}</th><th class="r">${t('dash.profile.len')} · ${lenUnit()}</th>
          <th class="r">${t('dash.profile.median')} · ${lenUnit()}</th><th>${t('dash.profile.gs')}</th><th>${t('dash.profile.toll')}</th><th>${t('dash.profile.longest')}</th></tr></thead>
        <tbody>${profile.map((p) => `<tr>
          <td><i class="lg-dot" style="--sys-col:${p.colour}"></i>${t(`sys.${p.id}`)}</td>
          <td class="r">${num(p.routes)}</td>
          <td class="r">${num(lenOf(p.mi))}</td>
          <td class="r">${lenNum(p.median)}</td>
          <td><span class="pbar"><i style="width:${p.gs.toFixed(1)}%;background:${p.colour}"></i></span><small>${num(p.gs, p.gs < 10 ? 1 : 0)}%</small></td>
          <td><span class="pbar"><i style="width:${p.toll.toFixed(1)}%;background:var(--amber)"></i></span><small>${num(p.toll, p.toll < 10 ? 1 : 0)}%</small></td>
          <td>${p.longest ? `<a class="dash-go" data-id="${p.longest.id}">${esc(p.longest.label)}</a> <small>${lenNum(p.longest.mi)}</small>` : ''}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>

    ${stateCols.length ? `<div class="dash-card dash-wide">
      <h3>${t('dash.byState')} · ${t('dash.mostMiles')}</h3>
      <div class="in ${all ? 'dash-3' : 'dash-1'}">${stateCols.map((c) => `
        <div><p class="dash-sub"><span class="flagdot flag-${c}"></span>${t(`sys.country.${c}`)}</p>
          ${bars(stateRowsOf(c, all ? 8 : 16), () => CC_COLOUR[c])}</div>`).join('')}</div>
    </div>` : ''}

    <div class="dash-cols">
      <div class="dash-card">
        <h3>${t('dash.widest')}</h3>
        <div class="in">
          <div class="hbars">${widest.map((r) => `
            <div class="hbar hbar-route" data-id="${r.id}">
              <span class="hbar-k"><b>${r.label}</b><small>${lenNum(r.mi)} ${lenUnit()}</small></span>
              <span class="hbar-t"><i style="width:${((r.ns / widest[0].ns) * 100).toFixed(1)}%;background:${SYS_COLOUR[r.sys] || 'var(--cyan)'}"></i></span>
              <span class="hbar-v">${r.ns}</span>
            </div>`).join('')}</div>
        </div>
      </div>
      ${acc ? `<div class="dash-card">
        <h3>${t('dash.acc')}</h3>
        <div class="in">
          <div class="acc-range">
            <div class="acc-axis"><span>−25%</span><span>0</span><span>+25%</span></div>
            <div class="acc-track">
              <i class="acc-band" style="left:${accX(acc.p10)}%;width:${accX(acc.p90) - accX(acc.p10)}%"></i>
              <i class="acc-mid" style="left:${accX(acc.median)}%"></i>
            </div>
            <p class="acc-k">${t('dash.acc.range', { lo: acc.p10, mid: acc.median > 0 ? `+${acc.median}` : acc.median, hi: `+${acc.p90}` })}</p>
          </div>
          ${bars([5, 10, 25].map((w) => ({ k: t('dash.acc.within', { n: w }), v: acc[`within${w}`], suffix: '%' })), () => 'var(--lime)', 100)}
          <p class="hbar-note">${t('dash.acc.note', { n: num(acc.routes) })}</p>
        </div>
      </div>` : ''}
    </div>

    <div class="dash-card dash-wide" id="dashSpeed" hidden></div>
    ${all || cc === 'us' ? '<div class="dash-card dash-wide" id="dashBuild" hidden></div>' : ''}

    <div class="dash-card dash-wide" style="margin-top:20px">
      <h3>${t('dash.longest')}</h3>
      <div class="in">
        <div class="hbars">${longest.map((r) => `
          <div class="hbar hbar-route" data-id="${r.id}">
            <span class="hbar-k"><b>${r.label}</b><small>${ownerLabel(r.sys, r.st)} · ${t('dash.nStates', { n: num(r.ns) })}</small></span>
            <span class="hbar-t"><i style="width:${((r.mi / longest[0].mi) * 100).toFixed(1)}%;background:${SYS_COLOUR[r.sys] || 'var(--cyan)'}"></i></span>
            <span class="hbar-v">${lenNum(r.mi)}</span>
          </div>`).join('')}</div>
      </div>
    </div>`;
}

/* How the Interstates were built, from FHWA's year-end mileage open to traffic.
   It is the one complete account of any system's growth in the atlas - no
   other country publishes a year-by-year series per system - so it is shown
   for the whole atlas and for the United States, and named as what it is. */
let buildPromise = null;
function buildout() {
  buildPromise ||= fetch('data/timeline.json').then((r) => (r.ok ? r.json() : null))
    .then((h) => (h?.mileage?.open?.length ? h : null)).catch(() => null);
  return buildPromise;
}

function buildoutCard(h) {
  const open = h.mileage.open.map(([year, mi, designated]) => ({ year, mi, designated }));
  const first = open[0];
  const last = open.at(-1);
  const top = Math.max(...open.map((o) => Math.max(o.mi, o.designated)));
  const W = 600;
  const H = 120;
  const x = (y) => ((y - first.year) / (last.year - first.year)) * W;
  const y = (mi) => H - (mi / top) * (H - 8);
  const line = open.map((o, i) => `${i ? 'L' : 'M'}${x(o.year).toFixed(1)} ${y(o.mi).toFixed(1)}`).join(' ');
  const goal = open.map((o, i) => `${i ? 'L' : 'M'}${x(o.year).toFixed(1)} ${y(o.designated).toFixed(1)}`).join(' ');
  // By decade, from the difference between year-ends; what was open by 1960
  // is its own bar, because the table does not say when before then it opened.
  const at = (yr) => open.find((o) => o.year === yr)?.mi ?? last.mi;
  const decades = [
    { k: t('build.before', { y: first.year }), v: first.mi },
    ...[1960, 1970, 1980, 1990].map((d) => ({
      k: d === 1990 ? `1990–${last.year}` : t('build.decade', { d }),
      v: at(Math.min(d + 9, last.year)) - (d === 1960 ? first.mi : at(d - 1)),
    })),
  ];
  const vmax = Math.max(...decades.map((d) => d.v));
  const events = (h.events || []).filter((e) => e.system && !e.kind && e.year >= first.year && e.year <= last.year);
  return `
    <h3>${t('build.title')}</h3>
    <div class="in build">
      <svg class="build-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <path class="build-area" d="${line} L${W} ${H} L0 ${H} Z"/>
        <path class="build-goal" d="${goal}"/>
        <path class="build-line" d="${line}"/>
      </svg>
      <div class="build-ev">${events.map((e) => `<i style="left:${((x(e.year) / W) * 100).toFixed(1)}%" title="${e.year} · ${esc(e[getLang()] || e.en)}"></i>`).join('')}</div>
      <div class="build-ax"><span>${first.year}</span><span>${last.year}</span></div>
      <div class="build-dec">${decades.map((d) => `
        <div><span class="build-b"><i style="height:${((d.v / vmax) * 100).toFixed(1)}%"></i></span>
          <b>${num(lenOf(d.v))}</b><small>${d.k}</small></div>`).join('')}</div>
      <p class="hbar-note">${t('build.note', { a: num(lenOf(first.mi)), b: num(lenOf(last.mi)), u: lenUnit(), y0: first.year, y1: last.year })}</p>
    </div>`;
}

/* How much of each network is signed at what, by length. A bar per country
   for the whole atlas and per system inside one. What was read off a sign
   is solid; what the law sets by default is hatched, so the two never pass
   for each other; grey is road no source covers. */
function speedCard(d, cc) {
  const all = cc === 'all';
  const rows = all
    ? DASH_CC.filter((c) => d.summary[c]).map((c) => ({ key: c, name: t(`sys.country.${c}`), flag: c, s: d.summary[c] }))
    : SYSTEMS.filter((x) => x.cc === cc && d.systems[x.id]).map((x) => ({ key: x.id, name: t(`sys.${x.id}`), colour: x.colour, s: d.systems[x.id] }));
  if (!rows.length) return '';
  const typical = (s) => {
    const by = BANDS.map((k) => [k, (s.bands[k] || 0) + (s.law[k] || 0)]);
    const half = by.reduce((a, [, v]) => a + v, 0) / 2;
    let acc = 0;
    for (const [k, v] of by) { acc += v; if (half && acc >= half) return k; }
    return null;
  };
  const pct = (v, w) => (w ? (v / w) * 100 : 0);
  const body = rows.map(({ name, flag, colour, s }) => {
    const known = (s.bySrc.p || 0) + (s.bySrc.o || 0);
    const unknown = Math.max(0, s.mi - known - (s.bySrc.l || 0));
    const typ = typical(s);
    const segs = [
      ...BANDS.filter((k) => s.bands[k]).map((k) => `<i style="flex:${s.bands[k]};background:${speedColour(k)}" title="${bandLabel(k)} ${speedUnit()} · ${num(lenOf(s.bands[k]))} ${lenUnit()}"></i>`),
      ...BANDS.filter((k) => s.law[k]).map((k) => `<i class="spd-law" style="flex:${s.law[k]};--c:${speedColour(k)}" title="${esc(t('spd.src.l'))} ${bandLabel(k)} ${speedUnit()} · ${num(lenOf(s.law[k]))} ${lenUnit()}"></i>`),
      unknown > 0 ? `<i style="flex:${unknown};background:${UNKNOWN};opacity:.35" title="${esc(t('spd.none'))} · ${num(lenOf(unknown))} ${lenUnit()}"></i>` : '',
    ].join('');
    return `<div class="spd-row">
      <div class="cc-hd">${flag ? `<span class="flagdot flag-${flag}"></span>` : `<i class="lg-dot" style="--sys-col:${colour}"></i>`}<b>${name}</b>
        <span>${typ ? t('dash.speed.typical', { v: `${bandLabel(typ)} ${speedUnit()}` }) + ' · ' : ''}${t('dash.speed.measured', { pct: num(pct(known, s.mi)) })}</span></div>
      <div class="stack">${segs}</div>
    </div>`;
  }).join('');
  const key = BANDS.map((k) => `<li><i style="background:${speedColour(k)}"></i>${bandLabel(k)}${k === 120 ? '+' : ''}</li>`).join('')
    + `<li><i class="spd-law" style="--c:${speedColour(80)}"></i>${t('spd.src.l')}</li>`
    + `<li><i style="background:${UNKNOWN};opacity:.35"></i>${t('spd.none')}</li>`;
  return `<h3>${t('dash.speed')} · ${speedUnit()}</h3>
    <div class="in">
      <div class="cc-rows">${body}</div>
      <ul class="stack-key spd-key">${key}</ul>
      <p class="hbar-note">${t('dash.speed.note')}</p>
    </div>`;
}

// The headline figures run from what they last said to what they say now.
function countTiles(host) {
  const ease = (x) => 1 - (1 - x) ** 3;
  const t0 = performance.now();
  const tiles = [...host.querySelectorAll('[data-tile]')].map((el) => ({
    el, key: el.dataset.tile, to: Number(el.dataset.to), from: dashPrev[el.dataset.tile] ?? 0,
  }));
  for (const x of tiles) dashPrev[x.key] = x.to;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / 700);
    for (const x of tiles) x.el.textContent = num(Math.round(x.from + (x.to - x.from) * ease(k)));
    if (k < 1 && host.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function wireDashBody(host) {
  for (const row of host.querySelectorAll('.hbar-route[data-id], .dash-go[data-id]')) {
    row.addEventListener('click', () => { closeSheet(); select(row.dataset.id); });
  }
  for (const bar of host.querySelectorAll('.hbar[data-st]')) {
    bar.addEventListener('click', () => {
      const st = bar.dataset.st;
      closeSheet();
      loadState(st).then(() => zoomToState(st));
    });
  }
  host.classList.remove('anim');
  void host.offsetWidth;
  host.classList.add('anim');
  countTiles(host);
  const cc = dashCc;
  loadSpeed().then((d) => {
    const slot = host.querySelector('#dashSpeed');
    if (!d || !slot || cc !== dashCc) return;
    slot.innerHTML = speedCard(d, cc);
    slot.hidden = false;
  });
  buildout().then((h) => {
    const slot = host.querySelector('#dashBuild');
    if (!h || !slot) return;
    slot.innerHTML = buildoutCard(h);
    slot.hidden = false;
  });
}

function wireDashboard() {
  const host = document.getElementById('dashBody');
  for (const b of document.querySelectorAll('.dash-cc')) {
    b.addEventListener('click', () => {
      if (b.dataset.cc === dashCc) return;
      dashCc = b.dataset.cc;
      for (const o of document.querySelectorAll('.dash-cc')) o.classList.toggle('on', o === b);
      host.innerHTML = dashBody(dashCc);
      wireDashBody(host);
    });
  }
  wireDashBody(host);
}

/* ══════════════════════════════════════════════════════════════════════
   Jurisdiction picker

   One picker, two tiers. American state routes and Canadian provincial
   highways are the same problem - too much geometry to ship as one file, so
   the reader chooses where to look - and they get the same sheet, filtered to
   the country that asked for it.
   ══════════════════════════════════════════════════════════════════════ */

function renderJurisdictions(sys) {
  const cc = countryOf(sys);
  const ca = cc === 'ca';
  const rows = Object.entries(app.stats.byState)
    .filter(([code]) => countryOfJuris(code) === cc)
    .sort((a, b) => stateName(a[0]).localeCompare(stateName(b[0]), getLang() === 'zh' ? 'zh' : 'en'));

  const title = { us: 'sys.pickState', ca: 'sys.pickProvince', mx: 'sys.pickMxState', cn: 'sys.pickCnProvince' }[cc];
  return frame(title, `sys.${sys}.meta`, `
    <div class="jur-grid">
      ${rows.map(([code, v]) => `<button class="sys jur" data-load="${code}" type="button">
        <span class="sys-txt">
          <span class="sys-name">${stateName(code)}</span>
          <span class="sys-meta">${num(v[sys] ? v.routes : 0)} · ${dist(v[sys] || 0)}</span>
        </span>
        ${app.stateLoaded.has(code) ? '<span class="pill">on</span>' : ''}
      </button>`).join('')}
    </div>
    ${ca ? `<div class="note" style="margin-top:13px">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6v.1"/></svg>
      <span>${t('ca.municipalWhy')}</span></div>` : ''}
    ${cc === 'mx' ? `<div class="note" style="margin-top:13px">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6v.1"/></svg>
      <span>${t('mx.unsignedStates')}</span></div>` : ''}
    ${cc === 'cn' ? `<div class="note" style="margin-top:13px">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6v.1"/></svg>
      <span>${t('cn.provincialWhy')}</span></div>` : ''}`);
}

const renderStates = () => renderJurisdictions('us-state');
const renderProvinces = () => renderJurisdictions('ca-provincial');
const renderMxStates = () => renderJurisdictions('mx-state');
const renderCnProvinces = () => renderJurisdictions('cn-provincial');

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
   Data & sources

   Drawn from data/docs.json, which tools/build-docs.mjs parses out of
   docs/DATA-SOURCES.md, docs/ACCURACY.md and their Chinese mirrors, and from
   data/coverage.json. Nothing here is written for the page, so it says what
   the documents say and no more.
   ══════════════════════════════════════════════════════════════════════ */

const DOC_TABS = ['coverage', 'sources', 'decisions', 'issues', 'accuracy'];
let docsTab = 'coverage';
let docsData = null;

/** The handful of inline Markdown the documents use. */
function inline(md) {
  const codes = [];
  let s = esc(md).replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, text, href) => (/^https?:/.test(href)
    ? `<a href="${href}" target="_blank" rel="noopener">${text}</a>`
    : `<span class="dc-ref">${text}</span>`));
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code>${codes[i]}</code>`);
}

const isIdTable = (b) => /^(ID|编号)$/.test(b.head[0]);
const isFlagTable = (b) => /^(Country|国家)$/.test(b.head[0]) && b.head.length >= 4;

function docTable(b) {
  if (isIdTable(b) || isFlagTable(b)) {
    // Registers read better as cards: the ID or flag, the lead column as the
    // headline, and every other column as a labelled line beneath it.
    return `<div class="dc-cards">${b.rows.map((r) => {
      const kind = isFlagTable(b) ? r[2] : null;
      return `<article class="dc-card" data-q="${esc(r.join(' ').toLowerCase())}">
        <div class="dc-card-hd"><span class="dc-id">${inline(r[0])}</span><p class="dc-lead">${inline(r[1])}</p>
          ${kind ? `<span class="dc-pill ${/pending|待做/.test(kind) ? 'pend' : ''}">${inline(kind)}</span>` : ''}</div>
        <dl>${r.slice(2).map((c, i) => (isFlagTable(b) && i === 0) || !c || c === '—' ? ''
          : `<div><dt>${inline(b.head[i + 2])}</dt><dd>${inline(c)}</dd></div>`).join('')}</dl>
      </article>`;
    }).join('')}</div>`;
  }
  return `<div class="dc-tbl-w"><table class="tbl dc-tbl"><thead><tr>${b.head.map((h, i) => `<th class="${b.align[i]}">${inline(h)}</th>`).join('')}</tr></thead>
    <tbody>${b.rows.map((r) => `<tr>${r.map((c, i) => `<td class="${b.align[i]}">${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

/** Listed, drawn and absent per system, one bar each, absences split by reason. */
function coverageChart(cov) {
  const lang = getLang();
  const shades = ['#ff9f5a', '#ffd166', '#c792ea', '#7aa2ff', '#ff6b8b', '#5ad1a8'];
  const byCountry = DASH_CC.map((cc) => [cc, cov.rows.filter((r) => r.cc === cc)]).filter(([, rows]) => rows.length);
  return `<div class="cov">${byCountry.map(([cc, rows]) => `
    <section class="cov-cc">
      <h4><span class="flagdot flag-${cc}"></span>${t(`sys.country.${cc}`)}</h4>
      ${rows.map((r) => {
        const colour = SYS_COLOUR[r.system] || 'var(--cyan)';
        if (r.listed == null) {
          return `<div class="cov-row"><div class="cov-hd"><b>${r.tier[lang]}</b><span>${num(r.drawn)}</span></div>
            <p class="cov-src">${inline(r.listedBy[lang])}</p></div>`;
        }
        const pct = (n) => (n / r.listed) * 100;
        const segs = r.why.map((w, i) => ({ ...w, colour: shades[i % shades.length] }));
        return `<div class="cov-row">
          <div class="cov-hd"><b>${r.tier[lang]}</b>
            <span>${t('docs.cov.drawnOf', { d: num(r.drawn), n: num(r.listed) })}
            <em style="color:${colour}">${num(pct(r.drawn), pct(r.drawn) >= 99.95 ? 0 : 1)}%</em></span></div>
          <div class="cov-bar" role="img" aria-label="${num(r.drawn)} / ${num(r.listed)}">
            <i style="width:${pct(r.drawn)}%;background:${colour}"></i>
            ${segs.map((s) => `<i class="ab" style="width:${pct(s.n)}%;background:${s.colour}" title="${num(s.n)} · ${esc(cov.reasons[s.key][lang])}"></i>`).join('')}
          </div>
          <p class="cov-src">${t('docs.cov.listedBy')} ${inline(r.listedBy[lang])}</p>
          ${segs.length ? `<ul class="cov-why">${segs.map((s) => `<li><i style="background:${s.colour}"></i><b>${num(s.n)}</b> ${inline(cov.reasons[s.key][lang])}</li>`).join('')}</ul>` : ''}
        </div>`;
      }).join('')}
    </section>`).join('')}
    <p class="cov-note">${inline(cov.note[lang])}</p>
  </div>`;
}

function docBlocks(blocks, cov) {
  return blocks.map((b) => {
    if (b.t === 'h') return `<h${b.level + 1} class="dc-h">${inline(b.text.replace(/^\d+\.\s*/, ''))}</h${b.level + 1}>`;
    if (b.t === 'p') return `<p class="dc-p">${inline(b.text)}</p>`;
    if (b.t === 'ul' || b.t === 'ol') return `<${b.t} class="dc-list">${b.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${b.t}>`;
    if (b.t === 'table') return docTable(b);
    if (b.t === 'coverage') return cov ? coverageChart(cov) : '';
    return '';
  }).join('');
}

/* ── views drawn from the documents and data/insights.json ───────────── */

const plain = (md) => String(md).replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*`]/g, '').trim();
const pctTxt = (v) => (v == null ? '—' : `${num(v, v > 0 && v < 10 ? 1 : 0)}%`);
const registerRows = (docs) => docs.sources.flatMap((s) => s.blocks)
  .filter((b) => b.t === 'table' && isIdTable(b)).flatMap((b) => b.rows);

/** Share of each system's mileage that carries each attribute. */
function fieldHeatmap(ins) {
  return `<div class="dash-card dv-card"><h3>${t('dv.fields.title')}</h3><div class="in">
    <div class="dc-tbl-w"><table class="tbl dv-heat">
      <thead><tr><th></th>${ins.fields.map((f) => `<th>${t(`dv.f.${f}`)}</th>`).join('')}</tr></thead>
      <tbody>${ins.coverage.map((r) => `<tr><td><i class="lg-dot" style="--sys-col:${SYS_COLOUR[r.system]}"></i>${t(`sys.${r.system}`)}</td>
        ${ins.fields.map((f) => {
          const v = r.cells[f];
          return v == null ? '<td class="dv-na" title="—">—</td>'
            : `<td style="--a:${(0.08 + (v / 100) * 0.82).toFixed(2)}" title="${pctTxt(v)}">${pctTxt(v)}</td>`;
        }).join('')}</tr>`).join('')}</tbody>
    </table></div>
    <p class="hbar-note">${t('dv.fields.note')}</p></div></div>`;
}

/** The routes with the most unbridged gap, and each system's share broken. */
function gapRanking(ins) {
  const max = ins.gaps[0]?.gapMi || 1;
  const rows = ins.gaps.slice(0, 12).filter((r) => app.byId?.has(r.id));
  return `<div class="dash-cols">
    <div class="dash-card"><h3>${t('dv.gaps.title')}</h3><div class="in">
      <div class="hbars">${rows.map((r) => `
        <div class="hbar hbar-route" data-id="${r.id}">
          <span class="hbar-k"><b>${esc(r.label)}</b><small>${ownerLabel(r.system, r.st)} · ${t('dv.gaps.breaks', { n: num(r.breaks) })}</small></span>
          <span class="hbar-t"><i style="width:${((r.gapMi / max) * 100).toFixed(1)}%;background:${SYS_COLOUR[r.system]}"></i></span>
          <span class="hbar-v">${lenNum(r.gapMi)}</span>
        </div>`).join('')}</div>
      <p class="hbar-note">${t('dv.gaps.note', { u: lenUnit() })}</p></div></div>
    <div class="dash-card"><h3>${t('dv.broken.title')}</h3><div class="in">
      ${bars(ins.broken.map((b) => ({ k: t(`sys.${b.system}`), v: Math.round((b.broken / (b.routes || 1)) * 100), suffix: '%', sys: b.system })), (r) => SYS_COLOUR[r.sys], 100)}
      <p class="hbar-note">${t('dv.broken.note')}</p></div></div>
  </div>`;
}

/** Each register entry as a bar from the year its data describes to now. */
function freshness(docs) {
  const rows = registerRows(docs).map((r) => {
    const [ed, got] = String(r[3]).split('·').map((x) => x.trim());
    const dates = (s) => (s || '').match(/\b(19|20)\d{2}(-\d{2}-\d{2})?\b/g) || [];
    const years = dates(ed).map((d) => Number(d.slice(0, 4)));
    const retrieved = dates(got).find((d) => d.length === 10) || (dates(ed).length === 1 && dates(ed)[0].length === 10 && !got ? dates(ed)[0] : null);
    return { id: plain(r[0]), name: plain(r[1]), year: years.length ? Math.max(...years) : null, retrieved };
  });
  const now = Math.max(...rows.map((r) => Number((r.retrieved || '0').slice(0, 4))), ...rows.map((r) => r.year || 0));
  const from = Math.min(...rows.filter((r) => r.year).map((r) => r.year));
  const x = (y) => ((y - from) / (now - from || 1)) * 100;
  const ageCol = (age) => (age <= 1 ? 'var(--lime)' : age <= 3 ? 'var(--cyan)' : age <= 10 ? 'var(--amber)' : '#ff6b8b');
  return `<div class="dash-card dv-card"><h3>${t('dv.fresh.title')}</h3><div class="in">
    <div class="dv-fresh">${rows.map((r) => `
      <div class="dv-fr" title="${esc(r.name)}">
        <span class="dv-fr-id">${esc(r.id)}</span><span class="dv-fr-n">${esc(r.name)}</span>
        <span class="dv-fr-t">${r.year ? `<i style="left:${x(r.year)}%;width:${Math.max(1.2, 100 - x(r.year))}%;background:${ageCol(now - r.year)}"></i>`
          : `<em>${t('dv.fresh.undated')}</em>`}</span>
        <span class="dv-fr-y">${r.year ?? ''}${r.retrieved ? `<small>${t('dv.fresh.got', { d: r.retrieved })}</small>` : ''}</span>
      </div>`).join('')}
      <div class="dv-fr dv-fr-ax"><span></span><span></span><span class="dv-fr-t"><b style="left:0">${from}</b><b style="left:50%">${Math.round((from + now) / 2)}</b><b style="left:100%">${now}</b></span><span></span></div>
    </div>
    <p class="hbar-note">${t('dv.fresh.note')}</p></div></div>`;
}

// Which register entry feeds which system, and with what. A geometry flow
// carries the system's whole mileage; an attribute flow the share it covers.
const FLOWS = [
  ['US-1', 'geom', ['us-interstate', 'us-numbered', 'us-state']],
  ['US-6', 'traffic', ['us-interstate', 'us-numbered', 'us-state']],
  ['US-3', 'official', ['us-interstate']],
  ['US-4', 'cost', ['us-interstate']],
  ['CA-1', 'geom', ['ca-tch', 'ca-nhs', 'ca-provincial']],
  ['CA-2', 'geom', ['ca-tch', 'ca-nhs']],
  ['CA-4–10', 'traffic', ['ca-tch', 'ca-nhs', 'ca-provincial']],
  ['MX-1', 'geom', ['mx-federal', 'mx-state']],
  ['MX-3', 'traffic', ['mx-federal', 'mx-state']],
  ['TW-1', 'geom', ['tw-freeway', 'tw-provincial']],
  ['TW-2', 'official', ['tw-provincial']],
  ['HK-1', 'geom', ['hk-route']],
  ['CN-1', 'geom', ['cn-expressway', 'cn-national', 'cn-provincial']],
];

/**
 * One Sankey per country, each on its own scale: American state routes alone
 * outweigh Canada and Mexico together. A node is never shorter than its label,
 * so a band may widen or narrow across the chart; its mileage is in the tooltip.
 */
function lineagePanel(cc, ins, reg) {
  const sys = Object.fromEntries(ins.coverage.map((r) => [r.system, r]));
  const links = FLOWS.flatMap(([src, kind, to]) => to.filter((s) => sys[s]?.cc === cc).map((s) => ({
    src, kind, to: s, v: kind === 'geom' ? sys[s].mi : (sys[s].mi * (sys[s].cells[kind] || 0)) / 100,
  }))).filter((l) => l.v > 0);
  if (!links.length) return '';
  const W = 640; const NW = 9; const GAP = 8; const MIN = 26; const SPAN = 150;
  const left = [...new Set(links.map((l) => l.src))];
  const right = SYSTEMS.map((s) => s.id).filter((id) => links.some((l) => l.to === id));
  const sum = (key, id) => links.filter((l) => l[key] === id).reduce((a, l) => a + l.v, 0);
  const total = Math.max(...[left.map((id) => sum('src', id)), right.map((id) => sum('to', id))].map((xs) => xs.reduce((a, b) => a + b, 0)));
  const place = (ids, key) => {
    let y = 0;
    return Object.fromEntries(ids.map((id) => {
      const v = sum(key, id);
      const n = { y, h: Math.max(MIN, (v / total) * SPAN), v, off: 0 };
      y += n.h + GAP;
      return [id, n];
    }));
  };
  const L = place(left, 'src');
  const R = place(right, 'to');
  const H = Math.max(...[...Object.values(L), ...Object.values(R)].map((n) => n.y + n.h));
  const x0 = 200; const x1 = W - 170; const mx = (x0 + NW + x1) / 2;
  const bands = links.map((l) => {
    const a = L[l.src]; const b = R[l.to];
    const ha = (l.v / a.v) * a.h; const hb = (l.v / b.v) * b.h;
    const ya = a.y + a.off; const yb = b.y + b.off;
    a.off += ha; b.off += hb;
    const f = (n) => n.toFixed(1);
    return `<path d="M${x0 + NW},${f(ya)} C${mx},${f(ya)} ${mx},${f(yb)} ${x1},${f(yb)} L${x1},${f(yb + hb)} C${mx},${f(yb + hb)} ${mx},${f(ya + ha)} ${x0 + NW},${f(ya + ha)} Z"
      fill="${SYS_COLOUR[l.to]}" fill-opacity="${l.kind === 'geom' ? 0.4 : 0.2}">
      <title>${esc(l.src)} → ${esc(t(`sys.${l.to}`))} · ${t(`dv.flow.${l.kind}`)} · ${num(lenOf(l.v))} ${lenUnit()}</title></path>`;
  }).join('');
  const name = (id) => (reg.get(id) || reg.get(id.split('–')[0]) || '').replace(/[,(].*$/, '').slice(0, 30);
  return `<div class="dv-sk-cc"><p class="dash-sub"><span class="flagdot flag-${cc}"></span>${t(`sys.country.${cc}`)}</p>
    <svg class="dv-sankey" viewBox="0 0 ${W} ${Math.ceil(H)}" role="img">${bands}
      ${left.map((id) => `<rect x="${x0}" y="${L[id].y.toFixed(1)}" width="${NW}" height="${L[id].h.toFixed(1)}" rx="2" class="dv-node"/>
        <text x="${x0 - 8}" y="${(L[id].y + L[id].h / 2 - 5).toFixed(1)}" text-anchor="end" dominant-baseline="middle"><tspan class="dv-sk-id">${esc(id)}</tspan><tspan x="${x0 - 8}" dy="12" class="dv-sk-n">${esc(name(id))}</tspan></text>`).join('')}
      ${right.map((id) => `<rect x="${x1}" y="${R[id].y.toFixed(1)}" width="${NW}" height="${R[id].h.toFixed(1)}" rx="2" fill="${SYS_COLOUR[id]}"/>
        <text x="${x1 + NW + 8}" y="${(R[id].y + R[id].h / 2 - 5).toFixed(1)}" dominant-baseline="middle"><tspan>${esc(t(`sys.${id}`))}</tspan><tspan x="${x1 + NW + 8}" dy="12" class="dv-sk-n">${num(lenOf(sys[id].mi))} ${lenUnit()}</tspan></text>`).join('')}
    </svg></div>`;
}

function lineage(ins) {
  const reg = new Map(registerRows(docsData.docs[getLang()] || docsData.docs.en).map((r) => [plain(r[0]), plain(r[1])]));
  return `<div class="dash-card dv-card"><h3>${t('dv.flow.title')}</h3><div class="in dv-sk">
    ${DASH_CC.map((cc) => lineagePanel(cc, ins, reg)).join('')}
    <p class="hbar-note">${t('dv.flow.note')}</p></div></div>`;
}

const VERDICT_COLOUR = {
  covered: 'var(--lime)', agree: 'var(--lime)', present: 'var(--lime)',
  otherSystem: 'var(--cyan)', otherNumber: 'var(--cyan)', numberOnly: 'var(--amber)',
  short: '#c792ea', notInTiger: '#7a8ca6', notFound: '#ff6b8b', absent: '#ff6b8b', inTiger: '#ff6b8b', differs: 'var(--amber)',
};

function crosschecks(ins) {
  const c = ins.crosscheck;
  const LEN_COLOUR = ['#ff6b8b', '#ff9f5a', 'var(--amber)', 'var(--cyan)', 'var(--lime)', 'var(--cyan)', 'var(--amber)', '#ff9f5a', '#ff6b8b'];
  const binLabel = (b) => (b.lo == null ? `< ${b.hi}%` : b.hi == null ? `> +${b.lo}%` : b.lo === -2 ? '±2%' : `${b.lo > 0 ? '+' : ''}${b.lo}…${b.hi > 0 ? '+' : ''}${b.hi}%`);
  const rows = [
    { k: 'len', segs: ins.lengths.bins.map((b, i) => ({ n: b.n, label: binLabel(b), colour: LEN_COLOUR[i] })) },
    { k: 'usn', segs: ['covered', 'otherSystem', 'notInTiger', 'short', 'inTiger'].map((v) => ({ v, n: c.usNumbered[v] })) },
    { k: 'us', segs: ['covered', 'otherSystem', 'notInTiger', 'short', 'inTiger'].map((v) => ({ v, n: c.usState[v] })) },
    { k: 'mxf', segs: ['present', 'absent'].map((v) => ({ v, n: c.mxFederal[v] })) },
    { k: 'mx', segs: ['agree', 'otherNumber', 'numberOnly', 'notFound'].map((v) => ({ v, n: c.mxState[v] })) },
    { k: 'tch', segs: [{ v: 'agree', n: c.tch.agree }, { v: 'differs', n: c.tch.listed - c.tch.agree }] },
  ].map((r) => ({ ...r, segs: r.segs.filter((s) => s.n > 0) }));
  return `<div class="dash-card dv-card"><h3>${t('dv.cross.title')}</h3><div class="in dv-cross">${rows.map((r) => {
    const tot = r.segs.reduce((a, s) => a + s.n, 0);
    const lab = (s) => s.label || t(`dv.v.${s.v}`);
    return `<div class="dv-x"><div class="cov-hd"><b>${t(`dv.cross.${r.k}`)}</b><span>${num(tot)}</span></div>
      <div class="stack">${r.segs.map((s) => `<i style="flex:${s.n};background:${s.colour || VERDICT_COLOUR[s.v]}" title="${esc(lab(s))} · ${num(s.n)}"></i>`).join('')}</div>
      <ul class="stack-key">${r.segs.map((s) => `<li><i style="background:${s.colour || VERDICT_COLOUR[s.v]}"></i>${esc(lab(s))}<b>${num(s.n)}</b></li>`).join('')}</ul></div>`;
  }).join('')}
  <p class="hbar-note">${t('dv.cross.note')}</p></div></div>`;
}

/* Decisions: where each is enforced, for which country, and what it cites. */

const STAGES = ['fetch', 'ref', 'read', 'stitch', 'build', 'check', 'page'];
const REGIONS = ['all', 'us', 'ca', 'mx', 'ea', 'layers'];

function stagesOf(enforced) {
  const out = new Set();
  for (const f of String(enforced).match(/[\w.-]+\.(mjs|js|json)\b/g) || []) {
    if (/^fetch-/.test(f)) out.add('fetch');
    else if (/\.json$/.test(f)) out.add('ref');
    else if (/^geo\.mjs$/.test(f)) out.add('stitch');
    else if (/^build-/.test(f)) out.add('build');
    else if (/^(check-|coverage-figures|readme-figures|verify)/.test(f)) out.add('check');
    else if (/\.mjs$/.test(f)) out.add('read');
    else out.add('page');
  }
  return [...out];
}

function decisionIndex(docs) {
  const list = [];
  let region = -1;
  for (const b of docs.decisions.flatMap((s) => s.blocks)) {
    if (b.t === 'h') region++;
    if (b.t !== 'table' || !isIdTable(b)) continue;
    for (const r of b.rows) {
      const id = plain(r[0]);
      const n = Number(id.replace(/\D/g, ''));
      const cites = [...new Set((`${r[1]} ${r[2]}`.match(/D-\d+/g) || []).filter((d) => d !== id))];
      list.push({ id, n, region: REGIONS[Math.max(0, Math.min(REGIONS.length - 1, region))], stages: stagesOf(r[r.length - 1]), cites });
    }
  }
  return list;
}

function decisionViews(docs) {
  const ds = decisionIndex(docs);
  const regLabel = (r) => (['us', 'ca', 'mx'].includes(r) ? t(`sys.country.${r}`) : t(`dv.reg.${r}`));
  const count = (st, rg) => ds.filter((d) => (!st || d.stages.includes(st)) && (!rg || d.region === rg));
  const maxCell = Math.max(1, ...STAGES.flatMap((s) => REGIONS.map((r) => count(s, r).length)));
  const REG_COLOUR = { all: '#e6edf6', us: CC_COLOUR.us, ca: CC_COLOUR.ca, mx: '#6ef7a5', ea: CC_COLOUR.hk, layers: '#c792ea' };

  const W = 640; const H = 150; const base = H - 26;
  const sorted = ds.slice().sort((a, b) => a.n - b.n);
  const xOfD = new Map(sorted.map((d, i) => [d.id, 14 + (i / Math.max(1, sorted.length - 1)) * (W - 28)]));
  const arcs = ds.flatMap((d) => d.cites.filter((c) => xOfD.has(c)).map((c) => {
    const a = xOfD.get(d.id); const b = xOfD.get(c);
    const r = Math.abs(a - b) / 2;
    return `<path data-a="${d.id}" data-b="${c}" d="M${a.toFixed(1)},${base} A${r.toFixed(1)},${Math.min(r, base - 6).toFixed(1)} 0 0 ${a < b ? 1 : 0} ${b.toFixed(1)},${base}" stroke="${REG_COLOUR[d.region]}"/>`;
  })).join('');

  return `<div class="dash-card dv-card"><h3>${t('dv.pipe.title')}</h3><div class="in">
    <div class="dv-pipe">${STAGES.map((s, i) => `${i ? '<span class="dv-arrow">→</span>' : ''}<button class="dv-stage" type="button" data-stage="${s}">
      <b>${count(s).length}</b><span>${t(`dv.stage.${s}`)}</span></button>`).join('')}</div>
    <div class="dc-tbl-w"><table class="tbl dv-mtx"><thead><tr><th></th>${STAGES.map((s) => `<th>${t(`dv.stage.${s}`)}</th>`).join('')}</tr></thead>
      <tbody>${REGIONS.map((r) => `<tr><td><button class="dv-reg" type="button" data-region="${r}"><i style="background:${REG_COLOUR[r]}"></i>${regLabel(r)}</button></td>${STAGES.map((s) => {
        const n = count(s, r).length;
        return `<td>${n ? `<button class="dv-cell" type="button" data-stage="${s}" data-region="${r}" style="--a:${(0.15 + (n / maxCell) * 0.75).toFixed(2)}">${n}</button>` : ''}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="hbar-note">${t('dv.pipe.note')}</p></div></div>
  <div class="dash-card dv-card"><h3>${t('dv.ref.title')}</h3><div class="in">
    <svg class="dv-arcs" viewBox="0 0 ${W} ${H}" role="img">${arcs}
      ${sorted.map((d) => `<g class="dv-dn" data-id="${d.id}"><circle cx="${xOfD.get(d.id).toFixed(1)}" cy="${base}" r="${3 + Math.min(4, ds.filter((o) => o.cites.includes(d.id)).length)}" fill="${REG_COLOUR[d.region]}"><title>${d.id}</title></circle>
        ${d.n % 5 === 0 || d.n === 1 ? `<text x="${xOfD.get(d.id).toFixed(1)}" y="${base + 18}" text-anchor="middle">${d.id}</text>` : ''}</g>`).join('')}
    </svg>
    <ul class="stack-key">${REGIONS.map((r) => `<li><i style="background:${REG_COLOUR[r]}"></i>${regLabel(r)}</li>`).join('')}</ul>
    <p class="hbar-note">${t('dv.ref.note')}</p></div></div>
  <div class="dv-filter-bar" hidden><span id="dvFilterTxt"></span><button class="btn" type="button" id="dvClear">${t('dv.filter.clear')}</button></div>`;
}

function wireDecisionViews(body, docs) {
  const ds = decisionIndex(docs);
  const bar = body.querySelector('.dv-filter-bar');
  const apply = (ids) => {
    for (const c of body.querySelectorAll('.dc-card')) {
      const id = c.querySelector('.dc-id')?.textContent.trim();
      c.hidden = Boolean(ids) && !ids.has(id);
    }
    bar.hidden = !ids;
    if (ids) {
      body.querySelector('#dvFilterTxt').textContent = t('dv.filter.on', { n: num(ids.size) });
      body.querySelector('.dc-card:not([hidden])')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };
  let key = null;
  const toggle = (k, ids) => { key = key === k ? null : k; apply(key ? ids : null); };
  for (const b of body.querySelectorAll('[data-stage], [data-region]')) {
    b.addEventListener('click', () => {
      const st = b.dataset.stage; const rg = b.dataset.region;
      toggle(`${st}|${rg}`, new Set(ds.filter((d) => (!st || d.stages.includes(st)) && (!rg || d.region === rg)).map((d) => d.id)));
    });
  }
  for (const g of body.querySelectorAll('.dv-dn')) {
    g.addEventListener('click', () => {
      const d = ds.find((x) => x.id === g.dataset.id);
      toggle(d.id, new Set([d.id, ...d.cites, ...ds.filter((o) => o.cites.includes(d.id)).map((o) => o.id)]));
    });
  }
  body.querySelector('#dvClear').addEventListener('click', () => { key = null; apply(null); });
}

// A known gap's topic, read from its English title; the Chinese register is
// the same table row for row, so the topic carries across by position.
const GAP_TOPICS = [
  ['crossings', /crossing/i],
  ['tolls', /toll|fare|concession|CAPUFE/i],
  ['traffic', /traffic|counts/i],
  ['history', /opening|timeline/i],
  ['place', /which state|route ends|which road/i],
  ['attrs', /speed/i],
  ['interface', /interface/i],
  ['roads', /./],
];
const TOPIC_COLOUR = {
  roads: '#7aa2ff', place: '#c792ea', traffic: '#35e7ff', history: '#ffd166',
  tolls: '#ffb545', crossings: '#ff6b8b', attrs: '#5ad1a8', interface: '#7a8ca6',
};

/** The accuracy document's register of known gaps, by country and topic. */
function gapKinds(docs) {
  const tableOf = (d) => d.accuracy.flatMap((s) => s.blocks).find((b) => b.t === 'table' && isFlagTable(b));
  const table = tableOf(docs);
  const en = tableOf(docsData.docs.en);
  if (!table || !en) return '';
  const FLAG = { '🇺🇸': 'us', '🇨🇦': 'ca', '🇲🇽': 'mx', CN: 'cn', TW: 'tw', HK: 'hk' };
  const rows = table.rows.map((r, i) => {
    const flags = plain(r[0]).split(/\s+/).map((f) => FLAG[f]).filter(Boolean);
    return {
      cc: flags.length === 1 ? flags[0] : 'all',
      topic: GAP_TOPICS.find(([, rx]) => rx.test(en.rows[i]?.[1] || ''))[0],
      pending: /pending/i.test(en.rows[i]?.[2] || ''),
      title: plain(r[1]),
    };
  });
  const topics = GAP_TOPICS.map(([k]) => k).filter((k) => rows.some((r) => r.topic === k));
  const byCc = [...DASH_CC, 'all'].map((cc) => ({ cc, rows: rows.filter((r) => r.cc === cc) })).filter((c) => c.rows.length);
  const max = Math.max(...byCc.map((c) => c.rows.length));
  const pending = rows.filter((r) => r.pending).length;
  return `<div class="dash-card dv-card"><h3>${t('dv.gk.title', { n: num(rows.length) })}</h3><div class="in">
    <div class="cc-rows">${byCc.map((c) => `<div class="cc-row">
      <div class="cc-hd">${c.cc === 'all' ? '' : `<span class="flagdot flag-${c.cc}"></span>`}<b>${c.cc === 'all' ? t('dv.gk.shared') : t(`sys.country.${c.cc}`)}</b><span>${num(c.rows.length)}</span></div>
      <div class="stack dv-gk" style="width:${((c.rows.length / max) * 100).toFixed(1)}%">${topics.flatMap((k) => c.rows.filter((r) => r.topic === k)
        .map((r) => `<i class="${r.pending ? 'pend' : ''}" style="flex:1;background:${TOPIC_COLOUR[k]}" title="${esc(r.title)}"></i>`)).join('')}</div>
    </div>`).join('')}</div>
    <ul class="stack-key">${topics.map((k) => `<li><i style="background:${TOPIC_COLOUR[k]}"></i>${t(`dv.gk.${k}`)}<b>${num(rows.filter((r) => r.topic === k).length)}</b></li>`).join('')}
      ${pending ? `<li><i class="pend" style="background:var(--ink-faint)"></i>${t('dv.gk.pending')}<b>${num(pending)}</b></li>` : ''}</ul>
    <p class="hbar-note">${t('dv.gk.note')}</p></div></div>`;
}

function docViews(tab, docs, ins) {
  if (tab === 'coverage') return ins ? fieldHeatmap(ins) + gapRanking(ins) : '';
  if (tab === 'sources') return freshness(docs) + (ins ? lineage(ins) + crosschecks(ins) : '');
  if (tab === 'decisions') return decisionViews(docs);
  if (tab === 'accuracy') return gapKinds(docs);
  return '';
}

function renderDocs() {
  return frame('docs.title', 'docs.sub', `
    <div class="nb-tabs dc-tabs" role="tablist">${DOC_TABS.map((k) => `<button class="btn" data-dc="${k}" type="button" role="tab">${t(`docs.tab.${k}`)}</button>`).join('')}</div>
    <div class="dc-filter" hidden><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4.3-4.3"/></svg>
      <input id="dcQ" type="search" autocomplete="off" spellcheck="false"></div>
    <div id="dcBody" class="dc-body"><p class="dc-p">${t('docs.loading')}</p></div>`);
}

async function wireDocs() {
  if (!docsData) {
    const [docs, cov, ins] = await Promise.all([
      fetch('data/docs.json').then((r) => r.json()),
      fetch('data/coverage.json').then((r) => r.json()).catch(() => null),
      fetch('data/insights.json').then((r) => r.json()).catch(() => null),
    ]);
    docsData = { docs, cov, ins };
  }
  if (current !== 'docs') return;
  const body = document.getElementById('dcBody');
  const filter = document.querySelector('.dc-filter');
  const q = document.getElementById('dcQ');
  q.placeholder = t('docs.filter');
  const paint = (tab) => {
    docsTab = tab;
    const docs = docsData.docs[getLang()];
    const secs = docs[tab];
    body.innerHTML = `<div class="dv">${docViews(tab, docs, docsData.ins)}</div>`
      + secs.map((s) => `<section class="dc-sec">${secs.length > 1 ? `<h3 class="dc-h dc-h2">${inline(s.title)}</h3>` : ''}
      ${docBlocks(s.blocks, docsData.cov)}</section>`).join('');
    for (const row of body.querySelectorAll('.hbar-route[data-id]')) {
      row.addEventListener('click', () => { closeSheet(); select(row.dataset.id); });
    }
    if (tab === 'decisions') wireDecisionViews(body, docs);
    const filterable = body.querySelectorAll('.dc-card').length > 8;
    filter.hidden = !filterable;
    q.value = '';
    document.querySelector('.sh-bd').scrollTop = 0;
  };
  q.addEventListener('input', () => {
    const v = q.value.trim().toLowerCase();
    for (const c of body.querySelectorAll('.dc-card')) c.hidden = Boolean(v) && !c.dataset.q.includes(v);
  });
  for (const tab of document.querySelectorAll('[data-dc]')) {
    tab.classList.toggle('on', tab.dataset.dc === docsTab);
    tab.addEventListener('click', () => {
      for (const o of document.querySelectorAll('[data-dc]')) o.classList.toggle('on', o === tab);
      paint(tab.dataset.dc);
    });
  }
  paint(docsTab);
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

  const sysChips = DASH_CC.map((cc) => `<p class="ab-cc"><span class="flagdot flag-${cc}"></span><b>${t(`sys.country.${cc}`)}</b>
    ${SYSTEMS.filter((x) => x.cc === cc).map((x) => `<span class="ab-chip" style="--sys-col:${x.colour}">${t(`sys.${x.id}`)}</span>`).join('')}</p>`).join('');
  const go = (tab, label) => `<button class="ab-go" type="button" data-docs="${tab}">${label}<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>`;
  const L = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;

  const copy = zh ? {
    what: ['它是什么', `北美三国与中国大陆、台湾、香港的编号公路网：${SYSTEMS.length} 个路网系统、${num(app.index.length)} 条路线、${dist(totalMi)} 制图里程，覆盖 ${juris} 个州、省、地区与县市。每条线都可以点开，看起止点、分州里程、路段构成、海拔剖面，部分路线还有成文介绍。`],
    data: ['数据从哪里来', [
      ['us', `几何取自 ${L('https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html', 'TIGER/Line')}，官方里程取自 FHWA 路线名录，车流、路况、车道取自 ${L('https://www.fhwa.dot.gov/policyinformation/hpms.cfm', 'HPMS')}。`],
      ['ca', `几何取自加拿大统计局《${L('https://www.statcan.gc.ca/en/lode/databases/odr', '国家道路网')}》，NHS 名录取自交通部，车流量取自公开批量数据的七个省与地区。`],
      ['mx', `几何取自 INEGI《${L('https://www.inegi.org.mx/programas/rnc/', '国家道路网')}》2025 版，车流量取自 SICT《${L('https://www.datos.gob.mx/dataset/datos_viales', 'Datos Viales')}》。`],
      ['cn', `几何取自 ${L('https://www.openstreetmap.org/copyright', 'OpenStreetMap')} 贡献者（Geofabrik 提取，ODbL 许可）——官方的天地图对境外访问不开放，这是本站唯一一处非官方几何来源，没有官方里程与车流。`],
      ['tw', `几何取自国土测绘中心《${L('https://data.gov.tw/dataset/73232', '道路中心線')}》，省道官方里程取自交通部公路局《${L('https://data.gov.tw/dataset/105020', '省道公路路線表')}》，国道里程取自高速公路局《${L('https://data.gov.tw/dataset/37652', '路段基本資訊')}》。`],
      ['hk', `几何取自运输署《${L('https://portal.csdi.gov.hk/csdi-webpage/dataset/td_rcd_1638949160594_2844', '道路網絡')}》（空间数据共享平台）。`],
    ], '底图 OpenFreeMap（OpenStreetMap），卫星影像 Esri，地形 Mapzen。'],
    read: ['怎么读', [
      ['实测', `长度、起止点、分州里程、路段等级，均由几何在本站算出，分向行驶的公路只计一次。${acc.zh}`],
      ['上报', '车流、路况、车道、限速，来自各国机构，一律按编号而非位置匹配，并注明覆盖了全线多少。'],
      ['撰写', '历史、造价、驾驶体验，每个数字都附来源；找不到公开数据就直接写明，不做估算。'],
    ], '官方里程与实测不一致时两者并列，差异会说明原因；渡轮、共线、未建成路段不绘制也不计入，详情面板会写明缺了多少。'],
    links: [['sources', '全部来源与许可'], ['coverage', '覆盖率'], ['accuracy', '准确性与已知缺口'], ['decisions', '处理决策']],
    keys: '键盘',
  } : {
    what: ['What it is', `The numbered highway networks of the three North American countries, mainland China, Taiwan and Hong Kong: ${SYSTEMS.length} route systems, ${num(app.index.length)} routes and ${dist(totalMi)} of mapped road across ${juris} states, provinces, territories and counties. Every line opens into its termini, its length by jurisdiction, what it is built as, an elevation profile and, for some, a written profile.`],
    data: ['Where the data comes from', [
      ['us', `Geometry from ${L('https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html', 'TIGER/Line')}, official lengths from the FHWA Route Log, traffic, condition and lanes from ${L('https://www.fhwa.dot.gov/policyinformation/hpms.cfm', 'HPMS')}.`],
      ['ca', `Geometry from Statistics Canada's ${L('https://www.statcan.gc.ca/en/lode/databases/odr', 'National Road Network')}, the NHS from Transport Canada, traffic from the seven jurisdictions that publish counts in bulk.`],
      ['mx', `Geometry from INEGI's ${L('https://www.inegi.org.mx/programas/rnc/', 'Red Nacional de Caminos')} 2025, traffic from SICT's ${L('https://www.datos.gob.mx/dataset/datos_viales', 'Datos Viales')}.`],
      ['cn', `Geometry from ${L('https://www.openstreetmap.org/copyright', 'OpenStreetMap')} contributors (Geofabrik extract, ODbL) - the official Tianditu service is closed to access from abroad, so this is the one place the atlas draws on a source that is not an authority, and there are no official lengths or traffic.`],
      ['tw', `Geometry from the NLSC's ${L('https://data.gov.tw/dataset/73232', 'road centrelines')}, provincial official lengths from the Highway Bureau's ${L('https://data.gov.tw/dataset/105020', 'provincial highway register')}, freeway lengths from the Freeway Bureau's ${L('https://data.gov.tw/dataset/37652', 'section chainages')}.`],
      ['hk', `Geometry from the Transport Department's ${L('https://portal.csdi.gov.hk/csdi-webpage/dataset/td_rcd_1638949160594_2844', 'Road Network')}, on the CSDI portal.`],
    ], 'Base map OpenFreeMap (OpenStreetMap), imagery Esri, terrain Mapzen.'],
    read: ['How to read it', [
      ['Measured', `Length, termini, length by jurisdiction and roadway class, computed here from the geometry, with a divided highway counted once. ${acc.en}`],
      ['Reported', 'Traffic, condition, lanes and speeds, as each country’s agencies publish them, joined by designation and never by position, with the share of the road they cover.'],
      ['Written', 'History, cost and character, each figure with its source. Where there is no public figure the page says so rather than estimating one.'],
    ], 'Where the official length and the measured one disagree, both are shown and the difference is explained. Ferries, concurrencies and unbuilt pieces are neither drawn nor counted, and the detail panel says how much is missing.'],
    links: [['sources', 'Every source and licence'], ['coverage', 'Coverage'], ['accuracy', 'Accuracy and known gaps'], ['decisions', 'Processing decisions']],
    keys: 'Keyboard',
  };

  const body = `
    <div class="ab">
      <section class="ab-part">
        <span class="ab-n">01</span><h4>${copy.what[0]}</h4>
        <p>${copy.what[1]}</p>
        ${sysChips}
      </section>
      <section class="ab-part">
        <span class="ab-n">02</span><h4>${copy.data[0]}</h4>
        ${copy.data[1].map(([cc, text]) => `<p class="ab-row"><span class="flagdot flag-${cc}"></span><span>${text}</span></p>`).join('')}
        <p class="ab-fine">${copy.data[2]}</p>
        <div class="ab-links">${go(copy.links[0][0], copy.links[0][1])}${go(copy.links[1][0], copy.links[1][1])}</div>
      </section>
      <section class="ab-part">
        <span class="ab-n">03</span><h4>${copy.read[0]}</h4>
        ${copy.read[1].map(([k, text]) => `<p class="ab-row"><b class="ab-k">${k}</b><span>${text}</span></p>`).join('')}
        <p class="ab-fine">${copy.read[2]}</p>
        <div class="ab-links">${go(copy.links[2][0], copy.links[2][1])}${go(copy.links[3][0], copy.links[3][1])}</div>
      </section>
    </div>
    <p class="ab-keys"><span>${copy.keys}</span><b>/</b> <b>Ctrl-K</b> ${zh ? '搜索' : 'search'} · <b>F</b> ${zh ? '巡航所选路线' : 'fly the selected route'} · <b>T</b> ${zh ? '三维地形' : '3D terrain'} · <b>Z</b> ${zh ? '隐藏界面' : 'hide the interface'} · <b>L</b> <b>S</b> <b>M</b> ${zh ? '图层、设置、更多' : 'layers, settings, more'} · <b>Esc</b> ${zh ? '返回' : 'back out'}</p>`;

  return frame('about.title', 'about.sub', body);
}

function wireAbout() {
  for (const b of document.querySelectorAll('[data-docs]')) {
    b.addEventListener('click', () => { docsTab = b.dataset.docs; openSheet('docs'); });
  }
}
