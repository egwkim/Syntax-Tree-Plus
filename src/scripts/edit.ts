import { Node, Tree } from "./tree.js";

/** Deep clone a node and its subtree (delegates to Node.clone). */
export function cloneNodeSubtree(node: Node): Node {
  return node.clone();
}

/** Add a new empty child under `node` at `index` (-1 = append). */
export function addChildAt(node: Node, index: number, label = ""): Node {
  const child = new Node(label);
  node.insertChild(child, index);
  return child;
}

/** Add a new empty child at the end of `node`'s children. */
export function addChild(node: Node, label = ""): Node {
  return addChildAt(node, -1, label);
}

/** Add a sibling immediately after `node`. Root has no siblings. */
export function addSiblingAfter(node: Node, label = ""): Node | null {
  if (!node.parent) return null;
  const sibling = new Node(label);
  const idx = node.parent.children.indexOf(node);
  node.parent.insertChild(sibling, idx + 1);
  return sibling;
}

/** Add a sibling immediately before `node`. Root has no siblings. */
export function addSiblingBefore(node: Node, label = ""): Node | null {
  if (!node.parent) return null;
  const sibling = new Node(label);
  const idx = node.parent.children.indexOf(node);
  node.parent.insertChild(sibling, idx);
  return sibling;
}

/** Back-compat alias: add a sibling after `node`. */
export function addSibling(node: Node, label = ""): Node | null {
  return addSiblingAfter(node, label);
}

/**
 * True if `node` is `ancestor` itself or lies within its subtree. Used to
 * forbid drag-reparenting a node into its own descendants (which would create
 * a cycle).
 */
export function isDescendant(ancestor: Node, node: Node): boolean {
  let n: Node | null = node;
  while (n) {
    if (n === ancestor) return true;
    n = n.parent;
  }
  return false;
}

/**
 * Move `node` to become a child of `newParent` at `index`. No-op (returns
 * false) if the move is illegal (into itself/a descendant). Adjusts the index
 * when moving within the same parent so it refers to the post-removal slot.
 */
export function reparent(node: Node, newParent: Node, index: number): boolean {
  if (isDescendant(node, newParent)) return false;
  const sameParent = node.parent === newParent;
  const originalIndex = newParent.children.indexOf(node);
  node.parent?.removeChild(node);
  let idx = index;
  if (sameParent && originalIndex !== -1 && originalIndex < index) idx -= 1;
  idx = Math.max(0, Math.min(idx, newParent.children.length));
  newParent.insertChild(node, idx);
  return true;
}

/**
 * Delete a node, reattaching its children to the parent at the node's old
 * position. The root cannot be deleted. Returns the node to select next.
 */
export function deleteNode(tree: Tree, node: Node): Node | null {
  if (!node.parent) return node; // never delete the root
  const parent = node.parent;
  const idx = parent.children.indexOf(node);
  const kids = [...node.children];
  kids.forEach((child, i) => parent.insertChild(child, idx + i));
  parent.removeChild(node);
  return parent;
}

/** Insert a new parent above `node` (wrap it in a new labelled node). */
export function wrapNode(tree: Tree, node: Node, label = "X"): Node {
  const newParent = new Node(label);
  if (!node.parent) {
    // Wrapping the root: the wrapper becomes the new root.
    newParent.insertChild(node);
    tree.root = newParent;
    newParent.parent = null;
    tree.recomputeDepth();
    return newParent;
  }
  const parent = node.parent;
  const idx = parent.children.indexOf(node);
  parent.insertChild(newParent, idx);
  newParent.insertChild(node);
  return newParent;
}

/** Move a node one slot left/right among its siblings. */
export function moveSibling(node: Node, dir: -1 | 1): boolean {
  if (!node.parent) return false;
  const siblings = node.parent.children;
  const idx = siblings.indexOf(node);
  const target = idx + dir;
  if (target < 0 || target >= siblings.length) return false;
  siblings.splice(idx, 1);
  siblings.splice(target, 0, node);
  return true;
}

/**
 * Expand a node into an X-bar skeleton:  XP → (Spec) X' → X (Compl)
 * The bar level (X) derives from the node's current label.
 */
export function xbarTemplate(tree: Tree, node: Node): Node {
  const base = node.label.replace(/(P|['′])$/g, "").trim() || "X";
  node.updateLabel(base + "P");
  // Clear existing children (X-bar defines fresh structure).
  [...node.children].forEach((c) => node.removeChild(c));

  const spec = new Node("Spec");
  const bar = new Node(base + "'");
  const head = new Node(base);
  const compl = new Node("Compl");

  node.insertChild(spec);
  node.insertChild(bar);
  bar.insertChild(head);
  bar.insertChild(compl);
  return head;
}

/** Toggle the triangle flag on a leaf terminal. */
export function toggleTriangle(node: Node): void {
  if (node.isLeaf) node.triangle = !node.triangle;
}
