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

// What may stand before a nested code block's line: the marks and indentation
// of the lists and quotes it is in.
const CONTAINER = /^[\s>]*(?:(?:[-+*]|\d{1,9}[.)])[\s>]*)*$/

/**
 * The numbers of the lines of `s` that are code. A block at the top level
 * covers the lines of its raw text, which marked cuts the source into. One in
 * a list or a quote has its raw text without the container's marks, so its
 * lines are found within the container's as the ends of lines that have only
 * such marks before them.
 */
function codeLines(s) {
  const lines = s.split('\n').map((l) => l.replace(/\r$/, ''))
  const code = new Set()
  const rawLines = (raw) => raw.replace(/\n$/, '').split('\n')
  let at = 0
  for (const t of marked.lexer(s)) {
    const span = rawLines(t.raw).length
    if (t.type === 'code') {
      for (let k = 0; k < span; k++) code.add(at + k)
    } else {
      let from = at
      for (const inner of nestedCode(t)) {
        const want = rawLines(inner.raw)
        const fits = (j) => want.every((w, k) => {
          const line = lines[j + k]
          return line.endsWith(w) && CONTAINER.test(line.slice(0, line.length - w.length))
        })
        for (let j = from; j + want.length <= at + span; j++) {
          if (!fits(j)) continue
          for (let k = 0; k < want.length; k++) code.add(j + k)
          from = j + want.length
          break
        }
      }
    }
    at += (t.raw.match(/\n/g) ?? []).length
  }
  return code
}

/** The code blocks inside a block, in the order they come. */
function* nestedCode(t) {
  for (const child of [...(t.tokens ?? []), ...(t.items ?? [])]) {
    if (child.type === 'code') yield child
    else yield* nestedCode(child)
  }
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
    } else if (s[j] === '\n' && /^\n[ \t]*(\n|$)/.test(s.slice(j, j + 80))) {
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

const newlines = (part) => (part.match(/\n/g) ?? []).length

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

  /** Copy the source up to `stop` as it is. */
  const keep = (stop) => {
    const part = s.slice(i, stop)
    out += part
    line += newlines(part)
    i = stop
  }

  while (i < s.length) {
    if (lineStart) {
      lineStart = false
      // A line of code, a fence's own included, stays as it is.
      if (code.has(line)) {
        const eol = s.indexOf('\n', i)
        keep(eol < 0 ? s.length : eol)
        continue
      }
    }

    const c = s[i]
    if (c === '\n') {
      out += c
      line++
      i++
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
      for (let k = 0; k <= newlines(inner); k++) intoCode ||= code.has(line + k)
      if (inner.trim() && !intoCode && !/(^|[^\\])(\\\\)*\$/.test(inner)) {
        // A display formula over several lines keeps its lines, so that $$
        // stands on a line of its own as it did; one on a single line, and an
        // inline one, lose the spaces inside, which GitHub's $ will not take.
        out += display
          ? `$$${inner.includes('\n') ? inner : inner.trim()}$$`
          : `$${inner.trim()}$`
        count++
        line += newlines(inner)
        i = end + 2
      } else {
        keep(i + 2)
      }
    } else if (c === '\\' && s[i + 1] !== '\n' && i + 1 < s.length) {
      // A backslash and what it escapes, so that \\( is not an opening.
      keep(i + 2)
    } else {
      out += c
      i++
    }
  }
  return { text: out, count }
}
