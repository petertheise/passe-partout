# 🧭 Passe-Partout

An **offline-first travel companion** built as a Progressive Web App — no App
Store, no Node, no build step, no backend. Built for a family member's trip to
Paris and Lyon: installed from Safari to the home screen, loaded once on hotel
Wi-Fi, and it kept working on the Métro with no signal.

The interesting constraint was **zero infrastructure**: the whole app is static
files. Trip data lives in a Google Sheet the trip-planner edits like any
spreadsheet; the app reads it as published CSV. All traveler state — journal,
visited pins, cached data — lives on the phone in IndexedDB.

## What it does

- **Offline map** per city (MapLibre GL, tiles cached by a service worker)
  with points of interest color-coded by category.
- **Near Me** — POIs sorted by live walking distance.
- **Today card** — the day's scheduled stops, front and center.
- **Itinerary timeline & reservations locker** driven by a `Logistics` tab in
  the sheet (flights, trains, hotels, confirmation codes).
- **Phrasebook, currency converter, journal** with one-tap share/export.
- **Optional AI "What's Nearby" button** — asks Claude for hidden-gem
  suggestions near the current location (bring-your-own API key, stored only
  on the device; everything else works without it).

```
Google Sheet ──published CSV──▶ data engine ──▶ IndexedDB (Dexie)
map tiles ────▶ service-worker cache ─┐
                                      ▼
                        vanilla-JS UI (no framework)
```

Geocoding runs once, ahead of time, against OpenStreetMap and ships as
`data/geocode.json` — the traveler's phone never geocodes. Vague entries can
be placed by dragging a pin; corrections persist on-device and survive sheet
refreshes.

## Run it

```bash
python3 -m http.server 8791    # from the project folder
# → http://localhost:8791
```

Copy `data/trips.sample.json` to `data/trips.json` and point it at your own
Google Sheet (File → Share → **Publish to web** → CSV; share as "anyone with
the link can view"). To deploy for a phone, drag the folder onto any static
host (Netlify Drop, Cloudflare Pages, GitHub Pages), open the URL in Safari,
**Share → Add to Home Screen**.

## The sheet as CMS

The first two tabs are read as points of interest (*Arrondissement, Point of
Interest, Type, Description, Time Requirement, …*). Add a tab named
**`Logistics`** and the day-by-day timeline turns on:

| Date | Time | Category | Title | Location/Address | Confirmation Code | Details |
|------|------|----------|-------|------------------|-------------------|---------|
| 2026-08-02 | 09:14 | Train | Eurostar #9014 | Gare du Nord | ABC123 | Car 12, seats 41–42 |

`Category` ∈ `Flight` / `Train` / `Hotel` / `Scheduled Sight`. The app only
ever **reads** the sheet. New city next year? **⚙️ → Add a trip**, paste a
sheet URL — no code changes.

## What's inside

```
index.html            app shell
js/                   config, store (IndexedDB), data engine, map, ui, tools, app
data/                 trips.sample.json, geocode.json, geo/*.geojson
vendor/               MapLibre, PapaParse, Dexie (vendored — offline-safe)
sw.js                 service worker (offline cache)
manifest.webmanifest  home-screen install metadata
```

Vanilla JS (ES modules) · MapLibre GL · Dexie · PapaParse · Service Worker —
all dependencies vendored locally, so the app has **zero** runtime calls to
third-party infrastructure beyond map tiles and the owner's sheet.
