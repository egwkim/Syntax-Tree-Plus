// main.js

const tree = new Tree();
tree.root.label = "XP";
const child1 = new Node("XP", tree.root);
const child2 = new Node("XP", tree.root);
const grandchild1 = new Node("XP", child1);
const grandchild2 = new Node("XP", child1);
const grandchild4 = new Node("XP", child2);

const navigationHistory = [];

function render() {
  const container = document.getElementById("tree-container");
  container.innerHTML = "";
  const svg = renderTreeToSVG(tree, (node) => {
    tree.selectedNode = node;
    render();
  });
  container.appendChild(svg);
}

// Keyboard navigation
window.addEventListener('keydown', function(e) {
  if (!tree.selectedNode) return;
  let node = tree.selectedNode;
  if (e.key === 'ArrowUp') {
    if (node.parent) {
      // Track which child index we are coming from
      const idx = node.parent.children.indexOf(node);
      navigationHistory.push(idx);
      tree.selectedNode = node.parent;
      render();
    }
  } else if (e.key === 'ArrowDown') {
    if (node.children && node.children.length > 0) {
      // Use history if available, otherwise default to first child
      let idx = 0;
      if (navigationHistory.length > 0) {
        idx = navigationHistory.pop();
        if (idx >= node.children.length) idx = 0;
      }
      tree.selectedNode = node.children[idx];
      render();
    }
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    if (node.parent) {
      const siblings = node.parent.children;
      const idx = siblings.indexOf(node);
      if (e.key === 'ArrowLeft' && idx > 0) {
        tree.selectedNode = siblings[idx - 1];
        navigationHistory.length = 0; // reset history
        render();
      } else if (e.key === 'ArrowRight' && idx < siblings.length - 1) {
        tree.selectedNode = siblings[idx + 1];
        navigationHistory.length = 0; // reset history
        render();
      }
    }
  }
});

render();
