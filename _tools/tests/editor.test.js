// The editor as a whole, driven through its DOM in a frame (editor-harness.js):
// autosave, the statuses, closing and the bin, the notices about browser
// storage, files on disk, and Google Drive through an in-memory stand-in.
// docs/STATUS.md lists the statuses; docs/ARCHITECTURE.md → Storage says why
// each notice exists.

import { withEditor, waitFor, sleep } from './editor-harness.js'
import { suite, test, assert } from './runner.js'

suite('editor: notes')

test('a first visit opens the welcome note, and stores it', () => withEditor(async (ed) => {
  assert.deepEqual(ed.tabs(), ['welcome.md'])
  await waitFor(() => ed.stored('welcome.md'), 'the welcome note stored')
  assert.equal(ed.status().text, '', 'an untouched note shows no status')
}))

test('a new note says "Not saved" once edited, and is stored a moment later', () => withEditor(async (ed) => {
  await ed.newNote()
  assert.equal(ed.status().text, '', 'untouched')
  await ed.type('hello')
  assert.equal(ed.status().text, 'Not saved')
  assert.ok(ed.status().cls.includes('warn'), 'in amber')
  await waitFor(async () => (await ed.storedDocs()).some((d) => d.text === 'hello'), 'the text stored')
}))

test('switching notes keeps the last keystrokes of each', () => withEditor(async (ed) => {
  await ed.newNote()
  await ed.type('first note')
  await ed.newNote() // well within the autosave delay
  await ed.type('second note')
  await waitFor(async () => {
    const texts = (await ed.storedDocs()).map((d) => d.text)
    return texts.includes('first note') && texts.includes('second note')
  }, 'both notes stored')
}))

test('leaving the page stores what the autosave still holds', () => withEditor(async (ed) => {
  await ed.newNote()
  await ed.type('typed just before leaving')
  ed.win.dispatchEvent(new ed.win.Event('pagehide'))
  // Sooner than the autosave delay (400 ms) would have written it.
  await waitFor(async () => (await ed.storedDocs()).some((d) => d.text === 'typed just before leaving'),
    'the text stored on leaving', 250)
}))

test('open notes come back after a reload', () => withEditor(async (ed) => {
  await ed.newNote()
  await ed.type('still here')
  await waitFor(async () => (await ed.storedDocs()).some((d) => d.text === 'still here'), 'stored')
  await ed.reload()
  assert.deepEqual(ed.tabs(), ['welcome.md', 'untitled.md'])
  const editor = await ed.editor()
  assert.equal(editor.getValue(), 'still here')
}))

test('closing an untouched note removes it without asking', () => withEditor(async (ed) => {
  await ed.newNote()
  await waitFor(async () => (await ed.storedDocs()).length === 2, 'the new note stored')
  ed.closeActive()
  assert.ok(!ed.isOpen('close-warn'), 'no question')
  assert.deepEqual(ed.tabs(), ['welcome.md'])
  await waitFor(async () => (await ed.storedDocs()).length === 1, 'the note deleted, not binned')
}))

test('Discard changes sends the note to the bin', () => withEditor(async (ed) => {
  await ed.newNote()
  await ed.type('to be discarded')
  ed.closeActive()
  await ed.choose('close-warn', 'Discard changes')
  await waitFor(() => !ed.tabs().includes('untitled.md'), 'the tab closed')
  const binned = (await ed.storedDocs()).find((d) => d.text === 'to be discarded')
  assert.ok(binned?.binnedAt, 'in the bin, with its text')
}))

suite('editor: storage')

test('a refused write shows Storage error and a notice; Try again stores it', () => withEditor(async (ed) => {
  await ed.newNote()
  ed.win.refuseWrites = true
  await ed.type('refused')
  await waitFor(() => ed.status().text === 'Storage error', 'the status')
  assert.ok(ed.status().cls.includes('error'), 'in red')
  const notice = ed.banner()
  assert.ok(notice?.text.startsWith('This browser refused to store'), `the notice, got ${JSON.stringify(notice)}`)
  assert.equal(notice.action, 'Try again')
  assert.ok(ed.leaveAsks(), 'leaving asks first')

  ed.$('#banner-action').click() // still refused
  await sleep(200)
  assert.equal(ed.status().text, 'Storage error', 'still refused')

  ed.win.refuseWrites = false
  ed.$('#banner-action').click()
  await waitFor(() => ed.status().text === 'Not saved', 'the error cleared')
  assert.equal(ed.banner(), null, 'the notice gone')
  assert.ok(!ed.leaveAsks(), 'leaving no longer asks')
  assert.ok((await ed.storedDocs()).some((d) => d.text === 'refused'), 'stored after all')
}))

test('coming back to the page tries a refused write again', () => withEditor(async (ed) => {
  await ed.newNote()
  ed.win.refuseWrites = true
  await ed.type('refused')
  await waitFor(() => ed.status().text === 'Storage error', 'the error')
  ed.win.refuseWrites = false
  await ed.comeBack(() => ed.status().text === 'Not saved', 'the error cleared on focus')
}))

test('downloading a refused note clears the error: the text is in a file', () => withEditor(async (ed) => {
  await ed.newNote()
  ed.win.refuseWrites = true
  await ed.type('refused')
  await waitFor(() => ed.status().text === 'Storage error', 'the error')
  ed.$('#btn-save').click() // Download as .md
  assert.deepEqual(ed.win.downloads, ['untitled.md'])
  await waitFor(() => ed.status().text === '', 'no status once downloaded')
  assert.ok(!ed.leaveAsks(), 'nothing to lose by leaving')
}))

test('discarding a note the bin refuses asks first', () => withEditor(async (ed) => {
  await ed.newNote()
  ed.win.refuseWrites = true
  await ed.type('refused')
  await waitFor(() => ed.status().text === 'Storage error', 'the error')

  ed.win.answer = false
  ed.closeActive()
  await ed.choose('close-warn', 'Discard changes')
  await waitFor(() => ed.win.asked.some((q) => q.startsWith('The bin could not take')), 'the question')
  assert.ok(ed.tabs().includes('untitled.md'), 'kept when the answer is no')

  ed.win.answer = true
  ed.closeActive()
  await ed.choose('close-warn', 'Discard changes')
  await waitFor(() => !ed.tabs().includes('untitled.md'), 'dropped when the answer is yes')
}))

test('blocked storage is said at once, with a way to fix it', () => withEditor({
  // Chrome when the site may not store data: the open request fails.
  before: `IDBFactory.prototype.open = function () {
    const req = { error: new DOMException('Access to the IndexedDB API is denied in this context.', 'UnknownError') }
    setTimeout(() => req.onerror && req.onerror())
    return req
  }`,
}, async (ed) => {
  const notice = await waitFor(() => ed.banner(), 'the notice')
  assert.ok(notice.text.startsWith('This browser won’t let lemma-md store anything'), notice.text)
  assert.ok(!notice.closable, 'it stays')
  assert.ok(notice.link?.href.endsWith('/help/#storage-blocked'), 'links to the answer')
  assert.equal(notice.link.target, '_blank', 'in a new tab')

  ed.$('#btn-settings').click()
  await waitFor(() => ed.isOpen('settings'), 'Settings to open')
  assert.ok(ed.$('#storage-usage').textContent.includes('won’t let lemma-md store anything'), 'Settings says so')
}))

test('an upgrade from another tab asks for a reload; leaving then asks first', () => withEditor(async (ed) => {
  await waitFor(() => ed.stored('welcome.md'), 'started')
  // A newer build opens the database at a higher version; aborting its
  // upgrade leaves the test database as it was.
  await new Promise((resolve) => {
    const req = indexedDB.open(ed.database, 3)
    req.onupgradeneeded = () => req.transaction.abort()
    req.onerror = () => resolve()
    req.onsuccess = () => { req.result.close(); resolve() }
  })
  const notice = await waitFor(() => ed.banner(), 'the notice')
  assert.ok(notice.text.startsWith('lemma-md was updated in another tab'), notice.text)
  assert.equal(notice.action, 'Reload')
  assert.ok(!notice.closable, 'it stays')

  await ed.newNote()
  await ed.type('typed after the update')
  await waitFor(() => ed.status().text === 'Storage error', 'the status')
  assert.ok(ed.leaveAsks(), 'Reload, or leaving, asks first')
}))

// Files on disk, through the browser's private file system (OPFS): its handles
// are real FileSystemFileHandles, so the app reads, writes and stores them as
// it does a file the user picked. Only the pickers are stubbed, to return them.

const DISK = `lemma-md-tests-${Date.now()}`
let folders = 0

/** Run `body` with a folder of its own in OPFS, removed afterwards. */
async function withDisk(body) {
  const root = await navigator.storage.getDirectory()
  const name = `${DISK}-${++folders}`
  const dir = await root.getDirectoryHandle(name, { create: true })
  try {
    await body(dir)
  } finally {
    await root.removeEntry(name, { recursive: true })
  }
}

async function writeFile(handle, text) {
  const writable = await handle.createWritable()
  await writable.write(text)
  await writable.close()
}

async function diskFile(dir, name, text) {
  const handle = await dir.getFileHandle(name, { create: true })
  await writeFile(handle, text)
  return handle
}

const readFile = async (handle) => (await handle.getFile()).text()

/** Open `handle` through "Open a file…". */
async function openFile(ed, handle) {
  ed.win.showOpenFilePicker = async () => [handle]
  ed.$('#btn-open').click()
  await waitFor(() => ed.activeTab() === handle.name, `${handle.name} open`)
}

suite('editor: files on disk')

test('Open a file… opens it; Save writes back into that file', () => withDisk((dir) => withEditor(async (ed) => {
  const file = await diskFile(dir, 'notes.md', 'on disk')
  await openFile(ed, file)
  assert.equal(ed.status().title, 'Saved to this computer')
  await ed.type(', edited')
  assert.equal(ed.status().text, 'Changed')
  ed.$('#btn-cloud-save').click()
  await waitFor(async () => (await readFile(file)) === 'on disk, edited', 'written back')
  await waitFor(() => ed.status().title === 'Saved to this computer', 'in step again')
})))

test('a file changed on disk is noticed on coming back', () => withDisk((dir) => withEditor(async (ed) => {
  const file = await diskFile(dir, 'notes.md', 'on disk')
  await openFile(ed, file)
  await writeFile(file, 'changed by another program')
  await ed.comeBack(() => ed.status().text === 'Changed on disk', 'the status')
})))

test('saving over a file changed on disk asks first', () => withDisk((dir) => withEditor(async (ed) => {
  const file = await diskFile(dir, 'notes.md', 'on disk')
  await openFile(ed, file)
  await ed.type(', mine')
  await writeFile(file, 'changed by another program')
  ed.$('#btn-cloud-save').click()
  await waitFor(() => ed.isOpen('local-conflict'), 'the question')
  assert.equal(await readFile(file), 'changed by another program', 'nothing written before the answer')
  ed.$('#local-conflict-overwrite').click()
  assert.ok(ed.win.asked.includes('Overwrite the file on disk with your version?'), 'and asks once more')
  await waitFor(async () => (await readFile(file)) === 'on disk, mine', 'overwritten')
})))

/** Make `handle` read as `text` from now on, with the date and size it had: an
 *  edit that leaves both alone, as some programs and file systems do. */
async function editKeepingDateAndSize(handle, text) {
  const was = await handle.getFile()
  assert.equal(new Blob([text]).size, was.size, 'the same size')
  handle.getFile = async () => new File([text], was.name, { lastModified: was.lastModified })
}

/** Make reading `handle` fail from now on, as for a file moved, deleted or
 *  locked by another program. */
function failReads(handle, name, message) {
  handle.getFile = async () => { throw new DOMException(message, name) }
}

test('an edit on disk that keeps date and size is still noticed', () => withDisk((dir) => withEditor(async (ed) => {
  const file = await diskFile(dir, 'notes.md', 'on disk')
  await openFile(ed, file)
  await editKeepingDateAndSize(file, 'by them')
  await ed.comeBack(() => ed.status().text === 'Changed on disk', 'the status')
})))

test('saving over an edit that kept date and size asks first', () => withDisk((dir) => withEditor(async (ed) => {
  const file = await diskFile(dir, 'notes.md', 'on disk')
  await openFile(ed, file)
  await ed.type(', mine')
  await editKeepingDateAndSize(file, 'by them')
  ed.$('#btn-cloud-save').click()
  await waitFor(() => ed.isOpen('local-conflict'), 'the question')
})))

test('a file that cannot be read is not written over without asking', () => withDisk((dir) => withEditor(async (ed) => {
  const file = await diskFile(dir, 'notes.md', 'on disk')
  await openFile(ed, file)
  await ed.type(', mine')
  failReads(file, 'NotReadableError', 'The file could not be read.')
  ed.$('#btn-cloud-save').click()
  await waitFor(() => ed.isOpen('local-conflict'), 'the question')
  assert.ok(ed.$('#local-conflict-title').textContent.includes('can’t be checked'), 'a question of its own')
  assert.ok(ed.$('#local-conflict-text').textContent.includes('(The file could not be read)'), 'with the reason')
  const shown = (el) => ed.win.getComputedStyle(el).display !== 'none'
  assert.ok(!shown(ed.$('#local-conflict-theirs')), 'nothing on disk to reload')
  assert.ok(!shown(ed.$('#local-conflict-compare').closest('p')), 'nothing to compare with')
  assert.ok(shown(ed.$('#local-conflict-copy')), 'a copy can still be saved')
  delete file.getFile // reading works again, so the test can see what is written
  assert.equal(await readFile(file), 'on disk', 'nothing written before the answer')

  await ed.choose('local-conflict', 'Write anyway')
  assert.ok(ed.win.asked.some((q) => q.startsWith('Write your version to “notes.md”')), 'and asks once more')
  await waitFor(async () => (await readFile(file)) === 'on disk, mine', 'written')
})))

test('a file deleted on disk can be saved as a new one', () => withDisk((dir) => withEditor(async (ed) => {
  const file = await diskFile(dir, 'notes.md', 'on disk')
  const copy = await diskFile(dir, 'notes copy.md', '')
  await openFile(ed, file)
  await ed.type(', mine')
  failReads(file, 'NotFoundError', 'A requested file or directory could not be found.')
  ed.win.showSaveFilePicker = async () => copy
  ed.$('#btn-cloud-save').click()
  await ed.choose('local-conflict', 'Save a copy…')
  await waitFor(async () => (await readFile(copy)) === 'on disk, mine', 'the copy written')
  await waitFor(() => ed.activeTab() === 'notes copy.md', 'the note now lives in the copy')
})))

test('a declined permission writes nothing, and says so', () => withDisk((dir) => withEditor(async (ed) => {
  const file = await diskFile(dir, 'locked.md', 'on disk')
  // As after a reload, when the browser asks again and the answer is no. Own
  // properties on the handle; storing it in IndexedDB keeps only the handle.
  file.queryPermission = async () => 'prompt'
  file.requestPermission = async () => 'denied'
  await openFile(ed, file)
  await ed.type(', edited')
  ed.$('#btn-cloud-save').click()
  await waitFor(() => ed.win.alerts.includes('Permission to write this file was declined.'), 'the message')
  assert.equal(await readFile(file), 'on disk', 'nothing written')
  assert.equal(ed.status().text, 'Changed', 'still unsaved')
})))

test('Save on a new note saves it to a file, then closes it', () => withDisk((dir) => withEditor(async (ed) => {
  const file = await diskFile(dir, 'new.md', '')
  ed.win.showSaveFilePicker = async () => file
  await ed.newNote()
  await ed.type('a new note')
  ed.closeActive()
  await ed.choose('close-warn', 'Save')
  await waitFor(() => ed.isOpen('save-target'), 'where to save')
  ed.$('#save-target-local').click()
  await waitFor(async () => (await readFile(file)) === 'a new note', 'written')
  await waitFor(() => ed.tabs().length === 1, 'the tab closed')
  await waitFor(async () => !(await ed.storedDocs()).some((d) => d.text === 'a new note'),
    'gone from the browser, not binned: the file is the copy')
})))

// Google Drive, through the in-memory provider of fake-drive.js. The app's own
// folder is remembered, as after a first connection, so no setup dialog shows.

const DRIVE = {
  fakeDrive: true,
  meta: { 'gdrive:appFolder': { id: 'folder-app', name: 'lemma-md' } },
}

/** Put a file in the fake Drive and open it through "Open from cloud…". */
async function openFromDrive(ed, name, text) {
  const drive = await waitFor(() => ed.win.fakeDrive, 'the fake Drive')
  const id = drive.add({ name, text })
  drive.picks.push({ id, name })
  ed.$('#btn-cloud-open').click()
  await waitFor(() => ed.activeTab() === name, `${name} open`)
  return { drive, id }
}

suite('editor: Google Drive')

test('a note opened from Drive saves back into the same file', () => withEditor(DRIVE, async (ed) => {
  const { drive, id } = await openFromDrive(ed, 'drive.md', 'from Drive')
  assert.ok(!/Changed/.test(ed.status().text), 'in step: a time, no status word')
  await ed.type(', edited')
  assert.equal(ed.status().text, 'Changed')
  ed.$('#btn-cloud-save').click()
  await waitFor(() => drive.files.get(id).text === 'from Drive, edited', 'written to the same file')
  await waitFor(() => ed.status().text !== 'Changed', 'in step again')
  assert.equal(drive.writes.length, 1, 'one write')
}))

test('a change made in Drive is noticed on coming back', () => withEditor(DRIVE, async (ed) => {
  const { drive, id } = await openFromDrive(ed, 'drive.md', 'from Drive')
  drive.outside.edit(id, 'edited on another device')
  await ed.comeBack(() => ed.status().text === 'Changed in Drive', 'the status')
  assert.ok(ed.$('#tabs .tab.active .dot.remote'), 'and a mark on the tab')
}))

test('a file renamed in Drive is noticed', () => withEditor(DRIVE, async (ed) => {
  const { drive, id } = await openFromDrive(ed, 'drive.md', 'from Drive')
  drive.outside.rename(id, 'renamed elsewhere.md')
  await ed.comeBack(() => ed.status().text === 'Renamed in Drive', 'the status')
}))

test('a file trashed in Drive is noticed', () => withEditor(DRIVE, async (ed) => {
  const { drive, id } = await openFromDrive(ed, 'drive.md', 'from Drive')
  drive.outside.trash(id)
  await ed.comeBack(() => ed.status().text === 'In Drive trash', 'the status')
}))

test('saving over a file changed in Drive asks first', () => withEditor(DRIVE, async (ed) => {
  const { drive, id } = await openFromDrive(ed, 'drive.md', 'from Drive')
  await ed.type(', mine')
  drive.outside.edit(id, 'edited on another device')
  ed.$('#btn-cloud-save').click()
  await waitFor(() => ed.isOpen('cloud-conflict'), 'the question')
  assert.equal(drive.writes.length, 0, 'nothing written before the answer')
  ed.$('#conflict-overwrite').click()
  assert.ok(ed.win.asked.includes('Overwrite the file in Drive with your version?'), 'and asks once more')
  await waitFor(() => drive.files.get(id).text === 'from Drive, mine', 'overwritten')
}))

test('renaming a Drive note is an unsaved change, and Save carries the name', () => withEditor(DRIVE, async (ed) => {
  const { drive, id } = await openFromDrive(ed, 'drive.md', 'from Drive')
  // A double click, as the app counts one. The first click redraws the tabs,
  // so the second lands on the new label, as a person's would.
  ed.$('#tabs .tab.active .name').click()
  ed.$('#tabs .tab.active .name').click()
  const input = await waitFor(() => ed.$('#tabs .tab.active input.tab-rename'), 'the rename field')
  input.value = 'renamed.md'
  input.dispatchEvent(new ed.win.KeyboardEvent('keydown', { key: 'Enter' }))
  await waitFor(() => ed.activeTab() === 'renamed.md', 'the new name')

  assert.equal(ed.status().text, 'Changed', 'the status')
  assert.equal(ed.activeDot(), 'Renamed since it was last saved', 'the dot says why')
  ed.closeActive()
  await waitFor(() => ed.isOpen('close-warn'), 'closing to ask')
  ed.$('#close-warn').close()

  ed.$('#btn-cloud-save').click()
  await waitFor(() => drive.files.get(id).name === 'renamed.md', 'the name reached Drive')
  await waitFor(() => ed.status().text !== 'Changed', 'in step again')
}))

suite('editor: answers that come late')

// Drive answers in its own time. Whatever a dialog was opened for, and
// whatever is on screen, must still be what its answer is applied to.

const listed = (ed) => ed.$$('#cloud-files .entry .e-name').map((n) => n.textContent)

test('Save As to Drive saves the note it was opened for', () => withEditor(DRIVE, async (ed) => {
  const drive = await waitFor(() => ed.win.fakeDrive, 'the fake Drive')
  await ed.newNote()
  await ed.type('note A')
  await ed.newNote()
  await ed.type('note B')
  ed.$$('#tabs .tab .name')[1].click() // back to A
  await waitFor(async () => (await ed.editor()).getValue() === 'note A', 'A shown')

  drive.delay.stat = 300 // Drive is slow while the dialog gets ready…
  ed.$('#btn-cloud-save-as').click()
  ed.$$('#tabs .tab .name')[2].click() // …and meanwhile the person moves on to B
  await waitFor(() => ed.isOpen('cloud-save-as'), 'the dialog')
  await waitFor(() => !ed.$('#cloud-save-confirm').disabled, 'the dialog ready')
  ed.$('#cloud-save-confirm').click()
  await waitFor(() => drive.writes.length === 1, 'the write')
  assert.equal(drive.writes[0].text, 'note A', 'the text of the note the dialog was opened for')
  await waitFor(() => !ed.isOpen('cloud-save-as'), 'the dialog closed')
  await sleep(50) // whatever follows the write has run
  assert.deepEqual(ed.win.alerts, [], 'and no failure reported after it')
}))

test('a slow folder listing cannot replace the one on screen', () => withEditor(DRIVE, async (ed) => {
  const drive = await waitFor(() => ed.win.fakeDrive, 'the fake Drive')
  const slow = drive.add({ name: 'slow', folder: true })
  drive.add({ name: 'in-slow.md', text: 'x', parents: [slow] })
  drive.add({ name: 'top.md', text: 'y' })
  await ed.newNote()
  await ed.type('text')
  ed.$('#btn-cloud-save-as').click()
  await waitFor(() => ed.isOpen('cloud-save-as') && listed(ed).includes('top.md'), 'the app folder listed')

  drive.delay.list = (parent) => (parent === slow ? 400 : 0)
  ed.$$('#cloud-files .e-folder').find((li) => li.textContent.includes('slow')).click()
  assert.ok(ed.$('#cloud-save-confirm').disabled, 'no saving into a folder still loading')
  ed.$('#cloud-path button.crumb').click() // back up before it answers
  await sleep(600) // the slow answer has come and gone
  assert.equal(ed.$('#cloud-path .crumb.current').textContent, 'lemma-md', 'the breadcrumb')
  assert.deepEqual(listed(ed), ['slow', 'top.md'], 'the list matches the breadcrumb')
  assert.ok(!ed.$('#cloud-save-confirm').disabled, 'saving is possible again')
}))

test('reloading from Drive keeps what was typed while it loaded, unless told otherwise', () => withEditor(DRIVE, async (ed) => {
  const { drive, id } = await openFromDrive(ed, 'drive.md', 'from Drive')
  await ed.type(', mine')
  drive.outside.edit(id, 'edited on another device')
  ed.$('#btn-cloud-save').click()
  await waitFor(() => ed.isOpen('cloud-conflict'), 'the question')

  drive.delay.read = 400
  ed.$('#conflict-theirs').click() // "Reload theirs", confirmed
  await sleep(50)
  ed.win.answer = false // to whatever is asked once Drive answers
  await ed.type(' and more') // typed while Drive is answering
  await sleep(600)
  assert.equal((await ed.editor()).getValue(), 'from Drive, mine and more', 'kept')
  assert.ok(ed.win.asked.some((q) => q.includes('while its Drive version was loading')), 'it asked first')
}))
