"""Paths, URLs and tunables for the data pipeline."""

from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = PIPELINE_DIR.parent
CACHE_DIR = PIPELINE_DIR / ".cache"
DATA_DIR = REPO_DIR / "data"

USER_AGENT = "travel-anywhere-route-research/0.1 (personal non-commercial project)"

# Seconds to wait between live (non-cached) requests to the same host.
REQUEST_DELAY = 1.0

WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"
WIKIDATA_SPARQL = "https://query.wikidata.org/sparql"

OURAIRPORTS_AIRPORTS_CSV = "https://davidmegginson.github.io/ourairports-data/airports.csv"
OURAIRPORTS_COUNTRIES_CSV = "https://davidmegginson.github.io/ourairports-data/countries.csv"

HOME_COUNTRY = "IN"
