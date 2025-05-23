# Syntax Tree Plus

[Live Demo on GitHub Pages](https://egwkim.github.io/Syntax-Tree-Plus/)

## Overview
Syntax Tree Plus is a web-based application for creating, editing, and visualizing syntactic tree structures. It features intuitive keyboard navigation, node editing, and clipboard operations (cut/copy/paste), all rendered interactively with SVG.

## Project Structure
```
syntaxtreeplus
├── src
│   ├── index.html          # Main HTML document
│   ├── css
│   │   └── styles.css      # Styles for the tree visualizer
│   ├── scripts
│   │   ├── main.js         # Entry point and UI logic
│   │   ├── tree.js         # Tree and Node class definitions
│   │   ├── render.js       # SVG rendering logic
│   │   ├── edit.js         # Editing and clipboard functions
├── README.md               # Project documentation
```

## Features
- **SVG Tree Visualization**: Interactive, auto-spaced tree rendering with node selection highlighting.
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
1. Clone the repository.
2. Open `src/index.html` in your browser.
3. Use keyboard shortcuts or mouse to interact with the tree.

## Implementation Notes
- The tree is rendered using SVG, with automatic spacing to prevent node overlap.
- All editing and navigation logic is in `main.js` and `edit.js`.
- The root node is always centered on the screen.

## Contributing
Contributions are welcome! Please open an issue or submit a pull request.

## License
MIT License