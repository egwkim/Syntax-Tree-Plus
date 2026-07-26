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
- `make test` runs the parser/serializer round-trip tests (`test/*.test.mjs`:
  `roundtrip` for one tree, `multitree` for a whole document) on
  Node's built-in runner — no test dependency. They build first and import from
  `dist/`; `test/dom-stub.mjs` fakes the canvas that `tree.ts` measures text
  with, so the notation is testable without a browser. Import it **before** any
  module that pulls in `tree.js`. Whole-app behaviour is still verified ad-hoc
  via Playwright driving the built app.

## Architecture (`src/scripts/`)

Pure model/logic modules with one controller wiring them to the DOM.

| Module | Responsibility |
| --- | --- |
| `tree.ts` | `Node` / `Tree` model. Node = label + `subscript`/`superscript`/`triangle` + children. A node is either a **word** (`isWord`) or a labelled **node** — see the words-vs-nodes note below. Also width measurement and layout fields. |
| `parser.ts` | Bracket notation → trees. `parseAll` reads a whole **document** (every top-level bracket group) — that's what the app calls; `parse` is the single-tree wrapper returning the first. Own tokenizer (`[`/`]`/`_`/`^`/word/`"…"`); tolerant — auto-closes missing `]`, missing labels and unterminated quotes, and skips junk *between* trees. `parseLabel` splits `NP_1^0` into base/sub/sup and shares that tokenizer. Bracketing is what marks a word: bare content is a word, `[...]` is a node. |
| `serialize.ts` | `Tree` → bracket notation. Inverse of the parser: words go out bare, nodes keep their brackets (`[N]` even when childless), and a label/word is quoted only when it would otherwise be misread (see the quoting notes below), so ordinary documents stay bare. `serializeAll` is the document form (one tree per line). `serializePretty` (multi-line) exists but is **unused**. |
| `brackets.ts` | Pure, DOM-free helpers for the text pane: bracket matching (quote-aware — a `[` inside `"…"` is label text, not structure), matched-pair-at-caret detection, highlight-HTML building, and edit diff/position tracking. Unit-testable without a browser. |
| `render.ts` | `Tree[]` → one `<svg>`. Two passes per tree (`layoutTree` positions, `drawTree` draws), then the boxes are composed onto one canvas — row or column per `settings.forestLayout`. Handles triangles, scripts, movement arrows, leaf alignment, bounding-box sizing. Tags each node group with `data-node-id`. |
| `edit.ts` | Pure tree ops: add child/sibling (positional, each with a word-or-node choice), `toggleWordNode`, delete (promotes children), wrap, templates (X-bar, CP/TP, coordination), `linkNodes`/`nextSubscript` (movement-arrow tool), `applyAutoSubscripts` (auto-subscript display option), `reparent`, `isDescendant`. |
| `export.ts` | Download SVG / PNG (SVG rasterized via canvas) / LaTeX `forest`, plus clipboard copy (PNG image, SVG markup, LaTeX). Takes the whole document (`Tree[]`) — an image carries every tree as laid out, LaTeX emits one `forest` environment per tree. Always draws with the light palette — see the export-colors note below. |
| `history.ts` | Undo/redo over document snapshots (bracket strings). One instance **per tab**. |
| `tabs.ts` | `Workspace` model: an ordered list of named documents (`TabData` = id/name/text) + which is active. Pure model — no DOM, no history; add/remove/rename/switch and `toStored`/`fromStored`. |
| `keymap.ts` | Single source of truth for keyboard shortcuts: the command list (id/label/default key/extra aliases), user remappings, canonical key encoding, and lookup. The help table and the remap UI are both rendered from it, so they can't drift. |
| `persist.ts` | Autosave to localStorage + shareable URL fragment (`#t=`): the tab **workspace** (`saveWorkspace`/`loadWorkspace`, active doc mirrored to `#t=`), the theme, the display prefs (`savePrefs`/`loadPrefs`), the keymap overrides (`saveKeymap`/`loadKeymap`) and the compact toolbar's open category (`saveToolbarCat`/`loadToolbarCat`). `loadDoc` remains to migrate a legacy single-doc save into a tab on boot; `saveDoc` is now **unused** (the workspace blob replaced it) and only kept as its counterpart. |
| `settings.ts` | Layout/style constants, the three-way `leafAlignment`, how several trees of one document are arranged (`forestLayout`/`forestGap`), theme colors. `THEME_COLORS` + `applyThemeColors` are the single source for the light/dark drawing palette (used by both the theme toggle and the exporters) — with one gap: the **selected** label's color is hardcoded in `drawLabel` (`#0b2a4a`) and `settings.label.selectedColor` is not read by anything. |
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
- **Movement arrows** are derived, not drawn explicitly: **any** two nodes of one
  tree that share a subscript are linked. A trace (`t`, `t*`, `e`, `*` —
  `collectMovement`'s regex, case-insensitive) only decides *direction*: every
  trace points at the first non-trace occurrence. With no trace among them, each
  later occurrence points at the first, which is what makes Arrow mode work —
  `linkNodes` just co-indexes two ordinary nodes and lets the renderer derive the
  arrow. No column-number arrow syntax. A chain of more than one trace (e.g.
  successive-cyclic movement through two specifier positions) fans every trace
  out to the same antecedent instead of linking them step by step — see the
  TODO.
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
- **Triangles / terminal spans**: a multi-word terminal auto-triangles. Scripts
  bind to the **whole run**, not its last word — `[NP the big cat_1]` is the span
  "the big cat" with subscript 1, so a triangle can carry a movement index. This
  matches jsSyntaxTree, whose tokenizer splits `_`/`^` out of a word run and
  attaches them to the joined value.
- **Quoting, not escaping.** There is no escape character — jsSyntaxTree has none
  — and a `"…"` string is how a literal space, `_`, `^`, `[` or `]` gets into a
  label (`[N "a_b"]`, `["my node" x]`). Inside quotes every character is literal;
  an unterminated quote runs to end of input, like a missing `]`. The old
  backslash scheme was a local invention the parser never honoured and is gone —
  a `\` is now ordinary text (legacy documents still parse, just with the
  backslash literal). **One thing is inexpressible: a literal `"`**, since
  jsSyntaxTree's quoted strings have no inner escape; `serialize` drops it rather
  than emit text that wouldn't parse back.
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
- **Arrow-link mode** (`toggle-link` in `app.ts`) is a two-click node picker, same
  spirit as Move mode, mutually exclusive with it (enabling one turns off the
  other). It doesn't add new data or notation — it just automates giving two
  nodes a shared subscript, so the existing derived-arrow rendering picks it up.
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
  - **Co-indexation is per tree.** `collectMovement` walks one root, so a shared
    subscript across two trees draws nothing; Arrow mode refuses a cross-tree
    pair with a toast rather than silently doing nothing.
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
  History>` so **undo is per-tab**, swapping `historyStack` on switch. Switching
  flushes the text pane into the active tab first (`flushActiveText`, only if it
  parses — matching the autosave rule that unparseable text is never saved). The
  whole workspace is persisted as one JSON blob; the active tab's text is still
  mirrored to `#t=` so share links keep working, and a legacy single-doc save (or
  an incoming `#t=`) migrates into a tab on boot. The last tab can't be closed.
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
  matching `actions[id]`. Structural keys (arrows, Shift+arrows, Ctrl+Z/Y, Esc)
  stay hardcoded and non-remappable; everything else is a `COMMANDS` entry with a
  remappable primary key (+ optional fixed aliases like `Enter`/`F2`). Zoom
  commands are `global` (run without a selection). The Settings panel captures a
  keypress to rebind (capture-phase listener); overrides persist via `saveKeymap`.
  `rebind` refuses a key already taken by *another `COMMANDS` entry* — it does
  **not** protect the hardcoded structural keys, so a command can currently be
  bound to `ArrowUp`/`Ctrl+z`/`Escape` and silently never fire (see TODO).
  **Add a shortcut by adding a `COMMANDS` entry**, not a `switch` case — the help
  table and remap UI regenerate from the list.
- Module imports use explicit `.js` extensions (ESM output).
- `id` on `Node` is a per-session counter, not persisted.
- **Deliberately unwired exports.** Several exports exist with no caller and are
  not dead code by accident: `serializePretty` (awaiting the pretty-print button),
  `saveDoc` (counterpart of the legacy `loadDoc`), `keymap.bindingToDefault`,
  `Workspace.single`, `edit.addChild`/`addSibling` (back-compat wrappers over the
  positional forms) and `settings.label.selectedColor`. `deleteNode`/`wrapNode`
  also take a `tree` argument that only `wrapNode` uses. Check this list before
  "cleaning up" or re-implementing one of them.

## TODO — open fixes & improvements

(Completed work is documented in the sections above, not tracked here.)

Bugs
- [ ] **Opening a share link overwrites the active tab.** On boot `startApp` does
      `workspace.active.text = shared` whenever `#t=` parses, then saves — so
      following someone's link in a browser that already holds work replaces that
      tab's document *and* its localStorage copy, with no prompt. Undo can't reach
      it either: history is keyed per tab id and the pre-boot text was never
      pushed. A shared doc should arrive as its **own new tab**. (Normally the
      fragment just mirrors the active tab, which is why this stays invisible
      until a foreign link is opened.)
- [ ] **Unparseable text is discarded on tab switch.** `flushActiveText` only
      saves when the text parses (matching the autosave rule), so a half-typed
      tree in tab A vanishes on switching away and back. Keep a per-tab draft
      string alongside the last-good text.
- [ ] **LaTeX export doesn't escape `\`, `^`, `[` or `]`.** `texEscape`
      (`export.ts`) covers `&%$#_{}` and `~` only. Since the backslash stopped
      being an escape character in the notation, `[N back\slash]` is now a legal
      label and emits a raw control sequence; worse, `[N "[x]"]` emits `[[x]]`,
      which breaks `forest`'s own bracket structure rather than merely mis-setting
      a glyph. Needs `\textbackslash{}` / `\textasciicircum{}` and braced brackets.
- [ ] **A chain of more than two co-indexed nodes draws parallel arrows instead
      of a chain.** `collectMovement` (`render.ts`) buckets every node sharing a
      subscript, and when the bucket holds more than one trace it links **all**
      of them straight to `antecedents[0]` — so successive-cyclic movement
      through two (or more) specifier positions, e.g.
      `[TopP [DP_1 나는] [Top' [TP [DP_1 t] [T' [PredP [DP_1 t] ...`, draws two
      separate arrows both landing on the topmost node instead of one chain
      climbing trace → trace → antecedent. (Reported via screenshot: "두 번
      이동할 때 아래쪽부터 차례대로 이동해야 되는데 화살표가 따로 노네".) Traces
      need to be ordered by tree position and linked pairwise along the chain —
      each to the next-higher occurrence — rather than fanned out to a single
      target.
- [ ] **A command can be rebound onto a hardcoded key.** `rebind` only scans other
      `COMMANDS` entries, so binding one to `ArrowUp`, `Ctrl+z` or `Escape` is
      accepted and then dead — `app.ts` handles those before consulting the keymap
      and returns. `rebind`'s own doc comment already promises a reserved-key
      sentinel (`{ id: "" }`) that was never implemented: either implement it
      against a list of the structural keys, or drop the comment.
- [ ] **An armed rebind survives closing Settings by clicking the backdrop.** The
      `close-settings` action clears `capturingFor`, but the modal's
      `e.target === settingsModal` branch returns before reaching it, and the
      capture-phase key listener doesn't check whether the panel is open — so the
      next keypress *anywhere*, including inside the text pane, is swallowed and
      bound to the armed command.
- [ ] **The inline editor doesn't survive a re-render, and races it.** `render()`
      clears `#tree-container`, which is where `startInlineEdit` parks its
      `<input>`. Any render while the editor is open (the `resize` handler is the
      reachable path) removes the input mid-render; the resulting `blur` runs
      `finish(true)` → `mutated()` → a **nested** `renderTree()` that appends its
      SVG before the outer call appends its own, leaving two trees stacked in the
      container. Call `cancelInlineEdit()` at the top of `renderTree`, as the
      `scroll` handler already does.
- [ ] **A triangle isn't cleared when a span is edited down to one word.** The
      inline-edit commit sets `triangle = true` for a multi-word word but never
      sets it back, so `the big cat` → `cat` keeps drawing a triangle until the
      next text round-trip re-derives the flag. Same root cause as the per-node
      `triangle` item below.
- [ ] **Zoom in is documented as `+` but bound to `=`.** The button title in
      `index.html` and the help modal both say `+`, while `COMMANDS` has `=` and
      `canonicalFromEvent` renders Shift+= as `Shift++`, which matches nothing —
      so pressing what the UI advertises does nothing. Add `+`/`Shift+=` as an
      `extraKeys` alias, or fix the text.
- [ ] **Undo from the text pane drops the caret to the end.** Ctrl+Z is captured
      globally even while typing, and `restoreFromHistory` assigns
      `textInput.value`, which resets the selection to the end of the document.
- [ ] **A per-node `triangle` flag that disagrees with the label doesn't survive.**
      The flag isn't in the notation: `parse` derives it (a multi-word terminal is
      a triangle), so toggling it off with `t` on a multi-word leaf — or on with a
      single word — is lost on the next text round-trip. jsSyntaxTree has only a
      global "Enable triangles" option, so a compatible per-node spelling would
      have to be invented; a global display setting may be the better match.
- [ ] **A literal `"` in a label is inexpressible** (jsSyntaxTree's quoted strings
      have no inner escape), so `serialize` drops it. Only matters for a label
      that actually needs a quotation mark, e.g. citing a quoted word.

Robustness
- [ ] **Closing a tab is unrecoverable** — no confirm, and `closeTab` deletes
      that tab's `History` outright. Add "reopen closed tab" (or an undo toast).
- [ ] **A tab whose text won't parse borrows the previous tab's trees.**
      `loadActiveTab`'s fallback chain ends in `: trees`, so the newly active tab
      goes live over the *old* tab's `Tree` objects — two tabs then share node
      identity, and the first edit serializes the old document into the new tab.
      Only reachable from a malformed workspace blob or `#t=`, and the fix is a
      one-liner (fall back to `DEFAULT_DOC` / a fresh `Tree`).
- [ ] **Export and clipboard failures use `alert()`** (`export.ts`,
      `copy-*` actions), which the no-dialogs convention above rules out — in an
      environment that suppresses dialogs a failed PNG export reports nothing at
      all. Route them through `flashStatus` like every other message.
- [ ] **Accessibility outside the SVG.** The tree itself is a proper ARIA tree,
      but its surroundings aren't: the modals are bare `<div class="modal">` (no
      `role="dialog"`/`aria-modal`, no focus trap, focus isn't restored on close),
      `#parse-error` and the `#status-toast` aren't live regions, so parse errors
      and every toast ("Copied", "Only a leaf can be a word") are never announced,
      every tab in `#tabbar` is `tabIndex=0` where `role="tab"` wants a roving
      tabindex plus an `aria-controls` target, and `#divider` has no
      `role="separator"` or keyboard resize.
- [ ] **Text-pane bracket keys ignore modifiers**: the textarea `keydown` handler
      matches `e.key === "["` (and `]`, Backspace) without checking
      Ctrl/Alt/Meta, so an OS or browser chord ending in `[` still wraps the
      selection. It also never checks `isComposing`, which is worth auditing for
      IME input.
- [ ] **URL fragment churn**: `updateFragment` runs `history.replaceState` with
      the whole document on every edit, so large trees mean multi-KB URLs
      rewritten per keystroke. Debounce it; consider compressing the payload.
- [ ] Extend the test suite: `make test` covers parser/serializer round-trips
      for one tree (`test/roundtrip.test.mjs`) and for a multi-tree document
      (`test/multitree.test.mjs`), but `edit.ts`, `brackets.ts`, `tabs.ts` and
      `keymap.ts` are all pure and untested, and there's no Playwright smoke test
      in-repo yet.

Features
- [ ] **Pretty-print button** for the text pane. `serializePretty` in
      `serialize.ts` is already written and currently **unused** — it just needs
      wiring to a toolbar/pane button.
- [ ] **Tab ergonomics**: `Ctrl+1…9` / `Ctrl+Tab` switching, drag-to-reorder,
      duplicate-tab. Cheap now that `COMMANDS` drives the keymap.
- [ ] **Export options**: PNG scale is hardcoded at 2×; add a scale control, a
      transparent-background option, and batch export of every tab.
- [ ] **Font family picker.** `settings.label.fontFamily` exists with no UI, and
      font choice matters for publication figures.
- [ ] **Toolbar actions with no `COMMANDS` entry** (`coordination`,
      `paste-before`, `toggle-align`, `toggle-boxes`, `toggle-theme`, `new-tab`)
      have no key and therefore no row in the help table — the table only renders
      `FIXED_KEYS` + `COMMANDS`. Give them entries, or render the keyless actions
      too so Coord/Paste ◀ stop being invisible to keyboard users.
- [ ] **Settings inputs validate looser than they advertise**: the markup carries
      `min`/`max` (font size 8–40, spacing bounds), the handlers accept any
      `> 0` / `>= 0`, so a typed-in 400 goes straight into the layout.
