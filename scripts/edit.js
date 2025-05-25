import { Node } from "./tree.js";
// Utility to deep clone a node and its subtree (without parent linkage)
export function cloneNodeSubtree(node) {
    const newNode = new Node(node.label);
    node.children.forEach((child) => {
        const childClone = cloneNodeSubtree(child);
        newNode.insertChild(childClone);
    });
    return newNode;
}
export function editSelectedLabel(tree) {
    if (!tree.selectedNode)
        return;
    const newLabel = prompt("Edit node label:", tree.selectedNode.label);
    if (newLabel !== null) {
        tree.selectedNode.updateLabel(newLabel);
    }
}
export function deleteSelectedNode(tree) {
    const node = tree.selectedNode;
    if (!node || !node.parent)
        return;
    const parent = node.parent;
    const idx = parent.children.indexOf(node);
    // Attach children to parent at the position of the deleted node
    node.children.forEach((child, i) => {
        parent.insertChild(child, idx + i);
        child.parent = parent;
    });
    parent.removeChild(node);
    tree.selectedNode = parent;
}
