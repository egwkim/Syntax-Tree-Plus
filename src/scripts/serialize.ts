import { Node, Tree } from "./tree.js";

/**
 * Characters that would break a bare token: the structural brackets, the script
 * markers, the quote itself, and whitespace. There is no escape character —
 * jsSyntaxTree has none — so a label containing any of these is quoted instead.
 */
const NEEDS_QUOTING = /[\s[\]_^"]/;

/**
 * Wrap `text` in quotes. A literal `"` has no representation at all
 * (jsSyntaxTree's quoted strings carry no escape mechanism), so one is dropped
 * rather than emitted to produce text that wouldn't parse back.
 */
function quoted(text: string): string {
  return `"${text.replace(/"/g, "")}"`;
}

/** Render `text` as one token, quoting it only when it contains a delimiter. */
function quoteIfNeeded(text: string): string {
  return NEEDS_QUOTING.test(text) ? quoted(text) : text;
}

/** The `^sup` / `_sub` suffix, shared by every label form. */
function scriptSuffix(node: Node): string {
  let s = "";
  if (node.superscript) s += "^" + quoteIfNeeded(node.superscript);
  if (node.subscript) s += "_" + quoteIfNeeded(node.subscript);
  return s;
}

/** Rebuild a raw label token, e.g. base="N", sub="1", sup="0" -> "N^0_1". */
function labelToken(node: Node): string {
  return quoteIfNeeded(node.label) + scriptSuffix(node);
}

/**
 * Delimiters that force a *terminal* to be quoted. Whitespace is absent on
 * purpose: a run of bare words is the idiomatic spelling of a span, and `parse`
 * rejoins it, so `the big cat` needs no quotes. (A node **label** is different —
 * it can't hold a bare space, so `labelToken` quotes on whitespace too.)
 */
const TERMINAL_NEEDS_QUOTING = /[[\]_^"]/;

/**
 * The token for a terminal.
 *
 * `standalone` means it sits next to another terminal, so it has to be
 * self-delimiting or the two would serialize into one space-separated run and
 * merge on re-parse. Quoting is what makes it self-delimiting: a quoted value is
 * never joined into a neighbouring run (jsSyntaxTree's `parseValue` accumulates
 * only unquoted tokens).
 */
function terminalToken(node: Node, standalone: boolean): string {
  const label = node.label;
  const quote = standalone || TERMINAL_NEEDS_QUOTING.test(label);
  return (quote ? quoted(label) : label) + scriptSuffix(node);
}

/** Does the child at `i` sit next to another terminal? */
function hasLeafNeighbour(children: Node[], i: number): boolean {
  return (
    (i > 0 && children[i - 1].isLeaf) ||
    (i + 1 < children.length && children[i + 1].isLeaf)
  );
}

/**
 * Serialize a node to labelled bracket notation.
 *
 * Terminal (leaf) children are emitted as bare text; labelled children are
 * wrapped in their own brackets. This is the inverse of {@link parse}.
 */
export function serializeNode(node: Node): string {
  if (node.isLeaf) return labelToken(node);

  const parts = node.children.map((child, i) =>
    child.isLeaf
      ? terminalToken(child, hasLeafNeighbour(node.children, i))
      : serializeNode(child)
  );

  return `[${labelToken(node)} ${parts.join(" ")}]`;
}

export function serialize(tree: Tree): string {
  // A childless root still needs its brackets — a bare label doesn't parse.
  if (tree.root.isLeaf) return `[${labelToken(tree.root)}]`;
  return serializeNode(tree.root);
}

/** Pretty-print a tree across multiple indented lines (nice for the text pane). */
export function serializePretty(tree: Tree, indent: string = "  "): string {
  const build = (node: Node, depth: number, standalone: boolean): string => {
    const pad = indent.repeat(depth);
    if (node.isLeaf) {
      return pad + terminalToken(node, standalone);
    }
    // Collapse a node whose children are all terminals onto one line.
    const allLeaves = node.children.every((c) => c.isLeaf);
    if (allLeaves) {
      return pad + serializeNode(node);
    }
    // A newline is just whitespace to the parser, so adjacent terminals still
    // need to be self-delimiting even on separate lines.
    const inner = node.children
      .map((c, i) => build(c, depth + 1, hasLeafNeighbour(node.children, i)))
      .join("\n");
    return `${pad}[${labelToken(node)}\n${inner}\n${pad}]`;
  };
  return build(tree.root, 0, false);
}
