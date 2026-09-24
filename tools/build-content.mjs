// Validates the hand-written route dossiers and publishes them to data/.
//
//   node tools/build-content.mjs
//
// The validation exists to protect two promises the site makes. First, that
// English and Chinese say the same thing: any localised field missing one
// language is an error, not a silent fallback. Second, that no figure appears
// without a source: a figure either carries a source string or is explicitly
// marked as having no public data.

import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { IX, SECTION_KEYS, geoPath, system, systemOfCode } from '../assets/schema.js';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'content', 'dossiers');
const OUT = join(ROOT, 'data', 'dossiers');

// Where a route's geometry lives, which is by system and then by jurisdiction
// for the tiers too large to load whole.
function geoFile(row) {
  const s = systemOfCode(row[IX.sys]);
  return s ? geoPath(s.id, row[IX.st]) : null;
}

const geoCache = new Map();
async function geometryOf(row) {
  const file = geoFile(row);
  if (!geoCache.has(file)) {
    const fc = JSON.parse(await readFile(join(ROOT, 'data', 'geo', file), 'utf8'));
    geoCache.set(file, new Map(fc.features.map((f) => [f.properties.id, f.geometry.coordinates])));
  }
  return geoCache.get(file).get(row[IX.id]) || [];
}

/** How far an anchor is from the nearest point of a route, in km. */
async function anchorDistanceKm(row, [ax, ay]) {
  const scale = Math.cos((ay * Math.PI) / 180);
  let best = Infinity;
  for (const line of await geometryOf(row)) {
    for (const [x, y] of line) {
      const d = (((x - ax) * scale) ** 2) + ((y - ay) ** 2);
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best) * 111.32;
}

/**
 * Which road a dossier is about.
 *
 * A route's id is assigned by the build, and where one number covers several
 * disconnected roads it has to be made unique somehow — by the state carrying
 * the most of it, or failing that by mileage rank. Neither is a property of
 * the road. Both moved when the American geometry changed source, and twenty-
 * six hand-written profiles silently stopped being shown: the file was still
 * there, the id it named no longer existed.
 *
 * So a dossier names its road the way a person would, and the build looks it
 * up: a system, a number, and where it is. The filename carries the first two
 * (`i-285`, `us-12-mt`, `ca-33-1`) and is enough on its own for all but the
 * numbers used more than once. Those add an `anchor`, a coordinate the road
 * passes near — a fact about the road, which survives any amount of
 * re-splitting.
 */
function selectorFrom(slug, declared) {
  if (declared?.num) {
    return {
      sys: declared.sys ? SYS_CODE[declared.sys] : null,
      st: declared.st || null,
      num: String(declared.num).toLowerCase(),
      anchor: declared.anchor || null,
    };
  }
  const parts = slug.split('-');
  const lead = parts[0];
  const sys = lead === 'i' ? system('us-interstate').code
    : lead === 'us' ? system('us-numbered').code : null;
  // A state-route slug opens with its jurisdiction; an Interstate or US slug
  // may close with one, to tell namesakes apart.
  let st = sys ? null : lead.toUpperCase();
  const rest = parts.slice(1);
  if (rest.length === 2 && /^[a-z]{2}$/.test(rest[1])) st = rest[1].toUpperCase();
  return { sys, st, num: rest[0], anchor: declared?.anchor || null };
}

async function resolve(sel, routes) {
  let pool = routes.filter((r) => String(r[IX.num]).toLowerCase() === sel.num
    && (!sel.sys || r[IX.sys] === sel.sys));
  if (!pool.length) return { error: `nothing numbered ${sel.num} in the atlas` };

  // The jurisdiction in a slug is a hint, not a filter: it records which state
  // held most of the road when the id was minted, and that can change without
  // the road changing. Narrow by it when it still matches, ignore it when it
  // does not and the number is unambiguous anyway.
  if (sel.st) {
    const narrowed = pool.filter((r) => r[IX.st] === sel.st);
    if (narrowed.length) pool = narrowed;
  }
  if (pool.length === 1 && !sel.anchor) return { row: pool[0] };

  const listing = () => pool.map((r) => `      ${r[IX.id]}  ${r[IX.label]}  ${r[IX.st]}`
    + `  ${r[IX.mi]} mi  centred ${r[IX.cx]}, ${r[IX.cy]}`).join('\n');

  if (!sel.anchor) {
    return {
      error: `${pool.length} roads carry this number — add "route": { "num": "${sel.num}",`
        + ` "anchor": [lon, lat] } naming a point on the one this is about:\n${listing()}`,
    };
  }

  const measured = [];
  for (const r of pool) measured.push([await anchorDistanceKm(r, sel.anchor), r]);
  measured.sort((a, b) => a[0] - b[0]);
  // A wrong anchor has to be an error rather than a nearest guess, or a typo
  // quietly publishes a profile about one road onto another.
  if (measured[0][0] > 25) {
    return {
      error: `the anchor is ${Math.round(measured[0][0])} km from the nearest road carrying`
        + ` this number, so it names none of them:\n${listing()}`,
    };
  }
  return { row: measured[0][1] };
}

const problems = [];
const warnings = [];

function fail(file, msg) { problems.push(`${file}: ${msg}`); }
function warn(file, msg) { warnings.push(`${file}: ${msg}`); }

function checkLocalised(file, path, value, { allowNull = false } = {}) {
  if (value == null) {
    if (!allowNull) fail(file, `${path} is missing`);
    return;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    fail(file, `${path} must be an object with en and zh`);
    return;
  }
  for (const lang of ['en', 'zh']) {
    const v = value[lang];
    if (v == null || (typeof v === 'string' && !v.trim())) fail(file, `${path}.${lang} is empty`);
  }
}

function checkParagraphs(file, path, value) {
  if (!Array.isArray(value) || !value.length) {
    fail(file, `${path} must be a non-empty array of paragraphs`);
    return 0;
  }
  let words = 0;
  value.forEach((p, i) => {
    if (typeof p !== 'string' || !p.trim()) fail(file, `${path}[${i}] is empty`);
    else words += p.trim().split(/\s+/).length;
  });
  return words;
}

async function main() {
  let files = [];
  try {
    files = (await readdir(SRC)).filter((f) => f.endsWith('.json') && f !== 'index.json');
  } catch {
    console.log('no content/dossiers directory yet — nothing to build');
  }

  const index = JSON.parse(await readFile(join(ROOT, 'data', 'index.json'), 'utf8'));
  const takenBy = new Map();

  // Routes that carry an official construction cost from FHWA's route-by-route
  // table. Several dossiers were written before that table was wired in and
  // record the cost as undocumented, some of them asserting that federal
  // accounting was only ever done for the system as a whole. That is no longer
  // true, and leaving the claim in place would print "no public data" directly
  // above the figure. The claims are dropped here rather than edited out of
  // content/, so the reason lives in one place and the removals are reported.
  const costed = new Set();
  try {
    const fc = JSON.parse(await readFile(join(ROOT, 'data', 'geo', 'interstate.json'), 'utf8'));
    for (const f of fc.features) if (f.properties.offCostK) costed.add(f.properties.id);
  } catch { /* geometry not built yet; nothing to reconcile against */ }

  const ROUTE_COST_LABEL = /^(total|route-wide|original|overall)?\s*construction cost$|^cost of the whole route$/i;
  const superseded = [];

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const timelineRoutes = [];
  const timelineEvents = [];
  const publishedIds = [];
  let published = 0;
  const bySystem = {};

  for (const file of files.sort()) {
    let d;
    try {
      d = JSON.parse(await readFile(join(SRC, file), 'utf8'));
    } catch (e) {
      fail(file, `invalid JSON — ${e.message}`);
      continue;
    }

    const slug = file.replace(/\.json$/, '');
    const hit = await resolve(selectorFrom(slug, d.route), index.routes);
    if (hit.error) { fail(file, hit.error); continue; }
    const id = hit.row[IX.id];
    if (takenBy.has(id)) {
      fail(file, `resolves to ${id}, which ${takenBy.get(id)} already claims`);
      continue;
    }
    takenBy.set(id, file);
    // Published under the route's id, because that is what the site looks up,
    // and carrying it inside so the timeline can light the road on the map.
    d = { ...d, id };

    checkLocalised(file, 'name', d.name);
    checkLocalised(file, 'tagline', d.tagline);
    if (d.termini) {
      checkLocalised(file, 'termini.start', d.termini.start, { allowNull: true });
      checkLocalised(file, 'termini.end', d.termini.end, { allowNull: true });
    }

    if (!Array.isArray(d.sections) || !d.sections.length) {
      fail(file, 'sections must be a non-empty array');
    } else {
      const seen = new Set();
      for (const s of d.sections) {
        if (!SECTION_KEYS.has(s.key)) fail(file, `unknown section key "${s.key}"`);
        if (seen.has(s.key)) fail(file, `duplicate section "${s.key}"`);
        seen.add(s.key);
        const en = checkParagraphs(file, `sections.${s.key}.en`, s.en);
        const zh = checkParagraphs(file, `sections.${s.key}.zh`, s.zh);
        // The two languages should carry the same content. Chinese runs shorter
        // by word count, so only a wide divergence is worth flagging.
        if (en && zh && (s.en.length !== s.zh.length)) {
          warn(file, `section "${s.key}" has ${s.en.length} English paragraphs but ${s.zh.length} Chinese`);
        }
      }
    }

    for (const group of ['figures', 'trafficFigures', 'conditionFigures']) {
      if (!d[group]) continue;
      if (!Array.isArray(d[group])) { fail(file, `${group} must be an array`); continue; }
      d[group].forEach((f, i) => {
        checkLocalised(file, `${group}[${i}].label`, f.label);
        const hasValue = f.value && (f.value.en || f.value.zh);
        if (hasValue) {
          checkLocalised(file, `${group}[${i}].value`, f.value);
          if (!f.source) fail(file, `${group}[${i}] has a value but no source`);
        } else if (!f.why) {
          fail(file, `${group}[${i}] has no value and no "why" explaining the gap`);
        } else {
          checkLocalised(file, `${group}[${i}].why`, f.why);
        }
      });
    }

    if (d.officialMi != null && !d.mileageSource) {
      fail(file, 'officialMi given without mileageSource');
    }

    if (costed.has(id) && Array.isArray(d.figures)) {
      const kept = d.figures.filter((f) => {
        const blank = !(f.value && (f.value.en || f.value.zh));
        const drop = blank && ROUTE_COST_LABEL.test((f.label?.en || '').trim());
        if (drop) superseded.push(`${id} — "${f.label.en}"`);
        return !drop;
      });
      d = { ...d, figures: kept };
    }

    if (d.completedYear != null) {
      timelineRoutes.push({
        id, label: hit.row[IX.label], year: d.completedYear, mi: hit.row[IX.mi],
      });
    }
    for (const ev of d.timeline || []) {
      if (typeof ev.year !== 'number') { fail(file, 'timeline entry without a year'); continue; }
      checkLocalised(file, `timeline ${ev.year}`, { en: ev.en, zh: ev.zh });
      timelineEvents.push({ year: ev.year, en: ev.en, zh: ev.zh, id });
    }

    await writeFile(join(OUT, `${id}.json`), JSON.stringify(d));
    publishedIds.push(id);
    published++;
    const sys = systemOfCode(hit.row[IX.sys])?.id ?? 'us-state';
    bySystem[sys] = (bySystem[sys] || 0) + 1;
  }

  // The client checks this before requesting a dossier, so routes without one
  // cost no request and log no error.
  await writeFile(join(OUT, 'index.json'), JSON.stringify({ ids: publishedIds.sort() }));

  // System-wide events sit alongside the per-route ones, so the timeline reads
  // as one story rather than a list of openings.
  try {
    const ms = JSON.parse(await readFile(join(ROOT, 'content', 'reference', 'milestones.json'), 'utf8'));
    for (const ev of ms.events) {
      checkLocalised('milestones.json', `event ${ev.year}`, { en: ev.en, zh: ev.zh });
      if (!ev.source) fail('milestones.json', `event ${ev.year} has no source`);
      timelineEvents.push({
        year: ev.year, en: ev.en, zh: ev.zh, source: ev.source, system: true, ...(ev.kind ? { kind: ev.kind } : {}),
      });
    }
  } catch { warn('milestones.json', 'not found; timeline will have route events only'); }

  // Québec's Répertoire dates each tronçon's opening to traffic. Those years
  // belong on the playhead as sourced notes. They are not turned into map
  // geometry: the directory does not publish coordinates, and lighting a whole
  // autoroute in the year its first piece opened would draw unopened road as
  // open. One span ("1975-1979") is kept undated, as the scraper recorded it.
  let quebec = null;
  try {
    const qc = JSON.parse(await readFile(join(ROOT, 'content', 'reference', 'qc-autoroutes.json'), 'utf8'));
    const srcLine = `${qc.source.publisher} — ${qc.source.title}`;
    const qcId = (number) => {
      const n = String(number);
      const hits = index.routes.filter((r) => r[IX.st] === 'QC' && String(r[IX.num]) === n);
      if (hits.length === 1) return hits[0][IX.id];
      const exact = hits.find((r) => r[IX.id] === `qc-${n}`);
      return exact ? exact[IX.id] : null;
    };
    let dated = 0;
    let undated = 0;
    let linked = 0;
    for (const a of Object.values(qc.autoroutes ?? {})) {
      const id = qcId(a.number);
      for (const sec of a.sections ?? []) {
        for (const seg of sec.segments ?? []) {
          if (typeof seg.year !== 'number') { undated++; continue; }
          dated++;
          if (id) linked++;
          timelineEvents.push({
            year: seg.year,
            en: `Opened to traffic: Autoroute ${a.number}`
              + (sec.name ? `, ${sec.name}` : '')
              + ` — ${seg.segment}.`,
            zh: `通车：${a.number} 号高速公路`
              + (sec.name ? `（${sec.name}）` : '')
              + ` — ${seg.segment}。`,
            source: srcLine,
            kind: 'qc',
            ...(id ? { id } : {}),
          });
        }
      }
    }
    quebec = {
      segments: qc.coverage?.segments ?? dated + undated,
      dated,
      undated,
      linked,
      yearFrom: qc.coverage?.yearFrom ?? null,
      yearTo: qc.coverage?.yearTo ?? null,
      source: { publisher: qc.source.publisher, title: qc.source.title, url: qc.source.url, retrieved: qc.source.retrieved },
    };
  } catch { warn('qc-autoroutes.json', 'not found; Québec openings will not appear on the playhead'); }

  timelineRoutes.sort((a, b) => a.year - b.year);
  timelineEvents.sort((a, b) => a.year - b.year || (a.system ? -1 : b.system ? 1 : 0));
  const years = [...timelineRoutes.map((r) => r.year), ...timelineEvents.map((e) => e.year)];

  // FHWA's year-by-year mileage table rides along in the same file. It is the
  // only complete account of how the system grew - there is no published
  // opening date per route - so the buildout view needs both it and the dated
  // routes above, and needs to be able to say how far apart the two are.
  let mileage = null;
  try {
    const m = JSON.parse(await readFile(join(ROOT, 'content', 'reference', 'interstate-mileage.json'), 'utf8'));
    mileage = { source: m.source, scope: m.scope, fields: m.fields, open: m.open };
  } catch { warn('interstate-mileage.json', 'not found; the buildout view will not open'); }

  const interstates = index.routes.filter((r) => r[2] === 'i').length;
  await writeFile(join(ROOT, 'data', 'timeline.json'), JSON.stringify({
    range: [Math.min(1956, ...years), Math.max(2026, ...years)],
    // How much of the network the map can honestly light up, so the view can
    // report its own coverage instead of implying it is complete.
    coverage: { interstates, documented: timelineRoutes.length, quebec },
    mileage,
    routes: timelineRoutes,
    events: timelineEvents,
  }));

  console.log(`published ${published} dossiers`, bySystem);
  if (superseded.length) {
    console.log(`\n${superseded.length} "no public data" cost figure(s) dropped, now sourced from`
      + ' the FHWA route cost table:');
    for (const s of superseded) console.log(`  ${s}`);
  }
  console.log(`timeline: ${timelineRoutes.length} dated routes, ${timelineEvents.length} events`
    + (quebec ? ` (${quebec.dated} Québec tronçons, ${quebec.undated} undated, ${quebec.linked} matched to a mapped route)` : ''));

  if (warnings.length) {
    console.log(`\n${warnings.length} warning(s):`);
    for (const w of warnings) console.log(`  ~ ${w}`);
  }
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    for (const p of problems) console.log(`  ! ${p}`);
    process.exit(1);
  }
  console.log('\ncontent OK');
}

main().catch((e) => { console.error(e); process.exit(1); });
