import { Node, Tree } from "./tree.js";

/** Escape characters that are structurally meaningful in bracket notation. */
function escapeText(text: string): string {
  return text.replace(/([\[\]\\])/g, "\\$1");
}

/** Rebuild a raw label token, e.g. base="N", sub="1", sup="0" -> "N^0_1". */
function labelToken(node: Node): string {
  let s = escapeText(node.label).replace(/ /g, "\\ ");
  if (node.superscript) s += "^" + node.superscript;
  if (node.subscript) s += "_" + node.subscript;
  return s;
}

/**
 * Serialize a node to labelled bracket notation.
 *
 * Terminal (leaf) children are emitted as bare text; labelled children are
 * wrapped in their own brackets. This is the inverse of {@link parse}.
 */
export function serializeNode(node: Node): string {
  if (node.isLeaf) {
    // A bare terminal (word / triangle span).
    if (node.triangle) {
      return escapeText(node.label);
    }
    return labelToken(node);
  }

  const parts = node.children.map((child) => {
    if (child.isLeaf) {
      // Emit terminals inline without wrapping brackets.
      return child.triangle ? escapeText(child.label) : labelToken(child);
    }
    return serializeNode(child);
  });

  return `[${labelToken(node)} ${parts.join(" ")}]`;
}

export function serialize(tree: Tree): string {
  return serializeNode(tree.root);
}

/** Pretty-print a tree across multiple indented lines (nice for the text pane). */
export function serializePretty(tree: Tree, indent: string = "  "): string {
  const build = (node: Node, depth: number): string => {
    const pad = indent.repeat(depth);
    if (node.isLeaf) {
      return pad + (node.triangle ? escapeText(node.label) : labelToken(node));
    }
    // Collapse a node whose children are all terminals onto one line.
    const allLeaves = node.children.every((c) => c.isLeaf);
    if (allLeaves) {
      return pad + serializeNode(node);
    }
    const inner = node.children
      .map((c) => build(c, depth + 1))
      .join("\n");
    return `${pad}[${labelToken(node)}\n${inner}\n${pad}]`;
  };
  return build(tree.root, 0);
}
