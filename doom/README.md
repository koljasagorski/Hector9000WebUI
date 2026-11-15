# Doom easter egg

Picking the cocktail **Doom** in the drink grid starts Doom in the kiosk. Any drink whose
name contains "doom" does this instead of opening the drink dialog; if the backend has no
such drink, `js/hector9000.js` adds a "Doom" button itself (`Main.html?nodoom` switches
that off, for development).

The game is an iframe (`index.html`) on top of the UI. It leaves by itself and tells the
UI by `postMessage`:

| way out | reason sent |
|---|---|
| "Drinks" button (top left) | `back` |
| "Quit Game" in the Doom menu | `quit` |
| nobody touched anything for 2 minutes | `idle` |
| files missing, engine crashed, no picture within 2 minutes | `error` |
| UI sees no heartbeat for 30 s / game open for 30 min | `hung` / `max` (UI side) |

On the way out the UI publishes `Hector9000/event/doom` (`{"seconds": ..., "reason": ...}`);
the stats server counts plays and play time. Touches in the game also keep the LED strip awake.
While Doom is open the drink grid is not reachable (no drink can be started under it), and
Doom does not open while a dialog is open or a drink is being made.

## Controls (800x480 touch screen)

Left: ◀ ▲ ▼ ▶ (turn / walk). Right: **Feuer** (fire), **Los** (use / open doors, also answers menu
entries and Y/N questions), **Waffe ◀ ▶** (previous / next weapon). Top right: **Menü** (Esc).
Several fingers work at the same time. Starts on its own: the page walks through
New Game → episode 1 → skill 2 ("Hey, not too rough"). A real keyboard works as well.

## Needs

* Chromium with `--allow-file-access-from-files` when the UI is opened from `file://`
  (`../kiosk.sh` sets it). Over http no flag is needed. Without it the game shows an error
  and returns to the drinks after a few seconds.
* RAM: the engine reserves 96 MB (grows up to 256 MB) plus the 29 MB game data; the iframe is removed on exit, which frees it again. Not measured on the Pi.
* Not tested on a real Pi 2/3 (32-bit ARM, Chromium 113): checked in desktop Chrome only,
  also with the CPU throttled to 1/6. Sound is off (`-nosound`); `?sound` switches it on.

## Files

| file | what |
|---|---|
| `index.html`, `doom.js`, `doom.css` | page, touch controls, loader, exit logic (written for this repo) |
| `default.cfg` | engine settings: arrow keys, Ctrl = fire, Space = use, `[` `]` = weapons, always run, mouse off |
| `websockets-doom.js`, `websockets-doom.wasm` | the engine, built from `cloudflare/doom-wasm` (see below) |
| `freedoom1.wad` | Freedoom: Phase 1 0.13.0, the free game data |
| `build/` | the patch and the script that produced the engine files |
| `COPYING.md`, `AUTHORS.md` | GPL-2.0 text and authors of the engine |
| `FREEDOOM-*.txt` | Freedoom licence (BSD-3) and credits |

## Licences and sources (GPL-2.0)

The engine is [doom-wasm](https://github.com/cloudflare/doom-wasm) by Cloudflare, a WebAssembly
port of [Chocolate Doom](https://www.chocolate-doom.org/), licensed GPL-2.0. The binaries
here are built from upstream commit `65e0d3ae2ffa604155eebd96ed40da6567bd08f4`
with the one change in `build/doom-wasm-hector.patch` (leaner Emscripten flags: no
`SAFE_HEAP`/stack checks/source map, memory growth up to 256 MB). That commit plus the patch
plus `build/build.sh` (Emscripten 3.1.64, `emscripten/emsdk:3.1.64`) is the complete
corresponding source. `COPYING.md` is the licence text.

The game data is [Freedoom](https://freedoom.github.io/) 0.13.0 (BSD-3, see `FREEDOOM-COPYING.txt`),
not the commercial Doom data. To use another IWAD, replace `freedoom1.wad` (same name) or change
`FILES` and the `-iwad` argument in `doom.js`.

Shipped files (SHA-256):

    freedoom1.wad          7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d
    websockets-doom.wasm   af696d4bd55a120426f0010a470703058bff3c165e4a147f9ee836f4694e382e
    websockets-doom.js     08e5c33625ba51fdda7c3f9489749f3ea7443f9c5f82936b6093e0cb55203ce3

## Things worth knowing (found while building this)

* **The page loads wasm and WAD itself** (XHR + `Module.wasmBinary` + `FS.createDataFile`).
  Emscripten 3.1.64 has a swapped-arguments bug in its `file://` loader
  (`new Promise((reject, resolve) => ...)`), so its own loading never succeeds from `file://`.
  Loading it ourselves also gives the progress bar.
* **`startup_delay` must stay at 2000 in `default.cfg`.** With 0 the game starts but never
  advances a tic (the "Player left the game" message stays forever). The engine default is 1000.
* **No `-warp`**: in this port it starts a broken game. The page uses the menu instead.
* The status bar shows FRAGS instead of ARMS and "Player 4 left the game" appears for a few
  seconds at the start. Cosmetic quirk of the port (not investigated further).
* Development switches (query string of `doom/index.html`): `?args=a,b,c` replaces the engine
  arguments, `?idle=ms` shortens the idle time, `?sound` enables sound.
