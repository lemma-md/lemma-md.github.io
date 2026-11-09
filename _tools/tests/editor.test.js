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

test('a menu taller than the window scrolls within itself', () => withEditor(async (ed) => {
  ed.win.frameElement.style.height = '400px'
  ed.$('#btn-menu').click()
  const menu = ed.$('#menu')
  await waitFor(() => !menu.hidden, 'the menu open')
  assert.ok(menu.getBoundingClientRect().bottom <= ed.win.innerHeight, 'the menu ends inside the window')
  assert.ok(menu.scrollHeight > menu.clientHeight, 'and scrolls')
  assert.ok(ed.doc.documentElement.scrollHeight <= ed.win.innerHeight, 'the page does not grow under it')
  menu.scrollTop = menu.scrollHeight
  const last = ed.$('#btn-help').getBoundingClientRect()
  assert.ok(last.bottom <= menu.getBoundingClientRect().bottom + 1, 'its last entry can be reached')
}))

test('the preview makes a title slide exactly when the projector does', () => withEditor(async (ed) => {
  await ed.newNote()
  const editor = await ed.editor()
  const cards = () => ed.$$('#preview .slide-card')
  const titled = () => cards()[0]?.classList.contains('title')

  editor.setValue('---\nfontsize: 28\n---\n\n# One\n\n---\n\n# Two', 1)
  await waitFor(() => cards().length === 2, 'two slides')
  assert.ok(!titled(), 'options alone make no title slide')

  editor.setValue('---\ntitle: A talk\n---\n\n# One\n\n---\n\n# Two', 1)
  await waitFor(() => cards().length === 3, 'a title slide and two more')
  assert.ok(titled(), 'a title makes one')
}))

test('an edit to one slide changes its card alone; the others, a repeated one too, stay in place', () => withEditor(async (ed) => {
  await ed.newNote()
  const editor = await ed.editor()
  const cards = () => [...ed.$$('#preview .slide-card')]
  const deck = (b) => `---\nfontsize: 28\n---\n\n# A\n\n---\n\nSame\n\n---\n\n# ${b}\n\n---\n\nSame\n\n---\n\n# C`
  editor.setValue(deck('B'), 1)
  await waitFor(() => cards().length === 5, 'five slides')
  const before = cards()
  let added = 0
  let removed = 0
  const count = (records) => { for (const r of records) { added += r.addedNodes.length; removed += r.removedNodes.length } }
  const observer = new ed.win.MutationObserver(count)
  observer.observe(ed.$('#preview .deck-preview'), { childList: true })
  editor.setValue(deck('Bee'), 1)
  await waitFor(() => cards()[2]?.querySelector('h1')?.textContent === 'Bee', 'the third slide changed')
  count(observer.takeRecords())
  observer.disconnect()
  assert.deepEqual(cards().map((card, i) => card === before[i]), [true, true, false, true, true], 'the same cards but the third')
  assert.deepEqual([added, removed], [1, 1], 'one card put in, one taken out')
}))

test('slides swapped, taken out or put in: the other cards are kept, and numbered anew', () => withEditor(async (ed) => {
  await ed.newNote()
  const editor = await ed.editor()
  const cards = () => [...ed.$$('#preview .slide-card')]
  const titles = () => cards().map((card) => card.querySelector('h1')?.textContent)
  const numbers = () => cards().map((card) => card.querySelector('.slide-num').textContent).join(' ')
  const deck = (...slides) => '---\nfontsize: 28\n---\n\n' + slides.map((s) => `# ${s}\n\nText of ${s}, $x_${s}$.`).join('\n\n---\n\n')
  editor.setValue(deck('A', 'B', 'C', 'D'), 1)
  await waitFor(() => titles().join() === 'A,B,C,D', 'four slides')
  const [a, b, c, d] = cards()

  editor.setValue(deck('A', 'C', 'B', 'D'), 1)
  await waitFor(() => titles().join() === 'A,C,B,D', 'B and C swapped')
  assert.deepEqual(cards(), [a, c, b, d], 'the same four cards')
  assert.equal(numbers(), '1 2 3 4')

  editor.setValue(deck('A', 'B', 'D'), 1)
  await waitFor(() => titles().join() === 'A,B,D', 'C taken out')
  assert.deepEqual(cards(), [a, b, d])
  assert.equal(numbers(), '1 2 3')

  editor.setValue(deck('E', 'A', 'B', 'D'), 1)
  await waitFor(() => titles().join() === 'E,A,B,D', 'E put in first')
  assert.deepEqual(cards().slice(1), [a, b, d], 'the others kept')
  assert.equal(numbers(), '1 2 3 4')
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
  assert.ok(notice.link?.href.endsWith('/help/troubleshooting/#storage-blocked'), 'links to the answer')
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

suite('editor: formulas from a chat')

const CHAT = 'For \\( f(x) = x^2 \\):\n\n\\[\nf\'(x) = 2x\n\\]\n'

test('a file with \\( \\) formulas offers Fix, in reading mode; Undo takes it back', () => withDisk((dir) => withEditor(async (ed) => {
  await openFile(ed, await diskFile(dir, 'answer.md', CHAT))
  assert.equal(ed.doc.body.dataset.mode, 'view', 'still reading')
  assert.equal(ed.$$('#preview .katex').length, 0, 'shown as text')
  assert.deepEqual(ed.notice(), { text: '2 formulas written with \\( \\) or \\[ \\] are shown as plain text.', action: 'Fix', place: 'preview-pane' }, 'atop the preview while reading')
  assert.equal(ed.banner(), null, 'not in the banner, which is the whole app\'s')
  ed.$('#note-notice-action').click()
  assert.equal(ed.notice()?.text, 'Fixed 2 formulas: written with $ now.')
  await waitFor(() => ed.$$('#preview .katex').length === 2, 'typeset')
  assert.equal(ed.status().text, 'Changed', 'an edit, to save like any other')
  await waitFor(async () => (await ed.stored('answer.md'))?.text === 'For $f(x) = x^2$:\n\n$$\nf\'(x) = 2x\n$$\n', 'stored fixed')
  ed.$('#note-notice-action').click() // Undo
  assert.equal(ed.notice(), null)
  await waitFor(() => ed.$$('#preview .katex').length === 0, 'back to the text it was')
  assert.equal((await ed.editor()).getValue(), CHAT)
})))

test('a paste that brings \\( \\) offers Fix for the whole note, which Ctrl+Z takes back', () => withEditor(async (ed) => {
  await ed.newNote()
  await ed.type('Mine: \\(a\\). ')
  assert.equal(ed.notice(), null, 'typing offers nothing')
  const ace = await ed.editor()
  ace.navigateFileEnd()
  ace.onPaste('Pasted: \\(b\\).')
  await waitFor(() => ed.notice()?.action === 'Fix', 'the offer')
  assert.equal(ed.notice().place, 'editor-pane', 'under the toolbar while writing')
  ed.$('#note-notice-action').click()
  assert.equal(ace.getValue(), 'Mine: $a$. Pasted: $b$.')
  ace.undo()
  assert.equal(ace.getValue(), 'Mine: \\(a\\). Pasted: \\(b\\).', 'one step back, the paste kept')
  assert.equal(ed.notice(), null, 'and the Undo notice gone with it')
}))

test('switching notes takes the offer down', () => withDisk((dir) => withEditor(async (ed) => {
  await openFile(ed, await diskFile(dir, 'answer.md', CHAT))
  assert.equal(ed.notice()?.action, 'Fix')
  await ed.newNote()
  assert.equal(ed.notice(), null)
})))

suite('editor: toolbar')

const button = (ed, id) => ed.$(`#${id}`)

test('Undo and Redo, greyed out when there is nothing to do', () => withEditor(async (ed) => {
  await ed.newNote()
  const ace = await ed.editor()
  await waitFor(() => button(ed, 'tb-undo').disabled, 'nothing to undo in a new note')
  await ed.type('abc')
  await waitFor(() => !button(ed, 'tb-undo').disabled, 'Undo on')
  button(ed, 'tb-undo').click()
  await waitFor(() => ace.getValue() === '', 'undone')
  await waitFor(() => !button(ed, 'tb-redo').disabled, 'Redo on')
  button(ed, 'tb-redo').click()
  await waitFor(() => ace.getValue() === 'abc', 'redone')
  assert.ok(button(ed, 'tb-undo').title.endsWith('(Ctrl+Z)') || button(ed, 'tb-undo').title.endsWith('(⌘Z)'), 'the key in the tooltip')
}))

test('Find and Replace open the search box, Replace with its replace field', () => withEditor(async (ed) => {
  await ed.newNote()
  await ed.editor()
  button(ed, 'tb-replace').click()
  const box = await waitFor(() => ed.$('.ace_search'), 'the search box')
  await waitFor(() => box.querySelector('.ace_replace_form') && ed.win.getComputedStyle(box.querySelector('.ace_replace_form')).display !== 'none', 'the replace field showing')
}))

test('Fix from the toolbar says so when there is nothing to fix; again, puts the notice away', () => withEditor(async (ed) => {
  await ed.newNote()
  await ed.type('Only $x$ here.')
  button(ed, 'tb-fix').click()
  await waitFor(() => ed.notice()?.text === 'No formulas here are written with \\( \\) or \\[ \\].', 'the answer')
  button(ed, 'tb-fix').click()
  await waitFor(() => ed.notice() === null, 'put away')
  await ed.type(' And \\(y\\).')
  button(ed, 'tb-fix').click()
  await waitFor(() => ed.notice()?.action === 'Fix', 'the offer')
  button(ed, 'tb-fix').click()
  await waitFor(() => ed.notice() === null, 'put away again')
}))

/** Click a toolbar button and wait for the text it leaves. */
async function press(ed, ace, id, expected) {
  button(ed, id).click()
  await waitFor(() => ace.getValue() === expected, `${id}: ${JSON.stringify(expected)}`)
}

// What each press does to the text is in markup.test.js; these are the buttons.
test('Bold, italic and formulas: a second press takes them away; with nothing selected, the cursor waits between the marks', () => withEditor(async (ed) => {
  await ed.newNote()
  const ace = await ed.editor()
  ace.setValue('word', -1)
  ace.selectAll()
  await press(ed, ace, 'tb-bold', '**word**')
  assert.equal(ace.getSelectedText(), 'word', 'still selected')
  await press(ed, ace, 'tb-italic', '***word***')
  ace.undo()
  assert.equal(ace.getValue(), '**word**', 'each a step of its own for Ctrl+Z')
  ace.clearSelection()
  ace.moveCursorTo(0, 4)
  ace.execCommand('bold') // Ctrl+B, in the middle of the word
  assert.equal(ace.getValue(), 'word')
  ace.navigateFileEnd()
  ace.insert(' ')
  await press(ed, ace, 'tb-math', 'word $$')
  ace.insert('x')
  assert.equal(ace.getValue(), 'word $x$')
  await press(ed, ace, 'tb-display', 'word $$x$$')
  await press(ed, ace, 'tb-math', 'word $x$')
  await press(ed, ace, 'tb-math', 'word x')
}))

test('a Markdown button shows pressed where the cursor is in what it puts in', () => withEditor(async (ed) => {
  await ed.newNote()
  const ace = await ed.editor()
  const ids = ['tb-bold', 'tb-italic', 'tb-heading', 'tb-list', 'tb-math', 'tb-display']
  const on = () => ids.filter((id) => button(ed, id).getAttribute('aria-pressed') === 'true').join(' ')
  ace.setValue('# Title\n\nSome **bold** and $x$.', -1)
  ace.moveCursorTo(0, 3)
  await waitFor(() => on() === 'tb-heading', 'in the heading')
  ace.moveCursorTo(2, 8)
  await waitFor(() => on() === 'tb-bold', 'in the bold')
  ace.moveCursorTo(2, 19)
  await waitFor(() => on() === 'tb-math', 'in the formula')
  ace.moveCursorTo(2, 2)
  await waitFor(() => on() === '', 'in plain text')
  button(ed, 'tb-bold').click()
  await waitFor(() => ace.getValue().endsWith('**Some** **bold** and $x$.') && on() === 'tb-bold', 'pressed once the word is bold')
}))

test('the pressed buttons wait for a pause in typing, not read the text at every key', () => withEditor(async (ed) => {
  await ed.newNote()
  const ace = await ed.editor()
  const bold = () => button(ed, 'tb-bold').getAttribute('aria-pressed')
  ace.setValue('Some bold text.', -1)
  ace.moveCursorTo(0, 7)
  await waitFor(() => bold() === 'false', 'not pressed in plain text')
  // Four keys, the cursor put back in the word after each, as typing moves it.
  for (const column of [5, 6, 11, 12]) {
    ace.session.insert({ row: 0, column }, '*')
    ace.moveCursorTo(0, 8)
  }
  assert.equal(ace.getValue(), 'Some **bold** text.')
  await sleep(0)
  assert.equal(bold(), 'false', 'not yet, right after the keys')
  await waitFor(() => bold() === 'true', 'pressed after the pause, the word now bold')
}))

test('Heading goes #, ##, ###, none; List puts lines in and out of a list', () => withEditor(async (ed) => {
  await ed.newNote()
  const ace = await ed.editor()
  ace.setValue('Title', -1)
  await press(ed, ace, 'tb-heading', '# Title')
  await press(ed, ace, 'tb-heading', '## Title')
  await press(ed, ace, 'tb-heading', '### Title')
  await press(ed, ace, 'tb-heading', 'Title')
  ace.setValue('a\nb\n\nc', -1)
  ace.selectAll()
  await press(ed, ace, 'tb-list', '- a\n- b\n\n- c')
  await press(ed, ace, 'tb-list', 'a\nb\n\nc')
  // Pasted from a Windows clipboard into an empty note: Ace keeps \r\n then.
  ace.setValue('', -1)
  ace.onPaste('Title\r\nmore')
  assert.equal(ace.session.doc.getNewLineCharacter(), '\r\n')
  ace.moveCursorTo(0, 2)
  await press(ed, ace, 'tb-heading', '# Title\r\nmore')
  await press(ed, ace, 'tb-heading', '## Title\r\nmore')
  ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 4 } })
  await press(ed, ace, 'tb-bold', '## Title\r\n**more**')
  await press(ed, ace, 'tb-bold', '## Title\r\nmore')
}))

test('$$ puts a line between two $$', () => withEditor(async (ed) => {
  await ed.newNote()
  const ace = await ed.editor()
  ace.setValue('', -1)
  await press(ed, ace, 'tb-display', '$$\n\n$$')
  ace.insert('x')
  assert.equal(ace.getValue(), '$$\nx\n$$', 'the cursor waited between')
  ace.setValue('E = mc^2', -1)
  await press(ed, ace, 'tb-display', '$$\nE = mc^2\n$$')
}))

test('Link opens a dialog: a new link on the word at the cursor; in a link, that one, to change or take away', () => withEditor(async (ed) => {
  await ed.newNote()
  const ace = await ed.editor()
  ace.setValue('see the site now', -1)
  ace.moveCursorTo(0, 10)
  button(ed, 'tb-link').click()
  const dialog = await waitFor(() => ed.$('#link-dialog[open]'), 'the dialog')
  assert.equal(ed.$('#link-title').textContent, 'Insert link')
  assert.equal(ed.$('#link-text').value, 'site', 'the word as its text')
  assert.equal(ed.doc.activeElement, ed.$('#link-href'), 'the address asked for')
  assert.ok(ed.$('#link-apply').disabled, 'nothing to insert without an address')
  assert.ok(ed.$('#link-remove').hidden, 'nothing to take away')
  ed.$('#link-href').value = 'https://x.org'
  ed.$('#link-href').dispatchEvent(new ed.win.Event('input'))
  ed.$('#link-apply').click() // as Enter does
  await waitFor(() => ace.getValue() === 'see the [site](https://x.org) now', 'written')
  assert.ok(!dialog.open, 'and the dialog gone')

  ace.moveCursorTo(0, 11)
  await waitFor(() => button(ed, 'tb-link').getAttribute('aria-pressed') === 'true', 'pressed in the link')
  button(ed, 'tb-link').click()
  await waitFor(() => dialog.open, 'the dialog again')
  assert.equal(ed.$('#link-title').textContent, 'Edit link')
  assert.equal(ed.$('#link-href').value, 'https://x.org')
  ed.$('#link-text').value = 'the site'
  ed.$('#link-apply').click()
  await waitFor(() => ace.getValue() === 'see the [the site](https://x.org) now', 'changed')

  ace.moveCursorTo(0, 11)
  button(ed, 'tb-link').click()
  await waitFor(() => dialog.open && !ed.$('#link-remove').hidden, 'Remove link offered')
  ed.$('#link-remove').click()
  await waitFor(() => ace.getValue() === 'see the the site now', 'taken away, the text left')
}))

test('the arrows: the cursor\'s place to the preview, the preview\'s to the editor', () => withEditor(async (ed) => {
  await ed.newNote()
  const ace = await ed.editor()
  ace.setValue(Array.from({ length: 80 }, (_, i) => `Paragraph ${i}.`).join('\n\n'), -1)
  await waitFor(() => ed.$$('#preview [data-line]').length === 80, 'rendered, with its map')
  const pane = ed.$('#preview-pane')
  const inView = (line) => {
    const box = ed.$(`#preview [data-line="${line}"]`).getBoundingClientRect()
    const view = pane.getBoundingClientRect()
    return box.top >= view.top && box.bottom <= view.bottom
  }
  // The cursor far below the top of the editor: the arrow brings its place in.
  ace.gotoLine(121, 0, false) // paragraph 60
  ace.session.setScrollTop(0)
  await waitFor(() => pane.scrollTop === 0, 'the preview at the top')
  button(ed, 'tb-to-preview').click()
  await sleep(100) // and a follow that was still due does not undo it
  await waitFor(() => inView(120), 'paragraph 60 in view in the preview')
  // The preview scrolled by hand: the other arrow brings the editor there.
  const forty = ed.$('#preview [data-line="80"]')
  pane.scrollTop += forty.getBoundingClientRect().top - pane.getBoundingClientRect().top
  button(ed, 'tb-to-editor').click()
  // Read from the scroll position: Ace redraws on animation frames, which a
  // background tab does not have.
  await waitFor(() => Math.abs(ace.session.getScrollTop() / ace.renderer.lineHeight - 80) <= 1, 'line 80 at the top of the editor')
}))

suite('editor: preview in step')

/** Ctrl+click `el` in the preview, near its top. */
function ctrlClick(ed, el) {
  el.dispatchEvent(new ed.win.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true, clientY: el.getBoundingClientRect().top + 2 }))
}

test('the preview follows the editor as it scrolls', () => withEditor(async (ed) => {
  await ed.newNote()
  const ace = await ed.editor()
  // Paragraph i starts on line 2i.
  ace.setValue(Array.from({ length: 80 }, (_, i) => `Paragraph ${i}.`).join('\n\n'), -1)
  await waitFor(() => ed.$$('#preview [data-line]').length === 80, 'rendered, with its map')
  const pane = ed.$('#preview-pane')
  const at = (line) => ed.$(`#preview [data-line="${line}"]`).getBoundingClientRect().top - pane.getBoundingClientRect().top
  ace.session.setScrollTop(100 * ace.renderer.lineHeight)
  await waitFor(() => Math.abs(at(100)) < 5, 'paragraph 50 at the top of the preview')
  ace.session.setScrollTop(0)
  await waitFor(() => pane.scrollTop === 0, 'and back to the top')
}))

test('Ctrl+click in the preview puts the cursor on that line, opening the editor while reading', () => withEditor(async (ed) => {
  await ed.newNote()
  const ace = await ed.editor()
  ace.setValue('# One\n\nSome text\nover two lines.\n\n## Two\n\nMore.', -1)
  ed.$('#btn-mode').click()
  await waitFor(() => ed.doc.body.dataset.mode === 'view', 'reading')
  const two = await waitFor(() => ed.$('#preview h2'), 'the second heading')
  two.dispatchEvent(new ed.win.MouseEvent('click', { bubbles: true, clientY: two.getBoundingClientRect().top + 2 }))
  await sleep(100)
  assert.equal(ed.doc.body.dataset.mode, 'view', 'a plain click does nothing')
  ctrlClick(ed, two)
  await waitFor(() => ed.doc.body.dataset.mode === 'edit', 'the editor open')
  await waitFor(() => ace.getCursorPosition().row === 5, 'the cursor on "## Two"')
}))

// Paragraphs long enough to wrap, more so in the narrower preview beside the
// editor: paragraph i starts on line 2i.
const WRAPPING = Array.from({ length: 80 }, (_, i) => `Paragraph ${i}, with $x_{${i}}$ and enough words to wrap onto a second line when the preview stands beside the editor.`).join('\n\n')

/** How far below the top of the preview `el` stands. */
const below = (ed, el) => el.getBoundingClientRect().top - ed.$('#preview-pane').getBoundingClientRect().top

/** A paragraph of the preview in the lower half of what it shows. */
function lowerParagraph(ed) {
  const height = ed.$('#preview-pane').clientHeight
  return ed.$$('#preview p').find((p) => below(ed, p) > height / 2 && below(ed, p) + p.offsetHeight < height)
}

/** Whether the editor shows `line`, worked out from its scroll position (Ace draws on animation frames). */
function editorShows(ace, line) {
  const { session, renderer } = ace
  const row = session.documentToScreenRow(line, 0)
  const top = session.getScrollTop() / renderer.lineHeight
  return row >= top && row + 1 <= top + renderer.scroller.clientHeight / renderer.lineHeight
}

test('Ctrl+click leaves the preview where it is, and brings the editor to it', () => withEditor(async (ed) => {
  await ed.newNote()
  const ace = await ed.editor()
  ace.setValue(WRAPPING, -1)
  await waitFor(() => ed.$$('#preview [data-line]').length === 80, 'rendered, with its map')
  const pane = ed.$('#preview-pane')
  ace.session.setScrollTop(60 * ace.renderer.lineHeight)
  await waitFor(() => pane.scrollTop > 0, 'the preview following')
  await sleep(100)
  const p = lowerParagraph(ed)
  const line = Number(p.dataset.line)
  const [scroll, at] = [pane.scrollTop, below(ed, p)]
  ctrlClick(ed, p)
  await waitFor(() => ace.getCursorPosition().row === line, 'the cursor on its line')
  await sleep(200) // a follow would have come by now
  assert.ok(Math.abs(pane.scrollTop - scroll) <= 2, `the preview stayed: ${scroll}, then ${pane.scrollTop}`)
  assert.ok(Math.abs(below(ed, p) - at) <= 2, 'and the paragraph with it')
  assert.ok(editorShows(ace, line), 'the line in view in the editor')
}))

test('Ctrl+click while reading opens the editor, and what was clicked stays where it was', () => withEditor(async (ed) => {
  await ed.newNote()
  const ace = await ed.editor()
  ace.setValue(WRAPPING, -1)
  await waitFor(() => ed.$$('#preview [data-line]').length === 80, 'rendered, with its map')
  ed.$('#btn-mode').click()
  await waitFor(() => ed.doc.body.dataset.mode === 'view', 'reading')
  const pane = ed.$('#preview-pane')
  pane.scrollTop = pane.scrollHeight / 2
  await sleep(100)
  const p = lowerParagraph(ed)
  const line = Number(p.dataset.line)
  const at = below(ed, p)
  ctrlClick(ed, p)
  await waitFor(() => ed.doc.body.dataset.mode === 'edit' && ace.getCursorPosition().row === line, 'the editor open, the cursor on its line')
  await sleep(200)
  // The preview is narrower now and its text longer: the paragraph is back under the pointer.
  assert.ok(Math.abs(below(ed, p) - at) <= 2, `the paragraph stayed: ${Math.round(at)}, then ${Math.round(below(ed, p))}`)
  assert.ok(editorShows(ace, line), 'the line in view in the editor')
}))

test('in a deck, Ctrl+click finds the line within its slide', () => withEditor(async (ed) => {
  await ed.newNote()
  const ace = await ed.editor()
  const md = '---\ntitle: T\n---\n\n# One\n\nA\n\n---\n\n<!-- center -->\n# Two\n\ntext'
  ace.setValue(md, -1)
  const text = await waitFor(() => [...ed.$$('#preview .slide-card p')].find((p) => p.textContent === 'text'), 'the second slide')
  ctrlClick(ed, text)
  await waitFor(() => ace.getCursorPosition().row === md.split('\n').indexOf('text'), 'the cursor on "text"')
  ctrlClick(ed, ed.$$('#preview .slide-card')[2])
  await waitFor(() => ace.getCursorPosition().row === 9, 'a click on the card, not on a block: the slide\'s first line')
}))

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
