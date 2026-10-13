// Writes the coverage table in docs/DATA-SOURCES.md, and the same figures in
// both languages to data/coverage.json for the site: for each route system,
// how many routes the official register lists, how many the atlas draws, and
// why each of the rest is absent.
//
//   node tools/coverage-figures.mjs           rewrite both in place
//   node tools/coverage-figures.mjs --check   fail if either is out of date
//
// The unit is a route in a jurisdiction, because every register is kept that
// way: FHWA lists I-95 once per state it crosses. Each absence gets a reason,
// from one of three places:
//
//   content/reference/us-crosscheck.json   HPMS against TIGER and the atlas
//                                          (npm run check:us)
//   content/reference/mx-crosscheck.json   SICT against the atlas
//                                          (npm run check:mx)
//   content/reference/coverage-gaps.json   reasons established by hand
//
// plus two rules for Canada's NHS register below. An absence with no reason
// fails the run, as does a hand reason for a route that is no longer absent,
// so the table cannot quietly describe a build it was not written from. The
// two crosscheck files are written from a build, so run both after one.

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const DOC = join(ROOT, 'docs', 'DATA-SOURCES.md');
const OUT = join(ROOT, 'data', 'coverage.json');
const read = async (p) => JSON.parse(await readFile(join(ROOT, p), 'utf8'));
const fmt = (n) => n.toLocaleString('en-US');
const problems = [];

async function drawn() {
  const files = ['us/interstate', 'us/numbered', 'ca/nhs', 'ca/tch', 'mx/federal'].map((f) => `data/geo/${f}.json`);
  for (const d of ['us/state', 'ca/provincial', 'mx/state']) {
    for (const f of await readdir(join(ROOT, 'data', 'geo', d))) files.push(`data/geo/${d}/${f}`);
  }
  const have = new Map();
  for (const f of files) {
    for (const { properties: p } of (await read(f)).features) {
      for (const st of new Set([p.st, ...(p.states ?? []).map((s) => s.st)])) {
        const k = `${p.sys}|${st}`;
        if (!have.has(k)) have.set(k, new Set());
        have.get(k).add(String(p.num).toUpperCase());
      }
    }
  }
  return { has: (sys, st, n) => have.get(`${sys}|${st}`)?.has(String(n).toUpperCase()) ?? false };
}

/** Count absences by reason, taking each from `rule` or the hand list. */
function tally(system, absent, rule, hand) {
  const by = {};
  for (const key of absent) {
    const why = rule?.(key) ?? hand[key];
    if (!why) { problems.push(`${system} ${key}: absent, with no reason`); continue; }
    by[why] = (by[why] ?? 0) + 1;
  }
  for (const key of Object.keys(hand)) {
    if (!absent.includes(key)) problems.push(`${system} ${key}: has a reason in coverage-gaps.json but is not absent`);
  }
  return Object.entries(by).sort((a, b) => b[1] - a[1]).map(([key, n]) => ({ key, n }));
}

/** Reasons the rules below give, beside the hand reasons in coverage-gaps.json. */
const RULE_REASONS = {
  otherSystem: {
    en: 'filed by HPMS under another system than TIGER\'s, and drawn under TIGER\'s',
    zh: 'HPMS 把它归入与 TIGER 不同的系统，已按 TIGER 的编号绘制',
  },
  notInTiger: {
    en: 'on no TIGER primary or secondary road in that state (D-47)',
    zh: '在该州 TIGER 的主要与次要道路中没有这条路（D-47）',
  },
  short: {
    en: 'on TIGER for under half a mile at a stretch (D-42)',
    zh: '在 TIGER 中最长连续路段不足半英里（D-42）',
  },
  inTiger: { en: 'on TIGER for longer, unexplained', zh: 'TIGER 中有更长路段，原因不明' },
  code: {
    en: 'a segment, interchange or two-route code in the register, not a route number',
    zh: '登记中填的是路段、立交或两条路的组合代码，不是路线编号',
  },
  localAccess: { en: 'a Newfoundland local-access number (D-20)', zh: '纽芬兰的地方连接编号（D-20）' },
  sictNotFound: {
    en: 'carried by no atlas route under the number or SICT\'s tramo names (D-51)',
    zh: '本站没有任何路线带这个编号或 SICT 给出的路段名（D-51）',
  },
  sictNumberOnly: {
    en: 'drawn under the number, but on a road whose tramo names do not match SICT\'s',
    zh: '已按该编号绘制，但路段名与 SICT 的不符',
  },
  notInNlsc: {
    en: 'carried by no segment of the NLSC centrelines outside a provisional 臨 alignment',
    zh: '国土测绘中心中心线里，除临时线（臨）外没有任何路段带这个编号',
  },
  notInCsdi: { en: 'carried by no segment of the Transport Department centrelines', zh: '运输署中心线里没有任何路段带这个编号' },
};

async function rows() {
  const { has } = await drawn();
  const gaps = await read('content/reference/coverage-gaps.json');
  const out = [];
  const row = (cc, system, tier, listedBy, listed, drawnN, absent) => out.push({
    cc, system, tier, listedBy, listed, drawn: drawnN, absent: listed == null ? null : listed - drawnN, why: absent,
  });

  // Interstates: FHWA's Route Log, each route in each state.
  {
    const fhwa = (await read('content/reference/fhwa-mileage.json')).routes;
    const absent = [];
    let listed = 0;
    for (const [route, v] of Object.entries(fhwa)) {
      const n = route.replace(/^I-/, '').replace(/^H-/, 'H').replace(/^(\d+) (Central|East|West)$/, (m, a, b) => a + b[0]);
      for (const [st, mi] of Object.entries(v.states ?? v)) {
        if (typeof mi !== 'number') continue;
        listed++;
        if (!has('us-interstate', st, n)) absent.push(`${route}|${st}`);
      }
    }
    row('us', 'us-interstate', { en: 'Interstate', zh: '州际公路' },
      { en: 'FHWA Route Log, Table 1 (US-3): each route in each state', zh: 'FHWA 路线名录表 1（US-3）：每条路线在每个州各计一次' },
      listed, listed - absent.length, tally('us-interstate', absent, null, gaps.gaps['us-interstate'] ?? {}));
  }

  // US and state routes: HPMS, as judged by check-us-coverage.mjs.
  {
    const us = await read('content/reference/us-crosscheck.json');
    for (const [sys, tier] of [['us-numbered', { en: 'US Route', zh: '美国国道' }], ['us-state', { en: 'State Route', zh: '州道' }]]) {
      const t = us.total[sys];
      if (t.inTiger) problems.push(`${sys}: ${t.inTiger} HPMS keys on TIGER with no route and no reason (us-crosscheck.json)`);
      const why = ['otherSystem', 'notInTiger', 'short', 'inTiger'].filter((k) => t[k])
        .sort((a, b) => t[b] - t[a]).map((key) => ({ key, n: t[key] }));
      row('us', sys, tier,
        { en: 'HPMS (US-6): each route of a mile or more each state reports', zh: 'HPMS（US-6）：各州上报的每条 1 英里以上路线' },
        t.reported, t.covered, why);
    }
  }

  // Canada's NHS: Transport Canada's register, each number in each province.
  const CA = ['ca-nhs', 'ca-tch', 'ca-provincial'];
  {
    const reg = (await read('content/reference/canada-nhs.json')).register;
    const absent = [];
    let listed = 0;
    for (const [pr, tiers] of Object.entries(reg)) {
      for (const n of new Set(Object.values(tiers).flat().map(String))) {
        listed++;
        if (!CA.some((s) => has(s, pr, n))) absent.push(`${pr}|${n}`);
      }
    }
    // Newfoundland files segment and interchange codes ("I1:382:11") and its
    // local-access numbers ("430-78") in the register's number field.
    const rule = (key) => {
      const n = key.split('|')[1];
      if (/[:/]/.test(n)) return 'code';
      if (/^\d+[A-Z]?-\d/.test(n)) return 'localAccess';
      return null;
    };
    row('ca', 'ca-nhs', { en: 'National Highway System', zh: '国家公路系统' },
      { en: 'Transport Canada register (CA-2): each number in each province', zh: '加拿大交通部登记（CA-2）：每个编号在每个省各计一次' },
      listed, listed - absent.length, tally('ca-nhs', absent, rule, gaps.gaps['ca-nhs'] ?? {}));
  }

  // The Trans-Canada: the hand-kept list, each route in each province.
  {
    const list = (await read('content/reference/tch-routes.json')).routes;
    const absent = list.filter((r) => !has('ca-tch', r.pr, r.number)).map((r) => `${r.pr}|${r.number}`);
    row('ca', 'ca-tch', { en: 'Trans-Canada', zh: '横加公路' },
      { en: 'hand-kept list of the highways that carry it (D-52): each route in each province', zh: '手工维护的承载路线清单（D-52）：每条路线在每个省各计一次' },
      list.length, list.length - absent.length, tally('ca-tch', absent, null, gaps.gaps['ca-tch'] ?? {}));
  }

  // Canadian provincial routes: the traffic registers of the jurisdictions
  // that publish one.
  {
    const cat = (await read('content/reference/ca-traffic.json')).provinces;
    const absent = [];
    let listed = 0;
    for (const [pr, v] of Object.entries(cat)) {
      for (const n of Object.keys(v.routes)) {
        listed++;
        if (!CA.some((s) => has(s, pr, n))) absent.push(`${pr}|${n}`);
      }
    }
    const juris = Object.keys(cat).join(', ');
    row('ca', 'ca-provincial', { en: 'Provincial', zh: '省道' },
      {
        en: `provincial traffic registers (CA-4 to CA-10), ${juris}: each route; the other six publish none`,
        zh: `各省交通量登记（CA-4 至 CA-10），${juris}：每条路线；其余六个省区没有发布`,
      },
      listed, listed - absent.length, tally('ca-provincial', absent, null, gaps.gaps['ca-provincial'] ?? {}));
  }

  // Mexico: SICT's Datos Viales index, as judged by check-mexico-numbers.mjs.
  let note = null;
  {
    const mx = await read('content/reference/mx-crosscheck.json');
    const absent = [];
    for (const [st, v] of Object.entries(mx.byState)) for (const rt of v.federal.absent) absent.push(`${st}|${rt}`);
    const f = mx.total.federal;
    row('mx', 'mx-federal', { en: 'Federal', zh: '联邦公路' },
      { en: 'SICT Datos Viales 2025 (MX-4): each route in each state', zh: 'SICT《道路数据 2025》（MX-4）：每条路线在每个州各计一次' },
      f.present + f.absent, f.present, tally('mx-federal', absent, null, gaps.gaps['mx-federal'] ?? {}));
    const s = mx.total.state;
    const listed = s.agree + s.otherNumber + s.numberOnly + s.notFound;
    row('mx', 'mx-state', { en: 'State', zh: '州道' },
      { en: 'SICT Datos Viales 2025 (MX-4): each numbered state road', zh: 'SICT《道路数据 2025》（MX-4）：每条有编号的州道' },
      listed, s.agree + s.otherNumber,
      [{ key: 'sictNotFound', n: s.notFound }, { key: 'sictNumberOnly', n: s.numberOnly }].filter((w) => w.n));
    note = {
      en: `Of the Mexican state roads counted as drawn, ${fmt(s.otherNumber)} carry INEGI's number rather than SICT's (D-26).`,
      zh: `计为已绘制的墨西哥州道中，有 ${fmt(s.otherNumber)} 条用的是 INEGI 的编号而非 SICT 的（D-26）。`,
    };
  }

  // Taiwan and Hong Kong. The build records which register numbers it found
  // no geometry for, so this reads the build rather than the raw downloads.
  {
    const ea = (await read('data/stats.json')).eastAsia ?? {};
    const count = async (f) => new Set((await read(`data/geo/${f}.json`)).features.map((x) => x.properties.num)).size;
    const tw = ea.tw;
    if (tw) {
      row('tw', 'tw-freeway', { en: 'National Freeway', zh: '國道' },
        { en: 'no published register (TW-1 numbers what it draws)', zh: '没有公开的路线登记（TW-1 按其图层编号）' },
        null, await count('tw/freeway'), []);
      const unmapped = tw.unmapped ?? [];
      row('tw', 'tw-provincial', { en: 'Provincial Highway', zh: '省道' },
        { en: 'Highway Bureau provincial register (TW-2): each route', zh: '公路局省道路线表（TW-2）：每条路线' },
        tw.register, tw.register - unmapped.length, unmapped.length ? [{ key: 'notInNlsc', n: unmapped.length }] : []);
    }
    if (ea.hk) {
      const n = await count('hk/routes');
      row('hk', 'hk-route', { en: 'Strategic Route', zh: '主要幹線' },
        { en: 'Transport Department, Routes 1 to 10 (HK-1)', zh: '运输署 1 至 10 号干线（HK-1）' },
        10, n, n < 10 ? [{ key: 'notInCsdi', n: 10 - n }] : []);
    }
  }

  const reasons = {};
  for (const r of out) {
    for (const { key } of r.why) {
      const en = gaps.reasons[key] ?? RULE_REASONS[key]?.en;
      const zh = gaps.reasonsZh?.[key] ?? RULE_REASONS[key]?.zh;
      if (!en || !zh) problems.push(`reason ${key} has no ${en ? 'Chinese' : 'English'} text`);
      reasons[key] = { en, zh };
    }
  }
  return { rows: out, reasons, note };
}

const FLAG = { us: '🇺🇸', ca: '🇨🇦', mx: '🇲🇽', tw: 'TW', hk: 'HK' };

function markdown({ rows: rs, reasons, note }) {
  const cell = (n) => (n == null ? '—' : fmt(n));
  return [
    '| Country | System | Listed by | Listed | Drawn | Absent | Why absent |',
    '| --- | --- | --- | ---: | ---: | ---: | --- |',
    ...rs.map((r) => `| ${FLAG[r.cc]} | ${r.tier.en} | ${r.listedBy.en} | ${cell(r.listed)} | ${fmt(r.drawn)} | ${cell(r.absent)} | ${
      r.why.length ? r.why.map((w) => `${fmt(w.n)} ${reasons[w.key].en}`).join('; ') : '—'} |`),
    '',
    note.en,
  ].join('\n');
}

async function main() {
  const check = process.argv.includes('--check');
  const before = await readFile(DOC, 'utf8');
  const data = await rows();
  if (problems.length) {
    console.error(`coverage-figures: ${problems.length} problem${problems.length === 1 ? '' : 's'}`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  const eol = before.includes('\r\n') ? '\r\n' : '\n';
  const re = /(<!-- auto:coverage -->)[\s\S]*?(<!-- \/auto:coverage -->)/;
  if (!re.test(before)) throw new Error('DATA-SOURCES.md has no auto:coverage marker');
  const value = markdown(data);
  const after = before.replace(re, (all, open, close) => `${open}${eol}${value.replace(/\n/g, eol)}${eol}${close}`);
  const json = `${JSON.stringify(data)}\n`;
  const jsonBefore = await readFile(OUT, 'utf8').catch(() => '');

  if (after === before && json === jsonBefore) { console.log('coverage table up to date'); return; }
  if (check) { console.error('coverage table is out of date: run node tools/coverage-figures.mjs'); process.exit(1); }
  if (after !== before) await writeFile(DOC, after);
  if (json !== jsonBefore) await writeFile(OUT, json);
  console.log('coverage table rewritten from the build');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
