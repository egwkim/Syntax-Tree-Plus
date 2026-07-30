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

export function svgString(trees: Tree[]): {
  xml: string;
  width: number;
  height: number;
} {
  return withExportColors(() => {
    const svg = buildSVG(trees, { interactive: false, showSelection: false });
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

export type { ExportFormat } from "./settings.js";

/** One file the export dialog is about to hand to the browser. */
export interface ExportFile {
  blob: Blob;
  filename: string;
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

/**
 * Rasterize the document's SVG to a PNG blob (shared by download and clipboard
 * copy). `transparent` skips the white backdrop, leaving the canvas alpha
 * intact for figures that sit on a colored background.
 */
function renderPNGBlob(
  trees: Tree[],
  scale = 1,
  transparent = false,
): Promise<Blob> {
  const { xml, width, height } = svgString(trees);
  return new Promise((resolve, reject) => {
    const img = new Image();
    const svgUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(width * scale);
      canvas.height = Math.ceil(height * scale);
      const ctx = canvas.getContext("2d")!;
      if (!transparent) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
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

/**
 * Strip what a filesystem won't take from a tab name. Tabs are named freely,
 * but the name becomes a download filename, so path separators and the
 * characters Windows reserves have to go.
 */
function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  return cleaned || "syntax-tree";
}

/**
 * Turn tab names into distinct filenames. Nothing stops two tabs sharing a
 * name, but two downloads that share one overwrite each other (or get numbered
 * by the browser, which isn't the user's choice), so repeats are numbered from
 * the second occurrence on: `tree.png`, `tree(2).png`, `tree(3).png`.
 */
export function uniqueFilenames(names: string[], ext: string): string[] {
  const used = new Map<string, number>();
  return names.map((raw) => {
    const base = sanitizeFilename(raw);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return (n === 1 ? base : `${base}(${n})`) + "." + ext;
  });
}

/** Build one tab's PNG. */
export async function pngFile(
  trees: Tree[],
  filename: string,
  scale = 1,
  transparent = false,
): Promise<ExportFile> {
  return { blob: await renderPNGBlob(trees, scale, transparent), filename };
}

/** Build one tab's SVG. Vector output, so there is no scale to apply. */
export function svgFile(trees: Tree[], filename: string): ExportFile {
  const { xml } = svgString(trees);
  return { blob: new Blob([xml], { type: "image/svg+xml" }), filename };
}

/** Build one `.tex` from whatever trees it's handed (one tab, or all of them). */
export function latexFile(trees: Tree[], filename: string): ExportFile {
  return {
    blob: new Blob([toForest(trees)], { type: "text/plain" }),
    filename,
  };
}

/**
 * Save every file, spaced out. Browsers throttle — and Chrome outright blocks —
 * downloads fired back-to-back from one gesture, so a multi-tab export has to
 * pace itself or silently lose files after the first few.
 */
export async function downloadFiles(files: ExportFile[]): Promise<void> {
  for (let i = 0; i < files.length; i++) {
    if (i > 0) {
      await new Promise((r) => setTimeout(r, 250));
    }
    triggerDownload(files[i].blob, files[i].filename);
  }
}

/**
 * Whether this browser can accept an image on the system clipboard at all
 * (`ClipboardItem` is still missing in some browsers/insecure contexts). The
 * export dialog checks this up front so it can grey the button out with an
 * explanation instead of letting the user hit a rejected promise.
 */
export function clipboardImageSupported(): boolean {
  return !!(navigator.clipboard && typeof ClipboardItem !== "undefined");
}

/** Whether this browser can put plain text on the system clipboard. */
export function clipboardTextSupported(): boolean {
  return !!(navigator.clipboard && typeof navigator.clipboard.writeText === "function");
}

function requireClipboardImage() {
  if (!clipboardImageSupported()) {
    throw new Error("Clipboard image copy isn't supported in this browser.");
  }
}

/**
 * Copy the tree(s) as a raster image to the system clipboard, so they can be
 * pasted straight into a document or chat without a download step.
 */
export async function copyPNG(
  trees: Tree[],
  scale = 1,
  transparent = false,
): Promise<void> {
  requireClipboardImage();
  const blob = await renderPNGBlob(trees, scale, transparent);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

/**
 * Copy the tree(s) as an *image* rather than as markup: the vector goes on the
 * clipboard with a raster alongside it, so an app that understands SVG keeps
 * the figure scalable and everything else still gets a picture.
 *
 * Browsers disagree about which MIME types `write` accepts, and one unsupported
 * type rejects the whole item — hence the PNG-only retry.
 */
export async function copySVGImage(trees: Tree[]): Promise<void> {
  requireClipboardImage();
  const { xml } = svgString(trees);
  const svg = new Blob([xml], { type: "image/svg+xml" });
  const png = await renderPNGBlob(trees, 1, false);
  try {
    await navigator.clipboard.write([
      new ClipboardItem({ "image/svg+xml": svg, "image/png": png }),
    ]);
  } catch {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
  }
}

/**
 * Copy the raw SVG markup as text — one `<svg>` per tab, blank-line separated.
 * Unlike the image copy this has an obvious multi-tab answer (concatenated
 * text, the same call `copyLaTeX` makes), so the dialog allows it regardless
 * of how many tabs are selected.
 */
export async function copySVGMarkup(perTab: Tree[][]): Promise<void> {
  if (!clipboardTextSupported()) {
    throw new Error("Clipboard access isn't available in this browser.");
  }
  const combined = perTab.map((trees) => svgString(trees).xml).join("\n\n");
  await navigator.clipboard.writeText(combined);
}

/**
 * Escape text for LaTeX. Backslashes are swapped for a placeholder first so
 * the `\` inserted by the other replacements (e.g. `_` -> `\_`) isn't itself
 * re-escaped; `[`/`]` are brace-wrapped rather than escaped since `forest`
 * reads bare brackets as tree structure, not glyphs.
 */
const BACKSLASH_PLACEHOLDER = "\u0000";

function texEscape(s: string): string {
  return s
    .replace(/\\/g, BACKSLASH_PLACEHOLDER)
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde ")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/\[/g, "{[}")
    .replace(/\]/g, "{]}")
    .replace(new RegExp(BACKSLASH_PLACEHOLDER, "g"), "\\textbackslash{}");
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

/** Generate LaTeX code for the `forest` package (one tree). */
function treeToForest(tree: Tree): string {
  // Refresh auto-subscripts so the export matches the rendered tree even if
  // LaTeX is generated without a preceding on-screen render.
  applyAutoSubscripts(tree, settings.autoSubscript);
  const build = (node: Node, depth: number): string => {
    const indent = "  ".repeat(depth + 1);
    if (node.isLeaf) {
      // Mirror the on-screen italics: a word is a lexical item, a childless
      // node is a category label and stays upright.
      const base = texEscape(node.label);
      const content =
        (node.isWord && !node.triangle ? `\\textit{${base}}` : base) +
        scriptSuffix(node);
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

/**
 * Generate LaTeX for the `forest` package. Each tree of the document becomes
 * its own `forest` environment (the package has no notion of several trees in
 * one), separated by a blank line so they're independent floats/paragraphs in
 * the surrounding document.
 */
export function toForest(trees: Tree[]): string {
  return trees.map(treeToForest).join("\n\n");
}

/** Copy the `forest` LaTeX source to the clipboard (no download step). */
export async function copyLaTeX(trees: Tree[]): Promise<void> {
  if (!clipboardTextSupported()) {
    throw new Error("Clipboard access isn't available in this browser.");
  }
  await navigator.clipboard.writeText(toForest(trees));
}
