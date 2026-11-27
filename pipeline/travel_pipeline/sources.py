"""Loaders for the external data sources: OurAirports, Wikidata and Wikipedia."""

import csv
import io
import json
import re
import sqlite3
from dataclasses import dataclass
from urllib.parse import quote, unquote

from . import http
from .config import (CACHE_DIR, COUNTRY_NAMES, OURAIRPORTS_AIRPORTS_CSV, OURAIRPORTS_COUNTRIES_CSV,
                     WIKIDATA_SPARQL, WIKIPEDIA_API, WIKIPEDIA_PAGE)


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
    # "Western Sahara (disputed territory)" -> "Western Sahara"
    names = {r["code"]: re.sub(r"\s*\(.*\)$", "", r["name"]) for r in csv.DictReader(io.StringIO(text))}
    return names | COUNTRY_NAMES


# ------------------------------------------------------------------ Wikidata

def load_wikidata_iata_titles(refresh: bool = False) -> dict[str, dict[str, tuple[float, float] | None]]:
    """English Wikipedia article title -> IATA airport code(s), each with the article's (lat, lon) when known, from
    Wikidata property P238."""
    query = """
    SELECT ?iata ?article ?at WHERE {
      ?item wdt:P238 ?iata .
      ?article schema:about ?item ;
               schema:isPartOf <https://en.wikipedia.org/> .
      OPTIONAL { ?item wdt:P625 ?at . }
    }"""
    data = http.get_json(WIKIDATA_SPARQL, {"query": query, "format": "json"}, refresh=refresh)
    mapping: dict[str, dict[str, tuple[float, float] | None]] = {}
    for b in data["results"]["bindings"]:
        title = title_from_url(b["article"]["value"])
        iata = b["iata"]["value"].strip().upper()
        if title and len(iata) == 3:
            at = re.match(r"Point\(([-\d.]+) ([-\d.]+)\)", b.get("at", {}).get("value", ""))
            mapping.setdefault(title, {})[iata] = (float(at[2]), float(at[1])) if at else None
    return mapping


def load_capitals(refresh: bool = False) -> dict[str, tuple[str, float, float]]:
    """ISO 3166-1 alpha-2 code -> (capital, lon, lat), from Wikidata (P297 country code, P36 capital, P625
    coordinates), with the choices and additions in config."""
    from .config import CAPITAL_CHOICE, CAPITAL_EXTRA, NO_CAPITAL

    query = """
    SELECT ?iso ?capLabel ?at WHERE {
      ?country wdt:P297 ?iso ; wdt:P36 ?cap .
      ?cap wdt:P625 ?at .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }"""
    data = http.get_json(WIKIDATA_SPARQL, {"query": query, "format": "json"}, refresh=refresh)
    found: dict[str, dict[str, tuple[float, float]]] = {}
    for b in data["results"]["bindings"]:
        at = re.match(r"Point\(([-\d.]+) ([-\d.]+)\)", b["at"]["value"])
        if at:
            found.setdefault(b["iso"]["value"], {})[b["capLabel"]["value"]] = (float(at[1]), float(at[2]))
    out = {}
    for iso2, caps in found.items():
        name = CAPITAL_CHOICE.get(iso2) if len(caps) > 1 else next(iter(caps))
        if iso2 not in NO_CAPITAL and name in caps:
            out[iso2] = (name, *caps[name])
    return out | CAPITAL_EXTRA


# ----------------------------------------------------------------- Wikipedia

@dataclass
class WikiPage:
    requested: str
    title: str      # canonical title after following redirects
    revid: int
    html: str


def fetch_page(title: str, refresh: bool = False) -> WikiPage | None:
    # Pages fetched through the API by earlier runs are still good.
    old = None if refresh else http.cached(WIKIPEDIA_API, {
        "action": "parse", "page": title, "prop": "text|revid", "redirects": "1", "format": "json",
        "formatversion": "2", "disablelimitreport": "1", "disableeditsection": "1"}, ".json")
    if old:
        data = json.loads(old)
        if "error" in data:
            return None
        p = data["parse"]
        return WikiPage(requested=title, title=normalize_title(p["title"]), revid=p["revid"], html=p["text"])
    # The article itself, not the API: cached by Wikimedia, so it's quick and costs them little (robot policy).
    url = WIKIPEDIA_PAGE + quote(title.replace(" ", "_"), safe="/:(),'!*")
    p = json.loads(http.get_bytes(url, refresh=refresh, suffix=".json", keep=_keep_article))
    if not p:
        return None
    return WikiPage(requested=title, title=normalize_title(p["title"]), revid=p["revid"], html=p["html"])


def _keep_article(content: bytes | None) -> bytes:
    """The part of an article page we need, as JSON: its name, revision and content, in the layout the API gives."""
    from bs4 import BeautifulSoup, Comment

    if content is None:
        return b"null"
    page = content.decode("utf-8")
    soup = BeautifulSoup(page, "html.parser").select_one("#mw-content-text .mw-parser-output")
    if soup is None:
        return b"null"
    for el in soup.select(".mw-editsection, style, link, meta"):
        el.decompose()
    for el in soup.find_all(string=lambda t: isinstance(t, Comment)):
        el.extract()
    direct = set()                                   # articles linked by their own name, not through a redirect
    for el in soup.find_all(True):
        for name in ("data-mw", "about", "typeof", "rel"):
            el.attrs.pop(name, None)
        if el.name == "a":
            href, kind = el.get("href", ""), el.get("class") or []
            if "new" in kind:
                el["href"] = "/w/index.php?redlink=1"       # no such article
            elif "//en.wikipedia.org/wiki/" in href:
                el["href"] = "/wiki/" + href.split("//en.wikipedia.org/wiki/", 1)[1]
                target = title_from_url(el["href"])
                if target and "mw-redirect" not in kind and "?" not in href and ":" not in target:
                    direct.add(target)
    for el in soup.find_all("section"):
        el.unwrap()
    db = _redirect_db()
    db.executemany("INSERT OR IGNORE INTO redirects VALUES (?, ?)", [(t, t) for t in direct])
    db.commit()
    db.close()
    name = json.loads(re.search(r'"wgPageName":("(?:[^"\\]|\\.)*")', page).group(1))
    revid = int(re.search(r'"wgRevisionId":(\d+)', page).group(1))
    return json.dumps({"title": name, "revid": revid, "html": str(soup)}, ensure_ascii=False).encode()


def infobox_codes(title: str, refresh: bool = False) -> tuple[str | None, str | None]:
    """(IATA, ICAO) codes from an airport article's infobox."""
    from bs4 import BeautifulSoup

    page = fetch_page(title, refresh)
    if page is None:
        return None, None
    box = BeautifulSoup(page.html, "html.parser").select_one("table.infobox")
    text = box.get_text(" ", strip=True) if box else ""
    iata = re.search(r"\bIATA\s*:\s*([A-Z]{3})\b", text)
    icao = re.search(r"\bICAO\s*:\s*([A-Z]{4})\b", text)
    return (iata.group(1) if iata else None), (icao.group(1) if icao else None)


def _redirect_db() -> sqlite3.Connection:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(CACHE_DIR / "redirects.db", timeout=60)
    db.execute("CREATE TABLE IF NOT EXISTS redirects (title TEXT PRIMARY KEY, target TEXT)")
    return db


def resolve_redirects(titles: list[str], refresh: bool = False) -> dict[str, str | None]:
    """Map each title to its canonical article title (None if the page does not exist). Remembered per title, so
    covering more countries doesn't ask again."""
    unique = sorted(set(titles))
    db = _redirect_db()
    out: dict[str, str | None] = {}
    if not refresh:
        for t in unique:
            row = db.execute("SELECT target FROM redirects WHERE title = ?", (t,)).fetchone()
            if row:
                out[t] = row[0]
    todo = [t for t in unique if t not in out]
    for i in range(0, len(todo), 50):
        batch = todo[i:i + 50]
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
        db.executemany("INSERT OR REPLACE INTO redirects VALUES (?, ?)", [(t, out[t]) for t in batch])
        db.commit()
    db.close()
    return out
