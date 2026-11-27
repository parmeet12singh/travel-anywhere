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
    prose: bool = False         # from a sentence: the label is an article name, not how travellers call the place


@dataclass
class AirlineRow:
    airline: str
    airline_title: str | None
    destinations: list[Destination] = field(default_factory=list)


@dataclass
class ParseResult:
    status: str                 # ok | no_section | no_table | former (only lists past destinations)
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


# "Airlines and destinations", also "Airline and destination" and "Airlines and helicopter destinations"; at h2, or at
# h3 under e.g. "Operations".
SECTION_RE = re.compile(r"\bairlines? and (?:\w+ )?destinations?\b", re.I)
# Not flights you can take today ("Former airlines and destinations" at an airport that closed).
NOT_CURRENT_RE = re.compile(r"\b(former(ly)?|previous(ly)?|past|historic(al|ally)?|defunct|terminated|discontinued|ceased|"
                            r"future|planned|proposed|potential)\b", re.I)
# Tables inside the section that aren't route lists: passenger statistics, or past airlines with the years they flew.
NOT_ROUTES_RE = re.compile(r"\b(rank|passengers?|years? served|period)\b", re.I)


def _heading_level(el: Tag) -> int | None:
    if el.name in ("h2", "h3", "h4"):
        return int(el.name[1])
    for c in (el.get("class") or []) if el.name == "div" else []:
        if c in ("mw-heading2", "mw-heading3", "mw-heading4"):
            return int(c[-1])
    return None


def _section_start(soup: BeautifulSoup) -> Tag | None:
    for name in ("h2", "h3"):
        for h in soup.find_all(name):
            text = h.get_text(" ", strip=True)
            if SECTION_RE.search(text) and not NOT_CURRENT_RE.search(text) and "cargo" not in text.lower():
                return h.parent if h.parent.name == "div" and "mw-heading" in (h.parent.get("class") or []) else h
    return None


def _section_tables(soup: BeautifulSoup) -> list[Tag] | None:
    """Passenger wikitables in the 'Airlines and destinations' section (cargo and former routes excluded)."""
    start = _section_start(soup)
    if start is None:
        return None
    level = _heading_level(start)
    tables = []
    skipping = False                         # inside a "Former destinations" subsection
    own = set(map(id, start.find_all()))     # find_all_next() also yields start's own children
    for el in start.find_all_next():
        if id(el) in own:
            continue
        lv = _heading_level(el)
        if lv is not None:
            text = el.get_text(" ", strip=True)
            # "Passenger" belongs to the section even when its heading has the wrong level (Poznań).
            if lv <= level and not re.fullmatch(r"passengers?( flights| airlines)?", text, re.I):
                break
            if "cargo" in text.lower():
                break
            skipping = bool(NOT_CURRENT_RE.search(text))
        if el.name == "table" and "wikitable" in (el.get("class") or []) and not skipping:
            if el.find_parent("table") is None and not _other_table(el):
                tables.append(el)
    return tables


def _other_table(table: Tag) -> bool:
    """Not today's passenger routes: statistics, past airlines, or a table under a bold "Cargo" / "Former" label."""
    first = table.find("tr")
    if first and any(NOT_ROUTES_RE.search(c.get_text(" ")) for c in first.find_all("th")):
        return True
    lead = table.find_previous_sibling()
    while lead is not None and lead.name in ("style", "link", "meta"):
        lead = lead.find_previous_sibling()
    text = _clean(lead.get_text(" ")) if lead is not None and lead.name in ("p", "dl", "b") else ""
    return len(text) < 40 and bool(re.search(r"\bcargo\b", text, re.I) or NOT_CURRENT_RE.search(text))


def _only_former(soup: BeautifulSoup) -> bool:
    """The article lists destinations, but only under a heading like "Former airlines and destinations"."""
    return any("destination" in (t := h.get_text(" ", strip=True)).lower() and NOT_CURRENT_RE.search(t)
               and not re.search(r"future|planned|proposed|potential", t, re.I) for h in soup.find_all("h2"))


def category_of(label: str) -> str:
    """One of the four kinds the site knows, whatever the table's bold label says: "Seasonal charters",
    "Mining charter", "Hajj & Umrah" (charters for pilgrims) and typos like "Seasonal cherter" included."""
    label = label.lower()
    seasonal = "season" in label
    charter = bool(re.search(r"ch[ae]rter|hajj|umrah", label))
    return "seasonal charter" if seasonal and charter else "seasonal" if seasonal else "charter" if charter else "scheduled"


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
                    category = category_of(label)
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


# --------------------------------------------------------------- routes described in a sentence
# Small airports (most of Oceania's) often have a sentence instead of a table. Only these present-tense patterns are
# read, and only when nothing but airport links, commas and "and" is left in the list, so history ("flew ... until
# 2022") and remarks never become routes:
#   "Air Tahiti connects Ahe Airport to A, B and C."          "Air Tahiti serves A and B from Anaa Airport."
#   "Labasa Airport is connected to A by X and Y, and to B by X."
TOKEN = "\u27e6%d\u27e7"
TOKEN_RE = re.compile("\u27e6(\\d+)\u27e7")
CONNECTS_RE = re.compile("^(?P<al>.+?) (?:connects?|links?) (?P<x>[^\u27e6]+?) (?:to|with) (?P<d>\u27e6.*)$")
SERVES_RE = re.compile("^(?P<al>.+?) serves? (?P<d>\u27e6.*?) from (?P<x>[^\u27e6]+)$")
CONNECTED_RE = re.compile("^(?P<x>[^\u27e6]+?) is (?:connected|linked) (?:to|with) (?P<rest>\u27e6.*)$")
CONNECTED_PART_RE = re.compile(r"(?P<d>\u27e6.+?) by (?P<al>.+?)(?:,? and (?:to|with) (?=\u27e6)|,? (?:to|with) (?=\u27e6)|$)")


def _parse_prose(soup: BeautifulSoup) -> ParseResult:
    start = _section_start(soup)
    result = ParseResult(status="ok")
    airlines: dict[str, str | None] = {}                      # name -> article, for names linked only once
    level = _heading_level(start)
    for el in start.find_next_siblings():
        lv = _heading_level(el)
        if lv is not None and lv <= level:
            break
        if el.name != "p":
            continue
        links: list[tuple[str, str]] = []
        for a in el.find_all("a"):
            if _is_article_link(a):
                links.append((_clean(a.get_text(" ")), title_from_url(a["href"])))
                a.replace_with(TOKEN % (len(links) - 1))
            elif "new" in (a.get("class") or []):
                a.decompose()                                 # no such article, so no known airport
        text = re.sub(r"\s*\([^)]*\)", "", _clean(el.get_text(" ")))
        text = re.sub(r"\s+([,.;])", r"\1", text)
        for sentence in re.split(r"(?<=[.])\s+", text):
            for al, dests in _prose_groups(sentence.rstrip(". ")):
                names = _prose_airlines(al, links, airlines)
                if names is None:
                    result.warnings.append(f"sentence not understood: {_show(sentence, links)[:150]}")
                    continue
                for name in names:
                    row = AirlineRow(airline=name, airline_title=airlines.get(name))
                    for i in TOKEN_RE.findall(dests):
                        row.destinations.append(Destination(label=links[int(i)][0], title=links[int(i)][1],
                                                            prose=True))
                    result.rows.append(row)
    if not result.rows:
        result.status = "no_table"
    return result


def _prose_groups(sentence: str) -> list[tuple[str, str]]:
    """(airlines text, destinations text) pairs in one sentence; empty when it isn't one of the known patterns."""
    only_list = lambda d: not re.sub(r"\bin [A-Z]\w+(?: [A-Z]\w+)?|\b(and|both|atoll|island)\b|[,&]", "", TOKEN_RE.sub("", d)).strip()
    if m := CONNECTED_RE.match(sentence):
        parts = [(x["al"], x["d"]) for x in CONNECTED_PART_RE.finditer(m["rest"])]
    elif m := CONNECTS_RE.match(sentence) or SERVES_RE.match(sentence):
        parts = [(m["al"], m["d"])]
    else:
        return []
    return parts if parts and all(only_list(d) for _, d in parts) else []


def _prose_airlines(text: str, links, airlines: dict[str, str | None]) -> list[str] | None:
    names = []
    for part in re.split(r",\s*(?:and\s+)?|\s+and\s+", text.strip(" ,")):
        part = re.sub(r"^by ", "", part.strip())
        if m := TOKEN_RE.fullmatch(part):
            name, title = links[int(m.group(1))]
            airlines[name] = title
        elif part in airlines:                                # "... and to Nadi by Fiji Link" (linked earlier)
            name = part
        elif re.fullmatch(r"[A-Z][\w'&.-]*(?: [A-Z0-9][\w'&.-]*){0,4}", part) and not TOKEN_RE.search(part):
            name = part
            airlines.setdefault(name, None)
        else:
            return None
        names.append(name)
    return names or None


def _show(sentence: str, links) -> str:
    return TOKEN_RE.sub(lambda m: links[int(m.group(1))][0], sentence)


def parse_airport_html(html: str) -> ParseResult:
    soup = BeautifulSoup(html, "html.parser")
    for sup in soup.select("sup"):          # citations, [citation needed], footnotes
        sup.decompose()

    tables = _section_tables(soup)
    if tables is None:
        return ParseResult(status="former" if _only_former(soup) else "no_section")
    if not tables:
        return _parse_prose(soup)

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
                # "Guyane Express Fly [ fr ]": the marker is a link to another language's article.
                name = re.sub(r"\s*\[\s*[a-z]{2,3}\s*\]", "", _clean(airline_cell.get_text(" ")))
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
