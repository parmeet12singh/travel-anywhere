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

type Meta = { as_of: string };

export type AirlineInfo = { logo?: string; website?: string };

export const HOME_COUNTRY = "IN";

/** A country you can pick on the map: India, or one with flights to India. */
export type Country = {
  iso2: string;
  name: string;
  bounds: [[number, number], [number, number]]; // main landmass, for framing
  airports: number;
  routes: number;
};

export type Dataset = {
  countries: Country[];
  /** Every route as published (each airport pair may appear in one or both directions). */
  routes: Route[];
  airports: Map<string, Airport>;
  /** Every airport you can start from: Indian airports, plus foreign ones (whose routes are their links to India). */
  searchable: Airport[];
  airlines: Map<string, AirlineInfo>; // keyed by the airline's Wikipedia title
  origins: Airport[];
  routesByOrigin: Map<string, Route[]>;
  asOf: string;
};

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Couldn't load ${path} (HTTP ${res.status})`);
  return res.json() as Promise<T>;
}

export async function loadDataset(): Promise<Dataset> {
  const [airportList, routes, meta, airlineInfo, countries] = await Promise.all([
    getJson<Airport[]>("/data/airports.json"),
    getJson<Route[]>("/data/routes.json"),
    getJson<Meta>("/data/meta.json"),
    // Logos and websites are optional extras: without them the site shows initials and plain names.
    getJson<Record<string, { logo?: string; website?: string | null }>>("/data/airlines.json").catch(() => ({})),
    getJson<Country[]>("/data/countries.json"),
  ]);
  const airlines = new Map<string, AirlineInfo>(
    Object.entries(airlineInfo).map(([title, a]) => [
      title,
      { logo: a.logo ? `/data/${a.logo}` : undefined, website: a.website ?? undefined },
    ]),
  );

  const airports = new Map(airportList.map((a) => [a.iata, a]));
  const routesByOrigin = new Map<string, Route[]>();
  for (const r of routes) {
    if (r.status === "suspended") continue;
    const list = routesByOrigin.get(r.origin);
    if (list) list.push(r);
    else routesByOrigin.set(r.origin, [r]);
  }
  // Indian airports are the real origins (their Wikipedia pages are the data source).
  const origins = airportList
    .filter((a) => a.country === HOME_COUNTRY && routesByOrigin.has(a.iata))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Reverse view for foreign airports: Delhi → Dubai also means Dubai → Delhi, so Dubai's "routes" are its
  // non-stop links to Indian cities. These are the only routes we know for airports outside India.
  for (const r of routes) {
    if (r.status === "suspended" || r.domestic) continue;
    const back: Route = { ...r, origin: r.dest, dest: r.origin };
    const list = routesByOrigin.get(back.origin);
    if (list) list.push(back);
    else routesByOrigin.set(back.origin, [back]);
  }
  const searchable = airportList.filter((a) => routesByOrigin.has(a.iata));

  return {
    airports,
    airlines,
    countries,
    routes: routes.filter((r) => r.status !== "suspended"),
    searchable,
    origins,
    routesByOrigin,
    asOf: meta.as_of,
  };
}
