// Local files, through the File System Access API.
//
// Unlike the cloud provider this is handle-based, not id-based: opening or
// saving yields a `FileSystemFileHandle` that writes back to the very same file
// on disk. The handle is structured-cloneable, so it is kept in the note (and
// so in IndexedDB) to reach the same file again after a reload — subject to the
// browser re-granting permission, which needs a user gesture.
//
// The API is Chromium-desktop only (Chrome, Edge, Opera); Firefox, Safari and
// every mobile browser lack it. `isSupported`/`isSaveSupported` feature-detect,
// and the app falls back to download + drag-and-drop where they are false.
//
// There is no path: the API exposes only the file's name, never its location.

const CAN_OPEN = typeof window.showOpenFilePicker === 'function'
const CAN_SAVE = typeof window.showSaveFilePicker === 'function'

// Save writes Markdown, so the save picker offers only that. Open also accepts
// the .html we export, so a note round-trips back in through the same picker.
const TYPES = [
  { description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown'], 'text/plain': ['.txt'] } },
]
const OPEN_TYPES = [
  ...TYPES,
  { description: 'Exported page', accept: { 'text/html': ['.html', '.htm'] } },
]

const stat = async (handle) => {
  const file = await handle.getFile()
  return { name: file.name, text: await file.text(), lastModified: file.lastModified, size: file.size, file }
}

export const localFiles = {
  id: 'local',
  label: 'This computer',

  /** Can a file be opened with a writable handle at all. */
  isSupported: () => CAN_OPEN,
  /** Can a brand-new file be saved to a location the user picks. */
  isSaveSupported: () => CAN_SAVE,

  /** Open one or more files, each with its handle. Resolves to [] on cancel. */
  async open() {
    let handles
    try {
      handles = await window.showOpenFilePicker({ multiple: true, types: OPEN_TYPES, excludeAcceptAllOption: false })
    } catch (err) {
      if (err?.name === 'AbortError') return []
      throw err
    }
    const out = []
    for (const handle of handles) {
      const s = await stat(handle)
      out.push({ handle, name: s.name, text: s.text, lastModified: s.lastModified, size: s.size })
    }
    return out
  },

  /** Re-read a file from its handle. */
  async read(handle) {
    const s = await stat(handle)
    return { handle, name: s.name, text: s.text, lastModified: s.lastModified, size: s.size }
  },

  /** The change marker: a file edited on disk gets a new lastModified/size. */
  async revision(handle) {
    const file = await handle.getFile()
    return { lastModified: file.lastModified, size: file.size }
  },

  /**
   * Write to an existing handle, or — when none is given — ask the user where to
   * put a new file and write there. Returns the handle and the fresh
   * lastModified/size, which become the note's new baseline.
   */
  async write({ handle, name, text }) {
    if (!handle) {
      handle = await window.showSaveFilePicker({ suggestedName: name || 'untitled.md', types: TYPES })
    }
    const writable = await handle.createWritable()
    await writable.write(text)
    await writable.close()
    const file = await handle.getFile()
    return { handle, name: file.name, lastModified: file.lastModified, size: file.size }
  },

  /**
   * Make sure we may read/write the handle, re-requesting after a reload. The
   * request must run from a user gesture, or the browser refuses silently.
   */
  async ensurePermission(handle, mode = 'readwrite') {
    if (!handle?.queryPermission) return true // older builds granted at pick time
    const opts = { mode }
    if ((await handle.queryPermission(opts)) === 'granted') return true
    return (await handle.requestPermission(opts)) === 'granted'
  },
}
