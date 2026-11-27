import { asset } from "./asset";

export type Airport = {
  iata: string;
  label: string; // the name travellers know it by, e.g. "Goa–Mopa"
  name: string;
  city: string;
  country: string;
  country_name: string;
  lat: number;
  lon: number;
  tz: string; // IANA time zone, e.g. "Asia/Kolkata"
  is_origin: boolean;
  wiki: string | null;
};

export type AirlineOnRoute = {
  airline: string;
  airline_wiki: string | null;
  category: string; // scheduled | seasonal | charter | seasonal charter
  status: "active" | "upcoming" | "suspended";
  note?: "begins" | "resumes" | "ends" | "suspended";
  note_date?: string | null;
};

export type Route = {
  origin: string;
  dest: string;
  domestic: boolean;
  status: "active" | "upcoming" | "suspended";
  seasonal_only: boolean;
  charter_only: boolean;
  airlines: AirlineOnRoute[];
};

type Meta = { as_of: string; covered: string[] };

export type AirlineInfo = { logo?: string; website?: string };

/** The country selected for a first-time visitor. Nothing else on the site treats it specially. */
export const DEFAULT_COUNTRY = "IN";

/** A country you can pick on the map: one we have full routes for (see `covered`), or one with flights to those. */
export type Country = {
  iso2: string;
  name: string;
  bounds: [[number, number], [number, number]]; // main landmass, for framing
  airports: number;
  routes: number;
  /** Marked with a star on the start screen (none for city-territories like Hong Kong). */
  capital?: { name: string; lon: number; lat: number };
};

export type Dataset = {
  countries: Country[];
  /** Every route as published (each airport pair may appear in one or both directions). */
  routes: Route[];
  airports: Map<string, Airport>;
  /** Countries whose airports' full route lists we have. Elsewhere we only know the links to these. */
  covered: Set<string>;
  /** Every airport you can start from, in covered countries and elsewhere. */
  searchable: Airport[];
  airlines: Map<string, AirlineInfo>; // keyed by the airline's Wikipedia title
  routesByOrigin: Map<string, Route[]>;
  asOf: string;
};

/** routes-web.json: routes.json in compact form (written by scripts/copy-data.mjs, which describes the layout). */
type CompactRoutes = {
  categories: string[];
  statuses: Route["status"][];
  notes: (AirlineOnRoute["note"] | null)[];
  airlines: [string, string | null][];
  listings: [number, number, number, number, string | null][];
  routes: [string, string, number, number[]][];
};

/**
 * Back to the usual Route objects. Each distinct listing (airline + kind + status + note) becomes one object shared
 * by every route that has it: never modified, so sharing is safe, and far fewer objects than one per listing.
 */
function expandRoutes(c: CompactRoutes): Route[] {
  const listings = c.listings.map(([airline, category, status, note, noteDate]): AirlineOnRoute => {
    const [name, wiki] = c.airlines[airline];
    const a: AirlineOnRoute = { airline: name, airline_wiki: wiki, category: c.categories[category], status: c.statuses[status] };
    if (c.notes[note]) {
      a.note = c.notes[note] ?? undefined;
      a.note_date = noteDate;
    }
    return a;
  });
  return c.routes.map(([origin, dest, flags, ids]) => ({
    origin,
    dest,
    domestic: (flags & 1) !== 0,
    seasonal_only: (flags & 2) !== 0,
    charter_only: (flags & 4) !== 0,
    status: c.statuses[flags >> 3],
    airlines: ids.map((i) => listings[i]),
  }));
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Couldn't load ${path} (HTTP ${res.status})`);
  return res.json() as Promise<T>;
}

export async function loadDataset(): Promise<Dataset> {
  const [airportList, compactRoutes, meta, airlineInfo, countries] = await Promise.all([
    getJson<Airport[]>(asset("data/airports.json")),
    getJson<CompactRoutes>(asset("data/routes-web.json")),
    getJson<Meta>(asset("data/meta.json")),
    // Logos and websites are optional extras: without them the site shows initials and plain names.
    getJson<Record<string, { logo?: string; website?: string | null }>>(asset("data/airlines.json")).catch(() => ({})),
    getJson<Country[]>(asset("data/countries.json")),
  ]);
  const airlines = new Map<string, AirlineInfo>(
    Object.entries(airlineInfo).map(([title, a]) => [
      title,
      { logo: a.logo ? asset(`data/${a.logo}`) : undefined, website: a.website ?? undefined },
    ]),
  );

  const routes = expandRoutes(compactRoutes);
  const airports = new Map(airportList.map((a) => [a.iata, a]));
  const routesByOrigin = new Map<string, Route[]>();
  for (const r of routes) {
    if (r.status === "suspended") continue;
    const list = routesByOrigin.get(r.origin);
    if (list) list.push(r);
    else routesByOrigin.set(r.origin, [r]);
  }
  // Airports whose own Wikipedia tables were read (`is_origin`) have full route lists.
  const covered = new Set(meta.covered);

  // Every other airport gets the reverse view: Delhi → Dubai also means Dubai → Delhi. Outside the covered countries
  // that's all we know; inside them it covers small airports whose article has no table of its own.
  for (const r of routes) {
    if (r.status === "suspended" || airports.get(r.dest)?.is_origin) continue;
    const back: Route = { ...r, origin: r.dest, dest: r.origin };
    const list = routesByOrigin.get(back.origin);
    if (list) list.push(back);
    else routesByOrigin.set(back.origin, [back]);
  }
  const searchable = airportList.filter((a) => routesByOrigin.has(a.iata));

  return {
    airports,
    airlines,
    countries: countries.sort((a, b) => a.name.localeCompare(b.name)),
    routes: routes.filter((r) => r.status !== "suspended"),
    covered,
    searchable,
    routesByOrigin,
    asOf: meta.as_of,
  };
}
