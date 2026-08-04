import { settings, LeafAlignment, SETTING_LIMITS, clampSetting } from "./settings.js";
import type { StoredWorkspace } from "./tabs.js";

const STORAGE_KEY = "syntax-tree-plus:doc";
const THEME_KEY = "syntax-tree-plus:theme";
const PREFS_KEY = "syntax-tree-plus:prefs";
const WORKSPACE_KEY = "syntax-tree-plus:workspace";
const KEYMAP_KEY = "syntax-tree-plus:keymap";
const TOOLBAR_CAT_KEY = "syntax-tree-plus:toolbar-cat";

/**
 * The shareable link for a document — what the Share dialog shows and copies.
 *
 * The fragment used to be *mirrored*: every edit rewrote the URL through
 * `history.replaceState`, so a large tree meant a multi-KB address bar
 * rewritten on each keystroke, and the link went stale-looking the moment the
 * user typed again. Sharing is an explicit act now, so the URL is built on
 * demand here and the address bar is left alone (see `clearFragment`).
 */
export function shareURL(text: string): string {
  const { origin, pathname, search } = location;
  return `${origin}${pathname}${search}#t=` + encodeURIComponent(text);
}

/**
 * Drop a `#t=…` fragment from the address bar without reloading. Called once
 * on boot, after the incoming document has been taken into a tab: leaving it
 * there would make every later reload re-open that tab, and it can only go
 * stale now that nothing keeps it up to date.
 */
export function clearFragment() {
  if (!location.hash) return;
  history.replaceState(null, "", location.pathname + location.search);
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

/** Persist the current active document (bracket notation) to localStorage. */
export function saveDoc(text: string) {
  try {
    localStorage.setItem(STORAGE_KEY, text);
  } catch {
    /* storage may be unavailable (private mode) — ignore */
  }
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

/**
 * Persist the whole tab workspace. Storage only: the URL fragment is *not*
 * touched here (see `shareURL`) — this runs on every edit, and rewriting a
 * multi-KB address bar per keystroke was pure churn.
 */
export function saveWorkspace(ws: StoredWorkspace) {
  try {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(ws));
  } catch {
    /* ignore */
  }
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

  // Clamped to the panel's own ranges (`SETTING_LIMITS`): a blob saved by an
  // older build — or hand-edited — shouldn't be able to put a value into the
  // layout that the Settings panel would now refuse.
  if (typeof p.fontSize === "number" && Number.isFinite(p.fontSize))
    settings.label.fontSize = clampSetting(p.fontSize, SETTING_LIMITS.fontSize);
  if (typeof p.horizontalSpacing === "number" && Number.isFinite(p.horizontalSpacing))
    settings.node.horizontalSpacing = clampSetting(
      p.horizontalSpacing,
      SETTING_LIMITS.horizontalSpacing
    );
  if (typeof p.verticalSpacing === "number" && Number.isFinite(p.verticalSpacing))
    settings.node.verticalSpacing = clampSetting(
      p.verticalSpacing,
      SETTING_LIMITS.verticalSpacing
    );
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
