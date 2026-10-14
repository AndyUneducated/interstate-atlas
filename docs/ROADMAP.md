# East Asia roadmap

Work to bring the East Asian routes (mainland China, Taiwan, Hong Kong) to the depth and breadth of
the North American ones. Paused on 2026-10-14; this file is where to pick it up. What each figure
is and where it comes from stays in [DATA-SOURCES.md](DATA-SOURCES.md) (§4 coverage table,
D-60 to D-77); this file only tracks the work.

## Done

| Milestone | What it delivered |
| --- | --- |
| M0 | Title lockup in every system: shield beside the name, the other language under it, other names as chips (D-75). Names are searchable. East Asian fields moved to where North America has them (register ends and plan length in the header, not under measured figures). |
| M1 | Elevation profiles for every mainland national route, Taiwan route and Hong Kong route. Lanes, bridge and tunnel share from OpenStreetMap (D-76). Hong Kong traffic from the Annual Traffic Census (HK-3), road names in Chinese from OSM (HK-4). |
| M2 | System histories: mainland 1981–2025, Taiwan freeways 1964–2013 and provincial 1939–2026, Hong Kong 1972–2025. |
| M3 | 41 dossiers: 19 mainland, 8 Taiwan, all 10 Hong Kong. Termini oriented by coordinate and end labels from geography (D-77). |
| M4 | 28 more dossiers: all 36 national expressway main lines, Taiwan freeways 1–6 and 10, nine provincial highways. Simplified system names in the zh UI. |

Dossiers now: mainland 39, Taiwan 16, Hong Kong 10 (237 in all).

## Next, in the order proposed

1. **Taiwan freeway official lengths and toll sections.** The Freeway Bureau publishes route
   lengths and the ETC charging sections; neither is read yet (§4: "none for the 國道", toll "none").
2. **Taiwan bridges with year built.** Highway Bureau and Freeway Bureau bridge registers on
   data.gov.tw; would match Ontario's and Mexico's rows.
3. **More dossiers.** Mainland: the longest ordinary national highways (G331, G228, G312, G207,
   G213, G215…) and the busiest regional expressways (G0612, G3012, G1523…). Taiwan: 台17, 台19,
   台21, 台26, 國3甲, 國8. Use [DOSSIER-BRIEF.md](DOSSIER-BRIEF.md).
4. **Mainland per-route opening years** from the dossiers' timelines into the buildout chart.

## Still missing against North America, with no fix in sight

- Mainland traffic: no open per-route source (provincial yearbooks are not open data).
- Mainland and Hong Kong toll share: the OSM toll tag is too sparse (D-69).
- Construction cost outside the dossiers: no register publishes it for any East Asian route.
- Mexico has no dossiers, and so no elevation profiles.

## Open minor points

- Hong Kong census road names are traditional (they are OSM's local names); the rest of the zh UI
  is simplified. Kept on purpose, like the sign labels (3號幹線).
- Dossier figures marked "reported, not checked" are kept by choice; a later pass could check them
  against primary sources.

## Working notes

- Validate dossiers with `node tools/build-content.mjs --check`; publish without `--check`.
  Do not rerun `build-data` for dossier work.
- `npm test`, then `tools/verify.mjs` with `PW_CHANNEL=chrome` (about 7 minutes) before a commit.
