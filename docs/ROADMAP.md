# Roadmap

The big features still to build, grouped by the part of the app they belong
to, with the questions to settle before or while building them. Within a
section, items are in the order they will be done. It lives here rather than in
a chat so the reasoning survives.

The docs split the work three ways:

- **here**: what comes next, and what is still undecided about it;
- [ARCHITECTURE.md](ARCHITECTURE.md): decisions, by topic, about what is
  built. A question settled before its feature ships is marked as decided here;
  when the feature ships, its decisions move there with their month;
- [CHANGELOG.md](../CHANGELOG.md): what shipped, and when. A finished feature
  leaves this file and gets a line there.

Small bugs are not tracked here. They are fixed, and the commit is the record.

## 1. Editor

### 1.1 Formulas that fail to render

KaTeX already marks them: with `throwOnError: false` it returns the formula's
source in red, with the class `katex-error` and the error message as a
tooltip. A note should say how many there are, with *previous* and *next* to
step through them; each step scrolls the preview to the formula and, while
editing, puts the cursor on its source, which the preview's line map gives
(`src/sync.js`, as Ctrl+click uses it). Formulas written as `\( … \)` were the
first such problem to be handled: the notice under the bar offers to fix them
(ARCHITECTURE → Rendering pipeline).

Open questions:

- **Where it shows.** The notice under the bar, as for `\( \)`, works while
  reading too, but holds one message; a slim panel along the bottom of the
  editor could list several kinds of finding, but only while writing.
- **What else counts as a problem.** For example an unclosed `$$`, which shows
  as raw dollars and TeX up to the next blank line, or an image that fails to
  load. Or a bare `$` that reads like a price (`$5`): every pair of
  dollars is math now, so a fix would escape it as `\$5`.

### 1.3 Inserting images

Today an image is only a Markdown link, `![](url)`, to a picture that already
lives somewhere on the web. Inserting one by pasting from the clipboard,
dropping a file in, or choosing one from disk needs somewhere to keep the
picture. That is the real question, because a note is a single plain `.md`
file.

Open questions:

- **Where the picture lives.** The options:
  - **inside the note**, as a `data:` URL. The note stays one self-contained
    file, but the source gains a long unreadable line, and the file grows by
    the picture's size plus a third (base64).
  - **next to the note's file**, on disk or in the same Drive folder, linked
    by a relative path such as `images/figure-1.png`. This is how other
    Markdown editors do it, and the `.md` stays clean. But a note with no file
    yet has nowhere to put it, and on disk it needs access to the folder, not
    just the one file.
  - **in this browser**, until the note is saved somewhere, then moved next to
    the file.
- **Drive images in the preview.** A picture in Drive cannot be shown by a
  plain URL: reading it needs the user's token, so the preview would fetch it
  through the Drive API. The PDF export already flags images it cannot load,
  for example Gmail attachment links.
- **Size.** Should a pasted screenshot be scaled down or recompressed before
  it is stored?
- **Pictures in Export as .tex.** Today a picture becomes a link to its web
  address (ARCHITECTURE → Export). Once pictures live with the note,
  `\includegraphics` needs them beside the `.tex`: download a `.zip` with the
  pictures, or leave the links for the user to resolve?

### Later

- **Merging** two versions in *Compare changes*, beyond choosing one side.
- **Open in Overleaf** directly, as well as *Export as .tex*. Overleaf
  accepts a document posted to it, but that sends the note's text to a third
  party, so it would be an explicit button, never automatic.

## 2. Presenter

### 2.1 Presentation management

Today a presentation *is* its note. The projector reads the note's current text
by its id, and the ink is stored under the note's id, numbered by slide. That
has three consequences:

- Editing the note moves the ink onto the wrong slides.
- Closing or deleting the note deletes the ink with it.
- Opening the same file again starts from nothing, because a reopened file
  gets a new note id.

The change is that a presentation becomes a record of its own:

- **A snapshot.** Starting a presentation copies the deck's text into it.
  Editing the note afterwards changes nothing in it, so its ink stays on the
  slides it was drawn on.
- **A source, not an owner.** A presentation remembers where it came from: a
  note in this browser, a file on disk, or a Drive file, along with its name.
  Closing, binning or deleting the note leaves the presentation alone.
- **The presentations page** (`presentations/`) exists already (see
  ARCHITECTURE → Presentation): it lists the notes that have been presented,
  with their title, source note, slides and drawings, and shows one again. As
  records it gains the date each was created and last shown, and *Delete* and
  *Start afresh* from the same source with no ink.
- **Start new** on that page asks where the presentation comes from: a note in
  this browser, a file on disk, or a file in Google Drive. That is a `.md` at
  first, and a `.pdf` too once 2.2 is done.
- **Starting afresh from the same source** reads it again: a note from this
  browser, a Drive file by its id (after sign-in), and a file on disk from the
  handle the browser kept (Chromium) or by picking it again.
- Ink, board pages, undo history and the last slide shown belong to the
  presentation, not the note.
- **Boards of their own already exist** (*Start with a blank board*): a meta
  cell `present-board:<id>` with the time it began, and ink under that id. The
  move to records carries them over as presentations with no source and no
  snapshot.
- PDF export from the projector prints the presentation, meaning its snapshot
  and its ink, not whatever the note says now.

Decided *(2026-11)*:

- **No drawing is ever lost as a side effect.** Closing a note, discarding it,
  deleting it from the bin, or the bin emptying itself leaves its
  presentations whole: snapshot, ink, board pages and history. Only *Delete*
  on the presentations page removes one. Today a note closed with nothing
  unsaved is deleted from the browser, and its ink and boards with it, for
  good and without passing through the bin.
- **The page reads figures, it does not work them out.** A presentation keeps
  its counts (slides, slides drawn on, board pages) and its dates with it,
  updated when they change, so opening the page parses no deck and reads no
  ink.
- **The editor's *Present* stays**, and goes straight to a presentation of the
  current note without the list. If the note's latest presentation has no ink
  yet, its snapshot is refreshed quietly. If it has ink and the text is
  unchanged, it continues. If it has ink and the text has changed, the editor
  asks whether to continue it or start a new one from the current text.
- **Deleting a presentation** asks for confirmation and then deletes it for
  good. There is no second bin.
- **Existing ink is kept.** Each note's current ink becomes a presentation whose
  snapshot is the note's text as it is now. That is the best available, since
  the text the ink was drawn on was never kept.

Still open:

- **Recognising a reopened file in the editor.** The editor's *Present* looks
  up presentations by note id, and a file opened again gets a new id. A note
  opened from Drive could also match by its Drive file id, which is stable. A
  file from disk has only its name to go by. Its old presentations stay on the
  presentations page either way.
- **Storage.** Settings should count presentations (snapshots, ink, later PDFs)
  separately from notes. Today its figure is the notes' text alone, and ink,
  kept in a store of its own, is in no figure at all; this is where that gets
  settled, once presentations own their ink.

### 2.2 PDF files as presentations

A PDF, from disk or from Drive, presented and drawn over like a deck. Its pages
are rendered by pdf.js. pdf.js ships as native ES modules, so it fits the
no-build rule; it is vendored, and loaded only by a presentation made from a
PDF. The PDF itself is stored in IndexedDB as part of the presentation.

Decided *(2026-11)*: this comes after 2.1, not with it.

Open questions:

- **Page proportions.** PDF pages come in their own proportions, a Beamer deck
  often 4:3 or 16:9. The ink layer's fixed 960×700 slide space has to become a
  per-presentation size.
- **Size.** A PDF can be tens of megabytes. Settings should say how much space
  presentations take, which ties in with *Storage* in 2.1.

### 2.3 Presentation themes

Swappable sets of colour, spacing and fonts, each a separate CSS file layered
over the shared slide styles (`src/slides.css`). reveal.js themes through CSS
custom properties, so this is mostly packaging. A deck chooses one with a
`theme:` line in its front-matter, next to `fontsize:`, and the projector can
switch themes from its menu.

A theme is a presenter feature. The editor's slide preview and the PDF export
only follow it, as they already follow `fontsize`, so a slide looks the same
everywhere.

Open questions:

- Does a theme switched in the projector last only for that talk, or is it
  written back into the front-matter? Now that a presentation keeps its own
  snapshot, it could also be stored on the presentation, leaving the note
  untouched.
- A PDF presentation has no theme to apply.

### Later

- **A speaker view** on a second screen, with notes, the next slide and a
  timer. The single-window projector was chosen first, and this was left for
  later; see ARCHITECTURE → Presentation.

## 3. Help

### 3.1 More answers in help

Help (`help/`) is in sections: the FAQ (`help/faq/`), the editor,
presentations and troubleshooting (`help/troubleshooting/`). The editor and
presentations are placeholders that list what they will answer; the topics below go to the section their group belongs to: *How
lemma-md works* and *Practical* to the FAQ, *Saving* and *Writing* to the
editor, *Presenting* to presentations. The FAQ answers six questions so far: what Markdown is, with
examples; why the site exists; no server and no account; files on disk; where
a note is before it is saved; and other tools to view and edit `.md`.
Troubleshooting has one problem: a browser that won't let the site store
anything. A problem the app reports by a message goes there, headed by that
message. The rest, in a proposed order. *Link candidate* marks a place
in the app that could link to the answer, once it exists; see ARCHITECTURE →
Help for why the app links rather than explains.

How lemma-md works:

5. **Keeping notes permanently** (`#keep-permanently`, link candidate from
   Settings). What the Settings button asks for. Firefox asks the user, while
   Chrome and Safari decide by themselves (a bookmark often helps). How to
   undo it.

Saving:

6. **Google Drive** (`#google-drive`). The `drive.file` permission: the app
   sees only files it created or that were opened with it. The app's folder.
   Why Google's window can appear after a reload (the token is kept in memory
   only). Disconnecting, and removing the app's access in the Google account.
7. **What the status says** (`#status`, link candidate from the status
   tooltip). *Not saved*, *Changed*, *Saving…*, *Changed in Drive*, *Renamed in
   Drive*, *In Drive trash*, *Storage error*; the tab's dot and ⟳. This is the
   user's version of [STATUS.md](STATUS.md).
8. **When the file changed somewhere else** (`#conflicts`). Overwrite, take
   theirs, or keep a copy; *Compare changes*.
9. **The bin** (`#bin`). Only notes closed with *Discard changes* go there,
   for 15 days by default; restoring one.
10. **Storage error** (`#storage-error`, link candidate from the storage
    notice). What it means and what to do: save or download the note, free disk
    space, *Try again*. Also the notice that the app was updated in another tab.
11. **Other tabs, browsers and devices** (`#devices`). The tabs of one browser
    share their notes; another browser or another computer sees none of them.
    Notes move between them through Drive or files.

Writing:

12. **Markdown and formulas** (`#syntax`). What is supported. KaTeX is not full
    LaTeX: no packages, and which macros work. A literal dollar is `\$`, as in
    LaTeX. What HTML a note may hold: no styles, forms or classes.
13. **Formulas pasted from ChatGPT** (`#chatgpt-formulas`). `\( \)` and
    `\[ \]`, and *Fix* in the notice under the bar.
14. **Downloading and exporting** (`#export`). `.md`; a standalone `.html` that
    can be dragged back in; `.tex`, and which engine compiles it; PDF through
    the browser's print.

Presenting:

15. **Slides from a note** (`#slides`). `---`, the front-matter, the projector
    window, *Present*, *Annotate* and *Board*.
16. **Where ink is kept** (`#ink`). In this browser, beside the note, not in the
    `.md`, and what that means when moving to another computer.

Practical:

17. **Browsers and phones** (`#browsers`). What works where. It may merge with
    the answer on files (`#files`).
18. **Offline** (`#offline`). There is no service worker, so the page needs the
    network to load. Once it is loaded, writing works without the network;
    Drive does not.
19. **Google's window does not open** (`#popups`, link candidate). A popup
    blocker, and allowing popups for this site. Google reports a blocked window
    as `popup_failed_to_open`; check what the app shows then.
20. **Source code, licence and feedback** (`#source`). GitHub, MIT, and where
    to report a bug.

Still open:

- **Links in.** The front page links from its footer and the editor from its
  menu. Still to decide: a button next to *Open the editor* (and
  *Presentations*, 2.1), and perhaps the projector.

## 4. Tests

The test page (`_tools/tests/`, see ARCHITECTURE → Tests) covers rendering, the
export, slides, the FAQ links, browser storage, and the editor's flows with
files on disk and Google Drive. Still to come:

### 4.1 Later

- **A live Drive check**, run by hand before a release: sign in once on the
  test page, then create, read, rename and trash files in a folder of its own.
  `drive.file` lets the tests see nothing but the files they made.
- **One command** that opens the page in headless Chrome and prints the result,
  and then perhaps a GitHub Actions check.

## Possible, much later: syncing to a private GitHub repository

This would be optional, for people who already have a GitHub account. A note
becomes a Markdown file in a private repository, and the UI hides the words
branch, commit and push. Gists were rejected; see ARCHITECTURE → Storage. What
is already known, should it ever start:

- **Sign-in.** A static page cannot finish GitHub's OAuth by itself: it needs a
  client secret, and the token endpoint sends no CORS headers. There are two
  ways round that:
  - a **token broker**, a Cloudflare Worker of about 30 lines that takes part
    only in login. It would be the app's first server-side piece.
  - a **fine-grained personal access token** that the user creates and pastes
    in. No server is needed, but the token then has to be stored, against the
    rule that Drive's token stays in memory, or pasted again every session.
- **The provider layer first.** The editor core still names `'gdrive'`
  throughout and takes `availableProviders()[0]` wherever a note is first
  saved. A second provider needs a choice of provider at first save, and the
  folder picker moved out of `app.js`.
- **Conflicts.** GitHub's contents API refuses an update that does not name the
  blob `sha` it replaces, which maps onto the note's existing `remote`
  baseline.
