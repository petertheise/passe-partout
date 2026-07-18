// app.js — bootstrap + orchestration.

import * as data from "./data.js";
import * as mapmod from "./map.js";
import * as tools from "./tools.js";
import * as ui from "./ui.js";
import * as store from "./store.js";
import { CATEGORIES, HIGH_PRIORITY, categoryFromType } from "./config.js";

const $ = (s) => document.querySelector(s);
const state = { trips: [], trip: null, pois: [], logistics: [], hotels: [], filter: "all", screen: "map", pollTimer: null };

// Walking distance in meters between [lng,lat] pairs (haversine).
function distM(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toR, dLng = (b[0] - a[0]) * toR;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// ---------- boot ----------
init();
async function init() {
  await data.loadGeocodeSeed();
  state.trips = await loadTrips();
  const savedId = await store.kvGet("activeTripId");
  state.trip = state.trips.find((t) => t.id === savedId) || state.trips[0];

  ui.renderLegend($("#legend"));
  ui.renderFilters($("#filterbar"), state.filter, pickFilter);
  wireChrome();

  mapmod.initMap("map", state.trip, { onSelect: openDrawer });
  mapmod.startGeolocation();
  $("#citySwitch").textContent = `${state.trip.flag || "📍"} ${state.trip.city} ▾`;

  await refresh();
  startPolling();
  maybeToday();
  tools.initVoice(); // resolve the French voice early so speak() is instant + synchronous
  window.addEventListener("pointerdown", () => tools.primeSpeech(), { once: true });
}

async function loadTrips() {
  let base = [];
  try { base = await (await fetch("data/trips.json")).json(); } catch {}
  const user = (await store.getUserTrips()).map((t) => ({ ...t, custom: true }));
  const byId = new Map(base.map((t) => [t.id, t]));
  for (const u of user) byId.set(u.id, u);
  return [...byId.values()];
}

// ---------- data refresh (sync-merge) ----------
async function refresh() {
  setSync("syncing");
  try {
    const { pois, online } = await data.buildTripData(state.trip);
    state.pois = pois;
    mapmod.renderPois(state.pois, filterFn());
    setSync(online ? "ok" : "offline");
  } catch (e) {
    console.error(e); setSync("offline");
  }
  if (state.screen === "plan") loadPlan();
}

function startPolling() {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => { if (!document.hidden) refresh(); }, 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  window.addEventListener("focus", refresh);
}

function setSync(s) {
  const d = $("#syncDot");
  d.className = "sync " + s;
  d.title = { ok: "Up to date", syncing: "Syncing…", offline: "Offline — showing cached data" }[s] || "";
}

// ---------- filters ----------
const filterFn = () => (ui.FILTERS.find((f) => f.id === state.filter) || ui.FILTERS[0]).fn;
function pickFilter(id) {
  state.filter = id;
  ui.renderFilters($("#filterbar"), id, pickFilter);
  mapmod.renderPois(state.pois, filterFn());
}

// ---------- drawer ----------
let drawerPoi = null;
function openDrawer(poi) {
  drawerPoi = poi;
  $("#drawer").innerHTML = ui.drawerHTML(poi);
  $("#drawer").classList.add("open");
  $("#backdrop").classList.add("show");
}
function closeDrawer() {
  $("#drawer").classList.remove("open");
  $("#backdrop").classList.remove("show");
  drawerPoi = null;
}
$("#drawer").addEventListener("click", async (e) => {
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (!act || !drawerPoi) return;
  const p = drawerPoi;
  if (act === "visit") {
    p.visited = !p.visited;
    await store.setVisited(p.pk, p.tripId, p.visited);
    mapmod.renderPois(state.pois, filterFn());
    openDrawer(p);
  } else if (act === "navigate") {
    window.open(`https://maps.apple.com/?daddr=${p.lat},${p.lng}&q=${encodeURIComponent(p.name)}`, "_blank");
  } else if (act === "place") {
    mapmod.setFixMode(p.pk);
    if (window.__userPos) { p.lng = window.__userPos[0]; p.lat = window.__userPos[1]; await store.setOverride(p.pk, p.tripId, p.lng, p.lat); }
    else { const c = state.trip.center; p.lng = c[0]; p.lat = c[1]; await store.setOverride(p.pk, p.tripId, p.lng, p.lat); }
    mapmod.renderPois(state.pois, filterFn());
    mapmod.flyTo(p.lng, p.lat, 16);
    closeDrawer();
    toast("Drag the highlighted pin to its exact spot.");
  } else if (act === "journal") {
    closeDrawer(); showScreen("journal");
    setTimeout(() => { const t = $("#jTitle"); if (t) { t.value = p.name; $("#jText")?.focus(); } }, 60);
  }
});
$("#backdrop").addEventListener("click", closeDrawer);

// ---------- chrome / nav / buttons ----------
function wireChrome() {
  // bottom nav
  document.querySelectorAll("#bottomnav button").forEach((b) =>
    (b.onclick = () => showScreen(b.dataset.screen)));
  // legend collapse
  $("#legend .lg-head").onclick = () => $("#legend").classList.toggle("collapsed");
  // locate + nearby
  $("#btnLocate").onclick = () => mapmod.centerOnUser();
  $("#btnNearby").onclick = runNearby;
  // FAB add
  $("#btnAdd").onclick = openAddForm;
  // city switcher menu
  $("#citySwitch").onclick = toggleCityMenu;
  // settings gear
  $("#btnSettings").onclick = () => showScreen("trips");
}

function showScreen(name) {
  state.screen = name;
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === "screen-" + name));
  document.querySelectorAll("#bottomnav button").forEach((b) => b.classList.toggle("on", b.dataset.screen === name));
  $("#filterbar").style.display = name === "map" ? "" : "none";
  if (name === "near") loadNear();
  if (name === "plan") loadPlan();
  if (name === "tools") loadTools();
  if (name === "journal") loadJournal();
  if (name === "trips") loadTripsScreen();
}

// ---------- near me ----------
async function loadNear() {
  const showVisited = await store.kvGet("nearShowVisited", false);
  const pos = window.__userPos;
  const rows = state.pois.filter((p) => p.lat != null && (showVisited || !p.visited));
  if (pos) {
    for (const p of rows) p.dist = distM(pos, [p.lng, p.lat]);
    rows.sort((a, b) => a.dist - b.dist);
  } else {
    for (const p of rows) p.dist = null;
    rows.sort((a, b) => (b.aggregate ?? -1) - (a.aggregate ?? -1));
  }
  ui.renderNear($("#nearContent"), rows, !!pos, showVisited);
  $("#nearVisited").onchange = async (e) => {
    await store.kvSet("nearShowVisited", e.target.checked);
    loadNear();
  };
  $("#nearContent").querySelectorAll(".near-row").forEach((b) => (b.onclick = () => {
    const p = state.pois.find((x) => x.pk === b.dataset.pk);
    if (!p) return;
    showScreen("map");
    mapmod.flyTo(p.lng, p.lat, 16);
    openDrawer(p);
  }));
}

// ---------- today card ----------
async function maybeToday() {
  const iso = todayISO();
  const card = $("#todayCard");
  if ((await store.kvGet("todayDismissed")) === iso + "::" + state.trip.id) { card.style.display = "none"; return; }
  const logistics = await data.fetchLogistics(state.trip);
  const events = logistics.filter((r) => r.date === iso)
    .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  if (!events.length) { card.style.display = "none"; return; }

  // a couple of unvisited high-priority picks, nearest first when GPS is on
  const pos = window.__userPos;
  const stars = state.pois.filter((p) => !p.visited && (p.aggregate ?? 0) >= HIGH_PRIORITY && p.lat != null);
  if (pos) { for (const p of stars) p.dist = distM(pos, [p.lng, p.lat]); stars.sort((a, b) => a.dist - b.dist); }
  else { for (const p of stars) p.dist = null; stars.sort((a, b) => (b.aggregate ?? 0) - (a.aggregate ?? 0)); }

  const label = new Date(iso + "T12:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  ui.renderToday(card, label, events.slice(0, 3), stars.slice(0, 2));
  card.style.display = "";
  card.querySelector('[data-tact="dismiss"]').onclick = async (e) => {
    e.stopPropagation();
    await store.kvSet("todayDismissed", iso + "::" + state.trip.id);
    card.style.display = "none";
  };
  card.querySelector('[data-tact="plan"]').onclick = () => showScreen("plan");
  card.querySelectorAll(".today-star").forEach((b) => (b.onclick = (e) => {
    e.stopPropagation();
    const p = state.pois.find((x) => x.pk === b.dataset.pk);
    if (p) { mapmod.flyTo(p.lng, p.lat, 16); openDrawer(p); }
  }));
}

// ---------- plan ----------
async function loadPlan() {
  const [logistics, hotels] = await Promise.all([data.fetchLogistics(state.trip), data.fetchHotels(state.trip)]);
  state.logistics = logistics; state.hotels = hotels;
  ui.renderPlan($("#planContent"), logistics, hotels);
}

// ---------- tools ----------
async function loadTools() {
  const rate = await tools.getRate();
  ui.renderTools($("#toolsContent"), rate);
  const usd = $("#usd"), eur = $("#eur");
  usd.oninput = () => (eur.value = usd.value ? (usd.value * rate.usdToEur).toFixed(2) : "");
  eur.oninput = () => (usd.value = eur.value ? (eur.value * rate.eurToUsd).toFixed(2) : "");
  $("#toolsContent").querySelectorAll("[data-eur]").forEach((b) =>
    (b.onclick = () => { eur.value = b.dataset.eur; eur.oninput(); }));
  // translate
  let dir = "en|fr";
  const setDir = () => ($("#dir").textContent = dir === "en|fr" ? "EN → FR ⇆" : "FR → EN ⇆");
  $("#dir").onclick = () => { dir = dir === "en|fr" ? "fr|en" : "en|fr"; setDir(); };
  $("#doTr").onclick = async () => {
    $("#tout").textContent = "…";
    const out = await tools.translate($("#tin").value, dir);
    $("#tout").innerHTML = `<b data-say2="${ui.esc(out)}">${ui.esc(out)} 🔊</b>`;
  };
  $("#micEn").onclick = () => tools.listen("en-US", (t) => ($("#tin").value = t));
  $("#micFr").onclick = () => tools.listen("fr-FR", (t) => { $("#tin").value = t; dir = "fr|en"; setDir(); });
  $("#toolsContent").addEventListener("click", (e) => {
    const say = e.target.closest("[data-say]")?.dataset.say || e.target.closest("[data-say2]")?.dataset.say2;
    if (say) tools.speak(say);
  });

  // French voice picker
  await tools.initVoice();
  const sel = $("#frVoice");
  const voices = tools.frenchVoices();
  const active = tools.currentVoiceName();
  sel.innerHTML = voices.length
    ? voices.map((v) => `<option value="${ui.esc(v.name)}" ${v.name === active ? "selected" : ""}>${ui.esc(v.name)} · ${v.lang}</option>`).join("")
    : `<option>No French voice installed — see below</option>`;
  sel.onchange = () => tools.setVoice(sel.value);
  $("#voiceTest").onclick = () => tools.speak("Bonjour ! Je voudrais un café, s'il vous plaît.");
}

// ---------- journal ----------
async function loadJournal() {
  const entries = await store.getJournal(state.trip.id);
  ui.renderJournal($("#journalContent"), entries);
  const chosen = new Set();
  $("#jTags")?.querySelectorAll(".tag").forEach((b) =>
    (b.onclick = () => { b.classList.toggle("on"); b.classList.contains("on") ? chosen.add(b.dataset.tag) : chosen.delete(b.dataset.tag); }));
  $("#jSave").onclick = async () => {
    const title = $("#jTitle").value.trim(), text = $("#jText").value.trim();
    if (!title && !text) return;
    await store.addJournal({ id: store.uid(), tripId: state.trip.id, title, text, tags: [...chosen], ts: Date.now() });
    loadJournal();
  };
  $("#journalContent").querySelectorAll("[data-del]").forEach((b) =>
    (b.onclick = async () => { await store.delJournal(b.dataset.del); loadJournal(); }));
  const exp = $("#jExport");
  if (exp) exp.onclick = async () => {
    const all = await store.getJournal(state.trip.id);
    const text = `🧭 ${state.trip.city} — Travel Journal\n\n` +
      all.slice().reverse().map((e) => {   // oldest → newest reads like a diary
        const when = new Date(e.ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
        return [`${when}${e.title ? ` — ${e.title}` : ""}`, e.text || "", (e.tags || []).join(" ")]
          .filter(Boolean).join("\n");
      }).join("\n\n");
    if (navigator.share) {
      try { await navigator.share({ title: `${state.trip.city} journal`, text }); } catch {}
    } else {
      try { await navigator.clipboard.writeText(text); toast("Journal copied — paste it into a note or email."); }
      catch { toast("Couldn't copy — try again."); }
    }
  };
}

// ---------- trips / settings ----------
async function loadTripsScreen() {
  ui.renderTrips($("#tripsContent"), state.trips, state.trip.id);
  const c = $("#tripsContent");
  c.querySelectorAll("[data-switch]").forEach((b) => (b.onclick = () => setActive(b.dataset.switch)));
  c.querySelectorAll("[data-edittrip]").forEach((b) => (b.onclick = () => openTripForm(state.trips.find((t) => t.id === b.dataset.edittrip))));
  c.querySelectorAll("[data-deltrip]").forEach((b) => (b.onclick = async () => { await store.delTrip(b.dataset.deltrip); state.trips = await loadTrips(); loadTripsScreen(); }));
  $("#addTrip").onclick = () => openTripForm();
  // settings
  $("#aiKey").value = (await store.kvGet("aiKey")) || "";
  $("#mapKey").value = (await store.kvGet("mapKey")) || "";
  $("#aiModel").value = (await store.kvGet("aiModel")) || "claude-sonnet-5";
  $("#saveSettings").onclick = async () => {
    await store.kvSet("aiKey", $("#aiKey").value.trim());
    await store.kvSet("mapKey", $("#mapKey").value.trim());
    await store.kvSet("aiModel", $("#aiModel").value);
    toast("Settings saved.");
  };
}

function openTripForm(t = {}) {
  showModal(ui.tripFormHTML(t));
  $("#f_save").onclick = async () => {
    const sheetRaw = $("#f_sheet").value.trim();
    const m = sheetRaw.match(/[-\w]{25,}/);
    const sheetId = m ? m[0] : sheetRaw;
    const city = $("#f_city").value.trim();
    if (!city || !sheetId) { toast("City and Sheet are required."); return; }
    const gids = $("#f_gids").value.split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n));
    const center = $("#f_center").value.split(",").map(Number);
    const trip = {
      id: t.id || city.toLowerCase().replace(/\s+/g, "-"),
      city, flag: t.flag || "📍", sheetId, poiGids: gids.length ? gids : [0],
      hotelGid: t.hotelGid ?? null, logisticsSheet: "Logistics",
      geojson: $("#f_geo").value.trim() || null,
      center: center.length === 2 && center.every((n) => !isNaN(n)) ? center : [2.348, 48.8566],
      zoom: t.zoom || 12, custom: true,
    };
    await store.putTrip(trip);
    state.trips = await loadTrips();
    hideModal(); loadTripsScreen();
    toast(`Saved “${city}”.`);
  };
  $("#f_cancel").onclick = hideModal;
}

async function setActive(id) {
  state.trip = state.trips.find((t) => t.id === id);
  await store.kvSet("activeTripId", id);
  $("#citySwitch").textContent = `${state.trip.flag || "📍"} ${state.trip.city} ▾`;
  mapmod.clearMarkers();
  mapmod.flyToTrip(state.trip);
  mapmod.loadBoundaries(state.trip);
  closeCityMenu();
  showScreen("map");
  await refresh();
  maybeToday();
}

// ---------- city menu ----------
function toggleCityMenu() {
  let m = $("#cityMenu");
  if (m) return closeCityMenu();
  m = ui.el(`<div id="cityMenu" class="citymenu">${
    state.trips.map((t) => `<button data-go="${t.id}">${t.flag || "📍"} ${ui.esc(t.city)}${t.id === state.trip.id ? " ✓" : ""}</button>`).join("")
  }<button data-go="__manage" class="manage">⚙️ Manage trips</button></div>`);
  document.body.appendChild(m);
  m.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => {
    if (b.dataset.go === "__manage") { closeCityMenu(); showScreen("trips"); }
    else setActive(b.dataset.go);
  }));
}
function closeCityMenu() { $("#cityMenu")?.remove(); }

// ---------- manual add ----------
function openAddForm() {
  showModal(`
    <h2>Add a place</h2>
    <label class="fld"><span>Name</span><input id="a_name" placeholder="That café we found"></label>
    <label class="fld"><span>Type</span>
      <select id="a_type">${Object.entries(CATEGORIES).map(([k, v]) => `<option value="${v.label}">${v.emoji} ${v.label}</option>`).join("")}</select></label>
    <label class="fld"><span>Notes</span><textarea id="a_notes" rows="2"></textarea></label>
    <label class="chk"><input type="checkbox" id="a_here" checked> Pin at my current location</label>
    <div class="dw-actions">
      <button class="btn primary" id="a_save">Add place</button>
      <button class="btn" id="a_cancel">Cancel</button>
    </div>`);
  $("#a_save").onclick = async () => {
    const name = $("#a_name").value.trim();
    if (!name) { toast("Give it a name."); return; }
    const type = $("#a_type").value;
    const here = $("#a_here").checked && window.__userPos;
    const [lng, lat] = here ? window.__userPos : state.trip.center;
    const id = store.uid();
    await store.addManual({
      id, tripId: state.trip.id, pk: "manual::" + id, source: "manual",
      name, type, category: categoryFromType(type),
      description: "", notes: $("#a_notes").value.trim(),
      timeReq: "", metro: "", matt: null, dd: null, aggregate: null,
      arrondissement: "", lat, lng,
    });
    hideModal();
    await refresh();
    if (!here) toast("Added — open it and tap “Place on map” to position it.");
    else toast("Added at your location.");
  };
  $("#a_cancel").onclick = hideModal;
}

// ---------- nearby AI ----------
async function runNearby() {
  if (!window.__userPos) { toast("Waiting for GPS…"); return; }
  const loved = [...new Set(state.pois.filter((p) => (p.aggregate ?? 0) >= HIGH_PRIORITY).map((p) => p.category))]
    .map((c) => CATEGORIES[c].label);
  const journal = await store.getJournal(state.trip.id);
  const lastVisited = state.pois.filter((p) => p.visited).slice(-1)[0]?.name || journal[0]?.title || "";
  showModal(`<h2>✨ What’s Nearby</h2><div id="nb" class="nb">Asking Claude…</div><div class="dw-actions"><button class="btn" id="nb_close">Close</button></div>`);
  $("#nb_close").onclick = hideModal;
  try {
    const text = await tools.nearby({
      coords: window.__userPos, city: state.trip.city, lovedTypes: loved,
      lastVisited, itineraryNames: state.pois.map((p) => p.name),
    });
    $("#nb").innerHTML = ui.esc(text).replace(/\n/g, "<br>");
  } catch (e) {
    if (String(e.message).includes("NO_KEY"))
      $("#nb").innerHTML = `Add your Claude API key in ⚙️ Manage trips → Settings to enable this.`;
    else $("#nb").textContent = "Couldn’t reach Claude: " + e.message;
  }
}

// ---------- modal + toast ----------
function showModal(html) { $("#modalBody").innerHTML = html; $("#modal").classList.add("show"); }
function hideModal() { $("#modal").classList.remove("show"); }
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") hideModal(); });

let toastT;
function toast(msg) {
  let t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 3200);
}

// ---------- service worker ----------
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("sw.js").catch(() => {});
