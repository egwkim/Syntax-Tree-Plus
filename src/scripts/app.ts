import { Tree, Node } from "./tree.js";
import { render } from "./render.js";
import { settings } from "./settings.js";
import {
    editSelectedLabel,
    deleteSelectedNode,
    cloneNodeSubtree,
} from "./edit.js";

export function startApp() {
  const tree = new Tree();
  tree.root.updateLabel("XP");
  const child1 = new Node("XP", tree.root);
  const child2 = new Node("XP", tree.root);
  const grandchild1 = new Node("XP", child1);
  const grandchild2 = new Node("XP", child1);
  const grandchild4 = new Node("XP", child2);

  const navigationHistory: number[] = [];
  let clipboardNode: Node | null = null;

  window.addEventListener("keydown", function (e: KeyboardEvent) {
    if (!tree.selectedNode) return;
    let node = tree.selectedNode;
    if (e.key === "ArrowUp") {
      if (node.parent) {
        const idx = node.parent.children.indexOf(node);
        navigationHistory.push(idx);
        tree.selectedNode = node.parent;
        render(tree);
      }
    } else if (e.key === "ArrowDown") {
      if (node.children && node.children.length > 0) {
        let idx = 0;
        if (navigationHistory.length > 0) {
          idx = navigationHistory.pop()!;
          if (idx >= node.children.length) idx = 0;
        }
        tree.selectedNode = node.children[idx];
        render(tree);
      }
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      if (node.parent) {
        const siblings = node.parent.children;
        const idx = siblings.indexOf(node);
        if (e.key === "ArrowLeft" && idx > 0) {
          tree.selectedNode = siblings[idx - 1];
          navigationHistory.length = 0;
          render(tree);
        } else if (e.key === "ArrowRight" && idx < siblings.length - 1) {
          tree.selectedNode = siblings[idx + 1];
          navigationHistory.length = 0;
          render(tree);
        }
      }
    } else if (e.key === "n") {
      const newNode = new Node("", node);
      if (node.children.length >= 2) {
        tree.selectedNode = node.children[0];
      }
      render(tree);
    } else if (e.key === "e") {
      editSelectedLabel(tree);
      render(tree);
    } else if (e.key === "Delete" || e.key === "Backspace" || e.key === "d") {
      deleteSelectedNode(tree);
      render(tree);
    } else if (e.key === "x") {
      if (node && node.parent) {
        clipboardNode = node;
        node.parent.removeChild(node);
        tree.selectedNode = node.parent;
        render(tree);
      }
    } else if (e.key === "c") {
      if (node) {
        clipboardNode = cloneNodeSubtree(node);
      }
    } else if (e.key === "v") {
      if (clipboardNode && node && node.parent) {
        const parent = node.parent;
        const idx = parent.children.indexOf(node);
        parent.removeChild(node);
        const pasted = cloneNodeSubtree(clipboardNode);
        parent.insertChild(pasted, idx);
        tree.selectedNode = pasted;
        render(tree);
      }
    } else if (e.key === "r") {
      if (node.parent) {
        node.parent.children.reverse();
        render(tree);
      }
    }
  });

  render(tree);

  // Re-render tree on window resize
  window.addEventListener("resize", () => {
    render(tree);
  });
}
