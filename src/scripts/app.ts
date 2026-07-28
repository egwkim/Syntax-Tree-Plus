import { Tree, Node, derivedTriangle } from "./tree.js";
import { render } from "./render.js";
import { settings, applyThemeColors, LeafAlignment } from "./settings.js";
import { parseAll, parseLabel } from "./parser.js";
import { serializeAll, serializePretty } from "./serialize.js";
import { History } from "./history.js";
import { Workspace, type TabData } from "./tabs.js";
import { setupCompactToolbar } from "./toolbar.js";
import {
  COMMANDS,
  FIXED_KEYS,
  bindingFor,
  commandForKey,
  commandDef,
  canonicalFromEvent,
  displayKey,
  applyOverrides,
  overrides as keymapOverrides,
  resetBindings,
  rebind,
} from "./keymap.js";
import {
  saveTheme,
  loadTheme,
  savePrefs,
  loadPrefs,
  saveWorkspace,
  loadWorkspace,
  loadDoc,
  fragmentDoc,
  saveKeymap,
  loadKeymap,
} from "./persist.js";
import {
  exportSVG,
  exportPNG,
  exportLaTeX,
  copyImagePNG,
  copySVGMarkup,
  copyLaTeX,
} from "./export.js";
import {
  matchBrackets,
  bracketPairAtCaret,
  matchingOpen,
  buildHighlightHTML,
  diffRange,
  adjustIndex,
} from "./brackets.js";
import {
  cloneNodeSubtree,
  addChildAt,
  addSiblingBefore,
  addSiblingAfter,
  deleteNode,
  wrapNode,
  moveSibling,
  xbarTemplate,
  cpTpTemplate,
  coordinationTemplate,
  toggleTriangle,
  toggleWordNode,
  isDescendant,
  reparent,
  linkNodes,
} from "./edit.js";

const DEFAULT_DOC =
  "[S [NP [D The][N cat]] [VP [V sat] [PP [P on] [NP [D the][N mat]]]]]";

export function startApp() {
  const container = document.getElementById("tree-container") as HTMLElement;
  const textInput = document.getElementById("text-input") as HTMLTextAreaElement;
  const textHighlights = document.getElementById("text-highlights") as HTMLElement;
  const parseError = document.getElementById("parse-error") as HTMLElement;
  const toolbar = document.getElementById("toolbar") as HTMLElement;
  const helpModal = document.getElementById("help-modal") as HTMLElement;
  const settingsModal = document.getElementById("settings-modal") as HTMLElement;
  const fontSizeInput = document.getElementById("setting-font-size") as HTMLInputElement;
  const hSpacingInput = document.getElementById("setting-h-spacing") as HTMLInputElement;
  const vSpacingInput = document.getElementById("setting-v-spacing") as HTMLInputElement;
  const edgeStyleSelect = document.getElementById("setting-edge-style") as HTMLSelectElement;
  const autoSubscriptInput = document.getElementById("setting-auto-subscript") as HTMLInputElement;
  const nodeColorInput = document.getElementById("setting-node-color") as HTMLInputElement;
  const forestLayoutSelect = document.getElementById("setting-forest-layout") as HTMLSelectElement;
  const colorHint = document.getElementById("settings-color-hint") as HTMLElement;
  const treePane = document.getElementById("tree-pane") as HTMLElement;
  const tabbar = document.getElementById("tabbar") as HTMLElement;
  const zoomLabel = document.getElementById("zoom-label") as HTMLElement;
  const helpKeys = document.getElementById("help-keys") as HTMLElement;
  const shortcutList = document.getElementById("shortcut-list") as HTMLElement;

  // A tab's document holds one *or more* trees (`[S …] [S …]`). They're all
  // drawn on the same canvas; `tree` is whichever one holds the selection —
  // every edit command still works on exactly one tree, so most of the
  // controller is unchanged by there being others beside it.
  let trees: Tree[] = [];
  let activeIndex = 0;
  let tree!: Tree;
  const workspace = new Workspace();
  // One undo/redo history per tab, so switching tabs keeps each doc's history.
  const histories = new Map<string, History>();
  let historyStack = new History();
  const navigationHistory: number[] = [];
  // Zoom: the built SVG carries the tree's natural pixel size in its width/
  // height attributes (viewBox stays fixed); we scale those to zoom, so the
  // pane's native scrollbars pan the enlarged content. 1 = 100%.
  let zoom = 1;
  const ZOOM_MIN = 0.2;
  const ZOOM_MAX = 4;
  let clipboard: Node | null = null;
  let inlineEditor: HTMLInputElement | null = null;
  // The active editor's own `finish`, so `cancelInlineEdit` can close it
  // through the same single-fire path as Enter/Escape/blur instead of
  // reaching in and removing the <input> directly (see cancelInlineEdit).
  let inlineEditFinish: ((commit: boolean) => void) | null = null;
  let dragMode = false;
  let linkMode = false;
  let linkSource: Node | null = null;

  // ---- helpers -------------------------------------------------------

  function getNodeById(id: number): Node | null {
    let found: Node | null = null;
    for (const t of trees) {
      t.root.walk((n) => {
        if (n.id === id) found = n;
      });
    }
    return found;
  }

  /** The tree a node belongs to (its own, falling back to the active one). */
  function treeOf(node: Node): Tree {
    return node.tree ?? tree;
  }

  /** Make the i-th tree of the document the active one (index clamped). */
  function setActiveIndex(i: number) {
    activeIndex = Math.max(0, Math.min(i, trees.length - 1));
    tree = trees[activeIndex];
  }

  /**
   * Move the selection to `node` (or clear it), making that node's tree active.
   * Exactly one tree ever carries a selection — the renderer draws whatever
   * each tree reports, so a stale `selectedNode` on another tree would show up
   * as a second highlighted node.
   */
  function selectNode(node: Node | null) {
    for (const t of trees) t.selectedNode = null;
    if (!node) return;
    const idx = trees.indexOf(treeOf(node));
    if (idx >= 0) setActiveIndex(idx);
    tree.selectedNode = node;
  }

  /**
   * Where a node sits in the document: which tree, then the child-index path
   * down to it. Used to restore the selection across a re-parse or an undo.
   */
  interface SelectionPath {
    tree: number;
    path: number[];
  }

  function pathOf(node: Node): SelectionPath {
    const path: number[] = [];
    let n: Node = node;
    while (n.parent) {
      path.unshift(n.parent.children.indexOf(n));
      n = n.parent;
    }
    const idx = trees.indexOf(treeOf(n));
    return { tree: idx >= 0 ? idx : activeIndex, path };
  }

  /**
   * Node at a selection path in `list` — or, if that branch no longer exists
   * (undo of an "add", a text edit that removed it), the deepest ancestor along
   * the path that does. Falling back to the nearest ancestor keeps the
   * selection where the user was working instead of throwing them back to the
   * root. A vanished *tree* falls back to the last one, for the same reason.
   */
  function nodeAtPath(list: Tree[], sel: SelectionPath): Node {
    const t = list[Math.max(0, Math.min(sel.tree, list.length - 1))];
    let n: Node = t.root;
    for (const idx of sel.path) {
      const child = n.children[idx];
      if (!child) break;
      n = child;
    }
    return n;
  }

  /**
   * Replace the document's trees. `keep` restores the selection by path;
   * without it the first tree's root is selected (callers that want no
   * selection at all clear it afterwards).
   */
  function setTrees(list: Tree[], keep?: SelectionPath) {
    trees = list.length > 0 ? list : [new Tree()];
    setActiveIndex(keep ? keep.tree : activeIndex);
    selectNode(keep ? nodeAtPath(trees, keep) : tree.root);
  }

  /** Is DOM focus currently on a node inside the tree SVG? */
  function treeHasFocus(): boolean {
    const active = document.activeElement;
    return (
      active instanceof Element &&
      container.contains(active) &&
      active.closest("[data-node-id]") !== null
    );
  }

  /** Move DOM focus to the selected node's group (roving-tabindex target). */
  function focusSelectedNode() {
    const target = tree.selectedNode ?? tree.root;
    container
      .querySelector<SVGGElement>(`[data-node-id="${target.id}"]`)
      ?.focus();
  }

  // Natural (unzoomed) pixel size of the current SVG, from its viewBox.
  let baseW = 0;
  let baseH = 0;
  let lastSvg: SVGSVGElement | null = null;

  function renderTree() {
    // The SVG is rebuilt from scratch: it would strand (and race, on a
    // trailing blur) an open inline editor, and it drops DOM focus — so close
    // the editor first, and if the user was navigating with the keyboard, put
    // focus back on the selected node afterwards.
    cancelInlineEdit();
    const refocus = treeHasFocus();
    const svg = render(trees, container, (node) => {
      if (linkMode) {
        handleLinkClick(node);
        return;
      }
      // Clicking into another tree of the document makes that tree active.
      selectNode(node);
      navigationHistory.length = 0;
      renderTree();
    });
    lastSvg = svg;
    baseW = Number(svg.getAttribute("width")) || svg.getBoundingClientRect().width;
    baseH = Number(svg.getAttribute("height")) || svg.getBoundingClientRect().height;
    applyZoom();
    updateHistoryButtons();
    updateRoundTripWarning();
    if (settingsModal.classList.contains("active")) syncSettingsInputs();
    if (refocus) focusSelectedNode();
  }

  // ---- zoom & pan ----------------------------------------------------

  function clampZoom(z: number): number {
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
  }

  /** Scale the rendered SVG to `zoom`; the pane's scrollbars then pan it. */
  function applyZoom() {
    if (!lastSvg || !baseW || !baseH) return;
    lastSvg.style.width = baseW * zoom + "px";
    lastSvg.style.height = baseH * zoom + "px";
    if (zoomLabel) zoomLabel.textContent = Math.round(zoom * 100) + "%";
  }

  /** Set zoom, keeping the given client point fixed in the viewport. */
  function setZoom(next: number, anchorX?: number, anchorY?: number) {
    const z = clampZoom(next);
    if (z === zoom) {
      applyZoom();
      return;
    }
    const rect = treePane.getBoundingClientRect();
    // Default anchor: centre of the visible pane.
    const ax = anchorX ?? rect.left + rect.width / 2;
    const ay = anchorY ?? rect.top + rect.height / 2;
    // Content coordinate under the anchor before the change.
    const cx = (treePane.scrollLeft + (ax - rect.left)) / zoom;
    const cy = (treePane.scrollTop + (ay - rect.top)) / zoom;
    zoom = z;
    applyZoom();
    // Restore the same content point under the anchor after scaling.
    treePane.scrollLeft = cx * zoom - (ax - rect.left);
    treePane.scrollTop = cy * zoom - (ay - rect.top);
  }

  function zoomBy(factor: number) {
    setZoom(zoom * factor);
  }

  /** Scale so the whole tree fits the pane, then centre it. Never enlarges. */
  function fitToView() {
    if (!baseW || !baseH) return;
    const rect = treePane.getBoundingClientRect();
    const pad = 16;
    const z = clampZoom(
      Math.min((rect.width - pad) / baseW, (rect.height - pad) / baseH, 1)
    );
    zoom = z;
    applyZoom();
    treePane.scrollLeft = (baseW * zoom - rect.width) / 2;
    treePane.scrollTop = (baseH * zoom - rect.height) / 2;
  }

  function resetZoom() {
    zoom = 1;
    applyZoom();
  }

  // Ctrl/Cmd + wheel zooms toward the cursor (native browser zoom is suppressed).
  treePane.addEventListener(
    "wheel",
    (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setZoom(zoom * factor, e.clientX, e.clientY);
    },
    { passive: false }
  );

  // Background drag-to-pan (only over empty canvas, and not in Move/Arrow mode
  // where a background drag has other meaning). A node press is left alone.
  let panning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panScrollLeft = 0;
  let panScrollTop = 0;
  let panMoved = false;
  treePane.addEventListener("pointerdown", (e) => {
    if (dragMode || linkMode) return;
    if (e.button !== 0 || !e.isPrimary) return;
    if ((e.target as Element).closest("[data-node-id]")) return;
    panning = true;
    panMoved = false;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panScrollLeft = treePane.scrollLeft;
    panScrollTop = treePane.scrollTop;
  });
  treePane.addEventListener("pointermove", (e) => {
    if (!panning) return;
    const dx = e.clientX - panStartX;
    const dy = e.clientY - panStartY;
    if (!panMoved && Math.hypot(dx, dy) < 4) return;
    panMoved = true;
    treePane.classList.add("panning");
    treePane.setPointerCapture(e.pointerId);
    treePane.scrollLeft = panScrollLeft - dx;
    treePane.scrollTop = panScrollTop - dy;
  });
  const endPan = () => {
    if (panMoved) suppressClick = true; // don't let the pan end as a deselect
    panning = false;
    treePane.classList.remove("panning");
  };
  treePane.addEventListener("pointerup", endPan);
  treePane.addEventListener("pointercancel", endPan);

  /**
   * Two-click picker for the explicit "Arrow" tool: the first click marks a
   * source node (shown via normal selection styling + a status hint); the
   * second click links it to the target with a shared subscript (`linkNodes`
   * in edit.ts) — the movement arrow itself is still derived from that
   * co-indexation, same as manually typing matching subscripts.
   */
  function handleLinkClick(node: Node) {
    if (!linkSource) {
      linkSource = node;
      selectNode(node);
      renderTree();
      flashStatus(`Arrow from "${node.label || "∅"}" — click the target node`);
      return;
    }
    if (node === linkSource) {
      linkSource = null;
      renderTree();
      flashStatus("Cancelled");
      return;
    }
    // Movement is derived from co-indexation *within* a tree (see render.ts),
    // so a shared subscript across two trees would draw nothing. Keep waiting
    // for a target in the source's own tree rather than silently doing nothing.
    if (treeOf(node) !== treeOf(linkSource)) {
      flashStatus("A movement arrow links two nodes of the same tree");
      return;
    }
    linkNodes(treeOf(linkSource), linkSource, node);
    selectNode(node);
    linkSource = null;
    mutated();
    flashStatus("Linked with a movement arrow");
  }

  /**
   * Every terminal arrangement is expressible now that adjacent terminals are
   * quoted (`[NP "the big" "old cat"]`), so there's nothing left to warn about.
   * The banner element is kept in the markup, permanently hidden, so the pane's
   * layout is unchanged; drop both if no other warning ever needs it.
   */
  function updateRoundTripWarning() {
    document.getElementById("round-trip-warning")?.classList.remove("visible");
  }

  /**
   * Store `text` as the active tab's document and persist the whole workspace.
   * Only text that parsed ever gets here, and it supersedes any pending draft.
   */
  function persistActive(text: string) {
    workspace.setActiveText(text);
    saveWorkspace(workspace.toStored());
    refreshTabMarkers();
  }

  /**
   * Park pane text that doesn't parse on the active tab, so switching away and
   * back (or reloading) doesn't throw away a half-typed tree. The tab's
   * document — the last text that *did* parse — is left alone, which is what
   * keeps the canvas, the undo history and share links on a valid document.
   */
  function persistDraft(text: string) {
    workspace.setActiveDraft(text);
    saveWorkspace(workspace.toStored());
    refreshTabMarkers();
  }

  /** Push current state to history + persist. Optionally refresh text pane. */
  function commit(updateText = true) {
    const text = serializeAll(trees);
    historyStack.push(text);
    persistActive(text);
    if (updateText) {
      textInput.value = text;
      afterProgrammaticValue();
    }
    renderTree();
  }

  /** A GUI mutation happened: re-render, sync text, persist, snapshot. */
  function mutated() {
    commit(true);
  }

  // ---- text pane (text -> tree) --------------------------------------

  let debounceTimer: number | undefined;
  function onTextChanged() {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      const raw = textInput.value;
      const { trees: parsed, error } = parseAll(raw);
      if (error || parsed.length === 0) {
        parseError.textContent = "⚠ " + (error ?? "Could not parse");
        parseError.classList.add("visible");
        // Unparseable text is never promoted to the tab's document (the canvas
        // and undo history would have nothing to show), but it is kept as a
        // draft so it survives a tab switch or a reload.
        persistDraft(raw);
        return;
      }
      parseError.classList.remove("visible");
      const path = trees.length > 0 ? pathOf(tree.selectedNode ?? tree.root) : undefined;
      setTrees(parsed, path);
      historyStack.push(raw.trim());
      persistActive(raw);
      renderTree();
    }, 250);
  }

  // ---- syntax-highlight overlay + bracket handling -------------------
  //
  // The textarea's glyphs are transparent (see CSS); `textHighlights` is a
  // mirror <div> layered exactly behind it that re-renders the same text with
  // the matching bracket pair at the caret highlighted (VS Code style).
  //
  // `autoCloses` holds the indices of `]` characters we auto-inserted. Only
  // those may be typed over — a `]` the user typed themselves is always
  // inserted literally. Positions are kept in sync with edits (`reconcile`)
  // and dropped once the caret leaves their pair (`pruneAutoCloses`).
  let autoCloses: number[] = [];
  let lastValue = "";

  function syncScroll() {
    textHighlights.scrollTop = textInput.scrollTop;
    textHighlights.scrollLeft = textInput.scrollLeft;
  }

  function refreshHighlight() {
    const val = textInput.value;
    // Only box a pair while the pane is focused with a collapsed caret — like an
    // editor, an unfocused pane shows plain text with no match highlight.
    const active =
      document.activeElement === textInput &&
      textInput.selectionStart === textInput.selectionEnd;
    const pair = active
      ? bracketPairAtCaret(val, textInput.selectionStart, matchBrackets(val))
      : null;
    textHighlights.innerHTML = buildHighlightHTML(val, pair);
    syncScroll();
  }

  /** Keep tracked `]` positions valid across a content change. */
  function reconcile() {
    const val = textInput.value;
    const d = diffRange(lastValue, val);
    autoCloses = autoCloses
      .map((p) => adjustIndex(p, d))
      .filter((p) => p >= 0 && val[p] === "]");
    lastValue = val;
  }

  /** Forget any tracked pair the caret is no longer inside. */
  function pruneAutoCloses() {
    if (autoCloses.length === 0) return;
    const val = textInput.value;
    const caret = textInput.selectionStart;
    const matchOf = matchBrackets(val);
    autoCloses = autoCloses.filter((c) => {
      if (val[c] !== "]") return false;
      const open = matchingOpen(matchOf, c);
      return open >= 0 && open < caret && caret <= c;
    });
  }

  /** Re-sync overlay state after code replaces the textarea value directly. */
  function afterProgrammaticValue() {
    lastValue = textInput.value;
    autoCloses = []; // a wholesale replacement — no pair is mid-edit
    refreshHighlight();
  }

  textInput.addEventListener("input", () => {
    reconcile();
    refreshHighlight();
  });
  textInput.addEventListener("input", onTextChanged);
  textInput.addEventListener("scroll", syncScroll);
  textInput.addEventListener("focus", refreshHighlight);
  textInput.addEventListener("blur", refreshHighlight);
  document.addEventListener("selectionchange", () => {
    if (document.activeElement !== textInput) return;
    pruneAutoCloses();
    refreshHighlight();
  });

  // ---- IDE-style bracket handling in the text pane -------------------
  textInput.addEventListener("keydown", (e) => {
    // Only bare `[` / `]` / Backspace trigger auto-pairing — a chord that
    // happens to end in one of those keys (an OS/browser shortcut) should
    // reach the browser unmodified, and an IME composition keystroke isn't a
    // literal character yet.
    if (e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return;
    const el = textInput;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const val = el.value;

    const applyEdit = (
      text: string,
      selStart: number,
      selEnd: number = selStart
    ) => {
      el.value = text;
      el.selectionStart = selStart;
      el.selectionEnd = selEnd;
      el.dispatchEvent(new Event("input")); // reconcile + re-highlight + re-parse
    };

    if (e.key === "[") {
      // Wrap the selection in [ … ] (keeping it selected), or insert an empty
      // pair with the caret between the brackets.
      e.preventDefault();
      const selected = val.slice(start, end);
      const text = val.slice(0, start) + "[" + selected + "]" + val.slice(end);
      // The auto-inserted `]` lands right after the (possibly empty) selection;
      // remember it so a following `]` types over it instead of duplicating.
      const closePos = start + 1 + selected.length;
      if (start === end) applyEdit(text, start + 1);
      else applyEdit(text, start + 1, end + 1);
      autoCloses.push(closePos);
    } else if (e.key === "]") {
      // Type over the closing bracket only when it's one we auto-inserted;
      // a `]` the user typed themselves is inserted literally by the browser.
      if (start === end && val[start] === "]" && autoCloses.includes(start)) {
        e.preventDefault();
        el.selectionStart = el.selectionEnd = start + 1;
        autoCloses = autoCloses.filter((p) => p !== start); // consumed
        refreshHighlight();
      }
    } else if (e.key === "Backspace" && start === end) {
      // Delete an empty [] pair in one keystroke.
      if (val[start - 1] === "[" && val[start] === "]") {
        e.preventDefault();
        applyEdit(val.slice(0, start - 1) + val.slice(start + 1), start - 1);
      }
    }
  });

  // ---- inline label editing (no prompt) ------------------------------

  /**
   * The node as a single editable token. A label holding a delimiter is quoted,
   * so what the editor shows is exactly what `parseLabel` reads back on commit
   * (`a_b` would otherwise return as base `a` + subscript `b`); a literal `"`
   * is doubled for the same reason (see serialize.ts's `quoted`). Spaces are
   * left bare — a multi-word terminal is the normal way to type a triangle.
   */
  function rawToken(node: Node): string {
    let s = /["[\]_^]/.test(node.label)
      ? `"${node.label.replace(/"/g, '""')}"`
      : node.label;
    if (node.superscript) s += "^" + node.superscript;
    if (node.subscript) s += "_" + node.subscript;
    return s;
  }

  function startInlineEdit(node: Node) {
    cancelInlineEdit();
    const group = container.querySelector<SVGGElement>(
      `[data-node-id="${node.id}"]`
    );
    if (!group) return;
    const textEl = group.querySelector("text");
    if (!textEl) return;

    const rect = textEl.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();

    const input = document.createElement("input");
    input.type = "text";
    input.className = "inline-editor";
    input.value = rawToken(node);
    input.style.left = `${rect.left - cRect.left + container.scrollLeft - 6}px`;
    input.style.top = `${rect.top - cRect.top + container.scrollTop - 4}px`;
    input.style.minWidth = `${Math.max(rect.width + 16, 48)}px`;

    // Guard against double-fire: committing removes the input, which triggers
    // the blur handler — we must run the mutation exactly once.
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      input.removeEventListener("blur", onBlur);
      const value = input.value.trim();
      input.remove();
      if (inlineEditor === input) inlineEditor = null;
      if (inlineEditFinish === finish) inlineEditFinish = null;

      let changed = false;
      if (commit) {
        const { base, sub, sup } = parseLabel(value);
        node.updateLabel(base);
        node.subscript = sub;
        node.superscript = sup;
        // A rename is a fresh value, so triangle-ness reverts to what the new
        // label implies (multi-word -> triangle) rather than keeping whatever
        // it was — otherwise shrinking "the big cat" to "cat" would leave a
        // stale triangle. A manual override (the `t` key) is a separate,
        // later action and isn't touched by editing text elsewhere.
        if (node.isWord) node.triangle = derivedTriangle(base);
        node.updateTextWidth();
        changed = true;
      }

      // Blank-node cleanup: a leaf left with no label (e.g. added then
      // cancelled, or cleared) is discarded rather than kept as an empty node
      // that would also vanish on a text round-trip.
      if (node.isLeaf && node.label.trim() === "" && node.parent) {
        const parent = node.parent;
        parent.removeChild(node);
        selectNode(parent);
        changed = true;
      }

      if (changed) mutated();
      else renderTree();
    };
    const onBlur = () => finish(true);

    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", onBlur);

    container.appendChild(input);
    inlineEditor = input;
    inlineEditFinish = finish;
    input.focus();
    input.select();
  }

  /**
   * Close the open inline editor, committing whatever it holds — the same
   * outcome as blurring it. Routed through the editor's own `finish` (not a
   * raw `.remove()`): removing a focused element fires `blur` synchronously,
   * and `finish`'s `done` guard is what keeps that from re-entering and
   * double-removing the <input>.
   */
  function cancelInlineEdit() {
    inlineEditFinish?.(true);
  }

  container.addEventListener("dblclick", (e) => {
    const target = e.target as Element;
    const group = target.closest("[data-node-id]");
    if (!group) return;
    const found = getNodeById(Number(group.getAttribute("data-node-id")));
    if (found) {
      selectNode(found);
      renderTree();
      startInlineEdit(found);
    }
  });

  // ---- deselect by clicking empty space ------------------------------
  // (Node clicks stopPropagation, so this only fires on the background.)
  container.addEventListener("click", (e) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const onNode = (e.target as Element).closest("[data-node-id]");
    if (onNode) return;
    let changed = false;
    if (linkSource) {
      linkSource = null;
      flashStatus("Cancelled");
      changed = true;
    }
    if (tree.selectedNode) {
      selectNode(null);
      navigationHistory.length = 0;
      changed = true;
    }
    if (changed) renderTree();
  });

  // ---- toolbar actions -----------------------------------------------

  function insertAndEdit(node: Node | null) {
    if (!node) return;
    selectNode(node);
    // Render (so the inline editor can be positioned) but don't commit to
    // history/text yet — the node is still blank. finish() commits, or the
    // blank-node cleanup discards it if left empty.
    renderTree();
    startInlineEdit(node);
  }

  const actions: Record<string, () => void> = {
    child() {
      const sel = tree.selectedNode;
      if (sel) insertAndEdit(addChildAt(sel, sel.children.length));
    },
    "child-start"() {
      const sel = tree.selectedNode;
      if (sel) insertAndEdit(addChildAt(sel, 0));
    },
    text() {
      const sel = tree.selectedNode;
      if (sel) insertAndEdit(addChildAt(sel, sel.children.length, "", true));
    },
    "sib-before"() {
      const sel = tree.selectedNode;
      if (sel) insertAndEdit(addSiblingBefore(sel));
    },
    "sib-after"() {
      const sel = tree.selectedNode;
      if (sel) insertAndEdit(addSiblingAfter(sel));
    },
    copy() {
      if (tree.selectedNode) {
        clipboard = cloneNodeSubtree(tree.selectedNode);
        flashStatus("Copied");
      }
    },
    cut() {
      const sel = tree.selectedNode;
      if (!sel || !sel.parent) return; // can't cut the root
      clipboard = cloneNodeSubtree(sel);
      const parent = sel.parent;
      parent.removeChild(sel);
      selectNode(parent);
      mutated();
    },
    paste() {
      const sel = tree.selectedNode;
      if (!clipboard || !sel) return;
      const pasted = cloneNodeSubtree(clipboard);
      sel.insertChild(pasted);
      selectNode(pasted);
      mutated();
    },
    "paste-before"() {
      const sel = tree.selectedNode;
      if (!clipboard || !sel || !sel.parent) return;
      const pasted = cloneNodeSubtree(clipboard);
      const idx = sel.parent.children.indexOf(sel);
      sel.parent.insertChild(pasted, idx);
      selectNode(pasted);
      mutated();
    },
    "paste-after"() {
      const sel = tree.selectedNode;
      if (!clipboard || !sel || !sel.parent) return;
      const pasted = cloneNodeSubtree(clipboard);
      const idx = sel.parent.children.indexOf(sel);
      sel.parent.insertChild(pasted, idx + 1);
      selectNode(pasted);
      mutated();
    },
    "toggle-drag"() {
      dragMode = !dragMode;
      document.body.classList.toggle("drag-mode", dragMode);
      toolbar
        .querySelector('[data-action="toggle-drag"]')
        ?.classList.toggle("active", dragMode);
      if (!dragMode) cleanupDrag(false);
      if (dragMode && linkMode) actions["toggle-link"]();
    },
    "toggle-link"() {
      linkMode = !linkMode;
      linkSource = null;
      document.body.classList.toggle("link-mode", linkMode);
      toolbar
        .querySelector('[data-action="toggle-link"]')
        ?.classList.toggle("active", linkMode);
      if (linkMode && dragMode) actions["toggle-drag"]();
    },
    wrap() {
      const sel = tree.selectedNode;
      if (!sel) return;
      const parent = wrapNode(treeOf(sel), sel, "X");
      selectNode(parent);
      mutated();
      startInlineEdit(parent);
    },
    rename() {
      if (tree.selectedNode) startInlineEdit(tree.selectedNode);
    },
    triangle() {
      const sel = tree.selectedNode;
      if (sel && sel.isWord) {
        toggleTriangle(sel);
        mutated();
      }
    },
    "toggle-word"() {
      const sel = tree.selectedNode;
      if (!sel) return;
      if (!toggleWordNode(sel)) {
        flashStatus("Only a leaf can be a word");
        return;
      }
      flashStatus(sel.isWord ? "Word" : "Node");
      mutated();
    },
    delete() {
      const sel = tree.selectedNode;
      if (!sel) return;
      const next = deleteNode(treeOf(sel), sel);
      selectNode(next);
      mutated();
    },
    xbar() {
      const sel = tree.selectedNode;
      if (!sel) return;
      const head = xbarTemplate(treeOf(sel), sel);
      selectNode(head);
      mutated();
    },
    cptp() {
      const sel = tree.selectedNode;
      if (!sel) return;
      const head = cpTpTemplate(treeOf(sel), sel);
      selectNode(head);
      mutated();
    },
    coordination() {
      const sel = tree.selectedNode;
      if (!sel) return;
      const target = coordinationTemplate(treeOf(sel), sel);
      selectNode(target);
      mutated();
    },
    undo() {
      const state = historyStack.undo();
      if (state !== null) restoreFromHistory(state);
    },
    redo() {
      const state = historyStack.redo();
      if (state !== null) restoreFromHistory(state);
    },
    // Exports cover the whole document — every tree in the tab, laid out the
    // way the canvas shows them.
    "export-svg": () => exportSVG(trees),
    "export-png": () => exportPNG(trees),
    "export-latex": () => exportLaTeX(trees),
    "copy-png-image": () => {
      copyImagePNG(trees)
        .then(() => flashStatus("Copied image"))
        .catch((err: Error) => alert(err.message || "Couldn't copy the image."));
    },
    "copy-svg-markup": () => {
      copySVGMarkup(trees)
        .then(() => flashStatus("Copied SVG"))
        .catch((err: Error) => alert(err.message || "Couldn't copy the SVG."));
    },
    "copy-latex": () => {
      copyLaTeX(trees)
        .then(() => flashStatus("Copied LaTeX"))
        .catch((err: Error) => alert(err.message || "Couldn't copy the LaTeX."));
    },
    "toggle-align"() {
      // Cycle the three jsSyntaxTree alignment modes.
      const order: LeafAlignment[] = ["top", "words", "bottom"];
      const names = { top: "Top aligned", words: "Words at bottom", bottom: "Bottom aligned" };
      const next = order[(order.indexOf(settings.leafAlignment) + 1) % order.length];
      settings.leafAlignment = next;
      flashStatus(names[next]);
      savePrefs();
      renderTree();
    },
    "toggle-boxes"() {
      settings.showNodeBoxes = !settings.showNodeBoxes;
      savePrefs();
      renderTree();
    },
    "toggle-triangles"() {
      settings.showTriangles = !settings.showTriangles;
      flashStatus(settings.showTriangles ? "Triangles on" : "Triangles off");
      savePrefs();
      renderTree();
    },
    "toggle-theme": () => toggleTheme(),
    help() {
      renderHelpKeys();
      helpModal.classList.add("active");
    },
    "close-help"() {
      helpModal.classList.remove("active");
    },
    settings() {
      syncSettingsInputs();
      renderShortcutSettings();
      settingsModal.classList.add("active");
    },
    "close-settings"() {
      capturingFor = null;
      renderShortcutSettings();
      settingsModal.classList.remove("active");
    },
    "reset-node-color"() {
      if (!tree.selectedNode) return;
      delete tree.selectedNode.color;
      renderTree();
    },
    reverse() {
      const sel = tree.selectedNode;
      if (sel && sel.parent) {
        sel.parent.children.reverse();
        mutated();
      }
    },
    /** Add another tree to this tab's document, right after the active one. */
    "add-tree"() {
      const added = new Tree(new Node("S"));
      trees.splice(activeIndex + 1, 0, added);
      setActiveIndex(activeIndex + 1);
      selectNode(added.root);
      mutated();
      startInlineEdit(added.root);
    },
    /**
     * Drop the selected tree from the document. Like closing a tab it refuses
     * to leave nothing behind, but unlike closing a tab it's just an edit — the
     * snapshot in history covers every tree, so Ctrl+Z brings it back.
     */
    "delete-tree"() {
      if (trees.length <= 1) {
        flashStatus("A tab keeps at least one tree");
        return;
      }
      const removed = activeIndex;
      trees.splice(removed, 1);
      setActiveIndex(Math.min(removed, trees.length - 1));
      selectNode(tree.root);
      mutated();
      flashStatus("Tree deleted — Ctrl+Z to undo");
    },
    "zoom-in": () => zoomBy(1.2),
    "zoom-out": () => zoomBy(1 / 1.2),
    "zoom-reset": () => resetZoom(),
    "zoom-fit": () => fitToView(),
    "pretty-print"() {
      // Reformats the pane from the live trees, not the current text — so it
      // also normalizes stray whitespace/quoting rather than just re-indenting
      // what's there. The trees themselves are unchanged (no re-render needed).
      const pretty = trees.map((t) => serializePretty(t)).join("\n\n");
      if (pretty === textInput.value) return;
      historyStack.push(pretty);
      persistActive(pretty);
      textInput.value = pretty;
      afterProgrammaticValue();
      updateHistoryButtons(); // no renderTree(), which normally does this
      flashStatus("Pretty-printed");
    },
    "new-tab": () => addTab(),
    "duplicate-tab": () => duplicateTab(),
    "reopen-tab": () => reopenTab(),
    "reset-shortcuts"() {
      resetBindings();
      saveKeymap(keymapOverrides());
      renderShortcutSettings();
      renderHelpKeys();
      flashStatus("Shortcuts reset to defaults");
    },
  };

  /** Reflect current settings + the selected node's color into the panel's inputs. */
  function syncSettingsInputs() {
    fontSizeInput.value = String(settings.label.fontSize);
    hSpacingInput.value = String(settings.node.horizontalSpacing);
    vSpacingInput.value = String(settings.node.verticalSpacing);
    edgeStyleSelect.value = settings.edge.style;
    autoSubscriptInput.checked = settings.autoSubscript;
    forestLayoutSelect.value = settings.forestLayout;

    const sel = tree?.selectedNode;
    nodeColorInput.disabled = !sel;
    if (sel) {
      nodeColorInput.value = sel.color || settings.label.color;
      colorHint.textContent = `Color for "${sel.label || "∅"}". Cleared by Reset or a text-pane edit.`;
    } else {
      nodeColorInput.value = "#000000";
      colorHint.textContent = "Select a node in the tree to give it a custom color.";
    }
  }

  fontSizeInput.addEventListener("input", () => {
    const v = parseInt(fontSizeInput.value, 10);
    if (Number.isFinite(v) && v > 0) {
      settings.label.fontSize = v;
      savePrefs();
      renderTree();
    }
  });
  hSpacingInput.addEventListener("input", () => {
    const v = parseInt(hSpacingInput.value, 10);
    if (Number.isFinite(v) && v >= 0) {
      settings.node.horizontalSpacing = v;
      savePrefs();
      renderTree();
    }
  });
  vSpacingInput.addEventListener("input", () => {
    const v = parseInt(vSpacingInput.value, 10);
    if (Number.isFinite(v) && v >= 0) {
      settings.node.verticalSpacing = v;
      savePrefs();
      renderTree();
    }
  });
  edgeStyleSelect.addEventListener("change", () => {
    settings.edge.style = edgeStyleSelect.value as "straight" | "curved";
    savePrefs();
    renderTree();
  });
  autoSubscriptInput.addEventListener("change", () => {
    settings.autoSubscript = autoSubscriptInput.checked;
    savePrefs();
    renderTree();
  });
  forestLayoutSelect.addEventListener("change", () => {
    settings.forestLayout = forestLayoutSelect.value === "column" ? "column" : "row";
    savePrefs();
    renderTree();
  });
  nodeColorInput.addEventListener("input", () => {
    if (tree.selectedNode) {
      tree.selectedNode.color = nodeColorInput.value;
      renderTree();
    }
  });

  function restoreFromHistory(state: string) {
    const { trees: parsed } = parseAll(state);
    if (parsed.length === 0) return;
    // Keep the selection across undo/redo by child-index path, the same way a
    // text re-parse does — otherwise every undo throws the user back to the root.
    const path = tree?.selectedNode ? pathOf(tree.selectedNode) : null;
    setTrees(parsed, path ?? undefined);
    if (!path) selectNode(null); // nothing was selected — keep it that way
    persistActive(state);

    // A plain `.value` assignment resets the caret to the end, which is
    // jarring when Ctrl+Z fires while the text pane has focus (it's a fixed
    // key, so it works mid-typing). Map the pre-undo caret across the diff
    // between the old and new text — the same technique `reconcile` uses to
    // keep `autoCloses` valid — instead of just dropping it.
    const d = diffRange(lastValue, state);
    const mapCaret = (idx: number) => {
      const mapped = adjustIndex(idx, d);
      return mapped >= 0 ? mapped : d.start;
    };
    const caretStart = mapCaret(textInput.selectionStart);
    const caretEnd = mapCaret(textInput.selectionEnd);
    textInput.value = state;
    textInput.selectionStart = caretStart;
    textInput.selectionEnd = caretEnd;
    afterProgrammaticValue();
    parseError.classList.remove("visible");
    renderTree();
  }

  toolbar.addEventListener("click", (e) => {
    const btn = (e.target as Element).closest("button");
    if (!btn) return;
    const action = btn.getAttribute("data-action");
    if (action && actions[action]) actions[action]();
  });
  helpModal.addEventListener("click", (e) => {
    if (e.target === helpModal) helpModal.classList.remove("active");
    const btn = (e.target as Element).closest("button");
    if (btn?.getAttribute("data-action") === "close-help")
      helpModal.classList.remove("active");
  });
  settingsModal.addEventListener("click", (e) => {
    if (e.target === settingsModal) {
      settingsModal.classList.remove("active");
      return;
    }
    const btn = (e.target as Element).closest("button");
    const action = btn?.getAttribute("data-action");
    if (action && actions[action]) actions[action]();
  });

  function updateHistoryButtons() {
    const undoBtn = toolbar.querySelector('[data-action="undo"]');
    const redoBtn = toolbar.querySelector('[data-action="redo"]');
    undoBtn?.toggleAttribute("disabled", !historyStack.canUndo());
    redoBtn?.toggleAttribute("disabled", !historyStack.canRedo());
  }

  // ---- theme ---------------------------------------------------------

  function applyTheme(theme: string) {
    document.documentElement.setAttribute("data-theme", theme);
    applyThemeColors(theme === "dark" ? "dark" : "light");
    saveTheme(theme);
    if (tree) renderTree();
  }
  function toggleTheme() {
    const current =
      document.documentElement.getAttribute("data-theme") === "dark"
        ? "light"
        : "dark";
    applyTheme(current);
  }

  // ---- transient status toast ----------------------------------------

  let statusTimer: number | undefined;

  /**
   * Transient message. With an `action` the toast grows a button and stays up
   * long enough to click — that's the undo affordance for destructive-ish
   * commands (closing a tab), in place of a confirm dialog the environment
   * can't show.
   */
  function flashStatus(msg: string, action?: { label: string; run: () => void }) {
    let el = document.getElementById("status-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "status-toast";
      document.body.appendChild(el);
    }
    const toast = el;
    const hide = () => toast.classList.remove("visible", "with-action");
    toast.textContent = "";
    const text = document.createElement("span");
    text.textContent = msg;
    toast.appendChild(text);
    if (action) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toast-action";
      btn.textContent = action.label;
      btn.addEventListener("click", () => {
        hide();
        action.run();
      });
      toast.appendChild(btn);
    }
    // `pointer-events` is off by default so a toast never eats a click on the
    // canvas; only one carrying a button turns them back on.
    toast.classList.toggle("with-action", !!action);
    toast.classList.add("visible");
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(hide, action ? 7000 : 900);
  }

  // ---- drag to move nodes (drag mode) --------------------------------

  let dragSource: Node | null = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragging = false;
  let suppressClick = false;
  let dropTarget: Node | null = null;
  let dropIndex = 0;
  let ghostEl: HTMLElement | null = null;
  let dropBox: HTMLElement | null = null;
  let dropCaret: HTMLElement | null = null;

  function nodeTextRect(node: Node): DOMRect | null {
    const t = container.querySelector(`[data-node-id="${node.id}"] text`);
    return t ? t.getBoundingClientRect() : null;
  }

  // Pointer events (not mouse) so drag-to-move works with touch and pen too.
  container.addEventListener("pointerdown", (e) => {
    if (!dragMode || !e.isPrimary || e.button !== 0) return;
    const group = (e.target as Element).closest("[data-node-id]");
    if (!group) return;
    e.preventDefault();
    dragSource = getNodeById(Number(group.getAttribute("data-node-id")));
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragging = false;
  });

  window.addEventListener("pointermove", (e) => {
    if (!dragSource) return;
    if (!dragging) {
      if (Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY) < 5) return;
      dragging = true;
      document.body.classList.add("is-dragging");
      ghostEl = document.createElement("div");
      ghostEl.className = "drag-ghost";
      ghostEl.textContent = dragSource.label || "∅";
      document.body.appendChild(ghostEl);
    }
    e.preventDefault(); // stop touch-scroll while dragging a node
    if (ghostEl) {
      ghostEl.style.left = e.clientX + 12 + "px";
      ghostEl.style.top = e.clientY + 12 + "px";
    }
    updateDropTarget(e.clientX, e.clientY);
  });

  window.addEventListener("pointerup", () => {
    if (!dragSource) return;
    // A node interaction happened in drag mode; swallow the trailing click so
    // the empty-space handler doesn't deselect after a re-render.
    suppressClick = true;
    if (dragging && dropTarget) {
      const moved = reparent(dragSource, dropTarget, dropIndex);
      if (moved) {
        // A drop into another tree of the document moves the subtree there;
        // `selectNode` follows it, so the active tree tracks the node.
        selectNode(dragSource);
        cleanupDrag(false);
        mutated();
        return;
      }
    }
    // Plain tap in drag mode (no movement) still selects the node.
    if (!dragging && dragSource) selectNode(dragSource);
    cleanupDrag(true);
  });

  function updateDropTarget(cx: number, cy: number) {
    const el = document.elementFromPoint(cx, cy);
    const group = el?.closest("[data-node-id]");
    const target = group
      ? getNodeById(Number(group.getAttribute("data-node-id")))
      : null;

    // A tree's root has no parent to detach from — dropping it into another
    // tree would leave its own tree rootless, so roots aren't draggable. (With
    // one tree this was already impossible: every target was its descendant.)
    if (
      !target ||
      !dragSource ||
      !dragSource.parent ||
      isDescendant(dragSource, target)
    ) {
      dropTarget = null;
      hideDropIndicators();
      return;
    }
    dropTarget = target;

    // Insertion index = children whose center is left of the cursor.
    const kids = target.children;
    let index = kids.length;
    for (let i = 0; i < kids.length; i++) {
      const r = nodeTextRect(kids[i]);
      if (r && cx < r.left + r.width / 2) {
        index = i;
        break;
      }
    }
    dropIndex = index;

    ensureDropIndicators();
    // Outline the prospective parent.
    const tr = nodeTextRect(target);
    if (tr && dropBox) {
      dropBox.style.left = tr.left - 4 + "px";
      dropBox.style.top = tr.top - 2 + "px";
      dropBox.style.width = tr.width + 8 + "px";
      dropBox.style.height = tr.height + 4 + "px";
      dropBox.style.display = "block";
    }
    // Caret at the insertion slot.
    if (dropCaret) {
      let caretX: number;
      let top: number;
      let height: number;
      if (kids.length === 0) {
        const r = tr!;
        caretX = r.left + r.width / 2;
        top = r.bottom + 6;
        height = 22;
      } else {
        const first = nodeTextRect(kids[0])!;
        top = first.top - 6;
        height = first.height + 12;
        if (index <= 0) caretX = first.left - 8;
        else if (index >= kids.length)
          caretX = nodeTextRect(kids[kids.length - 1])!.right + 8;
        else {
          const prev = nodeTextRect(kids[index - 1])!;
          const next = nodeTextRect(kids[index])!;
          caretX = (prev.right + next.left) / 2;
        }
      }
      dropCaret.style.left = caretX - 1 + "px";
      dropCaret.style.top = top + "px";
      dropCaret.style.height = height + "px";
      dropCaret.style.display = "block";
    }
  }

  function ensureDropIndicators() {
    if (!dropBox) {
      dropBox = document.createElement("div");
      dropBox.className = "drop-box";
      document.body.appendChild(dropBox);
    }
    if (!dropCaret) {
      dropCaret = document.createElement("div");
      dropCaret.className = "drop-caret";
      document.body.appendChild(dropCaret);
    }
  }
  function hideDropIndicators() {
    if (dropBox) dropBox.style.display = "none";
    if (dropCaret) dropCaret.style.display = "none";
  }

  function cleanupDrag(rerender: boolean) {
    dragSource = null;
    dragging = false;
    dropTarget = null;
    document.body.classList.remove("is-dragging");
    ghostEl?.remove();
    ghostEl = null;
    hideDropIndicators();
    if (rerender && tree) renderTree();
  }

  // ---- keyboard ------------------------------------------------------

  window.addEventListener("keydown", (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const typing =
      target.tagName === "INPUT" || target.tagName === "TEXTAREA";

    // Global shortcuts that work even while typing.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) actions.redo();
      else actions.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      actions.redo();
      return;
    }
    // Tab switching also works while typing — you shouldn't have to leave the
    // text pane to reach another document. Fixed keys rather than `COMMANDS`
    // entries for that reason (remappable commands are resolved after the
    // typing guard below).
    if ((e.ctrlKey || e.metaKey) && !e.altKey && /^[1-9]$/.test(e.key)) {
      e.preventDefault();
      // 9 is "last tab", the convention every browser and editor uses.
      const n = Number(e.key);
      switchToIndex(n === 9 ? workspace.tabs.length - 1 : n - 1);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Tab") {
      // Chrome and Firefox keep Ctrl+Tab for their own tab strip and won't let
      // a page have it; where it does arrive, it should do the obvious thing.
      // Ctrl+Alt+arrow below is the binding that always works.
      e.preventDefault();
      cycleTab(e.shiftKey ? -1 : 1);
      return;
    }
    if (
      (e.ctrlKey || e.metaKey) &&
      e.altKey &&
      (e.key === "ArrowLeft" || e.key === "ArrowRight")
    ) {
      e.preventDefault();
      cycleTab(e.key === "ArrowLeft" ? -1 : 1);
      return;
    }
    // Escape cancels an in-progress drag (before other Escape handling).
    if (e.key === "Escape" && dragSource) {
      e.preventDefault();
      cleanupDrag(true);
      return;
    }
    // Escape cancels a pending arrow-link source.
    if (e.key === "Escape" && linkSource) {
      e.preventDefault();
      linkSource = null;
      renderTree();
      flashStatus("Cancelled");
      return;
    }
    // Escape closes any open modal, regardless of selection state.
    if (
      e.key === "Escape" &&
      (helpModal.classList.contains("active") ||
        settingsModal.classList.contains("active"))
    ) {
      e.preventDefault();
      helpModal.classList.remove("active");
      settingsModal.classList.remove("active");
      return;
    }
    if (typing) return; // don't hijack while editing text

    // Global commands (zoom) act regardless of what's selected.
    const canonical = canonicalFromEvent(e);
    const globalCmd = commandForKey(canonical);
    if (globalCmd && globalCmd.global && actions[globalCmd.id]) {
      e.preventDefault();
      actions[globalCmd.id]();
      return;
    }

    if (!tree.selectedNode) {
      // Nothing selected but the user has Tabbed onto a node: adopt it as the
      // selection so the next keystroke navigates from there.
      const active = document.activeElement;
      const g =
        active instanceof Element && container.contains(active)
          ? active.closest("[data-node-id]")
          : null;
      const adopted = g
        ? getNodeById(Number(g.getAttribute("data-node-id")))
        : null;
      if (adopted) {
        e.preventDefault();
        selectNode(adopted);
        renderTree();
      }
      return;
    }

    const node = tree.selectedNode;
    // Structural navigation keys stay fixed (not remappable) — they carry core
    // tree semantics. Focus sits on the node group; keep arrows from scrolling.
    if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      switch (e.key) {
        case "ArrowUp":
          if (node.parent) {
            navigationHistory.push(node.parent.children.indexOf(node));
            selectNode(node.parent);
            renderTree();
          }
          break;
        case "ArrowDown":
          if (node.children.length > 0) {
            let idx = 0;
            if (navigationHistory.length > 0) {
              idx = navigationHistory.pop()!;
              if (idx >= node.children.length) idx = 0;
            }
            selectNode(node.children[idx]);
            renderTree();
          }
          break;
        case "ArrowLeft":
        case "ArrowRight": {
          const dir = e.key === "ArrowLeft" ? -1 : 1;
          if (node.parent) {
            const sibs = node.parent.children;
            const idx = sibs.indexOf(node);
            if (e.shiftKey) {
              // Shift+arrow reorders siblings.
              if (moveSibling(node, dir)) mutated();
            } else {
              const t = idx + dir;
              if (t >= 0 && t < sibs.length) {
                selectNode(sibs[t]);
                navigationHistory.length = 0;
                renderTree();
              }
            }
          } else {
            // A root has no siblings; its neighbours are the document's other
            // trees, so the same keys step between them — and Shift reorders
            // them, exactly as it reorders siblings one level down.
            const to = activeIndex + dir;
            if (to < 0 || to >= trees.length) break;
            if (e.shiftKey) {
              const [moved] = trees.splice(activeIndex, 1);
              trees.splice(to, 0, moved);
              setActiveIndex(to);
              mutated();
            } else {
              selectNode(trees[to].root);
              navigationHistory.length = 0;
              renderTree();
            }
          }
          break;
        }
      }
      return;
    }
    if (e.key === "Escape") {
      if (tree.selectedNode) {
        selectNode(null);
        navigationHistory.length = 0;
        renderTree();
      }
      return;
    }

    // Everything else is a remappable command, resolved through the keymap.
    const cmd = commandForKey(canonical);
    if (cmd && actions[cmd.id]) {
      e.preventDefault();
      actions[cmd.id]();
    }
  });

  // Reposition / dismiss inline editor on scroll & resize.
  container.addEventListener("scroll", cancelInlineEdit);
  window.addEventListener("resize", () => {
    syncScroll();
    if (tree) renderTree();
  });

  // ---- tabs (multiple named trees) -----------------------------------

  /** The undo history for a tab, created (with a baseline snapshot) on demand. */
  function ensureHistory(id: string, baseline: string): History {
    let h = histories.get(id);
    if (!h) {
      h = new History();
      h.push(baseline);
      histories.set(id, h);
    }
    return h;
  }

  /**
   * Load the active tab into the live trees + text pane + its own history.
   *
   * The pane shows the draft when there is one (that's the point of drafts),
   * but the *trees* always come from the tab's own document — never from
   * whatever the previously active tab left in `trees`, which would hand two
   * tabs the same `Tree` objects and serialize the old document into the new
   * tab on its first edit.
   */
  function loadActiveTab() {
    const tab = workspace.active;
    historyStack = ensureHistory(tab.id, tab.text);
    const shown = tab.draft ?? tab.text;
    const { trees: parsed, error } = parseAll(shown);
    const loaded =
      parsed.length > 0 && !error ? parsed : parseAll(tab.text).trees;
    // A freshly opened tab starts on its first tree, root selected.
    setTrees(loaded.length > 0 ? loaded : [new Tree()], { tree: 0, path: [] });
    textInput.value = shown;
    afterProgrammaticValue();
    if (error) {
      parseError.textContent = "⚠ " + error;
      parseError.classList.add("visible");
    } else {
      parseError.classList.remove("visible");
    }
    renderTabs();
    renderTree();
  }

  /**
   * Persist the text pane's current content into the active tab before leaving
   * it: as the document if it parses, as a draft if it doesn't. Either way
   * nothing the user typed is dropped on the way out.
   */
  function flushActiveText() {
    const { trees: parsed, error } = parseAll(textInput.value);
    if (parsed.length > 0 && !error) persistActive(textInput.value);
    else persistDraft(textInput.value);
  }

  function switchTab(id: string) {
    if (id === workspace.activeId) return;
    flushActiveText();
    cancelInlineEdit();
    workspace.setActive(id);
    loadActiveTab();
    saveWorkspace(workspace.toStored());
  }

  function addTab() {
    flushActiveText();
    const tab = workspace.add(DEFAULT_DOC);
    ensureHistory(tab.id, tab.text);
    loadActiveTab();
    saveWorkspace(workspace.toStored());
    flashStatus(`New tab: ${tab.name}`);
  }

  /**
   * Closing a tab used to be the one unrecoverable action in the app — it
   * dropped the document *and* deleted its undo history. The closed tab is now
   * held aside, history and all, so "Reopen" puts it back where it was with
   * its undo stack intact. Only the last few are kept; older ones are really
   * gone (that's what bounds the memory a session can hold on to).
   */
  const CLOSED_LIMIT = 10;
  const closedTabs: { tab: TabData; index: number; history?: History }[] = [];

  function closeTab(id: string) {
    const wasActive = id === workspace.activeId;
    // Leaving a tab is a flush point like switching away from it, or the draft
    // the user was mid-way through typing would be lost with the close.
    if (wasActive) flushActiveText();
    const removed = workspace.remove(id);
    if (!removed) {
      flashStatus("Can't close the last tab");
      return;
    }
    const history = histories.get(id);
    histories.delete(id);
    closedTabs.push({ ...removed, history });
    if (closedTabs.length > CLOSED_LIMIT) closedTabs.shift();
    if (wasActive) loadActiveTab();
    else renderTabs();
    saveWorkspace(workspace.toStored());
    flashStatus(`Closed "${removed.tab.name}"`, {
      label: "Reopen",
      run: reopenTab,
    });
  }

  /** Put the most recently closed tab back, at its old position. */
  function reopenTab() {
    const entry = closedTabs.pop();
    if (!entry) {
      flashStatus("No recently closed tab");
      return;
    }
    flushActiveText();
    cancelInlineEdit();
    workspace.insert(entry.tab, entry.index);
    // Restoring the tab's id restores its undo history with it: `ensureHistory`
    // finds this entry instead of starting a fresh stack.
    if (entry.history) histories.set(entry.tab.id, entry.history);
    loadActiveTab();
    saveWorkspace(workspace.toStored());
    flashStatus(`Reopened "${entry.tab.name}"`);
  }

  /** Copy the active tab (document, draft and all) in right after it. */
  function duplicateTab() {
    flushActiveText();
    cancelInlineEdit();
    const copy = workspace.duplicate(workspace.activeId);
    if (!copy) return;
    ensureHistory(copy.id, copy.text);
    loadActiveTab();
    saveWorkspace(workspace.toStored());
    flashStatus(`Duplicated as "${copy.name}"`);
  }

  /** Switch by position — `Ctrl+1…9`, and the wrap-around cycle keys. */
  function switchToIndex(i: number) {
    const tab = workspace.tabs[i];
    if (tab) switchTab(tab.id);
  }

  function cycleTab(dir: -1 | 1) {
    const n = workspace.tabs.length;
    if (n < 2) return;
    const from = workspace.indexOf(workspace.activeId);
    switchToIndex((from + dir + n) % n);
  }

  /** Inline-edit a tab's name (no prompt(), matching the node-rename pattern). */
  function startTabRename(id: string) {
    const tab = workspace.tabs.find((t) => t.id === id);
    const tabEl = tabbar.querySelector<HTMLElement>(`[data-tab-id="${id}"]`);
    const nameEl = tabEl?.querySelector<HTMLElement>(".tab-name");
    if (!tab || !nameEl) return;
    const input = document.createElement("input");
    input.className = "tab-rename";
    input.value = tab.name;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      if (commit) {
        const v = input.value.trim();
        if (v) workspace.rename(id, v);
      }
      saveWorkspace(workspace.toStored());
      renderTabs();
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
  }

  function renderTabs() {
    if (!tabbar) return;
    tabbar.innerHTML = "";
    const closable = workspace.tabs.length > 1;
    for (const tab of workspace.tabs) {
      const active = tab.id === workspace.activeId;
      const el = document.createElement("div");
      el.className = "tab" + (active ? " active" : "");
      // A tab holding text that doesn't parse gets a marker, so the draft
      // isn't invisible state — you can see which tab you left mid-edit.
      if (tab.draft !== undefined) el.classList.add("has-draft");
      el.setAttribute("data-tab-id", tab.id);
      el.setAttribute("role", "tab");
      el.setAttribute("aria-selected", String(active));
      el.tabIndex = 0;

      const name = document.createElement("span");
      name.className = "tab-name";
      name.textContent = tab.name;
      if (tab.draft !== undefined) name.title = "Unparsed text waiting in this tab";
      el.appendChild(name);

      const close = document.createElement("button");
      close.className = "tab-close";
      close.type = "button";
      close.title = "Close tab";
      close.textContent = "×";
      close.setAttribute("data-tab-close", tab.id);
      close.disabled = !closable;
      el.appendChild(close);

      tabbar.appendChild(el);
    }
    const add = document.createElement("button");
    add.className = "tab-add";
    add.type = "button";
    add.title = "New tree (tab)";
    add.textContent = "+";
    add.setAttribute("data-action", "new-tab");
    tabbar.appendChild(add);

    // Duplicate acts on the active tab, so it lives beside "+" rather than on
    // every tab — one control, and the bar stays readable on a phone.
    const dup = document.createElement("button");
    dup.className = "tab-add tab-dup";
    dup.type = "button";
    dup.title = `Duplicate this tab (${displayKey(bindingFor("duplicate-tab"))})`;
    dup.textContent = "⧉";
    dup.setAttribute("data-action", "duplicate-tab");
    tabbar.appendChild(dup);
  }

  /** Update just the draft markers, without rebuilding the bar (and with it
   *  any in-progress rename input). */
  function refreshTabMarkers() {
    if (!tabbar) return;
    for (const tab of workspace.tabs) {
      tabbar
        .querySelector(`[data-tab-id="${tab.id}"]`)
        ?.classList.toggle("has-draft", tab.draft !== undefined);
    }
  }

  tabbar?.addEventListener("click", (e) => {
    const target = e.target as Element;
    // The bar's own buttons (+ / ⧉) go through the same `data-action` map the
    // toolbar uses, so a tab command needs wiring in exactly one place.
    const action = target.closest<HTMLElement>("[data-action]")?.getAttribute("data-action");
    if (action && actions[action]) {
      actions[action]();
      return;
    }
    const closeBtn = target.closest<HTMLElement>("[data-tab-close]");
    if (closeBtn) {
      e.stopPropagation();
      if (!(closeBtn as HTMLButtonElement).disabled)
        closeTab(closeBtn.getAttribute("data-tab-close")!);
      return;
    }
    if (suppressTabClick) {
      suppressTabClick = false;
      return; // the click that ended a reorder drag
    }
    const tabEl = target.closest<HTMLElement>("[data-tab-id]");
    if (tabEl) switchTab(tabEl.getAttribute("data-tab-id")!);
  });

  // ---- drag a tab to reorder it ---------------------------------------
  //
  // Pointer events, like node dragging: mouse and pen start on a 5px move,
  // touch on a long press — the bar scrolls horizontally on a phone, and a
  // short horizontal drag has to stay a scroll. The model is reordered live
  // and the bar re-rendered, so the tab follows the pointer with no separate
  // drop indicator; the pointer is captured on the *bar*, so the re-render
  // replacing the tab element under the cursor doesn't end the drag.
  const TOUCH_HOLD_MS = 400;
  let tabDragId: string | null = null;
  let tabDragStartX = 0;
  let tabDragArmed = false;
  let tabDragMoved = false;
  let tabHoldTimer: number | undefined;
  let suppressTabClick = false;

  function endTabDrag() {
    window.clearTimeout(tabHoldTimer);
    if (tabDragMoved) {
      saveWorkspace(workspace.toStored());
      suppressTabClick = true;
    }
    if (tabDragId) {
      tabbar
        ?.querySelector(`[data-tab-id="${tabDragId}"]`)
        ?.classList.remove("dragging");
    }
    tabDragId = null;
    tabDragArmed = false;
    tabDragMoved = false;
  }

  /** Where the dragged tab belongs now: past every tab whose centre it's left. */
  function tabDropIndex(clientX: number): number {
    const els = Array.from(
      tabbar?.querySelectorAll<HTMLElement>("[data-tab-id]") ?? []
    );
    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect();
      if (clientX < r.left + r.width / 2) return i;
    }
    return els.length - 1;
  }

  tabbar?.addEventListener("pointerdown", (e) => {
    // A fresh interaction always starts unsuppressed: if the click that ended
    // the last drag never landed on the bar, the flag mustn't eat this one.
    suppressTabClick = false;
    if (e.button !== 0 || !e.isPrimary) return;
    const target = e.target as Element;
    if (target.closest("button") || target.closest("input")) return;
    const tabEl = target.closest<HTMLElement>("[data-tab-id]");
    if (!tabEl || workspace.tabs.length < 2) return;
    tabDragId = tabEl.getAttribute("data-tab-id");
    tabDragStartX = e.clientX;
    tabDragMoved = false;
    tabDragArmed = e.pointerType !== "touch";
    if (!tabDragArmed) {
      tabHoldTimer = window.setTimeout(() => {
        tabDragArmed = true;
        tabEl.classList.add("dragging");
      }, TOUCH_HOLD_MS);
    }
  });

  tabbar?.addEventListener("pointermove", (e) => {
    if (!tabDragId) return;
    if (!tabDragArmed) {
      // Moved before the hold elapsed: that's a scroll, not a reorder.
      if (Math.abs(e.clientX - tabDragStartX) > 8) endTabDrag();
      return;
    }
    if (!tabDragMoved) {
      if (Math.abs(e.clientX - tabDragStartX) < 5) return;
      tabDragMoved = true;
      tabbar!.setPointerCapture(e.pointerId);
    }
    e.preventDefault();
    if (workspace.move(tabDragId, tabDropIndex(e.clientX))) renderTabs();
    tabbar
      ?.querySelector(`[data-tab-id="${tabDragId}"]`)
      ?.classList.add("dragging");
  });

  tabbar?.addEventListener("pointerup", endTabDrag);
  tabbar?.addEventListener("pointercancel", endTabDrag);
  tabbar?.addEventListener("dblclick", (e) => {
    const tabEl = (e.target as Element).closest<HTMLElement>("[data-tab-id]");
    if (tabEl) startTabRename(tabEl.getAttribute("data-tab-id")!);
  });
  tabbar?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const tabEl = (e.target as Element).closest<HTMLElement>("[data-tab-id]");
    if (tabEl) {
      e.preventDefault();
      switchTab(tabEl.getAttribute("data-tab-id")!);
    }
  });

  // ---- keyboard-shortcut help + remap UI (rendered from the keymap) ----

  /** Fill the help modal's shortcut table from the single keymap source. */
  function renderHelpKeys() {
    if (!helpKeys) return;
    helpKeys.innerHTML = "";
    const rows: { keys: string; label: string }[] = [];
    for (const f of FIXED_KEYS) rows.push({ keys: f.keys, label: f.label });
    for (const c of COMMANDS) {
      const keys = [bindingFor(c.id), ...(c.extraKeys ?? [])]
        .filter(Boolean)
        .map(displayKey)
        .join(" / ");
      rows.push({ keys, label: c.label });
    }
    for (const r of rows) {
      const tr = document.createElement("tr");
      const td1 = document.createElement("td");
      td1.textContent = r.keys;
      const td2 = document.createElement("td");
      td2.textContent = r.label;
      tr.append(td1, td2);
      helpKeys.appendChild(tr);
    }
  }

  let capturingFor: string | null = null;

  /** Render the remappable-shortcut list in the Settings panel. */
  function renderShortcutSettings() {
    if (!shortcutList) return;
    shortcutList.innerHTML = "";
    for (const c of COMMANDS) {
      const row = document.createElement("div");
      row.className = "shortcut-row";

      const label = document.createElement("span");
      label.className = "shortcut-label";
      label.textContent = c.label;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "shortcut-key";
      btn.setAttribute("data-rebind", c.id);
      btn.textContent =
        capturingFor === c.id ? "Press a key…" : displayKey(bindingFor(c.id));
      if (capturingFor === c.id) btn.classList.add("capturing");

      row.append(label, btn);
      shortcutList.appendChild(row);
    }
  }

  /** Begin capturing the next keypress as a new binding for `id`. */
  function beginCapture(id: string) {
    capturingFor = id;
    renderShortcutSettings();
  }

  // Capture a keypress for rebinding (only while the Settings panel is open and
  // a row is armed). Runs at capture phase so it pre-empts the global handler.
  window.addEventListener(
    "keydown",
    (e) => {
      if (!capturingFor) return;
      // Ignore lone modifier presses — wait for the actual key.
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        capturingFor = null;
        renderShortcutSettings();
        return;
      }
      const canonical = canonicalFromEvent(e);
      const conflict = rebind(capturingFor, canonical);
      if (conflict) {
        flashStatus(`${displayKey(canonical)} is already used by "${conflict.label}"`);
      } else {
        saveKeymap(keymapOverrides());
        renderHelpKeys();
      }
      capturingFor = null;
      renderShortcutSettings();
    },
    true
  );

  shortcutList?.addEventListener("click", (e) => {
    const btn = (e.target as Element).closest<HTMLElement>("[data-rebind]");
    if (btn) beginCapture(btn.getAttribute("data-rebind")!);
  });

  // ---- divider (resize panes) ----------------------------------------
  setupDivider();

  // ---- compact toolbar (small screens) --------------------------------
  setupCompactToolbar();

  // ---- boot ----------------------------------------------------------
  // Restore persisted display settings (font size, spacing, edge style,
  // alignment, boxes, auto-subscript) before the first render.
  loadPrefs();
  applyOverrides(loadKeymap());
  renderHelpKeys();
  renderShortcutSettings();

  const savedTheme = loadTheme() || "light";
  document.documentElement.setAttribute("data-theme", savedTheme);
  applyThemeColors(savedTheme === "dark" ? "dark" : "light");

  // Restore the tab workspace, migrating a legacy single-doc save into one tab.
  const stored = loadWorkspace();
  const restored = stored ? Workspace.fromStored(stored) : null;
  const fragment = fragmentDoc();
  const shared =
    fragment && parseAll(fragment).trees.length > 0 ? fragment : null;

  if (restored) {
    workspace.tabs = restored.tabs;
    workspace.activeId = restored.activeId;
  } else {
    const legacy = loadDoc();
    const seed =
      legacy && parseAll(legacy).trees.length > 0 ? legacy : shared ?? DEFAULT_DOC;
    workspace.add(seed, "Tree 1");
  }

  // A shared link opens as its **own tab**. The fragment normally just mirrors
  // whatever tab is active, so an incoming document that matches one we already
  // hold is that mirror and only needs focusing; anything else came from
  // somebody else's link, and overwriting the active tab with it (as this used
  // to do, localStorage included, with no way back) is data loss.
  if (shared) {
    const match = workspace.tabs.find((t) => t.text === shared);
    if (match) workspace.setActive(match.id);
    else workspace.add(shared, "Shared");
  }

  loadActiveTab();
  saveWorkspace(workspace.toStored());
}

function setupDivider() {
  const divider = document.getElementById("divider");
  const treePane = document.getElementById("tree-pane");
  const app = document.getElementById("app");
  if (!divider || !treePane || !app) return;
  let dragging = false;
  divider.addEventListener("pointerdown", (e) => {
    dragging = true;
    e.preventDefault();
    divider.setPointerCapture(e.pointerId);
    document.body.style.userSelect = "none";
  });
  divider.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const rect = app.getBoundingClientRect();
    // Panes stack vertically on small screens (see the CSS media query), so
    // resize along whichever axis is the flex main axis.
    const vertical = getComputedStyle(app).flexDirection === "column";
    const pct = vertical
      ? ((e.clientY - rect.top) / rect.height) * 100
      : ((e.clientX - rect.left) / rect.width) * 100;
    const clamped = Math.min(85, Math.max(15, pct));
    treePane.style.flex = `0 0 ${clamped}%`;
  });
  const endDivide = () => {
    dragging = false;
    document.body.style.userSelect = "";
  };
  divider.addEventListener("pointerup", endDivide);
  divider.addEventListener("pointercancel", endDivide);
}
