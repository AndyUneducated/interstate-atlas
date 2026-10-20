# East Asia roadmap

Work to bring the East Asian routes (mainland China, Taiwan, Hong Kong) to the depth and breadth of
the North American ones. Paused on 2026-10-14; this file is where to pick it up. What each figure
is and where it comes from stays in [DATA-SOURCES.md](DATA-SOURCES.md) (§4 coverage table,
D-60 onward); this file only tracks the work.

## Done

| Milestone | What it delivered |
| --- | --- |
| M0 | Title lockup in every system: shield beside the name, the other language under it, other names as chips (D-75). Names are searchable. East Asian fields moved to where North America has them (register ends and plan length in the header, not under measured figures). |
| M1 | Elevation profiles for every mainland national route, Taiwan route and Hong Kong route. Lanes, bridge and tunnel share from OpenStreetMap (D-76). Hong Kong traffic from the Annual Traffic Census (HK-3), road names in Chinese from OSM (HK-4). |
| M2 | System histories: mainland 1981–2025, Taiwan freeways 1964–2013 and provincial 1939–2026, Hong Kong 1972–2025. |
| M3 | 41 dossiers: 19 mainland, 8 Taiwan, all 10 Hong Kong. Termini oriented by coordinate and end labels from geography (D-77). |
| M4 | 28 more dossiers: all 36 national expressway main lines, Taiwan freeways 1–6 and 10, nine provincial highways. Simplified system names in the zh UI. |

Dossiers now: mainland 48, Taiwan 22, Hong Kong 10, Mexico 5 (257 in all).

## Data that exists and is not yet built (planned 2026-10-19)

Each is a *pending* row in [ACCURACY.md §6](ACCURACY.md#6-known-gaps) and the coverage table
([DATA-SOURCES.md §4](DATA-SOURCES.md#4-coverage-by-country)); remove the row when it is done.
Smallest first.

| # | Work | Source | Decided |
| --- | --- | --- | --- |
| P1 | Taiwan freeway official lengths | Freeway Bureau 路段基本資訊 v2.0 (data.gov.tw 37652) | **done** 2026-10-19 (TW-6, D-78): the end chainage is shown as the official length, source named |
| P2 | Taiwan freeway tolls: toll share per freeway, gantries on the toll layer | 國道計費門架座標及里程牌價表 (data.gov.tw 21165); toll-station dates (118759) | **done** 2026-10-19 (TW-7, TW-8, D-79) |
| P3 | Hong Kong tunnel and bridge tolls on the toll layer and route panel | Transport Department, Road Network (2nd generation), toll tables | **done** 2026-10-19 (HK-5, D-80): nine tunnels, private-car toll |
| P4 | Elevation profiles for every Interstate, US route, Trans-Canada, NHS route and Mexican federal route | AWS Terrain Tiles (X-2), as now | **done** 2026-10-19 (D-81): main routes only; state and provincial routes stay without |
| P5 | Mainland and Hong Kong land border crossings | National Office of Port Administration list of 84 highway ports, placed at OpenStreetMap's border-control points | **done** 2026-10-19 (CN-3, CN-4, D-82): 69 of 84 placed, labelled as placed by OpenStreetMap; 14 unmapped ports listed |
| P6 | Quebec bridges with year built | MTMD Structure (Données Québec), WFS | **done** 2026-10-19 (CA-18, D-83): 5,181 structures on the numbered routes |
| P7 | US bridges with year built | FHWA National Bridge Inventory | **done** 2026-10-19 (US-11, D-84): 196,860 bridges that carry an atlas route, loaded a state at a time |
| P8 | More dossiers: the longest mainland national highways, regional expressways, Taiwan provincial highways and freeways, and Mexico's federal routes | [DOSSIER-BRIEF.md](DOSSIER-BRIEF.md) | **done** 2026-10-19 (257 in all): 台17, 台19, 台21, 台26, 國3甲, 國8; G331, G228, G312, G207, G213, G215; G0612, G3012, G1523; Mexico's first five, MEX-15, 45, 57, 85 and 200. Second round 2026-10-19 (305 in all): ten more Mexican federal routes, ten mainland national highways, eight regional expressways and rings, ten Canadian provincial highways and ten US routes. More can follow the brief, route by route |
| P9 | Mainland per-route opening years from the dossiers' timelines into the buildout chart | dossiers | **done** 2026-10-19 (D-85): 22 of the 36 main lines dated, the rest listed undated |

## Checked 2026-10-19 and planned

The checks the previous list left open. What exists is planned below; what does not is a *source*
row in [ACCURACY.md §6](ACCURACY.md#6-known-gaps).

| # | Work | Source | Decided |
| --- | --- | --- | --- |
| P10 | Mexican federal official lengths | SICT *Red Federal Pavimentada* 2024, datos.gob.mx (CC BY 4.0); free network only, so labelled as such | **needs a decision** (probed 2026-10-19): the file sums each route's free federal tramos *and* its branches (ramales, 5,000 of 40,563 km) and leaves out its D toll roads, so it agrees with the measured length within 10% on only 40 of 119 routes. Shown as the headline it would read as a register like FHWA's; shown in the provenance section, as "SICT free federal network: N km, of which branches M", it would not |
| P11 | Alberta bridges with year built | Alberta Transportation `Structure-Export.csv` (licence to confirm) | **skipped** 2026-10-19: the export sits in the department's file directory (transportation.alberta.ca/planningtools/Data/Bridge/) with no licence stated, and open.alberta.ca, where the Open Government Licence – Alberta applies, carries no structure inventory. Not open under [§2](DATA-SOURCES.md#2-what-a-source-must-meet); a *source* row now. Asking the department to publish it on open.alberta.ca would open it |
| P12 | Taiwan provincial average roughness, one IRI per route | data.gov.tw 98064 | **done** 2026-10-19 (TW-9, D-86) |
| P13 | Pavement roughness in Alberta (50 m, with coordinates) and Ontario (by chainage, needs the 2015 LHRS to place) | open.alberta.ca; data.ontario.ca | |
| P14 | Canadian official lengths per route: BC Landmark Kilometre Inventory, Saskatchewan HIGHWAY_OFFICIAL, New Brunswick DTI network, Manitoba 2018 inventory, Ontario and Alberta section lengths | provincial open-data portals | **done** 2026-10-19 (CA-19 to CA-22, D-87): 1,201 highways in the headline, source named; 167 more than 20% from the drawn piece left with their measurement. The 20% test is my call, on D-59's pattern: **for you to confirm** |

## Missing against North America because no source exists

These are *source* rows in [ACCURACY.md §6](ACCURACY.md#6-known-gaps).

- Mainland traffic, official lengths and toll share; mainland bridges.
- Taiwan bridges (released only on application) and Hong Kong bridge years.
- Construction cost outside the dossiers, everywhere but the Interstates.

## Open minor points

- Hong Kong census road names are traditional (they are OSM's local names); the rest of the zh UI
  is simplified. Kept on purpose, like the sign labels (3號幹線).
- Dossier figures marked "reported, not checked": the 23 in the dossiers written before
  2026-10-19's second round were checked against primary sources that day. 13 were confirmed
  and now cite them; four of those were corrected (G1 Heilongjiang 6.332 billion, not 5.864;
  G219 Shiquanhe–Rutog paved 2007, not 2006; G3 Langfang's earlier estimate 5.057 billion;
  G7 Baigeda–Mingshui 6.21 billion). Nine have no primary source and keep the mark (G10, G3012
  Xiaocaohu–Hoxud, G331, G42 Wanzhou–Yunyang, G50, MEX-45, MEX-200, PH 7, Freeway 6), and the
  Freeway 10 figure now gives the outturn beside the 2010 report. The 48 new dossiers' marked
  figures have not had this pass.

## Working notes

- Validate dossiers with `node tools/build-content.mjs --check`; publish without `--check`.
  Do not rerun `build-data` for dossier work.
- `npm test`, then `tools/verify.mjs` with `PW_CHANNEL=chrome` (about 7 minutes) before a commit.
