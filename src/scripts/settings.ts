/**
 * Vertical placement of nodes, mirroring jsSyntaxTree's three alignment modes:
 *
 * - `top`    — every node sits at its own depth (ALIGN_TOP).
 * - `words`  — words drop to a common bottom row; nodes (including childless
 *              ones like `[N]`) stay at their depth (ALIGN_LEAVES).
 * - `bottom` — leaves drop to the bottom row and every parent is pushed down to
 *              just above its highest child (ALIGN_BOTTOM).
 */
export type LeafAlignment = "top" | "words" | "bottom";
export type EdgeStyle = "straight" | "curved";
export type ThemeName = "light" | "dark";
/** How several trees in one document are arranged on the canvas. */
export type ForestLayout = "row" | "column";

export const settings = {
  node: {
    minWidth: 30,
    height: 34,
    padding: 8,
    horizontalSpacing: 24,
    verticalSpacing: 72,
    radius: 6,
  },
  label: {
    fontSize: 16,
    fontFamily: "'Times New Roman', Georgia, serif",
    color: "#1a1a1a",
    selectedColor: "#0b4fa8",
  },
  edge: {
    color: "#555",
    width: 1.5,
    style: "straight" as EdgeStyle,
  },
  triangle: {
    color: "#555",
    width: 1.5,
  },
  movement: {
    color: "#b0006a",
    width: 1.5,
  },
  fill: {
    node: "transparent",
    selected: "#cce6ff",
    selectedStroke: "#0b4fa8",
  },
  // Vertical alignment mode — see LeafAlignment.
  leafAlignment: "words" as LeafAlignment,
  // Draw a border box around every node label.
  showNodeBoxes: false,
  // jsSyntaxTree's "Enable triangles" checkbox: a global, notation-independent
  // override. When false, nothing triangles regardless of word count or a
  // node's own `triangle` field — matching jsSyntaxTree, which has no
  // per-node spelling for this at all.
  showTriangles: true,
  // Auto-number repeated node labels with subscripts (NP → NP₁, NP₂, …).
  // Purely a display option (jsSyntaxTree parity) — see `applyAutoSubscripts`.
  autoSubscript: false,
  // A tab's document can hold several trees: lay them out left-to-right
  // ("row") or one under another ("column"). Purely how they're composed onto
  // the canvas — each tree is still laid out independently.
  forestLayout: "row" as ForestLayout,
  // Blank space between two trees of the same document.
  forestGap: 56,
};

export type Settings = typeof settings;

/**
 * The drawing colors each theme implies. Single source of truth: the UI theme
 * toggle and the exporters both go through `applyThemeColors`, so an export
 * can't drift from what the theme actually draws. (The light values match the
 * defaults above.)
 */
export const THEME_COLORS: Record<
  ThemeName,
  { label: string; edge: string; triangle: string }
> = {
  light: { label: "#1a1a1a", edge: "#555", triangle: "#555" },
  dark: { label: "#e8e8e8", edge: "#aaa", triangle: "#aaa" },
};

/** Point the tree-drawing colors at a theme's palette. */
export function applyThemeColors(theme: ThemeName) {
  const c = THEME_COLORS[theme];
  settings.label.color = c.label;
  settings.edge.color = c.edge;
  settings.triangle.color = c.triangle;
}
