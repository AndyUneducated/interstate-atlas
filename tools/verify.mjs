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
  const fc = JSON.parse(await readFile(join(ROOT, 'data', 'geo', 'us', 'interstate.json'), 'utf8'));
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

// PW_CHANNEL=chrome uses the installed browser where Playwright's own is absent.
const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
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

// Buttons that live in the header menus are clicked through the DOM, so a
// step does not depend on the menu having been opened first.
const jsClick = (sel) => page.$eval(sel, (el) => el.click());

// The system switches live in the Layers menu and the region places under the
// region switch, so a step reaches them the way a reader would.
const sysClick = async (id) => {
  if (!await page.locator('#menuLayers.open').count()) await page.click('#btnLayers');
  await page.click(`.sys[data-sys="${id}"]`);
};
const jumpTo = async (key) => {
  if (!await page.locator('#regionWrap.open').count()) await page.click('#regionSeg .seg-b.on');
  await page.click(`[data-jump="${key}"]`);
};

await step('load page', async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
});

await step('boot completes', async () => {
  await page.waitForSelector('#boot.done', { timeout: 45000 });
});

await step('interstates rendered', async () => {
  const exposed = await page.evaluate(() => !!window.__map);
  if (!exposed) throw new Error('map not exposed');
  await waitForSource('rt-us-interstate');
});

await step('results list populated', async () => {
  await page.waitForSelector('#results .res', { state: 'attached', timeout: 15000 });
  const n = await page.locator('#results .res').count();
  if (n < 10) throw new Error(`only ${n} results`);
});

await step('the list stays folded until the search box is used', async () => {
  const shown = () => page.locator('#findDrop').isVisible();
  if (await shown()) throw new Error('results list open before anyone asked');
  await page.click('#q');
  if (!await shown()) throw new Error('focusing the search box did not open the list');
  await page.keyboard.press('Escape');
  if (await shown()) throw new Error('Escape did not fold the list');
  await page.fill('#q', 'I-80');
  if (!await shown()) throw new Error('typing did not open the list');
  await page.click('#btnLayers');
  if (await shown()) throw new Error('a click elsewhere did not fold the list');
  await page.keyboard.press('Escape');
  await page.fill('#q', '');
  await page.keyboard.press('Escape');
});

await step('nothing is parked half on the screen', async () => {
  // The flythrough panel hid itself by sliding down 140% of its own height,
  // which is only enough once it has content in it. Empty, on a fresh load, it
  // was 28px tall and the slide left a 7px strip of blank frame across the
  // bottom of the map - above the timeline, and eating drags, because it also
  // had no pointer-events guard. Anything held off-screen is checked here
  // rather than only the one that broke.
  const bad = await page.evaluate(() => {
    const out = [];
    for (const id of ['fly', 'toast', 'zenOut', 'detail', 'tlapse']) {
      const el = document.getElementById(id);
      if (!el) continue;
      const cs = getComputedStyle(el);
      const hidden = cs.display === 'none' || cs.visibility === 'hidden'
        || Number(cs.opacity) === 0;
      if (hidden) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      // On screen at all is fine; straddling an edge is what is not.
      const clipped = r.bottom > innerHeight + 0.5 || r.top < -0.5
        || r.right > innerWidth + 0.5 || r.left < -0.5;
      const onScreen = r.bottom > 0 && r.top < innerHeight;
      if (clipped && onScreen) {
        out.push(`#${id} straddles the viewport edge at `
          + `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`
          + ` (viewport ${innerWidth}x${innerHeight}, pointer-events ${cs.pointerEvents})`);
      }
    }
    return out;
  });
  if (bad.length) throw new Error(bad.join('; '));
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

await step('a freeway known by name alone', async () => {
  await page.fill('#q', 'Garden State Parkway');
  await page.waitForTimeout(400);
  const res = page.locator('#results .res').first();
  if (!(await res.locator('.shield-named').count())) throw new Error('no empty shield in the result');
  await res.click();
  await page.waitForSelector('#detail:not(.hidden)', { timeout: 10000 });
  await page.waitForTimeout(1500);
  const title = await page.locator('.dt-name').textContent();
  if (!title.includes('Garden State Parkway')) throw new Error(`unexpected title: ${title}`);
  if (!(await page.locator('.fig-k').filter({ hasText: 'No route number' }).count())) {
    throw new Error('no "no route number" note');
  }
  await page.fill('#q', 'I-95');
  await page.waitForTimeout(400);
  await page.locator('#results .res').first().click();
  await page.waitForTimeout(1500);
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
  await jsClick('#btnNumbering');
  await page.waitForSelector('#sheet:not(.hidden)', { timeout: 8000 });
  await page.waitForTimeout(700);
  const lines = await page.locator('.nb-route[data-id]').count();
  if (lines < 8) throw new Error(`only ${lines} grid lines drawn`);
});
await shot('03-numbering.png');

await step('dashboard', async () => {
  await page.click('#shClose');
  await page.click('#btnMore');
  await page.click('#btnDash');
  await page.waitForSelector('.dash-top', { timeout: 8000 });
  await page.waitForTimeout(600);
  const v = await page.locator('.dash-top .m-v').first().textContent();
  if (!/\d/.test(v)) throw new Error(`no total miles: ${v}`);
});
await shot('04-dashboard.png');

await step('dashboard charts the countries and the longest routes', async () => {
  const rows = await page.locator('.cc-row').count();
  if (rows !== 5) throw new Error(`expected a bar per country or region, got ${rows}`);
  const longest = await page.locator('.hbar-route[data-id]').count();
  if (longest < 10) throw new Error(`only ${longest} longest-route bars`);
});

await step('the More menu opens and closes', async () => {
  await page.click('#shClose');
  await page.click('#btnMore');
  await page.waitForSelector('#menuMore.open', { timeout: 4000 });
  for (const id of ['btnDash', 'btnNumbering', 'btnTimeline', 'btnPalette', 'btnDocs', 'btnAbout']) {
    if (!await page.locator(`#menuMore #${id}`).isVisible()) throw new Error(`#${id} not in the open menu`);
  }
  // Statistics leads the menu, and the menu is the last thing on the bar.
  const first = await page.evaluate(() => document.querySelector('#menuMore .menu-it')?.id);
  if (first !== 'btnDash') throw new Error(`the More menu starts with #${first}, not Statistics`);
  const last = await page.evaluate(() => document.querySelector('#hud .hud-group:last-child > :last-child')?.id);
  if (last !== 'menuMore') throw new Error(`#${last} sits right of the More menu`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  if (await page.locator('#menuMore.open').count()) throw new Error('Escape left the menu open');
});

await step('data and sources page renders every tab', async () => {
  await page.click('#btnMore');
  await page.click('#btnDocs');
  await page.waitForSelector('.cov-row', { timeout: 8000 });
  // Coverage is the default tab: a bar per system, including the Trans-Canada.
  const bars = await page.locator('.cov-bar').count();
  if (bars < 6) throw new Error(`only ${bars} coverage bars`);
  if (await page.locator('#menuMore.open').count()) throw new Error('menu stayed open behind the page');
  for (const [tab, min] of [['sources', 5], ['decisions', 40], ['issues', 1], ['accuracy', 5]]) {
    await page.click(`[data-dc="${tab}"]`);
    await page.waitForTimeout(150);
    const n = await page.locator('#dcBody .dc-card, #dcBody .dc-tbl tbody tr').count();
    if (n < min) throw new Error(`${tab}: ${n} entries, expected at least ${min}`);
  }
  // The filter narrows the decision log rather than only being drawn.
  await page.click('[data-dc="decisions"]');
  await page.fill('#dcQ', 'correctMileage');
  await page.waitForTimeout(150);
  const shown = await page.locator('#dcBody .dc-card:not([hidden])').count();
  if (shown !== 1) throw new Error(`filtering for correctMileage shows ${shown} cards, expected D-53 alone`);
});
await shot('04b-docs.png');

await step('each documents tab leads with its views, and the decision map filters the log', async () => {
  for (const [tab, sels] of [
    ['coverage', ['.dv-heat td', '.dv .hbar-route']],
    ['sources', ['.dv-fr', '.dv-sankey path', '.dv-x .stack i']],
    ['decisions', ['.dv-stage', '.dv-cell', '.dv-arcs path']],
    ['accuracy', ['.dv-gk i']],
  ]) {
    await page.click(`[data-dc="${tab}"]`);
    await page.waitForTimeout(150);
    for (const sel of sels) if (!await page.locator(`#dcBody ${sel}`).count()) throw new Error(`${tab}: no ${sel}`);
  }
  // Escape the earlier word filter, then let the Stitch stage pick the cards.
  await page.click('[data-dc="decisions"]');
  const all = await page.locator('#dcBody .dc-card:not([hidden])').count();
  await page.click('.dv-stage[data-stage="stitch"]');
  await page.waitForTimeout(200);
  const want = Number(await page.locator('.dv-stage[data-stage="stitch"] b').textContent());
  const shown = await page.locator('#dcBody .dc-card:not([hidden])').count();
  if (shown !== want || shown >= all) throw new Error(`the Stitch stage shows ${shown} of ${all} decisions, its tile says ${want}`);
  await page.click('#dvClear');
  if (await page.locator('#dcBody .dc-card:not([hidden])').count() !== all) throw new Error('Show all did not restore the log');
});

await step('the header buttons are icons that name themselves', async () => {
  for (const id of ['btnLayers', 'btnSettings', 'btnMore']) {
    const b = await page.evaluate((i) => {
      const el = document.getElementById(i);
      return { text: el.textContent.trim(), tip: el.dataset.tip, label: el.getAttribute('aria-label'), w: el.getBoundingClientRect().width };
    }, id);
    if (b.text || b.w > 36) throw new Error(`#${id} still carries text (${b.text}, ${b.w}px)`);
    if (!b.tip || b.tip !== b.label) throw new Error(`#${id} has no tooltip name`);
  }
});

await step('the Layers menu holds the base maps, the overlays and the tilt', async () => {
  await page.click('#shClose');
  await page.keyboard.press('l');
  await page.waitForSelector('#menuLayers.open', { timeout: 4000 });
  for (const sel of ['#basemap', '#btnCrossings', '#btnTolls', '#btnBridges', '#btnTerrain']) {
    if (!await page.locator(`#menuLayers ${sel}`).isVisible()) throw new Error(`${sel} not in the open Layers menu`);
  }
  if (await page.locator('#basemap img').count() !== 3) throw new Error('the base maps are not three previews');
  await page.waitForFunction(() => [...document.querySelectorAll('#menuLayers [data-count]')].every((e) => /\d/.test(e.textContent)), null, { timeout: 4000 });
  await page.mouse.click(400, 500);
  await page.waitForTimeout(200);
  if (await page.locator('#menuLayers.open').count()) throw new Error('clicking away left the Layers menu open');
});

await step('the settings menu holds units, language, panels, the colour key and zen', async () => {
  await page.keyboard.press('s');
  await page.waitForSelector('#menuSettings.open', { timeout: 4000 });
  for (const sel of ['#unitSeg', '#langSeg', '#themeSeg', '#btnLegend', '#btnZen']) {
    if (!await page.locator(`#menuSettings ${sel}`).isVisible()) throw new Error(`${sel} not in the open settings menu`);
  }
  // The light panels turn the panel over and leave the map alone.
  await page.click('#themeSeg [data-theme="light"]');
  await page.waitForTimeout(300);
  const light = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    panel: getComputedStyle(document.getElementById('shell')).backgroundColor,
  }));
  if (light.theme !== 'light' || !/2[34]\d, 2[34]\d, 2[45]\d/.test(light.panel)) {
    throw new Error(`light panels did not apply: ${JSON.stringify(light)}`);
  }
  await page.click('#themeSeg [data-theme="dark"]');
  await page.keyboard.press('Escape');
});

// Closing whatever sheet the previous step opened. Not every step leaves one
// open, and a step must not fail because the thing it is tidying up after is
// already tidy.
const dismissSheet = async () => {
  const close = page.locator('#shClose');
  if (await close.count()) await close.click().catch(() => {});
};

await step('buildout scrubber opens and scrubs', async () => {
  await dismissSheet();
  await jsClick('#btnTimeline');
  await page.waitForSelector('#tlapse .tlx-year', { timeout: 8000 });
  await page.waitForTimeout(500);

  // Scrubbing has to move the year and the mileage with it, not just the
  // slider: the curve, the headline figure and the map filter are all driven
  // off the same value and a break between them would be invisible otherwise.
  const before = await page.locator('#tlapse .tlx-year').textContent();
  await page.locator('#tlxRange').fill('1975');
  await page.waitForTimeout(700);
  const after = await page.locator('#tlapse .tlx-year').textContent();
  if (after !== '1975') throw new Error(`year reads ${after} after scrubbing to 1975`);
  if (before === after) throw new Error('year did not move');
  const open = await page.locator('#tlapse .tlx-v').first().textContent();
  if (!/\d/.test(open)) throw new Error(`no mileage figure at 1975: ${open}`);

  // The early years light up almost nothing - 1961 has one documented route -
  // so the present-day network is drawn faintly underneath to place them. If
  // that layer stops being added, the view still works and silently becomes a
  // black rectangle in every year before about 1970.
  const ghost = await page.evaluate(() => {
    const m = window.__map;
    return m.getLayer('tl-ghost') ? (m.getLayoutProperty('tl-ghost', 'visibility') ?? 'visible') : null;
  });
  if (ghost === 'none') throw new Error('ghost network hidden while the scrubber is open');
  if (ghost === null) throw new Error('ghost network layer missing');
});
await shot('05-timeline.png');

await step('buildout scrubber closes', async () => {
  await page.click('#tlxClose');
  await page.waitForTimeout(400);
  if (await page.locator('#tlapse .tlx-year').count()) throw new Error('scrubber still up');
  // Leaving the ghost behind would dim the whole Interstate layer for the rest
  // of the session, which reads as a rendering fault rather than as a leftover.
  const ghost = await page.evaluate(() => (window.__map.getLayer('tl-ghost')
    ? window.__map.getLayoutProperty('tl-ghost', 'visibility') : 'none'));
  if (ghost !== 'none') throw new Error('ghost network still drawn after closing');
});

await step('command palette', async () => {
  await dismissSheet();
  await page.keyboard.press('/');
  await page.waitForSelector('#palette:not(.hidden)', { timeout: 6000 });
  await page.fill('#palQ', 'US 66');
  await page.waitForTimeout(400);
  const n = await page.locator('.pal-it').count();
  if (n < 1) throw new Error('palette empty');
  await page.keyboard.press('Escape');
});

await step('US routes layer toggles on', async () => {
  await sysClick('us-numbered');
  await waitForSource('rt-us-numbered');
  await page.keyboard.press('Escape');
});
await shot('06-us-routes.png');

await step('language switch to Chinese', async () => {
  await page.click('#btnSettings');
  await page.click('#langSeg [data-lang="zh"]');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  const region = await page.locator('#regionSeg [data-region="na"]').textContent();
  if (!/[\u4e00-\u9fff]/.test(region)) throw new Error(`region switch not translated: ${region}`);
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
  await page.click('#btnSettings'); // back to English
  await page.click('#langSeg [data-lang="en"]');
  await page.keyboard.press('Escape');
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
  await sysClick('us-state');
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

await step('choosing a result folds the list out of the way', async () => {
  await page.fill('#q', 'I-40');
  await page.waitForTimeout(500);
  await page.locator('#results .res').first().click();
  await page.waitForSelector('#detail:not(.hidden)', { timeout: 10000 });
  if (await page.locator('#findDrop').isVisible()) throw new Error('list still open over the map');
  // The query is kept, so going back to the box finds the same list.
  if (await page.inputValue('#q') !== 'I-40') throw new Error('choosing a result cleared the query');
  await page.keyboard.press('Escape');
  await page.fill('#q', '');
  await page.keyboard.press('Escape');
});

await step('base maps switch', async () => {
  if (!await page.locator('#menuLayers.open').count()) await page.click('#btnLayers');
  for (const mode of ['relief', 'satellite', 'dark']) {
    await page.click(`[data-base="${mode}"]`);
    await page.waitForTimeout(900);
    const on = await page.evaluate(() => document.querySelector('#basemap .bcard.on')?.dataset.base);
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
  await page.keyboard.press('Escape');
});
await shot('11-relief.png');

await step('region jump brings Alaska and its routes', async () => {
  await jumpTo('ak');
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
  const found = await page.evaluate(() => (window.__map.getSource('rt-us-interstate')?._data.features || [])
    .filter((f) => f.properties.label?.startsWith('A-'))
    .map((f) => f.properties.label).sort());
  const want = ['A-1', 'A-2', 'A-3', 'A-4'];
  if (want.some((w) => !found.includes(w))) {
    throw new Error(`expected ${want.join(' ')}, found ${found.join(' ') || 'none'}`);
  }
});

await step('a US route shows what the states measured', async () => {
  // These come from HPMS rather than from the geometry, and they are joined by
  // designation. A parser change on either side breaks the join silently: the
  // panel keeps working and simply stops saying anything about traffic.
  await dismissSheet();
  await page.fill('#q', 'I-95');
  await page.waitForTimeout(700);
  await page.locator('#results .res').first().click();
  await page.waitForSelector('#detail:not(.hidden)', { timeout: 10000 });
  await page.waitForTimeout(1200);
  const keys = await page.locator('.fig-box .fig-k').allTextContents();
  for (const want of [/traffic/i, /pavement/i]) {
    if (!keys.some((k) => want.test(k))) {
      throw new Error(`no ${want} row among ${JSON.stringify(keys)}`);
    }
  }
  const lanes = await page.locator('.mgrid .m-k').allTextContents();
  if (!lanes.some((k) => /lanes/i.test(k))) throw new Error('no lane count on a US route');
});

await step('Trans-Canada draws by default', async () => {
  await jumpTo('ca');
  await page.waitForTimeout(2600);
  const n = await waitForSource('rt-ca-tch');
  if (n < 5) throw new Error(`only ${n} Trans-Canada routes`);
  // The Yellowhead is the northern Trans-Canada through BC; the national file
  // never names it so, and it went missing for exactly that reason.
  const yellowhead = await page.evaluate(() => window.__map.querySourceFeatures('rt-ca-tch')
    .some((f) => f.properties.st === 'BC' && String(f.properties.num ?? f.properties.number) === '16'));
  if (!yellowhead) throw new Error('BC 16 (Yellowhead) is not drawn as Trans-Canada');
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
  await sysClick('ca-provincial');
  await page.waitForSelector('[data-load="ON"]', { timeout: 10000 });
  await page.click('[data-load="ON"]');
  await waitForSource('st-ON');
});
await shot('15-ontario.png');

await step('a route in a publishing province carries traffic', async () => {
  // Five of thirteen jurisdictions publish counts, each read out of a field
  // that was not designed to be read that way - Quebec's route number out of a
  // linear reference, Alberta's out of a column that shifts position, New
  // Brunswick's out of a control-section key. Any of those feeds can change
  // shape without warning, and the failure mode is silent: the join produces
  // nothing and the panel simply stops showing a block that used to be there.
  // Highway 401 is the check because it is the busiest road in the country and
  // Ontario has published its volume every year for three decades.
  await page.keyboard.press('Escape');
  await page.fill('#q', 'ON 401');
  await page.waitForTimeout(700);
  await page.locator('#results .res').first().click();
  await page.waitForSelector('#detail:not(.hidden)', { timeout: 10000 });
  await page.waitForTimeout(2200);

  const box = page.locator('.fig-box', { hasText: /province measures/i });
  if (!await box.count()) throw new Error('no provincial traffic block on Ontario 401');
  const text = await box.first().textContent();

  // Read the traffic row itself rather than the block, whose subtitle carries
  // the count year and would otherwise pass for a volume.
  const row = box.first().locator('.fig', { has: page.locator('.fig-k') })
    .filter({ hasText: /traffic|车流/i }).first();
  if (!await row.count()) throw new Error(`no traffic row in the block: ${text.slice(0, 200)}`);
  const value = await row.locator('.fig-v').textContent();
  const aadt = Number((/([\d,]{5,})/.exec(value)?.[1] ?? '').replace(/,/g, ''));
  if (!aadt) throw new Error(`no traffic figure on the 401: ${value}`);
    // The 401 carried 73,700 a day averaged over its length at the last build, so
    // anything under ten thousand means the join has broken rather than moved.
    if (aadt < 10000) throw new Error(`implausible AADT on the 401: ${aadt}`);

    // The average is a figure about 828 km of road, most of it rural, and on its
    // own it makes the busiest highway in North America look ordinary. The peak
    // is what the road is known for - 511,400 through Toronto at the 2024 count -
    // and it comes from a different column of the ministry's file, so it can drop
    // out while the average stays put.
    const peak = Math.max(...[...value.matchAll(/([\d,]{5,})/g)]
      .map((m) => Number(m[1].replace(/,/g, ''))));
    if (!peak || peak < aadt * 2) {
      throw new Error(`no busiest-point volume beside the 401's average: ${value}`);
    }
  // The licence has to travel with the figure; Ontario's is the one that is
  // unstated, and dropping that caveat is the quiet failure worth catching.
  if (!/licence|Ministry of Transportation/i.test(text)) {
    throw new Error('traffic figure shown without naming its source');
  }
});
await shot('16-ontario-401-traffic.png');

await step('the length is the headline, not one tile of six', async () => {
  // The panel's six equal tiles were levelled so that how long the road is sat
  // in the same box as its tolled share. If the hero disappears the page has
  // silently gone back to that, and the grid would also be left with five
  // tiles in a layout built for six.
  await page.keyboard.press('Escape');
  await page.fill('#q', 'I-90');
  await page.waitForTimeout(700);
  await page.locator('#results .res').first().click();
  await page.waitForSelector('#detail:not(.hidden)', { timeout: 10000 });
  await page.waitForTimeout(1600);

  const hero = page.locator('#detail .mhero').first();
  if (!await hero.count()) throw new Error('no headline length on the detail panel');
  const mi = Number(((await hero.locator('.mhero-v').textContent()) || '')
    .replace(/[^\d]/g, ''));
  // I-90 is the longest Interstate, 3,020 miles by the Route Log.
  if (!(mi > 2500 && mi < 3500)) throw new Error(`implausible headline length: ${mi}`);
  // Kilometres beside it, because half this atlas is signed in them.
  if (!/km/.test(await hero.locator('.mhero-s').textContent())) {
    throw new Error('headline length gives no kilometres');
  }
  // The hero has to be visibly bigger than the tiles or it is not a hierarchy.
  const sizes = await page.evaluate(() => [
    parseFloat(getComputedStyle(document.querySelector('#detail .mhero-v')).fontSize),
    parseFloat(getComputedStyle(document.querySelector('#detail .m-v')).fontSize),
  ]);
  if (!(sizes[0] > sizes[1] * 1.4)) {
    throw new Error(`headline not dominant: ${sizes[0]}px vs ${sizes[1]}px`);
  }
  // Five tiles over two rows of a six-column track; a sixth would mean the
  // length got put back into the grid as well as above it. Scoped to the first
  // grid, because the elevation block further down the panel is another one.
  const tiles = await page.locator('#detail .mgrid').first().locator('.m').count();
  if (tiles !== 5) throw new Error(`expected 5 tiles beside the headline, got ${tiles}`);
});

await step('the unit switch converts, and switches back', async () => {
  // I-90 is still open from the step above. The headline is the thing a
  // reader checks first, so it is the thing that has to follow the switch.
  const read = async () => Number(((await page.locator('#detail .mhero-v').textContent()) || '')
    .replace(/[^\d]/g, ''));
  const before = await read();
  const flip = async () => {
    await page.click('#btnSettings');
    await page.click('#unitSeg .seg-b:not(.on)');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(900);
  };
  await flip();
  const after = await read();
  const ratio = after / before;
  // Whichever way it went, the two readings are a mile and a kilometre apart.
  if (!(Math.abs(ratio - 1.609) < 0.01 || Math.abs(ratio - 1 / 1.609) < 0.01)) {
    throw new Error(`headline went ${before} -> ${after}, not a unit conversion`);
  }
  const col = (await page.locator('#resColMi').textContent()).trim();
  await flip();
  if (await read() !== before) throw new Error('switching back does not restore the figure');
  if ((await page.locator('#resColMi').textContent()).trim() === col) {
    throw new Error('the list column head does not follow the unit');
  }
});

await step('the list says how it is sorted and what its number is', async () => {
  await page.keyboard.press('Escape');
  await page.fill('#q', '');
  await page.waitForTimeout(600);
  const unsearched = await page.locator('#resSort').textContent();
  if (!unsearched.trim()) throw new Error('unsearched list does not say how it is ordered');
  // The right-hand column was a bare number with no unit anywhere on screen.
  const col = await page.locator('#resColMi').textContent();
  if (!col.trim()) throw new Error('the mileage column is unlabelled');
  // And the explanation of what an unsearched list contains has to be reachable.
  const why = await page.getAttribute('#resSort', 'title');
  if (!why || why.length < 20) throw new Error('no explanation of the default list');

  await page.fill('#q', 'I-5');
  await page.waitForTimeout(700);
  const searched = await page.locator('#resSort').textContent();
  if (searched === unsearched) throw new Error('sort label does not change when searching');
});

await step('choosing a route on the map moves the list to it', async () => {
  // The two halves of the screen used to disagree: the map drew the selection
  // and the panel described it, while the list sat wherever it had been left.
  await page.keyboard.press('Escape');
  await page.fill('#q', '');
  await page.waitForTimeout(800);
  await page.locator('#results').evaluate((el) => { el.scrollTop = 0; });

  // A route far enough down the unsearched list to be off-screen.
  const target = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#results .res')];
    const host = document.getElementById('results');
    const hit = rows.find((r) => r.offsetTop > host.clientHeight + 300);
    return hit ? hit.querySelector('.res-name')?.textContent?.trim() : null;
  });
  if (!target) throw new Error('list too short to test scrolling');

  await page.evaluate((label) => {
    const row = [...document.querySelectorAll('#results .res')]
      .find((r) => r.querySelector('.res-name')?.textContent?.trim() === label);
    window.__select(row.dataset.id);
  }, target);
  await page.waitForTimeout(2200);

  const visible = await page.evaluate(() => {
    const sel = document.querySelector('#results .res.sel');
    if (!sel) return 'none';
    const host = document.getElementById('results');
    const a = sel.getBoundingClientRect();
    const b = host.getBoundingClientRect();
    return a.top >= b.top - 2 && a.bottom <= b.bottom + 2 ? 'in view' : 'off screen';
  });
  if (visible !== 'in view') throw new Error(`selected row is ${visible} after a map pick`);
});

// The colour key is read in the browser, so the region test is spelled out
// there rather than imported.
const readLegend = () => page.evaluate(() => {
  const el = document.getElementById('legend');
  if (!el) return null;
  const region = document.documentElement.dataset.region;
  const inRegion = (id) => (/^(tw|hk)-/.test(id) ? 'ea' : 'na') === region;
  return {
    shown: !el.hidden && Number(getComputedStyle(el).opacity) > 0.5,
    rows: el.querySelectorAll('.lg-r').length,
    on: [...document.querySelectorAll('#sysList .sys.on')].filter((s) => inRegion(s.dataset.sys)).length,
    colours: [...el.querySelectorAll('.lg-dot')].map((d) => getComputedStyle(d).backgroundColor),
  };
});

await step('the map carries a key to its colours', async () => {
  // The system switches live in a menu, so this is the only thing on screen
  // saying which colour is which on a map that is unlabelled when zoomed out.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  const legend = await readLegend();
  if (!legend) throw new Error('no legend element');
  if (!legend.shown) throw new Error('legend not visible');
  // A key to what is drawn here, so it has to track the switches and the
  // region: by this point in the run earlier steps have turned several on.
  if (legend.rows !== legend.on) {
    throw new Error(`legend lists ${legend.rows} systems but ${legend.on} are drawn in this region`);
  }
  if (!legend.rows) throw new Error('legend is empty with systems drawn');
  if (new Set(legend.colours).size !== legend.rows) {
    throw new Error('legend swatches share a colour');
  }
  // It must not sit under the search list when that is open.
  const clear = await page.evaluate(() => {
    const lg = document.getElementById('legend').getBoundingClientRect();
    const hud = document.getElementById('hud').getBoundingClientRect();
    return lg.top > hud.bottom;
  });
  if (!clear) throw new Error('legend overlaps the top bar');
  await page.click('#btnSettings');
  await page.click('#btnLegend');
  const off = await page.evaluate(() => document.getElementById('legend').hidden);
  await page.click('#btnLegend');
  await page.keyboard.press('Escape');
  const back = await page.evaluate(() => !document.getElementById('legend').hidden);
  if (!off || !back) throw new Error(`legend switch: off=${off} back=${back}`);
});
await shot('17-legend.png');

await step('the interface can be taken off the map and brought back', async () => {
  await page.keyboard.press('z');
  await page.waitForTimeout(900);
  const hidden = await page.evaluate(() => ({
    zen: document.body.classList.contains('zen'),
    hud: Number(getComputedStyle(document.getElementById('hud')).opacity),
    out: Number(getComputedStyle(document.getElementById('zenOut')).opacity),
    // Hidden chrome must not still be catching clicks meant for the map,
    // including the search box, which sits inside the bar.
    clicks: [...new Set(['hud', 'shell', 'menuLayers']
      .map((id) => getComputedStyle(document.getElementById(id)).pointerEvents))].join(),
  }));
  if (!hidden.zen) throw new Error('z did not hide the interface');
  if (hidden.hud > 0.05) throw new Error('chrome still visible');
  if (hidden.clicks !== 'none') throw new Error('hidden chrome still takes clicks');
  if (hidden.out < 0.1) throw new Error('no way back from a hidden interface');
});
await shot('18-zen.png');

await step('escape brings the interface back', async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  const back = await page.evaluate(() => ({
    zen: document.body.classList.contains('zen'),
    hud: Number(getComputedStyle(document.getElementById('hud')).opacity),
  }));
  if (back.zen || back.hud < 0.9) throw new Error('escape did not restore the interface');
});

await step('the buildout run stops at the end rather than looping', async () => {
  // It used to wrap straight back to an empty 1956 map, so a reader glancing
  // away could not tell the start of a run from the end of one.
  await jsClick('#btnTimeline');
  await page.waitForSelector('#tlxRange', { timeout: 15000 });
  const max = Number(await page.getAttribute('#tlxRange', 'max'));
  await page.evaluate((y) => {
    const r = document.getElementById('tlxRange');
    r.value = String(y);
    r.dispatchEvent(new Event('input', { bubbles: true }));
  }, max - 2);
  await page.waitForTimeout(400);
  await page.click('#tlxPlay');
  await page.waitForTimeout(9000);

  const end = await page.evaluate(() => ({
    year: Number(document.querySelector('.tlx-year')?.textContent),
    playing: document.getElementById('tlapse').classList.contains('playing'),
    ended: document.getElementById('tlapse').classList.contains('ended'),
  }));
  if (end.year !== max) throw new Error(`run settled on ${end.year}, expected ${max}`);
  if (end.playing) throw new Error('still playing past the end');
  if (!end.ended) throw new Error('finished run does not offer to rewind');

  // And the rewind has to actually rewind, or the control does nothing.
  await page.click('#tlxPlay');
  await page.waitForTimeout(700);
  const year = await page.evaluate(() => Number(document.querySelector('.tlx-year')?.textContent));
  if (year > 1962) throw new Error(`play on a finished run did not rewind, at ${year}`);
  await page.click('#tlxClose');
  await page.waitForTimeout(500);
});

await step('border crossings draw, and a nearby route can be chosen from one', async () => {
  await page.keyboard.press('Escape');
  await jsClick('#btnCrossings');
  await waitForSource('xing');
  // A Canadian crossing with routes beside it, clicked where it is drawn.
  const pt = await page.evaluate(async () => {
    const d = await (await fetch('data/crossings.json')).json();
    const f = d.features.find((x) => x.properties.country === 'ca' && x.properties.near.length >= 2);
    const map = window.__map;
    map.jumpTo({ center: f.geometry.coordinates, zoom: 11, pitch: 0, bearing: 0 });
    await new Promise((res) => map.once('idle', res));
    const p = map.project(f.geometry.coordinates);
    const r = map.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y, borders: new Set(d.features.map((x) => x.properties.border)).size };
  });
  if (pt.borders !== 4) throw new Error(`expected crossings on four borders, found ${pt.borders}`);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForSelector('.xg-pop .xg-r', { timeout: 8000 });
  const label = await page.textContent('.xg-pop .xg-r b');
  await shot('11-crossings.png');
  await page.click('.xg-pop .xg-r');
  await page.waitForFunction(() => !document.getElementById('detail').classList.contains('hidden'), null, { timeout: 15000 });
  const title = await page.textContent('#detail');
  if (!title.includes(label.trim())) throw new Error(`chose ${label} from the crossing, detail shows something else`);
  await jsClick('#btnCrossings');
  if (await page.locator('.xg-pop').count()) throw new Error('popup outlived its layer');
});

await step('toll facilities draw, show dated fares, and appear in the route panel', async () => {
  await page.keyboard.press('Escape');
  await jsClick('#btnTolls');
  await waitForSource('toll');
  // The Confederation Bridge, clicked at the middle of its drawn line.
  const pt = await page.evaluate(async () => {
    const d = await (await fetch('data/tolls.json')).json();
    const f = d.features.find((x) => x.properties.id === 'confederation-bridge' && x.geometry.type === 'LineString');
    if (!f) return null;
    const c = f.geometry.coordinates[Math.floor(f.geometry.coordinates.length / 2)];
    const map = window.__map;
    map.jumpTo({ center: c, zoom: 11, pitch: 0, bearing: 0 });
    await new Promise((res) => map.once('idle', res));
    const p = map.project(c);
    const r = map.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y, n: d.features.filter((x) => x.properties.kind !== 'plaza').length };
  });
  if (!pt) throw new Error('the Confederation Bridge is not drawn');
  if (pt.n !== 7) throw new Error(`expected seven toll facilities, found ${pt.n}`);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForSelector('.tl-pop .tl-fare', { timeout: 8000 });
  if (await page.locator('.tl-pop .tl-fare').count() < 1) throw new Error('no dated fare in the popup');
  await shot('12-tolls.png');
  await page.click('.tl-pop .xg-r');
  // The tolls section starts folded, so the items are present but not shown.
  await page.waitForSelector('#dtTolls .tl-item', { timeout: 15000, state: 'attached' });
  await jsClick('#btnTolls');
  if (await page.locator('.tl-pop').count()) throw new Error('popup outlived its layer');
});

await step('Mexican toll plazas draw and open with their operator', async () => {
  await page.keyboard.press('Escape');
  await jsClick('#btnTolls');
  await waitForSource('toll');
  const pt = await page.evaluate(async () => {
    const d = await (await fetch('data/tolls.json')).json();
    const plazas = d.features.filter((x) => x.properties.kind === 'plaza');
    const f = plazas.find((x) => x.properties.admin === 'CAPUFE' && x.properties.place === 'Definida');
    const map = window.__map;
    map.jumpTo({ center: f.geometry.coordinates, zoom: 12, pitch: 0, bearing: 0 });
    await new Promise((res) => map.once('idle', res));
    const p = map.project(f.geometry.coordinates);
    const r = map.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y, n: plazas.length };
  });
  if (pt.n < 1000) throw new Error(`expected over a thousand toll plazas, found ${pt.n}`);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForSelector('.tl-pop .tl-op', { timeout: 8000 });
  const text = await page.textContent('.tl-pop');
  if (!text.includes('CAPUFE')) throw new Error(`plaza popup does not name its operator: ${text.slice(0, 120)}`);
  await jsClick('#btnTolls');
});

await step('bridges draw, colour by year, and say the year is not the road\'s', async () => {
  await page.keyboard.press('Escape');
  await jsClick('#btnBridges');
  await waitForSource('bridge');
  const pt = await page.evaluate(async () => {
    const d = await (await fetch('data/bridges.json')).json();
    const F = Object.fromEntries(d.fields.map((f, i) => [f, i]));
    const r = d.rows.find((x) => d.sets[x[F.set]].id === 'on' && x[F.built] && x[F.kind] === 'bridge');
    const map = window.__map;
    map.jumpTo({ center: [r[F.lon], r[F.lat]], zoom: 13, pitch: 0, bearing: 0 });
    await new Promise((res) => map.once('idle', res));
    const p = map.project([r[F.lon], r[F.lat]]);
    const b = map.getCanvas().getBoundingClientRect();
    return { x: b.left + p.x, y: b.top + p.y, n: d.rows.length, sets: d.sets.map((s) => s.id).join(','), year: r[F.built] };
  });
  if (pt.n < 14000) throw new Error(`expected about 14,800 structures, found ${pt.n}`);
  if (pt.sets !== 'mx,on') throw new Error(`expected the Mexican and Ontario inventories, found ${pt.sets}`);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForSelector('.xg-pop .xg-n', { timeout: 8000 });
  const text = await page.textContent('.xg-pop');
  if (!text.includes(String(pt.year))) throw new Error(`popup does not give the year built ${pt.year}`);
  await shot('13-bridges.png');
  await jsClick('#btnBridges');
  if (await page.locator('.xg-pop').count()) throw new Error('popup outlived its layer');
});

await step('the region switch flies to East Asia and follows the view', async () => {
  await dismissSheet();
  await page.click('#regionSeg [data-region="ea"]');
  await page.waitForTimeout(3200);
  const lng = await page.evaluate(() => window.__map.getCenter().lng);
  if (lng < 112 || lng > 124) throw new Error(`switch did not reach East Asia (lng ${lng.toFixed(1)})`);
  if (!(await page.locator('#regionSeg [data-region="ea"].on').count())) throw new Error('switch does not show East Asia');
  if (!(await page.locator('[data-jump="tw"]').count())) throw new Error('no Taiwan jump row');
  if (await page.locator('[data-jump="ak"]').count()) throw new Error('North American jumps still shown');
  const fw = await waitForSource('rt-tw-freeway');
  const hk = await waitForSource('rt-hk-route');
  if (fw < 10) throw new Error(`only ${fw} Taiwanese freeways`);
  if (hk !== 10) throw new Error(`expected Routes 1 to 10, found ${hk}`);
});
await shot('19-east-asia.png');

await step('in East Asia the key and the places are East Asian', async () => {
  const legend = await readLegend();
  if (!legend.rows || legend.rows !== legend.on) {
    throw new Error(`legend lists ${legend.rows} systems with ${legend.on} drawn here`);
  }
  const names = await page.locator('#legend .lg-r').allTextContents();
  if (names.some((n) => /Interstate|Trans-Canada|federal/i.test(n))) {
    throw new Error(`North American systems in the East Asian key: ${names.join(', ')}`);
  }
  // Pressing the region already on screen opens its places rather than flying.
  await page.click('#regionSeg [data-region="ea"]');
  if (!await page.locator('#regionPop [data-jump="hk"]').isVisible()) throw new Error('region places did not open');
  await page.click('[data-jump="hk"]');
  await page.waitForTimeout(1900);
  if (await page.locator('#regionWrap.open').count()) throw new Error('places stayed open after a jump');
  const { lng, lat } = await page.evaluate(() => window.__map.getCenter());
  if (Math.abs(lng - 114.1) > 0.4 || Math.abs(lat - 22.37) > 0.3) {
    throw new Error(`jump did not reach Hong Kong (${lng.toFixed(2)}, ${lat.toFixed(2)})`);
  }
});

await step('國1 finds National Freeway 1 on its plum-blossom shield', async () => {
  await page.fill('#q', '國1');
  await page.waitForTimeout(700);
  const first = page.locator('#results .res').first();
  if (!(await first.locator('.shield-twf').count())) throw new Error('first result has no 國道 shield');
  await first.click();
  await page.waitForSelector('#detail:not(.hidden)', { timeout: 10000 });
  await page.waitForTimeout(900);
  const title = await page.textContent('.dt-name');
  if (title.trim() !== 'Fwy 1') throw new Error(`opened ${title}`);
  const text = await page.textContent('#detail');
  if (!/What the Freeway Bureau publishes/.test(text)) throw new Error('no Freeway Bureau traffic on Fwy 1');
  if (!/reference values/.test(text) || /AADT/.test(text)) throw new Error('Fwy 1 traffic not labelled as reference values');
});

await step('a provincial highway gives the Highway Bureau length and termini', async () => {
  await page.fill('#q', '台9');
  await page.waitForTimeout(700);
  await page.locator('#results .res').first().click();
  await page.waitForSelector('#detail:not(.hidden)', { timeout: 10000 });
  await page.waitForTimeout(1200);
  const text = await page.textContent('#detail');
  if (!/Highway Bureau/.test(text)) throw new Error('no register length on PH 9');
  if (!/Register termini/.test(text)) throw new Error('no register termini on PH 9');
  if (!/What the Highway Bureau counts/.test(text)) throw new Error('no survey traffic on PH 9');
  if (/工程處/.test(text)) throw new Error('PH 9 names a works office as its busiest station');
  if (!(await page.locator('.dt-hd .shield-twp').count())) throw new Error('PH 9 has no 省道 shield');
});
await shot('20-taiwan-detail.png');

await step('the switch flies back to North America', async () => {
  await page.click('#dtClose');
  await page.click('#regionSeg [data-region="na"]');
  await page.waitForTimeout(3200);
  const lng = await page.evaluate(() => window.__map.getCenter().lng);
  if (lng > -50) throw new Error(`switch did not return (lng ${lng.toFixed(1)})`);
  if (!(await page.locator('[data-jump="ak"]').count())) throw new Error('North American jumps not restored');
});

console.log(`\nsteps failed:    ${failures}`);
console.log(`console errors:  ${errors.length}`);
for (const e of [...new Set(errors)].slice(0, 25)) console.log(`  ! ${e.slice(0, 300)}`);
console.log(`failed requests: ${failed.length}`);
for (const f of [...new Set(failed)].slice(0, 25)) console.log(`  ! ${f}`);

await browser.close();
process.exit(failures || errors.length || failed.length ? 1 : 0);
