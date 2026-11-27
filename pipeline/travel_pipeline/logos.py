"""Download each airline's logo from the infobox of its Wikipedia article.

Writes data/logos/<slug>.svg|png and data/airlines.json:
    {"IndiGo": {"name": "IndiGo", "website": "https://www.goindigo.in", "logo": "logos/indigo.svg",
                "file": "File:IndiGo.svg", "license": "Public domain", "non_free": false}, ...}
The website comes from the same infobox ("Website" row). Airlines with no logo still get their website.

Logos are trademarks of their airlines. Many are "non-free" files on English Wikipedia (used there under fair
use); `non_free` records that so the site owner can decide how to use them.

Run from the pipeline/ directory after `travel_pipeline.build`:
    .venv/bin/python -m travel_pipeline.logos
"""

import json
import re
import sqlite3
from urllib.parse import unquote

from bs4 import BeautifulSoup

from . import http, sources
from .config import CACHE_DIR, DATA_DIR, PIPELINE_DIR, WIKIPEDIA_API

LOGO_DIR = DATA_DIR / "logos"
OVERRIDES = PIPELINE_DIR / "logo_overrides.json"   # airline's own logo, when Wikipedia has none
IMAGE_EXT = re.compile(r"\.(svg|png)$", re.I)          # photos (.jpg) are aircraft, not logos
PHOTO_HINT = re.compile(r"airbus|boeing|embraer|atr[ _-]?\d|bombardier|\bA3\d\d|\b7[0-9]7\b|_VT-|aircraft|"
                        r"ARJ ?21|\bC9[12]9|comac|\bCRJ|dash[ _-]?8|\bQ400|\bMA60|superjet|sukhoi|tupolev|antonov|"
                        r"ilyushin|cessna|twin otter|islander|\bE1[79]5|\bE190|"
                        r"\bmap\b|route ?map|\boperations?\b", re.I)   # maps of where the airline flies


def slug(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")


def infobox(title: str):
    page = sources.fetch_page(title)
    return BeautifulSoup(page.html, "html.parser").select_one("table.infobox") if page else None


def infobox_website(title: str) -> str | None:
    box = infobox(title)
    if box is None:
        return None
    for tr in box.select("tr"):
        th = tr.find("th")
        if th and th.get_text(" ", strip=True).lower() == "website":
            link = tr.select_one("td a.external[href^='http']")
            if link:
                return link["href"]
    return None


def infobox_logo_file(title: str) -> str | None:
    """The first SVG/PNG in the infobox that isn't an aircraft photo, as 'File:Name.ext'."""
    box = infobox(title)
    if box is None:
        return None
    candidates = []
    for a in box.select('a[href^="/wiki/File:"]'):
        name = unquote(a["href"][len("/wiki/"):]).replace("_", " ")
        if IMAGE_EXT.search(name) and not PHOTO_HINT.search(name):
            candidates.append(name)
    # Prefer a vector logo when the infobox has both.
    svg = [c for c in candidates if c.lower().endswith(".svg")]
    return (svg or candidates or [None])[0]


def _file_db() -> sqlite3.Connection:
    db = sqlite3.connect(CACHE_DIR / "files.db", timeout=60)
    db.execute("CREATE TABLE IF NOT EXISTS files (title TEXT PRIMARY KEY, info TEXT)")
    return db


def file_infos(titles: list[str]) -> dict[str, dict | None]:
    """Address, type and licence of image files, asked 50 at a time and remembered."""
    fixed = {"action": "query", "prop": "imageinfo", "iiprop": "url|mime|extmetadata", "format": "json",
             "formatversion": "2"}
    db, pages = _file_db(), {}
    todo = []
    for t in sorted(set(titles)):
        row = db.execute("SELECT info FROM files WHERE title = ?", (t,)).fetchone()
        old = None if row else http.cached(WIKIPEDIA_API, {**fixed, "titles": t}, ".json")
        if row:
            pages[t] = json.loads(row[0])
        elif old:
            pages[t] = (json.loads(old)["query"]["pages"] or [{}])[0]
        else:
            todo.append(t)
    for i in range(0, len(todo), 50):
        batch = todo[i:i + 50]
        q = http.get_json(WIKIPEDIA_API, {**fixed, "titles": "|".join(batch)})["query"]
        renamed = {n["from"]: n["to"] for n in q.get("normalized", [])}
        found = {p["title"]: p for p in q["pages"]}
        for t in batch:
            pages[t] = found.get(renamed.get(t, t), {})
            db.execute("INSERT OR REPLACE INTO files VALUES (?, ?)", (t, json.dumps(pages[t])))
        db.commit()
    db.close()
    return {t: _file_info(p) for t, p in pages.items()}


def _file_info(page: dict) -> dict | None:
    info = (page.get("imageinfo") or [None])[0]
    if not info:
        return None
    meta = info.get("extmetadata", {})
    licence = meta.get("LicenseShortName", {}).get("value", "")
    return {
        "url": info["url"].split("?", 1)[0],  # drop Wikimedia's utm_* tracking parameters
        "mime": info.get("mime", ""),
        "license": re.sub(r"<[^>]+>", "", licence).strip(),
        "non_free": meta.get("NonFree", {}).get("value", "").lower() == "true" or "fair use" in licence.lower(),
    }


# Logos are shown on tiles of at most 80 x 36 CSS pixels: three times that stays sharp on any screen.
MAX_SIZE = (240, 108)


def shrink(content: bytes, ext: str) -> tuple[bytes, str]:
    """A raster logo scaled down to the size the site shows it at, as PNG (some originals are several MB: Tian Jiao
    Airlines' is 11.5 MB for a 56-pixel tile). SVGs are returned as they are."""
    if ext == ".svg":
        return content, ext
    import io
    from PIL import Image

    image = Image.open(io.BytesIO(content))
    image.seek(0)                                   # first frame of an animated GIF
    image = image.convert("RGBA")
    image.thumbnail(MAX_SIZE, Image.LANCZOS)        # only ever shrinks, keeps the proportions
    out = io.BytesIO()
    image.save(out, "PNG", optimize=True)
    # Already small enough as it was: keep the original bytes (no re-encoding).
    return (content, ext) if ext == ".png" and len(content) <= out.tell() else (out.getvalue(), ".png")


def main() -> None:
    routes = json.loads((DATA_DIR / "routes.json").read_text())
    airlines: dict[str, str] = {}
    for r in routes:
        for a in r["airlines"]:
            if a["airline_wiki"]:
                airlines.setdefault(a["airline_wiki"], a["airline"])

    LOGO_DIR.mkdir(parents=True, exist_ok=True)
    overrides = {k: v for k, v in json.loads(OVERRIDES.read_text()).items() if not k.startswith("_")} \
        if OVERRIDES.exists() else {}
    out, missing = {}, []
    files = {t: infobox_logo_file(t) for t in sorted(airlines)}
    infos = file_infos([f for f in files.values() if f])
    for title, name in sorted(airlines.items()):
        entry = {"name": name, "website": infobox_website(title)}
        out[title] = entry
        file_title = files[title]
        info = infos.get(file_title) if file_title else None
        if (not info or not IMAGE_EXT.search(info["url"])) and title in overrides:
            o = overrides[title]
            info = {"url": o["url"], "license": o.get("license", "Trademark (airline's website)"), "non_free": True,
                    "override": True}
            file_title = o["source"]
        if not info or not (IMAGE_EXT.search(info["url"]) or info.get("override")):
            missing.append(title)
            continue
        ext = (re.search(r"\.(svg|png|gif|jpe?g|webp)$", info["url"].lower()) or [".png"])[0]
        try:
            content, ext = shrink(http.get_bytes(info["url"], suffix=ext), ext)
            dest = LOGO_DIR / f"{slug(title)}{ext}"
            for old in LOGO_DIR.glob(f"{slug(title)}.*"):   # an earlier copy in another format
                if old != dest:
                    old.unlink()
            dest.write_bytes(content)
        except Exception as exc:  # one stubborn file shouldn't stop the rest; re-running retries it
            print(f"  {name}: download failed ({exc})", flush=True)
            missing.append(title)
            continue
        entry.update({"logo": f"logos/{dest.name}", "file": file_title,
                      "license": info["license"], "non_free": info["non_free"]})
        print(f"  {name}: {dest.name} ({info['license'] or 'licence unknown'})")

    # Files no airline points to any more (an airline's earlier name, a corrected link) are leftovers.
    kept = {v["logo"].split("/")[-1] for v in out.values() if v.get("logo")}
    for f in LOGO_DIR.iterdir():
        if f.is_file() and f.name not in kept:
            f.unlink()
    (DATA_DIR / "airlines.json").write_text(json.dumps(out, indent=1, ensure_ascii=False, sort_keys=True) + "\n")
    with_logo = [v for v in out.values() if v.get("logo")]
    vector = sum(v["logo"].endswith(".svg") for v in with_logo)
    websites = sum(1 for v in out.values() if v["website"])
    print(f"\n{len(with_logo)} logos ({vector} SVG, {len(with_logo) - vector} PNG), {websites} websites; "
          f"no logo for {len(missing)}: " + ", ".join(missing))


if __name__ == "__main__":
    main()
