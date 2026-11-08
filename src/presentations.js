// The presentations page (presentations/index.html): every note presented in
// this browser, each with a button to show it again in the projector. What
// counts as a presentation, and what is known about one, is catalog.js's.
//
// The projector opens in a window of its own, named as the editor names it, so
// the list stays where it is and a presentation already showing comes forward.

import * as drafts from './drafts.js'
import { listPresentations, projectorUrl, projectorWindow, boardId, startBoard } from './present/catalog.js'
import { helpUrl } from './help.js'

const el = {
  list: document.getElementById('decks'),
  note: document.getElementById('decks-note'),
  newBoard: document.getElementById('new-board'),
}

const SOURCES = { gdrive: 'Google Drive', local: 'this computer' }

function fmtDate(ms) {
  const d = new Date(ms)
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay
    ? `today, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** A presentation's name: its title, or for a board of its own, when it began. */
const title = (p) => (p.board
  ? `Board, ${new Date(p.created).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
  : p.title)

/** The facts under a presentation's title, as one line. */
function facts(p) {
  const parts = p.board
    ? ['a board of its own, no slides']
    : [
        `from “${p.note}”${p.source ? `, saved on ${SOURCES[p.source] ?? p.source}` : ''}`,
        plural(p.slides, 'slide'),
      ]
  const drawings = [
    p.drawnSlides && `on ${plural(p.drawnSlides, 'slide')}`,
    p.boardPages && `on ${plural(p.boardPages, 'board page')}`,
  ].filter(Boolean)
  if (drawings.length) parts.push(`drawings ${drawings.join(' and ')}`)
  if (p.lastDrawn) parts.push(`last drawn ${fmtDate(p.lastDrawn)}`)
  return parts.join(' · ')
}

function item(p) {
  const li = document.createElement('li')
  li.className = 'deck'
  li.dataset.id = p.id

  const text = document.createElement('div')
  text.className = 'deck-text'
  const heading = document.createElement('h3')
  heading.textContent = title(p)
  if (p.binned) {
    const tag = document.createElement('span')
    tag.className = 'tag'
    tag.textContent = 'In the bin'
    tag.title = 'Its note was discarded; it stays in the bin, in the editor’s Settings, until the bin empties'
    heading.append(' ', tag)
  }
  const line = document.createElement('p')
  line.className = 'deck-facts'
  line.textContent = facts(p)
  text.append(heading, line)

  const show = document.createElement('button')
  show.type = 'button'
  show.className = 'button'
  show.textContent = p.lastSlide ? `Show from slide ${p.lastSlide + 1}` : 'Show'
  show.onclick = () => window.open(projectorUrl(p.id), projectorWindow(p.id))

  li.append(text, show)
  return li
}

function say(text, link) {
  el.note.textContent = text
  if (link) {
    const a = document.createElement('a')
    a.href = link.href
    a.textContent = link.text
    el.note.append(' ', a)
  }
  el.note.hidden = false
}

async function render() {
  el.note.hidden = true
  if (await drafts.openFailure()) {
    el.list.textContent = ''
    el.newBoard.disabled = true // nothing drawn on it could be kept
    say('This browser won’t let lemma-md store anything, so no presentation is kept here.',
      { href: helpUrl('troubleshooting', 'storage-blocked'), text: 'How to allow it' })
    return
  }
  const all = await listPresentations().catch(() => [])
  el.list.replaceChildren(...all.map(item))
  if (!all.length) {
    say('Nothing presented in this browser yet. Start with a blank board, or open a note in the editor and choose Present: it will be listed here.',
      { href: '../editor/', text: 'Open the editor' })
  }
}

// A board of its own, in the projector's window. The window opens at once, in
// the click, where a popup blocker allows it; the board is made while it loads.
el.newBoard.onclick = async () => {
  const id = boardId()
  const win = window.open('', projectorWindow(id))
  try {
    await startBoard(id)
  } catch (err) {
    win?.close()
    say(`The board could not be started: ${err?.message ?? err}`)
    return
  }
  if (win) win.location.href = projectorUrl(id)
  else window.open(projectorUrl(id), projectorWindow(id))
}

render()
// A presentation made or drawn on in another tab shows up on coming back.
document.addEventListener('visibilitychange', () => { if (!document.hidden) render() })
