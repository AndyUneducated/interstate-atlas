<div align="center">

# Highway Atlas

**the highway network of North America**

An interactive, bilingual atlas of every numbered highway in the United States and Canada —
the Interstates, the US numbered routes, every state route system, the Trans-Canada
Highway, Canada's National Highway System and every numbered provincial route — with a
written record for the roads that have one.

[![live site](https://img.shields.io/badge/live-andyuneducated.github.io%2Finterstate--atlas-35e7ff?style=for-the-badge)](https://andyuneducated.github.io/interstate-atlas/)

![routes](https://img.shields.io/badge/routes-10%2C657-ffd166?style=flat-square)
![countries](https://img.shields.io/badge/countries-US%20%C2%B7%20CA-ff4d6d?style=flat-square)
![jurisdictions](https://img.shields.io/badge/jurisdictions-64-4fe3b0?style=flat-square)
![languages](https://img.shields.io/badge/languages-English%20%C2%B7%20%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-a78bfa?style=flat-square)
![runtime deps](https://img.shields.io/badge/runtime%20dependencies-1-35e7ff?style=flat-square)
![build step](https://img.shields.io/badge/client%20build%20step-none-35e7ff?style=flat-square)
![code](https://img.shields.io/badge/code-MIT-lightgrey?style=flat-square)
![content](https://img.shields.io/badge/content-CC%20BY%204.0-lightgrey?style=flat-square)

</div>

---

## What it does

| | |
| --- | --- |
| **Map** | MapLibre GL over a dark vector basemap, with satellite and terrain alternatives and every route in the network selectable. |
| **Route detail** | Termini, length, per-jurisdiction mileage, roadway classification, grade separation, lane counts and posted speeds where recorded — and for curated routes a written account of how the road came to be, what it cost, what it carries and what condition it is in. |
| **Buildout scrubber** | A docked timeline over the live map: drag through 1960–1997 and watch FHWA's mileage curve fill while documented routes light up as they open. |
| **Flythrough** | Follows a route's mainline end to end with the camera down on the pavement. |
| **Numbering explainer** | Why I-5 is on the west coast and I-95 on the east, and why the US routes run the other way — drawn rather than described. |
| **Statistics dashboard** | Network totals by system and by jurisdiction, both countries. |
| **Elevation profiles** | Sampled from open terrain data for curated routes. |
| **Trip planner** | Chain routes into an itinerary. |
| **Command palette** | <kbd>/</kbd> or <kbd>Ctrl</kbd>+<kbd>K</kbd> to reach any route, jurisdiction or view. |
| **Bilingual** | Full English and 简体中文 parity, enforced by a build check. Quebec routes keep their official French names in both modes, with an English gloss. |

## Coverage

10,657 routes across 64 states, provinces and territories, measuring 493,115 miles of road.

| Country | System | Routes | Miles | Notes |
| --- | --- | --- | --- | --- |
| 🇺🇸 | Interstate Highways | 324 | 46,664 | includes Alaska's four unsigned A-series and Hawaii's H-series |
| 🇺🇸 | US Numbered Routes | 446 | 121,499 | the pre-1956 grid, numbered opposite to the Interstates |
| 🇺🇸 | State Routes | 6,753 | 211,829 | 50 states, DC and Puerto Rico, loaded per state |
| 🇨🇦 | Trans-Canada Highway | 26 | 7,418 | the designation, traced across the provincial highways that carry it |
| 🇨🇦 | National Highway System | 357 | 35,208 | Core, Feeder, and Northern and Remote, as designated by Transport Canada |
| 🇨🇦 | Provincial & Municipal Routes | 2,751 | 70,662 | 12 provinces and territories, loaded per jurisdiction |

Nunavut has no numbered route in the national road file, and no road connects it to the
rest of the country, so it appears in no tier.

## On accuracy

This is the part worth reading before trusting a number on the site.

Two kinds of figure appear, and they are never mixed:

**Measured.** Length, endpoints, per-jurisdiction mileage, straight-line span, roadway-class
composition, lane counts and posted speeds are computed here from public road geometry.
They are close, not survey-exact — generalised geometry cuts corners, so measured lengths
tend to run slightly short. Across the routes where an official figure exists to check
against, the median disagreement is −0.6%, two-thirds land within 5% and four-fifths within
10%. Every page carrying these numbers says so.

**Published.** Official Interstate mileage comes from the FHWA Route Log and Finder List;
Canadian designations come from Transport Canada. Everything in a written dossier — costs,
traffic counts, construction dates, condition — carries its own source line naming the
publication and its date.

Where no published figure exists, the site says so explicitly rather than estimating. A
1,900-mile Interstate assembled over six decades by sixteen jurisdictions has no single
construction cost, and the page says that instead of inventing one. The content build
enforces this: a figure must either carry a source or carry an explanation of why it is
absent, and English and Chinese must both be present. `node tools/build-content.mjs` fails
the build otherwise.

The same honesty applies to what the data cannot distinguish. Canada's national road file
records county and municipal route numbers in the same field as provincial highway numbers,
with nothing to tell them apart — Ontario numbers some thirty-five county roads 4, next to
its Highway 4. Both are published here rather than guessed at, the tier is named for it,
and each road is listed with the place that identifies it.

## Data sources

### United States

| Source | Used for | Licence |
| --- | --- | --- |
| [Natural Earth](https://www.naturalearthdata.com/) 1:10m North America roads | route geometry, roadway class | public domain |
| [US Census Gazetteer](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html) 2023 places | terminus naming (32,329 places) | public domain |
| [FHWA Route Log and Finder List](https://www.fhwa.dot.gov/planning/national_highway_system/interstate_highway_system/routefinder/) | official Interstate mileage, urban areas served | US government work |
| FHWA *Interstate System Mileage Open to Traffic*, 1960–1997 | the buildout curve | US government work |

### Canada

| Source | Used for | Licence |
| --- | --- | --- |
| [Statistics Canada National Road Network](https://www.statcan.gc.ca/en/lode/databases/odr) (NRN) | route geometry, road class, lanes, posted speed, surface, place names | Open Government Licence – Canada |
| [Transport Canada National Highway System](https://open.canada.ca/data/en/dataset/2dac78ba-8b48-4bec-8290-cbdda8474f97) | Core / Feeder / Northern and Remote designation | Open Government Licence – Canada |
| Transport Canada *NHS Annual Report* 2017 | published NHS mileage by jurisdiction and tier | Open Government Licence – Canada |

### Both

| Source | Used for | Licence |
| --- | --- | --- |
| [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (AWS Open Data) | elevation profiles | open data |
| [OpenFreeMap](https://openfreemap.org/) | vector basemap | open |
| [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) | satellite basemap | Esri terms |

## Dependencies

The site ships one third-party library, vendored rather than loaded from a CDN — a static
atlas should not stop working because someone else's origin is having a bad day.

| | Package | Version | Role |
| --- | --- | --- | --- |
| **Served** | [maplibre-gl](https://maplibre.org/) | 4.7.1 | map rendering, vendored into `assets/vendor/` — the only thing the browser loads |
| **Build** | [shapefile](https://github.com/mbostock/shapefile) | ^0.6.6 | reads the Natural Earth and NRN shapefiles |
| **Build** | [pngjs](https://github.com/pngjs/pngjs) | ^7.0.0 | decodes Terrain-RGB elevation tiles |
| **Dev only** | [playwright-core](https://playwright.dev/) | ^1.63.0 | headless verification |

No API keys. No client build step. No framework. Route stitching, shortest-path search,
Douglas–Peucker simplification, the gazetteer index and the ZIP reader are all written here
in plain Node, with no dependencies of their own.

## Building

```sh
npm install

# acquire — slow, run rarely; everything lands in tools/src/ (gitignored)
node tools/fetch-source.mjs      # Natural Earth + Census gazetteer
node tools/fetch-fhwa.mjs        # FHWA Route Log → content/reference/
node tools/fetch-canada.mjs      # StatCan NRN, 13 provinces and territories (~1.5 GB)
node tools/fetch-canada-nhs.mjs  # Transport Canada NHS designations

# build — deterministic, offline
node tools/build-data.mjs        # geometry → data/geo/, index.json, stats.json  (~25 min)
node tools/build-content.mjs     # validate prose → data/dossiers/, timeline.json
node tools/build-elevation.mjs   # sample terrain → data/elevation/

# run and check
node tools/serve.mjs             # http://localhost:8787
node tools/check-i18n.mjs        # English/Chinese parity
node tools/verify.mjs            # headless run-through, screenshots to tools/shots/
```

`tools/src/` (source downloads) and `tools/cache/` (terrain tiles) are gitignored. The
first elevation run fetches a few thousand tiles and is slow; reruns are cached.

## How it works

The source data is not routes. It is a pile of road fragments, split at every jurisdiction
line and wherever a classification changes, with no notion that they belong to the same
road. Reassembling them — and deciding when two pieces carrying the same number are one
road and when they are two — is most of the work.

**[→ docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** covers the pipeline, the measured/published
rule the design exists to serve, the stitching algorithm, the client's loading strategy,
and a table of every source quirk that produced a visibly wrong atlas before it was
handled.

## Licence

Code is MIT. Written content is CC BY 4.0. The underlying data keeps the licences above.
