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

// Math is tokenised by marked itself rather than pre-extracted, so markdown
// never gets a chance to mangle `_`, `*` or `\\` inside a formula.
const mathExtension = {
  extensions: [
    {
      name: 'mathBlock',
      level: 'block',
      start(src) { return src.indexOf('$$') },
      tokenizer(src) {
        const m = /^\$\$([\s\S]+?)\$\$(?:\n+|$)/.exec(src)
        if (m) return { type: 'mathBlock', raw: m[0], text: m[1].trim() }
      },
      renderer(token) { return renderMath(token.text, true) },
    },
    {
      name: 'mathInline',
      level: 'inline',
      start(src) { const i = src.indexOf('$'); return i < 0 ? undefined : i },
      tokenizer(src) {
        // Guards against prices: `$` must not be followed by a space or digit,
        // and the closing `$` must not be preceded by a space.
        const m = /^\$(?![\s\d])([\s\S]*?[^\s\\])\$(?!\d)/.exec(src)
        if (m) return { type: 'mathInline', raw: m[0], text: m[1] }
      },
      renderer(token) { return renderMath(token.text, false) },
    },
  ],
}

marked.use({ gfm: true, breaks: false }, mathExtension)

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
