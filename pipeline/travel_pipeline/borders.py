"""Borders for the map, as India officially shows them.

Source: Natural Earth (public domain).
- Countries: the "India point of view" admin-0 file. It shows all of Jammu & Kashmir and Ladakh (including
  Gilgit-Baltistan and Aksai Chin) and all of Arunachal Pradesh as part of India, with no disputed/dashed lines.
  Every other country's shape follows the same view, so e.g. Pakistan and China never cover Indian territory.
- States/provinces: the admin-1 file, trimmed to those country shapes. India's Jammu & Kashmir and Ladakh are
  rebuilt to match the official map (Natural Earth's admin-1 is de facto).

Writes:
- data/borders.geojson          every country's outline (thin grey lines under the map labels)
- data/countries.json           the countries you can pick on the site (those in our route data), with the area
                                to frame and how many airports/routes they have
- data/country-areas.geojson    filled shapes of those countries (invisible; for hover and click on the map)
- data/countries/<ISO2>.geojson for each of those: its land
                                border (highlighted; the full outline for island countries) and its state/province lines

Run from the pipeline/ directory (after travel_pipeline.build):
    .venv/bin/python -m travel_pipeline.borders
"""

import json

from shapely import make_valid
from shapely.geometry import MultiPolygon, Point, box, mapping, shape
from shapely.ops import linemerge, unary_union

from . import http
from .config import DATA_DIR

SOURCE = ("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
          "ne_10m_admin_0_countries_ind.geojson")
STATES_SOURCE = ("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
                 "ne_10m_admin_1_states_provinces.geojson")
TOLERANCE = 0.04   # degrees (~4 km): invisible at the zoom levels the map shows
DECIMALS = 2       # ~1 km
MIN_ISLAND = 0.02  # square degrees: drop smaller islands from the world outline, except India's
COUNTRY_DIR = DATA_DIR / "countries"


def _round(coords):
    if isinstance(coords[0], (int, float)):
        return [round(coords[0], DECIMALS), round(coords[1], DECIMALS)]
    return [_round(c) for c in coords]


def _feature(props: dict, geom) -> dict | None:
    if geom.is_empty:
        return None
    g = mapping(geom)
    return {"type": "Feature", "properties": props, "geometry": {"type": g["type"], "coordinates": _round(g["coordinates"])}}


def _iso2(p: dict) -> str:
    v = p.get("ISO_A2_EH")
    return v if v and v != "-99" else p.get("ISO_A2", "")


def _lines(geom):
    """Keep only line parts (intersections can also return stray points)."""
    if geom.geom_type in ("LineString", "MultiLineString"):
        return geom
    parts = [g for g in getattr(geom, "geoms", []) if g.geom_type in ("LineString", "MultiLineString")]
    return unary_union(parts) if parts else geom.boundary.intersection(geom)


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
    world = []
    for f in src:
        p = f["properties"]
        iso2 = _iso2(p)
        geom = make_valid(shape(f["geometry"]))
        if iso2:
            raw[iso2] = unary_union([raw[iso2], geom]) if iso2 in raw else geom
        light = geom
        if iso2 != "IN" and geom.geom_type == "MultiPolygon":
            parts = [g for g in geom.geoms if g.area >= MIN_ISLAND]
            light = MultiPolygon(parts) if parts else geom
        light = light.simplify(TOLERANCE if iso2 != "IN" else TOLERANCE / 2, preserve_topology=True)
        feat = _feature({"iso2": iso2}, light.boundary)
        if feat:
            world.append(feat)
    (DATA_DIR / "borders.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": world},
                                                         separators=(",", ":")))

    # The countries a visitor can pick: India plus every country with flights to India in our data.
    counts: dict[str, dict] = {}
    by_iata = {a["iata"]: a for a in airports}
    for r in routes:
        for code in (r["origin"], r["dest"]):
            a = by_iata[code]
            c = counts.setdefault(a["country"], {"name": a["country_name"], "airports": set(), "routes": 0})
            c["airports"].add(code)
        counts[by_iata[r["dest"]]["country"]]["routes"] += 1

    COUNTRY_DIR.mkdir(parents=True, exist_ok=True)
    index = []
    for iso2 in sorted(counts):
        geom = raw[iso2]
        # Land border = the parts of the outline that touch a neighbour. Island countries: the whole outline.
        near = [g for c, g in raw.items() if c != iso2 and g.envelope.intersects(geom.envelope.buffer(0.1))
                and g.distance(geom) < 0.05]
        # Detail scales with the country's size, like a printed map: Qatar fine, Russia coarse.
        main = max(geom.geoms, key=lambda g: g.area) if geom.geom_type == "MultiPolygon" and iso2 != "IN" else geom
        x0, y0, x1, y1 = main.bounds
        tol = min(0.08, max(0.01, ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5 * 0.0015))
        if iso2 == "IN":
            tol = 0.012  # home country: finer state lines
        land = _lines(geom.boundary.intersection(unary_union(near).buffer(0.01))) if near else None
        has_land_border = land is not None and not land.is_empty and land.length > 0.05
        border = (land if has_land_border else geom.boundary).simplify(tol)

        if iso2 == "IN":
            provinces = _official_indian_states(states_src, geom)
        else:
            provinces = [make_valid(shape(f["geometry"])).intersection(geom)
                         for f in states_src if f["properties"].get("iso_a2") == iso2]
        internal = unary_union([g.boundary for g in provinces if not g.is_empty]) if provinces else None
        if internal is not None and not internal.is_empty:
            # Joining the many short pieces back into continuous lines first lets simplification work.
            internal = _lines(internal.difference(geom.boundary.buffer(0.03)))
            internal = linemerge(internal) if internal.geom_type == "MultiLineString" else internal
            internal = internal.simplify(tol)

        feats = [f for f in (_feature({"kind": "border"}, border),
                             _feature({"kind": "provinces"}, internal) if internal is not None else None) if f]
        path = COUNTRY_DIR / f"{iso2}.geojson"
        path.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")))

        # Framing uses the main landmass (contiguous US, metropolitan France), not every far-off island.
        c = counts[iso2]
        index.append({"iso2": iso2, "name": c["name"], "bounds": [[round(x0, 2), round(y0, 2)], [round(x1, 2), round(y1, 2)]],
                      "airports": len(c["airports"]), "routes": c["routes"]})
        print(f"  {iso2} {c['name']}: {path.stat().st_size / 1024:.0f} KB, border={'land' if has_land_border else 'outline (island)'}")

    # Filled country shapes (simplified, official boundaries) for every country in the index: invisible on the
    # site, used to tell which country is under the cursor (hover preview, click to see routes between countries).
    areas = []
    for iso2 in sorted(counts):
        geom = raw[iso2]
        if geom.geom_type == "MultiPolygon":
            parts = [g for g in geom.geoms if g.area >= MIN_ISLAND / 4] or list(geom.geoms)
            geom = MultiPolygon(parts)
        x0, y0, x1, y1 = geom.bounds
        tol = min(0.08, max(0.01, ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5 * 0.0015))
        feat = _feature({"iso2": iso2}, geom.simplify(tol, preserve_topology=True))
        if feat:
            areas.append(feat)
    (DATA_DIR / "country-areas.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": areas}, separators=(",", ":")))
    print(f"country areas: {len(areas)} shapes, {(DATA_DIR / 'country-areas.geojson').stat().st_size / 1024:.0f} KB")

    index.sort(key=lambda c: (c["iso2"] != "IN", c["name"]))
    (DATA_DIR / "countries.json").write_text(json.dumps(index, indent=1, ensure_ascii=False) + "\n")
    size = sum(p.stat().st_size for p in COUNTRY_DIR.glob("*.geojson")) / 1024
    print(f"{len(index)} countries; world outline {(DATA_DIR / 'borders.geojson').stat().st_size / 1024:.0f} KB; "
          f"per-country files {size:.0f} KB in total (each loaded only when picked)")


if __name__ == "__main__":
    main()
