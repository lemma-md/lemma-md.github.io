#!/bin/sh
# Stop the development server, wherever it was started from.
#
# Useful mainly when the server has no visible window - started by a tool, or
# left over from a console that has since been closed. With a window in front
# of you, Ctrl+C in it is quicker.

PORT=8001

pids=""
if command -v lsof >/dev/null 2>&1; then
  # -sTCP:LISTEN keeps the process holding the port, not the browser's own
  # connections to it. One process listening on both IPv4 and IPv6 is reported
  # twice, hence sort -u.
  pids=$(lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | sort -u)
elif command -v fuser >/dev/null 2>&1; then
  pids=$(fuser "$PORT/tcp" 2>/dev/null | tr ' ' '\n' | sort -u)
else
  # Git Bash on Windows ships neither, which is the common way to land here.
  echo
  echo "  Neither lsof nor fuser is available, so the process cannot be found."
  echo "  On Windows, run lemma_stop.cmd instead - it asks netstat."
  echo "  Otherwise, stop the server from the terminal it is running in."
  echo
  exit 1
fi

if [ -z "$pids" ]; then
  echo
  echo "  Nothing is listening on port $PORT - already stopped."
  echo
  exit 0
fi

for pid in $pids; do
  echo "  Stopping pid $pid on port $PORT ..."
  kill "$pid" 2>/dev/null || true
done

# Give them a moment to go, then insist.
sleep 1
for pid in $pids; do
  kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
done

echo
echo "  Port $PORT is free."
echo
