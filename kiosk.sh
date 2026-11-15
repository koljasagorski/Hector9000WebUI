#!/usr/bin/env bash
#
# Start the Hector9000 WebUI fullscreen (Chromium kiosk mode).
#
# 1. waits until the MQTT broker websocket (backend) is reachable,
# 2. starts Chromium in kiosk mode and restarts it if it crashes,
# 3. stops for good once the "leave fullscreen" flag exists.
#
# Contract with Hector9000 (HectorSystem.py, topic Hector9000/system/kioskExit):
#   flag file   /tmp/hector9000-kiosk/exit  (the directory belongs to the kiosk
#               user, so the flag can be removed even if root created it)
#   marker      every kiosk Chromium runs with a profile dir containing
#               "hector9000-kiosk-profile", so `pkill -f` only hits the kiosk.
#
# The UI is served to Chromium from a small local web server (a tiny Python http.server wrapper,
# bound to 127.0.0.1 only, stopped when this script ends). That keeps Chromium's file://
# restrictions in place: --allow-file-access-from-files would let any script that ever
# ran in the kiosk read local files. Only if no such server can be started the UI is
# opened from file:// with that flag, so the kiosk still comes up.
#
# Environment overrides:
#   HECTOR_MQTT_HOST (localhost)  HECTOR_MQTT_WS_PORT (9001)
#   HECTOR_WAIT_TIMEOUT (120 s)   HECTOR_KIOSK_FLAGS (extra Chromium flags)
#   HECTOR_UI_PORT (8765, the next free one up to +9 is used)
#
# Usage: kiosk.sh          start kiosk
#        kiosk.sh --exit   leave fullscreen (same as the secret button)

set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UI_PORT="${HECTOR_UI_PORT:-8765}"
UI_SERVER_PID=""
PAGE=""
EXTRA_FLAGS=""
EXIT_DIR="/tmp/hector9000-kiosk"
EXIT_FLAG="${EXIT_DIR}/exit"
PROFILE_DIR="${HOME}/.cache/hector9000-kiosk-profile"
MQTT_HOST="${HECTOR_MQTT_HOST:-localhost}"
MQTT_WS_PORT="${HECTOR_MQTT_WS_PORT:-9001}"
WAIT_TIMEOUT="${HECTOR_WAIT_TIMEOUT:-120}"

log() { echo "[hector9000-kiosk] $*"; }

if [ "${1:-}" = "--exit" ]; then
    mkdir -p "$EXIT_DIR"
    touch "$EXIT_FLAG"
    pkill -f "hector9000-kiosk-[p]rofile"
    exit 0
fi

stop_ui_server() {
    if [ -n "$UI_SERVER_PID" ]; then
        kill "$UI_SERVER_PID" 2>/dev/null
        wait "$UI_SERVER_PID" 2>/dev/null
        UI_SERVER_PID=""
    fi
}
trap stop_ui_server EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
trap 'exit 129' HUP

# Serve the UI on 127.0.0.1 and set PAGE; returns 1 if that is not possible.
# The Python wrapper only creates the ready file after it has bound the port itself, so a
# foreign server that already uses a port is never mistaken for ours.
start_ui_server() {
    command -v python3 >/dev/null 2>&1 || return 1
    local port ready_dir ready tries
    ready_dir="$(mktemp -d 2>/dev/null)" || return 1
    ready="${ready_dir}/ready"
    for port in $(seq "$UI_PORT" $((UI_PORT + 9))); do
        # 9>&-: the server must not inherit the instance lock
        python3 - "$port" "$DIR" "$ready" >/dev/null 2>&1 9>&- <<'PY' &
import functools, http.server, sys
port, directory, ready = int(sys.argv[1]), sys.argv[2], sys.argv[3]


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def end_headers(self):
        # The kiosk profile survives reboots. Without this, Chromium may keep serving an
        # old hector9000.js for a while after an update; "no-cache" = ask again every time
        # (an unchanged file costs a 304, so the 29 MB Doom data is not downloaded again).
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


server = http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Quiet, directory=directory))
open(ready, "w").close()
server.serve_forever()
PY
        UI_SERVER_PID=$!
        tries=0
        while [ "$tries" -lt 40 ] && kill -0 "$UI_SERVER_PID" 2>/dev/null; do
            if [ -e "$ready" ]; then
                rm -rf "$ready_dir"
                PAGE="http://127.0.0.1:${port}/Main.html"
                return 0
            fi
            sleep 0.25
            tries=$((tries + 1))
        done
        stop_ui_server   # port in use (the wrapper died) or too slow - try the next port
    done
    rm -rf "$ready_dir"
    return 1
}

BROWSER=""
for candidate in chromium-browser chromium google-chrome; do
    if command -v "$candidate" >/dev/null 2>&1; then
        BROWSER="$candidate"
        break
    fi
done
if [ -z "$BROWSER" ]; then
    log "no Chromium found (tried chromium-browser, chromium, google-chrome)"
    exit 1
fi

# --- single instance (a second autostart would otherwise fight the first) --
LOCK="/tmp/hector9000-kiosk-$(id -u).lock"
if command -v flock >/dev/null 2>&1; then
    exec 9>"$LOCK"
    if ! flock -n 9; then
        log "kiosk already running, exiting"
        exit 0
    fi
fi

mkdir -p "$EXIT_DIR"
rm -f "$EXIT_FLAG"
if [ -e "$EXIT_FLAG" ]; then
    log "cannot remove $EXIT_FLAG ($EXIT_DIR owned by another user?) - remove it and start again"
    exit 1
fi

# --- wait until Hector is initialised (broker websocket reachable) ---------
log "waiting for MQTT websocket ${MQTT_HOST}:${MQTT_WS_PORT} (max ${WAIT_TIMEOUT}s)"
waited=0
until (exec 3<>"/dev/tcp/${MQTT_HOST}/${MQTT_WS_PORT}") 2>/dev/null; do
    if [ "$waited" -ge "$WAIT_TIMEOUT" ]; then
        log "broker not reachable, starting anyway (UI keeps retrying)"
        break
    fi
    sleep 2
    waited=$((waited + 2))
done

# --- local web server for the UI (file:// fallback) -------------------------
if start_ui_server; then
    log "serving the UI at ${PAGE}"
else
    PAGE="file://${DIR}/Main.html"
    EXTRA_FLAGS="--allow-file-access-from-files"
    log "WARNING: no local web server, opening ${PAGE} with ${EXTRA_FLAGS} (less safe)"
fi

# --- start fullscreen, restart on crash, stop on exit flag -----------------
mkdir -p "$PROFILE_DIR"
while [ ! -e "$EXIT_FLAG" ]; do
    # no "restore pages?" bubble after a reboot or a kill
    prefs="${PROFILE_DIR}/Default/Preferences"
    if [ -f "$prefs" ]; then
        sed -i -e 's/"exited_cleanly":false/"exited_cleanly":true/' \
               -e 's/"exit_type":"[^"]*"/"exit_type":"Normal"/' "$prefs"
    fi

    log "starting ${BROWSER} in kiosk mode"
    # shellcheck disable=SC2086
    "$BROWSER" \
        --kiosk \
        --user-data-dir="$PROFILE_DIR" \
        --noerrdialogs \
        --disable-infobars \
        --disable-session-crashed-bubble \
        --disable-translate \
        --disable-features=TranslateUI \
        --no-first-run \
        --fast --fast-start \
        --disk-cache-dir=/dev/null \
        --overscroll-history-navigation=0 \
        --disable-pinch \
        --check-for-update-interval=31536000 \
        --password-store=basic \
        --ozone-platform-hint=auto \
        ${EXTRA_FLAGS} \
        ${HECTOR_KIOSK_FLAGS:-} \
        "$PAGE" 9>&- &   # browser must not inherit the instance lock
    # wait (not a foreground run): a TERM/INT/HUP to this script must stop the web server at once
    wait $!

    [ -e "$EXIT_FLAG" ] && break
    log "browser ended unexpectedly, restarting in 3s"
    sleep 3
done

log "fullscreen left - start again with: ${DIR}/kiosk.sh"
