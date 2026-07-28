/**
 * Text-pane bracket helpers (`brackets.ts`): bracket matching, the
 * matched-pair-at-caret lookup, and the diff/index-mapping pair that keeps a
 * tracked position (an auto-inserted `]`, or a caret across undo/redo) valid
 * across an edit.
 *
 * Pure and DOM-free, so testable directly. Run with `make test` (builds
 * first) or `node --test test/`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  matchBrackets,
  bracketPairAtCaret,
  matchingOpen,
  diffRange,
  adjustIndex,
} from "../dist/scripts/brackets.js";

// ---- matchBrackets / matchingOpen -------------------------------------

test("matchBrackets pairs nested brackets both ways", () => {
  const text = "[NP [N cat]]";
  const m = matchBrackets(text);
  assert.equal(m.get(0), 11);
  assert.equal(m.get(11), 0);
  assert.equal(m.get(4), 10);
  assert.equal(m.get(10), 4);
});

test("matchBrackets skips brackets inside a quoted label", () => {
  const text = '[N "[x]"]';
  const m = matchBrackets(text);
  // Only the outer pair should match; the quoted `[`/`]` are label text.
  assert.equal(m.get(0), 8);
  assert.equal(m.size, 2);
});

test("matchBrackets leaves an unmatched bracket out of the map", () => {
  const text = "[NP [N cat]";
  const m = matchBrackets(text);
  assert.equal(m.has(0), false);
  assert.equal(m.get(4), 10);
});

test("matchingOpen only accepts a `]`'s partner, not the reverse", () => {
  const text = "[N cat]";
  const m = matchBrackets(text);
  assert.equal(matchingOpen(m, 6), 0);
  assert.equal(matchingOpen(m, 0), -1); // 0 is the `[`, not a `]`
});

// ---- bracketPairAtCaret -------------------------------------------------

test("bracketPairAtCaret prefers the bracket to the caret's left", () => {
  const text = "[N cat]";
  const m = matchBrackets(text);
  // Caret at 7 (end of string) sits right after the closing `]`.
  assert.deepEqual(bracketPairAtCaret(text, 7, m), { open: 0, close: 6 });
});

test("bracketPairAtCaret falls back to the bracket on the right", () => {
  const text = "[N cat]";
  const m = matchBrackets(text);
  // Caret at 0 has nothing to its left; the `[` is to its right.
  assert.deepEqual(bracketPairAtCaret(text, 0, m), { open: 0, close: 6 });
});

test("bracketPairAtCaret returns null away from any bracket", () => {
  const text = "[N cat]";
  const m = matchBrackets(text);
  assert.equal(bracketPairAtCaret(text, 3, m), null);
});

// ---- diffRange / adjustIndex --------------------------------------------

test("diffRange isolates a single inserted character", () => {
  const d = diffRange("[N cat]", "[N cats]");
  assert.deepEqual(d, { start: 6, oldEnd: 6, newEnd: 7 });
});

test("diffRange isolates a single deleted character", () => {
  const d = diffRange("[N cats]", "[N cat]");
  assert.deepEqual(d, { start: 6, oldEnd: 7, newEnd: 6 });
});

test("adjustIndex shifts a position after the edit by the length delta", () => {
  const d = diffRange("[N cat]", "[N cats]");
  assert.equal(adjustIndex(7, d), 8); // the trailing `]`
});

test("adjustIndex leaves a position before the edit untouched", () => {
  const d = diffRange("[N cat]", "[N cats]");
  assert.equal(adjustIndex(1, d), 1);
});

test("adjustIndex invalidates a position inside the replaced range", () => {
  const d = diffRange("[N cat]", "[N dog]");
  assert.equal(adjustIndex(4, d), -1); // inside "cat" -> "dog"
});

/**
 * This is the shape `restoreFromHistory` (app.ts) relies on to keep the
 * text-pane caret in place across undo/redo, instead of a raw `.value`
 * assignment dropping it to the end: map the caret across the diff between
 * the pre- and post-undo text, falling back to the start of the change when
 * the caret sat inside whatever got replaced.
 */
test("a caret after the undone edit stays pinned to the same text", () => {
  const before = "[NP the cat]";
  const after = "[NP the cats]"; // user typed "s" before the closing "]"
  const d = diffRange(after, before); // undo: redo-text -> undo-text
  const caret = 12; // right after the "s", i.e. still before the "]"
  const mapped = adjustIndex(caret, d);
  assert.equal(mapped, 11); // same spot in `before`: right after "cat"
});

test("a caret inside the undone edit falls back to the start of the change", () => {
  const before = "[NP the cat]";
  const after = "[NP the dog]";
  const d = diffRange(after, before);
  const caret = 10; // inside "dog"
  const mapped = adjustIndex(caret, d);
  assert.equal(mapped, -1);
  assert.equal(d.start, 8); // where the caller falls back to
});
