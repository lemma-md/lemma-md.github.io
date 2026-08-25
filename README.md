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
- download as `.md`

Planned, roughly in order:

1. export to a self-contained `.html` (formulas included, opens anywhere) and to PDF
2. slide presentation with pen, highlighter and laser pointer
3. opening and saving real files on disk, where the browser allows it
4. optional syncing to a private GitHub repository or a cloud drive

## Drafts are local

Notes live in **this browser on this computer** and are not uploaded anywhere.
Clearing site data removes them. Use *Download* to keep a copy. Syncing is on
the roadmap above, deliberately last — see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

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

src/landing.js      renders the front page's examples with viewer.js
src/app.js          tabs, drag & drop, autosave, pane splitter
src/viewer.js       markdown + TeX -> sanitised HTML
src/editor.js       Ace, loaded on demand
src/drafts.js       IndexedDB persistence
src/settings.js     the Settings window
src/storage/        cloud providers behind one interface (see docs/CLOUD-SETUP.md)
src/config.js       the app's own Google ids — empty until you fill them in

src/theme.css       colours, reset, base type — every page
src/markdown.css    how rendered markdown looks — every page that renders it
src/landing.css     the front page
src/ui.css          the editor's chrome

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
