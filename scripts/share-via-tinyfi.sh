#!/bin/sh
set -eu

PORT="${1:-${PORT:-3000}}"
REMOTE_PORT="${TINYFI_REMOTE_PORT:-80}"
HOST="${TINYFI_HOST:-tinyfi.sh}"

echo "Forwarding localhost:${PORT} to ${HOST} on remote port ${REMOTE_PORT}..."
echo "Press Ctrl+C to stop the tunnel."

exec ssh \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -o ExitOnForwardFailure=yes \
  -R "${REMOTE_PORT}:localhost:${PORT}" \
  "${HOST}"
