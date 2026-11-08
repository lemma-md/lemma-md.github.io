// The presentations page and what it lists (src/present/catalog.js): for now a
// presentation is still its note, counted once presenting it has left ink or a
// last slide behind (ROADMAP 2.1 makes it a record of its own).

import { listPresentations, projectorUrl, projectorWindow, startBoard } from '../../src/present/catalog.js'
import { openPage, openEditor, waitFor, storedIn } from './editor-harness.js'
import { suite, test, assert } from './runner.js'

const PREFIX = 'lemma-md-test-catalog-'
const RUN = Date.now()
let made = 0

/** Run `body` with a fresh drafts.js on a database of its own. */
async function withDrafts(body) {
  const name = `${PREFIX}${RUN}-${++made}`
  const before = globalThis.lemmaTestDatabase
  globalThis.lemmaTestDatabase = name
  const drafts = await import(`../../src/drafts.js?catalog=${RUN}-${made}`)
  globalThis.lemmaTestDatabase = before
  try {
    await body(drafts)
  } finally {
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase(name)
      req.onsuccess = req.onerror = req.onblocked = () => resolve()
    })
  }
}

const DECK = '---\ntitle: On curves\n---\n\n# One\n\n---\n\n# Two'
const note = (id, text, extra = {}) => ({ id, name: `${id}.md`, text, updatedAt: 1, ...extra })
const ink = (id, slides, updatedAt = 5) => ({ id, slides, undo: {}, redo: {}, updatedAt })
const STROKE = [{ points: [[0, 0], [1, 1]] }]

suite('presentations')

test('a note never presented is not one', () => withDrafts(async (drafts) => {
  await drafts.putDoc(note('plain', DECK))
  assert.deepEqual(await listPresentations(drafts), [])
}))

test('a note shown once is one: its title, slides, and the slide it stopped at', () => withDrafts(async (drafts) => {
  await drafts.putDoc(note('talk', DECK))
  await drafts.putMeta('present-slide:talk', 2)
  const [p] = await listPresentations(drafts)
  assert.deepEqual(
    [p.id, p.title, p.note, p.slides, p.lastSlide, p.drawnSlides, p.lastDrawn, p.binned],
    ['talk', 'On curves', 'talk.md', 3, 2, 0, null, false],
  )
}))

test('drawings count slides and board pages apart; undo history alone draws nothing', () => withDrafts(async (drafts) => {
  await drafts.putDoc(note('drawn', DECK))
  await drafts.putAnnotations(ink('drawn', { 0: STROKE, 2: STROKE, 1: [], 'board:0': STROKE }, 7))
  await drafts.putDoc(note('undone', DECK))
  await drafts.putAnnotations({ id: 'undone', slides: {}, undo: { 0: [['x']] }, redo: {}, updatedAt: 9 })
  const all = await listPresentations(drafts)
  assert.deepEqual(all.map((p) => p.id), ['drawn'], 'only the one with something drawn')
  assert.deepEqual([all[0].drawnSlides, all[0].boardPages, all[0].lastDrawn], [2, 1, 7])
}))

test("without a title the note's name stands in; a binned note is still listed", () => withDrafts(async (drafts) => {
  await drafts.putDoc(note('untitled', '# One\n\n---\n\n# Two', { binnedAt: 3 }))
  await drafts.putMeta('present-slide:untitled', 0)
  const [p] = await listPresentations(drafts)
  assert.deepEqual([p.title, p.slides, p.binned], ['untitled.md', 2, true])
}))

test('the most recently drawn on comes first', () => withDrafts(async (drafts) => {
  for (const [id, at] of [['old', 1], ['new', 3], ['mid', 2]]) {
    await drafts.putDoc(note(id, DECK))
    await drafts.putAnnotations(ink(id, { 0: STROKE }, at))
  }
  assert.deepEqual((await listPresentations(drafts)).map((p) => p.id), ['new', 'mid', 'old'])
}))

test('a board of its own is one once drawn on, with no note and no slides', () => withDrafts(async (drafts) => {
  await startBoard('board-x', drafts)
  assert.deepEqual(await listPresentations(drafts), [], 'not while it is blank')
  await drafts.putAnnotations(ink('board-x', { 'board:0': STROKE, 'board:1': STROKE }, 9))
  await drafts.putDoc(note('talk', DECK))
  await drafts.putAnnotations(ink('talk', { 0: STROKE }, 5))
  const [board, talk] = await listPresentations(drafts)
  assert.deepEqual(
    [board.id, board.board, board.note, board.slides, board.boardPages, board.lastDrawn],
    ['board-x', true, null, 0, 2, 9],
  )
  assert.ok(Number.isFinite(board.created), 'when it began')
  assert.equal(talk.id, 'talk', 'listed with the notes, the most recently drawn on first')
}))

test('the projector is the one the editor opens: same address, same window', () => {
  assert.equal(projectorUrl('a b'), `${location.origin}/present/?id=a%20b`)
  assert.equal(projectorWindow('a'), 'lemma-present-a')
})

suite('presentations page')

test('it lists them, and Show opens the projector where it left off', async () => {
  const page = await openPage('presentations', {
    docs: [note('talk', DECK)],
    meta: { 'present-slide:talk': 2 },
    annotations: [ink('talk', { 0: STROKE })],
  })
  try {
    await waitFor(() => page.$$('#decks .deck').length === 1, 'the list')
    const row = page.$('#decks .deck')
    assert.equal(row.querySelector('h3').textContent, 'On curves')
    const facts = row.querySelector('.deck-facts').textContent
    assert.ok(facts.includes('from “talk.md”') && facts.includes('3 slides') && facts.includes('drawings on 1 slide'), facts)
    const show = row.querySelector('button')
    assert.equal(show.textContent, 'Show from slide 3')
    show.click()
    assert.deepEqual(page.win.opened, [{ url: `${location.origin}/present/?id=talk`, target: 'lemma-present-talk' }])
  } finally {
    await page.close()
  }
})

test('with nothing presented, it says how to make one', async () => {
  const page = await openPage('presentations', { docs: [note('plain', 'just text')] })
  try {
    const message = await waitFor(() => page.$('#decks-note').textContent.startsWith('Nothing') && page.$('#decks-note'), 'the message')
    assert.ok(message.textContent.startsWith('Nothing presented in this browser yet'), message.textContent)
    assert.ok(message.querySelector('a').href.endsWith('/editor/'), 'a way to the editor')
  } finally {
    await page.close()
  }
})

test('a note presented and drawn on is listed once; discarded, it stays, in the bin', async () => {
  const ed = await openEditor()
  try {
    // A deck in a note of its own, saved as the editor saves.
    const DECK_TEXT = '# One\n\n---\n\n# Two'
    await ed.newNote()
    ;(await ed.editor()).setValue(DECK_TEXT, 1)
    const deck = await waitFor(async () => (await ed.storedDocs()).find((d) => d.text === DECK_TEXT), 'the deck stored')

    let page = await openPage('presentations', {}, { database: ed.database })
    await waitFor(() => page.$('#decks-note').textContent.startsWith('Nothing presented'), 'the list, empty')
    assert.equal(page.$$('#decks .deck').length, 0, 'nothing presented yet')
    await page.close()

    // Present it, switch to the board, take the pen, draw a stroke.
    const projector = await openPage('present', {}, { database: ed.database, query: `id=${encodeURIComponent(deck.id)}` })
    const w = projector.win
    await waitFor(() => projector.$('.reveal .slides section'), 'the slides', 15000) // reveal, KaTeX, fonts
    // The ink layer sets up after the slides, so Alt+B is pressed until the board shows.
    await waitFor(() => {
      w.dispatchEvent(new w.KeyboardEvent('keydown', { code: 'KeyB', key: 'b', altKey: true }))
      return w.getComputedStyle(projector.$('.board')).display !== 'none'
    }, 'the board', 10000)
    w.dispatchEvent(new w.KeyboardEvent('keydown', { code: 'Digit2', key: '2' })) // the pen
    const svg = projector.$('.board svg.board-ink:not([hidden])')
    const box = svg.getBoundingClientRect()
    const at = (type, f) => svg.dispatchEvent(new w.PointerEvent(type, {
      bubbles: true, pointerId: 1, pressure: 0.5, clientX: box.left + box.width * f, clientY: box.top + box.height * f,
    }))
    at('pointerdown', 0.2)
    at('pointermove', 0.3)
    at('pointermove', 0.4)
    at('pointerup', 0.4)
    await waitFor(async () => (await storedIn(ed.database, 'annotations')).some((r) => r.id === deck.id), 'the ink stored')
    await projector.close()

    page = await openPage('presentations', {}, { database: ed.database })
    await waitFor(() => page.$$('#decks .deck').length, 'the list')
    assert.equal(page.$$('#decks .deck').length, 1, 'once')
    assert.ok(page.$('.deck-facts').textContent.includes('drawings on 1 board page'), page.$('.deck-facts').textContent)
    await page.close()

    // Discarded, it goes to the bin with its ink, and is still listed.
    ed.closeActive()
    await ed.choose('close-warn', 'Discard changes')
    await waitFor(async () => (await ed.storedDocs()).find((d) => d.id === deck.id)?.binnedAt, 'binned')
    page = await openPage('presentations', {}, { database: ed.database })
    await waitFor(() => page.$$('#decks .deck').length === 1, 'still listed')
    assert.ok(page.$('.deck h3').textContent.includes('In the bin'), 'marked as in the bin')
    await page.close()
  } finally {
    await ed.close()
  }
}, { timeout: 40000 })

test('Start with a blank board: the projector opens on a board of its own, then it is listed', async () => {
  let page = await openPage('presentations', {})
  const database = page.database
  try {
    await waitFor(() => page.$('#decks-note').textContent.startsWith('Nothing presented'), 'the page ready')
    page.$('#new-board').click()
    const opened = await waitFor(() => page.win.opened.find((o) => o.url.includes('/present/?id=board-')), 'the projector')
    const id = new URL(opened.url).searchParams.get('id')
    assert.equal(opened.target, projectorWindow(id), 'in the window named for it')

    // On the board from the start: no note, no slides, no key pressed.
    const projector = await openPage('present', {}, { database, query: `id=${encodeURIComponent(id)}` })
    try {
      const w = projector.win
      await waitFor(() => w.document.body.classList.contains('board-mode') && projector.$('.board svg.board-ink:not([hidden])'),
        'the board', 15000)
      w.dispatchEvent(new w.KeyboardEvent('keydown', { code: 'Digit2', key: '2' })) // the pen
      const svg = projector.$('.board svg.board-ink:not([hidden])')
      const box = svg.getBoundingClientRect()
      const at = (type, f) => svg.dispatchEvent(new w.PointerEvent(type, {
        bubbles: true, pointerId: 1, pressure: 0.5, clientX: box.left + box.width * f, clientY: box.top + box.height * f,
      }))
      at('pointerdown', 0.2)
      at('pointermove', 0.3)
      at('pointerup', 0.3)
      await waitFor(async () => (await storedIn(database, 'annotations')).some((r) => r.id === id), 'the ink stored')
      const mode = (await storedIn(database, 'meta')).find((r) => r.key === 'present-mode')
      assert.ok(mode?.value !== 'board', 'opening on the board is not what the next talk opens in')
    } finally {
      await projector.close()
    }

    const list = await openPage('presentations', {}, { database })
    try {
      await waitFor(() => list.$$('#decks .deck').length === 1, 'the list')
      assert.ok(list.$('.deck h3').textContent.startsWith('Board, '), list.$('.deck h3').textContent)
      assert.ok(list.$('.deck-facts').textContent.startsWith('a board of its own, no slides · drawings on 1 board page'),
        list.$('.deck-facts').textContent)
    } finally {
      await list.close()
    }
  } finally {
    await page.close() // the page's own database goes with it
  }
}, { timeout: 40000 })

test("the editor's menu opens the list; Present opens the same projector window", async () => {
  const ed = await openEditor()
  try {
    ed.$('#btn-presentations').click()
    assert.deepEqual(ed.win.opened.pop(), { url: `${location.origin}/presentations/`, target: 'lemma-presentations' })
    ed.$('#btn-present').click()
    const id = (await ed.storedDocs())[0].id
    assert.deepEqual(ed.win.opened.pop(), { url: projectorUrl(id), target: projectorWindow(id) })
  } finally {
    await ed.close()
  }
})
