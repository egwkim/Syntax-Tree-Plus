// Pure, DOM-free helpers for the text pane's bracket handling and syntax
// highlighting. Kept side-effect-free so they can be unit-tested without a
// browser and reused by the controller in app.ts.
/**
 * Match every balanced `[`…`]` pair in `text`. Returns a map keyed by *both*
 * indices of each pair (open->close and close->open) so a lookup from either
 * bracket is O(1). Unmatched brackets simply don't appear in the map.
 *
 * Brackets inside a `"…"` string are literal label text, not structure, so they
 * are skipped — the same rule the parser's tokenizer applies.
 */
export function matchBrackets(text) {
    const matchOf = new Map();
    const stack = [];
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
            continue;
        }
        if (inQuotes)
            continue;
        if (ch === "[")
            stack.push(i);
        else if (ch === "]") {
            const open = stack.pop();
            if (open !== undefined) {
                matchOf.set(open, i);
                matchOf.set(i, open);
            }
        }
    }
    return matchOf;
}
/**
 * The bracket pair to highlight for a collapsed caret, VS Code style: the
 * bracket immediately to the left of the caret wins, else the one to the
 * right. Returns null when the caret isn't adjacent to a matched bracket.
 */
export function bracketPairAtCaret(text, caret, matchOf) {
    for (const i of [caret - 1, caret]) {
        if (i < 0 || i >= text.length)
            continue;
        const ch = text[i];
        if (ch !== "[" && ch !== "]")
            continue;
        const m = matchOf.get(i);
        if (m === undefined)
            continue;
        return { open: Math.min(i, m), close: Math.max(i, m) };
    }
    return null;
}
/** The matching `[` index for the `]` at `closeIdx`, or -1 if unmatched. */
export function matchingOpen(matchOf, closeIdx) {
    const o = matchOf.get(closeIdx);
    return o !== undefined && o < closeIdx ? o : -1;
}
function escapeChar(ch) {
    if (ch === "&")
        return "&amp;";
    if (ch === "<")
        return "&lt;";
    if (ch === ">")
        return "&gt;";
    return ch;
}
/**
 * HTML for the highlight mirror: `text` escaped verbatim, with the two
 * brackets of `highlight` (if any) wrapped in `<span class="bracket-match">`.
 * Only `color`/`background`-type styling may be applied to that span — it must
 * not change glyph metrics or it will drift from the textarea on top.
 *
 * A trailing space is appended when the text ends in a newline so the mirror
 * keeps the final (empty) line's height, matching the textarea.
 */
export function buildHighlightHTML(text, highlight) {
    let out = "";
    for (let i = 0; i < text.length; i++) {
        const esc = escapeChar(text[i]);
        if (highlight && (i === highlight.open || i === highlight.close)) {
            out += `<span class="bracket-match">${esc}</span>`;
        }
        else {
            out += esc;
        }
    }
    if (text.endsWith("\n"))
        out += " ";
    return out;
}
/**
 * Diff two strings into the single contiguous range that changed, by stripping
 * the common prefix and suffix. Exact for the edits a textarea produces
 * (typing, deletion, paste, our programmatic splices) which are always one
 * contiguous replacement.
 */
export function diffRange(oldStr, newStr) {
    const oldLen = oldStr.length;
    const newLen = newStr.length;
    const max = Math.min(oldLen, newLen);
    let start = 0;
    while (start < max && oldStr[start] === newStr[start])
        start++;
    let end = 0;
    while (end < max - start &&
        oldStr[oldLen - 1 - end] === newStr[newLen - 1 - end]) {
        end++;
    }
    return { start, oldEnd: oldLen - end, newEnd: newLen - end };
}
/**
 * Map a tracked index across an edit. Indices before the change are stable,
 * indices after it shift by the length delta, and an index that fell *inside*
 * the replaced range is invalidated (returns -1).
 */
export function adjustIndex(idx, d) {
    if (idx < d.start)
        return idx;
    if (idx >= d.oldEnd)
        return idx + (d.newEnd - d.oldEnd);
    return -1;
}
