// config.js — static configuration: categories, colours, type mapping, defaults.

export const CATEGORIES = {
  museum:   { label: "Museum / Culture",      color: "#8b5cf6", emoji: "🎨" },
  food:     { label: "Restaurant / Food",     color: "#f97316", emoji: "🍽️" },
  shop:     { label: "Store / Shopping",      color: "#3b82f6", emoji: "🛍️" },
  landmark: { label: "Historical Landmark",   color: "#ef4444", emoji: "🏰" },
  park:     { label: "Park / Leisure",        color: "#22c55e", emoji: "🌳" },
  other:    { label: "Other",                 color: "#9ca3af", emoji: "📍" },
};

// High-priority threshold on the Aggregate score.
export const HIGH_PRIORITY = 7;

// Map a raw (possibly multi-line) Type string to one of our categories.
export function categoryFromType(rawType = "") {
  const t = String(rawType).toLowerCase();
  const has = (...w) => w.some((x) => t.includes(x));
  if (has("museum", "gallery", "galerie", "musée", "musee")) return "museum";
  if (has("restaurant", "restuarant", "bar", "food market", "bistro", "brasserie",
          "cafe", "café", "bouillon", "epicerie", "épicerie")) return "food";
  if (has("store", "shop", "boutique", "market") && !has("food market")) return "shop";
  if (has("landmark", "church", "cathedral", "basilique", "monument", "cemetery",
          "bridge", "pont", "historical", "hill", "traboule")) return "landmark";
  if (has("park", "garden", "jardin", "parc", "leisure")) return "park";
  return "other";
}

// Keyless raster style (no account/token). Uses CARTO's CORS-enabled tiles,
// which MapLibre requires for WebGL. OSM's own tile server lacks CORS headers.
export function osmRasterStyle() {
  return {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: [
          "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
          "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
          "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
          "https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
        ],
        tileSize: 256,
        attribution: "© OpenStreetMap contributors © CARTO",
        maxzoom: 20,
      },
    },
    layers: [{ id: "osm", type: "raster", source: "osm" }],
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  };
}

// Offline "pocket phrases" — always available with no network.
export const POCKET_PHRASES = [
  ["Hello", "Bonjour"],
  ["Good evening", "Bonsoir"],
  ["Please", "S'il vous plaît"],
  ["Thank you", "Merci"],
  ["Excuse me", "Excusez-moi"],
  ["Sorry", "Pardon"],
  ["Yes / No", "Oui / Non"],
  ["Do you speak English?", "Parlez-vous anglais ?"],
  ["I don't understand", "Je ne comprends pas"],
  ["How much is it?", "C'est combien ?"],
  ["The check, please", "L'addition, s'il vous plaît"],
  ["Where is the toilet?", "Où sont les toilettes ?"],
  ["A table for two", "Une table pour deux"],
  ["I would like…", "Je voudrais…"],
  ["Water, please", "De l'eau, s'il vous plaît"],
  ["A coffee, please", "Un café, s'il vous plaît"],
  ["Where is the metro?", "Où est le métro ?"],
  ["I'm allergic to…", "Je suis allergique à…"],
  ["Can you help me?", "Pouvez-vous m'aider ?"],
  ["Have a nice day", "Bonne journée"],
];
