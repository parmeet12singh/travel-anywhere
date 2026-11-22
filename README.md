# Travel Anywhere

Pick any Indian city and see every place you can fly to from it, on a map: domestic and international, direct flights first, and later with 1, 2 or 3 stops.

## Status

**v1: direct routes, live-ready.** The data pipeline (`pipeline/` → `data/`) and the site (`web/`) are complete for phase 1.

### What the site does (v1)

- **Pick a city** (search by city, airport, code, old names like Bombay, or a country) or click a dot. Dot size shows how many non-stop destinations an airport has.
- **See every non-stop destination** as arcs on the map and as a list: magenta for India, teal abroad. Filter by India / Abroad and by airline, sort by name or distance.
- **Route page:** distance, local time and UTC offset at both ends, each airline with its logo, a link to its website, and seasonal / starts / ends notes.
- **Country picker** (top right, with the country's flag): frames the country, highlights its border and states/provinces, and lists its airports. India is the default.
- **Two countries:** hover a country on the map to preview it, click it (or pick one under "Most connected countries") to see every route between it and the picker's country: both borders highlighted, the links on the map, airlines and busiest routes in the panel.
- **Light and dark themes**, shareable links for every view (`?from=DEL&to=DXB`, `?pair=AE`, `?country=AE`), browser Back and Escape step back one level, keyboard and screen-reader friendly, works on phones.
- **India's official boundaries** throughout: all of Jammu & Kashmir, Ladakh and Arunachal Pradesh.

Deferred to later: live weather, flight durations, full route data for other countries, then phases 2 and 3 below.

| Phase | Scope |
|---|---|
| 1 | Direct flights from every Indian airport (domestic + international) |
| 2 | 1 / 2 / 3-stop reachability, colour-coded |
| 3 | Fares on the map (Travelpayouts) |

## Layout

```
travel-anywhere/
├── pipeline/   Python: scrape Wikipedia → resolve airports → data/*.json
├── data/       Generated data (committed, so changes show up in git history)
└── web/        React + Vite + Tailwind + MapLibre + deck.gl site (design notes in web/DESIGN.md)
```

## Data

Route data comes from the **"Airlines and destinations"** tables in Wikipedia airport articles.

| File | Contents |
|---|---|
| `data/airports.json` | Every airport that appears in a route: IATA code, name, city, country, coordinates, Wikipedia article |
| `data/routes.json` | One entry per origin → destination pair: domestic flag, status, and the airlines flying it (with seasonal / charter / begins / ends notes) |
| `data/meta.json` | Build time, counts, and the Wikipedia revision ID of every page used |
| `data/airlines.json` | Airline websites and logo details, with each logo file's licence |
| `data/logos/` | Airline logo files. **Not in the repo:** about half are non-free (fair use) trademarks. Run `travel_pipeline.logos` to download them locally; without them the site shows each airline's initials |
| `data/borders.geojson` | Every country's outline, India point of view (thin grey lines on the map) |
| `data/countries.json` | The countries you can pick: name, area to frame, airport and route counts |
| `data/countries/<ISO2>.geojson` | Per country: its highlighted border and its state/province lines (loaded only when needed) |
| `data/country-areas.geojson` | Filled country shapes, invisible on the site: used to tell which country is under the pointer |
| `data/report.md` | Everything that needs a human look: unmatched links, pages without tables, one-sided routes |

How it works:

1. **Origins:** every Indian airport that [OurAirports](https://ourairports.com/data/) marks as having scheduled service. Indian airports discovered in other airports' tables are added automatically.
2. **Scrape:** each airport's article is fetched through the Wikipedia API, and the passenger table(s) are parsed. Cargo tables are excluded; `Seasonal:` / `Charter:` labels and `(begins …)`, `(resumes …)`, `(ends …)` notes are kept.
3. **Resolve:** each destination link is followed through Wikipedia redirects to the real airport article, then mapped to an IATA code using Wikidata (P238) and OurAirports. Coordinates come from OurAirports.
4. **Status:** each airline on a route is `active`, `upcoming` (begins/resumes in the future) or `suspended`. Listings whose end date has passed are dropped.

Wikipedia is the only source for routes. OurAirports and Wikidata are used only to turn an airport article into an IATA code and coordinates.

### Rebuilding the data

```sh
cd pipeline
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m pytest -q                       # parser tests
.venv/bin/python -m travel_pipeline.build            # uses the cache in pipeline/.cache
.venv/bin/python -m travel_pipeline.build --refresh  # re-download everything from Wikipedia
.venv/bin/python -m travel_pipeline.logos            # airline logos from each airline's Wikipedia infobox
.venv/bin/python -m travel_pipeline.borders          # borders as India officially shows them + per-country files
```

Airline logos and websites come from each airline's Wikipedia infobox. For airlines whose article has no logo, `pipeline/logo_overrides.json` points at the logo on the airline's own website.

The first run takes about 15–20 minutes because requests are rate-limited. Later runs read from the cache and finish in seconds.

## Running the site

```sh
cd web
npm install
npm run dev      # http://localhost:5173 (copies ../data into web/public/data first)
npm run build    # production build in web/dist
```

`npm run dev` / `npm run build` first copy `../data` into `web/public/data` and the needed flags into `web/public/flags` (both generated, not committed).

### Deploying

The site is fully static (no server or database), so any static host works.

**GitHub Pages (current):** `.github/workflows/deploy-pages.yml` builds and publishes the site on every push to `main`, at `https://<user>.github.io/travel-anywhere/`. One-time setup: repo **Settings → Pages → Source: GitHub Actions**. The workflow builds with `BASE_PATH=/travel-anywhere/` because the site lives in a sub-folder there; every data and flag path goes through `web/src/lib/asset.ts`, so nothing is hard-coded to `/`.

**Cloudflare Pages (alternative):** free, unlimited bandwidth, data centres across India. No `BASE_PATH` needed:

| Setting | Value |
|---|---|
| Root directory | `web` |
| Build command | `npm ci && npm run build` |
| Output directory | `dist` |

To update the routes: rebuild the data (above), commit `data/`, push. The site redeploys on its own.

### Tech

React 19, TypeScript, Vite, Tailwind CSS v4, MapLibre GL (base map from [OpenFreeMap](https://openfreemap.org/), © OpenStreetMap contributors), deck.gl for routes and dots, Headless UI and Heroicons for the controls, Fuse.js for search, Barlow fonts. Design notes: [`web/DESIGN.md`](web/DESIGN.md).

## Licensing

Route data is derived from Wikipedia ([CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)). Airport data is from OurAirports (public domain) and Wikidata (CC0). Country borders are from Natural Earth's "India point of view" dataset (public domain), so the map shows India's official boundaries: all of Jammu & Kashmir and Ladakh, and all of Arunachal Pradesh. Indian state and union-territory lines come from Natural Earth's admin-1 data, with Jammu & Kashmir and Ladakh rebuilt to match India's official map. The generated `data/` files must carry the same CC BY-SA attribution when redistributed.

Map tiles: OpenFreeMap / OpenMapTiles, data © OpenStreetMap contributors (ODbL). Flags: [flag-icons](https://github.com/lipis/flag-icons) (MIT). Icons: [Heroicons](https://heroicons.com/) (MIT). Airline logos are trademarks of their owners; each file's licence is recorded in `data/airlines.json`.
