import { Node, Tree, wordColumnIndex } from "./tree.js";

/** Column numbers for every word of a document — see `wordColumnIndex`. */
type Columns = Map<Node, number>;

/**
 * Characters that would break a bare token: the structural brackets, the script
 * markers, the quote itself, and whitespace. There is no backslash escape
 * character — jsSyntaxTree has none — so a label containing any of these is
 * quoted instead.
 */
const NEEDS_QUOTING = /[\s[\]_^"]/;

/**
 * An arrow marker sitting where the tokenizer would read one — the one piece of
 * syntax that isn't a single delimiter character, so `NEEDS_QUOTING` can't see
 * it.
 *
 * The marker is only recognised at the **start of a token**, which is exactly
 * what this matches: `well-known`, `a->b` and `<p>` stay bare, while a value
 * that begins one of its tokens with `->`, `<-` or `<>` gets quoted. Without
 * this, `[N "->"]` serializes to `[N ->]` and comes back as an empty `[N]` —
 * the word is read as a (dangling) arrow and vanishes.
 */
const ARROW_TOKEN = /(?:^|\s)(?:->|<-|<>)/;

/**
 * Wrap `text` in quotes, doubling any literal `"` (SQL/CSV-style) so it
 * survives inside the quoted string — the one addition beyond jsSyntaxTree's
 * own quoting, which has no inner escape at all. See the tokenizer's `"`
 * branch in parser.ts for the read side.
 */
function quoted(text: string): string {
  return `"${text.replace(/"/g, '""')}"`;
}

/** Render `text` as one token, quoting it only when it contains a delimiter. */
function quoteIfNeeded(text: string): string {
  return NEEDS_QUOTING.test(text) || ARROW_TOKEN.test(text) ? quoted(text) : text;
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
 * The ` -> N` suffix for a word carrying a movement arrow.
 *
 * The column is **re-derived** from where the target sits now, so every GUI edit
 * that shifts the terminals renumbers the arrows for free. Three cases:
 *
 * - target resolved and still in the document → its current column;
 * - target gone (deleted, or moved to another document) → no arrow at all,
 *   since there's nothing left to point at;
 * - never resolved (a hand-typed number past the last column) → the number as
 *   written, so text the user typed isn't quietly deleted.
 *
 * The space in front is required: `t->1` is a single word to the tokenizer —
 * ours and jsSyntaxTree's alike — so an arrow has to start its own token.
 */
function arrowSuffix(node: Node, columns: Columns): string {
  const arrow = node.arrow;
  if (!arrow) return "";
  let column: number;
  if (arrow.target) {
    const current = columns.get(arrow.target);
    if (current === undefined) return "";
    column = current;
  } else {
    column = arrow.rawColumn;
  }
  const mark = arrow.ends.to ? (arrow.ends.from ? "<>" : "->") : "<-";
  return ` ${mark} ${column}`;
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
function terminalToken(node: Node, standalone: boolean, columns: Columns): string {
  const label = node.label;
  const quote =
    standalone || TERMINAL_NEEDS_QUOTING.test(label) || ARROW_TOKEN.test(label);
  return (quote ? quoted(label) : label) + scriptSuffix(node) + arrowSuffix(node, columns);
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
export function serializeNode(node: Node, columns?: Columns): string {
  const cols = columns ?? wordColumnIndex(node.tree ? [node.tree] : []);
  if (node.isWord) return terminalToken(node, false, cols);

  const parts = node.children.map((child, i) =>
    child.isWord
      ? terminalToken(child, hasWordNeighbour(node.children, i), cols)
      : serializeNode(child, cols)
  );

  // A childless node still needs its brackets — a bare label doesn't parse.
  if (parts.length === 0) return `[${labelToken(node)}]`;
  return `[${labelToken(node)} ${parts.join(" ")}]`;
}

export function serialize(tree: Tree, columns?: Columns): string {
  return serializeNode(tree.root, columns ?? wordColumnIndex([tree]));
}

/**
 * Serialize a whole document — every tree in a tab — back to bracket notation.
 *
 * One tree per line: a newline is plain whitespace to the tokenizer, so the
 * separator is purely cosmetic, but it keeps a multi-tree document readable in
 * the text pane and makes each tree a line you can select. Inverse of
 * {@link parseAll}.
 */
export function serializeAll(trees: Tree[], separator = "\n"): string {
  // One shared column index: an arrow's number counts the whole document's
  // terminals, so it can't be computed a tree at a time.
  const columns = wordColumnIndex(trees);
  return trees.map((tree) => serialize(tree, columns)).join(separator);
}

/**
 * Pretty-print a tree across multiple indented lines (nice for the text pane).
 *
 * `columns` must be the **document's** index whenever the tree is part of a
 * multi-tree document — see {@link serializePrettyAll}, which is what the
 * Pretty-print button calls.
 */
export function serializePretty(
  tree: Tree,
  indent: string = "  ",
  columns: Columns = wordColumnIndex([tree])
): string {
  const build = (node: Node, depth: number, standalone: boolean): string => {
    const pad = indent.repeat(depth);
    if (node.isWord) {
      return pad + terminalToken(node, standalone, columns);
    }
    // Collapse a node whose children are all leaves (or that has none) onto
    // one line.
    if (node.children.every((c) => c.isLeaf)) {
      return pad + serializeNode(node, columns);
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

/**
 * Pretty-print a whole document — the form the Pretty-print button uses.
 *
 * The blank line between trees is cosmetic (a newline is plain whitespace to
 * the tokenizer), but the shared column index is not: an arrow's `N` counts the
 * document's terminals, so numbering each tree on its own silently repoints
 * every arrow in the second tree onwards — `-> 3` reformatted to `-> 1` is a
 * different word, not a different spelling of the same one.
 */
export function serializePrettyAll(
  trees: Tree[],
  indent: string = "  ",
  separator = "\n\n"
): string {
  const columns = wordColumnIndex(trees);
  return trees.map((tree) => serializePretty(tree, indent, columns)).join(separator);
}
