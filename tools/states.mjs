export const STATE_CODE = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO',
  Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA',
  Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS',
  Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA',
  Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT',
  Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM',
  'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK',
  Oregon: 'OR', Pennsylvania: 'PA', 'Puerto Rico': 'PR', 'Rhode Island': 'RI',
  'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT',
  Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI',
  Wyoming: 'WY',
};

export const STATE_NAME = Object.fromEntries(
  Object.entries(STATE_CODE).map(([name, code]) => [code, name]),
);

// Land borders between states, including the Four Corners diagonals. Used to
// decide whether two pieces of the same route number are one corridor with a
// hole in the data or two unrelated roads that happen to share a number.
// Alaska, Hawaii and Puerto Rico intentionally border nothing.
const ADJACENCY = {
  AL: 'FL GA MS TN', AK: '', AZ: 'CA CO NM NV UT', AR: 'LA MO MS OK TN TX',
  CA: 'AZ NV OR', CO: 'AZ KS NE NM OK UT WY', CT: 'MA NY RI', DE: 'MD NJ PA',
  DC: 'MD VA', FL: 'AL GA', GA: 'AL FL NC SC TN', HI: '',
  ID: 'MT NV OR UT WA WY', IL: 'IA IN KY MO WI', IN: 'IL KY MI OH',
  IA: 'IL MN MO NE SD WI', KS: 'CO MO NE OK', KY: 'IL IN MO OH TN VA WV',
  LA: 'AR MS TX', ME: 'NH', MD: 'DC DE PA VA WV', MA: 'CT NH NY RI VT',
  MI: 'IN OH WI', MN: 'IA ND SD WI', MS: 'AL AR LA TN',
  MO: 'AR IA IL KS KY NE OK TN', MT: 'ID ND SD WY', NE: 'CO IA KS MO SD WY',
  NV: 'AZ CA ID OR UT', NH: 'MA ME VT', NJ: 'DE NY PA', NM: 'AZ CO OK TX UT',
  NY: 'CT MA NJ PA VT', NC: 'GA SC TN VA', ND: 'MN MT SD', OH: 'IN KY MI PA WV',
  OK: 'AR CO KS MO NM TX', OR: 'CA ID NV WA', PA: 'DE MD NJ NY OH WV',
  PR: '', RI: 'CT MA', SC: 'GA NC', SD: 'IA MN MT NE ND WY',
  TN: 'AL AR GA KY MO MS NC VA', TX: 'AR LA NM OK', UT: 'AZ CO ID NM NV WY',
  VT: 'MA NH NY', VA: 'DC KY MD NC TN WV', WA: 'ID OR', WV: 'KY MD OH PA VA',
  WI: 'IA IL MI MN', WY: 'CO ID MT NE SD UT',
};

const NEIGHBOURS = Object.fromEntries(
  Object.entries(ADJACENCY).map(([st, list]) => [st, new Set(list ? list.split(' ') : [])]),
);

export function statesTouch(a, b) {
  for (const x of a) {
    if (b.has(x)) return true;
    for (const n of NEIGHBOURS[x] || []) if (b.has(n)) return true;
  }
  return false;
}
