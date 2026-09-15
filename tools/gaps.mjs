// Reports designations that FHWA publishes but the atlas has no geometry for.
import { readFile } from 'node:fs/promises';

const ref = JSON.parse(await readFile('content/reference/fhwa-mileage.json', 'utf8')).routes;
const fc = JSON.parse(await readFile('data/geo/interstate.json', 'utf8'));

const have = new Set();
for (const f of fc.features) {
  const n = String(f.properties.num);
  have.add(`I-${n}`);
  have.add(n.replace(/^([A-Z]+)(\d)/, '$1-$2'));
}

const missing = Object.keys(ref).filter((k) => !have.has(k));
const mi = missing.reduce((s, k) => s + (ref[k].total || 0), 0);

console.log(`FHWA designations:  ${Object.keys(ref).length}`);
console.log(`present in atlas:   ${Object.keys(ref).length - missing.length}`);
console.log(`missing geometry:   ${missing.length}  (${Math.round(mi).toLocaleString()} mi)`);
for (const k of missing) {
  console.log(`   ${k.padEnd(12)} ${String(ref[k].total ?? '-').padStart(8)} mi  ${Object.keys(ref[k].states).join(',')}`);
}
