// Writes the coverage table in docs/DATA-SOURCES.md: for each route system,
// how many routes the official register lists, how many the atlas draws, and
// why each of the rest is absent.
//
//   node tools/coverage-figures.mjs           rewrite the table in place
//   node tools/coverage-figures.mjs --check   fail if it is out of date
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
const read = async (p) => JSON.parse(await readFile(join(ROOT, p), 'utf8'));
const fmt = (n) => n.toLocaleString('en-US');
const problems = [];

async function drawn() {
  const files = ['us/interstate', 'us/numbered', 'ca/nhs', 'ca/tch', 'mx/federal'].map((f) => `data/geo/${f}.json`);
  for (const d of ['us/state', 'ca/provincial', 'mx/state']) {
    for (const f of await readdir(join(ROOT, 'data', 'geo', d))) files.push(`data/geo/${d}/${f}`);
  }
  const have = new Map();
  const count = {};
  for (const f of files) {
    for (const { properties: p } of (await read(f)).features) {
      count[p.sys] = (count[p.sys] ?? 0) + 1;
      for (const st of new Set([p.st, ...(p.states ?? []).map((s) => s.st)])) {
        const k = `${p.sys}|${st}`;
        if (!have.has(k)) have.set(k, new Set());
        have.get(k).add(String(p.num).toUpperCase());
      }
    }
  }
  return { has: (sys, st, n) => have.get(`${sys}|${st}`)?.has(String(n).toUpperCase()) ?? false, count };
}

/** Tally absences by reason, taking each from `rule` or the hand list. */
function tally(system, absent, rule, hand, reasons) {
  const by = {};
  for (const key of absent) {
    const why = rule?.(key) ?? hand[key];
    if (!why) { problems.push(`${system} ${key}: absent, with no reason`); continue; }
    by[why] = (by[why] ?? 0) + 1;
  }
  for (const key of Object.keys(hand)) {
    if (!absent.includes(key)) problems.push(`${system} ${key}: has a reason in coverage-gaps.json but is not absent`);
  }
  return Object.entries(by).sort((a, b) => b[1] - a[1]).map(([why, n]) => `${fmt(n)} ${reasons[why] ?? why}`);
}

async function table() {
  const { has, count } = await drawn();
  const gaps = await read('content/reference/coverage-gaps.json');
  const R = gaps.reasons;
  const rows = [];
  const row = (flag, tier, listedBy, listed, drawnN, why) => rows.push(
    `| ${flag} | ${tier} | ${listedBy} | ${listed == null ? '—' : fmt(listed)} | ${fmt(drawnN)} | ${listed == null ? '—' : fmt(listed - drawnN)} | ${why.length ? why.join('; ') : '—'} |`,
  );

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
    row('🇺🇸', 'Interstate', 'FHWA Route Log, Table 1 (US-3): each route in each state', listed, listed - absent.length,
      tally('us-interstate', absent, null, gaps.gaps['us-interstate'] ?? {}, R));
  }

  // US and state routes: HPMS, as judged by check-us-coverage.mjs.
  {
    const us = await read('content/reference/us-crosscheck.json');
    const words = {
      otherSystem: 'filed by HPMS under another system than TIGER\'s, and drawn under TIGER\'s',
      notInTiger: 'on no TIGER primary or secondary road in that state (D-47)',
      short: 'on TIGER for under half a mile at a stretch (D-42)',
      inTiger: 'on TIGER for longer, unexplained',
    };
    for (const [sys, tier] of [['us-numbered', 'US Route'], ['us-state', 'State Route']]) {
      const t = us.total[sys];
      if (t.inTiger) problems.push(`${sys}: ${t.inTiger} HPMS keys on TIGER with no route and no reason (us-crosscheck.json)`);
      const why = Object.keys(words).filter((k) => t[k]).sort((a, b) => t[b] - t[a]).map((k) => `${fmt(t[k])} ${words[k]}`);
      row('🇺🇸', tier, 'HPMS (US-6): each route of a mile or more each state reports', t.reported, t.covered, why);
    }
  }

  // Canada's NHS: Transport Canada's register, each number in each province.
  {
    const reg = (await read('content/reference/canada-nhs.json')).register;
    const CA = ['ca-nhs', 'ca-tch', 'ca-provincial'];
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
    const reasons = { ...R, code: 'a segment, interchange or two-route code in the register, not a route number', localAccess: 'a Newfoundland local-access number (D-20)' };
    row('🇨🇦', 'National Highway System', 'Transport Canada register (CA-2): each number in each province', listed, listed - absent.length,
      tally('ca-nhs', absent, rule, gaps.gaps['ca-nhs'] ?? {}, reasons));
    row('🇨🇦', 'Trans-Canada', 'none: the designation is measured along the highways that carry it (D-21)', null, count['ca-tch'] ?? 0, []);
  }

  // Canadian provincial routes: the traffic registers of the jurisdictions
  // that publish one.
  {
    const cat = (await read('content/reference/ca-traffic.json')).provinces;
    const CA = ['ca-nhs', 'ca-tch', 'ca-provincial'];
    const absent = [];
    let listed = 0;
    for (const [pr, v] of Object.entries(cat)) {
      for (const n of Object.keys(v.routes)) {
        listed++;
        if (!CA.some((s) => has(s, pr, n))) absent.push(`${pr}|${n}`);
      }
    }
    const juris = Object.keys(cat).join(', ');
    row('🇨🇦', 'Provincial', `provincial traffic registers (CA-4 to CA-10), ${juris}: each route; the other six publish none`, listed, listed - absent.length,
      tally('ca-provincial', absent, null, gaps.gaps['ca-provincial'] ?? {}, R));
  }

  // Mexico: SICT's Datos Viales index, as judged by check-mexico-numbers.mjs.
  {
    const mx = await read('content/reference/mx-crosscheck.json');
    const absent = [];
    for (const [st, v] of Object.entries(mx.byState)) for (const rt of v.federal.absent) absent.push(`${st}|${rt}`);
    const f = mx.total.federal;
    row('🇲🇽', 'Federal', 'SICT Datos Viales 2025 (MX-4): each route in each state', f.present + f.absent, f.present,
      tally('mx-federal', absent, null, gaps.gaps['mx-federal'] ?? {}, R));
    const s = mx.total.state;
    const listed = s.agree + s.otherNumber + s.numberOnly + s.notFound;
    row('🇲🇽', 'State', 'SICT Datos Viales 2025 (MX-4): each numbered state road', listed, s.agree + s.otherNumber, [
      `${fmt(s.notFound)} carried by no atlas route under the number or SICT's tramo names (D-51)`,
      `${fmt(s.numberOnly)} drawn under the number, but on a road whose tramo names do not match SICT's`,
    ].filter((x) => !x.startsWith('0 ')));
    rows.push('');
    rows.push(`Of the Mexican state roads counted as drawn, ${fmt(s.otherNumber)} carry INEGI's number rather than SICT's (D-26).`);
  }

  return [
    '| Country | System | Listed by | Listed | Drawn | Absent | Why absent |',
    '| --- | --- | --- | ---: | ---: | ---: | --- |',
    ...rows,
  ].join('\n');
}

async function main() {
  const check = process.argv.includes('--check');
  const before = await readFile(DOC, 'utf8');
  const value = await table();
  if (problems.length) {
    console.error(`coverage-figures: ${problems.length} problem${problems.length === 1 ? '' : 's'}`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  const eol = before.includes('\r\n') ? '\r\n' : '\n';
  const re = /(<!-- auto:coverage -->)[\s\S]*?(<!-- \/auto:coverage -->)/;
  if (!re.test(before)) throw new Error('DATA-SOURCES.md has no auto:coverage marker');
  const after = before.replace(re, (all, open, close) => `${open}${eol}${value.replace(/\n/g, eol)}${eol}${close}`);
  if (after === before) { console.log('coverage table up to date'); return; }
  if (check) { console.error('coverage table is out of date: run node tools/coverage-figures.mjs'); process.exit(1); }
  await writeFile(DOC, after);
  console.log('coverage table rewritten from the build');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
