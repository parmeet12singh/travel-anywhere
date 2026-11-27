"""Build data/airports.json and data/routes.json from Wikipedia airport articles.

Run from the pipeline/ directory:

    .venv/bin/python -m travel_pipeline.build            # uses the on-disk cache
    .venv/bin/python -m travel_pipeline.build --refresh  # re-download everything
"""

import argparse
import csv
import dataclasses
import json
import re
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from math import asin, cos, radians, sin, sqrt

from shapely import make_valid
from shapely.geometry import Point, shape
from shapely.ops import unary_union

from . import borders, http, sources
from .config import COVERED_COUNTRIES, DATA_DIR, LABEL_OVERRIDES, REQUIRE_BOTH_SIDES
from .parse_destinations import Destination, parse_airport_html

SKIP_TYPES = {"closed", "heliport", "balloonport"}
AIRPORT_WORDS = re.compile(r"airport|airfield|aerodrome|air base|air station|airstrip|heliport", re.I)


MAX_KM = 150     # an article about an airport can't be further than this from where OurAirports has it



def _is_airline(title: str, refresh: bool = False) -> bool:
    """Whether a Wikipedia article is about an airline: its infobox has the airline codes or fleet rows, or it is a
    company in the aviation industry (Blade Air Mobility)."""
    from bs4 import BeautifulSoup

    page = sources.fetch_page(title, refresh)
    box = BeautifulSoup(page.html, "html.parser").select_one("table.infobox") if page else None
    text = box.get_text(" ", strip=True) if box else ""
    return bool(re.search(r"\bIATA\b|\bICAO\b|Callsign|Fleet size|Hubs|Industry .{0,40}(Aviation|Airline)", text))

def _km(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, lo1, la2, lo2 = map(radians, (*a, *b))
    h = sin((la2 - la1) / 2) ** 2 + cos(la1) * cos(la2) * sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371 * asin(sqrt(h))


class TitleResolver:
    """Maps Wikipedia article titles to IATA codes using Wikidata + OurAirports."""

    def __init__(self, airports: dict[str, sources.Airport],
                 wikidata: dict[str, dict[str, tuple[float, float] | None]]):
        self.airports = airports
        self.by_title: dict[str, set[str]] = defaultdict(set)
        self.misplaced: list[str] = []      # for the report
        for title, codes in wikidata.items():
            for c, at in codes.items():
                if c not in airports:
                    continue
                # Some codes are wrong or reused: Seko (Indonesia) has the code of Sokoto (Nigeria).
                km = _km(at, (airports[c].lat, airports[c].lon)) if at else 0
                alike = title.split()[0] in airports[c].name       # same airport, imprecise coordinates
                if km > (10 * MAX_KM if alike else MAX_KM):
                    self.misplaced.append(f"{title} is not {c} ({airports[c].name}, {airports[c].country})")
                    continue
                self.by_title[title].add(c)
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
        if self.by_icao is None:
            self.by_icao = sources.load_ourairports_by_icao(self.refresh)
        here = self.by_icao.get(icao) if icao else None
        code = iata or icao               # a few small airports have no IATA code
        # The same code may belong to another airport (Anambra's CHE is a heliport in Tallinn): use the ICAO code.
        if here and code in self.airports and \
                _km((here.lat, here.lon), (self.airports[code].lat, self.airports[code].lon)) > MAX_KM:
            code = icao
        if code is None:
            return set()
        if code not in self.airports:
            if here is None:
                return set()
            self.airports[code] = dataclasses.replace(here, iata=code)
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


def inside_official_india(airports: dict[str, sources.Airport]) -> set[str]:
    """IATA codes of airports that other countries administer but that lie inside India's official boundary
    (Natural Earth, India point of view), e.g. Gilgit and Skardu. They're left out: listing them under another
    country would contradict the official borders the map draws."""
    src = json.loads(http.get_bytes(borders.SOURCE, suffix=".geojson"))["features"]
    india = unary_union([make_valid(shape(f["geometry"])) for f in src if borders._iso2(f["properties"]) == "IN"])
    x0, y0, x1, y1 = india.bounds
    return {c for c, ap in airports.items()
            if ap.country != "IN" and x0 <= ap.lon <= x1 and y0 <= ap.lat <= y1
            and india.contains(Point(ap.lon, ap.lat))}


def build(refresh: bool = False) -> None:
    today = date.today()
    print("Loading OurAirports + Wikidata reference data ...")
    airports = sources.load_ourairports(refresh)
    countries = sources.load_countries(refresh)
    resolver = TitleResolver(airports, sources.load_wikidata_iata_titles(refresh))
    resolver.refresh = refresh

    excluded = inside_official_india(airports)

    # Seed: every airport in the covered countries that OurAirports marks as having scheduled service.
    queue = sorted(ap.iata for ap in airports.values()
                   if ap.country in COVERED_COUNTRIES and ap.scheduled_service
                   and ap.type not in SKIP_TYPES and ap.iata not in excluded)
    seeded = set(queue)
    print(f"Seeded {len(queue)} airports with scheduled service: "
          + ", ".join(f"{c} {n}" for c, n in sorted(Counter(airports[i].country for i in queue).items())))

    visited: set[str] = set()
    pages: dict[str, dict] = {}            # origin IATA -> page info
    parsed: dict[str, list] = {}           # origin IATA -> AirlineRows
    issues = defaultdict(list)
    redirect_cache: dict[str, str | None] = {}

    # In rounds: every page in the queue, then all their redirects at once (the API takes 50 titles per request), then
    # the airports those pages led to.
    while queue:
        round_, queue = queue, []
        for iata in round_:
            if iata in visited:
                continue
            visited.add(iata)
            title = resolver.iata_to_title.get(iata)
            if not title:
                issues["origin_without_article"].append(iata)
                continue
            page = sources.fetch_page(title, refresh)
            if page is None:
                # OurAirports links sometimes have typos ("Internatioal"): try the title Wikidata has for this code.
                for other in sorted(t for t, codes in resolver.by_title.items() if iata in codes and t != title):
                    page = sources.fetch_page(other, refresh)
                    if page:
                        break
            if page is None:
                issues["origin_article_missing"].append(f"{iata} ({title})")
                continue
            result = parse_airport_html(page.html)
            if result.status in ("no_section", "no_table"):
                # The link may lead to a closed airport that had this code (Brive-Laroche): try the other article.
                for other in sorted(t for t, codes in resolver.by_title.items() if iata in codes and t != title):
                    page2 = sources.fetch_page(other, refresh)
                    if page2 and page2.title != page.title and (result2 := parse_airport_html(page2.html)).status == "ok":
                        page, result = page2, result2
                        break
            pages[iata] = {"title": page.title, "revid": page.revid, "status": result.status}
            for w in result.warnings:
                issues["parse_warnings"].append(f"{iata}: {w}")
            if result.status != "ok":
                issues[f"origin_{result.status}"].append(f"{iata} ({page.title})")
                continue
            parsed[iata] = result.rows
            print(f"  {iata} {page.title}: {sum(len(r.destinations) for r in result.rows)} listings")

        # Resolve destination links; queue newly discovered airports in the covered countries.
        rows = [r for iata in round_ for r in parsed.get(iata, [])]
        titles = {d.title for r in rows for d in r.destinations} - redirect_cache.keys()
        redirect_cache.update(sources.resolve_redirects(sorted(titles), refresh))
        for r in rows:
            for d in r.destinations:
                code = resolver.iata(redirect_cache.get(d.title) or d.title)
                if code and airports[code].country in COVERED_COUNTRIES and code not in visited \
                        and code not in queue and code not in excluded:
                    queue.append(code)

    # ------------------------------------------------------------- airlines
    # One name and one article per airline: tables link "Red Wings (airline)" (a redirect) or "Red Wings Airlines",
    # and write "Rossiya" or "Rossiya Airlines". Each link goes to its real article, shown under the name most
    # tables use for it.
    airline_links = sorted({r.airline_title for rows in parsed.values() for r in rows if r.airline_title})
    airline_article = {t: a for t, a in sources.resolve_redirects(airline_links, refresh).items() if a}
    # A redirect can lead somewhere else: [[Iberia]] is the Iberian Peninsula, small airlines go to "List of airlines
    # of Iran". Followed only to an airline's article; otherwise "Name (airline)" if that is one, or no link at all.
    known = set(airline_article.values())
    for link, article in list(airline_article.items()):
        if article != link and not _is_airline(article, refresh):
            better = f"{link} (airline)"
            airline_article[link] = better if better in known and _is_airline(better, refresh) else None
            issues["airline_links_dropped"].append(f"{link} -> {article}" + (f" (using {better})" if airline_article[link] else ""))
    airline_article = {t: a for t, a in airline_article.items() if a}
    airline_names: dict[str, Counter] = defaultdict(Counter)
    for rows in parsed.values():
        for r in rows:
            if r.airline_title in airline_article:
                airline_names[airline_article[r.airline_title]][r.airline] += 1
    airline_name = {t: names.most_common(1)[0][0] for t, names in airline_names.items()}

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
                if dest in excluded:
                    issues["excluded_destinations"].append(f"{origin}->{dest}")
                    continue
                if not d.prose:
                    labels[dest][d.label] += 1
                if dest == origin:
                    continue
                status = airline_status(d, today)
                if status == "ended":
                    ended.append(f"{origin}->{dest} {r.airline} ({d.note_text})")
                    continue
                wiki = airline_article.get(r.airline_title) if r.airline_title else None
                entry = {"airline": airline_name.get(wiki, r.airline), "airline_wiki": wiki,
                         "category": d.category, "status": status}
                if d.note:
                    entry["note"] = d.note
                    entry["note_date"] = d.note_date
                key = (wiki or r.airline, d.category)
                if all((e["airline_wiki"] or e["airline"], e["category"]) != key
                       for e in routes[(origin, dest)]):
                    routes[(origin, dest)].append(entry)

    # Airports whose article only has a list of former destinations have no flights today (Phnom Penh's old airport):
    # no routes, so they disappear from the data.
    closed = {i for i, p in pages.items() if p["status"] == "former"}
    for key in [k for k in routes if k[1] in closed]:
        issues["closed_destinations"].append(f"{key[0]}->{key[1]} ({', '.join(e['airline'] for e in routes[key])})")
        del routes[key]
    # Routes to check by hand: only one of the two tables lists them, or the destination has no table of its own.
    one_sided = [(o, d) for o, d in routes if d in parsed and (d, o) not in routes]
    unconfirmed = [(o, d) for o, d in routes if airports[d].country in COVERED_COUNTRIES and d not in parsed]
    to_verify = [(k, "only listed by the first airport") for k in one_sided] + \
                [(k, "second airport has no table") for k in unconfirmed]
    to_verify = [{"from": o, "from_city": display_label(labels.get(o), airports[o]), "from_country": airports[o].country,
                  "to": d, "to_city": display_label(labels.get(d), airports[d]), "to_country": airports[d].country,
                  "airlines": ", ".join(sorted({e["airline"] for e in routes[(o, d)]})), "why": why}
                 for (o, d), why in sorted(to_verify)]
    if REQUIRE_BOTH_SIDES:
        for key in one_sided:
            issues["one_sided_dropped"].append(f"{key[0]}->{key[1]}")
            del routes[key]

    route_list = []
    for (o, d), entries in sorted(routes.items()):
        statuses = {e["status"] for e in entries}
        status = next(s for s in ("active", "upcoming", "suspended") if s in statuses or s == "suspended")
        route_list.append({
            "origin": o, "dest": d,
            "domestic": airports[d].country == airports[o].country,
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
        "covered": sorted(COVERED_COUNTRIES),
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
    write_to_verify(to_verify)
    write_report(meta, issues, unresolved, ended, resolver, route_list, seeded, len(to_verify))
    print(json.dumps(meta["counts"], indent=2))


def display_label(counts: Counter | None, ap: sources.Airport) -> str:
    """The name travellers know an airport by: the label Wikipedia tables use most often for it."""
    if ap.iata in LABEL_OVERRIDES:
        return LABEL_OVERRIDES[ap.iata]
    if counts:
        best = max(counts.items(), key=lambda kv: (kv[1], -len(kv[0])))[0]
        if best:
            return re.sub(r" Airport$", "", best)
    city = re.sub(r"\s*\(.*?\)", "", ap.city or "").strip()
    return re.sub(r" Airport$", "", city or ap.name)


def write_json_lines(path, items: list[dict]) -> None:
    """A JSON array with one item per line: valid JSON, compact, and git-diff friendly."""
    body = ",\n".join(json.dumps(i, ensure_ascii=False, separators=(",", ":")) for i in items)
    path.write_text("[\n" + body + "\n]\n")


VERIFY_FIELDS = ["from", "from_city", "from_country", "to", "to_city", "to_country", "airlines", "why", "checked"]


def write_to_verify(rows: list[dict]) -> None:
    """Routes to check by hand. What you type in the last column ("checked") survives rebuilds."""
    path = DATA_DIR / "routes_to_verify.csv"
    notes = {}
    if path.exists():
        with path.open(newline="") as f:
            notes = {(r["from"], r["to"]): r["checked"] for r in csv.DictReader(f) if r.get("checked")}
    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, VERIFY_FIELDS, lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow({**r, "checked": notes.get((r["from"], r["to"]), "")})


def write_report(meta, issues, unresolved, ended, resolver, route_list, seeded, n_verify) -> None:
    c = meta["counts"]
    lines = [f"# Data build report — {meta['as_of']}", "",
             "Generated by `travel_pipeline.build`. Lists everything that needs a human look.", "",
             "## Summary", ""]
    lines += [f"- **{k.replace('_', ' ')}:** {v}" for k, v in c.items()]
    lines += ["", "## Origin airports with no usable destinations table", ""]
    for key in ("origin_no_section", "origin_no_table", "origin_former", "origin_article_missing", "origin_without_article"):
        if issues.get(key):
            lines.append(f"- **{key.replace('origin_', '').replace('_', ' ')}** ({len(issues[key])}): "
                         + ", ".join(sorted(issues[key])))
    discovered = sorted({r["origin"] for r in route_list} - seeded)
    if discovered:
        lines += ["", f"Airports found via other airports' tables (not flagged as scheduled "
                      f"in OurAirports): {', '.join(discovered)}"]

    lines += ["", "## Destination links that could not be matched to an airport", "",
              "| Linked article | Shown as | Times |", "|---|---|---|"]
    for (title, label), n in unresolved.most_common():
        lines.append(f"| {title} | {label} | {n} |")

    if resolver.from_infobox:
        lines += ["", "## Airports identified from their Wikipedia infobox (not in Wikidata/OurAirports by title)", ""]
        lines += [f"- {t} → {c}" for t, c in sorted(resolver.from_infobox.items())]

    if resolver.misplaced:
        lines += ["", "## Wikidata codes ignored: the article is about a place far from the airport with that code", ""]
        lines += [f"- {x}" for x in sorted(resolver.misplaced)]

    if issues["airline_links_dropped"]:
        lines += ["", "## Airline links that redirect to something other than an airline (link not used)", ""]
        lines += [f"- {x}" for x in sorted(issues["airline_links_dropped"])]

    if resolver.ambiguous:
        lines += ["", "## Articles mapped to more than one IATA code (first one used)", ""]
        lines += [f"- {t}: {', '.join(sorted(codes))}" for t, codes in sorted(resolver.ambiguous.items())]

    lines += ["", "## Routes to verify", "",
              f"{n_verify} routes are in `routes_to_verify.csv`: only one of the two articles lists them, or the second "
              "airport has no table."]
    if issues.get("one_sided_dropped"):
        lines += ["", f"Dropped because REQUIRE_BOTH_SIDES is on: {', '.join(sorted(issues['one_sided_dropped']))}"]
    if issues.get("closed_destinations"):
        lines += ["", "## Dropped: routes to airports whose article only lists former destinations", ""]
        lines += [f"- {x}" for x in sorted(issues["closed_destinations"])]
    if ended:
        lines += ["", f"## Dropped: listings whose end date has passed ({len(ended)})", ""]
        lines += [f"- {e}" for e in sorted(ended)]
    if issues.get("excluded_destinations"):
        lines += ["", "## Left out: airports inside India's official boundary administered by another country", "",
                  ", ".join(sorted(set(issues["excluded_destinations"])))]
    if issues.get("parse_warnings"):
        lines += ["", "## Parser warnings", ""] + [f"- {w}" for w in issues["parse_warnings"]]

    (DATA_DIR / "report.md").write_text("\n".join(lines) + "\n")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--refresh", action="store_true", help="ignore the cache and re-download")
    build(refresh=ap.parse_args().refresh)


if __name__ == "__main__":
    main()
