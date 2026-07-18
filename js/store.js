// store.js — local-first persistence via Dexie (IndexedDB).
// Everything here lives ONLY on the device and is never synced back to Sheets.

const db = new Dexie("passepartout");
db.version(1).stores({
  kv:        "key",                    // settings, caches (activeTrip, fx rate, ai key…)
  sheetCache:"tripId",                 // last good POI pull per trip (offline fallback)
  manual:    "id, tripId",            // manual entries  {source:"manual"}
  visited:   "pk, tripId",            // visited overlay (local only)
  overrides: "pk, tripId",            // coordinate drag-fixes
  geocache:  "key",                    // runtime-geocoded coords
  journal:   "id, tripId",            // travel journal entries
  trips:     "id",                     // user-added / edited trips
});

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// --- key/value settings ---
export async function kvGet(key, dflt = null) {
  const r = await db.kv.get(key);
  return r ? r.value : dflt;
}
export async function kvSet(key, value) {
  await db.kv.put({ key, value });
  return value;
}

// --- sheet cache (offline) ---
export const cacheSheet  = (tripId, pois) => db.sheetCache.put({ tripId, pois, ts: Date.now() });
export const getCached   = async (tripId) => (await db.sheetCache.get(tripId))?.pois || [];

// --- manual entries ---
export const getManual   = (tripId) => db.manual.where("tripId").equals(tripId).toArray();
export const addManual   = (row) => db.manual.put(row);
export const delManual   = (id) => db.manual.delete(id);

// --- visited overlay ---
export async function getVisitedMap(tripId) {
  const rows = await db.visited.where("tripId").equals(tripId).toArray();
  return Object.fromEntries(rows.map((r) => [r.pk, r.visited]));
}
export const setVisited  = (pk, tripId, visited) =>
  db.visited.put({ pk, tripId, visited, ts: Date.now() });

// --- coordinate overrides ---
export async function getOverrides(tripId) {
  const rows = await db.overrides.where("tripId").equals(tripId).toArray();
  return Object.fromEntries(rows.map((r) => [r.pk, [r.lng, r.lat]]));
}
export const setOverride = (pk, tripId, lng, lat) =>
  db.overrides.put({ pk, tripId, lng, lat, ts: Date.now() });

// --- runtime geocode cache ---
export const getGeo = async (key) => await db.geocache.get(key);
export const setGeo = (key, lat, lng) => db.geocache.put({ key, lat, lng, ts: Date.now() });

// --- journal ---
export const getJournal = (tripId) =>
  db.journal.where("tripId").equals(tripId).reverse().sortBy("ts");
export const addJournal = (row) => db.journal.put(row);
export const delJournal = (id) => db.journal.delete(id);

// --- user trips ---
export const getUserTrips = () => db.trips.toArray();
export const putTrip = (trip) => db.trips.put(trip);
export const delTrip = (id) => db.trips.delete(id);

export default db;
