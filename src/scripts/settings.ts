export type LeafAlignment = "node" | "leaf";
export type EdgeStyle = "straight" | "curved";
export type ThemeName = "light" | "dark";

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
  // Terminal words aligned to a common bottom row ("leaf") or drawn at their
  // own depth ("node").
  leafAlignment: "leaf" as LeafAlignment,
  // Draw a border box around every node label.
  showNodeBoxes: false,
  // Auto-number repeated node labels with subscripts (NP → NP₁, NP₂, …).
  // Purely a display option (jsSyntaxTree parity) — see `applyAutoSubscripts`.
  autoSubscript: false,
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
