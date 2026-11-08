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
  `src/load-script.js`, so that reading a note stays cheap.
- **Plans, decisions and history live in three files.** The next big features
  and their open and decided questions are in [docs/ROADMAP.md](docs/ROADMAP.md).
  When a feature or notable fix ships, it leaves ROADMAP, gets a line under that
  day's date in [CHANGELOG.md](CHANGELOG.md), and its decisions move into
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) under their topic, marked with
  the month. ARCHITECTURE describes only what is built. Small bugs are not listed in any of them: fix
  them. Reviews and working notes stay out of the repo, which is public and
  published whole.
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

**Run the tests** before calling a change done: open
`http://localhost:8001/_tools/tests/`. The page title reads `PASS n` or
`FAIL n of m`, and `window.testResults` lists the failures. A fixed bug gets a
test there, in the file for its area. The export tests also fail when
`RENDER_MIN` was not regenerated after a change to the renderer. A run takes
about a minute, most of it the editor tests; the page reloads every module
itself, so a plain reload runs what is on disk.

The start scripts run `_tools/serve.py`, which sends `Cache-Control: no-cache`,
so a reload asks for every file again. Plain `python -m http.server` sends no
such header, and a browser then happily serves an old `index.html` or `ui.css`
after an edit: two phantom bugs and one broken editor came from that. A page
already open still holds what it loaded, so reload it after an edit; and if a
page looks wrong, check that the server running is the one the scripts start
(`lemma_stop`, then `lemma_start`) before concluding anything from it.

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
