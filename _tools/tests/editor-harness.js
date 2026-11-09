// The editor, loaded into a hidden frame on a database of its own, for tests to
// drive through its DOM much as a person would. A frame rather than the page
// itself, because the app runs as soon as it loads and keeps state in its
// module: each test gets a fresh one.
//
// The page is the real editor/index.html, given as srcdoc so that a script can
// run before the app does. That script sets the test database, and takes over
// what would otherwise stop the page or leave it: confirm() and alert(), which
// are recorded and answered; downloads, which are recorded and not saved; and
// window.open. It also lets a test refuse every write, the way a full disk does.

const PREFIX = 'lemma-md-test-editor-'
const RUN = Date.now()
let made = 0

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Wait until `check` returns something truthy (it may be async). */
export async function waitFor(check, what, ms = 3000) {
  const end = Date.now() + ms
  let error = null
  while (Date.now() < end) {
    try {
      const value = await check()
      if (value) return value
    } catch (err) {
      error = err
    }
    await sleep(25)
  }
  throw new Error(`timed out after ${ms} ms waiting for ${what}${error ? ` (${error.message})` : ''}`)
}

const dropDatabase = (name) => new Promise((resolve) => {
  const req = indexedDB.deleteDatabase(name)
  req.onsuccess = req.onerror = req.onblocked = () => resolve()
})

/** Open the test database the way drafts.js would create it. */
function openDatabase(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 2)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const [store, keyPath] of [['docs', 'id'], ['meta', 'key'], ['annotations', 'id']]) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function readAll(name, store) {
  const db = await openDatabase(name)
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(store).objectStore(store).getAll()
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}


// Runs in the frame before the app. Kept as a function so that it is real code
// here, then sent over as text.
function frameSetup(database) {
  globalThis.lemmaTestDatabase = database

  // An automated tab is usually hidden, and the app re-checks files and Drive
  // only while visible. Leaving is tested with `pagehide` instead.
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })

  window.asked = []
  window.answer = true
  window.confirm = (message) => { window.asked.push(message); return window.answer }
  window.alerts = []
  window.alert = (message) => { window.alerts.push(message) }
  window.opened = []
  window.open = (url, target) => { window.opened.push({ url: String(url), target }); return null }

  window.downloads = []
  const click = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) { window.downloads.push(this.download); return }
    return click.call(this)
  }

  window.refuseWrites = false
  const put = IDBObjectStore.prototype.put
  IDBObjectStore.prototype.put = function (...args) {
    const req = put.apply(this, args)
    if (window.refuseWrites) {
      const tx = this.transaction
      req.addEventListener('success', () => tx.abort())
    }
    return req
  }
}

/** Put records into the test database before a page opens it:
 *  { docs: [...], annotations: [...], meta: { key: value } }. */
async function seed(name, { docs = [], annotations = [], meta = {} } = {}) {
  const db = await openDatabase(name)
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['docs', 'annotations', 'meta'], 'readwrite')
      for (const d of docs) tx.objectStore('docs').put(d)
      for (const a of annotations) tx.objectStore('annotations').put(a)
      for (const [key, value] of Object.entries(meta)) tx.objectStore('meta').put({ key, value })
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

/**
 * Load the app's page in `dir` into a hidden frame, on `database`. With a
 * `query` (the projector's `id=…`), through frame.html, since a srcdoc page
 * has no query of its own.
 */
async function loadFrame(dir, database, { before = '', extraHead = '', query = '' } = {}) {
  const head = [
    `<base href="${location.origin}/${dir}/">`,
    `<script>(${frameSetup})(${JSON.stringify(database)});\n${before}</script>`,
    extraHead,
  ].join('\n')

  const frame = document.createElement('iframe')
  frame.style.cssText = 'width:1000px;height:700px;border:0'
  document.getElementById('scratch').append(frame)
  const loaded = new Promise((resolve) => { frame.onload = resolve })
  if (query) {
    frame.src = `frame.html?${query}`
    await loaded
    await frame.contentWindow.loadApp(dir, head)
    return frame
  }
  const page = await (await fetch(`../../${dir}/index.html`, { cache: 'no-store' })).text()
  frame.srcdoc = page.replace('<head>', `<head>\n${head}`)
  await loaded
  return frame
}

/**
 * Load the editor. `meta` is written to its database first (settings the app
 * reads on start); `before` is more code to run before the app, as text;
 * `fakeDrive` swaps the Google Drive provider for the one in fake-drive.js.
 * With `database`, a second editor on the notes of an open one, as another tab
 * would be: it starts nothing but its "open in another tab", and leaves the
 * database in place on closing.
 */
export async function openEditor({ meta = null, before = '', fakeDrive = false, database = null } = {}) {
  const own = !database
  database ??= `${PREFIX}${RUN}-${++made}`
  if (meta) await seed(database, { meta })

  const frame = await loadFrame('editor', database, {
    before,
    // Module scripts run in order, so this one patches the provider before
    // app.js starts using it; both import the same module instance.
    extraHead: fakeDrive
      ? `<script type="module">
          import { googleDrive } from '../src/storage/gdrive.js'
          import { installFakeDrive } from '../_tools/tests/fake-drive.js'
          installFakeDrive(googleDrive)
        </script>`
      : '',
  })

  const editor = driver(frame, database, own)
  await waitFor(() => editor.tabs().length || editor.isOpen('elsewhere'), 'the app to start')
  return editor
}

/**
 * Load another page of the app (`presentations`, say) on a database of its
 * own, holding `records` (see seed). Resolves once the page's scripts have run;
 * waiting for what they draw is the test's to do. With `database`, it shares
 * that one instead (an open editor's, say) and leaves it in place on closing;
 * `before` is code to run before the page's own, as for openEditor; `query` is
 * the page's query string, such as the projector's `id=…`.
 */
export async function openPage(dir, records = {}, { database = null, before = '', query = '' } = {}) {
  const own = !database
  database ??= `${PREFIX}${RUN}-${++made}`
  await seed(database, records)
  const frame = await loadFrame(dir, database, { before, query })
  return {
    database,
    get win() { return frame.contentWindow },
    get doc() { return frame.contentDocument },
    $: (selector) => frame.contentDocument.querySelector(selector),
    $$: (selector) => [...frame.contentDocument.querySelectorAll(selector)],
    async close() {
      frame.remove()
      if (own) await dropDatabase(database)
    },
  }
}

/** Everything in one store of a test database, read straight. */
export const storedIn = (database, store) => readAll(database, store)

/** What a test can do with an open editor. */
function driver(frame, database, own = true) {
  const e = {
    database,
    get win() { return frame.contentWindow },
    get doc() { return frame.contentDocument },
    $: (selector) => e.doc.querySelector(selector),
    $$: (selector) => [...e.doc.querySelectorAll(selector)],
    waitFor,

    tabs: () => e.$$('#tabs .tab .name').map((n) => n.textContent),
    activeTab: () => e.$('#tabs .tab.active .name')?.textContent ?? null,
    activeDot: () => e.$('#tabs .tab.active .dot:not(.remote)')?.title ?? null,

    /** The toolbar status: { text, cls, title }, text '' when none is shown. */
    status() {
      const s = e.$('#cloud-state')
      return { text: s.hidden ? '' : s.textContent, cls: s.className, title: s.title }
    },

    /** The notice under the bar, or null. */
    banner() {
      if (e.$('#banner').hidden) return null
      const link = e.$('#banner-link')
      return {
        text: e.$('#banner-text').textContent,
        action: e.$('#banner-action').hidden ? null : e.$('#banner-action').textContent,
        closable: !e.$('#banner-close').hidden,
        link: link.hidden ? null : { href: link.href, target: link.target },
      }
    },

    /** The notice about the note (under the toolbar, or atop the preview), or null. */
    notice() {
      if (e.$('#note-notice').hidden) return null
      return {
        text: e.$('#note-notice-text').textContent,
        action: e.$('#note-notice-action').hidden ? null : e.$('#note-notice-action').textContent,
        place: e.$('#note-notice').parentElement.id,
      }
    },

    /** Ace, switching to writing mode first if needed. */
    async editor() {
      if (e.doc.body.dataset.mode !== 'edit') e.$('#btn-mode').click()
      await waitFor(() => e.win.ace && e.$('.ace_editor'), 'the editor to load', 5000)
      return e.win.ace.edit(e.$('.ace_editor'))
    },

    /** Type at the end of the active note. */
    async type(text) {
      const ed = await e.editor()
      const last = ed.session.getLength() - 1
      ed.session.insert({ row: last, column: ed.session.getLine(last).length }, text)
    },

    async newNote() {
      const before = e.tabs().length
      e.$('#btn-new').click()
      await waitFor(() => e.tabs().length === before + 1, 'a new tab')
    },

    /** Click the × of the active tab. */
    closeActive() {
      e.$('#tabs .tab.active .close').click()
    },

    isOpen: (id) => Boolean(e.$(`#${id}`)?.open),

    /** Click the button labelled `label` in the open dialog `id`. */
    async choose(id, label) {
      await waitFor(() => e.isOpen(id), `the dialog #${id}`)
      const button = [...e.$(`#${id}`).querySelectorAll('button')].find((b) => b.textContent.trim() === label)
      if (!button) throw new Error(`no "${label}" in #${id}`)
      button.click()
    },

    /**
     * Come back to the page until `check` holds. The app re-checks files and
     * Drive on focus, but not more than once in three seconds, and the frame
     * may already have had a real focus event moments ago; so, like a person
     * coming back later, this keeps coming back for a while.
     */
    comeBack(check, what) {
      // Three seconds of throttle, then the check itself, in a tab whose
      // timers may run once a second: 5 s left too little and failed now and
      // then. 8 s still fits in a test's 10.
      return waitFor(() => {
        e.win.dispatchEvent(new e.win.Event('focus'))
        return check()
      }, what, 8000)
    },

    /** Would leaving the page ask first? */
    leaveAsks() {
      const event = new e.win.Event('beforeunload', { cancelable: true })
      e.win.dispatchEvent(event)
      return event.defaultPrevented
    },

    /** What the app has stored, read straight from its database. */
    storedDocs: () => readAll(database, 'docs'),
    async stored(name) {
      return (await e.storedDocs()).find((d) => d.name === name && !d.binnedAt) ?? null
    },

    /** Reload the frame: the same database, a fresh app. */
    async reload() {
      const loaded = new Promise((resolve) => { frame.onload = resolve })
      e.win.location.reload()
      await loaded
      await waitFor(() => e.tabs().length, 'the app to start again')
    },

    async close() {
      frame.remove()
      if (own) await dropDatabase(database)
    },
  }
  return e
}

/** Run `body` with a fresh editor, and clean up after it. */
export async function withEditor(options, body) {
  if (typeof options === 'function') [options, body] = [{}, options]
  const editor = await openEditor(options)
  try {
    await body(editor)
  } finally {
    await editor.close()
  }
}
