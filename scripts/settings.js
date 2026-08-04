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
        style: "straight",
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
    leafAlignment: "words",
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
    forestLayout: "row",
    // Blank space between two trees of the same document.
    forestGap: 56,
    // Last state of the export dialog, remembered so a repeated export (the
    // common case while writing a paper) doesn't have to be re-configured.
    // Purely dialog state — it doesn't affect what's drawn on the canvas.
    exportPrefs: {
        format: "png",
        scale: 1,
        transparent: false,
        scope: "current",
        combineLatex: true,
    },
};
/**
 * A snapshot of the display settings' factory values, taken from the object
 * literal above at module load — before `loadPrefs` (or anything else) ever
 * mutates it. `resetDisplaySettings` restores exactly this set: the fields the
 * Settings panel exposes plus the alignment/boxes/triangles toggles that live
 * on the toolbar but are still part of the same persisted `prefs` blob.
 * Deliberately excludes theme-derived colors (`label.color`/`edge.color`/
 * `triangle.color` track the light/dark toggle, not a "default" of their own),
 * per-node `color` overrides (document content, not an app setting), and
 * `exportPrefs` (dialog state, reset has never covered it).
 */
const DISPLAY_DEFAULTS = {
    fontSize: settings.label.fontSize,
    horizontalSpacing: settings.node.horizontalSpacing,
    verticalSpacing: settings.node.verticalSpacing,
    edgeStyle: settings.edge.style,
    leafAlignment: settings.leafAlignment,
    showNodeBoxes: settings.showNodeBoxes,
    showTriangles: settings.showTriangles,
    autoSubscript: settings.autoSubscript,
    forestLayout: settings.forestLayout,
};
/** Put every display setting back to its factory value. */
export function resetDisplaySettings() {
    settings.label.fontSize = DISPLAY_DEFAULTS.fontSize;
    settings.node.horizontalSpacing = DISPLAY_DEFAULTS.horizontalSpacing;
    settings.node.verticalSpacing = DISPLAY_DEFAULTS.verticalSpacing;
    settings.edge.style = DISPLAY_DEFAULTS.edgeStyle;
    settings.leafAlignment = DISPLAY_DEFAULTS.leafAlignment;
    settings.showNodeBoxes = DISPLAY_DEFAULTS.showNodeBoxes;
    settings.showTriangles = DISPLAY_DEFAULTS.showTriangles;
    settings.autoSubscript = DISPLAY_DEFAULTS.autoSubscript;
    settings.forestLayout = DISPLAY_DEFAULTS.forestLayout;
}
/**
 * The ranges the numeric settings actually accept. Single source of truth: the
 * Settings panel writes them onto its `<input>`s' `min`/`max` (so the markup
 * can't drift from what the handlers enforce), the handlers refuse anything
 * outside them, and `loadPrefs` clamps a persisted value to the same bounds.
 * They used to live only in `index.html`, where they were advertised and never
 * checked — a typed-in font size of 400 went straight into the layout.
 */
export const SETTING_LIMITS = {
    fontSize: { min: 8, max: 40 },
    horizontalSpacing: { min: 4, max: 120 },
    verticalSpacing: { min: 30, max: 200 },
};
/** Keep `v` inside a limit range. */
export function clampSetting(v, limit) {
    return Math.min(limit.max, Math.max(limit.min, v));
}
/**
 * The drawing colors each theme implies. Single source of truth: the UI theme
 * toggle and the exporters both go through `applyThemeColors`, so an export
 * can't drift from what the theme actually draws. (The light values match the
 * defaults above.)
 */
export const THEME_COLORS = {
    light: { label: "#1a1a1a", edge: "#555", triangle: "#555" },
    dark: { label: "#e8e8e8", edge: "#aaa", triangle: "#aaa" },
};
/** Point the tree-drawing colors at a theme's palette. */
export function applyThemeColors(theme) {
    const c = THEME_COLORS[theme];
    settings.label.color = c.label;
    settings.edge.color = c.edge;
    settings.triangle.color = c.triangle;
}
