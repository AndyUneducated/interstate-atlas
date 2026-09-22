// Reads the Red Nacional de Caminos into route groups shaped like the American
// and Canadian ones, so the rest of the build does not care which country a
// road is in.
//
// Two tiers, and both are designations rather than inventions:
//
//   federal   A carretera federal, numbered MEX-xxx by the SICT. The network
//             the federation signs, maintains and tolls.
//
//   state     A carretera numbered by the state that administers it, written
//             with that state's prefix - EM-057 in the State of Mexico, and
//             so on for the other thirty-one.
//
// Which of the two a road belongs to is not written in its number. CODIGO
// holds a bare "15" whether the road is federal or not, so the tier comes
// from ADMINISTRA and JURISDI, the two fields that say who maintains the road
// and who has authority over it. That is a fact about the road rather than an
// inference from its geometry, which is the only kind of tier this atlas will
// assign.
//
// The RNC is a routable network rather than a drawn map, and it is richer than
// either northern source: every segment carries its lane count, surface
// material, toll status, administering authority, carriageway direction and
// the level it sits at relative to the ground. It has no functional
// classification at all, though, so nothing here says "freeway". Mexico signs
// autopistas de cuota, but the road file does not mark them as a class, and
// inferring one from the toll flag would call every tolled bridge a motorway.
// The composition bar therefore reads Primary, Secondary, Local and Unpaved
// and stops there.
//
// Two fields look useful and are not, and both are disclaimed by INEGI's own
// technical document rather than merely doubted here:
//
//   VELOCIDAD   exists to estimate travel times for route calculation, is
//               assigned at the analyst's discretion, and has no official
//               standing and no relation to posted limits. It is surfaced
//               under the name routingSpeed and must never be shown the way
//               the Canadian file's SPEED is.
//
//   ESCALA_VIS  is a drawing hint - at which zoom a road should appear - and
//               is explicitly not a classification of the road. It is not
//               read at all.

import * as shapefile from 'shapefile';
import { open, readFile } from 'node:fs/promises';
import { simplify } from './geo.mjs';
import { layerPath } from './fetch-mexico.mjs';

/**
 * The RNC's own sentinels, which are values rather than blanks.
 *
 * The data dictionary defines two, and writes both into the field as literal
 * text: N/A where an attribute does not apply to this kind of object - the
 * route number of a roundabout - and N/D where it applies but could not be
 * captured. A reader that trusts the field finds hundreds of thousands of
 * roads named "N/D".
 */
const BLANK = new Set(['N/A', 'N/D', 'NA', 'ND', '', '-']);
export const clean = (v) => {
  const s = String(v ?? '').trim();
  return s && !BLANK.has(s.toUpperCase()) ? s : null;
};

// INEGI's catalogue of federal entities, which is what JURISDI holds: either
// the two-digit key or the abbreviation the dictionary prints beside it. 33 is
// not a state - it marks a road the federation has jurisdiction over - so it
// is kept out of the table and answered separately.
export const STATES = {
  '01': { code: 'AGU', abbr: 'Ags.', name: 'Aguascalientes' },
  '02': { code: 'BCN', abbr: 'B.C.', name: 'Baja California' },
  '03': { code: 'BCS', abbr: 'B.C.S.', name: 'Baja California Sur' },
  '04': { code: 'CAM', abbr: 'Camp.', name: 'Campeche' },
  '05': { code: 'COA', abbr: 'Coah.', name: 'Coahuila' },
  '06': { code: 'COL', abbr: 'Col.', name: 'Colima' },
  '07': { code: 'CHP', abbr: 'Chis.', name: 'Chiapas' },
  '08': { code: 'CHH', abbr: 'Chih.', name: 'Chihuahua' },
  '09': { code: 'CMX', abbr: 'CDMX', name: 'Ciudad de México' },
  10: { code: 'DUR', abbr: 'Dgo.', name: 'Durango' },
  11: { code: 'GUA', abbr: 'Gto.', name: 'Guanajuato' },
  12: { code: 'GRO', abbr: 'Gro.', name: 'Guerrero' },
  13: { code: 'HID', abbr: 'Hgo.', name: 'Hidalgo' },
  14: { code: 'JAL', abbr: 'Jal.', name: 'Jalisco' },
  15: { code: 'MEX', abbr: 'Mex.', name: 'México' },
  16: { code: 'MIC', abbr: 'Mich.', name: 'Michoacán' },
  17: { code: 'MOR', abbr: 'Mor.', name: 'Morelos' },
  18: { code: 'NAY', abbr: 'Nay.', name: 'Nayarit' },
  19: { code: 'NLE', abbr: 'N.L.', name: 'Nuevo León' },
  20: { code: 'OAX', abbr: 'Oax.', name: 'Oaxaca' },
  21: { code: 'PUE', abbr: 'Pue.', name: 'Puebla' },
  22: { code: 'QUE', abbr: 'Qro.', name: 'Querétaro' },
  23: { code: 'ROO', abbr: 'Q.Roo.', name: 'Quintana Roo' },
  24: { code: 'SLP', abbr: 'S.L.P.', name: 'San Luis Potosí' },
  25: { code: 'SIN', abbr: 'Sin.', name: 'Sinaloa' },
  26: { code: 'SON', abbr: 'Son.', name: 'Sonora' },
  27: { code: 'TAB', abbr: 'Tab.', name: 'Tabasco' },
  28: { code: 'TAM', abbr: 'Tamps.', name: 'Tamaulipas' },
  29: { code: 'TLA', abbr: 'Tlax.', name: 'Tlaxcala' },
  30: { code: 'VER', abbr: 'Ver.', name: 'Veracruz' },
  31: { code: 'YUC', abbr: 'Yuc.', name: 'Yucatán' },
  32: { code: 'ZAC', abbr: 'Zac.', name: 'Zacatecas' },
};

const FEDERATION = '33';

// Accent-blind and punctuation-blind, because the same state is written four
// ways across the sources this has to meet: "Coahuila" in the road file
// against "Coahuila de Zaragoza" formally, "México" the state against "Estado
// de México" in the traffic file, and "Q.Roo." against "Quintana Roo".
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]/g, '');

const BY_NAME = new Map();
for (const [key, st] of Object.entries(STATES)) {
  for (const v of [key, st.code, st.abbr, st.name]) BY_NAME.set(fold(v), { key, ...st });
}
for (const [alias, of] of [
  ['Coahuila de Zaragoza', 'Coahuila'],
  ['Michoacán de Ocampo', 'Michoacán'],
  ['Veracruz de Ignacio de la Llave', 'Veracruz'],
  ['Estado de México', 'México'],
  ['Distrito Federal', 'Ciudad de México'],
]) BY_NAME.set(fold(alias), BY_NAME.get(fold(of)));

/** The federal entity a JURISDI value or a written state name refers to. */
export function state(v) {
  const raw = String(v ?? '').trim();
  if (!raw) return null;
  if (raw === FEDERATION || ['FED', 'FEDERACION'].includes(fold(raw))) {
    return { key: FEDERATION, code: 'FED', abbr: 'Fed.', name: 'Federación' };
  }
  return BY_NAME.get(fold(raw)) ?? null;
}

/* ══════════════════════════════════════════════════════════════════════════
   Reading the designation out of CODIGO
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * A Mexican route number.
 *
 * The written form of a designation is a prefix, a hyphen, a number and
 * sometimes a letter: MEX-015D for the tolled Mexico City to Guadalajara road,
 * EM-057 for a State of Mexico route. Three things have to be normalised
 * before two spellings of one road can meet.
 *
 * An all-digit number is zero-padded to three, because the sources write both
 * MEX-15D and MEX-015D and they are the same highway. A designation made of
 * letters rather than digits - EM-HGO, the road towards Hidalgo - is left
 * alone, there being nothing to pad.
 *
 * The hyphen is not always present and neither is the prefix. A bare "15D"
 * appears, as does "MEX 15 D", and CODIGO in the road file is bare throughout
 * - see readRedVial, which supplies the prefix from the road's jurisdiction.
 *
 * The trailing D means cuota, a toll road, and is part of the designation
 * rather than a modifier on it. The signage manual published in the Diario
 * Oficial de la Federación in 2024 gives sign SII-8 as the escudo for a
 * carretera federal directa de cuota, and the shield carries the D. MEX-015
 * and MEX-015D are two parallel roads between the same places, one free and
 * one tolled, so folding them together would merge a highway with its own
 * bypass.
 */
const ROUTE = /^([A-Z]{2,3})?[\s-]*([0-9]{1,4}|[A-Z]{2,4})[\s-]*([A-Z])?$/;

const rejected = new Map();
export function rejectedNumbers() { return rejected; }

/**
 * The routes a written designation names, normalised, or an empty list.
 *
 * A value can name two routes where they run concurrently, which the sources
 * write with a slash or a comma.
 *
 * Shared with the traffic fetcher, which reads route numbers out of a `ruta`
 * column written by a different agency and in the full MEX-045 form. Both have
 * to normalise the same way or the traffic will not find the road.
 */
export function normaliseRoute(value, onReject = null) {
  const raw = clean(value);
  if (!raw) return [];

  const out = [];
  for (const piece of raw.toUpperCase().split(/[/,;]+/)) {
    const text = piece.trim();
    if (!text) continue;
    const m = ROUTE.exec(text);
    if (!m) { onReject?.(text); continue; }
    const [, prefix, body, suffix] = m;
    out.push({
      prefix: prefix ?? null,
      number: `${/^\d+$/.test(body) ? body.padStart(3, '0') : body}${suffix ?? ''}`,
      // The designation can say tolled and so can PEAJE. The two are made
      // independently, so readRedVial compares them rather than trusting one.
      toll: suffix === 'D',
    });
  }
  return [...new Map(out.map((r) => [`${r.prefix}-${r.number}`, r])).values()];
}

/**
 * The routes a CODIGO value designates.
 *
 * CODIGO is populated only where TIPO_VIAL is "Carretera"; the dictionary
 * fills it with N/A everywhere else, and reading those as numbers would give
 * Mexico one road made of every roundabout in the country. So `tipoVial` is a
 * guard, not a hint.
 *
 * What CODIGO actually holds, measured over the whole layer, is a bare number
 * - 15, 200, 45 - with no prefix and no suffix on 99.6% of numbered segments.
 * The rest are worth knowing about:
 *
 *   999-A, 999-B    lettered variants of a number, a few segments each, read
 *                   as part of the number the way an American 2A is
 *   99-9, 999-99    a road numbered off the highway it leaves, in the same
 *                   hierarchical style Newfoundland uses in the Canadian
 *                   source. 713 segments, and they are addresses rather than
 *                   designations, so they are refused
 *   Q99, S99, G-99  three prefixes the data dictionary does not define. 341
 *                   segments, refused rather than guessed at
 *
 * There is no D suffix anywhere in the field. Mexico's tolled federal routes
 * are signed with one, and SICT's own traffic file writes them that way, but
 * the road file carries toll status only in PEAJE. So the suffix is parsed,
 * because it arrives from the other source, and the cross-check readRedVial
 * runs against PEAJE reports how many segments carry it - which in the edition
 * this was written against is none of them.
 */
export function parseRoute(codigo, tipoVial) {
  if (String(tipoVial ?? '').trim().toLowerCase() !== 'carretera') return [];
  return normaliseRoute(codigo, (v) => rejected.set(v, (rejected.get(v) ?? 0) + 1));
}

/** The designation as it is written: MEX-015D, EM-057. */
export const routeId = (r) => `${r.prefix}-${r.number}`;

/**
 * The prefix a jurisdiction's route numbers carry.
 *
 * ISO 3166-2 subdivision codes, with one exception. The State of Mexico's ISO
 * code is MEX, which is the three letters the federal network already uses,
 * and its own shields read EM - so EM it is, and it is the only state where
 * the two could have been confused in the first place.
 */
export const routePrefix = (st) => (st?.key === FEDERATION ? 'MEX'
  : st?.code === 'MEX' ? 'EM' : st?.code ?? null);

/* ══════════════════════════════════════════════════════════════════════════
   Reading the layer
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Which character encoding the attribute table is in.
 *
 * It matters more here than it looks. Half the RNC's controlled vocabulary is
 * accented - Periférico, Prolongación, "En operación" - so reading the table
 * in the wrong encoding does not merely spoil a few place names: it stops
 * every one of those values matching, and a road file whose CONDICION never
 * equals "En operación" comes out as a country with no open roads. That is
 * exactly what it did before this was checked.
 *
 * The shapefile library assumes Windows-1252, which was right for the format's
 * generation and is wrong for this file. A .cpg sidecar declares the encoding
 * where a producer ships one; the RNC does not, so the table is sniffed
 * instead.
 *
 * Only the records are looked at. A dBASE header carries the record count and
 * the field flags as binary, so a sample taken from the front of the file
 * contains bytes that are not text in any encoding, and sniffing over it
 * concludes the file is Latin-1 every time. The header length is at offset 8,
 * and the last few bytes of the sample go too, because a fixed-width record
 * can be cut mid-character.
 */
async function dbfEncoding(base) {
  try {
    const cpg = (await readFile(`${base}.cpg`, 'utf8')).trim().toLowerCase();
    if (cpg) return /utf-?8/.test(cpg) ? 'utf-8' : cpg;
  } catch { /* no sidecar, which is the usual case */ }

  const fh = await open(`${base}.dbf`, 'r');
  try {
    const head = Buffer.allocUnsafe(32);
    await fh.read(head, 0, 32, 0);
    const buf = Buffer.allocUnsafe(1 << 22);
    const { bytesRead } = await fh.read(buf, 0, buf.length, head.readUInt16LE(8));
    const sample = buf.subarray(0, Math.max(0, bytesRead - 3));
    if (!sample.some((b) => b >= 0x80)) return 'utf-8';
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(sample);
      return 'utf-8';
    } catch {
      return 'windows-1252';
    }
  } finally {
    await fh.close();
  }
}

// TIPO_VIAL mapped onto the vocabulary the American and Canadian sides already
// use, so a composition bar means the same thing in all three countries. There
// is no Freeway in it, for the reason given in the header.
const TYPE_OF_VIAL = {
  Carretera: 'Primary',
  Periférico: 'Primary',
  Viaducto: 'Primary',
  'Eje vial': 'Primary',
  Camino: 'Secondary',
  Calzada: 'Secondary',
  Boulevard: 'Secondary',
  Avenida: 'Secondary',
  Calle: 'Local',
  Privada: 'Local',
  Prolongación: 'Local',
  Andador: 'Local',
  Peatonal: 'Local',
  Vereda: 'Unpaved',
  Brecha: 'Unpaved',
  Enlace: 'Ramp',
  'Rampa de frenado': 'Ramp',
  Retorno: 'Ramp',
  'Retorno U': 'Ramp',
  Glorieta: 'Ramp',
};

// CIRCULA read as whether the road is divided, exactly as the Canadian file's
// TRAFFICDIR is: a carriageway carrying one direction belongs to a divided
// road, one carrying both does not. It is the weaker of the two readings,
// because a one-way street is also "Un sentido" - but only carreteras get
// this far, and a one-way carretera is a carriageway.
const DIVIDED = {
  'Un sentido': 'Divided',
  'Dos sentidos': 'Undivided',
};

// CONDICION. Planned and closed-for-construction segments are drawn in the
// file but are not road yet, and counting them would have the atlas measure
// highways that do not exist.
const OPEN = new Set(['En operación', 'En construcción - abierto']);

// Every controlled vocabulary above is looked up accent-blind. The encoding is
// established before the file is read, so this should never be load-bearing -
// but the failure it guards against is silent and total, and a lookup table
// that quietly matches nothing is not something a build would notice.
const folded = (table) => new Map(Object.entries(table).map(([k, v]) => [fold(k), v]));
const VIAL_BY_FOLD = folded(TYPE_OF_VIAL);
const DIVIDED_BY_FOLD = folded(DIVIDED);
const OPEN_BY_FOLD = new Set([...OPEN].map(fold));
const PAVED = fold('Con pavimento');
const UNPAVED = fold('Sin pavimento');

const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const positive = (v) => (num(v) > 0 ? num(v) : null);

/**
 * Read the road network into route groups, keyed by system and number.
 *
 * Only numbered carreteras become routes. The RNC is a complete road file down
 * to footpaths - over two million lines, of which the numbered federal and
 * state network is a small fraction - so everything else is either dropped or,
 * for an unnumbered carretera, kept as context geometry the way TIGER's
 * primary roads are.
 *
 * Geometry is thinned on the way in, both to keep the country in memory at
 * once and because the source is digitised at 1:50,000 while the atlas draws
 * at roughly 1:1,000,000. Endpoints are never moved, so the stitcher still
 * joins fragment to fragment.
 */
export async function readRedVial({
  groups = new Map(), tol = 0.0008, context = null, base = null, onProgress = null,
} = {}) {
  const path = base ?? await layerPath('red_vial');
  if (!path) return null;

  const encoding = await dbfEncoding(path);
  const src = await shapefile.open(`${path}.shp`, `${path}.dbf`, { encoding });
  const counts = {
    read: 0, kept: 0, carreteras: 0, numbered: 0, padded: 0, concurrent: 0,
    notOpen: 0, unplaceable: 0, suffixD: 0, peajeYes: 0, tollAgree: 0, tollDisagree: 0,
  };
  const types = new Map();

  for (;;) {
    const r = await src.read();
    if (r.done) break;
    counts.read++;
    if (onProgress && counts.read % 200000 === 0) onProgress(counts.read);

    const p = r.value.properties;
    const g = r.value.geometry;
    if (!g) continue;

    const tipo = clean(p.TIPO_VIAL);
    types.set(tipo, (types.get(tipo) ?? 0) + 1);

    const condicion = clean(p.CONDICION);
    if ((condicion && !OPEN_BY_FOLD.has(fold(condicion)))
      || fold(clean(p.ESTATUS)) === fold('Deshabilitado')) {
      counts.notOpen++;
      continue;
    }

    const parts = g.type === 'LineString' ? [g.coordinates]
      : g.type === 'MultiLineString' ? g.coordinates : [];
    if (!parts.length) continue;

    if (tipo === 'Carretera') counts.carreteras++;
    const parsed = parseRoute(p.CODIGO, tipo);

    // CODIGO is a bare number, so what makes a road federal is who administers
    // it, not how it is written. ADMINISTRA says that directly; JURISDI says
    // it a second way, by naming the federation instead of a state. Either is
    // taken, because a segment can carry one and not the other.
    const jur = state(p.JURISDI);
    const admin = clean(p.ADMINISTRA);
    const federal = admin === 'Federal' || jur?.key === FEDERATION;
    const prefix = federal ? 'MEX' : routePrefix(jur);
    const routes = parsed
      .map((r) => ({ ...r, prefix: r.prefix ?? prefix, system: (r.prefix ?? prefix) === 'MEX' ? 'federal' : 'state' }))
      // A numbered carretera whose jurisdiction is neither the federation nor
      // a named state cannot be given a designation without deciding which
      // state it belongs to from its position, which is the kind of guess this
      // atlas does not make. It is counted and left out.
      .filter((r) => r.prefix);
    if (parsed.length && !routes.length) counts.unplaceable++;

    if (!routes.length) {
      // An unnumbered carretera is real road and worth drawing faintly beneath
      // the numbered network, the way TIGER's unnumbered arterials are. Urban
      // streets and footpaths are not: there are millions of them.
      if (context && tipo === 'Carretera') {
        for (const part of parts) if (part.length >= 2) context.push(part);
      }
      continue;
    }
    counts.numbered++;
    if (routes.length > 1) counts.concurrent++;
    // How often the padding above did something, so that a source which stops
    // writing short numbers shows up as this falling to zero rather than as
    // routes quietly splitting in two.
    if (/^\d{1,2}[A-Z]?$/.test(clean(p.CODIGO)?.replace(/^[A-Z]{2,3}[\s-]*/i, '') ?? '')) counts.padded++;

    const peaje = clean(p.PEAJE);
    const tolled = peaje == null ? null : /^s[ií]$/i.test(peaje);
    // The D suffix and the PEAJE flag are two independent statements about the
    // same segment, one from the designation and one from the inventory. Where
    // they disagree one of them is wrong, and the count is reported rather
    // than silently resolved: a free stretch of a road numbered D is usually a
    // toll-free access section, and a tolled segment on an undesignated number
    // is usually a bridge. Where CODIGO carries no suffix at all the
    // comparison has nothing to say, which is itself worth reporting.
    const designatedToll = routes.some((x) => x.toll);
    if (designatedToll) counts.suffixD++;
    if (tolled) counts.peajeYes++;
    if (tolled != null) {
      if (designatedToll === tolled) counts.tollAgree++;
      else counts.tollDisagree++;
    }

    const pav = fold(clean(p.COND_PAV));

    const props = {
      type: pav === UNPAVED ? 'Unpaved' : (VIAL_BY_FOLD.get(fold(tipo)) ?? 'Unknown'),
      state: jur?.code ?? null,
      divided: DIVIDED_BY_FOLD.get(fold(clean(p.CIRCULA))) ?? null,
      tipoVial: tipo,
      name: clean(p.NOMBRE),
      lanes: positive(p.CARRILES),
      paved: pav === PAVED ? true : pav === UNPAVED ? false : null,
      surface: clean(p.RECUBRI),
      toll: tolled,
      administra: clean(p.ADMINISTRA),
      // Metres in the source; kilometres everywhere in this atlas.
      sourceKm: positive(p.LONGITUD) == null ? null : positive(p.LONGITUD) / 1000,
      width: positive(p.ANCHO),
      // Zero is ground level, so anything else is a grade separation. It is
      // the only thing in the file that distinguishes an interchange from a
      // crossroads.
      level: num(p.NIVEL),
      // Named for what it is, and not for what it looks like. See the header:
      // this is a routing parameter, not a speed limit, and the field name is
      // the only thing standing between it and a panel that claims one.
      routingSpeed: positive(p.VELOCIDAD),
      // The topological node ids at either end. The RNC is a routable network,
      // so unlike the other two sources it already knows what joins what.
      nodes: [num(p.UNION_INI), num(p.UNION_FIN)],
    };

    for (const route of routes) {
      // Federal numbers are national, so their pieces group across state lines
      // and stitch into one road. A state number means nothing outside its own
      // state, and the prefix already carries which state that is.
      const key = `${route.system}|${routeId(route)}`;
      let grp = groups.get(key);
      if (!grp) {
        grp = {
          system: route.system,
          prefix: route.prefix,
          number: route.number,
          id: routeId(route),
          country: 'MX',
          administra: new Set(),
          parts: [],
          names: new Set(),
          // The states with legal authority over the road, which is what
          // JURISDI records - not the states it runs through. A federal
          // highway crossing eight of them says "Fed." on every segment and
          // arrives here with this empty. Where the road physically is has to
          // be measured from the geometry, as it is for the other two
          // countries.
          jurisdictions: new Set(),
        };
        groups.set(key, grp);
      }
      // NOMBRE is the tramo designation - "Atlacomulco - Maravatío (Cuota)" -
      // so a route accumulates the origin-destination pairs it is built from
      // rather than one name. They are the closest thing the source has to
      // termini stated by the publisher.
      if (props.name) grp.names.add(props.name);
      if (jur && jur.key !== FEDERATION) grp.jurisdictions.add(jur.code);
      // Who maintains the road, kept per route rather than per segment,
      // because a state route with municipal stretches is a real thing and the
      // tier a route is shown under should be able to say so.
      if (admin) grp.administra.add(admin);
      for (const part of parts) {
        if (part.length < 2) continue;
        grp.parts.push({ coords: part.length > 2 ? simplify(part, tol) : part, props });
      }
      counts.kept++;
    }
  }

  return { groups, types, encoding, ...counts };
}

/**
 * Read the whole country.
 *
 * One layer, unlike Canada's thirteen, because the RNC is published nationally
 * rather than jurisdiction by jurisdiction.
 */
export async function loadMexico(_root, { context = null, base = null } = {}) {
  const path = base ?? await layerPath('red_vial');
  if (!path) {
    console.log('  MX  missing; run tools/fetch-mexico.mjs');
    return null;
  }

  const res = await readRedVial({ context, base: path });
  console.log(`  MX  ${String(res.read).padStart(7)} segments -> `
    + `${String(res.groups.size).padStart(4)} numbered routes`
    + `  (${res.carreteras} carreteras, ${res.numbered} of them numbered, ${res.encoding})`);
  if (res.notOpen) {
    console.log(`      ${res.notOpen} segments planned, under construction or disabled, left out`);
  }
  // A data-quality signal rather than a correction. The two toll statements
  // are made independently, so how often they disagree says how far either can
  // be trusted; printing it every build means a change in it is visible.
  const tollSeen = res.tollAgree + res.tollDisagree;
  if (!res.suffixD) {
    console.log(`      no CODIGO carries a D suffix; PEAJE alone marks the ${res.peajeYes}`
      + ' tolled segments, so the two cannot be cross-checked');
  } else if (tollSeen) {
    console.log(`      D suffix and PEAJE agree on ${((res.tollAgree / tollSeen) * 100).toFixed(1)}%`
      + ` of ${tollSeen} numbered segments (${res.suffixD} designated D, ${res.peajeYes} flagged`
      + `, ${res.tollDisagree} disagree)`);
  }
  if (res.unplaceable) {
    console.log(`      ${res.unplaceable} numbered segments name neither the federation nor a state, and are left out`);
  }
  if (rejected.size) {
    const segs = [...rejected.values()].reduce((a, b) => a + b, 0);
    console.log(`      ignored ${rejected.size} values in CODIGO across ${segs} segments`);
  }
  return res;
}

/** Which tier a stitched Mexican route belongs to. */
export function mexicoSystem(grp) {
  return grp.system === 'federal' ? 'federal-mx' : 'state-mx';
}

/** The label a Mexican route carries, in each language. */
export function mexicoLabel(grp) {
  // The shield reads "MÉX" above the number; the written form everywhere else,
  // SICT's own traffic file included, is MEX-015D. The written form is used,
  // because it is what a search will be typed as.
  return { en: grp.id, zh: grp.id };
}
