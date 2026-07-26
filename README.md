# Syntax Tree Plus

[Live Demo on GitHub Pages](https://egwkim.github.io/Syntax-Tree-Plus/)

A web-based **hybrid** syntax-tree editor for linguists. Build and edit
constituency / X-bar trees either with a **GUI** (click, keyboard, toolbar)
**or** by typing **labelled bracket notation** — the two views stay in sync in
real time. Trees render as SVG and export to SVG, PNG, or LaTeX (`forest`).

## Why "hybrid"?

Most online tree tools are text-only (fast to type, awkward to restructure),
while GUI tools are usually desktop apps that don't round-trip to the notation
you publish. Syntax Tree Plus gives you both at once:

- Type `[S [NP the cat] [VP slept]]` in the text pane → the tree redraws.
- Edit the tree in the GUI (add/rename/delete/move nodes) → the notation updates.

## Features

- **Two-way hybrid editing** — GUI and bracket notation kept in sync.
- **jsSyntaxTree-compatible notation** — paste trees from existing tools.
- **Inline label editing** — double-click a node (no pop-up dialogs).
- **Linguistics support**:
  - **Triangles** for multi-word terminals (`[NP the big cat]`).
  - **Subscripts / superscripts** (`NP_1`, `X^0`).
  - **Movement arrows** drawn automatically between co-indexed nodes when one
    is a trace (`t`, `t*`, `e`) — e.g. `[DP_1 who] … [DP t_1]`.
  - **X-bar quick template** — expand a node to `XP → (Spec) X' → X (Compl)`.
- **Export** — SVG, PNG, and LaTeX `forest` code.
- **Undo / redo**, **autosave** (localStorage), and **shareable URLs** (the tree
  is encoded in the link).
- **Light / dark theme**, leaf-alignment and node-box toggles.
- **Phone-friendly toolbar** — on a small screen the toolbar collapses to a row
  of category chips (Insert / Edit / Clipboard / Templates / Tools / View /
  Export); tap one to show just those buttons, tap it again to hide them and
  give the whole screen to the tree.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Arrow keys | Move selection (parent / child / sibling) |
| Shift + ← / → | Reorder siblings |
| `n` | Add child |
| `s` | Add sibling |
| `e` / Enter / F2 | Rename (inline) |
| `w` | Wrap in a new parent |
| `t` | Toggle triangle on a terminal |
| `b` | Expand to X-bar skeleton |
| `d` / Delete | Delete node (children reattach to parent) |
| `r` | Reverse sibling order |
| `x` / `c` / `v` | Cut / copy / paste subtree |
| Ctrl/Cmd + Z / Y | Undo / redo |

When renaming, type the full token including scripts, e.g. `DP_1` or `C^0`.

## Notation reference

```
[S [NP [Det the] [N cat]] [VP [V chased] [NP a dog]]]
```

- `[Label … ]` — a labelled (internal) node.
- Bare words are terminals; a multi-word run becomes a **triangle**.
- `_x` adds a subscript, `^y` a superscript (`NP_1`, `X^0`).
- Escape a literal bracket/underscore with a backslash: `\[`, `\_`.

## Usage

### 1. Install dependencies

Install [pnpm](https://pnpm.io/), then:

```sh
pnpm install
```

### 2. Build

```sh
pnpm run build   # or: make build
```

### 3. Run a local dev server

```sh
pnpm run start   # or: make serve
```

Then open the printed URL (default <http://localhost:3000>).

For an auto-rebuilding dev loop:

```sh
pnpm run watch
```

## Project structure

```
src/
  index.html            layout: toolbar + split pane (tree | text)
  css/styles.css        theming, panes, inline editor, modal
  scripts/
    tree.ts             Node / Tree model
    parser.ts           bracket notation  -> Tree
    serialize.ts        Tree -> bracket notation
    render.ts           SVG layout & drawing (triangles, scripts, arrows)
    edit.ts             tree operations (add / delete / wrap / X-bar …)
    export.ts           SVG / PNG / LaTeX export
    history.ts          undo / redo
    persist.ts          localStorage + URL persistence
    settings.ts         layout & style settings
    toolbar.ts          compact (mobile) toolbar: category chips
    app.ts              controller: wires GUI, text sync, keyboard
    main.ts             entry point
```

## Implementation notes

- The tree is rendered as a single, bounding-box-sized `<svg>` (good for both
  display and export).
- The parser and serializer are inverses of each other; a round-trip through
  both is stable, which keeps GUI edits and text edits from drifting.
- Undo/redo works over document snapshots (bracket strings), so every kind of
  edit is captured uniformly.
