import { render } from './viewer.js'
import { createEditor } from './editor.js'
import * as drafts from './drafts.js'

const SAMPLE = `# Welcome to md-studio

Write plain text on the left, see it typeset on the right — as you type.

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
> Use *Download* to keep a copy as a \`.md\` file.
`

const state = { docs: new Map(), openIds: [], activeId: null }
let editor = null

const el = {
  tabs: document.getElementById('tabs'),
  preview: document.getElementById('preview'),
  editor: document.getElementById('editor'),
  editorPane: document.getElementById('editor-pane'),
  splitter: document.getElementById('splitter'),
  fileInput: document.getElementById('file-input'),
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

const saveSession = () =>
  drafts.putSession({ openIds: state.openIds, activeId: state.activeId }).catch(reportError)

function reportError(err) {
  console.error(err)
}

/* ---------- rendering ---------- */

let previewTimer = null
function schedulePreview() {
  clearTimeout(previewTimer)
  previewTimer = setTimeout(updatePreview, 120)
}

function updatePreview() {
  const doc = active()
  el.preview.innerHTML = doc ? render(doc.text) : ''
}

function renderTabs() {
  el.tabs.textContent = ''
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
      dot.title = 'Edited since it was opened or downloaded'
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

    el.tabs.append(tab)
  }
}

/* ---------- document actions ---------- */

function addDoc(name, text) {
  const doc = {
    id: crypto.randomUUID(),
    name,
    text,
    savedText: text,
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

function closeTab(id) {
  const i = state.openIds.indexOf(id)
  if (i === -1) return
  state.openIds.splice(i, 1)
  state.docs.delete(id)
  drafts.deleteDoc(id).catch(reportError)

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
}

/* ---------- files ---------- */

async function openFiles(files) {
  let lastId = null
  for (const file of files) {
    const text = await file.text()
    lastId = addDoc(file.name, text)
  }
  if (lastId) setActive(lastId)
  else renderTabs()
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

/* ---------- wiring ---------- */

document.getElementById('btn-new').onclick = () => {
  setActive(addDoc('untitled.md', '# \n'))
  editor?.focus()
}
document.getElementById('btn-open').onclick = () => el.fileInput.click()
document.getElementById('btn-save').onclick = downloadActive

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

  for (const doc of stored) state.docs.set(doc.id, doc)

  const session = await drafts.getSession().catch(() => null)
  state.openIds = (session?.openIds ?? []).filter((id) => state.docs.has(id))
  if (!state.openIds.length && stored.length) state.openIds = stored.map((d) => d.id)
  state.activeId = state.docs.has(session?.activeId) ? session.activeId : state.openIds[0] ?? null

  if (!state.openIds.length) state.activeId = addDoc('welcome.md', SAMPLE)

  renderTabs()
  updatePreview()

  editor = await createEditor(el.editor, onEdit)
  const doc = active()
  if (doc) editor.setText(doc.text)
  editor.focus()
}

init().catch((err) => {
  reportError(err)
  el.editor.textContent = 'Could not start the editor. See the browser console.'
})
