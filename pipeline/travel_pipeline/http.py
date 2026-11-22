"""Polite, cached HTTP access.

Every response is cached on disk under pipeline/.cache so re-running the pipeline
(e.g. after a parser fix) does not hit Wikipedia again. Pass refresh=True, or
delete the cache directory, to fetch fresh data.
"""

import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlencode, urlparse

import requests

from .config import CACHE_DIR, REQUEST_DELAY, USER_AGENT

_session = requests.Session()
_session.headers["User-Agent"] = USER_AGENT
_last_request: dict[str, float] = {}


def _cache_path(url: str, suffix: str) -> Path:
    key = hashlib.sha256(url.encode()).hexdigest()[:24]
    host = urlparse(url).netloc.replace(".", "_")
    return CACHE_DIR / host / f"{key}{suffix}"


# Wikimedia's image server throttles automated downloads much harder than the API.
HOST_DELAY = {"upload.wikimedia.org": 5.0}


def _throttle(host: str) -> None:
    wait = HOST_DELAY.get(host, REQUEST_DELAY) - (time.monotonic() - _last_request.get(host, 0.0))
    if wait > 0:
        time.sleep(wait)
    _last_request[host] = time.monotonic()


def _curl(url: str) -> bytes:
    out = subprocess.run(
        ["curl", "--silent", "--show-error", "--fail", "--location", "--max-time", "60", "--user-agent", USER_AGENT, url],
        capture_output=True,
    )
    if out.returncode != 0:
        raise requests.RequestException(out.stderr.decode(errors="replace").strip() or f"curl exit {out.returncode}")
    return out.stdout


def get_bytes(url: str, params: dict | None = None, *, refresh: bool = False,
              suffix: str = ".bin", retries: int = 4) -> bytes:
    full_url = f"{url}?{urlencode(sorted(params.items()))}" if params else url
    path = _cache_path(full_url, suffix)
    if path.exists() and not refresh:
        return path.read_bytes()

    host = urlparse(url).netloc
    for attempt in range(retries):
        _throttle(host)
        try:
            if host in HOST_DELAY:
                # Wikimedia's image server throttles Python HTTP clients however polite they are, but serves curl
                # normally, so image files go through curl (still one every few seconds, same User-Agent).
                content = _curl(full_url)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(content)
                return content
            resp = _session.get(full_url, timeout=60)
        except requests.RequestException:
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt * 2)
            continue
        if resp.status_code in (429, 500, 502, 503, 504):
            wait = min(30, int(resp.headers.get("Retry-After", 2 ** attempt * 5)))
            print(f"    HTTP {resp.status_code} for {full_url[-60:]}, retrying in {wait}s", file=sys.stderr, flush=True)
            _session.close()  # drop pooled connections; the next attempt opens a new one
            time.sleep(wait)
            continue
        resp.raise_for_status()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(resp.content)
        return resp.content
    raise RuntimeError(f"Giving up on {full_url} after {retries} attempts")


def get_json(url: str, params: dict | None = None, *, refresh: bool = False) -> dict:
    return json.loads(get_bytes(url, params, refresh=refresh, suffix=".json"))


def get_text(url: str, params: dict | None = None, *, refresh: bool = False) -> str:
    return get_bytes(url, params, refresh=refresh, suffix=".txt").decode("utf-8")
