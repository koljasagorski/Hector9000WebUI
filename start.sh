#!/usr/bin/env bash
# Start the WebUI fullscreen (see kiosk.sh)
exec "$(cd "$(dirname "$0")" && pwd)/kiosk.sh" "$@"
