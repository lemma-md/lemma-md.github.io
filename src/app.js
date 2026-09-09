import { render } from './viewer.js'
import { createEditor } from './editor.js'
import { initSettings } from './settings.js'
import * as drafts from './drafts.js'
import { register, availableProviders, providerFor } from './storage/index.js'
import { googleDrive } from './storage/gdrive.js'
import { localFiles } from './storage/local.js'

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
  cloudState: document.getElementById('cloud-state'),
}

const active = () => state.docs.get(state.activeId) ?? null

/* ---------- persistence ---------- */

// UI-only state that must never reach storage: a save in flight, and the result
// of the last external-change check. Persisting `cloudBusy` once left a note
// stuck on "Saving…" after a reload; the remote-change flags are re-derived on
// load anyway. Stripped on write and cleared on load.
const TRANSIENT_KEYS = ['cloudBusy', 'remoteChanged', 'remoteRenamed', 'remoteTrashed', 'localBusy', 'localChanged']

/** Write a note to the scratch database without its transient UI flags. */
function persistDoc(doc) {
  const clean = { ...doc }
  for (const k of TRANSIENT_KEYS) delete clean[k]
  return drafts.putDoc(clean)
}

let saveTimer = null
function scheduleSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const doc = active()
    if (doc) persistDoc(doc).catch(reportError)
  }, 400)
}

/**
 * Write a document immediately, bypassing the debounce. The in-memory document
 * is always current — only the database write is delayed — so this captures
 * whatever was typed last.
 */
const saveNow = (doc) => (doc ? persistDoc(doc).catch(reportError) : Promise.resolve())

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

// Remembers the last tab-name click so a double-click can be recognised across
// the strip rebuild that selecting a tab causes. See the name handler below.
let lastTabClick = { id: null, at: 0 }

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

    if (doc.remoteTrashed || doc.remoteRenamed || doc.remoteChanged) {
      const mark = document.createElement('span')
      mark.className = 'dot remote'
      mark.textContent = '⟳'
      mark.title = doc.remoteTrashed
        ? 'Moved to the Drive trash — saving will ask what to do'
        : doc.remoteRenamed
          ? 'Renamed or moved in Drive — saving will ask what to do'
          : 'Changed in Google Drive — saving will ask what to do'
      tab.append(mark)
    }

    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = doc.name
    name.title = 'Double-click to rename'
    // Double-click is detected by hand rather than with the `dblclick` event:
    // selecting a tab rebuilds the strip, so the node is swapped out between the
    // two clicks and the browser would never fire dblclick. `lastTabClick`
    // outlives the rebuild, so the second click still finds the first.
    name.onclick = (e) => {
      e.stopPropagation() // selection and rename are handled here, not on the tab
      const now = Date.now()
      if (lastTabClick.id === id && now - lastTabClick.at < 400) {
        lastTabClick = { id: null, at: 0 }
        beginRename(id, name)
      } else {
        lastTabClick = { id, at: now }
        setActive(id)
      }
    }
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

function addDoc(name, text, remote = null, origin = null, local = null) {
  const doc = {
    id: crypto.randomUUID(),
    name,
    text,
    savedText: text,
    remote,
    // A local-file source: { handle, name, lastModified, size, savedAt }. Its
    // handle writes back to the same file on disk.
    local,
    // How the note began, for the status line: 'new' (the New button) shows
    // "New"; an opened file ('file') stays quiet until edited. A cloud or local
    // note has a source instead and needs neither.
    origin,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  state.docs.set(doc.id, doc)
  state.openIds.push(doc.id)
  persistDoc(doc).catch(reportError)
  return doc.id
}

function setActive(id) {
  state.activeId = id
  const doc = active()
  if (editor && doc) editor.setText(doc.text)
  renderTabs()
  updatePreview()
  renderCloudStatus()
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
  if (wasClean) { renderTabs(); renderCloudStatus() }
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

/* ---------- renaming ---------- */

/**
 * Rename a note by editing its tab in place. Enter or losing focus commits,
 * Escape abandons. The name is what a colleague receives and what a download is
 * called, so it is worth making easy to change; a cloud file learns the new
 * name on the next save, which now carries it.
 */
function beginRename(id, span) {
  const doc = state.docs.get(id)
  if (!doc) return

  const input = document.createElement('input')
  input.className = 'tab-rename'
  input.value = doc.name

  let settled = false
  const finish = (commit) => {
    if (settled) return
    settled = true
    if (commit) applyRename(id, input.value)
    renderTabs() // rebuilds the strip, replacing the input with a fresh label
  }

  input.onkeydown = (e) => {
    e.stopPropagation() // keep the app's own Ctrl/Alt shortcuts out of the field
    if (e.key === 'Enter') { e.preventDefault(); finish(true) }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false) }
  }
  input.onblur = () => finish(true)
  input.onclick = (e) => e.stopPropagation() // not a request to switch tabs

  span.replaceWith(input)
  input.focus()
  input.select()
}

function applyRename(id, raw) {
  const doc = state.docs.get(id)
  if (!doc) return
  const name = raw.trim()
  if (!name || name === doc.name) return
  doc.name = name
  doc.updatedAt = Date.now()
  saveNow(doc)
}

/* ---------- files ---------- */

/**
 * The local-file source stored on a note: its handle writes back to the same
 * file, and lastModified/size are the baseline a later save compares against to
 * notice the file changed on disk. Only present when the browser gave a handle.
 */
function localSource(f) {
  return f.handle
    ? { handle: f.handle, name: f.name, lastModified: f.lastModified, size: f.size, savedAt: Date.now() }
    : null
}

/** The open tab already backed by this file handle, if any. */
async function openIdForHandle(handle) {
  for (const id of state.openIds) {
    const h = state.docs.get(id)?.local?.handle
    if (h && (await h.isSameEntry(handle).catch(() => false))) return id
  }
  return null
}

/**
 * Open files that arrived with handles ({ handle, name, text, lastModified,
 * size }) — from the file picker or a drop in a browser that supports it — so
 * each note remembers where it came from and can be saved straight back.
 */
async function openLocalFiles(entries) {
  let lastId = null
  for (const f of entries) {
    const open = f.handle ? await openIdForHandle(f.handle) : null
    if (open) { lastId = open; continue }
    lastId = addDoc(f.name, f.text, null, 'file', localSource(f))
  }
  if (lastId) { setActive(lastId); setMode('view') } else renderTabs()
}

/** Open plain File objects — the fallback where no handle is available, so the
 *  note has no source and Save will ask where to put it. */
async function openFiles(files) {
  let lastId = null
  for (const file of files) {
    const text = await file.text()
    lastId = addDoc(file.name, text, null, 'file')
  }
  if (lastId) {
    setActive(lastId)
    // Someone opening a file wants to see it, not to be handed a text editor.
    setMode('view')
  } else renderTabs()
}

/**
 * "Open a file…". Where the File System Access API exists, pick with it so the
 * note keeps a writable handle; elsewhere fall back to a plain file input, which
 * yields contents but no handle.
 */
async function openLocal() {
  if (!localFiles.isSupported()) return el.fileInput.click()
  try {
    const files = await localFiles.open()
    if (files.length) await openLocalFiles(files)
  } catch (err) {
    reportError(err)
    alert(`Could not open the file.\n\n${err.message ?? err}`)
  }
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
  persistDoc(doc).catch(reportError)
  renderTabs()
}

/* ---------- cloud ---------- */

function updateCloudButtons() {
  const available = availableProviders().length > 0
  // "Save" (btn-cloud-save) is always shown: it routes to a local file or the
  // cloud, or asks. Only the cloud-specific items depend on a provider.
  document.getElementById('btn-cloud-open').hidden = !available
  document.getElementById('btn-cloud-save-as').hidden = !available
}

/**
 * Closing the Google sign-in popup or dismissing the picker is a cancellation,
 * not a failure — GIS reports it as `popup_closed` (older builds: 'popup
 * closed'), and the user does not want an alert about a choice they just made.
 */
const isCancel = (err) => /popup[ _]?closed|access_denied|cancel/i.test(err?.message ?? '')

/** Report a cloud failure where the user will actually see it. */
function cloudFailed(action, err) {
  if (isCancel(err)) return
  reportError(err)
  alert(`Could not ${action}.\n\n${err.message ?? err}`)
}

/**
 * The app keeps one folder of its own — "lemma-md" by default — so saving needs
 * neither the picker nor a scattered Drive. `drive.file` cannot search for it,
 * so its id and name are remembered locally; a second device therefore makes
 * its own, a fair price for the narrow scope.
 */
const APP_FOLDER_NAME = 'lemma-md'
const appFolderKey = (provider) => `${provider.id}:appFolder`

/** The remembered folder as { id, name }, or null if none has been made yet. */
const knownAppFolder = (provider) => drafts.getMeta(appFolderKey(provider)).catch(() => null)

const storeAppFolder = (provider, folder) =>
  drafts.putMeta(appFolderKey(provider), { id: folder.id, name: folder.name }).catch(reportError)

// A parent folder deleted in Drive since its id was cached comes back as a 404.
const isMissing = (err) => /\b404\b|not ?found/i.test(err?.message ?? '')

const setup = {
  dialog: document.getElementById('cloud-setup'),
  folder: document.getElementById('cloud-setup-folder'),
  rename: document.getElementById('cloud-setup-rename'),
  name: document.getElementById('cloud-setup-name'),
  create: document.getElementById('cloud-setup-create'),
}

/**
 * Connect to the provider and return its default folder, the first time through
 * a short dialog that says what is about to happen and lets the name be changed.
 * Resolves to { id, name }, or null if the user backs out — in which case the
 * cloud action that asked should quietly stop. Once a folder is remembered this
 * returns it straight away, without a dialog or a prompt.
 */
async function ensureAppFolder(provider) {
  const known = await knownAppFolder(provider)
  if (known?.id) {
    // Refresh the name best-effort: a folder renamed in Drive should show its
    // current name (e.g. on the Open picker). A transient failure falls back to
    // the cached folder so saving still works; only a definite 404 — the folder
    // was deleted — drops through to remake it.
    try {
      const fresh = await provider.stat(known.id)
      if (fresh.name !== known.name) await storeAppFolder(provider, fresh)
      return fresh
    } catch (err) {
      if (!isMissing(err)) return known
    }
  }

  return new Promise((resolve) => {
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      setup.create.onclick = null
      setup.rename.onclick = null
      setup.dialog.removeEventListener('close', onCancel)
      resolve(result)
    }
    const onCancel = () => finish(null) // the × or Escape

    // Start collapsed: the name shows as plain text with a link to edit it, so
    // the common case is one button and no typing. The input holds the value
    // either way, so continuing reads it whether or not it was revealed.
    setup.name.value = APP_FOLDER_NAME
    setup.folder.textContent = APP_FOLDER_NAME
    setup.folder.hidden = false
    setup.rename.hidden = false
    setup.name.hidden = true
    setup.create.disabled = false

    setup.rename.onclick = () => {
      setup.folder.hidden = true
      setup.rename.hidden = true
      setup.name.hidden = false
      setup.name.focus()
      setup.name.select()
    }

    setup.create.onclick = async () => {
      const name = setup.name.value.trim() || APP_FOLDER_NAME
      setup.create.disabled = true
      try {
        if (!provider.isConnected()) await provider.connect()
        // Reuse an existing folder of this name before making another, so a
        // reconnect or a second device does not scatter duplicate folders.
        const existing = (await provider.list({ foldersOnly: true })).find((f) => f.name === name)
        const folder = existing || (await provider.createFolder(name))
        await storeAppFolder(provider, folder)
        setup.dialog.removeEventListener('close', onCancel) // a success, not a cancel
        setup.dialog.close()
        finish({ id: folder.id, name: folder.name })
      } catch (err) {
        setup.create.disabled = false
        if (!isCancel(err)) cloudFailed('connect to Google Drive', err) // else stay open to retry
      }
    }

    setup.dialog.showModal()
  })
}

/** Connecting is "obtain the token and settle on a default folder". */
const connectCloud = (provider) => ensureAppFolder(provider)

/** Disconnecting forgets both: the token is revoked, the folder is unremembered. */
async function disconnectCloud(provider) {
  provider.disconnect()
  await drafts.putMeta(appFolderKey(provider), null).catch(reportError)
}

/** Connected means a folder is remembered; a token is refreshed silently when needed. */
const isCloudConnected = (provider) => knownAppFolder(provider).then((f) => Boolean(f?.id))

/**
 * A note's link to its Drive file. Beyond the id it carries the revision the
 * note was last in step with (`headRevisionId` and friends), which is what lets
 * an external change be noticed before it is overwritten.
 */
function remoteLink(provider, meta) {
  return {
    provider: provider.id,
    id: meta.id,
    // The name and folder the file had when we last synced, so a rename or a
    // move made in Drive can be told apart from a local one.
    name: meta.name,
    parentId: meta.parents?.[0] ?? null,
    savedAt: Date.now(),
    headRevisionId: meta.headRevisionId,
    modifiedTime: meta.modifiedTime,
    size: meta.size,
    md5Checksum: meta.md5Checksum,
  }
}

/** "note.md" -> "note (copy).md" */
function copyName(name) {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? `${name.slice(0, dot)} (copy)${name.slice(dot)}` : `${name} (copy)`
}

/**
 * The origin a note is bound to, which is what Save routes on. It is read from
 * the note's own links rather than stored twice: a Drive file gives 'gdrive'
 * (its id and folder live in `remote`); a local file will give 'local' with its
 * handle once that adapter exists; a brand-new or dropped-in note has none yet.
 */
function noteSource(doc) {
  if (doc?.remote?.provider === 'gdrive') return 'gdrive'
  if (doc?.local?.handle) return 'local'
  return null
}

/** The open tab already showing this provider's file, if any. */
function openIdForRemote(provider, id) {
  return (
    state.openIds.find((openId) => {
      const d = state.docs.get(openId)
      return d?.remote?.provider === provider.id && d.remote.id === id
    }) ?? null
  )
}

const fmtBytes = (n) => {
  n = Number(n) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1048576).toFixed(1)} MB`
}
const fmtWhen = (value) => {
  const d = new Date(value)
  return isNaN(d) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}
const fmtTimeShort = (ms) => {
  const d = new Date(ms)
  if (isNaN(d)) return ''
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}
const fmtDate = (value) => {
  const d = new Date(value)
  return isNaN(d) ? '' : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * The cloud state of the active note, shown in the bar. `cloudBusy` and
 * `remoteChanged` are transient (in memory only): a save in flight, and a file
 * that changed in Drive since we last saw it.
 */
/**
 * The one-line cloud state of a note — text, a colour class, and a tooltip — or
 * null when there is nothing worth showing. The full rules live in
 * docs/STATUS.md.
 */
function cloudStatusText(doc) {
  const dirty = doc.text !== doc.savedText
  const source = noteSource(doc)
  if (!source) {
    if (doc.origin === 'new') return { text: 'New', cls: 'cloud-state', title: 'A new note, not saved anywhere yet' }
    if (dirty) return { text: 'Changed', cls: 'cloud-state warn', title: 'Edited since it was opened' }
    return null // an opened file, unedited and with no source: say nothing
  }
  if (source === 'local') {
    if (doc.localBusy) return { text: 'Saving…', cls: 'cloud-state' }
    if (doc.localChanged) return { text: 'Changed on disk', cls: 'cloud-state warn', title: 'The file changed on disk since you opened it' }
    if (dirty) return { text: 'Changed', cls: 'cloud-state warn', title: 'Edited since it was last saved' }
    // In sync: the time of the last save to disk, no status word.
    const when = doc.local.savedAt ?? doc.local.lastModified
    return { text: fmtTimeShort(when), cls: 'cloud-state', title: 'Saved to this computer' }
  }
  if (doc.cloudBusy) return { text: 'Saving…', cls: 'cloud-state' }
  if (doc.remoteTrashed) return { text: 'In Drive trash', cls: 'cloud-state warn', title: 'The file is in the Drive trash' }
  if (doc.remoteRenamed) return { text: 'Renamed in Drive', cls: 'cloud-state warn', title: 'The file was renamed or moved in Drive' }
  if (doc.remoteChanged) return { text: 'Changed in Drive', cls: 'cloud-state warn', title: 'The file changed in Drive since you opened it' }
  if (dirty) return { text: 'Changed', cls: 'cloud-state warn', title: 'Edited since it was last saved' }
  // In sync: just the source file's own time, no status word.
  const when = doc.remote.modifiedTime ?? doc.remote.savedAt
  return { text: fmtTimeShort(when), cls: 'cloud-state', title: 'In sync with Google Drive' }
}

function renderCloudStatus() {
  const doc = active()
  if (!el.cloudState) return
  const st = doc && cloudStatusText(doc)
  if (!st) { el.cloudState.hidden = true; el.cloudState.textContent = ''; return }
  el.cloudState.hidden = false
  el.cloudState.className = st.cls
  el.cloudState.textContent = st.text
  el.cloudState.title = st.title || st.text
}

/* ---------- file info ---------- */

const fi = {
  dialog: document.getElementById('file-info'),
  grid: document.getElementById('fi-grid'),
  save: document.getElementById('fi-save'),
}

const infoLine = (time, size) =>
  [fmtWhen(time), size != null ? fmtBytes(size) : null].filter(Boolean).join(' · ') || '—'

function addInfoRow(label, value, right = null) {
  const dt = document.createElement('dt')
  dt.textContent = label
  const dd = document.createElement('dd')
  const valNode = typeof value === 'string' ? document.createTextNode(value) : value
  if (right) {
    // Something pinned to the right of the row: a status word, or a control.
    dd.className = 'with-badge'
    const v = document.createElement('span')
    v.append(valNode)
    let rightNode
    if (right instanceof HTMLElement) {
      rightNode = right
    } else {
      rightNode = document.createElement('span')
      rightNode.className = `info-badge ${right.cls || ''}`.trim()
      rightNode.textContent = right.text
    }
    dd.append(v, rightNode)
  } else {
    dd.append(valNode)
  }
  fi.grid.append(dt, dd)
}

/**
 * Where the note came from and how three versions of it line up: the source as
 * it is now, the version we opened, and the local copy. For a note identical to
 * what was opened, "Your copy" shows the source's own time, as asked.
 */
const SLOW = Symbol('slow')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function openFileInfo() {
  const doc = active()
  if (!doc) return
  const source = noteSource(doc)

  if (source === 'local') {
    // Like the Drive panel: open already showing the disk state if the read is
    // quick, otherwise open with a spinner and fill in when it lands.
    const pending = readLocalInfo(doc).catch(() => null)
    const raced = await Promise.race([pending, delay(300).then(() => SLOW)])
    if (raced === SLOW) {
      renderFileInfo(doc, 'checking')
      pending.then((data) => { if (fi.dialog.open && active() === doc) renderFileInfo(doc, 'live', data) })
    } else {
      renderFileInfo(doc, 'live', raced)
    }
    if (!fi.dialog.open) fi.dialog.showModal()
    return
  }

  const provider = source === 'gdrive' ? providerFor(doc) : null

  if (provider && provider.isConnected()) {
    const pending = fetchLiveInfo(provider, doc.remote).catch(() => null)
    // A short window to open already showing the live status; if the read misses
    // it, open with the spinner and update when it lands.
    const raced = await Promise.race([pending, delay(300).then(() => SLOW)])
    if (raced === SLOW) {
      renderFileInfo(doc, 'checking')
      pending.then((data) => { if (fi.dialog.open && active() === doc) renderFileInfo(doc, 'live', data) })
    } else {
      renderFileInfo(doc, 'live', raced)
    }
  } else {
    renderFileInfo(doc, provider ? 'stale' : 'live')
  }
  if (!fi.dialog.open) fi.dialog.showModal()
}

/**
 * Read the file's current state from disk for the panel, but only where
 * permission is already granted — opening the panel should not, on its own,
 * provoke a permission prompt. Returns null when it can't read silently; the
 * panel then offers a reload, which runs from the click's own gesture.
 */
async function readLocalInfo(doc, force = false) {
  const handle = doc.local?.handle
  if (!handle) return null
  if (force) {
    if (!(await localFiles.ensurePermission(handle, 'read'))) return null
  } else if (handle.queryPermission) {
    if ((await handle.queryPermission({ mode: 'read' })) !== 'granted') return null
  }
  return localFiles.read(handle)
}

/** Fetch the live source state plus the folder's name, for the panel. */
async function fetchLiveInfo(provider, r) {
  const live = await provider.revision(r.id)
  const parentId = live.parents?.[0] ?? r.parentId
  const folderName = parentId ? (await provider.stat(parentId).catch(() => null))?.name : null
  return { live, folderName }
}

/**
 * Fill the panel for `doc` in one of three modes: 'live' (with `data`, or null
 * when the read failed), 'checking' (a read is in flight — show a spinner), or
 * 'stale' (no token yet — offer a reload). It never fetches on its own; the
 * caller owns the read, so the 300ms open race and a manual reload share one.
 */
function renderFileInfo(doc, mode, data) {
  const source = noteSource(doc)
  const dirty = doc.text !== doc.savedText
  const localSize = new Blob([doc.text]).size
  const editedBadge = dirty ? { text: 'Changed in editor', cls: 'warn' } : null
  fi.grid.textContent = ''

  if (source === 'local') {
    const base = doc.local
    addInfoRow('Source', 'This computer')
    addInfoRow('File', base.name || doc.name)

    const live = mode === 'live' ? (data ?? null) : null
    if (live) {
      // Reflect what the disk read just told us on the tab and toolbar too.
      const moved = live.lastModified !== base.lastModified || live.size !== base.size
      const changed = moved && live.text !== doc.savedText
      if (Boolean(doc.localChanged) !== changed) { doc.localChanged = changed; renderTabs(); renderCloudStatus() }
      addInfoRow('On disk now', infoLine(live.lastModified, live.size), changed ? { text: 'Changed on disk', cls: 'warn' } : null)
      if (changed) addInfoRow('When you saved it', infoLine(base.lastModified, base.size))
    } else {
      // Couldn't read silently, or a read is in flight: last-known figures, with
      // a spinner or a reload that reads from its own click gesture.
      const control = document.createElement('button')
      control.type = 'button'
      control.className = 'fi-reload'
      control.textContent = '⟳'
      if (mode === 'checking') {
        control.classList.add('spinning')
        control.disabled = true
        control.title = 'Checking the file…'
      } else {
        control.title = 'Check the file now'
        control.onclick = () => {
          renderFileInfo(doc, 'checking')
          readLocalInfo(doc, true)
            .catch(() => null)
            .then((d) => { if (fi.dialog.open && active() === doc) renderFileInfo(doc, 'live', d) })
        }
      }
      addInfoRow('On disk', infoLine(base.lastModified, base.size) + ' (when last saved)', control)
    }

    addInfoRow('Your copy', dirty ? infoLine(doc.updatedAt, localSize) : '(no changes)', editedBadge)
    fi.save.disabled = !dirty
    return
  }

  const sourceLabel = source === 'gdrive'
    ? 'Google Drive'
    : doc.origin === 'new'
      ? 'New note — not saved to storage yet'
      : 'Not saved to storage yet'
  addInfoRow('Source', sourceLabel)

  if (source !== 'gdrive') {
    addInfoRow('Your copy', infoLine(dirty ? doc.updatedAt : doc.createdAt, localSize), editedBadge)
    fi.save.disabled = !(dirty || !source)
    return
  }

  const r = doc.remote
  const provider = providerFor(doc)
  const live = mode === 'live' ? (data?.live ?? null) : null
  const folderName = mode === 'live' ? (data?.folderName ?? null) : null
  const parentId = live?.parents?.[0] ?? r.parentId
  const fileName = live?.name ?? r.name ?? doc.name

  const pathVal = document.createElement('span')
  pathVal.append(`${folderName ? folderName + ' / ' : ''}${fileName}`)
  if (parentId) {
    pathVal.append(' ')
    const a = document.createElement('a')
    a.className = 'folder-link'
    a.href = `https://drive.google.com/drive/folders/${parentId}`
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.textContent = 'Open folder'
    a.title = 'Open this folder in Google Drive'
    pathVal.append(a)
  }
  addInfoRow('Path', pathVal)

  if (live) {
    // Reflect what we just learned on the tab and toolbar too; the kind of
    // change is the status of the "In Drive now" row.
    const chg = detectRemoteChange(r, live)
    if (applyRemoteFlags(doc, chg)) { renderTabs(); renderCloudStatus() }
    const badge = chg.trashed
      ? { text: 'In Drive trash', cls: 'warn' }
      : chg.renamed
        ? { text: 'Renamed in Drive', cls: 'warn' }
        : chg.changed
          ? { text: 'Changed in Drive', cls: 'warn' }
          : null
    addInfoRow('In Drive now', infoLine(live.modifiedTime, live.size), badge)
    if (chg.trashed || chg.renamed || chg.changed) {
      addInfoRow('When you opened it', infoLine(r.modifiedTime, r.size))
    }
  } else {
    // Last-known figures, with a spinner while a read is in flight, or a reload
    // to (re)try. Reload owns its own read, then re-renders in 'live' mode.
    const control = document.createElement('button')
    control.type = 'button'
    control.className = 'fi-reload'
    control.textContent = '⟳'
    if (mode === 'checking') {
      control.classList.add('spinning')
      control.disabled = true
      control.title = 'Checking Google Drive…'
    } else {
      control.title = 'Check Google Drive now'
      control.onclick = () => {
        renderFileInfo(doc, 'checking')
        fetchLiveInfo(provider, r)
          .catch(() => null)
          .then((d) => { if (fi.dialog.open && active() === doc) renderFileInfo(doc, 'live', d) })
      }
    }
    addInfoRow('In Drive', infoLine(r.modifiedTime, r.size) + ' (last known)', control)
  }

  addInfoRow('Your copy', dirty ? infoLine(doc.updatedAt, localSize) : '(no changes)', editedBadge)
  fi.save.disabled = !(dirty || !source)
}

/** How a Drive file now differs from the baseline a note remembers. */
function detectRemoteChange(remote, cur) {
  return {
    trashed: Boolean(cur.trashed),
    renamed: Boolean(
      (remote.name && cur.name !== remote.name) ||
        (remote.parentId && (cur.parents?.[0] ?? null) !== remote.parentId),
    ),
    changed: cur.headRevisionId !== remote.headRevisionId,
  }
}

/** Apply the detected flags to a note; returns whether any of them moved. */
function applyRemoteFlags(doc, chg) {
  if (
    chg.trashed === Boolean(doc.remoteTrashed) &&
    chg.renamed === Boolean(doc.remoteRenamed) &&
    chg.changed === Boolean(doc.remoteChanged)
  ) {
    return false
  }
  doc.remoteTrashed = chg.trashed
  doc.remoteRenamed = chg.renamed
  doc.remoteChanged = chg.changed
  return true
}

let lastRemoteCheck = 0

/** Ask Drive whether any open cloud note's file has changed underneath it, and
 *  flag those that have. Only runs with a live token, so it never triggers a
 *  sign-in popup just from switching back to the tab. */
async function checkRemoteChanges() {
  const provider = availableProviders()[0]
  if (!provider || !provider.isConnected()) return
  let touched = false
  for (const id of state.openIds) {
    const d = state.docs.get(id)
    if (d?.remote?.provider !== provider.id || !d.remote.id || !d.remote.headRevisionId) continue
    try {
      const cur = await provider.revision(d.remote.id)
      if (applyRemoteFlags(d, detectRemoteChange(d.remote, cur))) touched = true
    } catch {
      // Transient failure — leave the note's flags as they were.
    }
  }
  if (touched) { renderTabs(); renderCloudStatus() }
}

/**
 * Notice when an open local note's file has changed on disk. Like the Drive
 * check, it only reads where permission is already granted, so returning to the
 * tab never provokes a permission prompt on its own. The bytes are compared
 * against what we last saved, so a mere re-touch is not flagged.
 */
async function checkLocalChanges() {
  let touched = false
  for (const id of state.openIds) {
    const d = state.docs.get(id)
    const base = d?.local
    if (!base?.handle?.queryPermission) continue
    try {
      if ((await base.handle.queryPermission({ mode: 'read' })) !== 'granted') continue
      const cur = await localFiles.read(base.handle)
      const moved = cur.lastModified !== base.lastModified || cur.size !== base.size
      const changed = moved && cur.text !== d.savedText
      if (Boolean(d.localChanged) !== changed) { d.localChanged = changed; touched = true }
    } catch {
      // Transient failure — leave the note's flag as it was.
    }
  }
  if (touched) { renderTabs(); renderCloudStatus() }
}

function maybeCheckRemote() {
  if (document.visibilityState !== 'visible') return
  const now = Date.now()
  if (now - lastRemoteCheck < 3000) return // don't storm on rapid focus changes
  lastRemoteCheck = now
  checkRemoteChanges().catch(reportError)
  checkLocalChanges().catch(reportError)
}

/* ---------- overwrite conflict ---------- */

const conflict = {
  dialog: document.getElementById('cloud-conflict'),
  name: document.getElementById('conflict-name'),
  detail: document.getElementById('conflict-detail'),
  theirs: document.getElementById('conflict-theirs'),
  copy: document.getElementById('conflict-copy'),
  overwrite: document.getElementById('conflict-overwrite'),
}

/**
 * Before overwriting a Drive file, check its current revision against the one
 * the note last saw. Unchanged → 'overwrite'. Changed → ask. Gone → a copy is
 * the safe default, there being nothing to overwrite. Resolves to
 * 'overwrite' | 'theirs' | 'copy' | 'cancel'.
 */
async function guardOverwrite(provider, doc) {
  const r = doc.remote
  if (!r?.headRevisionId) return { choice: 'overwrite' } // opened before revisions were tracked
  let cur
  try {
    cur = await provider.revision(r.id)
  } catch (err) {
    if (isMissing(err)) return { choice: 'copy' } // the file is gone; a copy is safe
    throw err
  }

  if (cur.trashed) return { choice: await askIdentity(provider, doc, cur, 'trashed'), cur }

  const renamed = r.name && cur.name !== r.name
  const moved = r.parentId && (cur.parents?.[0] ?? null) !== r.parentId
  if (renamed || moved) {
    return { choice: await askIdentity(provider, doc, cur, moved && !renamed ? 'moved' : 'renamed'), cur }
  }

  if (cur.headRevisionId !== r.headRevisionId) return { choice: await askConflict(doc, cur), cur }
  return { choice: 'overwrite', cur } // untouched since we last saw it
}

function askConflict(doc, current) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (choice) => {
      if (settled) return
      settled = true
      conflict.theirs.onclick = conflict.copy.onclick = conflict.overwrite.onclick = null
      conflict.dialog.removeEventListener('close', onCancel)
      resolve(choice)
    }
    const onCancel = () => finish('cancel') // the × or Escape
    const choose = (choice) => {
      conflict.dialog.removeEventListener('close', onCancel) // a choice, not a cancel
      conflict.dialog.close()
      finish(choice)
    }

    conflict.name.textContent = doc.name
    const theirs = [fmtWhen(current.modifiedTime), current.size && fmtBytes(current.size)].filter(Boolean).join(', ')
    const yours = [fmtWhen(doc.updatedAt), fmtBytes(new Blob([doc.text]).size)].filter(Boolean).join(', ')
    conflict.detail.textContent = `Theirs: ${theirs} · Yours: ${yours}`
    conflict.dialog.addEventListener('close', onCancel)
    conflict.theirs.onclick = () => choose('theirs')
    conflict.copy.onclick = () => choose('copy')
    conflict.overwrite.onclick = () => choose('overwrite')
    conflict.dialog.showModal()
  })
}

const identity = {
  dialog: document.getElementById('cloud-identity'),
  title: document.getElementById('identity-title'),
  text: document.getElementById('identity-text'),
  actions: document.getElementById('identity-actions'),
}

/**
 * The Drive file changed identity — trashed, renamed, or moved — since we opened
 * it. Explain what happened and offer to follow it, keep a separate copy, or (for
 * a trashed file) restore it. Resolves to 'follow' | 'restore' | 'copy' | 'cancel'.
 */
async function askIdentity(provider, doc, cur, kind) {
  const was = doc.remote.name || doc.name
  let title, text, buttons
  if (kind === 'trashed') {
    title = 'This file is in the Drive trash'
    text = `“${was}” was moved to the Drive trash, so saving would write into the trash. Restore it and save, or keep a separate copy?`
    buttons = [['Restore & save', 'restore', true], ['Save a copy', 'copy', false]]
  } else if (kind === 'moved') {
    const folder = (await provider.stat(cur.parents?.[0]).catch(() => null))?.name
    title = 'Moved in Drive'
    text = `“${cur.name}” was moved${folder ? ` to “${folder}”` : ''} in Drive. Save to that same file, or keep a separate copy?`
    buttons = [['Save there', 'follow', true], ['Save a copy', 'copy', false]]
  } else {
    title = 'Renamed in Drive'
    text = `“${was}” was renamed to “${cur.name}” in Drive. Save to that same file, or keep a separate copy?`
    buttons = [['Save there', 'follow', true], ['Save a copy', 'copy', false]]
  }

  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      identity.dialog.removeEventListener('close', onCancel)
      resolve(value)
    }
    const onCancel = () => finish('cancel') // the × or Escape

    identity.title.textContent = title
    identity.text.textContent = text
    identity.actions.textContent = ''
    for (const [label, value, primary] of buttons) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = primary ? 'primary' : 'action'
      b.textContent = label
      b.onclick = () => {
        identity.dialog.removeEventListener('close', onCancel)
        identity.dialog.close()
        finish(value)
      }
      identity.actions.append(b)
    }
    identity.dialog.addEventListener('close', onCancel)
    identity.dialog.showModal()
  })
}

/** Replace the note's contents with the version currently in Drive. */
async function pullTheirs(provider, doc) {
  const fresh = await provider.read(doc.remote.id)
  doc.text = fresh.text
  doc.savedText = fresh.text
  doc.name = fresh.name
  doc.remote = remoteLink(provider, fresh)
  doc.updatedAt = Date.now()
  doc.remoteChanged = doc.remoteRenamed = doc.remoteTrashed = false
  if (doc.id === state.activeId) {
    if (editor) editor.setText(fresh.text)
    updatePreview()
  }
  await saveNow(doc)
  renderTabs()
  renderCloudStatus()
}

/** Make a fresh app folder with the remembered name, after the old one vanished. */
async function recreateAppFolder(provider) {
  const known = await knownAppFolder(provider)
  const folder = await provider.createFolder(known?.name || APP_FOLDER_NAME)
  await storeAppFolder(provider, folder)
  return folder
}

/**
 * Create a new file inside the app folder, remaking the folder once if it has
 * been deleted out from under us.
 */
async function createInAppFolder(provider, fields, folder) {
  try {
    return await provider.write({ ...fields, parents: [folder.id] })
  } catch (err) {
    if (!isMissing(err)) throw err
    const fresh = await recreateAppFolder(provider)
    return provider.write({ ...fields, parents: [fresh.id] })
  }
}

async function openFromCloud() {
  const provider = availableProviders()[0]
  if (!provider) return
  try {
    // First cloud use explains itself and makes the home folder; afterwards the
    // chooser simply lands there, with a My Drive view for anything elsewhere.
    const folder = await ensureAppFolder(provider)
    if (!folder) return
    const picked = await provider.pick(folder.id, folder.name)
    let lastId = null
    for (const file of picked) {
      // A file already in a tab activates that tab rather than opening a second
      // copy of the same source.
      const open = openIdForRemote(provider, file.id)
      if (open) { lastId = open; continue }
      const fresh = await provider.read(file.id)
      lastId = addDoc(fresh.name, fresh.text, remoteLink(provider, fresh))
    }
    if (lastId) {
      setActive(lastId)
      setMode('view')
    }
  } catch (err) {
    cloudFailed('open that file', err)
  }
}

/**
 * "Save", also on Ctrl+S. It writes a note back to wherever it came from: a
 * Drive file, or a file on this computer — silently unless that file changed
 * underneath us. A note with no source yet is asked where to go.
 */
function saveActive() {
  const doc = active()
  if (!doc) return
  const src = noteSource(doc)
  if (src === 'gdrive') return overwriteToCloud(doc)
  if (src === 'local') return saveToLocal(doc)
  return openSaveTarget()
}

/* ---------- save to a local file ---------- */

/**
 * Write a note back to its file on disk, or — for a note without one yet — ask
 * where to put it. First it checks the file has not changed on disk since we
 * last saw it; only that turns the save into a dialog.
 */
async function saveToLocal(doc) {
  const base = doc.local || null
  try {
    if (base?.handle) {
      // Permission can lapse across a reload; re-requesting needs the gesture
      // that led here (the menu click or Ctrl+S), which we still have.
      if (!(await localFiles.ensurePermission(base.handle))) {
        alert('Permission to write this file was declined.')
        return
      }
      const { choice, cur } = await guardLocalOverwrite(doc)
      if (choice === 'cancel') return
      if (choice === 'theirs') return pullLocal(doc, cur)
      // 'copy' drops the handle so the picker asks for a new file; 'overwrite'
      // keeps it and writes the same file.
      if (choice === 'copy') return saveToLocalAs(doc)
    }
    doc.localBusy = true
    renderCloudStatus()
    const saved = await localFiles.write({ handle: base?.handle, name: doc.name, text: doc.text })
    doc.local = { handle: saved.handle, name: saved.name, lastModified: saved.lastModified, size: saved.size, savedAt: Date.now() }
    doc.name = saved.name
    doc.savedText = doc.text
    doc.localChanged = false
    await saveNow(doc)
    renderTabs()
  } catch (err) {
    localFailed(err)
  } finally {
    doc.localBusy = false
    renderCloudStatus()
  }
}

/**
 * "Save As": write the note to a new file the user picks and make that file its
 * source from now on. Any previous source is left untouched on disk or in Drive —
 * this note simply follows the new file, the way Save As does everywhere.
 */
async function saveToLocalAs(doc) {
  try {
    doc.localBusy = true
    renderCloudStatus()
    const saved = await localFiles.write({ handle: null, name: doc.name, text: doc.text })
    doc.local = { handle: saved.handle, name: saved.name, lastModified: saved.lastModified, size: saved.size, savedAt: Date.now() }
    doc.name = saved.name
    doc.savedText = doc.text
    doc.localChanged = false
    // The new local file is now the note's home; drop any cloud link so Save
    // goes here, not back to Drive.
    doc.remote = null
    doc.remoteChanged = doc.remoteRenamed = doc.remoteTrashed = false
    await saveNow(doc)
    renderTabs()
  } catch (err) {
    localFailed(err)
  } finally {
    doc.localBusy = false
    renderCloudStatus()
  }
}

/** "Save As" on the active note — the menu entry and its wiring. */
function saveActiveAs() {
  const doc = active()
  if (doc) return saveToLocalAs(doc)
}

/** Report a local-file failure, staying quiet when the user just cancelled the
 *  picker (AbortError). */
function localFailed(err) {
  if (err?.name === 'AbortError') return
  reportError(err)
  alert(`Could not save the file.\n\n${err.message ?? err}`)
}

/**
 * Before overwriting a file on disk, see whether it changed since we last saved
 * or opened it. Metadata (time or size) moving is the first hint, but the bytes
 * may still be identical — a touch, or a re-save of the same text — so a real
 * content difference is what makes it a conflict. Resolves to
 * { choice: 'overwrite' | 'theirs' | 'copy' | 'cancel', cur }.
 */
async function guardLocalOverwrite(doc) {
  const base = doc.local
  let cur
  try {
    cur = await localFiles.read(base.handle)
  } catch {
    return { choice: 'overwrite' } // can't read it to compare; just write
  }
  const moved = cur.lastModified !== base.lastModified || cur.size !== base.size
  if (!moved || cur.text === doc.savedText) return { choice: 'overwrite', cur }
  return { choice: await askLocalConflict(doc, cur), cur }
}

const localConflict = {
  dialog: document.getElementById('local-conflict'),
  name: document.getElementById('local-conflict-name'),
  detail: document.getElementById('local-conflict-detail'),
  theirs: document.getElementById('local-conflict-theirs'),
  copy: document.getElementById('local-conflict-copy'),
  overwrite: document.getElementById('local-conflict-overwrite'),
}

/** Ask what to do about a file that changed on disk. Resolves to
 *  'theirs' | 'copy' | 'overwrite' | 'cancel'. */
function askLocalConflict(doc, cur) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (choice) => {
      if (settled) return
      settled = true
      localConflict.theirs.onclick = localConflict.copy.onclick = localConflict.overwrite.onclick = null
      localConflict.dialog.removeEventListener('close', onCancel)
      resolve(choice)
    }
    const onCancel = () => finish('cancel')
    const choose = (choice) => {
      localConflict.dialog.removeEventListener('close', onCancel)
      localConflict.dialog.close()
      finish(choice)
    }
    localConflict.name.textContent = doc.name
    const theirs = [fmtWhen(cur.lastModified), cur.size != null && fmtBytes(cur.size)].filter(Boolean).join(', ')
    const yours = [fmtWhen(doc.updatedAt), fmtBytes(new Blob([doc.text]).size)].filter(Boolean).join(', ')
    localConflict.detail.textContent = `On disk: ${theirs} · Yours: ${yours}`
    localConflict.dialog.addEventListener('close', onCancel)
    localConflict.theirs.onclick = () => choose('theirs')
    localConflict.copy.onclick = () => choose('copy')
    localConflict.overwrite.onclick = () => choose('overwrite')
    localConflict.dialog.showModal()
  })
}

/** Replace a note's contents with the version now on disk. `cur` is the read
 *  already taken by the conflict check, so we don't read twice. */
async function pullLocal(doc, cur) {
  const fresh = cur ?? (await localFiles.read(doc.local.handle))
  doc.text = fresh.text
  doc.savedText = fresh.text
  doc.name = fresh.name
  doc.local = { handle: fresh.handle ?? doc.local.handle, name: fresh.name, lastModified: fresh.lastModified, size: fresh.size, savedAt: Date.now() }
  doc.updatedAt = Date.now()
  doc.localChanged = false
  if (doc.id === state.activeId) {
    if (editor) editor.setText(fresh.text)
    updatePreview()
  }
  await saveNow(doc)
  renderTabs()
  renderCloudStatus()
}

/* ---------- where to save a new note ---------- */

const saveTarget = {
  dialog: document.getElementById('save-target'),
  name: document.getElementById('save-target-name'),
  local: document.getElementById('save-target-local'),
  drive: document.getElementById('save-target-drive'),
  unsupported: document.getElementById('save-target-unsupported'),
  download: document.getElementById('save-target-download'),
}

/**
 * A note with no source yet: ask whether it goes to this computer or to Google
 * Drive. Where the browser can't write files directly, the local choice is
 * disabled and the panel explains why, offering a download instead.
 */
function openSaveTarget() {
  const doc = active()
  if (!doc) return
  const canLocal = localFiles.isSaveSupported()
  const canDrive = availableProviders().length > 0
  saveTarget.name.textContent = doc.name
  saveTarget.local.disabled = !canLocal
  saveTarget.local.classList.toggle('disabled', !canLocal)
  saveTarget.drive.hidden = !canDrive
  saveTarget.unsupported.hidden = canLocal
  saveTarget.dialog.showModal()
}

/** Write a cloud-backed note straight back to its Drive file. */
async function overwriteToCloud(doc) {
  const provider = providerFor(doc)
  if (!provider) return
  try {
    // Not before checking the file has not changed underneath us since we last
    // saw it — that is the only thing that turns this into a dialog.
    const { choice, cur } = await guardOverwrite(provider, doc)
    if (choice === 'cancel') return
    if (choice === 'theirs') { await pullTheirs(provider, doc); return }

    doc.cloudBusy = true
    renderCloudStatus()
    if (choice === 'copy') {
      const folder = await ensureAppFolder(provider)
      if (!folder) return
      const saved = await createInAppFolder(provider, { name: copyName(doc.name), text: doc.text }, folder)
      doc.remote = remoteLink(provider, saved)
      doc.name = saved.name
    } else {
      // 'follow' adopts the file's current Drive name (it was renamed or moved);
      // 'restore' brings it back from the trash first; 'overwrite' keeps our
      // name. All three write to the same file.
      if (choice === 'restore') await provider.untrash(doc.remote.id)
      const name = choice === 'follow' ? cur.name : doc.name
      const saved = await provider.write({ id: doc.remote.id, name, text: doc.text })
      doc.remote = remoteLink(provider, saved)
      if (saved.name) doc.name = saved.name
    }
    doc.savedText = doc.text
    doc.remoteChanged = doc.remoteRenamed = doc.remoteTrashed = false
    await saveNow(doc)
    renderTabs()
  } catch (err) {
    cloudFailed('save to the cloud', err)
  } finally {
    doc.cloudBusy = false
    renderCloudStatus()
  }
}

/* ---------- save to cloud as ---------- */

/**
 * "Save to cloud as…" — shaped like Google's file picker. `drive.file` cannot
 * list all of a Drive, so a starting folder is chosen from a dropdown of roots
 * (the connected folder, folders saved into, folders added by hand), a
 * breadcrumb walks into it, and one list shows folders and files.
 */
const saveAs = {
  dialog: document.getElementById('cloud-save-as'),
  name: document.getElementById('cloud-save-name'),
  tabs: document.getElementById('cloud-tabs'),
  tabApp: document.getElementById('cloud-tab-app'),
  path: document.getElementById('cloud-path'),
  explain: document.getElementById('cloud-explain'),
  files: document.getElementById('cloud-files'),
  newFolder: document.getElementById('cloud-new-folder'),
  addExternal: document.getElementById('cloud-add-folder'),
  confirm: document.getElementById('cloud-save-confirm'),
  cancel: document.getElementById('cloud-save-cancel'),
}

const FOLDER_MIME = 'application/vnd.google-apps.folder'
// A folder added by hand but never saved into drops off the My Drive tab after
// this long; one saved into stays for good, and the connected folder always is.
const ROOT_TTL_MINUTES = 60

let pickerProvider = null
let pickerTab = 'app' // 'app' (the connected folder) | 'mydrive' (added folders)
let pickerApp = null // { id, name } of the connected folder — the app tab's root
let pickerRoots = [] // added folders — the My Drive tab's list
let pickerPath = [] // [{ id, name }] below the current tab's root
let pickerEntries = { folders: [], files: [] } // contents of the current folder

const current = () => pickerPath[pickerPath.length - 1] || null
const rootsKey = (provider) => `${provider.id}:saveRoots`

/**
 * The starting folders offered in the dropdown: the connected folder (always),
 * folders saved into (kept for good), and folders added by hand (kept until the
 * TTL lapses). Pruning happens here, when the dialog opens.
 */
async function loadRoots(provider, appFolder) {
  let roots = (await drafts.getMeta(rootsKey(provider)).catch(() => null)) || []
  const now = Date.now()
  const ttl = ROOT_TTL_MINUTES * 60_000
  roots = roots.filter((r) => r.savedAt || now - (r.addedAt || 0) < ttl)
  const known = roots.find((r) => r.id === appFolder.id)
  if (known) known.name = appFolder.name
  else roots.unshift({ id: appFolder.id, name: appFolder.name, addedAt: now, savedAt: now })
  await drafts.putMeta(rootsKey(provider), roots).catch(reportError)
  return roots
}

async function addRoot(provider, folder) {
  const roots = (await drafts.getMeta(rootsKey(provider)).catch(() => null)) || []
  if (!roots.some((r) => r.id === folder.id)) {
    roots.push({ id: folder.id, name: folder.name, addedAt: Date.now() })
    await drafts.putMeta(rootsKey(provider), roots).catch(reportError)
  }
}

async function markRootSaved(provider, id) {
  const roots = (await drafts.getMeta(rootsKey(provider)).catch(() => null)) || []
  const r = roots.find((x) => x.id === id)
  if (r && !r.savedAt) {
    r.savedAt = Date.now()
    await drafts.putMeta(rootsKey(provider), roots).catch(reportError)
  }
}

async function openSaveAs() {
  const doc = active()
  if (!doc) return
  const provider = availableProviders()[0]
  if (!provider) return
  const folder = await ensureAppFolder(provider)
  if (!folder) return
  pickerProvider = provider
  pickerApp = { id: folder.id, name: folder.name }
  saveAs.name.value = doc.name
  const roots = await loadRoots(provider, folder)
  pickerRoots = roots.filter((r) => r.id !== folder.id)
  saveAs.tabApp.textContent = folder.name
  openTab('app')
  saveAs.dialog.showModal()
  saveAs.name.focus()
  saveAs.name.select()
}

/** Switch tab: 'app' starts in the connected folder; 'mydrive' lands on the list
 *  of added folders (and the explanation of why they must be added by hand). */
function openTab(tab) {
  pickerTab = tab
  pickerPath = tab === 'app' ? [pickerApp] : []
  for (const t of saveAs.tabs.querySelectorAll('.cloud-tab')) {
    t.classList.toggle('active', t.dataset.tab === tab)
  }
  loadEntries()
}

/** Draw the breadcrumb and the list for wherever we now are. */
async function loadEntries() {
  renderPath()
  saveAs.explain.hidden = !(pickerTab === 'mydrive' && !pickerPath.length)
  saveAs.files.textContent = ''

  // The My Drive tab's own root is not a real folder — Drive won't let us list
  // it — so it shows the added folders instead.
  if (pickerTab === 'mydrive' && !pickerPath.length) { renderRootList(); return }

  try {
    const items = await pickerProvider.list({ parent: current().id })
    pickerEntries = {
      folders: items.filter((f) => f.mimeType === FOLDER_MIME),
      files: items.filter((f) => f.mimeType !== FOLDER_MIME),
    }
  } catch {
    pickerEntries = { folders: [], files: [] }
  }
  renderEntries()
}

function renderRootList() {
  pickerEntries = { folders: [], files: [] }
  if (!pickerRoots.length) {
    const li = document.createElement('li')
    li.className = 'files-empty'
    li.textContent = 'No folders added yet — use “add a folder” above.'
    saveAs.files.append(li)
    return
  }
  for (const r of pickerRoots) {
    const li = document.createElement('li')
    li.className = 'entry e-folder'
    li.title = r.name
    const name = document.createElement('span')
    name.className = 'e-name'
    name.textContent = r.name
    li.append(name)
    li.onclick = () => { pickerPath = [{ id: r.id, name: r.name }]; loadEntries() }
    saveAs.files.append(li)
  }
}

/** The breadcrumb: within the app tab it is the descent from the connected
 *  folder; within My Drive it starts at a "My Drive" crumb back to the list. */
function renderPath() {
  saveAs.path.textContent = ''
  const crumbs = []
  if (pickerTab === 'mydrive') {
    crumbs.push({ name: 'My Drive', to: () => { pickerPath = []; loadEntries() } })
  }
  pickerPath.forEach((p, i) => {
    crumbs.push({ name: p.name, to: () => { pickerPath = pickerPath.slice(0, i + 1); loadEntries() } })
  })
  crumbs.forEach((c, i) => {
    if (i) {
      const sep = document.createElement('span')
      sep.className = 'crumb-sep'
      sep.textContent = '›'
      saveAs.path.append(sep)
    }
    // The last crumb is where we already are — plain text, not a link.
    const last = i === crumbs.length - 1
    const node = document.createElement(last ? 'span' : 'button')
    node.className = last ? 'crumb current' : 'crumb'
    node.textContent = c.name
    if (!last) {
      node.type = 'button'
      node.onclick = c.to
    }
    saveAs.path.append(node)
  })
}

function renderEntries() {
  saveAs.files.textContent = ''
  const { folders, files } = pickerEntries
  if (!folders.length && !files.length) {
    const li = document.createElement('li')
    li.className = 'files-empty'
    li.textContent = 'Empty, or nothing here this app can see.'
    saveAs.files.append(li)
    return
  }
  folders.sort((a, b) => a.name.localeCompare(b.name))
  files.sort((a, b) => a.name.localeCompare(b.name))

  for (const f of folders) {
    const li = document.createElement('li')
    li.className = 'entry e-folder'
    li.title = f.name
    const name = document.createElement('span')
    name.className = 'e-name'
    name.textContent = f.name
    li.append(name)
    li.onclick = () => { pickerPath.push({ id: f.id, name: f.name }); loadEntries() }
    saveAs.files.append(li)
  }
  for (const f of files) {
    const li = document.createElement('li')
    li.className = 'entry e-file'
    li.dataset.id = f.id
    li.title = f.name
    const name = document.createElement('span')
    name.className = 'e-name'
    name.textContent = f.name
    const meta = document.createElement('span')
    meta.className = 'e-meta'
    meta.textContent = [fmtDate(f.modifiedTime), f.size != null ? fmtBytes(f.size) : null]
      .filter(Boolean)
      .join(' · ')
    li.append(name, meta)
    li.onclick = () => { saveAs.name.value = f.name; highlightFile(f.id) }
    li.ondblclick = () => { saveAs.name.value = f.name; confirmSaveAs() }
    saveAs.files.append(li)
  }
}

function highlightFile(id) {
  for (const row of saveAs.files.querySelectorAll('.e-file')) {
    row.classList.toggle('selected', row.dataset.id === id)
  }
}

async function newFolder() {
  if (!current()) { alert('Open a folder first, then make a new one inside it.'); return }
  const name = prompt('New folder name')
  if (!name?.trim()) return
  try {
    const folder = await pickerProvider.createFolder(name.trim(), [current().id])
    pickerPath.push({ id: folder.id, name: folder.name })
    await loadEntries()
  } catch (err) {
    cloudFailed('create the folder', err)
  }
}

async function addExternalFolder() {
  // Google's picker renders beneath this <dialog>'s top layer, so step out while
  // it is up and back in with the result; the typed name is preserved. The
  // added folder joins the My Drive tab, and we open straight into it.
  const typed = saveAs.name.value
  saveAs.dialog.close()
  try {
    const folder = await pickerProvider.pickFolder()
    if (folder) {
      await addRoot(pickerProvider, folder)
      const roots = await loadRoots(pickerProvider, pickerApp)
      pickerRoots = roots.filter((r) => r.id !== pickerApp.id)
      pickerTab = 'mydrive'
      for (const t of saveAs.tabs.querySelectorAll('.cloud-tab')) {
        t.classList.toggle('active', t.dataset.tab === 'mydrive')
      }
      pickerPath = [{ id: folder.id, name: folder.name }]
      await loadEntries()
    }
  } catch (err) {
    cloudFailed('add a folder', err)
  }
  saveAs.name.value = typed
  saveAs.dialog.showModal()
}

async function confirmSaveAs() {
  const doc = active()
  if (!doc) return
  if (!current()) { alert('Choose a folder to save into.'); return }
  const name = saveAs.name.value.trim() || doc.name
  // A name that matches a file already in this folder means "save over it",
  // like a normal save dialog — confirm first, then write to that file's id.
  const existing = pickerEntries.files.find((f) => f.name.toLowerCase() === name.toLowerCase())
  if (existing && !confirm(`“${existing.name}” already exists here. Replace it?`)) return
  saveAs.confirm.disabled = true
  doc.cloudBusy = true
  renderCloudStatus()
  try {
    const saved = existing
      ? await pickerProvider.write({ id: existing.id, name, text: doc.text })
      : await pickerProvider.write({ name, text: doc.text, parents: [current().id] })
    doc.remote = remoteLink(pickerProvider, saved)
    doc.name = saved.name || name
    doc.savedText = doc.text
    doc.remoteChanged = false
    await markRootSaved(pickerProvider, pickerPath[0].id)
    await saveNow(doc)
    renderTabs()
    saveAs.dialog.close()
  } catch (err) {
    cloudFailed('save to the cloud', err)
  } finally {
    saveAs.confirm.disabled = false
    doc.cloudBusy = false
    renderCloudStatus()
  }
}

/* ---------- wiring ---------- */

document.getElementById('btn-new').onclick = () => {
  setActive(addDoc('untitled.md', '# \n', null, 'new'))
  // A blank note is an invitation to type, so this is the one action that
  // always lands in the editor.
  setMode('edit', { focus: true })
}
el.modeBtn.onclick = toggleMode
document.getElementById('btn-open').onclick = openLocal
document.getElementById('btn-save').onclick = downloadActive
document.getElementById('btn-close').onclick = () => { if (state.activeId) closeTab(state.activeId) }
document.getElementById('btn-cloud-open').onclick = openFromCloud
document.getElementById('btn-cloud-save').onclick = saveActive
document.getElementById('btn-save-as').onclick = saveActiveAs
document.getElementById('btn-cloud-save-as').onclick = openSaveAs
// "Save As" writes a new local file, so it needs the picker; where that is
// missing, Download covers saving to a file instead.
document.getElementById('btn-save-as').hidden = !localFiles.isSaveSupported()
document.getElementById('btn-file-info').onclick = openFileInfo
// The status in the bar is a shortcut to the same panel.
if (el.cloudState) el.cloudState.onclick = openFileInfo
fi.save.onclick = () => { fi.dialog.close(); saveActive() }
saveTarget.local.onclick = () => { saveTarget.dialog.close(); saveToLocal(active()) }
saveTarget.drive.onclick = () => { saveTarget.dialog.close(); openSaveAs() }
saveTarget.download.onclick = (e) => { e.preventDefault(); saveTarget.dialog.close(); downloadActive() }
for (const t of saveAs.tabs.querySelectorAll('.cloud-tab')) t.onclick = () => openTab(t.dataset.tab)
saveAs.newFolder.onclick = newFolder
saveAs.addExternal.onclick = addExternalFolder
saveAs.confirm.onclick = confirmSaveAs
saveAs.cancel.onclick = () => saveAs.dialog.close()

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
  // Ctrl+S is Save: back to the note's own file (on disk or in Drive) when it
  // has one, otherwise a chooser. Download keeps its menu place, without a key.
  { id: 'btn-cloud-save', mod: 'ctrl', code: 'KeyS', hint: 'S' },
  { id: 'btn-file-info', mod: 'alt', code: 'KeyI', hint: 'I' },
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

  // Where the browser supports it, a drop can yield a writable handle — but only
  // if getAsFileSystemHandle() is called synchronously, before this handler
  // returns and the items list is emptied. So the promises are gathered here and
  // awaited in dropHandles; the plain-files path is the fallback.
  const items = e.dataTransfer?.items
  if (items && localFiles.isSupported()) {
    const handles = []
    for (const item of items) {
      if (item.kind === 'file' && item.getAsFileSystemHandle) handles.push(item.getAsFileSystemHandle())
    }
    if (handles.length) return dropHandles(handles)
  }
  if (e.dataTransfer?.files.length) openFiles([...e.dataTransfer.files])
})

/** Resolve dropped handles, read each file, and open them with their source. */
async function dropHandles(promises) {
  const entries = []
  for (const p of promises) {
    const handle = await p.catch(() => null)
    if (handle?.kind !== 'file') continue
    try {
      entries.push(await localFiles.read(handle))
    } catch (err) {
      reportError(err)
    }
  }
  if (entries.length) openLocalFiles(entries)
}

// Returning to the tab is when someone else's edit is most likely to have
// landed, so that is when open cloud notes are re-checked for changes.
addEventListener('visibilitychange', maybeCheckRemote)
addEventListener('focus', maybeCheckRemote)

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

  // Clear any transient flags an older build may have persisted, so a note does
  // not come back stuck on "Saving…" or falsely "Changed in Drive".
  for (const doc of stored) for (const k of TRANSIENT_KEYS) delete doc[k]

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
  renderCloudStatus()

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
      cloud: {
        isConnected: isCloudConnected,
        connect: connectCloud,
        disconnect: disconnectCloud,
        folder: (provider) => knownAppFolder(provider),
      },
    })
  } catch (err) {
    reportError(err)
  }
}

init().catch((err) => {
  reportError(err)
  el.preview.innerHTML = '<p class="empty-note">Could not start. See the browser console.</p>'
})
