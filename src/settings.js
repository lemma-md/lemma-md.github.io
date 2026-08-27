import * as drafts from './drafts.js'
import { availableProviders } from './storage/index.js'

const el = {
  dialog: document.getElementById('settings'),
  open: document.getElementById('btn-settings'),
  usage: document.getElementById('storage-usage'),
  persist: document.getElementById('storage-persist'),
  recent: document.getElementById('recent-list'),
  cloud: document.getElementById('cloud-status'),
}

function formatBytes(n) {
  if (!n) return '0 bytes'
  if (n < 1024) return `${n} bytes`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1048576).toFixed(1)} MB`
  return `${(n / 1073741824).toFixed(1)} GB`
}

function formatDate(ms) {
  const d = new Date(ms)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}

async function renderStorage() {
  const status = await drafts.storageStatus()

  if (!status) {
    el.usage.textContent = ''
    el.persist.textContent = ''
    return
  }

  const notes = status.count === 1 ? '1 note' : `${status.count} notes`
  el.usage.textContent = status.count
    ? `${notes}, ${formatBytes(status.bytes)} in total.`
    : 'No notes yet.'
  if (status.nearlyFull) {
    el.usage.textContent += ' This browser is running low on storage space.'
  }

  el.persist.textContent = ''
  const line = document.createElement('div')

  if (status.persisted) {
    // No control is offered because none exists: persistence cannot be revoked
    // from a page, only through the browser's own site settings.
    line.className = 'state ok'
    line.textContent = 'Notes are kept permanently. The browser will not delete them to free up space. You can undo this in the browser’s settings for this site.'
  } else {
    line.className = 'state warn'
    const text = document.createElement('span')
    text.textContent = 'The browser may delete these notes if it runs short of space.'

    const button = document.createElement('button')
    button.className = 'action'
    button.textContent = 'Keep them permanently'
    button.onclick = async () => {
      button.disabled = true
      button.textContent = 'Asking…'
      const granted = await drafts.persistStorage()
      if (granted) return renderStorage()
      button.disabled = false
      button.textContent = 'Keep them permanently'
      text.textContent = granted === null
        ? 'This browser cannot keep notes permanently.'
        : 'The browser declined. Bookmarking this page often changes its mind.'
    }

    line.append(text, button)
  }

  el.persist.append(line)
}

/**
 * Lists every stored note, not just the closed ones. Someone asking "where are
 * my notes?" wants the whole answer; a filtered view that says "nothing here"
 * whenever every note happens to be open reads as "you have none".
 */
async function renderNotes({ getOpenIds, onOpen, onDeleted }) {
  const openIds = new Set(getOpenIds())
  const all = (await drafts.listDocs()).sort((a, b) => b.updatedAt - a.updatedAt)

  el.recent.textContent = ''

  if (!all.length) {
    const li = document.createElement('li')
    li.className = 'empty'
    li.textContent = 'No notes yet.'
    el.recent.append(li)
    return
  }

  for (const doc of all) {
    const isOpen = openIds.has(doc.id)
    const li = document.createElement('li')

    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = doc.name
    if (isOpen) {
      const badge = document.createElement('span')
      badge.className = 'badge'
      badge.textContent = 'open'
      name.append(' ', badge)
    }
    li.append(name)

    const meta = document.createElement('span')
    meta.className = 'meta'
    meta.textContent = `${formatDate(doc.updatedAt)} · ${formatBytes(new Blob([doc.text]).size)}`
    li.append(meta)

    const show = document.createElement('button')
    show.textContent = isOpen ? 'Show' : 'Open'
    show.onclick = () => {
      onOpen(doc)
      el.dialog.close()
    }
    li.append(show)

    const remove = document.createElement('button')
    remove.className = 'danger'
    remove.textContent = 'Delete'
    remove.onclick = async () => {
      // The only irreversible action in the app, so it asks first.
      if (!confirm(`Delete “${doc.name}” permanently?`)) return
      // Drop the tab before the record, so a pending autosave cannot write the
      // note back after it has been deleted.
      onDeleted(doc.id)
      await drafts.deleteDoc(doc.id)
      refresh()
    }
    li.append(remove)

    el.recent.append(li)
  }
}

async function renderCloud({ cloud, onCloudChange }) {
  el.cloud.textContent = ''
  const providers = availableProviders()

  if (!providers.length) {
    const p = document.createElement('p')
    p.className = 'note'
    p.textContent = 'No cloud provider is set up in this copy of the app yet.'
    el.cloud.append(p)
    return
  }

  for (const provider of providers) {
    // Connection is defined by the app, not the live token: it survives a
    // reload (the token is refreshed silently), so a returning user is not told
    // they are disconnected just because the page was reloaded.
    const connected = await cloud.isConnected(provider)

    const row = document.createElement('div')
    row.className = connected ? 'state ok' : 'state'

    const label = document.createElement('span')
    if (connected) {
      label.append(`${provider.label} is connected`)
      // The folder we save into, as a link straight to it in Drive.
      const folder = await cloud.folder?.(provider)
      if (folder?.id) {
        label.append(' — ')
        const a = document.createElement('a')
        a.className = 'folder-link'
        a.href = `https://drive.google.com/drive/folders/${folder.id}`
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        a.textContent = folder.name
        a.title = 'Open this folder in Google Drive'
        label.append(a)
      } else {
        label.append('.')
      }
    } else {
      label.append(`${provider.label} is not connected.`)
    }
    row.append(label)

    const button = document.createElement('button')
    button.className = 'action'
    button.textContent = connected ? 'Disconnect' : 'Connect'
    button.onclick = async () => {
      button.disabled = true
      try {
        if (connected) await cloud.disconnect(provider)
        else await cloud.connect(provider)
      } catch (err) {
        console.error(err)
        label.textContent = `Could not reach ${provider.label}.`
      }
      button.disabled = false
      onCloudChange?.()
      refresh()
    }
    row.append(button)

    el.cloud.append(row)
  }
}

let context = null

export async function refresh() {
  if (!context) return
  await Promise.all([renderCloud(context), renderStorage(), renderNotes(context)])
}

/**
 * @param {object} ctx
 * @param {() => string[]} ctx.getOpenIds  ids currently shown as tabs
 * @param {(doc: object) => void} ctx.onOpen  open a stored note, or focus it
 * @param {(id: string) => void} ctx.onDeleted  drop a note from the tab strip
 */
export function initSettings(ctx) {
  const missing = Object.entries(el).filter(([, node]) => !node).map(([name]) => name)
  if (missing.length) {
    // Settings is a convenience; editing is not. Never let a markup change
    // here take the editor down with it.
    console.error(`Settings unavailable, missing elements: ${missing.join(', ')}`)
    return
  }

  context = ctx

  // Left-hand tabs: clicking one shows its panel and hides the rest.
  for (const tab of el.dialog.querySelectorAll('.settings-tab')) {
    tab.onclick = () => {
      for (const t of el.dialog.querySelectorAll('.settings-tab')) {
        t.classList.toggle('active', t === tab)
      }
      for (const panel of el.dialog.querySelectorAll('.settings-panel')) {
        panel.hidden = panel.id !== tab.dataset.panel
      }
    }
  }

  el.open.onclick = async () => {
    await refresh()
    el.dialog.showModal()
  }
}
