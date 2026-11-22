import type { AirlineOnRoute, Airport, Dataset } from "./data";
import { distanceKm } from "./geo";

/**
 * Routes between two countries, worked out from the route data in a general way: any airport in the source
 * country linked (in either direction) to any airport in the target country. Today every route touches India;
 * when other countries' routes are added, these functions pick them up unchanged.
 */
export type Link = {
  from: Airport; // airport in the source country
  to: Airport; // airport in the target country
  airlines: AirlineOnRoute[];
  km: number;
};

/** Same airline under different spellings in Wikipedia tables ("flydubai"/"Flydubai", "Spice Jet"/"SpiceJet"). */
const airlineId = (a: AirlineOnRoute) => (a.airline_wiki ?? a.airline).toLowerCase().replace(/[^a-z0-9]/g, "");

export function countryLinks(data: Dataset, source: string, target: string): Link[] {
  const byPair = new Map<string, Link>();
  for (const r of data.routes) {
    const a = data.airports.get(r.origin);
    const b = data.airports.get(r.dest);
    if (!a || !b) continue;
    let from: Airport, to: Airport;
    if (a.country === source && b.country === target) [from, to] = [a, b];
    else if (a.country === target && b.country === source) [from, to] = [b, a];
    else continue;
    const key = `${from.iata}-${to.iata}`;
    const link = byPair.get(key) ?? { from, to, airlines: [], km: distanceKm(from, to) };
    for (const al of r.airlines) {
      if (!link.airlines.some((x) => airlineId(x) === airlineId(al))) link.airlines.push(al);
    }
    byPair.set(key, link);
  }
  return [...byPair.values()].sort(
    (x, y) => y.airlines.length - x.airlines.length || x.from.label.localeCompare(y.from.label) || x.to.label.localeCompare(y.to.label),
  );
}

/** Number of airport-to-airport links between the source country and every other country. */
export function linkCountsFrom(data: Dataset, source: string): Map<string, number> {
  const pairs = new Map<string, Set<string>>();
  for (const r of data.routes) {
    const a = data.airports.get(r.origin);
    const b = data.airports.get(r.dest);
    if (!a || !b || a.country === b.country) continue;
    const other = a.country === source ? b.country : b.country === source ? a.country : null;
    if (!other) continue;
    const key = [a.iata, b.iata].sort().join("-");
    const set = pairs.get(other) ?? new Set<string>();
    set.add(key);
    pairs.set(other, set);
  }
  return new Map([...pairs].map(([iso2, set]) => [iso2, set.size]));
}

/** Summary numbers for the panel. */
export function linkSummary(links: Link[]) {
  const airlines = new Map<string, { airline: AirlineOnRoute; count: number }>();
  for (const l of links)
    for (const a of l.airlines) {
      const e = airlines.get(airlineId(a)) ?? { airline: a, count: 0 };
      e.count++;
      airlines.set(airlineId(a), e);
    }
  return {
    routes: links.length,
    fromAirports: new Set(links.map((l) => l.from.iata)).size,
    toAirports: new Set(links.map((l) => l.to.iata)).size,
    airlines: [...airlines.values()].sort((a, b) => b.count - a.count || a.airline.airline.localeCompare(b.airline.airline)),
  };
}
