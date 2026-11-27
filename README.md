# Travel Anywhere

Pick a city in any covered country and see every place you can fly to from it, on a map: domestic and international, direct flights first, and later with 1, 2 or 3 stops.

## Status

**Phase 1 (direct routes) covers the whole world.** 239 countries and territories have full route lists: 4,391 airports and 65,845 non-stop routes, read from 4,251 Wikipedia airport articles (data as of 26 Nov 2026). 234 of them can be picked on the map; the other five (Andorra, Liechtenstein, San Marino, Vatican City, Palestine) have no airport with scheduled flights.

### Countries covered

Full route lists, by continent:

| Continent | Countries |
|---|---|
| Africa | Algeria, Angola, Benin, Botswana, Burkina Faso, Burundi, Cameroon, Cape Verde, Central African Republic, Chad, Comoros, Côte d'Ivoire, DR Congo, Djibouti, Egypt, Equatorial Guinea, Eritrea, Eswatini, Ethiopia, Gabon, Gambia, Ghana, Guinea, Guinea-Bissau, Kenya, Lesotho, Liberia, Libya, Madagascar, Malawi, Mali, Mauritania, Mauritius, Mayotte, Morocco, Mozambique, Namibia, Niger, Nigeria, Republic of the Congo, Rwanda, Réunion, Saint Helena, Senegal, Seychelles, Sierra Leone, Somalia, South Africa, South Sudan, Sudan, São Tomé and Principe, Tanzania, Togo, Tunisia, Uganda, Western Sahara, Zambia, Zimbabwe |
| Asia | Afghanistan, Armenia, Azerbaijan, Bahrain, Bangladesh, Bhutan, Brunei, Cambodia, China, Christmas Island, Cocos (Keeling) Islands, Cyprus, Georgia, Hong Kong, India, Indonesia, Iran, Iraq, Israel, Japan, Jordan, Kazakhstan, Kuwait, Kyrgyzstan, Laos, Lebanon, Macau, Malaysia, Maldives, Mongolia, Myanmar, Nepal, North Korea, Oman, Pakistan, Palestinian Territory (no scheduled flights today), Philippines, Qatar, Saudi Arabia, Singapore, South Korea, Sri Lanka, Syria, Taiwan, Tajikistan, Thailand, Timor-Leste, Turkey, Turkmenistan, United Arab Emirates, Uzbekistan, Vietnam, Yemen |
| Europe | Albania, Andorra (no scheduled flights today), Austria, Belarus, Belgium, Bosnia and Herzegovina, Bulgaria, Croatia, Czech Republic, Denmark, Estonia, Faroe Islands, Finland, France, Germany, Gibraltar, Greece, Guernsey, Hungary, Iceland, Ireland, Isle of Man, Italy, Jersey, Kosovo, Latvia, Liechtenstein (no scheduled flights today), Lithuania, Luxembourg, Malta, Moldova, Monaco (no scheduled flights today), Montenegro, Netherlands, North Macedonia, Norway, Poland, Portugal, Romania, Russia, San Marino (no scheduled flights today), Serbia, Slovakia, Slovenia, Spain, Sweden, Switzerland, Ukraine (no scheduled flights today), United Kingdom, Vatican City (no scheduled flights today) |
| North America | Anguilla, Antigua and Barbuda, Aruba, Bahamas, Barbados, Belize, Bermuda, British Virgin Islands, Canada, Caribbean Netherlands, Cayman Islands, Costa Rica, Cuba, Curaçao, Dominica, Dominican Republic, El Salvador, Greenland, Grenada, Guadeloupe, Guatemala, Haiti, Honduras, Jamaica, Martinique, Mexico, Montserrat, Nicaragua, Panama, Puerto Rico, Saint Barthélemy, Saint Kitts and Nevis, Saint Lucia, Saint Martin, Saint Pierre and Miquelon, Saint Vincent and the Grenadines, Sint Maarten, Trinidad and Tobago, Turks and Caicos Islands, U.S. Virgin Islands, United States |
| Oceania | American Samoa, Australia, Cook Islands, Fiji, French Polynesia, Guam, Kiribati, Marshall Islands, Micronesia, Nauru, New Caledonia, New Zealand, Niue, Norfolk Island, Northern Mariana Islands, Palau, Papua New Guinea, Samoa, Solomon Islands, Tonga, Tuvalu, Vanuatu, Wallis and Futuna |
| South America | Argentina, Bolivia, Brazil, Chile, Colombia, Ecuador, Falkland Islands, French Guiana, Guyana, Paraguay, Peru, Suriname, Uruguay, Venezuela |

### What the site does (v1)

- **Pick a city** (search by city, airport, code, old names like Bombay, or a country) or click a dot. Dot size shows how many non-stop destinations an airport has. A city name that exists in several countries lists the matches grouped by country, the country with the most routes first ("london": the UK's six airports, then London, Ontario). Where dots crowd together (New York, zoomed out), a click opens a short list of the airports there; a very crowded spot zooms in instead.
- **The capital** of the picked country is marked ★ with its name, beside its busiest airport; the label is a link to that airport (or a list, when the capital has several).
- **See every non-stop destination** as arcs on the map and as a list: magenta within the same country, teal abroad. Filter by domestic / abroad and by airline, sort by name or distance.
- **Route page:** distance, local time and UTC offset at both ends, each airline with its logo, a link to its website, and seasonal / starts / ends notes.
- **Country picker** (top right, with the country's flag): frames the country, tints its land, outlines its land borders and coast in one solid line, shows its states/provinces, and lists its airports. India is the default; every country works the same way.
- **Two countries:** hover a country on the map to preview it, click it (or pick one under "Most connected countries") to see every route between it and the picker's country: both borders highlighted (a border they share alternates both colours), the links on the map, airlines and busiest routes in the panel.
- **Light and dark themes**, shareable links for every view (`?from=DEL&to=DXB`, `?pair=AE`, `?country=AE`), browser Back and Escape step back one level, keyboard and screen-reader friendly, works on phones.
- **India's official boundaries** throughout: all of Jammu & Kashmir, Ladakh and Arunachal Pradesh.

Deferred to later: live weather, flight durations, inset maps for far-off parts of countries (Alaska, Azores), an "overseas territory" note for places like the Falklands, fixes from the accessibility review (focus after picking, tab order, skip link), then phases 2 and 3 below.

Known limitation: Wikipedia lists through-flights as plain destinations, so a few "non-stop" routes actually stop on the way (Sydney–London via Singapore, Shanghai–Buenos Aires via Auckland). About 16 routes over 15,000 km are the clear cases.

| Phase | Scope |
|---|---|
| 1 | Direct flights from every airport in the covered countries (domestic + international) |
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
| `data/meta.json` | Build time, counts, and the Wikipedia revision ID of every page used (the published copy leaves the revision list out) |
| `data/airlines.json` | Airline websites and logo details, with each logo file's licence |
| `data/logos/` | Airline logo files, scaled to the size the site shows them. **Not in the repo:** about half are non-free (fair use) trademarks. Run `travel_pipeline.logos` to download them locally; without them the site shows each airline's initials |
| `data/borders.geojson` | Every land border between countries, India point of view (thin grey lines on the map). Coasts come from the base map |
| `data/countries.json` | The countries you can pick: name, area to frame, airport and route counts, and the capital (name and position) |
| `data/countries/<ISO2>.geojson` | Per country, loaded only when picked: `area` (its land, for the tint), `border` (land borders, the very same lines as in `borders.geojson` and in each neighbour's file), `coast` (from OpenStreetMap's land, matching the base map's shoreline) and `provinces` |
| `data/country-areas.geojson` | Filled country shapes, invisible on the site: used to tell which country is under the pointer |
| `data/routes_to_verify.csv` | Routes only one of the two airports lists, to check by hand |
| `data/report.md` | Everything that needs a human look: unmatched links, pages without tables, one-sided routes |

How it works:

1. **Origins:** every airport in the covered countries (`COUNTRIES_BY_CONTINENT` in `pipeline/travel_pipeline/config.py`) that [OurAirports](https://ourairports.com/data/) marks as having scheduled service. Airports of those countries discovered in other airports' tables are added automatically. Airports inside India's official boundary that another country administers (Gilgit, Skardu, Chilas, Muzaffarabad, Rawalakot) are left out, so the data doesn't contradict the map.
2. **Scrape:** each airport's article is fetched as a normal Wikipedia page (cached by Wikimedia; the API is used only for batches of redirect and file look-ups, within its rate limit for clients without contact details), and the passenger table(s) are parsed. Cargo, statistics and former-airline tables are excluded; small airports that describe their routes in a sentence ("Air Tahiti connects Ahe Airport to ...") are read with strict patterns; `Seasonal:` / `Charter:` labels (typos and variants like "Seasonal cherter" or "Hajj & Umrah" included) and `(begins …)`, `(resumes …)`, `(ends …)` notes are kept.
3. **Resolve:** each destination link is followed through Wikipedia redirects to the real airport article, then mapped to an IATA code using Wikidata (P238) and OurAirports. Coordinates come from OurAirports. A code whose Wikidata article is far (over 150 km) from the airport with that code is ignored (codes get reused). Airline links are resolved the same way, so one airline is one entry under its most-used name; a redirect to something that isn't an airline ("Iberia" → Iberian Peninsula) is not followed.
4. **One-sided routes are kept, and listed for checking:** Wikipedia's articles often disagree, usually because one is incomplete. Routes that only one of the two airports lists (or whose second airport has no table) are in `data/routes_to_verify.csv`; notes typed in its last column survive rebuilds. Airports whose article only has a "former" list are left out.
5. **Status:** each airline on a route is `active`, `upcoming` (begins/resumes in the future) or `suspended`. Listings whose end date has passed are dropped.

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

`borders` runs on every CPU core (about 3 minutes). The first run also downloads OpenStreetMap's simplified land polygons (about 25 MB, kept in `pipeline/.cache`) for the coastlines.

Airline logos and websites come from each airline's Wikipedia infobox. For airlines whose article has no logo, `pipeline/logo_overrides.json` points at the logo on the airline's own website. Raster logos are scaled down to the size the site shows them at (at most 240 × 108 px).

The site doesn't load `routes.json` as it is: `web/scripts/copy-data.mjs` (run by `npm run dev` and `npm run build`) publishes it as `routes-web.json`, the same data in a compact form (394 KB compressed instead of 791 KB, a ninth of the size to parse), leaves the revision list out of the published `meta.json`, and copies only the logos `airlines.json` points to.

A first run for the whole world takes several hours, because requests to Wikipedia are rate-limited; runs share one request queue, so several can work at once and any can be stopped and restarted. Later runs read from the cache and finish in minutes.

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

Route data is derived from Wikipedia ([CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)). Airport data is from OurAirports (public domain) and Wikidata (CC0). Country borders are from Natural Earth's "India point of view" dataset (public domain), so the map shows India's official boundaries: all of Jammu & Kashmir and Ladakh, and all of Arunachal Pradesh. Coastlines of the picked country are cut from OpenStreetMap's simplified land polygons (© OpenStreetMap contributors, ODbL). Capitals are from Wikidata (CC0). Indian state and union-territory lines come from Natural Earth's admin-1 data, with Jammu & Kashmir and Ladakh rebuilt to match India's official map. The generated `data/` files must carry the same CC BY-SA attribution when redistributed.

Map tiles: OpenFreeMap / OpenMapTiles, data © OpenStreetMap contributors (ODbL). Flags: [flag-icons](https://github.com/lipis/flag-icons) (MIT). Icons: [Heroicons](https://heroicons.com/) (MIT). Airline logos are trademarks of their owners; each file's licence is recorded in `data/airlines.json`.
