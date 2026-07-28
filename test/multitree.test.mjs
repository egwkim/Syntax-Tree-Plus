/**
 * Multi-tree documents: a tab's text can hold several top-level trees.
 *
 * The contract here is the same one `roundtrip.test.mjs` pins down for a single
 * tree, lifted to a document: `parseAll` and `serializeAll` are inverses, the
 * trees stay separate (no merging, no reordering), and each keeps the notation
 * guarantees it had on its own. Plus the leniency rules that let you type a
 * second tree without the first one breaking mid-keystroke.
 *
 * Run with `make test` (builds first) or `node --test test/`.
 */
import "./dom-stub.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

import { parse, parseAll } from "../dist/scripts/parser.js";
import { serialize, serializeAll } from "../dist/scripts/serialize.js";

/** Structural fingerprint of a tree: everything the notation must preserve. */
const shape = (n) => ({
  label: n.label,
  sub: n.subscript,
  sup: n.superscript,
  triangle: n.triangle,
  children: n.children.map(shape),
});

const parsedAll = (text) => {
  const { trees, error } = parseAll(text);
  assert.equal(error, null, `unexpected parse error for ${text}: ${error}`);
  assert.ok(trees.length > 0, `no trees for ${text}`);
  return trees;
};

/** parse -> serialize -> parse preserves every tree, and is a fixed point. */
function assertRoundTrip(text) {
  const trees = parsedAll(text);
  const once = serializeAll(trees);
  const reparsed = parsedAll(once);
  assert.deepEqual(
    reparsed.map((t) => shape(t.root)),
    trees.map((t) => shape(t.root)),
    `document changed across a round-trip (serialized as ${once})`
  );
  assert.equal(
    serializeAll(reparsed),
    once,
    "serialization is not a fixed point"
  );
  return once;
}

// ---- parsing several trees -------------------------------------------

test("a document can hold several trees", () => {
  const trees = parsedAll("[S [NP Mary] [VP left]] [S [NP John] [VP stayed]]");
  assert.equal(trees.length, 2);
  assert.deepEqual(
    trees.map((t) => t.root.children.map((c) => c.label)),
    [
      ["NP", "VP"],
      ["NP", "VP"],
    ]
  );
});

test("trees are separated by structure, not whitespace", () => {
  // Newlines, no space at all, and extra indentation are all the same document.
  for (const text of ["[A x][B y]", "[A x]\n[B y]", "  [A x]   \n\n  [B y]  "]) {
    const trees = parsedAll(text);
    assert.equal(trees.length, 2, text);
    assert.deepEqual(trees.map((t) => t.root.label), ["A", "B"]);
  }
});

test("each tree keeps its own root — nothing is merged under a wrapper", () => {
  const trees = parsedAll("[NP the cat] [NP the mat]");
  assert.equal(trees.length, 2);
  for (const t of trees) {
    assert.equal(t.root.label, "NP");
    assert.equal(t.root.parent, null);
    assert.equal(t.root.children[0].triangle, true, "spans still triangle");
  }
});

test("co-indexation is per tree: a subscript in one doesn't reach the other", () => {
  // Movement arrows derive from a shared subscript within one tree (render.ts),
  // so the two `_1`s here are independent — the notation must keep them apart.
  const [first, second] = parsedAll(
    "[S [DP_1 the cat] [VP [V left] [DP t_1]]] [S [DP_1 a dog] [VP barked]]"
  );
  assert.notEqual(first.root, second.root);
  assert.equal(first.root.children[0].subscript, "1");
  assert.equal(second.root.children[0].subscript, "1");
  assertRoundTrip(serializeAll([first, second]));
});

// ---- leniency ---------------------------------------------------------

test("a missing ']' still auto-closes, absorbing what follows", () => {
  // Mid-typing tolerance is unchanged: the tokens after the unclosed bracket
  // belong to it, so this is one tree, not two.
  const { trees, error } = parseAll("[A [B x] [C y]");
  assert.equal(error, null);
  assert.equal(trees.length, 1);
  assert.deepEqual(trees[0].root.children.map((c) => c.label), ["B", "C"]);
});

test("junk between trees is skipped, junk before the first is an error", () => {
  const { trees, error } = parseAll("[A x] ] stray [B y]");
  assert.equal(error, null);
  assert.deepEqual(trees.map((t) => t.root.label), ["A", "B"]);

  assert.equal(parseAll("oops [A x]").error, "Expected '['");
  assert.equal(parseAll("   ").error, "Empty input");
  assert.deepEqual(parseAll("   ").trees, []);
});

test("parse() still returns just the first tree", () => {
  // The single-tree wrapper is what the round-trip tests and any caller that
  // wants one tree use; it must not start failing on a multi-tree document.
  const { tree, error } = parse("[A x] [B y]");
  assert.equal(error, null);
  assert.equal(tree.root.label, "A");
  assert.equal(serialize(tree), "[A x]");
});

// ---- round-trips ------------------------------------------------------

test("a multi-tree document round-trips, one tree per line", () => {
  const text = assertRoundTrip("[S [NP [D the] [N cat]] [VP sat]] [S [NP dogs] [VP bark]]");
  assert.equal(text, "[S [NP [D the] [N cat]] [VP sat]]\n[S [NP dogs] [VP bark]]");
  assert.equal(parsedAll(text).length, 2);
});

test("the notation's quoting rules hold inside each tree of a document", () => {
  // First tree: two childless *nodes* keep their own brackets. Second: adjacent
  // words are quoted so they don't merge into one span on re-parse. Third: a
  // quoted label keeps its literal underscore.
  assert.equal(
    assertRoundTrip('[NP [the] [cat]] [NP "the" "cat"] [S ["a_b" x]]'),
    '[NP [the] [cat]]\n[NP "the" "cat"]\n[S ["a_b" x]]'
  );
});

test("doubled quotes hold inside each tree of a document", () => {
  const text = '[NP cat] [N "she said ""hi"""]';
  const [a, b] = parsedAll(text);
  assert.equal(a.root.children[0].label, "cat");
  assert.equal(b.root.children[0].label, 'she said "hi"');
  assertRoundTrip(text);
});

test("words and childless nodes stay distinct across trees", () => {
  // The word/node split is carried by bracketing, so it has to survive being
  // one tree of several just as it does on its own.
  const [words, nodes] = parsedAll("[S cat] [S [cat]]");
  assert.equal(words.root.children[0].isWord, true);
  assert.equal(nodes.root.children[0].isWord, false);
  assert.equal(assertRoundTrip("[S cat] [S [cat]]"), "[S cat]\n[S [cat]]");
});

test("a one-tree document serializes exactly as it did before", () => {
  // No churn for ordinary single-tree documents: serializeAll of one tree is
  // just serialize.
  for (const text of [
    "[S]",
    "[NP the big cat_1]",
    "[S [NP [D the] [N cat]] [VP [V sat]]]",
  ]) {
    const trees = parsedAll(text);
    assert.equal(trees.length, 1);
    assert.equal(serializeAll(trees), serialize(trees[0]));
    assert.equal(serializeAll(trees), text);
  }
});

test("an empty document serializes to the empty string", () => {
  assert.equal(serializeAll([]), "");
});
