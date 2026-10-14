/**
 * The base-map previews on the Layers menu, captured against the running site
 * so each card shows what choosing it will do.
 *
 * Committed, like the README images: they are part of the interface. Every
 * preview is the same stretch of map, so the difference between the cards is
 * the ground and nothing else. The Bay Area and the Sierra because the bay,
 * the Central Valley and the mountains all fit in one small frame.
 *
 * The plain and relief grounds follow the theme, so those two are shot in
 * each (the light ones as base-*-light.jpg); imagery is the same in both.
 *
 * Re-run after any change to the base maps or the road colours:
 *   node tools/serve.mjs &  node tools/shoot-bases.mjs
 */
import { chromium } from 'playwright-core';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://localhost:8787';
const OUT = join(import.meta.dirname, '..', 'assets');
const W = 192;
const H = 120;

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });

for (const theme of ['dark', 'light']) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 });
  await page.addInitScript((th) => localStorage.setItem('ia.theme', th), theme);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 30000 });
  await page.waitForTimeout(6000);
  await page.evaluate(() => window.__map.jumpTo({ center: [-120.9, 38.3], zoom: 5.8 }));

  const modes = theme === 'light' ? ['dark', 'relief'] : ['dark', 'relief', 'satellite'];
  for (const mode of modes) {
    await page.keyboard.press('l');
    await page.click(`#basemap [data-base="${mode}"]`);
    await page.keyboard.press('Escape');
    await page.keyboard.press('z');
    await page.waitForTimeout(500);
    await page.waitForFunction(() => window.__map.areTilesLoaded(), null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    const file = `base-${mode}${theme === 'light' ? '-light' : ''}.jpg`;
    await page.screenshot({
      path: join(OUT, file), type: 'jpeg', quality: 82,
      clip: { x: 600 - W / 2, y: 400 - H / 2, width: W, height: H },
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    console.log(`wrote assets/${file}`);
  }
  await page.close();
}

await browser.close();
