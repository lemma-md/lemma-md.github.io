// Formulas a chat writes as \( … \) and \[ … \], and Fix, which writes them in
// dollars (src/delimiters.js). What must not change matters as much: code, and
// formulas already in dollars.

import { fixDelimiters } from '../../src/delimiters.js'
import { render } from '../../src/viewer.js'
import { suite, test, assert } from './runner.js'

const fixed = (md) => fixDelimiters(md).text
const count = (md) => fixDelimiters(md).count

/** How many formulas the preview typesets, and how many it fails on. */
function typeset(md) {
  const div = document.createElement('div')
  div.innerHTML = render(md)
  return { formulas: div.querySelectorAll('.katex').length, errors: div.querySelectorAll('.katex-error').length }
}

suite('formulas from a chat')

test('\\( \\) becomes $ $, \\[ \\] becomes $$ $$', () => {
  assert.equal(fixed('Let \\( f(x) = x^2 \\) be given.'), 'Let $f(x) = x^2$ be given.')
  assert.equal(fixed('Then \\[ \\int_0^1 f = \\tfrac13 \\] in a line.'), 'Then $$\\int_0^1 f = \\tfrac13$$ in a line.')
  // On lines of their own, the $$ stay on lines of their own: a block.
  assert.equal(fixed('So:\n\\[\nE = mc^2\n\\]\nas claimed.'), 'So:\n$$\nE = mc^2\n$$\nas claimed.')
  assert.equal(count('\\(a\\), \\(b\\) and \\[c\\]'), 3)
})

test('a chat\'s answer, once fixed, is typeset', () => {
  const answer = [
    '## The derivative',
    '',
    'For \\( f(x) = x^n \\) with \\( n \\in \\mathbb{N} \\):',
    '',
    '1. Expand \\( (x+h)^n \\):',
    '   \\[',
    '   (x+h)^n = \\sum_{k=0}^{n} \\binom{n}{k} x^{n-k} h^k',
    '   \\]',
    '2. Divide by \\( h \\) and let \\( h \\to 0 \\).',
    '',
    '\\[',
    '\\begin{aligned}',
    'f\'(x) &= \\lim_{h\\to 0} \\frac{(x+h)^n - x^n}{h} \\\\[4pt]',
    '      &= n x^{n-1}',
    '\\end{aligned}',
    '\\]',
  ].join('\n')
  assert.equal(typeset(answer).formulas, 0, 'before, nothing is typeset')
  assert.equal(count(answer), 7)
  assert.deepEqual(typeset(fixed(answer)), { formulas: 7, errors: 0 })
})

test('code is left as it is', () => {
  const fence = '```tex\n\\( x \\) and \\[ y \\]\n```'
  assert.equal(fixed(fence), fence)
  const tildes = '~~~~\n\\(x\\)\n```\n\\(y\\)\n~~~~\nafter \\(z\\)'
  assert.equal(fixed(tildes), '~~~~\n\\(x\\)\n```\n\\(y\\)\n~~~~\nafter $z$')
  assert.equal(fixed('Write `\\(x\\)` or ``\\[y\\]``, not \\(z\\).'), 'Write `\\(x\\)` or ``\\[y\\]``, not $z$.')
})

test('formulas already in dollars are left alone, their own \\[ included', () => {
  const md = '$$\\begin{aligned} a &= b \\\\[4pt] c &= d \\end{aligned}$$ and $\\{x\\}$'
  assert.equal(fixed(md), md)
  assert.equal(count(md), 0)
})

test('what is not a formula stays: escapes, unclosed, empty, across a blank line', () => {
  for (const md of [
    'A backslash before a bracket: \\\\(not math\\\\)',
    'An opening with no end \\( x + y',
    'Nothing inside \\(\\) or \\[ \\]',
    'Two paragraphs \\( a\n\nb \\)',
    'A dollar inside \\( a $ b \\) would end it early',
  ]) {
    assert.equal(fixed(md), md, md)
  }
  // An escaped dollar inside is only a dollar sign.
  assert.equal(fixed('\\( \\$5 \\)'), '$\\$5$')
})
