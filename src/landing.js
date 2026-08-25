// Front page: render the examples with the very code the editor uses.
//
// The claim the examples make — "this is what you get" — would rot if the page
// carried hand-written HTML beside each snippet. So the markdown on the left is
// the only copy, read straight out of the page and rendered into the box
// beside it.

import { loadScript } from './load-script.js'

// marked, DOMPurify and KaTeX together weigh more than the rest of the page,
// and none of them is needed to read the text above the examples. They arrive
// after first paint; until they do, each box says so.
const VENDOR = ['../vendor/marked.min.js', '../vendor/purify.min.js', '../vendor/katex/katex.min.js']

async function renderExamples() {
  const examples = [...document.querySelectorAll('.example')]
  if (!examples.length) return

  // Sequential, not parallel: viewer.js calls marked.use() as it loads, so
  // marked has to be a global by then.
  for (const src of VENDOR) {
    await loadScript(new URL(src, import.meta.url).href)
  }
  const { render } = await import('./viewer.js')

  for (const example of examples) {
    const source = example.querySelector('.src')
    const out = example.querySelector('.out')
    if (!source || !out) continue
    // The snippet is indented in the HTML for readability; leading and
    // trailing blank lines would otherwise become an empty paragraph.
    out.innerHTML = render(source.textContent.trim())
    out.classList.remove('pending')
  }
}

renderExamples().catch((err) => {
  // A front page that renders nothing is still a front page: the markdown
  // sources stay visible and every link still works.
  console.error(err)
  for (const out of document.querySelectorAll('.example .out')) {
    out.textContent = 'Could not render this example.'
  }
})
