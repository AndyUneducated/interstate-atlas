# Data sources and decisions

Every source the atlas reads, the standard it had to meet to be read at all, and every
decision taken about how it is used. This is the document to open before updating a
source, correcting a figure or adding a new one.

The [README](../README.md#data-sources) lists the sources in short;
[ACCURACY.md](ACCURACY.md) explains what each kind of figure means to a reader;
[ARCHITECTURE.md](ARCHITECTURE.md) explains how the pipeline is built. This document is
the register behind all three, and where they disagree with it, it is the one to fix
first.

Dates below are retrieval dates of the data now in `data/`. They move with every re-fetch,
and the file named in each row records the current one.

### Contents

| | |
| --- | --- |
| [1. Changing the data](#1-changing-the-data) | update, correct, add: what to touch, in what order |
| [2. What a source must meet](#2-what-a-source-must-meet) | the adoption standard |
| [3. Source register](#3-source-register) | every source, by country |
| [4. Coverage by country](#4-coverage-by-country) | which kinds of figure exist where, and at what grain |
| [5. Decision log](#5-decision-log) | every decision, why, and where it is enforced |
| [6. Open data issues](#6-open-data-issues) | known problems not yet fixed |

---

## 1. Changing the data

**Updating a source to a newer edition.**

1. Run its fetch script (the register names it). Fetchers are resumable and print what
   failed; a partial run leaves no half-written file in `content/reference/`.
2. Check the edition the fetcher recorded: `retrieved`, `edition` or `asOf` in the
   reference file, or `tools/src/ca/editions.json` and `tools/src/mx/edition.json` for the
   large downloads.
3. Run `npm run build`, then `npm run build:elevation` if geometry changed, then `npm test`
   and `npm run verify`.
4. Read the diff in `data/` before committing. A rebuild that moves a number is expected; a
   rebuild that moves a number nobody can explain is the thing to stop for.
5. Update the row in [§3](#3-source-register) and any decision in [§5](#5-decision-log)
   the new edition affects.

**Correcting a wrong figure.** Find which of the three kinds it is
([ACCURACY.md §1](ACCURACY.md#1-three-kinds-of-figure)). A *measured* figure is fixed in
the build, never by editing `data/`. A *reported* figure is the publisher's; if it is wrong
at source it is shown as published, and the discrepancy is noted. A *published* figure in a
dossier is fixed in `content/dossiers/`, with its source line. Record the correction as a
decision if it changes a rule rather than a single value.

**Adding a source.** Check it against [§2](#2-what-a-source-must-meet). Write the fetcher
so it records retrieval date, edition and licence in its output. Add a row to
[§3](#3-source-register), the README's source table, and every decision it introduces to
[§5](#5-decision-log). If it fills a gap listed in [ACCURACY.md §6](ACCURACY.md#6-known-gaps),
update that row too.

---

## 2. What a source must meet

| Standard | Rule | When it is not met |
| --- | --- | --- |
| **Authority** | The publisher is the body that owns, counts or designates the road: a federal or provincial ministry, a statistics agency, or the operator. | Not read. Commercial road guides and encyclopedias are used to find a primary source, never as one. |
| **Machine-readable in bulk** | A file or a query API covering the whole jurisdiction. | Not read, and listed as a source gap. An interactive map or a PDF per site does not count. Hand assembly is allowed only for a small, closed set (the seven Canadian tolls, Alaska's four Interstates, the milestones), each fact with its own source. |
| **Dated** | The edition, survey year or as-of date is known. | Read only if the absence is recorded as `null`, never guessed (the RNC states no edition year). |
| **Licence known** | The terms are recorded with the data. | Read if the data is government-published and the absence of a statement is recorded (Ontario traffic, Quebec répertoire, SICT PDFs). |
| **Joinable by designation** | A figure names the route it describes. | A source that can only be joined by position is used only for placing points (crossings, toll ends, count stations), and the distance is recorded. |
| **Says what it covers** | The share of a road a figure describes can be computed. | The figure is not shown as the road's. |
| **No inference** | A figure is used for the question it answers. | Refused: a bridge's year built does not date the road; a concession's grant date is not an opening date; operator trips are not daily traffic. |

---

## 3. Source register

**Reproducible** says whether re-running the fetch returns the data now in `data/`.

### United States

| ID | Source | Used for | Edition · retrieved | Licence | Fetched by → stored | Reproducible |
| --- | --- | --- | --- | --- | --- | --- |
| US-1 | [Census TIGER/Line](https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html) primary and secondary roads, 52 files | route geometry and designations | 2025 (`TIGER_YEAR`) · on first build | public domain | `tiger.mjs` during the build → `tools/src/tiger/` | yes, year pinned |
| US-2 | [Census Gazetteer](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html) places | naming US termini | 2023 | public domain | `fetch-source.mjs` → `tools/src/` | yes |
| US-3 | [FHWA Route Log and Finder List](https://www.fhwa.dot.gov/planning/national_highway_system/interstate_highway_system/routefinder/), Tables 1 and 2 | official Interstate mileage per state, urban areas served | January 2026 · 2026-09-15 | US government work | `fetch-fhwa.mjs` → `fhwa-mileage.json` | no, the page is updated in place |
| US-4 | [FHWA *Estimated Cost of Individual Interstate Routes*](https://www.fhwa.dot.gov/highwayhistory/data/page03.cfm) | official construction cost per route | 1991 Interstate Cost Estimate · 2026-09-15 | US government work | `fetch-fhwa.mjs` → `fhwa-cost.json` | yes, historical |
| US-5 | [FHWA *Interstate Status and Progress*](https://www.fhwa.dot.gov/highwayhistory/data/page06.cfm) | the buildout curve, 1960–1997 | ends 1997 | US government work | by hand → `interstate-mileage.json` | yes, historical |
| US-6 | [FHWA HPMS](https://data.transportation.gov/Roadways-and-Bridges/HPMS-Spatial-All-Sections-2024/42um-tgh5) *Spatial All Sections*, query API | traffic, trucks, roughness, rutting, cracking, lanes, speed limits, tolls, year improved | 2024 (`HPMS_YEAR`) · 2026-09-16 | US government work | `fetch-hpms.mjs` → `hpms.json` | yes, year pinned |
| US-7 | Alaska DOT&PF, *Interstate Highway System Section 106 Exemption Route List*, and FHWA | declaring Alaska's A-1 to A-4 | as cited in the file | public | by hand → `alaska-interstates.json` | yes |
| US-8 | FHWA histories, Public Law 101-427, AASHTO, state DOTs | system-level timeline events | as cited per event | public | by hand → `milestones.json` | yes |
| US-10 | TIGER names (US-1) read against the FHWA Route Log (US-3) | which freeways TIGER records by name alone are a signed route (the Natcher Parkway is I-165), and which spellings are one road | TIGER 2025, Route Log January 2026 · 2026-10-10 | public domain | by hand → `us-named-freeways.json` | yes, each alias cited |
| US-9 | [BTS *Border Crossing Entry Data*](https://data.bts.gov/Research-and-Statistics/Border-Crossing-Entry-Data/keg4-3bc2) | checking where Canadian crossings were placed | 2026-10-04 | public domain | `fetch-border-crossings.mjs`, check only | no |

### Canada

| ID | Source | Used for | Edition · retrieved | Licence | Fetched by → stored | Reproducible |
| --- | --- | --- | --- | --- | --- | --- |
| CA-1 | [StatCan National Road Network](https://www.statcan.gc.ca/en/lode/databases/odr), 13 jurisdictions | route geometry, designations, route-end place names | per province, e.g. ON 18.0, QC 10.0, MB 6.0 · 2026-09-15 | Open Government Licence – Canada | `fetch-canada.mjs` → `tools/src/ca/` | no, unversioned URLs; `tools/src/ca/editions.json` records the editions |
| CA-2 | Transport Canada, National Highway System map service | NHS designation (Core, Feeder, Northern and Remote) | 2026-09-15 | Open Government Licence – Canada | `fetch-canada-nhs.mjs` → `canada-nhs.json` | no |
| CA-3 | [Council of Ministers, *NHS Annual Report 2017*](https://comt.ca/Reports/NHS%20Annual%202017.pdf) | NHS network mileage and condition | as of 2017-12-31 | public | `fetch-canada-nhs.mjs` → `canada-nhs.json` | yes |
| CA-4 | [Quebec MTMD, *Débit de circulation*](https://www.donneesquebec.ca/recherche/dataset/debit-de-circulation) | DJMA, heavy-vehicle share, seasons, ten years | daily WFS · 2026-09-22 | CC BY 4.0 | `fetch-canada-traffic.mjs` → `ca-traffic.json` | no, updated daily |
| CA-5 | [Ontario MTO, *Provincial Highways Traffic Volumes*](https://www.library.mto.gov.on.ca/SydneyPLUS/TechPubs/Portal/tp/tvSplash.aspx) | AADT | 2024 · 2026-09-22 | none stated | same | yes, per edition |
| CA-6 | [Alberta, *Traffic volumes on links*](https://open.alberta.ca/opendata/traffic-volumes-on-links-in-the-highway-network) | WAADT, commercial share | 2025 · 2026-09-22 | OGL – Alberta | same | yes, per edition |
| CA-7 | [Nova Scotia, *Traffic Volumes – Provincial Highway System*](https://data.novascotia.ca/Roads-Driving-and-Transport/Traffic-Volumes-Provincial-Highway-System/8524-ec3n) | AADT, truck share, 85th-percentile speed | 2005–2025 · 2026-09-22 | OGL – Nova Scotia | same | no |
| CA-8 | [New Brunswick, *AADT counts at point locations*](https://gnb.socrata.com/datasets/gdx2-xdus) | AADT | 2023 · 2026-09-22 | OGL – New Brunswick | same | yes, per edition |
| CA-9 | [PEI, *Traffic Volumes*](https://www.princeedwardisland.ca/en/service/view-pei-traffic-volumes) | AADT | 2015–2018 · 2026-09-22 | OGL – PEI | same | yes |
| CA-10 | [GNWT Bureau of Statistics, *Estimated Traffic on NWT Highways*](https://www.statsnwt.ca/Transportation/) | estimated AADT | 2011–2024 · 2026-09-22 | OGL – NWT | same | yes, per edition |
| CA-11 | [MTMD, *Répertoire des autoroutes du Québec*](https://www.transports.gouv.qc.ca/fr/projets-infrastructures/info-reseau-routier/repertoire-autoroutes/Pages/repertoire-des-autoroutes.aspx) | opening year of each autoroute tronçon | 2026-09-20 | none stated; © Gouvernement du Québec | `fetch-quebec-autoroutes.mjs` → `qc-autoroutes.json` | no |
| CA-12 | *Canada Year Book*, 1951–1968 and 1973 | Trans-Canada timeline events | as cited per event | Statistics Canada | by hand → `milestones.json` | yes, historical |
| CA-13 | [CBSA *Directory of CBSA Offices*](https://open.canada.ca/data/en/dataset/1018c301-d359-4077-8d9b-4e9fbe6a223f) | the Canada–US crossings: 116 offices offering HWY/B | 2026-10-04 | Open Government Licence – Canada | `fetch-border-crossings.mjs` → `border-crossings.json` | no |
| CA-14 | [NRCan Geolocation Service](https://geogratis.gc.ca/services/geolocation/en/locate) | placing CBSA offices and toll-stretch ends from addresses | 2026-10-04 | Open Government Licence – Canada | same, cached in `tools/src/borders/` | no |
| CA-15 | Operators, regulations and federal briefings (407 ETR, IPC Order PO-1976, Transport Canada, the PBO, Highway 104 Western Alignment Corporation and Regulations, bridge authorities, MDOT, FBCL) | the seven toll facilities, their terms and dated fares | each fact dated in the file · 2026-10-04 | as each publisher states | by hand → `tolls-ca.json` | yes, each fact cited |
| CA-16 | [Ontario MTO, *Bridge conditions*](https://data.ontario.ca/dataset/bridge-conditions) | 5,053 structures with year built, drawn in the bridge layer | 2026-09-22 | OGL – Ontario | `fetch-bridges.mjs` → `bridges.json` → `build-bridges.mjs` | yes, per edition |

### Mexico

| ID | Source | Used for | Edition · retrieved | Licence | Fetched by → stored | Reproducible |
| --- | --- | --- | --- | --- | --- | --- |
| MX-1 | [INEGI / SICT / IMT *Red Nacional de Caminos*](https://www.inegi.org.mx/programas/rnc/), `red_vial` | geometry, CODIGO designation, administering body, toll flag, lanes, surface, divided | no edition stated; updated 2026-03-19 · 2026-09-22 | INEGI Términos de Libre Uso | `fetch-mexico.mjs` → `tools/src/mx/` | no, replaced each December; `tools/src/mx/edition.json` records it |
| MX-2 | same, `plaza_cobro` | 1,376 toll plazas, drawn in the toll layer | same | same | same, read by `build-tolls.mjs` | same |
| MX-3 | [SICT *Datos Viales*](https://www.datos.gob.mx/dataset/datos_viales), survey and 2013–2024 panel | TDPA and vehicle mix at 12,263 count stations: 2024, and 2023 for the twelve states the 2024 edition cuts short (D-40) | latest 2024; portal updated 2026-04-16 · 2026-10-10 | Términos de Libre Uso MX | `fetch-mexico-traffic.mjs` → `mx-traffic.json` | no |
| MX-4 | [SICT *Datos Viales 2025*](https://micrs.sct.gob.mx/index.php/infraestructura/direccion-general-de-servicios-tecnicos/datos-viales/2025), 32 per-state PDF indexes | which roads SICT lists, their numbers and names | 2025 · 2026-09-28 | none stated on the PDFs | `fetch-mexico-designations.mjs` → `mx-designations.json` (PDFs in `tools/src/mx/dv/`) | yes, per edition |
| MX-5 | [SICT *Títulos de Concesión*](https://micrs.sct.gob.mx/infraestructura/direccion-general-de-desarrollo-carretero/titulos-de-concesion/) | 75 federal concession titles | 2026-10-05 | none stated | `fetch-mx-concessions.mjs` → `mx-concessions.json` | no |
| MX-6 | [INDAABIN *Puertos fronterizos*](https://www.datos.gob.mx/dataset/puertos_fronterizos_centros_atencion_transito_fronterizo) | Mexican border crossings, north and south, with coordinates | 2025 list · 2026-10-04 | CC BY 4.0 | `fetch-border-crossings.mjs` → `border-crossings.json` | no; the newer quarterly lists drop the coordinates |
| MX-7 | [SICT *Puentes de la Red Federal libre de peaje*](https://datos.gob.mx/dataset/puentes-de-la-red-federal-de-carreteras-libres-de-peaje) | 9,818 federal bridges with year built, drawn in the bridge layer | 2026-09-22 | Libre Uso MX | `fetch-bridges.mjs` → `bridges.json` → `build-bridges.mjs` | yes |

### All three

| ID | Source | Used for | Edition · retrieved | Licence | Fetched by → stored | Reproducible |
| --- | --- | --- | --- | --- | --- | --- |
| X-1 | [Natural Earth](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/) Admin 1, 1:10m | which Mexican state a federal segment is in; distance to the US border | 2026-09-22 | public domain | `mx-states.mjs`, `border.mjs` on first use → `tools/src/ne/` | yes |
| X-2 | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/), Terrarium, zoom 9 | elevation profiles | cached in `tools/cache/` | open data | `build-elevation.mjs` | yes |
| X-3 | OpenFreeMap, AWS Terrain Tiles, Esri World Imagery | basemaps at runtime only, none of the atlas's own data | live | per service | the browser | — |

---

## 4. Coverage by country

The grain is uneven because the sources are. Where a cell is empty, no publisher releases
the data in a form that meets [§2](#2-what-a-source-must-meet), unless it says *pending*.

| Kind of figure | United States | Canada | Mexico |
| --- | --- | --- | --- |
| Geometry | per state, TIGER 2025, one year for all | per province, NRN editions differ by province | one national file, RNC |
| Route numbers | every signed system | every number in the NRN, municipal and provincial alike | numbered roads only: 265 of the 711 state roads SICT counts carry a number |
| Route ends | Census place names | NRN place names on each side of the road | SICT section (tramo), no gazetteer |
| Official length | Interstates only, FHWA register | NHS network totals, not per route | none |
| Traffic | HPMS sections, length-weighted per route, 2024; Tennessee unmatched | 7 of 13 jurisdictions, years from 2015–2018 (PEI) to 2025 (AB), length-weighted plus busiest point | count stations, median, lowest and highest; not averaged; 2024, or 2023 in twelve states |
| Pavement condition, lanes, speed | HPMS, with coverage share | lanes and paved share from the NRN | lanes, surface, divided from the RNC; no speed limit |
| Toll share | HPMS toll flag | none on the roadway; 7 facilities drawn | RNC per-segment flag; 1,376 toll plazas drawn; 75 concession titles, 41 linked |
| Opening years | Interstates with a documented year (71 routes), buildout curve 1960–1997 | Quebec autoroutes per tronçon; Trans-Canada events from the Year Book | none |
| Construction cost | Interstates, FHWA 1991 estimate | in dossiers only, where published | none |
| Bridges with year built | none read (NBI not yet read) | Ontario only, provincial structures and culverts | federal free network; not the tolled network |
| Border crossings | the US side is only a check (BTS) | 116 CBSA highway offices, geocoded | 45 northern and the southern ports, INDAABIN coordinates |
| Written dossiers | 155 | 17 | none |
| Elevation profiles | every route with a dossier | every route with a dossier | none, as there are no dossiers |

### Routes listed and routes drawn

How many routes each country's own register lists, how many of them the atlas draws, and
why each of the rest is absent. A route counts once in each state or province it runs
through, because that is how every register is kept: FHWA lists I-95 once in each of its
fifteen states. "Drawn" means the atlas has a route of that number there. Where it is drawn
under a different number, the reason says so and it counts as absent, except for
Mexico's state roads, whose numbering D-26 leaves to INEGI.

Written by `tools/coverage-figures.mjs` from the build, the two cross-checks
(`npm run check:us`, `npm run check:mx`) and the reasons established by hand in
`content/reference/coverage-gaps.json`. `npm test` rewrites it, and fails on an absence that
has no reason.

<!-- auto:coverage -->
| Country | System | Listed by | Listed | Drawn | Absent | Why absent |
| --- | --- | --- | ---: | ---: | ---: | --- |
| 🇺🇸 | Interstate | FHWA Route Log, Table 1 (US-3): each route in each state | 541 | 523 | 18 | 12 TIGER names no road in that state with this Interstate number, so the road is drawn under the number TIGER gives it, or as context; 3 Puerto Rico's unsigned Interstates, drawn under the PR numbers TIGER and the signs carry (PR-52, PR-22 and others); 2 drawn, but stitched as a branch of the neighbouring state's route, so this state's mileage omits it (I-13); 1 FHWA lists 0.01 mi |
| 🇺🇸 | US Route | HPMS (US-6): each route of a mile or more each state reports | 717 | 695 | 22 | 21 filed by HPMS under another system than TIGER's, and drawn under TIGER's; 1 on no TIGER primary or secondary road in that state (D-47) |
| 🇺🇸 | State Route | HPMS (US-6): each route of a mile or more each state reports | 21,835 | 11,266 | 10,569 | 10,047 on no TIGER primary or secondary road in that state (D-47); 415 on TIGER for under half a mile at a stretch (D-42); 107 filed by HPMS under another system than TIGER's, and drawn under TIGER's |
| 🇨🇦 | National Highway System | Transport Canada register (CA-2): each number in each province | 341 | 301 | 40 | 30 a segment, interchange or two-route code in the register, not a route number; 6 a Newfoundland local-access number (D-20); 4 the NRN gives no road in that province this number (D-50) |
| 🇨🇦 | Trans-Canada | none: the designation is measured along the highways that carry it (D-21) | — | 26 | — | — |
| 🇨🇦 | Provincial | provincial traffic registers (CA-4 to CA-10), QC, ON, AB, NS, NB, PE, NT: each route; the other six publish none | 1,373 | 1,349 | 24 | 24 the NRN gives no road in that province this number (D-50) |
| 🇲🇽 | Federal | SICT Datos Viales 2025 (MX-4): each route in each state | 281 | 260 | 21 | 9 the RNC carries the number, but none of its segments is located in that state against Natural Earth's generalised boundaries (D-29); 7 the RNC numbers the tramo SICT names differently, and it is drawn under that number; 4 no RNC segment carries the name SICT gives the tramo; 1 the RNC gives the tramo SICT names no number (D-27) |
| 🇲🇽 | State | SICT Datos Viales 2025 (MX-4): each numbered state road | 235 | 168 | 67 | 40 carried by no atlas route under the number or SICT's tramo names (D-51); 27 drawn under the number, but on a road whose tramo names do not match SICT's |

Of the Mexican state roads counted as drawn, 54 carry INEGI's number rather than SICT's (D-26).
<!-- /auto:coverage -->

---

## 5. Decision log

Each decision states what was decided, why, and what was rejected. **Enforced** names the
code that holds the rule, so changing the decision means changing that code.

### Rules for every source

| ID | Decision | Why, and what was rejected | Enforced |
| --- | --- | --- | --- |
| D-1 | Every figure is measured, reported or published, and the three are never mixed or used to fill in for one another. | A blend cannot be checked against either source. | `build-data.mjs`, `build-content.mjs`, `detail.js` |
| D-2 | Reported figures are joined to a route by designation, never by position. | A spatial join lets a wrong geometry quietly acquire the right count. | `attachHpms`, `attachCanadianTraffic` in `build-data.mjs` |
| D-3 | A figure covering part of a road states the share it covers. | A measure over a fifth of a road, shown as the road's, is a fabrication. | the `cover` field on every HPMS and provincial measure |
| D-4 | Where a source says nothing, the site says nothing: no zero, no estimate. | A zero reads as a measurement. | `null` survives to the panel |
| D-5 | A route's length is measured once, along the path you would drive. | Summing every centreline counted Highway 401 at 1,819 km against 828. | `stitchRoute`, `drivenEdgeKm` in `geo.mjs` |
| D-6 | A published figure carries a source, or a reason none exists, in English and Chinese. | Unsourced prose cannot be corrected. | `build-content.mjs` fails the build |
| D-7 | A dossier names its road by system, number and, where the number repeats, an anchor point; never by the id a build assigned. | Build ids moved when US geometry changed source, and 26 dossiers silently stopped showing. | `resolve` in `build-content.mjs`; `build-elevation.mjs` reads the published ids |
| D-8 | A dossier's "no public figure" for a route's cost is dropped where FHWA's route cost table has one, and reported. | The page otherwise printed both side by side. | `build-content.mjs` |
| D-9 | The README's figures are written from the build. | Typed figures drifted from the data they described. | `readme-figures.mjs`, run by `npm test` |
| D-10 | An absent edition or licence is recorded as `null` or "none stated", never guessed. | A guessed edition makes a re-fetch look like a correction. | each fetcher |
| D-41 | A ring road whose farthest point is the tip of a stub is closed from the nodes within 5 km of either end of its path. | The stub has no way back, so Kansas City's I-435 measured 33 mi in Missouri and filed its Kansas half as branches; it now measures 81 mi against FHWA's 80.74. Only I-435 changed. | `ringFromNearEnds` in `geo.mjs` |
| D-42 | A piece under half a mile beside a longer piece of the same number is dropped; a short road that is the only one of its number is kept and shown as "<1 mi". The stitcher's sliver threshold (1.2 km US, 1.5 km Canada and Mexico) likewise applies only where the number has a longer piece. An American state number whose only piece is under half a mile is still left out, as it was under the threshold. | The ten dropped were digitising remnants listed as routes of 0 mi. Their siblings lost the `-1` suffix they needed only to tell the two apart (`us-129-ga-1` is now `us-129`). The threshold had also discarded whole roads shorter than it: Ontario's 7000-series links, Manitoba 29 to the border at Emerson. In the United States it would have added some 1,200 routes of under half a mile, nearly all a few hundred metres of a farm-to-market or secondary road that TIGER classes higher at an interchange, the rest of which D-47 leaves out. | `stitchRoute` in `geo.mjs`; `build-data.mjs`; `lenNum`, `routeDist` in `i18n.js`; `check-data.mjs` |
| D-43 | `build-data.mjs` removes per-jurisdiction geometry files it no longer writes, and `check-data.mjs`, run by `npm test`, fails on any disagreement between the index, the geometry files and every file that names a route. | A stale `DC.json` outlived the DC 295 that TIGER 2025 now files as I-295, and an id change in one build silently empties another file's references. | `build-data.mjs`, `check-data.mjs` |

### United States

| ID | Decision | Why, and what was rejected | Enforced |
| --- | --- | --- | --- |
| D-11 | TIGER/Line year is pinned. | Reproducible builds; the Census keeps past years. | `TIGER_YEAR` in `tiger.mjs` |
| D-12 | Designations are parsed from the road name; historic alignments (`Old US Hwy 395`, `Hst Rte 66`) are excluded; concurrencies (`US Hwy 11/15`) count for both routes. | TIGER has no route-number field. | `tiger.mjs` |
| D-13 | HPMS is queried and summed server-side, one row per route per state, rather than downloaded. | The release is 19.5 million sections and 49 GB. | `fetch-hpms.mjs` |
| D-14 | HPMS figures for a multi-state route are weighted by the miles measured in each state. | A flat average lets New Hampshire's 15 miles of I-95 count as much as Florida's 382. | `build-data.mjs` |
| D-15 | Texas, Massachusetts and Maryland are matched on HPMS `route_id`; Tennessee is left unmatched. | Those states do not report `route_signing` usably; no reliable key exists for Tennessee. | `fetch-hpms.mjs` |
| D-16 | Alaska's A-1 to A-4 are declared as the state routes they overlay plus two termini. | They carry no Interstate shields, so no geometry names them. | `alaska-interstates.json`, `build-data.mjs` |
| D-17 | Construction cost is FHWA's 1991 estimate: Interstate Construction funds only, obligations to 31 December 1989, not inflation-adjusted. | It is the only route-by-route federal figure; turnpikes built without IC funds are absent from it. | `fhwa-cost.json`, shown with its scope |
| D-18 | The buildout map lights only routes with a documented opening year; the curve is FHWA's national series. | No per-route opening record exists. | `build-content.mjs`, `timelapse.js` |
| D-47 | The American network is TIGER's primary and secondary roads (MTFCC S1100 and S1200), every signed route on them included. State routes TIGER files only among local roads are out of scope: North Carolina's secondary routes, South Carolina's S-roads, most Texas farm-to-market roads. | HPMS lists some 11,000 state route numbers the atlas lacks, nearly all of them these local-grade systems. Reading TIGER's full road files to add them was rejected: they are the size of every street in the country, and a farm road is not what the atlas maps. | `tiger.mjs` reads `PRISECROADS` only |
| D-48 | A name that is itself a designation is read as one although TIGER types it `M`: in Puerto Rico a name beginning "PR" or "Carr", anywhere a name beginning "I-", and in Texas a loop or spur, including those filed without the word "State" (Tyler's Loop 49, San Angelo's Loop 250). TIGER's tables are read as UTF-8. | Elsewhere `M` marks a common name and is refused, but TIGER types every Puerto Rican carretera `M`, PR-52 included, so the whole island was missing, as were Laredo's "I-69 W" and the two Texas loops. Read as Windows-1252, "Peña Blvd" came out as "PeÃ±a". | `parseName`, `LOCAL.TX`, `readState` in `tiger.mjs` |
| D-49 | A TIGER primary road with a name and no number becomes part of a route where no numbered route runs within 0.4 km of it. Where FHWA's Route Log shows the named road is a signed route, it joins that route (the Natcher Parkway is I-165); otherwise it is a route of its own, titled by its name, with an empty shield and a note that it has no number, if it measures a mile or more; a shorter one stays a context line. Unsigned internal numbers (Kentucky's 9000-series, New Jersey's 444 and 700, Oklahoma's turnpike numbers) are not shown. | S1100 is TIGER's limited-access class, so these were freeways drawn only as context hairlines: the Kentucky parkways, the John Kilpatrick Turnpike, Puerto Rico's expressways. The shorter ones are interchanges on ordinary arterials (Jamboree Road, Cedar Avenue), not freeways. No source the atlas reads carries the internal numbers: HPMS has no Kentucky 900x or New Jersey 444/700 rows, and its Oklahoma 375 is 209 mi, a different extent. | `named-freeways.mjs`, `us-named-freeways.json` |

### Canada

| ID | Decision | Why, and what was rejected | Enforced |
| --- | --- | --- | --- |
| D-19 | Municipal and county numbers in the NRN are kept, the tier is named "Provincial & Municipal", and each road is told apart by place. | The file does not distinguish them; guessing would drop real provincial highways. | `canada.mjs`, the tier name |
| D-20 | `RTNUMBER` 0 means no number; decimals (`1.0`) are trimmed; Newfoundland's local-access numbers (`430-15`) are excluded. | Each produced false routes: a 42,465 km "Highway 0", 2,504 false NL routes. | `canada.mjs` |
| D-21 | The Trans-Canada tier is measured: a route carrying it for at least 25 km and 35% of its length. | The Trans-Canada is a designation carried by other highways, not a number. | `canada.mjs` |
| D-22 | NHS designation is read from Transport Canada's service. | StatCan's own NHS layers are empty for NT and YT. | `fetch-canada-nhs.mjs` |
| D-23 | Traffic is read only from jurisdictions that publish in bulk; each figure is a length-weighted average shown beside the busiest point. | Maps and PDFs fail [§2](#2-what-a-source-must-meet); an average alone hides the peak. | `fetch-canada-traffic.mjs`, `detail.js` |
| D-24 | Ontario's shared-pavement crediting is kept as published; Nova Scotia's one-direction counts are summed into a two-way figure; Highway 407's operator trips are not shown as traffic. | Each is stated on the route panel. | `fetch-canada-traffic.mjs`, `ca.tr.note.*` |
| D-25 | Opening years come only from Quebec's répertoire and the dated Year Book events. | No other province publishes them; bridge years are refused (D-36). | `build-content.mjs` |
| D-50 | A provincial route the NRN gives no number is left out, not added from another source. Known cases: Alberta 12A and 834A; Nova Scotia 32, 33, 253, 280, 318, 322 and 328; New Brunswick 151, 189, 194, 195 and 197; ten Ontario 7000-series links (7087 to 7908) and 7187; Saskatchewan 10A, Yukon 97 and Quebec 720 from the NHS register. Each is listed in `coverage-gaps.json`. | Provincial counts and registers name them, but only the NRN supplies Canadian geometry with a licence that meets [§2](#2-what-a-source-must-meet); a provincial count file's sections cannot supply a road the national file lacks. | `canada.mjs` |

### Mexico

| ID | Decision | Why, and what was rejected | Enforced |
| --- | --- | --- | --- |
| D-26 | Route numbers follow INEGI's CODIGO; SICT's numbering is cross-checked, not merged. | The two agencies number state roads independently; merging would invent routes. | `mexico.mjs`, `check-mexico-numbers.mjs` → `mx-crosscheck.json` |
| D-27 | Only numbered roads become routes; unnumbered federal and state roads of 2 km or more are faint background. | An unnumbered road has no designation to join anything to. | `mexico.mjs`, `build-data.mjs` |
| D-28 | MEX-15 and MEX-15D are one route; toll share comes from the per-segment flag. | The file almost never writes the D suffix. | `mexico.mjs` |
| D-29 | A federal segment's state is found against Natural Earth 1:10m. | The file names the federation as the jurisdiction of every federal segment. | `mx-states.mjs` |
| D-30 | Route ends are the SICT section (tramo) they lie on. | There is no gazetteer in the Mexican pipeline. | `mexico.mjs`, `detail.js` |
| D-31 | `VELOCIDAD` is kept as `routingSpeed` and never shown as a speed limit. | It is a routing parameter, not a posted limit. | `mexico.mjs` |
| D-32 | TDPA is shown per route as the count of stations and their median, lowest and highest; no length-weighted average. Stations on unnumbered roads or more than 5 km from their route are not placed. The 2,206 sites SICT inferred for 2024 are noted, since the data does not flag them. | Stations are points; weighting them by length invents coverage. | `attachMexicanTraffic` in `build-data.mjs`, `mx-traffic.json` `limitations` |
| D-40 | Where SICT's latest edition holds under half a state's previous-year rows, that state's stations are the previous year's from the twelve-year panel. Each station carries its year, and a route whose stations span both shows "2023–2024". A station keyed `MEX-015D` is placed on MEX-015, as D-28 makes the two one route. | The 2024 edition stops at 99 rows in twelve states, in both resources (Jalisco 99 against 734 in 2023), a cut-off rather than a smaller survey. Using 2023 everywhere was rejected as discarding the complete 2024 states. Without the D fold, more than 2,000 stations on the toll motorways were dropped. | `fetch-mexico-traffic.mjs` `limitations.truncated`, `attachMexicanTraffic` |
| D-51 | A state route named only as a ramal, acceso or offset is kept where SICT's 2025 index lists the same number, in the same state, for a tramo of the same name. SICT state numbers the RNC does not carry are not placed. | Refusing every such route (D-27's reasoning, `isBranchOnly`) also dropped roads two agencies designate alike: Hidalgo's HGO-017 Tepeji del Río–Tlahuelilpan, Quintana Roo's QR-018. Of the 122 SICT state designations absent from the atlas, most are roads the RNC numbers differently (D-26) or that cannot be found in it by name; placing those by position was rejected. | `loadListed`, `readRedVial` in `mexico.mjs` |
| D-44 | A federal route with no segment inside any state's generalised boundary is filed in the nearest state; its per-state mileage stays empty. | `mex-174` (Ciudad Juárez) and a Sonoran piece of MEX-15 were filed in "MX". Pushing their segments into the nearest state's mileage was rejected, as D-29 leaves such segments unassigned. | `locate.nearest` in `mx-states.mjs` |

### Layers and profiles

| ID | Decision | Why, and what was rejected | Enforced |
| --- | --- | --- | --- |
| D-33 | A CBSA office is placed by the NRCan geocoder only if a candidate in its province lies within 5 km of the US; otherwise where the highway in its address meets the border; checked against the BTS port opposite at 25 km. Each records its precision. | CBSA gives addresses, not coordinates. | `fetch-border-crossings.mjs`, `build-crossings.mjs` |
| D-34 | Mexico's crossings are INDAABIN's list; no count of the northern border is preferred. | INDAABIN (45), IMT (52) and NADB (59) count different things. | `border-crossings.json` `counts` |
| D-35 | A crossing lists the routes within 2 km, by distance alone. | Neither register says which road a crossing is on. | `build-crossings.mjs` |
| D-36 | A bridge's year built is never used to date the road it carries. | A new bridge on an old road dates a replacement; roads open before their structures are finished. | `fetch-bridges.mjs` `notInferred` |
| D-37 | A Canadian toll stretch is drawn only if it measures within 10% of the published length; a fare is shown only with the date it took effect. | A cut of a different length has found the wrong stretch; an undated fare cannot be checked. | `build-tolls.mjs`, `tolls-ca.json` |
| D-38 | A concession title is linked to a route only if it writes the number, or a proposed name match has `approved: true`. A grant date is shown, for a title to build, as the earliest the road could have opened. Concessions are not drawn. | Titles name roads in words; the register does not say where a concession begins or ends. | `propose-mx-concession-matches.mjs`, `build-tolls.mjs` |
| D-39 | Elevation is sampled at 220 points along the mainline from zoom-9 tiles; a reading deeper than 30 m below sea level is taken as the water's surface. | The tiles carry bathymetry, so bridges and ferries read as the sea floor. Land below sea level shallower than 30 m (the Imperial Valley) is kept; Death Valley (−86 m) would not be. | `build-elevation.mjs` |
| D-45 | Mexico's toll plazas are drawn as points from the RNC, with the operator, the toll system and the source's own grade of the position; only a plaza graded *definida* is shown without a note. | It is where a toll is paid, not where a tolled road begins or ends, and a closed system has one at every entry and exit, so the count is of booths. | `build-tolls.mjs`, `tolls.js` |
| D-46 | The bridge layer draws the two inventories as published, culverts included where Ontario records them, coloured by year built, and every popup repeats D-36. The layer says which networks it covers. | The United States (NBI), Mexico's tolled network and twelve Canadian jurisdictions are absent; a layer that did not say so would read as the continent. | `build-bridges.mjs`, `bridges.js` |

---

## 6. Open data issues

Found by audit on 2026-10-10. Each is a problem in the data or pipeline, not a source gap;
source gaps are in [ACCURACY.md §6](ACCURACY.md#6-known-gaps). Remove a row when it is
fixed, and record any decision it produced in [§5](#5-decision-log).

| ID | Issue | Evidence |
| --- | --- | --- |
| I-4 | The route index's length mixes measured and official mileage. | `index.json` `mi` is FHWA's figure where one exists and the measurement otherwise (190 Interstates differ; I-90 2,706 against 3,076 measured). The list, the dashboard's longest routes and the trip planner sum them unlabelled, against D-1. |
| I-5 | Some dossiers give an official length for a different extent than the route record. | I-49 249.93 against 559 measured; also I-295 (NJ), I-69 (IN), AK-3, US 95 (NV), TX 71. |
| I-12 | Shallow-water elevation readings remain. | 14 profiles still dip to between −34 and −96 ft over bridges and ferries, shallower than D-39's threshold. |
| I-13 | A stretch stitched as a branch is drawn but left out of the route's length and its per-state mileage. | I-471 is drawn into Kentucky and measures 1 mi, all of it in Ohio, against FHWA's 5.02 mi in Kentucky; I-295's Pennsylvania stretch (FHWA 10.82 mi) is drawn as a branch of the New Jersey route and gives it no Pennsylvania mileage. |
