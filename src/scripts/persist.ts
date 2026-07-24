const STORAGE_KEY = "syntax-tree-plus:doc";
const THEME_KEY = "syntax-tree-plus:theme";

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
