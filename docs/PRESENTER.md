# The presenter

A note can be shown as a slide deck in a **separate projector window**, drawn
over with a laser/pen/chalk/highlighter/eraser, and flipped to a blank **board**
mid-talk. This document records the design decisions and the shape of the code
so a later session can pick it up quickly. For the user-facing summary see the
"Presenting" section of [../README.md](../README.md); for where it sits in the
whole app, [ARCHITECTURE.md](ARCHITECTURE.md).

Verify changes the way the rest of the project does: serve on **port 8001** and
inspect the DOM in a real browser (see [../CLAUDE.md](../CLAUDE.md)). `python
-m http.server` does not bust caches — `fetch(path, { cache: 'reload' })` before
reloading, and reload CSS with a `?v=` query. One recurring red herring: the
browser console keeps **stale errors across reloads**; a genuine failure in
`createInk` would leave the chrome unbuilt, so trust "the palette/board/menu all
exist" over ghost `ReferenceError`s in the console buffer.

## Files

| File | Role |
|------|------|
| [`present/index.html`](../present/index.html) | Projector page. Loads vendored globals (`marked`, `purify`, `katex`, **`reveal`**) then the CSS chain and the ES-module entry. Lives at `/present/` (no underscore → Jekyll publishes it; port stays 8001). |
| [`src/present/present.js`](../src/present/present.js) | Entry point. Reads `?id`, loads the doc from IndexedDB, builds `<section>`s, initialises reveal, calls `createInk`. |
| [`src/present/slides.js`](../src/present/slides.js) | `parseDeck` / `splitSlides` / front-matter / `<!-- directives -->` / `buildTitleBody`. |
| [`src/present/ink.js`](../src/present/ink.js) | **Everything else** — the ink layer, tools, palette, modes, board, navigator, overview, settings/help dialogs, blank screen, and the one keyboard handler. The big file. |
| [`src/present.css`](../src/present.css) | The theme + all the projector chrome. No reveal theme is vendored — this *is* the theme. |
| [`src/slides.css`](../src/slides.css) | Slide-body / `deck-*` styles **shared** with the editor's reading-view preview. |
| [`src/drafts.js`](../src/drafts.js) | IndexedDB (`docs` / `meta` / `annotations` stores). |

Rendering a slide reuses the app's own `render()` from `src/viewer.js` — one
markdown+TeX pipeline, so a slide is byte-identical to the note read in the
editor. Reveal's markdown/highlight/math plugins are **off** (`plugins: []`).

## What reveal.js still does (and doesn't)

We built the ink, tools, modes, board, navigator, overview, dialogs and keyboard
ourselves, hid reveal's controls/slide-number/theme, and turned its keyboard
**off**. Reveal still earns its place for: **scaling** the fixed `960×700` box to
any screen (letterboxed) — our SVG rides that transform; the **active-slide state
machine** (`.present`, `getIndices/slide/prev/next`); slide **transitions**; the
**progress bar**; and **PDF** print. Replacing it means re-implementing scaling +
transitions + PDF, so it stays for now.

`present.js` config worth knowing: `width/height = W/H (960×700)`, `margin: 0`,
`center: false` (top-aligned; the `center` directive opts a slide in),
`scrollActivationWidth: 0` (disable reveal's mobile "scroll view", which would
re-wrap sections and break the ink layer), `slideNumber: 'c/t'` and `controls`
(both hidden by CSS — we have our own navigator), `plugins: []`. `keyboard` is
set `true` there but immediately overridden to **`false`** by `ink.js`.

## Coordinate space & the ink layer

All ink lives in **slide space `0..W × 0..H` (960×700)** — the same box reveal
lays a slide out in. One `<svg class="ink" viewBox="0 0 960 700"
preserveAspectRatio="none">` per `<section>`; the element's on-screen rect
already reflects reveal's scale, so `clientX/Y → slide units` is just a divide by
the rect (`toViewport`). Because widths and the grid live in these units, strokes
are the **same weight at any projector resolution**.

Strokes sit in a `<g class="ink-layer">` that is translated by the slide's
scrollTop, so ink tracks a tall slide's content as it scrolls; the laser dot and
eraser ring are direct children of the svg (viewport-fixed).

A **tall slide** (a long note shown whole) scrolls its `.slide-body`. The ink svg
covers that body and, on the active slide, swallows pointer input for the tools —
so the native scrollbar under it can't be grabbed (a drag draws instead) and the
laser lit it up. So the projector **hides that scrollbar** (`present.css`) and
`ink.js` **forwards the wheel** through the svg to `body.scrollTop`; the slide
scrolls with the wheel/trackpad, no Ctrl needed. (Holding Ctrl still drops the
overlay for link clicks — that path is unrelated.)

## Surfaces (the key abstraction)

A **surface** is any drawable target, addressed by a key:

- a **slide** — keyed by its integer index (`0, 1, 2 …`),
- a **board page** — keyed by the string **`'board:N'`**.

Everything per-surface is keyed the same way, so the board needed **no second
drawing path**: `record.slides[key]`, `undoStacks[key]`, `redoStacks[key]`,
`layers[key]`, `scrollers[key]`. `curSurface()` returns the active slide index or
`'board:<page>'`. This is why board pages, undo/redo per page, and persistence
all "just work".

## Strokes & rendering

A stroke is `{ tool, slot, width, points }`.

- **`slot`, not a hex.** Colour is stored as a **palette slot 0–4**, resolved to
  a hex at render time from the surface's palette. So one base colour follows the
  surface — slot 3 is ink-black on a slide/whiteboard and chalk-white on the
  blackboard — and re-resolves when the board flips light/dark (`redraw` all board
  pages on surface change). `PALETTES.light` is ink for white surfaces,
  `PALETTES.dark` the chalk pastels, aligned slot-for-slot.
- **Variable width** for pen & chalk (`VARIABLE` set). Width per point is
  `base × (0.4 + pressure)`, EMA-smoothed (`liveWidth`). A stylus supplies the
  pressure; a mouse has none, so it draws at a constant **medium** pressure
  (`MOUSE_PRESSURE`, mid-range) — an earlier speed rule (slow→thick) made a mouse
  line as fat as near-max pen pressure.
  These render as a filled **ribbon** (`ribbonPath`): offset each centre point by
  half its width along the normal, trace one edge forward and the other back with
  round end caps. The edges are **quadratic-smoothed** (curve through the offset
  points) — a polygonal outline reads as a ragged edge on a high-contrast (light)
  surface. Marker/laser are fixed-width lines.
- **Marker** = wide translucent highlighter, `mix-blend-mode: multiply` (screen on
  the dark board, else it vanishes). `markerColor()` brightens a dark ink slot
  into a highlighter tint but leaves already-light colours alone. Base width 20.
- **Chalk** carries `filter: url(#chalk)` (a `feTurbulence`/`feDisplacementMap`
  grain, `userSpaceOnUse` so it doesn't shimmer as the stroke grows), full
  opacity on the whiteboard so it reads brighter than on a slide.
- **Eraser** trims strokes at its rim (`eraseFromStroke` clips each segment against
  the eraser disc), keeping the surviving pieces — it does not drop whole strokes.
- **Laser** leaves a fading trail only while pressed; nothing is stored.

Undo/redo is **delta-based**: each op is `{ removed, added }` holding stroke
*references*, per surface. Because IndexedDB structured-clone preserves shared
references, the history persists inside the record almost for free and survives a
reload. Undo/redo is disabled in Present.

## Modes

Three modes, on a vertical rail top-left (icon-only + tooltip) and in the menu:

- **Present** (`Alt+P`) — slides, **laser only**, toolbar hidden.
- **Annotate** (`Alt+A`) — slides + the drawing toolbar.
- **Board** (`Alt+B`) — the side-car board.

`boardMode` is the derived "on the board" flag. Each drawing mode **remembers its
own tool + colour** (`modeMem`, persisted); a fresh show defaults Annotate to a
**red pen** and Board to **white chalk** (`MODE_DEFAULTS`). The current mode is
restored on reload (meta `present-mode`). `data-mode` on `<body>` drives palette
visibility (hidden in Present).

## The board

A stack of blank pages, each a slide-sized svg (only the current is shown; the
rest carry the `hidden` **attribute** — see gotchas). Page count is restored from
the highest saved `'board:N'`. Two surfaces: **dark blackboard (default)** and
white whiteboard, chosen in Settings; a faint **notebook grid** (on by default) is
an SVG `<pattern>` in slide units, one per surface. The "next" button on the last
page turns into a **down-arrow-with-plus** once the page has ink, adding a fresh
page and then disabling itself so blank pages can't pile up.

## Navigator, overview, dialogs, blank screen

- **Navigator** — a vertical strip on the right (both slides and board): prev up,
  next down, page number between (current bold, total small in the corner).
  Clicking the number opens the overview. Buttons match the mode-button size.
- **Overview** — opened with **`=`** (not Esc — that clashes with fullscreen
  exit). A custom multi-row, vertically-scrolled thumbnail grid; reveal's own
  overview is a single horizontal row, so it didn't fit. Arrow keys move the
  selection, `Enter`/click opens. Slide thumbnails are scaled clones of the
  rendered content; board thumbnails clone the page's strokes.
- **Menu** (hamburger, top-right) → Present / Annotate / Board · Overview · Blank
  screen · **Settings** (`Ctrl+,`) · **Help**. Items show their shortcut on the
  right.
- **Settings / Help dialogs** — styled to match the editor's Settings (fixed size,
  left tab-rail, bold `.dlg-head h2`). Settings has one "Board" tab (surface +
  grid). Help is a two-column key→action table with `<kbd>` badges.
- **Blank screen** — our **own** opaque black overlay (`z-index: 90`), because
  reveal's pause only covers the deck, which is hidden on the board. Click or Esc
  dismisses, and a faint centred "Press Esc or click to return" hint says so
  without being loud enough to distract an audience.

## Keyboard

**Reveal's keyboard is off (`keyboard: false`).** One capture-phase handler in
`ink.js` drives everything:

`Alt+P/A/B` modes · `Ctrl+,` Settings · `1–5` tools (drawing modes only) · `=`
overview · `Ctrl+Z`/`Ctrl+Y` undo/redo (off in Present) · `Ctrl+click` link
passthrough · arrows/space/PgUp/PgDn/Home/End navigate (slides via reveal API,
board via `showBoardPage`) · **Esc** closes a dialog/menu, dismisses the blank
screen, or exits element-fullscreen — and when **nothing is open it is left
completely untouched** so the browser can exit F11 (see gotchas). A **Help**
dialog lists all of this.

Fullscreen is left **entirely to the browser** — we never drive it from code (an
earlier `F` shortcut and a menu button both used `requestFullscreen`, i.e.
element-fullscreen, whose only exit is a *press-and-hold* Esc). The browser's own
fullscreen (`F11`, or `⌃⌘F` on macOS) enters and exits on a single key, so we just
**name** it in Help. The key is picked by platform (`FS_KEY`); there is no web API
to read a browser's real shortcut.

## Persistence

Ink is per note in the `annotations` store (`{ id, slides, undo, redo,
updatedAt }`), keyed by note id — the `.md` stays plain text. Small preferences
live in the global `meta` store:

| meta key | value |
|----------|-------|
| `present-slide:<id>` | last slide index, per note (restore where you left off) |
| `present-mode` | last mode (`present`/`annotate`/`board`) |
| `present-mode-tools` | `{ annotate:{tool,slot}, board:{tool,slot} }` |
| `present-board-surface` | `dark` / `light` (default **dark**) |
| `present-board-grid` | boolean (default **on**) |

Deleting a note deletes its `annotations` record too. **Watch the orphan-flush
trap:** an open projector flushes its ink on `pagehide`, so navigating one tab
away can re-create a record you just deleted from another. When cleaning up a
test note, delete it *after* the projector tab is gone (or navigate that tab off
the note first).

## Hard-won lessons (why the code looks the way it does)

- **`[hidden]` must be reset.** The projector page has no `[hidden]{display:none}`
  reset; overlays that set `display:flex` (`#message`, `.settings-modal`) would
  ignore the attribute. `present.css` adds the reset.
- **`svg.hidden` doesn't reflect.** `.hidden` is an `HTMLElement` IDL prop; `<svg>`
  is `SVGElement`, so `svg.hidden = true` sets an expando that the `[hidden]`
  selector never matches. Board pages toggle with `svg.toggleAttribute('hidden',…)`.
- **Class-name collision.** The board mode flag on `<body>` had to be renamed to
  `board-mode`: with `body` classed `board` *and* the container classed `board`,
  `.board{display:none}` hit the body and blanked the page.
- **CSS beats presentation attributes.** A `.stroke{fill:none}` rule silently
  overrode the ribbon's `fill` attribute (pen invisible). No global fill rule now.
- **Ribbon end caps** use arc sweep flag `0` (bulge outward); `1` cut a concave
  notch that read as a "white dot" at the stroke's end.
- **Headings.** Reveal renders slide headings at weight 400; the reading view
  keeps the browser default bold, so `present.css` forces slide-body and dialog
  headings back to 700 to match the viewer.
- **Escape vs F11 — the big one.** Reveal calls `preventDefault()` on *any* key it
  binds, even a `null`-disabled one, and `preventDefault` on Escape stops the
  browser leaving **F11** fullscreen. A capture-phase `stopPropagation` on Escape
  also interfered. The fix that finally worked: turn reveal's keyboard **fully
  off** and drive navigation ourselves, so nothing touches Escape — our handler
  returns without `stopPropagation`/`preventDefault` when nothing is open, and F11
  exits. We also dropped every code path into `requestFullscreen` (the old `F`
  shortcut and a menu button): element-fullscreen only leaves on a *press-and-hold*
  Esc, so fullscreen is left to the browser's F11 and merely named in Help (see the
  Keyboard section).
- **TDZ ordering.** `redraw` (in the first draw loop) needs `palForSurface`; keep
  such helpers defined *before* the initial redraw. Several bugs were `const` used
  before its declaration line executed.
