// The editor's preview in step with the source: it follows the editor as that
// scrolls, and Ctrl+click in it finds the place in the source.
//
// The map is in the preview itself. Each top-level block carries the line it
// starts on and how many it takes (`data-line`, `data-lines`, from viewer.js).
// In a deck, a slide's blocks count from its own text, whose first line in the
// note is on the slide's body (`data-base`); the title card stands for the
// front-matter, and a card for its slide's first line (`data-slide-line`).

/** The blocks of the preview that map to the source, in order:
 *  { el, line, lines } with the note's own 0-based line numbers. */
export function anchors(preview) {
  return [...preview.querySelectorAll('[data-line]')].map((el) => ({
    el,
    line: Number(el.closest('[data-base]')?.dataset.base ?? 0) + Number(el.dataset.line),
    lines: Math.max(1, Number(el.dataset.lines) || 1),
  })).filter((a) => Number.isFinite(a.line))
}

/** Where `el` sits in the scrolling `pane`, as that pane's scrollTop would put it at the top. */
function offset(el, pane) {
  return el.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop
}

/**
 * Where in `pane` (as a scrollTop) the source's `line` is shown, `line` being
 * fractional, part way into it. Inside a block the place is taken in
 * proportion; between two blocks, across the gap between them. Before the
 * first block, the top.
 */
function placeOf(pane, preview, line) {
  const list = anchors(preview)
  const i = list.findLastIndex((a) => a.line <= line)
  if (i < 0) return 0
  const a = list[i]
  const top = offset(a.el, pane)
  const bottom = top + a.el.offsetHeight
  // The first block keeps the page's margin above it in view.
  if (i === 0 && line <= a.line) return 0
  if (line < a.line + a.lines) return top + ((line - a.line) / a.lines) * (bottom - top)
  const b = list[i + 1]
  const gap = b ? b.line - (a.line + a.lines) : 0
  return b && gap > 0 ? bottom + ((line - a.line - a.lines) / gap) * (offset(b.el, pane) - bottom) : bottom
}

/** Scroll `pane` so that what the source shows at `line` is at the top. */
export function followLine(pane, preview, line) {
  pane.scrollTop = placeOf(pane, preview, line)
}

/** Scroll `pane` so that `line` is in view, a third of the way down. */
export function showLine(pane, preview, line) {
  pane.scrollTop = placeOf(pane, preview, line) - pane.clientHeight / 3
}

/**
 * The source line (fractional) at the top of `pane`: followLine the other
 * way round, for bringing the editor to what the preview shows.
 */
export function lineAtTop(pane, preview) {
  const y = pane.scrollTop
  const list = anchors(preview)
  const i = list.findLastIndex((a) => offset(a.el, pane) <= y + 1)
  if (i < 0) return 0
  const a = list[i]
  const top = offset(a.el, pane)
  const height = a.el.offsetHeight
  if (y < top + height) return a.line + (height > 0 ? ((y - top) / height) * a.lines : 0)
  const b = list[i + 1]
  if (!b) return a.line + a.lines
  const room = offset(b.el, pane) - (top + height)
  const gap = b.line - (a.line + a.lines)
  return a.line + a.lines + (room > 0 ? ((y - top - height) / room) * gap : 0)
}

/**
 * The source line under a point in the preview (0-based), or null: the block
 * holding `target`, and within it the line in proportion to where `y` falls.
 * On a slide's card outside any block, the slide's first line.
 */
export function lineAt(preview, target, y) {
  const list = anchors(preview)
  const a = list.findLast((x) => x.el.contains(target))
  if (!a) {
    const card = target.closest?.('[data-slide-line]')
    return card ? Number(card.dataset.slideLine) : null
  }
  const box = a.el.getBoundingClientRect()
  const f = box.height > 0 ? (y - box.top) / box.height : 0
  return a.line + Math.min(a.lines - 1, Math.max(0, Math.floor(f * a.lines)))
}
