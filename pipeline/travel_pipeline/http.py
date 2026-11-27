"""Polite, cached HTTP access.

Every response is cached on disk under pipeline/.cache so re-running the pipeline
(e.g. after a parser fix) does not hit Wikipedia again. Pass refresh=True, or
delete the cache directory, to fetch fresh data.
"""

import contextlib
import fcntl
import hashlib
import json
import os
import subprocess
import sys
import time
from collections.abc import Callable
from http.cookiejar import DefaultCookiePolicy
from pathlib import Path
from urllib.parse import urlencode, urlparse

import requests

from .config import CACHE_DIR, REQUEST_DELAY, USER_AGENT

_session = requests.Session()
_session.headers["User-Agent"] = USER_AGENT
_session.cookies.set_policy(DefaultCookiePolicy(allowed_domains=[]))     # no cookies, as the robot policy asks


def _cache_path(url: str, suffix: str) -> Path:
    key = hashlib.sha256(url.encode()).hexdigest()[:24]
    host = urlparse(url).netloc.replace(".", "_")
    return CACHE_DIR / host / f"{key}{suffix}"


# How to queue for a server: (seconds between requests, requests at once). Wikimedia's robot policy: its API allows
# 10 requests a minute to clients without contact details, one at a time; ordinary article pages (/wiki/...) come from
# its cache and allow far more (20 a second, 10 at once); image files are throttled hardest.
LIMITS = {"en.wikipedia.org/wiki": (0.5, 4), "en.wikipedia.org/w": (6.2, 1), "upload.wikimedia.org": (5.0, 1)}
IMAGES = "upload.wikimedia.org"


def _queue_name(url: str) -> str:
    u = urlparse(url)
    with_path = f"{u.netloc}/{u.path.split('/')[1] if '/' in u.path else ''}"
    return with_path if with_path in LIMITS else u.netloc


def _not_before(queue: str, delay: float, pause: float = 0.0) -> None:
    """Wait until this queue's next request may start, then book the one after it `delay` later. With `pause`: no
    request (from any run) starts for that long."""
    with (CACHE_DIR / f".next-{queue.replace('/', '_')}").open("a+") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        f.seek(0)
        when = float(f.read().strip() or 0)
        now = time.time()
        if pause:
            when = max(when, now + pause)
        else:
            if when > now:
                time.sleep(min(when - now, 600))
            when = time.time() + delay
        f.seek(0)
        f.truncate()
        f.write(str(when))


@contextlib.contextmanager
def _turn(queue: str):
    """Wait for a turn in this queue. Runs in different terminals share it (lock files), so running several at once
    never exceeds a server's limits."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    delay, slots = LIMITS.get(queue, (REQUEST_DELAY, 1))
    files = [(CACHE_DIR / f".lock-{queue.replace('/', '_')}-{i}").open("a+") for i in range(slots)]
    try:
        while True:
            for f in files:
                try:
                    fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    continue
            else:
                time.sleep(0.05)
                continue
            break
        _not_before(queue, delay)
        yield
    finally:
        for f in files:
            f.close()          # also releases the lock


def _curl(url: str) -> bytes:
    out = subprocess.run(
        ["curl", "--silent", "--show-error", "--fail", "--location", "--max-time", "60", "--user-agent", USER_AGENT, url],
        capture_output=True,
    )
    if out.returncode != 0:
        raise requests.RequestException(out.stderr.decode(errors="replace").strip() or f"curl exit {out.returncode}")
    return out.stdout


def cached(url: str, params: dict | None = None, suffix: str = ".bin") -> bytes | None:
    path = _cache_path(f"{url}?{urlencode(sorted(params.items()))}" if params else url, suffix)
    return path.read_bytes() if path.exists() else None


def get_bytes(url: str, params: dict | None = None, *, refresh: bool = False, suffix: str = ".bin", retries: int = 8,
              keep: Callable[[bytes | None], bytes] | None = None) -> bytes:
    """The response, cached. `keep` turns it into what's stored and returned (None when the page doesn't exist)."""
    full_url = f"{url}?{urlencode(sorted(params.items()))}" if params else url
    path = _cache_path(full_url, suffix)
    if path.exists() and not refresh:
        return path.read_bytes()

    queue = _queue_name(url)
    for attempt in range(retries):
        with _turn(queue):
            if path.exists() and not refresh:     # another run fetched it while this one waited
                return path.read_bytes()
            try:
                if queue == IMAGES:
                    # Wikimedia's image server throttles Python HTTP clients however polite they are, but serves curl
                    # normally, so image files go through curl (still one every few seconds, same User-Agent).
                    content = _curl(full_url)
                else:
                    resp = _session.get(full_url, timeout=60)
                    if resp.status_code in (429, 500, 502, 503, 504):
                        # Wait as long as the server asks (within reason). Every run waits, not just this one.
                        wait = min(180, int(resp.headers.get("Retry-After", min(120, 2 ** attempt * 5))))
                        print(f"    HTTP {resp.status_code} for {full_url[-60:]}, retrying in {wait}s",
                              file=sys.stderr, flush=True)
                        _session.close()  # drop pooled connections; the next attempt opens a new one
                        _not_before(queue, 0, pause=wait)
                        continue
                    if keep and resp.status_code == 404:
                        content = None
                    else:
                        resp.raise_for_status()
                        content = resp.content
            except requests.HTTPError:
                raise
            except requests.RequestException:
                # The image server stays closed for many minutes once it throttles: wait longer, try fewer times.
                if attempt == (4 if queue == IMAGES else retries - 1):
                    raise
                _not_before(queue, 0, pause=60 * 2 ** attempt if queue == IMAGES else 2 ** attempt * 2)
                continue
            if keep:
                content = keep(content)
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(f".{os.getpid()}.tmp")       # never leaves a half-written file behind
            tmp.write_bytes(content)
            tmp.replace(path)
            return content
    raise RuntimeError(f"Giving up on {full_url} after {retries} attempts")


def get_json(url: str, params: dict | None = None, *, refresh: bool = False) -> dict:
    return json.loads(get_bytes(url, params, refresh=refresh, suffix=".json"))


def get_text(url: str, params: dict | None = None, *, refresh: bool = False) -> str:
    return get_bytes(url, params, refresh=refresh, suffix=".txt").decode("utf-8")
