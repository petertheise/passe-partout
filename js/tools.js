// tools.js — currency converter, translation (text + voice), and Claude nearby AI.

import * as store from "./store.js";

// ---------------- Currency (USD <-> EUR) ----------------
export async function getRate() {
  const today = new Date().toISOString().slice(0, 10);
  const cached = await store.kvGet("fx");
  if (cached && cached.date === today) return cached;
  try {
    const d = await (await fetch("https://open.er-api.com/v6/latest/USD")).json();
    const eur = d?.rates?.EUR;
    if (eur) return store.kvSet("fx", { date: today, usdToEur: eur, eurToUsd: 1 / eur });
  } catch {}
  return cached || { date: today, usdToEur: 0.92, eurToUsd: 1 / 0.92, stale: true };
}

// ---------------- Translation ----------------
export async function translate(text, dir /* "en|fr" or "fr|en" */) {
  text = text.trim();
  if (!text) return "";
  try {
    const u = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${dir}`;
    const d = await (await fetch(u)).json();
    return d?.responseData?.translatedText || "(no translation)";
  } catch {
    return "(offline — no connection for translation)";
  }
}

// --- Voice handling ---
// The chosen voice is resolved AHEAD of time and kept in module state, so that
// speak() can run fully synchronously inside a tap handler. iOS Safari only
// produces sound when speechSynthesis.speak() is called synchronously within a
// user gesture — any await before it makes iOS silently drop the speech.
let VOICES = [];
let savedVoiceName = null;
let currentVoice = null;

function frOnly() {
  return VOICES
    .filter((v) => (v.lang || "").toLowerCase().startsWith("fr"))
    .sort((a, b) => (b.lang === "fr-FR") - (a.lang === "fr-FR")); // France first
}
function computeDefault() {
  const fr = frOnly();
  const fra = fr.filter((v) => v.lang === "fr-FR"); // France accent for a France trip
  const pool = fra.length ? fra : fr;
  const named = ["aurélie", "audrey", "thomas", "marie", "virginie", "amélie"];
  const byName = (n) => pool.find((v) => v.name.toLowerCase().includes(n));
  return (
    pool.find((v) => /enhanced|premium|amélior|siri/i.test(v.name)) ||
    named.map(byName).find(Boolean) ||
    pool[0] || null
  );
}
function applyChosen() {
  const fr = frOnly();
  currentVoice = (savedVoiceName && fr.find((v) => v.name === savedVoiceName)) || computeDefault();
}
function refreshVoices() {
  if (!window.speechSynthesis) return;
  VOICES = speechSynthesis.getVoices() || [];
  applyChosen();
}
if (window.speechSynthesis) {
  refreshVoices();
  try { speechSynthesis.addEventListener("voiceschanged", refreshVoices); }
  catch { speechSynthesis.onvoiceschanged = refreshVoices; }
}

// Load the saved preference once (startup / when Tools opens).
export async function initVoice() {
  savedVoiceName = await store.kvGet("frVoice");
  refreshVoices();
}
export function frenchVoices() { return frOnly(); }
export function defaultVoiceName() { return computeDefault()?.name || null; }
export function currentVoiceName() { return currentVoice?.name || null; }
export function setVoice(name) {
  savedVoiceName = name;
  store.kvSet("frVoice", name);
  applyChosen();
}

// iOS keeps speech muted until the first gesture "unlocks" the audio channel.
// Call this from the very first tap anywhere in the app.
let primed = false;
export function primeSpeech() {
  if (primed || !window.speechSynthesis) return;
  primed = true;
  try { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; speechSynthesis.speak(u); } catch {}
}

// MUST stay synchronous — iOS only speaks when speak() runs inside a tap.
export function speak(text) {
  if (!text || !window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text);
  if (currentVoice) { u.voice = currentVoice; u.lang = currentVoice.lang; }
  else u.lang = "fr-FR";
  u.rate = 0.95; // a touch slower reads more naturally and is easier to follow
  try { speechSynthesis.cancel(); } catch {}
  speechSynthesis.speak(u);
}


export function listen(lang, onResult) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { alert("Voice input isn't supported in this browser."); return null; }
  const rec = new SR();
  rec.lang = lang;
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.onresult = (e) => onResult(e.results[0][0].transcript);
  rec.start();
  return rec;
}

// ---------------- Claude "What's Nearby & Similar?" ----------------
function buildBody(model, prompt) {
  const body = { model, max_tokens: 1024, messages: [{ role: "user", content: prompt }] };
  // Sonnet/Opus think by default; disable it for this quick list so the token
  // budget goes to the answer, not reasoning. Haiku doesn't think by default
  // and rejects the disabled flag, so we just omit it there.
  if (!model.startsWith("claude-haiku")) body.thinking = { type: "disabled" };
  return body;
}

export async function nearby({ coords, city, lovedTypes, lastVisited, itineraryNames }) {
  const key = await store.kvGet("aiKey");
  if (!key) throw new Error("NO_KEY");
  const model = (await store.kvGet("aiModel")) || "claude-sonnet-5";
  const prompt =
    `The user is currently at coordinates ${coords[1]}, ${coords[0]} in ${city}. ` +
    `Their sheet shows they love high-scoring ${lovedTypes.join(" and ") || "sights"}. ` +
    (lastVisited ? `They just completed a visit to ${lastVisited}. ` : "") +
    `Suggest 3 hidden-gem cafes, shops, or cultural sights within a 15-minute walk that match this vibe. ` +
    `Do not suggest places already on their itinerary list: ${itineraryNames.slice(0, 40).join(", ")}. ` +
    `For each: name, one vivid sentence, and roughly how far / which direction. Keep it tight.`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(buildBody(model, prompt)),
  });
  if (!res.ok) throw new Error("API " + res.status + ": " + (await res.text()).slice(0, 300));
  const data = await res.json();
  if (data.stop_reason === "refusal") return "Claude declined that request — try again from another spot.";
  // Response content is a list of blocks; only text blocks carry the answer.
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  return text || "Claude replied but sent no text — tap again in a moment.";
}
