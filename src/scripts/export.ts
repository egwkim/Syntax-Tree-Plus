import { Tree, Node } from "./tree.js";
import { buildSVG } from "./render.js";
import { settings, applyThemeColors } from "./settings.js";
import { applyAutoSubscripts } from "./edit.js";

/**
 * Build the tree with the light palette whatever the UI theme is, then restore.
 *
 * Exports leave the app's dark background behind: the PNG rasterizer fills a
 * white canvas, and an exported SVG is normally dropped into a white document.
 * Dark-theme text (light grey) on either is effectively invisible, so the
 * export is always drawn in the colors that read on white. Per-node `color`
 * overrides are the user's explicit choice and are left untouched.
 */
function withExportColors<T>(fn: () => T): T {
  const saved = {
    label: settings.label.color,
    edge: settings.edge.color,
    triangle: settings.triangle.color,
  };
  applyThemeColors("light");
  try {
    return fn();
  } finally {
    settings.label.color = saved.label;
    settings.edge.color = saved.edge;
    settings.triangle.color = saved.triangle;
  }
}

export function svgString(tree: Tree): {
  xml: string;
  width: number;
  height: number;
} {
  return withExportColors(() => {
    const svg = buildSVG(tree, { interactive: false, showSelection: false });
    const width = parseFloat(svg.getAttribute("width") || "800");
    const height = parseFloat(svg.getAttribute("height") || "600");
    const serializer = new XMLSerializer();
    const xml = serializer.serializeToString(svg);
    return {
      xml: '<?xml version="1.0" encoding="UTF-8"?>\n' + xml,
      width,
      height,
    };
  });
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

/** Rasterize the tree's SVG to a PNG blob (shared by download and clipboard copy). */
function renderPNGBlob(tree: Tree, scale = 2): Promise<Blob> {
  const { xml, width, height } = svgString(tree);
  return new Promise((resolve, reject) => {
    const img = new Image();
    const svgUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
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
        if (blob) resolve(blob);
        else reject(new Error("Canvas rasterization failed"));
      }, "image/png");
    };
    img.onerror = () => reject(new Error("Failed to rasterize SVG"));
    img.src = svgUrl;
  });
}

export function exportSVG(tree: Tree, filename = "syntax-tree.svg") {
  const { xml } = svgString(tree);
  triggerDownload(new Blob([xml], { type: "image/svg+xml" }), filename);
}

export function exportPNG(tree: Tree, filename = "syntax-tree.png", scale = 2) {
  renderPNGBlob(tree, scale)
    .then((blob) => triggerDownload(blob, filename))
    .catch(() => alert("PNG export failed while rasterizing the SVG."));
}

/**
 * Copy the tree as a raster image to the system clipboard (PNG is the one
 * image MIME type browsers reliably accept for `ClipboardItem`), so it can be
 * pasted directly into documents/chat without a download step.
 */
export async function copyImagePNG(tree: Tree, scale = 2): Promise<void> {
  if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
    throw new Error("Clipboard image copy isn't supported in this browser.");
  }
  const blob = await renderPNGBlob(tree, scale);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

/** Copy the tree's raw SVG markup to the clipboard as text. */
export async function copySVGMarkup(tree: Tree): Promise<void> {
  if (!navigator.clipboard) {
    throw new Error("Clipboard access isn't available in this browser.");
  }
  const { xml } = svgString(tree);
  await navigator.clipboard.writeText(xml);
}

/** Escape text for LaTeX. */
function texEscape(s: string): string {
  return s.replace(/([&%$#_{}])/g, "\\$1").replace(/~/g, "\\textasciitilde ");
}

function scriptSuffix(node: Node): string {
  // Mirror what's drawn on screen, including an auto-subscript when that
  // display option is on (`toForest` refreshes it before building).
  const sub = node.displaySubscript();
  if (!sub && !node.superscript) return "";
  let s = "$";
  if (node.superscript) s += "^{" + texEscape(node.superscript) + "}";
  if (sub) s += "_{" + texEscape(sub) + "}";
  return s + "$";
}

/** Generate LaTeX code for the `forest` package. */
export function toForest(tree: Tree): string {
  // Refresh auto-subscripts so the export matches the rendered tree even if
  // LaTeX is generated without a preceding on-screen render.
  applyAutoSubscripts(tree, settings.autoSubscript);
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

/** Copy the `forest` LaTeX source to the clipboard (no download step). */
export async function copyLaTeX(tree: Tree): Promise<void> {
  if (!navigator.clipboard) {
    throw new Error("Clipboard access isn't available in this browser.");
  }
  await navigator.clipboard.writeText(toForest(tree));
}
