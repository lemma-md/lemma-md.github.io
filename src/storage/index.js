/**
 * Permanent storage providers.
 *
 * IndexedDB (src/drafts.js) is the scratch area — it holds whatever is being
 * worked on. A provider here is the real destination: somewhere a note keeps
 * existing when the browser profile does not.
 *
 * The editor and viewer never talk to a provider directly. They only ever see
 * a note plus an optional `remote` link, so adding Dropbox or GitHub later
 * means writing an adapter, not touching the rest of the app.
 *
 * A provider implements:
 *
 *   id            string, stable, stored inside notes
 *   label         name shown to a human
 *   isConfigured  are credentials present at all
 *   isConnected   is there a usable session right now
 *   connect       obtain permission; may open a provider window
 *   disconnect    forget the session
 *   pick          (parent?) show the provider's file chooser, opened inside the
 *                 parent folder when given; resolve to [{id, name}]
 *   pickFolder    show a folder chooser, resolve to {id, name} or null
 *   read          (id) -> {id, name, text, ...revision}
 *   write         ({id?, name, text, parents?}) -> {id, name, ...revision};
 *                 creates when id is absent, then drops the file into parents
 *   createFolder  (name, parents?) -> {id, name}
 *   list          ({parent?, foldersOnly?}) -> [{id, name, mimeType, parents}]
 *   stat          (id) -> {id, name}
 *   revision      (id) -> {name, parents, trashed, headRevisionId, ...}
 *   untrash       (id) -> restore a file from the provider's trash
 *
 * The revision fields (headRevisionId etc.) let a caller notice that a file
 * changed underneath it before overwriting; providers without them may omit.
 *
 * `write` deliberately takes an optional id: creating a file and saving over
 * an existing one are the same intent, and the caller should not have to
 * decide which endpoint that becomes.
 */

const providers = new Map()

export function register(provider) {
  providers.set(provider.id, provider)
}

export function getProvider(id) {
  return providers.get(id)
}

/** Providers whose credentials are filled in; the rest stay out of the UI. */
export function availableProviders() {
  return [...providers.values()].filter((p) => p.isConfigured())
}

/**
 * A note's link to a file in permanent storage.
 * @typedef {{ provider: string, id: string, savedAt: number }} RemoteLink
 */

/** Resolve the provider a note is linked to, if it is still available. */
export function providerFor(doc) {
  return doc?.remote ? providers.get(doc.remote.provider) : undefined
}
