/**
 * The two images the README shows, captured against the running site.
 *
 * Unlike `tools/shots/`, which is scratch and gitignored, these are committed:
 * a README for a map with no map on it is asking to be taken on trust. They are
 * shot at 2x and downscaled by the browser's own device pixel ratio so the
 * hairline strokes and 10px mono labels survive GitHub's rendering, and at 16:9
 * so the banner does not push the badges off a laptop screen.
 *
 * Re-run after any visible change to the chrome:
 *   node tools/serve.mjs &  node tools/shoot-hero.mjs
 */
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://localhost:8787';
const OUT = join(import.meta.dirname, '..', 'docs', 'img');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 810 },
  deviceScaleFactor: 2,
});
const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`) });

await page.goto(BASE, { waitUntil: 'networkidle' });
// The boot splash fades, two systems stream in, and the map settles. Rushing
// this catches the atlas mid-draw, which looks like a bug rather than a map.
await page.waitForTimeout(9000);

// The hero is the continent with the Interstates on it - the thing the site is
// for - rather than a menu or a panel.
await shot('hero');
console.log('wrote docs/img/hero.png');

// The second image is the other half of the claim: that every road has a page.
// I-95 because it is the longest north-south Interstate and its dossier is one
// of the fuller ones, so the panel is showing real content and not placeholders.
await page.fill('#q', 'I-95');
await page.waitForTimeout(1200);
await page.locator('#results .res').first().click();
await page.waitForSelector('#detail:not(.hidden)', { timeout: 20000 });
await page.waitForTimeout(4500);
await shot('detail');
console.log('wrote docs/img/detail.png');

await browser.close();
