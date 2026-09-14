# Interstate Atlas

An interactive atlas of the United States highway network — Interstates, US Routes and
state highways — with a bilingual (English / 简体中文) written record for the routes that
have one.

**Live site:** https://andyuneducated.github.io/interstate-atlas/

The map covers 7,519 routes reconstructed from public geographic data. 155 of them carry a
hand-written dossier; the rest carry a measured data profile.

## What it does

- **Map.** MapLibre GL over an OpenFreeMap dark basemap, with every route in the network
  selectable. 3D terrain optional.
- **Route detail.** Termini, length, state-by-state mileage, roadway classification, and
  for curated routes a written account of how the road came to be, what it cost, what it
  carries and what condition it is in.
- **Flythrough.** Follows a route's mainline end to end with the camera on the pavement.
- **Numbering explainer.** Why I-5 is on the west coast and I-95 on the east, drawn rather
  than described.
- **Buildout timeline.** 1956 to today, showing only routes with a documented completion
  year.
- **Statistics dashboard.** Network totals by system and by state.
- **Elevation profiles.** Sampled from open terrain data for curated routes.
- **Trip planner.** Chain routes into an itinerary.
- **Command palette.** `/` or `Ctrl`+`K` to reach any route, state or view.

## On accuracy

This is the part worth reading before trusting a number on the site.

Two kinds of figure appear, and they are never mixed:

**Measured.** Length, endpoints, per-state mileage, straight-line span and roadway-class
composition are computed here from Natural Earth's 1:1,000,000 road geometry. They are
close, not survey-exact — generalised geometry cuts corners, so measured lengths tend to
run slightly short. Across the 234 routes where an official figure exists to check against,
the median disagreement is −0.6%, two-thirds land within 5%, and four-fifths within 10%.
Every page carrying these numbers says so.

**Published.** Official Interstate mileage comes from the FHWA Route Log and Finder List.
Everything in a written dossier — costs, traffic counts, construction dates, condition —
carries its own source line naming the publication and its date.

Where no published figure exists, the site says so explicitly rather than estimating. A
1,900-mile Interstate assembled over six decades by sixteen jurisdictions has no single
construction cost, and the page says that instead of inventing one. The content build
enforces this: a figure must either carry a source or carry an explanation of why it is
absent, and English and Chinese must both be present. `node tools/build-content.mjs` fails
the build otherwise.

## Data sources

| Source | Used for | Licence |
| --- | --- | --- |
| [Natural Earth](https://www.naturalearthdata.com/) 1:10m North America roads | route geometry, roadway class | public domain |
| [US Census Gazetteer](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html) 2023 places | terminus naming (32,329 places) | public domain |
| [FHWA Route Log and Finder List](https://www.fhwa.dot.gov/planning/national_highway_system/interstate_highway_system/routefinder/) (Jan 2026) | official Interstate mileage, urban areas served | US government work |
| [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (AWS Open Data) | elevation profiles | open data |
| [OpenFreeMap](https://openfreemap.org/) | vector basemap | open |

No API keys, no build step for the client, no framework. The site is static files.

## Building

```sh
npm install
node tools/fetch-source.mjs      # downloads Natural Earth + Census gazetteer to tools/src/
node tools/fetch-fhwa.mjs        # scrapes the FHWA Route Log to content/reference/
node tools/build-data.mjs        # geometry -> data/geo/, data/index.json, data/stats.json
node tools/build-content.mjs     # validates content/dossiers/ -> data/dossiers/, data/timeline.json
node tools/build-elevation.mjs   # samples terrain -> data/elevation/
node tools/serve.mjs             # http://localhost:8787
node tools/verify.mjs            # headless run-through, screenshots to tools/shots/
```

`tools/src/` (source downloads) and `tools/cache/` (terrain tiles) are gitignored. The
first elevation run fetches a few thousand tiles and is slow; reruns are cached.

### How routes are reconstructed

The source data is a pile of road fragments, split at state lines and wherever the
classification changes. Turning that back into routes is most of the work in
`tools/build-data.mjs` and `tools/geo.mjs`:

1. Fragments are grouped by system and number, and their endpoints snapped onto shared
   nodes by real distance rather than by grid cell, because the two sides of a state line
   disagree by a few metres.
2. Genuine holes in the data — where a route crosses a metro area under another
   classification, or a toll road is missing outright — are bridged as graph edges so the
   end-to-end path still falls out of one shortest-path search. Bridges are flagged, never
   drawn, and never counted as pavement.
3. Same-numbered roads are only merged when the states they run through are contiguous, so
   the eight unrelated I-295s stay eight roads while I-80 stays one.

## Licence

Code is MIT. Written content is CC BY 4.0. The underlying data keeps the licences above.
