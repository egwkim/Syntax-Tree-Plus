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

/**
 * Does the child at `i` sit next to another **word**?
 *
 * Only words can merge on re-parse. A childless *node* neighbour is already
 * self-delimiting — its brackets end the run — so `[NP the [N]]` needs no
 * quotes on `the`.
 */
function hasWordNeighbour(children: Node[], i: number): boolean {
  return (
    (i > 0 && children[i - 1].isWord) ||
    (i + 1 < children.length && children[i + 1].isWord)
  );
}

/**
 * Serialize a node to labelled bracket notation.
 *
 * Word children are emitted as bare text; node children are wrapped in their
 * own brackets — including when they have no children of their own, which is
 * exactly what keeps a symbol (`[N]`) distinct from a word (`cat`) across a
 * round-trip. This is the inverse of {@link parse}.
 */
export function serializeNode(node: Node): string {
  if (node.isWord) return terminalToken(node, false);

  const parts = node.children.map((child, i) =>
    child.isWord
      ? terminalToken(child, hasWordNeighbour(node.children, i))
      : serializeNode(child)
  );

  // A childless node still needs its brackets — a bare label doesn't parse.
  if (parts.length === 0) return `[${labelToken(node)}]`;
  return `[${labelToken(node)} ${parts.join(" ")}]`;
}

export function serialize(tree: Tree): string {
  return serializeNode(tree.root);
}

/** Pretty-print a tree across multiple indented lines (nice for the text pane). */
export function serializePretty(tree: Tree, indent: string = "  "): string {
  const build = (node: Node, depth: number, standalone: boolean): string => {
    const pad = indent.repeat(depth);
    if (node.isWord) {
      return pad + terminalToken(node, standalone);
    }
    // Collapse a node whose children are all leaves (or that has none) onto
    // one line.
    if (node.children.every((c) => c.isLeaf)) {
      return pad + serializeNode(node);
    }
    // A newline is just whitespace to the parser, so adjacent terminals still
    // need to be self-delimiting even on separate lines.
    const inner = node.children
      .map((c, i) => build(c, depth + 1, hasWordNeighbour(node.children, i)))
      .join("\n");
    return `${pad}[${labelToken(node)}\n${inner}\n${pad}]`;
  };
  return build(tree.root, 0, false);
}
