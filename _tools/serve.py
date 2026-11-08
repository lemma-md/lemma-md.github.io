#!/usr/bin/env python3
"""Serve the site for development: `python -m http.server`, with caching off.

    python _tools/serve.py PORT DIRECTORY

Run through _tools/lemma_start.sh or .cmd, which pick the port (8001, the one
Google knows) and check the Python version.

`python -m http.server` sends no Cache-Control header, only Last-Modified, and
a browser left to guess keeps a file for a tenth of its age without asking: a
module untouched for a week can be served from cache for hours. After an edit
the page then runs new files beside old ones, an app.js looking for a button
an old editor/index.html does not have, and breaks in ways no code explains.

Here every response carries `Cache-Control: no-cache`. The browser still keeps
its copy, but asks before each use; an unchanged file comes back as a short
304, so reloading stays quick, and a changed one is never missed.

GitHub Pages, for comparison, sends `max-age=600`: after a push, a visitor can
run a mix of old and new files for at most ten minutes.
"""

import contextlib
import functools
import http.server
import socket
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


class DualStackServer(http.server.ThreadingHTTPServer):
    """IPv6 and IPv4 at once, as `python -m http.server` listens, so that
    `localhost` works whichever of ::1 and 127.0.0.1 it resolves to first."""

    address_family = socket.AF_INET6 if socket.has_ipv6 else socket.AF_INET

    def server_bind(self):
        if self.address_family == socket.AF_INET6:
            with contextlib.suppress(Exception):
                self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    port, directory = int(sys.argv[1]), sys.argv[2]
    handler = functools.partial(NoCacheHandler, directory=directory)
    host = '::' if DualStackServer.address_family == socket.AF_INET6 else ''
    with DualStackServer((host, port), handler) as server:
        print(f'  Listening on port {port}, with caching off (Cache-Control: no-cache).', flush=True)
        with contextlib.suppress(KeyboardInterrupt):
            server.serve_forever()


if __name__ == '__main__':
    main()
