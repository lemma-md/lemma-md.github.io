import { render } from './viewer.js'
import { createEditor } from './editor.js'
import { initSettings } from './settings.js'
import * as drafts from './drafts.js'
import { register, availableProviders, providerFor } from './storage/index.js'
import { googleDrive } from './storage/gdrive.js'

register(googleDrive)

const SAMPLE = `# Welcome to lemma-md

You are reading this note as a finished page. Press **Edit** to see the plain
text behind it: source on the left, result on the right, changing as you type.

Inline formulas go between single dollars: $e^{i\\pi} + 1 = 0$.
Display formulas go between double dollars:

$$
\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
$$

## The markdown you actually need

- \`#\` starts a heading, \`##\` a subheading
- \`*italic*\` gives *italic*, \`**bold**\` gives **bold**
- a line starting with \`-\` becomes a list item

That is the whole language. Everything else is optional.

## Anything TeX-shaped works

$$
\\begin{aligned}
  (a+b)^2 &= a^2 + 2ab + b^2 \\\\
  \\zeta(s) &= \\sum_{n=1}^{\\infty} \\frac{1}{n^s}
\\end{aligned}
$$

> Drafts live in **this browser only** — nothing is uploaded anywhere.
> Use *Download as .md* in the menu to keep a copy as a file.
`

const state = { docs: new Map(), openIds: [], activeId: null, mode: 'view' }
let editor = null

const el = {
  tabs: document.getElementById('tabs'),
  preview: document.getElementById('preview'),
  editor: document.getElementById('editor'),
  editorPane: document.getElementById('editor-pane'),
  splitter: document.getElementById('splitter'),
  fileInput: document.getElementById('file-input'),
  modeBtn: document.getElementById('btn-mode'),
  menuBtn: document.getElementById('btn-menu'),
  menu: document.getElementById('menu'),
}

const active = () => state.docs.get(state.activeId) ?? null

/* ---------- persistence ---------- */

let saveTimer = null
function scheduleSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const doc = active()
    if (doc) drafts.putDoc(doc).catch(reportError)
  }, 400)
}

/**
 * Write a document immediately, bypassing the debounce. The in-memory document
 * is always current — only the database write is delayed — so this captures
 * whatever was typed last.
 */
const saveNow = (doc) => (doc ? drafts.putDoc(doc).catch(reportError) : Promise.resolve())

const saveSession = () =>
  drafts
    .putSession({ openIds: state.openIds, activeId: state.activeId, mode: state.mode })
    .catch(reportError)

function reportError(err) {
  console.error(err)
}

/* ---------- rendering ---------- */

let previewTimer = null
function schedulePreview() {
  clearTimeout(previewTimer)
  previewTimer = setTimeout(updatePreview, 120)
}

const EMPTY_STATE =
  '<p class="empty-note">No note is open. Start one with <strong>New</strong>, ' +
  'load a file with <strong>Open</strong>, or reopen a closed note from ' +
  '<strong>Settings</strong>.</p>'

function updatePreview() {
  const doc = active()
  el.preview.innerHTML = doc ? render(doc.text) : EMPTY_STATE
}

function renderTabs() {
  el.tabs.textContent = ''
  let activeTab = null
  for (const id of state.openIds) {
    const doc = state.docs.get(id)
    if (!doc) continue

    const tab = document.createElement('div')
    tab.className = 'tab' + (id === state.activeId ? ' active' : '')
    tab.onclick = () => setActive(id)

    if (doc.text !== doc.savedText) {
      const dot = document.createElement('span')
      dot.className = 'dot'
      dot.textContent = '•'
      dot.title = 'Edited since it was last saved'
      tab.append(dot)
    }

    const name = document.createElement('span')
    name.textContent = doc.name
    tab.append(name)

    const close = document.createElement('button')
    close.className = 'close'
    close.textContent = '×'
    close.title = 'Close'
    close.onclick = (e) => { e.stopPropagation(); closeTab(id) }
    tab.append(close)

    if (id === state.activeId) activeTab = tab
    el.tabs.append(tab)
  }

  // The strip wraps and is capped at three rows, so with many notes the active
  // one can sit below the fold. `nearest` scrolls the strip and nothing else.
  activeTab?.scrollIntoView({ block: 'nearest' })
}

/* ---------- reading and writing ---------- */

/**
 * Build the editor the first time writing is asked for, and never again.
 *
 * The promise is what gets cached, not the editor: Ace takes a moment to
 * arrive, and two quick presses of the toggle would otherwise start building
 * two of them.
 */
let editorPromise = null
function ensureEditor() {
  if (!editorPromise) {
    editorPromise = createEditor(el.editor, onEdit).then((created) => {
      editor = created
      const doc = active()
      if (doc) editor.setText(doc.text)
      return editor
    })
  }
  return editorPromise
}

function renderModeButton() {
  const willEdit = state.mode === 'view'
  el.modeBtn.querySelector('.label').textContent = willEdit ? 'Edit' : 'Read'
  el.modeBtn.querySelector('use').setAttribute('href', willEdit ? '#icon-write' : '#icon-read')
  const key = shortcutLabel(SHORTCUTS.find((s) => s.id === 'btn-mode'))
  el.modeBtn.title = willEdit
    ? `Edit this note (${key})`
    : `Put the editor away and just read (${key})`
}

/**
 * Reading is the default, and it is the cheap one: in view mode Ace is never
 * fetched at all, which is most of what the app weighs. Someone who was sent a
 * note and only wants to read it pays for the renderer and nothing else.
 */
async function setMode(mode, { focus = false } = {}) {
  state.mode = mode
  document.body.dataset.mode = mode
  renderModeButton()
  saveSession()

  if (mode !== 'edit') return
  try {
    const ed = await ensureEditor()
    // The pane was display:none until a moment ago, so Ace measured nothing.
    ed.resize()
    if (focus) ed.focus()
  } catch (err) {
    reportError(err)
    el.editor.textContent = 'Could not load the editor. See the browser console.'
  }
}

const toggleMode = () => setMode(state.mode === 'edit' ? 'view' : 'edit', { focus: true })

/* ---------- menu ---------- */

/**
 * Everything occasional lives behind one button, leaving the bar to the toggle
 * and the tab strip. The entries are ordinary buttons that kept their ids, so
 * whatever wires or hides them elsewhere is unaffected by the move.
 */
function setMenuOpen(open) {
  el.menu.hidden = !open
  el.menuBtn.setAttribute('aria-expanded', String(open))
}

const closeMenu = () => setMenuOpen(false)

el.menuBtn.onclick = (e) => {
  e.stopPropagation() // else the document listener below closes it again
  setMenuOpen(el.menu.hidden)
}

// A menu that will not go away is worse than no menu: any click outside and any
// choice inside dismiss it. Escape is handled with the other keys, below.
document.addEventListener('click', (e) => {
  if (!el.menu.hidden && !el.menu.contains(e.target)) closeMenu()
})
el.menu.addEventListener('click', (e) => { if (e.target.closest('button')) closeMenu() })

/* ---------- document actions ---------- */

function addDoc(name, text, remote = null) {
  const doc = {
    id: crypto.randomUUID(),
    name,
    text,
    savedText: text,
    remote,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  state.docs.set(doc.id, doc)
  state.openIds.push(doc.id)
  drafts.putDoc(doc).catch(reportError)
  return doc.id
}

function setActive(id) {
  state.activeId = id
  const doc = active()
  if (editor && doc) editor.setText(doc.text)
  renderTabs()
  updatePreview()
  saveSession()
}

/**
 * Close a tab without destroying anything. The note stays in storage and can
 * be reopened from Settings — until cloud saving exists this database is the
 * only copy a note has, so a close button must not be a delete button.
 */
function closeTab(id) {
  saveNow(state.docs.get(id))
  dropTab(id)
}

/**
 * Remove a note from the tab strip, leaving storage alone. Used both by
 * closing (after the note has been written) and by deleting from Settings
 * (where writing it back would undo the deletion).
 */
function dropTab(id) {
  const i = state.openIds.indexOf(id)
  if (i === -1) return
  state.openIds.splice(i, 1)
  state.docs.delete(id)

  if (state.activeId === id) {
    const next = state.openIds[Math.min(i, state.openIds.length - 1)]
    if (next) return setActive(next)
    state.activeId = null
    if (editor) editor.setText('')
    updatePreview()
  }
  renderTabs()
  saveSession()
}

function onEdit(text) {
  const doc = active()
  if (!doc || doc.text === text) return
  const wasClean = doc.text === doc.savedText
  doc.text = text
  doc.updatedAt = Date.now()
  if (wasClean) renderTabs()
  schedulePreview()
  scheduleSave()

  // The first keystroke is the earliest point where the user has something to
  // lose, and it follows a real gesture — see requestPersistenceOnce.
  drafts.requestPersistenceOnce()
}

/** Reopen a note that was closed earlier, from the Settings list. */
function openStoredDoc(doc) {
  if (!state.docs.has(doc.id)) state.docs.set(doc.id, doc)
  if (!state.openIds.includes(doc.id)) state.openIds.push(doc.id)
  setActive(doc.id)
}

/* ---------- files ---------- */

async function openFiles(files) {
  let lastId = null
  for (const file of files) {
    const text = await file.text()
    lastId = addDoc(file.name, text)
  }
  if (lastId) {
    setActive(lastId)
    // Someone opening a file wants to see it, not to be handed a text editor.
    setMode('view')
  } else renderTabs()
}

function downloadActive() {
  const doc = active()
  if (!doc) return
  const name = doc.name.endsWith('.md') ? doc.name : `${doc.name}.md`
  const url = URL.createObjectURL(new Blob([doc.text], { type: 'text/markdown' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)

  doc.savedText = doc.text
  drafts.putDoc(doc).catch(reportError)
  renderTabs()
}

/* ---------- cloud ---------- */

function updateCloudButtons() {
  const available = availableProviders().length > 0
  document.getElementById('btn-cloud-open').hidden = !available
  document.getElementById('btn-cloud-save').hidden = !available
}

/** Report a cloud failure where the user will actually see it. */
function cloudFailed(action, err) {
  reportError(err)
  alert(`Could not ${action}.\n\n${err.message ?? err}`)
}

async function openFromCloud() {
  const provider = availableProviders()[0]
  if (!provider) return
  try {
    if (!provider.isConnected()) await provider.connect()
    const picked = await provider.pick()
    let lastId = null
    for (const file of picked) {
      const { id, name, text } = await provider.read(file.id)
      lastId = addDoc(name, text, { provider: provider.id, id, savedAt: Date.now() })
    }
    if (lastId) {
      setActive(lastId)
      setMode('view')
    }
  } catch (err) {
    cloudFailed('open that file', err)
  }
}

async function saveToCloud() {
  const doc = active()
  if (!doc) return
  // Saving a note that came from the cloud writes back over the same file;
  // a note that did not creates a new one. Same intent, so one button.
  const provider = providerFor(doc) ?? availableProviders()[0]
  if (!provider) return
  try {
    if (!provider.isConnected()) await provider.connect()
    const saved = await provider.write({ id: doc.remote?.id, name: doc.name, text: doc.text })
    doc.remote = { provider: provider.id, id: saved.id, savedAt: Date.now() }
    if (saved.name) doc.name = saved.name
    doc.savedText = doc.text
    await saveNow(doc)
    renderTabs()
  } catch (err) {
    cloudFailed('save to the cloud', err)
  }
}

/* ---------- wiring ---------- */

document.getElementById('btn-new').onclick = () => {
  setActive(addDoc('untitled.md', '# \n'))
  // A blank note is an invitation to type, so this is the one action that
  // always lands in the editor.
  setMode('edit', { focus: true })
}
el.modeBtn.onclick = toggleMode
document.getElementById('btn-open').onclick = () => el.fileInput.click()
document.getElementById('btn-save').onclick = downloadActive
document.getElementById('btn-close').onclick = () => { if (state.activeId) closeTab(state.activeId) }
document.getElementById('btn-cloud-open').onclick = openFromCloud
document.getElementById('btn-cloud-save').onclick = saveToCloud

/* ---------- keyboard shortcuts ---------- */

/**
 * Ctrl+N, Ctrl+W and Ctrl+F4 are reserved by Chrome and Firefox for their own
 * window and tab handling. The browser never delivers the keydown to the page,
 * so binding them would not fail loudly — it would simply do nothing while
 * looking correct in the source. New and Close therefore sit on Alt.
 *
 * Matching is on `event.code`, the physical key, not `event.key`. With a
 * Cyrillic layout active `event.key` for that key is 'ы', and every binding
 * written against letters quietly stops working.
 */
const SHORTCUTS = [
  { id: 'btn-mode', mod: 'ctrl', code: 'KeyE', hint: 'E' },
  { id: 'btn-new', mod: 'alt', code: 'KeyN', hint: 'N' },
  { id: 'btn-open', mod: 'ctrl', code: 'KeyO', hint: 'O' },
  { id: 'btn-save', mod: 'ctrl', code: 'KeyS', hint: 'S' },
  { id: 'btn-close', mod: 'alt', code: 'KeyW', hint: 'W' },
]

const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
const prefix = (mod) => (mod === 'alt' ? (isMac ? '⌥' : 'Alt+') : isMac ? '⌘' : 'Ctrl+')
const shortcutLabel = (s) => prefix(s.mod) + s.hint

// The hint shown and the key handled come from the same row, so they cannot
// drift apart.
for (const s of SHORTCUTS) {
  const hint = document.getElementById(s.id)?.querySelector('.key')
  if (hint) hint.textContent = shortcutLabel(s)
}

addEventListener('keydown', (e) => {
  if (e.key === 'Escape') return closeMenu()

  const ctrl = e.ctrlKey || e.metaKey
  for (const s of SHORTCUTS) {
    if (e.code !== s.code || e.shiftKey) continue
    const pressed = s.mod === 'alt' ? e.altKey && !ctrl : ctrl && !e.altKey
    if (!pressed) continue
    e.preventDefault() // Ace and the browser both have their own ideas
    closeMenu()
    document.getElementById(s.id).click()
    return
  }
}, true)

el.fileInput.onchange = () => {
  openFiles([...el.fileInput.files])
  el.fileInput.value = ''
}

let dragDepth = 0
addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return
  dragDepth++
  document.body.classList.add('dragging')
})
addEventListener('dragover', (e) => e.preventDefault())
addEventListener('dragleave', () => {
  if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging') }
})
addEventListener('drop', (e) => {
  e.preventDefault()
  dragDepth = 0
  document.body.classList.remove('dragging')
  if (e.dataTransfer?.files.length) openFiles([...e.dataTransfer.files])
})

el.splitter.onmousedown = (down) => {
  down.preventDefault()
  const vertical = matchMedia('(max-width: 700px)').matches
  const move = (e) => {
    const rect = document.getElementById('panes').getBoundingClientRect()
    // The editor re-measures itself through a ResizeObserver.
    if (vertical) el.editorPane.style.height = `${Math.max(80, e.clientY - rect.top)}px`
    else el.editorPane.style.width = `${Math.max(160, e.clientX - rect.left)}px`
  }
  const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up) }
  addEventListener('mousemove', move)
  addEventListener('mouseup', up)
}

/* ---------- start ---------- */

async function init() {
  let stored = []
  try {
    stored = await drafts.listDocs()
  } catch (err) {
    // A blocked or unavailable IndexedDB must not leave a blank screen.
    reportError(err)
  }

  const byId = new Map(stored.map((doc) => [doc.id, doc]))
  const session = await drafts.getSession().catch(() => null)

  let openIds = (session?.openIds ?? []).filter((id) => byId.has(id))
  if (!openIds.length && stored.length) {
    // No usable session, but notes exist. Since closing a tab now keeps the
    // note, reopening every note ever written would be wrong — take the one
    // that was edited last.
    const newest = stored.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a))
    openIds = [newest.id]
  }

  // Only open notes are held in memory; Settings reads the rest from storage.
  for (const id of openIds) state.docs.set(id, byId.get(id))
  state.openIds = openIds
  state.activeId = openIds.includes(session?.activeId) ? session.activeId : openIds[0] ?? null

  if (!state.openIds.length) state.activeId = addDoc('welcome.md', SAMPLE)

  renderTabs()
  updatePreview()

  // Reading is where a first visit starts, and where a returning one resumes if
  // that is how it was left. Nothing of Ace is fetched until edit mode is asked
  // for, so this branch decides the weight of the page.
  await setMode(session?.mode === 'edit' ? 'edit' : 'view', { focus: true })

  // Last, and isolated: the editor must be usable even if this fails.
  try {
    updateCloudButtons()
    initSettings({
      getOpenIds: () => state.openIds,
      onOpen: openStoredDoc,
      onDeleted: dropTab,
      onCloudChange: updateCloudButtons,
    })
  } catch (err) {
    reportError(err)
  }
}

init().catch((err) => {
  reportError(err)
  el.preview.innerHTML = '<p class="empty-note">Could not start. See the browser console.</p>'
})
