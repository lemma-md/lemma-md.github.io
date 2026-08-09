// Ace wrapper.
//
// Ace is ~550 kB — far more than the rest of the app put together — so it is
// injected on demand rather than blocking the first render.

import { loadScript } from './load-script.js'

async function loadAce() {
  await loadScript('vendor/ace/ace.js')
  await Promise.all([
    loadScript('vendor/ace/mode-markdown.js'),
    loadScript('vendor/ace/theme-textmate.js'),
    loadScript('vendor/ace/ext-searchbox.js'),
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
