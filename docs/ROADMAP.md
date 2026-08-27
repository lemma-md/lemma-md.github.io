# Roadmap

What is left, in the order it will be done, and why that order. Kept here rather
than in a chat so the reasoning survives. See [ARCHITECTURE.md](ARCHITECTURE.md)
for the standing decisions this builds on.

## Where things stand

**Phase 0 is done: the Drive round trip works end to end** — open a file, edit,
save back — verified in a real browser. On the way, the save flow grew well past
the original adapter:

- Every `write` is now multipart, so a note's **name reaches Drive**, and a new
  file can be dropped into a chosen folder.
- A note can be **renamed** by double-clicking its tab.
- **Connect** is one operation that obtains the token and settles a default
  folder (a short "Connect to Google Drive" dialog, folder name editable);
  **disconnect** forgets both. Connection is durable across a reload — the
  folder marker persists and the token is refreshed silently — so the token is
  never written to disk. One "choose account" popup after a reload, only with
  several Google accounts signed in, is accepted (see the token decision note).
- Saving uses a **custom folder picker** built on `files.list` (which works for
  app-created content under `drive.file`): a tree of the app's own folders, a
  filename field, **New folder**, and **Add from Drive** to admit an outside
  folder once via Google's picker. Duplicate app folders are avoided by reusing
  an existing same-named folder instead of making another.

Still missing: conflict detection before overwrite, and a cloud save-status
indicator. No local file saving exists yet either.

## Decisions locked in

- **Drive first**, local files after.
- **Google Cloud project owner moves to the `lemma2md@` account.** Do this
  before brand verification; moving it afterwards is expensive. Add
  `nadrianov@` as an IAM owner so the original account keeps access.
- **One OAuth client, not a dev/prod pair.** A single client holds both origins
  (`localhost:8001` and `lemma-md.github.io`) with one committed `config.js`;
  nothing is switched at deploy. Separate projects were declined — the
  `drive.file` scope and the per-user Picker quota make them buy little, and two
  differing configs fight the no-build-step rule. If ever needed, branch on
  `location.hostname` rather than hand-swapping the file. Name the client for
  the app (`lemma-md web`), not an environment.
- A cloud-save **progress / status indicator** is wanted.
- **Detect an external change before overwriting.** Never clobber a Drive file
  blindly. Store an identity for the file at read/write time; before writing,
  re-check it; on a mismatch warn the user, and ideally offer a diff or a merge.

## Phase 0 — verify the round trip — **done**

Open a file from Drive, edit it, save it back, on `localhost:8001`. Verified in a
real browser. It surfaced (and fixed) the picker/consent setup, the `write`
name-propagation gap, and the tab double-click rename, and grew the connect flow
and custom picker described above.

## Phase 1 — production-quality Drive save

Built on what Phase 0 reveals. Missing today:

### Conflict detection before overwrite (the substance)

`write({id})` currently does a blind PATCH. The plan, mapped onto Drive's own
metadata rather than mtime/size (Drive gives better signals):

- On `read` and on every `write`, fetch and keep the file's **`headRevisionId`**
  (a change to the file changes this id) alongside `modifiedTime` and `size`.
  Store them in the note's `remote` link, which today is only
  `{ provider, id, savedAt }`.
- Before a save-over, GET the file's current `headRevisionId`.
  - Unchanged since our last read/write → safe to overwrite.
  - Changed → someone (or another device) wrote in between. Stop and warn.
- On a warning, offer at least a choice (overwrite / keep theirs / save a copy);
  better, a text diff of the two versions; best, a merge. Start with the choice,
  grow toward diff/merge.
- `read` must be widened from `fields=id,name` to include
  `headRevisionId,modifiedTime,size,md5Checksum`; `write` likewise.

`md5Checksum` gives a cheap content-equality check for the "unchanged, re-read
freely" case the user described.

### Note renaming, and propagating it to Drive — **done**

Double-click a tab to rename; every `write` is multipart, so the name reaches
Drive with the content.

### Save status

The tab dot only means "changed locally" (`text !== savedText`). Add a visible
cloud state: saved / saving / unsaved-to-cloud, with the last-saved time.

### Error surfacing

`cloudFailed` uses `alert()` — crude but adequate; revisit only if it grates.

## Phase 2 — local files (independent of Drive)

For a colleague with no Google account this matters more than Drive. Browsers
split hard:

- **Chromium desktop** (Chrome/Edge/Opera): File System Access API gives a real
  writable handle — a true "Save" back into the same file after one permission
  grant. The handle is structured-cloneable, so it can be kept in IndexedDB to
  reopen the very same file later ("recent files on disk").
- **Firefox, Safari, all mobile**: no API. Fall back to the existing download
  for save, and drag-drop / `<input type=file>` for open.

Feature-detect; show a "Save to file" affordance only where writable handles
exist. This is a third adapter but with handle-based, not id-based, semantics.

## Phase 3 — Google console for production (before public launch only)

Console work (yours) plus doc updates (mine). Does not block local development.

- API-key referrers: `md-studio.github.io` → `lemma-md.github.io`.
- OAuth client JavaScript origins: add `https://lemma-md.github.io`.
- Consent-screen homepage: the new address.
- Owner already moved to `lemma2md@` (see decisions).
- Set status to Production; pass brand verification, which needs the domain
  verified in Search Console under the owning account.

## Deferred — slides

reveal.js with a laser pointer and a chalkboard. Technically independent of all
the above; held back by priority, not dependency. Starts once saving is done.
