import { Tree, Node } from "./tree.js";
import { settings } from "./settings.js";

/**
 * Renders a tree as an SVG element.
 * @param tree - The tree object to render.
 * @param onNodeClick - Callback function to handle node click events.
 * @returns The SVG element representing the tree.
 */
function renderTreeToSVG(
  tree: Tree,
  onNodeClick: (node: Node, x: number, y: number) => void
): SVGSVGElement {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.style.width = "100vw";
  svg.style.height = "100vh";
  svg.style.display = "block";

  const nodeHeight = settings.node.height;
  const nodeRadius = settings.node.radius;
  const horizontalSpacing = settings.node.horizontalSpacing;
  const verticalSpacing = settings.node.verticalSpacing;

  tree.calculateWidths();

  // Create groups for layering
  const linesGroup = document.createElementNS(svgNS, "g");
  const rectanglesGroup = document.createElementNS(svgNS, "g");
  const textGroup = document.createElementNS(svgNS, "g");  svg.appendChild(linesGroup);
  svg.appendChild(rectanglesGroup);
  svg.appendChild(textGroup);

  // Center the root node in the viewport
  const defaultOffsetX = window.innerWidth / 2;
  const defaultOffsetY = 50;
  function renderSubtree(node: Node, x: number, y: number) {
    // Render children first
    if (node.children.length > 0) {
      // Calculate total width needed for all children (using their width property for spacing)
      let totalChildrenWidth = 0;
      node.children.forEach((child: Node, index: number) => {
        totalChildrenWidth += child.width;
        if (index < node.children.length - 1) {
          totalChildrenWidth += horizontalSpacing;
        }
      });

      // Position children centered under the parent
      let childX = x - totalChildrenWidth / 2;
      const childY = y + verticalSpacing;

      // Recursively render each child and draw connecting lines
      node.children.forEach((child: Node) => {
        // Position child at center of its allocated width
        const childCenterX = childX + child.width / 2;
        
        // Recursively render the child subtree
        renderSubtree(child, childCenterX, childY);
        
        // Draw line from parent to child
        const line = document.createElementNS(svgNS, "line");
        line.setAttribute("x1", x.toString());
        line.setAttribute("y1", (y + nodeHeight / 2).toString());
        line.setAttribute("x2", childCenterX.toString());
        line.setAttribute("y2", (childY - nodeHeight / 2).toString());
        line.setAttribute("stroke", settings.edge.color);
        line.setAttribute("stroke-width", settings.edge.width.toString());
        linesGroup.appendChild(line);
        
        // Move to next child position (using child.width for spacing)
        childX += child.width + horizontalSpacing;
      });
    }

    // Draw the current node after its children
    drawNode(node, x, y);
  }
  // Helper function to draw a single node
  function drawNode(node: Node, x: number, y: number) {
    // Use textWidth for rectangle size, with padding from settings
    const nodeWidth = Math.max(node.textWidth + settings.node.padding * 2, settings.node.minWidth);

    // Draw rectangle
    const rect = document.createElementNS(svgNS, "rect");
    rect.setAttribute("x", (x - nodeWidth / 2).toString());
    rect.setAttribute("y", (y - nodeHeight / 2).toString());
    rect.setAttribute("width", nodeWidth.toString());
    rect.setAttribute("height", nodeHeight.toString());
    rect.setAttribute("rx", nodeRadius.toString());
    rect.setAttribute("ry", nodeRadius.toString());
    rect.setAttribute("fill", tree.selectedNode === node ? "#cce6ff" : "#fff");
    rect.setAttribute("stroke", "#ddd");
    rect.setAttribute("stroke-width", "1");
    rect.style.cursor = "pointer";
    rect.addEventListener("click", (e) => {
      e.stopPropagation();
      onNodeClick(node, x, y);
    });
    rectanglesGroup.appendChild(rect);

    // Draw text label
    const text = document.createElementNS(svgNS, "text");
    text.setAttribute("x", x.toString());
    text.setAttribute("y", (y + 5).toString());
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("font-size", settings.label.fontSize.toString());
    text.setAttribute("font-family", settings.label.fontFamily);
    text.setAttribute("fill", settings.label.color);
    text.textContent = node.label;
    text.style.cursor = "pointer";
    text.addEventListener("click", (e) => {
      e.stopPropagation();
      onNodeClick(node, x, y);
    });
    textGroup.appendChild(text);
  }

  // Start rendering from the root
  renderSubtree(tree.root, defaultOffsetX, defaultOffsetY);

  return svg;
}

export function render(tree: Tree) {
  const container = document.getElementById("tree-container")!;
  container.innerHTML = "";
  const svg = renderTreeToSVG(tree, (node: Node, x: number, y: number) => {
    tree.selectedNode = node;
    render(tree);
  });
  container.appendChild(svg);
}
