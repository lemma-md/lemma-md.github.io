import { loadScript } from '../load-script.js'
import { GOOGLE } from '../config.js'

const GIS = 'https://accounts.google.com/gsi/client'
const GAPI = 'https://apis.google.com/js/api.js'

// `drive.file` reaches only the files the user themselves opens or creates
// through this app — never the rest of their Drive. It is a non-sensitive
// scope, which is why the consent screen stays plain and Google does not
// require the app to pass review. Widening this would change both.
const SCOPE = 'https://www.googleapis.com/auth/drive.file'

const FILES = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'
const MIME = 'text/markdown'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

// The identity fields kept for conflict detection: headRevisionId is the change
// marker, name/parents/trashed catch a file renamed, moved, or trashed in Drive,
// and the rest describe the version a note was last in step with.
const REV_FIELDS = 'id,name,parents,trashed,headRevisionId,modifiedTime,size,md5Checksum'

/**
 * The access token is kept in memory only.
 *
 * Browser OAuth issues no refresh token, so it expires after about an hour and
 * is re-requested — usually without a prompt, since the Google session is
 * still there. Keeping it out of storage also keeps it away from other pages
 * on this origin, which on GitHub Pages includes every other project published
 * under the same account.
 */
let token = null
let expiresAt = 0
let tokenClient = null

const isConfigured = () => Boolean(GOOGLE.clientId && GOOGLE.apiKey && GOOGLE.appId)
const isConnected = () => Boolean(token) && Date.now() < expiresAt

async function loadGoogleScripts() {
  // Google's libraries are versioned on their servers and cannot be vendored,
  // so they are fetched only once someone actually connects. Anyone who never
  // touches the cloud never loads third-party code.
  await Promise.all([loadScript(GIS), loadScript(GAPI)])
}

function requestToken({ silent }) {
  return new Promise((resolve, reject) => {
    if (!tokenClient) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE.clientId,
        scope: SCOPE,
        callback: () => {}, // replaced per request below
      })
    }
    tokenClient.callback = (response) => {
      if (response.error) return reject(new Error(response.error))
      token = response.access_token
      expiresAt = Date.now() + (Number(response.expires_in) || 3600) * 1000 - 60_000
      resolve(token)
    }
    tokenClient.error_callback = (err) => reject(new Error(err?.type || 'popup closed'))
    // An empty prompt reuses the existing Google session when there is one, so
    // a returning user is not asked to consent again.
    tokenClient.requestAccessToken({ prompt: silent ? '' : 'consent' })
  })
}

async function ensureToken() {
  if (isConnected()) return token
  await loadGoogleScripts()
  return requestToken({ silent: true })
}

async function api(url, options = {}) {
  const accessToken = await ensureToken()
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, ...(options.headers ?? {}) },
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Google Drive: ${response.status} ${response.statusText} ${detail}`.trim())
  }
  return response
}

function loadPicker() {
  return new Promise((resolve, reject) => {
    gapi.load('picker', { callback: resolve, onerror: () => reject(new Error('picker failed to load')) })
  })
}

/**
 * The picker reports some of its own failures — a rejected developer key, say —
 * in a dialog that has no close button and never reaches the picker callback.
 * It then sits on top of the note until the page is reloaded, so the app has to
 * offer the way out itself: Escape, or a click on the backdrop. Returns a
 * teardown to run once the picker is gone.
 */
function installPickerEscape(dismiss) {
  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation() // do not also close a dialog underneath
      dismiss()
    }
  }
  // Clicking away is what most people try first. The class belongs to Google's
  // markup, so this may stop working one day — Escape is the reliable path and
  // this is the convenience on top of it.
  const onBackdrop = (event) => {
    if (event.target?.classList?.contains('picker-dialog-bg')) dismiss()
  }
  document.addEventListener('keydown', onKey, true)
  document.addEventListener('click', onBackdrop, true)
  return () => {
    document.removeEventListener('keydown', onKey, true)
    document.removeEventListener('click', onBackdrop, true)
  }
}

export const googleDrive = {
  id: 'gdrive',
  label: 'Google Drive',
  isConfigured,
  isConnected,

  async connect() {
    await loadGoogleScripts()
    // An explicit connect shows the consent screen; silent renewal happens in
    // ensureToken afterwards.
    await requestToken({ silent: false })
  },

  disconnect() {
    if (token) google.accounts.oauth2.revoke(token, () => {})
    token = null
    expiresAt = 0
  },

  /**
   * Google's own file chooser. Resolves to [] when the user cancels. A
   * `parent` folder id, when given, opens the chooser inside that folder (shown
   * under `parentLabel`) so it lands in the app's own folder; a second view
   * over all of My Drive keeps files kept elsewhere reachable.
   */
  async pick(parent, parentLabel) {
    const accessToken = await ensureToken()
    await loadPicker()

    return new Promise((resolve) => {
      let picker = null
      let teardown = () => {}
      const dismiss = (result) => {
        teardown()
        picker?.dispose()
        resolve(result)
      }
      teardown = installPickerEscape(() => dismiss([]))

      // Markdown reaches Drive under several types depending on how it was
      // uploaded, so the filter stays broad. Too narrow and a user's own notes
      // are simply missing from the chooser, which reads as the app being
      // broken. Owned-by-me drops the clutter of folders other people have
      // shared, which is not where anyone keeps the note they came to open.
      const listView = () => new google.picker.DocsView(google.picker.ViewId.DOCS)
        // `drive.file` does not grant thumbnail access until a file is picked.
        .setMode(google.picker.DocsViewMode.LIST)
        .setMimeTypes('text/markdown,text/x-markdown,text/plain')
        .setIncludeFolders(true)
        .setOwnedByMe(true)

      const home = listView()
      if (parent) home.setParent(parent)
      if (parentLabel) home.setLabel(parentLabel)

      const builder = new google.picker.PickerBuilder().addView(home)
      // A second view over the whole of My Drive, so notes kept outside the app
      // folder stay reachable — the folder is a default home, not a cage.
      if (parent) builder.addView(listView().setLabel('My Drive'))

      picker = builder
        .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
        .setOAuthToken(accessToken)
        .setDeveloperKey(GOOGLE.apiKey)
        // Without the app id, a file the user picks is not granted to this app
        // under `drive.file`, and reading it fails after an apparently
        // successful choice.
        .setAppId(GOOGLE.appId)
        .setCallback((data) => {
          if (data.action === google.picker.Action.PICKED) {
            dismiss(data.docs.map((d) => ({ id: d.id, name: d.name })))
          } else if (data.action === google.picker.Action.CANCEL) {
            dismiss([])
          }
        })
        .build()

      picker.setVisible(true)
    })
  },

  /**
   * A folder chooser for "save as". Resolves to { id, name } for the chosen
   * folder, or null when the user cancels. Picking a folder is also what grants
   * this app permission to create a file inside it under `drive.file`.
   */
  async pickFolder() {
    const accessToken = await ensureToken()
    await loadPicker()

    return new Promise((resolve) => {
      let picker = null
      let teardown = () => {}
      const dismiss = (result) => {
        teardown()
        picker?.dispose()
        resolve(result)
      }
      teardown = installPickerEscape(() => dismiss(null))

      // A folders-only view whose folders are themselves selectable — without
      // setSelectFolderEnabled the folder can be opened but never chosen. Kept
      // to the user's own folders (setOwnedByMe), starting at the My Drive root
      // (setParent) and navigating down — not a flat search of every folder,
      // and never someone else's.
      const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
        .setMode(google.picker.DocsViewMode.LIST)
        .setSelectFolderEnabled(true)
        .setMimeTypes('application/vnd.google-apps.folder')
        .setOwnedByMe(true)
        .setParent('root')

      picker = new google.picker.PickerBuilder()
        .addView(view)
        // Hide the side panel (Shared with me, shared drives, recent), so only
        // the user's own My Drive is reachable.
        .enableFeature(google.picker.Feature.NAV_HIDDEN)
        .setOAuthToken(accessToken)
        .setDeveloperKey(GOOGLE.apiKey)
        .setAppId(GOOGLE.appId)
        .setCallback((data) => {
          if (data.action === google.picker.Action.PICKED) {
            const folder = data.docs?.[0]
            dismiss(folder ? { id: folder.id, name: folder.name } : null)
          } else if (data.action === google.picker.Action.CANCEL) {
            dismiss(null)
          }
        })
        .build()

      picker.setVisible(true)
    })
  },

  async read(id) {
    const meta = await (await api(`${FILES}/${id}?fields=${REV_FIELDS}`)).json()
    const text = await (await api(`${FILES}/${id}?alt=media`)).text()
    return {
      id: meta.id,
      name: meta.name,
      text,
      parents: meta.parents,
      trashed: meta.trashed,
      headRevisionId: meta.headRevisionId,
      modifiedTime: meta.modifiedTime,
      size: meta.size,
      md5Checksum: meta.md5Checksum,
    }
  },

  /** Restore a file from the Drive trash. */
  async untrash(id) {
    await api(`${FILES}/${id}?fields=id`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ trashed: false }),
    })
  },

  /**
   * The identity of the file's current content, for conflict detection.
   * `headRevisionId` changes on every edit to the file; `md5Checksum` says
   * whether the content is actually the same after all.
   */
  async revision(id) {
    return await (await api(`${FILES}/${id}?fields=${REV_FIELDS}`)).json()
  },

  /**
   * Create a folder and return { id, name }. The app keeps one folder of its
   * own to save into; `drive.file` cannot search for an existing one, so the
   * caller remembers the id rather than looking it up. A folder is metadata
   * with no content, so this is a plain JSON create, not an upload.
   */
  async createFolder(name, parents) {
    const metadata = { name, mimeType: FOLDER_MIME }
    if (parents?.length) metadata.parents = parents
    const created = await api(`${FILES}?fields=id,name`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(metadata),
    })
    return await created.json()
  },

  /**
   * List files this app can see. Under `drive.file` that is exactly what the
   * app created or the user opened through it — which is what lets a custom
   * folder tree exist at all. `parent` restricts to one folder's children,
   * `foldersOnly` to subfolders.
   */
  async list({ parent, foldersOnly } = {}) {
    const clauses = ['trashed=false']
    if (parent) clauses.push(`'${parent}' in parents`)
    if (foldersOnly) clauses.push(`mimeType='${FOLDER_MIME}'`)
    const q = encodeURIComponent(clauses.join(' and '))
    const url =
      `${FILES}?q=${q}&fields=files(id,name,mimeType,parents,modifiedTime,size)&pageSize=1000&orderBy=folder,name`
    const { files } = await (await api(url)).json()
    return files || []
  },

  /** Current metadata for a file or folder: { id, name }. Used to notice a
   *  folder renamed in Drive since its name was cached. */
  async stat(id) {
    const meta = await (await api(`${FILES}/${id}?fields=id,name`)).json()
    return { id: meta.id, name: meta.name }
  },

  /**
   * Create a file (no id) or save over one (id present). Both go through a
   * multipart body so the name travels with the content: a plain media upload
   * carries no metadata, which is why a renamed note never used to reach Drive.
   * `parents` drops a newly created file into a chosen folder; Drive ignores it
   * on an update, where moving a file is a separate operation, so it is only
   * sent when creating.
   */
  async write({ id, name, text, parents }) {
    const boundary = `lemma-md-${crypto.randomUUID()}`
    const metadata = id ? { name } : { name, mimeType: MIME }
    if (!id && parents?.length) metadata.parents = parents

    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: ${MIME}\r\n\r\n${text}\r\n` +
      `--${boundary}--`

    const url = id
      ? `${UPLOAD}/${id}?uploadType=multipart&fields=${REV_FIELDS}`
      : `${UPLOAD}?uploadType=multipart&fields=${REV_FIELDS}`

    const response = await api(url, {
      method: id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    })
    return await response.json()
  },
}
