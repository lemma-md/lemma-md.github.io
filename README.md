# md-studio

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

- live preview of markdown with TeX formulas
- editor with line numbers, syntax highlighting and search
- multiple notes in tabs, restored when you come back
- automatic saving of drafts
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

There is no build step. Any static file server will do — from the repository
root:

```bash
python -m http.server 8080
```

Then open <http://localhost:8080>. Opening `index.html` straight from disk does
**not** work — the code uses ES modules, which browsers refuse to load over
`file://`.

Deployment is a file copy: the repository is the site.

## Layout

```
index.html          loads the vendored libraries
src/app.js          tabs, drag & drop, autosave, pane splitter
src/viewer.js       markdown + TeX -> sanitised HTML
src/editor.js       Ace, loaded on demand
src/drafts.js       IndexedDB persistence
src/ui.css
vendor/             third-party libraries, committed (see VENDOR.md)
```

Why it is built this way — and why there is no bundler — is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
