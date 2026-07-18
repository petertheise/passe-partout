// map.js — MapLibre canvas, coloured markers, arrondissement overlays, geolocation.

import { CATEGORIES, HIGH_PRIORITY, osmRasterStyle } from "./config.js";
import * as store from "./store.js";

let map;
let markers = new Map();          // pk -> { marker, poi }
let onSelect = () => {};
let fixModePk = null;             // pk currently being drag-fixed
let userMarker = null;

export function initMap(containerId, trip, handlers = {}) {
  onSelect = handlers.onSelect || onSelect;
  map = new maplibregl.Map({
    container: containerId,
    style: osmRasterStyle(),
    center: trip.center,
    zoom: trip.zoom,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.on("load", () => loadBoundaries(trip));
  map.on("error", (e) => console.error("MAP ERROR:", e?.error?.message || e));
  window.__map = map;
  return map;
}

// --- Arrondissement boundary overlays ---
export async function loadBoundaries(trip) {
  if (!map || !trip.geojson) return;
  for (const id of ["arr-fill", "arr-line", "arr-label"])
    if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource("arr")) map.removeSource("arr");
  let gj;
  try { gj = await (await fetch(trip.geojson)).json(); } catch { return; }
  map.addSource("arr", { type: "geojson", data: gj });
  map.addLayer({ id: "arr-fill", type: "fill", source: "arr",
    paint: { "fill-color": "#6366f1", "fill-opacity": 0.04 } });
  map.addLayer({ id: "arr-line", type: "line", source: "arr",
    paint: { "line-color": "#6366f1", "line-opacity": 0.35, "line-width": 1 } });
  map.addLayer({ id: "arr-label", type: "symbol", source: "arr",
    layout: { "text-field": ["get", "name"], "text-size": 11 },
    paint: { "text-color": "#6366f1", "text-halo-color": "#fff", "text-halo-width": 1.2, "text-opacity": 0.7 } });
}

// --- Render / refresh markers ---
export function renderPois(pois, filterFn = () => true) {
  if (!map) return;
  const seen = new Set();
  for (const poi of pois) {
    if (poi.lat == null || poi.lng == null) continue;
    seen.add(poi.pk);
    const visible = filterFn(poi);
    let entry = markers.get(poi.pk);
    if (!entry) {
      const el = document.createElement("div");
      const marker = new maplibregl.Marker({ element: el, anchor: "center", draggable: false })
        .setLngLat([poi.lng, poi.lat]).addTo(map);
      el.addEventListener("click", (e) => { e.stopPropagation(); onSelect(poi); });
      marker.on("dragend", () => {
        const ll = marker.getLngLat();
        store.setOverride(poi.pk, poi.tripId, ll.lng, ll.lat);
        poi.lng = ll.lng; poi.lat = ll.lat;
      });
      entry = { marker, poi, el };
      markers.set(poi.pk, entry);
    }
    entry.poi = poi;
    entry.marker.setLngLat([poi.lng, poi.lat]);
    styleMarker(entry.el, poi);
    entry.el.style.display = visible ? "" : "none";
    entry.marker.setDraggable(fixModePk === poi.pk);
    entry.el.classList.toggle("fixing", fixModePk === poi.pk);
  }
  // remove markers whose POI vanished (prune)
  for (const [pk, entry] of markers)
    if (!seen.has(pk)) { entry.marker.remove(); markers.delete(pk); }
}

function styleMarker(el, poi) {
  const cat = CATEGORIES[poi.category] || CATEGORIES.other;
  const high = (poi.aggregate ?? 0) >= HIGH_PRIORITY;
  // Never assign className wholesale: MapLibre's own "maplibregl-marker" class
  // (position:absolute) lives on this element — wiping it makes pins drift on zoom.
  el.classList.add("poi-marker");
  el.classList.toggle("high", high);
  el.classList.toggle("visited", !!poi.visited);
  el.style.setProperty("--c", cat.color);
  el.innerHTML = high ? "★" : "";
  el.title = poi.name;
}

export function setFixMode(pk) { fixModePk = pk; }
export function flyTo(lng, lat, zoom = 15) { map?.flyTo({ center: [lng, lat], zoom }); }
export function flyToTrip(trip) { map?.flyTo({ center: trip.center, zoom: trip.zoom }); }

export function clearMarkers() {
  for (const [, e] of markers) e.marker.remove();
  markers.clear();
}

// --- Live geolocation: pulsing blue dot ---
export function startGeolocation() {
  if (!navigator.geolocation) return;
  let dotEl;
  navigator.geolocation.watchPosition(
    (pos) => {
      const { longitude, latitude } = pos.coords;
      window.__userPos = [longitude, latitude];
      if (!userMarker) {
        dotEl = document.createElement("div");
        dotEl.className = "user-dot";
        userMarker = new maplibregl.Marker({ element: dotEl }).setLngLat([longitude, latitude]).addTo(map);
      } else {
        userMarker.setLngLat([longitude, latitude]);
      }
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 10000 }
  );
}

export function centerOnUser() {
  if (window.__userPos) map?.flyTo({ center: window.__userPos, zoom: 15 });
  else alert("Waiting for GPS… make sure location is allowed.");
}
