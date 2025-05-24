import { Node, Tree } from './tree.js';

// Utility to deep clone a node and its subtree (without parent linkage)
export function cloneNodeSubtree(node: Node): Node {
  const newNode = new Node(node.label);
  node.children.forEach((child: Node) => {
    const childClone = cloneNodeSubtree(child);
    newNode.addChild(childClone);
  });
  return newNode;
}

export function editSelectedLabel(tree: Tree, render: () => void) {
  if (!tree.selectedNode) return;
  const newLabel = prompt("Edit node label:", tree.selectedNode.label);
  if (newLabel !== null) {
    tree.selectedNode.label = newLabel;
    render();
  }
}

export function deleteSelectedNode(tree: Tree, render: () => void) {
  const node = tree.selectedNode;
  if (!node || !node.parent) return;
  const parent = node.parent;
  const idx = parent.children.indexOf(node);
  // Attach children to parent at the position of the deleted node
  node.children.forEach((child: Node, i: number) => {
    parent.addChild(child, idx + i);
    child.parent = parent;
  });
  parent.removeChild(node);
  tree.selectedNode = parent;
  render();
}
