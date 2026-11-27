"""Paths, URLs and tunables for the data pipeline."""

from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = PIPELINE_DIR.parent
CACHE_DIR = PIPELINE_DIR / ".cache"
DATA_DIR = REPO_DIR / "data"

USER_AGENT = "travel-anywhere-route-research/0.1 (personal non-commercial project)"

# Seconds to wait between live (non-cached) requests to the same host.
REQUEST_DELAY = 2.0

WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"
WIKIPEDIA_PAGE = "https://en.wikipedia.org/wiki/"
WIKIDATA_SPARQL = "https://query.wikidata.org/sparql"

OURAIRPORTS_AIRPORTS_CSV = "https://davidmegginson.github.io/ourairports-data/airports.csv"
OURAIRPORTS_COUNTRIES_CSV = "https://davidmegginson.github.io/ourairports-data/countries.csv"

# Countries whose airports' full route lists are collected, by continent (ISO 3166 alpha-2 codes; continents as in
# OurAirports). Airports elsewhere appear only as destinations. To add a country: add its code under its continent
# and rebuild.
COUNTRIES_BY_CONTINENT = {
    "Africa": {
        "AO",  # Angola
        "BF",  # Burkina Faso
        "BI",  # Burundi
        "BJ",  # Benin
        "BW",  # Botswana
        "CD",  # DR Congo
        "CF",  # Central African Republic
        "CG",  # Republic of the Congo
        "CI",  # Côte d'Ivoire
        "CM",  # Cameroon
        "CV",  # Cape Verde
        "DJ",  # Djibouti
        "DZ",  # Algeria
        "EG",  # Egypt
        "EH",  # Western Sahara
        "ER",  # Eritrea
        "ET",  # Ethiopia
        "GA",  # Gabon
        "GH",  # Ghana
        "GM",  # Gambia
        "GN",  # Guinea
        "GQ",  # Equatorial Guinea
        "GW",  # Guinea-Bissau
        "KE",  # Kenya
        "KM",  # Comoros
        "LR",  # Liberia
        "LS",  # Lesotho
        "LY",  # Libya
        "MA",  # Morocco
        "MG",  # Madagascar
        "ML",  # Mali
        "MR",  # Mauritania
        "MU",  # Mauritius
        "MW",  # Malawi
        "MZ",  # Mozambique
        "NA",  # Namibia
        "NE",  # Niger
        "NG",  # Nigeria
        "RE",  # Réunion
        "RW",  # Rwanda
        "SC",  # Seychelles
        "SD",  # Sudan
        "SH",  # Saint Helena
        "SL",  # Sierra Leone
        "SN",  # Senegal
        "SO",  # Somalia
        "SS",  # South Sudan
        "ST",  # São Tomé and Principe
        "SZ",  # Eswatini
        "TD",  # Chad
        "TG",  # Togo
        "TN",  # Tunisia
        "TZ",  # Tanzania
        "UG",  # Uganda
        "YT",  # Mayotte
        "ZA",  # South Africa
        "ZM",  # Zambia
        "ZW",  # Zimbabwe
    },
    "Asia": {
        "AE",  # United Arab Emirates
        "AF",  # Afghanistan
        "AM",  # Armenia
        "AZ",  # Azerbaijan
        "BD",  # Bangladesh
        "BH",  # Bahrain
        "BN",  # Brunei
        "BT",  # Bhutan
        "CC",  # Cocos (Keeling) Islands
        "CN",  # China
        "CX",  # Christmas Island
        "CY",  # Cyprus
        "GE",  # Georgia
        "HK",  # Hong Kong
        "ID",  # Indonesia
        "IL",  # Israel
        "IN",  # India
        "IQ",  # Iraq
        "IR",  # Iran
        "JO",  # Jordan
        "JP",  # Japan
        "KG",  # Kyrgyzstan
        "KH",  # Cambodia
        "KP",  # North Korea
        "KR",  # South Korea
        "KW",  # Kuwait
        "KZ",  # Kazakhstan
        "LA",  # Laos
        "LB",  # Lebanon
        "LK",  # Sri Lanka
        "MM",  # Myanmar
        "MN",  # Mongolia
        "MO",  # Macau
        "MV",  # Maldives
        "MY",  # Malaysia
        "NP",  # Nepal
        "OM",  # Oman
        "PH",  # Philippines
        "PK",  # Pakistan
        "PS",  # Palestinian Territory (no scheduled flights today)
        "QA",  # Qatar
        "SA",  # Saudi Arabia
        "SG",  # Singapore
        "SY",  # Syria
        "TH",  # Thailand
        "TJ",  # Tajikistan
        "TL",  # Timor-Leste
        "TM",  # Turkmenistan
        "TR",  # Turkey
        "TW",  # Taiwan
        "UZ",  # Uzbekistan
        "VN",  # Vietnam
        "YE",  # Yemen
    },
    "Europe": {
        "AD",  # Andorra (no scheduled flights today)
        "AL",  # Albania
        "AT",  # Austria
        "BA",  # Bosnia and Herzegovina
        "BE",  # Belgium
        "BG",  # Bulgaria
        "BY",  # Belarus
        "CH",  # Switzerland
        "CZ",  # Czech Republic
        "DE",  # Germany
        "DK",  # Denmark
        "EE",  # Estonia
        "ES",  # Spain
        "FI",  # Finland
        "FO",  # Faroe Islands
        "FR",  # France
        "GB",  # United Kingdom
        "GG",  # Guernsey
        "GI",  # Gibraltar
        "GR",  # Greece
        "HR",  # Croatia
        "HU",  # Hungary
        "IE",  # Ireland
        "IM",  # Isle of Man
        "IS",  # Iceland
        "IT",  # Italy
        "JE",  # Jersey
        "LI",  # Liechtenstein (no scheduled flights today)
        "LT",  # Lithuania
        "LU",  # Luxembourg
        "LV",  # Latvia
        "MC",  # Monaco (no scheduled flights today)
        "MD",  # Moldova
        "ME",  # Montenegro
        "MK",  # North Macedonia
        "MT",  # Malta
        "NL",  # Netherlands
        "NO",  # Norway
        "PL",  # Poland
        "PT",  # Portugal
        "RO",  # Romania
        "RS",  # Serbia
        "RU",  # Russia
        "SE",  # Sweden
        "SI",  # Slovenia
        "SK",  # Slovakia
        "SM",  # San Marino (no scheduled flights today)
        "UA",  # Ukraine (no scheduled flights today)
        "VA",  # Vatican City (no scheduled flights today)
        "XK",  # Kosovo
    },
    "North America": {
        "AG",  # Antigua and Barbuda
        "AI",  # Anguilla
        "AW",  # Aruba
        "BB",  # Barbados
        "BL",  # Saint Barthélemy
        "BM",  # Bermuda
        "BQ",  # Caribbean Netherlands
        "BS",  # Bahamas
        "BZ",  # Belize
        "CA",  # Canada
        "CR",  # Costa Rica
        "CU",  # Cuba
        "CW",  # Curaçao
        "DM",  # Dominica
        "DO",  # Dominican Republic
        "GD",  # Grenada
        "GL",  # Greenland
        "GP",  # Guadeloupe
        "GT",  # Guatemala
        "HN",  # Honduras
        "HT",  # Haiti
        "JM",  # Jamaica
        "KN",  # Saint Kitts and Nevis
        "KY",  # Cayman Islands
        "LC",  # Saint Lucia
        "MF",  # Saint Martin
        "MQ",  # Martinique
        "MS",  # Montserrat
        "MX",  # Mexico
        "NI",  # Nicaragua
        "PA",  # Panama
        "PM",  # Saint Pierre and Miquelon
        "PR",  # Puerto Rico
        "SV",  # El Salvador
        "SX",  # Sint Maarten
        "TC",  # Turks and Caicos Islands
        "TT",  # Trinidad and Tobago
        "US",  # United States
        "VC",  # Saint Vincent and the Grenadines
        "VG",  # British Virgin Islands
        "VI",  # U.S. Virgin Islands
    },
    "Oceania": {
        "AS",  # American Samoa
        "AU",  # Australia
        "CK",  # Cook Islands
        "FJ",  # Fiji
        "FM",  # Micronesia
        "GU",  # Guam
        "KI",  # Kiribati
        "MH",  # Marshall Islands
        "MP",  # Northern Mariana Islands
        "NC",  # New Caledonia
        "NF",  # Norfolk Island
        "NR",  # Nauru
        "NU",  # Niue
        "NZ",  # New Zealand
        "PF",  # French Polynesia
        "PG",  # Papua New Guinea
        "PW",  # Palau
        "SB",  # Solomon Islands
        "TO",  # Tonga
        "TV",  # Tuvalu
        "VU",  # Vanuatu
        "WF",  # Wallis and Futuna
        "WS",  # Samoa
    },
    "South America": {
        "AR",  # Argentina
        "BO",  # Bolivia
        "BR",  # Brazil
        "CL",  # Chile
        "CO",  # Colombia
        "EC",  # Ecuador
        "FK",  # Falkland Islands
        "GF",  # French Guiana
        "GY",  # Guyana
        "PE",  # Peru
        "PY",  # Paraguay
        "SR",  # Suriname
        "UY",  # Uruguay
        "VE",  # Venezuela
    },
}
COVERED_COUNTRIES = set().union(*COUNTRIES_BY_CONTINENT.values())

# When both airports have a Wikipedia table, must both list the route? Off: one-sided routes are kept and listed in
# data/routes_to_verify.csv for checking by hand. Often the other article is just incomplete (Mumbai - Jammu flies).
REQUIRE_BOTH_SIDES = False

# Names for airports no other airport's table mentions, where OurAirports' town isn't the name travellers know.
LABEL_OVERRIDES = {"GWD": "Gwadar", "MEQ": "Meulaboh"}

# Shorter names for countries whose full name doesn't fit the site's controls.
COUNTRY_NAMES = {"CD": "DR Congo", "SH": "Saint Helena"}

# Capitals (marked with a star on the map) come from Wikidata. Where it lists more than one, the first one in the
# country's Wikipedia infobox. Montserrat: Plymouth was abandoned after the 1997 eruption; Brades is the de facto
# capital.
CAPITAL_CHOICE = {"BO": "Sucre", "LK": "Sri Jayawardenepura Kotte", "MS": "Brades", "SZ": "Mbabane",
                  "YE": "Sanaa", "YT": "Mamoudzou", "ZA": "Pretoria"}
# Missing from Wikidata: (name, lon, lat).
CAPITAL_EXTRA = {"BQ": ("Kralendijk", -68.2655, 12.1443)}
# No star: city-territories (the whole territory is the city) and Western Sahara (disputed).
NO_CAPITAL = {"HK", "MO", "SG", "MC", "EH"}
