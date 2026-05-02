"""
Curates public-domain paintings from Wikimedia Commons into weather-themed
tile sets.

Uses the MediaWiki API to search the File namespace for "<theme> painting"
and downloads thumbnail-sized renders (default 843px wide).

Usage:
    python3 scripts/curate_tiles.py [--per-weather N] [--width W] [--dry-run]
                                    [--only sunny,rain]

Outputs:
    assets/tiles/<weather>/<slug>.jpg
    assets/tiles/manifest.json
"""

import argparse
import json
import re
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

API = "https://commons.wikimedia.org/w/api.php"
USER_AGENT = ("JournalApp/0.1 "
              "(https://github.com/example/journal; personal-use tile curator)")

# One or more search phrases per weather. We use "<keyword> painting" so the
# file-namespace search returns paintings (vs. photos of the same weather).
WEATHER_QUERIES = {
    "sunny":         ["sunlit landscape painting", "summer landscape painting",
                      "harvest landscape painting", "haystack painting Monet"],
    "partly_cloudy": ["pastoral landscape painting", "river landscape painting",
                      "country lane painting", "afternoon landscape painting"],
    "cloudy":        ["overcast landscape painting", "grey sky painting",
                      "cloudy landscape painting", "stormy sky painting"],
    "rain":          ["rainy day painting", "rain painting", "rain umbrella painting",
                      "Caillebotte rainy day"],
    "storm":         ["storm painting", "tempest painting", "shipwreck painting",
                      "thunderstorm painting"],
    "snow":          ["winter landscape painting", "snow scene painting",
                      "snowy village painting", "Hokusai snow"],
    "fog":           ["fog painting", "mist painting", "Friedrich fog",
                      "misty morning painting"],
    "clear_night":   ["moonlight painting", "moonlit landscape painting",
                      "starry night painting", "nocturne painting Whistler"],
}

# Acceptable license tokens (substrings, case-insensitive) inside extmetadata.
LICENSE_OK = ("public domain", "pd-", "cc0", "no known copyright")

TITLE_REJECT_PATTERNS = (
    re.compile(r"\bself[- ]portrait\b", re.I),
    re.compile(r"\bportrait of\b", re.I),
    re.compile(r"\bcoat of arms\b", re.I),
    re.compile(r"\bdiagram\b", re.I),
    re.compile(r"\bmap of\b", re.I),
    # Detail crops, museum marks, "back of head" zooms — surface as variants of
    # the same painting and create near-duplicates in the tile set.
    re.compile(r" - detail\b", re.I),
    re.compile(r" - mark\b", re.I),
    re.compile(r"\bdetail of\b", re.I),
    re.compile(r"\bzoom\b", re.I),
    re.compile(r"\bhinterkopf\b", re.I),
    re.compile(r"\bdpag\b", re.I),    # German postal stamp scans
    re.compile(r"\bstamp\b", re.I),
)

MIN_FILE_SIZE = 35_000  # bytes — anything below is likely a thumbnail/icon

# We only want raster painting/print images, not SVGs, PDFs, or videos.
ALLOWED_EXTS = (".jpg", ".jpeg", ".png", ".tif", ".tiff")


def http_get_json(url: str, params: dict) -> dict:
    qs = urllib.parse.urlencode(params)
    full = f"{url}?{qs}"
    result = subprocess.run(
        ["curl", "-sSfL", "--max-time", "30", "-A", USER_AGENT, full],
        capture_output=True, check=True,
    )
    return json.loads(result.stdout.decode("utf-8"))


def http_download(url: str, dest: Path) -> None:
    subprocess.run(
        ["curl", "-sSfL", "--max-time", "60", "-A", USER_AGENT, "-o", str(dest), url],
        check=True,
    )


def search_files(query: str, limit: int = 25) -> list[str]:
    data = http_get_json(API, {
        "action": "query", "format": "json",
        "list": "search",
        "srnamespace": "6",          # File:
        "srsearch": query,
        "srlimit": str(limit),
    })
    return [h["title"] for h in data.get("query", {}).get("search", [])]


def get_imageinfo(titles: list[str], width: int) -> list[dict]:
    if not titles:
        return []
    data = http_get_json(API, {
        "action": "query", "format": "json",
        "titles": "|".join(titles),
        "prop": "imageinfo",
        "iiprop": "url|extmetadata|size|mime",
        "iiurlwidth": str(width),
    })
    pages = data.get("query", {}).get("pages", {}) or {}
    out = []
    for page in pages.values():
        infos = page.get("imageinfo") or []
        if not infos:
            continue
        info = infos[0]
        info["_title"] = page.get("title", "")
        out.append(info)
    return out


def is_public_domain(info: dict) -> bool:
    em = info.get("extmetadata") or {}
    license_short = (em.get("LicenseShortName", {}).get("value") or "").lower()
    license_full  = (em.get("UsageTerms",       {}).get("value") or "").lower()
    text = license_short + " " + license_full
    return any(tok in text for tok in LICENSE_OK)


def title_rejected(title: str) -> bool:
    return any(p.search(title) for p in TITLE_REJECT_PATTERNS)


def clean_title(filename: str, object_name: str | None) -> str:
    """Display title for a tile. Prefer extmetadata.ObjectName when set;
    otherwise prettify the Wikimedia filename."""
    if object_name:
        t = re.sub(r"<[^>]+>", "", object_name).strip()
        # Wikimedia sometimes returns Wikidata-structured strings like:
        #   'Foo title QS:P1476,en:"Foo"label QS:Len,"Foo"'
        # The actual title sits before either "title QS:" or "label QS:".
        t = re.split(r"\s*(?:title|label) QS:", t, maxsplit=1)[0].strip()
        # Some entries lead with "<Language>:" — drop that prefix.
        t = re.sub(r"^[A-Z][a-zA-Z]+:\s*", "", t).strip()
        if t:
            return t
    t = filename.replace("File:", "")
    t = re.sub(r"\.(jpe?g|png|tiff?)$", "", t, flags=re.I)
    t = t.replace("_", " ")
    # Collapse whitespace around dashes for typographic niceness.
    t = re.sub(r"\s*-\s*", " — ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def normalize_title(title: str) -> str:
    """For dedup: drop museum suffix, punctuation, case, repeated whitespace."""
    t = title.replace("File:", "")
    t = re.sub(r"\.[A-Za-z]+$", "", t)        # extension
    t = re.sub(r"\s*-\s*[A-Z0-9_]+\s*$", "", t)  # trailing inventory codes
    t = re.sub(r"\s*-\s*WGA\d+\s*$", "", t, flags=re.I)
    t = re.sub(r"[^a-z0-9 ]", " ", t.lower())
    t = re.sub(r"\s+", " ", t).strip()
    return t


def slugify(name: str) -> str:
    name = name.replace("File:", "").strip()
    name = re.sub(r"\.[A-Za-z]+$", "", name)             # drop extension
    name = re.sub(r"[^A-Za-z0-9]+", "_", name).strip("_")
    return name[:80].lower()


def curate(weather: str, queries: list[str], target: int, width: int,
           out_root: Path, dry_run: bool) -> list[dict]:
    out_dir = out_root / weather
    out_dir.mkdir(parents=True, exist_ok=True)
    picked: list[dict] = []
    seen: set[str] = set()

    seen_norm: set[str] = set()
    # Pre-load already-curated titles into the dedup set so re-runs don't add
    # a near-duplicate of something already on disk.
    print(f"\n[{weather}]")
    for q in queries:
        if len(picked) >= target:
            break
        print(f"  search: {q!r}")
        try:
            titles = search_files(q, limit=15)
        except subprocess.CalledProcessError as e:
            print(f"    search failed: {e}", file=sys.stderr)
            continue

        # batch imageinfo lookup (up to 50 titles per call)
        new_titles = [t for t in titles if t not in seen]
        for t in new_titles:
            seen.add(t)
        if not new_titles:
            continue

        try:
            infos = get_imageinfo(new_titles, width)
        except subprocess.CalledProcessError as e:
            print(f"    imageinfo failed: {e}", file=sys.stderr)
            continue

        for info in infos:
            if len(picked) >= target:
                break
            title = info.get("_title", "")
            if title_rejected(title):
                continue
            mime = info.get("mime") or ""
            if not mime.startswith("image/"):
                continue
            url = info.get("url") or ""
            if not any(url.lower().endswith(ext) for ext in ALLOWED_EXTS):
                # fall through — Wikimedia thumbs are always JPG even for source TIFFs
                pass
            thumb = info.get("thumburl") or info.get("url")
            if not thumb:
                continue
            if not is_public_domain(info):
                continue
            norm = normalize_title(title)
            if norm in seen_norm:
                continue
            seen_norm.add(norm)

            em = info.get("extmetadata") or {}
            artist = (em.get("Artist", {}).get("value") or "").strip()
            artist = re.sub(r"<[^>]+>", " ", artist)            # turn HTML tags into separators
            artist = re.sub(r"\s+", " ", artist).strip()
            # Wikimedia sometimes glues "Unknown author" / "Unknown artist" onto a
            # named attribution; keep just the first attribution.
            artist = re.split(r"\s+(?:Unknown(?:\s+(?:author|artist))?|Anonymous)\b",
                              artist, maxsplit=1)[0].strip()
            credit = (em.get("Credit", {}).get("value") or "").strip()
            credit = re.sub(r"<[^>]+>", "", credit)[:120]
            object_name = (em.get("ObjectName", {}).get("value") or "")

            slug = slugify(title)
            file_name = f"{slug}.jpg"
            dest = out_dir / file_name
            entry = {
                "source": "wikimedia",
                "file": f"assets/tiles/{weather}/{file_name}",
                "title": clean_title(title, object_name),
                "artist": artist[:120],
                "credit": credit,
                "url": f"https://commons.wikimedia.org/wiki/{urllib.parse.quote(title)}",
                "license": (em.get("LicenseShortName", {}).get("value") or ""),
            }

            if dry_run:
                print(f"    + {entry['title'][:55]} — {entry['artist'][:30]}")
                picked.append(entry)
                continue

            if dest.exists() and dest.stat().st_size > 1000:
                print(f"    = have {entry['title'][:55]}")
                picked.append(entry)
                continue
            try:
                http_download(thumb, dest)
                size = dest.stat().st_size
                if size < MIN_FILE_SIZE:
                    print(f"    × too small ({size//1024} KB), discarding "
                          f"{entry['title'][:50]}")
                    dest.unlink(missing_ok=True)
                    continue
                print(f"    ↓ {entry['title'][:55]} ({size//1024} KB)")
                picked.append(entry)
                time.sleep(0.15)  # gentle on Wikimedia
            except subprocess.CalledProcessError as e:
                print(f"    ! download failed: {e}", file=sys.stderr)

    print(f"  → {len(picked)} tile(s) for {weather}")
    return picked


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--per-weather", type=int, default=8,
                        help="target tiles per weather state (default: 8)")
    parser.add_argument("--width", type=int, default=843,
                        help="thumbnail width in px (default: 843)")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--only", default="",
                        help="comma-separated weather states (default: all)")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parents[1]
    out_root = project_root / "assets" / "tiles"
    out_root.mkdir(parents=True, exist_ok=True)

    only = {s.strip() for s in args.only.split(",") if s.strip()}
    manifest: dict[str, list[dict]] = {}

    for weather, queries in WEATHER_QUERIES.items():
        if only and weather not in only:
            continue
        try:
            entries = curate(weather, queries, args.per_weather, args.width,
                             out_root, args.dry_run)
            manifest[weather] = entries
        except KeyboardInterrupt:
            print("\ninterrupted")
            break

    if not args.dry_run:
        manifest_path = out_root / "manifest.json"
        if manifest_path.exists():
            try:
                existing = json.loads(manifest_path.read_text())
                for k, v in existing.items():
                    if k not in manifest:
                        manifest[k] = v
            except Exception:
                pass
        # Final sync: drop manifest entries whose tile file no longer exists
        # on disk (e.g. the user deleted a dud manually).
        synced: dict[str, list[dict]] = {}
        for weather, entries in manifest.items():
            kept = [e for e in entries
                    if (project_root / e["file"]).exists()]
            synced[weather] = kept
        manifest_path.write_text(json.dumps(synced, indent=2))
        print(f"\nmanifest written: {manifest_path}")
        for w, entries in synced.items():
            print(f"  {w}: {len(entries)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
