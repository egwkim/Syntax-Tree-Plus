import { settings } from "./settings.js";
const canvas = document.createElement("canvas");
const context = canvas.getContext("2d");
context.font = `${settings.label.fontSize}px ${settings.label.fontFamily}`;
export class Node {
    constructor(label, parent = null) {
        this.textWidth = NaN;
        this.width = NaN;
        this.depth = NaN;
        this.tree = null;
        this.updateLabel(label);
        this.children = [];
        this.parent = null;
        if (parent) {
            parent.insertChild(this);
        }
    }
    insertChild(child, idx = -1) {
        if (idx === -1) {
            this.children.push(child);
        }
        else {
            this.children.splice(idx, 0, child);
        }
        child.parent = this;
        child.depth = this.depth + 1;
        child.tree = this.tree || null;
        if (child.tree && child.tree.maxDepth < child.depth) {
            child.tree.maxDepth = child.depth;
        }
    }
    removeChild(child) {
        const index = this.children.indexOf(child);
        if (index > -1) {
            this.children.splice(index, 1);
            child.parent = null;
        }
    }
    updateLabel(newLabel) {
        this.label = newLabel;
        this.updateTextWidth();
    }
    updateTextWidth() {
        this.textWidth = Math.ceil(context.measureText(this.label).width);
        if (this.textWidth < settings.node.minWidth) {
            this.textWidth = settings.node.minWidth;
        }
        return this.textWidth;
    }
}
export class Tree {
    constructor() {
        this.maxDepth = 0;
        this.root = new Node("Root");
        this.root.depth = 0;
        this.selectedNode = null;
    }
    calculateWidths() {
        function calculateNodeWidth(node) {
            let childWidth = 0;
            node.children.forEach((child) => {
                childWidth += calculateNodeWidth(child);
            });
            childWidth +=
                settings.node.horizontalSpacing * (node.children.length - 1);
            node.width = Math.max(node.textWidth, childWidth);
            return node.width;
        }
        calculateNodeWidth(this.root);
    }
}
