import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre parses map tiles in a web worker shipped as a separate module; let Vite bundle it and hand over its URL.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { IconLayer, PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Layer, PickingInfo } from "@deck.gl/core";
import type { Airport, Country } from "../lib/data";
import type { Theme } from "../lib/theme";
import { useTheme } from "../lib/theme";
import type { Destination } from "../lib/destinations";
import { airwayPath, distanceKm } from "../lib/geo";
import { useMinuteClock } from "../lib/time";
import { MapTimeLabel } from "./MapTimeLabel";
import { assetUrl } from "../lib/asset";
import { inSentence } from "../lib/names";
import type { Link } from "../lib/pairs";
import { linkKey } from "./PairView";

maplibregl.setWorkerUrl(maplibreWorkerUrl);

type RGB = [number, number, number];
type Palette = { ink: RGB; airway: RGB; ocean: RGB; paper: RGB };

// Same values as the CSS tokens in index.css, as RGB for deck.gl.
const PALETTES: Record<Theme, Palette> = {
  light: { ink: [23, 33, 43], airway: [181, 23, 111], ocean: [14, 110, 128], paper: [244, 246, 245] },
  dark: { ink: [228, 235, 239], airway: [229, 96, 159], ocean: [70, 182, 200], paper: [15, 26, 35] },
};

// One base map for both themes. Switching theme only repaints its colours, so nothing is re-downloaded.
const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const DRAW_MS = 900;

// Chart-style base map: English names only, and none of the road, town or airport labels that would
// compete with the routes.
const HIDDEN_LABELS = /^(highway|road_|airport|label_other|label_village|label_town|label_state|waterway_line_label)/;
const CITY_LABELS = ["label_city", "label_city_capital"];
// Country and sea names are context, not content: soft grey, regular weight, smaller than our route labels.
const COUNTRY_LABELS = /^label_country/;
const SEA_LABELS = /^water_name/;
const QUIET_LABEL = "#7c8690";
/** Space for the star icon at the start of the capital label, px. */
const STAR_ROOM = 16;
/** Airports this close to the capital are its airports, named in its star label (Dulles is 42 km out). */
const CAPITAL_AIRPORT_KM = 60;
/** Five-pointed star, drawn as a mask so it takes the theme's ink colour. */
const STAR_ICON = {
  url: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24"><path d="M12 1.5l3.1 6.6 7.2.9-5.3 5 1.4 7.1L12 17.6l-6.4 3.5 1.4-7.1-5.3-5 7.2-.9z" fill="#000"/></svg>')}`,
  width: 64,
  height: 64,
  mask: true,
};

// Night chart: navy land, darker sea, barely-there roads, so the routes stand out.
const NIGHT = { land: "#15232e", water: "#081118", border: "#33475a", road: "#1b2a36", label: "#94a4b0" };

type PaintKey = "background-color" | "fill-color" | "fill-outline-color" | "line-color" | "text-color" | "text-halo-color";
type Original = { id: string; key: PaintKey; value: unknown };

/** One-off changes that are the same in both themes. Returns the light colours, to restore later. */
function prepareChartStyle(map: maplibregl.Map): Original[] {
  const originals: Original[] = [];
  for (const layer of map.getStyle().layers) {
    // The base map's borders are replaced by the official ones (see BORDERS); its state lines are clutter anyway.
    if (/^boundary/.test(layer.id) || (layer.type === "symbol" && HIDDEN_LABELS.test(layer.id))) {
      map.setLayoutProperty(layer.id, "visibility", "none");
      continue;
    }
    for (const key of ["background-color", "fill-color", "fill-outline-color", "line-color", "text-color", "text-halo-color"] as PaintKey[]) {
      const value = (layer.paint as Record<string, unknown> | undefined)?.[key];
      if (value !== undefined) originals.push({ id: layer.id, key, value });
    }
    if (layer.type !== "symbol") continue;
    if (COUNTRY_LABELS.test(layer.id) || SEA_LABELS.test(layer.id)) {
      map.setLayoutProperty(layer.id, "text-font", ["Noto Sans Regular"]);
      map.setLayoutProperty(layer.id, "text-size", ["interpolate", ["linear"], ["zoom"], 1, 9, 4, 12, 7, 14]);
    }
    if (map.getLayoutProperty(layer.id, "text-field")) {
      map.setLayoutProperty(layer.id, "text-field", ["coalesce", ["get", "name:en"], ["get", "name:latin"], ["get", "name"]]);
    }
  }
  return originals;
}

/** Repaint the base map for a theme. Pure paint changes: instant, no network. */
function paintTheme(map: maplibregl.Map, theme: Theme, originals: Original[]) {
  if (map.getLayer(BORDERS.layer)) map.setPaintProperty(BORDERS.layer, "line-color", BORDER_COLOUR[theme]);
  if (map.getLayer(SELECTED.border)) map.setPaintProperty(SELECTED.border, "line-color", SELECTED_BORDER_COLOUR[theme]);
  if (map.getLayer(SELECTED.provinces)) map.setPaintProperty(SELECTED.provinces, "line-color", PROVINCE_COLOUR[theme]);
  for (const id of [SELECTED.area, PAIR_PROVINCES.area]) if (map.getLayer(id)) map.setPaintProperty(id, "fill-color", TINT[theme]);
  if (map.getLayer(PAIR_PROVINCES.layer)) map.setPaintProperty(PAIR_PROVINCES.layer, "line-color", PROVINCE_COLOUR[theme]);
  if (map.getLayer(AREAS.hover)) map.setPaintProperty(AREAS.hover, "line-color", SELECTED_BORDER_COLOUR[theme]);
  for (const id of [PAIR_PROVINCES.border, PAIR_PROVINCES.dashes]) {
    if (map.getLayer(id)) map.setPaintProperty(id, "line-color", PAIR_COLOURS[theme].target);
  }
  for (const { id, key, value } of originals) {
    let next: unknown = value;
    if (theme === "dark") {
      if (key === "background-color") next = NIGHT.land;
      else if (key === "fill-color" || key === "fill-outline-color") next = /water/.test(id) ? NIGHT.water : NIGHT.land;
      else if (key === "line-color") next = /boundary/.test(id) ? NIGHT.border : /waterway/.test(id) ? NIGHT.water : NIGHT.road;
      else if (key === "text-color") next = NIGHT.label;
      else if (key === "text-halo-color") next = NIGHT.land;
    } else if (key === "text-color" && (COUNTRY_LABELS.test(id) || SEA_LABELS.test(id))) {
      next = QUIET_LABEL;
    }
    // `next` is a colour or colour expression taken from (or valid for) this same property.
    map.setPaintProperty(id, key, next as never);
  }
}

/**
 * Which way the selected route runs on screen. Chips sit on the outer side of each end (left/right for mostly
 * east–west routes, above/below for north–south ones), and the map framing leaves room for them on those sides.
 */
function routeLayout(o: Airport, d: Airport): { horizontal: boolean; destEastOrSouth: boolean } {
  const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  let dx = d.lon - o.lon;
  if (dx > 180) dx -= 360;
  if (dx < -180) dx += 360;
  const dy = ((mercY(o.lat) - mercY(d.lat)) * 180) / Math.PI; // screen y grows downwards
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  return { horizontal, destEastOrSouth: horizontal ? dx > 0 : dy > 0 };
}
const CHIP_ROOM = { side: 250, vertical: 60 };

/*
 * Borders as India officially shows them (Natural Earth "India point of view", built by
 * pipeline/travel_pipeline/borders.py): all of J&K and Ladakh incl. Gilgit-Baltistan and Aksai Chin, and all of
 * Arunachal Pradesh, with no disputed/dashed lines. The base map's own (de facto) border layers are hidden.
 *
 * - Every country's outline: thin grey.
 * - The selected country (picker, top right): its land border highlighted, one step below the routes, plus its
 *   states/provinces, thinner and lighter. Ink, not magenta/teal: those colours already mean route types.
 */
const BORDERS = { source: "official-borders", layer: "official-borders", url: assetUrl("data/borders.geojson") };
const BORDER_COLOUR: Record<Theme, string> = { light: "hsl(0, 0%, 70%)", dark: "#33475a" };
const SELECTED = {
  source: "selected-country",
  border: "selected-country-border",
  provinces: "selected-country-provinces",
  area: "selected-country-area",
};
// Solid, not see-through: a transparent line looked lighter over the sea than over land, so an island's coast and
// India's land border didn't match. Dark ink, the depth of the original border.
const SELECTED_BORDER_COLOUR: Record<Theme, string> = { light: "#454d55", dark: "#a9b3ba" };
const PROVINCE_COLOUR: Record<Theme, string> = { light: "rgba(23, 33, 43, 0.4)", dark: "rgba(228, 235, 239, 0.3)" };
/*
 * Countries you can point at: invisible filled shapes (official boundaries) to find the country under the cursor,
 * a neutral outline for the hovered one (a preview), and teal for the country picked to compare with. In that
 * view the picker's country turns magenta: our "this side / the other side" colours, outlines only, no fills.
 */
const PAIR_PROVINCES = { source: "pair-country", layer: "pair-country-provinces", border: "pair-country-border", dashes: "pair-country-border-dashes", area: "pair-country-area" };
const AREAS = { source: "country-areas", hit: "country-areas-hit", hover: "country-hover", url: assetUrl("data/country-areas.geojson") };
const PAIR_COLOURS: Record<Theme, { source: string; target: string }> = {
  light: { source: "#b5176f", target: "#0e6e80" },
  dark: { source: "#e5609f", target: "#46b6c8" },
};
const NONE: maplibregl.FilterSpecification = ["==", ["get", "iso2"], ""];
const onlyCountry = (iso2: string | null): maplibregl.FilterSpecification => (iso2 ? ["==", ["get", "iso2"], iso2] : NONE);
const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const countryFile = (iso2: string) => assetUrl(`data/countries/${iso2}.geojson`);
/*
 * Lines: land borders, and the picked country's coast from OpenStreetMap's land (the same shoreline the base map
 * draws), both in the same style. The world outline is land borders only. The picked country's land is also lightly
 * tinted, under the base map's water so the sea trims it to the exact coast.
 */
const LAND_BORDERS: maplibregl.FilterSpecification = ["==", ["get", "kind"], "border"];
const BORDER_OR_COAST: maplibregl.FilterSpecification = ["match", ["get", "kind"], ["border", "coast"], true, false];
const AREA: maplibregl.FilterSpecification = ["==", ["get", "kind"], "area"];
/** The base map's water layer: the picked country's tint goes just under it. */
const WATER_LAYER = "water";
const TINT: Record<Theme, string> = { light: "#ffffff", dark: "#1f3343" };
/** Highlighted outline (land borders and coast alike: one style for every country). */
const HIGHLIGHT_WIDTH = 1.6; // the same at every zoom: a close-up island's coast looks like a country view's border

function addOfficialBorders(map: maplibregl.Map, iso2: string) {
  if (map.getSource(BORDERS.source)) return;
  map.addSource(BORDERS.source, { type: "geojson", data: BORDERS.url });
  map.addSource(SELECTED.source, { type: "geojson", data: iso2 ? countryFile(iso2) : EMPTY_FC });
  const firstLabel = map.getStyle().layers.find((l) => l.type === "symbol")?.id; // borders go under place names
  map.addLayer(
    {
      id: BORDERS.layer,
      type: "line",
      source: BORDERS.source,
      filter: LAND_BORDERS,
      paint: { "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.6, 6, 1.2] },
    },
    firstLabel,
  );
  map.addLayer(
    {
      id: SELECTED.provinces,
      type: "line",
      source: SELECTED.source,
      filter: ["==", ["get", "kind"], "provinces"],
      layout: { "line-join": "round" },
      paint: { "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.4, 5, 0.8, 8, 1.2] },
    },
    firstLabel,
  );
  map.addLayer(
    {
      id: SELECTED.border,
      type: "line",
      source: SELECTED.source,
      filter: BORDER_OR_COAST,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-width": HIGHLIGHT_WIDTH },
    },
    firstLabel,
  );
  // The second country's states/provinces in the two-country view (same style as the picker country's).
  map.addSource(PAIR_PROVINCES.source, { type: "geojson", data: EMPTY_FC });
  map.addLayer(
    {
      id: PAIR_PROVINCES.layer,
      type: "line",
      source: PAIR_PROVINCES.source,
      filter: ["==", ["get", "kind"], "provinces"],
      layout: { "line-join": "round" },
      paint: { "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.4, 5, 0.8, 8, 1.2] },
    },
    firstLabel,
  );
  // The second country's border, from its own file, so a border the two share is the very same line. Solid teal
  // under the picker country's magenta, and teal dashes on top: a shared stretch alternates magenta and teal, so
  // it reads as both countries' (not just whichever is drawn last); elsewhere the dashes sit on their own solid line.
  const pairBorder = {
    type: "line" as const, source: PAIR_PROVINCES.source, layout: { "line-join": "round" as const },
    filter: BORDER_OR_COAST,
  };
  map.addLayer({ ...pairBorder, id: PAIR_PROVINCES.border, paint: { "line-width": HIGHLIGHT_WIDTH } }, SELECTED.border);
  map.addLayer({ ...pairBorder, id: PAIR_PROVINCES.dashes, paint: { "line-width": HIGHLIGHT_WIDTH, "line-dasharray": [2, 2] } }, firstLabel);
  // The land of the picked country (and of the second one in the two-country view): a light tint under the water.
  const under = map.getLayer(WATER_LAYER) ? WATER_LAYER : firstLabel;
  for (const [id, source] of [[SELECTED.area, SELECTED.source], [PAIR_PROVINCES.area, PAIR_PROVINCES.source]] as const) {
    // Light to start with; paintTheme sets the theme's colour right after.
    map.addLayer({ id, type: "fill", source, filter: AREA, paint: { "fill-color": TINT.light } }, under);
  }
  map.addSource(AREAS.source, { type: "geojson", data: AREAS.url });
  map.addLayer({ id: AREAS.hit, type: "fill", source: AREAS.source, paint: { "fill-color": "#000", "fill-opacity": 0 } }, firstLabel);
  const outline = { "line-join": "round", "line-cap": "round" } as const;
  map.addLayer(
    { id: AREAS.hover, type: "line", source: AREAS.source, filter: NONE, layout: outline,
      paint: { "line-width": ["interpolate", ["linear"], ["zoom"], 1, 1.2, 5, 1.8, 8, 2.4] } },
    firstLabel,
  );
}

function showCountry(map: maplibregl.Map, iso2: string) {
  (map.getSource(SELECTED.source) as maplibregl.GeoJSONSource | undefined)?.setData(iso2 ? countryFile(iso2) : EMPTY_FC);
}

/**
 * City and sea names help on the overview map; once routes are drawn they only compete with them. In the
 * two-country view the country names go too: the two highlighted borders already say it. State/province lines
 * always stay (India's official map shows its states).
 */
function setCityLabels(map: maplibregl.Map, visible: boolean, countryNames = true) {
  for (const layer of map.getStyle().layers) {
    if (CITY_LABELS.includes(layer.id) || SEA_LABELS.test(layer.id)) {
      map.setLayoutProperty(layer.id, "visibility", visible ? "visible" : "none");
    } else if (COUNTRY_LABELS.test(layer.id)) {
      map.setLayoutProperty(layer.id, "visibility", countryNames ? "visible" : "none");
    }
  }
}

/**
 * The base map's own name for the capital is hidden while our star label shows it (otherwise "Beijing" twice).
 * By place, not by name: the two sources spell some differently ("Washington, D.C." / "Washington"). A box of
 * ±0.3° around the capital: wide enough for the two sources' points to differ, too small to catch another city.
 */
const baseCityFilters = new Map<string, unknown>();
function hideBaseLabelAt(map: maplibregl.Map, at: { lon: number; lat: number } | null) {
  for (const id of CITY_LABELS) {
    if (!map.getLayer(id)) continue;
    if (!baseCityFilters.has(id)) baseCityFilters.set(id, map.getFilter(id));
    const original = baseCityFilters.get(id) as maplibregl.FilterSpecification;
    if (!at) {
      map.setFilter(id, original);
      continue;
    }
    const d = 0.3;
    const area: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [[[at.lon - d, at.lat - d], [at.lon + d, at.lat - d], [at.lon + d, at.lat + d], [at.lon - d, at.lat + d], [at.lon - d, at.lat - d]]],
    };
    const outside = ["!", ["within", area]];
    map.setFilter(id, (original ? ["all", original, outside] : outside) as maplibregl.FilterSpecification);
  }
}

// Over a clickable airport dot or route: the site's "clickable" plane cursor (defined in index.css).
const PLANE_CURSOR = "var(--cursor-plane-click)";

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isWide = () => window.matchMedia("(min-width: 768px)").matches;
const padding = () =>
  isWide() ? { top: 64, bottom: 64, left: 500, right: 96 } : { top: 32, bottom: 32, left: 40, right: 40 };

/**
 * How close to frame a country. Big ones fit the view, up to zoom 6. Small ones (Samoa, Singapore) come closer, until
 * they fill about 40% of the free map: large enough to read and to keep their airport dots apart, with sea or
 * neighbours still around them. Up to zoom 9, for the likes of Nauru.
 */
const SMALL_COUNTRY = { fill: 0.4, maxZoom: 9 };
function countryZoom(map: maplibregl.Map, bounds: maplibregl.LngLatBoundsLike): number {
  const fit = map.cameraForBounds(bounds, { padding: padding() })?.zoom ?? 6;
  return Math.min(SMALL_COUNTRY.maxZoom, Math.max(6, fit + Math.log2(SMALL_COUNTRY.fill)));
}

type Props = {
  origins: Airport[];
  /** The country picked at the top right: framed on the start screen, border and provinces highlighted. */
  country: Country;
  /** We have that country's full route lists: its dots are magenta, otherwise teal. */
  covered: boolean;
  /** Non-stop destinations per airport: dot size on the overview map. */
  dotWeights: Map<string, number>;
  origin: Airport | null;
  destinations: Destination[]; // already filtered
  allDestinations: Destination[];
  frameKey: string; // changes when the filters change, so the map reframes on what's shown
  /** On the route page: label both ends with their local time (HTML labels instead of the canvas ones). */
  routeTimes?: { origin: Airport; dest: Airport; domestic: boolean } | null;
  emphasised: string | null; // hovered or selected destination
  onPickOrigin: (iata: string) => void;
  onPickDestination: (iata: string) => void;
  onHover: (iata: string | null) => void;
  /** Every country you can pick, for hover names. */
  countries: Country[];
  /** Routes between the picker's country and each other country (country code → number of airport pairs). */
  linkCounts: Map<string, number>;
  /** Routes between the picker's country and a second country, when one is picked on the map or in the panel. */
  pair: { target: Country; links: Link[] } | null;
  emphasisedLink: string | null;
  onPickCountry: (iso2: string) => void;
  onPickLink: (link: Link) => void;
  onHoverLink: (key: string | null) => void;
};

type Airway = { dest: Destination; path: [number, number][] };

export function MapView(props: Props) {
  const { origins, origin, destinations, allDestinations, frameKey, emphasised, dotWeights, country, emphasisedLink } = props;
  // Overview dots, biggest first so small airports are drawn on top and stay visible.
  const homeCountry = props.covered;
  const maxWeight = useMemo(
    () => Math.max(1, ...origins.map((a) => dotWeights.get(a.iata) ?? 1)),
    [origins, dotWeights],
  );
  const sizedOrigins = useMemo(
    () => [...origins].sort((a, b) => (dotWeights.get(b.iata) ?? 0) - (dotWeights.get(a.iata) ?? 0)),
    [origins, dotWeights],
  );
  const theme = useTheme();
  const themeRef = useRef<Theme>(theme);
  themeRef.current = theme;
  const palette = PALETTES[theme];
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const originalsRef = useRef<Original[]>([]);
  const handlers = useRef(props);
  handlers.current = props;
  const [ready, setReady] = useState(false);
  // The base map has drawn the first view (or we've waited long enough). Routes and labels wait for this, so
  // they never float over a blank map on load.
  const [baseLoaded, setBaseLoaded] = useState(false);
  const [showLoading, setShowLoading] = useState(false);
  const [viewVersion, setViewVersion] = useState(0); // bumps after pan/zoom, so label placement is redone
  const [progress, setProgress] = useState(1);
  const [hoverOrigin, setHoverOrigin] = useState<string | null>(null);
  const [hoverCrowd, setHoverCrowd] = useState(0); // airports under the pointer, start screen
  const [hoverCapital, setHoverCapital] = useState(false); // pointer over the capital's label (a link)
  const capitalAirportsRef = useRef<Airport[]>([]); // the airports the capital's label names, for clicks
  // A click on a crowded spot: the airports there, to choose from (screen position of the click).
  const [chooser, setChooser] = useState<{ x: number; y: number; airports: Airport[] } | null>(null);
  const [hoverPairAirport, setHoverPairAirport] = useState<string | null>(null);
  // Country under the cursor (start screen and pair view, desktop): outline + a small label by the cursor.
  const [hoverCountry, setHoverCountry] = useState<{ iso2: string; x: number; y: number } | null>(null);
  const hoverCountryRef = useRef<string | null>(null);
  const pair = props.pair ?? null;
  const pairKey = pair ? pair.target.iso2 : "";
  const routeTimes = props.routeTimes ?? null;
  const now = useMinuteClock();

  // HTML labels pinned to the map for the two ends of the selected route.
  type TimeLabel = { key: string; airport: Airport; tone: "ink" | "airway" | "ocean"; el: HTMLDivElement };
  const [timeLabels, setTimeLabels] = useState<TimeLabel[]>([]);
  const routeKey = routeTimes ? `${routeTimes.origin.iata}-${routeTimes.dest.iata}` : "";
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !routeTimes) {
      setTimeLabels([]);
      return;
    }
    const ends: Omit<TimeLabel, "el">[] = [
      { key: "origin", airport: routeTimes.origin, tone: "ink" },
      { key: "dest", airport: routeTimes.dest, tone: routeTimes.domestic ? "airway" : "ocean" },
    ];
    // Each chip goes on the outer side of its city, pointing away from the other end, so the two never overlap
    // (even on short hops like Bhubaneswar → Bhawanipatna) and neither covers the route line.
    const { horizontal, destEastOrSouth } = routeLayout(routeTimes.origin, routeTimes.dest);
    type Side = { anchor: maplibregl.PositionAnchor; offset: [number, number] };
    const LEFT: Side = { anchor: "right", offset: [-14, 0] };
    const RIGHT: Side = { anchor: "left", offset: [14, 0] };
    const ABOVE: Side = { anchor: "bottom", offset: [0, -15] };
    const BELOW: Side = { anchor: "top", offset: [0, 15] };
    const [originSide, destSide] = horizontal
      ? destEastOrSouth ? [LEFT, RIGHT] : [RIGHT, LEFT]
      : destEastOrSouth ? [ABOVE, BELOW] : [BELOW, ABOVE];
    const markers: maplibregl.Marker[] = [];
    const labels = ends.map((end) => {
      const el = document.createElement("div");
      el.style.pointerEvents = "none";
      const side = end.key === "origin" ? originSide : destSide;
      markers.push(
        new maplibregl.Marker({ element: el, anchor: side.anchor, offset: side.offset })
          .setLngLat([end.airport.lon, end.airport.lat])
          .addTo(map),
      );
      return { ...end, el };
    });
    setTimeLabels(labels);
    return () => markers.forEach((m) => m.remove());
    // Recreate only when the route changes.
  }, [routeKey, ready]);

  // Create the map once.
  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style: STYLE_URL,
      // MapLibre animates paint changes over 300 ms by default; that made theme switches (and the first paint
      // in dark mode) visibly fade. Colour changes here should be instant.
      transformStyle: (_previous, next) => ({ ...next, transition: { duration: 0, delay: 0 } }),
      bounds: handlers.current.country.bounds,
      fitBoundsOptions: { padding: padding(), maxZoom: 6 },
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      renderWorldCopies: true, // pan freely east or west, e.g. to the Americas
      minZoom: 1,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    // Dots get small when zoomed out; a wider invisible hit area keeps them easy to click and tap.
    const overlay = new MapboxOverlay({ interleaved: false, layers: [], pickingRadius: 8 });
    map.addControl(overlay);
    // Fires once: the style is never swapped (themes repaint it instead).
    // Keep the canvas hidden until it has drawn a frame in the right theme, so a dark page never flashes the
    // style's default light colours on load. The wrapper behind it shows the theme's paper colour meanwhile.
    map.getCanvas().style.opacity = "0";
    map.on("moveend", () => setViewVersion((v) => v + 1));
    // Countries respond only where no airport dot or route is under the pointer (those come first).
    const countryAt = (point: maplibregl.Point): string | null => {
      const h = handlers.current;
      if (h.origin || !map.getLayer(AREAS.hit)) return null;
      // Airports win over the country underneath: anything within 16 px of a dot or route counts as the airport, so
      // a pointer just off a tiny dot (Dubai, zoomed out) doesn't fall through to Iran across the Gulf.
      if (overlay.pickObject({ x: point.x, y: point.y, radius: 16 })) return null;
      const iso2 = map.queryRenderedFeatures(point, { layers: [AREAS.hit] })[0]?.properties?.iso2 as string | undefined;
      return iso2 && iso2 !== h.country.iso2 ? iso2 : null;
    };
    const setHover = (iso2: string | null, point?: maplibregl.Point) => {
      if (iso2 !== hoverCountryRef.current && map.getLayer(AREAS.hover)) map.setFilter(AREAS.hover, onlyCountry(iso2));
      hoverCountryRef.current = iso2;
      setHoverCountry(iso2 && point ? { iso2, x: point.x, y: point.y } : null);
      if (iso2) map.getCanvas().style.cursor = PLANE_CURSOR;
      else if (!overlay.pickObject({ x: point?.x ?? -1, y: point?.y ?? -1, radius: 8 })) map.getCanvas().style.cursor = "";
    };
    map.on("mousemove", (e) => setHover(countryAt(e.point), e.point));
    map.on("mouseout", () => setHover(null));
    map.on("movestart", () => setChooser(null));
    map.on("click", (e) => {
      const h = handlers.current;
      // Start screen: one airport under the pointer opens it; several (a crowded spot) opens a list to choose from.
      if (!h.origin && !h.pair) {
        // The capital's label is a link: its airport's routes, or a list when it names several.
        const named = capitalAirportsRef.current;
        if (named.length > 0 && overlay.pickObject({ x: e.point.x, y: e.point.y, radius: 2, layerIds: ["capital-name"] })) {
          if (named.length === 1) {
            setChooser(null);
            h.onPickOrigin(named[0].iata);
          } else {
            setChooser({ x: e.point.x, y: e.point.y, airports: named });
          }
          return;
        }
        const here = airportsAt(map, h.origins, h.dotWeights, e.point);
        if (here.length === 1) {
          setChooser(null);
          h.onPickOrigin(here[0].iata);
          return;
        }
        if (here.length > CHOOSER_MAX) {
          // Too many to list (a fingertip over the US north-east, zoomed out): zoom in on the nearest ones instead,
          // as clustered maps do; the next tap then opens one or lists a few.
          setChooser(null);
          const b = new maplibregl.LngLatBounds();
          for (const a of here.slice(0, CHOOSER_MAX)) b.extend([a.lon, a.lat]); // the nearest few: one tap closer
          map.fitBounds(b, { padding: padding(), maxZoom: 11, duration: prefersReducedMotion() ? 0 : 700 });
          return;
        }
        if (here.length > 1) {
          setChooser({ x: e.point.x, y: e.point.y, airports: here });
          return;
        }
      }
      setChooser(null);
      const iso2 = countryAt(e.point);
      if (iso2) {
        setHover(null);
        handlers.current.onPickCountry(iso2);
      }
    });
    map.on("style.load", () => {
      originalsRef.current = prepareChartStyle(map);
      addOfficialBorders(map, handlers.current.country.iso2);
      paintTheme(map, themeRef.current, originalsRef.current);
      setCityLabels(map, handlers.current.origin === null);
      map.once("render", () => {
        map.getCanvas().style.opacity = "1";
      });
      setReady(true);
      map.once("idle", () => setBaseLoaded(true));
      window.setTimeout(() => setBaseLoaded(true), 3000); // slow connection: show the routes anyway
    });
    mapRef.current = map;
    overlayRef.current = overlay;
    return () => {
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, []);

  // Theme switch: repaint the existing map (no new style, no tiles to fetch).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    paintTheme(map, theme, originalsRef.current);
  }, [theme, ready]);


  // Frame the map on the origin and the destinations currently shown. The very first framing (page load or
  // refresh) jumps straight there; later changes (picking a city or route) animate.
  const originIata = origin?.iata ?? null;
  const framedOnce = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const duration = prefersReducedMotion() || !framedOnce.current ? 0 : 900;
    framedOnce.current = true;
    setCityLabels(map, origin === null && !pair, !pair || origin !== null);
    if (!origin) {
      if (pair) {
        const b = new maplibregl.LngLatBounds();
        if (pair.links.length > 0) for (const l of pair.links) b.extend([l.from.lon, l.from.lat]).extend([l.to.lon, l.to.lat]);
        else b.extend(country.bounds).extend(pair.target.bounds);
        // Extra room at the sides so names placed left/right of the outermost airports stay clear of the panel.
        const p = padding();
        const extra = isWide() ? 140 : 0;
        map.fitBounds(b, { padding: { ...p, left: p.left + extra, right: p.right + extra }, duration, maxZoom: 5.5 });
        return;
      }
      map.fitBounds(country.bounds, { padding: padding(), duration, maxZoom: countryZoom(map, country.bounds) });
      return;
    }
    const shown = destinations.length > 0 ? destinations : allDestinations;
    const bounds = new maplibregl.LngLatBounds([origin.lon, origin.lat], [origin.lon, origin.lat]);
    for (const d of shown) bounds.extend([d.airport.lon, d.airport.lat]);
    if (shown.length === 1) {
      // A single route: zoom out so both ends, their chips and some context stay in view. Chips sit beside the
      // dots on east–west routes and above/below on north–south ones, so leave room on those sides.
      const p = padding();
      const wide = isWide();
      const { horizontal } = routeLayout(origin, shown[0].airport);
      const side = wide ? (horizontal ? CHIP_ROOM.side : 140) : 40;
      const vert = wide ? (horizontal ? 140 : 140 + CHIP_ROOM.vertical) : 40;
      map.fitBounds(bounds, {
        padding: { top: p.top + vert, bottom: p.bottom + vert, left: p.left + side, right: p.right + side },
        duration,
        // Up to zoom 5 for context; hops under ~150 km closer in, or the route would hide behind its own labels.
        maxZoom: Math.max(5, 7.5 - 1.7 * Math.max(bounds.getEast() - bounds.getWest(), bounds.getNorth() - bounds.getSouth())),
      });
    } else {
      map.fitBounds(bounds, { padding: padding(), duration, maxZoom: 6.5 });
    }
    // Reframe only when the origin or the filters change, not on every hover.
  }, [originIata, frameKey, ready, country.iso2, pairKey]);

  // Selected country: swap in its highlighted border and provinces (one small file, fetched on demand).
  useEffect(() => {
    const map = mapRef.current;
    if (map && ready) showCountry(map, country.iso2);
  }, [country.iso2, ready]);

  // A list of airports from a crowded spot belongs to the view it was opened in.
  useEffect(() => {
    setChooser(null);
    setHoverCapital(false);
    if (origin || pair) capitalAirportsRef.current = [];
  }, [country.iso2, origin, pair]);

  // The capital's star label replaces the base map's name for it (start screen only; elsewhere names are off).
  const capitalShown = !origin && !pair ? country.capital ?? null : null;
  useEffect(() => {
    const map = mapRef.current;
    if (map && ready) hideBaseLabelAt(map, capitalShown);
  }, [capitalShown, ready]);

  // Pair view: the other country in teal, the picker's country in magenta (back to ink afterwards).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getLayer(PAIR_PROVINCES.border)) return;
    (map.getSource(PAIR_PROVINCES.source) as maplibregl.GeoJSONSource | undefined)?.setData(pairKey ? countryFile(pairKey) : EMPTY_FC);
    map.setPaintProperty(SELECTED.border, "line-color", pairKey ? PAIR_COLOURS[theme].source : SELECTED_BORDER_COLOUR[theme]);
  }, [pairKey, ready, theme]);


  // "Loading map…" only if the wait is noticeable, so fast loads never flash it.
  useEffect(() => {
    if (baseLoaded) {
      setShowLoading(false);
      return;
    }
    const t = window.setTimeout(() => setShowLoading(true), 400);
    return () => window.clearTimeout(t);
  }, [baseLoaded]);

  // The one orchestrated moment: airways draw outward when a city is picked (on load: once the map is there).
  useEffect(() => {
    if (!baseLoaded) {
      setProgress(0);
      return;
    }
    if (!originIata || prefersReducedMotion()) {
      setProgress(1);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DRAW_MS);
      setProgress(1 - (1 - t) ** 3);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    setProgress(0);
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [originIata, baseLoaded]);

  const airways: Airway[] = useMemo(() => {
    if (!origin) return [];
    return destinations.map((dest) => ({
      dest,
      path: airwayPath([origin.lon, origin.lat], [dest.airport.lon, dest.airport.lat], dest.route.domestic ? 0.2 : 0.14),
    }));
  }, [origin, destinations]);

  const maxKm = useMemo(() => Math.max(1, ...allDestinations.map((d) => d.km)), [allDestinations]);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    if (!baseLoaded) {
      overlay.setProps({ layers: [] });
      return;
    }
    const map = mapRef.current;
    const setCursor = (info: PickingInfo) => {
      if (map) map.getCanvas().style.cursor = info.object || hoverCountryRef.current ? PLANE_CURSOR : "";
    };
    const dim = emphasised !== null;
    // Dot size follows zoom: about half size for the whole-country/world view, growing to full size by zoom 7.
    // Re-evaluated after each zoom (viewVersion).
    const zoom = map ? map.getZoom() : 4;
    const dotScale = dotScaleAt(zoom);
    const layers: Layer[] = [];

    if (!origin && pair) {
      const em = pair.links.find((l) => linkKey(l) === emphasisedLink) ?? null;
      // A link is "on" when it's hovered (map or list) or touches the hovered airport dot.
      const on = (l: Link) =>
        em ? linkKey(l) === emphasisedLink : hoverPairAirport !== null && (l.from.iata === hoverPairAirport || l.to.iata === hoverPairAirport);
      const anyOn = em !== null || hoverPairAirport !== null;
      // Airports on each side, busiest first. "Busiest" = routes × airlines, so Dubai (fewer routes than Abu Dhabi
      // but far more airlines) gets its name placed first.
      const ends = (side: "from" | "to") => {
        const m = new Map<string, { airport: Airport; n: number; weight: number }>();
        for (const l of pair.links) {
          const e = m.get(l[side].iata) ?? { airport: l[side], n: 0, weight: 0 };
          e.n++;
          e.weight += l.airlines.length;
          m.set(l[side].iata, e);
        }
        return [...m.values()].sort((a, b) => b.weight - a.weight);
      };
      const sources = ends("from");
      const targets = ends("to");
      layers.push(
        new PathLayer<Link>({
          id: "pair-links",
          data: pair.links,
          getPath: (l) => airwayPath([l.from.lon, l.from.lat], [l.to.lon, l.to.lat], 0.14),
          // One even, thin line per airport pair (airline counts are in the list); only the hovered ones get bold.
          getColor: (l) => [...palette.ocean, anyOn ? (on(l) ? 255 : 35) : 120],
          getWidth: (l) => (anyOn && on(l) ? 3 : 1.1),
          widthUnits: "pixels",
          capRounded: true,
          jointRounded: true,
          pickable: true,
          onHover: (info) => {
            setCursor(info);
            handlers.current.onHoverLink(info.object ? linkKey(info.object) : null);
          },
          onClick: (info) => info.object && handlers.current.onPickLink(info.object),
          updateTriggers: { getColor: [emphasisedLink, hoverPairAirport, theme], getWidth: [emphasisedLink, hoverPairAirport] },
        }),
        new ScatterplotLayer<{ airport: Airport; n: number; source: boolean }>({
          id: "pair-airports",
          data: [...sources.map((e) => ({ ...e, source: true })), ...targets.map((e) => ({ ...e, source: false }))],
          getPosition: (e) => [e.airport.lon, e.airport.lat],
          getRadius: (e) => Math.max(3, Math.min(9, 3 + Math.sqrt(e.n) * 1.2) * dotScale),
          radiusUnits: "pixels",
          getFillColor: (e) => (e.source ? palette.airway : palette.ocean),
          getLineColor: palette.paper,
          stroked: true,
          lineWidthUnits: "pixels",
          getLineWidth: 1.5,
          pickable: true,
          onHover: (info) => {
            setCursor(info);
            setHoverPairAirport(info.object?.airport.iata ?? null);
          },
          updateTriggers: { getFillColor: theme, getLineColor: theme, getRadius: dotScale },
        }),
      );
      const hoveredEnd = [...sources, ...targets].find((e) => e.airport.iata === hoverPairAirport);
      if (em) {
        layers.push(label("pair-from", em.from, palette.airway, palette.paper), label("pair-to", em.to, palette.ocean, palette.paper));
      } else if (hoveredEnd) {
        const side = hoveredEnd.airport.country === pair.target.iso2 ? palette.ocean : palette.airway;
        layers.push(label("pair-hover", hoveredEnd.airport, side, palette.paper));
      } else {
        layers.push(
          new TextLayer<Placed<{ airport: Airport; source: boolean }>>({
            id: "pair-names",
            // All of the other country's airports (usually few), and only the 5 busiest on this side; hover for the rest.
            data: placeAirports(
              map,
              [...targets.map((e) => ({ airport: e.airport, source: false })), ...sources.slice(0, 5).map((e) => ({ airport: e.airport, source: true }))],
              [...targets, ...sources].map((e) => e.airport),
            ),
            getPosition: (e) => [e.airport.lon, e.airport.lat],
            getText: (e) => nameText(e.airport),
            getColor: (e) => (e.source ? palette.airway : palette.ocean),
            getSize: 14,
            fontFamily: '"Barlow Condensed", "Barlow", sans-serif',
            fontWeight: 600,
            getPixelOffset: (e) => e.offset,
            background: true,
            getBackgroundColor: [...palette.paper, 225],
            backgroundPadding: [5, 2],
            characterSet: "auto",
            updateTriggers: { getColor: theme, getBackgroundColor: theme },
          }),
        );
      }
    } else if (!origin) {
      layers.push(
        new ScatterplotLayer<Airport>({
          id: "origins",
          data: sizedOrigins,
          getPosition: (a) => [a.lon, a.lat],
          // Dot area grows with the number of non-stop destinations (square-root scale, so Delhi's 159 isn't
          // 40× Kanpur's 4), with a floor so small airports stay visible and a cap so hubs don't swamp neighbours.
          // Zoom scaling is applied here (not via radiusScale) so there's a floor: never under 3 px radius.
          getRadius: (a) => Math.max(3, dotRadius(dotWeights.get(a.iata) ?? 1) * dotScale) + (a.iata === hoverOrigin ? 2 : 0),
          radiusUnits: "pixels",
          lineWidthScale: dotScale,
          // Colour = which side of the route map (magenta for covered countries, teal elsewhere); shade = how connected. Mixing toward
          // the paper colour gives "darker means more" on the light map and "brighter means more" on the dark one.
          getFillColor: (a) => {
            // Lightest shade starts at 72%: the minimum that keeps every dot at ≥ 3:1 against the land in both themes.
            const t = a.iata === hoverOrigin ? 1 : 0.72 + 0.28 * Math.sqrt((dotWeights.get(a.iata) ?? 1) / maxWeight);
            const c = homeCountry ? palette.airway : palette.ocean;
            return c.map((v, i) => Math.round(palette.paper[i] + (v - palette.paper[i]) * t)) as RGB;
          },
          getLineColor: palette.paper,
          lineWidthUnits: "pixels",
          getLineWidth: 1.5,
          stroked: true,
          pickable: true,
          onHover: (info) => {
            setCursor(info);
            setHoverOrigin(info.object?.iata ?? null);
            // Several dots under the pointer: the label says so, so the list that a click opens isn't a surprise.
            setHoverCrowd(info.object && map ? airportsAt(map, origins, dotWeights, info).length : 0);
          },
          // Clicks are handled by the map (see "click" above), which also covers crowded spots.
          updateTriggers: {
            getRadius: [hoverOrigin, dotWeights, dotScale],
            getFillColor: [theme, hoverOrigin, homeCountry, maxWeight],
            getLineColor: theme,
          },
        }),
      );
      // The capital: a star (the usual map symbol) and its name, above the airport dots so it's always readable,
      // as the capitals of the countries around are (the base map's own label for it is hidden, see
      // hideBaseLabelAt). Not pickable: clicks go through to the dots underneath.
      const capital = country.capital;
      // The capital's airports (within 60 km), busiest first: its label sits by the busiest and links to them.
      const capitalAirports = capital
        ? sizedOrigins.filter((a) => distanceKm(a, { lat: capital.lat, lon: capital.lon }) <= CAPITAL_AIRPORT_KM)
        : [];
      const codes = capitalAirports.map((a) => a.iata).filter((c) => c.length === 3);
      // Longest first; shorter ones for when it doesn't fit beside the star (narrow phone maps).
      // A capital with airports: the label belongs to its busiest airport's dot (the codes name airports, so the
      // label sits by one, not 10 km away in the city centre: Conakry), with the star in the label. Without
      // airports: a star on the city, the name beside it.
      const hub = capitalAirports[0] ?? null;
      capitalAirportsRef.current = capitalAirports.filter((a) => codes.slice(0, 3).includes(a.iata));
      // The star is an icon drawn inside the label's left padding, not a "★" character: the label font has no star
      // and browsers substitute unpredictably (one showed "決").
      const star = "";
      // Just the capital's name: its airport's dot is right beside it, so codes would only repeat it (and Sri
      // Jayawardenepura Kotte is long enough already). Clicking it opens that airport, or a list if there are several.
      const texts = capital ? [star + capital.name] : [""];
      const anchorAt: [number, number] | null = hub ? [hub.lon, hub.lat] : capital ? [capital.lon, capital.lat] : null;
      // Clear of the dot (its radius at this zoom) or of the star.
      const gap = hub ? Math.max(3, dotRadius(dotWeights.get(hub.iata) ?? 1) * dotScale) + 6 : 12;
      let capitalText = texts[0];
      // Name on the side of the star that covers the fewest airport dots (right, left, above, below, in that order
      // of preference), and never under the zoom buttons at the right edge or off the map.
      type Side = { anchor: "start" | "end" | "middle"; baseline: "center" | "bottom" | "top"; offset: [number, number] };
      const SIDES: Side[] = [
        { anchor: "start", baseline: "center", offset: [gap, 0] },
        { anchor: "end", baseline: "center", offset: [-gap, 0] },
        { anchor: "middle", baseline: "bottom", offset: [0, -gap] },
        { anchor: "middle", baseline: "top", offset: [0, gap] },
      ];
      let side = SIDES[0];
      let starOffset: [number, number] = [0, 0]; // star inside the label, from the dot
      if (anchorAt && map) {
        const at = map.project(anchorAt);
        const h = 22;
        const { clientWidth, clientHeight } = map.getContainer();
        const dots = sizedOrigins.map((a) => map.project([a.lon, a.lat]));
        // The first text that fits on some side, on the side covering the fewest dots (ties: right, left, above, below).
        for (const text of texts) {
          const w = capitalLabelWidth(text) + (hub ? STAR_ROOM : 0);
          const box = (s: Side) => {
            const x0 = s.anchor === "start" ? at.x + s.offset[0] : s.anchor === "end" ? at.x + s.offset[0] - w : at.x - w / 2;
            const y0 = s.baseline === "center" ? at.y - h / 2 : s.baseline === "bottom" ? at.y + s.offset[1] - h : at.y + s.offset[1];
            return { x0, y0, x1: x0 + w, y1: y0 + h };
          };
          const fits = (b: ReturnType<typeof box>) => b.x0 >= (isWide() ? 432 : 8) && b.x1 <= clientWidth - 68 && b.y0 >= 8 && b.y1 <= clientHeight - 40; // 40: map credits
          const covered = (b: ReturnType<typeof box>) => dots.filter((p) => p.x > b.x0 - 4 && p.x < b.x1 + 4 && p.y > b.y0 - 4 && p.y < b.y1 + 4).length;
          const scored = SIDES.map((s, i) => ({ s, i, b: box(s) })).filter((c) => fits(c.b));
          capitalText = text;
          const best = scored.length > 0 ? scored.sort((a, b) => covered(a.b) - covered(b.b) || a.i - b.i)[0] : { s: SIDES[0], b: box(SIDES[0]) };
          side = best.s;
          // The label's background starts (left edge) here; the star is centred in its slot after 5 px of padding.
          const textW = capitalLabelWidth(text) - 10;
          const o = best.s.offset;
          const left = best.s.anchor === "start" ? o[0] - 5
            : best.s.anchor === "end" ? o[0] - textW - 5 - STAR_ROOM
            : o[0] + STAR_ROOM / 2 - textW / 2 - 5 - STAR_ROOM;
          const midY = best.s.baseline === "center" ? 0 : best.s.baseline === "bottom" ? o[1] - 9 : o[1] + 9;
          starOffset = [left + 5 + STAR_ROOM / 2 - 1, midY];
          if (scored.length > 0) break;
        }
      }
      if (capital && anchorAt) {
        layers.push(
          new TextLayer<NonNullable<Country["capital"]>>({
            id: "capital-name",
            data: [capital],
            getPosition: () => anchorAt,
            getText: () => capitalText,
            // A link when it names airports: magenta and the clickable cursor on hover (clicks: the map's handler).
            pickable: hub !== null,
            onHover: (info) => {
              setCursor(info);
              setHoverCapital(Boolean(info.object));
            },
            getColor: hoverCapital && hub ? palette.airway : palette.ink,
            getSize: 15,
            fontFamily: '"Barlow", sans-serif',
            fontWeight: 600,
            getTextAnchor: side.anchor,
            getAlignmentBaseline: side.baseline,
            // With the star room on the left: text starts after it (right side), ends before the dot's gap (left side).
            getPixelOffset: hub && side.anchor === "start" ? [side.offset[0] + STAR_ROOM, side.offset[1]]
              : hub && side.anchor === "middle" ? [side.offset[0] + STAR_ROOM / 2, side.offset[1]] : side.offset,
            background: true,
            getBackgroundColor: [...palette.paper, 225],
            // [left, top, right, bottom]: room on the left for the star icon when the label sits by an airport.
            backgroundPadding: hub ? [5 + STAR_ROOM, 2, 5, 2] : [5, 2],
            characterSet: "auto",
            updateTriggers: { getText: capitalText, getPosition: anchorAt, getColor: [theme, hoverCapital], getBackgroundColor: theme, getTextAnchor: side, getAlignmentBaseline: side, getPixelOffset: side },
          }),
        );
        // After the label, so its background doesn't cover the star.
        const stars = hub ? ([["capital", 14, palette.ink]] as const) : ([["capital-halo", 22, palette.paper], ["capital", 15, palette.ink]] as const);
        for (const [id, size, colour] of stars) {
          layers.push(
            new IconLayer<NonNullable<Country["capital"]>>({
              id,
              data: [capital],
              getPosition: () => anchorAt,
              getPixelOffset: hub ? starOffset : [0, 0],
              getIcon: () => STAR_ICON,
              getSize: size,
              sizeUnits: "pixels",
              getColor: colour,
              updateTriggers: { getColor: theme, getPosition: anchorAt, getPixelOffset: starOffset },
            }),
          );
        }
      }
      const hovered = origins.find((a) => a.iata === hoverOrigin);
      // The capital's airports: hovering one highlights the capital's label (a link to it) instead of a second label.
      const namedByCapital = hovered !== undefined && codes.slice(0, 3).includes(hovered.iata) && hoverCrowd <= 1;
      if (hovered && !chooser && !namedByCapital) {
        const more = hoverCrowd > 1 ? `  ·  ${hoverCrowd} airports here` : "";
        layers.push(label("origin-label", hovered, palette.ink, palette.paper, more));
      }
    } else {
      const reveal = (d: Destination) => Math.max(0, Math.min(1, progress * 1.6 - (d.km / maxKm) * 0.6));
      layers.push(
        new PathLayer<Airway>({
          id: "airways",
          data: airways,
          getPath: (a) => {
            const n = Math.max(2, Math.ceil(reveal(a.dest) * a.path.length));
            return a.path.slice(0, n);
          },
          getColor: (a) => {
            const c = a.dest.route.domestic ? palette.airway : palette.ocean;
            const on = a.dest.airport.iata === emphasised;
            return [...c, dim && !on ? 55 : on ? 255 : 190];
          },
          getWidth: (a) => (a.dest.airport.iata === emphasised ? 4 : a.dest.route.domestic ? 1.75 : 1.25),
          widthUnits: "pixels",
          capRounded: true,
          jointRounded: true,
          pickable: true,
          autoHighlight: false,
          onHover: (info) => {
            setCursor(info);
            handlers.current.onHover(info.object?.dest.airport.iata ?? null);
          },
          onClick: (info) => info.object && handlers.current.onPickDestination(info.object.dest.airport.iata),
          updateTriggers: { getPath: progress, getColor: [emphasised, theme], getWidth: emphasised },
        }),
        new ScatterplotLayer<Destination>({
          id: "destinations",
          data: destinations.filter((d) => reveal(d) >= 1),
          getPosition: (d) => [d.airport.lon, d.airport.lat],
          getRadius: (d) => (d.airport.iata === emphasised ? (routeTimes ? 9 : 7) : 4),
          radiusUnits: "pixels",
          radiusScale: routeTimes ? 1 : dotScale,
          lineWidthScale: routeTimes ? 1 : dotScale,
          getFillColor: (d) => {
            const c = d.route.domestic ? palette.airway : palette.ocean;
            return [...c, dim && d.airport.iata !== emphasised ? 110 : 255];
          },
          getLineColor: palette.paper,
          stroked: true,
          lineWidthUnits: "pixels",
          getLineWidth: (d) => (routeTimes && d.airport.iata === emphasised ? 3 : 1.5),
          pickable: true,
          onHover: (info) => {
            setCursor(info);
            handlers.current.onHover(info.object?.airport.iata ?? null);
          },
          onClick: (info) => info.object && handlers.current.onPickDestination(info.object.airport.iata),
          updateTriggers: { getRadius: [emphasised, routeKey], getFillColor: [emphasised, theme], getLineColor: theme, getLineWidth: [emphasised, routeKey] },
        }),
        new ScatterplotLayer<Airport>({
          id: "origin",
          data: [origin],
          getPosition: (a) => [a.lon, a.lat],
          getRadius: routeTimes ? 9 : 7,
          radiusUnits: "pixels",
          getFillColor: palette.ink,
          getLineColor: palette.paper,
          stroked: true,
          lineWidthUnits: "pixels",
          getLineWidth: routeTimes ? 3 : 2.5,
          updateTriggers: { getFillColor: theme, getLineColor: theme, getRadius: routeKey, getLineWidth: routeKey },
        }),
      );
      // Destination names, styled like the departure label ("Delhi  DEL"), once each route has finished drawing.
      // On the route page the solid chips name both ends instead.
      if (!routeTimes) {
        layers.push(
          new TextLayer<Placed<Destination>>({
            id: "destination-names",
            data: placeNames(map, origin, destinations.filter((d) => d.airport.iata !== emphasised && reveal(d) >= 1), destinations),
            getPosition: (d) => [d.airport.lon, d.airport.lat],
            getText: (d) => nameText(d.airport),
            getColor: (d) => (d.route.domestic ? palette.airway : palette.ocean),
            getSize: 14,
            fontFamily: '"Barlow Condensed", "Barlow", sans-serif',
            fontWeight: 600,
            getPixelOffset: (d) => d.offset,
            background: true,
            getBackgroundColor: [...palette.paper, 225],
            backgroundPadding: [5, 2],
            characterSet: "auto",
            updateTriggers: { getColor: theme, getBackgroundColor: theme },
          }),
        );
      }
      // On the route page the two ends get HTML labels with local times instead (see timeLabels).
      if (!routeTimes) {
        layers.push(label("origin-label", origin, palette.ink, palette.paper));
        const em = destinations.find((d) => d.airport.iata === emphasised);
        if (em) layers.push(label("dest-label", em.airport, em.route.domestic ? palette.airway : palette.ocean, palette.paper));
      }
    }
    overlay.setProps({ layers });
  }, [sizedOrigins, dotWeights, maxWeight, homeCountry, origin, destinations, airways, emphasised, progress, maxKm, hoverOrigin, ready, palette, theme, routeKey, baseLoaded, viewVersion, pair, emphasisedLink, hoverPairAirport, hoverCrowd, chooser, hoverCapital]);

  return (
    // MapLibre's own (unlayered) CSS sets position: relative on the map element, which beats Tailwind's
    // layered utilities, so the positioning lives on a wrapper and the map just fills it.
    <div className="absolute inset-0 bg-paper" role="region" aria-label="Map of non-stop routes. The destination list has the same information.">
      <div ref={container} className="h-full w-full" />
      {baseLoaded
        ? timeLabels.map((t) => createPortal(<MapTimeLabel airport={t.airport} tone={t.tone} now={now} />, t.el, t.key))
        : null}
      {chooser && !origin && !pair ? (
        <AirportChooser
          x={chooser.x}
          y={chooser.y}
          airports={chooser.airports}
          weights={dotWeights}
          home={homeCountry}
          onPick={(iata) => {
            setChooser(null);
            handlers.current.onPickOrigin(iata);
          }}
          onClose={() => {
            setChooser(null);
            mapRef.current?.getCanvas().focus();
          }}
        />
      ) : null}
      {hoverCountry ? (
        <CountryHint
          x={hoverCountry.x}
          y={hoverCountry.y}
          name={props.countries.find((c) => c.iso2 === hoverCountry.iso2)?.name ?? hoverCountry.iso2}
          source={inSentence(country)}
          count={props.linkCounts.get(hoverCountry.iso2) ?? 0}
        />
      ) : null}
      <p
        aria-live="polite"
        className={`pointer-events-none absolute inset-x-0 bottom-10 text-center text-sm text-slate md:bottom-auto md:top-1/2 md:left-[416px] ${showLoading ? "" : "sr-only"}`}
      >
        {showLoading ? "Loading map…" : ""}
      </p>
    </div>
  );
}

/** Map label text: "Delhi  DEL". */
const nameText = (a: Airport) => `${a.label}  ${a.iata.length === 3 ? a.iata : ""}`.trim();

/**
 * Real width of a label in px: the text measured in the label font (Barlow Condensed SemiBold), plus the
 * background's side padding. Guessing a width per letter over-estimated narrow names by up to ~40%, so labels
 * were dropped for overlaps that weren't there (Bengaluru from Ranchi).
 */
const measureCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
const widthCache = new Map<string, number>();
function labelWidth(text: string, size: number, padX: number): number {
  const key = `${size}|${text}`;
  let w = widthCache.get(key);
  if (w === undefined) {
    if (measureCtx) {
      measureCtx.font = `600 ${size}px "Barlow Condensed", "Barlow", sans-serif`;
      w = measureCtx.measureText(text).width;
    } else {
      w = text.length * size * 0.45;
    }
    // Only cache once the web font is in, so an early fallback-font measurement isn't kept.
    if (document.fonts?.check(`600 ${size}px "Barlow Condensed"`)) widthCache.set(key, w);
  }
  return w + padX * 2;
}

/** Screen position, on the copy of the world nearest the middle of the visible map (longitudes may go past ±180). */
function project(map: maplibregl.Map, a: Airport): maplibregl.Point {
  const { clientWidth: w, clientHeight: h } = map.getContainer();
  const middle = map.unproject([isWide() ? (424 + w) / 2 : w / 2, h / 2]).lng; // the panel covers the left on wide screens
  const turns = Math.round((a.lon - middle) / 360);
  return map.project([a.lon - 360 * turns, a.lat]);
}

type Box = { x0: number; y0: number; x1: number; y1: number };

/**
 * Destination names that fit without overlapping: the departure label is reserved first, then destinations from
 * nearest to farthest, each trying several positions around its dot. Recomputed after each pan/zoom, so more names
 * appear as you zoom in.
 */
function placeNames(map: maplibregl.Map | null, origin: Airport, items: Destination[], allShown: Destination[]): Placed<Destination>[] {
  if (!map) return [];
  // The departure label ("Ranchi  IXR", 15px, 18px above its dot) is drawn separately; keep its space free.
  const p = project(map, origin);
  const w = labelWidth(nameText(origin), 15, 6);
  const originBox: Box = { x0: p.x - w / 2, x1: p.x + w / 2, y0: p.y - 18 - 12, y1: p.y - 18 + 12 };
  return placeAirports(
    map,
    [...items].sort((a, b) => a.km - b.km),
    [origin, ...allShown.map((d) => d.airport)],
    [originBox],
  );
}

/** Small label by the cursor when pointing at a country: its name and how it's connected to the picker's country. */
/** Most airports listed in the chooser; a tap on more than this zooms in on them instead. */
const CHOOSER_MAX = 8;

/**
 * The airports at a crowded spot of the start-screen map, to pick one: a small card by the click, busiest first,
 * each row a full-size button (44 px). Keyboard: focus starts on the first airport, arrows move, Escape closes.
 */
function AirportChooser({ x, y, airports, weights, home, onPick, onClose }: {
  x: number;
  y: number;
  airports: Airport[];
  weights: Map<string, number>;
  home: boolean;
  onPick: (iata: string) => void;
  onClose: () => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const sorted = useMemo(
    () => [...airports].sort((a, b) => (weights.get(b.iata) ?? 0) - (weights.get(a.iata) ?? 0) || a.label.localeCompare(b.label)),
    [airports, weights],
  );

  // Beside the click, kept on the map: clear of the panel on wide screens, flipped left/up near the far edges.
  useLayoutEffect(() => {
    const el = card.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    // Never over the map's own controls: the panel (wide screens), the country pill at the top right and the zoom
    // buttons at the bottom right. Too tall for what's left (small phone map): it scrolls.
    const gap = 12;
    const minLeft = isWide() ? 432 : 8;
    const maxRight = box.clientWidth - 64;           // zoom buttons
    const minTop = 68;                               // country pill
    const maxBottom = box.clientHeight - 46;         // map credits (kept visible)
    const w = el.offsetWidth;
    const maxHeight = maxBottom - minTop;
    const h = Math.min(el.scrollHeight, maxHeight);
    let left = x + gap;
    if (left + w > maxRight) left = x - gap - w;
    left = Math.max(minLeft, Math.min(left, maxRight - w));
    let top = y - 20;
    if (top + h > maxBottom) top = maxBottom - h;
    setPos({ left, top: Math.max(minTop, top), maxHeight });
  }, [x, y, airports]);

  // Focus the first airport once the card is placed (it's hidden until then, and hidden things can't take focus).
  const placed = pos !== null;
  useEffect(() => {
    if (placed) card.current?.querySelector<HTMLButtonElement>("button[data-airport]")?.focus({ preventScroll: true });
  }, [placed, airports]);

  useEffect(() => {
    // A press anywhere else closes it (the map's own click handler opens the next one if needed).
    const onDown = (e: PointerEvent) => {
      if (card.current && !card.current.contains(e.target as Node) && !(e.target as HTMLElement).closest(".maplibregl-canvas")) onClose();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [airports]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const buttons = [...(card.current?.querySelectorAll<HTMLButtonElement>("button[data-airport]") ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  };

  return (
    <div
      ref={card}
      role="dialog"
      aria-label={`${airports.length} airports here`}
      onKeyDown={onKeyDown}
      style={pos ? { left: pos.left, top: pos.top, maxHeight: pos.maxHeight } : { visibility: "hidden" }}
      className="absolute z-20 flex w-72 flex-col overflow-hidden rounded-xl bg-surface shadow-xl ring-1 shadow-ink/15 ring-ink/10 dark:shadow-black/50 dark:ring-white/10"
    >
      <div className="flex items-center justify-between gap-2 border-b border-rule py-1 pr-1 pl-3.5">
        <p className="text-sm font-medium text-slate">{airports.length} airports here</p>
        <button type="button" aria-label="Close" onClick={onClose} className="grid size-11 cursor-pointer place-items-center rounded-lg text-slate hover:bg-paper hover:text-ink">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <ul className="min-h-0 overflow-y-auto overscroll-contain p-1.5">
        {sorted.map((a) => {
          const n = weights.get(a.iata) ?? 0;
          return (
            <li key={a.iata}>
              <button
                type="button"
                data-airport
                onClick={() => onPick(a.iata)}
                className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left hover:bg-paper focus-visible:bg-paper"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">{a.label}</span>
                  <span className="block text-xs text-slate">{n} {n === 1 ? "destination" : "destinations"}</span>
                </span>
                <span translate="no" className={`shrink-0 font-display text-base font-semibold ${home ? "text-airway" : "text-ocean"}`}>
                  {a.iata}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CountryHint({ x, y, name, source, count }: { x: number; y: number; name: string; source: string; count: number }) {
  return (
    <div
      aria-hidden="true"
      // Beside the cursor; flipped to its left near the right edge so it never runs off screen.
      style={{ transform: x > window.innerWidth - 280 ? `translate(calc(${x - 16}px - 100%), ${y + 18}px)` : `translate(${x + 16}px, ${y + 18}px)` }}
      className="pointer-events-none absolute top-0 left-0 z-10 max-w-64 rounded-lg bg-surface/95 px-3 py-2 shadow-lg ring-1 shadow-ink/10 ring-ink/10 backdrop-blur-md dark:shadow-black/40 dark:ring-white/10"
    >
      <p className="text-sm font-semibold text-ink">{name}</p>
      <p className="text-xs text-slate">
        {count > 0 ? `${count} ${count === 1 ? "route" : "routes"} with ${source}` : `No routes with ${source} yet`}
      </p>
    </div>
  );
}

type Placed<T> = T & { offset: [number, number] };

/**
 * Airport names that fit without overlapping, in priority order. Each name tries above its dot, then below, right
 * and left, so airports close together (Dubai and Sharjah are 15 km apart) each get a side instead of one being
 * dropped. Names also keep clear of every airport dot (`obstacles`).
 */
function placeAirports<T extends { airport: Airport }>(map: maplibregl.Map | null, items: T[], obstacles: Airport[] = [], reserved: Box[] = []): Placed<T>[] {
  if (!map) return [];
  const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const dots: Box[] = obstacles.map((a) => {
    const p = project(map, a);
    return { x0: p.x - 5, x1: p.x + 5, y0: p.y - 5, y1: p.y + 5 };
  });
  // The panel covers the left of the map on wide screens: names must not slide under it.
  const panel: Box[] = isWide() ? [{ x0: -1e6, x1: 424, y0: -1e6, y1: 1e6 }] : [];
  // So does the country pill in the corner.
  const pill = document.querySelector("[data-country-pill]")?.getBoundingClientRect();
  const corner: Box[] = pill ? [{ x0: pill.left - 4, x1: 1e6, y0: -1e6, y1: pill.bottom + 4 }] : [];
  const placed: Box[] = [...reserved, ...panel, ...corner];
  const shown: Placed<T>[] = [];
  const edge = map.getContainer().clientWidth;
  for (const item of items) {
    const p = project(map, item.airport);
    const w = labelWidth(nameText(item.airport), 14, 5); // 14px text, 5px side padding
    const h = 20; // 14px text plus 2px padding top and bottom, with a little air
    // Above, below, right, left; then the four diagonals; then a row further out above and below.
    const r = w / 2 + 8;
    const sides: [number, number][] = [
      [0, -16], [0, 16], [r + 2, 0], [-(r + 2), 0],
      [r, -14], [-r, -14], [r, 14], [-r, 14],
      [0, -40], [0, 40], [r, -36], [-r, -36], [r, 36], [-r, 36],
    ];
    for (const [dx, dy] of sides) {
      const box = { x0: p.x + dx - w / 2, x1: p.x + dx + w / 2, y0: p.y + dy - h / 2, y1: p.y + dy + h / 2 };
      if (box.x0 < edge && box.x1 > edge) continue; // cut off by the edge of the map
      if (placed.some((b) => overlaps(box, b)) || dots.some((b) => overlaps(box, b))) continue;
      placed.push(box);
      shown.push({ ...item, offset: [dx, dy] });
      break;
    }
  }
  return shown;
}

/** Radius in px (before zoom scaling) for an airport with `n` non-stop destinations. */
/** Start-screen dot size factor for a zoom level: about half size for a whole country, full size by zoom 7. */
const dotScaleAt = (zoom: number) => Math.min(1, Math.max(0.55, (zoom - 1.5) * 0.18));
const finePointer = () => window.matchMedia("(pointer: fine)").matches;

/**
 * Start-screen airports a click or tap at `point` could mean: every dot whose edge is within reach of it. Reach is
 * 4 px for a mouse and 20 px for a finger (with the dot itself, about the 44 px touch target guidelines ask for).
 * Nearest first.
 */
function airportsAt(map: maplibregl.Map, airports: Airport[], weights: Map<string, number>, point: { x: number; y: number }): Airport[] {
  const scale = dotScaleAt(map.getZoom());
  const reach = finePointer() ? 4 : 20;
  return airports
    .map((a) => {
      const p = map.project([a.lon, a.lat]);
      const r = Math.max(3, dotRadius(weights.get(a.iata) ?? 1) * scale);
      return { a, d: Math.hypot(p.x - point.x, p.y - point.y) - r };
    })
    .filter((x) => x.d <= reach)
    .sort((x, y) => x.d - y.d)
    .map((x) => x.a);
}

function dotRadius(n: number): number {
  return Math.min(13, 2.6 + 0.85 * Math.sqrt(n));
}

/** Width of the capital label (15 px Barlow semibold, 5 px padding each side), measured like the airport names. */
function capitalLabelWidth(text: string): number {
  if (!measureCtx) return text.length * 9 + 10;
  measureCtx.font = '600 15px "Barlow", sans-serif';
  return measureCtx.measureText(text).width + 10;
}

function label(id: string, a: Airport, color: RGB, background: RGB, suffix = "") {
  return new TextLayer<Airport>({
    id,
    data: [a],
    getPosition: (x) => [x.lon, x.lat],
    getText: (x) => `${x.label}  ${x.iata.length === 3 ? x.iata : ""}`.trim() + suffix,
    getColor: color,
    getSize: 15,
    fontFamily: '"Barlow Condensed", "Barlow", sans-serif',
    fontWeight: 600,
    getPixelOffset: [0, -18],
    background: true,
    getBackgroundColor: [...background, 235],
    backgroundPadding: [6, 3],
    characterSet: "auto",
    updateTriggers: { getText: suffix },
  });
}
