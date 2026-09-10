# Standalone HTML export

**Download as .html** writes a note as a single page that renders itself —
Markdown and TeX — in any browser, with no app and no other viewer. Dropping
that file back into lemma-md re-opens the note. All of it lives in
[`src/export-html.js`](../src/export-html.js).

## What the file contains

- The note's **original Markdown**, HTML-escaped inside
  `<script type="text/markdown" id="md-source">`. Escaping does two jobs: the
  content can never contain a literal `</script>` to break out of the tag, and
  it round-trips **byte-for-byte**, so a drag back in restores the exact source
  rather than reverse-engineering it from rendered HTML. (`</script>` inside a
  fenced code block is the case this protects.)
- A small **renderer** that reads that block and produces the page — a faithful
  copy of the app's pipeline (`src/viewer.js`): the marked math extension, then
  KaTeX, then DOMPurify with the `mathMl`/`svg` profiles.
- **Library `<script>`/`<link>` tags** from a CDN (jsDelivr), pinned to the same
  versions vendored in this repo, so the output matches the app exactly.

No editor, menu, toolbar or multi-doc — just the rendered note.

The imported note's **name** comes from the file name (`report.html` →
`report.md`), so nothing about the name needs storing in the file.

## Decisions

- **Markdown embedded in a script block, HTML-escaped** — for the exact
  round-trip above. Base64 would also be exact but unreadable; a raw script
  block could be broken by `</script>` in the content.
- **The math extension is kept** (it is most of the renderer's code). It is the
  reason formulas containing `_ * \` render correctly and identically to the
  app; the shorter KaTeX auto-render approach lets Markdown mangle the formula
  first (e.g. `$a*b*c$` becomes `a <em>b</em> c`), so it is not used.
- **DOMPurify is kept.** The file is made to be sent to someone; sanitising
  protects the recipient if the note contains hostile HTML.
- **Libraries from a CDN, not inlined.** This reverses an earlier "no network"
  intent (see ARCHITECTURE.md): a self-contained file would inline the libraries
  and ~1 MB of KaTeX fonts, and the small file won. Offline, or with a blocked
  CDN, the renderer falls back to showing the Markdown **as plain text** — never
  a blank page.
- **No build step.** The minified renderer is generated once and committed as a
  string, exactly as the vendored `*.min.js` are — not produced by a toolchain
  at serve time.

## The two options

Both are switches at the top of `src/export-html.js`:

```js
const OPTIONS = {
  css: 'cdn',   // 'cdn' | 'inline'
  js: 'min',    // 'min' | 'full'
}
```

**Current setting: `css: 'cdn'`, `js: 'min'`.**

### `css`

- **`cdn`** — [github-markdown-css](https://github.com/sindresorhus/github-markdown-css)
  from jsDelivr (light + dark). The page carries only a ~5-line frame; the
  container is `.markdown-body`. One more CDN dependency.
- **`inline`** — a self-contained ~30-line stylesheet with its own light/dark
  theme. No third stylesheet to fetch; the container is `#content`.

### `js`

- **`min`** — embeds `RENDER_MIN`, the pre-minified renderer.
- **`full`** — embeds the readable renderer (`exportedRender.toString()`).

## Regenerating the minified renderer

`RENDER_MIN` is derived from the readable `exportedRender()` so the two never
drift. **After editing `exportedRender()`** (or after changing `src/viewer.js` in
a way that should reach the export), regenerate it:

```bash
pip install rjsmin        # once; pure Python, no Node toolchain
python _tools/minify_render.py
```

The script reads `exportedRender()` from between the `// >>> render-source >>>`
markers, minifies `(…)()`, and writes the result back into the `RENDER_MIN`
region. rjsmin only strips comments and whitespace — it never renames
identifiers, so it cannot break the code's no-semicolon (ASI) style the way an
aggressive minifier could.

If `RENDER_MIN` is ever empty, the export falls back to the readable renderer, so
a missed regeneration degrades gracefully rather than shipping a broken file.
