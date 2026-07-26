import { Node, Tree } from "./tree.js";

export interface ParseResult {
  tree: Tree | null;
  error: string | null;
}

/**
 * Characters that end a bare (unquoted) token — the same set jsSyntaxTree's
 * tokenizer breaks on. There is deliberately **no escape character**: a literal
 * space, `_`, `^`, `[` or `]` gets into a label by quoting it (`"a_b"`).
 */
const DELIMITERS = new Set(["[", "]", "_", "^", '"']);

interface WordToken {
  type: "word";
  value: string;
  /** Written as `"…"` — always a value on its own, never joined into a run. */
  quoted: boolean;
}

type Token =
  | { type: "open" }
  | { type: "close" }
  | { type: "sub" }
  | { type: "sup" }
  | WordToken;

const isSpace = (ch: string) => ch === " " || ch === "\t" || ch === "\n" || ch === "\r";

/**
 * Split bracket notation into structural tokens.
 *
 * Whitespace only separates words; a run of bare words is rejoined with single
 * spaces when it becomes a terminal (see `readValue`). Inside `"…"` every
 * character is literal — including spaces, brackets and the script markers —
 * and an unterminated quote runs to end of input, matching how a missing `]`
 * is tolerated so the tree still builds while you type.
 */
function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (isSpace(ch)) {
      i++;
    } else if (ch === "[") {
      tokens.push({ type: "open" });
      i++;
    } else if (ch === "]") {
      tokens.push({ type: "close" });
      i++;
    } else if (ch === "_") {
      tokens.push({ type: "sub" });
      i++;
    } else if (ch === "^") {
      tokens.push({ type: "sup" });
      i++;
    } else if (ch === '"') {
      const end = input.indexOf('"', i + 1);
      const value = end === -1 ? input.slice(i + 1) : input.slice(i + 1, end);
      tokens.push({ type: "word", value, quoted: true });
      i = end === -1 ? input.length : end + 1;
    } else {
      let j = i;
      while (j < input.length && !isSpace(input[j]) && !DELIMITERS.has(input[j])) j++;
      tokens.push({ type: "word", value: input.slice(i, j), quoted: false });
      i = j;
    }
  }
  return tokens;
}

/**
 * Read one value (a label or a terminal) starting at `i`.
 *
 * Consecutive **bare** words join into a space-separated span — `the big cat`
 * is one terminal. A **quoted** word stands alone, which is what makes two
 * adjacent spans expressible: `[NP "the big" "old cat"]`. jsSyntaxTree's
 * `parseValue` accumulates only unquoted tokens for the same reason.
 */
function readValue(
  tokens: Token[],
  i: number
): { value: string; quoted: boolean; next: number } {
  const first = tokens[i] as WordToken;
  let value = first.value;
  let next = i + 1;
  if (!first.quoted) {
    while (next < tokens.length) {
      const t = tokens[next];
      if (t.type !== "word" || t.quoted) break;
      value += " " + t.value;
      next++;
    }
  }
  return { value, quoted: first.quoted, next };
}

/**
 * Apply any `_x` / `^y` markers that follow a value. A marker with no value
 * after it (mid-typing, or before a `]`) is ignored rather than consuming the
 * next structural token.
 */
function readScripts(tokens: Token[], i: number, node: Node): number {
  let pos = i;
  while (pos < tokens.length) {
    const marker = tokens[pos];
    if (marker.type !== "sub" && marker.type !== "sup") break;
    const value = tokens[pos + 1];
    if (!value || value.type !== "word") {
      pos++; // dangling marker — skip it
      continue;
    }
    if (marker.type === "sub") node.subscript = value.value;
    else node.superscript = value.value;
    pos += 2;
  }
  return pos;
}

/**
 * Split a raw label token into base / subscript / superscript.
 *
 *   "NP_1"        -> { base: "NP",        sub: "1", sup: "" }
 *   "X^0"         -> { base: "X",         sub: "",  sup: "0" }
 *   "N_1^0"       -> { base: "N",         sub: "1", sup: "0" }
 *   "the big cat" -> { base: "the big cat", sub: "", sup: "" }
 *   "\"a_b\""     -> { base: "a_b",       sub: "",  sup: "" }  (quoted: literal)
 *
 * Used by the inline editor, which edits a node's raw token; it shares the
 * tokenizer with `parse`, so quoting behaves identically in both.
 */
export function parseLabel(raw: string): {
  base: string;
  sub: string;
  sup: string;
} {
  const tokens = tokenize(raw);
  const scratch = new Node("");
  let base = "";
  let pos = 0;
  if (pos < tokens.length && tokens[pos].type === "word") {
    const read = readValue(tokens, pos);
    base = read.value;
    pos = read.next;
  }
  readScripts(tokens, pos, scratch);
  return { base, sub: scratch.subscript, sup: scratch.superscript };
}

/**
 * Parse labelled bracket notation into a Tree.
 *
 * Grammar (jsSyntaxTree-compatible):
 *   node     := '[' label content ']'
 *   content  := ( node | terminal )*
 *   label    := word | '"' … '"'   (+ optional _sub / ^sup)
 *   terminal := run of bare words | '"' … '"'   (+ optional _sub / ^sup)
 *
 * `[NP [Det the] [N cat]]`   -> NP with two labelled children
 * `[N cat]`                  -> N over the word "cat"
 * `[NP the cat]`             -> NP over one span "the cat" (a triangle)
 * `[NP "the" "cat"]`         -> NP over two separate terminals
 * `[NP the big cat_1]`       -> the span "the big cat", subscript 1
 * `[NP [N]]`                 -> NP over a childless *node* N — not a word
 *
 * Bracketing is what tells a word from a node: content typed bare is a word
 * (`isWord`), anything in its own `[...]` is a node even when it ends up
 * childless. Same rule as jsSyntaxTree's VALUE vs NODE.
 */
export function parse(input: string): ParseResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { tree: null, error: "Empty input" };
  }

  const tokens = tokenize(trimmed);
  let pos = 0;

  /** One terminal: a bare run, or a single quoted value. */
  function makeTerminal(): Node {
    const { value, next } = readValue(tokens, pos);
    pos = next;
    const node = new Node(value);
    node.isWord = true; // unbracketed content is a word (jsSyntaxTree's VALUE)
    pos = readScripts(tokens, pos, node);
    // A multi-word terminal renders as a triangle; single words don't.
    if (value.indexOf(" ") >= 0) node.triangle = true;
    node.updateTextWidth();
    return node;
  }

  function parseNode(): Node | string {
    if (pos >= tokens.length || tokens[pos].type !== "open") {
      return "Expected '['";
    }
    pos++; // consume '['

    // Read the label. Leniently allow a node with no label yet (mid-typing).
    let node: Node;
    if (pos < tokens.length && tokens[pos].type === "word") {
      const { value, quoted, next } = readValue(tokens, pos);
      pos = next;
      // Only the first word of a *bare* run labels the node; the rest is
      // terminal content belonging to it, so `[NP the cat]` is NP over the span.
      // A quoted label is literal — `["the big" x]` is the node "the big".
      const space = quoted ? -1 : value.indexOf(" ");
      const labelText = space >= 0 ? value.slice(0, space) : value;
      const rest = space >= 0 ? value.slice(space + 1) : "";
      node = new Node(labelText);
      if (rest) {
        // The label takes no scripts here — a trailing `_1` binds to the run.
        const child = new Node(rest);
        child.isWord = true;
        pos = readScripts(tokens, pos, child);
        if (rest.indexOf(" ") >= 0) child.triangle = true;
        child.updateTextWidth();
        node.insertChild(child);
      } else {
        pos = readScripts(tokens, pos, node);
      }
      node.updateTextWidth();
    } else {
      node = new Node("");
    }

    while (pos < tokens.length && tokens[pos].type !== "close") {
      const tok = tokens[pos];
      if (tok.type === "open") {
        const child = parseNode();
        if (typeof child === "string") return child;
        node.insertChild(child);
      } else if (tok.type === "word") {
        node.insertChild(makeTerminal());
      } else {
        pos++; // stray script marker outside a value — skip it
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
