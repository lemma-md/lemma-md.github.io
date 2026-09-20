// Turn a note's markdown into the ordered list of slide <section>s — the one
// place that decides whether there is a title slide and in what order the content
// slides follow. The projector (present.js) and the PDF export (pdf/pdf.js) both
// build their decks from here, because annotations are keyed by ordinal index:
// with a title slide, ink key 0 is the title and the first content slide is key
// 1. A second copy of this ordering would silently shift every annotation.

import { render } from '../viewer.js'
import { parseDeck, buildTitleBody } from './slides.js'

// The front-matter fields that, if any is present, justify an opening title
// slide (so a deck whose front-matter carries only options — e.g. `fontsize:` —
// gets no blank title page).
const TITLE_FIELDS = ['title', 'author', 'affiliation', 'place', 'date']

export function hasTitle(meta) {
  return !!meta && TITLE_FIELDS.some((k) => meta[k])
}

/** The opening title slide from front-matter fields. Text is set with
 *  textContent inside buildTitleBody, never innerHTML. */
export function titleSection(meta) {
  const section = document.createElement('section')
  section.className = 'title center'
  section.appendChild(buildTitleBody(meta))
  return section
}

/** One content slide: rendered markdown plus any directive it declared. */
export function contentSection(slide) {
  const section = document.createElement('section')
  if (slide.center) section.classList.add('center')
  if (slide.cls) section.classList.add(...slide.cls.split(/\s+/).filter(Boolean))
  if (slide.bg) section.dataset.background = slide.bg
  const body = document.createElement('div')
  body.className = 'slide-body md' // `md` so markdown.css styles the content
  body.innerHTML = render(slide.md)
  section.appendChild(body)
  return section
}

/**
 * Build the whole deck as an ordered array of <section>s, plus the parsed
 * front-matter. `sections[i]` is the slide whose annotations live under ink key
 * `i`. Returns { sections, meta, hasTitle } — `meta` is the front-matter object
 * (or null) so callers can read deck-wide options like `fontsize`.
 */
export function buildDeckSections(markdown) {
  const deck = parseDeck(markdown)
  const meta = deck.title || {}
  const withTitle = hasTitle(meta)
  const sections = []
  if (withTitle) sections.push(titleSection(meta))
  for (const slide of deck.slides) sections.push(contentSection(slide))
  return { sections, meta, hasTitle: withTitle }
}
