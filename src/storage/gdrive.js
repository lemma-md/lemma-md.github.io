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

  /** Google's own file chooser. Resolves to [] when the user cancels. */
  async pick() {
    const accessToken = await ensureToken()
    await loadPicker()

    return new Promise((resolve) => {
      let picker = null

      /**
       * The picker reports its own failures — a rejected developer key, say —
       * in a dialog that has no close button and never reaches the callback
       * below. It then sits on top of the note until the page is reloaded.
       * So the app has to provide the way out itself.
       */
      const dismiss = (result) => {
        document.removeEventListener('keydown', onKey, true)
        document.removeEventListener('click', onBackdrop, true)
        picker?.dispose()
        resolve(result)
      }

      const onKey = (event) => {
        if (event.key === 'Escape') {
          event.stopPropagation() // do not also close the Settings dialog
          dismiss([])
        }
      }

      // Clicking away is what most people try first. The class belongs to
      // Google's markup, so this may stop working one day — Escape is the
      // reliable path and this is the convenience on top of it.
      const onBackdrop = (event) => {
        if (event.target?.classList?.contains('picker-dialog-bg')) dismiss([])
      }

      document.addEventListener('keydown', onKey, true)
      document.addEventListener('click', onBackdrop, true)

      // Markdown reaches Drive under several types depending on how it was
      // uploaded, so the filter stays broad. Too narrow and a user's own notes
      // are simply missing from the chooser, which reads as the app being
      // broken.
      const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
        // `drive.file` does not grant thumbnail access until a file is picked.
        .setMode(google.picker.DocsViewMode.LIST)
        .setMimeTypes('text/markdown,text/x-markdown,text/plain')
        .setIncludeFolders(true)

      picker = new google.picker.PickerBuilder()
        .addView(view)
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

  async read(id) {
    const meta = await (await api(`${FILES}/${id}?fields=id,name`)).json()
    const text = await (await api(`${FILES}/${id}?alt=media`)).text()
    return { id: meta.id, name: meta.name, text }
  },

  async write({ id, name, text }) {
    if (id) {
      const updated = await api(`${UPLOAD}/${id}?uploadType=media&fields=id,name`, {
        method: 'PATCH',
        headers: { 'Content-Type': MIME },
        body: text,
      })
      return await updated.json()
    }

    // Creating needs the name alongside the content, which Drive takes as a
    // multipart body rather than two requests.
    const boundary = `lemma-md-${crypto.randomUUID()}`
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify({ name, mimeType: MIME })}\r\n` +
      `--${boundary}\r\nContent-Type: ${MIME}\r\n\r\n${text}\r\n` +
      `--${boundary}--`

    const created = await api(`${UPLOAD}?uploadType=multipart&fields=id,name`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    })
    return await created.json()
  },
}
