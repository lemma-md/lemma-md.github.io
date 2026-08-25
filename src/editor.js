// Ace wrapper.
//
// Ace is ~550 kB — far more than the rest of the app put together — so it is
// injected on demand rather than blocking the first render.

import { loadScript } from './load-script.js'

// Resolved against this module rather than the page: the editor is served from
// /editor/ while vendor/ sits at the root, and a bare relative path would be
// looked up beside the HTML instead. Fails silently when wrong — the editor
// simply never appears — so it is worth stating the base explicitly.
const vendor = (file) => new URL(`../vendor/ace/${file}`, import.meta.url).href

async function loadAce() {
  await loadScript(vendor('ace.js'))
  await Promise.all([
    loadScript(vendor('mode-markdown.js')),
    loadScript(vendor('theme-textmate.js')),
    loadScript(vendor('ext-searchbox.js')),
  ])
}

/**
 * Create the editor in `el`. `onChange` fires on every keystroke with the
 * full text; the caller decides how to debounce it.
 */
export async function createEditor(el, onChange) {
  await loadAce()
  el.textContent = ''

  const editor = ace.edit(el, {
    mode: 'ace/mode/markdown',
    theme: 'ace/theme/textmate',
    wrap: true,
    showLineNumbers: true,
    showGutter: true,
    showPrintMargin: false,
    fontSize: 14,
    scrollPastEnd: 0.5,
    highlightActiveLine: false,
  })

  // Ace measures its viewport at construction, from whatever the flex layout
  // reports at that moment. Re-measuring settles the first paint; the observer
  // then keeps it correct while the splitter is dragged.
  editor.resize(true)
  new ResizeObserver(() => editor.resize()).observe(el)

  // Ace inserts its own text on setValue; suppress the echo so loading a
  // document does not read back as a user edit.
  let quiet = false
  editor.on('change', () => { if (!quiet) onChange(editor.getValue()) })

  return {
    setText(text) {
      quiet = true
      editor.setValue(text ?? '', -1)
      editor.session.getUndoManager().reset()
      quiet = false
      // Repaint now rather than waiting for an animation frame. Swapping a
      // whole document is when a stale view would be most obvious, and this
      // also keeps the editor correct where requestAnimationFrame is
      // suspended — a background tab, or an automated browser.
      editor.renderer.updateFull(true)
    },
    getText: () => editor.getValue(),
    focus: () => editor.focus(),
    resize: () => editor.resize(),
  }
}
