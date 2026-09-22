// Downloads the Mexican source data into tools/src/mx/.
//
//   node tools/fetch-mexico.mjs
//   node tools/fetch-mexico.mjs --check   reports what is reachable, downloads nothing
//
// This is a long download over a link that has already failed once, so three
// things are true of every run. Nothing large is attempted until a one-byte
// request has proved the file is actually there and says how big it is. Bytes
// land in a `.part` file that is only renamed into place at full length, so a
// broken run resumes with a Range request instead of starting again. And
// everything worth knowing afterwards is appended to tools/src/mx/fetch.log,
// because nobody watches a transfer this size.
//
// The failure this was written against is worth naming, because it looks like
// a bug in this script and is not. A filtering resolver on some networks
// answers for repodatos.atdt.gob.mx with its own certificate and a block
// page; Node reports that as UNABLE_TO_VERIFY_LEAF_SIGNATURE, which reads
// like a broken publisher. The preflight below looks behind that error far
// enough to name the interceptor, and then refuses to download over it.
//
// Source: the Red Nacional de Caminos (RNC), generated jointly by INEGI, the
// Secretaría de Infraestructura, Comunicaciones y Transportes and the
// Instituto Mexicano del Transporte, and declared Información de Interés
// Nacional in the Diario Oficial de la Federación on 6 October 2014. It is the
// authoritative national road file: a routable ISO 14825 topological network
// digitised at 1:50,000, covering federal and state highways, rural roads,
// tracks and urban streets, with the route number, lane count, surface, toll
// status and administering authority on every segment. A new edition is
// published on 15 December each year.
//
// Where it is fetched from, and why not from INEGI directly. INEGI publishes
// the RNC as one national bundle of about 686 MB, behind a catalogue page
// whose download link is assembled in the browser; no stable direct URL for it
// could be confirmed, and a fetcher built on a guessed one would break
// silently at the next edition. The same product is published layer by layer
// through the national open-data portal by the IMT, one of the three agencies
// that make it, and the portal's catalogue API names the current file for each
// layer. So the URLs below are resolved at run time rather than written down,
// which also means the annual re-publication needs no code change.
//
// Only two layers are taken. red_vial is the road network itself; plaza_cobro
// is the toll plazas, which is what lets a tolled route be described by more
// than the Sí/No flag on its segments. The tariff table INEGI ships inside the
// national bundle is not published as a separate resource here, so tolls can
// be located but not priced.
//
// Shapefiles are not compressed, so what lands on disk is far larger than what
// came down the wire - roughly four times over. In the 2023 edition of
// red_vial the ratio was 486 MB of archive against 1.79 GB unpacked, and
// 1.15 GB of that is the attribute table alone. The archives are deleted once
// unpacked; the figure printed at the end of a run is measured, not estimated.

import { mkdir, writeFile, readFile, appendFile, rename, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { request as httpsRequest } from 'node:https';
import { listEntries, extractEntry } from './unzip.mjs';

const SRC = join(import.meta.dirname, 'src', 'mx');

const PORTAL = 'https://www.datos.gob.mx';
const DATASET = 'red_nacional_caminos_representacion_cartografica_formato_digital_georreferenciada';

// Ordered smallest first, as the Canadian fetcher is, so a run that dies
// partway still leaves something usable and the expensive layer is attempted
// last. Resources are matched on the name the catalogue gives them rather than
// on a file name, because the file names carry an ordinal prefix that has
// changed between editions.
export const LAYERS = [
  { key: 'plaza_cobro', name: 'Toll plazas', match: /plaza/i },
  { key: 'red_vial', name: 'Road network', match: /red\s*vial/i },
];

// The four files a shapefile is: geometry, index, attributes, projection.
const SHAPE_PARTS = /\.(shp|shx|dbf|prj)$/i;

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function sizeOf(path) {
  try { return (await stat(path)).size; } catch { return 0; }
}

/** The extracted shapefile for a layer, without its extension, or null. */
export async function layerPath(key) {
  const base = join(SRC, key);
  return (await exists(`${base}.shp`)) && (await exists(`${base}.dbf`)) ? base : null;
}

/* ── the log ────────────────────────────────────────────────────────────── */

// A download measured in hundreds of megabytes is not watched, so what
// happened to it has to be readable afterwards. Every run appends; the log is
// never truncated, because the useful question after a failed resume is what
// the previous attempt did.
const LOG = join(SRC, 'fetch.log');

async function log(line) {
  await mkdir(SRC, { recursive: true });
  await appendFile(LOG, `${new Date().toISOString()}  ${line}\n`);
}

/** Printed and kept. Progress ticks are not: they are noise on a timeline. */
async function say(line) {
  console.log(line);
  await log(line.trim());
}

/* ── the network between here and the publisher ─────────────────────────── */

async function get(url, { timeoutMs = 60000, headers = {} } = {}) {
  // No custom User-Agent: the catalogue answered 403 when one was sent, and
  // 200 to the runtime default.
  return fetch(url, { redirect: 'follow', headers, signal: AbortSignal.timeout(timeoutMs) });
}

// A certificate that will not verify is the signature of an intercepting
// middlebox, not of a publisher with a broken server.
const TLS_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_HAS_EXPIRED',
]);

/**
 * Who actually answered, when TLS verification says it was not the publisher.
 *
 * The interceptor presents its own certificate, and that certificate names
 * it. This asks once more with verification off purely to read that name and
 * the response headers, destroys the response before any body arrives, and
 * writes nothing. The point is to be able to report "a filter on this network
 * returned a block page" rather than "fetch failed" - not to download over a
 * connection that failed to verify, which is what the caller refuses to do.
 */
function peek(url) {
  return new Promise((resolve) => {
    const req = httpsRequest(url, { rejectUnauthorized: false, timeout: 20000 }, (res) => {
      const cert = res.socket.getPeerCertificate?.() ?? {};
      res.destroy();
      resolve({
        status: res.statusCode,
        headers: res.headers,
        issuer: cert.issuer?.O ?? cert.issuer?.CN ?? null,
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

/** Whether a response is a filter's block page wearing the publisher's URL. */
function blockedBy(headers) {
  const get_ = (k) => (typeof headers.get === 'function' ? headers.get(k) : headers[k]);
  if (get_('x-page-type') === 'blocked') {
    const app = get_('x-dnsfilter-app-url') || get_('x-app-url') || '';
    return `a content filter on this network (${app || 'unnamed'}) answered with its block page`;
  }
  return null;
}

/**
 * What a resource URL does when asked for, before any of it is downloaded.
 *
 * One byte is requested rather than the file, for two answers at once: the
 * total size comes back in Content-Range, and a 206 proves the server will
 * resume a part-finished download. Both are needed before committing to a
 * transfer this size, and asking costs nothing.
 */
async function probe(url) {
  let res;
  try {
    res = await get(url, { timeoutMs: 30000, headers: { Range: 'bytes=0-0' } });
  } catch (e) {
    const code = e?.cause?.code ?? e?.cause?.cause?.code ?? null;
    if (!TLS_CODES.has(code)) return { ok: false, why: `${e.message}${code ? ` (${code})` : ''}` };
    const seen = await peek(url);
    const blocked = seen && blockedBy(seen.headers);
    return {
      ok: false,
      why: blocked
        ? `${blocked}; its certificate is issued by ${seen.issuer ?? 'an unnamed authority'}, `
          + `which is why the verified request failed with ${code}`
        : `the certificate did not verify (${code}), so something on this network `
          + `is standing in for the publisher${seen?.issuer ? `; it identifies itself as ${seen.issuer}` : ''}`,
      intercepted: true,
    };
  }

  const blocked = blockedBy(res.headers);
  const type = res.headers.get('content-type') ?? '';
  const range = res.headers.get('content-range');
  res.body?.cancel().catch(() => {});

  if (blocked) return { ok: false, why: blocked, intercepted: true };
  if (res.status !== 206 && !res.ok) return { ok: false, why: `${res.status} ${res.statusText}` };
  // An archive does not arrive as a web page. A portal that has moved a file
  // answers 200 with HTML, and writing that to disk as red_vial.zip only
  // fails later, at unpacking, with a misleading complaint about the archive.
  if (/html|json/i.test(type)) {
    return { ok: false, why: `answered ${res.status} with ${type.split(';')[0]}, not an archive` };
  }

  const total = range ? Number(range.split('/')[1]) : Number(res.headers.get('content-length')) || 0;
  return { ok: true, total: Number.isFinite(total) ? total : 0, ranges: res.status === 206 };
}

/**
 * Ask about every layer before downloading any of it.
 *
 * The expensive layer is last, so a run that fails on the network would
 * otherwise spend its time on the small one and only then discover that the
 * large one was never going to arrive. Everything is probed first, and a run
 * with nothing reachable stops here rather than half an hour later.
 */
async function preflight(found) {
  await say('checking what this network can actually reach\n');
  const checks = new Map();
  for (const layer of LAYERS) {
    const resource = found.get(layer.key);
    if (!resource) {
      checks.set(layer.key, { ok: false, why: `the catalogue lists no resource matching ${layer.match}` });
      await say(`  ${layer.key.padEnd(12)} no such resource in the catalogue`);
      continue;
    }
    const res = await probe(resource.url);
    checks.set(layer.key, res);
    await say(res.ok
      ? `  ${layer.key.padEnd(12)} reachable  ${res.total ? size(res.total) : 'size not stated'}`
        + `, ${res.ranges ? 'resumable' : 'not resumable - a broken run restarts from zero'}`
      : `  ${layer.key.padEnd(12)} unreachable  ${res.why}`);
  }
  return checks;
}

async function resolveLayers() {
  const url = `${PORTAL}/api/3/action/package_show?id=${DATASET}`;
  const res = await get(url, { timeoutMs: 45000 });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from the datos.gob.mx catalogue`);
  const pkg = (await res.json()).result;
  const found = new Map();
  for (const layer of LAYERS) {
    const r = (pkg.resources ?? []).find((x) => layer.match.test(x.name ?? ''));
    if (r) found.set(layer.key, r);
  }
  return { pkg, found };
}

function unwrapFetch(err) {
  const code = err?.cause?.code ?? err?.cause?.cause?.code;
  return code ? `${err.message} (${code})` : err.message;
}

const mb = (n) => (n / 1048576).toFixed(0);

// Whole megabytes are the right unit for a 200 MB layer and the wrong one for
// a run that died after 400 KB, which would read as "0 MB" in the log line a
// reader uses to decide whether resuming is worth anything.
const size = (n) => {
  if (n >= 10485760) return `${(n / 1048576).toFixed(0)} MB`;
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
};

/**
 * Fetch an archive, picking up where the last attempt stopped.
 *
 * The road layer is most of 200 MB over a link that has already dropped
 * once, so a run that dies 90% through must not throw that away. Bytes go to
 * a `.part` file which is only renamed into place when the publisher's stated
 * length has arrived, so a truncated file can never be mistaken for a
 * complete one - and the next run asks for the rest of it with a Range
 * header instead of starting again.
 *
 * A server that ignores the Range header answers 200 with the whole file. In
 * that case whatever was on disk is wrong to append to and is dropped.
 */
async function download(url, dest, label, { ranges = true, total = 0 } = {}) {
  const part = `${dest}.part`;
  let have = await sizeOf(part);

  if (have && !ranges) {
    await say(`  ${label}  ${size(have)} on disk cannot be resumed; starting again`);
    await rm(part, { force: true });
    have = 0;
  }
  if (total && have >= total) {
    await rename(part, dest);
    await say(`  ${label}  already complete at ${size(have)}`);
    return have;
  }
  if (have) await say(`  ${label}  resuming at ${size(have)}${total ? ` of ${size(total)}` : ''}`);

  let res;
  try {
    // No overall deadline that could cut a good transfer short: a stalled
    // one is recovered by re-running, which now costs only the bytes missing.
    res = await get(url, {
      timeoutMs: 6 * 60 * 60 * 1000,
      headers: have ? { Range: `bytes=${have}-` } : {},
    });
  } catch (e) {
    throw new Error(`${unwrapFetch(e)} for ${url}`);
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);

  // A 200 is not proof of a file. A moved resource, and a filtering resolver
  // of the kind that sits in front of this host on some networks, both answer
  // with an HTML page and a success code. Either would land on disk as a few
  // hundred bytes named red_vial.zip and only fail later, at unpacking, with
  // a misleading message about the archive being broken.
  const blocked = blockedBy(res.headers);
  if (blocked) throw new Error(`${blocked} for ${url}`);
  const type = res.headers.get('content-type') ?? '';
  if (/html|json/i.test(type)) {
    throw new Error(`${url} answered ${res.status} with ${type.split(';')[0]}, not an archive`);
  }

  // Asked to resume and answered 200: the server sent the file from the top.
  const resuming = res.status === 206;
  if (have && !resuming) {
    await say(`  ${label}  the server ignored the resume request; starting again`);
    have = 0;
  }
  const expected = total
    || (Number(res.headers.get('content-length')) || 0) + (resuming ? have : 0);

  let seen = have;
  let lastShown = -5;
  const tick = new TransformStream({
    transform(chunk, ctrl) {
      seen += chunk.length;
      const pct = expected ? Math.floor((seen / expected) * 100) : 0;
      if (pct >= lastShown + 5) {
        lastShown = pct;
        const of = expected ? `/${mb(expected)}` : '';
        process.stdout.write(`\r  ${label}  ${String(pct).padStart(3)}%  ${mb(seen)}${of} MB   `);
      }
      ctrl.enqueue(chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(res.body.pipeThrough(tick)),
      createWriteStream(part, { flags: have ? 'a' : 'w' }),
    );
  } catch (e) {
    // Whatever arrived stays on disk. That is the whole point of the .part
    // file, and the log records how far it got so the next run is not a
    // guess about whether re-running is worth it.
    await log(`${label.trim()} interrupted at ${seen} bytes: ${unwrapFetch(e)}`);
    throw new Error(`${unwrapFetch(e)} after ${size(seen)} - re-run to resume`);
  }

  // Short of what the publisher said it would send is a broken transfer, not
  // a small file. It is left as .part so the next run continues it.
  if (expected && seen < expected) {
    await log(`${label.trim()} short: ${seen} of ${expected} bytes`);
    throw new Error(`${size(seen)} of ${size(expected)} arrived - re-run to resume`);
  }

  await rename(part, dest);
  await say(`\r  ${label}  downloaded ${size(seen)}                     `);
  return seen;
}

async function fetchLayer(layer, resource, check) {
  const label = `${layer.key.padEnd(12)} ${layer.name.padEnd(13)}`;
  if (await layerPath(layer.key)) { await say(`have   ${label}`); return null; }

  await mkdir(SRC, { recursive: true });
  const zip = join(SRC, `${layer.key}.zip`);
  let downloaded = null;
  if (!(await exists(zip))) downloaded = await download(resource.url, zip, label, check);

  // An archive that will not open is thrown away rather than kept. Where the
  // server states no length there is nothing to check a transfer against, so
  // a truncated file reaches this point looking finished; leaving it on disk
  // would make every later run skip the download and fail here again, on the
  // same broken bytes, forever.
  let entries;
  let wanted;
  try {
    process.stdout.write(`\r  ${label}  unpacking...                    `);
    entries = await listEntries(zip);
    wanted = entries.filter((e) => SHAPE_PARTS.test(e.name));
    if (!wanted.some((e) => /\.shp$/i.test(e.name))) throw new Error(`no shapefile inside ${layer.key}.zip`);
  } catch (e) {
    await rm(zip, { force: true });
    await log(`${label.trim()} unusable archive discarded: ${e.message}`);
    throw new Error(`${e.message} - the archive was discarded; re-run to download it again`);
  }

  // Everything is renamed to the layer key. The archives name their files for
  // the edition - rvrnc23gw one year, red_vial the next - so reading them back
  // by name would mean the reader having to know which edition is on disk.
  let bytes = 0;
  for (const e of wanted) {
    const ext = e.name.slice(e.name.lastIndexOf('.')).toLowerCase();
    await extractEntry(zip, e, join(SRC, `${layer.key}${ext}`));
    bytes += e.size;
  }
  await rm(zip, { force: true });

  await say(`\r  ${label}  ok  ${wanted.length} files, ${size(bytes)} on disk`
    + `${downloaded ? ` from ${size(downloaded)} downloaded` : ''}                 `);
  return { files: wanted.length, bytes, downloaded, names: wanted.map((e) => e.name) };
}

/**
 * The edition year, taken from whatever states it rather than worked out.
 *
 * The RNC is published every 15 December and named for that year, but the
 * open-data distribution does not carry the edition as a field. It does carry
 * it in the file names - the 2023 road layer is rvrnc23gw - so that is where
 * it is read from, and where no year is written the field is left null. It is
 * deliberately not inferred from the date the portal was last updated: an
 * edition published in December and reloaded the following March would come
 * out a year late, and a wrong citation is worse than an incomplete one.
 */
function editionFrom(names) {
  for (const n of names) {
    const full = /(?:^|[^0-9])(20\d{2})(?:[^0-9]|$)/.exec(n);
    if (full) return Number(full[1]);
    const short = /rnc(\d{2})/i.exec(n);
    if (short) return 2000 + Number(short[1]);
  }
  return null;
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  await mkdir(SRC, { recursive: true });
  await say(`fetching the Red Nacional de Caminos - ${LAYERS.length} layers`
    + `${checkOnly ? ' (checking only, nothing will be downloaded)' : ''}\n`);

  let pkg = null;
  let found = new Map();
  try {
    ({ pkg, found } = await resolveLayers());
  } catch (e) {
    await say(`  could not read the catalogue: ${unwrapFetch(e)}`);
  }

  const checks = await preflight(found);
  const reachable = [...checks.values()].filter((c) => c.ok).length;

  if (checkOnly) {
    await say(`\n${reachable} of ${LAYERS.length} layers reachable from this network`);
    process.exitCode = reachable === LAYERS.length ? 0 : 1;
    return;
  }
  // Nothing reachable is a network verdict, not a download problem, and the
  // reason is already printed above. Starting the transfers anyway would
  // bury it under two more identical failures.
  if (!reachable) {
    await say('\nnothing is reachable, so nothing was downloaded. '
      + 'The addresses are the publisher\'s; what answered them was not. '
      + 'Re-run from a network that does not intercept repodatos.atdt.gob.mx.');
    process.exitCode = 1;
    return;
  }

  const failed = [];
  const layers = {};
  const names = [];
  console.log('');
  for (const layer of LAYERS) {
    const resource = found.get(layer.key);
    const check = checks.get(layer.key);
    if (!resource || !check?.ok) {
      failed.push(layer.key);
      await say(`  ${layer.key.padEnd(12)} skipped: ${check?.why ?? 'not in the catalogue'}`);
      continue;
    }
    try {
      const got = await fetchLayer(layer, resource, check);
      layers[layer.key] = got
        ? { files: got.files, bytes: got.bytes, url: resource.url }
        : { url: resource.url };
      if (got) names.push(...got.names);
    } catch (e) {
      failed.push(layer.key);
      await say(`\r  ${layer.key.padEnd(12)} FAILED: ${e.message}                              `);
    }
  }

  // Provenance travels with the data. The Términos de Libre Uso let the RNC be
  // adapted and redistributed, commercially included, on two conditions: that
  // INEGI is credited in the form below together with the date of the data
  // used, and that any transformation is disclosed so the result is not taken
  // for INEGI's own work. This atlas simplifies the geometry for drawing and
  // reassembles fragments into routes, both of which are transformations, so
  // the second condition is not incidental. It is recorded here and shown on
  // the site rather than left to the reader to assume.
  // A re-run that downloads nothing must not rewrite what the first run
  // established. The edition year is only legible while the archives are being
  // unpacked, and the retrieval date belongs to the day the data actually came
  // down - so both are carried over from the existing file when this run was a
  // no-op, and a second run does not silently date the data to today or blank
  // the edition because it had no file names to read it from.
  const previous = await readFile(join(SRC, 'edition.json'), 'utf8')
    .then(JSON.parse).catch(() => ({}));
  const fresh = names.length > 0;
  const retrieved = fresh ? new Date().toISOString().slice(0, 10)
    : previous.retrieved ?? new Date().toISOString().slice(0, 10);
  const edition = editionFrom(names) ?? previous.edition ?? null;

  // Nothing on disk means nothing to describe. Writing provenance for data
  // that was never retrieved would leave a file claiming a source the build
  // does not have.
  if (!Object.keys(layers).length) {
    await say('\nno layers retrieved; tools/src/mx/ holds no shapefile and no edition.json was written');
    await say(`missing: ${failed.join(', ')} - re-run to retry`);
    process.exitCode = 1;
    return;
  }

  await writeFile(join(SRC, 'edition.json'), `${JSON.stringify({
    source: 'INEGI, SICT and IMT, Red Nacional de Caminos (RNC)',
    programme: 'https://www.inegi.org.mx/programas/rnc/',
    distribution: `${PORTAL}/dataset/${DATASET}`,
    licence: 'INEGI, Términos de Libre Uso de la Información',
    licenceUrl: 'https://www.inegi.org.mx/inegi/terminos.html',
    attribution: `Fuente: INEGI, Red Nacional de Caminos (RNC)${edition ? `, ${edition}` : ''}`,
    transformation: 'Geometry simplified for drawing at approximately 1:1,000,000, '
      + 'and road fragments reassembled into routes. Neither is INEGI\'s work and '
      + 'neither is presented as it.',
    edition,
    updated: pkg?.metadata_modified?.slice(0, 10) ?? null,
    retrieved,
    layers,
  }, null, 2)}\n`);

  const onDisk = Object.values(layers).reduce((a, l) => a + (l.bytes ?? 0), 0);
  await say(`\nMexican source data ready in tools/src/mx/  (${Object.keys(layers).length}/${LAYERS.length} layers`
    + `${onDisk ? `, ${(onDisk / 1073741824).toFixed(2)} GB on disk` : ''})`);
  await say(edition
    ? `RNC edition ${edition}, retrieved ${retrieved}`
    : 'the distribution states no edition year; edition.json records null rather than a guess');
  if (failed.length) {
    await say(`missing: ${failed.join(', ')} - re-run to retry`);
    process.exitCode = 1;
  }
}

// Run only when invoked directly; mexico.mjs imports layerPath from here.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
