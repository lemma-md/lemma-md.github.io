// Draft persistence.
//
// Everything lives in this browser only — there is no server and no account.
// That limit is deliberate for now, but it must be stated in the UI so nobody
// mistakes a draft for something that is backed up.

/**
 * Treat this string as permanent from here on.
 *
 * It is not a label — nothing shows it to anyone — but the key the browser
 * files every note under. Change it and `indexedDB.open` finds nothing, creates
 * an empty database, and the app comes up looking as though it had lost the
 * lot. The old notes are still on disk, merely unreachable, and nothing says so.
 *
 * It was renamed once, from `md-studio`, while the only notes in existence were
 * the author's own test ones and losing them cost nothing. That window is now
 * closed: any later rename needs code that opens the old database and copies
 * its contents across first.
 *
 * Tests only: the page in `_tools/tests` sets `lemmaTestDatabase` before it
 * loads this module, so that it never touches the notes a developer keeps on
 * the same origin. Nothing else sets it.
 */
const DB_NAME = globalThis.lemmaTestDatabase ?? 'lemma-md'

/** The database's name. The editor's lock is named after it (one-editor.js), so
 *  that tests, each on a database of its own, do not wait on each other. */
export const databaseName = DB_NAME
// Bumped 1 -> 2 only to add the `annotations` store: IndexedDB runs
// onupgradeneeded solely when this number rises, so an existing v1 database
// would otherwise never gain the store. There is no data to migrate (nothing
// released), so the bump carries no copy logic — just the create below.
const DB_VERSION = 2
const DOCS = 'docs'
const META = 'meta'
const ANNOT = 'annotations'

let dbPromise = null
let openError = null // why the database would not open, see openFailure
let replaced = null // { flush, stale } from the page, see onReplaced

/**
 * What to do when a newer build of the app, open in another tab, upgrades the
 * database. Its upgrade waits until this page's connection closes, and once
 * closed this page can no longer write. So the page first writes what it still
 * holds (`flush`), the connection then closes, and `stale` tells the page to
 * ask for a reload. Every later call fails with a plain message, not the
 * browser's "the connection is closing".
 */
export function onReplaced(handlers) {
  replaced = handlers
}

function open() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(DOCS)) db.createObjectStore(DOCS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' })
      // Presentation ink, one record per note, keyed by the note id. Kept out of
      // the note itself so the .md stays plain text.
      if (!db.objectStoreNames.contains(ANNOT)) db.createObjectStore(ANNOT, { keyPath: 'id' })
    }
    req.onsuccess = () => {
      const db = req.result
      // Another tab is opening the database at a higher version (see
      // onReplaced). Close this connection so its upgrade is not blocked, but
      // only after the page has written what it holds: the connection still
      // works until close(), and close() lets transactions already started
      // finish.
      db.onversionchange = async () => {
        try { await replaced?.flush?.() } catch (err) { console.error(err) }
        db.close()
        dbPromise = Promise.reject(new Error('This page is out of date: lemma-md was updated in another tab. Reload the page.'))
        dbPromise.catch(() => {}) // only callers should see it, not the console
        replaced?.stale?.()
      }
      resolve(db)
    }
    req.onerror = () => reject(req.error)
  })
  // Kept apart from the stale case, which swaps dbPromise for its own rejection.
  dbPromise.catch((err) => { openError = err })
  return dbPromise
}

/**
 * Why the database cannot be opened at all, or null when it can. A browser set
 * not to let sites store data refuses here, at the open, before any write:
 * Chrome with "Access to the IndexedDB API is denied in this context", Firefox
 * with "The operation is insecure" or with no `indexedDB` at all. A
 * `VersionError` means a newer build has already upgraded the database. Either
 * way nothing will be stored for as long as this page lives.
 */
export async function openFailure() {
  try {
    await open()
    return null
  } catch {
    return openError
  }
}

let mayWrite = () => true

/**
 * For the editor: its writes go through only while `check()` says so, that is
 * while it is the one editor in this browser (one-editor.js). A last line of
 * defence, since a page that is not starts nothing that writes. The projector
 * and the presentations page do not call this, and write as before.
 */
export function writeOnlyWhile(check) {
  mayWrite = check
}

async function run(storeName, mode, fn) {
  if (mode === 'readwrite' && !mayWrite()) throw new Error('These notes are open in another tab, which is the one that stores them.')
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode)
    const req = fn(tx.objectStore(storeName))
    tx.oncomplete = () => resolve(req ? req.result : undefined)
    // A failed request raises `error`, then aborts the transaction. A write that
    // fails only at commit, as a full quota or disk does, raises `abort` alone:
    // listening to `error` only, such a write stayed pending forever and the
    // failure was never shown. The error is the request's: the transaction's
    // own is not set yet when `error` reaches it.
    tx.onerror = (e) => reject(e.target.error ?? tx.error)
    tx.onabort = () => reject(tx.error ?? new DOMException('The browser cancelled the write.', 'AbortError'))
  })
}

export const listDocs = () => run(DOCS, 'readonly', (s) => s.getAll())
export const getDoc = (id) => run(DOCS, 'readonly', (s) => s.get(id)).then((d) => d ?? null)
export const putDoc = (doc) => run(DOCS, 'readwrite', (s) => s.put(doc))
// Deleting a note takes its presentation ink with it — the one place a note is
// hard-removed (a clean close, a Settings delete, a bin purge), so ink never
// outlives its note. The bin path uses putDoc, not this, so binning keeps it.
export const deleteDoc = (id) =>
  Promise.all([run(DOCS, 'readwrite', (s) => s.delete(id)), deleteAnnotations(id)])

// Presentation ink, keyed by note id. A record is
// { id, slides: { [index]: Stroke[] }, updatedAt }. The projector reads and
// writes these directly; the note's own record never carries them.
export const getAnnotations = (id) => run(ANNOT, 'readonly', (s) => s.get(id)).then((r) => r ?? null)
export const listAnnotations = () => run(ANNOT, 'readonly', (s) => s.getAll())
export const putAnnotations = (record) => run(ANNOT, 'readwrite', (s) => s.put(record))
export const deleteAnnotations = (id) => run(ANNOT, 'readwrite', (s) => s.delete(id))

// The bin.
//
// A note discarded from the workspace is not deleted outright: its record stays
// in the docs store, stamped with `binnedAt` (the moment it was binned), and the
// workspace ignores anything so stamped. It can be restored, is emptied on
// demand, and is purged automatically once it has sat past the retention window.

/** Notes currently in the workspace — everything not in the bin. */
export const listActive = () => listDocs().then((docs) => docs.filter((d) => !d.binnedAt))

/** Notes in the bin, newest deletion first. */
export const listBin = () =>
  listDocs().then((docs) => docs.filter((d) => d.binnedAt).sort((a, b) => b.binnedAt - a.binnedAt))

/** How many notes are in the bin and how much they weigh. */
export async function binStatus() {
  const docs = await listBin().catch(() => [])
  const bytes = docs.reduce((sum, d) => sum + new Blob([d.text ?? '']).size, 0)
  return { count: docs.length, bytes }
}

/** Delete every note in the bin. */
export async function emptyBin() {
  for (const d of await listBin()) await deleteDoc(d.id)
}

/** Delete binned notes older than `days`. Returns how many were removed. */
export async function purgeExpiredBin(days) {
  const cutoff = Date.now() - days * 86_400_000
  let removed = 0
  for (const d of await listBin()) {
    if (d.binnedAt < cutoff) { await deleteDoc(d.id); removed++ }
  }
  return removed
}

const RETENTION_KEY = 'binRetentionDays'
export const DEFAULT_RETENTION_DAYS = 15

/** How many days the bin holds a note before purging it. A stored value that is
 *  not a whole number of days ≥ 1 falls back to the default. */
export const getRetentionDays = () =>
  getMeta(RETENTION_KEY).then((v) => (Number.isInteger(v) && v >= 1 ? v : DEFAULT_RETENTION_DAYS))

export const setRetentionDays = (n) => putMeta(RETENTION_KEY, n)

/**
 * Ask the browser to keep this origin's storage rather than evicting it when
 * the disk fills up. Without this, drafts are "best effort" and can be dropped
 * without warning — unacceptable for something whose whole promise is that
 * work is not lost.
 *
 * Firefox shows a permission prompt here; Chrome and Safari never do, deciding
 * from their own engagement heuristics instead. There is no way back: the
 * Storage API has `persist` but no `unpersist`, so this can only be undone by
 * the user through the browser's own site settings.
 *
 * Resolves true if storage is persistent, false if the browser refused, null
 * if it does not support the API.
 */
export async function persistStorage() {
  if (!navigator.storage?.persist) return null
  try {
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return null
  }
}

let persistenceAsked = false

/**
 * The automatic path, fired from the first keystroke — never on load, because
 * a permission prompt on the first screen is exactly the obstacle this app
 * exists to avoid. Runs at most once per page load so a user who declines is
 * not nagged; an explicit request from Settings goes through persistStorage
 * directly.
 */
export async function requestPersistenceOnce() {
  if (persistenceAsked) return null
  persistenceAsked = true
  return persistStorage()
}

/**
 * What the user actually wants to know: how many notes there are and how much
 * they weigh.
 *
 * The size is summed from the note text rather than taken from
 * `navigator.storage.estimate()`. That call measures the browser's whole
 * storage bucket for this origin — block allocation, metadata and space not
 * yet reclaimed after deletions — which ran about 49x the size of the actual
 * text in testing, and in Firefox can report hundreds of megabytes that have
 * nothing to do with these notes. Reporting it as "your notes" would be a lie.
 *
 * The quota is only consulted to notice that the browser is genuinely running
 * out of room; the raw figure is not shown, because "476 GB allowed" tells a
 * mathematician nothing useful.
 */
export async function storageStatus() {
  // The workspace only — notes in the bin are reported separately.
  const docs = await listActive().catch(() => [])
  const bytes = docs.reduce((sum, doc) => sum + new Blob([doc.text ?? '']).size, 0)

  let persisted = false
  let nearlyFull = false
  try {
    persisted = (await navigator.storage?.persisted?.()) ?? false
    const est = await navigator.storage?.estimate?.()
    if (est?.quota) nearlyFull = est.usage / est.quota > 0.8
  } catch {
    // Storage API unavailable; the note count and size above still stand.
  }

  return { count: docs.length, bytes, persisted, nearlyFull }
}

/** Small key/value cells in the meta store, for things that are not notes. */
export const getMeta = (key) =>
  run(META, 'readonly', (s) => s.get(key)).then((row) => (row ? row.value : null))

export const putMeta = (key, value) =>
  run(META, 'readwrite', (s) => s.put({ key, value }))

/** Every cell whose key starts with `prefix`, as `{ key, value }`. */
export const listMeta = (prefix) =>
  run(META, 'readonly', (s) => s.getAll(IDBKeyRange.bound(prefix, `${prefix}￿`)))

export const getSession = () => getMeta('session')
export const putSession = (value) => putMeta('session', value)
