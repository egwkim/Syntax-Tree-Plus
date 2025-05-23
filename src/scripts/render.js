/**
 * Renders a tree as an SVG element.
 * @param {Tree} tree - The tree object to render.
 * @param {Function} onNodeClick - Callback function to handle node click events.
 * @returns {SVGSVGElement} The SVG element representing the tree.
 */
function renderTreeToSVG(tree, onNodeClick) {
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

  // Helper to calculate the width of each subtree
  function calcSubtreeWidth(node, nodeRadius, minSpacing) {
    if (!node.children || node.children.length === 0) return nodeRadius * 2;
    let total = 0;
    node.children.forEach(child => {
      total += calcSubtreeWidth(child, nodeRadius, minSpacing);
    });
    total += minSpacing * (node.children.length - 1);
    return Math.max(total, nodeRadius * 2);
  }

  function drawNode(node, x, y, level, parentCoords = null) {
    const nodeRadius = 20;
    const verticalSpacing = 80;
    const minSpacing = 40; // minimum horizontal spacing between nodes

    // Draw line to parent if not root
    if (parentCoords) {
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", parentCoords.x);
      line.setAttribute("y1", parentCoords.y);
      line.setAttribute("x2", x);
      line.setAttribute("y2", y);
      line.setAttribute("stroke", "#888");
      line.setAttribute("stroke-width", "2"); // wider line
      linesGroup.appendChild(line);
    }

    // Draw node circle
    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("cx", x);
    circle.setAttribute("cy", y);
    circle.setAttribute("r", nodeRadius);
    circle.setAttribute("fill", tree.selectedNode === node ? "#cce6ff" : "#fff");
    circle.setAttribute("stroke", "#333");
    circle.setAttribute("stroke-width", "2"); // wider border
    circle.style.cursor = "pointer";
    circle.addEventListener("click", function(e) {
      e.stopPropagation();
      if (onNodeClick) onNodeClick(node);
    });
    circlesGroup.appendChild(circle);

    // Draw label
    const text = document.createElementNS(svgNS, "text");
    text.setAttribute("x", x);
    text.setAttribute("y", y + 5);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("font-size", "14");
    text.textContent = node.label;
    text.style.cursor = "pointer";
    text.addEventListener("click", function(e) {
      e.stopPropagation();
      if (onNodeClick) onNodeClick(node);
    });
    textGroup.appendChild(text);

    // Draw children with automatic spacing
    const children = node.getChildren();
    if (children.length > 0) {
      // Calculate total width needed for all children
      const subtreeWidths = children.map(child => calcSubtreeWidth(child, nodeRadius, minSpacing));
      const totalWidth = subtreeWidths.reduce((a, b) => a + b, 0) + minSpacing * (children.length - 1);
      let startX = x - totalWidth / 2 + subtreeWidths[0] / 2;
      for (let i = 0; i < children.length; i++) {
        drawNode(children[i], startX, y + verticalSpacing, level + 1, { x, y });
        if (i < children.length - 1) {
          startX += (subtreeWidths[i] + subtreeWidths[i + 1]) / 2 + minSpacing;
        }
      }
    }
  }

  // Calculate the width and height of the viewport
  const nodeRadius = 20;
  const minSpacing = 40;
  const viewportWidth = window.innerWidth;
  const centerX = viewportWidth / 2;
  drawNode(tree.root, centerX, 100, 0);

  return svg;
}
