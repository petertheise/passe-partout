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
async function fetchRows(url) {
  const res = await fetch(url, { cache: "no-store" });
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
    const seed = GEOCODE_SEED[p.geoName];
    if (seed && seed.lat != null) { p.lat = seed.lat; p.lng = seed.lng; p.geoSource = seed.source; continue; }
    const cached = await store.getGeo(p.geoName);
    if (cached && cached.lat != null) { p.lat = cached.lat; p.lng = cached.lng; p.geoSource = "cache"; continue; }
    if (allowNetwork && navigator.onLine) {
      const g = await geocodeLive(p.name, p.arrondissement, tripId);
      if (g) { p.lat = g.lat; p.lng = g.lng; p.geoSource = "osm";
               await store.setGeo(p.geoName, g.lat, g.lng); continue; }
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
  try {
    for (let i = 0; i < trip.poiGids.length; i++) {
      const rows = await fetchRows(csvUrl(trip.sheetId, trip.poiGids[i]));
      sheetPois.push(...normalizePoiRows(rows, trip.id, i));
    }
    online = true;
    await store.cacheSheet(trip.id, sheetPois);   // refresh offline cache
  } catch (e) {
    sheetPois = await store.getCached(trip.id);   // offline: last good pull
  }

  // localState — manual entries, insulated from the prune above.
  const manual = await store.getManual(trip.id);

  // Merge, then apply coordinates + visited overlay.
  let all = [...sheetPois, ...manual];
  await attachCoords(all, trip.id, { allowNetwork: allowNetwork && online });
  const visited = await store.getVisitedMap(trip.id);
  for (const p of all) p.visited = !!visited[p.pk];

  return { pois: all, online };
}

// --- Logistics tab (Date/Time/Category/Title/…). Empty if the tab doesn't exist. ---
export async function fetchLogistics(trip) {
  try {
    const rows = await fetchRows(namedUrl(trip.sheetId, trip.logisticsSheet || "Logistics"));
    const out = rows
      .map((r) => ({
        date: (r["Date"] || "").trim(),
        time: (r["Time"] || "").trim(),
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
