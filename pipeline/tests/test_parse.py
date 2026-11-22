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
