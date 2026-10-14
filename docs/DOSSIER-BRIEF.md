# Writing an East Asian route dossier

The brief given to each writer of the M3 and M4 dossiers ([ROADMAP.md](ROADMAP.md)). A dossier is
the hand-written part of a route's detail page: history, engineering, alignment and the towns it
serves, cost, who paid, driving notes and a dated timeline.

## Read first

- `content/dossiers/tw-fwy-1.json`, `cn-g4.json` and `cn-g6-qhi.json` (an anchored route drawn in
  pieces), for structure, tone and density.
- `content/dossiers/on-401.json`, a North American example of the same format.
- `tools/build-content.mjs`, the validator.

## Format: one file per route, `content/dossiers/<route-id>.json`

- `id`: the atlas route id (`hk-3`, `tw-fwy-3`, `cn-g4`).
- `route`: `{ "sys": "<system id>", "num": "<number>" }`. System ids: `cn-expressway`,
  `cn-national`, `tw-freeway`, `tw-provincial`, `hk-route`. Where several atlas routes share the
  number (mainland routes are often split by province, `cn-g6-qhi` and `cn-g6-xiz`), add
  `"anchor": [lon, lat]`, a point within 25 km of the piece the dossier is about; the build lists
  the candidates otherwise. Write about the whole route, anchor on the longest piece, and do not
  invent lengths. Route rows are in `data/index.json` (fields: id, label, sys, tier, st, mi, base,
  num, cx, cy, …).
- `name` {en, zh}: the road's common name; `aka`: former or popular names as {en, zh}.
- `tagline` {en, zh}: one specific line, not marketing.
- `completedYear`: only if a full-route completion year is sourced.
- `termini.start` and `termini.end` {en, zh, at}: concrete places, `at` as `[lon, lat]`. The build
  uses `at` to put the ends the right way round and warns if it is more than 60 km from either drawn
  end; for a route drawn in pieces, name the drawn piece's ends and give the real terminus in prose.
- `sections`: `{ key, en: [paragraphs], zh: [paragraphs] }`, keys from `character, engineering,
  history, money, traffic, condition, drive`; `character` and `history` are required. en and zh have
  the same number of paragraphs and say the same thing.
- `figures`: `{ label{en,zh}, value{en,zh}, source }`, or `{ label, why{en,zh} }` when there is no
  public figure. Always include "Construction cost / 造价" and "Funding / 出资方", as a value or a why.
- `timeline`: `[{ year, en, zh }]`, 5 to 12 dated events.

## Language

- zh is Simplified Chinese, for Taiwan and Hong Kong roads too, with mainland punctuation.
- en is plain and precise, British spelling. No hype words.
- Money in the source's currency (元, NT$, HK$), with the year.
- People's names in en only in a spelling a source gives; otherwise describe the person's role.
  The zh text keeps the name.

## Sources and honesty

- Any labelled source is acceptable: government sites, reports, Wikipedia, news, trade press. A
  figure taken from Wikipedia citing an original says so: "X, as cited in Chinese Wikipedia, <article>".
- Never invent a fact, date or number. If unsure, leave it out or explain it in a `why`.
- Weak figures (a single trade-press report, unclear scope) stay, but say so in the value:
  "Reported at …; not checked against …".
- Where sources disagree, give each with its source rather than picking one.
- A mainland national expressway's cost is published only per section; say that in a `why` and
  give sourced section costs as separate figures.
- Hong Kong traffic is already on the page from the census; do not repeat its numbers.

## Validate, do not publish

Run `node tools/build-content.mjs --check` on its own; it must end with `content OK` and print no
warning for the new files. Publishing (the same command without `--check`) is done once all writers
are finished.
