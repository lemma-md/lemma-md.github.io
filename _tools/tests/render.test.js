// How a note renders: what counts as a formula, how display formulas sit among
// the blocks around them, and what the sanitiser lets through. These are the
// rules in src/viewer.js; docs/ARCHITECTURE.md → Rendering pipeline says why.

import { render } from '../../src/viewer.js'
import { suite, test, assert } from './runner.js'

/** The rendered note, as an element. */
export function rendered(md) {
  const div = document.createElement('div')
  div.innerHTML = render(md)
  return div
}

/** The note's top-level blocks: 'p', 'h1', 'ul', … and 'math' for a display
 *  formula standing as a block of its own. */
export function blocks(md) {
  return [...rendered(md).children].map((el) =>
    el.classList.contains('katex-display') ? 'math' : el.tagName.toLowerCase())
}

/** The formulas marked found, in order: `$` + TeX inline, `$$` + TeX display. */
export function formulas(md) {
  const out = []
  const walk = (tokens) => {
    for (const t of tokens ?? []) {
      if (t.type === 'mathBlock') out.push('$$' + t.text)
      else if (t.type === 'mathInline') out.push((t.display ? '$$' : '$') + t.text)
      walk(t.tokens)
      walk(t.items)
    }
  }
  walk(marked.lexer(md))
  return out
}

/** How many formulas KaTeX could not typeset. */
export const errors = (md) => rendered(md).querySelectorAll('.katex-error').length

suite('inline math')

test('a pair of dollars is a formula', () => {
  assert.deepEqual(formulas('a $x$ b'), ['$x'])
})

test('a formula may start with a digit', () => {
  assert.deepEqual(formulas('$2x+1$ and $1/2$'), ['$2x+1', '$1/2'])
})

test('spaces just inside the dollars are allowed, as in LaTeX', () => {
  assert.deepEqual(formulas('$ x $ and $a+b $'), ['$ x ', '$a+b '])
})

test('\\$ is a literal dollar', () => {
  assert.deepEqual(formulas('paid \\$5 and \\$10'), [])
  assert.equal(rendered('paid \\$5 and \\$10').textContent.trim(), 'paid $5 and $10')
})

test('\\$ inside a formula stays in it', () => {
  assert.deepEqual(formulas('$a\\$b$'), ['$a\\$b'])
})

test('a single $ with no partner is text', () => {
  assert.deepEqual(formulas('only one $ here'), [])
  assert.equal(rendered('only one $ here').textContent.trim(), 'only one $ here')
})

test('bare prices pair up as math, as in LaTeX: write \\$5', () => {
  assert.deepEqual(formulas('costs $5 and $10'), ['$5 and '])
})

test('dollars in code are not math', () => {
  assert.deepEqual(formulas('`$HOME` and `$PATH`'), [])
  assert.deepEqual(formulas('```\n$x$ and $$y$$\n```'), [])
})

test('$$…$$ within a line is display math in that line', () => {
  assert.deepEqual(formulas('text $$x^2$$ more'), ['$$x^2'])
  assert.deepEqual(blocks('text $$x^2$$ more'), ['p'])
  assert.ok(rendered('text $$x^2$$ more').querySelector('p .katex-display'), 'a display formula inside the paragraph')
})

suite('display math')

test('$$ on lines of its own is a display block', () => {
  assert.deepEqual(blocks('$$\nx\n$$'), ['math'])
  assert.deepEqual(formulas('$$\nx\n$$'), ['$$x'])
})

test('a formula written straight under a paragraph', () => {
  const md = 'text:\n$$\na = b\n$$\nmore'
  assert.deepEqual(blocks(md), ['p', 'math', 'p'])
})

test('a lone = inside it does not make the text above a heading', () => {
  const md = 'text:\n$$\n\\operatorname{div}(f)\n=\n\\sum_p p\n$$\nmore'
  assert.deepEqual(blocks(md), ['p', 'math', 'p'])
  assert.deepEqual(formulas(md), ['$$\\operatorname{div}(f)\n=\n\\sum_p p'])
  assert.equal(errors(md), 0, 'KaTeX errors')
})

test('a lone - inside it does not make a second-level heading', () => {
  assert.deepEqual(blocks('text\n$$\na\n-\nb\n$$\nmore'), ['p', 'math', 'p'])
})

test('text right after the closing $$ swallows nothing', () => {
  const md = '$$\n\\int_0^1 x\\,dx\n$$after\n\n## Heading\n\n- item\n\n$$\ny\n$$'
  assert.deepEqual(blocks(md), ['p', 'h2', 'ul', 'math'])
  assert.deepEqual(formulas(md), ['$$\n\\int_0^1 x\\,dx\n', '$$y'])
})

test('an unclosed $$ stops at the next blank line', () => {
  assert.deepEqual(blocks('$$\na\n\ntext'), ['p', 'p'])
  assert.deepEqual(formulas('$$\na\n\ntext'), [])
})

test('a single $ and \\$ may sit inside a display formula', () => {
  assert.deepEqual(formulas('$$\n\\text{costs $5$}\n$$'), ['$$\\text{costs $5$}'])
  assert.deepEqual(formulas('$$\na\\$b\n$$'), ['$$a\\$b'])
})

test('\\\\ line breaks survive in aligned', () => {
  const md = '$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$'
  assert.deepEqual(formulas(md), ['$$\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}'])
  assert.equal(errors(md), 0, 'KaTeX errors')
})

test('two formulas with text between them', () => {
  assert.deepEqual(blocks('$$\na\n$$\n\ntext\n\n$$\nb\n$$'), ['math', 'p', 'math'])
})

suite('headings')

test('setext headings still work', () => {
  assert.deepEqual(blocks('Title\n===\n\ntext'), ['h1', 'p'])
  assert.deepEqual(blocks('Sub\n---\n\ntext'), ['h2', 'p'])
})

test('a setext heading may hold inline math', () => {
  assert.deepEqual(blocks('Theorem on $x^2$\n===\n\ntext'), ['h1', 'p'])
  assert.deepEqual(formulas('Theorem on $x^2$\n==='), ['$x^2'])
})

suite('errors')

test('a formula KaTeX cannot parse is shown as an error', () => {
  assert.equal(errors('$\\frac{1}{$'), 1)
})

suite('sanitising')

test('event handlers are removed', () => {
  const img = rendered('<img src="x" onerror="alert(1)">').querySelector('img')
  assert.ok(img, 'the image itself stays')
  assert.equal(img.getAttribute('onerror'), null)
})

test('scripts are removed', () => {
  assert.equal(rendered('<script>alert(1)</script>\n\ntext').querySelector('script'), null)
})

test('javascript: links lose their href', () => {
  const a = rendered('[x](javascript:alert(1))').querySelector('a')
  assert.ok(!a || !/^javascript:/i.test(a.getAttribute('href') ?? ''), 'no javascript: href')
})

test('links to other sites open in a new tab, without an opener', () => {
  const a = rendered('[a](https://example.com)').querySelector('a')
  assert.equal(a.getAttribute('target'), '_blank')
  assert.ok(/noopener/.test(a.getAttribute('rel')), 'rel has noopener')
})

test('links within the page stay in the page', () => {
  assert.equal(rendered('[a](#section)').querySelector('a').getAttribute('target'), null)
})

test('KaTeX output keeps its MathML and SVG', () => {
  const el = rendered('$\\sqrt{x}$')
  assert.ok(el.querySelector('math'), 'MathML, for screen readers')
  assert.ok(el.querySelector('svg'), 'SVG, for the bar of the root')
})
