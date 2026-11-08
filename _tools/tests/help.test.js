// Help (help/), a page per section: the FAQ, troubleshooting and so on. The app
// links to answers there, so their anchors are permanent (docs/ARCHITECTURE.md
// → Help). These tests find every link into help in the app's own files and
// check that its answer exists, so a renamed anchor, or a link to an answer not
// yet written, fails here and not for a user.

import { helpUrl } from '../../src/help.js'
import { openEditor } from './editor-harness.js'
import { suite, test, assert } from './runner.js'

const text = async (path) => (await fetch(path, { cache: 'no-store' })).text()
const page = async (path) => new DOMParser().parseFromString(await text(path), 'text/html')

const SECTIONS = ['faq', 'editor', 'presentations', 'troubleshooting']
const PAGES = ['', ...SECTIONS.map((s) => `${s}/`)].map((p) => `../../help/${p}`)

/** Every answer the app links to, as [section, anchor]: helpUrl('…', '…') in
 *  code, help/…/#… in pages, and ../…/#… from one help page to another. */
async function linkedAnswers() {
  const files = [
    '../../src/app.js', '../../src/settings.js', '../../src/presentations.js',
    '../../editor/index.html', '../../index.html', '../../presentations/index.html',
    ...PAGES,
  ]
  const found = new Map()
  const add = (section, id) => found.set(`${section}/#${id}`, [section, id])
  for (const file of files) {
    const source = await text(file)
    for (const m of source.matchAll(/helpUrl\(\s*'([\w-]+)'\s*,\s*'([\w-]+)'\s*\)/g)) add(m[1], m[2])
    for (const m of source.matchAll(/(?:help\/|\.\.\/)([\w-]+)\/#([\w-]+)/g)) add(m[1], m[2])
  }
  return [...found.values()]
}

suite('help')

test('every answer the app links to exists', async () => {
  const answers = await linkedAnswers()
  const sections = new Set(answers.map(([section]) => section))
  assert.ok(sections.has('faq') && sections.has('troubleshooting'),
    `found the app's links (${answers.map((a) => a.join('/#')).join(', ')})`)
  for (const [section, id] of answers) {
    assert.ok(SECTIONS.includes(section), `help/${section}/ is a section`)
    assert.ok((await page(`../../help/${section}/`)).getElementById(id), `help/${section}/#${id} exists`)
  }
})

// The front page, presentations and help share one layout (landing.css → the
// page): a column with the logo and the page's contents beside the page.
const LAID_OUT = ['../../', '../../presentations/', ...PAGES]

test('every page has the logo and its contents beside it, each entry leading somewhere', async () => {
  for (const path of LAID_OUT) {
    const doc = await page(path)
    assert.ok(doc.body.classList.contains('paged') && doc.querySelector('.layout > main'), `${path}: the layout`)
    const home = doc.querySelector('.layout > aside.side > .masthead a.home')
    assert.equal(home && new URL(home.getAttribute('href'), new URL(path, location.href)).pathname, '/',
      `${path}: the logo, leading to the front page`)
    assert.ok(doc.querySelector('.side > nav#toc .toc-title'), `${path}: the contents`)
    assert.ok([...doc.scripts].some((s) => s.getAttribute('src')?.endsWith('src/toc.js')), `${path}: their script`)
    for (const a of doc.querySelectorAll('#toc a[href^="#"]')) {
      assert.ok(doc.getElementById(a.getAttribute('href').slice(1)), `${path}${a.getAttribute('href')} exists`)
    }
  }
})

test('the guide and presentations lead to the rest of the site, then to their own parts', async () => {
  const TOOLS = ['/editor/', '/presentations/']
  const expected = [
    ['../../presentations/', ['Go to'], ['/editor/', '/help/']], // its own parts: none yet
    ['../../help/', ['Go to', 'Guide'], TOOLS],
    ['../../help/faq/', ['Go to', 'Other guides', 'FAQ'], TOOLS],
    ['../../help/editor/', ['Go to', 'Other guides', 'Editing'], TOOLS],
    ['../../help/presentations/', ['Go to', 'Other guides', 'Presenting'], TOOLS],
    ['../../help/troubleshooting/', ['Go to', 'Other guides', 'Troubleshooting'], TOOLS],
  ]
  for (const [path, titles, targets] of expected) {
    const doc = await page(path)
    assert.deepEqual([...doc.querySelectorAll('#toc .toc-title')].map((t) => t.textContent), titles, `${path}: its groups`)
    const links = [...doc.querySelectorAll('#toc .toc-title + ul')][0].querySelectorAll('a')
    assert.deepEqual([...links].map((a) => new URL(a.getAttribute('href'), new URL(path, location.href)).pathname), targets, path)
  }
})

test("the front page's column: the tools, then its contents, privacy among them", async () => {
  const doc = await page('../../')
  assert.deepEqual([...doc.querySelectorAll('#toc .toc-title')].map((t) => t.textContent), ['Jump in', 'Welcome'])
  const [tools, contents] = doc.querySelectorAll('#toc .toc-title + ul')
  const targets = (list) => [...list.querySelectorAll('a')].map((a) => new URL(a.getAttribute('href'), new URL('../../', location.href)).href)
  assert.deepEqual(targets(tools), ['editor/', 'presentations/', 'help/'].map((p) => `${location.origin}/${p}`))
  assert.deepEqual([...contents.querySelectorAll('a')].map((a) => a.getAttribute('href')), ['#what', '#questions', '#privacy'])
  assert.ok(doc.querySelector('footer#privacy a[href="privacy.html"]'), 'the privacy policy, on the line about privacy')
  assert.ok(doc.querySelector('#questions > p.note a[href="help/"]'), 'help, in the lead-in after the questions')
  assert.ok(doc.querySelector('.hero .cta-more a[href="help/"]'), 'and in a sentence under the buttons')
})

test('helpUrl points into help/', () => {
  assert.equal(helpUrl('faq'), `${location.origin}/help/faq/`)
  assert.equal(helpUrl('troubleshooting', 'storage-blocked'),
    `${location.origin}/help/troubleshooting/#storage-blocked`)
})

test('the help page leads to each section, and each leads back', async () => {
  const home = await page('../../help/')
  const links = [...home.querySelectorAll('main > section > h2 a')].map((a) => a.getAttribute('href'))
  assert.deepEqual(links, SECTIONS.map((s) => `${s}/`), 'the sections, in order')
  for (const s of SECTIONS) {
    const back = (await page(`../../help/${s}/`)).querySelector('.crumbs a')
    assert.equal(back?.getAttribute('href'), '../', `help/${s}/ links back`)
  }
})

test("the guide's sections are one click away: from the guide's column, and from each other's", async () => {
  const pathsOf = (doc, path, title) => {
    const group = [...doc.querySelectorAll('#toc .toc-title')].find((t) => t.textContent === title)
    return [...group.nextElementSibling.querySelectorAll('a')].map((a) => new URL(a.getAttribute('href'), new URL(path, location.href)).pathname)
  }
  const all = SECTIONS.map((s) => `/help/${s}/`)
  assert.deepEqual(pathsOf(await page('../../help/'), '../../help/', 'Guide'), all, 'the guide: each section, not a part of its page')
  for (const s of SECTIONS) {
    const path = `../../help/${s}/`
    assert.deepEqual(pathsOf(await page(path), path, 'Other guides'), all.filter((p) => p !== `/help/${s}/`), `help/${s}/`)
  }
})

const words = (el) => el.textContent.replace(/\s+/g, ' ').trim()

test("the guide lists every answer of every section, worded as the section's page words it", async () => {
  const home = await page('../../help/')
  for (const block of home.querySelectorAll('main > section')) {
    const href = block.querySelector('h2 a').getAttribute('href')
    const doc = await page(`../../help/${href}`)
    const listed = [...block.querySelectorAll('li')].map((li) => [li.querySelector('a')?.getAttribute('href') ?? null, words(li)])
    const coming = doc.querySelector('main section#coming')
    // A written page: each answer by its anchor and its heading, the first one's
    // anchor being the page's. A placeholder: what it will answer, unlinked.
    const expected = coming
      ? [...coming.querySelectorAll('li')].map((li) => [null, words(li)])
      : [...doc.querySelectorAll('main > section')].map((s) => [`${href}#${s.id || doc.querySelector('main').id}`, words(s.querySelector('h2'))])
    assert.deepEqual(listed, expected, `help/${href}`)
  }
})

test("the site's name in running text is set as a name", async () => {
  let marked = 0
  for (const path of PAGES) {
    const doc = await page(path)
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
    for (let node; (node = walker.nextNode());) {
      if (!/lemma-md(?![\w-]|\.\w)/.test(node.data)) continue  // not lemma-md.github.io
      const el = node.parentElement
      if (el.closest('.masthead, .lit, code, script, style')) continue
      assert.ok(el.matches('.brand') && node.data === 'lemma-md',
        `${path}: “${node.data.trim().slice(0, 60)}” marks the name`)
      marked++
    }
  }
  assert.ok(marked > 10, `found the name in the text (${marked} times)`)
})

/** The page laid out in a frame of its own, `width` by `height` pixels. */
async function atWidth(path, width, height = 600) {
  const frame = document.createElement('iframe')
  frame.style.cssText = `position: absolute; left: -10000px; width: ${width}px; height: ${height}px; border: 0`
  frame.src = path
  await new Promise((resolve) => { frame.onload = resolve; document.body.append(frame) })
  await frame.contentDocument.fonts.ready
  return frame
}

test('on a phone, an address in the text stays whole, and none runs off the page', async () => {
  const frame = await atWidth('../../help/troubleshooting/', 320)
  try {
    const doc = frame.contentDocument
    const lits = [...doc.querySelectorAll('.lit')]
    const domain = lits.find((l) => l.textContent === 'lemma-md.github.io')
    assert.equal(domain.getClientRects().length, 1, 'lemma-md.github.io is not split at its hyphen')
    const edge = doc.querySelector('main').getBoundingClientRect().right
    for (const l of lits) assert.ok(l.getBoundingClientRect().right <= edge + 1, `${l.textContent} fits`)
  } finally {
    frame.remove()
  }
})

test('on a phone, the contents open below a bar that keeps the logo', async () => {
  const frame = await atWidth('../../help/faq/', 400)
  try {
    const doc = frame.contentDocument
    const style = (el) => frame.contentWindow.getComputedStyle(el)
    const toc = doc.getElementById('toc')
    assert.equal(style(toc).display, 'none', 'folded away')
    doc.querySelector('.toc-toggle').click()
    assert.ok(style(toc).display !== 'none', 'open')
    const logo = doc.querySelector('.masthead .home img').getBoundingClientRect()
    assert.ok(doc.elementFromPoint(logo.x + logo.width / 2, logo.y + logo.height / 2)?.closest('a.home'),
      'the logo is above the shade')
    const bar = doc.querySelector('.masthead').getBoundingClientRect()
    assert.ok(toc.querySelector('a').getBoundingClientRect().top >= bar.bottom, 'the contents hang below the bar')
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    assert.equal(style(toc).display, 'none', 'Escape folds them away')
  } finally {
    frame.remove()
  }
})

test('an entry chosen in the contents stays marked, even where its jump ends at the bottom', async () => {
  const frame = await atWidth('../../', 1200, 600)
  try {
    const doc = frame.contentDocument
    const win = frame.contentWindow
    doc.querySelector('#toc a[href="#questions"]').click()
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.ok(win.innerHeight + win.scrollY >= doc.documentElement.scrollHeight - 2, 'the jump ends at the bottom')
    assert.equal(doc.querySelector('#toc a[aria-current]')?.textContent, 'Questions')
    doc.querySelector('#toc a[href="#privacy"]').click()
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(doc.querySelector('#toc a[aria-current]')?.textContent, 'Privacy', 'and the next one chosen')
  } finally {
    frame.remove()
  }
})

test("a page's first answer sits at its top, title included", async () => {
  for (const [section, id] of [['faq', 'markdown'], ['troubleshooting', 'storage-blocked']]) {
    const doc = await page(`../../help/${section}/`)
    assert.equal(doc.getElementById(id)?.tagName, 'MAIN', `help/${section}/#${id} is the page, not its section`)
    assert.ok(doc.querySelector(`main#${id} .hero h1`), `help/${section}/: the title is inside it`)
  }
})

test("the editor's Help opens the help page", async () => {
  const ed = await openEditor()
  try {
    ed.$('#btn-help').click()
    assert.deepEqual(ed.win.opened.pop(), { url: `${location.origin}/help/`, target: 'lemma-help' })
  } finally {
    await ed.close()
  }
})
