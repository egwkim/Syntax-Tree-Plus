/**
 * Multiple named documents ("tabs"). Researchers routinely juggle a set of
 * sentences; each tab is one bracket-notation document with a display name.
 *
 * This is a pure model — no DOM, no persistence, no undo history. The
 * controller owns the live `Tree` and a per-tab `History`; the workspace just
 * tracks the ordered list of documents (id / name / text) and which is active.
 * Serialization to/from a plain object (for `persist.ts`) lives here too.
 *
 * Reopening a closed tab is deliberately *not* modelled here: restoring one
 * needs its undo history too, which only the controller has, so `remove`
 * reports what it removed and from where and lets the controller hold the
 * closed-tab stack (see `app.ts`).
 */
let seq = 0;
export class Workspace {
    constructor() {
        this.tabs = [];
        this.activeId = "";
    }
    makeId() {
        seq += 1;
        return "t" + Date.now().toString(36) + "-" + seq.toString(36);
    }
    get active() {
        return this.tabs.find((t) => t.id === this.activeId) ?? this.tabs[0];
    }
    indexOf(id) {
        return this.tabs.findIndex((t) => t.id === id);
    }
    /** Append a tab (auto-named if no name given) and make it active. */
    add(text, name) {
        const tab = {
            id: this.makeId(),
            name: this.uniqueName(name?.trim() || undefined),
            text,
        };
        this.tabs.push(tab);
        this.activeId = tab.id;
        return tab;
    }
    /**
     * Put an existing tab back at `index` (clamped) and make it active — the
     * counterpart of `remove`, used to reopen a closed tab with its identity
     * intact, so the controller's history map still finds its undo stack.
     */
    insert(tab, index) {
        const at = Math.max(0, Math.min(index, this.tabs.length));
        this.tabs.splice(at, 0, tab);
        this.activeId = tab.id;
        return tab;
    }
    /**
     * Copy a tab (text, draft and all) in right after the original, and make the
     * copy active. A copy is a *new* document — new id, so it gets its own undo
     * history rather than sharing the original's.
     */
    duplicate(id) {
        const idx = this.indexOf(id);
        if (idx < 0)
            return null;
        const src = this.tabs[idx];
        const copy = {
            id: this.makeId(),
            name: this.uniqueName(src.name + " (copy)"),
            text: src.text,
        };
        if (src.draft !== undefined)
            copy.draft = src.draft;
        return this.insert(copy, idx + 1);
    }
    /** Move a tab to `to` (clamped). Returns false if nothing moved. */
    move(id, to) {
        const from = this.indexOf(id);
        if (from < 0)
            return false;
        const target = Math.max(0, Math.min(to, this.tabs.length - 1));
        if (target === from)
            return false;
        const [tab] = this.tabs.splice(from, 1);
        this.tabs.splice(target, 0, tab);
        return true;
    }
    /**
     * A name not already in use. Without a base this is the next free "Tree N";
     * with one (a duplicate, an incoming shared document) the base is used as-is
     * when it's free, and numbered otherwise.
     */
    uniqueName(base) {
        const taken = (n) => this.tabs.some((t) => t.name === n);
        if (base && !taken(base))
            return base;
        const stem = base || "Tree";
        for (let i = this.tabs.length + 1;; i++) {
            const name = stem + " " + i;
            if (!taken(name))
                return name;
        }
    }
    /**
     * Remove a tab. Never leaves the workspace empty (the last tab can't be
     * closed). Returns the removed tab and the index it sat at — enough for the
     * controller to put it back — or null if the close was refused. If the closed
     * tab was active, focus shifts to its neighbour.
     */
    remove(id) {
        if (this.tabs.length <= 1)
            return null;
        const idx = this.indexOf(id);
        if (idx < 0)
            return null;
        const wasActive = this.tabs[idx].id === this.activeId;
        const [tab] = this.tabs.splice(idx, 1);
        if (wasActive) {
            const next = this.tabs[Math.min(idx, this.tabs.length - 1)];
            this.activeId = next.id;
        }
        return { tab, index: idx };
    }
    rename(id, name) {
        const tab = this.tabs.find((t) => t.id === id);
        const trimmed = name.trim();
        if (!tab || !trimmed)
            return false;
        tab.name = trimmed;
        return true;
    }
    setActive(id) {
        if (!this.tabs.some((t) => t.id === id))
            return false;
        this.activeId = id;
        return true;
    }
    /**
     * Update the active tab's document (called after every edit that parses).
     * Good text supersedes any draft — the draft only exists to hold text the
     * parser rejected.
     */
    setActiveText(text) {
        const a = this.active;
        if (!a)
            return;
        a.text = text;
        delete a.draft;
    }
    /**
     * Park unparseable pane text on the active tab. Passing null (or text equal
     * to the document) clears the draft.
     */
    setActiveDraft(draft) {
        const a = this.active;
        if (!a)
            return;
        if (draft === null || draft === a.text)
            delete a.draft;
        else
            a.draft = draft;
    }
    toStored() {
        return { tabs: this.tabs.map((t) => ({ ...t })), activeId: this.activeId };
    }
    static fromStored(data) {
        if (!data || !Array.isArray(data.tabs) || data.tabs.length === 0)
            return null;
        const ws = new Workspace();
        for (const t of data.tabs) {
            if (typeof t?.text !== "string")
                continue;
            const tab = {
                id: typeof t.id === "string" && t.id ? t.id : ws.makeId(),
                name: typeof t.name === "string" && t.name ? t.name : ws.uniqueName(),
                text: t.text,
            };
            // A draft that matches the document is redundant; anything else is
            // ignored, so a corrupt blob can't put a non-string in the text pane.
            if (typeof t.draft === "string" && t.draft !== t.text)
                tab.draft = t.draft;
            ws.tabs.push(tab);
        }
        if (ws.tabs.length === 0)
            return null;
        ws.activeId =
            typeof data.activeId === "string" &&
                ws.tabs.some((t) => t.id === data.activeId)
                ? data.activeId
                : ws.tabs[0].id;
        return ws;
    }
    static single(text, name = "Tree 1") {
        const ws = new Workspace();
        ws.add(text, name);
        return ws;
    }
}
/**
 * Parse a 1-based tab range spec — `"1-3,5"` → `[0, 1, 2, 4]` — into zero-based
 * indices into the workspace's tab order.
 *
 * Pure and total: anything malformed or out of range returns `null` rather than
 * a partial list, so the export dialog refuses the range outright instead of
 * silently exporting a subset the user didn't ask for. Duplicates collapse and
 * the spec's own order is preserved, so `"3,1"` exports tab 3 then tab 1.
 */
export function parseTabSelection(spec, count) {
    if (spec.trim() === "")
        return null;
    const out = [];
    const seen = new Set();
    for (const raw of spec.split(",")) {
        const part = raw.trim();
        const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
        if (!m)
            return null;
        const start = Number(m[1]);
        const end = m[2] === undefined ? start : Number(m[2]);
        // A reversed range ("5-3") is a typo, not an instruction to count down.
        if (start > end)
            return null;
        if (start < 1 || end > count)
            return null;
        for (let i = start; i <= end; i++) {
            if (seen.has(i))
                continue;
            seen.add(i);
            out.push(i - 1);
        }
    }
    return out;
}
