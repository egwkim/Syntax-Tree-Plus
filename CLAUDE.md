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
  `gh-pages` branch via a git worktree. Caveat: the Makefile `dist` target tries to
  make an *orphan* gh-pages branch, which fails once the branch exists — so today
  each deploy **appends** a commit. To deploy onto the existing site, point the
  worktree at `origin/gh-pages` first (`git worktree add -f dist gh-pages`), then
  `make deploy`. This is *not* the intended model — `gh-pages` is meant to be wiped
  to a single commit each deploy; see the deploy entry in the TODO.
- `make test` runs the parser/serializer round-trip tests (`test/*.test.mjs`) on
  Node's built-in runner — no test dependency. They build first and import from
  `dist/`; `test/dom-stub.mjs` fakes the canvas that `tree.ts` measures text
  with, so the notation is testable without a browser. Import it **before** any
  module that pulls in `tree.js`. Whole-app behaviour is still verified ad-hoc
  via Playwright driving the built app.

## Architecture (`src/scripts/`)

Pure model/logic modules with one controller wiring them to the DOM.

| Module | Responsibility |
| --- | --- |
| `tree.ts` | `Node` / `Tree` model. Node = label + `subscript`/`superscript`/`triangle` + children. A terminal is a childless node whose label is the word(s). Also width measurement and layout fields. |
| `parser.ts` | Bracket notation → `Tree`. Own tokenizer (`[`/`]`/`_`/`^`/word/`"…"`); tolerant — auto-closes missing `]`, missing labels and unterminated quotes. `parseLabel` splits `NP_1^0` into base/sub/sup and shares that tokenizer. |
| `serialize.ts` | `Tree` → bracket notation. Inverse of the parser: quotes a label/terminal only when it would otherwise be misread (see the quoting notes below), so ordinary documents stay bare. `serializePretty` (multi-line) exists but is **unused**. |
| `brackets.ts` | Pure, DOM-free helpers for the text pane: bracket matching (quote-aware — a `[` inside `"…"` is label text, not structure), matched-pair-at-caret detection, highlight-HTML building, and edit diff/position tracking. Unit-testable without a browser. |
| `render.ts` | `Tree` → `<svg>`. Two passes (layout positions, then draw). Handles triangles, scripts, movement arrows, leaf alignment, bounding-box sizing. Tags each node group with `data-node-id`. |
| `edit.ts` | Pure tree ops: add child/sibling (positional), delete (promotes children), wrap, templates (X-bar, CP/TP, coordination), `linkNodes`/`nextSubscript` (movement-arrow tool), `applyAutoSubscripts` (auto-subscript display option), `reparent`, `isDescendant`. |
| `export.ts` | Download SVG / PNG (SVG rasterized via canvas) / LaTeX `forest`, plus clipboard copy (PNG image, SVG markup, LaTeX). Always draws with the light palette — see the export-colors note below. |
| `history.ts` | Undo/redo over document snapshots (bracket strings). One instance **per tab**. |
| `tabs.ts` | `Workspace` model: an ordered list of named documents (`TabData` = id/name/text) + which is active. Pure model — no DOM, no history; add/remove/rename/switch and `toStored`/`fromStored`. |
| `keymap.ts` | Single source of truth for keyboard shortcuts: the command list (id/label/default key/extra aliases), user remappings, canonical key encoding, and lookup. The help table and the remap UI are both rendered from it, so they can't drift. |
| `persist.ts` | Autosave to localStorage + shareable URL fragment (`#t=`): the tab **workspace** (`saveWorkspace`/`loadWorkspace`, active doc mirrored to `#t=`), the theme, the display prefs (`savePrefs`/`loadPrefs`), and the keymap overrides (`saveKeymap`/`loadKeymap`). `loadDoc` remains to migrate a legacy single-doc save into a tab on boot; `saveDoc` is now **unused** (the workspace blob replaced it) and only kept as its counterpart. |
| `settings.ts` | Layout/style constants, leaf alignment, theme colors. `THEME_COLORS` + `applyThemeColors` are the single source for the light/dark drawing palette (used by both the theme toggle and the exporters). |
| `app.ts` | Controller. Owns the `Tree` + `Workspace`, wires toolbar/keyboard/drag/text pane, tabs, zoom/pan, inline editing, theme. |
| `main.ts` | Entry point: `startApp()`. |

## Data flow (the important part)

- **Text → tree**: `input` on the textarea → debounced `parse` → replace tree →
  `renderTree()`. Does *not* write back to the textarea (avoids loops).
- **Tree → everything**: after any GUI mutation, `mutated()` = serialize → push
  history → save → set textarea value → render. Programmatic `textarea.value`
  assignment doesn't fire `input`, so there's no feedback loop.
- Selection is a single `tree.selectedNode`. Across a text re-parse **and across
  undo/redo** it's restored by child-index path (`pathOf` / `nodeAtPath`). When
  that exact path is gone (undo of an "add", a text edit that deleted it),
  `nodeAtPath` returns the **deepest surviving ancestor** along the path rather
  than the root, so undo leaves the selection where the user was working.

## Conventions & gotchas

- **No `prompt()`/`alert()` dialogs for input** — the user's environment can't use
  them. Label editing is an inline `<input>` overlay; brackets/arrows are derived
  from notation, not modal prompts.
- **Inline editing** edits the *raw token* (`DP_1`, `X^0`); `parseLabel` splits it
  on commit. `rawToken` quotes a label holding a delimiter, so reopening the editor
  on `a_b` shows `"a_b"` rather than silently re-splitting it into base +
  subscript. Blank leaves are discarded on commit/cancel.
- **Movement arrows** are derived, not drawn explicitly: two nodes sharing a
  subscript are linked when one is a trace (`t`, `t*`, `e`). No column-number
  arrow syntax.
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
  `serializeNode` quotes a leaf that has a leaf neighbour: `[NP "the" "cat"]`,
  `[NP "the big" "old cat"]`. A quoted value is never joined into a neighbouring
  run (jsSyntaxTree's `parseValue` accumulates only unquoted tokens), which is
  what makes two adjacent spans expressible — the last arrangement that wasn't.
  A lone terminal keeps the readable bare spelling, so ordinary documents acquire
  no quotes at all. The bracketed spelling (`[NP [the] [cat]]`) still parses; it's
  just not what we emit.
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
- **Tabs** (`tabs.ts` + `#tabbar`): a `Workspace` holds several named documents;
  only the active one is the live `Tree`. The controller keeps a `Map<tabId,
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
  keypress to rebind (capture-phase listener, refuses conflicts); overrides
  persist via `saveKeymap`. **Add a shortcut by adding a `COMMANDS` entry**, not a
  `switch` case — the help table and remap UI regenerate from the list.
- Module imports use explicit `.js` extensions (ESM output).
- `id` on `Node` is a per-session counter, not persisted.

## TODO — open fixes & improvements

(Completed work is documented in the sections above, not tracked here.)

Bugs
- [ ] **Unparseable text is discarded on tab switch.** `flushActiveText` only
      saves when the text parses (matching the autosave rule), so a half-typed
      tree in tab A vanishes on switching away and back. Keep a per-tab draft
      string alongside the last-good text.
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
- [ ] **URL fragment churn**: `updateFragment` runs `history.replaceState` with
      the whole document on every edit, so large trees mean multi-KB URLs
      rewritten per keystroke. Debounce it; consider compressing the payload.
- [ ] Extend the test suite: `make test` covers parser/serializer round-trips
      (`test/roundtrip.test.mjs`), but `edit.ts`, `brackets.ts`, `tabs.ts` and
      `keymap.ts` are all pure and untested, and there's no Playwright smoke test
      in-repo yet.
- [ ] **`make deploy` doesn't implement the intended deploy model.** `gh-pages` is
      derived output and is meant to be *wiped every deploy*, leaving a single
      commit (rollback = check out an older `main` and rebuild). Two reasons it
      instead accumulates commits: `deploy` pushes without `--force`, and a
      parentless commit is never a fast-forward, so such a push is rejected; and
      `dist`'s wipe is guarded by `if git checkout --orphan=gh-pages`, which
      fatals with "a branch named 'gh-pages' already exists" on every run after
      the first, so the branch is never re-orphaned. Fix, in `deploy`:
      ```make
      cd $(DIST_DIR) && git add --all && \
      commit=$$(git commit-tree $$(git write-tree) \
                 -m "Deploy $$(git -C .. rev-parse --short HEAD)") && \
      git reset -q --hard $$commit && \
      git push --force origin HEAD:gh-pages
      ```
      `commit-tree` with no `-p` builds a parentless commit directly, so it's
      always exactly one commit and — unlike `--orphan` — it's idempotent.
      Two things worth adding at the same time: embed the **source commit SHA** in
      the message (as above), since otherwise nothing records which commit is
      live, and **refuse to deploy a dirty tree** (`git diff --quiet HEAD -- src`),
      since a build from uncommitted source can't be reproduced by the rebuild
      rollback path. `dist` then reduces to `git worktree add -f dist gh-pages`
      (note: the Makefile's `--relative-paths` is a newer git option — 2.43
      rejects it, so drop it unless you know the toolchain has it). Once this
      lands, the next deploy collapses `gh-pages` to the single commit it should
      have been.

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
