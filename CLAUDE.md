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
| `brackets.ts` | Pure, DOM-free helpers for the text pane: bracket matching, matched-pair-at-caret detection, highlight-HTML building, and edit diff/position tracking. Unit-testable without a browser. |
| `render.ts` | `Tree` → `<svg>`. Two passes (layout positions, then draw). Handles triangles, scripts, movement arrows, leaf alignment, bounding-box sizing. Tags each node group with `data-node-id`. |
| `edit.ts` | Pure tree ops: add child/sibling (positional), delete (promotes children), wrap, templates (X-bar, CP/TP, coordination), `linkNodes`/`nextSubscript` (movement-arrow tool), `applyAutoSubscripts` (auto-subscript display option), `reparent`, `isDescendant`. |
| `export.ts` | Download SVG / PNG (SVG rasterized via canvas) / LaTeX `forest`, plus clipboard copy (PNG image, SVG markup). |
| `history.ts` | Undo/redo over document snapshots (bracket strings). |
| `persist.ts` | Autosave the document to localStorage + shareable URL fragment (`#t=`); persist the theme and the display prefs (`savePrefs`/`loadPrefs`: font size, spacing, edge style, align/boxes toggles, auto-subscript). |
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
- **Arrow-link mode** (`toggle-link` in `app.ts`) is a two-click node picker, same
  spirit as Move mode, mutually exclusive with it (enabling one turns off the
  other). It doesn't add new data or notation — it just automates giving two
  nodes a shared subscript, so the existing derived-arrow rendering picks it up.
- Per-node `color` (like `id`) is session-only state, not part of the bracket
  notation — it's lost on any edit that re-parses the whole tree from text.
- **Auto-subscript** (`settings.autoSubscript`) writes to a *transient*
  `Node.autoSubscript` field, recomputed on every `buildSVG` by
  `applyAutoSubscripts`. Only non-terminal (internal) nodes are numbered —
  terminals (words) are excluded, since repeated words are common and
  numbering them would be noise, not signal. It's never serialized and never
  fed to `collectMovement`, so it can't pollute the notation or draw arrows.
  Render/measure/export read `Node.displaySubscript()` (manual `subscript`
  wins over `autoSubscript`); the real `subscript` is what serialize, movement
  arrows, and inline editing use.
- **Text-pane bracket handling** (`app.ts`, textarea `keydown`): IDE-style — select
  text + `[` wraps it; `[` alone inserts `[]` with the caret inside; `]` types over
  an auto-inserted `]` (only); Backspace between an empty `[]` deletes both.
  Type-over is gated on `autoCloses`, the tracked indices of `]` we auto-inserted:
  positions are kept in sync with edits (`reconcile`, via `diffRange`/`adjustIndex`)
  and dropped once the caret leaves their pair (`pruneAutoCloses`). A `]` the user
  typed themselves is never in that set, so it's always inserted literally.
- **Text-pane syntax highlighting**: the `<textarea>` renders transparent glyphs
  over a mirror `<div>` (`#text-highlights`) that re-renders the same text with the
  matching bracket pair at the caret boxed (VS Code style, matching-pair only). The
  two layers share identical text metrics (CSS) or the caret drifts; the mirror's
  scroll is synced to the textarea, and `.bracket-match` may only carry
  color/background styling (nothing that changes glyph width).
- **Accessibility**: the SVG is an ARIA tree (`role="tree"` + `treeitem` groups
  with `aria-level`/`aria-selected`/`aria-expanded`). Node keyboard focus uses a
  *roving tabindex* (only the selected node — or the root — is tabbable) and DOM
  focus is re-synced to the selection after every full re-render, since `render()`
  rebuilds the SVG from scratch and drops focus. Keep focus following selection if
  you touch `renderTree`.
- **Responsive**: the split is a flexbox that switches to `column` under 760px; the
  divider drag reads `flex-direction` to resize along the right axis. Anything new
  in the toolbar should tolerate wrapping.
- Module imports use explicit `.js` extensions (ESM output).
- `id` on `Node` is a per-session counter, not persisted.

## TODO — open fixes & improvements

(Completed work is documented in the sections above, not tracked here.)

Fixes / robustness
- [ ] Adjacent single-word leaves are lossy on round-trip; warning exists but a
      real fix (distinct separator or lossless serialization) would be better.
- [ ] Add an actual automated test suite (parser/serializer round-trip unit tests
      + a Playwright smoke test) instead of ad-hoc scripts.

Features
- [ ] Zoom & pan + "fit to view" for large trees (canvas only scrolls today).
- [ ] Multiple named trees / tabs (researchers juggle sets of sentences).
- [ ] Configurable keyboard shortcuts. Bindings are a hardcoded `switch (e.key)`
      in `app.ts`, and the help modal's shortcut table (`index.html`) is a
      separate hand-written list with no structural link to it — nothing
      generates one from the other or checks them against each other, so they
      can silently drift out of sync as shortcuts are added/changed (already a
      manual-discipline risk after adding `Shift+B` for CP/TP). A settings-driven
      key map, with the help table rendered from it, would remove both problems
      (remapping + drift) at once.
