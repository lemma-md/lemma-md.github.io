// The editor's preview brought up to date part by part (src/preview.js): it
// must show exactly what render() shows, line map included, whatever the note
// holds and however it got there, while an edit leaves the nodes of the
// blocks it did not touch where they were. Crooked HTML is where showing a
// note in parts can go wrong: an element left open in one part takes in the
// parts after it when the note is shown whole.

import { render } from '../../src/viewer.js'
import { showNote, patchChildren } from '../../src/preview.js'
import { suite, test, assert, AssertionError } from './runner.js'

// A formula's placeholder carries a key fresh for each render and the
// formula's number in it. It shows only where HTML left open takes the markup
// after it for text, as a <textarea> does; then the key differs every time,
// and the number counts from the part rather than the note. Neither is
// compared.
const sameKeys = (html) => html.replace(/data-formula="\d+-\d+"/g, 'data-formula="KEY"')

/** What render() makes of `md`, as the browser holds it. */
function expected(md) {
  const div = document.createElement('div')
  div.innerHTML = render(md, { lines: 0 })
  return sameKeys(div.innerHTML)
}

/** Show `md` in `root`, and fail unless that is what render() makes of it; the
 *  message gives the note and where the two part. */
function shows(root, md, what = '') {
  showNote(root, md)
  const want = expected(md)
  const got = sameKeys(root.innerHTML)
  if (got === want) return
  let i = 0
  while (got[i] === want[i]) i++
  const near = (s) => JSON.stringify(s.slice(Math.max(0, i - 60), i + 100))
  throw new AssertionError(`${what ? `${what}: ` : ''}the note ${JSON.stringify(md)} shows differently from render(), at ${i}:\n  render() …${near(want)}\n  preview  …${near(got)}`)
}

/** Children put in and taken out of `parent` while `change` runs. */
function moves(parent, change) {
  const observer = new MutationObserver(() => {})
  observer.observe(parent, { childList: true })
  change()
  let added = 0
  let removed = 0
  for (const r of observer.takeRecords()) {
    added += r.addedNodes.length
    removed += r.removedNodes.length
  }
  observer.disconnect()
  return { added, removed }
}

suite('preview: as render() shows it')

const NOTES = {
  'blocks of every kind': [
    '# Title', '', 'A paragraph', 'over two lines, with $x^2$ and **bold**.', '',
    '$$', '\\int_0^1 f', '$$', '- one', '- two', '', '```', 'code <b>', '```', '',
    '<!-- a comment -->', '', '| a | b |', '|---|---|', '| $1$ | <i>2</i> |', '',
    '> quoted', '> lines', '', '1. first', '', '2. loose', '', 'Last', '===', '', '---', '', 'end',
  ].join('\n'),
  'Markdown inside <details>': '<details>\n<summary>More</summary>\n\nHidden *text*, $y$.\n\n- a list\n\n</details>\n\nAfter.',
  'a <div> never closed, which takes the rest': 'Before.\n\n<div>\n\nInside.\n\n# Heading\n\nStill inside.',
  'a comment never closed': 'Before.\n\n<!-- open\n\nhidden\n\nhidden too',
  'an inline tag left open': 'One <b>bold\n\nTwo, still bold?\n\nThree.',
  'reference links': '[a link][ref] and [another][].\n\nText.\n\n[ref]: https://example.com "Title"\n[another]: https://example.org',
  'a paragraph written twice': 'Same.\n\nOther.\n\nSame.\n\n$$x$$\n\nSame.',
  'no newline at the end': 'One.\n\nTwo',
  'empty': '',
  'only blank lines': '\n\n\n',
  'formulas mid-line and as blocks': 'Text $$a+b$$ text.\n\n$$\na\n$$\ntext right after\n\n$a$, $b$',
  'a task list and nested lists': '- [x] done\n- [ ] to do\n  - nested\n    1. deeper\n\n* other\n+ marks',
  'Windows line ends': 'One.\r\n\r\nTwo, $x$.\r\n\r\n- a\r\n- b\r\n',
}

for (const [name, md] of Object.entries(NOTES)) {
  test(`shows ${name}`, () => shows(document.createElement('div'), md))
}

suite('preview: crooked HTML, as render() shows it')

// HTML as people write it, or half-write it while typing. The browser's HTML
// parser decides what each of these means: often that an element runs on into
// the blocks after it.
const CROOKED = {
  'a <div/>, as if it closed itself': 'Before.\n\n<div/>\n\nInside, since HTML ignores the slash.\n\nStill inside.',
  'a closing tag for an element never opened': '<div>\n\nText </span>\n\nmore, still in the div.\n\n</div>\n\nOut.',
  'stray closing tags, nothing open': '</div>\n\nText.\n\n</p>\n\nMore </b> text.\n\n</br>',
  'a <b> alone on its line, never closed': '<b>\n\nBold?\n\nStill bold?',
  'an inline <a> never closed': 'A <a href="https://example.com">link\n\nthat goes on.\n\nAnd on.',
  'an inline <b> closed in a later paragraph': 'One <b>bold\n\nTwo.\n\nThree</b> and plain.\n\nFour.',
  '<b> and <i> misnested': 'Some <b>bold <i>both</b> italic</i> text.\n\nAfter.',
  '<b> and <i> misnested, never closed': 'Some <b>bold <i>both</b> italic\n\nAfter.\n\nLast.',
  'a <p> written as HTML, never closed': '<p>An HTML paragraph\n\nA Markdown one.\n\n<span>inline</span>',
  'end tags left out where HTML allows': '<ul>\n<li>one\n<li>two\n</ul>\n\nAfter the list.\n\n<dl><dt>term<dd>definition</dl>\n\nEnd.',
  'a <table> never closed': '<table>\n<tr><td>cell\n\nMarkdown after.\n\n- a list',
  'a <table> closed later, with Markdown inside': '<table><tr><td>\n\n**bold** in a cell\n\n</td></tr></table>\n\nAfter.',
  'a <table> holding a stray <div> close': '<div>\n\n<table><tr><td>\n\n</div>\n\n</td></tr></table>\n\nStill in the div?',
  'table parts with no table': '<tr><td>a cell alone</td></tr>\n\n<td>\n\nText.',
  '<details> never closed': '<details>\n<summary>More</summary>\n\nHidden.\n\nAlso hidden?',
  '<details> inside <details>': '<details><summary>Outer</summary>\n\n<details><summary>Inner</summary>\n\nDeep.\n\n</details>\n\nOuter text.\n\n</details>\n\nOutside.',
  'SVG with elements that close themselves': '<svg width="20" height="20"><circle cx="10" cy="10" r="5"/><rect x="1" y="1" width="2" height="2"/></svg>\n\nAfter the picture.\n\nMore.',
  'SVG never closed': '<svg width="20" height="20"><circle cx="10" cy="10" r="5"/>\n\nText after.\n\nMore.',
  'HTML inside SVG': '<svg><foreignObject><div>\n\nText.\n\n</svg>\n\nAfter.',
  'MathML written by hand, closed and not': 'Inline <math><mi>x</mi><mo>+</mo><mn>1</mn></math> math.\n\n<math><mi>y</mi>\n\nNever closed.',
  'comments of odd shapes': '<!---->\n\nA.\n\n<!-->\n\nB.\n\n<!--->\n\nC.\n\n<!-- a <div> in a comment -->\n\nD.\n\n<!-- -- -->\n\nE.',
  'a comment opened mid-line, closed later': 'Text <!-- open\n\nhidden?\n\n-->\n\nshown.',
  'a tag inside an attribute': '<span title="<div>">x</span> and <span title=\'</div>\'>y</span>\n\nAfter.',
  'an attribute never closed': '<span title="open>x\n\nNext.\n\nLast.',
  'a tag never finished': 'Text <div\n\nNext.\n\n<span class="a"\n\nLast.',
  'tags in capitals': '<DIV>\n\nInside.\n\n</div>\n\nOutside.\n\n<B>bold</B>',
  'tags in code, which are text': '`<div>` in code\n\n```html\n<div>\n<b>\n```\n\n    <table> indented\n\nAfter.',
  'a <pre> with blank lines inside': '<pre>\nline one\n\nline three, after a blank\n</pre>\n\nAfter.',
  'elements the sanitiser removes, never closed': '<style>\n\np { color: red }\n\nText.\n\n<textarea>\n\nmore\n\n<select><option>x\n\nEnd.',
  '<script>, <iframe> and <form>': '<script>\nalert(1)\n</script>\n\nText.\n\n<iframe src="https://example.com">\n\nAfter.\n\n<form>\n\nIn a form?',
  '<plaintext> and <xmp>': 'Before.\n\n<xmp><b>text</xmp>\n\nMiddle.\n\n<plaintext>\n\nAll text now?',
  'a <div> opened in a quote': '> <div>\n> quoted\n\nafter\n\n</div>\n\nend',
  'a <div> opened in a list item': '- <div>\n- item two\n\nAfter the list.\n\n</div>\n\nOut.',
  'a <b> left open in a table cell': '| a | b |\n|---|---|\n| <b>bold | x |\n\nAfter the table.',
  'formulas inside a <div> never closed': '<div>\n\n$$\nx^2\n$$\n\nText $y$.\n\n# A heading',
  'what the preview splits by, written in the note': '<hr data-run="1">\n\n<!---->A\n\n<lemma-probe></lemma-probe>\n\n<span data-formula="0-0"></span>\n\nEnd.',
  'HTML around a setext heading': '<div>\nText\n===\n\nMore\n---\n</div>\n\nAfter.',
  'void elements written with an end tag': 'A<br></br>B\n\n<img src="x.png"></img>\n\n<hr></hr>\n\nAfter.',
  'a <button> and an <a> inside an <a>': '<a href="#a">one <a href="#b">two</a> three\n\n<button>press\n\nAfter.',
  '<template> and <noscript>': '<template>\n\nIn a template.\n\n</template>\n\n<noscript>\n\nNo script.\n\nAfter.',
  'a <textarea> left open, which takes the markup after it for text, line numbers too':
    'A.\n\nB, with $x^2$.\n <textarea>\n- one\n- two $y$\n\nC.',
}

for (const [name, md] of Object.entries(CROOKED)) {
  test(`shows ${name}`, () => shows(document.createElement('div'), md))
}

suite('preview: edits one after another, as render() shows them')

/** States `md` passes through while `text` is typed at `at`, one key at a time. */
function typing(md, at, text) {
  return [...text].map((_, i) => md.slice(0, at) + text.slice(0, i + 1) + md.slice(at))
}

const SEQUENCES = {
  'a <div> opened, written in, closed, then its close taken away': [
    'A.\n\nB.\n\nC.',
    'A.\n\n<div>\n\nB.\n\nC.',
    'A.\n\n<div>\n\nB, edited.\n\nC.',
    'A.\n\n<div>\n\nB, edited.\n\n</div>\n\nC.',
    'A.\n\n<div>\n\nB, edited.\n\n</div>\n\nC, edited.',
    'A.\n\n<div>\n\nB, edited.\n\nC, edited.',
    'A.\n\nB, edited.\n\nC, edited.',
  ],
  'text written after a tag left open at the end': [
    'A.\n\n<div>',
    'A.\n\n<div>\n\nB',
    'A.\n\n<div>\n\nB.\n\nC',
    'A.\n\n<div/>\n\nB.\n\nC',
    'A.\n\n<div></div>\n\nB.\n\nC',
  ],
  'a <details> typed around two paragraphs, a key at a time': [
    ...typing('A.\n\nB.\n\nC.', 0, '<details><summary>S</summary>\n\n'),
    ...typing('<details><summary>S</summary>\n\nA.\n\nB.\n\nC.', 38, '\n\n</details>'),
  ],
  'a comment opened and closed, a key at a time': [
    ...typing('A.\n\nB.\n\nC.\n\nD.', 3, '<!--\n\n'),
    ...typing('A.\n\n<!--\n\nB.\n\nC.\n\nD.', 18, '-->\n\n'),
  ],
  'a <b> opened in one paragraph and closed in another': [
    'One.\n\nTwo.\n\nThree.\n\nFour.',
    'One <b>.\n\nTwo.\n\nThree.\n\nFour.',
    'One <b>.\n\nTwo, edited.\n\nThree.\n\nFour.',
    'One <b>.\n\nTwo, edited.\n\nThree</b>.\n\nFour.',
    'One <b>.\n\nTwo, edited.\n\nThree</b>.\n\nFour, edited.',
    'One.\n\nTwo, edited.\n\nThree</b>.\n\nFour, edited.',
  ],
  'a table opened above Markdown, then closed': [
    'A.\n\n- one\n- two\n\nB.',
    'A.\n\n<table><tr><td>\n\n- one\n- two\n\nB.',
    'A.\n\n<table><tr><td>\n\n- one\n- two\n\n</td></tr></table>\n\nB.',
    'A.\n\n<table><tr><td>\n\n- one\n- two, edited\n\n</td></tr></table>\n\nB.',
  ],
  'a closing tag for an element never opened, typed and taken away': [
    '<div>\n\nText.\n\nMore.\n\n</div>\n\nOut.',
    '<div>\n\nText </span>.\n\nMore.\n\n</div>\n\nOut.',
    '<div>\n\nText </span>.\n\nMore, edited.\n\n</div>\n\nOut.',
    '<div>\n\nText.\n\nMore, edited.\n\n</div>\n\nOut.',
  ],
  'a reference link defined, used, changed and taken away': [
    '[a][r]\n\nText.',
    '[a][r]\n\nText.\n\n[r]: https://example.com',
    '[a][r] and [r]\n\nText.\n\n[r]: https://example.com',
    '[a][r] and [r]\n\nText.\n\n[r]: https://example.org',
    '[a][r] and [r]\n\nText.',
  ],
  'a code fence opened and closed': [
    'A.\n\n<div>\n\nB.\n\nC.',
    'A.\n\n```\n<div>\n\nB.\n\nC.',
    'A.\n\n```\n<div>\n```\n\nB.\n\nC.',
  ],
  'lines put in above a <textarea> that takes the markup after it for text': [
    'A.\n\nB <textarea>\n- one\n- two\n\nC.',
    'New.\n\nA.\n\nB <textarea>\n- one\n- two\n\nC.',
    'New,\nover two lines.\n\nA.\n\nB <textarea>\n- one\n- two\n\nC.',
    'A.\n\nB <textarea>\n- one\n- two\n\nC.',
  ],
  'lines put in above a quote never closed in an attribute': [
    'A.\n\n<span title="open\n\nB.\n\nC.',
    'New.\n\nA.\n\n<span title="open\n\nB.\n\nC.',
  ],
  'blocks moved, copied and deleted': [
    'One.\n\nTwo.\n\nThree.\n\nFour.',
    'One.\n\nThree.\n\nTwo.\n\nFour.',
    'One.\n\nThree.\n\nTwo.\n\nFour.\n\nThree.\n\nTwo.',
    'Three.\n\nTwo.\n\nFour.\n\nThree.',
    '',
    'One.',
  ],
}

for (const [name, states] of Object.entries(SEQUENCES)) {
  test(`shows ${name}`, () => {
    const root = document.createElement('div')
    states.forEach((md, i) => shows(root, md, `step ${i + 1} of ${states.length}`))
  })
}

suite('preview: random edits, as render() shows them')

/** A seeded random number generator (mulberry32): the same edits every run. */
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PIECES = [
  '<div>', '</div>', '<div/>', '<b>', '</b>', '<i>', '</span>', '<!--', '-->', '<details>', '</details>',
  '<summary>S</summary>', '<table>', '<tr><td>', '</table>', '<p>', '<svg>', '<circle r="1"/>', '</svg>',
  '<math><mi>x</mi>', '<a href="https://example.com">', '<br>', '$$', '$x$', '```', '- item', '> quote',
  '# Heading', '===', 'text **bold**', '[link][r]', '[r]: https://example.com', '| a | b |\n|---|---|\n| 1 | 2 |',
  '', 'plain text', 'more plain text', '1. first',
]

for (const seed of [1, 2, 3, 4, 5]) {
  test(`random edits, run ${seed}: insertions, deletions and copies of lines and tags`, () => {
    const next = random(seed)
    const pick = (list) => list[Math.floor(next() * list.length)]
    const root = document.createElement('div')
    let lines = ['A paragraph.', '', 'Another, with $x^2$.', '', '- one', '- two', '', 'End.']
    for (let step = 1; step <= 60; step++) {
      const at = Math.floor(next() * (lines.length + 1))
      const kind = next()
      if (kind < 0.45) lines.splice(at, 0, pick(PIECES))
      else if (kind < 0.65 && lines[at] != null) lines[at] = lines[at] + ' ' + pick(PIECES)
      else if (kind < 0.85 && lines.length) lines.splice(Math.min(at, lines.length - 1), 1)
      else if (lines.length) lines.splice(at, 0, lines[Math.floor(next() * lines.length)])
      if (lines.length > 50) lines = lines.slice(-40)
      shows(root, lines.join('\n'), `seed ${seed}, step ${step}`)
    }
  })
}

suite('preview: what an edit leaves in place')

test('an edit renders the blocks it changed and keeps the others', () => {
  // Markdown alone: a block with HTML in it is kept only where it stood (below).
  const md = [
    '# Title', '', 'A paragraph', 'over two lines, with $x^2$ and **bold**.', '',
    '$$', '\\int_0^1 f', '$$', '- one', '- two', '', '```', 'code', '```', '',
    '| a | b |', '|---|---|', '| $1$ | 2 |', '', '> quoted', '', '1. first', '', '2. loose', '',
    'Last', '===', '', '---', '', '[a][ref]', '', '[ref]: https://example.com', '', 'end',
  ].join('\n')
  const root = document.createElement('div')
  shows(root, md)
  const before = [...root.children]
  const edited = md.replace('A paragraph', 'A longer paragraph\n\nsplit in two')
  const { added, removed } = moves(root, () => shows(root, edited))
  const fresh = [...root.children].filter((el) => !before.includes(el))
  assert.equal(fresh.length, 2, 'two new blocks')
  assert.equal(fresh[0].textContent, 'A longer paragraph')
  assert.ok(fresh[1].textContent.startsWith('split in two'), 'and the rest of the paragraph')
  // Each block is its element and the newline after it.
  assert.deepEqual([added, removed], [4, 2], 'two blocks put in, one taken out')
})

test('a paragraph written several times: an edit above one leaves every block after it in place', () => {
  const md = ['Same.', 'A.', 'Same.', 'B.', 'Same.', 'C.', 'Same.'].join('\n\n')
  const root = document.createElement('div')
  shows(root, md)
  const before = [...root.children]
  const { added, removed } = moves(root, () => shows(root, md.replace('B.', 'Bee.')))
  assert.deepEqual([...root.children].map((el, i) => el === before[i]), [true, true, true, false, true, true, true])
  assert.deepEqual([added, removed], [2, 2], 'one block put in, one taken out')
})

test('a hundred paragraphs alike: an edit in the middle changes one', () => {
  const md = (middle) => [...Array(50).fill('Same.'), middle, ...Array(50).fill('Same.')].join('\n\n')
  const root = document.createElement('div')
  shows(root, md('X.'))
  const before = [...root.children]
  const { added, removed } = moves(root, () => shows(root, md('Y.')))
  assert.equal([...root.children].filter((el, i) => el !== before[i]).length, 1, 'one block new')
  assert.deepEqual([added, removed], [2, 2])
})

test('a block with HTML in it is kept when moved, unless its HTML took the markup after it for text', () => {
  const md = 'A.\n\n<details><summary>S</summary>\n\nB.\n\n</details>\n\n<!-- a comment -->\n\nC <textarea>\n- one\n\nD.'
  const root = document.createElement('div')
  shows(root, md)
  // The comment leaves the <div> that carries its line, empty.
  const [a, details, comment, swallowing] = root.children
  assert.ok(swallowing.textContent.includes('data-line'), 'the <textarea> shows the markup after it, line numbers too')
  shows(root, 'New.\n\n' + md)
  assert.ok(root.children[1] === a && root.children[2] === details && root.children[3] === comment, 'Markdown, a <details> and a comment, moved down, are kept')
  assert.ok(root.children[4] !== swallowing, 'the block that shows line numbers is new')
  shows(root, 'New.\n\n' + md.replace('D.', 'D, edited.'))
  assert.ok(root.children[2] === details, 'still kept')
})

test('HTML that writes a data-line of its own is kept only on its line, and its data-line as written', () => {
  const md = 'A.\n\n<div data-line="7">mine</div>\n\n<span data-line=-->"3">\n\nB.'
  const root = document.createElement('div')
  shows(root, md)
  const div = root.children[1]
  shows(root, md.replace('A.', 'A, edited.'))
  assert.ok(root.children[1] === div, 'kept on its line')
  shows(root, 'New.\n\n' + md)
  shows(root, 'New.\n\n' + md.replace('B.', 'B, edited.'))
})

test('a block moved elsewhere keeps its nodes', () => {
  const root = document.createElement('div')
  shows(root, 'One.\n\nTwo.\n\nThree.\n\nFour.')
  const before = new Set(root.children)
  shows(root, 'One.\n\nThree.\n\nFour.\n\nTwo.')
  assert.ok([...root.children].every((el) => before.has(el)), 'no block rendered again')
})

test('blocks after a <div> that closes are kept; inside it, the whole <div> is rendered again', () => {
  const md = (inside, after) => `A.\n\n<div>\n\n${inside}\n\n</div>\n\n${after}\n\nZ.`
  const root = document.createElement('div')
  shows(root, md('B.', 'C.'))
  const [a, div, c, z] = root.children
  assert.equal(root.children.length, 4, 'A, the <div>, C and Z')
  shows(root, md('B.', 'C, edited.'))
  assert.deepEqual([...root.children].map((el) => el === a || el === div || el === z), [true, true, false, true], 'below the <div>, C alone is new')
  shows(root, md('B, edited.', 'C, edited.'))
  assert.ok(root.children[1] !== div, 'the <div> is new')
  assert.ok(root.children[0] === a && root.children[3] === z, 'A and Z are not')
  assert.equal(c.isConnected, false)
})

test('a <div> left open: an edit after it renders the <div> again, with all it took in', () => {
  const root = document.createElement('div')
  shows(root, 'A.\n\n<div>\n\nB.\n\nC.')
  const a = root.children[0]
  shows(root, 'A.\n\n<div>\n\nB.\n\nC, edited.')
  assert.equal(root.children.length, 2, 'A and the <div>')
  assert.ok(root.children[0] === a, 'A is kept')
  assert.equal(root.children[1].children.length, 2, 'the <div> holds B and C')
})

test('patchChildren takes out and puts in only what changed', () => {
  const parent = document.createElement('div')
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((t) => Object.assign(document.createElement('p'), { textContent: t }))
  parent.append(a, b, c)
  const text = () => parent.textContent
  assert.deepEqual(moves(parent, () => patchChildren(parent, [a, d, c])), { added: 1, removed: 1 }, 'one replaced')
  assert.equal(text(), 'adc')
  assert.deepEqual(moves(parent, () => patchChildren(parent, [a, c])), { added: 0, removed: 1 }, 'one taken out')
  assert.deepEqual(moves(parent, () => patchChildren(parent, [a, b, c])), { added: 1, removed: 0 }, 'one put in')
  assert.deepEqual(moves(parent, () => patchChildren(parent, [d, a, b, c])), { added: 1, removed: 0 }, 'one put in first')
  assert.deepEqual(moves(parent, () => patchChildren(parent, [d, a, b, c])), { added: 0, removed: 0 }, 'nothing, when nothing changed')
  patchChildren(parent, [c, a, b])
  assert.equal(text(), 'cab', 'moved')
  const t = document.createTextNode('t')
  patchChildren(parent, [t, c, a, b, d])
  assert.equal(text(), 'tcabd', 'text nodes too')
  patchChildren(parent, [])
  assert.equal(parent.childNodes.length, 0, 'emptied')
})
