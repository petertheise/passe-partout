// sw.js — offline app shell + runtime tile cache. Sheet data is always network-first.
const VERSION = "pp-v13";
const TILE_CACHE = "pp-tiles-v2";   // bumped with the tile host change (old CARTO tiles carried a watermark)
// Everything the shell needs. A single 404 in addAll() aborts the whole install
// and leaves the app with NO offline support, so anything that might legitimately
// be missing (trips.json is gitignored) goes in OPTIONAL and is fetched tolerantly.
const CORE = [
  "./", "./index.html", "./css/styles.css",
  "./vendor/maplibre-gl.js", "./vendor/maplibre-gl.css",
  "./vendor/papaparse.min.js", "./vendor/dexie.min.js",
  "./js/app.js", "./js/config.js", "./js/store.js", "./js/data.js",
  "./js/map.js", "./js/ui.js", "./js/tools.js",
  "./data/geocode.json",
  "./data/geo/paris.geojson", "./data/geo/lyon.geojson",
  "./icons/icon-192.png", "./icons/icon-512.png",
];
const OPTIONAL = ["./data/trips.json"];
const TILE_KEEP = 400;
const SHELL_TIMEOUT_MS = 3000;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then(async (c) => {
    await c.addAll(CORE);
    await Promise.all(OPTIONAL.map((u) => c.add(u).catch(() => {})));
  }).then(() => self.skipWaiting()));
});

// Prune the tile cache oldest-first. Unbounded growth eventually makes iOS
// evict ALL site storage, journal included — so this runs during use too,
// not only on activate (which only fires on a VERSION bump).
async function pruneTiles(c) {
  const keys = await c.keys();
  if (keys.length > TILE_KEEP) await Promise.all(keys.slice(0, keys.length - TILE_KEEP).map((k) => c.delete(k)));
}

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== VERSION && k !== TILE_CACHE).map((k) => caches.delete(k)))
  ).then(async () => {
    await pruneTiles(await caches.open(TILE_CACHE));
    return self.clients.claim();
  }));
});

let tilePuts = 0;
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  // Google Sheets / translation / rates / Claude -> network only (freshness).
  if (/docs\.google\.com|mymemory|er-api|nominatim|api\.anthropic/.test(url.host + url.pathname)) return;

  // Map tiles, style, glyphs and sprites -> stale-while-revalidate in a dedicated cache.
  // Explicit host match: a tile-source change must be reflected here or caching silently stops.
  if (url.host === "tiles.openfreemap.org") {
    e.respondWith(caches.open(TILE_CACHE).then(async (c) => {
      const hit = await c.match(e.request);
      const net = fetch(e.request).then((r) => {
        if (r.ok) { c.put(e.request, r.clone()); if (++tilePuts % 50 === 0) pruneTiles(c); }
        return r;
      }).catch(() => hit || new Response("", { status: 504 }));
      return hit || net;
    }));
    return;
  }

  // Same-origin app shell -> network-first with a short timeout, then cache.
  // On stalled (connected-but-dead) connectivity a plain network-first fetch
  // hangs until the OS gives up, so the app takes a minute to open even though
  // every file is cached. Race the network against a 3s timer instead.
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      const cached = await caches.match(e.request);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), SHELL_TIMEOUT_MS);
      try {
        const r = await fetch(e.request, { signal: ctrl.signal });
        clearTimeout(timer);
        if (r.ok) {  // never let a transient error overwrite a good offline copy
          const copy = r.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return r;
      } catch {
        clearTimeout(timer);
        return cached || new Response("", { status: 504 });
      }
    })());
  }
});
