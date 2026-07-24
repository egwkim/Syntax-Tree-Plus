# CLAUDE.md

Guidance for working in this repository.

## What this is

**Syntax Tree Plus** — a browser-based, hybrid syntax-tree editor for linguists.
A tree can be edited two ways that stay in sync:

- **GUI**: click/keyboard/toolbar/drag on an SVG rendering.
- **Text**: jsSyntaxTree-compatible labelled bracket notation in a side pane.

No framework, no runtime dependencies. Plain TypeScript compiled to ES modules,
served as static files.

## Build & run

```sh
pnpm install
make build      # tsc -> dist/, then copy non-.ts files (html/css) into dist/
make serve      # serve dist/ locally
pnpm run watch  # rebuild + serve on change
```

- `tsc` outputs to `dist/` (see `tsconfig.json`: rootDir `src`, outDir `dist`).
- `dist/` is git-ignored. **Deploy** (`make deploy`) publishes `dist/` to the
  `gh-pages` branch via a git worktree. Caveat: the Makefile `dist` target makes
  an *orphan* gh-pages branch — to deploy on top of the existing site, set up the
  worktree against `origin/gh-pages` first (`git worktree add dist gh-pages`),
  then `make deploy`.
- No automated test suite in-repo; verification has been ad-hoc via Playwright
  driving the built app.

## Architecture (`src/scripts/`)

Pure model/logic modules with one controller wiring them to the DOM.

| Module | Responsibility |
| --- | --- |
| `tree.ts` | `Node` / `Tree` model. Node = label + `subscript`/`superscript`/`triangle` + children. A terminal is a childless node whose label is the word(s). Also width measurement and layout fields. |
| `parser.ts` | Bracket notation → `Tree`. Tolerant: auto-closes missing `]` and missing labels. `parseLabel` splits `NP_1^0` into base/sub/sup. |
| `serialize.ts` | `Tree` → bracket notation. Inverse of the parser. |
| `render.ts` | `Tree` → `<svg>`. Two passes (layout positions, then draw). Handles triangles, scripts, movement arrows, leaf alignment, bounding-box sizing. Tags each node group with `data-node-id`. |
| `edit.ts` | Pure tree ops: add child/sibling (positional), delete (promotes children), wrap, X-bar template, `reparent`, `isDescendant`. |
| `export.ts` | Download SVG / PNG (SVG rasterized via canvas) / LaTeX `forest`. |
| `history.ts` | Undo/redo over document snapshots (bracket strings). |
| `persist.ts` | Autosave to localStorage + shareable URL fragment (`#t=`). |
| `settings.ts` | Layout/style constants, leaf alignment, theme colors. |
| `app.ts` | Controller. Owns the `Tree`, wires toolbar/keyboard/drag/text pane, inline editing, theme. |
| `main.ts` | Entry point: `startApp()`. |

## Data flow (the important part)

- **Text → tree**: `input` on the textarea → debounced `parse` → replace tree →
  `renderTree()`. Does *not* write back to the textarea (avoids loops).
- **Tree → everything**: after any GUI mutation, `mutated()` = serialize → push
  history → save → set textarea value → render. Programmatic `textarea.value`
  assignment doesn't fire `input`, so there's no feedback loop.
- Selection is a single `tree.selectedNode`. Across a text re-parse it's restored
  by child-index path (`pathOf` / `nodeAtPath`).

## Conventions & gotchas

- **No `prompt()`/`alert()` dialogs for input** — the user's environment can't use
  them. Label editing is an inline `<input>` overlay; brackets/arrows are derived
  from notation, not modal prompts.
- **Inline editing** edits the *raw token* (`DP_1`, `X^0`); `parseLabel` splits it
  on commit. Blank leaves are discarded on commit/cancel.
- **Movement arrows** are derived, not drawn explicitly: two nodes sharing a
  subscript are linked when one is a trace (`t`, `t*`, `e`). No column-number
  arrow syntax.
- **Triangles**: a multi-word terminal auto-triangles. Adjacent single-word leaves
  under one node serialize to one space-separated run and would **merge into one
  triangle on a text round-trip** — the app shows a warning banner for this case.
- **Drag-to-move** uses Pointer Events (touch/pen ok) and only re-parents onto a
  non-descendant; a caret shows the drop index. It's behind the "Move" mode toggle.
- **Text-pane bracket handling** (`app.ts`, textarea `keydown`): IDE-style — select
  text + `[` wraps it; `[` alone inserts `[]` with the caret inside; `]` before a
  `]` types over it; Backspace between an empty `[]` deletes both. **Known bug**:
  type-over currently skips *any* `]` (even one you typed manually), because it
  doesn't track which bracket was auto-created — see the TODO for the planned fix.
- Module imports use explicit `.js` extensions (ESM output).
- `id` on `Node` is a per-session counter, not persisted.

## TODO — possible fixes & improvements

Fixes / robustness
- [ ] **Text-pane bracket UX (next up, decided).** Replace the bare `<textarea>`
      with a **dependency-free** highlight overlay: a transparent textarea on top
      of a mirror `<div>` whose text is re-rendered with `<span>`-wrapped brackets,
      kept in sync with the textarea's content/scroll/resize. Requirements:
      - Track the innermost **auto-created** bracket pair and **highlight the
        matching pair at the cursor** (VS Code style — matching-pair only, *not*
        rainbow; can switch later).
      - Type-over `]` **only** while the caret is inside that highlighted auto-pair;
        typing `]` anywhere else inserts a literal `]`. Drop the highlight/tracking
        once the caret leaves the pair's scope. (This fixes the known bug above.)
      - Keep the existing wrap-selection / auto-close / backspace-pair behaviors.
      - Stay framework-free: no CodeMirror/Monaco/Ace.
- [ ] Adjacent single-word leaves are lossy on round-trip; warning exists but a
      real fix (distinct separator or lossless serialization) would be better.
- [ ] Add an actual automated test suite (parser/serializer round-trip unit tests
      + a Playwright smoke test) instead of ad-hoc scripts.
- [ ] Small-screen / responsive layout: the split pane and toolbar assume desktop.
- [ ] Accessibility: SVG nodes have no ARIA roles or keyboard focus order.
- [ ] Fix the Makefile `dist` target so it tracks `origin/gh-pages` instead of
      creating an orphan branch.

Features
- [ ] Zoom & pan + "fit to view" for large trees (canvas only scrolls today).
- [ ] Copy tree image (PNG/SVG) to the system clipboard, not just download.
- [ ] Explicit movement-arrow tool (draw/label an arrow between two chosen nodes).
- [ ] Auto-subscripting of repeated labels (jsSyntaxTree parity, as a toggle).
- [ ] Settings panel: font size, spacing, edge style, per-node colors.
- [ ] Multiple named trees / tabs (researchers juggle sets of sentences).
- [ ] More templates beyond X-bar (CP/TP clause skeleton, coordination).
