/**
 * Multiple named documents ("tabs"). Researchers routinely juggle a set of
 * sentences; each tab is one bracket-notation document with a display name.
 *
 * This is a pure model — no DOM, no persistence, no undo history. The
 * controller owns the live `Tree` and a per-tab `History`; the workspace just
 * tracks the ordered list of documents (id / name / text) and which is active.
 * Serialization to/from a plain object (for `persist.ts`) lives here too.
 */

export interface TabData {
  id: string;
  name: string;
  text: string; // bracket notation
}

export interface StoredWorkspace {
  tabs: TabData[];
  activeId: string;
}

let seq = 0;

export class Workspace {
  tabs: TabData[] = [];
  activeId = "";

  private makeId(): string {
    seq += 1;
    return "t" + Date.now().toString(36) + "-" + seq.toString(36);
  }

  get active(): TabData {
    return this.tabs.find((t) => t.id === this.activeId) ?? this.tabs[0];
  }

  /** Append a tab (auto-named if no name given) and make it active. */
  add(text: string, name?: string): TabData {
    const tab: TabData = {
      id: this.makeId(),
      name: name?.trim() || this.uniqueName(),
      text,
    };
    this.tabs.push(tab);
    this.activeId = tab.id;
    return tab;
  }

  /** A default "Tree N" name not already in use. */
  private uniqueName(): string {
    for (let i = this.tabs.length + 1; ; i++) {
      const name = "Tree " + i;
      if (!this.tabs.some((t) => t.name === name)) return name;
    }
  }

  /**
   * Remove a tab. Never leaves the workspace empty (the last tab can't be
   * closed). Returns the now-active tab so the caller can load it, or null if
   * the close was refused. If the closed tab was active, focus shifts to its
   * neighbour.
   */
  remove(id: string): TabData | null {
    if (this.tabs.length <= 1) return null;
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx < 0) return null;
    const wasActive = this.tabs[idx].id === this.activeId;
    this.tabs.splice(idx, 1);
    if (wasActive) {
      const next = this.tabs[Math.min(idx, this.tabs.length - 1)];
      this.activeId = next.id;
    }
    return this.active;
  }

  rename(id: string, name: string): boolean {
    const tab = this.tabs.find((t) => t.id === id);
    const trimmed = name.trim();
    if (!tab || !trimmed) return false;
    tab.name = trimmed;
    return true;
  }

  setActive(id: string): boolean {
    if (!this.tabs.some((t) => t.id === id)) return false;
    this.activeId = id;
    return true;
  }

  /** Update the active tab's text (called after every edit). */
  setActiveText(text: string) {
    const a = this.active;
    if (a) a.text = text;
  }

  toStored(): StoredWorkspace {
    return { tabs: this.tabs.map((t) => ({ ...t })), activeId: this.activeId };
  }

  static fromStored(data: StoredWorkspace): Workspace | null {
    if (!data || !Array.isArray(data.tabs) || data.tabs.length === 0) return null;
    const ws = new Workspace();
    for (const t of data.tabs) {
      if (typeof t?.text !== "string") continue;
      ws.tabs.push({
        id: typeof t.id === "string" && t.id ? t.id : ws.makeId(),
        name: typeof t.name === "string" && t.name ? t.name : ws.uniqueName(),
        text: t.text,
      });
    }
    if (ws.tabs.length === 0) return null;
    ws.activeId =
      typeof data.activeId === "string" &&
      ws.tabs.some((t) => t.id === data.activeId)
        ? data.activeId
        : ws.tabs[0].id;
    return ws;
  }

  static single(text: string, name = "Tree 1"): Workspace {
    const ws = new Workspace();
    ws.add(text, name);
    return ws;
  }
}
