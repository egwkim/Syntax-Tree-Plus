/**
 * Renders a tree as an SVG element.
 * @param {Tree} tree - The tree object to render.
 * @param {Function} onNodeClick - Callback function to handle node click events.
 * @returns {SVGSVGElement} The SVG element representing the tree.
 */
function renderTreeToSVG(tree, onNodeClick) {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", "800");
  svg.setAttribute("height", "600");

  // Create groups for layering
  const linesGroup = document.createElementNS(svgNS, "g");
  const circlesGroup = document.createElementNS(svgNS, "g");
  const textGroup = document.createElementNS(svgNS, "g");
  svg.appendChild(linesGroup);
  svg.appendChild(circlesGroup);
  svg.appendChild(textGroup);

  function drawNode(node, x, y, level, parentCoords = null) {
    const nodeRadius = 20;
    const verticalSpacing = 80;
    const horizontalSpacing = 120;

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

    // Draw children
    const children = node.getChildren();
    const totalWidth = (children.length - 1) * horizontalSpacing;
    children.forEach((child, i) => {
      const childX = x - totalWidth / 2 + i * horizontalSpacing;
      const childY = y + verticalSpacing;
      drawNode(child, childX, childY, level + 1, { x, y });
    });
  }

  drawNode(tree.root, 400, 50, 0);

  return svg;
}
