# Accuracy

What a number on the site is, where it came from, and what the atlas does not have. The
[README](../README.md#on-accuracy) gives the summary; this is the long form.

Example figures below come from a particular build and move with every rebuild. The rules
they illustrate do not.

### Contents

| | |
| --- | --- |
| [1. Three kinds of figure](#1-three-kinds-of-figure) | measured, reported, published |
| [2. Measured](#2-measured) | what the geometry gives, and why it can disagree with the register |
| [3. Reported](#3-reported) | what the states and provinces counted, and who publishes it |
| [4. Published](#4-published) | sourced figures, and what happens when there is none |
| [5. What the data cannot tell apart](#5-what-the-data-cannot-tell-apart) | ambiguity kept visible |
| [6. Known gaps](#6-known-gaps) | every gap, and whether it is the source or unfinished work |

---

## 1. Three kinds of figure

| Kind | What | Comes from | Shown with | When there is none |
| --- | --- | --- | --- | --- |
| **Measured** | length, termini, per-jurisdiction mileage, straight-line span, roadway-class mix, grade-separated share | the surveyed road geometry, computed here | a note that it was derived | cannot be absent: it is computed |
| **Reported** | traffic, heavy-truck volume, pavement roughness, rutting, cracking, lanes, posted speeds, year last improved | what states, provinces and SICT counted and published | the share of the route it was measured over | nothing is shown; no zero, no estimate |
| **Published** | official mileage, construction cost, designation, opening dates, toll facts and fares | FHWA, Transport Canada, provincial ministries, SICT, operators | a source line naming the publication and its date | the page says no public figure exists |

The three are never mixed, averaged, or used to fill in for one another.

## 2. Measured

Length, endpoints, per-jurisdiction mileage, straight-line span and roadway-class
composition are computed here from surveyed road geometry, thinned for drawing but not
redrawn. A route is measured along the single path from one end of it to the other, so a
divided highway counts once rather than once per carriageway. The build compares the result
with FHWA's register wherever the register has a figure, and writes the spread into
`data/stats.json`; the README quotes it from there.

The larger disagreements are mostly explained rather than wrong, and the site explains them
instead of splitting the difference. FHWA credits pavement shared by two Interstates to one
of them, so where I-90 runs along the Indiana Toll Road with I-80 those miles are I-80's in
the register and both roads' here, which is why I-90 measures 13.7% longer than published.
The register also has slips of its own: its Tennessee column is shifted one row, so that
Knoxville's I-640, a beltway of about seven miles, is given I-840's 77.29. Those figures are
replaced from a committed correction table that keeps the published value beside each one
([D-53](DATA-SOURCES.md#5-decision-log)). Otherwise both figures are always shown, and
neither is bent toward the other.

The algorithm, and the cases it cannot measure correctly, are in
[ARCHITECTURE.md §3](ARCHITECTURE.md#3-from-fragments-to-routes).

## 3. Reported

Traffic volume, heavy-truck volume, pavement condition, lane counts, posted speeds and the
year a road was last improved are what the states measured and reported to FHWA, joined to
a route by its designation and never by position. Coverage is uneven by design: pavement
condition is surveyed thoroughly on the National Highway System and patchily elsewhere, so
every one of these figures states the share of the route it was measured over.

**Canada has no equivalent.** There is no national traffic collection, because counting is
provincial and each province decides for itself whether to publish, in what form and under
what terms. Routes in a province that does not publish carry no traffic figure rather than
an inferred one.

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

Each provincial figure is an average along the route, weighted by length, shown beside the
volume at the road's busiest point where the two differ. Highway 401 averages 73,700
vehicles a day along its length but carries 511,400 between Highway 427 and Renforth Drive,
the highest single-point count anywhere in this atlas. Ontario's Highway 407 is the one
conspicuous blank: the tolled section runs under a 99-year concession and is excluded from
the ministry's counts, and the figure its operator publishes is average workday trips,
which is not a daily volume and is not shown as though it were.

**Mexico counts at points.** SICT's Datos Viales gives TDPA (equivalent to AADT) at count
stations on the paved national network. A route shows how many of its stations were counted
and their median, lowest and highest TDPA. No length-weighted average is computed, because
the stations are points, not sections, and weighting them by length would invent coverage
SICT did not publish. The 2024 edition stops at 99 rows in twelve states, where 2023 had
hundreds, so those states' stations are 2023's. Every route says which year it shows, and
one crossing both kinds of state says "2023–2024".

## 4. Published

Official Interstate mileage comes from the FHWA Route Log and Finder List; Canadian
designations and network mileage come from Transport Canada. Everything in a written
dossier (costs, traffic counts, construction dates, condition) carries its own source line
naming the publication and its date. Toll facilities carry one per fact, and a fare is shown
only with the date it took effect.

Where no published figure exists, the site says so rather than estimating. The Yellowhead
Highway was built and extended by four provinces over decades and no department has
published a total cost for it, so its page says that instead of inventing one.
`build-content.mjs` enforces this: a figure must carry a source or an explanation of why it
is absent, in both English and Chinese, or the build fails. Where a dossier records a cost
as unpublished and FHWA's route-by-route cost table has one, the build drops the dossier's
claim and reports it, so the page never prints "no public figure" beside a sourced one.

## 5. What the data cannot tell apart

Canada's national road file records county and municipal route numbers in the same field as
provincial highway numbers, with nothing to tell them apart: twenty-two separate Ontario
roads carry the number 21. All are published rather than guessed at, the tier is named for
it, and each road is listed with the place that identifies it.

TIGER gives each stretch of road one name. Where two routes share the pavement, the stretch
carries one number and the other route has a gap there. The road is drawn, under the other
number, but the route that lost the label measures short: several Interstates fall below
FHWA's mileage for this reason alone. Where FHWA's figure exists, the route page shows it
beside the measurement.

A grant date is not an opening date. SICT's concession register dates when a title was
granted; for a title to build a road, the site shows that date as the earliest the road
could have opened, and says so.

---

## 6. Known gaps

"Source" means no publisher releases it in a usable form; "pending" means it is available
and not yet built.

| Country | Gap | Kind | Detail |
| --- | --- | --- | --- |
| 🇲🇽 | Opening years | source | Neither INEGI nor SICT publishes when a road opened. SICT's bridge inventory dates 9,818 federal free-network bridges; those are drawn in the bridge layer as facts about bridges, and not used to date roads. |
| 🇲🇽 | Most state highways | source | Most states do not number their state roads. SICT's own 2025 listing gives 265 of the 711 state roads it counts a number, and only numbered roads can become routes. The state tier is the numbered minority of INEGI's 103,787 km state network. |
| 🇲🇽 | Toll and free twins | source | The road file almost never writes the D suffix, so MEX-15 and MEX-15D share one number. A federal route can mix a toll and a free alignment, and parallel stretches show up as separate pieces under one number. Toll share comes from the file's per-segment toll flag. |
| 🇲🇽 | Which state a federal road is in | source | The road file records the federation rather than the state as the jurisdiction of federal segments. The per-state breakdown is located against Natural Earth's 1:10m boundaries, and each route page says so. |
| 🇲🇽 | Route ends | source | There is no gazetteer in the Mexican pipeline, so each end is given as the SICT section (tramo) it lies on rather than as a town. |
| 🇲🇽 | Unnumbered roads | source | Unnumbered federal and state carreteras are drawn only as faint background, and only stretches of 2 km or more. Municipal and private carreteras are not drawn. |
| 🇲🇽 | Speed limits | source | `VELOCIDAD` is a routing parameter, not a posted limit, and is not shown. OpenStreetMap's `maxspeed` is shown instead, labelled as such (D-73); it covers 78% of federal and 31% of state route length, and the rest has no limit, since Mexico sets no single default. |
| 🇺🇸 🇨🇦 | Speed limits off the reported network | source | HPMS reports a posted limit on 69% of Interstate, 60% of US route and 41% of state route length; the NRN on 44–51% of Canadian length. Defaults are set state by state and province by province, so the rest is shown as having no data rather than given one. A route's figure is the length-weighted mean, so it can fall between signed limits. |
| CN TW | Speed limits | source | No authority publishes limits per road. OpenStreetMap covers 18% of mainland expressway, 6–10% of other mainland length, 99% of Taiwan's freeways and 69% of its provincial highways (D-74). Where it covers under a quarter of a route, the route shows the legal default for its class instead, marked as a default: for a mainland expressway that is the 120 km/h ceiling, and the signed limit may be lower. |
| 🇲🇽 | Traffic on unnumbered roads | source | SICT count stations on roads with no number, or more than 5 km from their numbered route, are not placed. |
| 🇲🇽 | State route numbers differ between agencies | source | INEGI and SICT number state roads independently, and the atlas follows INEGI. Of the 235 distinct state route numbers in SICT's 2025 index, 101 match an atlas route by number and name, and 55 name a road the atlas carries under a different number. Sinaloa accounts for 10 of its 18 keys (SICT's SIN-030 Culiacán–Altata is INEGI's 313), and Chihuahua for 4 of its 6. Another 27 match by number only, and 52 match nothing. Federal numbers agree: 260 of 281 state-and-number pairs are present. Per-road detail is in `content/reference/mx-crosscheck.json` (`npm run check:mx`). |
| 🇲🇽 | SICT state routes the road file cannot place | source | Of the state designations in SICT's 2025 index that the atlas lacks, about half name a tramo the RNC carries under another number, and the rest name a tramo that cannot be found in the RNC by name at all (Guanajuato's GTO-001, San Luis Potosí's periférico SLP-032). They are not placed by position (D-51). |
| 🇲🇽 | How many crossings the northern border has | source | Published counts disagree, and each counts something different: INDAABIN lists 45 federal border-port properties on the US border, the Instituto Mexicano del Transporte (PT 437) 52 border bridges, and the North American Development Bank's 2019 study 59 crossings after reconciling inventories, 4 of them closed. The atlas draws INDAABIN's 45 and does not prefer any of the counts. One property can hold more than one crossing, as "Nogales I y II" does. |
| 🇲🇽 | Which road a concession is on | source | SICT's register of 75 federal concession titles names most roads in words, not by number. 6 titles write a route number. 35 more are linked because they write the name SICT's Datos Viales gives a road, each match proposed by `npm run propose:tolls` and accepted by hand in `content/reference/mx-concession-matches.json`. Matches on a road named only as where a concession begins or ends were rejected. The other 34 titles, mostly bridges, stay in `content/reference/mx-concessions.json`. Concessions are not drawn, since the register does not say where one begins or ends. |
| 🇲🇽 | Spanish interface | pending | English and Chinese only. |
| 🇲🇽 | Official lengths per route | pending | SICT's *Red Federal Pavimentada* 2024 (datos.gob.mx, CC BY 4.0) gives each tramo's effective length by route; summed, 40,562.6 km against SICT's published 40,564.7. It covers the free federal network only, so a route's D toll road is not in its total. Not yet read. |
| 🇲🇽 | Pavement condition | source | The only per-tramo source, *Estado Físico de la Red Federal Carretera*, is a 2013 spreadsheet on a server that did not answer; nothing current is published. |
| 🇲🇽 | CAPUFE toll-road traffic and tariffs | pending | Monthly flows and historical tariffs are published separately and not yet read. The 1,376 toll plazas the RNC records are drawn as points, without fares. |
| TW | Bridges with year built | source | The Highway Bureau and Freeway Bureau release their bridge records (竣工年月 among the fields) only on written application, which is not open data (§2). The county files on data.gov.tw cover county bridges and most give no year. |
| TW | Freeway traffic is not AADT | source | The Freeway Bureau publishes daily reference volumes per section without stating their unit or method, so a freeway's panel shows them by that name, as the busiest and the median section (D-64). The sections carry names and no coordinates, so a freeway's figures sit on its longest piece. The per-gantry ETC counts were not read; turning them into a per-route figure would be the atlas's own estimate. |
| TW | Provincial traffic is a survey | source | The Highway Bureau's survey covers every provincial highway; its county-road stations are left out, as the atlas draws no county roads. Some stations record a survey weekday or a dated closure, which suggests counts on given days rather than a year-round average (D-65). 5 of 770 stations are not placed: 4 lie more than 5 km from their route, 1 is on 台61支線, which the atlas does not carry. |
| TW | Stretches the centrelines leave out | source | A provincial highway is drawn as its centrelines are. Where they leave a stretch out, it is a gap against the register's length: 台8 measures 161 km against 187.8, 台20 143 against 203.9, 台26 68 against 93.5, each across mountain or coast that has a gap of 14 km or more in the file. Why each stretch is absent, whether closed, unbuilt or unmapped, has not been traced. |
| TW | Pavement condition by stretch | source | The Highway Bureau publishes one average IRI per provincial highway each year, shown as such (D-86), and not where on the route it is rough. The Freeway Bureau measures roughness and publishes none. |
| HK | Official lengths | source | The Transport Department publishes no per-route length for Routes 1 to 10 in a form the atlas reads. |
| HK | Traffic by route | source | The Annual Traffic Census gives per-station AADT only in a PDF appendix, which `fetch-hk-census.mjs` reads by column position. It names stations by street and never by route, so which stations are a route's own is decided by hand in `content/reference/hk-routes.json` from the streets at each station's limits, and a station on a road two routes share counts for both. The PDF states no licence; the atlas quotes the department's figures with attribution, as a dossier quotes a report, and does not redistribute the appendix. The Central–Wan Chai Bypass has no station, so Route 4's figures are of its Island Eastern Corridor and western end. |
| HK | Road class | source | The road network records no road class, so a route's freeway share is not given (D-63). |
| HK | Tolls beyond the department's tables | source | The Transport Department's toll tables list nine tunnels (D-80). A tolled road or bridge they leave out is not on the toll layer, and the atlas does not say whether it charges. |
| HK | Bridges with year built | source | The Highways Department's bridge layer on the CSDI portal gives each bridge's location and no year built. |
| CN HK | Where the mainland's ports are | source | The National Office of Port Administration lists 84 highway ports by name and with no coordinates, and Tianditu's geocoder refuses requests from abroad, so each is placed from OpenStreetMap and says so (D-82): 48 at the border-control point it maps under the port's name, 21 at another feature named for the port, which may be a building of the port rather than its gate. Khunjerab is placed at Tashkurgan, where it inspects, 86 km from the line. OpenStreetMap maps no port facility under the names of 14: Nanping, Dongning, Hulin, Heixiazi Island, Tianbao, Jinshuihe, Tengchong Houqiao, Tianpeng, Mengman, Gyirong, Ulastai, Muzart, Ahetubieke and Bedel; Xinjiang's transport department reported Muzart and Ahetubieke not yet open in 2024. The Heihe cableway is not a road. The ports facing Hong Kong and Macao are drawn on the mainland side only. |
| CN | An authoritative geometry | source | No Chinese authority publishes road geometry that can be read from abroad: Tianditu refuses foreign requests. The mainland is drawn from OpenStreetMap (D-66), which no authority stands behind. Its completeness varies by province, and a missing stretch, a wrong number or a road tagged with an old number is the mappers' and not the atlas's to correct. |
| CN | Official lengths and traffic | source | The Ministry of Transport publishes network totals in its statistical bulletin, not per-route lengths or counts. A main route shows the plan's length as Chinese Wikipedia lists it, beside its measurement (D-72); link routes and provincial roads have their measurement alone, and no mainland route has traffic. |
| CN | Toll share | source | OpenStreetMap's toll tag covers too little of the expressway network to measure (D-69), so no mainland route has one. |
| CN | Bridges with year built | source | No authority publishes a bridge register. |
| CN HK | Pavement condition | source | The Ministry of Transport's national road-condition monitoring is not released per segment; a few provinces have published sampled tables. Hong Kong's open pavement layer gives the surface type and no condition. |
| CN TW HK | Construction cost outside the dossiers | source | No register publishes a cost per route. A mainland expressway's cost is published per section, in approvals and news, and is given in its dossier where one is written. |
| CN | Provincial roads | source | How many provincial roads carry a number depends on how thoroughly each province is mapped. A number is each province's own (D-67), so S1 in Hebei and S1 in Sichuan are separate routes. |
| CN | Route ends | source | An end is named by the nearest mapped city or town, up to 120 km away in the west (D-68), not by the plan's terminus; the plan's ends are quoted beside, as the route relation tags them. |
| 🇺🇸 | Bridges with year built | source | Of the National Bridge Inventory's 624,193 structures, the bridge layer draws the 196,860 that carry an atlas route (D-84). Bridges on county and city roads, and those that carry a road over an atlas route rather than the route itself, are not drawn. 15,377 that name an atlas route lie over 1 km from its line, as the inventory places them, and are left out rather than moved. |
| 🇺🇸 🇨🇦 🇲🇽 | Elevation profiles on state and provincial routes | source | Only the national tiers and the routes with a dossier have a profile (D-81). The terrain tiles cover the continent, so this is a choice, not a source gap. |
| 🇺🇸 | Local-grade state routes | source | The American network is TIGER's primary and secondary roads. State systems TIGER files only among local roads are not drawn: North Carolina's secondary routes, South Carolina's S-roads, most Texas farm-to-market roads, and the like (D-47). |
| 🇺🇸 | Unsigned internal numbers | source | A freeway TIGER names without a number is titled by its name. Some states keep unsigned internal numbers for such roads (Kentucky's parkways are 9000-series); no source the atlas reads carries them, so none is shown (D-49). |
| 🇺🇸 | Interstates newer than TIGER | source | TIGER 2025 does not yet carry the newest sections of I-295 around Fayetteville, so it is drawn at 14 of the Route Log's 22.48 mi. The headline shows FHWA's figure; the map is short until TIGER adds them. |
| 🇨🇦 | Provincial routes the national file does not number | source | Alberta 12A and 834A, Nova Scotia 32, 33, 253, 280, 318, 322 and 328, and New Brunswick 151, 189, 194, 195 and 197 are in provincial registers or counts but carry no number in the National Road Network, so they are not drawn (D-50). |
| 🇨🇦 | Traffic in BC, SK, MB, NL, YT, NU | source | Not published in machine-readable form (see [§3](#3-reported)). |
| 🇨🇦 | Opening years outside Quebec | source | The *Canada Year Book* (1951–1968, 1973) never reported Trans-Canada completion by province. Saskatchewan (21 August 1957) is the one exception. The only other dated event is the national opening on 3 September 1962, which was not a completion. The 1969–1972 editions, which would cover the programme's end, are missing from Statistics Canada's digitised collection. The Act, its amendments and each province's agreement date are in the Trans-Canada's dates. Ontario's bridge years are drawn in the bridge layer as facts about bridges only. |
| 🇨🇦 | Nova Scotia counts on unnumbered roads | source | 103 of the 111 highways Nova Scotia counts attach to a route. The other eight cover 77 of 6,800 counted km, and they run on roads the National Road Network gives no route number: Hammonds Plains Rd (213), Purcells Cove Rd (253), and two Halifax arterials the province counts as 32 and 33. The province's own section geometry matches its counts but cannot supply a route the national file lacks. |
| 🇨🇦 | Where the Canadian crossings are | source | CBSA's directory gives each of its 116 highway border offices an address and no coordinates. 97 are placed by the NRCan geocoder: 41 to an address, 33 to an intersection, 11 to a street and 12 to a place name only. 17 had no match near the border and are placed where the highway in their address meets the line. Beaver Creek (address a PO box) and Fraser (on BC 2, which the atlas draws only near Dawson Creek) are not placed. Of the 58 that pair with a US port in BTS's data, all but Piney lie within 25 km of it. Piney is 39 km from Pinecreek MN, though 2.9 km from the line. |
| 🇨🇦 | Alberta bridges | source | Alberta Transportation's structure export (CSV, with coordinates, year built and the road it is on) can be downloaded from the department's file directory, but no licence is stated for it, and open.alberta.ca, where the Open Government Licence – Alberta applies, carries no structure inventory, so it is not read (checked 2026-10-19). Quebec's file records no rehabilitation year, so its bridges show the year built alone. |
| 🇨🇦 | Bridges in the other provinces and territories | source | Surveyed 2026-10-19. British Columbia's road-structure layer, Nova Scotia's structures database and Yukon's bridge layer are open but give no year built. New Brunswick's year built is only in a PDF with no coordinates, and its open bridge layer with years is of forestry roads. Saskatchewan, Manitoba, Prince Edward Island, Newfoundland and Labrador, the Northwest Territories and Nunavut publish no inventory with a year built; Newfoundland's are a PDF per bridge. |
| 🇨🇦 | Official lengths where the province no longer manages the road | source | A province's official length is the sum of the sections it manages (D-87), shown on 1,201 highways in six provinces. On 167 the sum is more than 20% from the drawn piece, mostly because the province has handed much of the road to municipalities (Ontario's Highway 2: 0.9 km in the ministry's file, 240 km drawn) or because the atlas draws the number in several pieces, and they have their measurement alone. Manitoba's figures are the 2018 inventory's, the latest it has published. |
| 🇨🇦 | Official lengths in NS, PE, NL and the territories | source | No per-route register is published; only road geometry. |
| 🇨🇦 | Pavement condition | pending | Ontario publishes IRI and condition by chainage for 2014–2023, without coordinates; Alberta 50 m IRI and rutting with coordinates for 2018–2025. Neither is read yet. British Columbia collects its own and does not publish it; Quebec publishes a provincial summary only; the other provinces nothing per segment. |
| 🇨🇦 | A register of toll facilities | source | Canada publishes none. The seven shown are 407 ETR, the Confederation Bridge, Cobequid Pass and the four international bridges of the Federal Bridge Corporation, each assembled from the documents that govern it. They are not every toll in the country. |
| 🇨🇦 | Fares without a date | source | A fare is shown only with the date it took effect, or the date since which the publisher says it has not changed. The Blue Water Bridge publishes its rates with neither, so none is shown, and no 407 ETR fare was recorded with one. |
| 🇨🇦 | Where a toll stretch sits | source | The three toll stretches are drawn along the atlas route between the ends the NRCan geocoder gives, and each is drawn only if that stretch is within 10% of the published length: 407 ETR measures 104.2 km against 108, the Confederation Bridge 13.7 against 12.9, Cobequid Pass 43.3 against 45. The four international bridges are points at their crossing or route end. |
| 🇨🇦 🇲🇽 CN | Which road a crossing is on | source | No register says. A crossing lists the atlas routes within 2 km of it, by distance alone; 149 of the 167 North American crossings have one, and 64 of the 69 mainland ports. |
