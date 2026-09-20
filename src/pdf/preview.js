// The in-page PDF export preview: a modal that frames an <iframe> onto the export
// page (pdf/), shown instead of a separate browser window. Printing is invoked
// from inside the iframe (its Save-as-PDF button), which prints only that frame's
// pages — the app behind it is not printed. Shared by the projector (ink.js) and
// the editor (app.js); both reach pdf/ at ../pdf/ from their own page.
//
// The export reads the note and its annotations from IndexedDB, so callers flush
// whatever they hold (the presenter its ink, the editor its debounced text)
// before opening this.

const CLOSE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'

/**
 * Open the preview modal for a note id. No-op without an id.
 *
 * Options steer the export page:
 * - `ink: true` includes the presentation annotations and board pages (only the
 *   projector sets this; the editor has no ink to print).
 * - `mode: 'slides' | 'doc'` picks the layout — fixed 960×700 slide pages, or a
 *   flowing A4 document. Defaults to 'slides' on the export page.
 */
export function openPdfPreview(noteId, { ink = false, mode } = {}) {
  if (!noteId) return

  const overlay = document.createElement('div')
  overlay.className = 'pdf-modal'
  const frame = document.createElement('div')
  frame.className = 'pdf-modal-frame'
  const bar = document.createElement('div')
  bar.className = 'pdf-modal-bar'
  const title = document.createElement('span')
  title.className = 'pdf-modal-title'
  title.textContent = 'Export as PDF'
  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.setAttribute('aria-label', 'Close')
  closeBtn.innerHTML = CLOSE_ICON
  bar.append(title, closeBtn)
  const iframe = document.createElement('iframe')
  // Relative to the host page (/editor/ or /present/), both of which sit beside
  // /pdf/, so ../pdf/ resolves correctly from either.
  const q = new URLSearchParams({ id: noteId, embed: '1' })
  if (ink) q.set('ink', '1')
  if (mode) q.set('mode', mode)
  iframe.src = `../pdf/?${q}`
  frame.append(bar, iframe)
  overlay.appendChild(frame)

  const close = () => {
    overlay.remove()
    window.removeEventListener('message', onMsg)
    document.removeEventListener('keydown', onKey, true)
  }
  // The iframe's panel posts this when its Close/Cancel is used.
  const onMsg = (e) => {
    if (e.origin === location.origin && e.data && e.data.type === 'pdf-close') close()
  }
  // Esc closes the modal when focus is in the host page (the iframe handles Esc
  // when focus is inside it). Capture-phase + stop so a host keyboard handler that
  // does not know about the modal does not also act on this Esc.
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close() }
  }
  closeBtn.onclick = close
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })
  window.addEventListener('message', onMsg)
  document.addEventListener('keydown', onKey, true)
  document.body.appendChild(overlay)
}
