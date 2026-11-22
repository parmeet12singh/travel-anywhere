"""Parse the "Airlines and destinations" passenger table(s) of a Wikipedia airport article.

Wikipedia convention (WP:AIRPORT-CONTENT) for each row:

    | Airline | Dest A, Dest B (begins 1 May 2027), <b>Seasonal:</b> Dest C, Dest D (ends 2 Jan 2027)

* every destination is a link to the destination airport's article
* a bold label ("Seasonal:", "Charter:", "Seasonal charter:") applies to all destinations after it
* a parenthesised note right after a destination qualifies only that destination
"""

import re
from dataclasses import dataclass, field
from datetime import date, datetime

from bs4 import BeautifulSoup, NavigableString, Tag

from .sources import title_from_url

NOTE_RE = re.compile(
    r"\(\s*(begins|resumes|ends|terminates|suspended|suspends)\b\s*(?:on\s+)?([^)]*)\)", re.I)
DATE_FORMATS = ("%d %B %Y", "%B %d, %Y", "%B %d %Y", "%d %b %Y", "%B %Y")


@dataclass
class Destination:
    title: str                  # linked article title (may still be a redirect)
    label: str                  # text shown in the table, e.g. "Bangkok–Suvarnabhumi"
    category: str = "scheduled"  # scheduled | seasonal | charter | seasonal charter | ...
    note: str | None = None     # begins | resumes | ends | suspended
    note_date: str | None = None  # ISO date when parseable
    note_text: str | None = None  # raw note, kept for debugging


@dataclass
class AirlineRow:
    airline: str
    airline_title: str | None
    destinations: list[Destination] = field(default_factory=list)


@dataclass
class ParseResult:
    status: str                 # ok | no_section | no_table
    rows: list[AirlineRow] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def parse_date(text: str) -> str | None:
    text = re.sub(r"\s+", " ", text.replace(",", ", ")).strip(" .,")
    text = text.replace(" ,", ",")
    for fmt in DATE_FORMATS:
        try:
            d = datetime.strptime(text, fmt).date()
            if fmt == "%B %Y":
                d = date(d.year, d.month, 1)
            return d.isoformat()
        except ValueError:
            continue
    return None


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _is_article_link(a: Tag) -> bool:
    href = a.get("href", "")
    if not href.startswith("/wiki/"):
        return False
    name = href[len("/wiki/"):]
    return ":" not in name.split("#")[0]   # skip File:, Wikipedia:, Help: ...


def _section_tables(soup: BeautifulSoup) -> list[Tag] | None:
    """Passenger wikitables in the 'Airlines and destinations' section (cargo excluded)."""
    start = None
    for h in soup.find_all("h2"):
        if "airlines and destinations" in h.get_text(" ", strip=True).lower():
            start = h.parent if h.parent.name == "div" and "mw-heading" in (h.parent.get("class") or []) else h
            break
    if start is None:
        return None
    tables = []
    own = set(map(id, start.find_all()))     # find_all_next() also yields start's own children
    for el in start.find_all_next():
        if id(el) in own:
            continue
        classes = el.get("class") or []
        is_heading = el.name in ("h2", "h3", "h4") or (el.name == "div" and "mw-heading" in classes)
        if el.name == "h2" or (el.name == "div" and "mw-heading2" in classes):
            break
        if is_heading and "cargo" in el.get_text(" ", strip=True).lower():
            break
        if el.name == "table" and "wikitable" in classes:
            if el.find_parent("table") is None:
                tables.append(el)
    return tables


def _parse_destinations_cell(cell: Tag) -> list[Destination]:
    out: list[Destination] = []
    category = "scheduled"
    trailing: list[str] = []        # text that follows the most recent destination

    def flush_note():
        if not out or not trailing:
            return
        m = NOTE_RE.search(" ".join(trailing))
        if m:
            d = out[-1]
            kind = m.group(1).lower()
            d.note = {"terminates": "ends", "suspends": "suspended"}.get(kind, kind)
            d.note_text = _clean(m.group(0))
            d.note_date = parse_date(m.group(2)) if m.group(2).strip() else None

    def walk(node: Tag):
        nonlocal category, trailing
        for child in node.children:
            if isinstance(child, NavigableString):
                trailing.append(str(child))
                continue
            if not isinstance(child, Tag):
                continue
            if child.name in ("b", "strong"):
                label = _clean(child.get_text(" ")).rstrip(":").strip().lower()
                if label:
                    flush_note()
                    trailing = []
                    category = label
                continue
            if child.name == "a" and _is_article_link(child):
                flush_note()
                trailing = []
                title = title_from_url(child["href"])
                if title:
                    out.append(Destination(title=title, label=_clean(child.get_text(" ")),
                                           category=category))
                continue
            walk(child)

    walk(cell)
    flush_note()
    return out


def parse_airport_html(html: str) -> ParseResult:
    soup = BeautifulSoup(html, "html.parser")
    for sup in soup.select("sup"):          # citations, [citation needed], footnotes
        sup.decompose()

    tables = _section_tables(soup)
    if tables is None:
        return ParseResult(status="no_section")
    if not tables:
        return ParseResult(status="no_table")

    result = ParseResult(status="ok")
    for table in tables:
        trs = [tr for tr in table.find_all("tr") if tr.find_parent("table") is table]
        # Columns are found by header name: tables may add a "Refs." column or swap the order.
        airline_col, dest_col, ncols = 0, 1, 2
        for tr in trs:
            heads = [_clean(c.get_text(" ")).lower() for c in tr.find_all(["td", "th"], recursive=False)]
            if tr.find("th") and any("destination" in h for h in heads):
                dest_col = next(i for i, h in enumerate(heads) if "destination" in h)
                airline_col = next((i for i, h in enumerate(heads) if "airline" in h),
                                   0 if dest_col != 0 else 1)
                ncols = len(heads)
                break

        last_airline: AirlineRow | None = None
        for tr in trs:
            cells = tr.find_all(["td", "th"], recursive=False)
            if not cells:
                continue
            if all(c.name == "th" for c in cells) and \
                    any("destination" in c.get_text(" ", strip=True).lower() for c in cells):
                continue  # header row
            missing = ncols - len(cells)  # >0 when a rowspan cell from an earlier row covers columns
            if missing <= 0:
                airline_cell, dest_cell = cells[airline_col], cells[dest_col]
                link = next((a for a in airline_cell.find_all("a") if _is_article_link(a)), None)
                name = _clean(airline_cell.get_text(" "))
                last_airline = AirlineRow(
                    airline=_clean(link.get_text(" ")) if link else name,
                    airline_title=title_from_url(link["href"]) if link else None,
                )
                result.rows.append(last_airline)
            elif last_airline is not None and airline_col < dest_col and 0 <= dest_col - missing < len(cells):
                dest_cell = cells[dest_col - missing]   # airline cell spans several rows
            else:
                result.warnings.append(f"unparsed row: {_clean(tr.get_text(' '))[:80]}")
                continue
            last_airline.destinations.extend(_parse_destinations_cell(dest_cell))
    if not any(r.destinations for r in result.rows):
        result.status = "no_table"
    return result
