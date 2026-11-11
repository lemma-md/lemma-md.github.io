// Formulas written as \( … \) and \[ … \], as ChatGPT and similar chats write
// them. Markdown reads \( as an escaped bracket, so such a formula shows as
// plain text. Fix rewrites them with $ and $$, which the preview reads, and
// GitHub and Obsidian too: a second delimiter style in the renderer would have
// made notes that read right only here.
//
// Code is left as it is, and so is a formula already in dollars, whose own \[
// (as in \\[4pt]) is TeX's business. Code blocks are those of marked's own
// reading, the preview's: fenced or indented, in a list or a quote too.

import './viewer.js' // registers the math extension with marked, as the preview reads

// A formula already in dollars, as the preview reads one (viewer.js).
const DISPLAY = /\$\$(?:\\[\s\S]|[^\\$])+?\$\$/y
const INLINE = /\$(?!\$)(?:\\[\s\S]|[^\\$])+\$/y

// A line ends as marked has it end: \r\n, \n, or \r alone, as old Macs wrote.
const BREAK = /\r\n|\r|\n/g
const breaks = (part) => (part.match(BREAK) ?? []).length

/**
 * The numbers of the lines of `s` that are code, found by counting lines, not
 * by matching text. marked cuts the source into blocks whose raw texts follow
 * one another, and a list item or a quote likewise: its raw text is the source
 * as written, and the blocks inside are read from its content line for line,
 * only without the marks and indentation. So a block starts as many lines
 * after the first of its container as the blocks before it span. Matching the
 * code's text against the source instead was fooled twice: marked writes a
 * tab in a list item as four spaces, and text in an item may read as the code
 * below it once its indentation is set aside.
 */
function codeLines(s) {
  const code = new Set()
  const lines = (raw) => (raw.match(/\n/g) ?? []).length
  // The blocks `tokens`, the first of them starting on line `at`.
  const walk = (tokens, at) => {
    for (const t of tokens) {
      if (t.type === 'code') {
        const span = t.raw.replace(/\n$/, '').split('\n').length
        for (let k = 0; k < span; k++) code.add(at + k)
      } else if (t.type === 'list') walk(t.items, at)
      else if (t.type === 'list_item' || t.type === 'blockquote') walk(t.tokens ?? [], at)
      at += lines(t.raw)
    }
  }
  walk(marked.lexer(s), 0)
  return code
}

/**
 * Where the formula opened at `from` ends: the index of its closing `\)` or
 * `\]`, or -1. A backslash escapes the character after it, so `\\)` is a line
 * break and a parenthesis, not the end; and a formula holds no blank line, any
 * more than TeX allows one in math.
 */
function closing(s, from, close) {
  for (let j = from; j < s.length; j++) {
    if (s[j] === '\\') {
      if (s.startsWith(close, j)) return j
      j++
    } else if ((s[j] === '\n' || s[j] === '\r') && /^(?:\r\n|\r(?!\n)|\n)[ \t]*(?:[\r\n]|$)/.test(s.slice(j, j + 80))) {
      return -1
    }
  }
  return -1
}

/** Where a code span opened by `length` backticks at `from` closes, or -1. */
function closingTicks(s, from, length) {
  const run = new RegExp(`(?<!\`)\`{${length}}(?!\`)`, 'g')
  run.lastIndex = from
  return run.exec(s)?.index ?? -1
}

/**
 * The note with its \( \) and \[ \] formulas written in dollars, and how many
 * were rewritten. A formula with a dollar of its own inside is left alone: in
 * dollars it would end there.
 */
export function fixDelimiters(source) {
  const s = String(source ?? '')
  // Most notes have none, and are not parsed for code.
  if (!/\\[([]/.test(s)) return { text: s, count: 0 }
  const code = codeLines(s)
  let out = ''
  let count = 0
  let line = 0
  let lineStart = true
  let i = 0

  /** Copy the source up to `stop` as it is. Never between \r and \n. */
  const keep = (stop) => {
    const part = s.slice(i, stop)
    out += part
    line += breaks(part)
    i = stop
  }
  const eol = /[\r\n]/g

  while (i < s.length) {
    if (lineStart) {
      lineStart = false
      // A line of code, a fence's own included, stays as it is.
      if (code.has(line)) {
        eol.lastIndex = i
        keep(eol.exec(s)?.index ?? s.length)
        continue
      }
    }

    const c = s[i]
    if (c === '\n' || c === '\r') {
      keep(i + (s.startsWith('\r\n', i) ? 2 : 1))
      lineStart = true
    } else if (c === '`') {
      const length = /^`+/.exec(s.slice(i, i + 100))[0].length
      const end = closingTicks(s, i + length, length)
      keep(end < 0 ? i + length : end + length)
    } else if (c === '$') {
      DISPLAY.lastIndex = INLINE.lastIndex = i
      const m = DISPLAY.exec(s) ?? INLINE.exec(s)
      keep(m ? i + m[0].length : i + 1)
    } else if (c === '\\' && (s[i + 1] === '(' || s[i + 1] === '[')) {
      const display = s[i + 1] === '['
      const end = closing(s, i + 2, display ? '\\]' : '\\)')
      const inner = end < 0 ? '' : s.slice(i + 2, end)
      // Not one on a line of code, which a code span over several lines can
      // lead into, nor one that runs on into one, as a fence right under a
      // paragraph can follow it.
      let intoCode = false
      for (let k = 0; k <= breaks(inner); k++) intoCode ||= code.has(line + k)
      if (inner.trim() && !intoCode && !/(^|[^\\])(\\\\)*\$/.test(inner)) {
        // A display formula over several lines keeps its lines, so that $$
        // stands on a line of its own as it did; one on a single line, and an
        // inline one, lose the spaces inside, which GitHub's $ will not take.
        out += display
          ? `$$${/[\r\n]/.test(inner) ? inner : inner.trim()}$$`
          : `$${inner.trim()}$`
        count++
        line += breaks(inner)
        i = end + 2
      } else {
        keep(i + 2)
      }
    } else if (c === '\\' && i + 1 < s.length && s[i + 1] !== '\n' && s[i + 1] !== '\r') {
      // A backslash and what it escapes, so that \\( is not an opening.
      keep(i + 2)
    } else {
      out += c
      i++
    }
  }
  return { text: out, count }
}
