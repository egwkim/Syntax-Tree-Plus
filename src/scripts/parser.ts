import { Node, Tree } from "./tree.js";

export interface ParseResult {
  tree: Tree | null;
  error: string | null;
}

/**
 * Split a raw label token into base / subscript / superscript.
 *
 *   "NP_1"   -> { base: "NP", sub: "1", sup: "" }
 *   "X^0"    -> { base: "X",  sub: "",  sup: "0" }
 *   "t_i"    -> { base: "t",  sub: "i", sup: "" }
 *   "N_1^0"  -> { base: "N",  sub: "1", sup: "0" }
 *
 * Only the first `_` / `^` is treated as a script marker. `\_` and `\^` are
 * literal.
 */
export function parseLabel(raw: string): {
  base: string;
  sub: string;
  sup: string;
} {
  let base = "";
  let sub = "";
  let sup = "";
  let mode: "base" | "sub" | "sup" = "base";

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "\\" && i + 1 < raw.length) {
      // Escaped character — take the next char literally.
      const next = raw[++i];
      if (mode === "base") base += next;
      else if (mode === "sub") sub += next;
      else sup += next;
      continue;
    }
    if (ch === "_") {
      mode = "sub";
      continue;
    }
    if (ch === "^") {
      mode = "sup";
      continue;
    }
    if (mode === "base") base += ch;
    else if (mode === "sub") sub += ch;
    else sup += ch;
  }
  return { base, sub, sup };
}

type Token =
  | { type: "open" }
  | { type: "close" }
  | { type: "text"; value: string };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let buf = "";
  const flush = () => {
    const trimmed = buf.trim();
    if (trimmed.length > 0) tokens.push({ type: "text", value: trimmed });
    buf = "";
  };
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "\\" && i + 1 < input.length) {
      buf += ch + input[i + 1];
      i++;
      continue;
    }
    if (ch === "[") {
      flush();
      tokens.push({ type: "open" });
    } else if (ch === "]") {
      flush();
      tokens.push({ type: "close" });
    } else {
      buf += ch;
    }
  }
  flush();
  return tokens;
}

/**
 * Parse labelled bracket notation into a Tree.
 *
 * Grammar (jsSyntaxTree-compatible):
 *   node     := '[' label content ']'
 *   content  := ( node | terminal )*
 *   terminal := run of bare words (a multi-word run becomes a triangle leaf)
 *
 * `[NP [Det the] [N cat]]`   -> NP with two labelled children
 * `[N cat]`                  -> N over the word "cat"
 * `[NP the cat]`             -> NP over a triangle spanning "the cat"
 */
export function parse(input: string): ParseResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { tree: null, error: "Empty input" };
  }

  const tokens = tokenize(trimmed);
  let pos = 0;

  function makeLabelNode(raw: string): Node {
    const { base, sub, sup } = parseLabel(raw);
    const node = new Node(base);
    node.subscript = sub;
    node.superscript = sup;
    node.updateTextWidth();
    return node;
  }

  function makeTerminal(raw: string): Node {
    // A multi-word terminal renders as a triangle; single words don't.
    const words = raw.trim().split(/\s+/);
    if (words.length > 1) {
      const node = new Node(raw.trim().replace(/\\(.)/g, "$1"));
      node.triangle = true;
      node.updateTextWidth();
      return node;
    }
    const node = makeLabelNode(raw.trim());
    return node;
  }

  function parseNode(): Node | string {
    if (pos >= tokens.length || tokens[pos].type !== "open") {
      return "Expected '['";
    }
    pos++; // consume '['

    // Read the label. Leniently allow a node with no label yet (mid-typing).
    let node: Node;
    if (pos < tokens.length && tokens[pos].type === "text") {
      const labelTok = tokens[pos] as { type: "text"; value: string };
      pos++;
      // The first word of the text token is the label; any remaining words on
      // the same run are terminal content belonging to this node.
      const parts = labelTok.value.split(/\s+/);
      const labelRaw = parts.shift()!;
      node = makeLabelNode(labelRaw);
      if (parts.length > 0) {
        node.insertChild(makeTerminal(parts.join(" ")));
      }
    } else {
      node = makeLabelNode("");
    }

    while (pos < tokens.length && tokens[pos].type !== "close") {
      const tok = tokens[pos];
      if (tok.type === "open") {
        const child = parseNode();
        if (typeof child === "string") return child;
        node.insertChild(child);
      } else if (tok.type === "text") {
        node.insertChild(makeTerminal(tok.value));
        pos++;
      } else {
        break;
      }
    }

    // Auto-close: a missing ']' is tolerated so the tree builds as you type.
    if (pos < tokens.length && tokens[pos].type === "close") {
      pos++; // consume ']'
    }
    return node;
  }

  const root = parseNode();
  if (typeof root === "string") {
    return { tree: null, error: root };
  }
  // Any trailing tokens (stray ']' or extra input) are ignored leniently.
  return { tree: new Tree(root), error: null };
}
