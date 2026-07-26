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
 * (so `n` and `Shift+N` are distinct and unambiguous); named keys keep their
 * `KeyboardEvent.key` spelling (`Delete`, `Enter`, `F2`, `ArrowUp`, …).
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

  // Clipboard
  { id: "copy", label: "Copy subtree", defaultKey: "c", category: "Clipboard" },
  { id: "cut", label: "Cut subtree", defaultKey: "x", category: "Clipboard" },
  { id: "paste", label: "Paste as last child", defaultKey: "v", category: "Clipboard" },
  { id: "paste-after", label: "Paste as sibling after", defaultKey: "Shift+v", category: "Clipboard" },

  // View
  { id: "zoom-in", label: "Zoom in", defaultKey: "=", category: "View", global: true },
  { id: "zoom-out", label: "Zoom out", defaultKey: "-", category: "View", global: true },
  { id: "zoom-reset", label: "Reset zoom (100%)", defaultKey: "0", category: "View", global: true },
  { id: "zoom-fit", label: "Fit tree to view", defaultKey: "f", category: "View", global: true },
];

/** Fixed structural shortcuts the controller handles directly (shown in help,
 *  not remappable — they'd collide with core navigation semantics). */
export const FIXED_KEYS: { keys: string; label: string; category: string }[] = [
  { keys: "Arrow keys", label: "Move selection (parent / child / sibling)", category: "Navigation" },
  { keys: "Shift + ← / →", label: "Reorder siblings", category: "Navigation" },
  { keys: "Ctrl+Z / Ctrl+Y", label: "Undo / redo", category: "Navigation" },
  { keys: "Esc", label: "Deselect / cancel (or click empty space)", category: "Navigation" },
];

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
 * primary binding or fixed alias; returns the conflicting command (or a
 * sentinel with id `""` for a reserved fixed key) so the caller can explain,
 * or null on success.
 */
export function rebind(id: string, canonical: string): CommandDef | { id: ""; label: string } | null {
  if (!byId.has(id)) return null;
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
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.metaKey) parts.push("Meta");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  parts.push(key);
  return parts.join("+");
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
  const parts = canonical.split("+");
  const key = parts.pop() ?? "";
  const mods = parts;
  const shown = KEY_DISPLAY[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  return [...mods, shown].join(" + ");
}
