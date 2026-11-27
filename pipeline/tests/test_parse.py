from travel_pipeline.parse_destinations import parse_airport_html, parse_date


def page(rows: str, extra: str = "") -> str:
    return f"""
    <div class="mw-heading mw-heading2"><h2 id="Airlines_and_destinations">Airlines and destinations</h2></div>
    <div class="mw-heading mw-heading3"><h3>Passenger</h3></div>
    <table class="wikitable sortable"><tr><th>Airlines</th><th>Destinations</th></tr>{rows}</table>
    {extra}
    <div class="mw-heading mw-heading2"><h2>Statistics</h2></div>"""


def test_basic_row_with_citations():
    r = parse_airport_html(page(
        '<tr><td><a href="/wiki/IndiGo">IndiGo</a></td><td>'
        '<a href="/wiki/Kempegowda_International_Airport">Bengaluru</a>,<sup class="reference">[1]</sup> '
        '<a href="/wiki/Indira_Gandhi_International_Airport">Delhi</a></td></tr>'))
    assert r.status == "ok"
    row = r.rows[0]
    assert row.airline == "IndiGo" and row.airline_title == "IndiGo"
    assert [d.title for d in row.destinations] == [
        "Kempegowda International Airport", "Indira Gandhi International Airport"]
    assert all(d.category == "scheduled" and d.note is None for d in row.destinations)


def test_seasonal_label_and_notes():
    r = parse_airport_html(page(
        '<tr><td><a href="/wiki/Air_Canada">Air Canada</a></td><td>'
        '<a href="/wiki/Toronto%E2%80%93Pearson">Toronto–Pearson</a> (begins 26 October 2026)<br/>'
        '<b>Seasonal:</b> <a href="/wiki/Montr%C3%A9al%E2%80%93Trudeau">Montréal–Trudeau</a>, '
        '<a href="/wiki/Vancouver_International_Airport">Vancouver</a> (ends 2 January 2027)</td></tr>'))
    d = r.rows[0].destinations
    assert d[0].title == "Toronto–Pearson" and d[0].note == "begins" and d[0].note_date == "2026-10-26"
    assert d[0].category == "scheduled"
    assert d[1].title == "Montréal–Trudeau" and d[1].category == "seasonal" and d[1].note is None
    assert d[2].category == "seasonal" and d[2].note == "ends" and d[2].note_date == "2027-01-02"


def test_cargo_table_excluded_and_rowspan():
    cargo = ('<div class="mw-heading mw-heading3"><h3>Cargo</h3></div>'
             '<table class="wikitable"><tr><td><a href="/wiki/Blue_Dart_Aviation">Blue Dart</a></td>'
             '<td><a href="/wiki/Chennai_International_Airport">Chennai</a></td></tr></table>')
    r = parse_airport_html(page(
        '<tr><td rowspan="2"><a href="/wiki/Air_India">Air India</a></td>'
        '<td><a href="/wiki/Pune_Airport">Pune</a></td></tr>'
        '<tr><td><a href="/wiki/Goa_International_Airport">Goa</a></td></tr>', cargo))
    assert len(r.rows) == 1
    assert [d.label for d in r.rows[0].destinations] == ["Pune", "Goa"]


def test_no_section():
    assert parse_airport_html("<p>Small airfield.</p>").status == "no_section"


def test_parse_date_variants():
    assert parse_date("1 December 2026") == "2026-12-01"
    assert parse_date("December 1, 2026") == "2026-12-01"
    assert parse_date("March 2027") == "2027-03-01"
    assert parse_date("soon") is None


def _table(header: str, rows: str) -> str:
    return ('<div class="mw-heading mw-heading2"><h2>Airlines and destinations</h2></div>'
            f'<table class="wikitable"><tr>{header}</tr>{rows}</table>')


def test_refs_column_is_ignored():
    r = parse_airport_html(_table(
        "<th>Airlines</th><th>Destinations</th><th>Refs.</th>",
        '<tr><td rowspan="2"><a href="/wiki/Air_India">Air India</a></td>'
        '<td><a href="/wiki/Pune_Airport">Pune</a></td><td><sup>[3]</sup></td></tr>'
        '<tr><td><a href="/wiki/Goa_International_Airport">Goa</a></td><td><sup>[4]</sup></td></tr>'))
    assert r.status == "ok"
    assert [d.label for d in r.rows[0].destinations] == ["Pune", "Goa"]


def test_swapped_columns():
    r = parse_airport_html(_table(
        "<th>Destinations</th><th>Airlines</th>",
        '<tr><td><a href="/wiki/Pune_Airport">Pune</a></td><td><a href="/wiki/IndiGo">IndiGo</a></td></tr>'))
    assert r.rows[0].airline_title == "IndiGo"
    assert [d.title for d in r.rows[0].destinations] == ["Pune Airport"]


ROW = '<tr><td><a href="/wiki/IndiGo">IndiGo</a></td><td><a href="/wiki/Pune_Airport">Pune</a></td></tr>'
HEAD = "<th>Airlines</th><th>Destinations</th>"


def _page(level: int, heading: str, table: bool = True) -> str:
    t = f'<table class="wikitable"><tr>{HEAD}</tr>{ROW}</table>' if table else ""
    return f'<div class="mw-heading mw-heading{level}"><h{level}>{heading}</h{level}></div>{t}'


def test_former_section_is_not_current():
    assert parse_airport_html(_page(2, "Former airlines and destinations")).status == "former"
    assert parse_airport_html(_page(2, "Future destinations")).status == "no_section"


def test_singular_and_h3_headings():
    assert parse_airport_html(_page(2, "Airline and destination")).status == "ok"
    assert parse_airport_html(_page(2, "Operations", table=False) + _page(3, "Airlines and destinations")).status == "ok"


def test_former_subsection_is_skipped():
    r = parse_airport_html(_page(2, "Airlines and destinations") + _page(3, "Former destinations"))
    assert [len(x.destinations) for x in r.rows] == [1]


def test_tables_that_are_not_todays_routes():
    ok = _page(2, "Airlines and destinations")
    years = f'<table class="wikitable"><tr>{HEAD}<th>Years served</th></tr>{ROW}</table>'
    stats = '<table class="wikitable"><tr><th>Rank</th><th>Destination (IATA)</th><th>Main airlines</th></tr>' + ROW + "</table>"
    extra = f'<table class="wikitable"><tr>{HEAD}</tr>{ROW}</table>'
    for other in (years, stats, "<p><b>Cargo</b></p>" + extra, "<dl><dt>Former</dt></dl>" + extra,
                  '<div class="mw-heading mw-heading3"><h3>Previously served airlines</h3></div>' + extra):
        assert [len(x.destinations) for x in parse_airport_html(ok + other).rows] == [1], other
    assert len(parse_airport_html(ok + "<p>International</p>" + extra).rows) == 2


def _prose(text: str) -> dict:
    import re
    html = re.sub(r"\[(.+?)\]", lambda m: f'<a href="/wiki/{m[1].replace(" ", "_")}">{m[1]}</a>', text)
    r = parse_airport_html('<div class="mw-heading mw-heading2"><h2>Airlines and destinations</h2></div>'
                           f"<p>{html}</p>" '<div class="mw-heading mw-heading2"><h2>References</h2></div><p>[Z Airport]</p>')
    out: dict = {}
    for row in r.rows:
        out.setdefault(row.airline, []).extend(d.label for d in row.destinations)
    return out or {"status": r.status}


def test_prose_routes():
    assert _prose("[Air Tahiti] connects Ahe Airport to [Arutua Airport], [Manihi Airport], and [Faa Airport] (Papeete).") \
        == {"Air Tahiti": ["Arutua Airport", "Manihi Airport", "Faa Airport"]}
    assert _prose("[Air Tahiti] serves [Faa Airport] and [Faaite Airport] from Anaa Airport.") \
        == {"Air Tahiti": ["Faa Airport", "Faaite Airport"]}
    assert _prose("Labasa Airport is connected to [Nausori Airport] (Suva) by [Fiji Link] and [Northern Air], "
                  "and to [Nadi Airport] by Fiji Link.") \
        == {"Fiji Link": ["Nausori Airport", "Nadi Airport"], "Northern Air": ["Nausori Airport"]}
    assert _prose("[Lulutai Airlines] connects Eua Airport to [Fua Airport] ([Nuku]).") == {"Lulutai Airlines": ["Fua Airport"]}


def test_prose_variations():
    assert _prose("[Air New Zealand] connects Niue Airport to [Auckland Airport] in New Zealand.") == {"Air New Zealand": ["Auckland Airport"]}
    assert _prose("Hoskins Airport is connected to [Lae Airport] by [PNG Air] and by [Air Niugini].") \
        == {"PNG Air": ["Lae Airport"], "Air Niugini": ["Lae Airport"]}


def test_prose_history_is_not_routes():
    for text in ("[Rex Airlines] flew Bathurst to [Sydney] twice weekly until 30 June 2022.",
                 "No scheduled flights as of May 2019.",
                 "[Samoa Airways] connects X Airport to [Apia Airport] and previously served [Suva Airport].",
                 "Prior to 2008 there was an [Air Link] service to [Dubbo]."):
        assert _prose(text) == {"status": "no_table"}, text


def test_passenger_heading_at_the_wrong_level():
    html = """<h2>Airlines and destinations</h2><p>The following airlines operate:</p><h2>Passenger</h2>
    <table class="wikitable"><tr><th>Airlines</th><th>Destinations</th></tr>
    <tr><td>LOT</td><td><a href="/wiki/Warsaw_Chopin_Airport">Warsaw</a></td></tr></table>
    <h2>Statistics</h2>"""
    result = parse_airport_html(html)
    assert result.status == "ok" and result.rows[0].destinations[0].title == "Warsaw Chopin Airport"


def test_category_labels_are_normalised():
    from travel_pipeline.parse_destinations import category_of
    assert category_of("Seasonal") == "seasonal"
    assert category_of("Seasonal charter") == "seasonal charter"
    assert category_of("Seasonal cherter") == "seasonal charter"
    assert category_of("Seasonal charters") == "seasonal charter"
    assert category_of("Charters") == "charter"
    assert category_of("Mining charter") == "charter"
    assert category_of("Hajj & Umrah") == "charter"
    assert category_of("Scheduled") == "scheduled"
