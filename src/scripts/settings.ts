export type LeafAlignment = "node" | "leaf";
export type EdgeStyle = "straight" | "curved";

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
