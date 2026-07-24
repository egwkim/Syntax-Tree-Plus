import { Tree, Node } from "./tree.js";
import { buildSVG } from "./render.js";

function svgString(tree: Tree): { xml: string; width: number; height: number } {
  const svg = buildSVG(tree, { interactive: false });
  const width = parseFloat(svg.getAttribute("width") || "800");
  const height = parseFloat(svg.getAttribute("height") || "600");
  const serializer = new XMLSerializer();
  const xml = serializer.serializeToString(svg);
  return {
    xml: '<?xml version="1.0" encoding="UTF-8"?>\n' + xml,
    width,
    height,
  };
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportSVG(tree: Tree, filename = "syntax-tree.svg") {
  const { xml } = svgString(tree);
  triggerDownload(new Blob([xml], { type: "image/svg+xml" }), filename);
}

export function exportPNG(tree: Tree, filename = "syntax-tree.png", scale = 2) {
  const { xml, width, height } = svgString(tree);
  const img = new Image();
  const svgUrl =
    "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) triggerDownload(blob, filename);
    }, "image/png");
  };
  img.onerror = () => alert("PNG export failed while rasterizing the SVG.");
  img.src = svgUrl;
}

/** Escape text for LaTeX. */
function texEscape(s: string): string {
  return s.replace(/([&%$#_{}])/g, "\\$1").replace(/~/g, "\\textasciitilde ");
}

function scriptSuffix(node: Node): string {
  if (!node.subscript && !node.superscript) return "";
  let s = "$";
  if (node.superscript) s += "^{" + texEscape(node.superscript) + "}";
  if (node.subscript) s += "_{" + texEscape(node.subscript) + "}";
  return s + "$";
}

/** Generate LaTeX code for the `forest` package. */
export function toForest(tree: Tree): string {
  const build = (node: Node, depth: number): string => {
    const indent = "  ".repeat(depth + 1);
    if (node.isLeaf) {
      const content = texEscape(node.label) + scriptSuffix(node);
      return `${indent}[${content}${node.triangle ? ", roof" : ""}]`;
    }
    const label = texEscape(node.label) + scriptSuffix(node);
    const kids = node.children
      .map((c) => build(c, depth + 1))
      .join("\n");
    return `${indent}[${label}\n${kids}\n${indent}]`;
  };
  return (
    "\\begin{forest}\n" +
    build(tree.root, 0).replace(/^\s+/, "  ") +
    "\n\\end{forest}"
  );
}

export function exportLaTeX(tree: Tree, filename = "syntax-tree.tex") {
  const code = toForest(tree);
  triggerDownload(new Blob([code], { type: "text/plain" }), filename);
}
