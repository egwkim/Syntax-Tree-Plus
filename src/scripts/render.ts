import { Tree, Node } from "./tree.js";
import { settings } from "./settings.js";
import { applyAutoSubscripts } from "./edit.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// Off-screen canvas for measuring the base label (excluding scripts).
const measureCanvas = document.createElement("canvas");
const measureCtx = measureCanvas.getContext("2d")!;
function baseTextWidth(node: Node): number {
  measureCtx.font = `${settings.label.fontSize}px ${settings.label.fontFamily}`;
  return measureCtx.measureText(node.label).width;
}

export interface RenderOptions {
  interactive?: boolean;
  onNodeClick?: (node: Node, evt: MouseEvent) => void;
  margin?: number;
  /**
   * Draw the selection highlight (box + tinted label). Defaults to
   * `interactive`, so an **export is a picture of the tree, not of the editing
   * session** — otherwise a downloaded SVG/PNG carries whichever node happened
   * to be selected, filled blue. The selection itself is untouched: only the
   * drawing is suppressed.
   */
  showSelection?: boolean;
}

const el = (name: string): SVGElement => document.createElementNS(SVG_NS, name);
function attr(node: SVGElement, attrs: Record<string, string | number>) {
  for (const k in attrs) node.setAttribute(k, String(attrs[k]));
}

/**
 * Build an <svg> element for a tree. The SVG is sized to the tree's bounding
 * box (good for both on-screen display and export).
 */
export function buildSVG(tree: Tree, opts: RenderOptions = {}): SVGSVGElement {
  const margin = opts.margin ?? 24;
  const { height, verticalSpacing, horizontalSpacing } = settings.node;

  // Compute auto-subscripts (if enabled) before measuring, so their width is
  // reflected in layout. Writes only the transient `autoSubscript` field.
  applyAutoSubscripts(tree, settings.autoSubscript);

  tree.calculateWidths();
  tree.recomputeDepth();

  const topMargin = margin + height / 2;
  const maxLeafDepth = tree.maxLeafDepth();
  const bottomRowY = topMargin + maxLeafDepth * verticalSpacing;

  const rowDepth = alignmentDepths(tree, maxLeafDepth);

  // --- Pass 1: assign positions ---------------------------------------
  const layout = (node: Node, centerX: number) => {
    node.x = centerX;
    node.y = topMargin + (rowDepth.get(node) ?? node.depth) * verticalSpacing;

    if (node.children.length > 0) {
      let childX = centerX - node.width / 2;
      node.children.forEach((child) => {
        const childCenter = childX + child.width / 2;
        layout(child, childCenter);
        childX += child.width + horizontalSpacing;
      });
    }
  };
  layout(tree.root, margin + tree.root.width / 2);

  // --- Compute bounding box -------------------------------------------
  let minX = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  tree.root.walk((n) => {
    const halfBox = n.textWidth / 2 + settings.node.padding;
    minX = Math.min(minX, n.x - halfBox);
    maxX = Math.max(maxX, n.x + halfBox);
    maxY = Math.max(maxY, n.y + height / 2);
  });

  // Reserve room beneath the tree for movement arrows.
  const arrowGroups = collectMovement(tree);
  const arrowRoom = arrowGroups.length > 0 ? 60 : 0;

  const width = maxX - minX + margin * 2;
  const totalHeight = maxY + margin + arrowRoom;
  const viewMinX = minX - margin;

  const svg = el("svg") as SVGSVGElement;
  attr(svg, {
    xmlns: SVG_NS,
    viewBox: `${viewMinX} 0 ${width} ${totalHeight}`,
    width,
    height: totalHeight,
  });
  svg.style.display = "block";
  svg.style.maxWidth = "none";
  // Expose the tree to assistive tech. Node groups (drawn below) are treeitems
  // owned directly by this role="tree" element; the drawing layers are purely
  // decorative and hidden from the accessibility tree.
  attr(svg, {
    role: "tree",
    "aria-label": "Syntax tree — Tab to enter, arrow keys to navigate",
  });

  defineArrowhead(svg);

  const edgesG = el("g");
  const trianglesG = el("g");
  const arrowsG = el("g");
  attr(edgesG, { "aria-hidden": "true" });
  attr(trianglesG, { "aria-hidden": "true" });
  attr(arrowsG, { "aria-hidden": "true" });
  svg.appendChild(edgesG);
  svg.appendChild(trianglesG);
  svg.appendChild(arrowsG);

  // --- Pass 2: draw ----------------------------------------------------
  tree.root.walk((node) => {
    node.children.forEach((child) => {
      if (child.isWord && child.triangle) {
        drawTriangle(trianglesG, node, child);
      } else {
        drawEdge(edgesG, node, child);
      }
    });
  });

  // Append node groups directly to the <svg> so each treeitem is a direct
  // child of role="tree"; drawn last so labels sit on top of the edges.
  tree.root.walk((node) => drawLabel(svg, tree, node, opts));

  drawMovementArrows(arrowsG, arrowGroups, bottomRowY, height);

  return svg;
}

/**
 * The row each node is drawn on under the current alignment mode — a port of
 * jsSyntaxTree's `moveLeafsToBottom` / `moveParentsDown`. An absent entry means
 * "stay at `node.depth`", so `top` needs no entries at all.
 *
 * `words` moves only words, which is the whole point of the mode: a childless
 * *node* like `[N]` is a category, not a lexical item, so it belongs with the
 * structure above rather than on the word row.
 *
 * One deliberate divergence in `bottom`: jsSyntaxTree only pushes down nodes
 * that have children, so a childless node's depth there comes out `Infinity`
 * (`moveParentsDown` takes a minimum over an empty child list) and the node
 * vanishes. We put every leaf on the bottom row instead.
 */
function alignmentDepths(tree: Tree, bottomRow: number): Map<Node, number> {
  const rows = new Map<Node, number>();
  const mode = settings.leafAlignment;

  if (mode === "top") return rows;

  if (mode === "words") {
    tree.root.walk((n) => {
      if (n.isWord) rows.set(n, bottomRow);
    });
    return rows;
  }

  // "bottom": leaves sit on the bottom row and each parent is pushed down to
  // just above its highest child. The root always lands back on row 0 — its
  // longest chain of descendants is what defines `bottomRow` in the first place.
  const assign = (node: Node): number => {
    const row = node.isLeaf
      ? bottomRow
      : Math.min(...node.children.map(assign)) - 1;
    rows.set(node, row);
    return row;
  };
  assign(tree.root);
  return rows;
}

function drawEdge(g: SVGElement, parent: Node, child: Node) {
  const x1 = parent.x;
  const y1 = parent.y + settings.node.height / 2 - 4;
  const x2 = child.x;
  const y2 = child.y - settings.node.height / 2 + 4;

  if (settings.edge.style === "curved") {
    const midY = (y1 + y2) / 2;
    const path = el("path");
    attr(path, {
      d: `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`,
      fill: "none",
      stroke: settings.edge.color,
      "stroke-width": settings.edge.width,
    });
    g.appendChild(path);
    return;
  }
  const line = el("line");
  attr(line, {
    x1,
    y1,
    x2,
    y2,
    stroke: settings.edge.color,
    "stroke-width": settings.edge.width,
  });
  g.appendChild(line);
}

function drawTriangle(g: SVGElement, parent: Node, leaf: Node) {
  const halfBase = Math.max(leaf.textWidth / 2, 12);
  const apexX = parent.x;
  const apexY = parent.y + settings.node.height / 2 - 4;
  const baseY = leaf.y - settings.node.height / 2 + 4;
  const tri = el("path");
  attr(tri, {
    d: `M ${apexX} ${apexY} L ${leaf.x - halfBase} ${baseY} L ${
      leaf.x + halfBase
    } ${baseY} Z`,
    fill: "none",
    stroke: settings.triangle.color,
    "stroke-width": settings.triangle.width,
    "stroke-linejoin": "round",
  });
  g.appendChild(tri);
}

/** Human-readable name announced for a node by assistive tech. */
function nodeAriaLabel(node: Node): string {
  let s = node.label.trim() || "(blank)";
  if (node.superscript) s += ", superscript " + node.superscript;
  const sub = node.displaySubscript();
  if (sub) s += ", subscript " + sub;
  s += node.isWord ? ", word" : ", node";
  return s;
}

function drawLabel(g: SVGElement, tree: Tree, node: Node, opts: RenderOptions) {
  // `isSelected` is the model's truth (drives ARIA + the roving tabindex);
  // `selected` is whether to *draw* it, which an export turns off.
  const isSelected = tree.selectedNode === node;
  const selected = isSelected && (opts.showSelection ?? !!opts.interactive);
  const group = el("g");
  group.setAttribute("data-node-id", String(node.id));

  // ARIA: every node is a treeitem, with level from its depth and the tree's
  // selection state.
  // No `aria-expanded`: nothing can collapse a subtree, and advertising an
  // expanded/collapsed state that doesn't exist just misleads screen readers.
  // Add it back if collapse/expand ever lands.
  attr(group, {
    role: "treeitem",
    "aria-label": nodeAriaLabel(node),
    "aria-level": node.depth + 1,
    "aria-selected": String(isSelected),
  });

  if (opts.interactive) {
    group.style.cursor = "pointer";
    // Roving tabindex: exactly one node is in the tab order — the selected one,
    // or the root when nothing is selected — so Tab reaches the tree once and
    // arrow keys take over from there.
    const isTabStop = tree.selectedNode
      ? isSelected
      : node === tree.root;
    group.setAttribute("tabindex", isTabStop ? "0" : "-1");
  }

  // A per-node color override (Settings panel) tints the label and, when node
  // boxes are visible, the box outline. It wins even while selected — the user
  // sets it via the panel with the node selected, so it must stay visible then,
  // not just after deselecting. Unset nodes keep the dark selected-text color
  // for contrast against the light selection fill.
  const textFill = node.color || (selected ? "#0b2a4a" : settings.label.color);

  if (settings.showNodeBoxes || selected) {
    const box = el("rect");
    const w = node.textWidth + settings.node.padding * 2;
    attr(box, {
      x: node.x - w / 2,
      y: node.y - settings.node.height / 2,
      width: w,
      height: settings.node.height,
      rx: settings.node.radius,
      ry: settings.node.radius,
      fill: selected ? settings.fill.selected : settings.fill.node,
      stroke: selected
        ? settings.fill.selectedStroke
        : settings.showNodeBoxes
        ? node.color || "#bbb"
        : "none",
      "stroke-width": 1.5,
    });
    group.appendChild(box);
  }

  const text = el("text");
  attr(text, {
    x: node.x,
    y: node.y,
    "text-anchor": "middle",
    "dominant-baseline": "central",
    "font-size": settings.label.fontSize,
    "font-family": settings.label.fontFamily,
    // Words are italicised, the way lexical items are set in running text;
    // category labels — including childless ones like `[N]` — stay upright.
    "font-style": node.isWord && !node.triangle ? "italic" : "normal",
    fill: textFill,
  });
  text.textContent = node.label;
  group.appendChild(text);

  // Sub / superscripts, positioned just right of the base label.
  const subscriptText = node.displaySubscript();
  if (subscriptText || node.superscript) {
    const bw = baseTextWidth(node);
    const sx = node.x + bw / 2 + 1;
    const scriptSize = settings.label.fontSize * 0.7;
    if (subscriptText) {
      const sub = el("text");
      attr(sub, {
        x: sx,
        y: node.y + settings.label.fontSize * 0.35,
        "text-anchor": "start",
        "dominant-baseline": "central",
        "font-size": scriptSize,
        "font-family": settings.label.fontFamily,
        fill: textFill,
      });
      sub.textContent = subscriptText;
      group.appendChild(sub);
    }
    if (node.superscript) {
      const sup = el("text");
      attr(sup, {
        x: sx,
        y: node.y - settings.label.fontSize * 0.35,
        "text-anchor": "start",
        "dominant-baseline": "central",
        "font-size": scriptSize,
        "font-family": settings.label.fontFamily,
        fill: textFill,
      });
      sup.textContent = node.superscript;
      group.appendChild(sup);
    }
  }

  if (opts.interactive && opts.onNodeClick) {
    group.addEventListener("click", (e) => {
      e.stopPropagation();
      opts.onNodeClick!(node, e as MouseEvent);
    });
  }
  g.appendChild(group);
}

// --- Movement arrows ---------------------------------------------------

interface MovementPair {
  from: Node; // trace / lower element
  to: Node; // antecedent
}

/**
 * Derive movement arrows from co-indexation: nodes that share a subscript are
 * linked. The trace (a leaf labelled `t`, `t*`, `e`, or `*`) is the arrow's
 * source; its antecedent is the target.
 */
function collectMovement(tree: Tree): MovementPair[] {
  const byIndex = new Map<string, Node[]>();
  tree.root.walk((n) => {
    if (n.subscript) {
      const arr = byIndex.get(n.subscript) ?? [];
      arr.push(n);
      byIndex.set(n.subscript, arr);
    }
  });

  const isTrace = (n: Node) =>
    n.isLeaf && /^(t\*?|e|\*)$/i.test(n.label.trim());

  const pairs: MovementPair[] = [];
  byIndex.forEach((nodes) => {
    if (nodes.length < 2) return;
    const traces = nodes.filter(isTrace);
    const antecedents = nodes.filter((n) => !isTrace(n));
    if (traces.length > 0 && antecedents.length > 0) {
      const target = antecedents[0];
      traces.forEach((tr) => pairs.push({ from: tr, to: target }));
    } else {
      // No explicit trace — link later occurrences to the first.
      for (let i = 1; i < nodes.length; i++) {
        pairs.push({ from: nodes[i], to: nodes[0] });
      }
    }
  });
  return pairs;
}

function drawMovementArrows(
  g: SVGElement,
  pairs: MovementPair[],
  bottomRowY: number,
  height: number
) {
  const dip = bottomRowY + height / 2 + 40;
  pairs.forEach(({ from, to }) => {
    const sx = from.x;
    const sy = from.y + height / 2;
    const tx = to.x;
    const ty = to.y + height / 2;
    const path = el("path");
    attr(path, {
      d: `M ${sx} ${sy} C ${sx} ${dip}, ${tx} ${dip}, ${tx} ${ty}`,
      fill: "none",
      stroke: settings.movement.color,
      "stroke-width": settings.movement.width,
      "marker-end": "url(#arrowhead)",
    });
    g.appendChild(path);
  });
}

function defineArrowhead(svg: SVGSVGElement) {
  const defs = el("defs");
  const marker = el("marker");
  attr(marker, {
    id: "arrowhead",
    markerWidth: 8,
    markerHeight: 8,
    refX: 6,
    refY: 3,
    orient: "auto",
    markerUnits: "strokeWidth",
  });
  const p = el("path");
  attr(p, { d: "M0,0 L6,3 L0,6 Z", fill: settings.movement.color });
  marker.appendChild(p);
  defs.appendChild(marker);
  svg.appendChild(defs);
}

/** Render a tree into a container element, wiring up click selection. */
export function render(
  tree: Tree,
  container: HTMLElement,
  onNodeClick: (node: Node, evt: MouseEvent) => void
): SVGSVGElement {
  container.innerHTML = "";
  const svg = buildSVG(tree, { interactive: true, onNodeClick });
  container.appendChild(svg);
  return svg;
}
