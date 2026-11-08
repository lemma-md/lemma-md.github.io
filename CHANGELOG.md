# Changelog

What shipped, and when. The site is published straight from `main`, so a date
is a release. One line per change a user would notice; fixes are listed when
they mattered.

This is the *when*. The *why* behind a decision is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and what is still to come is in
[docs/ROADMAP.md](docs/ROADMAP.md).

## 2026-11-09

### Added

- **Export as .tex**, in the editor's menu, beside *Export as PDF…*. A note becomes a LaTeX article,
  and a note shown as slides a Beamer presentation, its front-matter the title
  page. Formulas go as written; Greek letters, symbols such as ∈ or ℝ, and
  KaTeX's own macros are made LaTeX's, and emoji left out. The preamble follows
  the text: pdfLaTeX for English, accented Latin and Cyrillic, LuaLaTeX for
  Chinese, Japanese, Korean, Arabic and Hebrew.

## 2026-11-08

### Added

- A **Presentations** page, linked from the front page and the editor's menu.
  It lists every note presented in this browser, with its title, slides and
  drawings, and shows one again from the slide it stopped at. *Start with a
  blank board* opens the projector on a board with no slides, for a talk at
  the blackboard; once drawn on, it is listed with the others.
- A **Guide**, linked from the front page and from the bottom of the
  editor's menu, in sections. Its FAQ answers what Markdown is, why the site exists,
  why there is no server or account, saving into files on disk (and why only
  in Chromium browsers), where notes are kept before they are saved, and
  which other tools view and edit `.md` files. Troubleshooting explains how
  to let the site store data, and the app links there when a browser setting
  is in the way. Sections for the editor and presentations are to come.

### Changed

- The front page, presentations and help share the FAQ's layout: the logo and
  the page's contents in a column on the left, always in view, the part being
  read marked. On a phone they fold into a bar with a ☰ button. On the front
  page the column starts with *Jump in*: the editor, presentations, and the
  guide; on the guide's pages and presentations, with *Go to*. The front page
  gives the address to write to.
- The front page has a new headline and says what you can do, from sharing
  math as plain text to giving a talk and reviewing the board, instead of
  listing tools, and a few questions that lead to the FAQ. What Markdown
  is, with its examples, why the site exists and the other tools to view and
  edit `.md` move there.
- The privacy policy names the site's host, GitHub Pages, which logs the IP
  address of each visit, and says that the site loads nothing from any other
  host but Google's, once you connect to Drive.
- A new blank note starts empty, instead of with a `#` heading to type over.
- The toolbar status of a new note says **Not saved**, in amber, once it has
  been edited, and nothing before that. It used to say "New" in grey, which
  read as the *New* command.
- Only a note closed with *Discard changes* goes to the bin. One saved from the
  close dialog is closed like any saved note.
- Inline formulas follow LaTeX's rule: every pair of dollars is a formula,
  including one that starts with a digit (`$2x+1$`) or has spaces inside
  (`$ x $`), and `\$` writes a literal dollar. A price written with a bare `$`
  now reads as math: write `\$5`. The same in a downloaded `.html`. The
  welcome note says so.
- A note's own HTML can no longer restyle the app or show a form: styles,
  forms and classes are removed from it, and its ids are prefixed, as on
  GitHub. A note opened from somewhere else could otherwise hide the editor
  or lay a convincing fake dialog over it. Inline colours in a note go too.

### Fixed

- The editor's slide preview shows a title slide only when the projector
  does: front-matter holding only options, such as `fontsize:`, makes none.
- Slides are no longer split at a `---` inside a code block that holds a
  shorter fence or one of the other kind, nor run together by `$$` in inline
  code.
- Slow answers from Drive are applied to what they were for. *Save As* saves
  the note it was opened for, even if another tab is opened while it gets
  ready; a folder's listing that comes late no longer replaces the one on
  screen; and reloading a note from Drive or disk asks first if it was edited
  while the file was loading.
- Saving to a file on disk that cannot be read (moved, deleted, locked by
  another program) asks first, instead of writing over it unchecked. An edit
  made on disk is noticed even when it left the file's date and size as they
  were.
- Edits made just before switching tabs, or just before leaving the page,
  could be lost on a reload.
- Text typed while a save was in progress could be marked as saved though the
  file held the older version.
- *Save* in the close dialog of a new note saved it but left the tab open.
- When this browser refuses to store a note, for example because it is out of
  space, the note shows **Storage error**, on phones too, and a notice says the
  latest changes are only in this tab. Before, the failure went only to the
  console, and a full disk was not noticed at all. The note is stored again
  with *Try again* or on coming back to the page, and the error clears once the
  note is saved or downloaded. Discarding it asks first, since the bin cannot
  take it.
- A browser set not to let sites store data is recognised at startup: a notice
  that stays says nothing will be kept, and links to how to allow it. Settings
  says the same, and opens at all.
- Leaving the page, or reloading it, while it holds text the browser refused
  asks first.
- When the app is updated in another tab, this page first stores what it
  holds, then asks to be reloaded, instead of quietly failing every later save.
- Renaming a Drive note counts as an unsaved change, so closing it no longer
  drops the new name.
- `$$…$$` in the middle of a line shows as a display formula instead of an
  error.
- A display formula with text right after its closing `$$` no longer swallows
  everything up to the next formula, headings and lists included.
- In a deck, a `$$` left unclosed no longer merges every later slide into one:
  a blank line ends the formula, as it does in the preview.
- A `$$` formula written straight under a paragraph, with a line holding only
  `=` or `-`, no longer turns the text above it into a heading and breaks the
  formula.

## 2026-09-21

### Changed

- **Compare changes** opens on its own from *File info*, offering to discard
  your edits or reload the file underneath. It shows only the comparisons that
  actually differ and lands on the one that matters.

## 2026-09-20

### Added

- **Export as PDF**, through the browser's own print, with an in-app preview.
  A deck prints one 960×700 page per slide (from the presenter, with its
  annotations and any non-empty board pages). A plain note prints as flowing A4
  pages. Text and formulas stay selectable, and ink stays vector.
- `fontsize:` in a deck's front-matter sets the type size for the whole deck.

## 2026-09-16

### Added

- A privacy policy page.

### Changed

- Google's consent screen is published to production, so connecting to Drive no
  longer shows an "unverified app" warning.

## 2026-09-11

### Added

- **Slides.** A note presents as slides, split on `---`, in a separate projector
  window. A front-matter block becomes a title slide, and a comment at the top of
  a slide can centre it or set its class or background.
- Three presenter modes, **Present**, **Annotate** and **Board**, with a laser
  pointer, pen, chalk, highlighter and eraser. Ink is vector and kept per note in
  the browser, so it comes back next time.
- A multi-page **board**, blackboard or whiteboard, to work on mid-talk, and a
  thumbnail overview of the slides or the board pages.
- New notes from a template: blank, the welcome guide, or a slide demo.
- MIT licence.

## 2026-09-10

### Added

- **Files on disk.** Open a file and save back into it where the browser allows
  (Chromium on desktop). Elsewhere, open by drag-and-drop; saving downloads.
- **Compare changes**: a side-by-side diff of a note as last saved, as it is in
  its file or Drive, and as it is in the editor. Every conflict prompt offers it.
- **Download as `.html`**: a page that renders the note, Markdown and TeX, in any
  browser, and gives back the exact source when dragged back in.
- **A bin.** Closing a note with unsaved changes asks first. A discarded note
  goes to the bin in Settings and can be restored there for 15 days (adjustable).

### Changed

- Closing a note that has nothing unsaved removes it without asking, since its
  content is already in its file.

## 2026-08-27

### Added

- **Google Drive.** Connect once, open a note from Drive and save it back, into
  a folder chosen with the app's own picker. The connection survives a reload.
- Rename a note by double-clicking its tab; the new name reaches Drive on the
  next save.
- A **status** for every note in the toolbar, with a *File info* panel. A note
  changed, renamed or trashed in Drive is noticed, and saving asks first
  instead of overwriting.

## 2026-08-25

### Added

- A front page that explains markdown and links to the tools. The editor moves
  to `editor/`.
- **Reading and writing** as two modes (`Ctrl+E`). A note opens as a finished
  page, and the editor is downloaded only when first asked for.
- A slim bar holding the mode toggle and a menu that shows every shortcut.
  Shortcuts work on any keyboard layout, Cyrillic included.

## 2026-08-09

### Added

- First version: Markdown with TeX formulas, typeset live beside the text.
- An editor with line numbers, syntax highlighting and search.
- Several notes in tabs, saved automatically in the browser and restored when
  you come back. Download as `.md`.
- A Settings window listing every saved note, with the space they take and
  whether the browser has agreed to keep them permanently.
