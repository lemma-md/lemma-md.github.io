# Architecture and decisions

Each decision below records what was chosen and, more importantly, what
evidence led there. Several reverse an earlier choice in this project; where
that happened, the reason is kept so it is not quietly reversed again.

Decisions are grouped by topic, not by date, so that whoever is about to change
something finds the rule in the section they are reading. A decision carries the
month it was made, e.g. *(2026-09)*. The marks were introduced in November
2026, so for an older decision without one, `git log` on this file gives the
date. This file describes what is built. A question about planned work is
settled in [ROADMAP.md](ROADMAP.md), and its answer moves here when the work
ships, which also gets a line in [CHANGELOG.md](../CHANGELOG.md).

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
markdown --marked(+math extension)--> HTML, formulas as placeholders
         --DOMPurify--> safe HTML --placeholders replaced by KaTeX output--> innerHTML
```

Two details that are not free to change:

- **Math is tokenised by a marked extension, not pre-extracted.** Markdown
  therefore never sees the inside of a formula and cannot mangle `_`, `*` or
  `\\`. The inline rule is LaTeX's *(2026-11)*: every unescaped pair of
  dollars is a formula, whatever it holds, and `\$` is a literal dollar. Inside
  a formula a backslash escapes the next character, so `$a\$b$` is one formula,
  and `$$…$$` within a line is display math there. The earlier rule guessed at
  prices: it refused a `$` followed by a space or a digit, which kept
  `$5 and $10` as prose but left `$2x+1$` and `$ x $` as plain text. Pandoc's
  subtler guess (no space just inside the dollars, no digit after the closing
  one) was tried the same day and dropped as well: for a mathematician a
  formula that renders as written is worth more than an unescaped price. The
  rule exists three times: in `viewer.js`, in the exported page's renderer in
  `export-html.js`, and in that renderer's minified copy, regenerated with
  `_tools/minify_render.py`.
- **A display formula ends at its first `$$`, and holds no blank line**
  *(2026-11)*, as in TeX, where a blank line inside math is an error. As a
  block it runs from a `$$` at the start of a block to a `$$` that ends its
  line; a paragraph stops for it only at a line that starts such a formula.
  Before, the block could run on to any later `$$`, so `$$…$$text` swallowed
  the headings and lists up to the next formula, and a paragraph stopped at any
  `$$`, which cut it in two at a `$$x$$` within a line.
- **A `$$` line stops a setext heading, as a code fence does** *(2026-11)*.
  Markdown makes text over a line of `=` or `-` a heading, and marked looks for
  such headings before it lets the math extension see a `$$` line. A formula
  written straight under a paragraph, with a lone `=` on a line of its own,
  therefore made everything above that `=` a heading, the formula included. A
  wrapper round marked's `lheading` refuses any heading whose text holds a
  line starting with `$$`; the paragraph then stops at that line and the math
  block takes it. Kept in the same three places as the inline rule.
- **A note's own HTML may not restyle the app, and KaTeX goes in after it is
  sanitised** *(2026-11)*. The preview is part of the app's page, so CSS in a
  note is the app's CSS: a `<style>` could hide the editor, an inline style lay
  a fake dialog over it, and a class or id borrow the app's own rules (the
  projector's `.blank-screen` is fixed, full-screen and black). A form could
  post what is typed into it anywhere. So DOMPurify removes `<style>`, every
  `style` attribute, forms and their controls (a task list's checkbox stays,
  disabled), and every class but a code block's `language-…`; ids get the
  prefix `user-content-`, as on GitHub, and links to them follow. KaTeX's
  output needs inline styles, so formulas wait as placeholders while the HTML
  is sanitised and are put in afterwards: KaTeX writes its HTML from the TeX
  alone and escapes all of it. A placeholder carries a key fresh for each
  render, so one written into a note by hand pulls in nothing. Sanitising used
  to run over KaTeX's output, with the `mathMl` and `svg` profiles kept so that
  its MathML and SVG survived; those profiles now serve a note's own MathML
  and SVG, and KaTeX's MathML keeps its TeX annotation, which they stripped.
  A note's inline colours are lost with the styles; GitHub drops them too.

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

The helper is `loadScript` in `src/load-script.js`; the editor, the front page
and the Drive adapter all load through it. reveal.js needs no such care: only
the projector page (`present/`) includes it, so a reader never fetches it.

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

**Closing a note never throws away unsaved work** *(2026-09)*. A note with
unsaved changes asks first: save it, or discard it to the **bin**. The bin is
listed in Settings, where a note can be restored, and it purges a note after 15
days (adjustable). A note with nothing unsaved is simply removed. Its content is
already in its file, or was never worth keeping, so there is nothing to recover
and no reason to fill the bin with it. Deleting from Settings is explicit and
confirmed. The invariant: every note in storage is either open in a tab or in
the bin.

**The bin holds only what was discarded** *(2026-11)*. Choosing *Save* in the
close dialog removes the note once the save has finished, exactly like a clean
close. Before, it binned the note, so the same note could end up in the bin or
not depending on how it was closed. For a note with no file yet, *Save* first
asks where to save, and the close finishes only after that choice saves it; if
that dialog is dismissed or the save fails, the note stays open. A note
"saved" only by *Download* is likewise removed on close. That trusts the
download, which by default goes straight to the Downloads folder; the rare
download that fails silently is an accepted risk.

This replaces the first version's rule that a closed note always stayed in
storage. That rule fitted a time when this database held the *only* copy of
every note. Once notes could be saved to a real file, keeping every closed one
mostly kept copies of files that already exist.

**A failed write is shown, never only logged** *(2026-11)*. When IndexedDB
refuses a write, the latest edits exist only in the tab's memory, so the note's
status says **Storage error** and a notice under the bar says what that means.
A full quota or disk is reported only when the write commits, as an aborted
transaction with no `error` event, so every write listens for `abort` as well.

- **Nothing leaves memory unasked before its write has succeeded.** A note the
  bin refused is dropped only after the user agrees, and leaving the page while
  it holds refused text raises the browser's own "Leave site?" question.
- **The error lasts while the page holds the only copy.** Once the note is
  saved or downloaded, its source's status shows again. A refused note is
  tried again from the notice's *Try again* and on returning to the page,
  which is when space has usually been freed.
- **A database that will not open is a state of the whole page**, told once at
  startup by a notice that stays, rather than by the first failed write. It
  usually means the browser was set to block site data, so the notice links to
  the FAQ answer that says how to allow it.

**A newer build in another tab takes the database over** *(2026-11)*. A schema
upgrade waits until every open page lets go of the database. An older page
first writes what it still holds, then lets go and asks to be reloaded, and from
then on every write fails with that message. Without this, its connection
closed silently and every later save failed unseen.

The mental model is a desktop editor. IndexedDB is the scratch area, and a file,
on disk or in Drive, is the real copy. Until a note has been saved to one, the
browser holds the only copy. README's *Drafts are local* tells the user so.

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

## Cloud saving

How Google Drive is set up, step by step, is in [CLOUD-SETUP.md](CLOUD-SETUP.md).
How a note's status is decided is in [STATUS.md](STATUS.md). The decisions behind
them:

- **One OAuth client for both origins** *(2026-08)*. `localhost:8001` and
  `lemma-md.github.io` share it, with one committed `src/config.js`, so nothing
  is switched at deploy. Separate development and production projects were
  considered and declined; the reasoning is in CLOUD-SETUP.md, step 4. If
  per-environment values are ever needed, branch on `location.hostname` at
  runtime rather than swapping the file, which without a build step would mean
  doing it by hand.
- **The access token lives in memory only** *(2026-08)*. It is a bearer
  credential. It lasts about an hour, and the browser flow issues no refresh
  token, so storing it would save at most an hour of reconnecting. A connection
  survives a reload another way: the chosen folder is remembered in IndexedDB,
  and the token is re-requested silently. The accepted price is that someone
  signed in to several Google accounts sees Google's account chooser once after
  a reload. That is expected behaviour, not a bug. Asking for an identity scope
  to preselect the account was declined as well: it would widen a consent
  screen that is deliberately kept to `drive.file`.
- **A Drive file is never overwritten blindly** *(2026-08)*. A note remembers
  the file's `headRevisionId`, name, parents and trashed flag as of its last read
  or write. A save fetches them again first. If anything differs, the save asks
  what to do: overwrite, take theirs, or save a copy, with *Compare changes* to
  see the difference. Drive's revision id was chosen over modified-time and
  size because it changes on every content edit. When you come back to the tab,
  open notes are re-checked, but only if a token is already live, so the check
  never causes a sign-in popup.
- **The moment between that check and the write is left open** *(2026-11)*.
  Drive API v3 has no conditional write: files carry no ETag, so the server
  cannot refuse a save made over a change it has not seen. The old v2 API can
  (`If-Match`, answered with 412), but taking on a second, older API version
  for a window of about a second was judged not worth it; and a change caught
  after the fact could only be pointed to in Drive's own version history.
- **A late answer is applied to what asked for it** *(2026-11)*. Drive answers
  in its own time, and the page goes on meanwhile. So *Save As* takes its note
  when it is asked for, not when it is confirmed: another tab may be opened
  while the dialog gets ready. Its folder listings carry a generation number,
  and one for a folder already left is dropped, so the list always matches the
  breadcrumb; saving waits until the list is in. *Reload theirs*, from Drive or
  from disk, asks again if the note was edited while the file was loading,
  since those edits were not what the choice was about.
- **A file on disk is never written over blindly either** *(2026-11)*. Before
  saving, the file is read and compared with the text last saved or opened:
  by content alone, since an edit can leave the date and size as they were,
  and a save that changes nothing still touches them. A file that cannot be
  read (moved, deleted, locked) is not taken as unchanged: the save asks,
  offering *Save a copy…* or *Write anyway*.
- **Cloud errors are reported with `alert()`** *(2026-08)*. It is crude but
  adequate. Revisit only if it starts to grate.

## Export

- **`.md`** is the primary format and the anti-lock-in guarantee: the note is
  always a plain text file that opens in VS Code, Obsidian or any online editor.
- **`.html`** a standalone page that renders the note — Markdown and TeX — on
  its own in any browser (`src/export-html.js`). The original markdown is
  embedded HTML-escaped in a `<script type="text/markdown">` block: escaping
  keeps it byte-for-byte and unable to break out of the tag, so dragging the
  file back in restores the *exact* source rather than reverse-engineering it
  from rendered HTML. Only Windows line breaks change: the HTML parser turns
  `\r\n` into `\n`. The libraries load from a CDN, pinned to the same versions
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

**Presentations have a page of their own** *(2026-11)*, `presentations/`,
linked from the front page next to *Open the editor*, from its *Slides* card
and from the editor's menu. It lists every presentation in this browser and
shows one again in the projector window, from the slide it stopped at. It is a
page, not a dialog in the editor, so that it can be opened beside a talk and
reached without opening a note.

- **For now a presentation is still its note.** The projector reads the note
  by its id and keeps the ink and the last slide shown under that id, so a note
  counts as a presentation once presenting it has left either behind
  (`src/present/catalog.js`). ROADMAP 2.1 makes it a record of its own.
- **A board of its own** *(2026-11)*: *Start with a blank board* on the page
  begins a talk with no note and no slides, and the projector opens on the
  board. Already the shape 2.1 gives every presentation, in small: a meta cell
  `present-board:<id>` marks it and holds when it began, and its ink is kept
  under that id as a note's is. With no note behind it, closing a note can
  never take its drawings. It is listed once something is drawn on it, so a
  board opened and left blank leaves no line. Opening on the board does not
  become the mode the next talk opens in. The projector's window is opened
  in the click, before the board is written, where a popup blocker allows it.
- **The projector opens in its own window**, named after the note as the
  editor's *Present* names it: from either place, a presentation already
  showing comes forward instead of opening twice.
The full design, data model, meta keys and hard-won lessons are written up in
[PRESENTER.md](PRESENTER.md) — start there when touching the presenter.

Some things are deliberately **not** reveal's:

- **Rendering.** reveal's markdown/highlight/math plugins stay off; each slide is
  produced by the app's own `render()` (`src/viewer.js`). One markdown+TeX
  pipeline, so a slide is byte-identical to the same note read in the editor —
  the same reason the landing page and the editor share `render()`. Slides are
  split on a line of `---` (never inside a `$$…$$` or fenced-code block), with an
  optional YAML front-matter block becoming a title slide; both are borrowed
  conventions (Jekyll, Marp), not a borrowed renderer. A fence closes as in
  CommonMark, only by the same character run at least as long, and `$$` in
  inline code opens no formula *(2026-11)*. Front-matter makes a title slide
  only when it holds a title field (`hasTitle` in `deck-dom.js`), in the
  projector and the editor's preview alike: one with only options such as
  `fontsize:` makes none, and a card in one but not the other would number the
  slides differently.
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

## The site's pages

**The front page, presentations and help share one layout** *(2026-11)*,
first made for the FAQ: a column on the left with the logo and the page's
own contents, always in view, the part being read marked (`src/toc.js`,
`body.paged` in `landing.css`). The privacy policy keeps the plain page.

- **The page's own contents, not a map of the site.** A map in that column
  was the alternative, with each page's parts under its name; on most pages it
  would bury the few entries the reader needs under the ones they do not.
  First the way to the rest of the site, then the page's own parts under the
  page's own name rather than "Contents" (*Welcome*, *FAQ*, *Editing*,
  *Presenting*, *Troubleshooting*). The first is *Jump in* on the front page,
  where it leads into the tools and the guide, since that is what most people
  come to it for, and *Go to* elsewhere. The guide's own page lists its
  sections there, each opening the section's page in one click rather than
  scrolling to it, and each section's page lists the others under *Other
  guides*. The presentations page has only *Go to* for now: its own parts
  would be sections of the page, and listing the presentations there was
  tried and dropped. A group with nothing in it is not shown.
- **On a narrow screen the column is a bar** with the logo and a ☰ button,
  and the contents open below it, so the logo stays in view with them, as it
  does on a wide screen. Without the script the contents stay open below the
  logo and nothing sticks.

## Help

**Help, called the *Guide*, is a page of sections, `help/`, each a page of
its own** *(2026-11)*:
the FAQ (`help/faq/`), the editor and presentations, whose pages are
placeholders listing the answers to come, and troubleshooting
(`help/troubleshooting/`). The guide's own page is their contents: every
answer, under its section, worded as its page words it, with a test to keep
the two in step; a placeholder lists what it will answer, without links. Each
section links back to
`help/` above its title. The front page links to help under its buttons,
in *Jump in*, and in a sentence after a few of its questions, which lead
into the FAQ; the editor's menu opens `help/`.

**The FAQ answers what a usual web app would not need to.** There is no
server, a note lives in the browser until it is saved, and saving into a
file works only in Chromium browsers. Each answer is a section of its page.
The first one's anchor is the page itself (`main#markdown`), so arriving at
it shows the page's title rather than a heading cut loose from it;
troubleshooting does the same for its first problem.

- **Plain HTML**, like `privacy.html`, on the front page's stylesheet. A
  Markdown file shown by the app's renderer was the alternative: it would read
  like a note, but needs scripts to show anything, and the Jekyll that GitHub
  Pages runs may render a `.md` file as a page of its own. The one script, for
  the examples in *What is Markdown?*, renders them with the editor's own code
  (`src/examples.js`), so they cannot drift from what the editor produces;
  without it they still show their source. They lived on the front page until
  it turned to what the app does *(2026-11)*.
- **English only**, like the rest of the site.
- **The site's name is set in the formulas' typeface on a light blue** in
  running text (`<span class="brand">`, KaTeX's Computer Modern, the tint of
  the browser boxes) *(2026-11)*. In the body font the lowercase, hyphenated
  *lemma-md* was lost in a sentence, and the typeface alone was still too
  quiet. Bold is what the help already uses for the labels of a browser's
  settings; a colour of its own read as a link, or as a visited one; white on
  the logo's blue shouted on a page that names the site sixteen times. The font
  is declared in `landing.css` from KaTeX's files, so pages without KaTeX can
  use it, and only its faces in use are fetched. A test fails on a name left
  unmarked.
- **Paths in words, no screenshots**, for now. A screenshot of a browser's
  settings dates with every release of that browser, and a page of them would
  be wrong somewhere at any moment. Each step names the menu path, and also the
  settings page's own address where the browser has one
  (`chrome://settings/…`), which outlasts a renamed menu.
- **Section anchors are permanent.** The app links to them through
  `src/help.js`, so renaming one breaks a link in a build already out.
- **A problem goes to troubleshooting, not to the FAQ.** A browser that
  will not let the site store anything is not a question people ask about
  the site but a message they meet in it; its page is headed by that message,
  so that it is found by what the reader saw. It moved there from the FAQ
  before help was first published *(2026-11)*, so no link already out pointed
  at the old place.
- **A notice that points at a browser setting links to the answer** instead of
  giving the steps itself. The steps differ by browser and change with its
  releases; one page is easier to keep current than strings in the code. The
  link opens in a new tab, since the editor may hold the only copy of a note.
  The menu's *Help* reuses one named tab rather than opening a new one on every
  click.

## Tests

**A test page in the browser, with no framework** *(2026-11)*.
`_tools/tests/index.html`, opened from the local server, imports the app's own
modules and runs them in the engine a reader uses. The runner is a file of
about a hundred lines (`runner.js`): `suite`, `test`, a few assertions, a time
limit per test, and the result in the page title and `window.testResults`, so
that something driving the page can read it without looking.

- **Not Node, not npm.** The app is written for the browser: DOMPurify needs a
  DOM, the editor needs a page. A framework would mean a `package.json` or a
  vendored copy, for little more than the runner already does.
- **In `_tools/`**, so Jekyll leaves it out of the site, like the other
  development scripts.
- **The export is tested offline.** The downloaded `.html` loads its libraries
  from a CDN; the tests swap them for the vendored copies, and check first that
  the versions are the same, which is what makes the swap fair.
- **Links into help are found, not listed.** The help tests read the app's
  own files for `helpUrl('…', '…')` and `help/…/#…`, so a new link is checked without
  anyone remembering to add it.
- **Storage tests never touch real notes.** `drafts.js` takes its database name
  from `globalThis.lemmaTestDatabase` when set, and only the test page sets it:
  to `lemma-md-test` for anything that loads the module there, and to a name of
  its own for each storage test, which deletes that database afterwards. Each
  test also imports a fresh copy of the module (`drafts.js?run=…&instance=…`),
  since the module keeps its connection; the query changes on every run, so
  the browser cannot serve a copy cached before an edit.
- **Failures are real where they can be.** An upgrade from another tab and a
  database a newer build has upgraded are produced for real. A full disk and
  blocked storage cannot be made from a page, so they are imitated with the
  events a browser sends: a write whose transaction aborts at commit with no
  `error` event, an open that fails or throws, and no `indexedDB` at all. A
  write must reject within three seconds: hanging is the failure being guarded.

- **The editor is tested whole, in a frame** (`editor-harness.js`). The real
  `editor/index.html`, given as `srcdoc` so a script runs before the app: it
  sets a test database, makes the frame report itself visible (an automated
  tab is usually hidden, and the app re-checks files and Drive only while
  visible), answers and records `confirm()` and `alert()`, catches downloads
  and `window.open`, and can refuse every write the way a full disk does.
  Tests then click and type through the DOM and read the database directly.
- **Files on disk are real files** in the browser's private file system
  (OPFS): its handles are genuine `FileSystemFileHandle`s, which the app reads,
  writes and stores like a file the user picked. Only the pickers are stubbed.
  A declined permission is set as own properties on such a handle, which
  storing it in IndexedDB leaves behind.
- **Google Drive is a stand-in** (`fake-drive.js`): the provider's methods
  replaced, in the same module instance the app uses, by an in-memory Drive
  that can also change, rename, move or trash a file from outside. It tests
  the app's handling of Drive, not `gdrive.js`'s requests to Google.
- **Coming back is repeated.** The app re-checks files and Drive on focus but
  not more than once in three seconds, and a frame can get a real focus event
  of its own, so a test dispatches `focus` until the change is noticed.
- **What runs is what is on disk.** Before loading anything the page fetches
  every module the tests reach, the app's included, with `cache: 'reload'`
  (`fresh.js`), so a plain reload runs the code as it is now even from a server
  that sends no cache headers. The one the start scripts run sends
  `no-cache` anyway.

What is covered so far: the rendering rules (formulas, display blocks,
headings, sanitising), the export against the preview with both copies of its
renderer, the round trip of a note through the `.html`, cutting a note into
slides, the templates, the FAQ links, browser storage (notes, the bin,
settings, and every failure the app shows), and the editor's flows: autosave,
statuses, closing and the bin, the storage notices, files on disk, and Drive.

## Deployment

GitHub Pages; the repository is the site. For a project page the app is served
from a sub-path, so every asset reference must stay relative.
