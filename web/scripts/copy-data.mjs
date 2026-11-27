// Copies the pipeline output (../data) into public/data so Vite serves it as static files.
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, "..", "data");
const out = join(root, "public", "data");
rmSync(out, { recursive: true, force: true }); // start clean, so nothing from an earlier run lingers
mkdirSync(out, { recursive: true });
for (const f of ["airports.json", "borders.geojson", "country-areas.geojson", "countries.json"]) copyFileSync(join(src, f), join(out, f));
writeFileSync(join(out, "routes-web.json"), JSON.stringify(compactRoutes(JSON.parse(readFileSync(join(src, "routes.json"), "utf8")))));
// meta.json keeps, for the record, the Wikipedia revision of every page read (`source_pages`, most of the file);
// the site only needs the date and the covered countries, so that list stays out of the published copy.
const { source_pages: _pages, ...meta } = JSON.parse(readFileSync(join(src, "meta.json"), "utf8"));
writeFileSync(join(out, "meta.json"), JSON.stringify(meta));
cpSync(join(src, "countries"), join(out, "countries"), { recursive: true });
// Airline logos are optional: data/logos/ isn't in the public repo (about half are non-free trademarks), so a
// fresh checkout or the live build has none. Only logos whose file exists are listed; the rest show initials.
if (existsSync(join(src, "airlines.json"))) {
  const airlines = JSON.parse(readFileSync(join(src, "airlines.json"), "utf8"));
  let kept = 0;
  for (const a of Object.values(airlines)) {
    if (a.logo && existsSync(join(src, a.logo))) kept++;
    else delete a.logo;
  }
  writeFileSync(join(out, "airlines.json"), JSON.stringify(airlines));
  // Only the logos airlines.json points to (data/logos/ can hold files from earlier names of an airline).
  mkdirSync(join(out, "logos"), { recursive: true });
  for (const a of Object.values(airlines)) if (a.logo) copyFileSync(join(src, a.logo), join(out, a.logo));
  console.log(`airline logos: ${kept} found${kept ? "" : " (data/logos/ missing: initials are shown instead)"}`);
}
// Flags from flag-icons (MIT), standard 4:3 versions (the square ones are redrawn adaptations that misplace
// elements, e.g. Bangladesh's disc and Australia's Union Jack). Only the countries the site offers.
const flagsOut = join(root, "public", "flags");
mkdirSync(flagsOut, { recursive: true });
for (const { iso2 } of JSON.parse(readFileSync(join(src, "countries.json"), "utf8"))) {
  const code = iso2.toLowerCase();
  copyFileSync(join(root, "node_modules", "flag-icons", "flags", "4x3", `${code}.svg`), join(flagsOut, `${code}.svg`));
}
console.log(`copied route data to ${out}`);

/**
 * routes.json in a compact form for the site (decoded by web/src/lib/data.ts): the same data, but each airline and
 * each kind of listing is written once in a table and referred to by number, instead of repeating
 * {"airline": …, "airline_wiki": …, "category": …} on all 100,000 listings. About half the download and a ninth of
 * the size to parse.
 *   airlines: [name, wikipediaTitle | null][]
 *   listings: [airline, category, status, note | null, noteDate | null][]   (an airline's listing on a route)
 *   routes:   [origin, dest, flags, listing[]][]
 *             flags: 1 domestic, 2 seasonal only, 4 charter only, then the route's status (index in `statuses`) × 8
 */
function compactRoutes(routes) {
  const index = (map, list, key, value) => {
    if (!map.has(key)) {
      map.set(key, list.length);
      list.push(value);
    }
    return map.get(key);
  };
  const airlineIds = new Map(), airlines = [];
  const listingIds = new Map(), listings = [];
  const categories = ["scheduled", "seasonal", "charter", "seasonal charter"];
  const statuses = ["active", "upcoming", "suspended"];
  const notes = [null, "begins", "resumes", "ends", "suspended"];
  const rows = routes.map((r) => {
    if (!statuses.includes(r.status)) throw new Error(`routes.json: unexpected status ${r.status}`);
    const flags = (r.domestic ? 1 : 0) | (r.seasonal_only ? 2 : 0) | (r.charter_only ? 4 : 0) | (statuses.indexOf(r.status) << 3);
    const ids = r.airlines.map((a) => {
      const airline = index(airlineIds, airlines, JSON.stringify([a.airline, a.airline_wiki]), [a.airline, a.airline_wiki]);
      const listing = [airline, categories.indexOf(a.category), statuses.indexOf(a.status), notes.indexOf(a.note ?? null), a.note_date ?? null];
      if (listing.slice(1, 4).includes(-1)) throw new Error(`routes.json: unexpected value in ${JSON.stringify(a)}`);
      return index(listingIds, listings, JSON.stringify(listing), listing);
    });
    return [r.origin, r.dest, flags, ids];
  });
  return { categories, statuses, notes, airlines, listings, routes: rows };
}
