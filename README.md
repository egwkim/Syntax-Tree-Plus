# Syntax Tree Plus

[Live Demo on GitHub Pages](https://egwkim.github.io/Syntax-Tree-Plus/)

## Overview

Syntax Tree Plus is a web-based application for creating, editing, and visualizing syntactic tree structures. It features intuitive keyboard navigation, node editing, and clipboard operations (cut/copy/paste), all rendered interactively with SVG.

## Features

- **SVG Tree Visualization**: Tree rendering with node selection highlighting.
- **Keyboard Navigation**: Use arrow keys to move between parent, child, and sibling nodes.
- **Editing**:
  - Press 'n' to add a child node.
  - Press 'e' to edit a node label (via prompt).
  - Press 'Delete', 'Backspace', or 'd' to delete a node (children are reattached to parent).
  - Press 'r' to reverse the order of siblings.
- **Clipboard Operations**:
  - 'x': Cut node and subtree
  - 'c': Copy node and subtree
  - 'v': Paste (replace selected node with clipboard subtree)
- **Mouse Support**: Click nodes to select.

## Usage

### 1. Install dependencies

If you haven't already, install [pnpm](https://pnpm.io/) \
Install dependencies

```sh
pnpm install
```

### 2. Build the project

```sh
pnpm run build
# or
make build
```

### 3. Start a local dev server

```sh
pnpm run start
# or
make start
```

Then open [http://localhost:3000](http://localhost:3000) (or the port shown in your terminal) in your browser.

### 5. Use keyboard shortcuts or mouse to interact with the tree.

## Implementation Notes

- The tree is rendered using SVG
