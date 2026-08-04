/**
 * Compact (mobile) toolbar.
 *
 * The full toolbar is ~35 buttons; on a desktop row that's fine, but on a phone
 * it wraps into six or seven rows and eats half the screen — leaving almost no
 * canvas for the tree it's meant to edit.
 *
 * Under `COMPACT_QUERY` the groups collapse behind a horizontally scrollable
 * strip of **category chips**: one chip per `.group[data-cat]`, tapping a chip
 * reveals just that group's buttons on their own row, and tapping the open chip
 * again hides the row entirely (toolbar down to two thin rows). Groups marked
 * `.quick` (undo/redo, settings/help) stay visible in both layouts.
 *
 * Two deliberate constraints:
 *
 * - **The chips are built from the groups**, not from a parallel list, so the
 *   two layouts can't drift: adding a `.group[data-cat]` to the markup is all a
 *   new category needs.
 * - **Nothing moves in the DOM** — only visibility (a class) changes. The
 *   buttons stay where `app.ts` put them, so its single delegated
 *   `data-action` handler, `updateHistoryButtons()`, and the `.active`
 *   toggles on Move/Arrow keep working untouched.
 */
import { loadToolbarCat, saveToolbarCat } from "./persist.js";
/**
 * Narrow screens (the pane-stacking breakpoint in styles.css) — plus short
 * touch screens, which is a phone held in landscape: 850px wide but under
 * 400px tall, where a wrapped toolbar costs even more than in portrait. The
 * height clause is gated on a coarse pointer so a merely short desktop window
 * keeps the full toolbar.
 */
const COMPACT_QUERY = "(max-width: 760px), (max-height: 520px) and (pointer: coarse)";
export function setupCompactToolbar() {
    const toolbar = document.getElementById("toolbar");
    const cats = document.getElementById("toolbar-cats");
    if (!toolbar || !cats)
        return;
    const groups = Array.from(toolbar.querySelectorAll(".group[data-cat]"));
    if (groups.length === 0)
        return;
    const idOf = (g) => g.dataset.cat;
    const labelOf = (g) => g.dataset.catLabel || idOf(g);
    // Restore the last open category. "" is a real value — the user collapsed the
    // row — and must survive a reload; null means nothing was ever stored, so the
    // first category opens to keep the strip discoverable.
    const stored = loadToolbarCat();
    let active = stored === null ? idOf(groups[0]) : stored || null;
    if (active !== null && !groups.some((g) => idOf(g) === active)) {
        active = idOf(groups[0]);
    }
    for (const g of groups) {
        if (!g.id)
            g.id = "tb-group-" + idOf(g);
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "cat";
        chip.dataset.cat = idOf(g);
        chip.title = labelOf(g);
        chip.setAttribute("aria-controls", g.id);
        const icon = document.createElement("span");
        icon.className = "cat-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = g.dataset.catIcon || "";
        const label = document.createElement("span");
        label.className = "cat-label";
        label.textContent = labelOf(g);
        chip.append(icon, label);
        cats.appendChild(chip);
    }
    function apply() {
        for (const g of groups)
            g.classList.toggle("cat-active", idOf(g) === active);
        for (const chip of cats.querySelectorAll(".cat")) {
            chip.setAttribute("aria-expanded", String(chip.dataset.cat === active));
        }
    }
    cats.addEventListener("click", (e) => {
        const chip = e.target.closest(".cat");
        if (!chip)
            return;
        const id = chip.dataset.cat;
        // Tapping the open category closes it — that's how the toolbar gets out of
        // the way completely when the user just wants to look at the tree.
        active = active === id ? null : id;
        saveToolbarCat(active ?? "");
        apply();
        if (active)
            chip.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    // The layout itself is CSS (`body.compact-toolbar`); JS owns the switch so
    // the class and the chip state can never disagree about which mode is on.
    const mq = window.matchMedia(COMPACT_QUERY);
    const sync = () => document.body.classList.toggle("compact-toolbar", mq.matches);
    if (mq.addEventListener)
        mq.addEventListener("change", sync);
    else
        mq.addListener(sync); // older WebKit
    sync();
    apply();
}
