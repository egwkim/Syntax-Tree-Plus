import { Tree, Node } from './tree.js';

/**
 * Renders a tree as an SVG element.
 * @param tree - The tree object to render.
 * @param onNodeClick - Callback function to handle node click events.
 * @returns The SVG element representing the tree.
 */
export function renderTreeToSVG(tree: Tree, onNodeClick: (node: Node, x: number, y: number) => void): SVGSVGElement {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.style.width = "100vw";
  svg.style.height = "100vh";
  svg.style.display = "block";

  // Create groups for layering
  const linesGroup = document.createElementNS(svgNS, "g");
  const circlesGroup = document.createElementNS(svgNS, "g");
  const textGroup = document.createElementNS(svgNS, "g");
  svg.appendChild(linesGroup);
  svg.appendChild(circlesGroup);
  svg.appendChild(textGroup);

  function calcSubtreeWidth(node: Node, nodeRadius: number, minSpacing: number): number {
    if (!node.children || node.children.length === 0) return nodeRadius * 2;
    let total = 0;
    node.children.forEach((child: Node) => {
      total += calcSubtreeWidth(child, nodeRadius, minSpacing);
    });
    total += minSpacing * (node.children.length - 1);
    return Math.max(total, nodeRadius * 2);
  }

  function drawNode(node: Node, x: number, y: number, level: number, parentCoords: {x: number, y: number} | null = null) {
    const nodeRadius = 20;
    const verticalSpacing = 80;
    const minSpacing = 40;

    // Draw line to parent if not root
    if (parentCoords) {
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", parentCoords.x.toString());
      line.setAttribute("y1", parentCoords.y.toString());
      line.setAttribute("x2", x.toString());
      line.setAttribute("y2", y.toString());
      line.setAttribute("stroke", "#888");
      line.setAttribute("stroke-width", "2");
      linesGroup.appendChild(line);
    }

    // Draw node circle
    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("cx", x.toString());
    circle.setAttribute("cy", y.toString());
    circle.setAttribute("r", nodeRadius.toString());
    circle.setAttribute("fill", tree.selectedNode === node ? "#cce6ff" : "#fff");
    circle.setAttribute("stroke", "#333");
    circle.setAttribute("stroke-width", "2");
    circle.style.cursor = "pointer";
    circle.addEventListener("click", function(e) {
      e.stopPropagation();
      if (onNodeClick) onNodeClick(node, x, y);
    });
    circlesGroup.appendChild(circle);

    // Draw label
    const text = document.createElementNS(svgNS, "text");
    text.setAttribute("x", x.toString());
    text.setAttribute("y", (y + 5).toString());
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("font-size", "14");
    text.textContent = node.label;
    text.style.cursor = "pointer";
    text.addEventListener("click", function(e) {
      e.stopPropagation();
      if (onNodeClick) onNodeClick(node, x, y);
    });
    textGroup.appendChild(text);

    // Draw children with automatic spacing
    const children = node.getChildren();
    if (children.length > 0) {
      const subtreeWidths = children.map((child: Node) => calcSubtreeWidth(child, nodeRadius, minSpacing));
      const totalWidth = subtreeWidths.reduce((a: number, b: number) => a + b, 0) + minSpacing * (children.length - 1);
      let startX = x - totalWidth / 2 + subtreeWidths[0] / 2;
      for (let i = 0; i < children.length; i++) {
        drawNode(children[i], startX, y + verticalSpacing, level + 1, { x, y });
        if (i < children.length - 1) {
          startX += (subtreeWidths[i] + subtreeWidths[i + 1]) / 2 + minSpacing;
        }
      }
    }
  }

  const nodeRadius = 20;
  const minSpacing = 40;
  const viewportWidth = window.innerWidth;
  const centerX = viewportWidth / 2;
  drawNode(tree.root, centerX, 100, 0);

  return svg;
}
