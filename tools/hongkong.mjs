// Reads Hong Kong's strategic routes for build-data.mjs.
//
// Source: the Transport Department's Road Network, centreline layer, on the
// Common Spatial Data Infrastructure portal. Every centreline carries the
// Strategic Route Number of the road it belongs to, so Routes 1 to 10 are read
// straight from that field. fetch-hongkong.mjs keeps only those segments.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const SRC = join(import.meta.dirname, 'src', 'hk');
export const ROUTES = join(SRC, 'routes.json');

export const hongKongLabel = (number) => `Route ${number}`;

// The register writes street names in capitals; the signs do not.
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s\-(/])([a-z])/g, (_, a, b) => a + b.toUpperCase());

export async function loadHongKong() {
  let doc;
  try { doc = JSON.parse(await readFile(ROUTES, 'utf8')); } catch { return null; }
  const groups = new Map();
  for (const f of doc.features) {
    const p = f.properties;
    const number = String(p.ROUTE_NUM ?? '').trim();
    if (!/^\d+$/.test(number)) continue;
    if (!groups.has(number)) groups.set(number, { number, parts: [], names: new Map() });
    const g = groups.get(number);
    const en = p.STREET_ENAME && p.STREET_ENAME !== '-99' ? titleCase(p.STREET_ENAME) : null;
    const zh = p.STREET_CNAME && !/９９$/.test(p.STREET_CNAME) ? p.STREET_CNAME : null;
    // The source says nothing about a road's standard, only which strategic
    // route it is, so the type is left unknown rather than called a freeway.
    const props = { state: 'HK', type: 'Unknown', name: en, nameZh: zh, exit: p.EXIT_NUM ?? null };
    if (en) g.names.set(en, (g.names.get(en) ?? 0) + (p.SHAPE_Length ?? 0));
    g.parts.push({ coords: f.geometry.coordinates, props });
  }
  return { groups, edition: doc.edition ?? null, features: doc.features.length };
}
