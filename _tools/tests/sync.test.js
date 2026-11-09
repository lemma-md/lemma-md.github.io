// The editor's preview in step with the source: the line map in the rendered
// preview (viewer.js, render with `lines`), and how a slide's lines are the
// note's (present/slides.js). The editor and the preview following it, and
// Ctrl+click, are in editor.test.js.

import { render } from '../../src/viewer.js'
import { parseDeck } from '../../src/present/slides.js'
import { anchors } from '../../src/sync.js'
import { suite, test, assert } from './runner.js'

const NOTE = [
  '# Title', //                 0
  '', //                        1
  'A paragraph', //             2
  'over two lines.', //         3
  '', //                        4
  '$$', //                      5
  'x^2', //                     6
  '$$', //                      7
  '- one', //                   8
  '- two', //                   9
  '', //                        10
  '```', //                     11
  'code', //                    12
  '```', //                     13
  '', //                        14
  '<!-- a comment -->', //      15
  '', //                        16
  '| a |', //                   17
  '|---|', //                   18
  '| 1 |', //                   19
].join('\n')

/** The rendered note with its map. */
function mapped(md, opts = { lines: 0 }) {
  const div = document.createElement('div')
  div.innerHTML = render(md, opts)
  return div
}

suite('preview in step')

test('each block of the preview carries the line it starts on and how many it takes', () => {
  const map = anchors(mapped(NOTE)).map((a) => [a.el.tagName.toLowerCase(), a.line, a.lines])
  assert.deepEqual(map, [
    ['h1', 0, 1], ['p', 2, 2], ['div', 5, 3], ['ul', 8, 2], ['pre', 11, 3], ['div', 15, 1], ['table', 17, 3],
  ])
})

test('the map changes nothing else: the same text, the same formulas', () => {
  const plain = mapped(NOTE, {})
  const withMap = mapped(NOTE)
  assert.equal(plain.querySelectorAll('[data-line]').length, 0, 'none without asking')
  assert.equal(withMap.textContent, plain.textContent)
  assert.equal(withMap.querySelectorAll('.katex').length, plain.querySelectorAll('.katex').length)
  // Reference links are the whole note's, though each block is rendered alone.
  assert.ok(mapped('See [the site][s].\n\n[s]: https://example.org').querySelector('a[href="https://example.org"]'))
})

test("a slide's lines are the note's: after the front-matter, and after a directive", () => {
  const md = '---\ntitle: T\n---\n\n# One\n\n---\n\n<!-- center -->\n# Two\ntext'
  const deck = parseDeck(md)
  assert.deepEqual(deck.slides.map((s) => [s.line, s.mdLine]), [[3, 3], [7, 8]])
  // The heading of the second slide, "# Two", is line 9 of the note.
  const lines = md.split('\n')
  const two = deck.slides[1]
  const first = anchors(mapped(two.md))[0]
  assert.equal(lines[two.mdLine + first.line], '# Two')
})
