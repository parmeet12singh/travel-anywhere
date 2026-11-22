import Fuse from "fuse.js";
import type { Airport } from "./data";
import { distanceKm } from "./geo";

// Older or alternative names people still search with.
const ALIASES: Record<string, string[]> = {
  BOM: ["Bombay"],
  MAA: ["Madras"],
  CCU: ["Calcutta"],
  BLR: ["Bangalore"],
  DEL: ["New Delhi", "Gurgaon", "Gurugram"],
  COK: ["Cochin", "Ernakulam"],
  TRV: ["Trivandrum"],
  PNQ: ["Poona"],
  CCJ: ["Calicut", "Kozhikode"],
  VTZ: ["Vizag", "Vishakhapatnam"],
  BDQ: ["Baroda"],
  VNS: ["Benares", "Banaras", "Kashi"],
  IXD: ["Allahabad"],
  PNY: ["Pondicherry"],
  IXE: ["Mangalore"],
  HBX: ["Hubli"],
  IXG: ["Belgaum"],
  TRZ: ["Trichy"],
  GAU: ["Gauhati"],
  IXZ: ["Andaman"],
  GOI: ["Goa"],
  GOX: ["Goa", "North Goa"],
  IXU: ["Chhatrapati Sambhajinagar"],
  KUU: ["Manali", "Kullu"],
  DHM: ["Dharamshala", "Dharamsala"],
  IXB: ["Siliguri", "Darjeeling"],
};

/** Other airports this close to the matched one are offered as "nearby". */
export const NEARBY_KM = 150;

// Short or everyday names for countries (matched in addition to the full name).
const COUNTRY_ALIASES: Record<string, string[]> = {
  AE: ["UAE", "Emirates"],
  US: ["USA", "US", "America", "United States of America"],
  GB: ["UK", "Britain", "Great Britain", "England"],
  SA: ["KSA"],
  KR: ["Korea"],
  RU: ["Russia"],
  NL: ["Holland"],
};

export type SearchResult = {
  airport: Airport;
  nearby?: { of: Airport; km: number };
  inCountry?: string; // set when the result came from matching a country name
};

type Entry = { airport: Airport; primary: string[]; secondary: string[] };

const normalise = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const words = (s: string) => normalise(s).split(" ").filter(Boolean);

/**
 * Scores how well an airport matches: exact code, then names that start with the query, then any word in
 * the names starting with it. Returns 0 for no match, so unrelated airports never show up.
 */
function score(e: Entry, q: string, qCode: string): number {
  if (e.airport.iata === qCode) return 100;
  let best = 0;
  for (const name of e.primary) {
    const n = normalise(name);
    if (n === q) return 95;
    if (n.startsWith(q)) best = Math.max(best, 85);
    else if (words(name).some((w) => w.startsWith(q))) best = Math.max(best, 70);
  }
  if (best) return best;
  for (const name of e.secondary) {
    if (q.length >= 3 && words(name).some((w) => w.startsWith(q))) return 40;
  }
  return 0;
}

/**
 * Search over every airport you can start from. `routeCount` orders a country's airports busiest first.
 */
export function createOriginSearch(origins: Airport[], routeCount: (iata: string) => number) {
  const countries = new Map<string, { name: string; names: string[] }>();
  for (const a of origins) {
    if (!countries.has(a.country)) {
      countries.set(a.country, {
        name: a.country_name,
        names: [a.country_name, ...(COUNTRY_ALIASES[a.country] ?? [])].map(normalise),
      });
    }
  }
  const entries: Entry[] = origins.map((a) => ({
    airport: a,
    primary: [a.label, a.city, ...(ALIASES[a.iata] ?? [])].filter(Boolean),
    secondary: [a.name],
  }));
  // Typo tolerance ("Banglore") is only a fallback, and kept strict, for when nothing matches directly.
  const fuse = new Fuse(entries, {
    keys: ["primary"],
    threshold: 0.25,
    ignoreLocation: true,
    minMatchCharLength: 3,
  });

  return (query: string, limit = 6): SearchResult[] => {
    const q = normalise(query);
    if (!q) return [];
    const qCode = q.toUpperCase();

    // A country lists its airports, busiest first. Exact names and short forms (UAE, USA, UK, India) always do;
    // a partial name ("united ar…") only when no city or airport matches, so "indo" still finds Indore.
    const countryResults = (exactOnly: boolean): SearchResult[] | null => {
      for (const [code, c] of countries) {
        const hit = c.names.some((n) => n === q || (!exactOnly && q.length >= 4 && n.startsWith(q)));
        if (hit) {
          return origins
            .filter((a) => a.country === code)
            .sort((a, b) => routeCount(b.iata) - routeCount(a.iata) || a.label.localeCompare(b.label))
            .slice(0, 8)
            .map((airport) => ({ airport, inCountry: c.name }));
        }
      }
      return null;
    };
    const exactCountry = countryResults(true);
    if (exactCountry) return exactCountry;

    let matches = entries
      .map((e) => ({ e, s: score(e, q, qCode) }))
      .filter((m) => m.s > 0)
      .sort((a, b) => b.s - a.s || a.e.airport.label.localeCompare(b.e.airport.label))
      .map((m) => m.e.airport);
    if (matches.length === 0 && q.length >= 4) {
      matches = fuse.search(q, { limit: 3 }).map((r) => r.item.airport);
    }
    matches = matches.slice(0, limit);
    if (matches.length === 0) return countryResults(false) ?? [];

    // Nearby airports: around the best match, closest first, excluding ones already listed.
    const top = matches[0];
    const shown = new Set(matches.map((a) => a.iata));
    const nearby = origins
      .filter((a) => !shown.has(a.iata))
      .map((a) => ({ airport: a, nearby: { of: top, km: distanceKm(top, a) } }))
      .filter((r) => r.nearby.km <= NEARBY_KM)
      .sort((a, b) => a.nearby.km - b.nearby.km)
      .slice(0, 4);

    return [...matches.map((airport) => ({ airport })), ...nearby];
  };
}
