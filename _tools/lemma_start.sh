#!/bin/sh
# Start the development server.
#
# Port 8001 is not a preference: it is registered with Google as an authorised
# JavaScript origin and as an API-key referrer, and an origin is matched
# exactly. Served from any other port, every cloud feature fails. Changing it
# means editing the Google Cloud console too — see docs/CLOUD-SETUP.md.

set -e
PORT=8001
# This script lives in _tools, one below the site root, which is what gets
# served.
cd "$(dirname "$0")/.."

# Check the version rather than assume it: --directory arrived in 3.7, and a
# stale `python` earlier in PATH is a real hazard.
PY=""
for candidate in python3 python py; do
  if command -v "$candidate" >/dev/null 2>&1 &&
     "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 7) else 1)' >/dev/null 2>&1
  then
    PY="$candidate"
    break
  fi
done

if [ -z "$PY" ]; then
  echo
  echo "  No Python 3.7 or newer was found on PATH."
  echo "  Install it from https://www.python.org/downloads/ and try again."
  echo
  exit 1
fi

echo
echo "  Serving $(pwd)"
echo "  Front page  http://localhost:$PORT/"
echo "  Editor      http://localhost:$PORT/editor/"
echo
echo "  Press Ctrl+C to stop."
echo

exec "$PY" -m http.server "$PORT" --directory "$(pwd)"
