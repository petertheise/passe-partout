// sw.js — offline app shell + runtime tile cache. Sheet data is always network-first.
const VERSION = "pp-v11";
const CORE = [
  "./", "./index.html", "./css/styles.css",
  "./vendor/maplibre-gl.js", "./vendor/maplibre-gl.css",
  "./vendor/papaparse.min.js", "./vendor/dexie.min.js",
  "./js/app.js", "./js/config.js", "./js/store.js", "./js/data.js",
  "./js/map.js", "./js/ui.js", "./js/tools.js",
  "./data/trips.json", "./data/geocode.json",
  "./data/geo/paris.geojson", "./data/geo/lyon.geojson",
  "./icons/icon-192.png", "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== VERSION && k !== "pp-tiles").map((k) => caches.delete(k)))
  ).then(async () => {
    // Prune the tile cache: oldest-first, keep the newest ~400 tiles. Unbounded
    // growth eventually makes iOS evict ALL site storage, journal included.
    const c = await caches.open("pp-tiles");
    const keys = await c.keys();
    if (keys.length > 400) await Promise.all(keys.slice(0, keys.length - 400).map((k) => c.delete(k)));
    return self.clients.claim();
  }));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  // Google Sheets / translation / rates / Claude -> network only (freshness).
  if (/docs\.google\.com|mymemory|er-api|nominatim|api\.anthropic/.test(url.host + url.pathname)) return;

  // Map tiles -> stale-while-revalidate in a dedicated cache.
  if (/tile\.openstreetmap\.org|tiles|\.pbf$/.test(url.host + url.pathname)) {
    e.respondWith(caches.open("pp-tiles").then(async (c) => {
      const hit = await c.match(e.request);
      const net = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }

  // Same-origin app shell -> network-first (fresh when online, cached when offline).
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          if (r.ok) {  // never let a transient error overwrite a good offline copy
            const copy = r.clone();
            caches.open(VERSION).then((c) => c.put(e.request, copy)).catch(() => {});
          }
          return r;
        })
        .catch(() => caches.match(e.request))
    );
  }
});
