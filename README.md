<div align="center">

<h1>Highway Atlas</h1>

<h3><em>the highway network of North America</em></h3>

<p>
An interactive, bilingual atlas of every numbered highway in the United States and Canada —
the Interstates, the US numbered routes, every state route system, the Trans-Canada
Highway, Canada's National Highway System and every numbered provincial route — with a
written record for the roads that have one.
</p>

[![live site](https://img.shields.io/badge/live-andyuneducated.github.io%2Finterstate--atlas-35e7ff?style=for-the-badge&logo=githubpages&logoColor=05070c&labelColor=0b1220)](https://andyuneducated.github.io/interstate-atlas/)
[![architecture](https://img.shields.io/badge/docs-ARCHITECTURE-a78bfa?style=for-the-badge&logo=readthedocs&logoColor=05070c&labelColor=0b1220)](docs/ARCHITECTURE.md)

<br/>

![routes](https://img.shields.io/badge/routes-19%2C146-ffd166?style=flat-square&labelColor=0b1220)
![jurisdictions](https://img.shields.io/badge/jurisdictions-64-4fe3b0?style=flat-square&labelColor=0b1220)
![systems](https://img.shields.io/badge/route%20systems-6-ffd166?style=flat-square&labelColor=0b1220)
![countries](https://img.shields.io/badge/countries-US%20%C2%B7%20CA-ff4d6d?style=flat-square&labelColor=0b1220)
![languages](https://img.shields.io/badge/languages-English%20%C2%B7%20%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-a78bfa?style=flat-square&labelColor=0b1220)

![vanilla js](https://img.shields.io/badge/front%20end-vanilla%20ES%20modules-35e7ff?style=flat-square&labelColor=0b1220)
![build step](https://img.shields.io/badge/client%20build%20step-none-35e7ff?style=flat-square&labelColor=0b1220)
![browser deps](https://img.shields.io/badge/npm%20packages%20served-0-35e7ff?style=flat-square&labelColor=0b1220)
![maplibre](https://img.shields.io/badge/MapLibre%20GL%20JS-4.7.1%20vendored-4fe3b0?style=flat-square&labelColor=0b1220)
![build deps](https://img.shields.io/badge/npm%20dependencies-2%20build%20%C2%B7%201%20dev-ff9ecb?style=flat-square&labelColor=0b1220)

![data](https://img.shields.io/badge/data-TIGER%2FLine%20%C2%B7%20HPMS%20%C2%B7%20StatCan%20NRN%20%C2%B7%20Transport%20Canada-4f9ad8?style=flat-square&labelColor=0b1220)
![code licence](https://img.shields.io/badge/code-MIT-lightgrey?style=flat-square&labelColor=0b1220)
![content licence](https://img.shields.io/badge/content-CC%20BY%204.0-lightgrey?style=flat-square&labelColor=0b1220)

<sub><b>[Live site](https://andyuneducated.github.io/interstate-atlas/)</b> ·
[Architecture](docs/ARCHITECTURE.md) ·
[Coverage](#coverage) ·
[On accuracy](#on-accuracy) ·
[Data sources](#data-sources) ·
[Dependencies](#dependencies) ·
[Building](#building) ·
[Second machine](#working-on-a-second-machine)</sub>

<br/>

[![The Interstate system and the Trans-Canada Highway drawn across North America](docs/img/hero.png)](https://andyuneducated.github.io/interstate-atlas/)

<sub>The Interstates in cyan, the Trans-Canada in red, on the continent they actually cover.</sub>

</div>

---

> [!NOTE]
> **Counts move; method does not.** Every route total, mileage and percentage on this page
> is read back from the published build dated **2026-09-17** (`data/index.json`,
> `data/stats.json`) and changes whenever the pipeline is re-run against fresher source
> data. The rules those numbers obey — what counts as measured, what counts as published,
> and what is never filled in — are in [On accuracy](#on-accuracy) and do not change.

## What it does

| | |
| --- | --- |
| **Map** | MapLibre GL over a dark vector basemap, with satellite and terrain alternatives and every route in the network selectable. |
| **Route detail** | Termini, length, per-jurisdiction mileage, roadway classification and grade separation measured off the geometry; alongside them, what the states and provinces themselves measured — traffic, heavy-truck volume, pavement roughness, rutting and cracking, lanes, posted speeds — each stating the share of the road it covers. For curated routes, a written account of how the road came to be, what it cost, what it carries and what condition it is in. |
| **Buildout scrubber** | A docked timeline over the live map. The scrub track *is* FHWA's mileage curve, which runs 1960–1997; the playhead runs from 1956, the year of the Act, to the latest documented completion, and routes light up as their documented year arrives. |
| **Border crossings** | 167 land crossings on the Canada–US, Mexico–US, Mexico–Guatemala and Mexico–Belize borders, each saying how it was placed and listing the atlas routes within 2 km of it. |
| **Toll facilities** | Seven Canadian toll roads and bridges on the map, each with its operator, length, opening date and dated fares, and every fact linked to its source. A route's panel lists the tolls on it, and for Mexico the federal concession titles that name its number. |
| **Flythrough** | Follows a route's mainline end to end with the camera down on the pavement. |
| **Numbering explainer** | Why I-5 is on the west coast and I-95 on the east, and why the US routes run the other way — drawn rather than described. |
| **Statistics dashboard** | Network totals by system and by jurisdiction, both countries. |
| **Elevation profiles** | Sampled from open terrain data for curated routes. |
| **Trip planner** | Chain routes into an itinerary. |
| **Command palette** | <kbd>/</kbd> or <kbd>Ctrl</kbd>+<kbd>K</kbd> to reach any route, jurisdiction or view. |
| **Map on its own** | <kbd>Z</kbd> fades every panel off the map and back again. |
| **Bilingual** | Full English and 简体中文 parity, enforced by a build check. Quebec routes keep their official French names in both modes, with an English gloss. |

![Interstate 95 selected, with its termini, measured length and the figures the states reported](docs/img/detail.png)

<sub>I-95 selected. The percentage beside a reported figure is the share of the route it was
measured over — 81% for traffic, 96% for pavement — because partial coverage is stated rather
than rounded up to the whole road.</sub>

## How it fits together

Nothing is computed in the browser that could be computed once, offline. Government open
data is downloaded by the `fetch-*` scripts, turned into routes by the `build-*` scripts,
and committed to `data/` as plain JSON. The site is those files plus an HTML page and six
ES modules, served as-is.

```mermaid
flowchart LR
  SRC["Government open data<br/><i>US Census · FHWA<br/>StatCan · Transport Canada<br/>5 provincial DOTs</i>"]
  FETCH["tools/fetch-*.mjs<br/><i>network, run rarely</i>"]
  RAW["tools/src/<br/><i>shapefiles, gitignored</i>"]
  REF["content/reference/<br/><i>small extracts, committed</i>"]
  PROSE["content/dossiers/<br/><i>hand-written, bilingual</i>"]
  BUILD["tools/build-*.mjs<br/><i>offline, deterministic</i>"]
  DATA["data/<br/><i>static JSON, committed</i>"]
  SITE["index.html + assets/<br/><i>no bundler, no transpile</i>"]
  PAGES(["GitHub Pages<br/><i>static hosting</i>"])

  SRC --> FETCH
  FETCH --> RAW
  FETCH --> REF
  RAW --> BUILD
  REF --> BUILD
  PROSE --> BUILD
  BUILD --> DATA
  DATA --> PAGES
  SITE --> PAGES
```

The interesting half is `build-data.mjs`: the source files are not routes but road
fragments, and reassembling them is most of the work. That is the subject of
**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**, which has the detailed pipeline
diagram, the stitching algorithm step by step, the client module graph, and a table of
every source quirk that produced a visibly wrong atlas before it was handled.

## Coverage

21,026 routes across 96 states, provinces and territories, measuring 712,114 miles of
road, in the build dated 2026-09-23.

| Country | System | Routes | Miles | Notes |
| --- | --- | --- | --- | --- |
| 🇺🇸 | Interstate Highways | 461 | 50,461 | includes Alaska's four unsigned A-series and Hawaii's H-series |
| 🇺🇸 | US Numbered Routes | 1,051 | 155,337 | the pre-1956 grid, numbered opposite to the Interstates |
| 🇺🇸 | State Routes | 14,500 | 353,699 | 50 states, DC and Puerto Rico, loaded per state |
| 🇨🇦 | Trans-Canada Highway | 26 | 7,131 | the designation, traced across the provincial highways that carry it |
| 🇨🇦 | National Highway System | 357 | 33,860 | Core, Feeder, and Northern and Remote, as designated by Transport Canada |
| 🇨🇦 | Provincial & Municipal Routes | 2,751 | 68,739 | 12 provinces and territories, loaded per jurisdiction |
| 🇲🇽 | Federal Highways | 250 | 21,816 | numbered roads the federation administers; 35,109 km of INEGI's 51,310 km federal network, the rest being unnumbered |
| 🇲🇽 | State Highways | 1,630 | 21,071 | numbered state-administered roads in all 32 states, loaded per state; most state roads carry no number (see Known gaps) |

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
what terms. Seven publish route-level counts in machine-readable form and are read here;
six do not, and their routes carry no traffic figure rather than an inferred one. The asymmetry is real and
the site states it rather than papering over it.

| Jurisdiction | Counts published in bulk | Read here |
| --- | --- | --- |
| Quebec | WFS, updated daily, CC-BY, with heavy-vehicle share; annual, summer and winter, ten years | ✅ |
| Ontario | 2024 spreadsheet, no licence stated by the publisher | ✅ |
| Alberta | 2025 spreadsheet, per-highway weighted, with vehicle classification; site history 1963–2025 | ✅ |
| Nova Scotia | 2005–2025 census, Open Government Licence, with truck share and speeds | ✅ |
| New Brunswick | 2023 count stations, Open Government Licence | ✅ |
| Northwest Territories | Table 107, 2011–2024, published as estimates | ✅ |
| Prince Edward Island | ArcGIS feature services, 2015–2018 | ✅ |
| British Columbia | interactive map only; the catalogue's copy stops at 2010 | ❌ |
| Saskatchewan | PDF map | ❌ |
| Manitoba | web application and PDF | ❌ |
| NL, YT, NU | no machine-readable traffic publication found | ❌ |

Each figure is an average along the route, weighted by length, shown beside the volume at
the road's busiest point where the two differ — Highway 401 averages 73,700 vehicles a day
along its length but carries 511,400 between Highway 427 and Renforth Drive, which is the
highest single-point count anywhere in this atlas, on either side of the border. Ontario's
Highway 407 is the one conspicuous blank: the tolled section runs under a 99-year
concession and is excluded from the ministry's counts, and the figure its operator
publishes is average workday trips, which is not a daily volume and is not shown here as
though it were.

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
with nothing to tell them apart — twenty-two separate Ontario roads carry the number 21.
Both are published here rather than guessed at, the tier is named for it,
and each road is listed with the place that identifies it.

## Known gaps

What the atlas does not have, and whether that is a limit of the sources or unfinished
work. "Source" means no publisher releases it in a usable form; "pending" means it is
available and not yet built.

| Country | Gap | Kind | Detail |
| --- | --- | --- | --- |
| 🇲🇽 | Opening years | source | Neither INEGI nor SICT publishes when a road opened. SICT's bridge inventory dates 9,818 federal free-network bridges; those are shown as bridges and not used to date roads. |
| 🇲🇽 | Most state highways | source | Most states do not number their state roads. SICT's own 2025 listing gives 265 of the 711 state roads it counts a number, and only numbered roads can become routes. The state tier is the numbered minority of INEGI's 103,787 km state network. |
| 🇲🇽 | Toll and free twins | source | The road file almost never writes the D suffix, so MEX-15 and MEX-15D share one number. A federal route can mix a toll and a free alignment, and parallel stretches show up as separate pieces under one number. Toll share comes from the file's per-segment toll flag. |
| 🇲🇽 | Which state a federal road is in | source | The road file records the federation rather than the state as the jurisdiction of federal segments. The per-state breakdown is located against Natural Earth's 1:10m boundaries, and each route page says so. |
| 🇲🇽 | Route ends | source | There is no gazetteer in the Mexican pipeline, so each end is given as the SICT section (tramo) it lies on rather than as a town. |
| 🇲🇽 | Unnumbered roads | source | Unnumbered federal and state carreteras are drawn only as faint background, and only stretches of 2 km or more. Municipal and private carreteras are not drawn. |
| 🇲🇽 | Speed limits | source | `VELOCIDAD` is a routing parameter, not a posted limit, and is not shown. |
| 🇲🇽 | Traffic on unnumbered roads | source | SICT count stations on roads with no number, or more than 5 km from their numbered route, are not placed. |
| 🇲🇽 | Spanish interface | pending | English and Chinese only. |
| 🇲🇽 | Numbering explainer, construction timeline | pending | Neither has a Mexico view yet. |
| 🇲🇽 | State route numbers differ between agencies | source | INEGI and SICT number state roads independently, and the atlas follows INEGI. Of the 235 distinct state route numbers in SICT's 2025 index, 101 match an atlas route by number and name, and 55 name a road the atlas carries under a different number. Sinaloa accounts for 10 of its 18 keys (SICT's SIN-030 Culiacán–Altata is INEGI's 313), and Chihuahua for 4 of its 6. Another 27 match by number only, and 52 match nothing. Federal numbers agree: 260 of 281 state-and-number pairs are present. Per-road detail is in `content/reference/mx-crosscheck.json` (`npm run check:mx`). |
| 🇲🇽 | CAPUFE toll-road traffic and tariffs | pending | Monthly flows and historical tariffs are published separately and not yet read. |
| 🇨🇦 | Traffic in BC, SK, MB, NL, YT, NU | source | Not published in machine-readable form (see the table above). |
| 🇨🇦 | Opening years outside Quebec | source | The *Canada Year Book* (1951–1968, 1973) never reported Trans-Canada completion by province. Saskatchewan (21 August 1957) is the one exception. The only other dated event is the national opening on 3 September 1962, which was not a completion. The 1969–1972 editions, which would cover the programme's end, are missing from Statistics Canada's digitised collection. The Act, its amendments and each province's agreement date are on the timeline. Ontario's bridge years are shown as bridges only. |
| 🇨🇦 | Nova Scotia counts on unnumbered roads | source | 103 of the 111 highways Nova Scotia counts attach to a route. The other eight cover 77 of 6,800 counted km, and they run on roads the National Road Network gives no route number: Hammonds Plains Rd (213), Purcells Cove Rd (253), and two Halifax arterials the province counts as 32 and 33. The atlas has no route for them. The province's own section geometry matches its counts but cannot supply a route the national file lacks. |
| 🇲🇽 | How many crossings the northern border has | source | Published counts disagree, and each counts something different: INDAABIN lists 45 federal border-port properties on the US border, the Instituto Mexicano del Transporte (PT 437) 52 border bridges, and the North American Development Bank's 2019 study 59 crossings after reconciling inventories, 4 of them closed. The atlas draws INDAABIN's 45 and does not prefer any of the counts. One property can hold more than one crossing, as "Nogales I y II" does. |
| 🇨🇦 | Where the Canadian crossings are | source | CBSA's directory gives each of its 116 highway border offices an address and no coordinates. 97 are placed by the NRCan geocoder: 41 to an address, 33 to an intersection, 11 to a street and 12 to a place name only. 17 had no match near the border and are placed where the highway in their address meets the line. Beaver Creek (address a PO box) and Fraser (on BC 2, which the atlas draws only near Dawson Creek) are not placed. Of the 58 that pair with a US port in BTS's data, all but Piney lie within 25 km of it. Piney is 39 km from Pinecreek MN, though 2.9 km from the line. |
| 🇨🇦 🇲🇽 | Which road a crossing is on | source | Neither register says. A crossing lists the atlas routes within 2 km of it, by distance alone; 149 of the 167 have one. |
| 🇨🇦 | A register of toll facilities | source | Canada publishes none. The seven shown are 407 ETR, the Confederation Bridge, Cobequid Pass and the four international bridges of the Federal Bridge Corporation. Each was assembled from the documents that govern it: a concession agreement, a provincial regulation, federal briefing notes, the operator's tariff page. They are not every toll in the country. |
| 🇨🇦 | Fares without a date | source | A fare is shown only with the date it took effect, or the date since which the publisher says it has not changed. The Blue Water Bridge publishes its rates with neither, so none is shown, and no 407 ETR fare was recorded with one. |
| 🇨🇦 | Where a bridge toll sits | source | The three toll stretches are drawn along the atlas route between the ends the NRCan geocoder gives, and each is drawn only if that stretch is within 10% of the published length: 407 ETR measures 104.2 km against 108, the Confederation Bridge 13.7 against 12.9, Cobequid Pass 43.3 against 45. The four international bridges are points at their crossing or route end. |
| 🇲🇽 | Which road a concession is on | source | SICT's register of 75 federal concession titles names most roads in words, not by number. Only 6 titles write a route number, and only those are attached to routes. The rest stay in `content/reference/mx-concessions.json`. A grant date is not an opening date. For the 60 titles to build, it is shown as the earliest the road could have opened. Concessions are not drawn on the map, since the register does not say where one begins or ends. |

## Data sources

### United States

| Source | Used for | Licence |
| --- | --- | --- |
| [US Census TIGER/Line](https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html) 2025 primary and secondary roads, 52 files | route geometry and designations | public domain |
| [FHWA HPMS](https://data.transportation.gov/Roadways-and-Bridges/HPMS-Spatial-All-Sections-2024/42um-tgh5) *Spatial All Sections* 2024 | traffic counts, truck volumes, pavement roughness, rutting, cracking, lanes, speed limits, tolls, year last improved | US government work |
| [US Census Gazetteer](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html) 2023 places | terminus naming (32,329 places) | public domain |
| [FHWA Route Log and Finder List](https://www.fhwa.dot.gov/planning/national_highway_system/interstate_highway_system/routefinder/) | official Interstate mileage, urban areas served | US government work |
| FHWA *Interstate System Mileage Open to Traffic*, 1960–1997 | the buildout curve | US government work |
| [BTS *Border Crossing Entry Data*](https://data.bts.gov/Research-and-Statistics/Border-Crossing-Entry-Data/keg4-3bc2) | checking where the Canadian crossings were placed, against the US port opposite | public domain |

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
| [CBSA *Directory of CBSA Offices*](https://open.canada.ca/data/en/dataset/1018c301-d359-4077-8d9b-4e9fbe6a223f) | the Canada–US crossings, as the offices offering highway border service | Open Government Licence – Canada |
| [NRCan Geolocation Service](https://geogratis.gc.ca/services/geolocation/en/locate) | placing those offices from their addresses, and the ends of the toll stretches | Open Government Licence – Canada |
| [407 ETR](https://407etr.com/en/travel-with-us) and [IPC Ontario Order PO-1976](https://www.ipc.on.ca/sites/default/files/legacy/2016/08/PO-1976.pdf) | 407 ETR's length, concession term and tolling | operator's terms; IPC order public |
| Transport Canada [briefing binder (2025)](https://tc.canada.ca/en/binder/26-confederation-bridge-tolls) and [2023 briefing](https://tc.canada.ca/en/corporate-services/transparency/briefing-documents-transport-canada/2023/current-topics/confederation-bridge); [Parliamentary Budget Officer](https://www.pbo-dpb.ca/en/publications/LEG-2526-004-S--reducing-tolls-confederation-bridge-fares-wood-islands-caribou-ferry--reduction-droits-peage-pont-confederation-tarifs-traversier-wood-islands-caribou) (December 2025) | Confederation Bridge operator, agreements and dated tolls | Government of Canada terms |
| [Highway 104 Western Alignment Regulations](https://novascotia.ca/just/regulations/regs/HW104reg.htm), the corporation's [2023–24 annual report](http://www.highway104.ns.ca/ar-2024.pdf), [cobequidpass.com](https://cobequidpass.com/tollfees) | Cobequid Pass length, opening, exemptions and toll | Nova Scotia terms; operator's terms |
| [Federal Bridge Corporation](https://federalbridge.ca/portfolio-of-assets/) and the bridge operators: [Blue Water](https://bluewaterbridge.ca/toll-rates/), [Sault Ste. Marie](https://www.saultbridge.com/toll-rates-auto/), [Thousand Islands](https://tibridge.com/toll-rates/), [Seaway](https://sibc.ca/the-seaway-international-bridge-corporation-ltd-announces-toll-rate-adjustment-2/); [MDOT](https://www.michigan.gov/mdot/news-outreach/pressreleases/2026/09/14/toll-rollback-coming-to-international-bridge-oct-31) | ownership of the four international bridges, their tolls and dates | operators' terms |

### Mexico

| Source | Used for | Licence | Refresh |
| --- | --- | --- | --- |
| [INEGI / SICT / IMT *Red Nacional de Caminos*](https://www.inegi.org.mx/programas/rnc/) 2025, `red_vial` | route geometry, designation (CODIGO), administering body, toll flag, lanes, surface, divided | Términos de Libre Uso (INEGI) | annual, each December |
| [SICT *Datos Viales*](https://www.datos.gob.mx/dataset/datos_viales) 2013–2024 | TDPA and vehicle mix at 9,138 count stations | Términos de Libre Uso MX | annual |
| SICT *Datos Viales* 2025, per-state PDF indexes | which state roads SICT itself lists, and which of them carry a number | Términos de Libre Uso MX | annual; file names and layout changed between 2024 and 2025 |
| [INDAABIN *Puertos fronterizos*](https://www.datos.gob.mx/dataset/puertos_fronterizos_centros_atencion_transito_fronterizo) 2025 list | the Mexican border crossings, north and south, with coordinates | CC BY 4.0 | the newer quarterly lists drop the coordinates |
| [SICT *Títulos de Concesión*](https://micrs.sct.gob.mx/infraestructura/direccion-general-de-desarrollo-carretero/titulos-de-concesion/) | the 75 federal highway concession titles, with concessionaire, grant and end dates | none stated on the page | as SICT updates the page |
| [Natural Earth](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/) Admin 1, 1:10m | locating federal segments and border ports within states; distance to the US border | public domain | rarely |

### Both

| Source | Used for | Licence |
| --- | --- | --- |
| [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (AWS Open Data) | elevation profiles | open data |
| [OpenFreeMap](https://openfreemap.org/) | vector basemap | open |
| [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) | satellite basemap | Esri terms |

## Dependencies

Three npm packages in total, none of them served to the browser.

| Scope | Package | Declared | Used by | What for |
| --- | --- | --- | --- | --- |
| `dependencies` | [shapefile](https://github.com/mbostock/shapefile) | `^0.6.6` | `tools/tiger.mjs`, `tools/canada.mjs` | streams the TIGER/Line and NRN `.shp`/`.dbf` pairs; both readers open them a feature at a time so a 417 MB province need not be held in memory |
| `dependencies` | [pngjs](https://github.com/pngjs/pngjs) | `^7.0.0` | `tools/build-elevation.mjs` | decodes Terrarium terrain tiles, which pack metres above sea level into RGB |
| `devDependencies` | [playwright-core](https://playwright.dev/) | `^1.63.0` | `tools/verify.mjs` | drives the real site in headless Chromium |

**Nothing from npm reaches the browser.** The one third-party library the page loads is
MapLibre GL JS, vendored into the repository rather than fetched from a CDN — a static
atlas should not stop working because someone else's origin is having a bad day.

| | Version | Path | Loaded by |
| --- | --- | --- | --- |
| [MapLibre GL JS](https://maplibre.org/) | 4.7.1 | `assets/vendor/maplibre-gl.js`, `assets/vendor/maplibre-gl.css` | a plain `<script>` and `<link>` in `index.html` |

Everything else the build needs is written here in plain Node with no dependencies of its
own: route stitching and the shortest-path search (`tools/geo.mjs`), Douglas–Peucker
simplification, the gazetteer spatial index, the ZIP reader (`tools/unzip.mjs`, which
handles Zip64 because the Canadian archives cross 4 GB uncompressed) and an `.xlsx` reader
(`tools/xlsx.mjs`, narrow enough to read the two provincial spreadsheets and nothing else).

The page itself needs no API key and no account. At runtime it does talk to three public
tile services, all of them optional to the atlas's own data:

| Service | When | Needed for |
| --- | --- | --- |
| [OpenFreeMap](https://openfreemap.org/) `tiles.openfreemap.org` | always | the dark vector basemap under the routes |
| [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) `s3.amazonaws.com` | on demand | hillshading and the 3D terrain mesh |
| [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) `server.arcgisonline.com` | on demand | the satellite basemap |

## Building

There is no build step for the site — `index.html` and `assets/` are served exactly as
they sit in the repository. The scripts below rebuild the *data*, and only need running
when the upstream sources change.

| Script | Does | Writes |
| --- | --- | --- |
| `npm run fetch` | downloads the Census gazetteer, the FHWA Route Log and HPMS | `tools/src/`, `content/reference/` |
| `npm run fetch:ca` | downloads the StatCan NRN, the Transport Canada NHS and provincial traffic | `tools/src/ca/`, `content/reference/` |
| `npm run fetch:qc` | scrapes the MTQ répertoire for autoroute opening years | `content/reference/qc-autoroutes.json` |
| `npm run fetch:mx` | downloads the INEGI Red Nacional de Caminos and the SICT traffic panel | `tools/src/mx/`, `content/reference/` |
| `npm run fetch:mx:check` | preflight only: what is reachable, how big, and whether it can resume | — |
| `npm run fetch:borders` | reads the CBSA and INDAABIN crossing lists and geocodes the Canadian offices | `content/reference/border-crossings.json` |
| `npm run fetch:tolls` | reads SICT's concession register. The Canadian facilities are kept by hand in `content/reference/tolls-ca.json` | `content/reference/mx-concessions.json` |
| `npm run fetch:all` | every acquisition step above, in order | all of the above |
| `npm run build` | `build-data.mjs`, `build-crossings.mjs`, `build-tolls.mjs`, then `build-content.mjs` | `data/geo/`, `data/index.json`, `data/stats.json`, `data/crossings.json`, `data/tolls.json`, `data/dossiers/`, `data/timeline.json` |
| `npm run build:elevation` | samples terrain along curated routes | `data/elevation/` |
| `npm run serve` | serves the repository on `http://localhost:8787` | — |
| `npm test` | i18n parity, then content validation | — |
| `npm run verify` | drives the served site in headless Chromium | `tools/shots/` (gitignored) |

```sh
npm install

npm run fetch:all       # acquire everything — slow, run rarely
npm run build           # geometry and prose — deterministic, offline
npm run build:elevation # optional: sample terrain along curated routes

npm run serve           # http://localhost:8787
npm test                # i18n parity, then content validation
npm run verify          # headless run-through against the served site
```

TIGER/Line is the exception to `fetch:all`: it downloads itself per state on the first
build, into `tools/src/tiger/`, so the first `npm run build` needs the network.

`node tools/build-data.mjs` is much the slowest step — it is a shortest-path search over a
graph built from every road fragment in two countries, and takes tens of minutes. It needs
no network once the sources are on disk, and given the same inputs it produces the same
output. `tools/src/` (source downloads) and `tools/cache/` (terrain tiles) are gitignored;
the first elevation run fetches a few thousand tiles and is slow, and reruns are cached.

## Working on a second machine

A fresh clone serves the site immediately — `data/` is committed — but cannot *rebuild*
the data until the sources are back on disk. Two commands put them there:

```sh
npm run fetch      # Census gazetteer, FHWA Route Log, HPMS
npm run fetch:ca   # StatCan NRN, Transport Canada NHS, provincial traffic
```

TIGER/Line is in neither: `tiger.mjs` downloads a state the first time the build reads
one. Budget about 6 GB of disk and an afternoon.

| Path | On disk | Comes from |
| --- | --- | --- |
| `tools/src/ca/` | ~5.4 GB | `fetch-canada.mjs` — a 1.5 GB download that inflates on unpacking, because shapefiles are uncompressed |
| `tools/src/tiger/` | ~476 MB | the build itself, one state at a time |
| `tools/src/2023_Gaz_place_national.txt` | 6 MB | `fetch-source.mjs` |
| `tools/cache/` | ~96 MB | `build-elevation.mjs`, only if terrain profiles are rebuilt |

Both fetchers are resumable — they skip whatever is already on disk and print what
failed — so a dropped connection costs one re-run rather than the whole download.

None of this is committed, and none of it can be: GitHub rejects any file over 100 MB
and caps a single push at 2 GB, ten of these files are over 100 MB, and this repository
is a Pages source, for which the recommended ceiling is 1 GB.

Re-fetching reproduces the US data exactly, because `TIGER_YEAR` is pinned and the Census
keeps past years. It does not reproduce the Canadian data exactly: StatCan publishes the
current edition of each province at an address with no version in it, so a later fetch
can return a newer road network and move the mileage. `tools/src/ca/editions.json`
records which edition of each province produced the data now in `data/`.

## Repository layout

| Path | Committed | What it holds |
| --- | --- | --- |
| `index.html` | ✅ | the whole page: markup, no templating, no bundler |
| `assets/*.js` | ✅ | six ES modules, loaded directly by the browser |
| `assets/vendor/` | ✅ | MapLibre GL JS 4.7.1 |
| `tools/fetch-*.mjs` | ✅ | acquisition — the only scripts that touch the network |
| `tools/build-*.mjs` | ✅ | the pipeline — offline and deterministic |
| `tools/geo.mjs`, `tiger.mjs`, `canada.mjs` | ✅ | the geospatial algorithms and the two source readers |
| `content/dossiers/` | ✅ | hand-written route profiles, English and Chinese |
| `content/reference/` | ✅ | small sourced extracts: FHWA mileage and cost, HPMS, NHS register, provincial traffic |
| `data/` | ✅ | the build's output, and the only thing the site reads |
| `docs/` | ✅ | the architecture document and the two images on this page |
| `tools/src/`, `tools/cache/`, `tools/shots/` | ❌ | downloads, tile cache and verification screenshots |

## The parts that do not change

Rebuilds move every number on this page. These are the rules they move under.

| Rule | Where it is enforced |
| --- | --- |
| A figure is either **measured** from geometry or **published** by an authority, never a blend of the two | `build-data.mjs` computes the first; `content/` carries the second with its source |
| A published figure carries a source, or an explanation of why none exists | `build-content.mjs` fails the build otherwise |
| Every English string has a Chinese counterpart, with matching placeholders | `check-i18n.mjs` fails otherwise |
| Reported figures are joined to routes by **designation, never by position** | `attachHpms` and `attachCanadianTraffic` in `build-data.mjs` |
| Any figure covering part of a road states the share it covers | every HPMS and provincial measure carries a `cover` field |
| A route's length is measured along the path you would drive, once — not over every centreline in the corridor | `stitchRoute` and `drivenEdgeKm` in `geo.mjs` |
| Where a source says nothing, the site says nothing | no defaulting to zero; `null` survives to the panel |

## Licence

Code is MIT. Written content is CC BY 4.0. The underlying data keeps the licences above.
