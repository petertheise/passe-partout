// ui.js — rendering helpers for drawer, filters, legend, plan, journal, tools, trips.

import { CATEGORIES, HIGH_PRIORITY, POCKET_PHRASES } from "./config.js";

const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s = "") => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export { el, esc };

// ---------------- Filter pills ----------------
export const FILTERS = [
  { id: "all",       label: "All",                 fn: () => true },
  { id: "high",      label: "⭐ High Priority",     fn: (p) => (p.aggregate ?? 0) >= HIGH_PRIORITY },
  { id: "low",       label: "Low Priority",         fn: (p) => (p.aggregate ?? 0) < HIGH_PRIORITY },
  { id: "museum",    label: "🎨 Museums",           fn: (p) => p.category === "museum" },
  { id: "food",      label: "🍽️ Restaurants",       fn: (p) => p.category === "food" },
  { id: "notvisited",label: "Not Visited",          fn: (p) => !p.visited },
];

export function renderFilters(bar, activeId, onPick) {
  bar.innerHTML = "";
  for (const f of FILTERS) {
    const b = el(`<button class="pill ${f.id === activeId ? "on" : ""}">${f.label}</button>`);
    b.onclick = () => onPick(f.id);
    bar.appendChild(b);
  }
}

// ---------------- Legend ----------------
export function renderLegend(node) {
  const rows = Object.values(CATEGORIES).filter((c) => c.label !== "Other")
    .map((c) => `<div class="lg-row"><span class="dot" style="background:${c.color}"></span>${c.emoji} ${c.label}</div>`).join("");
  node.querySelector(".lg-body").innerHTML =
    rows +
    `<div class="lg-row"><span class="dot star">★</span> Starred = High Priority (≥ ${HIGH_PRIORITY})</div>` +
    `<div class="lg-row"><span class="dot gray"></span> Faded = Visited</div>`;
}

// ---------------- POI drawer (bottom sheet) ----------------
export function drawerHTML(p) {
  const cat = CATEGORIES[p.category] || CATEGORIES.other;
  const high = (p.aggregate ?? 0) >= HIGH_PRIORITY;
  const scoreCell = (label, v) => `<div class="sc"><b>${v ?? "–"}</b><span>${label}</span></div>`;
  return `
    <div class="dw-grab"></div>
    <div class="dw-head">
      <div>
        <h2>${high ? "⭐ " : ""}${esc(p.name)}</h2>
        <span class="badge" style="background:${cat.color}">${cat.emoji} ${esc(p.type || cat.label)}</span>
        ${p.arrondissement ? `<span class="badge ghost">${esc(p.arrondissement)}</span>` : ""}
        ${p.source === "manual" ? `<span class="badge ghost">📝 manual</span>` : ""}
      </div>
      <button class="visit ${p.visited ? "on" : ""}" data-act="visit">${p.visited ? "✓ Visited" : "Mark visited"}</button>
    </div>
    ${(p.timeReq || p.metro) ? `<div class="ribbon">
      ${p.timeReq ? `<span>⏱️ ${esc(p.timeReq)}</span>` : ""}
      ${p.metro ? `<span>🚇 ${esc(p.metro)}</span>` : ""}
    </div>` : ""}
    ${(p.aggregate != null || p.matt != null || p.dd != null) ? `<div class="scores">
      ${scoreCell("Aggregate", p.aggregate != null ? p.aggregate + "/10" : null)}
      ${scoreCell("Matt", p.matt)}
      ${scoreCell("DD", p.dd)}
    </div>` : ""}
    ${(p.description || p.notes) ? `<div class="notes">
      ${p.description ? `<p>${esc(p.description)}</p>` : ""}
      ${p.notes ? `<p class="tip">💡 ${esc(p.notes)}</p>` : ""}
    </div>` : ""}
    ${p.lat == null ? `<div class="warn">📍 No location yet — tap “Place on map”, then drag the pin.</div>` : ""}
    <div class="dw-actions">
      ${p.lat != null ? `<a class="btn primary" data-act="navigate">🗺️ Take Me There</a>` : `<button class="btn" data-act="place">📍 Place on map</button>`}
      <button class="btn" data-act="journal">📝 Log Visit</button>
    </div>`;
}

// ---------------- Near Me list ----------------
export function fmtDist(m) {
  if (m >= 10000) return `${Math.round(m / 1000)} km`;   // not walkable — skip the minutes
  const min = Math.max(1, Math.round(m / 80));            // ~80 m per walking minute
  return m < 1000 ? `${Math.round(m / 10) * 10} m\n${min} min` : `${(m / 1000).toFixed(1)} km\n${min} min`;
}

export function renderNear(container, rows, hasGps, showVisited) {
  container.innerHTML = `
    ${hasGps ? "" : `<div class="hint"><p>📡 Waiting for GPS — showing your top-rated spots for now. Distances appear once location kicks in.</p></div>`}
    <label class="chk near-toggle"><input type="checkbox" id="nearVisited" ${showVisited ? "checked" : ""}> Include visited places</label>
    ${rows.length ? rows.map((p) => `
      <button class="near-row" data-pk="${esc(p.pk)}">
        <span class="dot" style="background:${(CATEGORIES[p.category] || CATEGORIES.other).color}"></span>
        <span class="near-main">
          <b>${(p.aggregate ?? 0) >= HIGH_PRIORITY ? "⭐ " : ""}${esc(p.name)}${p.visited ? " ✓" : ""}</b>
          <small>${p.arrondissement ? esc(p.arrondissement) + " · " : ""}${esc(p.type || "")}${p.timeReq ? " · ⏱️ " + esc(p.timeReq) : ""}</small>
        </span>
        <span class="near-dist">${p.dist != null ? esc(fmtDist(p.dist)) : (p.aggregate != null ? p.aggregate + "/10" : "")}</span>
      </button>`).join("")
      : `<div class="empty"><p>Nothing left to see nearby — you've done it all! Toggle “Include visited” to browse everything.</p></div>`}`;
}

// ---------------- Today card (map overlay) ----------------
export function renderToday(node, dateLabel, events, stars) {
  node.innerHTML = `
    <div class="today-h">
      <span>🌞 Today · ${esc(dateLabel)}</span>
      <button class="today-x" data-tact="dismiss" title="Hide for today">✕</button>
    </div>
    <div class="today-evs" data-tact="plan">
      ${events.map((r) => `<div class="today-ev"><b>${esc(r.time || "")}</b> ${esc(r.title)}${r.location ? ` <span>· ${esc(r.location)}</span>` : ""}</div>`).join("")}
    </div>
    ${stars.length ? `<div class="today-stars">⭐ Nearby picks:
      ${stars.map((p) => `<button class="today-star" data-pk="${esc(p.pk)}">${esc(p.name)}${p.dist != null ? ` (${Math.max(1, Math.round(p.dist / 80))} min)` : ""}</button>`).join("")}
    </div>` : ""}`;
}

// ---------------- Plan / Logistics screen ----------------
const CAT_ICON = { Flight: "✈️", Train: "🚆", Hotel: "🏨", "Scheduled Sight": "📸" };
function slotOf(time) {
  const h = parseInt((time || "").split(":")[0], 10);
  if (isNaN(h)) return "All day";
  if (h < 12) return "🌅 Morning";
  if (h < 17) return "☀️ Afternoon";
  return "🌙 Evening";
}
export function renderPlan(container, logistics, hotels) {
  const locker = logistics.filter((r) => ["Flight", "Train", "Hotel"].includes(r.category));
  const byDate = {};
  for (const r of logistics) (byDate[r.date || "Unscheduled"] ??= []).push(r);

  let html = "";
  if (!logistics.length) {
    const big = !hotels.length;
    html += `<div class="${big ? "empty" : "hint"}">
      ${big ? "<h3>No schedule yet</h3>" : ""}
      <p>💡 Add a <b>Logistics</b> tab to this trip's Google Sheet — columns
      <code>Date · Time · Category · Title · Location/Address · Confirmation Code · Details</code> —
      and your flights, trains, hotels and daily timeline will appear here automatically.</p></div>`;
  }
  if (locker.length) {
    html += `<h3 class="sec">🎫 Reservations</h3>`;
    for (const r of locker) html += `
      <div class="card">
        <div class="card-t">${CAT_ICON[r.category] || "•"} ${esc(r.title)}</div>
        <div class="card-m">${r.date ? esc(r.date) : ""} ${r.time ? "· " + esc(r.time) : ""} ${r.location ? "· " + esc(r.location) : ""}</div>
        ${r.confirmation ? `<div class="card-c">🔑 ${esc(r.confirmation)}</div>` : ""}
        ${r.details ? `<div class="card-d">${esc(r.details)}</div>` : ""}
      </div>`;
  }
  const dates = Object.keys(byDate).filter((d) => d !== "Unscheduled").sort();
  if (dates.length) {
    html += `<h3 class="sec">🗓️ Daily Timeline</h3>`;
    for (const d of dates) {
      html += `<div class="day"><div class="day-h">${esc(d)}</div>`;
      const items = byDate[d].slice().sort((a, b) => (a.time || "").localeCompare(b.time || ""));
      for (const r of items) html += `
        <div class="tl">
          <span class="tl-slot">${slotOf(r.time)}</span>
          <span class="tl-time">${esc(r.time || "")}</span>
          <span class="tl-title">${CAT_ICON[r.category] || "•"} ${esc(r.title)}</span>
        </div>`;
      html += `</div>`;
    }
  }
  if (hotels.length) {
    html += `<h3 class="sec">🏨 Lodging Options</h3>`;
    for (const h of hotels) html += `
      <div class="card">
        <div class="card-t">${esc(h.place)}</div>
        <div class="card-m">${h.price ? "€" + esc(h.price) + "/night" : ""} ${h.area ? "· " + esc(h.area) : ""}</div>
        ${h.notes ? `<div class="card-d">${esc(h.notes)}</div>` : ""}
      </div>`;
  }
  container.innerHTML = html;
}

// ---------------- Tools screen (currency + translate) ----------------
export function renderTools(container, rate) {
  container.innerHTML = `
    <h3 class="sec">💶 Currency</h3>
    <div class="card conv">
      <div class="conv-row"><input id="usd" type="number" inputmode="decimal" placeholder="0"><span>USD</span></div>
      <div class="conv-eq">⇅</div>
      <div class="conv-row"><input id="eur" type="number" inputmode="decimal" placeholder="0"><span>EUR</span></div>
      <div class="chips">${[5,10,20,50,100].map((n)=>`<button class="chip" data-eur="${n}">€${n}</button>`).join("")}</div>
      <div class="fine">1 USD = ${rate.usdToEur.toFixed(3)} EUR${rate.stale ? " (offline estimate)" : ` · ${rate.date}`}</div>
    </div>

    <h3 class="sec">🗣️ Translate (EN ⇄ FR)</h3>
    <div class="card">
      <div class="conv-row"><textarea id="tin" rows="2" placeholder="Type or tap the mic…"></textarea></div>
      <div class="tbtns">
        <button class="chip" id="micEn">🎙️ EN</button>
        <button class="chip" id="micFr">🎙️ FR</button>
        <button class="chip" id="dir">EN → FR ⇆</button>
        <button class="chip primary" id="doTr">Translate</button>
      </div>
      <div id="tout" class="tout"></div>
    </div>

    <div class="card">
      <label class="fld"><span>🔊 French speaking voice</span>
        <select id="frVoice"><option>Loading voices…</option></select></label>
      <button class="chip primary" id="voiceTest">▶︎ Hear a sample</button>
      <div class="fine"><b>No sound?</b> Check the mute switch on the top-left edge of your iPhone — if it shows orange, it silences the voice. <br>Sounds robotic? Download a better one: <b>Settings → Accessibility → Spoken Content → Voices → French</b>, pick one marked <b>“Enhanced,”</b> then choose it here.</div>
    </div>

    <h3 class="sec">📖 Pocket Phrases (offline)</h3>
    <div class="card phrases">
      ${POCKET_PHRASES.map(([en, fr]) => `<div class="ph"><span>${esc(en)}</span><b data-say="${esc(fr)}">${esc(fr)} 🔊</b></div>`).join("")}
    </div>`;
}

// ---------------- Journal screen ----------------
const TAGS = ["#GreatCoffee", "#SkipTheLine", "#Hidden Gem", "#Overrated", "#WouldReturn", "#Views"];
export function renderJournal(container, entries) {
  container.innerHTML = `
    <div class="card">
      <input id="jTitle" placeholder="Place or title (optional)">
      <textarea id="jText" rows="3" placeholder="What did you think? Notes, tips, memories…"></textarea>
      <div class="chips" id="jTags">${TAGS.map((t)=>`<button class="chip tag" data-tag="${esc(t)}">${esc(t)}</button>`).join("")}</div>
      <button class="btn primary" id="jSave">Save entry</button>
    </div>
    ${entries.length ? `<button class="btn" id="jExport">📤 Share journal (${entries.length} ${entries.length === 1 ? "entry" : "entries"})</button>` : ""}
    ${entries.length ? entries.map((e)=>`
      <div class="card jentry">
        <div class="card-m">${new Date(e.ts).toLocaleString()}</div>
        ${e.title ? `<div class="card-t">${esc(e.title)}</div>` : ""}
        ${e.text ? `<div class="card-d">${esc(e.text)}</div>` : ""}
        ${(e.tags||[]).length ? `<div class="jtags">${e.tags.map((t)=>`<span class="tagpill">${esc(t)}</span>`).join("")}</div>` : ""}
        <button class="mini" data-del="${e.id}">delete</button>
      </div>`).join("") : `<div class="empty"><p>No journal entries yet. Tap a place → “Log Visit”, or write one above.</p></div>`}`;
}

// ---------------- Trips / Settings screen ----------------
export function renderTrips(container, trips, activeId) {
  container.innerHTML = `
    <h3 class="sec">🧭 Trips</h3>
    ${trips.map((t)=>`
      <div class="card trip ${t.id===activeId?"on":""}">
        <div class="card-t">${t.flag||"📍"} ${esc(t.city)} ${t.id===activeId?'<span class="badge ghost">active</span>':""}</div>
        <div class="card-m">${esc(t.sheetId.slice(0,14))}…</div>
        <div class="tbtns">
          <button class="chip" data-switch="${t.id}">Switch to</button>
          ${t.custom ? `<button class="chip" data-edittrip="${t.id}">Edit</button><button class="chip" data-deltrip="${t.id}">Delete</button>` : ""}
        </div>
      </div>`).join("")}
    <button class="btn primary" id="addTrip">➕ Add a trip</button>

    <h3 class="sec">⚙️ Settings</h3>
    <div class="card">
      <label class="fld"><span>Claude API key (for “What’s Nearby”)</span>
        <input id="aiKey" type="password" placeholder="sk-ant-…"></label>
      <label class="fld"><span>AI model (affects cost per tap)</span>
        <select id="aiModel">
          <option value="claude-haiku-4-5">Haiku — cheapest &amp; fastest</option>
          <option value="claude-sonnet-5">Sonnet — balanced (recommended)</option>
          <option value="claude-opus-4-8">Opus — best &amp; priciest</option>
        </select></label>
      <label class="fld"><span>Map tile key (optional — MapTiler/Mapbox style URL)</span>
        <input id="mapKey" placeholder="leave blank for free OpenStreetMap"></label>
      <button class="btn" id="saveSettings">Save settings</button>
      <div class="fine">Keys are stored only on this device (IndexedDB) and never leave it except to call that service directly.</div>
    </div>`;
}

export function tripFormHTML(t = {}) {
  return `
    <h2>${t.id ? "Edit" : "Add"} trip</h2>
    <label class="fld"><span>City name</span><input id="f_city" value="${esc(t.city||"")}" placeholder="Tokyo"></label>
    <label class="fld"><span>Google Sheet URL or ID</span><input id="f_sheet" value="${esc(t.sheetId||"")}" placeholder="https://docs.google.com/…"></label>
    <label class="fld"><span>POI tab gids (comma-sep, e.g. 0,1555741457)</span><input id="f_gids" value="${esc((t.poiGids||[0]).join(","))}"></label>
    <label class="fld"><span>Neighborhood GeoJSON URL (optional)</span><input id="f_geo" value="${esc(t.geojson||"")}"></label>
    <label class="fld"><span>Map center — lng,lat (optional)</span><input id="f_center" value="${esc((t.center||[]).join(","))}" placeholder="2.348,48.8566"></label>
    <div class="dw-actions">
      <button class="btn primary" id="f_save">Save trip</button>
      <button class="btn" id="f_cancel">Cancel</button>
    </div>`;
}
