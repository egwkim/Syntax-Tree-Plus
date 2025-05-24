export class Node {
  label: string;
  children: Node[];
  parent: Node | null;
  constructor(label: string, parent: Node | null = null) {
    this.label = label;
    this.children = [];
    this.parent = null;
    if (parent) {
      parent.addChild(this);
    }
  }

  addChild(child: Node, idx: number = -1) {
    if (idx === -1) {
      this.children.push(child);
    } else {
      this.children.splice(idx, 0, child);
    }
    child.parent = this;
  }

  removeChild(child: Node) {
    const index = this.children.indexOf(child);
    if (index > -1) {
      this.children.splice(index, 1);
      child.parent = null;
    }
  }

  getChildren(): Node[] {
    return this.children;
  }
}

export class Tree {
  root: Node;
  selectedNode: Node | null;
  constructor() {
    this.root = new Node("Root");
    this.selectedNode = null;
  }
}
