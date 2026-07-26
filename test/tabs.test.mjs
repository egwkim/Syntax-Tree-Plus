/**
 * Workspace (tab) model tests.
 *
 * `tabs.ts` is pure — no DOM, no storage — so the rules that keep a document
 * from being lost are testable directly: a draft is held beside the last text
 * that parsed rather than replacing it, a removed tab reports where it sat so
 * it can be put back, and a duplicate is a genuinely separate document.
 *
 * Run with `make test` (builds first) or `node --test test/`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { Workspace } from "../dist/scripts/tabs.js";

const ws2 = () => {
  const ws = new Workspace();
  const a = ws.add("[A x]", "Alpha");
  const b = ws.add("[B y]", "Beta");
  return { ws, a, b };
};

// ---- naming & activation ---------------------------------------------

test("add appends, activates, and never reuses a name", () => {
  const ws = new Workspace();
  const first = ws.add("[A]");
  assert.equal(ws.activeId, first.id);
  assert.equal(first.name, "Tree 1");

  const named = ws.add("[B]", "Alpha");
  assert.equal(named.name, "Alpha");
  // A name already in use is numbered rather than duplicated — tabs are told
  // apart by name in the bar, so two "Alpha"s would be indistinguishable.
  assert.notEqual(ws.add("[C]", "Alpha").name, "Alpha");
  assert.equal(new Set(ws.tabs.map((t) => t.name)).size, ws.tabs.length);
});

test("indexOf and active track the ordered list", () => {
  const { ws, a, b } = ws2();
  assert.equal(ws.indexOf(a.id), 0);
  assert.equal(ws.active.id, b.id);
  assert.equal(ws.setActive(a.id), true);
  assert.equal(ws.active.id, a.id);
  assert.equal(ws.setActive("nope"), false, "unknown id changes nothing");
  assert.equal(ws.active.id, a.id);
});

// ---- drafts (unparseable text must survive a tab switch) --------------

test("a draft sits beside the document, not on top of it", () => {
  const { ws, b } = ws2();
  ws.setActiveDraft("[B y");
  assert.equal(b.draft, "[B y", "the half-typed text is kept");
  assert.equal(b.text, "[B y]", "the last text that parsed is untouched");
});

test("good text supersedes the draft", () => {
  const { ws, b } = ws2();
  ws.setActiveDraft("[B y");
  ws.setActiveText("[B y] [C z]");
  assert.equal(b.text, "[B y] [C z]");
  assert.equal(b.draft, undefined, "the draft is spent, not left behind");
});

test("a draft equal to the document is no draft at all", () => {
  const { ws, b } = ws2();
  ws.setActiveDraft("[B y]");
  assert.equal(b.draft, undefined);
  ws.setActiveDraft("[B y");
  ws.setActiveDraft(null);
  assert.equal(b.draft, undefined, "null clears it");
});

// ---- remove / insert (reopening a closed tab) ------------------------

test("remove reports what it took out and from where", () => {
  const { ws, a, b } = ws2();
  const c = ws.add("[C z]", "Gamma");
  const removed = ws.remove(b.id);
  assert.deepEqual(
    [removed.tab.id, removed.index],
    [b.id, 1],
    "enough to put it back exactly where it was"
  );
  assert.deepEqual(ws.tabs.map((t) => t.id), [a.id, c.id]);
});

test("removing the active tab moves focus to a neighbour", () => {
  const { ws, a, b } = ws2();
  assert.equal(ws.activeId, b.id);
  ws.remove(b.id);
  assert.equal(ws.activeId, a.id);
});

test("the last tab can't be closed, and an unknown id is a no-op", () => {
  const ws = new Workspace();
  ws.add("[A]");
  assert.equal(ws.remove(ws.activeId), null);
  assert.equal(ws.tabs.length, 1);
  const { ws: two, a } = ws2();
  assert.equal(two.remove("nope"), null);
  assert.equal(two.tabs.length, 2);
  assert.equal(two.indexOf(a.id), 0);
});

test("insert puts a closed tab back at its index, id intact", () => {
  // The id is what lets the controller hand the tab its old undo history back.
  const { ws, a, b } = ws2();
  const c = ws.add("[C z]", "Gamma");
  const removed = ws.remove(b.id);
  ws.insert(removed.tab, removed.index);
  assert.deepEqual(ws.tabs.map((t) => t.id), [a.id, b.id, c.id]);
  assert.equal(ws.activeId, b.id, "a reopened tab becomes active");
  assert.equal(ws.tabs[1].text, "[B y]");
});

test("insert clamps an index that no longer exists", () => {
  const { ws, a } = ws2();
  const removed = ws.remove(a.id);
  ws.remove(ws.activeId); // refused — one tab left
  ws.insert(removed.tab, 99);
  assert.equal(ws.indexOf(removed.tab.id), ws.tabs.length - 1);
});

// ---- duplicate --------------------------------------------------------

test("duplicate copies the document in beside the original", () => {
  const { ws, a, b } = ws2();
  ws.setActive(a.id);
  ws.setActiveDraft("[A x");
  const copy = ws.duplicate(a.id);
  assert.equal(ws.indexOf(copy.id), 1, "right after the original");
  assert.deepEqual(ws.tabs.map((t) => t.id), [a.id, copy.id, b.id]);
  assert.equal(copy.text, "[A x]");
  assert.equal(copy.draft, "[A x", "an in-progress edit comes along");
  assert.notEqual(copy.id, a.id, "a new document, not an alias");
  assert.notEqual(copy.name, a.name);
  assert.equal(ws.activeId, copy.id);
  assert.equal(ws.duplicate("nope"), null);
});

test("editing a duplicate leaves the original alone", () => {
  const { ws, a } = ws2();
  const copy = ws.duplicate(a.id);
  ws.setActiveText("[A x] [Z w]");
  assert.equal(copy.text, "[A x] [Z w]");
  assert.equal(a.text, "[A x]");
});

// ---- reorder ----------------------------------------------------------

test("move reorders and clamps", () => {
  const { ws, a, b } = ws2();
  const c = ws.add("[C z]", "Gamma");
  assert.equal(ws.move(c.id, 0), true);
  assert.deepEqual(ws.tabs.map((t) => t.id), [c.id, a.id, b.id]);
  assert.equal(ws.move(c.id, 99), true, "past the end lands at the end");
  assert.deepEqual(ws.tabs.map((t) => t.id), [a.id, b.id, c.id]);
  assert.equal(ws.move(c.id, 2), false, "already there");
  assert.equal(ws.move("nope", 0), false);
  assert.equal(ws.activeId, c.id, "reordering doesn't change which tab is live");
});

// ---- persistence ------------------------------------------------------

test("a workspace round-trips through its stored form", () => {
  const { ws, a, b } = ws2();
  ws.setActiveDraft("[B y");
  const back = Workspace.fromStored(JSON.parse(JSON.stringify(ws.toStored())));
  assert.deepEqual(back.tabs, ws.tabs);
  assert.equal(back.activeId, ws.activeId);
  assert.equal(back.tabs[1].draft, "[B y", "the draft outlives a reload");
  // toStored copies, so the stored blob can't be mutated through the model.
  ws.toStored().tabs[0].text = "mutated";
  assert.equal(a.text, "[A x]");
  assert.equal(b.name, "Beta");
});

test("fromStored is defensive about a corrupt blob", () => {
  assert.equal(Workspace.fromStored({ tabs: [], activeId: "x" }), null);
  assert.equal(Workspace.fromStored({ tabs: [{ id: "a" }], activeId: "a" }), null);

  const ws = Workspace.fromStored({
    tabs: [
      { id: "a", name: "A", text: "[A]", draft: 42 },
      { id: "b", name: "B", text: "[B]", draft: "[B]" },
      { text: "[C]" },
    ],
    activeId: "gone",
  });
  assert.equal(ws.tabs.length, 3);
  assert.equal(ws.tabs[0].draft, undefined, "a non-string draft is dropped");
  assert.equal(ws.tabs[1].draft, undefined, "a draft equal to the text is noise");
  assert.ok(ws.tabs[2].id && ws.tabs[2].name, "missing id/name are filled in");
  assert.equal(ws.activeId, "a", "an unknown active id falls back to the first");
});
