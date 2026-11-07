// The help page's sections are linked from the app, so their anchors are
// permanent (docs/ARCHITECTURE.md → Help). These tests find every link into
// help/ in the app's own files and check that its section exists, so a renamed
// anchor, or a link to an answer not yet written, fails here and not for a user.

import { helpUrl } from '../../src/help.js'
import { suite, test, assert } from './runner.js'

const text = async (path) => (await fetch(path, { cache: 'no-store' })).text()

/** Every section the app links to: helpUrl('…') in code, help/#… in pages. */
async function linkedSections() {
  const files = ['../../src/app.js', '../../src/settings.js', '../../editor/index.html', '../../index.html']
  const found = new Set()
  for (const file of files) {
    const source = await text(file)
    for (const m of source.matchAll(/helpUrl\(\s*'([\w-]+)'\s*\)/g)) found.add(m[1])
    for (const m of source.matchAll(/help\/#([\w-]+)/g)) found.add(m[1])
  }
  return [...found]
}

async function helpPage() {
  return new DOMParser().parseFromString(await text('../../help/'), 'text/html')
}

suite('help')

test('every section the app links to exists', async () => {
  const sections = await linkedSections()
  assert.ok(sections.length >= 2, `found the app's links (${sections.join(', ')})`)
  const page = await helpPage()
  for (const id of sections) assert.ok(page.getElementById(id), `help/#${id} exists`)
})

test("the page's own contents point at its sections", async () => {
  const page = await helpPage()
  for (const a of page.querySelectorAll('#toc a[href^="#"]')) {
    assert.ok(page.getElementById(a.getAttribute('href').slice(1)), `${a.getAttribute('href')} exists`)
  }
})

test('helpUrl points at help/, beside the editor', () => {
  assert.equal(helpUrl(), `${location.origin}/help/`)
  assert.equal(helpUrl('files'), `${location.origin}/help/#files`)
})
