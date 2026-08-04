/**
 * Keymap tests.
 *
 * `keymap.ts` is pure (it imports nothing), so the rules that decide whether a
 * keypress can ever reach a command are testable without a browser: which keys
 * `rebind` refuses, and how a key event becomes — and renders as — a canonical
 * binding string. Both had gaps that made a binding silently dead: a command
 * could be bound to a structural key the controller answers first, and `+`
 * (the zoom-in key the UI advertises) had no spelling the lookup agreed on.
 *
 * Run with `make test` (builds first) or `node --test test/`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  COMMANDS,
  bindingFor,
  commandForKey,
  canonicalFromEvent,
  displayKey,
  rebind,
  reservedKey,
  resetBindings,
} from "../dist/scripts/keymap.js";

/** A KeyboardEvent stand-in: `canonicalFromEvent` only reads these five. */
const ev = (key, mods = {}) => ({
  key,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
});

// ---- reserved (structural) keys --------------------------------------

test("structural keys are reserved, ordinary ones aren't", () => {
  for (const k of ["ArrowUp", "Shift+ArrowLeft", "Escape", "Ctrl+z", "Meta+Shift+z", "Ctrl+y", "Ctrl+3", "Ctrl+Alt+ArrowRight", "Ctrl+Tab"]) {
    assert.ok(reservedKey(k), `${k} should be reserved`);
  }
  for (const k of ["q", "Shift+q", "Ctrl+Alt+n", "=", "+"]) {
    assert.equal(reservedKey(k), null, `${k} should be bindable`);
  }
});

test("rebind refuses a reserved key and leaves the binding alone", () => {
  resetBindings();
  const before = bindingFor("wrap");
  const conflict = rebind("wrap", "ArrowUp");
  assert.ok(conflict, "binding onto ArrowUp should be refused");
  assert.equal(conflict.id, "", "reserved keys report the empty-id sentinel");
  assert.ok(conflict.label.length > 0, "the sentinel names what the key does");
  assert.equal(bindingFor("wrap"), before);
});

test("rebind still refuses another command's key, and accepts a free one", () => {
  resetBindings();
  const taken = rebind("wrap", bindingFor("copy"));
  assert.equal(taken?.id, "copy");
  assert.equal(rebind("wrap", "q"), null);
  assert.equal(bindingFor("wrap"), "q");
  assert.equal(commandForKey("q")?.id, "wrap");
  resetBindings();
  assert.equal(commandForKey("q"), null);
});

test("rebind refuses a fixed alias of another command", () => {
  resetBindings();
  // `Enter` is an extraKey of rename, never a primary binding.
  assert.equal(rebind("wrap", "Enter")?.id, "rename");
  resetBindings();
});

// ---- canonical spelling ----------------------------------------------

test("shift carries a letter's case but not a punctuation glyph", () => {
  assert.equal(canonicalFromEvent(ev("N", { shift: true })), "Shift+n");
  assert.equal(canonicalFromEvent(ev("n")), "n");
  // Shift+= types "+": the glyph *is* the key, so "Shift++" would name nothing.
  assert.equal(canonicalFromEvent(ev("+", { shift: true })), "+");
  assert.equal(canonicalFromEvent(ev("?", { shift: true })), "?");
});

test("modifiers keep a fixed order", () => {
  assert.equal(
    canonicalFromEvent(ev("z", { ctrl: true, alt: true })),
    "Ctrl+Alt+z"
  );
  assert.equal(canonicalFromEvent(ev("Tab", { ctrl: true, shift: true })), "Ctrl+Shift+Tab");
});

test("`+` is a bindable key, not just the separator", () => {
  assert.equal(displayKey("+"), "+");
  assert.equal(displayKey("Ctrl++"), "Ctrl + +");
  assert.equal(displayKey("Shift+n"), "Shift + N");
  assert.equal(displayKey("Ctrl+Alt+z"), "Ctrl + Alt + Z");
});

test("zoom-in answers to the `+` the UI advertises", () => {
  resetBindings();
  assert.equal(commandForKey(canonicalFromEvent(ev("+", { shift: true })))?.id, "zoom-in");
  assert.equal(commandForKey(canonicalFromEvent(ev("=")))?.id, "zoom-in");
});

// ---- the list itself --------------------------------------------------

test("no command ships with a reserved or duplicated default key", () => {
  resetBindings();
  const seen = new Map();
  for (const c of COMMANDS) {
    for (const k of [c.defaultKey, ...(c.extraKeys ?? [])]) {
      assert.equal(reservedKey(k), null, `${c.id} defaults to reserved ${k}`);
      assert.equal(seen.get(k), undefined, `${k} is claimed by both ${seen.get(k)} and ${c.id}`);
      seen.set(k, c.id);
    }
  }
});
