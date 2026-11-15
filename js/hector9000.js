const DM_State = {
    'CLOSED': 0,
    'OPENING': 1,
    'LOADING': 2,
    'RUNNING': 3,
    'REQUESTING': 4,
    'DOSING': 5,
    'CLOSING': 6
};

const MM_State = {
    'CLOSED': 0,
    'OPENING': 1,
    'RUNNING': 2,
    'FIXED': 3,
    'CLOSING': 4,
};

var started = false;
var DM_status = DM_State.CLOSED;
var MM_status = MM_State.CLOSED;

var displays = [];
var displaystate = 0;
var mqtt;

const host = "localhost";
const port = 9001;


const TopicDrinkList = "Hector9000/get_drinks";
const TopicIngredients = "Hector9000/get_ingredientsForDrink";
const TopicDose = "Hector9000/doseDrink";
const TopicClean = "Hector9000/cleanMe";
const TopicDry = "Hector9000/dryMe";
const TopicOpenAllValves = "Hector9000/openAllValves";
const TopicCloseAllValves = "Hector9000/closeAllValves";
const TopicReboot = "Hector9000/system/reboot";
const TopicKioskExit = "Hector9000/system/kioskExit";
const TopicLED = "Hector9000/LEDStrip/";

//--------- Testing start ---------------

// Open Main.html?testing to run without MQTT server (uses the test data below)
const testing = new URLSearchParams(window.location.search).has("testing");

var drinkjson = '{ "id": "123", "name": "Getränk","color": "#999999",' +
    '"description": "Ein Getränk",' +
    '"ingredients": [' +
    '{"name": "Cola", "ammount": 150},' +
    '{"name": "Club-Mate", "ammount": 100},' +
    '{"name": "Rum", "ammount": 50},' +
    '{"name": "Wasser", "ammount": 200},' +
    '{"name": "O-Saft", "ammount": 10}' +
    ']' +
    '}';
    
var jsont = '{"drinks": [{"name": "Tequilla Sunrise","id": 123, "alcohol": true},{"name": "bla2","id": 123, "alcohol": false},{"name": "bla3","id": 123, "alcohol": false},{"name": "bla4","id": 123, "alcohol": false},{"name": "bla5","id": 123, "alcohol": true},{"name": "bla6","id": 123, "alcohol": true},{"name": "bla7","id": 123, "alcohol": false}]}';

//--------- Testing end ---------------

//--------- Congress themes ---------------
// Colour themes from the 40C3 styleguide, defined in css/congress.css.

const THEMES = [
    {id: "dark", name: "Dark"},
    {id: "light", name: "Light"},
    {id: "pink", name: "Zero Day Pink"},
    {id: "green", name: "Rabbit Green"},
    {id: "teal", name: "Teal"},
    {id: "autumn", name: "Autumn"},
    {id: "yellow", name: "Danger Yellow"},
    {id: "lilac", name: "Cute Lilac"}
];
const THEME_KEY = "hector9000.theme";
var themeIndex = 0;

function loadThemeIndex() {
    try {
        let saved = window.localStorage.getItem(THEME_KEY);
        let idx = THEMES.findIndex(function (t) { return t.id === saved; });
        return idx >= 0 ? idx : 0;
    } catch (e) {
        return 0;
    }
}

function applyTheme(idx) {
    themeIndex = ((idx % THEMES.length) + THEMES.length) % THEMES.length;
    let theme = THEMES[themeIndex];
    if (theme.id === "dark") {
        document.documentElement.removeAttribute("data-theme");
    } else {
        document.documentElement.setAttribute("data-theme", theme.id);
    }
    let label = document.getElementById("theme-name");
    if (label) {
        label.innerText = theme.name;
    }
    try {
        window.localStorage.setItem(THEME_KEY, theme.id);
    } catch (e) {
        // storage not available - theme just isn't remembered
    }
    publish(TopicLED + "theme", theme.id, true);
}

function nextTheme() {
    applyTheme(themeIndex + 1);
    showToast(THEMES[themeIndex].name);
}

// apply as early as possible (script runs in <head>) to avoid a colour flash
applyTheme(loadThemeIndex());

//--------- LED strip ---------------
// Ambient LED mode; events (dosing, finish, cleaning) are handled by the LED server.

const LED_MODES = [
    {id: "theme", name: "Theme"},
    {id: "random", name: "Random"},
    {id: "idle", name: "Idle"},
    {id: "off", name: "Off"}
];
const LED_KEY = "hector9000.ledmode";
var ledIndex = 0;

function loadLedIndex() {
    try {
        let saved = window.localStorage.getItem(LED_KEY);
        let idx = LED_MODES.findIndex(function (m) { return m.id === saved; });
        return idx >= 0 ? idx : 0;
    } catch (e) {
        return 0;
    }
}

function applyLedMode(idx) {
    ledIndex = ((idx % LED_MODES.length) + LED_MODES.length) % LED_MODES.length;
    let label = document.getElementById("led-name");
    if (label) {
        label.innerText = LED_MODES[ledIndex].name;
    }
    try {
        window.localStorage.setItem(LED_KEY, LED_MODES[ledIndex].id);
    } catch (e) {
        // not remembered
    }
    publish(TopicLED + "ambient", LED_MODES[ledIndex].id, true);
}

function nextLedMode() {
    applyLedMode(ledIndex + 1);
    showToast("LED: " + LED_MODES[ledIndex].name);
}

// tell the LED server someone is using Hector (ends the idle animation)
var lastActivitySent = 0;

function sendActivity() {
    let now = Date.now();
    if (now - lastActivitySent > 10000) {
        lastActivitySent = now;
        publish(TopicLED + "activity", "1");
    }
}

document.addEventListener("pointerdown", sendActivity, true);

// publish the current state again after (re)connecting
function publishLedState() {
    publish(TopicLED + "theme", THEMES[themeIndex].id, true);
    publish(TopicLED + "ambient", LED_MODES[ledIndex].id, true);
}

ledIndex = loadLedIndex();

//--------- Toast ---------------

var toastTimer = null;

function showToast(text, ms) {
    let toast = document.getElementById("toast");
    if (!toast) return;
    toast.innerText = text;
    toast.className = "show";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
        toast.className = "";
    }, ms || 1500);
}

//--------- Reboot (two-step confirm, no browser dialogs) ---------------

var rebootArmed = false;
var rebootTimer = null;

function resetReboot() {
    rebootArmed = false;
    clearTimeout(rebootTimer);
    let but = document.getElementById("reboot-but");
    if (but) {
        but.className = "CM_button";
        document.getElementById("reboot-label").innerText = "REBOOT";
    }
}

function rebootTap() {
    if (!rebootArmed) {
        rebootArmed = true;
        document.getElementById("reboot-but").className = "CM_button armed";
        document.getElementById("reboot-label").innerText = "Tap again to reboot";
        rebootTimer = setTimeout(resetReboot, 4000);
        return;
    }
    resetReboot();
    if (publish(TopicReboot, "true")) {
        showToast("Rebooting ...", 4000);
    } else {
        showToast("Reboot failed: no connection", 3000);
    }
}

function showRebooting() {
    document.getElementById("loading-text").innerText = "Rebooting";
    document.getElementById("loading").className = "";
    // If the Pi is still up after 90 s the reboot did not happen - give the UI back.
    setTimeout(function () {
        document.getElementById("loading").className = "inv";
        document.getElementById("loading-text").innerText = "Loading Drinks";
        showToast("Reboot did not happen", 4000);
    }, 90000);
}

//--------- Doom easter egg ---------------
// Picking the cocktail "Doom" (any drink whose name contains "doom") opens doom/index.html -
// Chocolate Doom as WebAssembly with the free Freedoom levels - in an iframe on top of the UI.
// The page ends itself (back button, "Quit Game", idle, error) and tells us by postMessage.
// MQTT and the drink list keep running underneath; removing the iframe frees the game's memory.
// If the backend has no such drink we add a "Doom" button ourselves (?nodoom switches that off).
// kiosk.sh serves the UI over http://127.0.0.1, so no special Chromium flag is needed.
// (Only the file:// fallback of kiosk.sh and a hand-opened Main.html need --allow-file-access-from-files.)

const DOOM_URL = "doom/index.html";
const DOOM_DRINK_ID = "doom";
const DOOM_ADD_VIRTUAL_DRINK = !new URLSearchParams(window.location.search).has("nodoom");
const DOOM_BEAT_TIMEOUT_MS = 30000;      // the page sends a heartbeat every 5 s
const DOOM_MAX_MS = 30 * 60 * 1000;      // nobody plays Doom at the bar for longer than this
const TopicDoomEvent = "Hector9000/event/doom";

var doomOverlay = null;
var doomFrame = null;
var doomStarted = 0;
var doomLastBeat = 0;
var doomWatchdog = null;

function isDoomDrink(name) {
    return /doom/i.test(String(name || ""));
}

function addDoomDrink(json) {
    if (!DOOM_ADD_VIRTUAL_DRINK || !json || !Array.isArray(json.drinks)) return;
    if (json.drinks.some(function (d) { return d && isDoomDrink(d.name); })) return;
    json.drinks.push({name: "Doom", id: DOOM_DRINK_ID, alcohol: false});
}

// Only from the drink grid: not while a modal is open or a drink is being made.
function startDoom() {
    if (doomOverlay || MM_status !== MM_State.CLOSED || DM_status !== DM_State.CLOSED) return false;
    doomOverlay = document.createElement("div");
    doomOverlay.id = "doom-overlay";
    doomFrame = document.createElement("iframe");
    doomFrame.id = "doom-frame";
    doomFrame.setAttribute("title", "Doom");
    doomFrame.setAttribute("allow", "autoplay");
    doomFrame.src = DOOM_URL;
    doomOverlay.appendChild(doomFrame);
    document.body.appendChild(doomOverlay);
    window.addEventListener("message", onDoomMessage);
    doomStarted = Date.now();
    doomLastBeat = doomStarted;
    doomWatchdog = setInterval(doomWatch, 5000);
    sendActivity();
    return true;
}

function stopDoom(reason, seconds) {
    if (!doomOverlay) return;
    window.removeEventListener("message", onDoomMessage);
    clearInterval(doomWatchdog);
    doomWatchdog = null;
    doomFrame.src = "about:blank";   // stops the engine at once
    doomOverlay.remove();
    doomOverlay = null;
    doomFrame = null;
    let played = (typeof seconds === "number" && seconds >= 0) ? Math.round(seconds) : Math.round((Date.now() - doomStarted) / 1000);
    if (played > 0) {
        publish(TopicDoomEvent, JSON.stringify({seconds: played, reason: String(reason || ""), ts: Date.now() / 1000}));
    }
    publish(TopicLED + "activity", "1");
    lastActivitySent = Date.now();
}

function onDoomMessage(e) {
    // only our own game frame may talk to us
    if (!doomFrame || e.source !== doomFrame.contentWindow) return;
    let msg = e.data;
    if (!msg || msg.source !== "hector-doom") return;
    if (msg.type === "hb") {
        doomLastBeat = Date.now();
    } else if (msg.type === "activity") {
        doomLastBeat = Date.now();
        sendActivity();
    } else if (msg.type === "exit") {
        stopDoom(msg.reason, msg.seconds);
    }
}

function doomWatch() {
    let now = Date.now();
    if (now - doomLastBeat > DOOM_BEAT_TIMEOUT_MS) {
        stopDoom("hung");
    } else if (now - doomStarted > DOOM_MAX_MS) {
        stopDoom("max");
    }
}

//--------- Secret fullscreen exit ---------------
// Tap the invisible zone in the top left corner 5 times within 3 seconds.
// A kiosk browser cannot leave fullscreen from JS, so the backend stops it.

const SECRET_TAPS = 5;
const SECRET_WINDOW_MS = 3000;
var secretTaps = [];

function secretExitTap() {
    let now = Date.now();
    secretTaps = secretTaps.filter(function (t) { return now - t < SECRET_WINDOW_MS; });
    secretTaps.push(now);
    if (secretTaps.length < SECRET_TAPS) return;
    secretTaps = [];
    exitFullscreen();
}

function exitFullscreen() {
    // normal (non-kiosk) browser fullscreen
    if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(function () {});
    }
    if (publish(TopicKioskExit, "true")) {
        showToast("Leaving fullscreen ...", 3000);
    } else {
        showToast("Exit failed: no connection", 3000);
    }
}

//--------- Drink buttons ---------------

// Drink and ingredient names come from the backend database (and thus from
// whoever can edit it), so they must never be inserted into the page as raw HTML.
function escapeHtml(value) {
    return String(value === undefined || value === null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function generateButton(name, id, alc) {
    shtml = '<div onclick="openDrinkModal(this)" class="button ';
    if (alc) {
        shtml += 'alc';
    }
    shtml += '" d_id="' + escapeHtml(id) + '" d_name="' + escapeHtml(name) + '"><div class="name">' + escapeHtml(name) + "</div></div>";
    return shtml;
}

function generateButtons(drinksjson) {
started = true;
    var json = JSON.parse(drinksjson);
    addDoomDrink(json);
    jl = json.drinks.length;
    cont = document.getElementById("content");
    count = 0;
    teiler = parseInt(jl / 6);
    for (i = 0; i < parseInt(jl / 6); i++) {
        count++;
        html = '<div class="buttons" id="id' + (i + 1) + '">';
        html += '<div class="row r1">';
        for (j = 0; j < 3; j++) {
            html += generateButton(json.drinks[(6 * i + j)].name, json.drinks[(6 * i + j)].id, json.drinks[(6 * i + j)].alcohol);
        }
        html += '</div><div class="row r2">';
        for (j = 0; j < 3; j++) {
            html += generateButton(json.drinks[(6 * i + 3 + j)].name, json.drinks[(6 * i + 3 + j)].id, json.drinks[(6 * i + 3 + j)].alcohol);
        }
        html += '</div></div>';
        cont.innerHTML += html;
        displays.push("id" + (i + 1));
    }
    rest = json.drinks.length % 6;
    ammont = (teiler * 6);
    if (rest > 0) {
        ct = 0;
        html = '<div class="buttons" id="id' + (count + 1) + '"><div class="row r1">';
        if (rest >= 4) {
            for (i = 0; i < 3; i++) {
                html += generateButton(json.drinks[(ammont + i)].name, json.drinks[(ammont + i)].id, json.drinks[(ammont + i)].alcohol);
            }
            html += '</div><div class="row r2">';
            ct = 3;
        }
        do {
            html += generateButton(json.drinks[(ammont + ct)].name, json.drinks[(ammont + ct)].id, json.drinks[(ammont + ct)].alcohol);
            ct++;
        } while (ct < rest);
        html += '</div></div>';
        cont.innerHTML += html;
        displays.push("id" + (count + 1));
    }
    for (i = 0; i < displays.length; i++) {
        document.getElementById(displays[i]).style.right = "" + (-i * 100 + 10) + "%";
    }
    document.addEventListener('keydown', keydown);
    document.getElementById("loading").className = "inv";
}

function startup() {
    applyTheme(themeIndex); // fill theme label now that the DOM exists
    applyLedMode(ledIndex);
    if (testing) {
        started = true;
        generateButtons(jsont);
    } else {
        setUpMQTT();
    }
}

// Mainmodal
function openModal() {
    if (MM_status === MM_State.CLOSED) {
        let main_modal = document.getElementById("mainModal");
        main_modal.className = "modal open";
        MM_status = MM_State.OPENING;
        setTimeout(function () {
            openModalBack();
            MM_status = MM_State.RUNNING;
        }, 1100);
    }
}

function closeModal() {
    if (MM_status === MM_State.RUNNING) {
        let main_modal = document.getElementById("mainModal");
        main_modal.className = "modal trans";
        setTimeout(function () {
            document.getElementById("mod-config").className = "inv";
            document.getElementById("mod-drink").className = "inv";
        }, 300);
        setTimeout(function () {
            main_modal.className = "modal";
            closeModalBack();
            MM_status = MM_State.CLOSED;
        }, 1000);
        MM_status = MM_State.CLOSING;
    }
}

function closeEitherModal() {
    if (MM_status === MM_State.RUNNING) {
        if (DM_status !== DM_State.CLOSED) {
            closeDrinkModal();
        } else {
            closeConfigModal();
        }
    }
}

// Drinkmodal
function resetDM() {
    document.getElementById("DM_name").innerHTML = "";
    document.getElementById("DM_List").innerHTML = "<div id=\"DM_ing_loader\"><div><div class=\"lds-roller\"><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div></div></div></div>";
    document.getElementById("DM_zubereiten").onclick = function () {
    };
    document.getElementById("DM_zubereiten").disabled = true;
    document.getElementById("mod-drink").setAttribute("d_id", "");
}

function closeDrinkModal() {
    if (DM_status === DM_State.RUNNING || DM_status === DM_State.LOADING) {
        DM_status = DM_State.CLOSING;
        if (!dosingFinished) {
            publish(TopicLED + "deselect", "1");  // keep the finish animation running
        }
        dosingFinished = false;
        closeModal();
        setTimeout(function () {
            document.getElementById("DM_ing_loader").className = "";
            resetDM();
            DM_status = DM_State.CLOSED;
        }, 1000)
    }
}

function openDrinkModal(drinkinfo) {
    if (MM_status === MM_State.CLOSED) {
        if (isDoomDrink(drinkinfo.getAttribute("d_name"))) {
            startDoom();   // the cocktail "Doom" is not poured - it starts the game
            return;
        }
        openModal();
        DM_status = DM_State.OPENING;
        setTimeout(function () {
            document.getElementById("mod-drink").className = "";
        }, 700);
        let d_name = "<u>" + escapeHtml(drinkinfo.getAttribute("d_name"));
        if (drinkinfo.className.includes("alc")) {
            d_name += "  (alc) ";
        }
        d_name += "</u>";
        document.getElementById("DM_name").innerHTML = d_name;
        document.getElementById("mod-drink").setAttribute("d_id", drinkinfo.getAttribute("d_id"));
        publish(TopicLED + "select", drinkinfo.getAttribute("d_id"));
        if (testing) {
            DM_status = DM_State.LOADING;
            setTimeout(showIngredientsAndButton(drinkjson), 800);
        } else {
            DM_status = DM_State.LOADING;
    publish(TopicIngredients, drinkinfo.getAttribute("d_id"));
        }
    }
}

function showIngredientsAndButton(json) {
    let drinkinfo = JSON.parse(json);
console.log(drinkinfo);
console.log(document.getElementById("mod-drink"));
    if (drinkinfo.id != document.getElementById("mod-drink").getAttribute("d_id")) {
        console.log("not doing stuff");
    return;
    }
    if (DM_status === DM_State.LOADING) {
    console.log("doing stuff");
        document.getElementById("DM_ing_loader").className = "inv";
        document.getElementById("DM_zubereiten").disabled = false;
        document.getElementById("DM_zubereiten").onclick = function () {
            doseDrink(drinkinfo.id);
        };
        for (let i = 0; i < drinkinfo.ingredients.length; i++) {
            document.getElementById("DM_List").innerHTML += '<div class="DM_ing"><div class="DM_ing_amm">' + escapeHtml(drinkinfo.ingredients[i].ammount) + 'ml</div><div class="DM_ing_name">' + escapeHtml(drinkinfo.ingredients[i].name) + '</div></div>';
        }
        DM_status = DM_State.RUNNING;
    }
console.log(DM_status);
}


// Configmodal
function resetCM() {
    resetReboot();
}

function closeConfigModal() {
    if (MM_status === MM_State.RUNNING && DM_status === DM_State.CLOSED) {
        closeModal();
        setTimeout(function () {
            resetCM();
        }, 1000)
    }
}

function openConfigModal() {
    if (MM_status === MM_State.CLOSED) {
        openModal();
        setTimeout(function () {
            document.getElementById("mod-config").className = "";
        }, 700);
    }
}


// Modalback
function openModalBack() {
    document.getElementById("modalclose").className = "";
}

function closeModalBack() {
    document.getElementById("modalclose").className = "MC_cls";
}

function doseDrink(id) {
    if (DM_status === DM_State.RUNNING) {
        if (testing) {
            MM_status = MM_State.FIXED;
            DM_status = DM_State.DOSING;
            //alert("TESTING - DOSING DRINK");
            document.getElementById("DM_zubereiten_loading").className = "";
            document.getElementById("DM_zubereiten").className = "DM_button loader_active";
            setTimeout(function () {
                document.getElementById("DM_abbruch").className = "DM_button dis";
                document.getElementById("DM_zubereiten").className = "DM_button dis";
                setTimeout(function () {
                    document.getElementById("DM_abbruch").className = "DM_button inv";
                    document.getElementById("DM_zubereiten").className = "DM_button inv";
                    document.getElementById("DM_dose_bar").className = "";
                    updateDosingState(id, 5);
                }, 500);
            }, 3000);
            setTimeout(function () {
                document.getElementById("DM_zubereiten_loading").className = "inv";
                document.getElementById("DM_zubereiten").className = "DM_button";
                doseEnded()
            }, 30000);
        } else {
            DM_status = DM_State.REQUESTING;
            publish(TopicDose, id.toString());
            document.getElementById("DM_zubereiten_loading").className = "";
            document.getElementById("DM_zubereiten").className = "DM_button loader_active";
    setTimeout(function(){doseStart("abc");}, 1000);
        }
    }
}

function doseStart(id) {
    if (DM_status === DM_State.REQUESTING) {
        DM_status = DM_State.DOSING;
        document.getElementById("DM_buttons").className = "dis";
    console.log("start");
        setTimeout(function () {
            document.getElementById("DM_zubereiten").className = "DM_button inv";
            document.getElementById("DM_abbruch").className = "DM_button inv";
            document.getElementById("DM_dose_bar").className = "";
            document.getElementById("DM_zubereiten_loading").className = "inv";
    }, 500)}
   // setTimeout(function(){doseEnded();}, 45000);
}

function updateDosingState(update) {
    console.log("update " + update); 
    if (DM_status === DM_State.DOSING){
        let inner = document.getElementById("inner_bar");
        update = update.split(".")[0];
        inner.style.width = update + "%";
        inner.getElementsByTagName("div")[0].innerText = update + "%";
    }
}

var dosingFinished = false;

function doseEnded() {
    if (DM_status === DM_State.DOSING) {
        dosingFinished = true;
        DM_status = DM_State.RUNNING;
        MM_status = MM_State.RUNNING;
        closeDrinkModal();
        setTimeout(function () {
            document.getElementById("DM_zubereiten").className = "DM_button";
            document.getElementById("DM_abbruch").className = "DM_button";
            document.getElementById("DM_dose_bar").className = "dis inv";
        }, 600);
    }

}

//Keyevents

function keydown(e) {
    if (doomOverlay) return;   // arrow keys belong to the game
    if (e.code === "ArrowRight" || e.code === "KeyD") {
        right();
    } else if (e.code === "ArrowLeft" || e.code === "KeyA") {
        left();
    }
}

function right() {
    if (MM_status === MM_State.RUNNING) {
        closeEitherModal();
    } else if (MM_status !== MM_State.CLOSED) {
    } else if (displaystate < displays.length - 1) {
        displaystate++;
        for (i = 0; i < displays.length; i++) {
            rg = "" + ((-i + displaystate) * 100 + 10) + "%";
            document.getElementById(displays[i]).style.right = rg;
        }
    } else if (displaystate === displays.length - 1) {
        displaystate = 0;
        for (i = 0; i < displays.length; i++) {
            rg = "" + ((-i + displaystate) * 100 + 10) + "%";
            document.getElementById(displays[i]).style.right = rg;
        }
    }
}

function left() {
    if (MM_status === MM_State.RUNNING) {
        closeEitherModal();
    } else if (MM_status !== MM_State.CLOSED) {
    } else if (displaystate > 0) {
        displaystate--;
        for (i = 0; i < displays.length; i++) {
            rg = "" + ((-i + displaystate) * 100 + 10) + "%";
            document.getElementById(displays[i]).style.right = rg;
        }
    } else if (displaystate === 0) {
        displaystate = displays.length - 1;
        for (i = 0; i < displays.length; i++) {
            rg = "" + ((-i + displaystate) * 100 + 10) + "%";
            document.getElementById(displays[i]).style.right = rg;
        }
    }
}

//MQTT

function IngredientSubscriber(payload) {
console.log("ingredientsub");
    if(DM_status === DM_State.LOADING){
        showIngredientsAndButton(payload);
    }
}

function DrinkSubscriber(payload) {
    if(!started){
        generateButtons(payload);
    }
}

function DoseStartSubscriber(payload) {
  // console.log(payload);
  // console.log(document.getElementById("mod-drink").getAttribute("d_id"));
    if (DM_status === DM_State.REQUESTING && payload == document.getElementById("mod-drink").getAttribute("d_id")){
        doseStart(payload);
    console.log("id was equal in startsubscriber");
    }
}

// Returns true if the message was handed to the broker connection.
// retained: the broker keeps the last value for clients that connect later.
function publish(topic, payload, retained) {
    console.log("publish-t: " + topic);
    console.log("publish-m: " + payload);
    if (testing || !mqtt) {
        console.log("publish skipped: not connected");
        return false;
    }
    try {
        let message = new Paho.MQTT.Message(payload);
        message.destinationName = topic;
        if (retained) {
            message.retained = true;
        }
        mqtt.send(message);
        return true;
    } catch (e) {
        console.log("publish failed: " + e);
        return false;
    }
}

function SystemReturnSubscriber(topic, payload) {
    if (topic === TopicReboot + "/return") {
        if (payload === "ok") {
            showRebooting();
        } else {
            showToast("Reboot failed", 3000);
        }
    } else if (topic === TopicKioskExit + "/return" && payload !== "ok") {
        showToast("Exit failed", 3000);
    }
}

function DrinkProcessSubscriber(payload) {
if (DM_status === DM_State.DOSING) {
        if (payload == "end" || payload.startsWith("100")) {
            doseEnded();
        } else {
            updateDosingState(payload);
        }
    }
}

function messageArrived(msg) {
    publish("logging", msg.destinationName + " - " + msg.payloadString);
console.log("topic: " + msg.destinationName);
console.log("payload: " + msg.payloadString);
    let topic = msg.destinationName;
    if (topic === TopicDrinkList + "/return") {
        DrinkSubscriber(msg.payloadString);
    } else if (topic === TopicIngredients + "/return") {
        IngredientSubscriber(msg.payloadString);
    } else if (topic === TopicDose + "/return") {
        DoseStartSubscriber(msg.payloadString);
    } else if (topic === TopicDose + "/progress") {
        DrinkProcessSubscriber(msg.payloadString);
    } else if (topic === TopicReboot + "/return" || topic === TopicKioskExit + "/return") {
        SystemReturnSubscriber(topic, msg.payloadString);
    }
}

function onConnect() {
    mqtt.subscribe(TopicDrinkList + "/return");
    mqtt.subscribe(TopicIngredients + "/return");
    mqtt.subscribe(TopicDose + "/progress");
    mqtt.subscribe(TopicDose + "/return");
    mqtt.subscribe(TopicReboot + "/return");
    mqtt.subscribe(TopicKioskExit + "/return");
    publishLedState();
    publishatstart();
}

function publishatstart(){
if(!started){
    publish(TopicDrinkList, "true");
    setTimeout(function e(){ publishatstart();},5000);
}	
}

function connectMQTT() {
    mqtt.connect({
        timeout: 3,
        onSuccess: onConnect,
        onFailure: function () {
            // broker not up yet (e.g. right after boot) - keep trying
            setTimeout(connectMQTT, 3000);
        }
    });
}

function setUpMQTT() {
    // unique id: two UIs with the same id would keep kicking each other off the broker
    mqtt = new Paho.MQTT.Client(host, port, "HectorFrontend-" + Math.random().toString(16).slice(2, 10));
    mqtt.onMessageArrived = messageArrived;
    mqtt.onConnectionLost = function () {
        setTimeout(connectMQTT, 3000);
    };
    connectMQTT();
}
