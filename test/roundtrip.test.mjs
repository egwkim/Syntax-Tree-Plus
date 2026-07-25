/**
 * Parser/serializer round-trip tests.
 *
 * The contract these pin down: `parse` and `serialize` are inverses. For any
 * document, re-parsing what we serialize must yield the same *tree shape*
 * (labels, scripts, triangle flags, nesting), and serializing is a fixed point
 * — one more pass can't change the text. Both silent data-loss bugs the app has
 * had (triangle scripts, adjacent word-leaves) are exactly this contract
 * failing, and neither needed a browser to catch.
 *
 * Run with `make test` (builds first) or `node --test test/`.
 */
import "./dom-stub.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

import { parse, parseLabel } from "../dist/scripts/parser.js";
import { serialize, serializeNode } from "../dist/scripts/serialize.js";
import { Node } from "../dist/scripts/tree.js";

/** Structural fingerprint of a tree: everything the notation must preserve. */
const shape = (n) => ({
  label: n.label,
  sub: n.subscript,
  sup: n.superscript,
  triangle: n.triangle,
  children: n.children.map(shape),
});

const parsed = (text) => {
  const { tree, error } = parse(text);
  assert.equal(error, null, `unexpected parse error for ${text}: ${error}`);
  assert.ok(tree, `no tree for ${text}`);
  return tree;
};

/**
 * The core assertion: parse -> serialize -> parse preserves the tree, and the
 * serialized form is stable (a second pass is a no-op).
 */
function assertRoundTrip(text, label = text) {
  const tree = parsed(text);
  const once = serialize(tree);
  const reparsed = parsed(once);
  assert.deepEqual(
    shape(reparsed.root),
    shape(tree.root),
    `${label}: tree changed across a round-trip (serialized as ${once})`
  );
  assert.equal(
    serialize(reparsed),
    once,
    `${label}: serialization is not a fixed point`
  );
  return once;
}

// ---- parseLabel ------------------------------------------------------

test("parseLabel splits base / subscript / superscript", () => {
  assert.deepEqual(parseLabel("NP"), { base: "NP", sub: "", sup: "" });
  assert.deepEqual(parseLabel("NP_1"), { base: "NP", sub: "1", sup: "" });
  assert.deepEqual(parseLabel("X^0"), { base: "X", sub: "", sup: "0" });
  assert.deepEqual(parseLabel("N_1^0"), { base: "N", sub: "1", sup: "0" });
  assert.deepEqual(parseLabel("t_i"), { base: "t", sub: "i", sup: "" });
});

test("parseLabel treats a quoted marker as a literal", () => {
  assert.deepEqual(parseLabel('"a_b"'), { base: "a_b", sub: "", sup: "" });
  assert.deepEqual(parseLabel('"a^b"'), { base: "a^b", sub: "", sup: "" });
  assert.deepEqual(parseLabel('"a_b"_1'), { base: "a_b", sub: "1", sup: "" });
});

test("parseLabel joins a bare multi-word run (inline-edited triangle)", () => {
  assert.deepEqual(parseLabel("the big cat"), {
    base: "the big cat",
    sub: "",
    sup: "",
  });
  assert.deepEqual(parseLabel("the big cat_1"), {
    base: "the big cat",
    sub: "1",
    sup: "",
  });
});

// ---- structural round-trips ------------------------------------------

test("round-trips ordinary trees unchanged", () => {
  for (const text of [
    "[S]",
    "[N cat]",
    "[S [NP [D the] [N cat]] [VP [V sat]]]",
    "[S [NP [D the][N cat]] [VP [V sat] [PP [P on] [NP [D the][N mat]]]]]",
    "[TP [DP_1 [D the] [N cat]] [T' [T was] [VP [V seen] [DP t_1]]]]",
    "[XP [Spec x] [X' [X^0 head] [Compl y]]]",
  ]) {
    assertRoundTrip(text);
  }
});

test("a childless root keeps its brackets", () => {
  // Serializing a bare label would produce text that no longer parses.
  const tree = parsed("[S]");
  assert.equal(serialize(tree), "[S]");
  assert.equal(tree.root.children.length, 0);
});

// ---- Fix A: scripts on a multi-word (triangle) terminal --------------

test("a multi-word terminal is a triangle", () => {
  const tree = parsed("[NP the big cat]");
  const leaf = tree.root.children[0];
  assert.equal(leaf.label, "the big cat");
  assert.equal(leaf.triangle, true);
  assert.equal(serialize(tree), "[NP the big cat]");
});

test("scripts bind to the whole terminal run, not its last word", () => {
  const tree = parsed("[NP the big cat_1]");
  const leaf = tree.root.children[0];
  assert.equal(leaf.label, "the big cat", "the run is the span");
  assert.equal(leaf.subscript, "1", "the trailing _1 is a subscript");
  assert.equal(leaf.triangle, true);
});

test("a triangle keeps its subscript across a round-trip", () => {
  // Regression: serializeNode used to emit a bare label for triangle leaves,
  // silently dropping scripts — so a moved phrase lost its movement index.
  const text = assertRoundTrip("[NP the big cat_1]");
  assert.equal(text, "[NP the big cat_1]");
});

test("a triangle keeps a superscript, and both scripts together", () => {
  assert.equal(assertRoundTrip("[NP the big cat^0]"), "[NP the big cat^0]");
  assert.equal(assertRoundTrip("[NP the big cat^0_1]"), "[NP the big cat^0_1]");
});

test("a co-indexed triangle and its trace survive together", () => {
  const text = assertRoundTrip("[S [DP the big cat_1] [VP [V left] [DP t_1]]]");
  const tree = parsed(text);
  const dp = tree.root.children[0].children[0];
  const trace = tree.root.children[1].children[1].children[0];
  assert.equal(dp.subscript, "1");
  assert.equal(trace.subscript, "1", "the movement index links both nodes");
});

test("a single-word terminal with a subscript is not a triangle", () => {
  const tree = parsed("[VP [DP t_1]]");
  const trace = tree.root.children[0].children[0];
  assert.equal(trace.label, "t");
  assert.equal(trace.subscript, "1");
  assert.equal(trace.triangle, false);
});

// ---- Fix B: adjacent terminals ---------------------------------------

test("adjacent single-word terminals stay distinct", () => {
  // Regression: these serialized to one space-separated run ("[NP the cat]")
  // and merged into a single triangle on re-parse. A quoted value is never
  // joined into a neighbouring run, so quoting keeps them apart.
  const tree = parsed("[NP [the] [cat]]");
  assert.equal(tree.root.children.length, 2);
  assert.equal(serialize(tree), '[NP "the" "cat"]');
  assertRoundTrip('[NP "the" "cat"]');
  assertRoundTrip("[NP [the] [cat]]"); // the bracketed spelling also round-trips
});

test("three adjacent terminals stay distinct", () => {
  const text = assertRoundTrip('[NP "the" "big" "cat"]');
  assert.equal(text, '[NP "the" "big" "cat"]');
  assert.equal(parsed(text).root.children.length, 3);
});

test("adjacent terminals keep their own scripts", () => {
  const text = assertRoundTrip('[NP "the"_1 "cat"_2]');
  const kids = parsed(text).root.children;
  assert.deepEqual(kids.map((k) => k.subscript), ["1", "2"]);
});

test("a lone terminal is still emitted bare (no notation churn)", () => {
  // Only a terminal with a terminal neighbour has to be self-delimiting.
  assert.equal(serialize(parsed("[N cat]")), "[N cat]");
  assert.equal(serialize(parsed("[NP [D the] [N cat]]")), "[NP [D the] [N cat]]");
  assert.equal(serialize(parsed("[NP the big cat]")), "[NP the big cat]");
});

test("a word next to a span keeps both distinct", () => {
  const tree = parsed("[NP [the] big cat]");
  assert.deepEqual(
    tree.root.children.map((c) => [c.label, c.triangle]),
    [["the", false], ["big cat", true]]
  );
  assertRoundTrip("[NP [the] big cat]");
  assertRoundTrip("[NP the big [cat]]");
  assertRoundTrip('[NP "the" "big cat"]');
});

test("a terminal beside a labelled node needs no brackets", () => {
  assertRoundTrip("[NP the big cat [PP [P on] [N mat]]]");
});

// ---- two adjacent spans (was the last lossy arrangement) -------------

test("two adjacent spans stay distinct, via quoting", () => {
  // Neither span can be bracketed — "[the big]" reads back as the node "the"
  // over the terminal "big" — so this used to be inexpressible and the app
  // showed a warning banner. Quoted values don't merge, so it round-trips now.
  const tree = parsed("[NP x]");
  const np = tree.root;
  np.children[0].updateLabel("the big");
  np.children[0].triangle = true;
  const second = new Node("old cat");
  second.triangle = true;
  np.insertChild(second);

  const text = serialize(tree);
  assert.equal(text, '[NP "the big" "old cat"]');
  const reparsed = parsed(text);
  assert.equal(reparsed.root.children.length, 2, "no longer merged");
  assert.deepEqual(
    reparsed.root.children.map((c) => [c.label, c.triangle]),
    [["the big", true], ["old cat", true]]
  );
  assertRoundTrip(text);
});

// ---- quoting (jsSyntaxTree's escape mechanism) ------------------------

test("a quoted value is one token, delimiters and all", () => {
  const tree = parsed('[NP "the big cat"]');
  const leaf = tree.root.children[0];
  assert.equal(leaf.label, "the big cat");
  assert.equal(leaf.triangle, true, "it still spans several words");
});

test("a quoted label keeps a literal underscore", () => {
  // Bare `a_b` means base "a" + subscript "b"; quoting makes it literal.
  const bare = parsed("[NP [N a_b]]").root.children[0].children[0];
  assert.equal(bare.label, "a");
  assert.equal(bare.subscript, "b");

  const text = assertRoundTrip('[NP [N "a_b"]]');
  assert.equal(text, '[NP [N "a_b"]]');
  const quoted = parsed(text).root.children[0].children[0];
  assert.equal(quoted.label, "a_b");
  assert.equal(quoted.subscript, "", "the underscore is literal, not a script");
});

test("a quoted label keeps a literal caret and brackets", () => {
  for (const [text, want] of [
    ['[NP [N "a^b"]]', "a^b"],
    ['[NP [N "[x]"]]', "[x]"],
  ]) {
    const out = assertRoundTrip(text);
    assert.equal(out, text);
    assert.equal(parsed(out).root.children[0].children[0].label, want);
  }
});

test("an internal node label containing a space round-trips", () => {
  // Regression: this used to serialize as `my\ node` and re-parse as `my\`.
  const tree = parsed("[S [X y]]");
  tree.root.children[0].updateLabel("my node");
  const text = serialize(tree);
  assert.equal(text, '[S ["my node" y]]');
  const back = parsed(text);
  assert.equal(back.root.children[0].label, "my node");
  assert.equal(back.root.children[0].children[0].label, "y");
  assertRoundTrip(text);
});

test("quoted values carry scripts, and scripts can be quoted", () => {
  // A lone span needs no quotes, so the quoted input normalises to the bare
  // spelling — same tree either way.
  assert.equal(assertRoundTrip('[NP "the big"_1]'), "[NP the big_1]");
  assert.equal(assertRoundTrip('[NP "the big"_1 "old cat"_2]'), '[NP "the big"_1 "old cat"_2]');
  const tree = parsed("[NP x]");
  tree.root.subscript = "a b";
  assert.equal(serialize(tree), '[NP_"a b" x]');
  assert.equal(parsed(serialize(tree)).root.subscript, "a b");
});

test("quoting is only used where it's needed", () => {
  // Nothing in an ordinary document should acquire quotes.
  for (const text of [
    "[S [NP [D the] [N cat]] [VP [V sat]]]",
    "[NP the big cat]",
    "[NP the big cat_1]",
    "[TP [DP_1 the cat] [T' [T was] [VP t_1]]]",
  ]) {
    assert.equal(serialize(parsed(text)), text);
    assert.ok(!serialize(parsed(text)).includes('"'), `${text} should stay unquoted`);
  }
});

test("an unterminated quote is tolerated while typing", () => {
  const { tree, error } = parse('[NP "the big');
  assert.equal(error, null);
  assert.equal(tree.root.children[0].label, "the big");
});

test("backslashes are ordinary characters now (no escape mechanism)", () => {
  // jsSyntaxTree has no escape character; `\` is just text.
  const leaf = parsed("[NP back\\slash]").root.children[0];
  assert.equal(leaf.label, "back\\slash");
});

test("serializeNode is exported for pretty-printing and matches serialize", () => {
  const tree = parsed("[S [NP [D the] [N cat]] [VP sat]]");
  assert.equal(serializeNode(tree.root), serialize(tree));
});
