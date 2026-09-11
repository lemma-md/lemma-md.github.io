# lemma-md

A browser notepad where formulas are visible as you type.

Write plain text on the left, see it typeset on the right. Nothing to install,
no account, no server — open the page and start writing.

## Who this is for

Mathematicians who are not programmers, and who have not yet had a reason to
care about markdown. The design target is the first thirty seconds: a sample
note with formulas is already on screen, editing it visibly changes the output,
and nothing asks for a login.

The bridge is TeX, not markdown. `$\int_0^1 f$` is already familiar; `#` and
`**bold**` are the small tax, and the app tries to teach only that much.

## What it is not

Not a replacement for Overleaf or LaTeX. Overleaf wins for papers. This is for
the half-page lemma you want to write down *now*, without creating a project,
picking a document class or waiting for a compile.

## Status

Working today:

- reading and writing as two modes, one button apart — a note opens as a
  finished page, and the editor appears only when asked for. Nothing of Ace is
  downloaded until then, which is 565 kB, or 47% of everything vendored
- a bar holding only that toggle and a menu button, so the tab strip keeps its
  room; everything occasional lives in the menu, each entry showing its shortcut
- shortcuts: `Ctrl+E` read/write, `Ctrl+O` open, `Ctrl+S` download, `Alt+N` new,
  `Alt+W` close. New and close sit on Alt because Chrome and Firefox reserve
  `Ctrl+N`, `Ctrl+W` and `Ctrl+F4` for their own windows and tabs and never
  deliver those keypresses to a page — a binding there would look right and do
  nothing. Matching is on the physical key, so a Cyrillic layout does not
  silently break them
- live preview of markdown with TeX formulas
- editor with line numbers, syntax highlighting and search
- multiple notes in tabs, restored when you come back
- automatic saving of drafts; closing a tab keeps the note, it does not delete it
- a Settings window listing every saved note — reopen or delete any of them —
  along with how much space they take and whether the browser has agreed to
  keep them permanently
- download as `.md`, or export a self-contained `.html` that renders the note —
  Markdown and TeX — anywhere, and can be dragged back in to recover the source
- open and save real files on disk where the browser allows it; elsewhere, open
  by drag-and-drop and "save" means download
- save notes to Google Drive and open them back, with conflicts and outside
  changes noticed before anything is overwritten
- present a note as slides — split on `---`, shown in a separate projector
  window with a laser pointer, pen, chalk, highlighter and eraser you can draw
  over the slide with, plus a multi-page blank board (black or white) to work on
  mid-talk; the ink is vector and saved per note
- new notes from a template — a blank note, the welcome guide, or a slide demo

Planned, roughly in order:

1. a proper **PDF** export (for now, your browser's Print dialog does it — from
   the projector, that prints the slides)
2. optional syncing to a private **GitHub** repository

Further out:

- **presentation themes** — swappable colour / spacing / font sets, each a
  separate CSS file layered over the shared slide styles (the slide look already
  lives in its own CSS, and reveal.js themes via CSS custom properties, so this
  is mostly packaging). Chosen per deck with a `theme:` line in the front-matter
  — the first deck-wide setting — and switchable from the projector via a menu.

## Drafts are local

Drafts live in **this browser on this computer**: they are not uploaded anywhere
on their own, and clearing site data removes them. Keep a copy by downloading it,
saving it to disk, or saving it to Google Drive — until you do, the browser holds
the only copy. Why cloud saving came late, and how narrowly it is scoped, is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Presenting

*Present* (in the menu, or `Alt+P`) opens the current note as slides in a
separate window — the projector — leaving the editor where it is. Slides are the
same rendered Markdown and TeX you see while reading; only the layout changes.

- **Slides** are separated by a line containing just `---`. A note with none is a
  single slide.
- **A title slide** is made from a front-matter block at the very top —
  `title`, `author`, `affiliation`, `place`, `date`:

  ```markdown
  ---
  title: Dessins d'enfants and the Galois action
  author: N. Adrianov
  affiliation: Moscow State University
  place: Oberwolfach
  date: 2026-09-11
  ---

  # First slide
  ...
  ```

- **Per-slide tweaks** go in a comment at the top of a slide: `<!-- center -->`
  centres it, `<!-- class: foo -->` adds a CSS class, `<!-- bg: #fff -->` sets a
  background.
- **Three modes**, on the buttons top-left (and in the menu top-right):
  **Present** (`Alt+P`) shows the slides with only the laser pointer;
  **Annotate** (`Alt+A`) adds the drawing toolbar so you can mark up the slides;
  **Board** (`Alt+B`) is a blank surface to work on mid-talk. Each mode remembers
  its own tool and colour, and the mode you were in is restored when you reopen.
- **Drawing.** The toolbar down the left has a laser pointer, a pen, chalk, a
  highlighter and an eraser (which rubs out just the part you drag over). Pen and
  chalk vary their width as you draw — thin when quick, thick when slow, or by
  stylus pressure. Marks are vectors, kept per note in this browser — not written
  into the `.md`, which stays plain text — so they come back the next time you
  present the same note. `Ctrl+Z` / `Ctrl+Y` undo and redo on the current surface.
- **The board** is a blackboard by default (chalk colours, notebook squares);
  *Settings* (in the menu) turns it into a whiteboard or hides the grid. It holds
  as many pages as you like — page through them with the navigator on the right (or
  the arrow / `PgUp` / `PgDn` keys); once a page has ink on it, its down arrow
  grows a **+** that adds a fresh page. A colour keeps its identity across
  surfaces: the same swatch is black ink on a slide or whiteboard and white chalk
  on the blackboard.
- **Overview.** `=` (or a click on the page number, right) opens a scrollable
  grid of thumbnails — the deck's slides, or the board's pages when you are on the
  board. Arrow keys move, `Enter` or a click opens one.
- **Keys.** Tools are on `1`–`5` (laser, pen, chalk, highlighter, eraser). The
  menu lists every shortcut, and **Help** in it opens the full reference.

## Running it

There is no build step, only a static file server. From the repository root:

```bash
./_tools/lemma_start.sh
```

and, when you are done, `./_tools/lemma_stop.sh`. On Windows the pair is
`_tools\lemma_start.cmd` and `_tools\lemma_stop.cmd`, either of which can be
double-clicked.

Starting checks that the Python it found is 3.7 or newer — `python` earlier in
`PATH` has been a 3.6 from 2017 on one machine here, and it failed in a way
that looked like a network fault. It also refuses to start on a port that is
already taken, rather than leaving you talking to an older copy while you edit
files nobody is serving.

Stopping is for when the server has no window to press Ctrl+C in: started by a
tool, or left behind by a console that has since been closed. It finds the
process by the port. On Windows use the `.cmd` version even from Git Bash,
which ships neither `lsof` nor `fuser`.

The equivalent by hand, if you would rather:

```bash
python -m http.server 8001
```

Then open <http://localhost:8001> for the front page, or
<http://localhost:8001/editor/> to go straight to the editor.
**Use that port and no other**: it is
registered with Google as an authorised origin, and the cloud features refuse
to start from an address that does not match exactly — see
[docs/CLOUD-SETUP.md](docs/CLOUD-SETUP.md). Opening `index.html` straight from disk does
**not** work — the code uses ES modules, which browsers refuse to load over
`file://`.

## Deployment

The repository *is* the site: GitHub Pages publishes the whole branch, so every
committed file becomes a fetchable URL — documentation and working notes
included. There is no build and nothing to run.

With one exception, which is a feature here rather than a nuisance. Pages
passes the branch through Jekyll, and **Jekyll drops anything whose name starts
with an underscore**. That is why the development scripts live in `_tools/`:
they are needed to work on the site and have no business being served from it.
The same applies to any `_drafts/` or `_scratch/` you may be tempted to add.

The trap is that the omission is silent — the file is in the repository, the
URL is a 404, and nothing reports the difference. Putting a `.nojekyll` file at
the root turns Jekyll off entirely and publishes everything verbatim; do that
only after moving `_tools/` somewhere else, or the scripts go up with the site.

One historical caveat, in case it resurfaces: Jekyll 3.3.0 briefly excluded the
whole `vendor/` directory, which would take every library with it. That was
reverted in 3.3.1, and only `vendor/bundle/` and its siblings are excluded now.
If the deployed site ever loses its libraries while working locally, this is
where to look first.

## Layout

The site has a front page and, under it, one directory per tool.

```
index.html          front page: what markdown is, and where the tools are
editor/index.html   the editor; loads the vendored libraries and the sprite
present/index.html  the projector window; loads reveal.js and the ink layer

src/landing.js      renders the front page's examples with viewer.js
src/app.js          tabs, drag & drop, autosave, pane splitter
src/viewer.js       markdown + TeX -> sanitised HTML
src/editor.js       Ace, loaded on demand
src/present/        slide splitting, reveal.js setup and the drawing tools
src/drafts.js       IndexedDB persistence (notes and presentation ink)
src/settings.js     the Settings window
src/storage/        cloud providers behind one interface (see docs/CLOUD-SETUP.md)
src/config.js       the app's own Google ids — empty until you fill them in

src/theme.css       colours, reset, base type — every page
src/markdown.css    how rendered markdown looks — every page that renders it
src/landing.css     the front page
src/ui.css          the editor's chrome
src/present.css     the projector and its tools, on top of reveal.js

vendor/             third-party libraries, committed (see VENDOR.md)
_tools/             scripts for working on the site, never published — see
                    Deployment for what the underscore does
```

The stylesheets are split that way because the front page shows rendered
markdown too, and it is a promise about what the editor produces. A second copy
of those rules would eventually make it a false one.

Paths inside `src/` resolve against the module, not the page — `editor.js`
builds Ace's URLs from `import.meta.url`. A bare relative path would be looked
up beside the HTML, which now lives one directory down, and the failure is
silent: the editor just never appears.

`favicon.svg` is the only place the logo is drawn. The PNG copies beside it —
`favicon-16`, `favicon-32`, `apple-touch-icon` (180 px, deliberately
full-bleed because iOS applies its own rounded mask) and `logo-120` (the size
Google's consent screen demands) — are rendered from it by
`_tools/make-icons.ps1` and should be regenerated rather than edited.

Why it is built this way — and why there is no bundler — is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
