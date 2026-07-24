import { Tree, Node } from "./tree.js";
import { render } from "./render.js";
import { settings } from "./settings.js";
import { parse, parseLabel } from "./parser.js";
import { serialize } from "./serialize.js";
import { History } from "./history.js";
import { saveDoc, loadDoc, saveTheme, loadTheme } from "./persist.js";
import { exportSVG, exportPNG, exportLaTeX } from "./export.js";
import {
  cloneNodeSubtree,
  addChildAt,
  addSiblingBefore,
  addSiblingAfter,
  deleteNode,
  wrapNode,
  moveSibling,
  xbarTemplate,
  toggleTriangle,
  isDescendant,
  reparent,
} from "./edit.js";

const DEFAULT_DOC =
  "[S [NP [D The][N cat]] [VP [V sat] [PP [P on] [NP [D the][N mat]]]]]";

export function startApp() {
  const container = document.getElementById("tree-container") as HTMLElement;
  const textInput = document.getElementById("text-input") as HTMLTextAreaElement;
  const parseError = document.getElementById("parse-error") as HTMLElement;
  const toolbar = document.getElementById("toolbar") as HTMLElement;
  const helpModal = document.getElementById("help-modal") as HTMLElement;

  let tree!: Tree;
  const historyStack = new History();
  const navigationHistory: number[] = [];
  let clipboard: Node | null = null;
  let inlineEditor: HTMLInputElement | null = null;
  let dragMode = false;

  // ---- helpers -------------------------------------------------------

  function getNodeById(id: number): Node | null {
    let found: Node | null = null;
    tree.root.walk((n) => {
      if (n.id === id) found = n;
    });
    return found;
  }

  /** Path of child indices from the root to a node (for selection restore). */
  function pathOf(node: Node): number[] {
    const path: number[] = [];
    let n: Node | null = node;
    while (n && n.parent) {
      path.unshift(n.parent.children.indexOf(n));
      n = n.parent;
    }
    return path;
  }
  function nodeAtPath(t: Tree, path: number[]): Node | null {
    let n: Node = t.root;
    for (const idx of path) {
      if (!n.children[idx]) return null;
      n = n.children[idx];
    }
    return n;
  }

  function setTree(newTree: Tree, keepSelectionPath?: number[]) {
    tree = newTree;
    if (keepSelectionPath) {
      tree.selectedNode = nodeAtPath(tree, keepSelectionPath) ?? tree.root;
    } else if (!tree.selectedNode) {
      tree.selectedNode = tree.root;
    }
  }

  function renderTree() {
    render(tree, container, (node) => {
      tree.selectedNode = node;
      navigationHistory.length = 0;
      renderTree();
    });
    updateHistoryButtons();
    updateRoundTripWarning();
  }

  /**
   * Warn when the tree contains two adjacent terminal leaves under one node:
   * bracket notation would serialize them as one space-separated run and a
   * text round-trip would merge them into a single (triangle) leaf.
   */
  function updateRoundTripWarning() {
    const warn = document.getElementById("round-trip-warning");
    if (!warn) return;
    let ambiguous = false;
    tree.root.walk((n) => {
      for (let i = 0; i < n.children.length - 1; i++) {
        if (n.children[i].isLeaf && n.children[i + 1].isLeaf) ambiguous = true;
      }
    });
    warn.classList.toggle("visible", ambiguous);
  }

  /** Push current state to history + persist. Optionally refresh text pane. */
  function commit(updateText = true) {
    const text = serialize(tree);
    historyStack.push(text);
    saveDoc(text);
    if (updateText) textInput.value = text;
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
      const { tree: parsed, error } = parse(raw);
      if (error || !parsed) {
        parseError.textContent = "⚠ " + (error ?? "Could not parse");
        parseError.classList.add("visible");
        return;
      }
      parseError.classList.remove("visible");
      const path = tree ? pathOf(tree.selectedNode ?? tree.root) : [];
      setTree(parsed, path);
      historyStack.push(raw.trim());
      saveDoc(raw);
      renderTree();
    }, 250);
  }
  textInput.addEventListener("input", onTextChanged);

  // ---- IDE-style bracket handling in the text pane -------------------
  textInput.addEventListener("keydown", (e) => {
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
      el.dispatchEvent(new Event("input")); // re-parse + re-render
    };

    if (e.key === "[") {
      // Wrap the selection in [ … ] (keeping it selected), or insert an empty
      // pair with the caret between the brackets.
      e.preventDefault();
      const selected = val.slice(start, end);
      const text = val.slice(0, start) + "[" + selected + "]" + val.slice(end);
      if (start === end) applyEdit(text, start + 1);
      else applyEdit(text, start + 1, end + 1);
    } else if (e.key === "]") {
      // Type over an existing closing bracket instead of duplicating it.
      if (start === end && val[start] === "]") {
        e.preventDefault();
        el.selectionStart = el.selectionEnd = start + 1;
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

  function rawToken(node: Node): string {
    let s = node.label;
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

      let changed = false;
      if (commit) {
        const { base, sub, sup } = parseLabel(value);
        node.updateLabel(base);
        node.subscript = sub;
        node.superscript = sup;
        // Multi-word terminal becomes a triangle automatically.
        if (node.isLeaf && base.indexOf(" ") >= 0) node.triangle = true;
        node.updateTextWidth();
        changed = true;
      }

      // Blank-node cleanup: a leaf left with no label (e.g. added then
      // cancelled, or cleared) is discarded rather than kept as an empty node
      // that would also vanish on a text round-trip.
      if (node.isLeaf && node.label.trim() === "" && node.parent) {
        const parent = node.parent;
        parent.removeChild(node);
        tree.selectedNode = parent;
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
    input.focus();
    input.select();
  }

  function cancelInlineEdit() {
    if (inlineEditor) {
      const ed = inlineEditor;
      inlineEditor = null;
      ed.remove();
    }
  }

  container.addEventListener("dblclick", (e) => {
    const target = e.target as Element;
    const group = target.closest("[data-node-id]");
    if (!group) return;
    const found = getNodeById(Number(group.getAttribute("data-node-id")));
    if (found) {
      tree.selectedNode = found;
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
    if (!onNode && tree.selectedNode) {
      tree.selectedNode = null;
      navigationHistory.length = 0;
      renderTree();
    }
  });

  // ---- toolbar actions -----------------------------------------------

  function insertAndEdit(node: Node | null) {
    if (!node) return;
    tree.selectedNode = node;
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
      tree.selectedNode = parent;
      mutated();
    },
    paste() {
      const sel = tree.selectedNode;
      if (!clipboard || !sel) return;
      const pasted = cloneNodeSubtree(clipboard);
      sel.insertChild(pasted);
      tree.selectedNode = pasted;
      mutated();
    },
    "paste-before"() {
      const sel = tree.selectedNode;
      if (!clipboard || !sel || !sel.parent) return;
      const pasted = cloneNodeSubtree(clipboard);
      const idx = sel.parent.children.indexOf(sel);
      sel.parent.insertChild(pasted, idx);
      tree.selectedNode = pasted;
      mutated();
    },
    "paste-after"() {
      const sel = tree.selectedNode;
      if (!clipboard || !sel || !sel.parent) return;
      const pasted = cloneNodeSubtree(clipboard);
      const idx = sel.parent.children.indexOf(sel);
      sel.parent.insertChild(pasted, idx + 1);
      tree.selectedNode = pasted;
      mutated();
    },
    "toggle-drag"() {
      dragMode = !dragMode;
      document.body.classList.toggle("drag-mode", dragMode);
      toolbar
        .querySelector('[data-action="toggle-drag"]')
        ?.classList.toggle("active", dragMode);
      if (!dragMode) cleanupDrag(false);
    },
    wrap() {
      const sel = tree.selectedNode;
      if (!sel) return;
      const parent = wrapNode(tree, sel, "X");
      tree.selectedNode = parent;
      mutated();
      startInlineEdit(parent);
    },
    rename() {
      if (tree.selectedNode) startInlineEdit(tree.selectedNode);
    },
    triangle() {
      const sel = tree.selectedNode;
      if (sel && sel.isLeaf) {
        toggleTriangle(sel);
        mutated();
      }
    },
    delete() {
      const sel = tree.selectedNode;
      if (!sel) return;
      const next = deleteNode(tree, sel);
      tree.selectedNode = next;
      mutated();
    },
    xbar() {
      const sel = tree.selectedNode;
      if (!sel) return;
      const head = xbarTemplate(tree, sel);
      tree.selectedNode = head;
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
    "export-svg": () => exportSVG(tree),
    "export-png": () => exportPNG(tree),
    "export-latex": () => exportLaTeX(tree),
    "toggle-align"() {
      settings.leafAlignment = settings.leafAlignment === "leaf" ? "node" : "leaf";
      renderTree();
    },
    "toggle-boxes"() {
      settings.showNodeBoxes = !settings.showNodeBoxes;
      renderTree();
    },
    "toggle-theme": () => toggleTheme(),
    help() {
      helpModal.classList.add("active");
    },
    "close-help"() {
      helpModal.classList.remove("active");
    },
  };

  function restoreFromHistory(state: string) {
    const { tree: parsed } = parse(state);
    if (!parsed) return;
    setTree(parsed);
    saveDoc(state);
    textInput.value = state;
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

  function updateHistoryButtons() {
    const undoBtn = toolbar.querySelector('[data-action="undo"]');
    const redoBtn = toolbar.querySelector('[data-action="redo"]');
    undoBtn?.toggleAttribute("disabled", !historyStack.canUndo());
    redoBtn?.toggleAttribute("disabled", !historyStack.canRedo());
  }

  // ---- theme ---------------------------------------------------------

  function applyTheme(theme: string) {
    document.documentElement.setAttribute("data-theme", theme);
    settings.label.color = theme === "dark" ? "#e8e8e8" : "#1a1a1a";
    settings.edge.color = theme === "dark" ? "#aaa" : "#555";
    settings.triangle.color = theme === "dark" ? "#aaa" : "#555";
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
  function flashStatus(msg: string) {
    let el = document.getElementById("status-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "status-toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("visible");
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => el!.classList.remove("visible"), 900);
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
        tree.selectedNode = dragSource;
        cleanupDrag(false);
        mutated();
        return;
      }
    }
    // Plain tap in drag mode (no movement) still selects the node.
    if (!dragging && dragSource) tree.selectedNode = dragSource;
    cleanupDrag(true);
  });

  function updateDropTarget(cx: number, cy: number) {
    const el = document.elementFromPoint(cx, cy);
    const group = el?.closest("[data-node-id]");
    const target = group
      ? getNodeById(Number(group.getAttribute("data-node-id")))
      : null;

    if (!target || !dragSource || isDescendant(dragSource, target)) {
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
    // Escape cancels an in-progress drag (before other Escape handling).
    if (e.key === "Escape" && dragSource) {
      e.preventDefault();
      cleanupDrag(true);
      return;
    }
    if (typing) return; // don't hijack while editing text
    if (!tree.selectedNode) return;

    const node = tree.selectedNode;
    switch (e.key) {
      case "ArrowUp":
        if (node.parent) {
          navigationHistory.push(node.parent.children.indexOf(node));
          tree.selectedNode = node.parent;
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
          tree.selectedNode = node.children[idx];
          renderTree();
        }
        break;
      case "ArrowLeft":
      case "ArrowRight":
        if (node.parent) {
          const sibs = node.parent.children;
          const idx = sibs.indexOf(node);
          if (e.shiftKey) {
            // Shift+arrow reorders siblings.
            if (moveSibling(node, e.key === "ArrowLeft" ? -1 : 1)) mutated();
          } else {
            const t = e.key === "ArrowLeft" ? idx - 1 : idx + 1;
            if (t >= 0 && t < sibs.length) {
              tree.selectedNode = sibs[t];
              navigationHistory.length = 0;
              renderTree();
            }
          }
        }
        break;
      case "n":
        actions.child();
        break;
      case "N":
        actions["child-start"]();
        break;
      case "s":
        actions["sib-after"]();
        break;
      case "S":
        actions["sib-before"]();
        break;
      case "w":
        actions.wrap();
        break;
      case "e":
      case "F2":
        e.preventDefault();
        actions.rename();
        break;
      case "t":
        actions.triangle();
        break;
      case "b":
        actions.xbar();
        break;
      case "Delete":
      case "Backspace":
      case "d":
        e.preventDefault();
        actions.delete();
        break;
      case "r":
        if (node.parent) {
          node.parent.children.reverse();
          mutated();
        }
        break;
      case "x":
        actions.cut();
        break;
      case "c":
        actions.copy();
        break;
      case "v":
        actions.paste();
        break;
      case "V":
        actions["paste-after"]();
        break;
      case "Escape":
        if (helpModal.classList.contains("active")) {
          helpModal.classList.remove("active");
        } else if (tree.selectedNode) {
          tree.selectedNode = null;
          navigationHistory.length = 0;
          renderTree();
        }
        break;
    }
  });

  // Reposition / dismiss inline editor on scroll & resize.
  container.addEventListener("scroll", cancelInlineEdit);
  window.addEventListener("resize", () => tree && renderTree());

  // ---- divider (resize panes) ----------------------------------------
  setupDivider();

  // ---- boot ----------------------------------------------------------
  const savedTheme = loadTheme() || "light";
  document.documentElement.setAttribute("data-theme", savedTheme);
  if (savedTheme === "dark") {
    settings.label.color = "#e8e8e8";
    settings.edge.color = "#aaa";
    settings.triangle.color = "#aaa";
  }

  const initial = loadDoc() || DEFAULT_DOC;
  const { tree: parsed, error } = parse(initial);
  setTree(parsed && !error ? parsed : parse(DEFAULT_DOC).tree!);
  tree.selectedNode = tree.root;
  textInput.value = serialize(tree);
  historyStack.push(serialize(tree));
  renderTree();
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
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    const clamped = Math.min(85, Math.max(25, pct));
    treePane.style.flex = `0 0 ${clamped}%`;
  });
  const endDivide = () => {
    dragging = false;
    document.body.style.userSelect = "";
  };
  divider.addEventListener("pointerup", endDivide);
  divider.addEventListener("pointercancel", endDivide);
}
