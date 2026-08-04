import { settings } from "./settings.js";

// Off-screen canvas used purely for measuring text widths.
const canvas: HTMLCanvasElement = document.createElement("canvas");
const context: CanvasRenderingContext2D = canvas.getContext("2d")!;

function measureFont(): string {
  return `${settings.label.fontSize}px ${settings.label.fontFamily}`;
}

let nextNodeId = 1;

/**
 * The triangle state a word's label implies on its own: multi-word spans
 * triangle, single words don't. `parse` sets a fresh word's `triangle` from
 * this; the inline-edit commit in app.ts re-derives it the same way on every
 * rename, so a stale triangle can't survive shrinking a span to one word.
 * Notation never stores a disagreement with this default — see the
 * `showTriangles` display setting for the jsSyntaxTree-compatible way to
 * suppress triangles without touching the bracket text.
 */
export function derivedTriangle(label: string): boolean {
  return label.indexOf(" ") >= 0;
}

/**
 * Which ends of a movement arrow carry an arrowhead: jsSyntaxTree's `->` (head
 * at the target), `<-` (head at the source) and `<>` (both).
 */
export interface ArrowEnds {
  to: boolean;
  from: boolean;
}

/**
 * An explicit movement arrow, written after a terminal as `-> N` / `<- N` /
 * `<> N`, where N is the target's **column**: its 1-based position among the
 * document's terminals, counted left to right. That's jsSyntaxTree's own arrow
 * spelling (`findTargetLeaf` counts VALUEs), so a document written there draws
 * the same arrows here.
 *
 * The column is resolved to a node reference when the text is parsed, and the
 * *reference* is what the app then keeps: any GUI edit that shifts the columns
 * renumbers itself on the next serialize, because the number is re-derived from
 * where the target sits now. `rawColumn` is kept for the one case a reference
 * can't cover — a hand-typed number that points nowhere — so it round-trips
 * instead of being silently dropped.
 */
export interface Arrow {
  target: Node | null;
  rawColumn: number;
  ends: ArrowEnds;
}

/**
 * A single node in a syntax tree.
 *
 * A node is either a **labelled node** such as `NP`, `VP`, `S`, or a **word**
 * (a terminal: one word or a span of words). The two are distinct even when
 * both are childless — `[NP [N]]` is a bare category `N` with nothing under it,
 * while `[N cat]` is `N` over the word `cat`. That's jsSyntaxTree's NODE/VALUE
 * split, and it's carried by the notation itself (brackets or not), so unlike
 * `color` it survives a text round-trip and undo/redo.
 *
 * A word spanning multiple words is drawn with a triangle (jsSyntaxTree
 * convention).
 */
export class Node {
  label!: string;
  subscript: string = "";
  superscript: string = "";
  triangle: boolean = false;
  /** Raw NODE/VALUE flag; read through `isWord`, which also enforces the
   *  childless invariant. */
  private word: boolean = false;
  /** Optional per-node text color override, set via the Settings panel. Not
   *  part of the bracket notation — like `id`, it's session-only and doesn't
   *  survive a text-pane re-parse. */
  color?: string;
  /** Transient, render-time-only subscript computed by the "auto-subscript"
   *  display option (repeated labels get numbered 1, 2, …). Never serialized
   *  and never merged into `subscript`, so it can't pollute the notation or
   *  spawn movement arrows; a manual `subscript` always wins. Recomputed on
   *  every render (see `applyAutoSubscripts` / `buildSVG`). */
  autoSubscript: string = "";
  /** Explicit movement arrow leaving this word, or null. Words only — a
   *  labelled node can't carry one, matching jsSyntaxTree, where only a VALUE
   *  is allowed an arrow and only a VALUE can be its target. */
  arrow: Arrow | null = null;

  children: Node[];
  parent: Node | null = null;
  tree: Tree | null = null;

  // Layout — populated by the renderer on every draw.
  x: number = NaN;
  y: number = NaN;
  textWidth: number = NaN; // width of the label box
  width: number = NaN; // width of the whole subtree
  depth: number = NaN;

  readonly id: number;

  constructor(label: string, parent: Node | null = null) {
    this.id = nextNodeId++;
    this.children = [];
    this.updateLabel(label);
    if (parent) {
      parent.insertChild(this);
    }
  }

  /** Structurally childless — says nothing about word-vs-node. */
  get isLeaf(): boolean {
    return this.children.length === 0;
  }

  /**
   * Is this a word (jsSyntaxTree's VALUE) rather than a labelled node?
   *
   * The childless test is part of the getter on purpose: jsSyntaxTree's VALUE
   * can never have children, and `serialize` would have to drop any that a word
   * somehow acquired (via drag-reparenting, say). Deriving it here makes that
   * state unrepresentable instead of merely discouraged.
   */
  get isWord(): boolean {
    return this.word && this.children.length === 0;
  }

  set isWord(value: boolean) {
    this.word = value;
  }

  insertChild(child: Node, idx: number = -1) {
    if (child.parent) {
      child.parent.removeChild(child);
    }
    if (idx === -1) {
      this.children.push(child);
    } else {
      this.children.splice(idx, 0, child);
    }
    child.parent = this;
    child.setTree(this.tree);
  }

  removeChild(child: Node) {
    const index = this.children.indexOf(child);
    if (index > -1) {
      this.children.splice(index, 1);
      child.parent = null;
    }
  }

  /** Recursively propagate the owning tree and recompute depth. */
  setTree(tree: Tree | null) {
    this.tree = tree;
    this.depth = this.parent ? this.parent.depth + 1 : 0;
    if (tree && this.depth > tree.maxDepth) {
      tree.maxDepth = this.depth;
    }
    this.children.forEach((c) => c.setTree(tree));
  }

  updateLabel(newLabel: string) {
    this.label = newLabel;
    this.updateTextWidth();
  }

  /** Subscript to render: a manual `subscript` wins over an auto-subscript. */
  displaySubscript(): string {
    return this.subscript || this.autoSubscript;
  }

  /** The label as shown, including sub/superscripts (used for width + export). */
  displayLabel(): string {
    let s = this.label;
    if (this.superscript) s += this.superscript;
    const sub = this.displaySubscript();
    if (sub) s += sub;
    return s;
  }

  updateTextWidth(): number {
    context.font = measureFont();
    const base = context.measureText(this.label).width;
    context.font = `${settings.label.fontSize * 0.7}px ${settings.label.fontFamily}`;
    const sub = this.displaySubscript();
    const scriptWidth = Math.max(
      sub ? context.measureText(sub).width : 0,
      this.superscript ? context.measureText(this.superscript).width : 0
    );
    this.textWidth = Math.ceil(base + scriptWidth);
    if (this.textWidth < settings.node.minWidth) {
      this.textWidth = settings.node.minWidth;
    }
    return this.textWidth;
  }

  /**
   * Deep clone of this node and its subtree (no parent linkage).
   *
   * An arrow is copied only when **both** of its ends are inside the copied
   * subtree, remapped onto the copies. An arrow pointing outside would otherwise
   * make the copy reference a node in the original tree, and the next serialize
   * would emit that node's column — an arrow the user never drew.
   */
  clone(): Node {
    const copy = this.cloneWithoutArrows();
    const map = new Map<Node, Node>();
    const pair = (from: Node, to: Node) => {
      map.set(from, to);
      from.children.forEach((c, i) => pair(c, to.children[i]));
    };
    pair(this, copy);
    this.walk((n) => {
      const target = n.arrow?.target;
      if (!target) return;
      const newTarget = map.get(target);
      if (!newTarget) return;
      map.get(n)!.arrow = {
        target: newTarget,
        rawColumn: n.arrow!.rawColumn,
        ends: { ...n.arrow!.ends },
      };
    });
    return copy;
  }

  private cloneWithoutArrows(): Node {
    const copy = new Node(this.label);
    copy.subscript = this.subscript;
    copy.superscript = this.superscript;
    copy.triangle = this.triangle;
    copy.isWord = this.isWord;
    copy.color = this.color;
    copy.updateTextWidth();
    this.children.forEach((child) => copy.insertChild(child.cloneWithoutArrows()));
    return copy;
  }

  /** Visit this node and all descendants, depth-first. */
  walk(fn: (n: Node) => void) {
    fn(this);
    this.children.forEach((c) => c.walk(fn));
  }
}

export class Tree {
  root: Node;
  selectedNode: Node | null = null;
  maxDepth: number = 0;

  constructor(root?: Node) {
    this.root = root ?? new Node("S");
    this.root.depth = 0;
    this.root.setTree(this);
    this.recomputeDepth();
  }

  /** Recompute depth + maxDepth for the whole tree. */
  recomputeDepth() {
    this.maxDepth = 0;
    this.root.setTree(this);
  }

  /** Compute subtree widths for every node (used by the renderer for layout). */
  calculateWidths() {
    const calc = (node: Node): number => {
      node.updateTextWidth();
      const boxWidth = node.textWidth + settings.node.padding * 2;
      if (node.isLeaf) {
        node.width = Math.max(boxWidth, settings.node.minWidth);
        return node.width;
      }
      let childWidth = 0;
      node.children.forEach((child) => {
        childWidth += calc(child);
      });
      childWidth += settings.node.horizontalSpacing * (node.children.length - 1);
      node.width = Math.max(boxWidth, childWidth);
      return node.width;
    };
    calc(this.root);
  }

  /** Depth of the deepest leaf (terminal row). */
  maxLeafDepth(): number {
    let max = 0;
    this.root.walk((n) => {
      if (n.isLeaf && n.depth > max) max = n.depth;
    });
    return max;
  }
}

/**
 * Every word of a document, in document order — the columns an arrow's `N`
 * counts.
 *
 * Only **words** are columns. A childless *node* (`[N]`) is not one, matching
 * jsSyntaxTree exactly, where the count is over VALUEs (`is_leaf` there means
 * "is a VALUE", not "has no children"). The count spans the whole document
 * rather than one tree, again as in jsSyntaxTree, whose invisible root holds
 * every top-level group.
 */
export function wordColumns(trees: Tree[]): Node[] {
  const words: Node[] = [];
  trees.forEach((tree) =>
    tree.root.walk((n) => {
      if (n.isWord) words.push(n);
    })
  );
  return words;
}

/** Column number (1-based) of every word in `trees`. */
export function wordColumnIndex(trees: Tree[]): Map<Node, number> {
  const index = new Map<Node, number>();
  wordColumns(trees).forEach((word, i) => index.set(word, i + 1));
  return index;
}

/**
 * Point every arrow in `trees` at the word its column names, dropping the
 * target when the number lands outside the document. Runs after a parse, and
 * again whenever a document is rebuilt from text.
 */
export function resolveArrows(trees: Tree[]): void {
  const words = wordColumns(trees);
  trees.forEach((tree) =>
    tree.root.walk((n) => {
      if (n.arrow) n.arrow.target = words[n.arrow.rawColumn - 1] ?? null;
    })
  );
}
