import type { Airport, AirlineOnRoute, Dataset, Route } from "./data";
import { distanceKm, unwrapLongitudes, unwrapped } from "./geo";

export type Destination = { airport: Airport; route: Route; km: number };
export type Scope = "all" | "domestic" | "abroad";
export type SortKey = "name" | "airlines" | "nearest" | "farthest";

export function destinationsFrom(data: Dataset, origin: Airport): Destination[] {
  const out: Destination[] = [];
  for (const route of data.routesByOrigin.get(origin.iata) ?? []) {
    const airport = data.airports.get(route.dest);
    if (airport) out.push({ airport, route, km: distanceKm(origin, airport) });
  }
  // Routes across the date line (Auckland → Los Angeles) are drawn the short way.
  const unwrap = unwrapLongitudes(origin.lon, out.map((d) => d.airport.lon));
  for (const d of out) d.airport = unwrapped(d.airport, unwrap);
  return out;
}

/** Airlines flying from the origin, busiest first. */
export function airlinesFrom(destinations: Destination[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const d of destinations)
    for (const name of new Set(d.route.airlines.map((a) => a.airline))) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function filterAndSort(list: Destination[], scope: Scope, airline: string | null, sort: SortKey): Destination[] {
  const out = list.filter(
    (d) =>
      (scope === "all" || (scope === "domestic") === d.route.domestic) &&
      (airline === null || d.route.airlines.some((a) => a.airline === airline)),
  );
  const byName = (a: Destination, b: Destination) => a.airport.label.localeCompare(b.airport.label);
  switch (sort) {
    case "airlines":
      return out.sort((a, b) => b.route.airlines.length - a.route.airlines.length || byName(a, b));
    case "nearest":
      return out.sort((a, b) => a.km - b.km);
    case "farthest":
      return out.sort((a, b) => b.km - a.km);
    default:
      return out.sort(byName);
  }
}

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });
const dateFmtYear = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return (d.getFullYear() === new Date().getFullYear() ? dateFmt : dateFmtYear).format(d);
}

/** Plain-words notes for one airline on a route, e.g. "Seasonal", "Starts 1 Dec". */
export function airlineNotes(a: AirlineOnRoute): string[] {
  const notes: string[] = [];
  if (a.category.includes("seasonal")) notes.push("Seasonal");
  if (a.category.includes("charter")) notes.push("Charter");
  // "Starts/Resumes" matter only until the date passes; "Ends" always matters.
  const pendingStart = (a.note === "begins" || a.note === "resumes") && a.status === "upcoming";
  if (pendingStart || a.note === "ends") {
    const when = a.note_date ? ` ${shortDate(a.note_date)}` : "";
    if (a.note === "begins") notes.push(`Starts${when}`);
    else if (a.note === "resumes") notes.push(`Resumes${when}`);
    else if (a.note === "ends") notes.push(`Ends${when}`);
  }
  return notes;
}

/** Notes that apply to the whole route (shown in the list). */
export function routeNotes(route: Route): string[] {
  if (route.status === "upcoming") {
    const dates = route.airlines.map((a) => a.note_date).filter((d): d is string => !!d).sort();
    return [dates[0] ? `Starts ${shortDate(dates[0])}` : "Starting soon"];
  }
  const notes: string[] = [];
  if (route.seasonal_only) notes.push("Seasonal");
  if (route.charter_only) notes.push("Charter");
  return notes;
}
