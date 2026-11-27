"""Borders for the map, as India officially shows them.

Source: Natural Earth (public domain).
- Countries: the "India point of view" admin-0 file. It shows all of Jammu & Kashmir and Ladakh (including
  Gilgit-Baltistan and Aksai Chin) and all of Arunachal Pradesh as part of India, with no disputed/dashed lines.
  Every other country's shape follows the same view, so e.g. Pakistan and China never cover Indian territory.
- States/provinces: the admin-1 file, trimmed to those country shapes. India's Jammu & Kashmir and Ladakh are
  rebuilt to match the official map (Natural Earth's admin-1 is de facto).

Coasts: OpenStreetMap's simplified land polygons (the base map draws OSM, so the shoreline matches it).

Writes:
- data/borders.geojson          every land border between countries (thin grey lines under the map labels); each
                                border two countries share is computed once and is the same line everywhere
- data/countries.json           the countries you can pick (those in our route data), with the area to frame, how
                                many airports/routes they have, and the capital (from Wikidata)
- data/country-areas.geojson    filled shapes of those countries (invisible; for hover and click on the map)
- data/countries/<ISO2>.geojson for each of those: "area" (its land, reaching a little out to sea, for the tint the
                                site draws under the water), "border" (land borders), "coast" (from OSM's land) and
                                "provinces" (state/province lines)

The heavy geometry runs on every CPU core (see _pmap); the output is the same as a single-core run.

Run from the pipeline/ directory (after travel_pipeline.build):
    .venv/bin/python -m travel_pipeline.borders
"""

import json
import multiprocessing
from pathlib import Path

import numpy as np

import shapely
from shapely import make_valid
from shapely.geometry import MultiPolygon, Point, box, mapping, shape
from shapely.ops import linemerge, unary_union

from . import http, sources
from .config import CACHE_DIR, DATA_DIR

SOURCE = ("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
          "ne_10m_admin_0_countries_ind.geojson")
STATES_SOURCE = ("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
                 "ne_10m_admin_1_states_provinces.geojson")
# Coastlines that match the base map (OpenFreeMap draws OpenStreetMap data): OSM's simplified land polygons, made
# for zoom 0-9. Natural Earth's coast is about 1 km out and shows as a line beside the real one when zoomed in.
OSM_LAND = "https://osmdata.openstreetmap.de/download/simplified-land-polygons-complete-3857.zip"
TOLERANCE = 0.04   # degrees (~4 km): invisible at the zoom levels the map shows
DECIMALS = 2       # ~1 km
SMALL = 6          # degrees across: countries smaller than this get finer detail
MIN_ISLAND = 0.02  # square degrees: drop smaller islands from the world outline, except India's
# Countries that are mostly coastline (Indonesia) get their whole outline highlighted: a scrap of land border alone
# wouldn't show where the country is.
MIN_LAND_SHARE = 0.2
COUNTRY_DIR = DATA_DIR / "countries"


def _round(coords, decimals=DECIMALS):
    if isinstance(coords[0], (int, float)):
        return [round(coords[0], decimals), round(coords[1], decimals)]
    return [_round(c, decimals) for c in coords]


def _diagonal(geom) -> float:
    x0, y0, x1, y1 = geom.bounds
    return ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5


def _detail(size: float) -> tuple[float, int]:
    """(simplification tolerance in degrees, decimals) for a country `size` degrees across. Detail scales with size,
    like a printed map: Samoa, which the site zooms into, fine; Russia coarse."""
    return min(0.08, max(0.0015 if size < SMALL else 0.01, size * 0.0015)), 3 if size < SMALL else DECIMALS


def _feature(props: dict, geom, decimals=DECIMALS) -> dict | None:
    if geom.is_empty:
        return None
    g = mapping(geom)
    return {"type": "Feature", "properties": props, "geometry": {"type": g["type"], "coordinates": _round(g["coordinates"], decimals)}}


def _compact_lons(main: list[float], lons: list[float]) -> tuple[float, float]:
    """West and east edges covering `main` (one landmass) and `lons`, going across the date line when that's shorter
    (Fiji: 177 to 180.6, not -180 to 180). East may exceed 180."""
    inside = [main[0], (main[0] + main[1]) / 2, main[1]]
    pts = sorted({x % 360 for x in (*inside, *lons)})
    gap, start = max(((pts[(i + 1) % len(pts)] - p) % 360 or 360, pts[(i + 1) % len(pts)]) for i, p in enumerate(pts))
    west = start if start <= 180 else start - 360
    return west, west + 360 - gap


def _carve_out(raw: dict, iso2: str, airports: list) -> bool:
    """Territories Natural Earth draws as part of another country (Réunion is in France's shape): their shape is the
    islands of that country nearest to the territory's airports, which are then no longer part of the country.
    True if the map has an outline for it."""
    mine, drawn = [], True
    for pt in airports:
        owner, part, dist = None, None, 1.0      # degrees; nothing nearer means it isn't on the map at all
        for code, geom in raw.items():
            if not geom.envelope.buffer(1).contains(pt):
                continue
            for g in getattr(geom, "geoms", [geom]):
                if (d := g.distance(pt)) < dist:
                    owner, part, dist = code, g, d
        if part is None or (part not in mine and part.area >= 0.5 * raw[owner].area):
            # Too small for the map, or drawn as part of another country's mainland (Kosovo, in India's official
            # view): just a small area around the airport, and the other country's shape stays as it is.
            drawn = False
            mine.append(pt.buffer(0.1))
        elif part not in mine:
            # With the islands around it (Mayotte's airport is on the smaller of its two).
            group = [g for g in raw[owner].geoms if g is part or (g.distance(part) < 0.3 and g.area < 0.5 * raw[owner].area)]
            mine += group
            raw[owner] = MultiPolygon([g for g in raw[owner].geoms if not any(g is x for x in group) and g.geom_type == "Polygon"])
    raw[iso2] = unary_union(mine)
    return drawn


def _iso2(p: dict) -> str:
    v = p.get("ISO_A2_EH")
    return v if v and v != "-99" else p.get("ISO_A2", "")


def _lines(geom):
    """Keep only line parts (intersections can also return stray points)."""
    if geom.geom_type in ("LineString", "MultiLineString"):
        return geom
    parts = [g for g in getattr(geom, "geoms", []) if g.geom_type in ("LineString", "MultiLineString")]
    return unary_union(parts) if parts else geom.boundary.intersection(geom)


def _osm_land() -> list:
    """OSM's simplified land polygons, in longitude/latitude (the file is in web Mercator). Downloaded once."""
    import shapefile
    import requests

    path = CACHE_DIR / "osm-land" / OSM_LAND.rsplit("/", 1)[1]
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        with requests.get(OSM_LAND, stream=True, timeout=600, headers={"User-Agent": http.USER_AGENT}) as r:
            r.raise_for_status()
            with open(f"{path}.part", "wb") as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
        Path(f"{path}.part").rename(path)
    r = 6378137.0

    def to_lonlat(xy):
        x, y = xy[:, 0], xy[:, 1]
        return np.column_stack([np.degrees(x / r), np.degrees(2 * np.arctan(np.exp(y / r)) - np.pi / 2)])

    return [shapely.transform(make_valid(shape(s.__geo_interface__)), to_lonlat)
            for s in shapefile.Reader(str(path)).iterShapes()]


def _official_indian_states(states_src, india):
    """India's states/UTs as on the official map: J&K includes PoK, Ladakh includes Gilgit-Baltistan, Aksai Chin
    and Shaksgam."""
    unit = lambda adm0, name: make_valid(next(shape(f["geometry"]) for f in states_src
                                             if f["properties"].get("adm0_a3") == adm0 and f["properties"]["name"] == name))
    states = {f["properties"]["name"]: make_valid(shape(f["geometry"]))
              for f in states_src if f["properties"].get("adm0_a3") == "IND"}
    states["Jammu and Kashmir"] = unary_union([states["Jammu and Kashmir"], unit("PAK", "Azad Kashmir")]).intersection(india)
    others = unary_union([g for n, g in states.items() if n != "Ladakh"])
    states["Ladakh"] = india.intersection(box(72.0, 32.0, 81.5, 37.5)).difference(others)
    for name, (lon, lat), want in [("Gilgit", (74.31, 35.92), "Ladakh"), ("Aksai Chin", (79.3, 35.2), "Ladakh"),
                                   ("Muzaffarabad", (73.47, 34.37), "Jammu and Kashmir"),
                                   ("Tawang", (91.86, 27.59), "Arunachal Pradesh")]:
        got = [n for n, g in states.items() if g.contains(Point(lon, lat))]
        assert got == [want], f"official map check failed: {name} is in {got}, expected {want}"
    return list(states.values())


def main() -> None:
    src = json.loads(http.get_bytes(SOURCE, suffix=".geojson"))["features"]
    states_src = json.loads(http.get_bytes(STATES_SOURCE, suffix=".geojson"))["features"]
    airports = json.loads((DATA_DIR / "airports.json").read_text())
    routes = json.loads((DATA_DIR / "routes.json").read_text())

    raw = {}  # ISO2 -> full-detail, valid country shape (India point of view)
    shapes = []
    for f in src:
        iso2, geom = _iso2(f["properties"]), make_valid(shape(f["geometry"]))
        if iso2:
            raw[iso2] = unary_union([raw[iso2], geom]) if iso2 in raw else geom
        shapes.append((iso2, geom))
    # The countries a visitor can pick: the covered countries plus every country with flights to them in our data.
    counts: dict[str, dict] = {}
    by_iata = {a["iata"]: a for a in airports}
    for r in routes:
        for code in (r["origin"], r["dest"]):
            a = by_iata[code]
            c = counts.setdefault(a["country"], {"name": a["country_name"], "airports": set(), "routes": 0})
            c["airports"].add(code)
        counts[by_iata[r["dest"]]["country"]]["routes"] += 1

    # Territories the map has no outline for: no lines are drawn, only their airports.
    undrawn = {
        iso2 for iso2 in sorted(set(counts) - set(raw))
        if not _carve_out(raw, iso2, [Point(by_iata[i]["lon"], by_iata[i]["lat"]) for i in sorted(counts[iso2]["airports"])])
    }

    # The heavy geometry below runs on every CPU core: each stage's items (countries, or pairs of neighbours) are
    # independent. Workers are forked, so they share the shapes loaded above instead of copying them.
    _G.update(raw=raw, undrawn=undrawn, states_src=states_src, counts=counts, by_iata=by_iata,
              capitals=sources.load_capitals())   # capitals: for the star on the map
    land = _osm_land()
    _G.update(land=land, land_tree=shapely.STRtree(land))
    print(f"OSM land polygons: {len(land)}")
    drawn = [c for c in raw if c.isalpha() and c not in undrawn]
    _G["near"] = dict(_pmap(_neighbours, drawn))
    pairs = sorted({tuple(sorted((a, b))) for a, ns in _G["near"].items() for b in ns})
    _G["shared"] = dict(_pmap(_shared_line, pairs))

    # Every country's outline (thin grey on the map). Borders between two countries are the very same lines as in
    # the highlighted borders, and coasts the same as an island country's highlight: picked or not, one line, never
    # two running side by side when zoomed in. Tiny islands of large countries are left out.
    world, _G["world_lines"] = [], {}
    for iso2, lines, feats in sorted(_pmap(_world_line, drawn), key=lambda x: x[0]):
        _G["world_lines"][iso2] = lines
        world += feats
    for iso2, geom in shapes:      # outlines without a country code (disputed areas)
        if not (iso2 and iso2.isalpha()):
            if feat := _feature({"iso2": iso2, "kind": "border"}, geom.simplify(TOLERANCE, preserve_topology=True).boundary, DECIMALS):
                world.append(feat)
    (DATA_DIR / "borders.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": world},
                                                         separators=(",", ":")))

    COUNTRY_DIR.mkdir(parents=True, exist_ok=True)
    index = []
    for entry, note in sorted(_pmap(_country_file, list(counts)), key=lambda x: x[0]["iso2"]):
        index.append(entry)
        print(note)

    # Filled country shapes (simplified, official boundaries) for every country in the index: invisible on the
    # site, used to tell which country is under the cursor (hover preview, click to see routes between countries).
    areas = [f for _, f in sorted(_pmap(_area, list(counts))) if f]
    (DATA_DIR / "country-areas.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": areas}, separators=(",", ":")))
    print(f"country areas: {len(areas)} shapes, {(DATA_DIR / 'country-areas.geojson').stat().st_size / 1024:.0f} KB")

    index.sort(key=lambda c: c["name"])
    (DATA_DIR / "countries.json").write_text(json.dumps(index, indent=1, ensure_ascii=False) + "\n")
    size = sum(p.stat().st_size for p in COUNTRY_DIR.glob("*.geojson")) / 1024
    print(f"{len(index)} countries; world outline {(DATA_DIR / 'borders.geojson').stat().st_size / 1024:.0f} KB; "
          f"per-country files {size:.0f} KB in total (each loaded only when picked)")


# ------------------------------------------------------------------ parallel work
# State shared with the worker processes (set before they're forked) and the functions they run.

_G: dict = {}


def _pmap(fn, items: list) -> list:
    """fn over items on every core. Biggest shapes first, so the slow ones (Russia, Canada) don't finish last."""
    def weight(item):
        codes = item if isinstance(item, tuple) else (item,)
        return -sum(shapely.get_num_coordinates(_G["raw"][c]) for c in codes)
    with multiprocessing.get_context("fork").Pool() as pool:
        return pool.map(fn, sorted(items, key=weight), chunksize=1)


def _tol_of(iso2: str) -> float:
    """Simplification tolerance for a country's highlighted lines: scales with its main landmass."""
    if iso2 == "IN":
        return 0.012  # home country: finer state lines
    g = _G["raw"][iso2]
    return _detail(_diagonal(max(g.geoms, key=lambda p: p.area) if g.geom_type == "MultiPolygon" else g))[0]


def _is_small(iso2: str, g) -> bool:
    return iso2 != "IN" and _diagonal(g) < SMALL


def _neighbours(iso2: str) -> tuple[str, list[str]]:
    """Countries whose outline touches this one. (Pieces without a country code, like the UK bases on Cyprus,
    aren't neighbours.)"""
    raw, geom = _G["raw"], _G["raw"][iso2]
    return iso2, [c for c, g in raw.items() if c != iso2 and c.isalpha() and c not in _G["undrawn"]
                  and g.envelope.intersects(geom.envelope.buffer(0.1)) and g.distance(geom) < 0.05]


def _shared_line(key: tuple[str, str]):
    """The border two countries share, computed once: their highlighted borders and the world outline all draw
    exactly this line. At the finer of the two countries' levels of detail."""
    a, b = key
    line = _lines(_G["raw"][a].boundary.intersection(_G["raw"][b].boundary.buffer(0.01)))
    line = linemerge(line) if line.geom_type == "MultiLineString" else line
    return key, line.simplify(min(_tol_of(a), _tol_of(b), TOLERANCE)) if not line.is_empty else line


def _shared(a: str, b: str):
    return _G["shared"][tuple(sorted((a, b)))]


def _world_line(iso2: str):
    """(iso2, the country's whole outline, its feature for borders.geojson). In the file each shared border is
    written once, with the first of its two countries (A–Z): half the size."""
    geom = light = _G["raw"][iso2]
    if iso2 != "IN" and geom.geom_type == "MultiPolygon" and not _is_small(iso2, geom):
        parts = [g for g in geom.geoms if g.area >= MIN_ISLAND]
        light = MultiPolygon(parts) if parts else geom
    near = _G["near"][iso2]
    coast = light.boundary
    if near:
        coast = coast.difference(unary_union([_G["raw"][c].boundary for c in near]).buffer(0.01))
    coast = _lines(coast)
    coast = linemerge(coast) if coast.geom_type == "MultiLineString" else coast
    tol = _detail(_diagonal(geom))[0] if _is_small(iso2, geom) else TOLERANCE / 2 if iso2 == "IN" else TOLERANCE
    coast = coast.simplify(tol)
    # Land borders and coast are separate features: the site fades coasts out when zoomed in, where the base map's
    # own (far more detailed) coastline takes over; land borders always stay.
    land = unary_union([_shared(iso2, c) for c in near]) if near else None
    written = unary_union([_shared(iso2, c) for c in near if iso2 < c]) if near else None
    # The world outline is land borders only: the base map itself shows where land meets sea.
    feats = [f for f in (_feature({"iso2": iso2, "kind": "border"}, written, 3) if written is not None else None,) if f]
    return iso2, (land, coast), feats


def _country_file(iso2: str):
    """Writes data/countries/<ISO2>.geojson; returns the country's countries.json entry and a log line."""
    raw, undrawn, counts, by_iata = _G["raw"], _G["undrawn"], _G["counts"], _G["by_iata"]
    geom = raw[iso2]
    # Land border = the parts of the outline that touch a neighbour. Island countries: the whole outline.
    near = _G["near"].get(iso2, []) if iso2 not in undrawn else []
    # Detail scales with the country's size, like a printed map: Qatar fine, Russia coarse.
    main = max(geom.geoms, key=lambda g: g.area) if geom.geom_type == "MultiPolygon" and iso2 != "IN" else geom
    x0, y0, x1, y1 = main.bounds
    size = _diagonal(main)
    tol = _tol_of(iso2)
    land = _lines(geom.boundary.intersection(unary_union([raw[c] for c in near]).buffer(0.01))) if near else None
    share = land.length / geom.boundary.length if land is not None and not land.is_empty else 0
    has_land_border = land is not None and not land.is_empty and land.length > 0.05 and share >= MIN_LAND_SHARE
    # The same lines as the world outline: picked together (China and North Korea) or over the grey outline,
    # one line. Island countries: their whole outline, exactly as on the world map.
    if iso2 == "IN":
        provinces = _official_indian_states(_G["states_src"], geom)
    else:
        provinces = [make_valid(shape(f["geometry"])).intersection(geom)
                     for f in _G["states_src"] if f["properties"].get("iso_a2") == iso2]
    internal = unary_union([g.boundary for g in provinces if not g.is_empty]) if provinces else None
    if internal is not None and not internal.is_empty:
        # Joining the many short pieces back into continuous lines first lets simplification work.
        internal = _lines(internal.difference(geom.boundary.buffer(min(0.03, size * 0.005))))
        internal = linemerge(internal) if internal.geom_type == "MultiLineString" else internal
        internal = internal.simplify(tol)

    # The land, as a fill for the site's tint of the picked country. Drawn under the base map's water, so it reaches
    # a little out to sea (never into another country): the sea then trims it to the base map's own, exact coast.
    # Natural Earth's coastline (about 1 km out) never shows.
    land_shape = geom.simplify(tol, preserve_topology=True)
    reach = land_shape.buffer(tol + 0.05, quad_segs=2)
    others = [g for c, g in raw.items() if c != iso2 and g.envelope.intersects(reach.envelope)]
    if others:
        reach = reach.difference(unary_union(others))
    area = unary_union([land_shape, reach]).simplify(0.01, preserve_topology=True)

    # The coast, from OSM's land within that area: the very shoreline the base map draws, so it can be outlined as
    # darkly as a land border (island countries: Sri Lanka, American Samoa). Stretches along the area's own edge are
    # where it meets a neighbour (land borders, drawn separately) and are left out. Finer for small countries.
    coast = None
    hits = _G["land_tree"].query(area)
    if len(hits):
        land_here = unary_union([_G["land"][i] for i in hits]).intersection(area)
        # Large countries are seen zoomed out: their tiny islets (Canada's Arctic has thousands) would only add
        # weight, so they're left out, and the line is a little coarser.
        if size >= SMALL and not land_here.is_empty:
            parts = [g for g in getattr(land_here, "geoms", [land_here]) if g.area >= MIN_ISLAND / 10]
            land_here = unary_union(parts) if parts else land_here
        if not land_here.is_empty:
            line = _lines(land_here.boundary.difference(area.boundary.buffer(0.005)))
            line = linemerge(line) if line.geom_type == "MultiLineString" else line
            coast = line.simplify(min(0.04, max(0.002, tol / 3))) if not line.is_empty else None

    # Lines: land borders (the same lines as on the world map) and the coast; a country with neither in our data
    # (no neighbours, no OSM land found) falls back to its Natural Earth outline.
    border = _G["world_lines"][iso2][0] if iso2 in _G["world_lines"] else None
    if border is None and coast is None:
        border = geom.boundary.simplify(tol)

    feats = [] if iso2 in undrawn else [f for f in (_feature({"kind": "area"}, area, 3),
                         _feature({"kind": "border"}, border, 3) if border is not None else None,
                         _feature({"kind": "coast"}, coast, 3) if coast is not None else None,
                         _feature({"kind": "provinces"}, internal, 3) if internal is not None else None) if f]
    path = COUNTRY_DIR / f"{iso2}.geojson"
    path.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")))

    # Framing uses the main landmass (contiguous US, metropolitan France), not every far-off island.
    # Always extended to all the country's airports, or they'd be off screen: Malaysia's biggest landmass is
    # Borneo but Kuala Lumpur isn't on it, and the Maldives has no main landmass at all.
    c = counts[iso2]
    if geom.geom_type == "MultiPolygon" and iso2 != "IN":
        # Small island countries: every sizeable island (the Comoros), not just the biggest, unless far apart.
        islands = unary_union([g for g in geom.geoms if g.area >= main.area / 10])
        if _diagonal(islands) < min(4, 8 * size):
            x0, y0, x1, y1 = islands.bounds
    if iso2 in undrawn:
        x0, y0, x1, y1 = x0 - 0.5, y0 - 0.5, x1 + 0.5, y1 + 0.5     # some surroundings, to see where it is
    x0, x1 = _compact_lons([x0, x1], [by_iata[i]["lon"] for i in c["airports"]])
    lats = [by_iata[i]["lat"] for i in c["airports"]]
    y0, y1 = min(y0, *lats), max(y1, *lats)
    entry = {"iso2": iso2, "name": c["name"], "bounds": [[round(x0, 2), round(y0, 2)], [round(x1, 2), round(y1, 2)]],
             "airports": len(c["airports"]), "routes": c["routes"]}
    if iso2 in _G["capitals"]:
        name, lon, lat = _G["capitals"][iso2]
        entry["capital"] = {"name": name, "lon": round(lon, 3), "lat": round(lat, 3)}
    note = f"  {iso2} {c['name']}: {path.stat().st_size / 1024:.0f} KB, border={'land' if has_land_border else 'outline'} ({share:.0%} land)"
    return entry, note


def _area(iso2: str):
    geom = _G["raw"][iso2]
    if geom.geom_type == "MultiPolygon":
        parts = [g for g in geom.geoms if g.area >= MIN_ISLAND / 4] or list(geom.geoms)
        geom = MultiPolygon(parts)
    tol, decimals = _detail(_diagonal(geom))
    return iso2, _feature({"iso2": iso2}, geom.simplify(tol, preserve_topology=True), decimals)


if __name__ == "__main__":
    main()
