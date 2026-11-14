## **Hector9000WEBUI**

### Usage:

This frontend is tested and optimized only on a 800x480 Chromium browser. There could occur problems in other browsers / screen sizes.

    JS location: js/hector9000.js

#### Congress design (40C3 "Model Citizens")

The UI uses the [40C3 styleguide](https://events.ccc.de/congress/2026/infos/styleguide/)
(CC0): colours, the 40C3 logo and the fonts Jersey 10 (SIL OFL 1.1) and Hack (MIT),
bundled in `fonts/congress/` together with their licenses. All styling is in
`css/congress.css`.

- **Colour themes:** the palette button in the header (and "Color" in the settings)
  cycles through the styleguide themes: Dark, Light, Zero Day Pink, Rabbit Green,
  Teal, Autumn, Danger Yellow, Cute Lilac. The choice is stored in the browser
  (`localStorage`) and survives reloads and reboots.
- **Drinks:** alcoholic drinks are filled boxes with an `ALC` label,
  non-alcoholic drinks are outlined boxes.

#### Fullscreen on boot

    ./install.sh        # as the desktop user, not root

This creates `~/.config/autostart/hector9000-kiosk.desktop`, which starts
`kiosk.sh` after login (X11 and Wayland desktops of Raspberry Pi OS). `kiosk.sh`
waits until the Hector backend is initialised (MQTT websocket on port 9001
reachable, max. 120 s) and then starts Chromium in kiosk (fullscreen) mode.
If Chromium crashes it is restarted. An older `Hector9000WebUI.service` user
unit is removed by `install.sh`.

Start manually: `./kiosk.sh &` (or `./start.sh`).
Overrides: `HECTOR_MQTT_HOST`, `HECTOR_MQTT_WS_PORT`, `HECTOR_WAIT_TIMEOUT`,
`HECTOR_KIOSK_FLAGS` (e.g. `--disable-gpu`).

#### Settings: reboot

"REBOOT" in the settings needs two taps (the second within 4 s). It sends
`Hector9000/system/reboot`; the Hector9000 backend (`HectorController.py`)
reboots the Pi. Requires the backend from
[koljasagorski/Hector9000](https://github.com/koljasagorski/Hector9000)
with system actions.

#### Secret button: leave fullscreen

Tap the invisible area in the **top left corner 5 times within 3 seconds**
(also works on the loading screen). This sends `Hector9000/system/kioskExit`;
the backend creates `/tmp/hector9000-kiosk.exit` and stops the kiosk Chromium
(processes with `hector9000-kiosk-profile` in the command line), and `kiosk.sh`
does not restart it. Without the backend: `./kiosk.sh --exit`.
Needs a working MQTT connection; otherwise the UI shows "Exit failed: no connection".

#### For Testing without MQTT-Server:

Open `Main.html?testing` – the UI uses built-in test data.

#### For Production/Testing with MQTT-Server:
```javascript
const host = %HOSTNAME%;
const port = %PORTNUMBER%;
```
Make sure your MQTT-Server has Websocket support and set the
port to the websocket port of your MQTT-Server.

To add Websocket support to the standart mosquitto MQTT-Server add:

    listener %PORTNUMBER%
    protocol websockets

to your mosquitto config file and then restart your MQTT-Server.

Note: with `allow_anonymous true` everyone who can reach the broker can send
these commands (including reboot). Restrict the broker if the network is not trusted.
