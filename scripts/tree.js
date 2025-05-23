class Tree {
  constructor() {
    this.root = new Node("Root");
    this.selectedNode = null;
  }
}

class Node {
  constructor(label, parent = null) {
    this.label = label;
    this.children = [];
    if (parent) {
      parent.addChild(this);
    }
  }

  addChild(child, idx = -1) {
    if (idx === -1) {
      this.children.push(child);
    } else {
      this.children.splice(idx, 0, child);
    }
    child.parent = this;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index > -1) {
      this.children.splice(index, 1);
    }
  }

  getChildren() {
    return this.children;
  }
}
