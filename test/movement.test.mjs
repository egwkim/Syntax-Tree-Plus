/**
 * Movement arrows: the explicit `-> N` / `<- N` / `<> N` notation borrowed from
 * jsSyntaxTree, where N is the target's terminal **column** (1-based, counted
 * left to right across the whole document).
 *
 * The three things worth pinning:
 *   - arrows are *written*, never inferred — a shared subscript draws nothing,
 *     so co-indexes used for binding or numbering stay quiet;
 *   - the column is re-derived from the target on every serialize, so editing
 *     the tree renumbers the arrows instead of moving them;
 *   - several arrows chain because each one names its own target — the bug that
 *     started this (three co-indexed positions all pointing at the topmost) is
 *     unrepresentable now.
 *
 * Run with `make test` (builds first) or `node --test test/`.
 */
import "./dom-stub.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

import { parse, parseAll } from "../dist/scripts/parser.js";
import {
  serialize,
  serializeAll,
  serializePrettyAll,
} from "../dist/scripts/serialize.js";
import { collectArrows } from "../dist/scripts/render.js";
import {
  setArrow,
  clearArrow,
  nextArrowEnds,
  deleteNode,
  toggleWordNode,
} from "../dist/scripts/edit.js";
import { wordColumns } from "../dist/scripts/tree.js";

const tree = (text) => {
  const { tree, error } = parse(text);
  assert.equal(error, null, `unexpected parse error for ${text}: ${error}`);
  return tree;
};

/** Arrows as [from label, to label, ends], for easy comparison. */
const arrows = (t) =>
  collectArrows(t).map((a) => [
    a.from.label,
    a.to.label,
    a.ends.to ? (a.ends.from ? "<>" : "->") : "<-",
  ]);

test("an arrow points at the terminal in the column it names", () => {
  //                    column 1 -----v         v- 2      v- 3
  const t = tree("[S [DP which book] [VP [V read] [DP t -> 1]]]");
  assert.deepEqual(arrows(t), [["t", "which book", "->"]]);
});

test("a shared subscript draws nothing", () => {
  // Co-indexation is now purely a label: binding indices (`John_1 … his_1`)
  // and hand-numbered nodes must not sprout arrows.
  assert.deepEqual(arrows(tree("[S [DP the cat_1] [VP [V left] [DP t_1]]]")), []);
  assert.deepEqual(arrows(tree("[S [DP John_1] [VP [V likes] [DP his_1 mother]]]")), []);
});

test("<- reverses the head and <> puts one on both ends", () => {
  assert.deepEqual(arrows(tree("[S [A a] [B b <- 1]]")), [["b", "a", "<-"]]);
  assert.deepEqual(arrows(tree("[S [A a] [B b <> 1]]")), [["b", "a", "<>"]]);
});

test("several arrows chain, each naming its own target", () => {
  // The reported bug: three positions of one movement. Every arrow is written,
  // so the chain is whatever the author says — no fan-out to guess about.
  const t = tree(
    "[TopP [DP 나는] [Top' [TP [DP t -> 1] [T' [VP [DP t -> 2] [V 갔다]]]]]]"
  );
  const pairs = collectArrows(t);
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].to, pairs[0].from.tree.root.children[0].children[0]);
  // Chained: the second arrow lands on the word the first one leaves from.
  assert.equal(pairs[1].to, pairs[0].from);
  assert.notEqual(pairs[1].to, pairs[0].to);
});

test("the column is re-derived on serialize, so edits renumber arrows", () => {
  const t = tree("[S [DP which book] [VP [V read] [DP t -> 1]]]");
  assert.equal(serialize(t), "[S [DP which book] [VP [V read] [DP t -> 1]]]");

  // Insert a terminal ahead of the target: every column after it shifts, and
  // the arrow follows the node it was pointed at rather than the old number.
  const extra = tree("[X hey]").root.children[0];
  t.root.insertChild(extra, 0);
  assert.equal(serialize(t), "[S hey [DP which book] [VP [V read] [DP t -> 2]]]");
  assert.deepEqual(arrows(t), [["t", "which book", "->"]]);
});

test("a deleted target drops the arrow; an unresolvable column is kept verbatim", () => {
  const t = tree("[S [A a] [B b -> 1]]");
  const a = t.root.children[0];
  a.parent.removeChild(a);
  assert.equal(serialize(t), "[S [B b]]", "nothing left to point at");

  // A number past the last column never resolved, so the text the user typed
  // survives instead of being silently deleted.
  const typo = tree("[S [A a] [B b -> 9]]");
  assert.deepEqual(arrows(typo), []);
  assert.equal(serialize(typo), "[S [A a] [B b -> 9]]");
});

test("columns span the document, but an arrow across trees isn't drawn", () => {
  const { trees, error } = parseAll("[A x -> 2]\n[B y]");
  assert.equal(error, null);
  assert.equal(wordColumns(trees).length, 2);
  assert.equal(trees[0].root.children[0].arrow.target, trees[1].root.children[0]);
  assert.deepEqual(collectArrows(trees[0]), [], "no shared coordinate space to draw in");
  assert.equal(serializeAll(trees), "[A x -> 2]\n[B y]", "the number is still kept");
});

test("pretty-printing a document keeps arrow columns document-wide", () => {
  // Columns count the document's terminals, so numbering each tree on its own
  // silently repoints every arrow from the second tree onwards: `-> 3` becomes
  // `-> 1`, which is a different word, not a different spelling of the same one.
  const { trees } = parseAll("[A [X a] [Y b]]\n[B [X c] [Y d -> 3]]");
  const pretty = serializePrettyAll(trees);
  assert.match(pretty, /-> 3/, "the column must survive reformatting");

  const back = parseAll(pretty);
  assert.equal(
    back.trees[1].root.children[1].children[0].arrow.target.label,
    "c",
    "still the same target after a pretty-print round trip"
  );
});

test("`->` is only an arrow at the start of a token", () => {
  // Hyphens and angle brackets are ordinary word characters, as in
  // jsSyntaxTree — its parseString swallows them mid-token too.
  assert.equal(serialize(tree("[N well-known]")), "[N well-known]");
  assert.equal(serialize(tree("[N a->b]")), "[N a->b]");
  assert.deepEqual(arrows(tree("[S [A a] [N b->1]]")), []);
});

test("a node label can't carry an arrow", () => {
  // jsSyntaxTree's parseNode has no arrow branch; the marker is consumed and
  // dropped rather than becoming terminal content.
  const t = tree("[NP -> 1 the cat]");
  assert.equal(serialize(t), "[NP the cat]");
  assert.deepEqual(arrows(t), []);
});

test("an arrow on a quoted terminal keeps its neighbours separate", () => {
  const t = tree('[NP "a" -> 2 "b"]');
  assert.equal(serialize(t), '[NP "a" -> 2 "b"]');
  assert.deepEqual(arrows(t), [["a", "b", "->"]]);
});

test("setArrow refuses anything but a word at both ends", () => {
  const t = tree("[S [DP the cat] [VP [V left] [DP t]]]");
  const [dp, vp] = t.root.children;
  const word = dp.children[0];
  const trace = vp.children[1].children[0];

  assert.equal(setArrow(trace, dp, { to: true, from: false }), false, "target is a node");
  assert.equal(setArrow(vp, word, { to: true, from: false }), false, "source is a node");
  assert.equal(setArrow(word, word, { to: true, from: false }), false, "self");
  assert.equal(setArrow(trace, word, { to: true, from: false }), true);
  assert.equal(serialize(t), "[S [DP the cat] [VP [V left] [DP t -> 1]]]");

  assert.equal(clearArrow(trace), true);
  assert.equal(clearArrow(trace), false);
  assert.equal(serialize(t), "[S [DP the cat] [VP [V left] [DP t]]]");
});

test("nextArrowEnds cycles -> then <- then <> then off", () => {
  const to = nextArrowEnds(null);
  assert.deepEqual(to, { to: true, from: false });
  const from = nextArrowEnds(to);
  assert.deepEqual(from, { to: false, from: true });
  const both = nextArrowEnds(from);
  assert.deepEqual(both, { to: true, from: true });
  assert.equal(nextArrowEnds(both), null, "fourth click removes the arrow");
});

test("a GUI-deleted target stops the arrow being drawn", () => {
  // `removeChild` leaves the detached node's `tree` pointing at the tree it was
  // in, so trusting `target.tree` drew a curve to a node with no layout —
  // stale coordinates, or NaN, which propagates into the box height and takes
  // the whole canvas with it. Serialization already dropped the arrow, so the
  // drawing has to agree.
  const t = tree("[S [DP which book] [VP [V read] [DP t -> 1]]]");
  assert.equal(collectArrows(t).length, 1);
  deleteNode(t, t.root.children[0].children[0]);
  assert.equal(serialize(t), "[S [DP] [VP [V read] [DP t]]]");
  assert.deepEqual(collectArrows(t), [], "nothing left to point at");
});

test("an end that stops being a word stops being drawn", () => {
  // Only words serialize an arrow and only words are columns, so a leaf flipped
  // to a node (or drag-reparented into a parent) must drop out of the drawing
  // too, or the canvas shows an arrow the text pane doesn't have.
  const t = tree("[S [A a] [B b -> 1]]");
  assert.equal(collectArrows(t).length, 1);
  toggleWordNode(t.root.children[1].children[0]);
  assert.equal(serialize(t), "[S [A a] [B [b]]]");
  assert.deepEqual(collectArrows(t), []);
});

test("a label that is itself an arrow marker round-trips", () => {
  // The marker is the one token that isn't a single delimiter character, so the
  // quoting rules had no idea about it: `[N "->"]` went out as `[N ->]` and came
  // back as an empty `[N]`.
  for (const src of [
    '[N "->"]',
    '[N "<-"]',
    '[N "<>"]',
    '[NP "the -> cat"]',
    '["->" x]',
    '[N x_"->"]',
  ]) {
    assert.equal(serialize(tree(src)), src, `${src} must survive as written`);
  }
});

test("ordinary hyphens and angle brackets stay unquoted", () => {
  // The flip side: the marker only counts at a token boundary, so affixes and
  // hyphenated words must not acquire quotes.
  for (const src of ["[T -ed]", "[N well-known]", "[N a->b]", "[N <p>]"]) {
    assert.equal(serialize(tree(src)), src);
  }
});

test("a cloned subtree keeps arrows it fully contains and drops the rest", () => {
  const t = tree("[S [VP [V read] [DP t -> 3]] [DP which book]]");
  const vp = t.root.children[0];
  const inner = vp.clone();
  assert.equal(inner.children[1].children[0].arrow, null, "target was outside the copy");

  const both = tree("[S [X a] [Y b -> 1]]").root.clone();
  assert.equal(both.children[1].children[0].arrow.target, both.children[0].children[0]);
});
