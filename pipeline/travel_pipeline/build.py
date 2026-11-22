"""Build data/airports.json and data/routes.json from Wikipedia airport articles.

Run from the pipeline/ directory:

    .venv/bin/python -m travel_pipeline.build            # uses the on-disk cache
    .venv/bin/python -m travel_pipeline.build --refresh  # re-download everything
"""

import argparse
import dataclasses
import json
import re
from collections import Counter, defaultdict
from datetime import date, datetime, timezone

from . import sources
from .config import DATA_DIR, HOME_COUNTRY
from .parse_destinations import Destination, parse_airport_html

SKIP_TYPES = {"closed", "heliport", "balloonport"}
AIRPORT_WORDS = re.compile(r"airport|airfield|aerodrome|air base|air station|airstrip|heliport", re.I)


class TitleResolver:
    """Maps Wikipedia article titles to IATA codes using Wikidata + OurAirports."""

    def __init__(self, airports: dict[str, sources.Airport], wikidata: dict[str, set[str]]):
        self.airports = airports
        self.by_title: dict[str, set[str]] = defaultdict(set)
        for title, codes in wikidata.items():
            self.by_title[title] |= {c for c in codes if c in airports}
        self.iata_to_title: dict[str, str] = {}
        for ap in airports.values():
            t = sources.title_from_url(ap.wikipedia_link) if ap.wikipedia_link else None
            if t:
                self.by_title[t].add(ap.iata)
                self.iata_to_title[ap.iata] = t
        for title, codes in self.by_title.items():
            for c in codes:
                self.iata_to_title.setdefault(c, title)
        self.ambiguous: dict[str, set[str]] = {}
        self.by_icao: dict[str, sources.Airport] | None = None
        self.from_infobox: dict[str, str] = {}     # title -> code, for the report
        self.refresh = False

    def _from_infobox(self, title: str) -> set[str]:
        """Fallback: read IATA/ICAO from the article's own infobox; coordinates from OurAirports by ICAO."""
        iata, icao = sources.infobox_codes(title, self.refresh)
        code = iata or icao               # a few small airports have no IATA code
        if code is None:
            return set()
        if code not in self.airports:
            if self.by_icao is None:
                self.by_icao = sources.load_ourairports_by_icao(self.refresh)
            ap = self.by_icao.get(icao) if icao else None
            if ap is None:
                return set()
            self.airports[code] = dataclasses.replace(ap, iata=code)
        self.by_title[title] = {code}
        self.iata_to_title.setdefault(code, title)
        self.from_infobox[title] = code
        return {code}

    def iata(self, title: str) -> str | None:
        codes = self.by_title.get(title, set())
        if not codes and AIRPORT_WORDS.search(title):
            codes = self._from_infobox(title)
        if len(codes) == 1:
            return next(iter(codes))
        if len(codes) > 1:
            # Prefer an open airport with scheduled service, then the bigger one.
            rank = {"large_airport": 0, "medium_airport": 1, "small_airport": 2}
            best = sorted(codes, key=lambda c: (not self.airports[c].scheduled_service,
                                                rank.get(self.airports[c].type, 5), c))
            self.ambiguous[title] = codes
            return best[0]
        return None


def airline_status(d: Destination, today: date) -> str:
    when = date.fromisoformat(d.note_date) if d.note_date else None
    if d.note is None:
        return "active"
    if d.note in ("begins", "resumes"):
        return "active" if when and when <= today else "upcoming"
    if d.note == "ends":
        return "ended" if when and when < today else "active"
    return "suspended"


def build(refresh: bool = False) -> None:
    today = date.today()
    print("Loading OurAirports + Wikidata reference data ...")
    airports = sources.load_ourairports(refresh)
    countries = sources.load_countries(refresh)
    resolver = TitleResolver(airports, sources.load_wikidata_iata_titles(refresh))
    resolver.refresh = refresh

    # Seed: every Indian airport OurAirports marks as having scheduled service.
    queue = sorted(ap.iata for ap in airports.values()
                   if ap.country == HOME_COUNTRY and ap.scheduled_service
                   and ap.type not in SKIP_TYPES)
    seeded = set(queue)
    print(f"Seeded {len(queue)} Indian airports with scheduled service")

    visited: set[str] = set()
    pages: dict[str, dict] = {}            # origin IATA -> page info
    parsed: dict[str, list] = {}           # origin IATA -> AirlineRows
    issues = defaultdict(list)
    redirect_cache: dict[str, str | None] = {}

    while queue:
        iata = queue.pop(0)
        if iata in visited:
            continue
        visited.add(iata)
        title = resolver.iata_to_title.get(iata)
        if not title:
            issues["origin_without_article"].append(iata)
            continue
        page = sources.fetch_page(title, refresh)
        if page is None:
            issues["origin_article_missing"].append(f"{iata} ({title})")
            continue
        result = parse_airport_html(page.html)
        pages[iata] = {"title": page.title, "revid": page.revid, "status": result.status}
        for w in result.warnings:
            issues["parse_warnings"].append(f"{iata}: {w}")
        if result.status != "ok":
            issues[f"origin_{result.status}"].append(f"{iata} ({page.title})")
            continue
        parsed[iata] = result.rows
        print(f"  {iata} {page.title}: {sum(len(r.destinations) for r in result.rows)} listings")

        # Resolve destination links; queue newly discovered Indian airports.
        titles = {d.title for r in result.rows for d in r.destinations} - redirect_cache.keys()
        redirect_cache.update(sources.resolve_redirects(sorted(titles), refresh))
        for r in result.rows:
            for d in r.destinations:
                code = resolver.iata(redirect_cache.get(d.title) or d.title)
                if code and airports[code].country == HOME_COUNTRY and code not in visited \
                        and code not in queue:
                    queue.append(code)

    # ------------------------------------------------------------- assemble routes
    routes: dict[tuple[str, str], list[dict]] = defaultdict(list)
    unresolved = Counter()
    labels: dict[str, Counter] = defaultdict(Counter)   # IATA -> how Wikipedia tables name it
    ended = []
    for origin, rows in parsed.items():
        for r in rows:
            for d in r.destinations:
                canonical = redirect_cache.get(d.title) or d.title
                dest = resolver.iata(canonical)
                if dest is None:
                    unresolved[(canonical, d.label)] += 1
                    issues["_unresolved_examples"].append(f"{origin}: {d.label} -> [[{canonical}]]")
                    continue
                labels[dest][d.label] += 1
                if dest == origin:
                    continue
                status = airline_status(d, today)
                if status == "ended":
                    ended.append(f"{origin}->{dest} {r.airline} ({d.note_text})")
                    continue
                entry = {"airline": r.airline, "airline_wiki": r.airline_title,
                         "category": d.category, "status": status}
                if d.note:
                    entry["note"] = d.note
                    entry["note_date"] = d.note_date
                key = (r.airline_title or r.airline, d.category)
                if all((e["airline_wiki"] or e["airline"], e["category"]) != key
                       for e in routes[(origin, dest)]):
                    routes[(origin, dest)].append(entry)

    route_list = []
    for (o, d), entries in sorted(routes.items()):
        statuses = {e["status"] for e in entries}
        status = next(s for s in ("active", "upcoming", "suspended") if s in statuses or s == "suspended")
        route_list.append({
            "origin": o, "dest": d,
            "domestic": airports[d].country == HOME_COUNTRY,
            "status": status,
            "seasonal_only": all("seasonal" in e["category"] for e in entries),
            "charter_only": all("charter" in e["category"] for e in entries),
            "airlines": sorted(entries, key=lambda e: e["airline"].lower()),
        })

    used = sorted({r["origin"] for r in route_list} | {r["dest"] for r in route_list})
    # IANA time zone from coordinates, so the site can show each airport's local time (DST included).
    from timezonefinder import TimezoneFinder
    tzf = TimezoneFinder()
    airport_list = [{
        "iata": c, "label": display_label(labels.get(c), airports[c]),
        "name": airports[c].name, "city": airports[c].city,
        "country": airports[c].country, "country_name": countries.get(airports[c].country, ""),
        "lat": round(airports[c].lat, 5), "lon": round(airports[c].lon, 5),
        "tz": tzf.timezone_at(lat=airports[c].lat, lng=airports[c].lon),
        "is_origin": c in parsed,
        "wiki": pages[c]["title"] if c in pages else resolver.iata_to_title.get(c),
    } for c in used]

    # ------------------------------------------------------------ write outputs
    DATA_DIR.mkdir(exist_ok=True)
    write_json_lines(DATA_DIR / "airports.json", airport_list)
    write_json_lines(DATA_DIR / "routes.json", route_list)

    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "as_of": today.isoformat(),
        "counts": {
            "origins_scraped": len(parsed),
            "airports": len(airport_list),
            "routes": len(route_list),
            "routes_active": sum(r["status"] == "active" for r in route_list),
            "routes_domestic": sum(r["domestic"] for r in route_list),
            "routes_international": sum(not r["domestic"] for r in route_list),
            "unresolved_destination_links": sum(unresolved.values()),
        },
        "source_pages": {k: {"title": v["title"], "revid": v["revid"]} for k, v in sorted(pages.items())},
    }
    (DATA_DIR / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n")
    write_report(meta, issues, unresolved, ended, resolver, route_list, seeded)
    print(json.dumps(meta["counts"], indent=2))


def display_label(counts: Counter | None, ap: sources.Airport) -> str:
    """The name travellers know an airport by: the label Wikipedia tables use most often for it."""
    if counts:
        best = max(counts.items(), key=lambda kv: (kv[1], -len(kv[0])))[0]
        if best:
            return best
    city = re.sub(r"\s*\(.*?\)", "", ap.city or "").strip()
    return city or ap.name


def write_json_lines(path, items: list[dict]) -> None:
    """A JSON array with one item per line: valid JSON, compact, and git-diff friendly."""
    body = ",\n".join(json.dumps(i, ensure_ascii=False, separators=(",", ":")) for i in items)
    path.write_text("[\n" + body + "\n]\n")


def write_report(meta, issues, unresolved, ended, resolver, route_list, seeded) -> None:
    c = meta["counts"]
    lines = [f"# Data build report — {meta['as_of']}", "",
             "Generated by `travel_pipeline.build`. Lists everything that needs a human look.", "",
             "## Summary", ""]
    lines += [f"- **{k.replace('_', ' ')}:** {v}" for k, v in c.items()]
    lines += ["", "## Origin airports with no usable destinations table", ""]
    for key in ("origin_no_section", "origin_no_table", "origin_article_missing", "origin_without_article"):
        if issues.get(key):
            lines.append(f"- **{key.replace('origin_', '').replace('_', ' ')}** ({len(issues[key])}): "
                         + ", ".join(sorted(issues[key])))
    discovered = sorted({r["origin"] for r in route_list} - seeded)
    if discovered:
        lines += ["", f"Indian airports found via other airports' tables (not flagged as scheduled "
                      f"in OurAirports): {', '.join(discovered)}"]

    lines += ["", "## Destination links that could not be matched to an airport", "",
              "| Linked article | Shown as | Times |", "|---|---|---|"]
    for (title, label), n in unresolved.most_common():
        lines.append(f"| {title} | {label} | {n} |")

    if resolver.from_infobox:
        lines += ["", "## Airports identified from their Wikipedia infobox (not in Wikidata/OurAirports by title)", ""]
        lines += [f"- {t} → {c}" for t, c in sorted(resolver.from_infobox.items())]

    if resolver.ambiguous:
        lines += ["", "## Articles mapped to more than one IATA code (first one used)", ""]
        lines += [f"- {t}: {', '.join(sorted(codes))}" for t, codes in sorted(resolver.ambiguous.items())]

    # Domestic routes listed only on one side.
    pairs = {(r["origin"], r["dest"]) for r in route_list}
    origins = {r["origin"] for r in route_list}
    one_sided = sorted(f"{o}->{d}" for o, d in pairs
                       if d in origins and (d, o) not in pairs)
    lines += ["", f"## Routes listed by only one of the two airports ({len(one_sided)})", "",
              "Either a new/ended route that only one page has caught up with, or a missing entry.", "",
              ", ".join(one_sided)]

    if ended:
        lines += ["", f"## Dropped: listings whose end date has passed ({len(ended)})", ""]
        lines += [f"- {e}" for e in sorted(ended)]
    if issues.get("parse_warnings"):
        lines += ["", "## Parser warnings", ""] + [f"- {w}" for w in issues["parse_warnings"]]

    (DATA_DIR / "report.md").write_text("\n".join(lines) + "\n")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--refresh", action="store_true", help="ignore the cache and re-download")
    build(refresh=ap.parse_args().refresh)


if __name__ == "__main__":
    main()
