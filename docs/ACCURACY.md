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
The register also has slips of its own: it gives Knoxville's I-640, a beltway of about seven
miles, as 77.29. Both figures are always shown, and neither is bent toward the other.

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
SICT did not publish.

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

A grant date is not an opening date. SICT's concession register dates when a title was
granted; for a title to build a road, the site shows that date as the earliest the road
could have opened, and says so.

---

## 6. Known gaps

"Source" means no publisher releases it in a usable form; "pending" means it is available
and not yet built.

| Country | Gap | Kind | Detail |
| --- | --- | --- | --- |
| 🇲🇽 | Opening years | source | Neither INEGI nor SICT publishes when a road opened. SICT's bridge inventory dates 9,818 federal free-network bridges; those are kept as bridges, not yet drawn, and not used to date roads. |
| 🇲🇽 | Most state highways | source | Most states do not number their state roads. SICT's own 2025 listing gives 265 of the 711 state roads it counts a number, and only numbered roads can become routes. The state tier is the numbered minority of INEGI's 103,787 km state network. |
| 🇲🇽 | Toll and free twins | source | The road file almost never writes the D suffix, so MEX-15 and MEX-15D share one number. A federal route can mix a toll and a free alignment, and parallel stretches show up as separate pieces under one number. Toll share comes from the file's per-segment toll flag. |
| 🇲🇽 | Which state a federal road is in | source | The road file records the federation rather than the state as the jurisdiction of federal segments. The per-state breakdown is located against Natural Earth's 1:10m boundaries, and each route page says so. |
| 🇲🇽 | Route ends | source | There is no gazetteer in the Mexican pipeline, so each end is given as the SICT section (tramo) it lies on rather than as a town. |
| 🇲🇽 | Unnumbered roads | source | Unnumbered federal and state carreteras are drawn only as faint background, and only stretches of 2 km or more. Municipal and private carreteras are not drawn. |
| 🇲🇽 | Speed limits | source | `VELOCIDAD` is a routing parameter, not a posted limit, and is not shown. |
| 🇲🇽 | Traffic on unnumbered roads | source | SICT count stations on roads with no number, or more than 5 km from their numbered route, are not placed. |
| 🇲🇽 | State route numbers differ between agencies | source | INEGI and SICT number state roads independently, and the atlas follows INEGI. Of the 235 distinct state route numbers in SICT's 2025 index, 101 match an atlas route by number and name, and 55 name a road the atlas carries under a different number. Sinaloa accounts for 10 of its 18 keys (SICT's SIN-030 Culiacán–Altata is INEGI's 313), and Chihuahua for 4 of its 6. Another 27 match by number only, and 52 match nothing. Federal numbers agree: 260 of 281 state-and-number pairs are present. Per-road detail is in `content/reference/mx-crosscheck.json` (`npm run check:mx`). |
| 🇲🇽 | How many crossings the northern border has | source | Published counts disagree, and each counts something different: INDAABIN lists 45 federal border-port properties on the US border, the Instituto Mexicano del Transporte (PT 437) 52 border bridges, and the North American Development Bank's 2019 study 59 crossings after reconciling inventories, 4 of them closed. The atlas draws INDAABIN's 45 and does not prefer any of the counts. One property can hold more than one crossing, as "Nogales I y II" does. |
| 🇲🇽 | Which road a concession is on | source | SICT's register of 75 federal concession titles names most roads in words, not by number. 6 titles write a route number. 35 more are linked because they write the name SICT's Datos Viales gives a road, each match proposed by `npm run propose:tolls` and accepted by hand in `content/reference/mx-concession-matches.json`. Matches on a road named only as where a concession begins or ends were rejected. The other 34 titles, mostly bridges, stay in `content/reference/mx-concessions.json`. Concessions are not drawn, since the register does not say where one begins or ends. |
| 🇲🇽 | Spanish interface | pending | English and Chinese only. |
| 🇲🇽 | Numbering explainer, construction timeline | pending | Neither has a Mexico view yet. |
| 🇲🇽 | CAPUFE toll-road traffic and tariffs | pending | Monthly flows and historical tariffs are published separately and not yet read. |
| 🇨🇦 | Traffic in BC, SK, MB, NL, YT, NU | source | Not published in machine-readable form (see [§3](#3-reported)). |
| 🇨🇦 | Opening years outside Quebec | source | The *Canada Year Book* (1951–1968, 1973) never reported Trans-Canada completion by province. Saskatchewan (21 August 1957) is the one exception. The only other dated event is the national opening on 3 September 1962, which was not a completion. The 1969–1972 editions, which would cover the programme's end, are missing from Statistics Canada's digitised collection. The Act, its amendments and each province's agreement date are on the timeline. Ontario's bridge years are kept as facts about bridges only, and not yet drawn. |
| 🇨🇦 | Nova Scotia counts on unnumbered roads | source | 103 of the 111 highways Nova Scotia counts attach to a route. The other eight cover 77 of 6,800 counted km, and they run on roads the National Road Network gives no route number: Hammonds Plains Rd (213), Purcells Cove Rd (253), and two Halifax arterials the province counts as 32 and 33. The province's own section geometry matches its counts but cannot supply a route the national file lacks. |
| 🇨🇦 | Where the Canadian crossings are | source | CBSA's directory gives each of its 116 highway border offices an address and no coordinates. 97 are placed by the NRCan geocoder: 41 to an address, 33 to an intersection, 11 to a street and 12 to a place name only. 17 had no match near the border and are placed where the highway in their address meets the line. Beaver Creek (address a PO box) and Fraser (on BC 2, which the atlas draws only near Dawson Creek) are not placed. Of the 58 that pair with a US port in BTS's data, all but Piney lie within 25 km of it. Piney is 39 km from Pinecreek MN, though 2.9 km from the line. |
| 🇨🇦 | A register of toll facilities | source | Canada publishes none. The seven shown are 407 ETR, the Confederation Bridge, Cobequid Pass and the four international bridges of the Federal Bridge Corporation, each assembled from the documents that govern it. They are not every toll in the country. |
| 🇨🇦 | Fares without a date | source | A fare is shown only with the date it took effect, or the date since which the publisher says it has not changed. The Blue Water Bridge publishes its rates with neither, so none is shown, and no 407 ETR fare was recorded with one. |
| 🇨🇦 | Where a toll stretch sits | source | The three toll stretches are drawn along the atlas route between the ends the NRCan geocoder gives, and each is drawn only if that stretch is within 10% of the published length: 407 ETR measures 104.2 km against 108, the Confederation Bridge 13.7 against 12.9, Cobequid Pass 43.3 against 45. The four international bridges are points at their crossing or route end. |
| 🇨🇦 🇲🇽 | Which road a crossing is on | source | Neither register says. A crossing lists the atlas routes within 2 km of it, by distance alone; 149 of the 167 have one. |
