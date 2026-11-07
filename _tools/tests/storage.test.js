// Browser storage (src/drafts.js): the notes, the bin, small settings, and every
// way a write or the database itself can fail. docs/ARCHITECTURE.md → Storage
// says what the app does about each failure; these tests hold drafts.js to its
// part of that.
//
// Each test gets a database of its own (`lemma-md-test-…`, never the real one)
// and a fresh copy of the module, since the module keeps its connection. The
// upgrade cases run for real. A full disk and blocked storage cannot be made
// from a page, so they are imitated with the events a browser sends then: a
// write that aborts at commit, an open that fails.

import { suite, test, assert } from './runner.js'

const PREFIX = 'lemma-md-test-'
const RUN = Date.now()
let made = 0

/** A fresh drafts.js on a database of its own. The query makes a new module
 *  instance; that it differs on every run keeps the browser from serving one
 *  cached before an edit. */
async function freshDrafts() {
  const name = `${PREFIX}${RUN}-${++made}`
  globalThis.lemmaTestDatabase = name
  const drafts = await import(`../../src/drafts.js?run=${RUN}&instance=${made}`)
  return { drafts, name }
}

/** Delete a database. Open connections get `versionchange`, which drafts.js
 *  answers by closing, so this does not wait on them. */
const dropDatabase = (name) => new Promise((resolve) => {
  const req = indexedDB.deleteDatabase(name)
  req.onsuccess = req.onerror = req.onblocked = () => resolve()
})

/** Run `body` with a fresh drafts.js, and delete its database afterwards. */
async function withDrafts(body) {
  const { drafts, name } = await freshDrafts()
  try {
    await body(drafts, name)
  } finally {
    await dropDatabase(name)
  }
}

/** Replace `obj[key]` for the length of `body`, then put it back. */
async function patched(obj, key, value, body) {
  const original = Object.getOwnPropertyDescriptor(obj, key)
  Object.defineProperty(obj, key, { value, configurable: true, writable: true })
  try {
    return await body()
  } finally {
    if (original) Object.defineProperty(obj, key, original)
    else delete obj[key]
  }
}

/** The error a promise rejects with; fails if it resolves, or does not settle
 *  within `ms`. A write nobody answers is the bug this guards against. */
async function rejection(promise, ms = 3000) {
  let timer
  const outcome = await Promise.race([
    promise.then(() => ({ resolved: true }), (error) => ({ error })),
    new Promise((resolve) => { timer = setTimeout(() => resolve({ hung: true }), ms) }),
  ])
  clearTimeout(timer)
  assert.ok(!outcome.hung, `settled within ${ms} ms`)
  assert.ok(!outcome.resolved, 'rejected')
  return outcome.error
}

/** Open a database straight, as another tab or a newer build would. */
const openRaw = (name, version, onupgradeneeded) => new Promise((resolve, reject) => {
  const req = version ? indexedDB.open(name, version) : indexedDB.open(name)
  if (onupgradeneeded) req.onupgradeneeded = () => onupgradeneeded(req)
  req.onsuccess = () => resolve(req.result)
  req.onerror = () => reject(req.error)
})

const note = (id, extra = {}) => ({ id, name: `${id}.md`, text: `text of ${id}`, ...extra })

// Databases left by a run that was interrupted.
for (const { name } of (await indexedDB.databases?.()) ?? []) {
  if (name?.startsWith(PREFIX)) await dropDatabase(name)
}

suite('storage')

test('a note is stored and read back', () => withDrafts(async (drafts) => {
  await drafts.putDoc(note('a'))
  assert.deepEqual(await drafts.getDoc('a'), note('a'))
  assert.equal(await drafts.getDoc('missing'), null)
}))

test('the workspace and the bin are told apart by binnedAt', () => withDrafts(async (drafts) => {
  await drafts.putDoc(note('open'))
  await drafts.putDoc(note('older', { binnedAt: 1000 }))
  await drafts.putDoc(note('newer', { binnedAt: 2000 }))
  assert.deepEqual((await drafts.listActive()).map((d) => d.id), ['open'])
  assert.deepEqual((await drafts.listBin()).map((d) => d.id), ['newer', 'older'], 'newest first')
}))

test('the bin purges only what has outstayed its days', () => withDrafts(async (drafts) => {
  const day = 86_400_000
  await drafts.putDoc(note('old', { binnedAt: Date.now() - 20 * day }))
  await drafts.putDoc(note('recent', { binnedAt: Date.now() - 2 * day }))
  assert.equal(await drafts.purgeExpiredBin(15), 1, 'removed')
  assert.deepEqual((await drafts.listBin()).map((d) => d.id), ['recent'])
}))

test('emptying the bin leaves the workspace', () => withDrafts(async (drafts) => {
  await drafts.putDoc(note('open'))
  await drafts.putDoc(note('binned', { binnedAt: Date.now() }))
  await drafts.emptyBin()
  assert.deepEqual((await drafts.listDocs()).map((d) => d.id), ['open'])
}))

test('deleting a note takes its ink with it', () => withDrafts(async (drafts) => {
  await drafts.putDoc(note('a'))
  await drafts.putAnnotations({ id: 'a', slides: { 0: [] }, updatedAt: 1 })
  await drafts.deleteDoc('a')
  assert.equal(await drafts.getDoc('a'), null)
  assert.equal(await drafts.getAnnotations('a'), null)
}))

test('the bin keeps 15 days unless told otherwise, and only whole days', () => withDrafts(async (drafts) => {
  assert.equal(await drafts.getRetentionDays(), 15)
  await drafts.setRetentionDays(7)
  assert.equal(await drafts.getRetentionDays(), 7)
  await drafts.setRetentionDays(0.5)
  assert.equal(await drafts.getRetentionDays(), 15, 'a fraction falls back')
}))

test('the bin reports how many notes it holds and their size', () => withDrafts(async (drafts) => {
  await drafts.putDoc({ id: 'b', name: 'b.md', text: 'ёж', binnedAt: 1 })
  assert.deepEqual(await drafts.binStatus(), { count: 1, bytes: 4 }, 'UTF-8 bytes')
}))

test('a database that opens reports no failure', () => withDrafts(async (drafts) => {
  assert.equal(await drafts.openFailure(), null)
}))

suite('storage failures')

test('a write refused at commit rejects instead of hanging', () => withDrafts(async (drafts) => {
  await drafts.putDoc(note('warm-up')) // the connection is open before the patch
  const put = IDBObjectStore.prototype.put
  // What a full quota or disk does: the request succeeds, then the transaction
  // aborts, with no `error` event at all.
  await patched(IDBObjectStore.prototype, 'put', function (...args) {
    const req = put.apply(this, args)
    const tx = this.transaction
    req.addEventListener('success', () => tx.abort())
    return req
  }, async () => {
    const error = await rejection(drafts.putDoc(note('a')))
    assert.equal(error.name, 'AbortError')
  })
  assert.equal(await drafts.getDoc('a'), null, 'nothing was stored')
}))

test('a quota error reaches the caller under its own name', () => withDrafts(async (drafts) => {
  await patched(IDBObjectStore.prototype, 'put', function () {
    throw new DOMException('Simulated: the quota has been exceeded.', 'QuotaExceededError')
  }, async () => {
    const error = await rejection(drafts.putDoc(note('a')))
    assert.equal(error.name, 'QuotaExceededError')
  })
}))

test('a failed request rejects with its own error, not null', () => withDrafts(async (drafts) => {
  // A request that fails after it was made, so the failure arrives as an
  // `error` event, when the transaction's own error is not set yet: `add` over
  // a record that exists.
  await drafts.putDoc(note('a'))
  await patched(IDBObjectStore.prototype, 'put', IDBObjectStore.prototype.add, async () => {
    const error = await rejection(drafts.putDoc(note('a')))
    assert.equal(error?.name, 'ConstraintError')
  })
}))

test('blocked storage: the open fails and says why', async () => {
  // Chrome when the site may not store data: the open request fires `error`.
  const blocked = new DOMException('Access to the IndexedDB API is denied in this context.', 'UnknownError')
  await patched(IDBFactory.prototype, 'open', function () {
    const req = { error: blocked }
    setTimeout(() => req.onerror?.())
    return req
  }, async () => {
    const { drafts } = await freshDrafts()
    assert.equal(await drafts.openFailure(), blocked)
    assert.equal(await rejection(drafts.putDoc(note('a'))), blocked, 'every write fails the same way')
    assert.equal((await drafts.storageStatus()).count, 0, 'Settings still gets an answer')
    assert.deepEqual(await drafts.binStatus(), { count: 0, bytes: 0 })
  })
})

test('blocked storage in Firefox: the open throws', async () => {
  const insecure = new DOMException('The operation is insecure.', 'SecurityError')
  await patched(IDBFactory.prototype, 'open', function () { throw insecure }, async () => {
    const { drafts } = await freshDrafts()
    assert.equal(await drafts.openFailure(), insecure)
  })
})

test('blocked storage in Firefox: no indexedDB at all', async () => {
  await patched(globalThis, 'indexedDB', null, async () => {
    const { drafts } = await freshDrafts()
    assert.equal((await drafts.openFailure())?.name, 'TypeError')
  })
})

test('a database a newer build has upgraded: VersionError', async () => {
  const { drafts, name } = await freshDrafts()
  try {
    ;(await openRaw(name, 3, (req) => req.result.createObjectStore('docs', { keyPath: 'id' }))).close()
    assert.equal((await drafts.openFailure())?.name, 'VersionError')
  } finally {
    await dropDatabase(name)
  }
})

test('an upgrade from another tab: store what the page holds, then step aside', () => withDrafts(async (drafts, name) => {
  const calls = []
  drafts.onReplaced({
    flush: async () => { calls.push('flush'); await drafts.putDoc(note('held')) },
    stale: () => calls.push('stale'),
  })
  await drafts.putDoc(note('before'))

  // A newer build opens the database at a higher version. Its upgrade waits
  // until this page lets go; aborting it then leaves the database at 2.
  await openRaw(name, 3, (req) => req.transaction.abort()).catch(() => {})

  assert.deepEqual(calls, ['flush', 'stale'], 'flushed first, then told to reload')
  const error = await rejection(drafts.putDoc(note('after')))
  assert.ok(/out of date/.test(error.message), `a plain message, got "${error.message}"`)
  assert.equal(await drafts.openFailure(), null, 'a stale page is not blocked storage')

  const db = await openRaw(name)
  try {
    assert.equal(db.version, 2)
    const ids = await new Promise((resolve) => {
      const req = db.transaction('docs').objectStore('docs').getAllKeys()
      req.onsuccess = () => resolve(req.result)
    })
    assert.deepEqual(ids, ['before', 'held'], 'the flush reached the database')
  } finally {
    db.close()
  }
}))
