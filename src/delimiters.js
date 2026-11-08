// Formulas written as \( … \) and \[ … \], as ChatGPT and similar chats write
// them. Markdown reads \( as an escaped bracket, so such a formula shows as
// plain text. Fix rewrites them with $ and $$, which the preview reads, and
// GitHub and Obsidian too: a second delimiter style in the renderer would have
// made notes that read right only here.
//
// Code is left as it is, fenced or inline, and so is a formula already in
// dollars, whose own \[ (as in \\[4pt]) is TeX's business.

// A formula already in dollars, as the preview reads one (viewer.js).
const DISPLAY = /\$\$(?:\\[\s\S]|[^\\$])+?\$\$/y
const INLINE = /\$(?!\$)(?:\\[\s\S]|[^\\$])+\$/y
const FENCE = /^ {0,3}(`{3,}|~{3,})/

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

/**
 * The note with its \( \) and \[ \] formulas written in dollars, and how many
 * were rewritten. A formula with a dollar of its own inside is left alone: in
 * dollars it would end there.
 */
export function fixDelimiters(source) {
  const s = String(source ?? '')
  let out = ''
  let count = 0
  let fence = null
  let lineStart = true
  let i = 0

  while (i < s.length) {
    if (lineStart) {
      lineStart = false
      const eol = s.indexOf('\n', i)
      const end = eol < 0 ? s.length : eol + 1
      const line = s.slice(i, end)
      const run = FENCE.exec(line)?.[1]
      // Inside a fenced block, and the fence lines themselves, nothing changes.
      if (fence || run) {
        if (!fence) fence = run
        else if (run && run[0] === fence[0] && run.length >= fence.length && line.trim() === run) fence = null
        out += line
        i = end
        lineStart = true
        continue
      }
    }

    const c = s[i]
    if (c === '\n') {
      out += c
      i++
      lineStart = true
    } else if (c === '`') {
      const length = /^`+/.exec(s.slice(i, i + 100))[0].length
      const end = closingTicks(s, i + length, length)
      const stop = end < 0 ? i + length : end + length
      out += s.slice(i, stop)
      i = stop
    } else if (c === '$') {
      DISPLAY.lastIndex = INLINE.lastIndex = i
      const m = DISPLAY.exec(s) ?? INLINE.exec(s)
      const stop = m ? i + m[0].length : i + 1
      out += s.slice(i, stop)
      i = stop
    } else if (c === '\\' && (s[i + 1] === '(' || s[i + 1] === '[')) {
      const display = s[i + 1] === '['
      const end = closing(s, i + 2, display ? '\\]' : '\\)')
      const inner = end < 0 ? '' : s.slice(i + 2, end)
      if (inner.trim() && !/(^|[^\\])(\\\\)*\$/.test(inner)) {
        // A display formula over several lines keeps its lines, so that $$
        // stands on a line of its own as it did; one on a single line, and an
        // inline one, lose the spaces inside, which GitHub's $ will not take.
        out += display
          ? `$$${inner.includes('\n') ? inner : inner.trim()}$$`
          : `$${inner.trim()}$`
        count++
        i = end + 2
      } else {
        out += s.slice(i, i + 2)
        i += 2
      }
    } else if (c === '\\' && s[i + 1] !== '\n' && i + 1 < s.length) {
      // A backslash and what it escapes, so that \\( is not an opening.
      out += s.slice(i, i + 2)
      i += 2
    } else {
      out += c
      i++
    }
  }
  return { text: out, count }
}
