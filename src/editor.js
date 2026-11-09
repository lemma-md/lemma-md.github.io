// Ace wrapper.
//
// Ace is ~550 kB — far more than the rest of the app put together — so it is
// injected on demand rather than blocking the first render.

import { loadScript } from './load-script.js'
import { bold, italic } from './markup.js'

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
 * full text; the caller decides how to debounce it. `onPaste` gets the text of
 * a paste once it is in; `onScroll` is told when the text scrolls, and
 * `onSelect` when the cursor moves or the selection changes.
 */
export async function createEditor(el, onChange, { onPaste, onScroll, onSelect } = {}) {
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
  // Ace announces a paste before inserting it.
  if (onPaste) editor.on('paste', (e) => setTimeout(() => onPaste(e.text)))
  if (onScroll) editor.session.on('changeScrollTop', () => onScroll())
  if (onSelect) {
    editor.on('changeSelection', () => onSelect())
    editor.on('changeCursor', () => onSelect())
  }

  /** One change from a button: a step of its own for Ctrl+Z, and the focus
   *  back in the text, where typing goes on. */
  function edit(change) {
    const undo = editor.session.getUndoManager()
    undo.startNewGroup()
    change()
    undo.startNewGroup()
    editor.focus()
  }

  /**
   * The text with its lines joined by \n, whatever the note's own line ends,
   * and the selection in it as offsets: what the commands of markup.js take.
   * A paste from a Windows clipboard into an empty note makes Ace's line ends
   * \r\n, and a \r read as part of a line made `# Title\r` no heading, so the
   * Heading button put in one more # each time.
   */
  function selected() {
    const lines = editor.session.doc.getAllLines()
    const index = (p) => {
      let i = p.column
      for (let r = 0; r < p.row; r++) i += lines[r].length + 1
      return i
    }
    const range = editor.getSelectionRange()
    return { text: lines.join('\n'), start: index(range.start), end: index(range.end) }
  }

  const api = {
    /**
     * The line at the top of the view, 0-based, with how far into it the view
     * has scrolled as a fraction: a long line wraps over several rows.
     */
    topLine() {
      const { session, renderer } = editor
      const row = session.getScrollTop() / renderer.lineHeight
      const line = session.screenToDocumentPosition(Math.floor(row), 0).row
      const first = session.documentToScreenRow(line, 0)
      return line + Math.min(1, Math.max(0, (row - first) / session.getRowLength(line)))
    },
    /**
     * Put the cursor at the start of `line` (0-based). The view moves only if
     * the line is out of it, and then puts it in the middle. Whether it is in
     * view is worked out from the scroll position, not from what Ace last
     * drew: that waits for an animation frame.
     */
    revealLine(line) {
      const { session, renderer } = editor
      editor.clearSelection()
      editor.moveCursorTo(line, 0)
      const row = session.documentToScreenRow(line, 0)
      const top = session.getScrollTop() / renderer.lineHeight
      const rows = renderer.scroller.clientHeight / renderer.lineHeight
      if (row < top || row + 1 > top + rows) editor.scrollToLine(line, true, false, () => {})
      editor.focus()
    },
    /** Scroll so that `line` (0-based, fractional as topLine gives it) is at the top. */
    scrollToTop(line) {
      const { session, renderer } = editor
      const whole = Math.max(0, Math.min(session.getLength() - 1, Math.floor(line)))
      const row = session.documentToScreenRow(whole, 0) + (line - whole) * session.getRowLength(whole)
      session.setScrollTop(row * renderer.lineHeight)
    },
    /** The line the cursor is on, 0-based. */
    cursorLine: () => editor.getCursorPosition().row,
    undo: () => { editor.undo(); editor.focus() },
    redo: () => { editor.redo(); editor.focus() },
    canUndo: () => editor.session.getUndoManager().hasUndo(),
    canRedo: () => editor.session.getUndoManager().hasRedo(),
    // Ace's own search box, opened as its keys open it; Replace opens with the
    // replace field showing, which is what was hard to find.
    find: () => editor.execCommand('find'),
    replace: () => editor.execCommand('replace'),

    /**
     * Apply one of the commands of markup.js to the text and the selection:
     * the edit it returns, then the selection it says.
     */
    format(command) {
      const { text, start, end } = selected()
      const e = command(text, start, end)
      if (!e) return
      const Range = editor.getSelectionRange().constructor
      const place = (s, i) => {
        const row = s.slice(0, i).split('\n').length - 1
        return { row, column: i - s.lastIndexOf('\n', i - 1) - 1 }
      }
      const after = text.slice(0, e.from) + e.insert + text.slice(e.to)
      const span = (s, a, b) => {
        const p = place(s, a)
        const q = place(s, b)
        return new Range(p.row, p.column, q.row, q.column)
      }
      edit(() => {
        editor.session.replace(span(text, e.from, e.to), e.insert)
        editor.selection.setSelectionRange(span(after, e.start, e.end))
      })
    },
    /** Ask `query` of markup.js about the text and the selection, as `format` gives them. */
    look: (query) => {
      const { text, start, end } = selected()
      return query(text, start, end)
    },
    /**
     * Replace the whole text as an edit, which Ctrl+Z takes back in one step,
     * and not with the edits around it. The cursor and the scroll stay where
     * they were, as far as the new text allows.
     */
    replaceAll(text) {
      const { session } = editor
      const undo = session.getUndoManager()
      const cursor = editor.getCursorPosition()
      const top = session.getScrollTop()
      undo.startNewGroup()
      session.doc.setValue(text)
      undo.startNewGroup()
      editor.clearSelection()
      editor.moveCursorToPosition(session.doc.clippedPos(cursor.row, cursor.column))
      session.setScrollTop(top)
      editor.renderer.updateFull(true)
    },
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

  // The keys a word processor has for bold and italic. Inside the editor they
  // are its own: Ace takes the key before the browser sees it.
  editor.commands.addCommands([
    { name: 'bold', bindKey: { win: 'Ctrl-B', mac: 'Command-B' }, exec: () => api.format(bold) },
    { name: 'italic', bindKey: { win: 'Ctrl-I', mac: 'Command-I' }, exec: () => api.format(italic) },
  ])

  return api
}
