/* The vocabulary shared by the build scripts and the browser.
 *
 * Everything in here was previously written out two or three times - once in
 * `tools/build-data.mjs` as it wrote a file, once in `tools/build-content.mjs`
 * as it read that file back, and once in `assets/` as the page consumed it.
 * Nothing enforced that the three copies agreed. Dropping a system from one of
 * them did not fail the build; it silently produced routes the page could not
 * place, or a dashboard bar with no colour.
 *
 * This module is plain data with no imports, so Node loads it from `tools/`
 * and the browser loads it over HTTP from the same path.
 */

/**
 * Every route system in the atlas.
 *
 * Ids are namespaced by country. That is not decoration: three of these tiers
 * are called "state" or its local equivalent in their own country, and a flat
 * namespace can only hold one of them. The separator is a hyphen rather than a
 * colon so the same id can be an i18n key, a CSS class and a path segment
 * without escaping.
 *
 * The three sets are not translations of each other and the ids should not be
 * read as if they were. American tiers are what the shields say. Canadian
 * tiers are designations - there is no signed national system to mirror. The
 * Mexican pair is administrative, recording who maintains a road; the RNC
 * carries no functional classification, so nothing here means "freeway".
 *
 * `perJuris` marks the tiers too large to draw at once, which ship one file
 * per state or province and load on demand.
 */
export const SYSTEMS = [
  {
    id: 'us-interstate',
    code: 'ui',
    cc: 'us',
    colour: '#35e7ff',
    geo: 'us/interstate.json',
    on: true,
  },
  {
    id: 'us-numbered',
    code: 'uu',
    cc: 'us',
    colour: '#ffb545',
    geo: 'us/numbered.json',
    on: false,
  },
  {
    id: 'us-state',
    code: 'us',
    cc: 'us',
    colour: '#a98bff',
    dir: 'us/state',
    perJuris: true,
    on: false,
  },
  {
    id: 'ca-tch',
    code: 'ct',
    cc: 'ca',
    colour: '#ff4d6d',
    geo: 'ca/tch.json',
    on: true,
  },
  {
    id: 'ca-nhs',
    code: 'cn',
    cc: 'ca',
    colour: '#4fe3b0',
    geo: 'ca/nhs.json',
    on: false,
  },
  {
    id: 'ca-provincial',
    code: 'cp',
    cc: 'ca',
    colour: '#ff9ecb',
    dir: 'ca/provincial',
    perJuris: true,
    on: false,
  },
  {
    id: 'mx-federal',
    code: 'mf',
    cc: 'mx',
    colour: '#9be15d',
    geo: 'mx/federal.json',
    on: true,
  },
  {
    id: 'mx-state',
    code: 'ms',
    cc: 'mx',
    colour: '#ffe066',
    dir: 'mx/state',
    perJuris: true,
    on: false,
  },
];

/** Country codes in the order the atlas presents them, north to south. */
export const COUNTRIES = ['ca', 'us', 'mx'];

const BY_ID = new Map(SYSTEMS.map((s) => [s.id, s]));
const BY_CODE = new Map(SYSTEMS.map((s) => [s.code, s]));

export function system(id) { return BY_ID.get(id) ?? null; }
export function systemOfCode(code) { return BY_CODE.get(code) ?? null; }
export function systemsOf(cc) { return SYSTEMS.filter((s) => s.cc === cc); }

/** The country a system belongs to, read straight off the namespace. */
export function countryOf(id) { return String(id).split('-')[0]; }

/** True for the tiers that ship one file per state or province. */
export function isPerJuris(id) { return Boolean(BY_ID.get(id)?.perJuris); }

/**
 * Where a route's geometry lives, relative to `data/geo/`.
 *
 * Per-jurisdiction tiers need the state or province code; the whole-system
 * tiers ignore it. Returns null for an unknown system rather than a path that
 * would 404 later at a point where the cause is no longer obvious.
 */
export function geoPath(id, juris) {
  const s = BY_ID.get(id);
  if (!s) return null;
  if (s.perJuris) return juris ? `${s.dir}/${juris}.json` : null;
  return s.geo;
}

/* ── the shape of data/index.json ─────────────────────────────────────── */

/**
 * The index is a positional array rather than objects: it carries every route
 * in the atlas so search and the dashboard never have to touch geometry, and
 * at that row count the repeated key names cost more than the values.
 *
 * `FIELDS` is written into the file itself as a header. `IX` is how both the
 * builder and the page address a row, so a column added in the middle moves
 * both sides at once.
 */
export const FIELDS = [
  'id', 'label', 'sys', 'tier', 'st', 'mi', 'base', 'num', 'cx', 'cy', 'gs', 'ns', 'where',
];

export const IX = Object.fromEntries(FIELDS.map((f, i) => [f, i]));

/** Tier codes, stored in the index as a single letter. */
export const TIER_CODE = {
  primary: 'p', auxiliary: 'a', special: 'x', state: 's',
};

export const TIER_BY_CODE = Object.fromEntries(
  Object.entries(TIER_CODE).map(([k, v]) => [v, k]),
);

/* ── road classes ─────────────────────────────────────────────────────── */

/**
 * Colours for the road-class composition bars.
 *
 * This is a different vocabulary from the systems above: a class describes
 * what a stretch of road is like, not which numbered system it belongs to.
 * The values come from HPMS in the United States and from the NRN in Canada,
 * mapped onto one shared set of words in `tools/canada.mjs`.
 */
export const CLASS_COLOUR = {
  Freeway: '#35e7ff',
  Tollway: '#ffb545',
  Primary: '#6ef7a5',
  Secondary: '#4f9ad8',
  'Other Paved': '#7a8ca6',
  Paved: '#7a8ca6',
  Unpaved: '#b98a5a',
  Ferry: '#a98bff',
  Trail: '#8a6f4f',
  Local: '#5c6b7f',
  Ramp: '#6b7a8f',
  Winter: '#8fd4ff',
  Unknown: '#4a5768',
};

/* ── dossier sections ─────────────────────────────────────────────────── */

/**
 * The order a route dossier reads in. `build-content.mjs` validates against
 * this set and the detail panel renders in this order, so a new section
 * appears in both places or neither.
 */
export const SECTION_ORDER = [
  'character', 'engineering', 'history', 'money', 'traffic', 'condition', 'drive',
];

export const SECTION_KEYS = new Set(SECTION_ORDER);

/* ── units ────────────────────────────────────────────────────────────── */

/** Exact by definition: the international mile is 1609.344 m. */
export const KM_PER_MI = 1.609344;
