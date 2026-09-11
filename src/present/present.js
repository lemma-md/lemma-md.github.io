// Projector entry point. Loads the note named by ?id from the same IndexedDB the
// editor uses, renders each slide with the app's own render() (one markdown+TeX
// pipeline — reveal's markdown/math plugins stay off), drives reveal.js for
// layout and navigation, and lays the ink layer on top.
//
// reveal.js is a vendored global (`Reveal`); marked/katex/DOMPurify are the same
// globals viewer.js expects — all loaded by present/index.html before this
// module.

import { render } from '../viewer.js'
import * as drafts from '../drafts.js'
import { parseDeck, buildTitleBody } from './slides.js'
import { createInk, W, H } from './ink.js'

const slidesEl = document.getElementById('slides')
const messageEl = document.getElementById('message')

function fail(text) {
  messageEl.textContent = text
  messageEl.hidden = false
}

/** Build the opening title slide from front-matter fields. Only the fields that
 *  are present appear; text is set with textContent, never innerHTML. */
function titleSection(meta) {
  const section = document.createElement('section')
  section.className = 'title center'
  section.appendChild(buildTitleBody(meta))
  return section
}

/** One content slide: rendered markdown, plus any directive it declared. */
function contentSection(slide) {
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

async function main() {
  const id = new URLSearchParams(location.search).get('id')
  if (!id) return fail('No note to present. Open a note in the editor and choose Present.')

  const doc = await drafts.getDoc(id).catch(() => null)
  if (!doc) return fail('That note could not be found in this browser.')

  document.title = `${doc.name} — lemma-md`

  const deck = parseDeck(doc.text)
  const meta = deck.title || {}
  const sections = []
  // A title slide only when there is something to put on it — so a deck whose
  // front-matter carries only options (e.g. `fontsize:`) gets no blank title.
  const hasTitle = ['title', 'author', 'affiliation', 'place', 'date'].some((k) => meta[k])
  if (hasTitle) sections.push(titleSection(meta))
  for (const slide of deck.slides) sections.push(contentSection(slide))
  if (!sections.length) return fail('This note is empty — nothing to present.')

  for (const s of sections) slidesEl.appendChild(s)

  // Optional base type size from the front-matter, e.g. `fontsize: 40` — the one
  // place the whole deck's "font size" lives, since reveal scales the slide box.
  if (meta.fontsize) {
    const fs = /^\d+(\.\d+)?$/.test(meta.fontsize) ? `${meta.fontsize}px` : meta.fontsize
    document.querySelector('.reveal').style.fontSize = fs
  }

  // reveal.js is a UMD global. Its own markdown/highlight/math plugins are left
  // out on purpose: the slides are already rendered HTML.
  const reveal = new Reveal(document.querySelector('.reveal'), {
    width: W,
    height: H,
    // No empty factor around the slide: the breathing room lives inside the
    // slide (present.css padding), not as a grey frame outside it. What grey
    // remains is only unavoidable letterboxing when the screen's aspect ratio
    // differs from the slide's.
    margin: 0,
    minScale: 0.2,
    maxScale: 2.0,
    controls: true,
    progress: true,
    hash: false,
    center: false, // top-aligned reads better for text; the `center` directive opts in per slide
    transition: 'slide',
    keyboard: true,
    slideNumber: 'c/t', // show "current / total" by the controls
    // A projector shows one slide at a time; a tall slide scrolls within itself
    // (our .slide-body). reveal's own "scroll view" is a mobile reading mode that
    // auto-activates on a narrow viewport and re-wraps the slides — disable it so
    // the classic deck layout (and the ink layer) stays put.
    scrollActivationWidth: 0,
    plugins: [],
  })
  await reveal.initialize()

  // Resume on the slide we left off on, then remember it as it changes, so a
  // reload comes back where you were. Kept per note in the meta store.
  const slideKey = `present-slide:${id}`
  const savedIndex = await drafts.getMeta(slideKey).catch(() => null)
  if (Number.isInteger(savedIndex)) reveal.slide(savedIndex)
  reveal.on('slidechanged', (e) => drafts.putMeta(slideKey, e.indexh).catch(() => {}))

  // In the Escape overview, drop the ink layer's grab and hide the palette so a
  // click lands on a thumbnail (reveal navigates to it) instead of the ink.
  reveal.on('overviewshown', () => document.body.classList.add('overview'))
  reveal.on('overviewhidden', () => document.body.classList.remove('overview'))

  // Ink after reveal, so the sections exist and are laid out.
  await createInk(reveal, id)
}

main().catch((err) => {
  console.error(err)
  fail(`Could not start the presentation.\n\n${err?.message ?? err}`)
})
