#!/usr/bin/env bash
#
# Start the Hector9000 WebUI fullscreen (Chromium kiosk mode).
#
# 1. waits until the MQTT broker websocket (backend) is reachable,
# 2. starts Chromium in kiosk mode and restarts it if it crashes,
# 3. stops for good once the "leave fullscreen" flag exists.
#
# Contract with Hector9000 (HectorSystem.py, topic Hector9000/system/kioskExit):
#   flag file   /tmp/hector9000-kiosk.exit
#   marker      every kiosk Chromium runs with a profile dir containing
#               "hector9000-kiosk-profile", so `pkill -f` only hits the kiosk.
#
# Environment overrides:
#   HECTOR_MQTT_HOST (localhost)  HECTOR_MQTT_WS_PORT (9001)
#   HECTOR_WAIT_TIMEOUT (120 s)   HECTOR_KIOSK_FLAGS (extra Chromium flags)
#
# Usage: kiosk.sh          start kiosk
#        kiosk.sh --exit   leave fullscreen (same as the secret button)

set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAGE="file://${DIR}/Main.html"
EXIT_FLAG="/tmp/hector9000-kiosk.exit"
PROFILE_DIR="${HOME}/.cache/hector9000-kiosk-profile"
MQTT_HOST="${HECTOR_MQTT_HOST:-localhost}"
MQTT_WS_PORT="${HECTOR_MQTT_WS_PORT:-9001}"
WAIT_TIMEOUT="${HECTOR_WAIT_TIMEOUT:-120}"

log() { echo "[hector9000-kiosk] $*"; }

if [ "${1:-}" = "--exit" ]; then
    touch "$EXIT_FLAG"
    pkill -f "hector9000-kiosk-[p]rofile"
    exit 0
fi

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

rm -f "$EXIT_FLAG"
if [ -e "$EXIT_FLAG" ]; then
    log "cannot remove $EXIT_FLAG (owned by another user?) - remove it and start again"
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
        ${HECTOR_KIOSK_FLAGS:-} \
        "$PAGE"

    [ -e "$EXIT_FLAG" ] && break
    log "browser ended unexpectedly, restarting in 3s"
    sleep 3
done

log "fullscreen left - start again with: ${DIR}/kiosk.sh"
