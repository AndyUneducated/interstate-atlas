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

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'content', 'dossiers');
const OUT = join(ROOT, 'data', 'dossiers');

const SECTION_KEYS = new Set([
  'character', 'engineering', 'history', 'money', 'traffic', 'condition', 'drive',
]);

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
  const knownIds = new Set(index.routes.map((r) => r[0]));

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

    const id = d.id || file.replace(/\.json$/, '');
    if (!knownIds.has(id)) {
      fail(file, `id "${id}" does not match any route in data/index.json`);
      continue;
    }

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

    if (d.completedYear != null) {
      const row = index.routes.find((r) => r[0] === id);
      timelineRoutes.push({ id, label: row[1], year: d.completedYear, mi: row[5] });
    }
    for (const ev of d.timeline || []) {
      if (typeof ev.year !== 'number') { fail(file, 'timeline entry without a year'); continue; }
      checkLocalised(file, `timeline ${ev.year}`, { en: ev.en, zh: ev.zh });
      timelineEvents.push({ year: ev.year, en: ev.en, zh: ev.zh, id });
    }

    await writeFile(join(OUT, `${id}.json`), JSON.stringify(d));
    publishedIds.push(id);
    published++;
    const sys = id.startsWith('i-') ? 'interstate' : id.startsWith('us-') ? 'us' : 'state';
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
      timelineEvents.push({ year: ev.year, en: ev.en, zh: ev.zh, source: ev.source, system: true });
    }
  } catch { warn('milestones.json', 'not found; timeline will have route events only'); }

  timelineRoutes.sort((a, b) => a.year - b.year);
  timelineEvents.sort((a, b) => a.year - b.year);
  const years = [...timelineRoutes.map((r) => r.year), ...timelineEvents.map((e) => e.year)];
  await writeFile(join(ROOT, 'data', 'timeline.json'), JSON.stringify({
    range: [Math.min(1956, ...years), Math.max(2026, ...years)],
    routes: timelineRoutes,
    events: timelineEvents,
  }));

  console.log(`published ${published} dossiers`, bySystem);
  console.log(`timeline: ${timelineRoutes.length} dated routes, ${timelineEvents.length} events`);

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
