/**
 * Movement-arrow derivation (`collectMovement` in render.ts): nodes sharing a
 * subscript are linked into arrows, with an explicit trace (`t`, `t*`, `e`,
 * `*`) deciding direction.
 *
 * Pins the successive-cyclic chain fix: a co-indexed group with more than one
 * trace must be linked pairwise by depth — trace -> trace -> antecedent —
 * rather than every trace fanning out to the same target.
 *
 * Run with `make test` (builds first) or `node --test test/`.
 */
import "./dom-stub.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

import { parse } from "../dist/scripts/parser.js";
import { collectMovement } from "../dist/scripts/render.js";

const tree = (text) => {
  const { tree, error } = parse(text);
  assert.equal(error, null, `unexpected parse error for ${text}: ${error}`);
  return tree;
};

/** Movement pairs as [from label, to label], for easy comparison. */
const labels = (pairs) => pairs.map((p) => [p.from.label, p.to.label]);

test("a single trace points at its antecedent", () => {
  const t = tree("[S [DP the cat_1] [VP [V left] [DP t_1]]]");
  assert.deepEqual(labels(collectMovement(t)), [["t", "the cat"]]);
});

test("plain co-indexation with no trace links later occurrences to the first", () => {
  // Arrow mode (linkNodes): every later occurrence fans out to the first
  // rather than chaining — deliberately unchanged by the trace-chain fix.
  const t = tree("[S [X a_1] [Y [X b_1] [Z c_1]]]");
  assert.deepEqual(labels(collectMovement(t)), [
    ["b", "a"],
    ["c", "a"],
  ]);
});

test("a chain of two traces links pairwise, not fanned out", () => {
  // Successive-cyclic movement through two specifier positions: the deepest
  // trace should point at the intermediate trace, which points at the
  // antecedent — not both traces pointing at the antecedent directly.
  const t = tree(
    "[TopP [DP the cat_1] [Top' [TP [DP t_1] [T' [VP [DP t_1] [V left]]]]]]"
  );
  const pairs = collectMovement(t);
  assert.equal(
    pairs.length,
    2,
    "3 co-indexed nodes chain into 2 arrows, not 2 fanned to one target"
  );

  const [midToTop, deepToMid] = pairs;
  assert.deepEqual([midToTop.from.label, midToTop.to.label], ["t", "the cat"]);
  assert.deepEqual([deepToMid.from.label, deepToMid.to.label], ["t", "t"]);
  assert.equal(midToTop.from.depth, 4);
  assert.equal(deepToMid.from.depth, 6);

  // Chained: the deep trace's target is the SAME node the mid trace's arrow
  // leaves from — not both traces landing directly on the antecedent.
  assert.equal(deepToMid.to, midToTop.from);
  assert.notEqual(deepToMid.to, midToTop.to, "must not both land on the antecedent");
});

test("regression: a Korean successive-cyclic example chains instead of fanning out", () => {
  // From the bug report ("두 번 이동할 때 아래쪽부터 차례대로 이동해야 되는데
  // 화살표가 따로 노네" — arrows should chain from the bottom up, but were
  // drawn separately): three positions co-indexed by movement, each deeper
  // than the last.
  const t = tree(
    "[TopP [DP 나는_1] [Top' [TP [DP t_1] [T' [PredP [DP t_1] [Pred' left]]]]]]"
  );
  const pairs = collectMovement(t);
  assert.equal(pairs.length, 2);
  assert.notEqual(pairs[0].to, pairs[1].to, "the two traces must not share a target");
  assert.equal(pairs[1].to, pairs[0].from, "chained: the mid trace is both a target and a source");
});

test("two independent chains in one tree don't cross-contaminate", () => {
  const t = tree(
    "[S [DP the cat_1] [DP the dog_2] [X [DP t_1] [Y [DP t_2]]]]"
  );
  const pairs = collectMovement(t);
  assert.equal(pairs.length, 2);
  assert.deepEqual(labels(pairs).sort(), [
    ["t", "the cat"],
    ["t", "the dog"],
  ]);
});
