// An in-memory Google Drive, put in place of the real provider's methods
// (src/storage/gdrive.js) inside a test frame. It speaks the provider
// interface described in src/storage/index.js, so the app cannot tell, and a
// test can change, rename, move or trash a file "from outside", as another
// device or a person in Drive would.
//
// It tests the app's logic around Drive, not gdrive.js's requests to Google.

export const APP_FOLDER = { id: 'folder-app', name: 'lemma-md' }

export function installFakeDrive(provider) {
  const files = new Map()
  let ids = 0
  let revisions = 0

  const bytes = (text) => new Blob([text]).size
  const touch = (f) => {
    f.headRevisionId = `rev-${++revisions}`
    f.modifiedTime = new Date().toISOString()
  }
  const meta = (f) => ({
    id: f.id,
    name: f.name,
    parents: [...f.parents],
    trashed: f.trashed,
    headRevisionId: f.headRevisionId,
    modifiedTime: f.modifiedTime,
    size: String(bytes(f.text)),
    md5Checksum: `md5-of-${f.headRevisionId}`,
  })
  const get = (id) => {
    const f = files.get(id)
    if (!f) throw new Error(`404: File not found: ${id}`)
    return f
  }
  function add({ id = `file-${++ids}`, name, text = '', parents = [APP_FOLDER.id], folder = false }) {
    const f = { id, name, text, parents, folder, trashed: false }
    touch(f)
    files.set(id, f)
    return id
  }

  add({ ...APP_FOLDER, parents: ['root'], folder: true })

  const drive = {
    files,
    add,
    /** What the next file chooser returns: [{ id, name }]. */
    picks: [],
    /** The folder the next folder chooser returns. */
    folderPick: null,
    /** Every write, in order: { id, name, text }. */
    writes: [],
    /** How long Drive takes to answer, in ms: a slow network, to race against. */
    /** `list` is a function of the folder listed. */
    delay: { stat: 0, read: 0, list: () => 0 },
    /** Changes made elsewhere, as if in Drive itself. */
    outside: {
      edit(id, text) { const f = get(id); f.text = text; touch(f) },
      rename(id, name) { get(id).name = name },
      move(id, parent) { get(id).parents = [parent] },
      trash(id) { get(id).trashed = true },
    },
  }

  const pause = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : null)

  Object.assign(provider, {
    isConnected: () => true,
    async connect() {},
    disconnect() {},
    async pick() { return drive.picks.splice(0) },
    async pickFolder() { return drive.folderPick },
    async read(id) {
      await pause(drive.delay.read)
      const f = get(id)
      return { ...meta(f), text: f.text }
    },
    async revision(id) { return meta(get(id)) },
    async write({ id, name, text, parents }) {
      drive.writes.push({ id: id ?? null, name, text })
      if (!id) return meta(get(add({ name, text, parents: parents?.length ? parents : ['root'] })))
      const f = get(id)
      f.text = text
      if (name) f.name = name
      touch(f)
      return meta(f)
    },
    async createFolder(name, parents) {
      const id = add({ name, parents: parents?.length ? parents : ['root'], folder: true })
      return { id, name }
    },
    async list({ parent, foldersOnly } = {}) {
      await pause(drive.delay.list(parent))
      return [...files.values()]
        .filter((f) => !f.trashed && (!parent || f.parents.includes(parent)) && (!foldersOnly || f.folder))
        .map((f) => ({
          id: f.id,
          name: f.name,
          mimeType: f.folder ? 'application/vnd.google-apps.folder' : 'text/markdown',
          parents: [...f.parents],
          modifiedTime: f.modifiedTime,
        }))
    },
    async stat(id) {
      await pause(drive.delay.stat)
      const f = get(id)
      return { id: f.id, name: f.name }
    },
    async untrash(id) { get(id).trashed = false },
  })

  window.fakeDrive = drive
  return drive
}
