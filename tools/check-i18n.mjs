/* Checks the interface string tables against each other and against the code.

   Content parity between English and Chinese is a requirement of this atlas,
   not a nice-to-have, and it is the kind of requirement that rots silently: a
   key added to one table and not the other falls back to English at runtime
   and looks like a rendering bug rather than a missing translation. The
   fallback is deliberate - a missing string should never show a reader a raw
   key - which is exactly why it needs checking here instead.

   Three failures are reported:
     · a key in one language table and not the other
     · a key the code asks t() for that no table defines
     · a key both tables define that the code never asks for

   The third is a warning rather than an error. Some keys are assembled at
   runtime from a system or tier id, so they are real even though no literal
   in the source spells them out; those prefixes are listed in BUILT below. */

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

// Keys assembled at runtime from a system, tier or region id rather than
// written out anywhere. Each entry is the literal prefix that appears in the
// source as `t(\`prefix${...}\`)`, so nothing below can be reported unread.
const BUILT = [
  'sys.', 'comp.', 'sect.', 'ca.nhs.', 'jump.', 'src.',
];

async function main() {
  const { STRINGS } = await import('../assets/i18n.js');
  const langs = Object.keys(STRINGS);
  const errors = [];
  const warnings = [];

  // --- parity between the tables ---
  for (const a of langs) {
    for (const b of langs) {
      if (a === b) continue;
      for (const k of Object.keys(STRINGS[a])) {
        if (!(k in STRINGS[b])) errors.push(`${k}: in ${a}, missing from ${b}`);
      }
    }
  }

  // --- placeholders must match, or one language silently drops a number ---
  const slots = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const k of Object.keys(STRINGS.en)) {
    const want = slots(STRINGS.en[k]);
    for (const l of langs.filter((x) => x !== 'en')) {
      if (!(k in STRINGS[l])) continue;
      const got = slots(STRINGS[l][k]);
      if (got !== want) {
        errors.push(`${k}: placeholders differ — en {${want}} vs ${l} {${got}}`);
      }
    }
  }

  // --- keys the code asks for ---
  // Not every key reaches t() directly. Plenty are handed to a helper that
  // looks them up - metric('ca.lanes'), section('money'), frame('sys.pickState')
  // - and matching only on t( reported all of those as dead. So any string
  // literal that is exactly a defined key counts as that key being read. It
  // is a loose test, but the errors above are what this script is for; this
  // part only flags strings nothing mentions at all.
  const asked = new Set();
  const literals = new Set();
  const files = (await readdir(ASSETS)).filter((f) => f.endsWith('.js'));
  for (const f of files) {
    const src = await readFile(join(ASSETS, f), 'utf8');
    for (const m of src.matchAll(/\bt\(\s*['"`]([\w.-]+)['"`]/g)) asked.add(m[1]);
    // The table's own definitions are not usages. Scanning i18n.js for
    // literals made every key match itself, so nothing was ever reported
    // unread and the warning was dead weight that looked like a clean bill.
    if (f === 'i18n.js') continue;
    for (const m of src.matchAll(/['"`]([\w-]+(?:\.[\w-]+)+)['"`]/g)) literals.add(m[1]);
  }
  const html = await readFile(join(ASSETS, '..', 'index.html'), 'utf8');
  for (const m of html.matchAll(/data-i18n(?:-\w+)?="([\w.-]+)"/g)) asked.add(m[1]);
  files.push('index.html');
  const used = new Set([...asked, ...literals]);
  // Only a direct t() call is an error when undefined; a bare literal that
  // merely looks like a key is more often a filename or a CSS property.
  for (const k of asked) {
    if (!(k in STRINGS.en)) errors.push(`${k}: asked for in code, defined nowhere`);
  }

  // --- keys nothing asks for ---
  for (const k of Object.keys(STRINGS.en)) {
    if (used.has(k)) continue;
    if (BUILT.some((p) => k.startsWith(p))) continue;
    warnings.push(`${k}: defined but never read`);
  }

  const n = Object.keys(STRINGS.en).length;
  console.log(`${n} keys × ${langs.length} languages, ${used.size} read from ${files.length} modules`);
  for (const w of warnings) console.log(`  warn  ${w}`);
  for (const e of errors) console.log(`  FAIL  ${e}`);
  if (errors.length) {
    console.log(`\n${errors.length} problem${errors.length === 1 ? '' : 's'}`);
    process.exit(1);
  }
  console.log(warnings.length ? `\nclean, ${warnings.length} warnings` : '\nclean');
}

main().catch((e) => { console.error(e); process.exit(1); });
