// The editor toolbar's Markdown: bold, italic, headings, lists, formulas and
// links, as edits of the text. A command takes the whole text, its lines
// ended by \n, and the selection, as offsets, and returns one edit:
//
//   { from, to, insert, start, end }
//
// which puts `insert` in place of text.slice(from, to), then selects
// [start, end) of the text that results. Being plain functions of the text,
// they are tested without an editor (markup.test.js); src/editor.js applies
// one as a single step for Ctrl+Z.
//
// A second press takes away what the first put in, as in a word processor,
// and $ and $$ turn one kind of formula into the other. So the commands have
// to know what is bold already, or a formula, and they know it as the preview
// does: marked reads the text, with the math extension viewer.js gives it,
// instead of a guess from the marks next to the cursor.

import './viewer.js' // gives marked its math extension

const rowStart = (text, i) => text.lastIndexOf('\n', i - 1) + 1
const rowEnd = (text, i) => {
  const n = text.indexOf('\n', i)
  return n < 0 ? text.length : n
}
const blank = (s) => !/\S/.test(s)

/** The selection without white space at its ends: marks go round the text. */
function trim(text, start, end) {
  while (start < end && /\s/.test(text[start])) start++
  while (end > start && /\s/.test(text[end - 1])) end--
  return [start, end]
}

/**
 * The lines the selection touches, from the start of the first to the end of
 * the last. A selection that ends at the start of a line does not take it.
 */
function rows(text, start, end) {
  if (end > start && text[end - 1] === '\n') end--
  return [rowStart(text, start), rowEnd(text, end)]
}

/**
 * Put `before` and `after` in place of the `cut` and `cutEnd` characters at
 * the ends of text[from, to). The selection keeps its place in what is
 * between, which a selection of the marks themselves comes down to.
 */
function rewrap(text, from, to, cut, cutEnd, before, after, start, end) {
  const inside = text.slice(from + cut, to - cutEnd)
  const at = (i) => from + before.length + Math.min(inside.length, Math.max(0, i - from - cut))
  return { from, to, insert: before + inside + after, start: at(start), end: at(end) }
}

const wrap = (text, start, end, before, after = before) => rewrap(text, start, end, 0, 0, before, after, start, end)

/**
 * `mark` round text[from, to), a word the cursor is in or next to, with the
 * cursor where it was among the letters: after the word, it stays after it.
 */
function wrapWord(text, from, to, mark, cursor) {
  const at = cursor <= from ? cursor : cursor >= to ? cursor + 2 * mark.length : cursor + mark.length
  return { from, to, insert: mark + text.slice(from, to) + mark, start: at, end: at }
}

/* ---------- the word at the cursor ---------- */

const LETTER = /[\p{L}\p{N}\p{M}_]/u
// Within a word, as in don't and well-known.
const JOINER = /['’-]/

/** The word the cursor is in or next to, as [from, to], or null between spaces. */
function wordAt(text, i) {
  const letter = (j) => j >= 0 && j < text.length && LETTER.test(text[j])
  const inWord = (j) => letter(j) || (JOINER.test(text[j] ?? '') && letter(j - 1) && letter(j + 1))
  let from = i
  let to = i
  while (inWord(from - 1)) from--
  while (inWord(to)) to++
  return from < to ? [from, to] : null
}

/**
 * What a formula at the cursor would hold: everything up to the spaces, as
 * in x^2, f(x) or \alpha_1, but not the marks of bold or code, nor the comma
 * after it or a bracket the sentence has round it. Null between spaces.
 */
function termAt(text, i) {
  const inTerm = (c) => c !== undefined && /[^\s$*`~]/.test(c)
  let from = i
  let to = i
  while (inTerm(text[from - 1])) from--
  while (inTerm(text[to])) to++
  const count = (c) => text.slice(from, to).split(c).length - 1
  while (from < to) {
    if (/[.,;:?"»”]/.test(text[to - 1]) || (text[to - 1] === ')' && count('(') < count(')'))) to--
    else if (/["«„“]/.test(text[from]) || (text[from] === '(' && count('(') > count(')'))) from++
    else break
  }
  return from < to ? [from, to] : null
}

/* ---------- what the text holds, as marked reads it ---------- */

let lexed = { text: null, spans: [] }

/**
 * Tokens with the offsets they stand at in `src`, nested ones too. A token's
 * raw is found in its parent's; the lines of a list item lose their indent in
 * its tokens, so what is within such a one is not placed, which only means a
 * button there adds marks instead of taking them away.
 */
function place(tokens, src, base, out) {
  let at = 0
  for (const token of tokens) {
    const i = typeof token.raw === 'string' && token.raw ? src.indexOf(token.raw, at) : -1
    if (i < 0) continue
    const from = base + i
    out.push({ type: token.type, token, from, to: from + token.raw.replace(/\n+$/, '').length })
    at = i + token.raw.length
    for (const inner of [token.tokens, token.items]) if (Array.isArray(inner)) place(inner, token.raw, from, out)
  }
  return out
}

/**
 * The spans of the text around the selection: the whole text read as the
 * preview reads it, and the selection's own lines read once more as one
 * paragraph, which places what a list item or a quote holds.
 */
function read(text, start, end) {
  // The toolbar asks at every move of the cursor, the text mostly the same.
  if (lexed.text !== text) lexed = { text, spans: place(marked.lexer(text), text, 0, []) }
  const spans = [...lexed.spans]
  const [from, to] = rows(text, start, end)
  const lines = text.slice(from, to)
  if (!/\n[ \t]*\n/.test(lines)) place(marked.Lexer.lexInline(lines), lines, from, spans)
  return spans
}

/** The smallest span of one of `types` that holds the selection, or null. */
function around(spans, types, start, end) {
  let best = null
  for (const s of spans) {
    if (types.includes(s.type) && s.from <= start && end <= s.to && (!best || s.to - s.from < best.to - best.from)) best = s
  }
  return best
}

/** How many of `ch` stand just before `i`, and just after it, on its line. */
function runs(text, i, ch) {
  let b = 0
  let a = 0
  while (text[i - b - 1] === ch) b++
  while (text[i + a] === ch) a++
  if (text[i - b - 1] === '\\' && b) b-- // \$ is a dollar, not a mark
  return [b, a]
}

// In code, ** and $ are what is written there.
const inCode = (spans, start, end) => around(spans, ['code', 'codespan'], start, end)

/* ---------- bold and italic ---------- */

/** The bold (size 2) or italic (1) text that holds the selection, as a span, or null. */
function findEmphasis(text, start, end, spans, type, size) {
  if (inCode(spans, start, end)) return null
  const span = around(spans, [type], start, end)
  if (span) return span
  // Marks with nothing between yet, as the button leaves them: **|**. Bold is
  // two stars on each side, italic one, and *** both.
  if (start === end) {
    const n = Math.min(...runs(text, start, '*'))
    if (size === 2 ? n >= 2 : n % 2 === 1) return { from: start - size, to: start + size }
  }
  return null
}

const emphasis = (type, size) => (text, start, end) => {
  ;[start, end] = trim(text, start, end)
  const spans = read(text, start, end)
  const found = findEmphasis(text, start, end, spans, type, size)
  if (found) return rewrap(text, found.from, found.to, size, size, '', '', start, end)
  const mark = '*'.repeat(size)
  // With nothing selected, the word the cursor is in. Between spaces there is
  // none, and the marks go in with the cursor between them.
  if (start === end && !around(spans, ['code', 'codespan', 'mathInline', 'mathBlock'], start, end)) {
    const word = wordAt(text, start)
    if (word) return wrapWord(text, word[0], word[1], mark, start)
  }
  return wrap(text, start, end, mark)
}

export const bold = emphasis('strong', 2)
export const italic = emphasis('em', 1)

/* ---------- formulas ---------- */

/**
 * The formula buttons. $ works as bold does: on the selection or, with
 * nothing selected, on what the cursor is in. $$ works as heading and list
 * do: on the lines the cursor is on, which go between two $$ lines. In a
 * formula, its own button takes it away and the other turns it into its
 * kind: a formula alone in its line goes onto lines of its own, and one within
 * a line, or a selection there, becomes `$$x$$` in place.
 */
/**
 * The formula that holds the selection, or null: where it stands, how many
 * characters at each end are its marks, and whether it is a display one.
 */
function findFormula(text, start, end, spans) {
  if (inCode(spans, start, end)) return null

  // On lines of its own: $$, the formula, $$, or $$x$$ alone in its block.
  const block = around(spans, ['mathBlock'], start, end)
  if (block) {
    const inside = text.slice(block.from + 2, block.to - 2)
    const cut = 2 + (/^[ \t]*\n/.exec(inside)?.[0].length ?? 0)
    const cutEnd = 2 + (/\n[ \t]*$/.exec(inside)?.[0].length ?? 0)
    return { from: block.from, to: block.to, cut, cutEnd, display: true }
  }

  // $$, an empty line, $$, as the button leaves them: not yet a formula to
  // marked, since a formula holds no blank line.
  const [from, to] = rows(text, start, end)
  if (blank(text.slice(from, to))) {
    const above = from > 0 ? rowStart(text, from - 1) : -1
    const below = to < text.length ? to + 1 : -1
    const fence = (i) => i >= 0 && text.slice(i, rowEnd(text, i)).trim() === '$$' && !around(spans, ['mathBlock', 'code'], i, i)
    if (fence(above) && fence(below)) return { from: above, to: rowEnd(text, below), cut: from - above, cutEnd: rowEnd(text, below) - to, display: true }
  }

  // In the line: $x$ or $$x$$, or the empty $|$ the button leaves.
  const span = around(spans, ['mathInline'], start, end)
  if (span) {
    const have = span.token.display ? 2 : 1
    return { from: span.from, to: span.to, cut: have, cutEnd: have, display: have === 2 }
  }
  if (start === end) {
    const have = Math.min(2, ...runs(text, start, '$'))
    if (have) return { from: start - have, to: start + have, cut: have, cutEnd: have, display: have === 2 }
  }
  return null
}

const formula = (display) => (text, start, end) => {
  ;[start, end] = trim(text, start, end)
  const spans = read(text, start, end)
  if (inCode(spans, start, end)) return wrap(text, start, end, display ? '$$' : '$')

  const f = findFormula(text, start, end, spans)
  if (f) {
    const { from, to, cut, cutEnd } = f
    if (f.display === display) return rewrap(text, from, to, cut, cutEnd, '', '', start, end)
    if (!display) return rewrap(text, from, to, cut, cutEnd, '$', '$', start, end)
    // A formula in the line made a display one: onto lines of its own if it
    // is alone in its line, `$$x$$` in place if not.
    const lineFrom = rowStart(text, from)
    const lineTo = rowEnd(text, to)
    if (blank(text.slice(lineFrom, from)) && blank(text.slice(to, lineTo))) {
      return rewrap(text, lineFrom, lineTo, from - lineFrom + cut, lineTo - to + cutEnd, '$$\n', '\n$$', start, end)
    }
    return rewrap(text, from, to, cut, cutEnd, '$$', '$$', start, end)
  }

  if (!display) {
    // As bold does: with nothing selected, what the cursor is in.
    const term = start === end && termAt(text, start)
    return term ? wrapWord(text, term[0], term[1], '$', start) : wrap(text, start, end, '$')
  }
  // Nothing selected, or whole lines: the lines go between two $$.
  if (start === end || text.slice(start, end).includes('\n') || (blank(text.slice(rowStart(text, start), start)) && blank(text.slice(end, rowEnd(text, end))))) {
    const [first, last] = rows(text, start, end)
    return rewrap(text, first, last, 0, 0, '$$\n', '\n$$', start, end)
  }
  return wrap(text, start, end, '$$')
}

export const inlineMath = formula(false)
export const displayMath = formula(true)

/* ---------- lines ---------- */

/**
 * Rewrite the lines the selection touches with `change(lines)`. A selection
 * then covers the new lines; a lone cursor goes to the end of the last.
 */
const eachLine = (change) => (text, start, end) => {
  const [from, to] = rows(text, start, end)
  const insert = change(text.slice(from, to).split('\n')).join('\n')
  const after = from + insert.length
  return { from, to, insert, start: start === end ? after : from, end: after }
}

const HEADING = /^(#{1,6})\s+(.*)$/
const ITEM = /^(\s*)[-*+]\s+/

/** Whether every line with text in `lines` is `pattern`'s: a heading, say. */
function all(lines, pattern) {
  const filled = lines.filter((l) => l.trim())
  return filled.length > 0 && filled.every((l) => pattern.test(l))
}

/** The next heading level of a line: none, #, ##, ###, then none again. */
function nextHeading(line) {
  const m = HEADING.exec(line)
  if (!m) return `# ${line}`
  return m[1].length >= 3 ? m[2] : `${m[1]}# ${m[2]}`
}

/** Lines into a list, or out of one when every line with text is an item already. */
function toggleList(lines) {
  if (all(lines, ITEM)) return lines.map((l) => l.replace(ITEM, '$1'))
  return lines.map((l) => (l.trim() || lines.length === 1 ? `- ${l}` : l))
}

export const heading = eachLine((lines) => lines.map(nextHeading))
export const list = eachLine(toggleList)

/* ---------- which buttons show as pressed ---------- */

/**
 * The buttons to show pressed for the selection: those whose next press
 * would take their marks away, or for heading change the level, for link open
 * the link to change. Found by the same reading as the commands, so the two
 * cannot disagree.
 */
export function state(text, start, end) {
  ;[start, end] = trim(text, start, end)
  const spans = read(text, start, end)
  const f = findFormula(text, start, end, spans)
  const [from, to] = rows(text, start, end)
  const lines = text.slice(from, to).split('\n')
  return {
    bold: !!findEmphasis(text, start, end, spans, 'strong', 2),
    italic: !!findEmphasis(text, start, end, spans, 'em', 1),
    heading: all(lines, HEADING),
    list: all(lines, ITEM),
    inlineMath: f?.display === false,
    displayMath: f?.display === true,
    link: !!findLink(spans, start, end),
  }
}

/* ---------- links ---------- */

// The Link button opens a dialog with the link's text and address: linkAt
// says what it opens on, setLink and unlink are what its buttons do.

/** The link that holds the selection, as a span, or null. */
function findLink(spans, start, end) {
  return inCode(spans, start, end) ? null : around(spans, ['link'], start, end)
}

/** Where the text of a link written [text](…) ends in it: the ] that closes the first [. */
function labelEnd(raw) {
  let depth = 0
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '\\') i++
    else if (raw[i] === '[') depth++
    else if (raw[i] === ']' && --depth === 0) return i
  }
  return -1
}

/**
 * What the link dialog opens on: the link the selection is in, its text as
 * written and its address; or else the selection, or with nothing selected
 * the word at the cursor, as the text of a new one. `from` and `to` are what
 * the link takes the place of. A link written as a bare address, or in <…>,
 * has no text of its own to leave, so it cannot be taken away, only changed.
 */
export function linkAt(text, start, end) {
  ;[start, end] = trim(text, start, end)
  const spans = read(text, start, end)
  const link = findLink(spans, start, end)
  if (link) {
    const raw = text.slice(link.from, link.to)
    const close = raw.startsWith('[') ? labelEnd(raw) : -1
    return {
      from: link.from,
      to: link.to,
      text: close > 0 ? raw.slice(1, close) : link.token.text,
      href: link.token.href,
      title: link.token.title || '',
      editing: true,
      removable: close > 0,
    }
  }
  if (start === end && !inCode(spans, start, end)) [start, end] = wordAt(text, start) ?? [start, end]
  return { from: start, to: end, text: text.slice(start, end), href: '', title: '', editing: false, removable: false }
}

/** An address typed as www.example.org gets its https://, which a browser would add. */
function withScheme(href) {
  href = href.trim()
  return /^www\./i.test(href) ? `https://${href}` : href
}

/** The address as Markdown writes it: in <…> when it holds a space, or brackets that do not pair. */
function destination(href) {
  const paired = href.split('(').length === href.split(')').length
  return /\s/.test(href) || !paired ? `<${href.replace(/</g, '%3C').replace(/>/g, '%3E')}>` : href
}

/**
 * The command for the dialog's Insert or Apply: [text](address) in place of
 * what linkAt found, keeping a title the link had, with the cursor after it.
 * With no text, the address is the text. A link left as it was is not
 * rewritten, so a bare address stays bare.
 */
export const setLink = (label, href) => (text, start, end) => {
  const at = linkAt(text, start, end)
  href = withScheme(href)
  label = label.replace(/\s*\n\s*/g, ' ') || href
  if (at.editing && label === at.text && href === at.href) return null
  const title = at.title ? ` "${at.title.replace(/"/g, '\\"')}"` : ''
  const insert = `[${label}](${destination(href)}${title})`
  const after = at.from + insert.length
  return { from: at.from, to: at.to, insert, start: after, end: after }
}

/** The command for the dialog's Remove link: the link's text stays, selected. */
export function unlink(text, start, end) {
  const at = linkAt(text, start, end)
  if (!at.removable) return null
  return { from: at.from, to: at.to, insert: at.text, start: at.from, end: at.from + at.text.length }
}
