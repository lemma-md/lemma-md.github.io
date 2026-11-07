// The downloaded .html: it must render a note exactly as the preview does, with
// both copies of its renderer (the readable one and the minified RENDER_MIN that
// actually ships), and give back the note's source byte for byte when dragged
// back in. See docs/HTML_EXPORT.md.
//
// The file loads its libraries from a CDN. Here they are swapped for the
// vendored copies, so the tests run offline; a test below checks that the
// versions are the same, which is what makes the swap fair.

import { render } from '../../src/viewer.js'
import { buildStandaloneHtml, extractMarkdown } from '../../src/export-html.js'
import { suite, test, assert } from './runner.js'

const CDN = 'https://cdn.jsdelivr.net/npm/'

/** The exported page with the CDN swapped for the vendored libraries. */
function offline(html) {
  const out = html
    .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/marked@[^"]+/g, '/vendor/marked.min.js')
    .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/dompurify@[^"]+/g, '/vendor/purify.min.js')
    .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/katex@[^"]+\/katex\.min\.js/g, '/vendor/katex/katex.min.js')
    .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/katex@[^"]+\/katex\.min\.css/g, '/vendor/katex/katex.min.css')
    // GitHub's stylesheet only styles the page; nothing here depends on it.
    .replace(/<link rel="stylesheet" href="https:\/\/cdn\.jsdelivr\.net\/npm\/github-markdown-css[^"]*">/, '')
  // A CDN file this test does not know about would make it depend on the network.
  assert.ok(!out.includes(CDN), 'every CDN file has a vendored stand-in')
  return out
}

/** Load a page into a hidden frame and return what it rendered into #content. */
async function renderedBy(html) {
  const frame = document.createElement('iframe')
  document.getElementById('scratch').append(frame)
  try {
    const loaded = new Promise((resolve) => { frame.onload = resolve })
    frame.srcdoc = html
    await loaded // after the library scripts and the inline renderer have run
    return frame.contentDocument.getElementById('content').innerHTML
  } finally {
    frame.remove()
  }
}

/** HTML as the browser writes it back after parsing it: KaTeX's own escaping
 *  (`&#x27;`) and the browser's (`'`) are the same page. */
function asParsed(html) {
  const div = document.createElement('div')
  div.innerHTML = html
  return div.innerHTML
}

/** Where two strings first differ, with a little context: a readable failure. */
function sameText(actual, expected, what) {
  if (actual === expected) return
  let i = 0
  while (i < actual.length && actual[i] === expected[i]) i++
  const at = (s) => JSON.stringify(s.slice(Math.max(0, i - 40), i + 60))
  throw new Error(`${what} differs at character ${i}:\n  got      ${at(actual)}\n  expected ${at(expected)}`)
}

/** Both copies of the exported renderer, read from the module's source. */
async function rendererSources() {
  const source = await (await fetch('../../src/export-html.js', { cache: 'no-store' })).text()
  const min = JSON.parse(/const RENDER_MIN = (".*")/.exec(source)[1])
  // The working copy may have Windows line breaks.
  const readable = /\/\/ >>> render-source >>>\r?\n([\s\S]*?)\/\/ <<< render-source <<</.exec(source)[1].trim()
  return { min, readable }
}

// A note touching every rule the renderer has: formulas of every kind, the
// blocks around them, raw HTML for the sanitiser, and links.
const CORPUS = [
  '# Heading\n\nText with $x$, $2x+1$, $ x $ and \\$5.',
  'text:\n$$\n\\operatorname{div}(f)\n=\n\\sum_p p\n$$\nmore',
  '$$\n\\int_0^1 x\\,dx\n$$after\n\n## Second\n\n- item $a$\n- item **bold**',
  'Inline display $$x^2$$ here, and `$code$`.',
  '$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$',
  'Title\n===\n\n| a | b |\n|---|---|\n| $1$ | 2 |',
  '<img src="x" onerror="alert(1)"> [ext](https://example.com) [in](#here)',
  '<style>body { display: none }</style>\n\n<p style="position: fixed">x</p>',
  '<form action="https://example.com"><input name="p" type="password"><button>Go</button></form>',
  '<div class="blank-screen" id="banner">y</div> [to it](#banner) [slide](#/3)\n\n- [x] done\n- [ ] to do',
  '```\n</script><script>alert(1)</script>\n```',
  'Broken $\\frac{1}{$ formula.',
].join('\n\n')

suite('export')

test('the file pins the library versions the app vendors', async () => {
  const html = buildStandaloneHtml('n.md', 'x')
  const pinned = (name) => new RegExp(`${name}@([0-9.]+)`).exec(html)?.[1]
  const vendored = async (path, re) => re.exec(await (await fetch(path)).text())?.[1]
  assert.equal(pinned('marked'), await vendored('../../vendor/marked.min.js', /marked@([0-9.]+)/), 'marked')
  assert.equal(pinned('dompurify'), await vendored('../../vendor/purify.min.js', /DOMPurify ([0-9.]+)/), 'DOMPurify')
  assert.equal(pinned('katex'), await vendored('../../vendor/katex/katex.min.js', /version:"([0-9.]+)"/), 'KaTeX')
})

test('the shipped renderer draws a note as the preview does', async () => {
  const html = offline(buildStandaloneHtml('n.md', CORPUS))
  const { min } = await rendererSources()
  assert.ok(html.includes(min), 'the file carries RENDER_MIN')
  sameText(await renderedBy(html), asParsed(render(CORPUS)), 'RENDER_MIN output')
})

test('the readable renderer draws it the same way', async () => {
  const { min, readable } = await rendererSources()
  const html = offline(buildStandaloneHtml('n.md', CORPUS)).replace(min, () => `(${readable})()`)
  sameText(await renderedBy(html), asParsed(render(CORPUS)), 'readable renderer output')
})

test('the source comes back byte for byte', () => {
  const md = 'a </script> b & c &amp; <b>x</b> "q" \'s\' ё ∞ $x$\n\n```\n<script>\n```\n'
  assert.equal(extractMarkdown(buildStandaloneHtml('n.md', md)), md)
})

test('except Windows line breaks, which come back as \\n', () => {
  // The HTML parser turns every \r\n into \n before anything reads the page.
  const md = 'one\r\ntwo\r\n'
  assert.equal(extractMarkdown(buildStandaloneHtml('n.md', md)), 'one\ntwo\n')
})

test('a page that is not an export gives nothing back', () => {
  assert.equal(extractMarkdown('<!DOCTYPE html><p>hello</p>'), null)
})
