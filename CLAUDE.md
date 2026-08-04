# CLAUDE.md

Guidance for working in this repository.

## What this is

**Syntax Tree Plus** — a browser-based, hybrid syntax-tree editor for linguists.
A tree can be edited two ways that stay in sync:

- **GUI**: click/keyboard/toolbar/drag on an SVG rendering.
- **Text**: jsSyntaxTree-compatible labelled bracket notation in a side pane.

A *document* (one tab) is a sequence of top-level bracket groups, so it can hold
**several trees** — `[S …] [S …]` — all drawn on the same canvas.

No framework, no runtime dependencies. Plain TypeScript compiled to ES modules,
served as static files.

## Build & run

```sh
pnpm install
make build      # tsc -> dist/, then copy non-.ts files (html/css) into dist/
make serve      # serve dist/ locally
make dist       # point dist/ at the gh-pages branch (once, before the first deploy)
make deploy     # build + publish dist/ to gh-pages
pnpm run watch  # rebuild + serve on change
```

- `tsc` outputs to `dist/` (see `tsconfig.json`: rootDir `src`, outDir `dist`).
  Target is **ES2020** with `moduleResolution: bundler` — the sources import with
  explicit `.js` extensions and the output is loaded as native ES modules by the
  browser, so nothing bundles or down-levels it. Note `noEmitOnError` is off (the
  tsc default), so a type error still writes JS; `make` halting on the `tsc` step
  is what stops a broken build, and the `copy` step never runs — a `dist/` with
  scripts but no `index.html` means the compile failed.
- `dist/` is git-ignored in the main worktree because it *is* the `gh-pages`
  worktree: `make dist` attaches it (creating the branch from `origin/gh-pages`,
  or bootstrapping a parentless one on a repo that's never deployed). It's
  idempotent and never switches branches in the main worktree. `make clean`
  empties `dist/` but deliberately spares `dist/.git`, which would break the
  worktree.
- **`gh-pages` holds no history**: each `make deploy` replaces it with a *single
  parentless commit*, built by `git commit-tree` (idempotent where
  `checkout --orphan` was not) and force-pushed, since a parentless commit is
  never a fast-forward. The message names the source commit
  (`Deploy <short-sha>`), so rollback = check out that commit and deploy again.
  Deploy refuses a dirty `src/` (`ALLOW_DIRTY=1` overrides) — a build from
  uncommitted source can't be reproduced by that rebuild path.
- `make test` runs the unit tests (`test/*.test.mjs`: `roundtrip` for one tree,
  `multitree` for a whole document, `movement` for the arrow notation, `tabs` for
  the workspace model, `export-select` for the export dialog's tab-range and
  filename logic) on Node's built-in runner — no test dependency. They build first and import from
  `dist/`; `test/dom-stub.mjs` fakes the canvas that `tree.ts` measures text
  with, so the notation is testable without a browser. Import it **before** any
  module that pulls in `tree.js` (`tabs.test.mjs` needs no stub — `tabs.ts`
  imports nothing). Whole-app behaviour is still verified ad-hoc via Playwright
  driving the built app.

## Architecture (`src/scripts/`)

Pure model/logic modules with one controller wiring them to the DOM.

| Module | Responsibility |
| --- | --- |
| `tree.ts` | `Node` / `Tree` model. Node = label + `subscript`/`superscript`/`triangle` + children, plus an optional explicit `arrow` on a word. Also the document-wide terminal numbering an arrow points by (`wordColumns`/`wordColumnIndex`/`resolveArrows`). A node is either a **word** (`isWord`) or a labelled **node** — see the words-vs-nodes note below. Also width measurement and layout fields. |
| `parser.ts` | Bracket notation → trees. `parseAll` reads a whole **document** (every top-level bracket group) — that's what the app calls; `parse` is the single-tree wrapper returning the first. Own tokenizer (`[`/`]`/`_`/`^`/`->`/`<-`/`<>`/word/`"…"`); tolerant — auto-closes missing `]`, missing labels and unterminated quotes, and skips junk *between* trees. `parseLabel` splits `NP_1^0` into base/sub/sup and shares that tokenizer. An arrow marker is read only after a terminal and resolved to its target once every tree is built. Bracketing is what marks a word: bare content is a word, `[...]` is a node. |
| `serialize.ts` | `Tree` → bracket notation. Inverse of the parser: words go out bare, nodes keep their brackets (`[N]` even when childless), and a label/word is quoted only when it would otherwise be misread (see the quoting notes below), so ordinary documents stay bare. An arrow is written back as `-> N` with N recomputed from where its target sits now. `serializeAll` is the document form (one tree per line) and is what shares one column index across trees. `serializePrettyAll` (multi-line, blank line between trees) backs the toolbar's Pretty-print button and shares one column index the same way. |
| `brackets.ts` | Pure, DOM-free helpers for the text pane: bracket matching (quote-aware — a `[` inside `"…"` is label text, not structure), matched-pair-at-caret detection, highlight-HTML building, and edit diff/position tracking. Unit-testable without a browser. |
| `render.ts` | `Tree[]` → one `<svg>`. Two passes per tree (`layoutTree` positions, `drawTree` draws), then the boxes are composed onto one canvas — row or column per `settings.forestLayout`. Handles triangles, scripts, movement arrows, leaf alignment, bounding-box sizing. Tags each node group with `data-node-id`. |
| `edit.ts` | Pure tree ops: add child/sibling (positional, each with a word-or-node choice), `toggleWordNode`, delete (promotes children), wrap, templates (X-bar, CP/TP, coordination), `setArrow`/`clearArrow`/`nextArrowEnds` (movement-arrow tool), `applyAutoSubscripts` (auto-subscript display option), `reparent`, `isDescendant`. |
| `export.ts` | File *builders*, not button handlers: `pngFile`/`svgFile`/`latexFile` turn a `Tree[]` into an `ExportFile` (blob + filename), `downloadFiles` saves a batch, `uniqueFilenames` de-duplicates tab names, and `copyPNG`/`copySVGImage`/`copySVGMarkup`/`copyLaTeX` write to the clipboard, and `clipboardImageSupported`/`clipboardTextSupported` feature-detect what the browser will accept. Each call takes one tab's trees — an image carries every tree of that tab as laid out, LaTeX emits one `forest` environment per tree. Always draws with the light palette — see the export-colors note below. |
| `history.ts` | Undo/redo over document snapshots (bracket strings). One instance **per tab**. |
| `tabs.ts` | `Workspace` model: an ordered list of named documents (`TabData` = id/name/`text` + an optional `draft`) + which is active. Pure model — no DOM, no history; add/insert/remove/duplicate/move/rename/switch and `toStored`/`fromStored`. `remove` returns the tab **and the index it sat at**, since putting one back also needs its undo history — which only the controller has, so the closed-tab stack lives there. `parseTabSelection` ("1-3,5" → indices) lives here too — the export dialog's tab picker, kept beside the model it indexes into and testable without a DOM. |
| `keymap.ts` | Single source of truth for keyboard shortcuts: the command list (id/label/default key/extra aliases), user remappings, canonical key encoding, lookup, and the structural keys `rebind` refuses (`reservedKey`). The help table and the remap UI are both rendered from it, so they can't drift. |
| `persist.ts` | Autosave to localStorage: the tab **workspace** (`saveWorkspace`/`loadWorkspace`), the theme, the display prefs *and the export dialog's state* (`savePrefs`/`loadPrefs`), the keymap overrides (`saveKeymap`/`loadKeymap`) and the compact toolbar's open category (`saveToolbarCat`/`loadToolbarCat`). The URL fragment is read-on-boot only: `fragmentDoc` takes an incoming `#t=` (a shared document, which gets its own tab rather than replacing what this browser holds), `clearFragment` drops it afterwards, and `shareURL` builds a link on demand for the Share dialog — nothing mirrors the document into the address bar as it's edited. `loadDoc` remains to migrate a legacy single-doc save into a tab on boot; `saveDoc` is **unused** (the workspace blob replaced it) and only kept as its counterpart. |
| `settings.ts` | Layout/style constants, the three-way `leafAlignment`, how several trees of one document are arranged (`forestLayout`/`forestGap`), the remembered `exportPrefs` (dialog state only — it draws nothing), theme colors, and `SETTING_LIMITS`/`clampSetting` (the ranges the Settings panel's number inputs enforce and `loadPrefs` clamps to). `THEME_COLORS` + `applyThemeColors` are the single source for the light/dark drawing palette (used by both the theme toggle and the exporters) — with one gap: the **selected** label's color is hardcoded in `drawLabel` (`#0b2a4a`) and `settings.label.selectedColor` is not read by anything. |
| `toolbar.ts` | Compact (small-screen) toolbar: builds the category chip strip from the toolbar's own `.group[data-cat]` elements and shows one group at a time. Owns the `body.compact-toolbar` switch. |
| `app.ts` | Controller. Owns the document's `trees` (+ which is active) and the `Workspace`, wires toolbar/keyboard/drag/text pane, tabs, zoom/pan, inline editing, theme. |
| `main.ts` | Entry point: `startApp()`. |

## Data flow (the important part)

- **Text → trees**: `input` on the textarea → debounced `parseAll` → replace the
  document's trees → `renderTree()`. Does *not* write back to the textarea
  (avoids loops).
- **Trees → everything**: after any GUI mutation, `mutated()` = `serializeAll` →
  push history → save → set textarea value → render. Programmatic
  `textarea.value` assignment doesn't fire `input`, so there's no feedback loop.
- Selection is a single node, and **exactly one tree carries it** — `selectNode`
  clears every tree's `selectedNode` before setting one, and makes that node's
  tree the active one (`tree` / `activeIndex`), so clicking into another tree of
  the document just moves the selection there. The renderer draws whatever each
  tree reports, so a stale `selectedNode` elsewhere would show as a second
  highlighted node.
- Across a text re-parse **and across undo/redo** the selection is restored by
  `SelectionPath` = which tree + the child-index path within it (`pathOf` /
  `nodeAtPath`). When that exact path is gone (undo of an "add", a text edit
  that deleted it), `nodeAtPath` returns the **deepest surviving ancestor**
  along the path rather than the root, so undo leaves the selection where the
  user was working; a vanished *tree* index falls back to the last tree.

## Conventions & gotchas

- **No `prompt()`/`alert()` dialogs for input** — the user's environment can't use
  them. Label editing is an inline `<input>` overlay; brackets/arrows are derived
  from notation, not modal prompts.
- **Inline editing** edits the *raw token* (`DP_1`, `X^0`); `parseLabel` splits it
  on commit. `rawToken` quotes a label holding a delimiter, so reopening the editor
  on `a_b` shows `"a_b"` rather than silently re-splitting it into base +
  subscript. Blank leaves are discarded on commit/cancel.
  `renderTree()` calls `cancelInlineEdit()` before rebuilding the SVG — `render()`
  clears `#tree-container`, which is where the editor's `<input>` lives, so any
  render while it's open (`resize` is the reachable path; `startInlineEdit`
  itself calls it too, to close a stale editor before opening the next one)
  would otherwise strand it mid-edit. `cancelInlineEdit` doesn't touch the
  `<input>` directly, though: closing (or reopening over) an *unfocused* editor
  would still need to reach it, and reaching in with a bare `.remove()` is a
  trap — removing a focused element fires `blur` synchronously, which re-enters
  `finish()` and tries to remove the (already detached) input a second time. It
  instead calls the open editor's own `finish(true)` (tracked in
  `inlineEditFinish`, alongside `inlineEditor`) — the same single-fire path
  Enter/Escape/blur already use, gated by `finish`'s own `done` flag — so a
  dismiss behaves exactly like a blur (commits, doesn't discard) and can't
  double-remove the node.
- **Movement arrows are written, never inferred.** A terminal carries
  jsSyntaxTree's own arrow spelling — `-> N`, `<- N`, `<> N`, where N is the
  target's **column**: its 1-based position among the document's terminals,
  counted left to right (`wordColumns` in `tree.ts`; jsSyntaxTree's
  `findTargetLeaf` counts VALUEs the same way). `->` heads at the target, `<-`
  at the source, `<>` at both.
  - **A subscript is only a label.** Co-indexation draws nothing, which is the
    point: `John_1 … his_1` is a binding index, not movement, and no rule over
    the tree can tell the two apart. The old derivation guessed — with several
    co-indexed nodes and no `t`-style trace it fanned them all onto the topmost
    instead of chaining, and it drew arrows on binding indices — so it's gone,
    along with the trace regex that decided direction.
  - **Only terminals.** A word can carry an arrow and be a column; a labelled
    node can be neither, exactly as in jsSyntaxTree (its `parseNode` has no
    arrow branch, and `is_leaf` there means "is a VALUE"). Our `isWord` is that
    same distinction, so the two line up 1:1. The cost is an empty landing site
    (`[DP]`) can't be an endpoint — write a terminal in it (`[DP t]`), which is
    what jsSyntaxTree documents do anyway.
  - **The number is re-derived, not stored.** Parsing resolves the column to a
    node *reference* (`Node.arrow.target`, `resolveArrows`) and serializing asks
    the target where it sits now, so every GUI edit renumbers the arrows for
    free and only hand-editing the text can move one. `rawColumn` keeps a number
    that resolved to nothing (typed past the last column) so it round-trips
    instead of vanishing; a target that leaves the document drops the arrow,
    since there's nothing to point at.
  - The marker is only recognised at the **start of a token**, so `well-known`
    and `a->b` stay single words and `-> 1` needs the space in front — matching
    jsSyntaxTree, whose `parseString` also swallows `-`/`<`/`>` mid-token.
  - `Node.clone()` copies an arrow only when both ends are inside the copied
    subtree, remapped onto the copies; otherwise the copy would reference — and
    renumber against — a node in the original tree.
  - **A live reference can go stale, so `collectArrows` re-checks both ends**
    against the walk it's already doing: each must be a **word** that is still
    **in this tree**. `removeChild` leaves a detached node's `tree` field
    pointing at its old tree, so a `target.tree === tree` test passes for a
    deleted node that no longer has a layout (stale coordinates, or `NaN` if it
    was never positioned — which propagates into the box height and collapses
    the canvas). An end can also stop being a word (`toggleWordNode`,
    drag-reparenting onto it), and a non-word is neither serialized with an
    arrow nor counted as a column. `serializeAll` drops both cases already; the
    check is what keeps the drawing and the notation saying the same thing.
  - **The markers are quoted like any other delimiter** (`ARROW_TOKEN` in
    `serialize.ts`). They're the one piece of syntax that isn't a single
    character, so the character-class quoting rules couldn't see them: `[N "->"]`
    went out as `[N ->]` and came back as an empty `[N]`. The pattern matches a
    marker only at a token boundary, exactly where the tokenizer reads one, so
    `-ed`, `well-known`, `a->b` and `<p>` stay bare.
- **Words vs nodes** (`Node.isWord`, jsSyntaxTree's VALUE vs NODE). A leaf is not
  automatically a word: `[N cat]` is `N` over the **word** `cat`, while `[NP [N]]`
  is a childless **node** — a bare category, or a symbol slot the user hasn't
  filled. **Bracketing is the spelling**, so unlike per-node `color` the
  distinction lives in the notation and survives a text round-trip and undo/redo.
  What it drives: italics (words only), triangles (words only), `words`-mode
  alignment, auto-subscript (nodes only), and the `\textit{}` in the LaTeX export.
  `isWord` is a *derived* getter — it also requires the node be childless, so a
  word that acquires children (drag-reparenting) silently becomes a node instead
  of serializing to something that would drop the subtree. The toolbar exposes it
  three ways: **+ Child** makes a node, **+ Text** makes a word, and
  **Word/Node** (`Shift+W`, `toggleWordNode`) flips a leaf. A new sibling
  inherits the kind of the node it's added beside.
- **Alignment has three modes** (`settings.leafAlignment`, cycled by ⇅ Align),
  ported from jsSyntaxTree: `top` (every node at its own depth), `words` (words
  drop to a common bottom row, nodes stay put — so a `[N]` sits with the
  structure, not the lexicon), and `bottom` (every leaf on the bottom row, each
  parent pushed to just above its highest child). `alignmentDepths` in `render.ts`
  computes the rows. One deliberate divergence: jsSyntaxTree's `moveParentsDown`
  takes a minimum over an empty child list, so a childless node lands at
  `Infinity` and disappears in its bottom mode; ours puts every leaf on the
  bottom row.
- **Triangles / terminal spans**: a multi-word terminal auto-triangles
  (`derivedTriangle` in `tree.ts`: does the label contain a space). Scripts
  bind to the **whole run**, not its last word — `[NP the big cat_1]` is the span
  "the big cat" with subscript 1, so a triangle can carry a movement index. This
  matches jsSyntaxTree, whose tokenizer splits `_`/`^` out of a word run and
  attaches them to the joined value. A word's actual `triangle` can disagree
  with what its label derives — toggling it with `t` (`toggleTriangle`) is the
  normal way — but **that disagreement is never written into the notation**:
  jsSyntaxTree has no per-node triangle spelling at all (only a global
  checkbox), and a per-node marker character was tried and deliberately
  reverted to stay compatible, so `serialize` is a pure function of the label
  and blind to `triangle` either way — a manual toggle is session-only, same
  as `color`. The jsSyntaxTree-compatible knob is instead
  `settings.showTriangles` (▽ Triangles button, `toggle-triangles`): a global,
  notation-independent override that suppresses every triangle at draw time
  (`render.ts`) regardless of word count or a node's own `triangle`, mirroring
  jsSyntaxTree's "Enable triangles" checkbox exactly. Renaming a leaf via the
  inline editor re-derives `triangle` from the new label from scratch rather
  than only ever setting it `true`, so shrinking `the big cat` to `cat`
  correctly drops the triangle instead of leaving it stuck.
- **Quoting, not escaping.** There is no backslash escape character — jsSyntaxTree
  has none — and a `"…"` string is how a literal space, `_`, `^`, `[` or `]`
  gets into a label (`[N "a_b"]`, `["my node" x]`). Inside quotes every character
  is literal *except* the quote itself: **two quotes in a row (`""`) is a literal
  `"`** (SQL/CSV-style doubling — the one addition beyond jsSyntaxTree's own
  quoting, since its quoted strings have no inner escape at all), and a single
  `"` still ends the string, so `[N "he said ""hi"" to me"]` keeps its literal
  quotes instead of losing them. An unterminated quote runs to end of input, like
  a missing `]`. The old backslash scheme was a local invention the parser never
  honoured and is gone — a `\` is now ordinary text (legacy documents still
  parse, just with the backslash literal).
- **Adjacent terminals are quoted.** Consecutive *bare* terminals serialize to one
  space-separated run and would merge into a single span on re-parse, so
  `serializeNode` quotes a word that has a *word* neighbour: `[NP "the" "cat"]`,
  `[NP "the big" "old cat"]`. A quoted value is never joined into a neighbouring
  run (jsSyntaxTree's `parseValue` accumulates only unquoted tokens), which is
  what makes two adjacent spans expressible — the last arrangement that wasn't.
  A lone terminal keeps the readable bare spelling, so ordinary documents acquire
  no quotes at all. Only *words* can merge, so a node neighbour needs no quoting
  (`[NP the [N]]`). The bracketed spelling `[NP [the] [cat]]` is a different tree
  — two childless nodes — and now round-trips as itself rather than being
  rewritten into quoted words.
  Because nothing is lossy any more, the **round-trip warning banner is retired**:
  `#round-trip-warning` is an empty, permanently hidden slot and
  `updateRoundTripWarning` only clears it. Reuse or delete both if no other
  warning needs the space — it isn't dead code by accident.
- **Drag-to-move** uses Pointer Events (touch/pen ok) and only re-parents onto a
  non-descendant; a caret shows the drop index. It's behind the "Move" mode toggle.
- **Arrow-link mode** (`toggle-link` in `app.ts`) is a two-click **word** picker,
  same spirit as Move mode, mutually exclusive with it (enabling one turns off
  the other). It writes real notation (`setArrow`), and picking the same pair
  again cycles the ends `->` → `<-` → `<>` → off (`nextArrowEnds`) — that
  cycle *is* the direction UI, so no extra buttons. Clicking a labelled node
  says so in a toast instead of silently doing nothing.
- Per-node `color` (like `id`) is session-only state, not part of the bracket
  notation — it's lost on any edit that re-parses the whole tree from text.
- **Auto-subscript** (`settings.autoSubscript`) writes to a *transient*
  `Node.autoSubscript` field, recomputed on every `buildSVG` by
  `applyAutoSubscripts`. Only nodes are numbered — **words** are excluded, since
  repeated words are common and numbering them would be noise, not signal. A
  childless node (`[N]`) is still a node and does get numbered, matching
  jsSyntaxTree's `assignSubscripts`. It's never serialized and never
  fed to `collectMovement`, so it can't pollute the notation or draw arrows.
  Render/measure/export read `Node.displaySubscript()` (manual `subscript`
  wins over `autoSubscript`); the real `subscript` is what serialize, movement
  arrows, and inline editing use.
- **Text-pane bracket handling** (`app.ts`, textarea `keydown`): IDE-style — select
  text + `[` wraps it; `[` alone inserts `[]` with the caret inside; `]` types over
  an auto-inserted `]` (only); Backspace between an empty `[]` deletes both. The
  handler bails immediately on `isComposing` (an IME keystroke isn't a literal
  character yet) or any of Ctrl/Alt/Meta, so a chord that happens to end in `[`
  reaches the browser unmodified instead of being hijacked as auto-pairing.
  Type-over is gated on `autoCloses`, the tracked indices of `]` we auto-inserted:
  positions are kept in sync with edits (`reconcile`, via `diffRange`/`adjustIndex`)
  and dropped once the caret leaves their pair (`pruneAutoCloses`). A `]` the user
  typed themselves is never in that set, so it's always inserted literally.
  `diffRange`/`adjustIndex` are reused for the text-pane caret itself:
  `restoreFromHistory` (undo/redo, a fixed key that fires even mid-typing) maps
  the pre-undo caret across the diff between the old and new text instead of
  letting the `.value` assignment reset it to the end — falling back to the
  start of the changed range when the caret sat inside whatever the undo
  replaced, since there's no meaningful "same spot" to map to there.
- **Text-pane syntax highlighting**: the `<textarea>` renders transparent glyphs
  over a mirror `<div>` (`#text-highlights`) that re-renders the same text with the
  matching bracket pair at the caret boxed (VS Code style, matching-pair only). The
  two layers share identical text metrics (CSS) or the caret drifts; the mirror's
  scroll is synced to the textarea, and `.bracket-match` may only carry
  color/background styling (nothing that changes glyph width).
- **An export is a picture of the tree, not of the editing session.** Two things
  are stripped:
  - *Colors* — `withExportColors` (`export.ts`) draws with the light palette
    whatever the UI theme is, since the PNG rasterizer fills a white canvas and
    an exported SVG normally lands in a white document, where dark-theme (light
    grey) text would be invisible. Temporary, restored in a `finally`. Per-node
    `color` overrides are the user's explicit choice and are left alone.
  - *Selection* — `RenderOptions.showSelection` (default: `interactive`) gates
    the selection box **and** the tinted label, so a download doesn't carry
    whichever node happened to be selected. `drawLabel` keeps the model's
    `isSelected` separate from the visual `selected`: ARIA and the roving
    tabindex read the former, only the drawing reads the latter.
- **Exporting goes through one dialog** (`#export-modal`, the single ⭳ Export
  button). It picks a *format* (PNG default / SVG / LaTeX), its options, and
  *which tabs*, then ends in **Download** or **Copy to clipboard**. The rules
  that aren't obvious from the markup:
  - **Options are per format, and the dialog owns the switch.** `data-format`
    rows are toggled by `syncExportUI`, not by CSS — scale (×0.5/×1/×2/×4) and
    transparency are **PNG only**. SVG has no scale on purpose: it's vector, so
    a scale factor would only set a default placement size, not fidelity.
  - **One file per tab.** A tab is a document, so exporting several yields
    several files — the trees of *different* tabs are never composed onto one
    canvas the way the trees *within* a tab are. `downloadFiles` paces the
    saves (~250ms apart) because browsers throttle, and Chrome blocks,
    downloads fired back-to-back from one gesture.
  - **LaTeX is the one format that can combine**, since a `.tex` is just text:
    the combine checkbox appears only once **more than one** tab is selected
    (with one tab it would be a no-op) and concatenates every tab's trees into
    a single file named `syntax-trees.tex`.
  - **Copy is single-item by nature.** The clipboard holds one thing, so
    an image copy (PNG, or SVG-as-picture) is *disabled* once several tabs
    are selected; a text copy (LaTeX, or SVG-as-markup) stays enabled and
    concatenates instead, because pasting text has an obvious multi-tab
    answer. `copySVGImage` puts `image/svg+xml` **and** a PNG in one
    `ClipboardItem` so vector-aware apps keep it scalable and everything else
    still pastes a picture — with a PNG-only retry, since browsers disagree
    about which MIME types `write` accepts and one unsupported type rejects
    the whole item.
  - **SVG alone gets a three-way choice**: Download, Copy as Image, Copy as
    Code — a vector can honestly be either, where PNG and LaTeX each have one
    obvious clipboard meaning and keep a single generic Copy button.
    `clipboardImageSupported()`/`clipboardTextSupported()` feature-detect
    `ClipboardItem`/`navigator.clipboard` up front, so an unsupported copy
    mode is *greyed out* with an inline explanation rather than failing at
    click time — Firefox lacking image-clipboard support is the case this
    exists for.
  - **Filenames come from tab names**, sanitized, with repeats numbered from
    the second occurrence (`dup.png`, `dup(2).png`) — two tabs may share a
    name, but two downloads that share one overwrite each other.
  - **A malformed custom range is refused, not trimmed.** `parseTabSelection`
    returns `null` for anything out of range, reversed or unparseable, and the
    dialog disables both buttons — exporting a silent subset of what was asked
    for is the worse failure.
  - The dialog's state (format/scale/transparency/scope/combine) persists with
    the other display prefs; `custom` scope deliberately doesn't restore, since
    the range referred to a tab layout that may no longer exist.
- **Accessibility**: the SVG is an ARIA tree (`role="tree"` + `treeitem` groups
  with `aria-level`/`aria-selected`). There is deliberately **no `aria-expanded`**
  — nothing can collapse a subtree, so advertising that state would mislead
  screen readers; add it back if collapse/expand ever lands. Node keyboard focus uses a
  *roving tabindex* (only the selected node — or the root — is tabbable) and DOM
  focus is re-synced to the selection after every full re-render, since `render()`
  rebuilds the SVG from scratch and drops focus. Keep focus following selection if
  you touch `renderTree`.
- **Responsive**: the split is a flexbox that switches to `column` under 760px; the
  divider drag reads `flex-direction` to resize along the right axis. Anything new
  in the toolbar should tolerate wrapping.
- **Compact toolbar** (`toolbar.ts` + `body.compact-toolbar`): all ~35 buttons
  wrapped to ~380px of chrome on a phone — more than the canvas. On a narrow (or
  short-and-touch) screen the toolbar instead shows one category at a time: a
  scrollable strip of chips in `#toolbar-cats`, the open category's buttons on
  their own scrollable row, and `.group.quick` (undo/redo, settings/help) always
  visible. Three rules keep it maintainable:
  - **The chips are generated from the groups.** A category *is* a
    `.group[data-cat]` in `index.html` (with `data-cat-label`/`data-cat-icon`);
    adding one to the markup is the whole change, and the two layouts can't drift.
  - **Nothing is re-parented** — only a class toggles, and the compact rows are
    `order` on the existing flex children. Every button stays where `app.ts` put
    it, so the delegated `data-action` handler, `updateHistoryButtons()` and the
    `.active` toggles on Move/Arrow need no compact-mode special case.
  - **JS owns the switch.** The CSS keys on the body class, not a media query,
    so the layout and the chip state can't disagree; the pre-existing 760px
    tweaks remain the no-JS fallback. Tapping the open chip closes the row (the
    choice persists via `saveToolbarCat`, where `""` means "collapsed").
- **Several trees in one tab.** A document is a *sequence* of top-level bracket
  groups, so `[S …] [S …]` is two trees, not a parse error, and the controller
  holds `trees: Tree[]` with `tree` pointing at whichever one has the selection.
  Nothing about a single tree changed — each is laid out independently and then
  translated into its slot (`buildSVG` composes; `settings.forestLayout` picks
  side-by-side or stacked, persisted with the other display prefs). The rules
  that fall out of "the trees are independent":
  - **Arrow columns are per document, arrows are per tree.** `wordColumns` counts
    every tree's terminals (jsSyntaxTree numbers across its invisible root the
    same way), so `-> N` can name a word in another tree — but `collectArrows`
    skips such a pair, since each tree is laid out in its own coordinate space
    and drawn into its own group, leaving nowhere to put the curve. The number
    survives serialization, so the arrow starts drawing if the two ends ever end
    up in one tree. Arrow mode refuses a cross-tree pair with a toast rather
    than writing an arrow that can't be drawn.
  - **A root isn't draggable.** Detaching it would leave its tree rootless.
    (With one tree this was already impossible — every drop target was its own
    descendant — so `updateDropTarget` now says so explicitly.) Dragging a
    non-root *into* another tree is fine and moves the subtree across.
  - **One tab stop for the whole canvas**, chosen across all trees in
    `buildSVG` — otherwise every unselected tree's root would be tabbable. Each
    tree gets a `<g role="group" aria-label="Tree n of m">` wrapper when there
    are several; with one tree the wrapper is `role="none"`, which keeps the
    node groups direct `treeitem`s of the enclosing `role="tree"` exactly as
    before.
  - **Exports cover the document**, not the active tree: one image with every
    tree, one `forest` environment per tree in LaTeX.
  - Keys: `Shift+T` adds a tree after the active one (`a` is "add word"),
    `Shift+D` deletes it (refusing the last one; it's an ordinary edit, so
    Ctrl+Z brings it back). On a **root**
    — which has no siblings — `←`/`→` step to the previous/next tree and
    `Shift+←`/`→` reorder them, mirroring sibling navigation one level down.
- **Tabs** (`tabs.ts` + `#tabbar`): a `Workspace` holds several named documents;
  only the active one's trees are live. A tab is the unit of *naming, undo and
  persistence*; a tree is one bracket group inside it (see the bullet above) —
  so several related examples can share a tab and its history, or sit in
  separate tabs with separate ones. The controller keeps a `Map<tabId,
  History>` so **undo is per-tab**, swapping `historyStack` on switch. The whole
  workspace is persisted as one JSON blob; the active tab's text is mirrored to
  `#t=` so share links keep working, and a legacy single-doc save migrates into
  a tab on boot. The last tab can't be closed. The rest follows from "a tab is a
  document the user can lose":
  - **`text` is the document; `draft` is what's being typed.** A tab carries
    both: `text` is the last string that *parsed* — what the canvas, the undo
    history and `#t=` are all built from — and `draft` holds pane text the
    parser rejected. Every debounced text edit parks one or the other
    (`persistActive` / `persistDraft`), and so does leaving a tab
    (`flushActiveText`, on switch/add/close), so a half-typed tree survives a
    switch *and* a reload instead of being dropped; the tab wears a `•` while it
    holds one. Text that parses — or any GUI edit — supersedes the draft.
    `loadActiveTab` rebuilds trees from the tab's **own** `text` and nothing
    else: falling back to the live `trees` handed two tabs the same `Tree`
    objects, and the first edit then serialized the old document into the new
    tab.
  - **A shared `#t=` document arrives as its own tab.** The fragment normally
    just mirrors the active tab, so on boot one that matches a tab already held
    is that mirror and only gets focused; anything else came from somebody
    else's link and lands in a new "Shared" tab. It used to overwrite the active
    tab — localStorage included, with no undo, since history is keyed per tab id
    and the pre-boot text was never pushed.
  - **Closing is undoable.** `closeTab` pushes the tab, its index *and* its
    `History` onto a bounded stack (`CLOSED_LIMIT`), and the toast grows a
    **Reopen** button — `flashStatus` takes an optional action, and
    `#status-toast` only accepts pointer events (and stays up longer) when it
    carries one, so an ordinary message still can't intercept a click meant for
    the canvas. Reopening re-inserts the tab under the **same id**, which is
    exactly what hands it back its undo stack.
  - **Duplicate / reorder / switch.** `⧉` in the tab bar copies the active tab in
    beside itself (new id, so it gets its own history). Tabs drag sideways to
    reorder: pointer events like node dragging, mouse/pen on a 5px move and
    touch after a long press, since the bar is a horizontal scroller and a short
    touch-drag has to stay a scroll; the pointer is captured on the **bar**, so
    re-rendering the tab under the cursor doesn't end the drag.
    `Ctrl+1…9` (9 = last) and `Ctrl+Alt+←/→` switch, and are **fixed** keys
    handled beside Ctrl+Z *before* the "is the user typing" guard — you
    shouldn't have to leave the text pane to reach another document.
    `new-tab`/`duplicate-tab`/`reopen-tab` are ordinary remappable `COMMANDS`
    (`Ctrl+Alt+N`/`D`/`Z`, each with a `Meta+…` alias for macOS). `Ctrl+Tab` is
    handled as well, but most browsers keep it for their own tab strip.
- **Zoom & pan**: zoom scales the *rendered* `<svg>`'s `width`/`height` (its
  `viewBox` is fixed), so the pane's native scrollbars do the panning — no custom
  transform math on the tree. `setZoom` keeps a client anchor point fixed
  (cursor for Ctrl/⌘+wheel, pane centre for buttons/keys); `fitToView` never
  enlarges past 100%. Background drag-to-pan is a `#tree-pane` pointer handler
  that's a no-op over a node or while Move/Arrow mode is on, and it sets
  `suppressClick` so the pan doesn't end as a deselect.
- **Configurable shortcuts** (`keymap.ts`): the keydown handler resolves a
  *canonical* key string (`canonicalFromEvent`: modifiers + key, single chars
  lower-cased with `shift` carrying case) through `commandForKey`, then runs the
  matching `actions[id]`. Structural keys (arrows, Shift+arrows, Ctrl+Z/Y, tab
  switching, Esc) stay hardcoded and non-remappable; everything else is a
  `COMMANDS` entry with a remappable primary key (+ optional fixed aliases like
  `Enter`/`F2`). Zoom commands are `global` (run without a selection). The
  Settings panel captures a keypress to rebind (capture-phase listener);
  overrides persist via `saveKeymap`. **Add a shortcut by adding a `COMMANDS`
  entry**, not a `switch` case — the help table and remap UI regenerate from the
  list. Three rules the rebind path enforces, each of which used to be a way to
  end up with a binding that never fires:
  - **The structural keys are reserved** (`reservedKey`, a list beside
    `FIXED_KEYS`). `rebind` refuses them with the `{ id: "" }` sentinel its doc
    comment always promised, and the toast names what the key does instead
    ("↑ is reserved for moving the selection"). Scanning only `COMMANDS`
    accepted `ArrowUp`/`Ctrl+z`/`Escape` and then let `app.ts` answer them
    first. A `COMMANDS` default that collides with the list is a test failure
    (`test/keymap.test.mjs`), so the two can't drift.
  - **Undo/redo don't swallow `Alt`.** `app.ts` matches Ctrl/⌘+Z/Y with
    `!e.altKey`, since the tab commands live on Ctrl+Alt+… — without it
    `Ctrl+Alt+Z` (`reopen-tab`) was eaten by undo before the keymap saw it.
  - **`Shift` is only part of a binding when it picks a letter's case.** On a
    punctuation key the shifted glyph *is* `e.key` (`+` for Shift+=), so
    `canonicalFromEvent` drops the modifier there — `Shift++` was a spelling
    nothing typed or rendered, which is why zoom-in's advertised `+` did
    nothing. `+` is now a fixed alias of `zoom-in` (primary: `=`), and
    `displayKey` reads a trailing `+` as the key rather than the separator.
- **An armed rebind can't outlive its panel.** Closing Settings *any* way
  disarms it: the backdrop click runs the `close-settings` action rather than
  just dropping the class, Escape goes through the same action, and the
  capture-phase listener bails (clearing `capturingFor`) if the panel isn't
  open. It swallows the next keypress by design — one that landed in the text
  pane after a backdrop close used to be silently bound to whatever row was
  armed.
- **The numeric settings enforce the range they advertise.** `SETTING_LIMITS`
  (`settings.ts`) is the one place the bounds live: `bindNumberSetting` writes
  them onto the `<input>`, ignores an out-of-range value while *typing* (`1` on
  the way to `12` is mid-edit, not a mistake) and clamps on `change`, and
  `loadPrefs` clamps a persisted value to the same bounds. The markup's
  `min`/`max` used to be decoration — the handlers took any `> 0`, so a
  typed-in font size of 400 went straight into the layout.
- **Sharing is an explicit act; the URL is not a mirror.** `#t=` used to be
  rewritten by `saveWorkspace` on *every* edit (`history.replaceState` with the
  whole document — multi-KB URLs per keystroke). Now nothing writes the address
  bar during editing: the **Share** button (beside Export) builds the link on
  demand with `shareURL(text)`, shows it as selectable text in `#share-modal`
  and copies it on request. Boot still *reads* an incoming `#t=` — same rule as
  before, a shared document lands in its own tab — and then calls
  `clearFragment()`, because a fragment nothing keeps current would otherwise
  re-open that tab on every later reload. A `hashchange` listener runs the same
  adoption path, since a link pasted into the address bar of an already-open app
  changes only the fragment and never reloads (`replaceState` doesn't fire
  `hashchange`, so clearing it can't loop). `updateFragment` is gone; `saveDoc`
  (already unused) no longer touches the URL either.
- **Toolbar icons that must survive a phone are inline SVG**, not glyphs.
  Export's `⭳` (U+2B73) is absent from the default font on most mobile
  browsers, where it rendered as an empty box; `svg.icon` (Export, Share) draws
  it with no font dependency, sized in `em` and stroked with `currentColor`, so
  it still tracks the button's font size, the theme and the `.active` state.
  Prefer this over an exotic codepoint for anything new in `.group.quick`.
- **A modal is a head plus a scroller** (`.modal-body.paneled` > `.modal-head` +
  `.modal-scroll`): the title row is a non-scrolling flex item and only the
  content moves. The head was `position: sticky` with negative margins, but
  sticky pins the *margin* box — so the painted row sat 24px below the
  scrollport's top edge and content scrolled visibly through the transparent
  strip above it (plainly wrong on a phone, where the panel is nearly
  full-height). Keep new panels in that shape, and note `.modal-scroll > button`
  is what styles a panel's own Close button now.
- Module imports use explicit `.js` extensions (ESM output).
- `id` on `Node` is a per-session counter, not persisted.
- **Deliberately unwired exports.** Several exports exist with no caller and are
  not dead code by accident: `saveDoc` (counterpart of the legacy `loadDoc`),
  `keymap.bindingToDefault`, `Workspace.single`, `edit.addChild`/`addSibling`
  (back-compat wrappers over the positional forms) and
  `settings.label.selectedColor`. `deleteNode`/`wrapNode` also take a `tree`
  argument that only `wrapNode` uses. Check this list before "cleaning up" or
  re-implementing one of them.

## TODO — open fixes & improvements

(Completed work is documented in the sections above, not tracked here.)

Bugs
- [ ] **LaTeX export drops movement arrows.** `toLatex` emits nodes only, so a
      document's arrows survive SVG and PNG but vanish in `forest` output. Now
      that arrows are explicit (`Node.arrow`), each end can be given a `name=`
      and the arrow drawn with a `\draw[->]` in the environment's tikz layer.

Robustness
- [ ] **Accessibility outside the SVG.** The tree itself is a proper ARIA tree,
      but its surroundings aren't: the modals are bare `<div class="modal">` (no
      `role="dialog"`/`aria-modal`, no focus trap, focus isn't restored on close),
      `#parse-error` and the `#status-toast` aren't live regions, so parse errors
      and every toast ("Copied", "Only a leaf can be a word") are never announced,
      every tab in `#tabbar` is `tabIndex=0` where `role="tab"` wants a roving
      tabindex plus an `aria-controls` target, and `#divider` has no
      `role="separator"` or keyboard resize.
- [ ] **A long share link is still a long URL.** `shareURL` percent-encodes the
      raw document, so a big document makes a link some chat apps truncate (the
      dialog warns past 2000 characters). Compressing the payload — or a
      shortening step — would lift the ceiling.
- [ ] Extend the test suite: `make test` covers parser/serializer round-trips
      (`test/roundtrip.test.mjs`, `test/multitree.test.mjs`), movement arrows
      (`test/movement.test.mjs`, which also reaches `setArrow`/`clearArrow`/
      `nextArrowEnds`), the workspace model (`test/tabs.test.mjs`), the pure
      text-pane helpers (`test/brackets.test.mjs`: bracket matching,
      matched-pair-at-caret, and the diff/index-mapping pair), the export
      dialog's pure parts (`test/export-select.test.mjs`) and the keymap
      (`test/keymap.test.mjs`: reserved keys, conflicts, canonical/display
      spelling), but `edit.ts` is still untested, and there's no Playwright
      smoke test in-repo yet (ad hoc runs against a `make serve` build are how
      the fixes above were checked).

Features
- [ ] **Export options still missing**: the dialog covers scale, transparency
      and tab selection, but not a ZIP for a many-tab export (N separate saves
      is clumsy past a handful) or a page-size/margin control for the PDF-ish
      workflows people use the SVG for.
- [ ] **Font family picker.** `settings.label.fontFamily` exists with no UI, and
      font choice matters for publication figures.
- [ ] **Toolbar actions with no `COMMANDS` entry** (`coordination`,
      `paste-before`, `toggle-align`, `toggle-boxes`, `toggle-triangles`,
      `toggle-theme`, `new-tab`, `export`, `share`) have no key and therefore no
      row in the help table — the table only renders `FIXED_KEYS` + `COMMANDS`.
      Give them entries, or render the keyless actions too so Coord/Paste ◀ stop
      being invisible to keyboard users.
