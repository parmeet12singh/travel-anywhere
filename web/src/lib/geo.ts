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
