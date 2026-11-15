// Doom easter egg for the Hector9000 kiosk (800x480 touch screen).
//
// Runs inside an <iframe> opened by Main.html when the cocktail "Doom" is picked.
// Engine: doom-wasm (Chocolate Doom compiled to WebAssembly, GPL-2.0), game data: Freedoom.
// See doom/README.md for sources, licences and how the engine was built.
//
// Talks to the parent page only through postMessage (source "hector-doom"):
//   hb        every few seconds while this page is alive
//   activity  somebody touched a button (keeps the LED strip awake)
//   exit      leave Doom, with reason and played seconds
//
// Loading uses plain XHR instead of Emscripten's own loader on purpose: the kiosk opens
// the UI from file:// (Chromium flag --allow-file-access-from-files), and Emscripten 3.1.64
// has a swapped-arguments bug in its file:// branch (new Promise((reject, resolve) => ...)),
// so wasm and WAD would never arrive. Doing it ourselves also gives a progress bar.

(function () {
    "use strict";

    var FILES = {wasm: "websockets-doom.wasm", wad: "freedoom1.wad", cfg: "default.cfg"};
    var GUESS_BYTES = {wasm: 5000000, wad: 28800000, cfg: 2000};   // until the browser tells the real size
    var LOAD_TIMEOUT_MS = 120000;   // from "files loaded" until the first picture
    var IDLE_MS = 120000;           // nobody touched anything: back to the drinks (?idle=ms for tests)
    var HEARTBEAT_MS = 5000;
    var MIN_HOLD_MS = 100;          // Doom polls keys once per tic; a shorter tap could vanish

    var params = new URLSearchParams(window.location.search);
    if (/^\d{3,7}$/.test(params.get("idle") || "")) IDLE_MS = parseInt(params.get("idle"), 10);
    var inFrame = window.parent !== window;
    var sound = params.has("sound");

    var canvas = document.getElementById("canvas");
    var loadingEl = document.getElementById("loading");
    var textEl = document.getElementById("loading-text");
    var fillEl = document.getElementById("loading-fill");
    var hintEl = document.getElementById("loading-hint");
    var padEl = document.getElementById("pad");

    var finished = false;
    var failed = false;
    var playingSince = 0;           // set when the first picture is there
    var lastInput = Date.now();
    var lastActivityPost = 0;
    var timers = [];

    // ---------------------------------------------------------------- parent

    function post(type, extra) {
        if (!inFrame) return;
        var msg = {source: "hector-doom", type: type};
        for (var k in extra) {
            if (Object.prototype.hasOwnProperty.call(extra, k)) msg[k] = extra[k];
        }
        try {
            window.parent.postMessage(msg, "*");   // file:// pages have opaque origins
        } catch (e) {
            // parent gone - nothing to tell
        }
    }

    function leave(reason) {
        if (finished) return;
        finished = true;
        timers.forEach(clearTimeout);
        timers.forEach(clearInterval);
        releaseAll();
        var seconds = playingSince ? Math.round((Date.now() - playingSince) / 1000) : 0;
        console.log("[doom] leave: " + reason + " after " + seconds + " s");
        post("exit", {reason: reason, seconds: seconds});
        if (!inFrame) {
            // opened on its own (development): nothing to return to
            document.body.style.opacity = "0.3";
        }
    }

    function touched() {
        var now = Date.now();
        lastInput = now;
        if (now - lastActivityPost > 8000) {
            lastActivityPost = now;
            post("activity");
        }
    }

    // ---------------------------------------------------------------- screens

    function setStatus(text, percent) {
        textEl.textContent = text;
        if (typeof percent === "number") {
            fillEl.style.width = Math.max(0, Math.min(100, percent)) + "%";
        }
    }

    function fail(message, hint) {
        if (finished || failed) return;
        failed = true;
        console.error("[doom] " + message);
        loadingEl.className = "failed";
        padEl.hidden = true;
        setStatus(message, 0);
        hintEl.textContent = hint || "";
        // somebody is standing in front of a dead screen - give the bar back after a moment
        timers.push(setTimeout(function () { leave("error"); }, 7000));
    }

    function showGame() {
        if (playingSince || finished) return;
        playingSince = Date.now();
        loadingEl.className = "gone";
        padEl.hidden = false;
        touched();
    }

    // ---------------------------------------------------------------- loading

    function download(name, onProgress) {
        var url = FILES[name];
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open("GET", url, true);
            xhr.responseType = "arraybuffer";
            xhr.onprogress = function (e) {
                onProgress(name, e.loaded, e.lengthComputable ? e.total : 0);
            };
            xhr.onload = function () {
                // file:// answers with status 0 in some browsers
                if ((xhr.status === 200 || xhr.status === 0) && xhr.response && xhr.response.byteLength > 0) {
                    onProgress(name, xhr.response.byteLength, xhr.response.byteLength);
                    resolve(xhr.response);
                } else {
                    reject(new Error(url + ": HTTP " + xhr.status));
                }
            };
            xhr.onerror = function () {
                reject(new Error(url + ": cannot be read"));
            };
            xhr.send(null);
        });
    }

    function downloadAll() {
        var loaded = {wasm: 0, wad: 0, cfg: 0};
        var total = {wasm: GUESS_BYTES.wasm, wad: GUESS_BYTES.wad, cfg: GUESS_BYTES.cfg};

        function progress(name, l, t) {
            if (failed) return;   // other downloads may still report after one has failed
            loaded[name] = l;
            if (t) total[name] = t;
            var sum = 0, done = 0;
            for (var k in total) {
                sum += total[k];
                done += loaded[k];
            }
            setStatus("Lade Dämonen … " + Math.round(100 * done / sum) + " %", 100 * done / sum);
        }

        return Promise.all([download("wasm", progress), download("wad", progress), download("cfg", progress)]);
    }

    // ---------------------------------------------------------------- engine

    function startEngine(wasm, wad, cfg) {
        setStatus("Starte Engine …", 100);

        // no -warp: in this port it starts a broken network game (frags, "player left")
        var args = ["-iwad", FILES.wad, "-config", FILES.cfg, "-window", "-geometry", "640x480",
            "-nogui", "-nomouse"];
        if (!sound) args.push("-nosound");   // the bar is loud anyway, and the Pi has CPU to spare for the game
        // development only: ?args=-warp,1,1 replaces the whole list (comma separated)
        if (params.has("args")) args = params.get("args").split(",");

        window.Module = {
            wasmBinary: wasm,
            arguments: args,
            canvas: canvas,
            preRun: [function () {
                // canOwn = true: MEMFS keeps our buffer instead of copying 29 MB again
                window.Module.FS.createDataFile("/", FILES.wad, new Uint8Array(wad), true, false, true);
                window.Module.FS.createDataFile("/", FILES.cfg, new Uint8Array(cfg), true, true, true);
                wad = null;
                cfg = null;
            }],
            print: onEngineLine,
            printErr: onEngineLine,
            setStatus: function () {},
            onExit: function (code) {
                // "Quit Game" in the Doom menu or an engine error ends up here
                leave(code === 0 ? "quit" : "error");
            },
            onAbort: function (what) {
                console.error("[doom] abort: " + what);
                fail("Doom ist abgestürzt.", "Zurück zu den Drinks …");
            }
        };

        // if the picture never comes, do not leave the bar staring at a loading bar
        timers.push(setTimeout(function () {
            if (!playingSince) fail("Doom startet nicht.", "Zu wenig Speicher oder zu langsam.");
        }, LOAD_TIMEOUT_MS));

        var script = document.createElement("script");
        script.src = "websockets-doom.js";
        script.onerror = function () {
            fail("Doom-Engine fehlt.", "doom/websockets-doom.js konnte nicht geladen werden.");
        };
        document.body.appendChild(script);
    }

    var engineUp = false;

    // The title screen shows demos. Walk through "New Game" like a player would, so the
    // cocktail takes people straight into the game: Esc, New Game, episode 1, skill 2.
    // Starts at skill "Hey, not too rough" - this is a bar, not a bunker.
    var START_KEYS = ["Escape", "Enter", "Enter", "ArrowUp", "Enter"];

    function autoStart() {
        if (finished) return;
        setStatus("Spiel startet …", 100);
        var i = 0;
        (function next() {
            if (finished) return;
            if (i >= START_KEYS.length) {
                timers.push(setTimeout(showGame, 700));
                return;
            }
            var code = START_KEYS[i++];
            press(code);
            release(code);
            timers.push(setTimeout(next, 450));
        })();
    }

    function onEngineLine(text) {
        if (arguments.length > 1) text = Array.prototype.slice.call(arguments).join(" ");
        console.log("[doom] " + text);
        if (/Running emscripten_set_main_loop/.test(text) && !engineUp) {
            engineUp = true;
            window.Module.wasmBinary = null;   // the instance exists, free the copy
            timers.push(setTimeout(autoStart, 1200));
        }
    }

    // ---------------------------------------------------------------- keys

    // KeyboardEvent.code -> legacy values. The Emscripten SDL2 layer reads code and keyCode.
    var KEYS = {
        ArrowUp: {key: "ArrowUp", kc: 38},
        ArrowDown: {key: "ArrowDown", kc: 40},
        ArrowLeft: {key: "ArrowLeft", kc: 37},
        ArrowRight: {key: "ArrowRight", kc: 39},
        ControlLeft: {key: "Control", kc: 17},
        Space: {key: " ", kc: 32},
        Enter: {key: "Enter", kc: 13},
        Escape: {key: "Escape", kc: 27},
        KeyY: {key: "y", kc: 89},
        BracketLeft: {key: "[", kc: 219},
        BracketRight: {key: "]", kc: 221}
    };

    var down = {};        // code -> how many fingers hold it
    var downSince = {};

    function dispatchKey(type, code) {
        var info = KEYS[code];
        if (!info) return;
        var ev = new KeyboardEvent(type, {
            key: info.key, code: code, keyCode: info.kc, which: info.kc, bubbles: true, cancelable: true
        });
        document.dispatchEvent(ev);   // bubbles up to window, where SDL listens
    }

    function press(code) {
        if (!down[code]) {
            down[code] = 0;
            downSince[code] = Date.now();
            dispatchKey("keydown", code);
        }
        down[code]++;
    }

    function release(code) {
        if (!down[code]) return;
        down[code]--;
        if (down[code] > 0) return;
        var wait = Math.max(0, MIN_HOLD_MS - (Date.now() - downSince[code]));
        setTimeout(function () {
            if (!down[code]) {           // not pressed again in the meantime
                delete down[code];
                dispatchKey("keyup", code);
            }
        }, wait);
    }

    function releaseAll() {
        Object.keys(down).forEach(function (code) {
            delete down[code];
            dispatchKey("keyup", code);
        });
    }

    // ---------------------------------------------------------------- buttons

    var activePointers = {};   // pointerId -> button

    function buttonKeys(btn) {
        var keys = btn.getAttribute("data-keys");
        return keys ? keys.split(",") : [];
    }

    function pointerDown(e) {
        var btn = e.currentTarget;
        e.preventDefault();
        touched();
        if (activePointers[e.pointerId]) return;
        activePointers[e.pointerId] = btn;
        try {
            btn.setPointerCapture(e.pointerId);
        } catch (err) {
            // synthetic or already gone pointer - still works without capture
        }
        btn.classList.add("down");
        buttonKeys(btn).forEach(press);
    }

    function pointerUp(e) {
        var btn = activePointers[e.pointerId];
        if (!btn) return;
        delete activePointers[e.pointerId];
        btn.classList.remove("down");
        buttonKeys(btn).forEach(release);
        touched();
        // "back" fires when the finger is lifted on the button, so a stray touch does not leave
        if (btn.getAttribute("data-action") === "back" && e.type === "pointerup") {
            var hit = document.elementFromPoint(e.clientX, e.clientY);
            if (hit === btn || btn.contains(hit)) leave("back");
        }
    }

    function wireButtons() {
        var buttons = document.querySelectorAll(".btn");
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].addEventListener("pointerdown", pointerDown);
            buttons[i].addEventListener("pointerup", pointerUp);
            buttons[i].addEventListener("pointercancel", pointerUp);
            buttons[i].addEventListener("lostpointercapture", pointerUp);
        }
        document.addEventListener("contextmenu", function (e) { e.preventDefault(); });
        // a real keyboard (development) counts as activity too
        document.addEventListener("keydown", function (e) { if (e.isTrusted) touched(); }, true);
        // never leave a key stuck down
        window.addEventListener("blur", releaseAll);
        window.addEventListener("pagehide", releaseAll);
    }

    // ---------------------------------------------------------------- start

    function main() {
        wireButtons();
        post("hb");
        timers.push(setInterval(function () { post("hb"); }, HEARTBEAT_MS));
        timers.push(setInterval(function () {
            if (!finished && Date.now() - lastInput > IDLE_MS) leave("idle");
        }, 5000));

        window.addEventListener("error", function (e) {
            console.error("[doom] error: " + e.message);
        });

        setStatus("Lade Dämonen … 0 %", 0);
        downloadAll().then(function (r) {
            if (finished) return;
            startEngine(r[0], r[1], r[2]);
        }, function (err) {
            // a missing file and a Chromium without file access look the same from here
            var hint = String(err.message || "").split(":")[0];
            if (window.location.protocol === "file:") {
                hint += " fehlt, oder Chromium läuft ohne --allow-file-access-from-files (kiosk.sh setzt das).";
            }
            fail("Doom konnte nicht geladen werden.", hint);
            console.error("[doom] " + err.message);
        });
    }

    main();
})();
