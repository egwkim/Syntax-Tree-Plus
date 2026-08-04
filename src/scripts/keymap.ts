/**
 * Single source of truth for keyboard shortcuts.
 *
 * The app used to carry two hand-maintained copies of every binding — a
 * `switch (e.key)` in `app.ts` and a static help table in `index.html` — with
 * nothing keeping them in sync. This module replaces both: it owns the command
 * list (id + label + default key), applies user remappings, and exposes a
 * lookup the controller drives its handler from. The help table and the
 * settings remap UI are both rendered from the same data, so they can't drift.
 *
 * A binding is a canonical string: optional modifiers joined by `+`, then the
 * key. Single-character keys are lower-cased with `shift` carrying the case
 * (so `n` and `Shift+N` are distinct and unambiguous) — but only for letters,
 * since on a punctuation key the shifted glyph *is* the key (`+` is Shift+=,
 * and "Shift++" would name nothing). Named keys keep their `KeyboardEvent.key`
 * spelling (`Delete`, `Enter`, `F2`, `ArrowUp`, …).
 */

export interface CommandDef {
  id: string; // matches an entry in the controller's `actions` map
  label: string; // shown in help + remap UI
  defaultKey: string; // canonical binding, remappable
  extraKeys?: string[]; // fixed aliases (not remappable), shown in help
  category: string; // grouping for the help table
  /** Runs without a selected node (e.g. zoom). */
  global?: boolean;
}

export const COMMANDS: CommandDef[] = [
  // Structure
  { id: "child", label: "Add child node at end", defaultKey: "n", category: "Structure" },
  { id: "child-start", label: "Add child node at start", defaultKey: "Shift+n", category: "Structure" },
  { id: "text", label: "Add child word (text)", defaultKey: "a", category: "Structure" },
  { id: "toggle-word", label: "Toggle leaf: word / node", defaultKey: "Shift+w", category: "Structure" },
  { id: "sib-after", label: "Add sibling after", defaultKey: "s", category: "Structure" },
  { id: "sib-before", label: "Add sibling before", defaultKey: "Shift+s", category: "Structure" },
  { id: "wrap", label: "Wrap in new parent", defaultKey: "w", category: "Structure" },
  { id: "rename", label: "Rename (inline)", defaultKey: "e", extraKeys: ["Enter", "F2"], category: "Structure" },
  { id: "triangle", label: "Toggle triangle on a word", defaultKey: "t", category: "Structure" },
  { id: "xbar", label: "Expand to X-bar skeleton", defaultKey: "b", category: "Structure" },
  { id: "cptp", label: "Expand to CP/TP clause skeleton", defaultKey: "Shift+b", category: "Structure" },
  { id: "delete", label: "Delete node (children reattach)", defaultKey: "d", extraKeys: ["Delete", "Backspace"], category: "Structure" },
  { id: "reverse", label: "Reverse sibling order", defaultKey: "r", category: "Structure" },
  // Tree-level commands: `a` is taken by "add word", so the mnemonic key is
  // Shift+T ("Tree"), with Shift+D pairing with `d` one level down.
  { id: "add-tree", label: "Add another tree to this tab", defaultKey: "Shift+t", category: "Structure" },
  { id: "delete-tree", label: "Delete the selected tree", defaultKey: "Shift+d", category: "Structure" },

  // Clipboard
  { id: "copy", label: "Copy subtree", defaultKey: "c", category: "Clipboard" },
  { id: "cut", label: "Cut subtree", defaultKey: "x", category: "Clipboard" },
  { id: "paste", label: "Paste as last child", defaultKey: "v", category: "Clipboard" },
  { id: "paste-after", label: "Paste as sibling after", defaultKey: "Shift+v", category: "Clipboard" },

  // Tabs. Modifier chords, not bare letters: the single-character keys belong
  // to the node-editing commands, and a tab command shouldn't need a selection.
  // Each carries a `Meta+…` alias so ⌃⌥ and ⌘⌥ both work on macOS. (Switching
  // between tabs is a fixed key — see FIXED_KEYS — since it also works while
  // the text pane has focus.)
  { id: "new-tab", label: "New tab", defaultKey: "Ctrl+Alt+n", extraKeys: ["Meta+Alt+n"], category: "Tabs", global: true },
  { id: "duplicate-tab", label: "Duplicate this tab", defaultKey: "Ctrl+Alt+d", extraKeys: ["Meta+Alt+d"], category: "Tabs", global: true },
  { id: "reopen-tab", label: "Reopen the last closed tab", defaultKey: "Ctrl+Alt+z", extraKeys: ["Meta+Alt+z"], category: "Tabs", global: true },

  // View. `+` is the key everyone reaches for and what the UI advertises, but
  // it's the *shifted* `=` on most layouts, so the remappable binding is `=`
  // and `+` (numpad, or Shift+= — see `canonicalFromEvent`) is a fixed alias.
  { id: "zoom-in", label: "Zoom in", defaultKey: "=", extraKeys: ["+"], category: "View", global: true },
  { id: "zoom-out", label: "Zoom out", defaultKey: "-", category: "View", global: true },
  { id: "zoom-reset", label: "Reset zoom (100%)", defaultKey: "0", category: "View", global: true },
  { id: "zoom-fit", label: "Fit tree to view", defaultKey: "f", category: "View", global: true },

  // Text pane
  { id: "pretty-print", label: "Pretty-print bracket notation", defaultKey: "Shift+p", category: "Text", global: true },
];

/** Fixed structural shortcuts the controller handles directly (shown in help,
 *  not remappable — they'd collide with core navigation semantics). */
export const FIXED_KEYS: { keys: string; label: string; category: string }[] = [
  { keys: "Arrow keys", label: "Move selection (parent / child / sibling)", category: "Navigation" },
  { keys: "← / → on a root", label: "Move to the previous / next tree of the tab", category: "Navigation" },
  { keys: "Shift + ← / →", label: "Reorder siblings (on a root: reorder trees)", category: "Navigation" },
  { keys: "Ctrl+Z / Ctrl+Y", label: "Undo / redo", category: "Navigation" },
  { keys: "Esc", label: "Deselect / cancel (or click empty space)", category: "Navigation" },
  { keys: "Ctrl+1 … Ctrl+9", label: "Switch to tab 1–9 (9 = last tab)", category: "Tabs" },
  { keys: "Ctrl+Alt+← / →", label: "Previous / next tab (wraps around)", category: "Tabs" },
  { keys: "Ctrl+Tab / Ctrl+Shift+Tab", label: "Next / previous tab, where the browser allows it", category: "Tabs" },
];

/**
 * Keys the controller handles *before* it consults the keymap — the structural
 * ones listed in `FIXED_KEYS`. They're not `COMMANDS` entries, so a conflict
 * scan over `COMMANDS` alone can't see them: binding a command to `ArrowUp`,
 * `Ctrl+z` or `Escape` used to be accepted and then silently never fire,
 * because `app.ts`'s keydown handler returns before the keymap lookup.
 * `reservedKey` is the list that check was missing; the label is what the user
 * is told the key already does.
 */
const RESERVED_KEYS = new Map<string, string>();
{
  const reserve = (label: string, ...keys: string[]) => {
    for (const k of keys) RESERVED_KEYS.set(k, label);
  };
  const arrows = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
  reserve("moving the selection", ...arrows);
  reserve("reordering siblings and trees", ...arrows.map((k) => "Shift+" + k));
  reserve("deselecting and closing dialogs", "Escape");
  // Ctrl and Meta are interchangeable in every one of these handlers (macOS),
  // so both spellings are reserved.
  for (const mod of ["Ctrl", "Meta"]) {
    reserve("undo", `${mod}+z`);
    reserve("redo", `${mod}+Shift+z`, `${mod}+y`, `${mod}+Shift+y`);
    reserve(
      "switching tabs",
      `${mod}+Tab`,
      `${mod}+Shift+Tab`,
      `${mod}+Alt+ArrowLeft`,
      `${mod}+Alt+ArrowRight`,
      ...Array.from({ length: 9 }, (_, i) => `${mod}+${i + 1}`)
    );
  }
}

/** What a structural key is already used for, or null if it's free to bind. */
export function reservedKey(canonical: string): string | null {
  return RESERVED_KEYS.get(canonical) ?? null;
}

const byId = new Map(COMMANDS.map((c) => [c.id, c]));

/** Current remappable bindings: command id → canonical key. */
const bindings: Record<string, string> = {};
resetBindings();

export function resetBindings() {
  for (const c of COMMANDS) bindings[c.id] = c.defaultKey;
}

/** Overlay saved overrides (ignores unknown ids / non-string values). */
export function applyOverrides(overrides: unknown) {
  if (typeof overrides !== "object" || overrides === null) return;
  for (const [id, key] of Object.entries(overrides as Record<string, unknown>)) {
    if (byId.has(id) && typeof key === "string" && key) bindings[id] = key;
  }
}

/** The overrides worth persisting (only bindings that differ from default). */
export function overrides(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of COMMANDS) if (bindings[c.id] !== c.defaultKey) out[c.id] = bindings[c.id];
  return out;
}

export function bindingFor(id: string): string {
  return bindings[id] ?? "";
}

export function commandDef(id: string): CommandDef | undefined {
  return byId.get(id);
}

/** Which command owns a canonical key (primary or fixed alias), or null. */
export function commandForKey(canonical: string): CommandDef | null {
  for (const c of COMMANDS) {
    if (bindings[c.id] === canonical) return c;
    if (c.extraKeys && c.extraKeys.includes(canonical)) return c;
  }
  return null;
}

/**
 * Rebind a command. Refuses a key already taken by a *different* command's
 * primary binding or fixed alias, and a structural key the controller handles
 * itself (see `reservedKey`); returns the conflicting command — or a sentinel
 * with id `""` for a reserved key — so the caller can explain, or null on
 * success.
 */
export function rebind(id: string, canonical: string): CommandDef | { id: ""; label: string } | null {
  if (!byId.has(id)) return null;
  const reserved = reservedKey(canonical);
  if (reserved) return { id: "", label: reserved };
  for (const c of COMMANDS) {
    if (c.id === id) continue;
    if (bindings[c.id] === canonical || (c.extraKeys && c.extraKeys.includes(canonical))) {
      return c;
    }
  }
  bindings[id] = canonical;
  return null;
}

export function bindingToDefault(id: string) {
  const def = byId.get(id);
  if (def) bindings[id] = def.defaultKey;
}

/** Canonical binding string for a keydown event (see module doc). */
export function canonicalFromEvent(e: KeyboardEvent): string {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  // Shift only belongs in the binding when it picked between two keys of the
  // same name — a letter's case. On a punctuation key the shifted glyph *is*
  // `e.key` (`+` for Shift+=, `?` for Shift+/), so carrying the modifier too
  // would spell a binding ("Shift++") that nothing types or renders.
  const shiftNamesTheKey =
    e.shiftKey && !(key.length === 1 && key.toLowerCase() === key.toUpperCase());
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.metaKey) parts.push("Meta");
  if (e.altKey) parts.push("Alt");
  if (shiftNamesTheKey) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

/**
 * Split a canonical binding into modifiers + key. `+` is both the separator
 * and a bindable key (zoom in), so the trailing one is read as the key rather
 * than blindly splitting: `Ctrl++` is Ctrl and `+`, not an empty key.
 */
function splitCanonical(canonical: string): { mods: string[]; key: string } {
  if (canonical.endsWith("+")) {
    return { mods: canonical.slice(0, -1).split("+").filter(Boolean), key: "+" };
  }
  const parts = canonical.split("+");
  const key = parts.pop() ?? "";
  return { mods: parts, key };
}

const KEY_DISPLAY: Record<string, string> = {
  " ": "Space",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Delete: "Del",
  Escape: "Esc",
  Backspace: "Backspace",
  Enter: "Enter",
};

/** Human-friendly rendering of a canonical binding, e.g. `Shift+n` → "Shift + N". */
export function displayKey(canonical: string): string {
  const { mods: rawMods, key } = splitCanonical(canonical);
  // "Meta" is the Command key everywhere it's reachable; spell it as such.
  const mods = rawMods.map((m) => (m === "Meta" ? "⌘" : m));
  const shown = KEY_DISPLAY[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  return [...mods, shown].join(" + ");
}
