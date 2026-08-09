// Draft persistence.
//
// Everything lives in this browser only — there is no server and no account.
// That limit is deliberate for now, but it must be stated in the UI so nobody
// mistakes a draft for something that is backed up.

const DB_NAME = 'md-studio'
const DB_VERSION = 1
const DOCS = 'docs'
const META = 'meta'

let dbPromise = null

function open() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(DOCS)) db.createObjectStore(DOCS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function run(storeName, mode, fn) {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode)
    const req = fn(tx.objectStore(storeName))
    tx.onerror = () => reject(tx.error)
    tx.oncomplete = () => resolve(req ? req.result : undefined)
  })
}

export const listDocs = () => run(DOCS, 'readonly', (s) => s.getAll())
export const putDoc = (doc) => run(DOCS, 'readwrite', (s) => s.put(doc))
export const deleteDoc = (id) => run(DOCS, 'readwrite', (s) => s.delete(id))

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
  const docs = await listDocs().catch(() => [])
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

export async function getSession() {
  const row = await run(META, 'readonly', (s) => s.get('session'))
  return row ? row.value : null
}

export const putSession = (value) =>
  run(META, 'readwrite', (s) => s.put({ key: 'session', value }))
