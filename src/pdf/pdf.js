// The PDF export window. A static, reveal-free print page: it reads a note and
// its annotations from the same IndexedDB the editor and projector use, lays each
// slide out as one fixed 960x700 page with its ink on top, appends the non-empty
// board pages, and opens the system print dialog (Save as PDF). Nothing here
// changes the note, its saved text, its dirty state or its annotations.
//
// The presenter opens this window after flush()ing its ink, so the annotations in
// IndexedDB are current — no cross-window snapshot protocol is needed.

import * as drafts from '../drafts.js'
import { render } from '../viewer.js'
import { buildDeckSections } from '../present/deck-dom.js'
import { extractFrontMatter } from '../present/slides.js'
import {
  W,
  H,
  PALETTES,
  buildDefs,
  createAnnotationSvg,
  createBoardSvg,
  nonEmptyBoards,
  annotationBottom,
} from '../present/ink-svg.js'

const params = new URLSearchParams(location.search)
// `&embed=1` when shown inside the in-page preview modal (an iframe): no
// auto-print (the user prints from the panel), and Close asks the parent to
// remove the modal. `&auto=0` is a testing hook that also suppresses auto-print.
const EMBED = params.get('embed') === '1'
const AUTO_PRINT = params.get('auto') !== '0' && !EMBED
// `&mode=doc` prints the note as a flowing A4 document (like a word processor);
// anything else prints slides (960×700). `&ink=1` includes the presentation
// annotations and board pages — only the projector sets it; the editor never
// prints ink, because those belong to a presentation, not the document.
const MODE = params.get('mode') === 'doc' ? 'doc' : 'slides'
const INK = params.get('ink') === '1'
const OVERFLOW_TOLERANCE = 2 // px slack before a slide counts as taller than a page

const deckEl = document.getElementById('deck')
const stageEl = document.getElementById('stage')

// Everything the render step needs, filled by main().
const deck = {
  sections: [], // one <section> per ordinal, ink already attached
  boards: [], // [{ index, strokes }]
  boardSurface: 'dark',
  boardGrid: true,
  overflow: [], // [{ i, num, bands }] for slides taller than one page
  failedImages: [], // <img>s that did not load, shown on the ready panel
  record: null, // the annotation record, only when exporting ink (the projector)
}

const rafOnce = () =>
  // An automated/background tab never fires requestAnimationFrame (its rAF is
  // parked), so race it against a timeout — otherwise readiness would hang.
  new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    requestAnimationFrame(finish)
    setTimeout(finish, 300)
  })

async function twoFrames() {
  await rafOnce()
  await rafOnce()
}

function fail(message) {
  stageEl.innerHTML = ''
  const h = document.createElement('h2')
  h.textContent = 'Export as PDF'
  const p = document.createElement('p')
  p.className = 'pdf-error'
  p.textContent = message
  stageEl.append(h, p)
  addActions([['Close', closeExport, false]])
}

/** Open the system print dialog (Save as PDF). Inside the modal's iframe this
 *  prints only the iframe, so the app behind it is not printed. Chromium names the
 *  file after the *top* document's title even then, so lend it this page's title
 *  (`<note>.pdf`) for the duration of the dialog, then restore it. */
function doPrint() {
  let top
  let saved
  try {
    top = window.top
    saved = top.document.title
    top.document.title = document.title
  } catch {
    top = null // cross-origin top (not expected on this same-origin app)
  }
  const restore = () => {
    if (top && saved !== undefined) {
      try { top.document.title = saved } catch { /* ignore */ }
    }
  }
  window.addEventListener('afterprint', restore, { once: true })
  window.print()
  setTimeout(restore, 1000) // fallback if afterprint does not fire
}

/** Close the export: ask the parent to dismiss its modal when embedded, else
 *  close the standalone window. */
function closeExport() {
  if (EMBED) {
    try {
      parent.postMessage({ type: 'pdf-close' }, location.origin)
    } catch {
      /* no reachable parent */
    }
  } else {
    window.close()
  }
}

/** Scale the on-screen preview to fit the viewport width — a fixed 960px page
 *  would otherwise overflow a narrow modal. Print ignores this (it is @media
 *  screen); it re-runs on resize. */
function fit() {
  if (MODE === 'doc') return // the A4 document shows at natural size and scrolls
  const z = Math.min(1, (window.innerWidth - 24) / (W + 40))
  document.documentElement.style.setProperty('--pdf-zoom', z > 0 ? z.toFixed(4) : '1')
}

/** Render an action row into the stage panel. `items` is [[label, fn, primary]]. */
function addActions(items) {
  const row = document.createElement('div')
  row.className = 'pdf-actions'
  for (const [label, fn, primary] of items) {
    const b = document.createElement('button')
    b.textContent = label
    if (primary) b.className = 'primary'
    b.addEventListener('click', fn)
    row.appendChild(b)
  }
  stageEl.appendChild(row)
}

/** A scaled thumbnail of a slide section, so an overflow warning is concrete. */
function thumbnail(section, num) {
  const wrap = document.createElement('div')
  wrap.className = 'pdf-thumb'
  const scale = document.createElement('div')
  scale.className = 'pdf-thumb-scale'
  // Match the deck's base type size and center/title layout so the thumbnail
  // reads like the page it stands for.
  const body = section.querySelector('.slide-body')
  if (body) scale.style.fontSize = getComputedStyle(body).fontSize
  section.classList.forEach((c) => {
    if (c === 'center' || c === 'title') scale.classList.add(c)
  })
  for (const child of section.children) {
    if (child.tagName.toLowerCase() === 'svg') continue // skip the ink overlay
    scale.appendChild(child.cloneNode(true))
  }
  const badge = document.createElement('span')
  badge.className = 'pdf-thumb-num'
  badge.textContent = num
  wrap.append(scale, badge)
  return wrap
}

/** One continuation band of a tall slide: the body shifted up by k whole pages,
 *  clipped to 700, and the ink viewBox moved to the same band. */
function bandPage(section, k) {
  const page = section.cloneNode(true)
  const body = page.querySelector('.slide-body')
  if (body) {
    body.classList.add('pdf-band')
    body.style.transform = `translateY(${-k * H}px)`
  }
  const svg = page.querySelector('svg.ink')
  if (svg) svg.setAttribute('viewBox', `0 ${k * H} ${W} ${H}`)
  return page
}

/** One board page: a real background rect, grid, and its strokes. */
function boardPage(board) {
  const section = document.createElement('section')
  section.className = 'pdf-page pdf-board'
  section.appendChild(
    createBoardSvg(board.strokes, {
      surface: deck.boardSurface,
      grid: deck.boardGrid,
      chalkFilter: false,
    }),
  )
  return section
}

/** (Re)build the deck DOM for the given overflow handling. `mode` is 'clip' (each
 *  slide one page, tall content clipped) or 'continue' (a tall slide spans as many
 *  pages as it needs). Boards always follow the last slide, in numeric order. */
function buildDeck(mode) {
  deckEl.textContent = ''
  deck.sections.forEach((section, i) => {
    const over = mode === 'continue' && deck.overflow.find((o) => o.i === i)
    if (over && over.bands > 1) {
      for (let k = 0; k < over.bands; k++) deckEl.appendChild(bandPage(section, k))
    } else {
      deckEl.appendChild(section)
    }
  })
  for (const board of deck.boards) deckEl.appendChild(boardPage(board))
}

/** The document-mode base type size: front-matter `fontsize` / `font-size`, a bare
 *  number taken as points (the unit a document is set in), else the CSS length as
 *  given; default 12pt. */
function docFontSize(meta) {
  const raw = meta && (meta.fontsize ?? meta['font-size'])
  if (!raw) return '12pt'
  const s = String(raw).trim()
  return /^\d+(\.\d+)?$/.test(s) ? `${s}pt` : s
}

/** Build the note as one flowing document (A4 in print), not slides: the whole
 *  markdown rendered once, so print pagination breaks it across pages naturally.
 *  No slides, no ink, no boards. Front-matter is parsed only for the base size and
 *  is not shown. */
function buildDocument(doc) {
  const { meta, body } = extractFrontMatter(doc.text)
  deckEl.textContent = ''
  const article = document.createElement('article')
  article.className = 'md pdf-doc'
  article.style.fontSize = docFontSize(meta)
  article.innerHTML = render(body)
  deckEl.appendChild(article)
}

/** Wait for fonts and images so the print is faithful; report any failed image. */
async function waitForResources() {
  try {
    await document.fonts.ready
  } catch {
    /* fonts API optional; geometry still stands */
  }
  const imgs = [...deckEl.querySelectorAll('img')]
  const failed = []
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise((resolve) => {
          let settled = false
          const finish = (isFail) => {
            if (settled) return
            settled = true
            if (isFail) failed.push(img)
            resolve()
          }
          const broken = () => img.naturalWidth === 0 && !!(img.currentSrc || img.getAttribute('src'))
          if (img.complete) return finish(broken())
          img.addEventListener('load', () => finish(false), { once: true })
          img.addEventListener('error', () => finish(true), { once: true })
          // A stuck image must not block export forever; if it still has not
          // loaded when the timeout fires, report it rather than drop it silently.
          setTimeout(() => finish(!img.complete || broken()), 8000)
        }),
    ),
  )
  await twoFrames()
  return { failed }
}

/** Measure which slides are taller than one page (content or ink below the fold),
 *  and how many pages each would need. Boards are always a single page. */
function measureOverflow() {
  const overflow = []
  deck.sections.forEach((section, i) => {
    if (section.classList.contains('title')) return // the title page always fits
    const body = section.querySelector('.slide-body')
    const contentH = body ? body.scrollHeight : section.scrollHeight
    const inkBottom = deck.record ? annotationBottom(deck.record.slides?.[i]) : 0
    const need = Math.max(contentH, inkBottom)
    if (need > H + OVERFLOW_TOLERANCE) {
      overflow.push({ i, num: i + 1, bands: Math.max(1, Math.ceil(need / H)) })
    }
  })
  return overflow
}

/** The 1-based page a node sits on (its position among the slide pages), or null
 *  in document mode where pages are formed dynamically by print pagination. */
function pageNumberOf(node) {
  const page = node.closest('.pdf-page')
  const idx = page ? [...deckEl.children].indexOf(page) : -1
  return idx >= 0 ? idx + 1 : null
}

/** The ready panel: the print action, and — if any images failed — the list of
 *  them inline (one per line, page number + the source as a link). There is no
 *  separate error panel; a failed image never blocks the export, it is just
 *  reported here so the user knows what will be missing. */
function showReady() {
  stageEl.innerHTML = ''
  const h = document.createElement('h2')
  h.textContent = 'Ready to print'
  stageEl.append(h)

  const failed = deck.failedImages
  if (failed.length) {
    const p = document.createElement('p')
    p.textContent =
      failed.length > 1
        ? `${failed.length} images could not be loaded and will be missing:`
        : 'One image could not be loaded and will be missing:'
    const ul = document.createElement('ul')
    ul.className = 'pdf-error-list'
    for (const img of failed) {
      const src = img.currentSrc || img.getAttribute('src') || ''
      const li = document.createElement('li')
      const pn = pageNumberOf(img) // null in document mode (pages are dynamic)
      if (pn != null) {
        const tag = document.createElement('span')
        tag.className = 'pdf-error-page'
        tag.textContent = `Page ${pn}`
        li.appendChild(tag)
      }
      const a = document.createElement('a')
      a.href = src
      a.textContent = src || 'unknown source'
      a.title = src // full URL on hover; the row itself is a single, trimmed line
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      li.appendChild(a)
      ul.appendChild(li)
    }
    stageEl.append(p, ul)
  } else {
    const p = document.createElement('p')
    p.textContent = 'Choose "Save as PDF" as the destination in the print dialog.'
    stageEl.append(p)
  }

  addActions([
    ['Save as PDF', doPrint, true],
    ['Close', closeExport, false],
  ])
}

/** The panel shown when slides overflow: the offending thumbnails and a choice. */
function showOverflowChoice() {
  stageEl.innerHTML = ''
  const h = document.createElement('h2')
  h.textContent = 'Some slides are taller than one page'
  const p = document.createElement('p')
  const nums = deck.overflow.map((o) => o.num).join(', ')
  p.textContent = `Slide${deck.overflow.length > 1 ? 's' : ''} ${nums} won't fit on a single page. Choose how to export ${deck.overflow.length > 1 ? 'them' : 'it'}:`
  const thumbs = document.createElement('div')
  thumbs.className = 'pdf-thumbs'
  for (const o of deck.overflow) thumbs.appendChild(thumbnail(deck.sections[o.i], o.num))
  stageEl.append(h, p, thumbs)
  addActions([
    ['Continue on next pages', () => applyMode('continue'), true],
    ['Clip to one page', () => applyMode('clip'), false],
    ['Cancel', closeExport, false],
  ])
}

/** Rebuild for the chosen overflow handling, then show the ready panel. Printing
 *  is a separate, explicit step so the preview can be reviewed first. */
async function applyMode(mode) {
  buildDeck(mode)
  const { failed } = await waitForResources()
  deck.failedImages = failed
  fit()
  showReady()
}

async function main() {
  document.body.dataset.mode = MODE // drives the @page choice (slide vs A4) in pdf.css

  const id = params.get('id')
  if (!id) return fail('No note to export. Open a note and choose Export as PDF.')

  const doc = await drafts.getDoc(id).catch(() => null)
  if (!doc) return fail('That note could not be found in this browser.')
  // The suggested file name: the note's name with its .md/.markdown extension
  // swapped for .pdf (matching the .html export). doPrint() lends this title to
  // the top document so Chromium names the file after the note, not the tab.
  const base = doc.name.replace(/\.(md|markdown|txt)$/i, '') || 'note'
  document.title = `${base}.pdf`

  if (MODE === 'doc') {
    // A plain note: one flowing A4 document. No slides, ink or boards — and no
    // overflow choice, since print pagination breaks it across pages itself.
    if (!doc.text.trim()) return fail('This note is empty — nothing to export.')
    buildDocument(doc)
    const { failed } = await waitForResources()
    deck.failedImages = failed
    showReady()
    if (AUTO_PRINT && !failed.length) doPrint()
    return
  }

  // Slides. Annotations and boards are included only with `ink` (the projector);
  // the editor exports the deck content alone.
  if (INK) {
    // The shared <defs> so a board's `url(#grid-*)` fill resolves and prints.
    document.body.appendChild(buildDefs())
    const record = (await drafts.getAnnotations(id).catch(() => null)) || { slides: {} }
    const surface = await drafts.getMeta('present-board-surface').catch(() => null)
    const grid = await drafts.getMeta('present-board-grid').catch(() => null)
    deck.boardSurface = surface === 'light' || surface === 'dark' ? surface : 'dark'
    deck.boardGrid = grid !== false
    deck.record = record
    deck.boards = nonEmptyBoards(record)
  }

  const { sections } = buildDeckSections(doc.text)
  sections.forEach((section, i) => {
    section.classList.add('pdf-page')
    const strokes = INK ? deck.record.slides?.[i] : null
    if (Array.isArray(strokes) && strokes.length) {
      section.appendChild(createAnnotationSvg(strokes, { palette: PALETTES.light, chalkFilter: false }))
    }
  })
  deck.sections = sections
  if (!deck.sections.length && !deck.boards.length) return fail('This note is empty — nothing to export.')

  // Lay out in clip mode first so we can measure natural heights, then decide.
  buildDeck('clip')
  const { failed } = await waitForResources()
  deck.failedImages = failed
  deck.overflow = measureOverflow()
  fit()

  if (deck.overflow.length) {
    showOverflowChoice() // a real choice: never silently clip, never auto-print
    return
  }

  // Straight to the ready panel; any failed images are listed on it. Auto-print
  // only when the deck is clean, so a missing image is seen before printing.
  showReady()
  if (AUTO_PRINT && !failed.length) doPrint()
}

window.addEventListener('resize', fit)
// When embedded, let Escape (with focus inside the iframe) close the modal too.
if (EMBED) document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeExport() })

main().catch((err) => {
  console.error(err)
  fail(`Could not prepare the PDF.\n\n${err?.message ?? err}`)
})
