# Long Story Short

A frictionless personal journaling PWA. One painted tile per day, picked from the
day's weather, curated from public-domain art on Wikimedia Commons. Tap a tile,
write a line or two about the day, optionally attach a photo. All data lives
locally on your device; backup is a single JSON file.

## What's where

```
index.html             timeline (calendar grid)
day.html               single-day editor
styles.css             everything visual
manifest.webmanifest   PWA manifest
sw.js                  offline service worker
src/
  timeline.js          grid view
  day.js               day editor
  db.js                IndexedDB wrapper (entries + weather caches)
  dates.js             YYYY-MM-DD helpers
  weather.js           Open-Meteo lookup, geolocation
  moon.js              moon-phase math (no API)
  tiles.js             deterministic tile picker
  export.js            JSON backup / restore
assets/
  tiles/<bucket>/      curated paintings, organized by weather bucket
  tiles/manifest.json  weather → tile metadata
  icons/               PWA icons (placeholder; replace if you want)
scripts/
  curate_tiles.py      one-time tile curation from Wikimedia Commons
```

## Run locally

ES modules require a real HTTP server (file:// won't work).

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploy to GitHub Pages

1. Create a new GitHub repo (any name, e.g. `journal`).
2. Push this directory to the repo:
   ```sh
   git init
   git add .
   git commit -m "initial"
   git branch -M main
   git remote add origin git@github.com:<you>/<repo>.git
   git push -u origin main
   ```
3. In the repo settings → **Pages**, choose **Deploy from a branch**, branch
   `main`, folder `/ (root)`.
4. After ~30 seconds your app is at `https://<you>.github.io/<repo>/`.
5. On iPhone Safari: open the URL, tap **Share → Add to Home Screen**. The icon
   on your home screen launches it as a standalone app.

## Backup

Tap **↓** in the header to download `journal-backup-YYYY-MM-DD.json`. This file
contains all entries, embedded photos (base64), and weather records. On iPhone,
the download saves to the **Files** app; from there you can drop it into iCloud
Drive for offsite backup.

To restore on a new device, install the PWA, tap **↑**, and pick the JSON file.

## Refreshing the tile set

If you want more variety or different paintings:

```sh
python3 scripts/curate_tiles.py --per-weather 10            # all weathers
python3 scripts/curate_tiles.py --per-weather 8 --only fog  # one weather
```

Edits to `WEATHER_QUERIES` at the top of the script let you steer searches.
The script is idempotent — already-downloaded tiles are kept, and the manifest
is rebuilt from what's actually on disk, so deleting a dud tile then re-running
will simply backfill it.

## Why these design choices

- **Plain HTML/CSS/JS, no bundler.** Smallest possible deploy story; pushing to
  GitHub Pages is the build.
- **Local-first storage.** No login, no server, no privacy surface area. The
  cost is that backup is on you — hence the prominent export button.
- **Public-domain museum art via Wikimedia Commons.** Free forever, no API key,
  no Cloudflare bot challenge (which the Art Institute of Chicago's IIIF
  endpoint enforces). Searches like `"<weather> painting"` over the File
  namespace return ranked, on-topic results.
- **Deterministic tile picking.** Same date + weather always picks the same
  painting on reload, but different days with the same weather get different
  paintings. Achieved with a tiny FNV-1a hash over `"<date>|<bucket>"`.
- **Calendar grid, not feed.** Months as rows, days as tiles — a tapestry
  rather than an Instagram timeline. (You can change this preference by
  swapping in a different `timeline.js`.)
