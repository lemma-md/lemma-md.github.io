// Pure ink geometry and static SVG rendering, shared by the interactive
// presenter (ink.js) and the PDF export (pdf/pdf.js). Nothing here touches the
// live document, IndexedDB or pointer events: it is the one place that knows how
// a stroke becomes an SVG path, so the projector and the exported PDF draw ink
// identically. Keeping a second copy in the PDF module is exactly what this file
// exists to prevent.

const SVGNS = 'http://www.w3.org/2000/svg'

// Must equal the width/height reveal is initialised with (present.js), so a
// pointer position and a saved stroke map into the same space the slide content
// lives in.
export const W = 960
export const H = 700

// Per-tool stroke geometry, in slide-space units. Marker is wide and drawn
// translucent (see the .stroke-marker rules) so it reads as a highlighter.
export const WIDTHS = { pen: 3, chalk: 5.5, marker: 20 }

// Tools whose width varies along the stroke (stored per point). The marker stays
// a uniform highlighter.
export const VARIABLE = new Set(['pen', 'chalk'])

// The blackboard's colour (kept in sync with present.css `.board-ink.surface-dark`).
export const BOARD_DARK = '#14231d'

// Notebook grid: cell size in slide-space units, so it scales with the board (the
// same proportion at any projector resolution) rather than a fixed screen size.
export const GRID_CELL = 38

// Two swatch palettes, aligned slot-for-slot so switching surface keeps a
// colour's "role". `light` is ink for white surfaces (slides, whiteboard);
// `dark` is chalk for the blackboard — light pastels, and the near-black slot
// becomes white. The active palette is chosen by surface.
export const PALETTES = {
  light: ['#e11d48', '#2563eb', '#059669', '#111827', '#f59e0b'],
  dark: ['#ff6b7d', '#6cb2ff', '#46d6a1', '#f4f4f5', '#ffce6b'],
}

// A filled outline for a variable-width stroke: offset each centre point by half
// its width along the normal, trace one side forward and the other back, with
// round end caps. `dw` is the fallback width for points that carry none (old data).
export function ribbonPath(points, dw) {
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

export function pathData(points) {
  if (!points.length) return ''
  return points.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
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
export function markerColor(hex) {
  if (MARKER_TINTS[hex]) return MARKER_TINTS[hex]
  const [h, s, l] = hexToHsl(hex)
  if (l > 0.7) return hex // already a light chalk colour — tinting would distort its hue
  return hslToHex(h, Math.max(s, 0.85), 0.62)
}

// One stroke as an SVG <path>. `pal` is the palette of the surface the stroke is
// drawn on, so its slot resolves to the right hex for that surface (old data may
// carry a hex instead). The export profile (`chalkFilter: false`) drops the
// url(#chalk) filter, whose feTurbulence/displacement would rasterise the layer
// in a printed PDF; the stroke is then a solid ribbon of the same colour.
export function strokeElement(s, pal, { chalkFilter = true } = {}) {
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
  if (s.tool === 'chalk' && chalkFilter) el.setAttribute('filter', 'url(#chalk)') // grainy, rough edge
  return el
}

// The shared <defs>: the chalk texture filter (referenced by url(#chalk)) and the
// two notebook-grid patterns (url(#grid-dark|light)). userSpaceOnUse anchors the
// noise and grid to slide coordinates, so they do not shimmer as a stroke grows.
// Returned as a zero-size <svg> to append once per document.
export function buildDefs() {
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
  return defs
}

// A static ink overlay for one slide: an <svg> in slide space with the strokes
// drawn in array order (which is their stacking order). `palette` is the surface
// palette (slides are always 'light'). Used by the PDF export; the presenter
// builds its live layer itself so it can mutate it.
export function createAnnotationSvg(strokes, { palette = PALETTES.light, chalkFilter = false } = {}) {
  const svg = document.createElementNS(SVGNS, 'svg')
  svg.setAttribute('class', 'ink')
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
  svg.setAttribute('preserveAspectRatio', 'none')
  const layer = document.createElementNS(SVGNS, 'g')
  layer.setAttribute('class', 'ink-layer')
  for (const s of strokes || []) layer.appendChild(strokeElement(s, palette, { chalkFilter }))
  svg.appendChild(layer)
  return svg
}

// A static board page: a real background <rect> (so a dark board prints even
// without the browser's "Background graphics" option), the notebook grid when
// enabled, then the strokes — in that order.
export function createBoardSvg(strokes, { surface = 'dark', grid = false, chalkFilter = false } = {}) {
  const svg = document.createElementNS(SVGNS, 'svg')
  svg.setAttribute('class', `ink board-ink surface-${surface}`)
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
  svg.setAttribute('preserveAspectRatio', 'none')
  const bg = document.createElementNS(SVGNS, 'rect')
  bg.setAttribute('x', '0')
  bg.setAttribute('y', '0')
  bg.setAttribute('width', W)
  bg.setAttribute('height', H)
  bg.setAttribute('fill', surface === 'dark' ? BOARD_DARK : '#ffffff')
  svg.appendChild(bg)
  if (grid) {
    const g = document.createElementNS(SVGNS, 'rect')
    g.setAttribute('width', W)
    g.setAttribute('height', H)
    g.setAttribute('fill', `url(#grid-${surface})`)
    svg.appendChild(g)
  }
  const pal = PALETTES[surface === 'dark' ? 'dark' : 'light']
  const layer = document.createElementNS(SVGNS, 'g')
  layer.setAttribute('class', 'ink-layer')
  for (const s of strokes || []) layer.appendChild(strokeElement(s, pal, { chalkFilter }))
  svg.appendChild(layer)
  return svg
}

// The board pages worth printing: those with at least one visible stroke, in
// numeric order. undo/redo history does not count as content, and gaps in the
// numbering are fine (a page erased to empty is skipped). Keys are `board:N` in
// the annotation record's `slides` map.
export function nonEmptyBoards(record) {
  const slides = (record && record.slides) || {}
  return Object.entries(slides)
    .flatMap(([key, strokes]) => {
      const m = /^board:(\d+)$/.exec(key)
      return m && Array.isArray(strokes) && strokes.length > 0 ? [{ index: Number(m[1]), strokes }] : []
    })
    .sort((a, b) => a.index - b.index)
}

// The lowest point any stroke reaches, in slide-space y. On a tall (scrolled)
// slide a stroke can sit below the 700 fold, so this feeds overflow detection in
// the PDF export independently of the content's own height.
export function annotationBottom(strokes) {
  let max = 0
  for (const s of strokes || []) for (const p of s.points || []) if (p[1] > max) max = p[1]
  return max
}
