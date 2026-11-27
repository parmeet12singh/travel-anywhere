const EARTH_KM = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

const km = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
export const formatKm = (d: number) => `${km.format(Math.round(d / 10) * 10)} km`;

/**
 * A curved "airway" between two points, drawn flat like a route on a chart.
 * Quadratic Bézier in lon/lat space, always bending the same way relative to the direction of travel,
 * so routes fanning out from one airport don't cross each other's curves.
 */
export function airwayPath(from: [number, number], to: [number, number], bend: number, steps = 40): [number, number][] {
  const [x0, y0] = from;
  const [x1, y1] = to;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const cx = (x0 + x1) / 2 - dy * bend;
  const cy = (y0 + y1) / 2 + dx * bend;
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    pts.push([u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1]);
  }
  return pts;
}

const mod360 = (x: number) => ((x % 360) + 360) % 360;

/** How far (degrees of longitude) a route may be drawn before it counts as going the wrong way round. A little more than
 * half the globe, so Delhi's routes to Toronto and Vancouver are drawn the same way instead of splitting the map. */
const LONGEST_WAY = 205;

/**
 * Longitudes are circular, maps are not: finds where to cut the globe so everything shown together is continuous. The
 * cut falls in an empty stretch where no route from `ref` has to go the long way round (Aalborg → Nuuk goes west over
 * Iceland, Los Angeles → Copenhagen east over Canada); of those, the widest, so the map is as compact as possible.
 * From Delhi the cut falls in the Pacific (nothing changes); from Sydney in the Atlantic, so Los Angeles becomes 242
 * instead of -118 and its route crosses the Pacific. `ref` keeps its own value; the others may go past ±180.
 */
export function unwrapLongitudes(ref: number, lons: number[]): (lon: number) => number {
  const sorted = [...new Set([ref, ...lons].map(mod360))].sort((a, b) => a - b);
  // Where each longitude goes when the globe is cut just before `start`. (The tolerance matters: rounding must not
  // send the first point a full turn away.)
  const placer = (start: number) => {
    const place = (lon: number) => {
      const x = mod360(lon);
      return x < start - 1e-6 ? x + 360 : x;
    };
    const shift = ref - place(ref);
    return (lon: number) => place(lon) + shift;
  };
  let best = placer(sorted[0]);
  let bestDetour = Infinity;
  let widest = -1;
  sorted.forEach((lon, i) => {
    const start = sorted[(i + 1) % sorted.length];
    const gap = mod360(start - lon) || 360;
    const place = placer(start);
    const detour = lons.reduce((sum, l) => sum + Math.max(0, Math.abs(place(l) - ref) - LONGEST_WAY), 0);
    if (detour < bestDetour - 1e-6 || (detour < bestDetour + 1e-6 && gap > widest)) {
      best = place;
      bestDetour = detour;
      widest = gap;
    }
  });
  return (lon) => {
    const x = best(lon);
    return Math.abs(x - lon) < 1e-6 ? lon : x;
  };
}

/** The same airport with its longitude moved by `unwrap` (the original object when nothing changes). */
export function unwrapped<T extends { lon: number }>(a: T, unwrap: (lon: number) => number): T {
  const lon = unwrap(a.lon);
  return lon === a.lon ? a : { ...a, lon };
}
