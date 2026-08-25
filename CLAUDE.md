# Working notes for Claude

Read [README.md](README.md) for what this project is and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for why it is built this way —
especially the reasoning behind having no build step. Do not restate either
file here; keep them current instead.

## Conventions

- **English only** in code comments, documentation and commit messages.
- **No build tooling.** No `package.json`, no bundler, no transpiler. Our code
  is native ES modules in `src/`; libraries are vendored globals. If something
  seems to need a bundler, that is a decision to raise, not to make quietly.
- **New dependencies are vendored**, never pulled from a CDN at runtime. Add
  them to the `curl` script in [VENDOR.md](VENDOR.md) and check that it still
  reproduces `vendor/` exactly.
- **Load heavy things on demand** with the `loadScript` helper in
  `src/editor.js`, so that reading a note stays cheap.
- **Use `curl.exe`**, not `Invoke-WebRequest`. In PowerShell, `curl` is an alias
  for the latter, which on Windows PowerShell 5.1 tries to parse responses
  through Internet Explorer's HTML engine and fails in a non-interactive shell.

## Verifying changes

ES modules will not load over `file://`. Serve the directory and check in a
real browser:

```bash
./_tools/lemma_start.sh
```

`_tools/lemma_start.cmd` is the Windows twin, and `lemma_stop.*` shuts the
server down by finding it on the port — worth knowing, because a server left
running with no visible window is how a stale copy ends up being tested. Do not
start the server by hand: the scripts also reject a Python older than 3.7,
which has already cost an afternoon here.

The underscore in `_tools/` is load-bearing: GitHub Pages runs Jekyll, which
refuses to publish anything whose name starts with one. Development scripts
belong there; anything the site needs at runtime must not. See the Deployment
section of [README.md](README.md).

**Always port 8001, never another.** `http://localhost:8001` is registered with
Google as an authorised JavaScript origin and as an API-key referrer; the port
is part of the origin and is matched exactly, so anything served from 8080 or
8081 fails every cloud call. Changing it means editing the Google Cloud console
too, which is a decision to raise rather than a port to pick.

Verify by inspecting the DOM, not by reasoning about the code. Past bugs found
this way: KaTeX fonts silently falling back inside a shadow root, and DOMPurify
being capable of stripping MathML.

`python -m http.server` sends no cache-busting headers, so a browser will
happily serve an old `index.html` or `ui.css` after an edit. This has already
caused two phantom bugs. Before concluding anything from a page, check that the
file the browser holds is the file on disk — compare against
`fetch(path, { cache: 'reload' })`, or reload the stylesheet with a query
string appended.

One caveat: an automated browser tab usually reports `visibilityState:
"hidden"`, and `requestAnimationFrame` never fires there. Ace's render loop is
built on rAF, so the editor can look blank while its state is perfectly
correct. Check `editor.session.getLength()` rather than counting rendered
gutter cells, and do not "fix" a repaint problem that only exists in the test
environment.

## Binary files

**Never move binary data through the transcript.** Copying a base64 blob out of
a browser and pasting it into a file silently drops characters — that is how
`apple-touch-icon.png` came to have a corrupt IDAT chunk while still reporting
the right dimensions to every tool that only reads the header. Generate binaries
with a script that writes the bytes itself, as `_tools/make-icons.ps1` does.

After writing one, walk its chunks and check the CRCs; a length or a successful
`Image.FromFile` proves nothing. Beware that Windows PowerShell 5.1 parses a hex
literal filling all 32 bits (`0xFFFFFFFF`, `0xEDB88320`) as a *negative* `Int32`,
so a CRC-32 written the obvious way computes nonsense — keep the arithmetic in
`[long]` and mask.

## Commits

The user makes all commits. Do not run `git commit` and do not offer to. When
the tree reaches a coherent, verified state, say so in a line and describe what
the commit would cover.
