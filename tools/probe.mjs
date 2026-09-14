// Scratch harness for poking at the live page. Not part of the build.
//
//   node tools/probe.mjs

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const PORT = 8899;

const server = spawn(process.execPath, [join(ROOT, 'tools', 'serve.mjs'), String(PORT)], {
  cwd: ROOT, stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 900));

const browser = await chromium.launch({ channel: 'chromium-headless-shell' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('  console:', m.text().slice(0, 200)); });
page.on('requestfailed', (r) => {
  const e = r.failure()?.errorText || '';
  if (!e.includes('ERR_ABORTED')) console.log('  failed:', e, r.url().slice(0, 120));
});
page.on('response', (r) => { if (r.status() >= 400) console.log('  http', r.status(), r.url().slice(0, 140)); });

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
await page.waitForSelector('#boot.done', { timeout: 30000 });
await page.waitForTimeout(2500);

console.log('\n-- enable US routes --');
await page.click('.sys[data-sys="us"]');
for (const wait of [1000, 2000, 3000, 5000]) {
  await page.waitForTimeout(wait === 1000 ? 1000 : 1000);
  const r = await page.evaluate(() => {
    const m = window.__map;
    const src = m.getSource('rt-us');
    return {
      hasSource: !!src,
      rawFeatures: src?._data?.features?.length ?? null,
      queried: src ? m.querySourceFeatures('rt-us').length : null,
      layer: !!m.getLayer('rt-us'),
      visibility: m.getLayer('rt-us') ? m.getLayoutProperty('rt-us', 'visibility') : null,
      filter: m.getLayer('rt-us') ? JSON.stringify(m.getFilter('rt-us')) : null,
      loaded: src ? m.isSourceLoaded('rt-us') : null,
      zoom: Math.round(m.getZoom() * 10) / 10,
      center: m.getCenter().toArray().map((v) => Math.round(v * 10) / 10),
      rendered: src ? m.queryRenderedFeatures({ layers: ['rt-us'] }).length : null,
    };
  });
  console.log(` t+${wait}ms`, JSON.stringify(r));
}

console.log('\n-- terrain double-toggle --');
await page.click('#btnTerrain');
await page.waitForTimeout(3000);
console.log(' pitch after on:', await page.evaluate(() => Math.round(window.__map.getPitch())));
try {
  await page.click('#btnTerrain', { timeout: 8000 });
  await page.waitForTimeout(1500);
  console.log(' pitch after off:', await page.evaluate(() => Math.round(window.__map.getPitch())));
} catch (e) {
  console.log(' second click FAILED:', e.message.split('\n')[0]);
  const blocker = await page.evaluate(() => {
    const b = document.getElementById('btnTerrain').getBoundingClientRect();
    const el = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    return el ? `${el.tagName}#${el.id}.${el.className}` : 'none';
  });
  console.log(' element at button centre:', blocker);
}

await browser.close();
server.kill();
