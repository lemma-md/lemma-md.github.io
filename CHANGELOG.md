# Changelog

What shipped, and when. The site is published straight from `main`, so a date
is a release. One line per change a user would notice; fixes are listed when
they mattered.

This is the *when*. The *why* behind a decision is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and what is still to come is in
[docs/ROADMAP.md](docs/ROADMAP.md).

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
