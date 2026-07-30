import { settings, LeafAlignment } from "./settings.js";
import type { StoredWorkspace } from "./tabs.js";

const STORAGE_KEY = "syntax-tree-plus:doc";
const THEME_KEY = "syntax-tree-plus:theme";
const PREFS_KEY = "syntax-tree-plus:prefs";
const WORKSPACE_KEY = "syntax-tree-plus:workspace";
const KEYMAP_KEY = "syntax-tree-plus:keymap";
const TOOLBAR_CAT_KEY = "syntax-tree-plus:toolbar-cat";

/** Mirror a bracket-notation doc into the URL fragment for shareable links. */
export function updateFragment(text: string) {
  const hash = "#t=" + encodeURIComponent(text);
  if (location.hash !== hash) {
    history.replaceState(null, "", hash);
  }
}

/** The document carried in the URL fragment (`#t=…`), if any — a shared link. */
export function fragmentDoc(): string | null {
  const m = location.hash.match(/[#&]t=([^&]*)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      /* fall through */
    }
  }
  return null;
}

/** Persist the current active document (bracket notation) to localStorage + URL. */
export function saveDoc(text: string) {
  try {
    localStorage.setItem(STORAGE_KEY, text);
  } catch {
    /* storage may be unavailable (private mode) — ignore */
  }
  updateFragment(text);
}

/**
 * The legacy single-document save, migrated into a tab on boot. Reads
 * localStorage only: the URL fragment is *not* consulted here, because a
 * fragment is a shared document that gets its own tab (see `startApp`) rather
 * than something that replaces what this browser already holds.
 */
export function loadDoc(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Persist the whole tab workspace and mirror the active doc into the URL. */
export function saveWorkspace(ws: StoredWorkspace) {
  try {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(ws));
  } catch {
    /* ignore */
  }
  const active = ws.tabs.find((t) => t.id === ws.activeId) ?? ws.tabs[0];
  if (active) updateFragment(active.text);
}

/** Load the persisted workspace, or null if none / malformed. */
export function loadWorkspace(): StoredWorkspace | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(WORKSPACE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.tabs)) return parsed as StoredWorkspace;
  } catch {
    /* fall through */
  }
  return null;
}

/** Persist keyboard-shortcut overrides (command id → canonical binding). */
export function saveKeymap(overrides: Record<string, string>) {
  try {
    localStorage.setItem(KEYMAP_KEY, JSON.stringify(overrides));
  } catch {
    /* ignore */
  }
}

/** Load keyboard-shortcut overrides, or null if none / malformed. */
export function loadKeymap(): Record<string, string> | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEYMAP_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Record<string, string>;
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Remember which compact-toolbar category was open. `""` is meaningful — the
 * user collapsed the button row — so it's stored rather than removed, and
 * `loadToolbarCat` returns null only when nothing was ever saved.
 */
export function saveToolbarCat(id: string) {
  try {
    localStorage.setItem(TOOLBAR_CAT_KEY, id);
  } catch {
    /* ignore */
  }
}

export function loadToolbarCat(): string | null {
  try {
    return localStorage.getItem(TOOLBAR_CAT_KEY);
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
    showTriangles: settings.showTriangles,
    autoSubscript: settings.autoSubscript,
    forestLayout: settings.forestLayout,
    exportPrefs: settings.exportPrefs,
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
  // Alignment used to be a two-way switch; migrate the old spellings so a
  // returning user keeps the mode they picked.
  const ALIGNMENTS: Record<string, LeafAlignment> = {
    top: "top",
    words: "words",
    bottom: "bottom",
    node: "top", // legacy: "draw each node at its own depth"
    leaf: "words", // legacy: "drop terminals to a common bottom row"
  };
  if (typeof p.leafAlignment === "string" && p.leafAlignment in ALIGNMENTS)
    settings.leafAlignment = ALIGNMENTS[p.leafAlignment];
  if (typeof p.showNodeBoxes === "boolean")
    settings.showNodeBoxes = p.showNodeBoxes;
  if (typeof p.showTriangles === "boolean")
    settings.showTriangles = p.showTriangles;
  if (typeof p.autoSubscript === "boolean")
    settings.autoSubscript = p.autoSubscript;
  if (p.forestLayout === "row" || p.forestLayout === "column")
    settings.forestLayout = p.forestLayout;

  // Export dialog state. Each field is checked against what the dialog can
  // actually offer, so a corrupt blob can't preselect a scale that isn't in
  // the dropdown (and then silently export at it).
  const ep = p.exportPrefs;
  if (typeof ep === "object" && ep !== null) {
    const e = ep as Record<string, unknown>;
    if (e.format === "png" || e.format === "svg" || e.format === "latex")
      settings.exportPrefs.format = e.format;
    if (e.scale === 0.5 || e.scale === 1 || e.scale === 2 || e.scale === 4)
      settings.exportPrefs.scale = e.scale;
    if (typeof e.transparent === "boolean")
      settings.exportPrefs.transparent = e.transparent;
    // "custom" deliberately isn't restored: the range it referred to belongs
    // to whatever tab layout was open then, so it reopens on the current tab.
    if (e.scope === "current" || e.scope === "all")
      settings.exportPrefs.scope = e.scope;
    if (typeof e.combineLatex === "boolean")
      settings.exportPrefs.combineLatex = e.combineLatex;
  }
}
