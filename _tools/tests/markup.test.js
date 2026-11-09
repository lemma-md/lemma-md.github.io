// The editor toolbar's Markdown (src/markup.js), as edits of the text: what a
// press does, and that a second one takes it away. The buttons themselves,
// in the editor, are in editor.test.js.
//
// A case is written with the selection in it: «…» round what is selected, or
// ‸ where the cursor is, before the press and after it.

import * as markup from '../../src/markup.js'
import { suite, test, assert } from './runner.js'

function parse(s) {
  const caret = s.indexOf('‸')
  if (caret >= 0) return { text: s.replace('‸', ''), start: caret, end: caret }
  const start = s.indexOf('«')
  return { text: s.replace('«', '').replace('»', ''), start, end: s.indexOf('»') - 1 }
}

const show = (text, start, end) =>
  start === end ? `${text.slice(0, start)}‸${text.slice(start)}` : `${text.slice(0, start)}«${text.slice(start, end)}»${text.slice(end)}`

/** Press the buttons named, one after another, on `before`; or apply the commands given. */
function press(before, ...commands) {
  let { text, start, end } = parse(before)
  for (const command of commands) {
    const e = (typeof command === 'string' ? markup[command] : command)(text, start, end)
    text = text.slice(0, e.from) + e.insert + text.slice(e.to)
    ;({ start, end } = e)
  }
  return show(text, start, end)
}

/** Each press of `name` in turn leaves the next of `states`. */
function steps(name, ...states) {
  for (let i = 1; i < states.length; i++) assert.equal(press(states[i - 1], name), states[i], `${name} on ${JSON.stringify(states[i - 1])}`)
}

suite('toolbar: bold and italic')

test('bold goes round the selection, and comes off it again', () => {
  steps('bold', '«word»', '**«word»**', '«word»')
  steps('italic', '«word»', '*«word»*', '«word»')
  // With nothing selected, the cursor waits between the marks.
  steps('bold', 'a ‸', 'a **‸**', 'a ‸')
  steps('italic', 'a ‸', 'a *‸*', 'a ‸')
})

test('with nothing selected, bold and italic take the word the cursor is in', () => {
  steps('bold', 'a wo‸rd here', 'a **wo‸rd** here', 'a wo‸rd here')
  steps('italic', 'a wo‸rd here', 'a *wo‸rd* here', 'a wo‸rd here')
  // Next to a word is in it; the cursor stays on its side of the marks.
  assert.equal(press('a word‸ here', 'bold'), 'a **word**‸ here')
  assert.equal(press('a ‸word here', 'bold'), 'a ‸**word** here')
  assert.equal(press('слово ‸', 'bold'), 'слово **‸**', 'between a space and the end, none')
  assert.equal(press('a ‸ b', 'italic'), 'a *‸* b', 'between spaces, none')
  assert.equal(press('по-ру‸сски', 'italic'), '*по-ру‸сски*')
  assert.equal(press("it does‸n't", 'bold'), "it **does‸n't**")
  assert.equal(press('a word‸, then', 'bold'), 'a **word**‸, then', 'not the comma')
  assert.equal(press('[li‸nk](https://x.org)', 'bold'), '[**li‸nk**](https://x.org)', 'not the link round it')
})

test('anywhere in bold text, bold comes off the whole of it', () => {
  assert.equal(press('Some **bo‸ld text** here', 'bold'), 'Some bo‸ld text here')
  assert.equal(press('Some **bold «text»** here', 'bold'), 'Some bold «text» here')
  assert.equal(press('«**word**»', 'bold'), '«word»', 'the marks selected too')
  assert.equal(press('- an **item‸**', 'bold'), '- an item‸', 'in a list')
  assert.equal(press('- one\n  and **two‸**', 'bold'), '- one\n  and two‸', 'on the second line of an item')
  assert.equal(press('# A **title‸**', 'bold'), '# A title‸', 'in a heading')
})

test('bold and italic, one inside the other, come off one at a time', () => {
  assert.equal(press('«w»', 'bold', 'italic'), '***«w»***')
  assert.equal(press('«w»', 'bold', 'italic', 'bold'), '*«w»*')
  assert.equal(press('«w»', 'italic', 'bold', 'italic'), '**«w»**')
  assert.equal(press('«w»', 'bold', 'italic', 'italic', 'bold'), '«w»')
  // Italic in bold empty marks is added, not mistaken for them.
  assert.equal(press('**‸**', 'italic'), '***‸***')
  assert.equal(press('*a **b‸** c*', 'italic'), 'a **b‸** c', 'the italic round the bold')
})

test('white space at the ends of the selection stays outside the marks', () => {
  assert.equal(press('«word »next', 'bold'), '**«word»** next')
  assert.equal(press('« word»', 'italic'), ' *«word»*')
})

test('in code, stars are what is written there', () => {
  assert.equal(press('`**«x»**`', 'bold'), '`****«x»****`')
  assert.equal(press('```\n**«x»**\n```', 'bold'), '```\n****«x»****\n```')
})

suite('toolbar: formulas')

test('$ goes round the selection, and comes off it again', () => {
  steps('inlineMath', 'Let «x» be', 'Let $«x»$ be', 'Let «x» be')
  steps('inlineMath', 'Let ‸', 'Let $‸$', 'Let ‸')
  assert.equal(press('a $x+‸y$ b', 'inlineMath'), 'a x+‸y b', 'from anywhere in the formula')
})

test('with nothing selected, $ takes what the cursor is in, up to the spaces', () => {
  steps('inlineMath', 'so x^‸2 is', 'so $x^‸2$ is', 'so x^‸2 is')
  assert.equal(press('so f(x)‸, then', 'inlineMath'), 'so $f(x)$‸, then', 'not the comma')
  assert.equal(press('(see \\alpha_1‸).', 'inlineMath'), '(see $\\alpha_1$‸).', 'nor the bracket round it')
  assert.equal(press('**x‸**', 'inlineMath'), '**$x$‸**', 'nor the marks of bold')
  assert.equal(press('so ‸ is', 'inlineMath'), 'so $‸$ is', 'between spaces, none')
})

test('$$ puts a line between two $$, and takes them away again', () => {
  steps('displayMath', '‸', '$$\n‸\n$$', '‸')
  steps('displayMath', 'E = mc^2‸', '$$\nE = mc^2‸\n$$', 'E = mc^2‸')
  steps('displayMath', '«a\nb»', '$$\n«a\nb»\n$$', '«a\nb»')
  assert.equal(press('$$\nx +‸ y\n$$', 'displayMath'), 'x +‸ y', 'from anywhere in the formula')
  assert.equal(press('$$x^2‸$$', 'displayMath'), 'x^2‸', 'written on one line')
  // In the middle of a line, $$x$$ there: the preview shows it on a line of its own.
  steps('displayMath', 'so «x» is', 'so $$«x»$$ is', 'so «x» is')
})

test('$ and $$ turn one kind of formula into the other', () => {
  // The case that was garbage: $ and then $$, or the other way round.
  steps('inlineMath', '«x»', '$«x»$')
  assert.equal(press('«x»', 'inlineMath', 'displayMath'), '$$\n«x»\n$$', 'alone on its line, onto lines of its own')
  assert.equal(press('«x»', 'displayMath', 'inlineMath'), '$«x»$')
  assert.equal(press('«x»', 'inlineMath', 'displayMath', 'inlineMath', 'inlineMath'), '«x»')
  assert.equal(press('so «x» is', 'inlineMath', 'displayMath'), 'so $$«x»$$ is', 'in the middle of a line, in the line')
  assert.equal(press('so «x» is', 'displayMath', 'inlineMath'), 'so $«x»$ is')
  // Nothing typed yet.
  assert.equal(press('‸', 'inlineMath', 'displayMath'), '$$\n‸\n$$')
  assert.equal(press('‸', 'displayMath', 'inlineMath'), '$‸$')
  // A formula over two lines into the line keeps its lines.
  assert.equal(press('$$\na \\\\‸\nb\n$$', 'inlineMath'), '$a \\\\‸\nb$')
  assert.equal(press('$$\na \\\\‸\nb\n$$', 'inlineMath', 'displayMath'), '$$\na \\\\‸\nb\n$$')
})

test('$$ between two formulas does not take their $$ for its own', () => {
  assert.equal(press('$$\na\n$$\n‸\n$$\nb\n$$', 'displayMath'), '$$\na\n$$\n$$\n‸\n$$\n$$\nb\n$$')
})

suite('toolbar: buttons pressed')

/** The buttons markup.state shows pressed for `s`, by name. */
function pressed(s) {
  const { text, start, end } = parse(s)
  const on = markup.state(text, start, end)
  return Object.keys(on).filter((k) => on[k]).join(' ')
}

test('a button is pressed where its next press takes its marks away', () => {
  assert.equal(pressed('plain te‸xt'), '')
  assert.equal(pressed('some **bo‸ld** text'), 'bold')
  assert.equal(pressed('some **bold**‸ text'), 'bold', 'at its end too, as a press there takes it away')
  assert.equal(pressed('*it‸*'), 'italic')
  assert.equal(pressed('***bo‸th***'), 'bold italic')
  assert.equal(pressed('**‸**'), 'bold', 'marks with nothing between yet')
  assert.equal(pressed('`**co‸de**`'), '', 'not in code')
  assert.equal(pressed('so $x‸$ is'), 'inlineMath')
  assert.equal(pressed('so $$x‸$$ is'), 'displayMath')
  assert.equal(pressed('$$\nx‸\n$$'), 'displayMath')
  assert.equal(pressed('$$\n‸\n$$'), 'displayMath')
})

test('heading and list are pressed when every line the selection touches is one', () => {
  assert.equal(pressed('## Ti‸tle'), 'heading')
  assert.equal(pressed('- an **it‸em**'), 'bold list')
  assert.equal(pressed('«- a\n\n- b»'), 'list')
  assert.equal(pressed('«- a\nb»'), '')
})

suite('toolbar: lines and links')

test('heading and list take each line the selection touches', () => {
  steps('heading', 'Title‸', '# Title‸', '## Title‸', '### Title‸', 'Title‸')
  assert.equal(press('«a\nb\n»c', 'list'), '«- a\n- b»\nc', 'not the line the selection ends at the start of')
  assert.equal(press('«- a\n- b»', 'list'), '«a\nb»')
})

suite('toolbar: the link dialog')

/** What the dialog opens on for `s`: its text, its address, and whether it is a link to change. */
function opens(s) {
  const { text, start, end } = parse(s)
  const at = markup.linkAt(text, start, end)
  return [at.text, at.href, at.editing ? 'edit' : 'new']
}

test('the dialog opens on the link the cursor is in, or on the selection or the word there', () => {
  assert.deepEqual(opens('see [the **si‸te**](https://x.org "T") now'), ['the **site**', 'https://x.org', 'edit'])
  assert.deepEqual(opens('see [a \\] b‸](<x y.html>)'), ['a \\] b', 'x y.html', 'edit'], 'its text as written')
  assert.deepEqual(opens('see https://x.org‸ now'), ['https://x.org', 'https://x.org', 'edit'], 'a bare address')
  assert.deepEqual(opens('see «the site» now'), ['the site', '', 'new'])
  assert.deepEqual(opens('see the si‸te now'), ['site', '', 'new'])
  assert.deepEqual(opens('see ‸ now'), ['', '', 'new'])
  assert.deepEqual(opens('`[a‸](b)`'), ['', '', 'new'], 'not in code')
  assert.equal(pressed('see [the si‸te](https://x.org)'), 'link', 'and its button pressed there')
})

test('Insert writes [text](address) in place of what the dialog opened on', () => {
  const write = (s, label, href) => press(s, markup.setLink(label, href))
  assert.equal(write('see the si‸te now', 'site', 'https://x.org'), 'see the [site](https://x.org)‸ now')
  assert.equal(write('see «the site» now', 'the site', 'https://x.org'), 'see [the site](https://x.org)‸ now')
  assert.equal(write('see ‸', '', 'https://x.org'), 'see [https://x.org](https://x.org)‸', 'no text: the address')
  assert.equal(write('‸', 'x', 'www.x.org'), '[x](https://www.x.org)‸')
  assert.equal(write('‸', 'x', 'my notes.html'), '[x](<my notes.html>)‸', 'a space in the address')
  assert.equal(write('see [old‸](https://a.org "T") now', 'new', 'https://b.org'), 'see [new](https://b.org "T")‸ now', 'the title kept')
  assert.equal(markup.setLink('https://x.org', 'https://x.org')('see https://x.org', 6, 6), null, 'unchanged, not rewritten')
})

test('Remove link leaves the text', () => {
  assert.equal(press('see [the **si‸te**](https://x.org) now', markup.unlink), 'see «the **site**» now')
  assert.equal(markup.unlink('see https://x.org', 6, 6), null, 'a bare address has no text of its own')
})
