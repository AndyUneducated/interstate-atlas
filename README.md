<div align="center">

# Highway Atlas

**the highway network of North America**

An interactive, bilingual atlas of every numbered highway in the United States and Canada —
the Interstates, the US numbered routes, every state route system, the Trans-Canada
Highway, Canada's National Highway System and every numbered provincial route — with a
written record for the roads that have one.

[![live site](https://img.shields.io/badge/live-andyuneducated.github.io%2Finterstate--atlas-35e7ff?style=for-the-badge)](https://andyuneducated.github.io/interstate-atlas/)

![routes](https://img.shields.io/badge/routes-19%2C146-ffd166?style=flat-square)
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
| **Route detail** | Termini, length, per-jurisdiction mileage, roadway classification and grade separation measured off the geometry; alongside them, what the states and provinces themselves measured — traffic, heavy-truck volume, pavement roughness, rutting and cracking, lanes, posted speeds — each stating the share of the road it covers. For curated routes, a written account of how the road came to be, what it cost, what it carries and what condition it is in. |
| **Buildout scrubber** | A docked timeline over the live map: drag through 1960–1997 and watch FHWA's mileage curve fill while documented routes light up as they open. |
| **Flythrough** | Follows a route's mainline end to end with the camera down on the pavement. |
| **Numbering explainer** | Why I-5 is on the west coast and I-95 on the east, and why the US routes run the other way — drawn rather than described. |
| **Statistics dashboard** | Network totals by system and by jurisdiction, both countries. |
| **Elevation profiles** | Sampled from open terrain data for curated routes. |
| **Trip planner** | Chain routes into an itinerary. |
| **Command palette** | <kbd>/</kbd> or <kbd>Ctrl</kbd>+<kbd>K</kbd> to reach any route, jurisdiction or view. |
| **Bilingual** | Full English and 简体中文 parity, enforced by a build check. Quebec routes keep their official French names in both modes, with an English gloss. |

## Coverage

19,146 routes across 64 states, provinces and territories, measuring 669,227 miles of road.

| Country | System | Routes | Miles | Notes |
| --- | --- | --- | --- | --- |
| 🇺🇸 | Interstate Highways | 461 | 50,461 | includes Alaska's four unsigned A-series and Hawaii's H-series |
| 🇺🇸 | US Numbered Routes | 1,051 | 155,337 | the pre-1956 grid, numbered opposite to the Interstates |
| 🇺🇸 | State Routes | 14,500 | 353,699 | 50 states, DC and Puerto Rico, loaded per state |
| 🇨🇦 | Trans-Canada Highway | 26 | 7,131 | the designation, traced across the provincial highways that carry it |
| 🇨🇦 | National Highway System | 357 | 33,860 | Core, Feeder, and Northern and Remote, as designated by Transport Canada |
| 🇨🇦 | Provincial & Municipal Routes | 2,751 | 68,739 | 12 provinces and territories, loaded per jurisdiction |

Nunavut has no numbered route in the national road file, and no road connects it to the
rest of the country, so it appears in no tier.

## On accuracy

This is the part worth reading before trusting a number on the site.

Two kinds of figure appear, and they are never mixed:

**Measured.** Length, endpoints, per-jurisdiction mileage, straight-line span and
roadway-class composition are computed here from surveyed road geometry, thinned for
drawing but not redrawn. A route is measured along the single path from one end of it to
the other, so a divided highway counts once rather than once per carriageway. Across the
262 routes where an official figure exists to check against, the median disagreement is
−0.2%: three-fifths land within 5%, four-fifths within 10%.

The larger disagreements are mostly explained rather than wrong, and the site explains them
instead of splitting the difference. FHWA credits pavement shared by two Interstates to one
of them, so where I-90 runs along the Indiana Toll Road with I-80 those miles are I-80's in
the register and both roads' here — which is why I-90 measures 13.7% longer than published.
The register also has slips of its own: it gives Knoxville's I-640, a beltway of about seven
miles, as 77.29. Both figures are always shown, and neither is bent toward the other.

**Reported.** Traffic volume, heavy-truck volume, pavement roughness, rutting, cracking,
lane counts, posted speeds and the year a road was last improved are what the states
measured and reported to FHWA, joined to a route by its designation and never by position.
Coverage is uneven by design — pavement condition is surveyed thoroughly on the National
Highway System and patchily elsewhere — so every one of these figures states the share of
the route it was measured over, and nothing is filled in where a state reported nothing.

Canada has no equivalent. There is no national traffic collection, because counting is
provincial and each province decides for itself whether to publish, in what form and under
what terms. Five publish route-level counts in bulk and are read here; eight do not, and
their routes carry no traffic figure rather than an inferred one. The asymmetry is real and
the site states it rather than papering over it.

| Jurisdiction | Counts published in bulk | Read here |
| --- | --- | --- |
| Quebec | WFS, updated daily, CC-BY, with heavy-vehicle share | ✅ |
| Ontario | 2024 spreadsheet, no licence stated by the publisher | ✅ |
| Alberta | 2025 spreadsheet, per-highway weighted, with vehicle classification | ✅ |
| Nova Scotia | 2005–2025 census, Open Government Licence, with truck share and speeds | ✅ |
| New Brunswick | 2023 count stations, Open Government Licence | ✅ |
| British Columbia | interactive map only; the catalogue's copy stops at 2010 | ❌ |
| Saskatchewan | PDF map | ❌ |
| Manitoba | web application and PDF | ❌ |
| NL, PEI, YT, NT, NU | no machine-readable traffic publication found | ❌ |

**Published.** Official Interstate mileage comes from the FHWA Route Log and Finder List;
Canadian designations and network mileage come from Transport Canada. Everything in a
written dossier — costs, traffic counts, construction dates, condition — carries its own
source line naming the publication and its date.

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
| [US Census TIGER/Line](https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html) 2025 primary and secondary roads, 52 files | route geometry and designations | public domain |
| [FHWA HPMS](https://data.transportation.gov/Roadways-and-Bridges/HPMS-Spatial-All-Sections-2024/42um-tgh5) *Spatial All Sections* 2024 | traffic counts, truck volumes, pavement roughness, rutting, cracking, lanes, speed limits, tolls, year last improved | US government work |
| [US Census Gazetteer](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html) 2023 places | terminus naming (32,329 places) | public domain |
| [FHWA Route Log and Finder List](https://www.fhwa.dot.gov/planning/national_highway_system/interstate_highway_system/routefinder/) | official Interstate mileage, urban areas served | US government work |
| FHWA *Interstate System Mileage Open to Traffic*, 1960–1997 | the buildout curve | US government work |

### Canada

| Source | Used for | Licence |
| --- | --- | --- |
| [Statistics Canada National Road Network](https://www.statcan.gc.ca/en/lode/databases/odr) (NRN) | route geometry, road class, lanes, posted speed, surface, place names | Open Government Licence – Canada |
| [Transport Canada National Highway System](https://open.canada.ca/data/en/dataset/2dac78ba-8b48-4bec-8290-cbdda8474f97) | Core / Feeder / Northern and Remote designation | Open Government Licence – Canada |
| Transport Canada *NHS Annual Report* 2017 | published NHS mileage by jurisdiction and tier | Open Government Licence – Canada |
| [Québec *Débit de circulation*](https://www.donneesquebec.ca/recherche/dataset/debit-de-circulation) | DJMA and heavy-vehicle share, Quebec | CC-BY 4.0 |
| [Ontario *Provincial Highways Traffic Volumes*](https://www.library.mto.gov.on.ca/SydneyPLUS/TechPubs/Portal/tp/tvSplash.aspx) 2024 | AADT, Ontario | no licence stated by the publisher |
| [Alberta *Traffic volumes on links in the highway network*](https://open.alberta.ca/opendata/traffic-volumes-on-links-in-the-highway-network) 2025 | WAADT and commercial share, Alberta | Open Government Licence – Alberta |
| [Nova Scotia *Traffic Volumes – Provincial Highway System*](https://data.novascotia.ca/Roads-Driving-and-Transport/Traffic-Volumes-Provincial-Highway-System/8524-ec3n) | AADT, truck share, 85th-percentile speed | Open Government Licence – Nova Scotia |
| [New Brunswick *AADT counts at point locations*](https://gnb.socrata.com/datasets/gdx2-xdus) 2023 | AADT, New Brunswick | Open Government Licence – New Brunswick |

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
| **Build** | [shapefile](https://github.com/mbostock/shapefile) | ^0.6.6 | reads the TIGER/Line and NRN shapefiles |
| **Build** | [pngjs](https://github.com/pngjs/pngjs) | ^7.0.0 | decodes Terrain-RGB elevation tiles |
| **Dev only** | [playwright-core](https://playwright.dev/) | ^1.63.0 | headless verification |

No API keys. No client build step. No framework. Route stitching, shortest-path search,
Douglas–Peucker simplification, the gazetteer index and the ZIP reader are all written here
in plain Node, with no dependencies of their own.

## Building

```sh
npm install

# acquire — slow, run rarely; everything lands in tools/src/ (gitignored)
node tools/fetch-source.mjs      # Census gazetteer
node tools/fetch-fhwa.mjs        # FHWA Route Log → content/reference/
node tools/fetch-hpms.mjs        # HPMS traffic and condition, grouped server-side
node tools/fetch-canada.mjs      # StatCan NRN, 13 provinces and territories (~1.5 GB)
node tools/fetch-canada-nhs.mjs  # Transport Canada NHS designations
node tools/fetch-canada-traffic.mjs  # provincial traffic counts, 5 provinces

# TIGER/Line downloads itself on first build, per state, into tools/src/tiger/ (~300 MB)

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
