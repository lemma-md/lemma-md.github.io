// Markdown + TeX -> sanitised HTML.
// marked, katex and DOMPurify are vendored globals (see index.html).

const KATEX_OPTS = { throwOnError: false, errorColor: '#b00020', strict: false }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

function renderMath(tex, displayMode) {
  // throwOnError:false makes KaTeX return markup for malformed formulas instead
  // of throwing, which matters while someone is still typing one.
  try {
    return katex.renderToString(tex, { ...KATEX_OPTS, displayMode })
  } catch (err) {
    return `<span class="katex-error">${escapeHtml(err && err.message)}</span>`
  }
}

// A display formula as a block: from a $$ at the start of a block to the first
// $$ that ends its line. It holds no $$ (a single $ or an escaped \$ is fine)
// and no blank line, which TeX does not allow inside math either. Letting it
// run on to any later $$ made `$$…$$text` swallow everything up to the next
// formula, headings and lists included. When text follows the closing $$ on
// its line, this is no block: the inline rule shows the formula in its line.
const MATH_BLOCK = /^\$\$((?:\\[\s\S]|[^\\$\n]|\$(?!\$)|\n(?![ \t]*\n))+?)\$\$(?:\n+|$)/

// Math is tokenised by marked itself rather than pre-extracted, so markdown
// never gets a chance to mangle `_`, `*` or `\\` inside a formula.
const mathExtension = {
  extensions: [
    {
      name: 'mathBlock',
      level: 'block',
      // Where a paragraph must stop: at a line that starts a display formula.
      // Not at just any $$, which cut a paragraph in two at a `$$x$$` within a
      // line, and not at every line starting with $$: in `$$…` over a line
      // `$$text`, that second line closes the formula. (marked passes the
      // paragraph without its first character, hence the +1.)
      start(src) {
        const line = /\n(?=\$\$)/g
        for (let m; (m = line.exec(src));) {
          if (MATH_BLOCK.test(src.slice(m.index + 1))) return m.index + 1
        }
      },
      tokenizer(src) {
        const m = MATH_BLOCK.exec(src)
        if (m) return { type: 'mathBlock', raw: m[0], text: m[1].trim() }
      },
      renderer(token) { return renderMath(token.text, true) },
    },
    {
      name: 'mathInline',
      level: 'inline',
      start(src) { const i = src.indexOf('$'); return i < 0 ? undefined : i },
      tokenizer(src) {
        // LaTeX's rule: every unescaped pair of dollars is a formula, whatever
        // it holds, spaces and leading digits included; a literal dollar is
        // written \$ (marked's escape takes it before this rule sees it).
        // Inside a formula a backslash escapes the next character, so
        // `$a\$b$` is one formula. `$$…$$` within a line is display math
        // there. Pandoc's rule, which guesses that `$5 and $10` are prices,
        // was tried and dropped: predictable formulas matter more here than
        // unescaped prices. Mirrored in export-html.js.
        const m = /^\$\$((?:\\[\s\S]|[^\\$])+?)\$\$/.exec(src) ?? /^\$(?!\$)((?:\\[\s\S]|[^\\$])+)\$/.exec(src)
        if (m) return { type: 'mathInline', raw: m[0], text: m[1], display: m[0].startsWith('$$') }
      },
      renderer(token) { return renderMath(token.text, token.display) },
    },
  ],
  tokenizer: {
    // A setext heading, text over a line of `=` or `-`, may not run across a
    // line that opens or closes a $$ block, just as it may not run across a
    // code fence. Without this, a formula written straight under a paragraph
    // with a lone `=` on one of its lines made everything above that line a
    // heading, formula included. Refusing (undefined) leaves the text to the
    // paragraph, which stops at the `$$`; `false` lets marked's own rule stand.
    // Mirrored in export-html.js.
    lheading(src) {
      const token = marked.Tokenizer.prototype.lheading.call(this, src)
      if (!token) return false
      return /^ {0,3}\$\$/m.test(token.raw) ? undefined : token
    },
  },
}

marked.use({ gfm: true, breaks: false }, mathExtension)

// A link inside a note goes to another site, so it opens in a new tab: clicking
// one in the preview must not navigate the editor away from what is being
// written. Anchors within the page (#section) are left alone.
//
// Done as a DOMPurify hook rather than by patching the HTML afterwards, so the
// attributes are added while sanitising rather than reintroduced after it.
// `noopener` also denies the opened page a handle on this one through
// `window.opener`.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName !== 'A') return
  const href = node.getAttribute('href') ?? ''
  if (!/^https?:/i.test(href)) return
  node.setAttribute('target', '_blank')
  node.setAttribute('rel', 'noopener noreferrer')
})

/**
 * Convert markdown to HTML that is safe to assign to innerHTML.
 *
 * Sanitising happens after KaTeX has run, so the profiles below must keep
 * MathML and SVG: KaTeX emits MathML for accessibility and SVG for stretchy
 * delimiters such as the bar of a square root.
 */
export function render(markdown) {
  const raw = marked.parse(markdown ?? '')
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true, mathMl: true, svg: true },
  })
}
