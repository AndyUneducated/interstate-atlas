/**
 * What each East Asian route is called, beside the number it is drawn under.
 *
 *   node tools/build-names.mjs
 *
 * A mainland route's name is the 2022 plan's short name (京港澳高速), with
 * its full name (北京—港澳高速公路) and English; failing a plan entry, the
 * name OpenStreetMap's route relation carries. A provincial expressway has
 * no plan entry, so it takes the expressway name its own ways carry most.
 * Taiwan's names are the bureaus' (tw-names.json). Hong Kong's routes are
 * strings of named roads and have no name of their own.
 *
 * `alt` is what else a route is called along some of its length - 京珠高速
 * on G4, 新藏公路 on G219 - with the names of other numbered routes it
 * shares pavement with left out, since those are concurrencies, not names.
 *
 * Writes data/names.json: { generated, sources, routes: { id: { zh, en,
 * full, alt, wz } } }, `wz` being the disambiguating place in Chinese for
 * the routes whose `where` names one.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const GEO = join(ROOT, 'data', 'geo');
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

async function features(dir) {
  const out = [];
  for (const f of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) out.push(...await features(p));
    else if (f.name.endsWith('.json')) out.push(...(await readJson(p)).features);
  }
  return out;
}

const plan = (await readJson(join(ROOT, 'content', 'reference', 'cn-plan.json'))).routes;
const twRef = await readJson(join(ROOT, 'content', 'reference', 'tw-names.json'));

// A name that is only a number, or a pair of ends, says nothing a reader
// does not already have from the shield and the termini.
const NUMERIC = /^(?:G|S|X)\d+|^\d+\s*(?:国道|省道)$|国道\d+|^China National Highway/i;
const ENDS = /\s[-－–—]\s/;
const EXPRESSWAY = /高速(?:公路)?$/;
const ROADLIKE = /(?:高速(?:公路)?|公路|线|路)$/;

const cn = (await features(join(GEO, 'cn'))).map((f) => f.properties);
const others = new Set(Object.values(plan).map((p) => p.short));

function cnName(p) {
  const own = p.plan ?? plan[p.num] ?? null;
  const osmParts = String(p.osm?.name ?? '').split(/\s+/).filter((s) => s && !NUMERIC.test(s));
  const provincialExpressway = p.sys === 'cn-provincial' && /^S(\d{1,2}|\d{4})$/.test(p.num);
  let zh = own?.short ?? osmParts.find((s) => ROADLIKE.test(s)) ?? null;
  if (!zh && provincialExpressway) {
    zh = (p.named ?? []).find((n) => EXPRESSWAY.test(n) && !others.has(n) && !NUMERIC.test(n)) ?? null;
  }
  const en = own?.en ?? (p.osm?.nameEn && !NUMERIC.test(p.osm.nameEn) ? p.osm.nameEn : null);
  const full = own?.zh ?? p.osm?.official ?? null;
  if (p.sys === 'cn-provincial' && !provincialExpressway) return null;
  const fit = p.sys === 'cn-national' ? ROADLIKE : EXPRESSWAY;
  const alt = [...new Set([...osmParts, ...(p.named ?? [])])].filter((n) => n !== zh && n !== full
    && !NUMERIC.test(n) && !ENDS.test(n) && fit.test(n) && !(others.has(n) && n !== own?.short)
    && !(full && full.replace(/[—－-]/g, '') === n.replace(/[—－-]/g, ''))).slice(0, 4);
  return zh || en || alt.length ? { zh, en, full: full !== zh ? full : null, alt } : null;
}

function whereZh(p) {
  if (!p.where) return null;
  let w = p.where;
  for (const end of [p.start, p.end]) if (end?.name && end.nameZh) w = w.replace(end.name, end.nameZh);
  return w !== p.where ? w : null;
}

const routes = {};
let named = 0;
for (const p of cn) {
  const n = cnName(p);
  const wz = whereZh(p);
  if (!n && !wz) continue;
  routes[p.id] = { ...(n ?? {}), ...(wz ? { wz } : {}) };
  if (n?.zh || n?.en) named++;
}
for (const [id, r] of Object.entries(twRef.routes)) {
  routes[id] = { zh: r.zh ?? null, en: r.en ?? null, full: null, alt: r.alt ?? [] };
  if (r.zh) named++;
}
for (const r of Object.values(routes)) {
  for (const k of Object.keys(r)) if (r[k] == null || (Array.isArray(r[k]) && !r[k].length)) delete r[k];
}

await writeFile(join(ROOT, 'data', 'names.json'), `${JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  sources: { cn: 'cn-plan.json (CN-2) and OpenStreetMap route relations and ways (CN-1)', tw: twRef.source },
  routes,
})}\n`);
console.log(`wrote names for ${named} routes (${Object.keys(routes).length} entries)`);
