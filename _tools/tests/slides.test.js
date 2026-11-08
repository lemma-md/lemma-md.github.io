// How a note becomes a deck (src/present/slides.js): where it is cut into
// slides, what counts as front-matter, and the directive comment on a slide.
// Then the templates a new note can start from, which must render cleanly.

import { splitSlides, parseDeck, parseDirectives, hasTitle } from '../../src/present/slides.js'
import { templates, WELCOME } from '../../src/templates.js'
import { errors } from './render.test.js'
import { suite, test, assert } from './runner.js'

const count = (md) => splitSlides(md).length

suite('slides')

test('--- on a line of its own separates slides', () => {
  assert.deepEqual(splitSlides('a\n\n---\n\nb'), ['a\n', '\nb'])
})

test('separators at either end make no empty slide', () => {
  assert.equal(count('---\n\na\n\n---\n'), 1)
})

test('--- in a code block does not cut', () => {
  assert.equal(count('a\n\n```\n---\n```\n\n---\n\nb'), 2)
})

test('--- inside a $$ formula does not cut', () => {
  assert.equal(count('a\n\n$$\nx\n---\ny\n$$\n\n---\n\nb'), 2)
})

test('$$x$$ on one line opens nothing', () => {
  assert.equal(count('a $$x$$ b\n\n---\n\nc'), 2)
})

test('a closing line with text after $$ closes the formula', () => {
  assert.equal(count('a\n$$\nx\n$$text\n\n---\n\nb'), 2)
})

test('an unclosed $$ ends at a blank line, not at the end of the deck', () => {
  assert.equal(count('one\n$$\nx\n\n---\n\ntwo\n\n---\n\nthree'), 3)
})

test('a four-backtick fence holds a three-backtick one', () => {
  assert.equal(count('a\n\n````\n```\n---\n```\n````\n\n---\n\nb'), 2)
})

test('~~~ does not close a ``` fence', () => {
  assert.equal(count('```\n~~~\n---\nstill code\n```'), 1)
})

test('a closing fence holds nothing else on its line', () => {
  assert.equal(count('```\n``` not a close\n---\nstill code\n```'), 1)
})

test('$$ in inline code opens no formula', () => {
  // No blank line before the separator, which would end a formula anyway.
  assert.equal(count('a `$$` b\n---\nc'), 2)
})

test('options alone in the front-matter make no title slide', () => {
  assert.ok(!hasTitle({ fontsize: '28' }), 'fontsize only')
  assert.ok(hasTitle({ title: 'A talk', fontsize: '28' }), 'a title')
})

test('front-matter becomes the title, not a slide', () => {
  const deck = parseDeck('---\ntitle: On curves\nauthor: A. B.\n---\n\nfirst\n\n---\n\nsecond')
  assert.deepEqual(deck.title, { title: 'On curves', author: 'A. B.' })
  assert.equal(deck.slides.length, 2)
})

test('a leading --- with no key: value is a separator, not front-matter', () => {
  const deck = parseDeck('---\njust text\n---\nmore')
  assert.equal(deck.title, null)
})

test('a directive comment sets the slide up and leaves its text', () => {
  const { directives, md } = parseDirectives('<!-- center; class: big; bg: #222 -->\n# T')
  assert.deepEqual(directives, { center: true, cls: 'big', bg: '#222' })
  assert.equal(md, '# T')
})

suite('templates')

test('the welcome note renders without formula errors', () => {
  assert.equal(errors(WELCOME), 0)
})

test('every template renders without formula errors, slide by slide', () => {
  for (const t of templates) {
    for (const [i, slide] of parseDeck(t.text ?? '').slides.entries()) {
      assert.equal(errors(slide.md), 0, `${t.id}, slide ${i + 1}`)
    }
  }
})
