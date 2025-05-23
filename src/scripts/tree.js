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

  addChild(child) {
    this.children.push(child);
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
