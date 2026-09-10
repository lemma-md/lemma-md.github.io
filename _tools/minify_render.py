#!/usr/bin/env python3
"""Regenerate the minified renderer embedded in src/export-html.js.

The exported .html can carry the Markdown renderer in two forms (see
docs/HTML_EXPORT.md): the readable copy of viewer.js, or a minified blob. This
produces the blob from the readable source so the two never drift — run it after
editing exportedRender() in export-html.js, whenever the `js: 'min'` option is
used.

Needs rjsmin (pure Python, no Node toolchain):

    pip install rjsmin

rjsmin only strips comments and whitespace; it never renames identifiers, so it
cannot break the code's ASI (no-semicolon style) the way an aggressive minifier
might.
"""

import json
import pathlib
import re
import sys

try:
    import rjsmin
except ImportError:
    sys.exit("rjsmin is not installed. Run:  pip install rjsmin")

FILE = pathlib.Path(__file__).resolve().parent.parent / "src" / "export-html.js"


def marked_region(text, name):
    """The full `// >>> name >>> ... // <<< name <<<` block, as a match."""
    m = re.search(
        r"// >>> %s >>>\n(.*?)\n// <<< %s <<<" % (re.escape(name), re.escape(name)),
        text,
        re.S,
    )
    if not m:
        sys.exit(f"marker region '{name}' not found in {FILE.name}")
    return m


def main():
    text = FILE.read_text(encoding="utf-8")

    source = marked_region(text, "render-source").group(1)
    minified = rjsmin.jsmin("(" + source + ")()").strip()

    block = marked_region(text, "render-min")
    replacement = (
        "// >>> render-min >>>\n"
        "const RENDER_MIN = " + json.dumps(minified) + "\n"
        "// <<< render-min <<<"
    )
    updated = text[: block.start()] + replacement + text[block.end() :]

    if updated != text:
        FILE.write_text(updated, encoding="utf-8")
    print(f"RENDER_MIN updated: {len(minified)} bytes")


if __name__ == "__main__":
    main()
