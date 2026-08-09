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

export async function getSession() {
  const row = await run(META, 'readonly', (s) => s.get('session'))
  return row ? row.value : null
}

export const putSession = (value) =>
  run(META, 'readwrite', (s) => s.put({ key: 'session', value }))
