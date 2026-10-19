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
  const group = page.locator(`.sg:has(.sys[data-sys="${id}"])`);
  if (!await group.evaluate((g) => g.classList.contains('open'))) {
    await group.locator('.sg-hd').click();
    await page.waitForTimeout(350);
  }
  await page.click(`.sys[data-sys="${id}"]`);
};
const jumpTo = async (key) => {
  if (!await page.locator('#shell.rpop-open').count()) await page.click('#globeBtn');
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

await step('the empty search is empty until something has been chosen', async () => {
  await page.evaluate(() => localStorage.removeItem('ia.recent'));
  await page.click('#q');
  await page.waitForTimeout(200);
  if (await page.locator('#results > *').count()) throw new Error('rows listed before anything was typed or chosen');
  if (await page.locator('#findDrop').isVisible()) throw new Error('an empty list was opened');
  if (await page.locator('#resColMi, #resSort, .res-mi, [data-go]').count()) throw new Error('length column or jumps still drawn');
  await page.keyboard.press('Escape');
});

await step('search is global: Taiwan from North America, and places and views too', async () => {
  await page.fill('#q', 'G4');
  await page.waitForTimeout(400);
  const first = await page.locator('#results .res[data-id]').first().getAttribute('data-id').catch(() => null);
  if (first !== 'cn-g4') {
    await page.fill('#q', '');
    await page.keyboard.press('Escape');
    throw new Error(`G4 from the North American view found ${first}`);
  }
  await page.fill('#q', 'Ontario');
  await page.waitForTimeout(300);
  if (!await page.locator('#results .res-go').filter({ hasText: 'Ontario' }).count()) throw new Error('no place row for Ontario');
  await page.fill('#q', 'Statistics');
  await page.waitForTimeout(300);
  if (!await page.locator('#results .res-go').filter({ hasText: 'Statistics' }).count()) throw new Error('no view row for Statistics');
  await page.fill('#q', '');
  await page.keyboard.press('Escape');
});

await step('a pick is offered back in the empty box, and can be removed', async () => {
  await page.fill('#q', 'Statistics');
  await page.waitForTimeout(300);
  await page.locator('#results .res-go').filter({ hasText: 'Statistics' }).first().click();
  await page.waitForSelector('#sheet.open, .sh.open', { timeout: 8000 }).catch(() => {});
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.fill('#q', '');
  await page.click('#q');
  await page.waitForTimeout(200);
  const rows = await page.locator('#results .res').count();
  const title = await page.textContent('#resTitle');
  if (rows !== 1 || !/Recent/.test(title)) throw new Error(`empty box showed ${rows} rows under "${title}"`);
  await page.locator('#results .res-x').first().evaluate((x) => x.click());
  await page.waitForTimeout(200);
  if (await page.locator('#results .res').count()) throw new Error('removing the pick left it listed');
  // Leave one behind, so the next step has a list to fold.
  await page.evaluate(() => localStorage.setItem('ia.recent', JSON.stringify([{ k: 'view', key: 'dashboard' }])));
  await page.keyboard.press('Escape');
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
  // bottom of the map - eating drags, because it also
  // had no pointer-events guard. Anything held off-screen is checked here
  // rather than only the one that broke.
  const bad = await page.evaluate(() => {
    const out = [];
    for (const id of ['fly', 'toast', 'zenOut', 'detail']) {
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
  if (await page.locator('.nb-cc').count() !== 5) throw new Error('the numbering page does not offer all five countries');
  if (await page.locator('.nb-cc.on').getAttribute('data-cc') !== 'us') throw new Error('over the US the page did not open on the US');
});
await shot('03-numbering.png');

await step('numbering covers China, Taiwan and Hong Kong, drawn from the data', async () => {
  await page.click('.nb-cc[data-cc="cn"]');
  await page.waitForSelector('.nb-plate .nb-geo', { timeout: 30000 });
  const n = await page.locator('.nb-plate .nb-geo').count();
  if (n < 200) throw new Error(`only ${n} expressways on the plate`);
  const fits = await page.$$eval('.nb-fit', (els) => els.map((e) => e.textContent.trim()).filter(Boolean));
  if (!fits.some((f) => /westward/.test(f)) || !fits.some((f) => /southward/.test(f))) throw new Error(`the measured directions are wrong: ${fits.join(' | ')}`);
  if (!fits.some((f) => /clockwise/.test(f))) throw new Error('no measured direction for the radials');
  await page.click('.nb-cls[data-c="radial"]');
  const dimmed = await page.locator('.nb-geo.dim').count();
  if (dimmed < n / 2) throw new Error('picking a rule did not isolate its roads');
  await page.click('.nb-ana-chip[data-ana="2"]');
  if (!(await page.locator('.nb-ana-code.on').textContent()).includes('4201'.slice(0, 2))) throw new Error('the anatomy chip did not switch');
  await page.waitForTimeout(400);
  await shot('03a-numbering-cn.png');
  for (const cc of ['tw', 'hk']) {
    await page.click(`.nb-cc[data-cc="${cc}"]`);
    await page.waitForSelector('.nb-plate .nb-geo', { timeout: 15000 });
  }
  await page.click('.nb-cc[data-cc="tw"]');
  await page.click('#nbTabs [data-nb="tw-provincial"]');
  await page.waitForSelector('.nb-plate .nb-geo', { timeout: 15000 });
  await page.waitForTimeout(300);
  const tw = await page.$$eval('.nb-fit', (els) => els.map((e) => e.textContent.trim()).filter(Boolean));
  if (!tw.some((f) => /southward, ρ = 1\.00/.test(f))) throw new Error(`Taiwan's east–west expressways are not strictly north to south: ${tw.join(' | ')}`);
  await shot('03b-numbering-tw.png');
  await page.click('.nb-cc[data-cc="us"]');
});

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
  if (rows !== 6) throw new Error(`expected a bar per country or region, got ${rows}`);
  const longest = await page.locator('.hbar-route[data-id]').count();
  if (longest < 10) throw new Error(`only ${longest} longest-route bars`);
});

await step('statistics switch to one country and back', async () => {
  const cards = await page.$$eval('.dash-cc', (els) => els.map((e) => e.dataset.cc));
  if (cards[0] !== 'all' || cards.length !== 7) throw new Error(`country rail is ${cards}`);
  await page.click('.dash-cc[data-cc="cn"]');
  await page.waitForTimeout(900);
  const want = await page.evaluate(async () => {
    const s = await (await fetch('data/stats.json')).json();
    return Object.entries(s.bySystem).filter(([k]) => k.startsWith('cn-')).reduce((a, [, v]) => a + v.routes, 0);
  });
  const got = Number((await page.locator('[data-tile="routes"]').textContent()).replace(/\D/g, ''));
  if (got !== want) throw new Error(`China shows ${got} routes, the index has ${want}`);
  const rows = await page.locator('.cc-row').count();
  if (rows !== 3) throw new Error(`China should chart its three systems, got ${rows}`);
  const ids = await page.$$eval('.hbar-route[data-id]', (els) => els.map((e) => e.dataset.id));
  if (!ids.length || ids.some((id) => !id.startsWith('cn-') && !/^[a-z]{3}-s/.test(id))) throw new Error(`non-Chinese routes in China's lists: ${ids.slice(0, 5)}`);
  if (!await page.locator('.dash-card .stack-tall').count()) throw new Error('no road-class mix for China');
  await shot('04c-dashboard-cn.png');
  await page.click('.dash-cc[data-cc="all"]');
  await page.waitForTimeout(900);
  if (await page.locator('.cc-row').count() !== 6) throw new Error('Everywhere did not bring the six countries back');
});

await step('the More menu opens and closes', async () => {
  await page.click('#shClose');
  await page.click('#btnMore');
  await page.waitForSelector('#menuMore.open', { timeout: 4000 });
  for (const id of ['btnDash', 'btnNumbering', 'btnDocs', 'btnAbout']) {
    if (!await page.locator(`#menuMore #${id}`).isVisible()) throw new Error(`#${id} not in the open menu`);
  }
  if (await page.locator('#btnPalette').count()) throw new Error('Jump to is still in the More menu');
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
  for (const sel of ['#basemap', '#btnCrossings', '#btnTolls', '#btnBridges', '#btnSpeed', '#btnTerrain']) {
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
  // The light theme turns the panels over and the ground with them; the road
  // colours stay as they are.
  const ground = () => page.evaluate(() => {
    const m = window.__map;
    const road = m.getStyle().layers.find((l) => l.type === 'line' && l.source === 'rt-us-interstate');
    return {
      bg: m.getPaintProperty('background', 'background-color'),
      water: m.getPaintProperty('water', 'fill-color'),
      road: road && m.getPaintProperty(road.id, 'line-color'),
    };
  });
  const dark = await ground();
  await page.click('#themeSeg [data-theme="light"]');
  await page.waitForTimeout(300);
  const light = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    panel: getComputedStyle(document.getElementById('shell')).backgroundColor,
  }));
  if (light.theme !== 'light' || !/2[34]\d, 2[34]\d, 2[45]\d/.test(light.panel)) {
    throw new Error(`light panels did not apply: ${JSON.stringify(light)}`);
  }
  const lit = await ground();
  if (lit.bg !== 'rgb(242,243,240)' || lit.water === dark.water) throw new Error(`the basemap stayed dark: ${JSON.stringify(lit)}`);
  if (JSON.stringify(lit.road) !== JSON.stringify(dark.road)) throw new Error('the road colours changed with the theme');
  const card = await page.evaluate(() => {
    const b = document.querySelector('#basemap [data-base="dark"]');
    return { name: b.querySelector('span').textContent, src: b.querySelector('img').getAttribute('src') };
  });
  if (card.name !== 'Light' || !card.src.endsWith('base-dark-light.jpg')) throw new Error(`the plain base card did not follow the theme: ${JSON.stringify(card)}`);
  await page.keyboard.press('Escape');
  await page.click('#btnLayers');
  await page.waitForTimeout(600);
  await shot('03d-layers-light.png');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  await shot('03c-light.png');
  await page.keyboard.press('s');
  await page.click('#themeSeg [data-theme="dark"]');
  await page.waitForTimeout(300);
  if (JSON.stringify(await ground()) !== JSON.stringify(dark)) throw new Error('switching back did not restore the dark ground');
  await page.keyboard.press('Escape');
});

// Closing whatever sheet the previous step opened. Not every step leaves one
// open, and a step must not fail because the thing it is tidying up after is
// already tidy.
const dismissSheet = async () => {
  const close = page.locator('#shClose');
  if (await close.count()) await close.click().catch(() => {});
};

await step('a route panel carries its dates, from its dossier or from Quebec', async () => {
  await dismissSheet();
  for (const [id, min] of [['i-70', 3], ['qc-40', 10]]) {
    await page.evaluate((x) => window.__select(x), id);
    await page.waitForTimeout(2500);
    const sect = page.locator('#detail .sect').filter({ has: page.locator('h3', { hasText: 'Dates' }) });
    await sect.waitFor({ state: 'attached', timeout: 15000 });
    await sect.locator('.chron li').nth(min - 1).waitFor({ state: 'attached', timeout: 15000 });
    const years = await sect.locator('.chron li b').allTextContents();
    const sorted = years.map(Number);
    if (sorted.some((y, i) => i && y < sorted[i - 1])) throw new Error(`${id} dates out of order: ${years}`);
  }
  await page.keyboard.press('Escape');
});

await step('the timeline is gone, and its curve is on the statistics page', async () => {
  if (await page.locator('#btnTimeline, #tlapse').count()) throw new Error('timeline controls still in the page');
  await jsClick('#btnDash');
  await page.waitForSelector('#dashBuild:not([hidden]) .build-dec > div', { timeout: 10000 });
  if (await page.locator('#dashBuild .build-dec > div').count() !== 5) throw new Error('the buildout is not five decade bars');
  await page.click('.dash-cc[data-cc="cn"]');
  await page.waitForTimeout(300);
  if (await page.locator('#dashBuild').count()) throw new Error('the Interstate buildout shown for China');
  await page.waitForSelector('#dashBuildCn:not([hidden]) .build-svg', { timeout: 10000 });
  const cn = await page.evaluate(async () => {
    const h = await (await fetch('data/timeline.json')).json();
    return { lines: h.mainland.length, dated: h.mainland.filter((l) => l.year).length };
  });
  if (cn.lines !== 36) throw new Error(`mainland buildout has ${cn.lines} main lines, not 36`);
  const chips = await page.locator('#dashBuildCn .dash-go').count();
  if (chips !== cn.lines) throw new Error(`mainland buildout lists ${chips} of ${cn.lines} lines`);
  if (await page.locator('#dashBuildCn .build-ev i').count() !== cn.dated) throw new Error('mainland buildout ticks do not match the dated lines');
  await page.locator('#dashBuildCn').scrollIntoViewIfNeeded();
  await shot('04e-dashboard-build-cn.png');
  await page.click('.dash-cc[data-cc="us"]');
  await page.waitForTimeout(300);
  if (await page.locator('#dashBuildCn').count()) throw new Error('the mainland buildout shown for the United States');
  await page.click('.dash-cc[data-cc="cn"]');
  await page.waitForSelector('#dashBuildCn:not([hidden]) .dash-go[data-id="cn-g1"]', { timeout: 10000 });
  await page.click('#dashBuildCn .dash-go[data-id="cn-g1"]');
  await page.waitForTimeout(1200);
  if (!(await page.locator('#detail').textContent()).includes('G1')) throw new Error('a mainland buildout chip did not open its route');
  await page.keyboard.press('Escape');
  await jsClick('#btnDash');
  await page.waitForTimeout(600);
  await page.click('.dash-cc[data-cc="all"]');
  await page.click('#shClose');
});

await step('the statistics page charts speed limits, defaults apart from readings', async () => {
  await dismissSheet();
  await jsClick('#btnDash');
  await page.waitForSelector('#dashSpeed:not([hidden]) .spd-row', { timeout: 10000 });
  if (await page.locator('#dashSpeed .spd-row').count() !== 6) throw new Error('speed chart is not a row per country');
  await page.click('.dash-cc[data-cc="cn"]');
  await page.waitForSelector('#dashSpeed:not([hidden]) .stack .spd-law', { timeout: 10000 });
  if (await page.locator('#dashSpeed .spd-row').count() !== 3) throw new Error('China speed chart is not a row per system');
  await page.locator('#dashSpeed').scrollIntoViewIfNeeded();
  await shot('04d-dashboard-speed-cn.png');
  await page.click('.dash-cc[data-cc="all"]');
  await page.click('#shClose');
});

await step('speed limits colour the routes, key them, and come off again', async () => {
  await dismissSheet();
  await page.evaluate(() => window.__map.jumpTo({ center: [-77, 39], zoom: 5.2 }));
  const need = (sel, what) => page.waitForSelector(sel, { state: 'attached', timeout: 15000 })
    .catch(() => { throw new Error(what); });
  await jsClick('#btnSpeed');
  // Switched off whatever happens, or every colour-key check after this one
  // would be reading the speed key.
  try {
    await need('#legend .lg-ramp', 'no speed key');
    const on = await page.evaluate(() => ({
      state: window.__map.getFeatureState({ source: 'rt-us-interstate', id: 'i-95' }),
      paint: window.__map.getPaintProperty('rt-us-interstate', 'line-color'),
    }));
    if (!(on.state.kph > 90 && on.state.src === 'p')) throw new Error(`I-95 not stamped: ${JSON.stringify(on.state)}`);
    if (!Array.isArray(on.paint)) throw new Error('route colour is not driven by the limit');
    await page.waitForTimeout(800);
    await shot('05s-speed.png');
    await jsClick('#btnLegend');
    const hidden = await page.evaluate(() => document.getElementById('legend').hidden);
    await jsClick('#btnLegend');
    const back = await page.evaluate(() => !document.getElementById('legend').hidden
      && !!document.querySelector('#legend .lg-ramp'));
    if (!hidden || !back) throw new Error(`speed key ignores the colour-key switch: off=${hidden} back=${back}`);
    await page.evaluate(() => window.__select('i-95'));
    await need('#dtSpeed .spd-sign.spd-us', 'I-95 panel has no American limit sign');
    if (!await page.locator('#dtSpeed .spd-b-p').count()) throw new Error('I-95 limit not marked official');
    await page.evaluate(() => window.__select('cn-g30'));
    await need('#dtSpeed .spd-sign.spd-ring', 'G30 panel has no limit sign');
    if (!await page.locator('#dtSpeed .spd-b-o').count()) throw new Error('G30 limit not marked as OpenStreetMap');
    if (!await page.locator('#dtSpeed .spd-bar i').count()) throw new Error('G30 has no distribution along the route');
    await page.keyboard.press('Escape');
  } finally {
    await jsClick('#btnSpeed');
    await page.waitForTimeout(300);
  }
  const off = await page.evaluate(() => window.__map.getPaintProperty('rt-us-interstate', 'line-color'));
  if (Array.isArray(off)) throw new Error('route colour not restored');
  if (await page.locator('#legend .lg-ramp').count()) throw new Error('speed key left behind');
  await page.evaluate(() => window.__map.jumpTo({ center: [-96, 38.5], zoom: 3.6 }));
});

await step('/ goes to the search box', async () => {
  await dismissSheet();
  await page.locator('#map canvas').first().click({ position: { x: 600, y: 400 } }).catch(() => {});
  await page.keyboard.press('/');
  await page.waitForTimeout(200);
  if (await page.evaluate(() => document.activeElement?.id) !== 'q') throw new Error('/ did not focus the search box');
  await page.keyboard.type('US 66');
  await page.waitForTimeout(400);
  if (await page.locator('#results .res[data-id]').count() < 1) throw new Error('no result for US 66');
  if (await page.locator('#palette').count()) throw new Error('the old palette is still in the page');
  await page.fill('#q', '');
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
  const region = await page.locator('.rcard[data-region="na"] b').textContent();
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
  // OSM's name:zh often holds both scripts, "美国;美國"; the map shows the first.
  const field = await page.evaluate(() => JSON.stringify(window.__map.getLayoutProperty('place_country_major', 'text-field')));
  if (!field.includes('zh-Hans') || !field.includes('index-of')) throw new Error(`country labels do not prefer Simplified: ${field.slice(0, 160)}`);
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
  await flip();
  if (await read() !== before) throw new Error('switching back does not restore the figure');
});

await step('choosing a route on the map moves the list to it', async () => {
  // The two halves of the screen used to disagree: the map drew the selection
  // and the panel described it, while the list sat wherever it had been left.
  await page.keyboard.press('Escape');
  await page.fill('#q', 'I-');
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
  const inRegion = (id) => (/^(cn|tw|hk)-/.test(id) ? 'ea' : 'na') === region;
  return {
    shown: !el.hidden && Number(getComputedStyle(el).opacity) > 0.5,
    rows: el.querySelectorAll('.lg-roads .lg-r').length,
    on: [...document.querySelectorAll('#sysList .sys.on')].filter((s) => inRegion(s.dataset.sys)).length,
    colours: [...el.querySelectorAll('.lg-roads .lg-dot')].map((d) => getComputedStyle(d).backgroundColor),
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

await step('border crossings draw, and a nearby route can be chosen from one', async () => {
  await page.keyboard.press('Escape');
  await jsClick('#btnCrossings');
  await waitForSource('xing');
  if (await page.locator('#legend .lg-ring').count() !== 4) throw new Error('the key does not list the four borders');
  // A Canadian crossing with routes beside it, clicked where it is drawn.
  const pt = await page.evaluate(async () => {
    const d = await (await fetch('data/crossings.json')).json();
    const f = d.features.find((x) => x.properties.country === 'ca' && x.properties.near.length >= 2);
    const map = window.__map;
    map.jumpTo({ center: f.geometry.coordinates, zoom: 11, pitch: 0, bearing: 0 });
    await new Promise((res) => map.once('idle', res));
    const p = map.project(f.geometry.coordinates);
    const r = map.getCanvas().getBoundingClientRect();
    const na = d.features.filter((x) => x.properties.country !== 'cn');
    return { x: r.left + p.x, y: r.top + p.y, borders: new Set(na.map((x) => x.properties.border)).size };
  });
  if (pt.borders !== 4) throw new Error(`expected North American crossings on four borders, found ${pt.borders}`);
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
  if (await page.locator('#legend .lg-ring').count()) throw new Error('crossings key outlived its layer');
});

await step('toll facilities draw, show dated fares, and appear in the route panel', async () => {
  await page.keyboard.press('Escape');
  await jsClick('#btnTolls');
  await waitForSource('toll');
  if (!await page.locator('#legend .lg-dash').count()) throw new Error('no toll key');
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
    return { x: r.left + p.x, y: r.top + p.y, n: Object.keys(d.facilities).filter((id) => d.facilities[id].drawn).length };
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
  const ticks = await page.locator('#legend .lg-at span').allTextContents();
  if (ticks.join(' ') !== '≤1930 1965 1995 2025') throw new Error(`bridge key ticks: ${ticks.join(' ')}`);
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
  if (pt.n < 19000) throw new Error(`expected about 20,000 structures, found ${pt.n}`);
  if (pt.sets !== 'mx,on,qc') throw new Error(`expected the Mexican, Ontario and Quebec inventories, found ${pt.sets}`);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForSelector('.xg-pop .xg-n', { timeout: 8000 });
  const text = await page.textContent('.xg-pop');
  if (!text.includes(String(pt.year))) throw new Error(`popup does not give the year built ${pt.year}`);
  await shot('13-bridges.png');
  const qc = await page.evaluate(async () => {
    const d = await (await fetch('data/bridges.json')).json();
    const F = Object.fromEntries(d.fields.map((f, i) => [f, i]));
    const r = d.rows.find((x) => d.sets[x[F.set]].id === 'qc' && x[F.kind] === 'bridge' && x[F.over] && x[F.lengthM] > 200);
    const map = window.__map;
    map.jumpTo({ center: [r[F.lon], r[F.lat]], zoom: 14, pitch: 0, bearing: 0 });
    await new Promise((res) => map.once('idle', res));
    const p = map.project([r[F.lon], r[F.lat]]);
    const b = map.getCanvas().getBoundingClientRect();
    return { x: b.left + p.x, y: b.top + p.y, year: r[F.built], over: r[F.over] };
  });
  await page.mouse.click(qc.x, qc.y);
  await page.waitForFunction((o) => document.querySelector('.xg-pop')?.textContent.includes(o), qc.over, { timeout: 8000 });
  const qtext = await page.textContent('.xg-pop');
  if (!qtext.includes(String(qc.year)) || !/Ministère des Transports/.test(qtext)) throw new Error(`Quebec bridge popup: ${qtext.slice(0, 160)}`);
  if (!/Zoom in for the US bridges/.test(await page.textContent('#legend'))) {
    await page.evaluate(() => window.__map.jumpTo({ center: [-98, 39], zoom: 4 }));
    await page.waitForFunction(() => /Zoom in for the US bridges/.test(document.getElementById('legend').textContent), null, { timeout: 8000 });
  }
  const usb = await page.evaluate(async () => {
    const f = await (await fetch('data/bridges/us/DE.json')).json();
    const G = Object.fromEntries(f.fields.map((k, i) => [k, i]));
    const r = f.rows.find((x) => /^i-/.test(f.routes[x[G.route]]) && x[G.built] && x[G.lengthM] > 150);
    const map = window.__map;
    map.jumpTo({ center: [r[G.lon], r[G.lat]], zoom: 15, pitch: 0, bearing: 0 });
    await new Promise((res) => map.once('idle', res));
    for (let i = 0; i < 40 && !map.queryRenderedFeatures(map.project([r[G.lon], r[G.lat]]), { layers: ['bridge-hit'] }).length; i++) {
      await new Promise((res) => setTimeout(res, 250));
    }
    const p = map.project([r[G.lon], r[G.lat]]);
    const b = map.getCanvas().getBoundingClientRect();
    return { x: b.left + p.x, y: b.top + p.y, year: r[G.built] };
  });
  await page.mouse.click(usb.x, usb.y);
  await page.waitForFunction(() => /National Bridge Inventory/.test(document.querySelector('.xg-pop')?.textContent ?? ''), null, { timeout: 8000 });
  const utext = await page.textContent('.xg-pop');
  if (!utext.includes(String(usb.year)) || !/Route I-/.test(utext)) throw new Error(`US bridge popup: ${utext.slice(0, 160)}`);
  await shot('13b-us-bridge.png');
  await jsClick('#btnBridges');
  if (await page.locator('.xg-pop').count()) throw new Error('popup outlived its layer');
  if (await page.locator('#legend .lg-at').count()) throw new Error('bridge key outlived its layer');
});

await step('the region switch flies to East Asia and follows the view', async () => {
  await dismissSheet();
  await page.click('#globeBtn');
  await page.click('.rcard[data-region="ea"]');
  await page.waitForTimeout(3200);
  await shot('19b-region-pop.png');
  const lng = await page.evaluate(() => window.__map.getCenter().lng);
  if (lng < 90 || lng > 125) throw new Error(`switch did not reach East Asia (lng ${lng.toFixed(1)})`);
  if (!(await page.locator('.rcard[data-region="ea"].on').count())) throw new Error('switch does not show East Asia');
  if (!(await page.locator('[data-jump="tw"]').count())) throw new Error('no Taiwan jump row');
  if (await page.locator('[data-jump="ak"]').count()) throw new Error('North American jumps still shown');
  await page.keyboard.press('Escape');
  const fw = await waitForSource('rt-tw-freeway');
  const hk = await waitForSource('rt-hk-route');
  if (fw < 10) throw new Error(`only ${fw} Taiwanese freeways`);
  if (hk !== 10) throw new Error(`expected Routes 1 to 10, found ${hk}`);
  if (!(await page.locator('[data-jump="cn"]').count())) throw new Error('no mainland China jump row');
  const ze = await waitForSource('rt-cn-expressway');
  if (ze < 200) throw new Error(`only ${ze} national expressways`);
});
await shot('19-east-asia.png');

await step('in East Asia the key and the places are East Asian', async () => {
  const legend = await readLegend();
  if (!legend.rows || legend.rows !== legend.on) {
    throw new Error(`legend lists ${legend.rows} systems with ${legend.on} drawn here`);
  }
  const names = await page.locator('#legend .lg-roads .lg-r').allTextContents();
  if (names.some((n) => /Interstate|Trans-Canada|federal/i.test(n))) {
    throw new Error(`North American systems in the East Asian key: ${names.join(', ')}`);
  }
  // The globe opens the places of the region on screen.
  await page.click('#globeBtn');
  if (!await page.locator('#regionPop [data-jump="hk"]').isVisible()) throw new Error('region places did not open');
  await page.click('[data-jump="hk"]');
  await page.waitForTimeout(1900);
  if (await page.locator('#shell.rpop-open').count()) throw new Error('places stayed open after a jump');
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
  if (title.trim() !== 'Sun Yat-sen Freeway') throw new Error(`opened ${title}`);
  if (!/中山高速公路/.test(await page.textContent('.dt-sub'))) throw new Error('Fwy 1 does not give its Chinese name');
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
  if (!/Register ends/.test(await page.textContent('.termini'))) throw new Error('no register ends beside the termini on PH 9');
  if (!/蘇花公路/.test(await page.textContent('.dt-aka'))) throw new Error('PH 9 does not list the names of its stretches');
  if (!/What the Highway Bureau counts/.test(text)) throw new Error('no survey traffic on PH 9');
  if (!/What the Highway Bureau measures of the surface[\s\S]*All provincial highways/.test(text)) throw new Error('no average roughness on PH 9');
  if (/工程處/.test(text)) throw new Error('PH 9 names a works office as its busiest station');
  if (!(await page.locator('.dt-hd .shield-twp').count())) throw new Error('PH 9 has no 省道 shield');
});
await shot('20-taiwan-detail.png');

await step('京港澳 finds G4, drawn from OpenStreetMap and named so', async () => {
  await page.click('#dtClose');
  await page.fill('#q', '京港澳');
  await page.waitForTimeout(700);
  const first = page.locator('#results .res').first();
  if (!(await first.locator('.shield-cne').count())) throw new Error('first result has no expressway shield');
  await first.click();
  await page.waitForSelector('#detail:not(.hidden)', { timeout: 10000 });
  await page.waitForTimeout(1200);
  // The number is the shield, the name is the title, the other language's
  // name is under it, and none of it is filed under the measured figures.
  const title = (await page.textContent('.dt-name')).trim();
  if (title !== 'Beijing–Hong Kong–Macau Expressway') throw new Error(`opened ${title}`);
  if ((await page.textContent('.dt-hd .shield')).trim() !== 'G4') throw new Error('G4 shield lost its number');
  if (!/京港澳高速/.test(await page.textContent('.dt-sub'))) throw new Error('G4 does not give its Chinese name');
  if (!/京珠高速/.test(await page.textContent('.dt-aka'))) throw new Error('G4 does not list its former name');
  const text = await page.textContent('#detail');
  if (!/OpenStreetMap/.test(text)) throw new Error('G4 does not say it is drawn from OpenStreetMap');
  if (!/Guangdong|Beijing/.test(text)) throw new Error('G4 names neither Guangdong nor Beijing');
  if (!/planned length/.test(await page.textContent('.mhero'))) throw new Error('G4 gives no planned length beside its own');
  const measured = await page.evaluate(() => [...document.querySelectorAll('#detail .sect')]
    .filter((s) => /Measured figures/.test(s.querySelector('h3')?.textContent))
    .map((s) => s.textContent).join(' '));
  if (/Name|Planned|京港澳/.test(measured)) throw new Error('names or plan filed under the measured figures');
  // What North American routes have from their authorities, East Asian ones
  // have from OpenStreetMap and the terrain tiles.
  const tiles = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#detail .mgrid .m')]
    .map((m) => [m.querySelector('.m-k').textContent.trim(), m.querySelector('.m-v').textContent.trim()])));
  if (!/^\d+(\.\d)?%$/.test(tiles['Bridges and tunnels'] ?? '')) throw new Error(`G4 bridges and tunnels tile reads ${tiles['Bridges and tunnels']}`);
  if (!/^\d(\.\d)?/.test(tiles.Lanes ?? '')) throw new Error(`G4 lanes tile reads ${tiles.Lanes}`);
  if (!/Wuhan/.test(text) || !/Changsha/.test(text)) throw new Error('G4 lists no towns served');
  if (!/Elevation profile[\s\S]*Highest point/.test(text)) throw new Error('G4 has no elevation profile');
  // A former name finds the route and says it is one.
  await page.click('#dtClose');
  await page.fill('#q', '京珠');
  await page.waitForTimeout(700);
  const row = page.locator('#results .res').first();
  if (!/G4/.test(await row.textContent()) || !/also called/.test(await row.locator('.res-sub').textContent())) {
    throw new Error('京珠 does not find G4 as a former name');
  }
  await row.click();
  await page.waitForSelector('#detail:not(.hidden)', { timeout: 10000 });
  await page.waitForTimeout(900);
});
await shot('21-china-g4.png');

await step('Hong Kong Route 9 gives the census traffic and its roads in Chinese', async () => {
  await page.click('#dtClose');
  await page.evaluate(() => window.__select('hk-9'));
  await page.waitForSelector('#detail:not(.hidden)', { timeout: 10000 });
  await page.waitForTimeout(1500);
  const text = await page.textContent('#detail');
  if (!/What the Transport Department counts/.test(text)) throw new Error('no census traffic on Route 9');
  if (!/Tolo Highway/.test(text) || !/157,910/.test(text)) throw new Error('Route 9 does not name Tolo Highway as its busiest station');
  if (!/vehicles a day/.test(text)) throw new Error('Route 9 traffic has no unit');
  if (!/Remember the Numbers/.test(text)) throw new Error('Route 9 does not carry the route system history');
  if (!/Direct span\s*Ring/.test(text)) throw new Error('Route 9, a ring, still gives a direct span');
  await page.click('#btnSettings');
  await page.click('#langSeg [data-lang="zh"]');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  const zh = await page.textContent('#detail');
  await page.click('#btnSettings');
  await page.click('#langSeg [data-lang="en"]');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  if (!/吐露港公路/.test(zh) || /Tuen Mun Road/.test(zh)) throw new Error('Route 9 does not list its roads in Chinese');
  if (/Tolo Highway/.test(zh)) throw new Error('Route 9 census stations are still named in English in Chinese');
});

await step('the Sun Yat-sen Freeway dossier gives cost, funding and its ends the right way round', async () => {
  await page.click('#dtClose');
  await page.evaluate(() => window.__select('tw-fwy-1'));
  await page.waitForSelector('#detail:not(.hidden)', { timeout: 10000 });
  await page.waitForTimeout(1500);
  const text = await page.textContent('#detail');
  if (!/Sun Yat-sen Freeway/.test(text) || !/North–South Freeway/.test(text)) throw new Error('no dossier name or former name');
  if (!/NT\$42\.9 billion/.test(text) || !/Saudi Arabia/.test(text)) throw new Error('no construction cost or funder');
  const south = await page.textContent('#detail .termini .term.from');
  if (!/Southern/i.test(south) || !/Xinsheng Road/.test(south)) throw new Error(`the southern end reads ${south}`);
  if (/服務區|轉接道/.test(text)) throw new Error('service areas listed as roads it follows');
});

await step('Taiwanese freeways give the Freeway Bureau length and their ETC gantries', async () => {
  await page.click('#dtClose');
  await page.evaluate(() => window.__select('tw-fwy-8'));
  await page.waitForSelector('#detail:not(.hidden)', { timeout: 10000 });
  await page.waitForTimeout(1500);
  let text = await page.textContent('#detail');
  if (!/Freeway Bureau section chainage/.test(text)) throw new Error('no Freeway Bureau length on Fwy 8');
  if (!/Freeway Bureau ends/.test(await page.textContent('.termini'))) throw new Error('no Freeway Bureau ends on Fwy 8');
  if (!/lists no charging gantry/.test(text)) throw new Error('Fwy 8 does not say it has no gantry');
  await page.click('#dtClose');
  await page.evaluate(() => window.__select('tw-fwy-3'));
  await page.waitForSelector('#detail:not(.hidden)', { timeout: 10000 });
  await page.waitForTimeout(1500);
  text = await page.textContent('#detail');
  if (!/78 ETC gantries each way charge by distance over [\d.,]+ (km|mi)/.test(text)) throw new Error('Fwy 3 gives no tolled distance');
  if (!/樹林收費站/.test(text)) throw new Error('Fwy 3 lists no former toll station');
  if (/measures of the surface/.test(text)) throw new Error('a freeway shows the provincial roughness');
  await page.click('#dtClose');
  await jsClick('#btnTolls');
  await waitForSource('toll');
  if (!await page.locator('#legend .lg-pt').count() || await page.locator('#legend .lg-dash').count()) {
    throw new Error('East Asian toll key is not the gantry alone');
  }
  const pt = await page.evaluate(async () => {
    const d = await (await fetch('data/tolls.json')).json();
    const gs = d.features.filter((x) => x.properties.kind === 'gantry');
    const f = gs.find((x) => d.gantries[x.properties.id]?.number === '1' && !d.gantries[x.properties.id].viaduct && d.gantries[x.properties.id].at > 150);
    const map = window.__map;
    map.jumpTo({ center: f.geometry.coordinates, zoom: 13, pitch: 0, bearing: 0 });
    await new Promise((res) => map.once('idle', res));
    const p = map.project(f.geometry.coordinates);
    const r = map.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y, n: gs.length };
  });
  if (pt.n < 150) throw new Error(`expected over 150 gantries, found ${pt.n}`);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForSelector('.tl-pop .tl-meta', { timeout: 8000 });
  const pop = await page.textContent('.tl-pop');
  if (!/Southbound/.test(pop) || !/TWD/.test(pop)) throw new Error(`gantry popup lacks direction or price: ${pop.slice(0, 160)}`);
  await shot('20b-taiwan-gantry.png');
  if (!await page.locator('#legend .lg-ring').count()) throw new Error('no Hong Kong toll tunnel in the East Asian toll key');
  await jsClick('#btnTolls');
  if (await page.locator('.tl-pop').count()) throw new Error('gantry popup outlived its layer');
});

await step('mainland highway ports draw, placed by OpenStreetMap', async () => {
  await page.keyboard.press('Escape');
  await jsClick('#btnCrossings');
  await waitForSource('xing');
  if (await page.locator('#legend .lg-ring').count() !== 3) throw new Error('the East Asian key is not land borders, Hong Kong and Macao');
  const pt = await page.evaluate(async () => {
    const d = await (await fetch('data/crossings.json')).json();
    const cn = d.features.filter((x) => x.properties.country === 'cn');
    const f = cn.find((x) => x.properties.nameZh === '满洲里');
    const map = window.__map;
    map.jumpTo({ center: f.geometry.coordinates, zoom: 12, pitch: 0, bearing: 0 });
    await new Promise((res) => map.once('idle', res));
    const p = map.project(f.geometry.coordinates);
    const r = map.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y, n: cn.length };
  });
  if (pt.n < 60) throw new Error(`expected over 60 mainland ports, found ${pt.n}`);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForSelector('.xg-pop .xg-n', { timeout: 8000 });
  const pop = await page.textContent('.xg-pop');
  if (!/Manzhouli/.test(pop) || !/China–Russia/.test(pop) || !/Placed by OpenStreetMap/.test(pop)) throw new Error(`port popup: ${pop.slice(0, 160)}`);
  if (!/G10|G301/.test(pop)) throw new Error('Manzhouli lists no nearby route');
  await shot('20c-cn-port.png');
  await jsClick('#btnCrossings');
  if (await page.locator('.xg-pop').count()) throw new Error('port popup outlived its layer');
});

await step('Hong Kong Route 3 gives its tunnels\' time-varying tolls', async () => {
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__select('hk-3'));
  await page.waitForSelector('#detail:not(.hidden)', { timeout: 10000 });
  await page.waitForSelector('#dtTolls .tl-item', { timeout: 15000, state: 'attached' });
  const text = await page.textContent('#dtTolls');
  if (!/Western Harbour Crossing/.test(text) || !/Tai Lam Tunnel/.test(text)) throw new Error(`Route 3 tolls: ${text.slice(0, 160)}`);
  if (!/by time of day: 20–60 HKD/.test(text)) throw new Error('Route 3 does not give the crossing\'s time-varying range');
});

await step('a Chinese province loads its provincial roads', async () => {
  await page.click('#dtClose');
  await page.fill('#q', '');
  await sysClick('cn-provincial');
  await page.waitForSelector('[data-load="SCH"]', { timeout: 10000 });
  const title = await page.textContent('#sheet .sh-hd');
  if (!/province/i.test(title)) throw new Error(`picker titled ${title}`);
  await page.click('[data-load="SCH"]');
  const n = await waitForSource('st-SCH');
  if (n < 50) throw new Error(`only ${n} Sichuan provincial roads`);
});
await shot('22-sichuan.png');

await step('the switch flies back to North America', async () => {
  if (await page.locator('#menuLayers.open').count()) await page.click('#btnLayers');
  if (await page.locator('#detail:not(.hidden)').count()) await page.click('#dtClose');
  await page.click('#globeBtn');
  await page.click('.rcard[data-region="na"]');
  await page.waitForTimeout(3200);
  await page.keyboard.press('Escape');
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
