#!/usr/bin/env bash
#
# Start the Hector9000 WebUI fullscreen automatically after login/boot.
# Run as the desktop user (not root), e.g. on Raspberry Pi OS with autologin.
#
# Uses an XDG autostart entry, which runs inside the desktop session
# (X11 and Wayland: LXDE, Wayfire, labwc), so DISPLAY/WAYLAND_DISPLAY are set.
# kiosk.sh then waits until the Hector backend (MQTT websocket) is up.

set -eu

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUTOSTART_DIR="${HOME}/.config/autostart"
DESKTOP_FILE="${AUTOSTART_DIR}/hector9000-kiosk.desktop"

if [ "$(id -u)" -eq 0 ]; then
    echo "Please run as the desktop user, not as root."
    exit 1
fi

chmod +x "${DIR}/kiosk.sh"

# Remove the old systemd user service of earlier versions (started twice otherwise)
if systemctl --user list-unit-files Hector9000WebUI.service >/dev/null 2>&1; then
    systemctl --user disable --now Hector9000WebUI.service >/dev/null 2>&1 || true
    rm -f "${HOME}/.config/systemd/user/Hector9000WebUI.service"
    systemctl --user daemon-reload >/dev/null 2>&1 || true
fi

mkdir -p "$AUTOSTART_DIR"
cat > "$DESKTOP_FILE" << EOL
[Desktop Entry]
Type=Application
Name=Hector9000 WebUI
Comment=Hector9000 WebUI in fullscreen kiosk mode
Exec=${DIR}/kiosk.sh
X-GNOME-Autostart-enabled=true
EOL

echo "Installiert: ${DESKTOP_FILE}"
echo "Die WebUI startet nach dem nächsten Login/Boot automatisch im Vollbild,"
echo "sobald das Hector-Backend (MQTT-Websocket) erreichbar ist."
echo "Sofort starten:        ${DIR}/kiosk.sh &"
echo "Vollbild beenden:      ${DIR}/kiosk.sh --exit  (oder 5x oben links tippen)"
echo "Autostart entfernen:   rm ${DESKTOP_FILE}"
