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

Dossiers now: mainland 39, Taiwan 16, Hong Kong 10 (237 in all).

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
| P5 | Mainland and Hong Kong land border crossings | National Office of Port Administration list of 84 highway ports, placed at OpenStreetMap's border-control points | labelled as placed by OpenStreetMap |
| P6 | Quebec bridges with year built | MTMD Structure (Données Québec), WFS | |
| P7 | US bridges with year built | FHWA National Bridge Inventory | only bridges that carry an atlas route |
| P8 | More dossiers: the longest mainland national highways (G331, G228, G312, G207, G213, G215…), regional expressways (G0612, G3012, G1523…), Taiwan's 台17, 台19, 台21, 台26, 國3甲, 國8, and Mexico's federal routes | [DOSSIER-BRIEF.md](DOSSIER-BRIEF.md) | |
| P9 | Mainland per-route opening years from the dossiers' timelines into the buildout chart | dossiers | |

## Still to check whether the data exists

- Bridges in Canadian provinces other than Ontario and Quebec.
- Per-route official lengths in Canada (provincial registers) and Mexico (SICT's Datos Viales
  gives each tramo's length, which may add up to a route's).
- Pavement condition outside the United States.

## Missing against North America because no source exists

These are *source* rows in [ACCURACY.md §6](ACCURACY.md#6-known-gaps).

- Mainland traffic, official lengths and toll share; mainland bridges.
- Taiwan bridges (released only on application) and Hong Kong bridge years.
- Construction cost outside the dossiers, everywhere but the Interstates.

## Open minor points

- Hong Kong census road names are traditional (they are OSM's local names); the rest of the zh UI
  is simplified. Kept on purpose, like the sign labels (3號幹線).
- Dossier figures marked "reported, not checked" are kept by choice; a later pass could check them
  against primary sources.

## Working notes

- Validate dossiers with `node tools/build-content.mjs --check`; publish without `--check`.
  Do not rerun `build-data` for dossier work.
- `npm test`, then `tools/verify.mjs` with `PW_CHANNEL=chrome` (about 7 minutes) before a commit.
