// edit.js
// Tree editing functionalities

function editSelectedLabel(tree, render) {
  if (!tree.selectedNode) return;
  const newLabel = prompt("Edit node label:", tree.selectedNode.label);
  if (newLabel !== null) {
    tree.selectedNode.label = newLabel;
    render();
  }
}

function deleteSelectedNode(tree, render) {
  const node = tree.selectedNode;
  if (!node || !node.parent) return;
  const parent = node.parent;
  node.children.forEach((child, i) => {
    parent.addChild(child, parent.children.indexOf(node) + i);
  });
  parent.removeChild(node);
  tree.selectedNode = parent;
  render();
}

function cloneNodeSubtree(node) {
  const newNode = new Node(node.label);
  node.children.forEach(child => {
    const childClone = cloneNodeSubtree(child);
    newNode.addChild(childClone);
  });
  return newNode;
}

// Export functions for use in main.js
window.editSelectedLabel = editSelectedLabel;
window.deleteSelectedNode = deleteSelectedNode;
window.cloneNodeSubtree = cloneNodeSubtree;

