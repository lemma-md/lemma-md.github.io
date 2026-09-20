// Projector entry point. Loads the note named by ?id from the same IndexedDB the
// editor uses, renders each slide with the app's own render() (one markdown+TeX
// pipeline — reveal's markdown/math plugins stay off), drives reveal.js for
// layout and navigation, and lays the ink layer on top.
//
// reveal.js is a vendored global (`Reveal`); marked/katex/DOMPurify are the same
// globals viewer.js expects — all loaded by present/index.html before this
// module.

import * as drafts from '../drafts.js'
import { buildDeckSections } from './deck-dom.js'
import { createInk, W, H } from './ink.js'

const slidesEl = document.getElementById('slides')
const messageEl = document.getElementById('message')

function fail(text) {
  messageEl.textContent = text
  messageEl.hidden = false
}

async function main() {
  const id = new URLSearchParams(location.search).get('id')
  if (!id) return fail('No note to present. Open a note in the editor and choose Present.')

  const doc = await drafts.getDoc(id).catch(() => null)
  if (!doc) return fail('That note could not be found in this browser.')

  document.title = `${doc.name} — lemma-md`

  // buildDeckSections is shared with the PDF export (deck-dom.js), so the section
  // order — and thus the ordinal that each slide's annotations are keyed by — is
  // identical in both.
  const { sections, meta } = buildDeckSections(doc.text)
  if (!sections.length) return fail('This note is empty — nothing to present.')

  for (const s of sections) slidesEl.appendChild(s)

  // Optional base type size from the front-matter, e.g. `fontsize: 24` (or the
  // `font-size` spelling) — the one place the whole deck's "font size" lives,
  // since reveal scales the slide box. A bare number is px on the 960x700 slide;
  // any CSS length (e.g. `18pt`) is passed through, so a familiar point size
  // works too (CSS makes 18pt = 24px). The editor preview honours the same value
  // (app.js), so the two agree.
  const fontsize = meta.fontsize ?? meta['font-size']
  if (fontsize) {
    const fs = /^\d+(\.\d+)?$/.test(fontsize) ? `${fontsize}px` : fontsize
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
