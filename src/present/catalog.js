// What the presentations page lists. Until presentations become records of
// their own (ROADMAP 2.1), a presentation is still its note: the projector
// reads the note by its id, and keeps the ink and the last slide shown under
// that id. A note counts as a presentation once it has been presented, which
// leaves one or the other behind.
//
// The one exception is a board of its own, started from the presentations
// page: no note and no slides, only board pages. A meta cell under its id
// (`present-board:<id>`) marks it, and its ink is kept under that id as a
// note's would be. With no note, closing a note in the editor can never take
// its drawings with it. Only startBoard writes.

import * as defaultDrafts from '../drafts.js'
import { parseDeck, slideCount } from './slides.js'

/** The projector's address for a note, from wherever the caller is. */
export const projectorUrl = (id) => new URL(`../../present/?id=${encodeURIComponent(id)}`, import.meta.url).href

/** The projector window's name for a note: the editor's Present uses the same,
 *  so a presentation already showing is brought back rather than opened twice. */
export const projectorWindow = (id) => `lemma-present-${id}`

const BOARD = 'present-board:'

/** A new id for a board of its own; startBoard makes it one. */
export const boardId = () => `board-${crypto.randomUUID()}`

/** Mark `id` as a board of its own, so the projector shows it and this list
 *  finds it. */
export const startBoard = (id, drafts = defaultDrafts) => drafts.putMeta(`${BOARD}${id}`, { created: Date.now() })

/** The board of its own under `id`, `{ created }`, or null if it is none. */
export const getBoard = (id, drafts = defaultDrafts) => drafts.getMeta(`${BOARD}${id}`)

/** Count what an ink record has drawn on: slides, and pages of the board
 *  (keyed `board:N`). Undo history alone draws nothing. */
function drawn(record) {
  let slides = 0
  let board = 0
  for (const [key, strokes] of Object.entries(record?.slides ?? {})) {
    if (!strokes?.length) continue
    if (String(key).startsWith('board:')) board++
    else slides++
  }
  return { slides, board }
}

const sourceOf = (doc) => (doc.remote?.provider ? doc.remote.provider : doc.local?.handle ? 'local' : null)

/**
 * Every presentation in this browser, the most recently drawn on first. `drafts`
 * is the storage module, passed in by tests to use a database of their own.
 */
export async function listPresentations(drafts = defaultDrafts) {
  const [docs, records] = await Promise.all([drafts.listDocs(), drafts.listAnnotations()])
  const inkOf = new Map(records.map((r) => [r.id, r]))
  const found = []
  for (const doc of docs) {
    const ink = inkOf.get(doc.id)
    const lastSlide = await drafts.getMeta(`present-slide:${doc.id}`).catch(() => null)
    const marks = drawn(ink)
    if (!marks.slides && !marks.board && !Number.isInteger(lastSlide)) continue
    const deck = parseDeck(doc.text ?? '')
    found.push({
      id: doc.id,
      title: deck.title?.title || doc.name,
      note: doc.name,
      source: sourceOf(doc),
      slides: slideCount(deck),
      drawnSlides: marks.slides,
      boardPages: marks.board,
      lastDrawn: marks.slides || marks.board ? ink.updatedAt ?? null : null,
      lastSlide: Number.isInteger(lastSlide) ? lastSlide : null,
      binned: Boolean(doc.binnedAt),
      edited: doc.updatedAt ?? null,
    })
  }
  // Boards of their own, once something is drawn on them: a board started and
  // left blank is not worth a line.
  for (const { key, value } of await drafts.listMeta(BOARD)) {
    const id = key.slice(BOARD.length)
    const ink = inkOf.get(id)
    const marks = drawn(ink)
    if (!marks.slides && !marks.board) continue
    found.push({
      id,
      board: true,
      title: null,
      created: value?.created ?? null,
      note: null,
      source: null,
      slides: 0,
      drawnSlides: marks.slides,
      boardPages: marks.board,
      lastDrawn: ink.updatedAt ?? null,
      lastSlide: null,
      binned: false,
      edited: value?.created ?? null,
    })
  }
  return found.sort((a, b) => (b.lastDrawn ?? 0) - (a.lastDrawn ?? 0) || (b.edited ?? 0) - (a.edited ?? 0))
}
