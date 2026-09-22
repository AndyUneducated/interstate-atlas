// THROWAWAY. Final tabulation off the pass-2 summary. Delete when done.
import { readFile } from 'node:fs/promises';
const d = JSON.parse(await readFile('tools/_probe-mx3.in.json', 'utf8'));
const rows = d.rows;
const st = rows.filter((r) => r.system === 'state');
const sum = (a, f) => +a.reduce((x, y) => x + f(y), 0).toFixed(1);
const show = (label, a) => console.log(label.padEnd(56), String(a.length).padStart(5), `${String(sum(a, (g) => g.km)).padStart(9)} km`);

const LETTER = /[A-Z]$/;
const D4 = /^\d{4}$/;
const ALPHA = /^[A-Z]+$/;

console.log('=== numbers carrying a letter suffix, or wholly alphabetic ===');
for (const g of rows.filter((g) => LETTER.test(g.number))) {
  console.log(' ', g.key, 'segs', g.segs, 'km', g.km, g.adminDominant,
    JSON.stringify(g.peaje), JSON.stringify(g.names.slice(0, 2)));
}
console.log('  (of which wholly alphabetic:',
  rows.filter((g) => ALPHA.test(g.number)).map((g) => g.key).join(', '), ')');

const est = st.filter((g) => g.adminDominant === 'Estatal');
const pure = st.filter((g) => g.adminPure && g.adminDominant === 'Estatal');
console.log('\n=== admission rules ===');
show('0. current', st);
show('1. ADMINISTRA dominant Estatal', est);
show('2. ADMINISTRA purely Estatal', pure);
show('3. rule2 + drop 4-digit numbers', pure.filter((g) => !D4.test(g.number)));
show('4. rule2 + drop 4-digit + >= 2 segments', pure.filter((g) => !D4.test(g.number) && g.segs >= 2));
for (const n of [1, 5, 10, 25]) show(`5. rule2 + drop 4-digit + >= ${n} km`, pure.filter((g) => !D4.test(g.number) && g.km >= n));

console.log('\n=== 4-digit numbers by prefix ===');
const byP = new Map();
for (const g of st.filter((g) => D4.test(g.number))) byP.set(g.prefix, (byP.get(g.prefix) ?? 0) + 1);
console.log(JSON.stringify(Object.fromEntries(byP)), 'total', st.filter((g) => D4.test(g.number)).length,
  'km', sum(st.filter((g) => D4.test(g.number)), (g) => g.km));

console.log('\n=== per-prefix number-space density (numeric numbers only) ===');
const pfxs = [...new Set(st.map((g) => g.prefix))];
const dens = pfxs.map((p) => {
  const ns = st.filter((g) => g.prefix === p).map((g) => Number(g.number)).filter(Number.isFinite).sort((a, b) => a - b);
  return { prefix: p, n: ns.length, min: ns[0], max: ns[ns.length - 1], density: +(ns.length / ns[ns.length - 1]).toFixed(2) };
}).sort((a, b) => b.n - a.n);
console.log(['pfx', 'n', 'min', 'max', 'density'].join('\t'));
for (const r of dens) console.log([r.prefix, r.n, r.min, r.max, r.density].join('\t'));
