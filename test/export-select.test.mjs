/**
 * The two pure pieces of the export dialog: which tabs a range spec picks, and
 * what the resulting downloads are named.
 *
 * Both decide what leaves the app, and both have a failure mode that is silent
 * rather than loud — a range that quietly drops a tab, or two tabs whose
 * downloads overwrite each other — so they're worth pinning down without a
 * browser. `parseTabSelection` needs no DOM at all; `uniqueFilenames` comes
 * from `export.js`, which pulls in `tree.js`, hence the stub import first.
 */
import "./dom-stub.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTabSelection } from "../dist/scripts/tabs.js";
import { uniqueFilenames } from "../dist/scripts/export.js";

test("a single index picks one tab, zero-based", () => {
  assert.deepEqual(parseTabSelection("1", 3), [0]);
  assert.deepEqual(parseTabSelection("3", 3), [2]);
});

test("a range is inclusive at both ends", () => {
  assert.deepEqual(parseTabSelection("1-3", 5), [0, 1, 2]);
  assert.deepEqual(parseTabSelection("2-2", 5), [1]);
});

test("the documented example selects 1, 2, 3 and 5", () => {
  assert.deepEqual(parseTabSelection("1-3,5", 6), [0, 1, 2, 4]);
});

test("whitespace around parts and hyphens is tolerated", () => {
  assert.deepEqual(parseTabSelection(" 1 - 2 , 4 ", 5), [0, 1, 3]);
});

test("duplicates collapse and the spec's own order is kept", () => {
  assert.deepEqual(parseTabSelection("3,1,3", 3), [2, 0]);
  assert.deepEqual(parseTabSelection("1-3,2", 3), [0, 1, 2]);
});

test("out-of-range, reversed and malformed specs are refused outright", () => {
  // Refusing beats exporting a subset the user didn't ask for.
  assert.equal(parseTabSelection("4", 3), null);
  assert.equal(parseTabSelection("1-4", 3), null);
  assert.equal(parseTabSelection("0", 3), null);
  assert.equal(parseTabSelection("3-1", 3), null);
  assert.equal(parseTabSelection("1,,2", 3), null);
  assert.equal(parseTabSelection("1-", 3), null);
  assert.equal(parseTabSelection("a", 3), null);
  assert.equal(parseTabSelection("", 3), null);
  assert.equal(parseTabSelection("   ", 3), null);
});

test("distinct names pass through untouched", () => {
  assert.deepEqual(uniqueFilenames(["one", "two"], "png"), ["one.png", "two.png"]);
});

test("repeated names are numbered from the second occurrence", () => {
  assert.deepEqual(uniqueFilenames(["t", "t", "t"], "png"), [
    "t.png",
    "t(2).png",
    "t(3).png",
  ]);
});

test("numbering is per name, not global", () => {
  assert.deepEqual(uniqueFilenames(["a", "b", "a", "b", "c"], "svg"), [
    "a.svg",
    "b.svg",
    "a(2).svg",
    "b(2).svg",
    "c.svg",
  ]);
});

test("characters a filesystem won't take are stripped", () => {
  assert.deepEqual(uniqueFilenames(['a/b:c*d?e"f<g>h|i'], "tex"), ["abcdefghi.tex"]);
  // Spaces and hyphens are ordinary filename characters and must survive.
  assert.deepEqual(uniqueFilenames(["my tree-2"], "png"), ["my tree-2.png"]);
});

test("a name that sanitizes to nothing falls back rather than yielding '.png'", () => {
  assert.deepEqual(uniqueFilenames(["///", "..."], "png"), [
    "syntax-tree.png",
    "syntax-tree(2).png",
  ]);
});
