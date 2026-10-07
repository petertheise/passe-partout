// data.js — the Smart Sync-Merge engine.
// Two layers: sheetState (from Google Sheets) + localState (manual entries, kept apart).
// Display = sheet POIs + manual POIs, with visited + coordinate overrides applied.

import { categoryFromType } from "./config.js";
import * as store from "./store.js";

let GEOCODE_SEED = {};   // { "paris::Louvre": {lat,lng,source} }
export async function loadGeocodeSeed() {
  try {
    GEOCODE_SEED = await (await fetch("data/geocode.json")).json();
  } catch { GEOCODE_SEED = {}; }
}

const slug = (s = "") => s.toLowerCase().trim().replace(/\s+/g, " ");
const num = (v) => {
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const csvUrl = (sheetId, gid) =>
  `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
const namedUrl = (sheetId, name) =>
  `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}`;

function parseCsv(text) {
  return Papa.parse(text.trim(), { header: true, skipEmptyLines: true }).data;
}
// Abort a hung fetch (Métro-grade connectivity) instead of spinning for a minute.
function withTimeout(ms) {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}
async function fetchRows(url) {
  const res = await fetch(url, { cache: "no-store", signal: withTimeout(8000) });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const text = await res.text();
  if (text.startsWith("<") || text.includes("gviz")) {
    // gviz wraps errors in HTML/JS — treat as "no such sheet"
    if (text.startsWith("<")) throw new Error("not-csv");
  }
  return parseCsv(text);
}

// --- Normalise one POI tab into POI objects (forward-filling arrondissement) ---
function normalizePoiRows(rows, tripId, tabIdx) {
  const out = [];
  let arr = "";
  for (const row of rows) {
    const a = (row["Arrondissement"] || "").trim();
    if (a) arr = a;
    const name = (row["Point of Interest"] || "").trim();
    if (!name) continue;
    const type = (row["Type"] || "").trim();
    const aggregate = num(row["Aggregate"]);
    out.push({
      pk: `${tripId}::${slug(name)}::${slug(arr)}`,
      tripId, name, arrondissement: arr, type,
      category: categoryFromType(type),
      description: (row["Description"] || "").trim(),
      timeReq: (row["Time Requirement"] || "").trim(),
      matt: num(row["Matt Score"]),
      dd: num(row["DD Score"]),
      aggregate,
      metro: (row["Metro"] || "").trim(),
      notes: (row["Notes"] || "").trim(),
      source: "sheet", tab: tabIdx,
      geoName: `${tripId}::${name}`,
    });
  }
  return out;
}

// --- Resolve coordinates: override > seed > runtime cache > live geocode ---
async function attachCoords(pois, tripId, { allowNetwork }) {
  const overrides = await store.getOverrides(tripId);
  for (const p of pois) {
    if (overrides[p.pk]) { p.lng = overrides[p.pk][0]; p.lat = overrides[p.pk][1]; p.geoSource = "you"; continue; }
    // Manual entries arrive with coordinates already (and no geoName); keep them.
    // Without this, store.getGeo(undefined) throws out of buildTripData and the
    // whole refresh reports "offline" with frozen POIs.
    if (p.lat != null && p.lng != null) { p.geoSource ??= "you"; continue; }
    if (!p.geoName) { p.lat = null; p.lng = null; p.geoSource = "unplaced"; continue; }
    const seed = GEOCODE_SEED[p.geoName];
    if (seed && seed.lat != null) { p.lat = seed.lat; p.lng = seed.lng; p.geoSource = seed.source; continue; }
    const cached = await store.getGeo(p.geoName);
    if (cached && cached.lat != null) { p.lat = cached.lat; p.lng = cached.lng; p.geoSource = "cache"; continue; }
    // A cached FAILURE (lat=null) also counts — retry at most once a day, not
    // on every 30s refresh (each miss costs a 1.1s throttled Nominatim call).
    if (cached && cached.lat == null && Date.now() - cached.ts < 86400e3) {
      p.lat = null; p.lng = null; p.geoSource = "unplaced"; continue;
    }
    if (allowNetwork && navigator.onLine) {
      const g = await geocodeLive(p.name, p.arrondissement, tripId);
      if (g) { p.lat = g.lat; p.lng = g.lng; p.geoSource = "osm";
               await store.setGeo(p.geoName, g.lat, g.lng); continue; }
      await store.setGeo(p.geoName, null, null);  // remember the miss
    }
    p.lat = null; p.lng = null; p.geoSource = "unplaced";
  }
  return pois;
}

let lastGeo = 0;
async function geocodeLive(name, arr, tripId) {
  // Throttle to be a good Nominatim citizen.
  const wait = 1100 - (Date.now() - lastGeo);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastGeo = Date.now();
  const city = tripId[0].toUpperCase() + tripId.slice(1);
  const q = `${name}, ${arr ? arr + ", " : ""}${city}, France`;
  try {
    const u = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=fr&q=${encodeURIComponent(q)}`;
    const d = await (await fetch(u)).json();
    if (d[0]) return { lat: +d[0].lat, lng: +d[0].lon };
  } catch {}
  return null;
}

// --- Public: build the full display list for a trip ---
export async function buildTripData(trip, { allowNetwork = true } = {}) {
  let sheetPois = [];
  let online = false;
  let cachedTs = null;
  try {
    for (let i = 0; i < trip.poiGids.length; i++) {
      const rows = await fetchRows(csvUrl(trip.sheetId, trip.poiGids[i]));
      sheetPois.push(...normalizePoiRows(rows, trip.id, i));
    }
    online = true;
    // A pull that parses to ZERO places (renamed header, wrong gid, reordered
    // tab) must never overwrite the last good offline copy: one sheet edit at
    // home would blank the map abroad. Treat it like a failed pull instead.
    if (sheetPois.length) {
      await store.cacheSheet(trip.id, sheetPois);   // refresh offline cache
    } else {
      const c = await store.getCachedEntry(trip.id);
      if (c?.pois?.length) { sheetPois = c.pois; cachedTs = c.ts; online = false; }
    }
  } catch (e) {
    const c = await store.getCachedEntry(trip.id);   // offline: last good pull
    sheetPois = c?.pois || []; cachedTs = c?.ts || null;
  }

  // localState — manual entries, insulated from the prune above.
  const manual = await store.getManual(trip.id);

  // Merge, then apply coordinates + visited overlay.
  let all = [...sheetPois, ...manual];
  await attachCoords(all, trip.id, { allowNetwork: allowNetwork && online });
  const visited = await store.getVisitedMap(trip.id);
  for (const p of all) p.visited = !!visited[p.pk];

  return { pois: all, online, cachedTs };
}

// Google's CSV export emits DISPLAY values, so a date cell comes out as
// "8/2/2026" (sheet locale) rather than ISO, and a time as "9:14". Normalise
// both so the Today card matches todayISO() and the timeline sorts by clock.
export function normDate(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);          // M/D/YYYY (US sheet)
  if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; }
  const d = new Date(s);
  if (!isNaN(d)) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return s;   // unknown format: keep the text, it still groups a day together
}
export function normTime(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const m = s.match(/^(\d{1,2})(?:[:h](\d{2}))?\s*([ap]\.?m\.?)?/i);
  if (!m) return s;
  let h = parseInt(m[1], 10); const mm = m[2] || "00";
  const ap = (m[3] || "").toLowerCase();
  if (ap.startsWith("p") && h < 12) h += 12;
  if (ap.startsWith("a") && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${mm}`;
}

// --- Logistics tab (Date/Time/Category/Title/…). Empty if the tab doesn't exist. ---
export async function fetchLogistics(trip) {
  try {
    const rows = await fetchRows(namedUrl(trip.sheetId, trip.logisticsSheet || "Logistics"));
    const out = rows
      .map((r) => ({
        date: normDate(r["Date"]),
        time: normTime(r["Time"]),
        category: (r["Category"] || "").trim(),
        title: (r["Title"] || "").trim(),
        location: (r["Location/Address"] || r["Location"] || r["Address"] || "").trim(),
        confirmation: (r["Confirmation Code"] || r["Confirmation"] || "").trim(),
        details: (r["Details"] || "").trim(),
      }))
      .filter((r) => r.title || r.date);
    await store.kvSet("logi::" + trip.id, out);   // offline fallback
    return out;
  } catch {
    return (await store.kvGet("logi::" + trip.id)) || [];
  }
}

// --- Hotels tab (Place/Price Per Night/Area/Notes) ---
export async function fetchHotels(trip) {
  if (trip.hotelGid == null) return [];
  try {
    const rows = await fetchRows(csvUrl(trip.sheetId, trip.hotelGid));
    const out = rows
      .map((r) => ({
        place: (r["Place"] || "").trim(),
        price: (r["Price Per Night"] || "").trim(),
        area: (r["Area"] || "").trim(),
        notes: (r["Notes"] || "").trim(),
      }))
      .filter((r) => r.place && !r.place.endsWith("?"));
    await store.kvSet("hotels::" + trip.id, out);   // offline fallback
    return out;
  } catch {
    return (await store.kvGet("hotels::" + trip.id)) || [];
  }
}
