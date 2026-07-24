import { settings } from "./settings.js";

const STORAGE_KEY = "syntax-tree-plus:doc";
const THEME_KEY = "syntax-tree-plus:theme";
const PREFS_KEY = "syntax-tree-plus:prefs";

/** Persist the current document (bracket notation) to localStorage + URL. */
export function saveDoc(text: string) {
  try {
    localStorage.setItem(STORAGE_KEY, text);
  } catch {
    /* storage may be unavailable (private mode) — ignore */
  }
  // Keep a shareable copy in the URL fragment without adding history entries.
  const hash = "#t=" + encodeURIComponent(text);
  if (location.hash !== hash) {
    history.replaceState(null, "", hash);
  }
}

/** Load a document: URL fragment wins over localStorage. Returns null if none. */
export function loadDoc(): string | null {
  const m = location.hash.match(/[#&]t=([^&]*)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      /* fall through */
    }
  }
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveTheme(theme: string) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}

export function loadTheme(): string | null {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

/**
 * Persist the user-tunable display settings so they survive a reload. Theme
 * colors are intentionally excluded — those are derived from the theme (see
 * `saveTheme`/`applyTheme`), not set directly here.
 */
export function savePrefs() {
  const prefs = {
    fontSize: settings.label.fontSize,
    horizontalSpacing: settings.node.horizontalSpacing,
    verticalSpacing: settings.node.verticalSpacing,
    edgeStyle: settings.edge.style,
    leafAlignment: settings.leafAlignment,
    showNodeBoxes: settings.showNodeBoxes,
    autoSubscript: settings.autoSubscript,
  };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* storage may be unavailable — ignore */
  }
}

/**
 * Load persisted display settings into `settings` (no-op if none saved or the
 * stored value is malformed). Each field is validated so a corrupt entry can't
 * push an out-of-range value into the layout.
 */
export function loadPrefs() {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(PREFS_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  let p: Record<string, unknown>;
  try {
    p = JSON.parse(raw);
  } catch {
    return;
  }
  if (typeof p !== "object" || p === null) return;

  if (typeof p.fontSize === "number" && p.fontSize > 0)
    settings.label.fontSize = p.fontSize;
  if (typeof p.horizontalSpacing === "number" && p.horizontalSpacing >= 0)
    settings.node.horizontalSpacing = p.horizontalSpacing;
  if (typeof p.verticalSpacing === "number" && p.verticalSpacing >= 0)
    settings.node.verticalSpacing = p.verticalSpacing;
  if (p.edgeStyle === "straight" || p.edgeStyle === "curved")
    settings.edge.style = p.edgeStyle;
  if (p.leafAlignment === "leaf" || p.leafAlignment === "node")
    settings.leafAlignment = p.leafAlignment;
  if (typeof p.showNodeBoxes === "boolean")
    settings.showNodeBoxes = p.showNodeBoxes;
  if (typeof p.autoSubscript === "boolean")
    settings.autoSubscript = p.autoSubscript;
}
