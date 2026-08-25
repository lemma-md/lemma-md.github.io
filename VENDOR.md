# Vendored libraries

Third-party code is committed to `vendor/` rather than installed. There is no
build step and no package manager: `index.html` loads these files directly.

Everything came from jsDelivr (which mirrors npm) at the pinned versions below.

| library | version | files | why |
|---|---|---|---|
| [marked](https://github.com/markedjs/marked) | 18.0.9 | `marked.min.js` | markdown parser |
| [DOMPurify](https://github.com/cure53/DOMPurify) | 3.4.13 | `purify.min.js` | marked does not sanitise; this closes the XSS hole |
| [KaTeX](https://katex.org) | 0.18.2 | `katex/katex.min.js`, `katex/katex.min.css`, `katex/fonts/*.woff2` | formula rendering |
| [Ace](https://ace.c9.io) | 1.44.0 | `ace/ace.js`, `ace/mode-markdown.js`, `ace/theme-textmate.js`, `ace/ext-searchbox.js` | editor with line numbers |

## Icons

The toolbar icons — among them `file-plus`, `folder-open`, `download`,
`settings`, `eye` and `square-pen` — are taken from
[Lucide](https://lucide.dev) v1.30.0 and inlined as `<symbol>` definitions at
the top of `index.html`. Only their path data is copied; the library itself is
not a dependency, since pulling in a whole icon set for four glyphs would cost
far more than it saves.

They are stroke-based and use `currentColor`, so they follow the surrounding
text colour with no per-icon styling.

To add another: copy the paths from
`https://cdn.jsdelivr.net/npm/lucide-static@1.30.0/icons/<name>.svg` into a new
`<symbol>`, keeping `viewBox="0 0 24 24"` and dropping the wrapper `<svg>`
attributes — those live on `.icon` in the stylesheet.

> ISC License. Copyright (c) 2026 Lucide Icons and Contributors.
>
> Permission to use, copy, modify, and/or distribute this software for any
> purpose with or without fee is hereby granted, provided that the above
> copyright notice and this permission notice appear in all copies.
>
> THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
> REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
> AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
> INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
> LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
> OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
> PERFORMANCE OF THIS SOFTWARE.

## Notes

- **Only `.woff2` fonts are kept.** The KaTeX stylesheet also lists `.woff` and
  `.ttf`, but every browser that runs this app supports `woff2` and stops at the
  first format it understands, so the other two are never requested. This cuts
  the font payload by roughly two thirds.
- **UMD builds, not ESM.** KaTeX ships 600 kB of unminified ESM against 272 kB
  of minified UMD, so the libraries are plain `<script>` globals. Our own code
  in `src/` is native ES modules.
- **Ace is loaded on demand** by `src/editor.js`, not from `index.html` — it is
  larger than everything else combined, and someone who only reads a note
  should never download it.

## Re-fetching

Run from the repository root. This reproduces `vendor/` exactly, so it doubles
as the update procedure — bump a version, run it, commit the diff.

```bash
MARKED=18.0.9
PURIFY=3.4.13
KATEX=0.18.2
ACE=1.44.0
CDN=https://cdn.jsdelivr.net/npm

get() { curl -sSfL --create-dirs -o "$2" "$1"; }

get $CDN/marked@$MARKED/lib/marked.umd.min.js      vendor/marked.min.js
get $CDN/dompurify@$PURIFY/dist/purify.min.js      vendor/purify.min.js
get $CDN/katex@$KATEX/dist/katex.min.js            vendor/katex/katex.min.js
get $CDN/katex@$KATEX/dist/katex.min.css           vendor/katex/katex.min.css

for m in ace mode-markdown theme-textmate ext-searchbox; do
  get $CDN/ace-builds@$ACE/src-min-noconflict/$m.js vendor/ace/$m.js
done

for f in AMS-Regular Caligraphic-Bold Caligraphic-Regular Fraktur-Bold \
         Fraktur-Regular Main-Bold Main-BoldItalic Main-Italic Main-Regular \
         Math-BoldItalic Math-Italic SansSerif-Bold SansSerif-Italic \
         SansSerif-Regular Script-Regular Size1-Regular Size2-Regular \
         Size3-Regular Size4-Regular Typewriter-Regular; do
  get $CDN/katex@$KATEX/dist/fonts/KaTeX_$f.woff2 vendor/katex/fonts/KaTeX_$f.woff2
done
```

After a KaTeX bump, check the `@font-face` rules in `katex.min.css` against the
font list above in case the set changed.

> On Windows use `curl.exe` (Git Bash or PowerShell) — plain `curl` in
> PowerShell is an alias for `Invoke-WebRequest`, which takes different
> arguments and, on Windows PowerShell 5.1, tries to parse responses through
> Internet Explorer's HTML engine.
