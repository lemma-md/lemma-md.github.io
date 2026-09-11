// The annotation layer for presentation mode.
//
// Each slide carries an <svg> overlay in slide coordinate space (0..W, 0..H,
// the same box reveal.js lays a slide out in), so the ink rides reveal's scale
// transform and stays aligned with the content at any projector size. Strokes
// are vectors — arrays of points with a tool, colour and width — stored per note
// in IndexedDB, never in the .md.

import * as drafts from '../drafts.js'

// Must equal the width/height reveal is initialised with (see present.js), so a
// pointer position maps into the same space the slide content lives in.
export const W = 960
export const H = 700

const SVGNS = 'http://www.w3.org/2000/svg'

// Per-tool stroke geometry, in slide-space units. Marker is wide and drawn
// translucent with a multiply blend (see present.css) so it reads as a
// highlighter over text rather than paint on top of it.
const WIDTHS = { pen: 3, chalk: 5.5, marker: 20 }
const ERASER_RADIUS = 12

// Reveal's own keyboard is turned off entirely (see createInk); we handle every
// key in one capture-phase handler. This keeps reveal's hands off Escape, whose
// preventDefault would otherwise stop the browser leaving F11 fullscreen.

// The blackboard's colour (kept in sync with present.css `.board-ink.surface-dark`).
const BOARD_DARK = '#14231d'
// Notebook grid: cell size in slide-space units, so it scales with the board (the
// same proportion at any projector resolution) rather than a fixed screen size.
const GRID_CELL = 38

// Tools whose width varies along the stroke (stored per point). The marker stays
// a uniform highlighter.
const VARIABLE = new Set(['pen', 'chalk'])

// The browser's own fullscreen key, shown only as a hint (we never trigger it —
// JavaScript can only start element-fullscreen, whose Esc-exit is the awkward
// "press and hold"; the browser's F11 exits on a single Esc). There is no web API
// to read a browser's shortcut, so we pick by platform: F11 on Windows/Linux,
// Control-Command-F on macOS. Both cover Chrome, Firefox and Edge/Safari.
const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '')
const FS_KEY = IS_MAC ? '⌃⌘F' : 'F11'

// Width along a "live" stroke. A stylus varies it by pressure (factor 0.4..1.4 of
// base). A mouse reports no pressure, so there is nothing to vary on; an earlier
// "slow = thick" speed rule made a mouse line as fat as near-max pen pressure.
// Instead a pressureless pointer draws at a constant MEDIUM pressure — the middle
// of the stylus range — so a mouse matches a relaxed pen. Returns slide units.
const W_MIN = 0.45
const W_MAX = 1.7
const MOUSE_PRESSURE = 0.5 // what a pressureless pointer (mouse) counts as: mid-range
function liveWidth(e, base) {
  const pressure = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : MOUSE_PRESSURE
  const f = 0.4 + pressure // 0.4..1.4; 0.9 at medium
  return base * Math.max(W_MIN, Math.min(W_MAX, f))
}

// A filled outline for a variable-width stroke: offset each centre point by half
// its width along the normal, trace one side forward and the other back, with
// round end caps. `dw` is the fallback width for points that carry none (old data).
function ribbonPath(points, dw) {
  const n = points.length
  const wOf = (p) => p[2] ?? dw
  if (n === 1) {
    const r = wOf(points[0]) / 2
    const x = points[0][0]
    const y = points[0][1]
    return `M${(x - r).toFixed(1)} ${y.toFixed(1)}a${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(2 * r).toFixed(1)} 0a${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(-2 * r).toFixed(1)} 0Z`
  }
  const left = []
  const right = []
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)]
    const b = points[Math.min(n - 1, i + 1)]
    let dx = b[0] - a[0]
    let dy = b[1] - a[1]
    const len = Math.hypot(dx, dy) || 1
    dx /= len
    dy /= len
    const hw = wOf(points[i]) / 2
    left.push([points[i][0] - dy * hw, points[i][1] + dx * hw])
    right.push([points[i][0] + dy * hw, points[i][1] - dx * hw])
  }
  const f = (p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`
  const rE = (wOf(points[n - 1]) / 2).toFixed(1)
  const rS = (wOf(points[0]) / 2).toFixed(1)
  // Trace one edge as a quadratic curve through the offset points (control at each
  // point, on-curve at the midpoints) so the silhouette is smooth, not a polygon
  // of facets — which read as a ragged edge on a high-contrast (light) surface.
  const smooth = (pts) => {
    let s = ''
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2
      const my = (pts[i][1] + pts[i + 1][1]) / 2
      s += `Q${f(pts[i])} ${mx.toFixed(1)} ${my.toFixed(1)}`
    }
    s += `L${f(pts[pts.length - 1])}`
    return s
  }
  // The end caps are round and bulge OUTWARD (sweep flag 0 goes forward over the
  // tip, not back into a notch).
  let d = `M${f(left[0])}` + smooth(left)
  d += `A${rE} ${rE} 0 0 0 ${f(right[n - 1])}`
  d += smooth(right.slice().reverse())
  d += `A${rS} ${rS} 0 0 0 ${f(left[0])}Z`
  return d
}

// Two swatch palettes, aligned slot-for-slot so switching surface keeps a
// colour's "role". `light` is ink for white surfaces (slides, whiteboard);
// `dark` is chalk for the blackboard — light pastels, and the near-black slot
// becomes white. The active palette is chosen by surface (see palKey).
const PALETTES = {
  light: ['#e11d48', '#2563eb', '#059669', '#111827', '#f59e0b'],
  dark: ['#ff6b7d', '#6cb2ff', '#46d6a1', '#f4f4f5', '#ffce6b'],
}

// Colour helpers: turn a pen swatch into a highlighter tint — same hue, but
// bright and light, so a marker reads like a highlighter over white rather than
// a muddy low-opacity version of a dark, saturated pen colour.
function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  let s = 0
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
  }
  return [h, s, l]
}
function hslToHex(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12
    const a = s * Math.min(l, 1 - l)
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(c * 255).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}
// Hand-tuned highlighter tint per swatch — light and bright, but true to the
// swatch (a red that reads red, not pink). Any other colour falls back to a
// computed bright/light version of the same hue.
const MARKER_TINTS = {
  '#e11d48': '#ff5c66', // red
  '#2563eb': '#5c9dff', // blue
  '#059669': '#2fd39b', // green
  '#111827': '#8592a8', // near-black -> slate
  '#f59e0b': '#ffc44d', // amber
}
function markerColor(hex) {
  if (MARKER_TINTS[hex]) return MARKER_TINTS[hex]
  const [h, s, l] = hexToHsl(hex)
  if (l > 0.7) return hex // already a light chalk colour — tinting would distort its hue
  return hslToHex(h, Math.max(s, 0.85), 0.62)
}

// Palette icons (Lucide, ISC — see VENDOR.md), inlined as SVG because the
// projector page carries no icon sprite. The laser has a red beam and dot so it
// reads as a laser pointer at a glance.
const ICONS = {
  pointer: '<path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/>',
  pen: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
  chalk: '<rect x="3.5" y="5.5" width="18" height="8" rx="4" transform="rotate(-45 12.5 9.5)"/><path d="M2 20.5h15"/>',
  marker: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
  eraser: '<path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21"/><path d="m5.082 11.09 8.828 8.828"/>',
  laser: '<path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/><circle cx="4.3" cy="4.3" r="1.9" fill="#ff3b30" stroke="none"/>',
  menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
  slides: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 20h8"/>',
  board: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M7 9.5h6"/><path d="M7 13.5h10"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronUp: '<path d="m18 15-6-6-6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  // A down chevron with a small plus at the lower-right: "add a new page below".
  chevronDownPlus: '<path d="m4 8 5 5 5-5"/><path d="M19 15v6"/><path d="M16 18h6"/>',
  present: '<path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/>',
  annotate: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  square: '<rect x="3" y="3" width="18" height="18" rx="2"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M15 3v18"/><path d="M3 9h18"/><path d="M3 15h18"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"/>',
  clear: '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
}

function icon(name) {
  const svg = document.createElementNS(SVGNS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('class', 'tool-icon')
  svg.innerHTML = ICONS[name]
  return svg
}

/**
 * Attach the ink layer to an initialised reveal deck. Reads any saved strokes
 * for `noteId`, draws them, builds the floating tool palette, and wires pointer
 * drawing. Returns { flush } so the caller can force a save (e.g. on unload).
 */
export async function createInk(reveal, noteId) {
  const deckEl = reveal.getRevealElement()
  const sections = [...deckEl.querySelectorAll('.slides > section')]

  const record = (await drafts.getAnnotations(noteId).catch(() => null)) || { id: noteId, slides: {}, updatedAt: 0 }
  // A "surface" is either a slide (keyed by its number) or a side-car board page
  // (keyed by the string 'board:N'). All the per-surface state below is keyed the
  // same way, so the board rides the whole drawing/erase/undo machinery unchanged.
  const strokesAt = (i) => (record.slides[i] ||= [])

  // Blackboard vs whiteboard is a small global preference, kept in the meta store
  // so it is not lost when a note's annotation record is (an empty deck deletes
  // its record). Default is the dark board.
  const savedSurface = await drafts.getMeta('present-board-surface').catch(() => null)
  const savedGrid = await drafts.getMeta('present-board-grid').catch(() => null)
  const savedModeTools = await drafts.getMeta('present-mode-tools').catch(() => null)
  const savedMode = await drafts.getMeta('present-mode').catch(() => null)

  // Per surface: the scrollable content container (slides only), and the <g>
  // holding its strokes (translated in step with that container's scroll).
  const scrollers = {}
  const layers = {}

  const svgs = sections.map((section, i) => {
    const svg = document.createElementNS(SVGNS, 'svg')
    svg.setAttribute('class', 'ink')
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
    svg.setAttribute('preserveAspectRatio', 'none')
    // Strokes live in this group, which is translated by the slide's scroll; the
    // laser dot is a direct child of the svg instead, so it stays at the cursor.
    const layer = document.createElementNS(SVGNS, 'g')
    layer.setAttribute('class', 'ink-layer')
    svg.appendChild(layer)
    layers[i] = layer
    section.appendChild(svg)

    const body = section.querySelector('.slide-body')
    scrollers[i] = body || null
    if (body) {
      // Keep the ink aligned as the content scrolls; and since a drawing tool
      // puts the svg on top (swallowing the wheel), forward the wheel to the
      // content so a tall slide can still be scrolled while drawing.
      body.addEventListener('scroll', () => applyScroll(i))
      svg.addEventListener('wheel', (e) => { body.scrollTop += e.deltaY; e.preventDefault() }, { passive: false })
    }

    wirePointer(svg, i)
    return svg
  })
  // The chalk texture filter, defined once and referenced by url(#chalk) from any
  // slide's strokes. userSpaceOnUse anchors the noise to slide coordinates, so the
  // grain does not shimmer as a stroke grows.
  const defs = document.createElementNS(SVGNS, 'svg')
  defs.setAttribute('width', '0')
  defs.setAttribute('height', '0')
  defs.style.position = 'absolute'
  defs.innerHTML =
    `<defs><filter id="chalk" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">` +
    '<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" stitchTiles="stitch" result="fine"/>' +
    '<feDisplacementMap in="SourceGraphic" in2="fine" scale="2.6" xChannelSelector="R" yChannelSelector="G" result="rough"/>' +
    '<feTurbulence type="fractalNoise" baseFrequency="0.45" numOctaves="3" seed="3" stitchTiles="stitch" result="grain"/>' +
    '<feComponentTransfer in="grain" result="grainA"><feFuncA type="discrete" tableValues="0.15 0.55 0.8 1"/></feComponentTransfer>' +
    '<feComposite in="rough" in2="grainA" operator="in"/>' +
    '</filter>' +
    // Two notebook grids (one per surface): faint squares, cell size in slide
    // units so the grid scales with the board, not the screen.
    `<pattern id="grid-dark" width="${GRID_CELL}" height="${GRID_CELL}" patternUnits="userSpaceOnUse">` +
    `<path d="M${GRID_CELL} 0H0V${GRID_CELL}" fill="none" stroke="#ffffff" stroke-opacity="0.10" stroke-width="1"/></pattern>` +
    `<pattern id="grid-light" width="${GRID_CELL}" height="${GRID_CELL}" patternUnits="userSpaceOnUse">` +
    `<path d="M${GRID_CELL} 0H0V${GRID_CELL}" fill="none" stroke="#2563eb" stroke-opacity="0.16" stroke-width="1"/></pattern>` +
    '</defs>'
  document.body.appendChild(defs)

  // The side-car board: a stack of blank pages, not tied to any slide. Each page
  // is a slide-sized panel and its own drawing surface, keyed 'board:N'; only the
  // current page is shown (the rest are `hidden`). Because every surface is keyed,
  // undo/redo/erase and persistence work per page with no special casing.
  const boardEl = document.createElement('div')
  boardEl.className = 'board'
  document.body.appendChild(boardEl)

  let boardSurface = savedSurface === 'light' || savedSurface === 'dark' ? savedSurface : 'dark'
  let boardGrid = savedGrid !== false // notebook squares on the board, on by default
  const boardKey = (n) => `board:${n}`
  const boardSvgs = [] // one <svg> per page; index === page number
  let boardPage = 0

  // Every ink surface (slides + board pages), for the whole-set operations
  // (cursor, laser/eraser off). Board pages push themselves on as they are made.
  const inkSvgs = [...svgs]

  function makeBoardPage(n) {
    const svg = document.createElementNS(SVGNS, 'svg')
    svg.setAttribute('class', `ink board-ink surface-${boardSurface}`)
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
    svg.setAttribute('preserveAspectRatio', 'none')
    // Only the current page is shown. Use the attribute (not the .hidden IDL
    // property, which SVGElement does not reflect) so the [hidden] rule matches.
    svg.toggleAttribute('hidden', n !== boardPage)
    // The notebook grid sits behind the strokes; its fill (a pattern) and
    // visibility are set by applyBoardGrid from the surface + grid preference.
    const grid = document.createElementNS(SVGNS, 'rect')
    grid.setAttribute('class', 'board-grid')
    grid.setAttribute('x', '0')
    grid.setAttribute('y', '0')
    grid.setAttribute('width', W)
    grid.setAttribute('height', H)
    grid.setAttribute('fill', `url(#grid-${boardSurface})`)
    grid.toggleAttribute('hidden', !boardGrid)
    svg.appendChild(grid)
    const layer = document.createElementNS(SVGNS, 'g')
    layer.setAttribute('class', 'ink-layer')
    svg.appendChild(layer)
    boardEl.appendChild(svg)
    layers[boardKey(n)] = layer
    scrollers[boardKey(n)] = null
    boardSvgs[n] = svg
    inkSvgs.push(svg)
    wirePointer(svg, boardKey(n))
    return svg
  }

  // Restore as many pages as were saved: one past the highest saved 'board:N'
  // (across strokes and history), and always at least one blank page.
  function savedBoardPages() {
    let max = -1
    for (const src of [record.slides, record.undo || {}, record.redo || {}]) {
      for (const k of Object.keys(src)) {
        const m = /^board:(\d+)$/.exec(k)
        if (m) max = Math.max(max, +m[1])
      }
    }
    return Math.max(1, max + 1)
  }
  for (let n = 0; n < savedBoardPages(); n++) makeBoardPage(n)

  // A stroke stores its colour as a slot, not a hex, so the SAME base colour
  // follows the surface: slot 3 is ink-black on a slide/whiteboard and chalk-white
  // on the blackboard. These resolve a surface id to the palette its strokes use.
  // (Defined here, before the first redraw, which reads them.)
  const surfaceKind = (i) => (typeof i === 'string' && i.startsWith('board') ? boardSurface : 'light')
  const palForSurface = (i) => PALETTES[surfaceKind(i)]

  // Draw saved strokes and set the initial scroll offset now that the maps exist.
  svgs.forEach((_, i) => { redraw(i); applyScroll(i) })
  boardSvgs.forEach((_, n) => redraw(boardKey(n)))

  /* ---------- surface / mode ---------- */

  // Three modes: 'present' (slides, laser only, no toolbar), 'annotate' (slides,
  // draw over them) and 'board' (the side-car board). `boardMode` is the board
  // case, kept as a derived flag since much of the code keys off "on the board".
  // Each drawing mode remembers its own tool + colour; a fresh show defaults to a
  // red pen for Annotate and white chalk for Board.
  const MODE_DEFAULTS = { annotate: { tool: 'pen', slot: 0 }, board: { tool: 'chalk', slot: 3 } }
  const modeMem = loadModeMem(savedModeTools)
  let mode = 'present'
  let boardMode = false
  const curSurface = () => (boardMode ? boardKey(boardPage) : reveal.getIndices().h)

  function loadModeMem(saved) {
    const mem = { annotate: { ...MODE_DEFAULTS.annotate }, board: { ...MODE_DEFAULTS.board } }
    for (const m of ['annotate', 'board']) {
      const s = saved && saved[m]
      if (s && ['pen', 'chalk', 'marker', 'eraser'].includes(s.tool)) mem[m].tool = s.tool
      if (s && Number.isInteger(s.slot) && s.slot >= 0 && s.slot < PALETTES.light.length) mem[m].slot = s.slot
    }
    return mem
  }
  let memTimer = null
  function persistModeMem() {
    clearTimeout(memTimer)
    memTimer = setTimeout(() => drafts.putMeta('present-mode-tools', modeMem).catch(() => {}), 400)
  }

  // The dark board uses the chalk palette; slides and the whiteboard use ink.
  const palKey = () => (boardMode && boardSurface === 'dark' ? 'dark' : 'light')
  const activePalette = () => PALETTES[palKey()]

  function applyBoardSurface() {
    for (const svg of boardSvgs) {
      svg.classList.toggle('surface-dark', boardSurface === 'dark')
      svg.classList.toggle('surface-light', boardSurface === 'light')
    }
  }

  // Point each page's grid rect at the matching pattern and show/hide it.
  function applyBoardGrid() {
    for (const svg of boardSvgs) {
      const g = svg.querySelector('.board-grid')
      if (!g) continue
      g.setAttribute('fill', `url(#grid-${boardSurface})`)
      g.toggleAttribute('hidden', !boardGrid)
    }
  }
  function setGrid(on) {
    boardGrid = !!on
    applyBoardGrid()
    drafts.putMeta('present-board-grid', boardGrid).catch(() => {})
    paintSettings()
  }

  // Show one board page (hiding the others) and update the page counter.
  function showBoardPage(n) {
    boardPage = n
    boardSvgs.forEach((svg, k) => { svg.toggleAttribute('hidden', k !== n) })
    paintNav()
    paintCursor() // the newly shown page needs the current tool's cursor
  }
  function boardAddPage() {
    const n = boardSvgs.length
    makeBoardPage(n)
    redraw(boardKey(n))
    showBoardPage(n)
  }

  /* ---------- tool state ---------- */

  let tool = 'laser' // laser | pen | chalk | marker | eraser — present starts on laser
  // The chosen colour is a slot (0..4) into the active palette, so the same slot
  // stays selected across a surface change and its hex follows the palette.
  let slot = 0
  let color = activePalette()[slot]
  document.body.dataset.tool = tool
  document.body.dataset.mode = mode

  // Laser state: a small dot at the cursor, and — only while the button is held —
  // a short trail behind it that fades, so a press reads like a pen stroke that
  // erases itself, while a plain hover just moves the dot.
  let laserSvg = null
  let laserLast = null // [x, y] viewport coords of the cursor, or null when away
  let laserTrail = [] // recent points { x, y, t } making the fading trail
  let laserRAF = null
  let laserDown = false // is the pointer pressed (leaving a trail)?

  // Undo/redo history, one stack per slide (so undo is local to the slide you are
  // on), as operations rather than snapshots: each entry is the small delta
  // { removed, added } of an action — the strokes it took out and the ones it put
  // in — holding references, not copies. It is saved inside the record (below);
  // because IndexedDB's structured clone preserves shared references, a stroke
  // that lives both on a slide and in a delta is stored once and comes back as one
  // object, so undo/redo keep working after a reload.
  const undoStacks = record.undo || {} // i -> [{ removed, added }], newest last
  const redoStacks = record.redo || {}

  function pushOp(i, removed, added) {
    if (!removed.length && !added.length) return
    const s = (undoStacks[i] ||= [])
    s.push({ removed, added })
    if (s.length > 100) s.shift()
    redoStacks[i] = [] // a fresh action invalidates any redo
  }

  // Rebuild the slide's list with `remove` taken out (by identity) and `add` put on.
  function applyDelta(i, remove, add) {
    const rm = new Set(remove)
    record.slides[i] = strokesAt(i).filter((s) => !rm.has(s)).concat(add)
    redraw(i)
    scheduleSave()
  }

  function undo() {
    const i = curSurface()
    const op = undoStacks[i]?.pop()
    if (!op) return
    ;(redoStacks[i] ||= []).push(op)
    applyDelta(i, op.added, op.removed) // reverse: pull what it added, restore what it removed
  }

  function redo() {
    const i = curSurface()
    const op = redoStacks[i]?.pop()
    if (!op) return
    ;(undoStacks[i] ||= []).push(op)
    applyDelta(i, op.removed, op.added) // replay
  }

  function setTool(next) {
    tool = next
    if (mode !== 'present') { modeMem[mode].tool = next; persistModeMem() }
    document.body.dataset.tool = tool
    laserOff()
    eraserOff()
    paintPalette()
    paintCursor()
  }
  function setSlot(next) {
    slot = next
    color = activePalette()[slot]
    if (mode !== 'present') { modeMem[mode].slot = next; persistModeMem() }
    paintSwatches()
    paintCursor()
  }
  // Re-read the colour from the active palette (e.g. after a surface change) and
  // repaint the swatches to that palette, keeping the same slot selected.
  function refreshColor() {
    color = activePalette()[slot]
    paintSwatches()
    paintCursor()
  }

  // Switch mode. Remember the tool of the mode we leave, restore the tool of the
  // one we enter (present is always the laser). The board is a full overlay, so
  // hide the deck (and its keyboard nav) while it is up and re-lay it out on return.
  function setMode(next) {
    if (!['present', 'annotate', 'board'].includes(next) || next === mode) return
    if (mode !== 'present') { modeMem[mode].tool = tool; modeMem[mode].slot = slot }
    mode = next
    boardMode = mode === 'board'
    document.body.dataset.mode = mode
    document.body.classList.toggle('board-mode', boardMode)
    applyBoardSurface()
    applyBoardGrid()
    if (!boardMode) reveal.layout()
    // Restore this mode's tool/colour; present forces the laser.
    tool = mode === 'present' ? 'laser' : modeMem[mode].tool
    slot = mode === 'present' ? slot : modeMem[mode].slot
    color = activePalette()[slot]
    document.body.dataset.tool = tool
    laserOff()
    eraserOff()
    paintPalette()
    paintCursor()
    paintModeUI()
    paintNav()
    persistModeMem()
    drafts.putMeta('present-mode', mode).catch(() => {})
  }

  function setSurface(next) {
    if (next !== 'light' && next !== 'dark') return
    boardSurface = next
    applyBoardSurface()
    applyBoardGrid() // the grid lines change colour with the surface
    boardSvgs.forEach((_, n) => redraw(boardKey(n))) // strokes re-resolve to the new palette
    drafts.putMeta('present-board-surface', next).catch(() => {})
    refreshColor() // dark<->light changes which palette is active on the board
    paintSettings()
  }

  // A cursor that shows what the tool will do: a dot in the pen's colour, a wide
  // translucent disc for the highlighter, a ring for the eraser's reach; the
  // laser hides the cursor (its red dot stands in). Built as an SVG data-URI so
  // it can carry the live colour, with the hotspot at the centre.
  function cursorFor() {
    // Laser and eraser hide the system cursor: each draws its own indicator in
    // slide space (the red dot; the eraser ring that matches the erased area).
    if (tool === 'laser' || tool === 'eraser') return 'none'
    // A single rim so the dot is visible over any colour: white by default, but
    // the board's own colour on the dark board — there a light chalk fill would
    // otherwise merge into a white rim and read as a bigger blob.
    const rim = boardMode && boardSurface === 'dark' ? BOARD_DARK : '#fff'
    let inner
    if (tool === 'pen') inner = `<circle cx="12" cy="12" r="4" fill="${color}" stroke="${rim}" stroke-width="1.5"/>`
    else if (tool === 'chalk') inner = `<circle cx="12" cy="12" r="5.5" fill="${color}" stroke="${rim}" stroke-width="1.5"/>`
    else if (tool === 'marker') inner = `<rect x="8.5" y="3" width="7" height="18" rx="3.5" fill="${markerColor(color)}" stroke="${rim}" stroke-width="1.5"/>`
    else return 'crosshair'
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">${inner}</svg>`
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, crosshair`
  }
  function paintCursor() {
    const c = cursorFor()
    for (const s of inkSvgs) s.style.cursor = c
  }

  // The eraser's own cursor: a ring drawn in slide space at ERASER_RADIUS, so it
  // is exactly the size of the area it rubs out, at any projector scale.
  function showEraser(svg, pt) {
    let el = svg.querySelector('.eraser-cursor')
    if (!el) {
      el = document.createElementNS(SVGNS, 'circle')
      el.setAttribute('class', 'eraser-cursor')
      el.setAttribute('r', ERASER_RADIUS)
      svg.appendChild(el)
    }
    el.setAttribute('cx', pt[0])
    el.setAttribute('cy', pt[1])
  }
  function eraserOff() {
    for (const s of inkSvgs) s.querySelector('.eraser-cursor')?.remove()
  }

  /* ---------- drawing ---------- */

  let saveTimer = null
  function scheduleSave() {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(flush, 500)
    if (boardMode) paintNav() // ink on the last page may enable "add page"
  }
  function flush() {
    clearTimeout(saveTimer)
    // Keep only what carries something — slides with strokes, and history stacks
    // with entries — so a deck that was never drawn on (or fully erased with no
    // undo left) leaves no record rather than a litter of empty arrays.
    const nonEmpty = (obj) => {
      const out = {}
      for (const k of Object.keys(obj)) if (obj[k]?.length) out[k] = obj[k]
      return out
    }
    const slides = nonEmpty(record.slides)
    const undo = nonEmpty(undoStacks)
    const redo = nonEmpty(redoStacks)
    if (!Object.keys(slides).length && !Object.keys(undo).length && !Object.keys(redo).length) {
      return drafts.deleteAnnotations(noteId).catch((e) => console.error(e))
    }
    record.slides = slides
    // Saved alongside the strokes; shared references make this nearly free (see
    // the note by undoStacks), and it lets undo/redo survive a reload.
    record.undo = undo
    record.redo = redo
    record.updatedAt = Date.now()
    return drafts.putAnnotations(record).catch((e) => console.error(e))
  }

  // A function declaration (hoisted): applyScroll runs from the init loop above,
  // before this point is reached in source order.
  function scrollOf(i) { return scrollers[i]?.scrollTop || 0 }

  // Slide a stroke group so the ink tracks the slide's scrolled content.
  function applyScroll(i) {
    layers[i]?.setAttribute('transform', `translate(0 ${(-scrollOf(i)).toFixed(1)})`)
  }

  // Client coordinates -> the visible slide viewport (0..W, 0..H). The SVG's
  // on-screen rect already reflects reveal's transform, so dividing by it yields
  // slide-space units regardless of how the deck is scaled.
  function toViewport(svg, e) {
    const r = svg.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H]
  }

  // Client coordinates -> the slide's content space: the viewport point plus how
  // far the slide is scrolled. Strokes are stored here so they stay anchored to
  // the content, not the viewport, as it scrolls.
  function toContent(svg, e, i) {
    const [x, y] = toViewport(svg, e)
    return [x, y + scrollOf(i)]
  }

  function pathData(points) {
    if (!points.length) return ''
    return points.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
  }

  // `pal` is the palette of the surface the stroke is drawn on, so its slot
  // resolves to the right hex for that surface. (Old data may carry a hex.)
  function strokeEl(s, pal) {
    const hex = s.slot != null ? pal[s.slot] : s.color
    const el = document.createElementNS(SVGNS, 'path')
    if (VARIABLE.has(s.tool)) {
      // Variable width: a filled ribbon rather than a fixed-width line.
      el.setAttribute('d', ribbonPath(s.points, s.width))
      el.setAttribute('fill', hex)
      el.setAttribute('stroke', 'none')
    } else {
      el.setAttribute('d', pathData(s.points))
      el.setAttribute('fill', 'none')
      el.setAttribute('stroke', s.tool === 'marker' ? markerColor(hex) : hex)
      el.setAttribute('stroke-width', s.width)
      el.setAttribute('stroke-linecap', 'round')
      el.setAttribute('stroke-linejoin', 'round')
    }
    el.setAttribute('class', `stroke stroke-${s.tool}`)
    if (s.tool === 'chalk') el.setAttribute('filter', 'url(#chalk)') // grainy, rough edge
    return el
  }

  function redraw(i) {
    const layer = layers[i]
    if (!layer) return
    const pal = palForSurface(i)
    layer.textContent = ''
    for (const s of strokesAt(i)) layer.appendChild(strokeEl(s, pal))
    applyScroll(i)
  }

  // Clip a polyline against the eraser disc (centre c, radius r): return the runs
  // of points that stay OUTSIDE it, cutting each crossing segment exactly at the
  // circle so a new end point sits on the rim — instead of snapping to whichever
  // vertex happened to fall outside. `hit` says whether anything was rubbed out.
  function eraseFromStroke(points, c, r) {
    const inside = (p) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 <= r * r
    // Interpolate every component, so a new end point keeps its width (p[2]) too.
    const lerp = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t)
    const runs = []
    let open = inside(points[0]) ? null : [points[0]]
    let hit = false
    const close = () => { if (open && open.length >= 2) runs.push(open); open = null }

    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]
      const b = points[i]
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const fx = a[0] - c[0]
      const fy = a[1] - c[1]
      const A = dx * dx + dy * dy
      // [tlo, thi] is the part of segment a->b that lies inside the disc, or null.
      let tlo = null
      let thi = null
      if (A === 0) {
        if (inside(a)) { tlo = 0; thi = 1 }
      } else {
        const B = 2 * (fx * dx + fy * dy)
        const C = fx * fx + fy * fy - r * r
        const disc = B * B - 4 * A * C
        if (disc >= 0) {
          const s = Math.sqrt(disc)
          const lo = Math.max(0, (-B - s) / (2 * A))
          const hi = Math.min(1, (-B + s) / (2 * A))
          if (lo <= hi) { tlo = lo; thi = hi }
        }
      }

      if (tlo === null) {
        // segment stays outside: extend the current run to b
        if (open === null) open = [a]
        open.push(b)
      } else {
        hit = true
        if (tlo > 0) { if (open === null) open = [a]; open.push(lerp(a, b, tlo)); close() } else close()
        open = thi < 1 ? [lerp(a, b, thi), b] : null
      }
    }
    close()
    return { runs, hit }
  }

  // Partial erase: rub out only the part of each stroke under the eraser, keeping
  // the surviving pieces (trimmed at the eraser's rim) as their own strokes.
  function eraseAt(i, pt) {
    const list = strokesAt(i)
    const out = []
    let changed = false
    for (const s of list) {
      const r = ERASER_RADIUS + s.width / 2
      if (s.points.length < 2) {
        // A lone point (a click): drop it only if the eraser is over it.
        const p = s.points[0]
        if ((p[0] - pt[0]) ** 2 + (p[1] - pt[1]) ** 2 <= r * r) changed = true
        else out.push(s)
        continue
      }
      const { runs, hit } = eraseFromStroke(s.points, pt, r)
      if (!hit) { out.push(s); continue }
      changed = true
      for (const run of runs) out.push({ ...s, points: run })
    }
    if (!changed) return false
    record.slides[i] = out
    redraw(i)
    return true
  }

  // The laser leaves a pen-like trail that fades. On each move we record the
  // cursor point; a rAF loop drops points older than LASER_FADE and redraws the
  // trail (tail more transparent) plus a small head dot at the cursor.
  const LASER_R = 4
  const LASER_FADE = 550 // ms for the trail to fade away

  function laserMove(svg, pt) {
    laserSvg = svg
    laserLast = pt
    // Only a held pointer lays down trail; a hover just moves the dot.
    if (laserDown) laserTrail.push({ x: pt[0], y: pt[1], t: performance.now() })
    drawLaser() // move the dot at once, without waiting for a frame
    if (laserTrail.length && !laserRAF) laserRAF = requestAnimationFrame(laserFrame)
  }

  function laserFrame() {
    laserRAF = null
    const now = performance.now()
    laserTrail = laserTrail.filter((p) => now - p.t < LASER_FADE)
    drawLaser()
    // Keep animating only while the trail is still fading; a stationary dot is
    // already drawn and needs no frames. A move (or a leave) restarts the loop.
    if (tool === 'laser' && laserTrail.length) laserRAF = requestAnimationFrame(laserFrame)
  }

  function drawLaser() {
    if (!laserSvg) return
    let g = laserSvg.querySelector('.laser')
    if (tool !== 'laser' || (!laserLast && !laserTrail.length)) { g?.remove(); return }
    if (!g) { g = document.createElementNS(SVGNS, 'g'); g.setAttribute('class', 'laser'); laserSvg.appendChild(g) }
    g.textContent = ''
    const now = performance.now()
    for (let k = 1; k < laserTrail.length; k++) {
      const a = laserTrail[k - 1]
      const b = laserTrail[k]
      const line = document.createElementNS(SVGNS, 'line')
      line.setAttribute('x1', a.x)
      line.setAttribute('y1', a.y)
      line.setAttribute('x2', b.x)
      line.setAttribute('y2', b.y)
      line.setAttribute('class', 'laser-trail')
      line.setAttribute('stroke-opacity', Math.max(0, 1 - (now - b.t) / LASER_FADE).toFixed(2))
      g.appendChild(line)
    }
    if (laserLast) {
      const dot = document.createElementNS(SVGNS, 'circle')
      dot.setAttribute('class', 'laser-dot')
      dot.setAttribute('cx', laserLast[0])
      dot.setAttribute('cy', laserLast[1])
      dot.setAttribute('r', LASER_R)
      g.appendChild(dot)
    }
  }

  function laserOff() {
    laserLast = null
    laserDown = false
    laserTrail = []
    if (laserRAF) { cancelAnimationFrame(laserRAF); laserRAF = null }
    for (const svg of inkSvgs) svg.querySelector('.laser')?.remove()
  }

  function wirePointer(svg, i) {
    let stroke = null
    let el = null
    let eraseBefore = null // the slide's stroke list at the start of an eraser drag
    let lastW = 0 // smoothed width carried across the points of a variable-width stroke

    svg.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      // Capture so a gesture that leaves the slide still tracks; harmless if the
      // browser refuses (e.g. no active pointer).
      try { svg.setPointerCapture(e.pointerId) } catch { /* ignore */ }

      if (tool === 'laser') { laserDown = true; laserMove(svg, toViewport(svg, e)); return }

      const pt = toContent(svg, e, i)
      if (tool === 'eraser') {
        showEraser(svg, toViewport(svg, e))
        eraseBefore = [...strokesAt(i)] // the list before the drag, for its net delta
        if (eraseAt(i, pt)) scheduleSave()
        stroke = 'erasing'
        return
      }
      const base = WIDTHS[tool]
      if (VARIABLE.has(tool)) {
        const w0 = liveWidth(e, base)
        stroke = { tool, slot, width: base, points: [[pt[0], pt[1], w0]] }
        lastW = w0
      } else {
        stroke = { tool, slot, width: base, points: [pt] }
      }
      strokesAt(i).push(stroke)
      el = strokeEl(stroke, palForSurface(i))
      layers[i].appendChild(el)
    })

    svg.addEventListener('pointermove', (e) => {
      if (tool === 'laser') return laserMove(svg, toViewport(svg, e))
      if (tool === 'eraser') showEraser(svg, toViewport(svg, e)) // ring follows the cursor
      if (!stroke) return
      const pt = toContent(svg, e, i)
      if (stroke === 'erasing') { if (eraseAt(i, pt)) scheduleSave(); return }
      if (VARIABLE.has(stroke.tool)) {
        lastW = lastW * 0.6 + liveWidth(e, stroke.width) * 0.4 // smooth the width across points
        stroke.points.push([pt[0], pt[1], lastW])
        el.setAttribute('d', ribbonPath(stroke.points, stroke.width))
      } else {
        stroke.points.push(pt)
        el.setAttribute('d', pathData(stroke.points))
      }
    })

    const end = () => {
      laserDown = false
      if (stroke === 'erasing') {
        // The drag's net delta: originals it removed, fragments it added.
        const after = strokesAt(i)
        const beforeSet = new Set(eraseBefore)
        const afterSet = new Set(after)
        pushOp(i, eraseBefore.filter((s) => !afterSet.has(s)), after.filter((s) => !beforeSet.has(s)))
        eraseBefore = null
      } else if (stroke) {
        pushOp(i, [], [stroke]) // one completed stroke — shares the object with the slide
      }
      if (stroke) scheduleSave()
      stroke = null
      el = null
    }
    svg.addEventListener('pointerup', end)
    svg.addEventListener('pointercancel', end)
    // Leaving the slide hides the eraser ring and the laser dot at once; any
    // remaining laser trail fades out on its own.
    svg.addEventListener('pointerleave', () => {
      svg.querySelector('.eraser-cursor')?.remove()
      if (tool !== 'laser') return
      laserDown = false
      laserLast = null
      drawLaser() // removes the group now if the trail is already empty
      if (laserTrail.length && !laserRAF) laserRAF = requestAnimationFrame(laserFrame)
    })
  }

  /* ---------- palette ---------- */

  const palette = document.createElement('div')
  palette.className = 'ink-palette'

  const TOOLS = [
    { id: 'laser', title: 'Laser pointer — hold Ctrl and click to open a link' },
    { id: 'pen', title: 'Pen' },
    { id: 'chalk', title: 'Chalk' },
    { id: 'marker', title: 'Highlighter' },
    { id: 'eraser', title: 'Eraser — rubs out the part you drag over' },
  ]

  const toolBtns = TOOLS.map((t) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.dataset.tool = t.id
    b.title = t.title
    b.appendChild(icon(t.id))
    b.onclick = () => setTool(t.id)
    palette.appendChild(b)
    return b
  })

  palette.appendChild(sep())

  // One button per slot; its colour follows the active palette (see paintSwatches),
  // so the strip shows ink on slides/whiteboard and chalk on the blackboard.
  const swatchBtns = activePalette().map((_, k) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'swatch'
    b.onclick = () => { setSlot(k); if (tool === 'laser' || tool === 'eraser') setTool('pen') }
    palette.appendChild(b)
    return b
  })

  palette.appendChild(sep())

  const undoBtn = button('undo', 'Undo (Ctrl+Z)', undo)
  const redoBtn = button('redo', 'Redo (Ctrl+Y)', redo)
  const clearBtn = button('clear', 'Clear this surface (can be undone)', () => {
    const i = curSurface()
    const current = strokesAt(i)
    if (!current.length) return
    pushOp(i, [...current], []) // remove them all — reversible
    record.slides[i] = []
    redraw(i)
    scheduleSave()
  })
  palette.append(undoBtn, redoBtn, clearBtn)
  document.body.appendChild(palette)

  // Repaint the swatches to the active palette, marking the chosen slot.
  function paintSwatches() {
    const pal = activePalette()
    swatchBtns.forEach((b, k) => {
      b.style.background = pal[k]
      b.title = `Colour ${pal[k]}`
      b.classList.toggle('active', k === slot)
    })
  }
  function paintPalette() {
    for (const b of toolBtns) b.classList.toggle('active', b.dataset.tool === tool)
    paintSwatches()
  }

  /* ---------- page navigation (slides and board) ---------- */

  // A vertical strip on the right, like the chalkboard plugin: previous above,
  // next below, the page number between (current bold, total smaller and fainter,
  // pushed to the right edge). It drives the slides in Present/Annotate and the
  // pages in Board. Clicking the number opens the overview. On the board's last
  // page the "next" button turns into "add page" when the page has ink on it.
  const nav = document.createElement('div')
  nav.className = 'board-nav'
  const navPrevBtn = button('chevronUp', 'Previous', () => navGo(-1))
  const navNextBtn = button('chevronDown', 'Next', () => navNext())
  const navCount = document.createElement('button')
  navCount.type = 'button'
  navCount.className = 'board-count'
  navCount.onclick = () => openOverview(boardMode ? 'board' : 'slides')
  const navCur = document.createElement('span')
  navCur.className = 'bc-cur'
  const navTot = document.createElement('span')
  navTot.className = 'bc-tot'
  navCount.append(navCur, navTot)
  nav.append(navPrevBtn, navCount, navNextBtn)
  document.body.appendChild(nav)

  // Current position/total for the active surface kind.
  const navState = () => boardMode
    ? { cur: boardPage, total: boardSvgs.length }
    : { cur: reveal.getIndices().h, total: sections.length }
  let navAdd = false // does the next button add a board page right now?

  function navGo(step) {
    if (boardMode) {
      const n = boardPage + step
      if (n >= 0 && n < boardSvgs.length) showBoardPage(n)
    } else if (step < 0) reveal.prev()
    else reveal.next()
  }
  function navNext() {
    if (navAdd) boardAddPage()
    else navGo(1)
  }
  function paintNav() {
    const { cur, total } = navState()
    navCur.textContent = cur + 1
    navTot.textContent = total
    navPrevBtn.disabled = cur === 0
    const onLast = cur === total - 1
    // On the board's last page, offer "add" only once the page carries ink, so a
    // run of blank pages can't pile up.
    navAdd = boardMode && onLast && strokesAt(boardKey(boardPage)).length > 0
    navNextBtn.replaceChildren(icon(navAdd ? 'chevronDownPlus' : 'chevronDown'))
    navNextBtn.disabled = onLast && !navAdd
    navNextBtn.title = navAdd ? 'Add a page' : boardMode ? 'Next page' : 'Next slide'
    navCount.title = boardMode ? 'Overview of the board pages' : 'Overview of the slides'
  }

  /* ---------- mode rail (top-left) ---------- */

  // The three modes as icon-only buttons (with tooltips), sized like the tool
  // palette. The same modes live in the menu too, with labels and a check.
  const MODES = [
    ['present', 'present', 'Present', 'Present — laser only (Alt+P)'],
    ['annotate', 'annotate', 'Annotate', 'Annotate the slides (Alt+A)'],
    ['board', 'board', 'Board', 'Board (Alt+B)'],
  ]
  const modeRail = document.createElement('div')
  modeRail.className = 'mode-rail'
  const railBtns = MODES.map(([m, ic, label, title]) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.dataset.mode = m
    b.title = title
    b.appendChild(icon(ic))
    b.onclick = () => setMode(m)
    modeRail.appendChild(b)
    return b
  })
  document.body.appendChild(modeRail)

  /* ---------- menu (top-right) + settings ---------- */

  const menuWrap = document.createElement('div')
  menuWrap.className = 'menu-wrap'
  const menuBtn = document.createElement('button')
  menuBtn.className = 'menu-btn'
  menuBtn.type = 'button'
  menuBtn.title = 'Menu'
  menuBtn.appendChild(icon('menu'))
  const menu = document.createElement('div')
  menu.className = 'menu-dropdown'
  menu.hidden = true

  // Each item shows its keyboard shortcut on the right (a small kbd), so the menu
  // doubles as a reminder of the keys.
  const menuItem = (label, iconName, shortcut, onclick) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'menu-item'
    b.appendChild(icon(iconName))
    const span = document.createElement('span')
    span.className = 'mi-label'
    span.textContent = label
    b.appendChild(span)
    if (shortcut) {
      const k = document.createElement('span')
      k.className = 'mi-key'
      k.textContent = shortcut
      b.appendChild(k)
    }
    b.onclick = onclick
    return b
  }
  const sepEl = () => { const d = document.createElement('div'); d.className = 'menu-sep'; return d }
  const modeItems = MODES.map(([m, ic, label], k) =>
    menuItem(label, ic, `Alt+${['P', 'A', 'B'][k]}`, () => { menu.hidden = true; setMode(m) }))
  const overviewItem = menuItem('Overview', 'grid', '=', () => { menu.hidden = true; openOverview(boardMode ? 'board' : 'slides') })
  const blankItem = menuItem('Blank screen', 'square', '', () => { menu.hidden = true; toggleBlank() })
  const settingsItem = menuItem('Settings', 'gear', 'Ctrl+,', () => { menu.hidden = true; openSettings() })
  const helpItem = menuItem('Help', 'help', '', () => { menu.hidden = true; help.hidden = false })
  menu.append(...modeItems, sepEl(), overviewItem, blankItem, sepEl(), settingsItem, sepEl(), helpItem)
  menuBtn.onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden }
  document.addEventListener('click', () => { menu.hidden = true })
  menuWrap.append(menuBtn, menu)
  document.body.appendChild(menuWrap)

  // A blank (black) screen that works in any mode — reveal's own pause only covers
  // the deck, which is hidden on the board. Click it or press Esc to return.
  const blank = document.createElement('div')
  blank.className = 'blank-screen'
  blank.hidden = true
  // A faint reminder of the way out — barely visible to an audience, but there for
  // the presenter, who might otherwise not know the black screen is dismissable.
  const blankHint = document.createElement('div')
  blankHint.className = 'blank-hint'
  blankHint.textContent = 'Press Esc or click to return'
  blank.appendChild(blankHint)
  blank.onclick = () => toggleBlank()
  document.body.appendChild(blank)
  let blankOn = false
  function toggleBlank() { blankOn = !blankOn; blank.hidden = !blankOn }

  // Mark the active mode in both the rail and the menu.
  function paintModeUI() {
    for (const b of railBtns) b.classList.toggle('active', b.dataset.mode === mode)
    modeItems.forEach((b, k) => b.classList.toggle('active', MODES[k][0] === mode))
  }

  // The settings dialog, shaped like the editor's: a fixed-size box with a
  // navigation rail on the left and the selected panel on the right. One tab
  // ("Board") for now; the layout is ready for more.
  const settings = document.createElement('div')
  settings.className = 'settings-modal'
  settings.hidden = true
  const dialog = document.createElement('div')
  dialog.className = 'settings-dialog'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-label', 'Settings')
  const head = document.createElement('div')
  head.className = 'dlg-head'
  const h = document.createElement('h2')
  h.textContent = 'Settings'
  const closeBtn = document.createElement('button')
  closeBtn.className = 'dlg-close'
  closeBtn.type = 'button'
  closeBtn.title = 'Close'
  closeBtn.textContent = '×'
  head.append(h, closeBtn)

  const body = document.createElement('div')
  body.className = 'settings-body'
  const tabs = document.createElement('div')
  tabs.className = 'settings-tabs'
  const boardTab = document.createElement('button')
  boardTab.type = 'button'
  boardTab.className = 'settings-tab active'
  boardTab.textContent = 'Board'
  tabs.appendChild(boardTab)
  const panels = document.createElement('div')
  panels.className = 'settings-panels'

  const boardPanel = document.createElement('div')
  boardPanel.className = 'settings-panel'
  const boardH = document.createElement('h3')
  boardH.textContent = 'Board'
  // Surface row (Dark / Light segmented).
  const surfRow = document.createElement('div')
  surfRow.className = 'settings-row'
  const surfLabel = document.createElement('span')
  surfLabel.className = 'settings-label'
  surfLabel.textContent = 'Surface'
  const seg = document.createElement('div')
  seg.className = 'seg'
  const surfBtns = [['dark', 'Dark'], ['light', 'Light']].map(([s, label]) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.dataset.surface = s
    b.textContent = label
    b.onclick = () => setSurface(s)
    seg.appendChild(b)
    return b
  })
  surfRow.append(surfLabel, seg)
  // Grid row (checkbox).
  const gridRow = document.createElement('label')
  gridRow.className = 'settings-row settings-check'
  const gridLabel = document.createElement('span')
  gridLabel.className = 'settings-label'
  gridLabel.textContent = 'Show grid'
  const gridBox = document.createElement('input')
  gridBox.type = 'checkbox'
  gridBox.onchange = () => setGrid(gridBox.checked)
  gridRow.append(gridLabel, gridBox)
  boardPanel.append(boardH, surfRow, gridRow)
  panels.appendChild(boardPanel)

  body.append(tabs, panels)
  dialog.append(head, body)
  settings.appendChild(dialog)
  document.body.appendChild(settings)

  function paintSettings() {
    for (const b of surfBtns) b.classList.toggle('active', b.dataset.surface === boardSurface)
    gridBox.checked = boardGrid
  }
  const openSettings = () => { settings.hidden = false; paintSettings() }
  const closeSettings = () => { settings.hidden = true }
  closeBtn.onclick = closeSettings
  settings.addEventListener('click', (e) => { if (e.target === settings) closeSettings() }) // backdrop

  /* ---------- help dialog (our own key reference) ---------- */

  const HELP = [
    { keys: ['Alt+P', 'Alt+A', 'Alt+B'], desc: 'Present / Annotate / Board' },
    { keys: ['1', '…', '5'], desc: 'Tools: laser, pen, chalk, highlighter, eraser' },
    { keys: ['←', '→', '↑', '↓', 'PgUp', 'PgDn', 'Space'], desc: 'Previous / next' },
    { keys: ['Home', 'End'], desc: 'First / last slide' },
    { keys: ['='], desc: 'Overview of slides or board pages' },
    { keys: ['Ctrl+Z', 'Ctrl+Y'], desc: 'Undo / redo (drawing modes)' },
    { keys: ['Ctrl+click'], desc: 'Open a link through the ink' },
    { keys: [FS_KEY], desc: 'Enter / exit fullscreen mode' },
    { keys: ['Ctrl+,'], desc: 'Settings' },
    { keys: ['Esc'], desc: 'Close a dialog or the blank screen' },
  ]
  const help = document.createElement('div')
  help.className = 'settings-modal'
  help.hidden = true
  const helpDlg = document.createElement('div')
  helpDlg.className = 'settings-dialog help-dialog'
  helpDlg.setAttribute('role', 'dialog')
  helpDlg.setAttribute('aria-label', 'Keyboard shortcuts')
  const helpHead = document.createElement('div')
  helpHead.className = 'dlg-head'
  const helpH = document.createElement('h2')
  helpH.textContent = 'Keyboard shortcuts'
  const helpClose = document.createElement('button')
  helpClose.className = 'dlg-close'
  helpClose.type = 'button'
  helpClose.title = 'Close'
  helpClose.textContent = '×'
  helpHead.append(helpH, helpClose)
  // A two-column table: key badges on the left, what they do on the right.
  const helpTable = document.createElement('table')
  helpTable.className = 'help-table'
  const helpTbody = document.createElement('tbody')
  for (const { keys, desc } of HELP) {
    const tr = document.createElement('tr')
    const kt = document.createElement('td')
    kt.className = 'hk'
    keys.forEach((chord, i) => {
      if (i) kt.appendChild(document.createTextNode(' '))
      if (chord === '…') { kt.appendChild(document.createTextNode('…')); return }
      chord.split('+').forEach((p, j) => {
        if (j) kt.appendChild(document.createTextNode('+'))
        const kbd = document.createElement('kbd')
        kbd.textContent = p
        kt.appendChild(kbd)
      })
    })
    const dt = document.createElement('td')
    dt.className = 'hd'
    dt.textContent = desc
    tr.append(kt, dt)
    helpTbody.appendChild(tr)
  }
  helpTable.appendChild(helpTbody)
  const helpScroll = document.createElement('div')
  helpScroll.className = 'help-scroll'
  helpScroll.appendChild(helpTable)
  helpDlg.append(helpHead, helpScroll)
  help.appendChild(helpDlg)
  document.body.appendChild(help)
  helpClose.onclick = () => { help.hidden = true }
  help.addEventListener('click', (e) => { if (e.target === help) help.hidden = true })

  /* ---------- overview (slides / board pages) ---------- */

  // A scrollable grid of thumbnails, opened with Escape (or 'o') for the current
  // mode: the deck's slides in slides mode, the board's pages in board mode.
  // Arrow keys move the selection, Enter or a click opens it. Rebuilt on each
  // open so a thumbnail reflects the latest content (board strokes especially).
  const overview = document.createElement('div')
  overview.className = 'overview'
  overview.hidden = true
  const overviewGrid = document.createElement('div')
  overviewGrid.className = 'overview-grid'
  overview.appendChild(overviewGrid)
  document.body.appendChild(overview)

  let ovKind = null // 'slides' | 'board' while open, else null
  let ovCards = [] // the card elements, index === item index
  let ovSel = 0
  const overviewOpen = () => ovKind !== null

  // One slide thumbnail: a scaled clone of the slide's rendered content (KaTeX
  // included), minus the ink layer — a content map, not a photo.
  function slideThumb(section) {
    const scale = document.createElement('div')
    scale.className = 'ov-scale'
    section.classList.forEach((c) => { if (c === 'center' || c === 'title') scale.classList.add(c) })
    for (const ch of section.children) {
      if (ch.tagName.toLowerCase() === 'svg') continue // skip the ink overlay
      scale.appendChild(ch.cloneNode(true))
    }
    const page = document.createElement('div')
    page.className = 'ov-page ov-page-slide'
    page.appendChild(scale)
    return page
  }

  // One board-page thumbnail: the surface colour and a clone of its strokes.
  function boardThumb(svgSrc) {
    const svg = document.createElementNS(SVGNS, 'svg')
    svg.setAttribute('class', `ov-board surface-${boardSurface}`)
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
    svg.setAttribute('preserveAspectRatio', 'none')
    if (boardGrid) {
      const grid = document.createElementNS(SVGNS, 'rect')
      grid.setAttribute('width', W)
      grid.setAttribute('height', H)
      grid.setAttribute('fill', `url(#grid-${boardSurface})`)
      svg.appendChild(grid)
    }
    const layer = svgSrc.querySelector('.ink-layer')
    if (layer) svg.appendChild(layer.cloneNode(true))
    const page = document.createElement('div')
    page.className = 'ov-page'
    page.appendChild(svg)
    return page
  }

  function openOverview(kind) {
    ovKind = kind
    overviewGrid.textContent = ''
    ovCards = []
    const items = kind === 'slides' ? sections : boardSvgs
    const current = kind === 'slides' ? reveal.getIndices().h : boardPage
    items.forEach((item, i) => {
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'ov-card'
      card.appendChild(kind === 'slides' ? slideThumb(item) : boardThumb(item))
      const label = document.createElement('span')
      label.className = 'ov-label'
      label.textContent = i + 1
      card.appendChild(label)
      card.onclick = () => { ovSel = i; openSelected() }
      overviewGrid.appendChild(card)
      ovCards.push(card)
    })
    ovSel = Math.min(current, ovCards.length - 1)
    overview.hidden = false
    document.body.classList.add('ov')
    paintOverviewSel(false) // after unhide, so scrollIntoView can measure
  }

  function closeOverview() {
    ovKind = null
    overview.hidden = true
    document.body.classList.remove('ov')
  }

  function paintOverviewSel(scroll = true) {
    ovCards.forEach((c, i) => c.classList.toggle('selected', i === ovSel))
    if (scroll) ovCards[ovSel]?.scrollIntoView({ block: 'nearest' })
  }

  function openSelected() {
    const i = ovSel
    const kind = ovKind
    closeOverview()
    if (kind === 'slides') {
      if (boardMode) setMode('present') // back to the deck (defensive; slides overview opens off-board)
      reveal.slide(i)
    } else {
      if (!boardMode) setMode('board')
      showBoardPage(i)
    }
  }

  // Cards per row (the grid wraps responsively), for up/down movement.
  function overviewCols() {
    if (ovCards.length < 2) return 1
    const top0 = ovCards[0].offsetTop
    let n = 0
    while (n < ovCards.length && ovCards[n].offsetTop === top0) n++
    return Math.max(1, n)
  }
  function overviewMove(dx, dy) {
    let i = ovSel
    if (dx) i = Math.max(0, Math.min(ovCards.length - 1, i + dx))
    if (dy) { const j = i + dy * overviewCols(); if (j >= 0 && j < ovCards.length) i = j }
    ovSel = i
    paintOverviewSel()
  }

  /* ---------- keyboard ---------- */

  // Tools in palette order, for the 1..5 shortcuts.
  const TOOL_KEYS = ['laser', 'pen', 'chalk', 'marker', 'eraser']
  const toggleOverview = () => (overviewOpen() ? closeOverview() : openOverview(boardMode ? 'board' : 'slides'))

  addEventListener('keydown', (e) => {
    const stop = () => { e.stopPropagation(); e.preventDefault() }

    // Alt+P / Alt+A / Alt+B switch modes anywhere (and pre-empt reveal's Alt+B).
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const m = { KeyP: 'present', KeyA: 'annotate', KeyB: 'board' }[e.code]
      if (m) { stop(); if (overviewOpen()) closeOverview(); setMode(m); return }
      if (e.code === 'KeyN') { stop(); return } // swallow reveal's Alt+N
    }

    // Ctrl+, opens Settings (the usual shortcut).
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === ',') {
      stop(); menu.hidden = true; if (settings.hidden) openSettings()
      return
    }

    // While the overview is up it owns the keyboard.
    if (overviewOpen()) {
      switch (e.key) {
        case 'Escape': case '=': stop(); closeOverview(); break
        case 'Enter': stop(); openSelected(); break
        case 'ArrowLeft': stop(); overviewMove(-1, 0); break
        case 'ArrowRight': stop(); overviewMove(1, 0); break
        case 'ArrowUp': case 'PageUp': stop(); overviewMove(0, -1); break
        case 'ArrowDown': case 'PageDown': stop(); overviewMove(0, 1); break
        case 'Home': stop(); ovSel = 0; paintOverviewSel(); break
        case 'End': stop(); ovSel = ovCards.length - 1; paintOverviewSel(); break
      }
      return
    }

    // Escape closes a dialog/menu or leaves the blank screen. When nothing is open
    // it is left ENTIRELY untouched — no stopPropagation, no preventDefault — so the
    // browser can exit F11 fullscreen on Escape (reveal's keyboard is off, so
    // nothing else touches it). We never enter fullscreen from code (see below).
    if (e.key === 'Escape') {
      if (!settings.hidden) { stop(); closeSettings() }
      else if (!help.hidden) { stop(); help.hidden = true }
      else if (!menu.hidden) { stop(); menu.hidden = true }
      else if (blankOn) { stop(); toggleBlank() }
      return
    }
    // '=' opens (or closes) the overview for the current mode.
    if (e.key === '=' && settings.hidden && menu.hidden && help.hidden) { stop(); toggleOverview(); return }

    // We never drive fullscreen ourselves. JS can only start element-fullscreen,
    // which the browser makes you "press and hold Esc" to leave; the browser's own
    // fullscreen (F11 / ⌃⌘F) exits on a single Esc, so we leave it entirely to the
    // browser and only name the key in Help.

    // 1..5 pick a tool (in the drawing modes; Present has only the laser).
    if (mode !== 'present' && e.key >= '1' && e.key <= '5' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const t = TOOL_KEYS[+e.key - 1]
      if (t) { stop(); setTool(t) }
      return
    }

    // Navigation — we drive it ourselves (reveal's keyboard is off): board pages in
    // board mode, the deck otherwise.
    if (boardMode) {
      if (e.key === 'PageDown' || e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
        if (boardPage < boardSvgs.length - 1) { e.preventDefault(); showBoardPage(boardPage + 1) }
        return
      }
      if (e.key === 'PageUp' || e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        if (boardPage > 0) { e.preventDefault(); showBoardPage(boardPage - 1) }
        return
      }
    } else {
      switch (e.key) {
        case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ': e.preventDefault(); reveal.next(); return
        case 'ArrowLeft': case 'ArrowUp': case 'PageUp': e.preventDefault(); reveal.prev(); return
        case 'Home': e.preventDefault(); reveal.slide(0); return
        case 'End': e.preventDefault(); reveal.slide(sections.length - 1); return
      }
    }
  }, true)

  reveal.configure({ keyboard: false }) // we drive all keys ourselves (see the keydown handler)
  applyBoardSurface()
  applyBoardGrid()
  paintModeUI()
  paintNav()
  paintPalette()
  paintCursor()

  // Keep the slide counter in step as the deck is navigated (arrows, controls).
  reveal.on('slidechanged', paintNav)

  // Resume in the mode we left off in (Present by default). setMode applies the
  // board/palette/tool state for that mode.
  if (savedMode === 'annotate' || savedMode === 'board') setMode(savedMode)

  // Undo/redo on the current slide: Ctrl/Cmd+Z undoes; Ctrl+Y or Ctrl/Cmd+Shift+Z
  // redoes. Matched on the physical key (event.code) so a Cyrillic layout does not
  // break it, in capture so reveal does not eat it.
  addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return
    if (mode === 'present') return // no drawing in Present, so no undo/redo
    if (e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); undo() }
    else if (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey)) { e.preventDefault(); redo() }
  }, true)

  // While Ctrl/Cmd is held, let the pointer reach the slide beneath the ink layer,
  // so a click opens a link or selects text even though a tool is active.
  const passthrough = (on) => document.body.classList.toggle('ink-through', on)
  addEventListener('keydown', (e) => { if (e.key === 'Control' || e.key === 'Meta') passthrough(true) })
  addEventListener('keyup', (e) => { if (e.key === 'Control' || e.key === 'Meta') passthrough(false) })
  addEventListener('blur', () => passthrough(false))

  // The projector window can be closed mid-show; make sure the last strokes are
  // written rather than lost to the debounce.
  addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush() })

  return { flush }
}

function sep() {
  const s = document.createElement('span')
  s.className = 'ink-sep'
  return s
}

function button(iconName, title, onclick) {
  const b = document.createElement('button')
  b.type = 'button'
  b.title = title
  b.appendChild(icon(iconName))
  b.onclick = onclick
  return b
}
