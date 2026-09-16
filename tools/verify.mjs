// Drives the site in a headless browser, reports console errors and failed
// requests, and writes screenshots to tools/shots/.
//
//   node tools/verify.mjs [baseUrl]

import { chromium } from 'playwright-core';
import { mkdir, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://localhost:8787';
const ROOT = join(import.meta.dirname, '..');
const SHOTS = join(import.meta.dirname, 'shots');
await mkdir(SHOTS, { recursive: true });

// Pick, from the build output, an Interstate that carries an official cost but
// no hand-written dossier. Chosen here rather than in the page so the search
// does not fill the console with the 404s it probes for.
const NO_DOSSIER_COSTED = await (async () => {
  const fc = JSON.parse(await readFile(join(ROOT, 'data', 'geo', 'interstate.json'), 'utf8'));
  for (const f of fc.features) {
    if (!f.properties.offCostK) continue;
    try {
      await access(join(ROOT, 'data', 'dossiers', `${f.properties.id}.json`));
    } catch {
      return f.properties.id;
    }
  }
  return null;
})();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1 });

const errors = [];
const failed = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => {
  // The map cancels in-flight tile requests whenever the camera moves, which
  // surfaces as ERR_ABORTED. That is normal behaviour, not a failure.
  const err = r.failure()?.errorText || '';
  if (err.includes('ERR_ABORTED')) return;
  failed.push(`${err} ${r.url().slice(0, 120)}`);
});
page.on('response', (r) => {
  // Nothing should 404 any more: both the dossiers and the elevation profiles
  // exist for a curated subset, and both are gated on a manifest so a route
  // without one is never requested.
  if (r.status() >= 400) {
    failed.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`);
  }
});

let failures = 0;
const step = async (name, fn) => {
  process.stdout.write(`${name.padEnd(46)}`);
  try {
    await fn();
    console.log('ok');
  } catch (e) {
    failures++;
    console.log(`FAIL — ${e.message.split('\n')[0]}`);
  }
};

/**
 * Wait until a route source has been fetched, parsed and handed to the map.
 *
 * The assertion is on the source's own data rather than on tiled output.
 * `querySourceFeatures` only sees tiles that have been built for the current
 * camera, so it reports zero both when loading genuinely failed and when the
 * map simply has not repainted yet — and with no GPU here, repaints come when
 * they come. Checking the parsed feature count tests the thing that can
 * actually break (fetch, parse, addSource) and leaves rendering to the
 * screenshots.
 */
const waitForSource = async (srcId, timeout = 25000) => {
  const deadline = Date.now() + timeout;
  let seen = 'not created';
  while (Date.now() < deadline) {
    const r = await page.evaluate((id) => {
      const m = window.__map;
      const src = m?.getSource(id);
      if (!src) return null;
      return {
        raw: src._data?.features?.length ?? 0,
        layer: !!m.getLayer(id),
        visible: m.getLayer(id) ? m.getLayoutProperty(id, 'visibility') !== 'none' : false,
      };
    }, srcId);
    if (r) {
      seen = JSON.stringify(r);
      if (r.raw > 0 && r.layer && r.visible) return r.raw;
    }
    await page.waitForTimeout(300);
  }
  throw new Error(`source ${srcId} not usable: ${seen}`);
};

// Screenshots are diagnostics, not assertions. Terrain renders in software
// here and can outrun any sensible timeout; losing a picture should not be
// reported as a broken page.
const shot = async (name) => {
  try {
    await page.screenshot({ path: join(SHOTS, name), timeout: 25000 });
  } catch {
    console.log(`  (screenshot ${name} timed out)`);
  }
};

await step('load page', async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
});

await step('boot completes', async () => {
  await page.waitForSelector('#boot.done', { timeout: 45000 });
});

await step('interstates rendered', async () => {
  const n = await page.evaluate(() => {
    const m = window.__map;
    return m ? m.querySourceFeatures('rt-interstate').length : -1;
  });
  if (n === -1) throw new Error('map not exposed');
  if (n === 0) throw new Error('no interstate features rendered');
});

await step('results list populated', async () => {
  await page.waitForSelector('#results .res', { timeout: 15000 });
  const n = await page.locator('#results .res').count();
  if (n < 10) throw new Error(`only ${n} results`);
});

await page.waitForTimeout(2500);
await shot('01-overview.png');

await step('select I-95 via search', async () => {
  await page.fill('#q', 'I-95');
  await page.waitForTimeout(400);
  await page.locator('#results .res').first().click();
  await page.waitForSelector('#detail:not(.hidden)', { timeout: 10000 });
  await page.waitForTimeout(2600);
  const title = await page.locator('.dt-name').textContent();
  if (!title.includes('95')) throw new Error(`unexpected title: ${title}`);
});
await shot('02-detail.png');

await step('detail metrics present', async () => {
  const vals = await page.locator('.mgrid .m-v').allTextContents();
  if (vals.length < 6) throw new Error(`only ${vals.length} metrics`);
  if (vals.every((v) => v.trim() === '—')) throw new Error('all metrics empty');
});

await step('termini shown', async () => {
  const terms = await page.locator('.term-v').allTextContents();
  if (terms.length < 2) throw new Error('missing termini');
  if (terms.some((x) => !x.trim() || x.trim() === '—')) throw new Error(`blank terminus: ${JSON.stringify(terms)}`);
});

await step('official construction cost shown', async () => {
  const cost = page.locator('.fig').filter({ hasText: 'Interstate Construction cost' }).first();
  if (!(await cost.count())) {
    const figs = await page.locator('.fig-k').allTextContents();
    throw new Error(`no cost figure among: ${JSON.stringify(figs)}`);
  }
  // A figure is worthless without a source and a legible magnitude.
  const value = (await cost.locator('.fig-v').first().textContent())?.trim() || '';
  if (!/\$[\d,.]+\s(billion|million)/.test(value)) throw new Error(`malformed cost: ${value}`);
  if (!value.includes('FHWA')) throw new Error(`cost figure is unsourced: ${value}`);
});

await step('cost reaches routes with no dossier', async () => {
  // The point of deriving cost from the route table is that it covers roads
  // nobody hand-wrote. Confirm the money section appears for one of those.
  if (!NO_DOSSIER_COSTED) throw new Error('every costed route has a dossier; nothing to check');
  await page.evaluate((rid) => window.__select(rid), NO_DOSSIER_COSTED);
  await page.waitForSelector('#detail:not(.hidden)', { timeout: 10000 });
  await page.waitForFunction(
    (rid) => document.querySelector('#detail')?.dataset.id === rid
      || document.querySelector('.dt-name'),
    NO_DOSSIER_COSTED,
    { timeout: 8000 },
  );
  await page.waitForTimeout(1200);
  const cost = page.locator('.fig').filter({ hasText: 'Interstate Construction cost' });
  if (!(await cost.count())) {
    throw new Error(`${NO_DOSSIER_COSTED} has cost data but shows no cost figure`);
  }
});

await step('numbering explainer', async () => {
  await page.click('#btnNumbering');
  await page.waitForSelector('#sheet:not(.hidden)', { timeout: 8000 });
  await page.waitForTimeout(700);
  const lines = await page.locator('.nb-route[data-id]').count();
  if (lines < 8) throw new Error(`only ${lines} grid lines drawn`);
});
await shot('03-numbering.png');

await step('dashboard', async () => {
  await page.click('#shClose');
  await page.click('#btnDash');
  await page.waitForSelector('.dash-top', { timeout: 8000 });
  await page.waitForTimeout(600);
  const v = await page.locator('.dash-top .m-v').first().textContent();
  if (!/\d/.test(v)) throw new Error(`no total miles: ${v}`);
});
await shot('04-dashboard.png');

await step('timeline opens', async () => {
  await page.click('#shClose');
  await page.click('#btnTimeline');
  await page.waitForSelector('#tlBody', { timeout: 8000 });
  await page.waitForTimeout(600);
});
await shot('05-timeline.png');

await step('command palette', async () => {
  await page.click('#shClose');
  await page.keyboard.press('/');
  await page.waitForSelector('#palette:not(.hidden)', { timeout: 6000 });
  await page.fill('#palQ', 'US 66');
  await page.waitForTimeout(400);
  const n = await page.locator('.pal-it').count();
  if (n < 1) throw new Error('palette empty');
  await page.keyboard.press('Escape');
});

await step('US routes layer toggles on', async () => {
  await page.click('.sys[data-sys="us"]');
  await waitForSource('rt-us');
});
await shot('06-us-routes.png');

await step('language switch to Chinese', async () => {
  await page.click('#btnLang');
  await page.waitForTimeout(900);
  const brand = await page.locator('.brand-name').textContent();
  if (!/[\u4e00-\u9fff]/.test(brand)) throw new Error(`brand not translated: ${brand}`);
  const leftover = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll('#hud, #shell, #detail')) {
      const txt = el.innerText || '';
      for (const w of ['Search', 'Numbering', 'Statistics', 'Route systems', 'Results']) {
        if (txt.includes(w)) bad.push(w);
      }
    }
    return bad;
  });
  if (leftover.length) throw new Error(`untranslated: ${leftover.join(', ')}`);
});
await shot('07-chinese.png');

await step('flythrough runs', async () => {
  await page.click('#btnLang'); // back to English
  await page.waitForTimeout(500);
  await page.fill('#q', 'I-70');
  await page.waitForTimeout(400);
  await page.locator('#results .res').first().click();
  await page.waitForSelector('#detail:not(.hidden)');
  await page.waitForTimeout(2200);
  await page.click('#dtFly');
  await page.waitForSelector('#fly.on', { timeout: 8000 });
  await page.waitForTimeout(4200);
  const mile = await page.locator('#flyMile').textContent();
  if (!Number(mile.replace(/[^\d]/g, ''))) throw new Error(`flythrough did not advance: ${mile}`);
});
await shot('08-flythrough.png');

// Terrain is deliberately exercised last of the map features: with no GPU in
// this environment the DEM renders in software, which slows everything after
// it down. Both toggles go through the element's own click handler rather than
// a synthetic mouse event, because Playwright's actionability check can sit
// waiting on a main thread that terrain has saturated.
const jsClick = (sel) => page.$eval(sel, (el) => el.click());

await step('terrain toggles', async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await jsClick('#btnTerrain');
  await page.waitForFunction(() => window.__map.getPitch() > 20, null, { timeout: 20000 });
});
await shot('09-terrain.png');

await step('terrain toggles back off', async () => {
  await jsClick('#btnTerrain');
  await page.waitForFunction(() => window.__map.getPitch() < 5, null, { timeout: 20000 });
});

await step('state routes load', async () => {
  await page.click('.sys[data-sys="state"]');
  await page.waitForSelector('[data-load="CA"]', { timeout: 10000 });
  await page.click('[data-load="CA"]');
  await waitForSource('st-CA');
});
await shot('10-state-routes.png');

await step('route markers never clip their number', async () => {
  // Three-digit state routes are the case a fixed-width shield could not hold.
  await page.fill('#q', '200');
  await page.waitForTimeout(600);
  const bad = await page.evaluate(() => [...document.querySelectorAll('.shield')]
    .filter((s) => s.scrollWidth > Math.ceil(s.getBoundingClientRect().width) + 1)
    .map((s) => s.textContent));
  if (bad.length) throw new Error(`clipped: ${JSON.stringify(bad.slice(0, 6))}`);
  const n = await page.locator('.shield').count();
  if (!n) throw new Error('no markers rendered for a three-digit search');
  await page.fill('#q', '');
});

await step('search reaches systems that are switched off', async () => {
  // Typing a number should find it whether or not its system is drawn.
  const hits = await page.evaluate(() => {
    const off = [...document.querySelectorAll('.sys')].filter((s) => !s.classList.contains('on'));
    return off.length;
  });
  await page.fill('#q', 'US 50');
  await page.waitForTimeout(600);
  const rows = await page.locator('#results .res').count();
  await page.fill('#q', '');
  if (!rows) throw new Error(`no results for "US 50" with ${hits} system(s) switched off`);
});

await step('collapsed panel can be reopened', async () => {
  await page.click('#btnCollapse');
  await page.waitForTimeout(700);
  if (!(await page.locator('#shellOpen').isVisible())) {
    throw new Error('panel collapsed with no control left to reopen it');
  }
  await page.click('#shellOpen');
  await page.waitForTimeout(700);
  if (await page.locator('#shell').evaluate((e) => e.classList.contains('hidden'))) {
    throw new Error('panel did not come back');
  }
});

await step('base maps switch', async () => {
  for (const mode of ['relief', 'satellite', 'dark']) {
    await page.click(`[data-base="${mode}"]`);
    await page.waitForTimeout(900);
    const on = await page.evaluate(() => document.querySelector('#basemap .seg-b.on')?.dataset.base);
    if (on !== mode) throw new Error(`asked for ${mode}, got ${on}`);
    const ok = await page.evaluate((m) => {
      const map = window.__map;
      if (m === 'satellite') return map.getLayer('sat') && map.getPaintProperty('sat', 'raster-opacity') === 1;
      if (m === 'relief') return map.getLayer('hillshade')
        && map.getLayoutProperty('hillshade', 'visibility') !== 'none';
      return true;
    }, mode);
    if (!ok) throw new Error(`${mode} selected but its layer is not live`);
  }
});
await shot('11-relief.png');

await step('region jump brings Alaska and its routes', async () => {
  await page.click('[data-jump="ak"]');
  await page.waitForTimeout(3800);
  const { lat, feats } = await page.evaluate(() => ({
    lat: window.__map.getCenter().lat,
    feats: (window.__map.getSource('st-AK')?._data.features || []).length,
  }));
  if (lat < 55) throw new Error(`jump did not reach Alaska (lat ${Math.round(lat)})`);
  if (!feats) throw new Error('reached Alaska with no Alaska routes loaded');
});
await shot('12-alaska.png');

await step('Alaska has its four unsigned Interstates', async () => {
  // Alaska's Interstates carry no shields, so they cannot be read out of the
  // geometry and are declared instead. If that declaration stops being
  // applied, Alaska silently goes back to looking like it has no Interstates.
  const found = await page.evaluate(() => (window.__map.getSource('rt-interstate')?._data.features || [])
    .filter((f) => f.properties.label?.startsWith('A-'))
    .map((f) => f.properties.label).sort());
  const want = ['A-1', 'A-2', 'A-3', 'A-4'];
  if (want.some((w) => !found.includes(w))) {
    throw new Error(`expected ${want.join(' ')}, found ${found.join(' ') || 'none'}`);
  }
});

await step('Trans-Canada draws by default', async () => {
  await page.click('[data-jump="ca"]');
  await page.waitForTimeout(2600);
  const n = await waitForSource('rt-tch');
  if (n < 5) throw new Error(`only ${n} Trans-Canada routes`);
});
await shot('13-canada.png');

await step('a Canadian route reads with Canadian metrics', async () => {
  await page.fill('#q', 'TCH 1');
  await page.waitForTimeout(700);
  await page.locator('#results .res').first().click();
  await page.waitForSelector('#detail:not(.hidden)', { timeout: 10000 });
  await page.waitForTimeout(2200);
  const keys = await page.locator('.mgrid .m-k').allTextContents();
  // Canada publishes lanes and posted speeds and has no toll attribute at all,
  // so the panel must not be showing the American metric set.
  if (!keys.some((k) => /lanes/i.test(k))) throw new Error(`no lane metric among ${JSON.stringify(keys)}`);
  if (keys.some((k) => /tolled/i.test(k))) throw new Error('showing a tolled share Canada does not publish');
  const facts = await page.locator('.ca-facts .fig-k').allTextContents();
  if (!facts.length) throw new Error('no Canadian designation facts shown');
});
await shot('14-canada-detail.png');

await step('provincial highways load by province', async () => {
  await page.keyboard.press('Escape');
  await page.click('.sys[data-sys="provincial"]');
  await page.waitForSelector('[data-load="ON"]', { timeout: 10000 });
  await page.click('[data-load="ON"]');
  await waitForSource('st-ON');
});
await shot('15-ontario.png');

console.log(`\nsteps failed:    ${failures}`);
console.log(`console errors:  ${errors.length}`);
for (const e of [...new Set(errors)].slice(0, 25)) console.log(`  ! ${e.slice(0, 300)}`);
console.log(`failed requests: ${failed.length}`);
for (const f of [...new Set(failed)].slice(0, 25)) console.log(`  ! ${f}`);

await browser.close();
process.exit(failures || errors.length || failed.length ? 1 : 0);
