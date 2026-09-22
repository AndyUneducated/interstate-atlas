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
    return m ? m.querySourceFeatures('rt-us-interstate').length : -1;
  });
  if (n === -1) throw new Error('map not exposed');
  if (n === 0) throw new Error('no interstate features rendered');
});

await step('results list populated', async () => {
  await page.waitForSelector('#results .res', { timeout: 15000 });
  const n = await page.locator('#results .res').count();
  if (n < 10) throw new Error(`only ${n} results`);
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

// Closing whatever sheet the previous step opened. Not every step leaves one
// open, and a step must not fail because the thing it is tidying up after is
// already tidy.
const dismissSheet = async () => {
  const close = page.locator('#shClose');
  if (await close.count()) await close.click().catch(() => {});
};

await step('buildout scrubber opens and scrubs', async () => {
  await dismissSheet();
  await page.click('#btnTimeline');
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
  await page.click('.sys[data-sys="us-numbered"]');
  await waitForSource('rt-us-numbered');
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
  await page.click('.sys[data-sys="us-state"]');
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
  await page.click('[data-jump="ca"]');
  await page.waitForTimeout(2600);
  const n = await waitForSource('rt-ca-tch');
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
  await page.click('.sys[data-sys="ca-provincial"]');
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

await step('folding the panel leaves a key to the colours', async () => {
  // Collapsing took the system list away with it, and with it the only thing
  // saying which colour is which on a map that is unlabelled when zoomed out.
  await page.keyboard.press('Escape');
  await page.click('#btnCollapse');
  await page.waitForTimeout(900);
  const legend = await page.evaluate(() => {
    const el = document.getElementById('legend');
    if (!el) return null;
    return {
      shown: Number(getComputedStyle(el).opacity) > 0.5,
      rows: el.querySelectorAll('.lg-r').length,
      on: document.querySelectorAll('#sysList .sys.on').length,
      colours: [...el.querySelectorAll('.lg-dot')]
        .map((d) => getComputedStyle(d).backgroundColor),
    };
  });
  if (!legend) throw new Error('no legend element');
  if (!legend.shown) throw new Error('legend not visible with the panel folded');
  // A key to what is drawn, so it has to track the switches rather than list
  // all six: by this point in the run earlier steps have turned several on.
  if (legend.rows !== legend.on) {
    throw new Error(`legend lists ${legend.rows} systems but ${legend.on} are drawn`);
  }
  if (!legend.rows) throw new Error('legend is empty with systems drawn');
  if (new Set(legend.colours).size !== legend.rows) {
    throw new Error('legend swatches share a colour');
  }

  await page.click('#shellOpen');
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => Number(getComputedStyle(document.getElementById('legend')).opacity));
  if (after > 0.5) throw new Error('legend still showing once the panel is back');
});
await shot('17-collapsed-legend.png');

await step('the interface can be taken off the map and brought back', async () => {
  await page.keyboard.press('z');
  await page.waitForTimeout(900);
  const hidden = await page.evaluate(() => ({
    zen: document.body.classList.contains('zen'),
    hud: Number(getComputedStyle(document.getElementById('hud')).opacity),
    shell: Number(getComputedStyle(document.getElementById('shell')).opacity),
    out: Number(getComputedStyle(document.getElementById('zenOut')).opacity),
    // Hidden chrome must not still be catching clicks meant for the map.
    clicks: getComputedStyle(document.getElementById('hud')).pointerEvents,
  }));
  if (!hidden.zen) throw new Error('z did not hide the interface');
  if (hidden.hud > 0.05 || hidden.shell > 0.05) throw new Error('chrome still visible');
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
  await page.click('#btnTimeline');
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

console.log(`\nsteps failed:    ${failures}`);
console.log(`console errors:  ${errors.length}`);
for (const e of [...new Set(errors)].slice(0, 25)) console.log(`  ! ${e.slice(0, 300)}`);
console.log(`failed requests: ${failed.length}`);
for (const f of [...new Set(failed)].slice(0, 25)) console.log(`  ! ${f}`);

await browser.close();
process.exit(failures || errors.length || failed.length ? 1 : 0);
