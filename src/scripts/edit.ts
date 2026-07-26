import { Node, Tree } from "./tree.js";

/** Deep clone a node and its subtree (delegates to Node.clone). */
export function cloneNodeSubtree(node: Node): Node {
  return node.clone();
}

/**
 * Add a new empty child under `node` at `index` (-1 = append).
 *
 * `isWord` picks which kind is created — a word (a lexical item, serialized
 * bare) or a labelled node (serialized in its own brackets, `[N]`, even while
 * childless). The caller always decides: the toolbar has a button for each.
 */
export function addChildAt(
  node: Node,
  index: number,
  label = "",
  isWord = false
): Node {
  const child = new Node(label);
  child.isWord = isWord;
  node.insertChild(child, index);
  return child;
}

/** Add a new empty child at the end of `node`'s children. */
export function addChild(node: Node, label = "", isWord = false): Node {
  return addChildAt(node, -1, label, isWord);
}

/**
 * Add a sibling immediately after `node`. Root has no siblings.
 *
 * A sibling defaults to the same kind as the node it's added next to — the
 * predictable choice, since siblings in a real tree are usually alike (two
 * category nodes, or two words under one mother).
 */
export function addSiblingAfter(
  node: Node,
  label = "",
  isWord = node.isWord
): Node | null {
  if (!node.parent) return null;
  const sibling = new Node(label);
  sibling.isWord = isWord;
  const idx = node.parent.children.indexOf(node);
  node.parent.insertChild(sibling, idx + 1);
  return sibling;
}

/** Add a sibling immediately before `node`. Root has no siblings. */
export function addSiblingBefore(
  node: Node,
  label = "",
  isWord = node.isWord
): Node | null {
  if (!node.parent) return null;
  const sibling = new Node(label);
  sibling.isWord = isWord;
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

/**
 * Expand a node into a CP/TP clause skeleton:
 *   CP → Spec, C' → C, TP → Spec, T' → T, VP
 * Returns C (the complementizer head) as the natural next thing to fill in.
 */
export function cpTpTemplate(tree: Tree, node: Node): Node {
  node.updateLabel("CP");
  [...node.children].forEach((c) => node.removeChild(c));

  const cSpec = new Node("Spec");
  const cBar = new Node("C'");
  const c = new Node("C");
  const tp = new Node("TP");
  const tSpec = new Node("Spec");
  const tBar = new Node("T'");
  const t = new Node("T");
  const vp = new Node("VP");

  node.insertChild(cSpec);
  node.insertChild(cBar);
  cBar.insertChild(c);
  cBar.insertChild(tp);
  tp.insertChild(tSpec);
  tp.insertChild(tBar);
  tBar.insertChild(t);
  tBar.insertChild(vp);
  return c;
}

/**
 * Expand a node into a flat coordination: &P → [XP, &, XP], where XP is the
 * node's own label (its category is preserved across both conjuncts).
 * Returns the coordinator leaf ("&") as the natural next thing to rename
 * ("and" / "or" / ...).
 */
export function coordinationTemplate(tree: Tree, node: Node): Node {
  const category = node.label.trim() || "XP";
  node.updateLabel("&P");
  [...node.children].forEach((c) => node.removeChild(c));

  const first = new Node(category);
  // The coordinator is the one slot in these templates meant to be renamed to
  // an actual lexical item ("and" / "or"), so it starts life as a word. The
  // category skeletons around it (Spec, X', heads) stay nodes.
  const conj = new Node("&");
  conj.isWord = true;
  const second = new Node(category);

  node.insertChild(first);
  node.insertChild(conj);
  node.insertChild(second);
  return conj;
}

/** Toggle the triangle flag on a word. Nodes never carry a triangle. */
export function toggleTriangle(node: Node): void {
  if (node.isWord) node.triangle = !node.triangle;
}

/**
 * Switch a leaf between a word and a labelled node — the manual override for
 * the case the notation can't guess: a leaf that holds a symbol (`Ø`, `t`, a
 * bare category) rather than a lexical item.
 *
 * Only leaves can change: a node with children is a node by definition. A node
 * turned into a word loses its triangle, which is a property of a word *span*
 * and would otherwise linger invisibly. Returns whether anything changed.
 */
export function toggleWordNode(node: Node): boolean {
  if (!node.isLeaf) return false;
  node.isWord = !node.isWord;
  if (!node.isWord) node.triangle = false;
  return true;
}

/**
 * Auto-subscript display option (jsSyntaxTree parity): number repeated
 * node labels so otherwise-identical phrase/bar nodes are distinguishable
 * (NP → NP₁, NP₂, …). Words are excluded: repeated words are common and
 * meaningful on their own, so numbering them would be noisy rather than
 * helpful. A childless *node* (`[N]`) is still a node and does get numbered,
 * matching jsSyntaxTree's `assignSubscripts`.
 *
 * Writes only to the transient `autoSubscript` field — never to `subscript` —
 * so it can't leak into the bracket notation on serialize or spawn a spurious
 * movement arrow (arrows derive from *shared* `subscript`, and auto values are
 * distinct per occurrence). A node that already carries a manual subscript is
 * left untouched and not counted, since it's already distinguished. Clears all
 * auto-subscripts first, so passing `enabled = false` simply resets them.
 */
export function applyAutoSubscripts(tree: Tree, enabled: boolean): void {
  tree.root.walk((n) => {
    n.autoSubscript = "";
  });
  if (!enabled) return;

  const groups = new Map<string, Node[]>();
  tree.root.walk((n) => {
    if (n.isWord) return; // words aren't numbered
    if (n.subscript) return; // respect an explicit subscript
    const label = n.label.trim();
    if (!label) return;
    const arr = groups.get(label) ?? [];
    arr.push(n);
    groups.set(label, arr);
  });

  groups.forEach((nodes) => {
    if (nodes.length < 2) return; // only repeated labels get numbered
    nodes.forEach((n, i) => {
      n.autoSubscript = String(i + 1);
    });
  });
}

/**
 * Next unused plain-integer subscript in the tree, as a string (e.g. "3" if
 * "1" and "2" are already taken). Used to auto-number a fresh movement link.
 */
export function nextSubscript(tree: Tree): string {
  let max = 0;
  tree.root.walk((n) => {
    if (/^\d+$/.test(n.subscript)) max = Math.max(max, parseInt(n.subscript, 10));
  });
  return String(max + 1);
}

/**
 * Link two nodes with a movement arrow by giving them a shared subscript —
 * movement arrows are derived from co-indexation (see render.ts), so this is
 * the data-level effect of the "explicit" arrow tool in the UI. Reuses either
 * node's existing subscript if it has one, else mints a fresh number. No-op
 * (returns false) when linking a node to itself.
 */
export function linkNodes(tree: Tree, a: Node, b: Node): boolean {
  if (a === b) return false;
  const sub = a.subscript || b.subscript || nextSubscript(tree);
  a.subscript = sub;
  b.subscript = sub;
  a.updateTextWidth();
  b.updateTextWidth();
  return true;
}
