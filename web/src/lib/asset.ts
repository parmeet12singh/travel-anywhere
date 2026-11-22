/**
 * URL of a file the site serves (data, flags), under the site's base path: "/" locally and on Cloudflare,
 * "/travel-anywhere/" on GitHub Pages (set at build time with BASE_PATH, see vite.config.ts).
 */
export const asset = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;

/** Same, as a full URL: MapLibre loads GeoJSON in a worker, where relative URLs don't resolve against the page. */
export const assetUrl = (path: string) => new URL(asset(path), window.location.href).href;
