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
from urllib.parse import unquote

from bs4 import BeautifulSoup

from . import http, sources
from .config import DATA_DIR, PIPELINE_DIR, WIKIPEDIA_API

LOGO_DIR = DATA_DIR / "logos"
OVERRIDES = PIPELINE_DIR / "logo_overrides.json"   # airline's own logo, when Wikipedia has none
IMAGE_EXT = re.compile(r"\.(svg|png)$", re.I)          # photos (.jpg) are aircraft, not logos
PHOTO_HINT = re.compile(r"airbus|boeing|embraer|atr[ _-]?\d|bombardier|\bA3\d\d|\b7[0-9]7\b|_VT-|aircraft", re.I)


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


def file_info(file_title: str) -> dict | None:
    params = {"action": "query", "titles": file_title, "prop": "imageinfo", "iiprop": "url|mime|extmetadata",
              "format": "json", "formatversion": "2"}
    pages = http.get_json(WIKIPEDIA_API, params)["query"]["pages"]
    info = (pages[0].get("imageinfo") or [None])[0] if pages else None
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
    for title, name in sorted(airlines.items()):
        entry = {"name": name, "website": infobox_website(title)}
        out[title] = entry
        file_title = infobox_logo_file(title)
        info = file_info(file_title) if file_title else None
        if (not info or not IMAGE_EXT.search(info["url"])) and title in overrides:
            o = overrides[title]
            info = {"url": o["url"], "license": "Trademark (airline's website)", "non_free": True}
            file_title = o["source"]
        if not info or not IMAGE_EXT.search(info["url"]):
            missing.append(title)
            continue
        ext = ".svg" if info["url"].lower().endswith(".svg") else ".png"
        dest = LOGO_DIR / f"{slug(title)}{ext}"
        try:
            dest.write_bytes(http.get_bytes(info["url"], suffix=ext))
        except Exception as exc:  # one stubborn file shouldn't stop the rest; re-running retries it
            print(f"  {name}: download failed ({exc})", flush=True)
            missing.append(title)
            continue
        entry.update({"logo": f"logos/{dest.name}", "file": file_title,
                      "license": info["license"], "non_free": info["non_free"]})
        print(f"  {name}: {dest.name} ({info['license'] or 'licence unknown'})")

    (DATA_DIR / "airlines.json").write_text(json.dumps(out, indent=1, ensure_ascii=False, sort_keys=True) + "\n")
    with_logo = [v for v in out.values() if v.get("logo")]
    vector = sum(v["logo"].endswith(".svg") for v in with_logo)
    websites = sum(1 for v in out.values() if v["website"])
    print(f"\n{len(with_logo)} logos ({vector} SVG, {len(with_logo) - vector} PNG), {websites} websites; "
          f"no logo for {len(missing)}: " + ", ".join(missing))


if __name__ == "__main__":
    main()
