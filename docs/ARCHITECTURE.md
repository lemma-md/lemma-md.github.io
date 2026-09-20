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

By default IndexedDB is "best effort": a browser may evict it when the disk
fills up, without asking. For an app whose promise is that work is not lost,
that is a defect, so `navigator.storage.persist()` is requested — but **on the
first keystroke, never on load**. Firefox shows a permission prompt for this,
and a prompt on the first screen is exactly the obstacle this app exists to
avoid; by the first edit the user has something to lose and has just made a
gesture. Chrome and Safari never prompt, deciding from engagement heuristics
instead. The request fires once per page load and is not retried.

The size shown in Settings is summed from the note text, not taken from
`navigator.storage.estimate()`. That call measures the browser's entire storage
bucket for the origin — block allocation, metadata, space not yet reclaimed
after deletion — which measured about 49x the real text in testing, and in
Firefox reported hundreds of megabytes unrelated to any note. Its quota figure
is equally unhelpful: Firefox reports a small group limit before persistence
and roughly half the free disk afterwards, so the number leaps from ~10 MB to
hundreds of gigabytes on being granted permission. The quota is consulted only
to detect that the disk is genuinely nearly full.

Persistence is offered as a button and a status line, never a toggle. The
Storage API has `persist` but no `unpersist`, so an "off" position could not do
anything — a switch that only works one way is a lie in the shape of a control.
Turning it off is possible only through the browser's own site settings, and
the UI says so.

**Closing a tab does not delete the note.** It leaves the tab strip and stays in
storage, reachable from Settings, where deleting is explicit and confirmed. This
matters because until cloud saving exists, this database holds the *only* copy
of a note — a close button that destroys work is indefensible. The pending
debounced write is flushed on close so the last keystrokes survive.

The mental model is a desktop editor: IndexedDB is the scratch area, and cloud
storage will be the real disk. That analogy is not yet honest — there is no real
disk to save to — which is another reason export and syncing come next.

Drafts are readable by any page on the same origin, and on GitHub Pages the
path is not part of the origin. Publishing at `<account>.github.io/<project>/`
would therefore hand every other project under that account — and every
third-party script on their pages — read access to the notes.

The app is published from a GitHub organisation of its own instead. What that
buys is a host nobody else publishes to — `lemma-md.github.io` — and since the
origin is exactly scheme, host and port, that host is the whole of the
protection. The same isolation a custom domain would give, at no cost.

Two corollaries follow from the path being irrelevant. The repository is named
`lemma-md.github.io` so the app answers at the bare root, but that is a choice
about how the address reads aloud, not about safety: a project repository at
`lemma-md.github.io/notes/` would be exactly as isolated. And **the isolation
lasts only while this organisation publishes nothing else** — a second project
under it would share this host, and therefore these drafts. If that day comes,
the answer is a custom domain, not a second path.

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
- **`.html`** a standalone page that renders the note — Markdown and TeX — on
  its own in any browser (`src/export-html.js`). The original markdown is
  embedded HTML-escaped in a `<script type="text/markdown">` block: escaping
  keeps it byte-for-byte and unable to break out of the tag, so dragging the
  file back in restores the *exact* source rather than reverse-engineering it
  from rendered HTML. The libraries load from a CDN, pinned to the same versions
  vendored here so the output matches the app, and the inline renderer is a
  `.toString()` copy of `viewer.js`. This needs the network to fetch those
  libraries — a reversal of an earlier "no network" intent: a self-contained
  variant would inline the libraries and the ~1 MB of KaTeX fonts, and the small
  file won. (Embedding documents in the URL was considered and rejected.)
- **`.pdf`** via browser print, because mathematicians send PDFs.

## Presentation

A note presents as slides in a **separate projector window** (`present/`), never
mixed with the editor. The slide engine is **reveal.js** — vendored, a classic
`<script>` global, loaded only by that page so a reader never pays for it. It
earns its place on the parts that are dear to build well: scaling a fixed
960×700 slide box to any projector, navigation, and transitions.
The full design, data model, meta keys and hard-won lessons are written up in
[PRESENTER.md](PRESENTER.md) — start there when touching the presenter.

Some things are deliberately **not** reveal's:

- **Rendering.** reveal's markdown/highlight/math plugins stay off; each slide is
  produced by the app's own `render()` (`src/viewer.js`). One markdown+TeX
  pipeline, so a slide is byte-identical to the same note read in the editor —
  the same reason the landing page and the editor share `render()`. Slides are
  split on a line of `---` (never inside a `$$…$$` or fenced-code block), with an
  optional YAML front-matter block becoming a title slide; both are borrowed
  conventions (Jekyll, Marp), not a borrowed renderer.
- **Three modes** (`src/present/ink.js`): Present (laser only, no toolbar),
  Annotate (draw over the slides) and Board. They are on a rail top-left and in
  the menu, and on `Alt+P`/`Alt+A`/`Alt+B` (intercepted before reveal, whose
  `Alt+B` would blank the screen — that is a menu item instead). Each drawing mode
  remembers its own tool and colour; a fresh show starts Annotate on a red pen and
  Board on white chalk.
- **Annotation.** Drawing is a small custom SVG layer, one `<svg>` in slide space
  inside each `<section>` so the ink rides reveal's scale transform. Tools: laser
  pointer, pen, chalk, semi-transparent highlighter, and an eraser that trims
  strokes at its rim rather than dropping them whole. Pen and chalk are
  variable-width (speed, or stylus pressure) and so render as filled ribbons.
  Widths live in slide-space units, so a stroke is the same weight at any
  projector resolution. A stroke stores its colour as a **palette slot**, not a
  hex, so one base colour follows the surface — black ink on a slide, white chalk
  on the blackboard — and re-resolves when the board flips light/dark. Strokes are
  vectors, stored per note in their own IndexedDB store (`annotations`), so the
  `.md` stays plain text and the ink returns next time.
- **A side-car board.** Alongside the deck is a stack of blank pages to work on
  mid-talk (blackboard by default, whiteboard from *Settings*). Each page is just
  another drawing surface: the whole per-surface machinery — strokes, per-surface
  undo/redo, persistence — is keyed by surface id, so a board page is the key
  `'board:N'` next to the slide numbers, and needed no second drawing path. Only
  the current page is in view (`[hidden]` on the rest); the count is restored from
  the highest saved `'board:N'`.
- **Overview.** `=` opens a custom thumbnail grid — reveal's own overview lays a
  linear deck out in a single horizontal row, so a multi-row, vertically scrolled
  grid with arrow-key selection is ours (`.overview` in `ink.js`). It serves both
  surfaces: slide thumbnails are scaled clones of the rendered content, board
  thumbnails a clone of the page's strokes.
- **Keyboard.** Reveal's own keyboard is turned **off** (`keyboard: false`); a
  single capture-phase handler in `ink.js` drives everything — mode switches
  (`Alt+P/A/B`), tools (`1`–`5`, drawing modes only), overview (`=`), settings
  (`Ctrl+,`), fullscreen (`F`), undo/redo (off in Present), our own **Blank screen**
  overlay (reveal's pause only covers the deck, hidden on the board), and slide/board
  navigation (arrows, space, PgUp/PgDn, Home/End) via the reveal API. Turning
  reveal's keyboard off is what fixes Escape: reveal `preventDefault`s any key it
  binds (even a disabled one), and `preventDefault` on Escape stops the browser
  leaving **F11** fullscreen — so with reveal out of the way, our handler leaves
  Escape completely untouched when nothing is open, and F11's Esc-to-exit works.
  A **Help** dialog lists the bindings.

This reverses the earlier sketch of `reveal.js-chalkboard` +
`reveal.js-notes-pointer`. Chalkboard owns its own drawing model and chalk look,
and a distinct translucent-highlighter tool sits awkwardly in it; more decisively
it would have been a second rendering path beside `render()`. A single-window
projector with the presenter drawing directly on it was chosen over a
speaker/second-screen view, which is left for later.

- **PDF export** is its own static page (`pdf/`), not reveal's print path —
  reveal's print stylesheet is not vendored, so it lays each slide out as one
  fixed `960×700` page itself (`src/pdf.css`) and prints through the browser. It
  reuses the projector's section builder (`deck-dom.js`) and ink renderer
  (`ink-svg.js`), so the same deck and the same strokes come out; the ink is baked
  in as vector SVG (chalk's rasterising filter dropped, blend modes avoided) while
  text and KaTeX stay selectable. The presenter's **Export as PDF…** flushes the
  ink to IndexedDB and shows that page in an in-page preview modal (an iframe),
  which reads it back — no cross-window snapshot; printing the iframe prints only
  its pages. Non-empty board pages follow the slides; a slide taller than one page
  is flagged, to clip or continue across pages. See [PRESENTER.md](PRESENTER.md).

## Deployment

GitHub Pages; the repository is the site. For a project page the app is served
from a sub-path, so every asset reference must stay relative.
