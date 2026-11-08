// A note as a .tex file, for Export as .tex. A note becomes an article; a
// note shown as slides becomes a Beamer presentation, a frame per slide.
//
// The converter walks marked's own tokens, the parse the preview makes with the
// same math extension, so a formula reaches LaTeX exactly as it was written and
// no library is needed: pandoc would not run in a browser without a large
// WebAssembly build. What the preview knows and LaTeX does not is translated on
// the way: Unicode symbols and Greek letters, KaTeX's own macros, emoji.
//
// The preamble is read off the text (scan): nothing extra for English, T1 for
// accented Latin letters, T2A and babel for Cyrillic, and LuaLaTeX with fonts
// from the TeX distributions for Chinese, Japanese, Korean, Arabic and Hebrew,
// which pdfLaTeX cannot set. See docs/ARCHITECTURE.md → Export.

import './viewer.js' // registers the math extension with marked
import { parseDeck, extractFrontMatter, hasTitle } from './present/slides.js'
import { fixDelimiters } from './delimiters.js'

/* ---------- characters ---------- */

const SPECIAL = {
  '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '#': '\\#', '$': '\\$',
  '%': '\\%', '&': '\\&', '_': '\\_', '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}', '<': '\\textless{}', '>': '\\textgreater{}',
  '|': '\\textbar{}', '\u00a0': '~',
}

// Greek letters, as unicode-math reads them: ε is \varepsilon, ϵ \epsilon.
// The capitals that look Latin are Latin letters in TeX.
const GREEK = {
  α: '\\alpha', β: '\\beta', γ: '\\gamma', δ: '\\delta', ε: '\\varepsilon',
  ϵ: '\\epsilon', ζ: '\\zeta', η: '\\eta', θ: '\\theta', ϑ: '\\vartheta',
  ι: '\\iota', κ: '\\kappa', λ: '\\lambda', μ: '\\mu', ν: '\\nu', ξ: '\\xi',
  ο: 'o', π: '\\pi', ϖ: '\\varpi', ρ: '\\rho', ϱ: '\\varrho', σ: '\\sigma',
  ς: '\\varsigma', τ: '\\tau', υ: '\\upsilon', φ: '\\varphi', ϕ: '\\phi',
  χ: '\\chi', ψ: '\\psi', ω: '\\omega',
  Γ: '\\Gamma', Δ: '\\Delta', Θ: '\\Theta', Λ: '\\Lambda', Ξ: '\\Xi',
  Π: '\\Pi', Σ: '\\Sigma', Υ: '\\Upsilon', Φ: '\\Phi', Ψ: '\\Psi', Ω: '\\Omega',
  Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N',
  Ο: 'O', Ρ: 'P', Τ: 'T', Χ: 'X',
}

// The symbols a chat writes as characters, in text or in a formula. pdfLaTeX
// knows none of them in math, and few in text.
const SYMBOLS = {
  '≤': '\\le', '≥': '\\ge', '≠': '\\ne', '≈': '\\approx', '≡': '\\equiv',
  '∼': '\\sim', '≃': '\\simeq', '≅': '\\cong', '∝': '\\propto', '≪': '\\ll',
  '≫': '\\gg', '∞': '\\infty', '∂': '\\partial', '∇': '\\nabla',
  '∅': '\\emptyset', '∀': '\\forall', '∃': '\\exists', '∄': '\\nexists',
  '¬': '\\neg', '∈': '\\in', '∉': '\\notin', '∋': '\\ni', '⊂': '\\subset',
  '⊆': '\\subseteq', '⊊': '\\subsetneq', '⊃': '\\supset', '⊇': '\\supseteq',
  '∪': '\\cup', '∩': '\\cap', '∖': '\\setminus', '∧': '\\wedge', '∨': '\\vee',
  '⊕': '\\oplus', '⊗': '\\otimes', '∘': '\\circ', '·': '\\cdot', '⋅': '\\cdot',
  '×': '\\times', '÷': '\\div', '±': '\\pm', '∓': '\\mp', '√': '\\surd',
  '∑': '\\sum', '∏': '\\prod', '∫': '\\int', '∮': '\\oint', '→': '\\to',
  '←': '\\leftarrow', '↔': '\\leftrightarrow', '⇒': '\\Rightarrow',
  '⇐': '\\Leftarrow', '⇔': '\\Leftrightarrow', '↦': '\\mapsto',
  '⟹': '\\Longrightarrow', '⟸': '\\Longleftarrow', '⟺': '\\Longleftrightarrow',
  '↑': '\\uparrow', '↓': '\\downarrow', 'ℝ': '\\mathbb{R}', 'ℕ': '\\mathbb{N}',
  'ℤ': '\\mathbb{Z}', 'ℚ': '\\mathbb{Q}', 'ℂ': '\\mathbb{C}', 'ℙ': '\\mathbb{P}',
  'ℓ': '\\ell', 'ℵ': '\\aleph', '∠': '\\angle', '⊥': '\\perp',
  '∥': '\\parallel', '∣': '\\mid', '⌊': '\\lfloor', '⌋': '\\rfloor',
  '⌈': '\\lceil', '⌉': '\\rceil', '⟨': '\\langle', '⟩': '\\rangle',
  '°': '^\\circ', '−': '-', '′': "'", '″': "''", '⋯': '\\cdots',
  '✓': '\\checkmark', '✔': '\\checkmark', '✅': '\\checkmark',
  '☑': '\\checkmark', '✗': '\\times', '✘': '\\times', '❌': '\\times',
}

// Emoji are decoration in a chat's answer and break pdfLaTeX: they are left
// out, with what joins and tints them. ©, ® and ™ are pictographs to Unicode,
// and LaTeX sets them.
const PICTOGRAPH = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\uFE0E\uFE0F\u200D\u20E3]/u
const KEPT = new Set(['©', '®', '™'])

let decoder = null
/** Markdown leaves entities in its text tokens; the preview's browser decodes them. */
function decode(s) {
  if (!s.includes('&')) return s
  decoder ??= document.createElement('textarea')
  decoder.innerHTML = s
  return decoder.value
}

/** A command that ends in a letter needs a space before a letter follows it. */
const spaced = (cmd) => (/[A-Za-z]$/.test(cmd) ? `${cmd} ` : cmd)

/** Text for running text: decoded, quotes turned, LaTeX's characters escaped. */
function words(raw, ctx) {
  let out = ''
  for (const ch of decode(raw)) {
    if (ch === '"') out += /[\s([{\u2014\u2013-]/.test(ctx.last) ? '``' : "''"
    else if (SPECIAL[ch]) out += SPECIAL[ch]
    else if (GREEK[ch] ?? SYMBOLS[ch]) out += `\\ensuremath{${GREEK[ch] ?? SYMBOLS[ch]}}`
    else if (PICTOGRAPH.test(ch) && !KEPT.has(ch)) {
      // With the space before it, so that "done ✅." does not end in " .".
      out = out.replace(/ $/, '')
      continue
    } else out += ch
    ctx.last = ch
  }
  return out
}

/* ---------- formulas ---------- */

// Packages a formula may need, by the commands it uses.
const MATH_PACKAGES = [
  [/\\(?:color|textcolor|colorbox)(?![A-Za-z])/, 'xcolor'],
  [/\\[bx]?cancel(?![A-Za-z])/, 'cancel'],
  [/\\bm(?![A-Za-z])/, 'bm'],
  [/\\mathscr(?![A-Za-z])/, 'mathrsfs'],
  [/\\(?:coloneqq|eqqcolon|Coloneqq)(?![A-Za-z])/, 'mathtools'],
]

// KaTeX's own macros, which LaTeX does not have. \empty is left alone: LaTeX
// has one, an empty macro its own code relies on.
const KATEX_MACROS = {
  R: '\\mathbb{R}', Reals: '\\mathbb{R}', reals: '\\mathbb{R}',
  N: '\\mathbb{N}', natnums: '\\mathbb{N}', Z: '\\mathbb{Z}',
  Complex: '\\mathbb{C}', cnums: '\\mathbb{C}', lt: '<', gt: '>',
  argmax: '\\operatorname*{arg\\,max}', argmin: '\\operatorname*{arg\\,min}',
}

/** A formula as LaTeX: as written, but for characters pdfLaTeX would refuse. */
function mathTex(text, ctx) {
  for (const [re, pkg] of MATH_PACKAGES) if (re.test(text)) ctx.need.add(pkg)
  for (const name of Object.keys(KATEX_MACROS)) {
    if (new RegExp(`\\\\${name}(?![A-Za-z])`).test(text)) ctx.macros.add(name)
  }
  let out = ''
  for (const ch of text) {
    const cmd = GREEK[ch] ?? SYMBOLS[ch]
    out += cmd ? spaced(cmd) : PICTOGRAPH.test(ch) && !KEPT.has(ch) ? '' : ch
  }
  return out
}

// A display formula that is an environment of its own: amsmath does not allow
// it inside \[ \], where KaTeX does.
const OWN_ENV = /^\\begin\{(align|alignat|gather|multline|flalign|equation|eqnarray)(\*?)\}[\s\S]*\\end\{\1\2\}$/

function displayMath(text, ctx) {
  const tex = mathTex(text.trim(), ctx)
  return OWN_ENV.test(tex) ? tex : `\\[\n${tex}\n\\]`
}

/* ---------- inline ---------- */

/** A URL as hyperref takes it in an argument. */
const url = (href) => href.replace(/[\\{}]/g, encodeURIComponent).replace(/[#%]/g, '\\$&')

function inline(tokens, ctx) {
  let out = ''
  for (const t of tokens ?? []) out += inlineToken(t, ctx)
  return out
}

function inlineToken(t, ctx) {
  switch (t.type) {
    case 'text': return t.tokens ? inline(t.tokens, ctx) : words(t.text, ctx)
    case 'escape': return words(t.text, ctx)
    case 'strong': return `\\textbf{${inline(t.tokens, ctx)}}`
    case 'em': return `\\emph{${inline(t.tokens, ctx)}}`
    case 'del':
      ctx.need.add('ulem')
      return `\\sout{${inline(t.tokens, ctx)}}`
    case 'codespan': {
      // Code is code: no quotes turned, no entities decoded.
      let code = ''
      for (const ch of t.text) code += SPECIAL[ch] ?? ch
      ctx.last = t.text.slice(-1)
      return `\\texttt{${code}}`
    }
    case 'br':
      ctx.last = ' '
      return ctx.inCell ? ' ' : '\\newline\n'
    case 'mathInline':
      ctx.last = '$'
      return t.display ? `\\[ ${mathTex(t.text, ctx)} \\]` : `$${mathTex(t.text, ctx)}$`
    case 'link': return link(t, ctx)
    case 'image': return image(t, ctx).inline
    case 'html':
      // A line break written as HTML still breaks the line; other tags go,
      // what they hold stays.
      return /^<br\s*\/?>$/i.test(t.text.trim()) ? inlineToken({ type: 'br' }, ctx) : ''
    default: return t.tokens ? inline(t.tokens, ctx) : words(t.text ?? '', ctx)
  }
}

function link(t, ctx) {
  const text = inline(t.tokens, ctx)
  // A link within the note, or to a relative address, has nowhere to go.
  if (!/^[a-z][\w+.-]*:/i.test(t.href)) return text
  ctx.need.add('hyperref')
  // An address written out may break across lines, as \url allows; but \url
  // takes its argument as it is, and some characters would still mean
  // something to LaTeX in a table cell or a heading.
  if (t.text === t.href && /^[\w\-./:?=+@!*,;]+$/.test(t.href)) return `\\url{${t.href}}`
  return `\\href{${url(t.href)}}{${text}}`
}

/** An image becomes a link to it: \includegraphics needs the file beside the
 *  .tex. One stored in the note itself, as a data: address, is left out. */
function image(t, ctx) {
  const alt = words(t.text || 'image', ctx)
  if (/^data:/i.test(t.href)) {
    return { inline: `[${alt}]`, note: '% An image stored in the note was left out.' }
  }
  if (!/^[a-z][\w+.-]*:/i.test(t.href)) return { inline: `[${alt}]`, note: `% image: ${t.href}` }
  ctx.need.add('hyperref')
  return { inline: `\\href{${url(t.href)}}{${alt}}`, note: `% image: ${t.href}` }
}

/* ---------- blocks ---------- */

const SECTIONS = ['section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph', 'subparagraph']
const ENUM = ['enumi', 'enumii', 'enumiii', 'enumiv']

function blocks(tokens, ctx) {
  const out = []
  for (const t of tokens ?? []) {
    ctx.last = ' '
    const tex = block(t, ctx)
    if (tex) out.push(tex)
  }
  return out.join('\n\n')
}

function block(t, ctx) {
  switch (t.type) {
    case 'space': case 'def': case 'checkbox': return ''
    case 'heading': {
      const text = inline(t.tokens, ctx)
      return ctx.slides ? `\\textbf{${text}}\\par` : `\\${SECTIONS[t.depth - 1]}{${text}}`
    }
    case 'paragraph': {
      // A picture alone in its paragraph keeps its address in a comment.
      const parts = t.tokens.filter((x) => !(x.type === 'text' && !x.text.trim()))
      if (parts.length === 1 && parts[0].type === 'image') {
        const { inline: tex, note } = image(parts[0], ctx)
        return `${note}\n${tex}`
      }
      return inline(t.tokens, ctx)
    }
    case 'text': return t.tokens ? inline(t.tokens, ctx) : words(t.text, ctx)
    case 'mathBlock': return displayMath(t.text, ctx)
    case 'code':
      // \end{verbatim} would end it early; with a space it is only text.
      return `\\begin{verbatim}\n${t.text.replace(/\\end\{verbatim\}/g, '\\end {verbatim}')}\n\\end{verbatim}`
    case 'blockquote': return `\\begin{quote}\n${blocks(t.tokens, ctx)}\n\\end{quote}`
    case 'list': return list(t, ctx)
    case 'table': return table(t, ctx)
    case 'hr': return '\\begin{center}\n\\rule{0.5\\linewidth}{0.4pt}\n\\end{center}'
    case 'html':
      // The note's own HTML has no LaTeX: it is kept as comments.
      return t.text.trim().split('\n').map((line) => `% ${line}`).join('\n')
    default: return t.tokens ? blocks(t.tokens, ctx) : words(t.text ?? '', ctx)
  }
}

function list(t, ctx) {
  const env = t.ordered ? 'enumerate' : 'itemize'
  const lines = [`\\begin{${env}}`]
  const depth = ctx.enumDepth
  if (t.ordered) {
    ctx.enumDepth++
    const start = Number(t.start)
    if (start !== 1 && ENUM[depth]) lines.push(`\\setcounter{${ENUM[depth]}}{${start - 1}}`)
  }
  for (const item of t.items) {
    const label = item.task ? `[${item.checked ? '$\\boxtimes$' : '$\\square$'}]` : ''
    const body = blocks(item.tokens.filter((x) => x.type !== 'checkbox'), ctx)
    // An item that starts with [, or with a comment over a line that does,
    // would hand LaTeX its own label.
    lines.push(`\\item${label}${!label && /^[[%]/.test(body) ? '{}' : ''} ${body}`)
  }
  if (t.ordered) ctx.enumDepth--
  lines.push(`\\end{${env}}`)
  return lines.join('\n')
}

function table(t, ctx) {
  ctx.need.add('booktabs')
  ctx.inCell = true
  const row = (cells) => `${cells.map((c) => { ctx.last = ' '; return inline(c.tokens, ctx) }).join(' & ')} \\\\`
  const cols = t.align.map((a) => ({ left: 'l', center: 'c', right: 'r' }[a] ?? 'l')).join('')
  const lines = ['\\begin{center}', `\\begin{tabular}{${cols}}`, '\\toprule', row(t.header), '\\midrule']
  for (const cells of t.rows) lines.push(row(cells))
  lines.push('\\bottomrule', '\\end{tabular}', '\\end{center}')
  ctx.inCell = false
  return lines.join('\n')
}

/* ---------- slides ---------- */

const hasCode = (tokens) => (tokens ?? []).some((t) => t.type === 'code' || hasCode(t.tokens) || (t.items ?? []).some((i) => hasCode(i.tokens)))

// A slide's bg is CSS. Some CSS names mean other colours to xcolor (its green
// is CSS's lime), so a name becomes its CSS value; one not listed is left out.
const CSS_COLORS = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF',
  cyan: '00FFFF', aqua: '00FFFF', magenta: 'FF00FF', fuchsia: 'FF00FF',
  yellow: 'FFFF00', gray: '808080', grey: '808080', darkgray: 'A9A9A9',
  darkgrey: 'A9A9A9', lightgray: 'D3D3D3', lightgrey: 'D3D3D3', silver: 'C0C0C0',
  maroon: '800000', navy: '000080', olive: '808000', purple: '800080',
  teal: '008080', lime: '00FF00', orange: 'FFA500', pink: 'FFC0CB',
  brown: 'A52A2A', violet: 'EE82EE', gold: 'FFD700', beige: 'F5F5DC',
  ivory: 'FFFFF0', lavender: 'E6E6FA', darkblue: '00008B', darkgreen: '006400',
  darkred: '8B0000', midnightblue: '191970', slategray: '708090',
  whitesmoke: 'F5F5F5', aliceblue: 'F0F8FF', snow: 'FFFAFA', linen: 'FAF0E6',
}

/** A CSS colour as six hex digits, or null. */
function hexColor(css) {
  const c = css.trim().toLowerCase()
  if (CSS_COLORS[c]) return CSS_COLORS[c]
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(c)
  if (hex) return (hex[1].length === 3 ? [...hex[1]].map((d) => d + d).join('') : hex[1]).toUpperCase()
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(c)
  if (rgb) return rgb.slice(1, 4).map((n) => Math.min(255, +n).toString(16).padStart(2, '0')).join('').toUpperCase()
  return null
}

function background(bg, ctx) {
  const hex = hexColor(bg)
  if (!hex) return null
  const name = `slidebg${++ctx.colors}`
  const lines = [`\\definecolor{${name}}{HTML}{${hex}}`, `\\setbeamercolor{background canvas}{bg=${name}}`]
  // On a dark background the projector sets light text, as reveal.js does.
  // Beamer takes the text colour once, for the whole document, so the frame
  // takes it up again itself.
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const dark = 0.299 * r + 0.587 * g + 0.114 * b < 128
  if (dark) lines.push('\\setbeamercolor{normal text}{fg=white}')
  return { before: lines.join('\n'), inside: dark ? '\\usebeamercolor[fg]{normal text}\n' : '' }
}

function frames(deck, ctx) {
  const out = []
  if (hasTitle(deck.title)) out.push('\\begin{frame}\n\\titlepage\n\\end{frame}')
  for (const slide of deck.slides) {
    const tokens = marked.lexer(slide.md)
    // The slide's first heading, if it opens the slide, is its title.
    let title = ''
    const first = tokens.findIndex((t) => t.type !== 'space')
    if (first >= 0 && tokens[first].type === 'heading') {
      ctx.last = ' '
      title = inline(tokens[first].tokens, ctx)
      tokens.splice(first, 1)
    }
    const opts = hasCode(tokens) ? '[fragile]' : '' // verbatim needs it
    const body = blocks(tokens, ctx)
    const bg = slide.bg ? background(slide.bg, ctx) : null
    const frame = `\\begin{frame}${opts}${title ? `{${title}}` : ''}\n${bg?.inside ?? ''}${slide.center ? '\\centering\n' : ''}${body}\n\\end{frame}`
    // The colours are set in a group of the frame's own.
    out.push(bg ? `{\n${bg.before}\n${frame}\n}` : frame)
  }
  return out.join('\n\n')
}

/* ---------- preamble ---------- */

// Fonts for LuaLaTeX, from the TeX distributions (TeX Live and MiKTeX), with a
// sans-serif one for Beamer, which sets its text in sans.
const LUA_LANGUAGES = {
  chinese: ['FandolSong', 'FandolHei'],
  japanese: ['Harano Aji Mincho', 'Harano Aji Gothic'],
  korean: ['UnBatang', 'UnDotum'],
  arabic: ['Amiri', 'Amiri'],
  hebrew: ['Libertinus Serif', 'Libertinus Sans'],
}

/** What the text needs from LaTeX to be set at all. */
export function scan(text) {
  // Letters are counted in the prose: a formula's commands are Latin letters.
  const prose = text.replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$|```[\s\S]*?```|`[^`\n]*`/g, '')
  const count = (re) => (prose.match(re) ?? []).length
  const cyrillic = count(/\p{Script=Cyrillic}/gu)
  const lua = []
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) lua.push('japanese')
  else if (/\p{Script=Hangul}/u.test(text)) lua.push('korean')
  else if (/\p{Script=Han}/u.test(text)) lua.push('chinese')
  if (/\p{Script=Arabic}/u.test(text)) lua.push('arabic')
  if (/\p{Script=Hebrew}/u.test(text)) lua.push('hebrew')
  return {
    // Accented Latin letters and guillemets: none of them is in OT1.
    accented: /[\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F«»‹›]/.test(text),
    // Which Cyrillic language: hyphenation needs one. і, ї, є and ґ are Ukrainian.
    cyrillic: cyrillic ? (/[іїєґІЇЄҐ]/.test(text) ? 'ukrainian' : 'russian') : null,
    // The main language is the one with more letters.
    cyrillicMain: cyrillic > count(/\p{Script=Latin}/gu),
    lua,
  }
}

function preamble(text, ctx) {
  const s = scan(text)
  const lines = []
  if (s.lua.length) lines.push('% !TEX program = lualatex')
  lines.push(`\\documentclass{${ctx.slides ? 'beamer' : 'article'}}`)
  if (s.lua.length) {
    // pdfLaTeX cannot set these scripts at all: it stops at once, saying so,
    // rather than at the first character it does not know.
    lines.push('\\usepackage{iftex}', '\\RequireLuaTeX')
    const main = s.cyrillic && s.cyrillicMain ? s.cyrillic : 'english'
    const bidi = s.lua.includes('arabic') || s.lua.includes('hebrew') ? 'bidi=basic, ' : ''
    lines.push(`\\usepackage[${bidi}${main}]{babel}`)
    // Latin Modern has no Cyrillic; CMU, the same design, does.
    if (s.cyrillic) {
      if (!s.cyrillicMain) lines.push(`\\babelprovide[import, onchar=ids fonts]{${s.cyrillic}}`)
      lines.push('\\babelfont{rm}{CMU Serif}', '\\babelfont{sf}{CMU Sans Serif}')
    }
    for (const lang of s.lua) {
      const [rm, sf] = LUA_LANGUAGES[lang]
      lines.push(`\\babelprovide[import, onchar=ids fonts]{${lang}}`, `\\babelfont[${lang}]{rm}{${rm}}`, `\\babelfont[${lang}]{sf}{${sf}}`)
    }
  } else if (s.cyrillic) {
    // T2A has the Cyrillic letters; the last encoding named is the default.
    lines.push(`\\usepackage[${s.accented ? 'T1,' : ''}T2A]{fontenc}`)
    const langs = s.cyrillicMain ? ['english', s.cyrillic] : [s.cyrillic, 'english']
    lines.push(`\\usepackage[${langs.join(',')}]{babel}`)
  } else if (s.accented) {
    lines.push('\\usepackage[T1]{fontenc}', '\\usepackage{lmodern}')
  }
  lines.push('\\usepackage{amsmath,amssymb}')
  const PACKAGES = { ulem: '\\usepackage[normalem]{ulem}', booktabs: '\\usepackage{booktabs}', xcolor: '\\usepackage{xcolor}', cancel: '\\usepackage{cancel}', bm: '\\usepackage{bm}', mathrsfs: '\\usepackage{mathrsfs}', mathtools: '\\usepackage{mathtools}' }
  for (const [name, use] of Object.entries(PACKAGES)) if (ctx.need.has(name)) lines.push(use)
  // Beamer loads hyperref itself; elsewhere it goes last, as it asks to.
  if (ctx.need.has('hyperref') && !ctx.slides) lines.push('\\usepackage{hyperref}')
  for (const name of ctx.macros) lines.push(`\\providecommand{\\${name}}{${KATEX_MACROS[name]}}`)
  return lines
}

/* ---------- the file ---------- */

function titleLines(meta, ctx) {
  if (!hasTitle(meta)) return []
  const field = (key) => {
    ctx.last = ' '
    return meta[key] ? words(meta[key], ctx) : ''
  }
  const [title, author, affiliation, place, date] = ['title', 'author', 'affiliation', 'place', 'date'].map(field)
  const join = (...parts) => parts.filter(Boolean).join(' \\\\ ')
  // Without a \date, LaTeX prints the day the file is compiled.
  return ctx.slides
    ? [`\\title{${title}}`, `\\author{${author}}`, ...(affiliation ? [`\\institute{${affiliation}}`] : []), `\\date{${join(place, date)}}`]
    : [`\\title{${title}}`, `\\author{${join(author, affiliation)}}`, `\\date{${join(place, date)}}`]
}

/**
 * The note as a complete .tex file. `slides` makes it a Beamer presentation, as
 * the note is shown as slides; otherwise it is an article.
 */
export function buildTex(name, source, { slides = false } = {}) {
  // \( \) is math to LaTeX itself, so a formula a chat wrote that way is one in
  // the .tex, fixed in the note or not.
  const text = fixDelimiters(source).text
  const ctx ={ slides, need: new Set(), macros: new Set(), last: ' ', inCell: false, enumDepth: 0, colors: 0 }
  let meta, body
  if (slides) {
    const deck = parseDeck(text)
    meta = deck.title
    body = frames(deck, ctx)
  } else {
    const parts = extractFrontMatter(text)
    meta = parts.meta
    body = blocks(marked.lexer(parts.body), ctx)
  }
  const titles = titleLines(meta, ctx)
  const head = preamble(text, ctx)
  // The magic comment, if any, must stay on the first line.
  const at = head[0].startsWith('%') ? 1 : 0
  head.splice(at, 0, `% ${name.replace(/[\r\n]/g, ' ')}, from lemma-md`)
  return [
    ...head,
    ...(titles.length ? ['', ...titles] : []),
    '',
    '\\begin{document}',
    ...(titles.length && !slides ? ['', '\\maketitle'] : []),
    '',
    body,
    '',
    '\\end{document}',
    '',
  ].join('\n')
}
