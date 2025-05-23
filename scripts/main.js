// main.js

const tree = new Tree();
tree.root.label = "XP";
const child1 = new Node("XP", tree.root);
const child2 = new Node("XP", tree.root);
const grandchild1 = new Node("XP", child1);
const grandchild2 = new Node("XP", child1);
const grandchild4 = new Node("XP", child2);

const navigationHistory = [];
let clipboardNode = null;

function render() {
  const container = document.getElementById("tree-container");
  container.innerHTML = "";
  const svg = renderTreeToSVG(tree, (node, x, y) => {
    tree.selectedNode = node;
    render();
  });
  container.appendChild(svg);
}

// Keyboard navigation and actions
window.addEventListener("keydown", function (e) {
  if (!tree.selectedNode) return;
  let node = tree.selectedNode;
  if (e.key === "ArrowUp") {
    if (node.parent) {
      const idx = node.parent.children.indexOf(node);
      navigationHistory.push(idx);
      tree.selectedNode = node.parent;
      render();
    }
  } else if (e.key === "ArrowDown") {
    if (node.children && node.children.length > 0) {
      let idx = 0;
      if (navigationHistory.length > 0) {
        idx = navigationHistory.pop();
        if (idx >= node.children.length) idx = 0;
      }
      tree.selectedNode = node.children[idx];
      render();
    }
  } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    if (node.parent) {
      const siblings = node.parent.children;
      const idx = siblings.indexOf(node);
      if (e.key === "ArrowLeft" && idx > 0) {
        tree.selectedNode = siblings[idx - 1];
        navigationHistory.length = 0;
        render();
      } else if (e.key === "ArrowRight" && idx < siblings.length - 1) {
        tree.selectedNode = siblings[idx + 1];
        navigationHistory.length = 0;
        render();
      }
    }
  } else if (e.key === "n") {
    // Add child node
    const newNode = new Node("", node);
    tree.selectedNode = newNode;
    render();
  } else if (e.key === "e") {
    window.editSelectedLabel(tree, render);
  } else if (e.key === "Delete" || e.key === "Backspace" || e.key === "d") {
    window.deleteSelectedNode(tree, render);
  } else if (e.key === "x") {
    // Cut: remove selected node and its subtree, set clipboard
    if (node && node.parent) {
      clipboardNode = node;
      node.parent.removeChild(node);
      tree.selectedNode = node.parent;
      render();
    }
  } else if (e.key === "c") {
    // Copy: deep clone selected node and its subtree to clipboard
    if (node) {
      clipboardNode = window.cloneNodeSubtree(node);
    }
  } else if (e.key === "v") {
    // Paste: replace selected node and its subtree with clipboardNode's clone
    if (clipboardNode && node && node.parent) {
      const parent = node.parent;
      const idx = parent.children.indexOf(node);
      parent.removeChild(node);
      const pasted = window.cloneNodeSubtree(clipboardNode);
      parent.addChild(pasted, idx);
      tree.selectedNode = pasted;
      render();
    }
  } else if (e.key === "r") {
    // Reverse the order of child nodes of the parent of the selected node
    if (node.parent) {
      node.parent.children.reverse();
      render();
    }
  }
});

render();
