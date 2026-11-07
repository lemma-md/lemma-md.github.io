# Note status

Every open note carries a small **status** shown at the left of the toolbar and,
in full, in the **File info** panel (clicking the status opens it). It answers
one question: *where does this note stand relative to the place it is saved?*

This is deliberately separate from the tab's edited-dot, which only ever means
"the local text differs from the last local save to the browser". The status is
about the **source** — the real storage a note is bound to.

## A note's source

A note is bound to one source, derived from its links, not stored twice:

- **Google Drive** — the note came from, or was saved to, a Drive file. Its id,
  name, parent folder and revision baseline live in the note's `remote` link.
- **none** — the note is not in any storage yet. Two kinds:
  - `origin: 'new'` — started with the **New** button.
  - `origin: 'file'` — opened from a local file (drag-and-drop or *Open a file…*).
    These are not writable handles, so the note is not bound to that file.

A local-file source with a writable handle (the File System Access API) is a
future third source; it will detect external change by modified-time and size
rather than a revision id, but the status rules below are otherwise the same.

## The status, in priority order

`cloudStatusText(doc)` in `src/app.js` decides the status. The first rule that
matches wins.

**Above every source:** if the browser refused to store the note's latest
edits (storage full or blocked, or the page made stale by a newer build in
another tab), the status is **Storage error**, in red. Those edits are then only
in this tab's memory, which matters more than anything the source could say. It
lasts until a write succeeds or the text reaches a file (saved or downloaded),
and it is the one status shown on a phone's narrow bar too. The first failure on
a page also shows a notice under the bar *(2026-11)*.

**No source:**

| condition | status |
|---|---|
| untouched (`text = savedText`) | *nothing shown* |
| `origin: 'new'`, edited | **Not saved** |
| an opened file, edited | **Changed** |

Both words are amber. An untouched note shows no status, whether it is a
blank note, a template as it came, or a file you only read: there is nothing
to lose and nothing to say about a place it was never saved to. Once edited,
the browser holds the only copy of the edits. The File info **Save** button
then offers to put the note in a storage.

A new note used to show **New** in grey from the start. That word sat beside
the toolbar's buttons and read as the *New* command, and grey understated a
page of text that existed only in the browser *(2026-11)*.

**Google Drive source:**

| condition | status |
|---|---|
| a save is in flight | **Saving…** |
| the file is in the Drive trash | **In Drive trash** |
| the file was renamed or moved in Drive | **Renamed in Drive** |
| the file's content changed in Drive | **Changed in Drive** |
| edited or renamed since the last save | **Changed** |
| in sync | *the source file's own date-time, with no status word* |

A rename counts because a save carries the name to Drive: until then, the new
name is an unsaved change like edited text, and closing the note asks first
*(2026-11)*. A file on disk keeps its own name on disk, so renaming its tab is
not a pending change there.

The in-sync case shows only a timestamp — the file's `modifiedTime` — because
there is no event to report; the time is just when the file last became what it
now is. If you type and then undo back to the saved text, the note is in sync
again and shows that same source time, not the moment you were typing.

The three "…in Drive" states are about the file's **identity or content moving
underneath the note**, and each makes the next save ask what to do rather than
overwrite blindly:

- **Changed in Drive** — content differs; saving offers overwrite / take theirs
  / save a copy.
- **Renamed in Drive** / **In Drive trash** — the file was renamed, moved, or
  trashed; saving offers to follow it (or restore it) or keep a separate copy.

## How external change is noticed

Each Drive file has a `headRevisionId` that changes on every content edit, and
`name` / `parents` / `trashed` that change on a rename, move, or trash. The note
remembers all of these as its baseline (in `remote`).

- **On save**, `guardOverwrite` re-fetches them and compares before writing.
- **On returning to the tab** (`visibilitychange` / `focus`), every open Drive
  note is re-checked and its flags updated — but only when a live token already
  exists, so this never provokes a sign-in popup.

## Tab markers

Two small marks can appear on a tab, independent of the toolbar status:

- **•** (accent) — edited since the last save to the browser (`text ≠ savedText`).
- **⟳** (amber) — the Drive file was changed, renamed, moved, or trashed; the
  tooltip says which.
