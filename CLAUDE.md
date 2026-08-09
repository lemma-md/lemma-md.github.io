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
python -m http.server 8080
```

Verify by inspecting the DOM, not by reasoning about the code. Past bugs found
this way: KaTeX fonts silently falling back inside a shadow root, and DOMPurify
being capable of stripping MathML.

One caveat: an automated browser tab usually reports `visibilityState:
"hidden"`, and `requestAnimationFrame` never fires there. Ace's render loop is
built on rAF, so the editor can look blank while its state is perfectly
correct. Check `editor.session.getLength()` rather than counting rendered
gutter cells, and do not "fix" a repaint problem that only exists in the test
environment.

## Commits

The user makes all commits. Do not run `git commit` and do not offer to. When
the tree reaches a coherent, verified state, say so in a line and describe what
the commit would cover.
