// Minimal service worker. Strategy:
//   • Pre-cache the app shell on install so the journal works offline.
//   • Cache-first for tile images (they never change).
//   • Network-first for the document and module scripts so updates roll out.
// Bump CACHE_VERSION whenever you change the shell to evict the old cache.

const CACHE_VERSION = "journal-v2";
const SHELL = [
  "./",
  "./index.html",
  "./day.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./src/timeline.js",
  "./src/day.js",
  "./src/db.js",
  "./src/dates.js",
  "./src/moon.js",
  "./src/weather.js",
  "./src/tiles.js",
  "./src/export.js",
  "./assets/tiles/manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((c) => c.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Don't intercept third-party requests (Open-Meteo, etc.).
  if (url.origin !== location.origin) return;

  // Cache-first for tile images.
  if (url.pathname.includes("/assets/tiles/") &&
      /\.(jpe?g|png|webp)$/i.test(url.pathname)) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const resp = await fetch(req);
        if (resp.ok) cache.put(req, resp.clone());
        return resp;
      })
    );
    return;
  }

  // Network-first for everything else, cache fallback.
  event.respondWith(
    fetch(req).then((resp) => {
      const copy = resp.clone();
      caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
      return resp;
    }).catch(() => caches.match(req))
  );
});
