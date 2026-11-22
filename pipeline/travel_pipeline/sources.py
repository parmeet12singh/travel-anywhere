"""Loaders for the external data sources: OurAirports, Wikidata and Wikipedia."""

import csv
import io
from dataclasses import dataclass
from urllib.parse import unquote

from . import http
from .config import (OURAIRPORTS_AIRPORTS_CSV, OURAIRPORTS_COUNTRIES_CSV,
                     WIKIDATA_SPARQL, WIKIPEDIA_API)


def normalize_title(title: str) -> str:
    """Wikipedia titles: underscores and spaces are equivalent, first letter is case-insensitive."""
    title = unquote(title).replace("_", " ").strip()
    return title[:1].upper() + title[1:]


def title_from_url(url: str) -> str | None:
    if "/wiki/" not in url:
        return None
    return normalize_title(url.split("/wiki/", 1)[1].split("#", 1)[0])


# ---------------------------------------------------------------- OurAirports

@dataclass
class Airport:
    iata: str
    name: str
    city: str
    country: str          # ISO 3166-1 alpha-2
    lat: float
    lon: float
    type: str             # large_airport, medium_airport, ...
    scheduled_service: bool
    wikipedia_link: str


def load_ourairports(refresh: bool = False) -> dict[str, Airport]:
    """All airports that have an IATA code, keyed by IATA code."""
    text = http.get_text(OURAIRPORTS_AIRPORTS_CSV, refresh=refresh)
    rank = {"large_airport": 0, "medium_airport": 1, "small_airport": 2, "seaplane_base": 3,
            "heliport": 4, "closed": 9}
    airports: dict[str, Airport] = {}
    for row in csv.DictReader(io.StringIO(text)):
        iata = row["iata_code"].strip().upper()
        if len(iata) != 3:
            continue
        ap = Airport(
            iata=iata, name=row["name"], city=row["municipality"], country=row["iso_country"],
            lat=float(row["latitude_deg"]), lon=float(row["longitude_deg"]), type=row["type"],
            scheduled_service=row["scheduled_service"] == "yes",
            wikipedia_link=row["wikipedia_link"],
        )
        # A few IATA codes appear on more than one row (e.g. a closed + an open airport): keep the best.
        old = airports.get(iata)
        if old is None or rank.get(ap.type, 5) < rank.get(old.type, 5):
            airports[iata] = ap
    return airports


def load_ourairports_by_icao(refresh: bool = False) -> dict[str, Airport]:
    """All airports keyed by ICAO-style identifier (ident and gps_code), including ones with no IATA code."""
    text = http.get_text(OURAIRPORTS_AIRPORTS_CSV, refresh=refresh)
    out: dict[str, Airport] = {}
    for row in csv.DictReader(io.StringIO(text)):
        ap = Airport(
            iata=row["iata_code"].strip().upper(), name=row["name"], city=row["municipality"],
            country=row["iso_country"], lat=float(row["latitude_deg"]), lon=float(row["longitude_deg"]),
            type=row["type"], scheduled_service=row["scheduled_service"] == "yes",
            wikipedia_link=row["wikipedia_link"],
        )
        for key in (row["gps_code"], row["ident"]):
            if key and len(key) == 4:
                out.setdefault(key.upper(), ap)
    return out


def load_countries(refresh: bool = False) -> dict[str, str]:
    text = http.get_text(OURAIRPORTS_COUNTRIES_CSV, refresh=refresh)
    return {r["code"]: r["name"] for r in csv.DictReader(io.StringIO(text))}


# ------------------------------------------------------------------ Wikidata

def load_wikidata_iata_titles(refresh: bool = False) -> dict[str, set[str]]:
    """English Wikipedia article title -> IATA airport code(s), from Wikidata property P238."""
    query = """
    SELECT ?iata ?article WHERE {
      ?item wdt:P238 ?iata .
      ?article schema:about ?item ;
               schema:isPartOf <https://en.wikipedia.org/> .
    }"""
    data = http.get_json(WIKIDATA_SPARQL, {"query": query, "format": "json"}, refresh=refresh)
    mapping: dict[str, set[str]] = {}
    for b in data["results"]["bindings"]:
        title = title_from_url(b["article"]["value"])
        iata = b["iata"]["value"].strip().upper()
        if title and len(iata) == 3:
            mapping.setdefault(title, set()).add(iata)
    return mapping


# ----------------------------------------------------------------- Wikipedia

@dataclass
class WikiPage:
    requested: str
    title: str      # canonical title after following redirects
    revid: int
    html: str


def fetch_page(title: str, refresh: bool = False) -> WikiPage | None:
    params = {"action": "parse", "page": title, "prop": "text|revid", "redirects": "1",
              "format": "json", "formatversion": "2", "disablelimitreport": "1",
              "disableeditsection": "1"}
    data = http.get_json(WIKIPEDIA_API, params, refresh=refresh)
    if "error" in data:
        return None
    p = data["parse"]
    return WikiPage(requested=title, title=normalize_title(p["title"]), revid=p["revid"],
                    html=p["text"])


def infobox_codes(title: str, refresh: bool = False) -> tuple[str | None, str | None]:
    """(IATA, ICAO) codes from an airport article's infobox."""
    import re
    from bs4 import BeautifulSoup

    page = fetch_page(title, refresh)
    if page is None:
        return None, None
    box = BeautifulSoup(page.html, "html.parser").select_one("table.infobox")
    text = box.get_text(" ", strip=True) if box else ""
    iata = re.search(r"\bIATA\s*:\s*([A-Z]{3})\b", text)
    icao = re.search(r"\bICAO\s*:\s*([A-Z]{4})\b", text)
    return (iata.group(1) if iata else None), (icao.group(1) if icao else None)


def resolve_redirects(titles: list[str], refresh: bool = False) -> dict[str, str | None]:
    """Map each title to its canonical article title (None if the page does not exist)."""
    out: dict[str, str | None] = {}
    unique = sorted(set(titles))
    for i in range(0, len(unique), 50):
        batch = unique[i:i + 50]
        params = {"action": "query", "titles": "|".join(batch), "redirects": "1",
                  "format": "json", "formatversion": "2"}
        q = http.get_json(WIKIPEDIA_API, params, refresh=refresh)["query"]
        step = {}
        for n in q.get("normalized", []):
            step[n["from"]] = n["to"]
        redirects = {r["from"]: r["to"] for r in q.get("redirects", [])}
        missing = {p["title"] for p in q.get("pages", []) if p.get("missing") or p.get("invalid")}
        for t in batch:
            cur = step.get(t, t)
            seen = set()
            while cur in redirects and cur not in seen:
                seen.add(cur)
                cur = redirects[cur]
            out[t] = None if cur in missing else normalize_title(cur)
    return out
