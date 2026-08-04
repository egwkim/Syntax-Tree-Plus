/**
 * Undo/redo history over document snapshots (bracket-notation strings).
 * Keeping snapshots as plain strings makes undo trivially correct — every
 * mutation, whether from the GUI or the text pane, produces one snapshot.
 */
export class History {
    constructor(limit = 200) {
        this.past = [];
        this.future = [];
        this.current = null;
        this.limit = limit;
    }
    /** Record a new state. No-op if identical to the current state. */
    push(state) {
        if (state === this.current)
            return;
        if (this.current !== null) {
            this.past.push(this.current);
            if (this.past.length > this.limit)
                this.past.shift();
        }
        this.current = state;
        this.future = [];
    }
    canUndo() {
        return this.past.length > 0;
    }
    canRedo() {
        return this.future.length > 0;
    }
    undo() {
        if (this.past.length === 0)
            return null;
        const prev = this.past.pop();
        if (this.current !== null)
            this.future.push(this.current);
        this.current = prev;
        return prev;
    }
    redo() {
        if (this.future.length === 0)
            return null;
        const next = this.future.pop();
        if (this.current !== null)
            this.past.push(this.current);
        this.current = next;
        return next;
    }
}
