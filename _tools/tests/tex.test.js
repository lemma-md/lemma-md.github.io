// Export as .tex: the note's Markdown in LaTeX, its formulas as written, and
// a preamble that follows what the text holds. The rules are in
// src/export-tex.js; docs/ARCHITECTURE.md → Export says why. Whether
// the files compile was checked with pdfLaTeX and LuaLaTeX when this was built:
// a browser has no TeX to run here.

import { buildTex, scan } from '../../src/export-tex.js'
import { suite, test, assert } from './runner.js'

const tex = (md, opts) => buildTex('note.md', md, opts)

/** What lies between \begin{document} and \end{document}. */
const body = (md, opts) => {
  const all = tex(md, opts)
  return all.slice(all.indexOf('\\begin{document}') + 16, all.indexOf('\\end{document}')).trim()
}

/** The lines before \begin{document}. */
const preamble = (md, opts) => {
  const all = tex(md, opts)
  return all.slice(0, all.indexOf('\\begin{document}')).split('\n').filter(Boolean)
}

const has = (text, part, what) => assert.ok(text.includes(part), `${what ?? ''} expected ${JSON.stringify(part)} in:\n${text}`)

suite('tex export')

test('a note is an article; Markdown becomes LaTeX', () => {
  assert.equal(preamble('Hi.')[1], '\\documentclass{article}')
  const out = body('# One\n\n## Two\n\nSome *em*, **bold**, `code`, ~~gone~~.\n\n> quoted\n\n***')
  for (const part of ['\\section{One}', '\\subsection{Two}', '\\emph{em}', '\\textbf{bold}', '\\texttt{code}', '\\sout{gone}', '\\begin{quote}\nquoted\n\\end{quote}', '\\rule{0.5\\linewidth}{0.4pt}']) has(out, part)
  has(preamble('~~gone~~').join('\n'), '\\usepackage[normalem]{ulem}', 'strikethrough needs ulem')
})

test('lists keep their numbers, their tasks and their nesting', () => {
  const out = body('3. three\n4. four\n   - inner\n\n- [ ] open\n- [x] done\n- [1] a reference')
  has(out, '\\begin{enumerate}\n\\setcounter{enumi}{2}\n\\item three')
  has(out, '\\item four\n\n\\begin{itemize}\n\\item inner\n\\end{itemize}')
  has(out, '\\item[$\\square$] open')
  has(out, '\\item[$\\boxtimes$] done')
  // Not a label for \item: the text it starts with.
  has(out, '\\item{} [1] a reference')
})

test('formulas reach LaTeX as written', () => {
  has(body('Inline $a_b^{c}\\,\\frac12$ here.'), '$a_b^{c}\\,\\frac12$')
  has(body('$$\n\\int_0^1 f\n$$'), '\\[\n\\int_0^1 f\n\\]')
  has(body('A line with $$x+y$$ in it.'), '\\[ x+y \\]')
  // \( \) is math to LaTeX, unfixed in the note or not.
  assert.equal(body('Chat: \\( x^2 \\) and\n\\[\ny\n\\]'), 'Chat: $x^2$ and\n\n\\[\ny\n\\]')
  // amsmath's own environments may not sit inside \[ \]; KaTeX allows it.
  const align = '\\begin{align}\na &= b \\\\\nc &= d\n\\end{align}'
  assert.equal(body(`$$\n${align}\n$$`), align)
})

test("LaTeX's characters are escaped in text, and in code", () => {
  has(body('a # $ % & _ { } ~ ^ b'), 'a \\# \\$ \\% \\& \\_ \\{ \\} \\textasciitilde{} \\textasciicircum{} b')
  has(body('a \\ b'), 'a \\textbackslash{} b')
  has(body('a < b > c | d'), 'a \\textless{} b \\textgreater{} c \\textbar{} d')
  has(body('`50% of {x}`'), '\\texttt{50\\% of \\{x\\}}')
  has(body('"quoted" and &amp;'), "``quoted'' and \\&")
  // \end{verbatim} inside a code block would end it early.
  has(body('```\nx\n\\end{verbatim}\n```'), '\\begin{verbatim}\nx\n\\end {verbatim}\n\\end{verbatim}')
})

test('symbols and Greek letters a chat writes become commands; emoji go', () => {
  has(body('x ∈ ℝ, α ≤ β'), 'x \\ensuremath{\\in} \\ensuremath{\\mathbb{R}}, \\ensuremath{\\alpha} \\ensuremath{\\le} \\ensuremath{\\beta}')
  has(body('$α+β≤∞$'), '$\\alpha +\\beta \\le \\infty $')
  has(body('$f′(x)$'), "$f'(x)$")
  has(body('Done ✅ 🚀.'), 'Done \\ensuremath{\\checkmark}.')
  has(body('© 2026'), '© 2026')
})

test("KaTeX's own macros and the packages a formula needs come with it", () => {
  const head = preamble('$\\R \\lt \\argmax f$ and $\\color{red} x$ and $\\bm v$').join('\n')
  has(head, '\\providecommand{\\R}{\\mathbb{R}}')
  has(head, '\\providecommand{\\lt}{<}')
  has(head, '\\providecommand{\\argmax}{\\operatorname*{arg\\,max}}')
  has(head, '\\usepackage{xcolor}')
  has(head, '\\usepackage{bm}')
  // \empty is LaTeX's own, and stays so.
  assert.ok(!preamble('$\\empty$').join('\n').includes('\\empty'), 'no \\empty')
})

test('links, tables and pictures', () => {
  const out = body('[a](https://x.org/a%20b#c), <https://x.org/p_q>, [in note](#top)\n\n| a | b |\n|:-|-:|\n| 1 | x<br>y |\n\n![plot](https://x.org/p.png)')
  has(out, '\\href{https://x.org/a\\%20b\\#c}{a}')
  has(out, '\\url{https://x.org/p_q}')
  has(out, ', in note')
  has(out, '\\begin{tabular}{lr}\n\\toprule\na & b \\\\\n\\midrule\n1 & x y \\\\\n\\bottomrule\n\\end{tabular}')
  has(out, '% image: https://x.org/p.png\n\\href{https://x.org/p.png}{plot}')
  const head = preamble('[a](https://x.org)\n\n| a |\n|-|\n| 1 |').join('\n')
  has(head, '\\usepackage{booktabs}')
  assert.equal(preamble('[a](https://x.org)').at(-1), '\\usepackage{hyperref}', 'hyperref comes last')
})

test('front-matter makes the title', () => {
  const md = '---\ntitle: On limits\nauthor: Ada\naffiliation: Society\ndate: 2026\n---\n\nText.'
  const head = preamble(md).join('\n')
  has(head, '\\title{On limits}\n\\author{Ada \\\\ Society}\n\\date{2026}')
  has(body(md), '\\maketitle\n\nText.')
  // Options only, such as fontsize, make no title.
  assert.ok(!tex('---\nfontsize: 14\n---\n\nText.').includes('\\maketitle'), 'no title from options')
})

test('a note shown as slides is a Beamer presentation, a frame per slide', () => {
  const md = '---\ntitle: Talk\nauthor: Ada\naffiliation: Society\n---\n\n# First\n\nHello.\n\n---\n\n<!-- center -->\nNo title.\n\n---\n\n<!-- bg: black -->\n## Code\n\n```\nx\n```'
  const head = preamble(md, { slides: true }).join('\n')
  has(head, '\\documentclass{beamer}')
  has(head, '\\institute{Society}')
  assert.ok(!head.includes('hyperref'), 'Beamer loads hyperref itself')
  const out = body(md, { slides: true })
  has(out, '\\begin{frame}\n\\titlepage\n\\end{frame}')
  has(out, '\\begin{frame}{First}\nHello.\n\\end{frame}')
  has(out, '\\begin{frame}\n\\centering\nNo title.\n\\end{frame}')
  // verbatim needs a fragile frame; a dark background, light text.
  has(out, '{\n\\definecolor{slidebg1}{HTML}{000000}\n\\setbeamercolor{background canvas}{bg=slidebg1}\n\\setbeamercolor{normal text}{fg=white}\n\\begin{frame}[fragile]{Code}\n\\usebeamercolor[fg]{normal text}\n')
})

test('the preamble follows the scripts in the text', () => {
  const head = (md) => preamble(md).join('\n')
  assert.deepEqual(preamble('Plain English.').slice(1), ['\\documentclass{article}', '\\usepackage{amsmath,amssymb}'], 'nothing extra for English')
  has(head('Café, ząb.'), '\\usepackage[T1]{fontenc}\n\\usepackage{lmodern}')
  has(head('Лемма о пределах функции, and English.'),'\\usepackage[T2A]{fontenc}\n\\usepackage[english,russian]{babel}')
  has(head('Mostly English text, with a Russian word: лемма.'), '\\usepackage[russian,english]{babel}')
  has(head('Привіт, як справи? Це лема.'), 'ukrainian]{babel}')
  has(head('Лемма, and Café.'), '\\usepackage[T1,T2A]{fontenc}')
  // A formula's commands are not English words.
  assert.equal(scan('Лемма $\\frac{\\alpha}{\\beta} + \\sum_{k} x_k$.').cyrillicMain, true)

  const zh = tex('English and 中文.')
  assert.ok(zh.startsWith('% !TEX program = lualatex\n'), 'the magic comment opens the file')
  for (const part of ['\\RequireLuaTeX', '\\usepackage[english]{babel}', '\\babelprovide[import, onchar=ids fonts]{chinese}', '\\babelfont[chinese]{rm}{FandolSong}']) has(zh, part)
  has(tex('これは日本語です。'), '{japanese}')
  has(tex('English and עברית.'), '\\usepackage[bidi=basic, english]{babel}')
  has(tex('Русский и 中文.'), '\\babelfont{rm}{CMU Serif}')
})
