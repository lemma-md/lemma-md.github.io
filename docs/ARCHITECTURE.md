# Architecture and decisions

Each decision below records what was chosen and, more importantly, what
evidence led there. Several reverse an earlier choice in this project; where
that happened, the reason is kept so it is not quietly reversed again.

## Goal

A markdown editor with TeX that a non-programmer can use within thirty seconds
of opening a link. Everything else is subordinate to that.

Two consequences that are easy to forget:

- **The viewer alone is not a product.** Someone who does not yet write
  markdown is not converted by a way to read it. The conversion moment is "I
  wrote a note with formulas in five minutes and sent it to a colleague", so
  editing and export belong in the first release, not a later one.
- **Anything resembling a login belongs last.** The audience has no GitHub
  account and a cloud consent screen reads as a threat. Local drafts must work
  with no account at all.

## No build step

There is no bundler, no package manager and no `package.json`. Our code is
native ES modules; third-party libraries are committed under `vendor/` and
loaded as plain `<script>` globals.

This reverses the project's original design (pnpm workspaces, Vite library
builds, per-package configs). What changed it:

- **Bundling was not what made the app small.** Measured over the wire: a Vite
  build of unified + rehype + highlight.js came to 247 kB, against ~168 kB for
  marked + KaTeX + DOMPurify with no build at all. Library choice dominates,
  and pre-minified libraries have nothing left to tree-shake.
- **Nothing in the requirements forces a bundler.** reveal.js, its plugins and
  pdf.js are all classic `<script>` libraries. CodeMirror 6 was the single
  exception, which is why it is not used (see below).
- **Code splitting does not need one.** Injecting a `<script>` on demand splits
  the app perfectly well — see `src/editor.js`.
- **Longevity.** This project will be maintained in spare time. A tree of files
  still opens in five years; a toolchain may not.

Vite comes back only if TypeScript or the remark plugin ecosystem becomes
necessary. Migration would be hours, not a rewrite — which is what makes
starting simple safe rather than reckless.

## Libraries

| choice | why |
|---|---|
| **marked** | single file, no build needed; the unified/remark pipeline cost ~4× the bytes for capability we do not use yet |
| **DOMPurify** | marked does not sanitise, and `innerHTML = marked.parse(...)` executes raw HTML |
| **KaTeX** | fast, and covers `\newcommand`, `align`, `cases`. It lacks `\label`/`\ref`, amsthm environments and tikz — acceptable, confirmed with the intended users |
| **Ace** | line numbers were wanted; CodeMirror 6 is the only dependency that would have forced a bundler back in |
| **IndexedDB** | works in every target browser, stores structured records, and can hold file handles later |

Vendored rather than loaded from a CDN: the app must work offline and must not
depend on a third party staying up. `VENDOR.md` holds a verified `curl` script
that reproduces `vendor/` byte for byte.

## Rendering pipeline

```
markdown --marked(+math extension)--> HTML with KaTeX output --DOMPurify--> innerHTML
```

Two details that are not free to change:

- **Math is tokenised by a marked extension, not pre-extracted.** Markdown
  therefore never sees the inside of a formula and cannot mangle `_`, `*` or
  `\\`. The inline rule also refuses to match a `$` followed by a space or a
  digit, so `$5 and $10` stays prose.
- **Sanitising runs after KaTeX, with the `mathMl` and `svg` profiles enabled.**
  KaTeX emits MathML for accessibility and SVG for stretchy delimiters such as
  the bar of a square root; a default HTML-only profile would silently destroy
  them. Verified: MathML, SVG and KaTeX's inline styles all survive, while
  `<img onerror>` and `javascript:` hrefs do not.

## No shadow DOM

An earlier version isolated the preview in a shadow root. It looked tidy and
cost a great deal: `@font-face` rules are **ignored inside a shadow root**, so
KaTeX silently fell back to Times New Roman — in production *and* in
development. Fixing it required a second copy of the stylesheet at document
level plus a build plugin to strip the dead font rules from the first.

The preview is ordinary DOM with prefixed selectors. Fonts simply work.

## Loading

Ace is roughly as large as everything else combined, so it is injected on first
use rather than from `index.html`:

```
reading a note   436 kB
+ editing        565 kB   (Ace, on demand)
fonts             48 kB   3 of 20 woff2 files — the rest are never requested
```

The same `loadScript` helper in `src/editor.js` will carry reveal.js and
pdf.js.

## Storage, and why syncing is last

Verified constraints, not assumptions:

- **File System Access API is Chromium-desktop only** — absent in Firefox
  (Mozilla's position is "harmful"), Safari and all mobile browsers, about 27%
  global reach. So reading is drag & drop plus `<input type="file">` everywhere,
  with `showOpenFilePicker` as an upgrade where it exists, because only it
  yields a handle for saving in place. Elsewhere "save" means download.
- **GitHub OAuth cannot be done from a static site.** PKCE arrived in July 2025
  but SPAs must still send a `client_secret`, and the token endpoint sends no
  CORS headers. It needs a ~30-line token broker (a Cloudflare Worker). The
  broker only participates in login; file contents never pass through it.
- **Cloud drives need no broker.** Google Drive, Dropbox and OneDrive all
  support pure client-side PKCE. Drive's `drive.file` scope limits access to
  files the user opened through the app, which is the least alarming consent
  screen available.
- **Gists are rejected.** Secret gists have unguessable ids but no access
  control — anyone with a leaked link can read them, which is unacceptable for
  unpublished mathematics. The eventual GitHub path is a private repository,
  with the UI hiding the words branch, commit and push.

## Export

- **`.md`** is the primary format and the anti-lock-in guarantee: the note is
  always a plain text file that opens in VS Code, Obsidian or any online editor.
- **`.html`** self-contained, with the original markdown embedded in a
  `<script type="text/markdown">` block. The file renders anywhere with no app
  and no network, and dragging it back in restores the exact source — no lossy
  HTML-to-markdown conversion. (Embedding documents in the URL was considered
  and rejected.)
- **`.pdf`** via browser print, because mathematicians send PDFs.

## Presentation

reveal.js with `reveal.js-chalkboard` (pen and annotation, drawings included in
the printed PDF) and `reveal.js-notes-pointer` (laser pointer). Its speaker view
is an ordinary popup window synchronised by messages, not the Chromium-only
Window Management API — so presenting on two screens works in Firefox.

## Deployment

GitHub Pages; the repository is the site. For a project page the app is served
from a sub-path, so every asset reference must stay relative.
