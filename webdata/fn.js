/*
 *    Copyright (c) 2018 Unrud<unrud@outlook.com>
 *
 *    This file is part of Remote-Touchpad.
 *
 *    Foobar is free software: you can redistribute it and/or modify
 *    it under the terms of the GNU General Public License as published by
 *    the Free Software Foundation, either version 3 of the License, or
 *    (at your option) any later version.
 *
 *    Remote-Touchpad is distributed in the hope that it will be useful,
 *    but WITHOUT ANY WARRANTY; without even the implied warranty of
 *    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *    GNU General Public License for more details.
 *
 *   You should have received a copy of the GNU General Public License
 *   along with Foobar.  If not, see <http://www.gnu.org/licenses/>.
 */

// [1 Touch, 2 Touches, 3 Touches]
const TOUCH_MOVE_THRESHOLD = [10, 15, 15];
const TOUCH_TIMEOUT = 250;
// [[px/s, mult], ...]
const POINTER_ACCELERATION = [
    [0, 0],
    [87, 1],
    [173, 1],
    [553, 2]
];

const POINTER_BUTTON_LEFT = 0;
const POINTER_BUTTON_RIGHT = 1;
const POINTER_BUTTON_MIDDLE = 2;

const KEY_VOLUME_MUTE = 0;
const KEY_VOLUME_DOWN = 1;
const KEY_VOLUME_UP = 2;
const KEY_MEDIA_PLAY_PAUSE = 3;
const KEY_MEDIA_PREV_TRACK = 4;
const KEY_MEDIA_NEXT_TRACK = 5;

var ws;
var pad;
var padlabel;

var touchMoved = false;
var touchStart = 0;
var touchLastEnd = 0;
var touchReleasedCount = 0;
var ongoingTouches = [];
var moveXSum = 0;
var moveYSum = 0;
var scrollXSum = 0;
var scrollYSum = 0;
var dragging = false;
var draggingTimeout = null;
var scrolling = false;

function fullscreenEnabled() {
    return (document.fullscreenEnabled ||
        document.webkitFullscreenEnabled ||
        document.mozFullScreenEnabled ||
        document.msFullscreenEnabled ||
        false);
}

function requestFullscreen(e) {
    if (e.requestFullscreen) {
        e.requestFullscreen();
    } else if (e.webkitRequestFullscreen) {
        e.webkitRequestFullscreen();
    } else if (e.mozRequestFullScreen) {
        e.mozRequestFullScreen();
    } else if (e.msRequestFullscreen) {
        e.msRequestFullscreen();
    }
}

function exitFullscreen() {
    if (document.exitFullscreen) {
        document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
    } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
    } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
    }
}

function fullscreenElement() {
    return (document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement ||
        null);
}

function addFullscreenchangeEventListener(listener) {
    if (document.fullscreenElement !== undefined) {
        document.addEventListener("fullscreenchange", listener);
    } else if (document.webkitFullscreenElement !== undefined) {
        document.addEventListener("webkitfullscreenchange", listener);
    } else if (document.mozFullScreenElement !== undefined) {
        document.addEventListener("mozfullscreenchange", listener);
    } else if (document.msFullscreenElement !== undefined) {
        document.addEventListener("MSFullscreenChange", listener);
    }
}

function copyTouch(touch, timeStamp) {
    return {
        identifier: touch.identifier,
        pageX: touch.pageX,
        pageXStart: touch.pageX,
        pageY: touch.pageY,
        pageYStart: touch.pageY,
        timeStamp: timeStamp
    };
}

function ongoingTouchIndexById(idToFind) {
    for (var i = 0; i < ongoingTouches.length; i++) {
        var id = ongoingTouches[i].identifier;

        if (id == idToFind) {
            return i;
        }
    }
    return -1;
}

function calculatePointerAccelerationMult(speed) {
    for (var i = 0; i < POINTER_ACCELERATION.length; i++) {
        s2 = POINTER_ACCELERATION[i][0];
        a2 = POINTER_ACCELERATION[i][1];
        if (s2 <= speed) {
            continue;
        }
        if (i == 0) {
            return a2;
        }
        s1 = POINTER_ACCELERATION[i - 1][0];
        a1 = POINTER_ACCELERATION[i - 1][1];
        return ((speed - s1) / (s2 - s1)) * (a2 - a1) + a1;
    }
    if (POINTER_ACCELERATION.length > 0) {
        return POINTER_ACCELERATION[POINTER_ACCELERATION.length - 1][1];
    }
    return 1;
}

function onDraggingTimeout() {
    draggingTimeout = null;
    ws.send("b" + POINTER_BUTTON_LEFT + ";0");
}

function updateMoveAndScroll() {
    var moveX = Math.trunc(moveXSum);
    var moveY = Math.trunc(moveYSum);
    if (Math.abs(moveX) >= 1 || Math.abs(moveY) >= 1) {
        moveXSum -= moveX;
        moveYSum -= moveY;
        ws.send("m" + moveX + ";" + moveY);
    }
    var scrollX = Math.trunc(scrollXSum);
    var scrollY = Math.trunc(scrollYSum);
    if (Math.abs(scrollX) >= 1 || Math.abs(scrollY) >= 1) {
        scrollXSum -= scrollX;
        scrollYSum -= scrollY;
        scrolling = true;
        ws.send("s" + scrollX + ";" + scrollY);
    }
}

function handleStart(evt) {
    if (ongoingTouches.length == 0) {
        touchStart = evt.timeStamp;
        touchMoved = false;
        touchReleasedCount = 0;
        dragging = false;
    }
    var touches = evt.changedTouches;
    for (var i = 0; i < touches.length; i++) {
        if (touches[i].target !== pad && touches[i].target !== padlabel) {
            continue;
        }
        evt.preventDefault();
        ongoingTouches.push(copyTouch(touches[i], evt.timeStamp));
        touchLastEnd = 0;
        if (!dragging) {
            moveXSum = Math.trunc(moveXSum);
            moveYSum = Math.trunc(moveYSum);
        }
        scrollXSum = Math.trunc(scrollXSum);
        scrollYSum = Math.trunc(scrollYSum);
        if (draggingTimeout !== null) {
            clearTimeout(draggingTimeout);
            draggingTimeout = null;
            dragging = true;
        }
        if (scrolling) {
            ws.send("sf");
            scrolling = false;
        }
    }
}

function handleEnd(evt) {
    var touches = evt.changedTouches;
    for (var i = 0; i < touches.length; i++) {
        var idx = ongoingTouchIndexById(touches[i].identifier);
        if (idx < 0) {
            continue;
        }
        ongoingTouches.splice(idx, 1);
        touchReleasedCount++;
        touchLastEnd = evt.timeStamp;
        if (scrolling) {
            ws.send("sf");
            scrolling = false;
        }
    }
    if (touchReleasedCount > TOUCH_MOVE_THRESHOLD.length) {
        touchMoved = true;
    }
    if (ongoingTouches.length == 0 && touchReleasedCount >= 1 &&
        dragging) {
        ws.send("b" + POINTER_BUTTON_LEFT + ";0");
    }
    if (ongoingTouches.length == 0 && touchReleasedCount >= 1 &&
        !touchMoved && evt.timeStamp - touchStart < TOUCH_TIMEOUT) {
        var button = 0;
        if (touchReleasedCount == 1) {
            button = POINTER_BUTTON_LEFT;
        } else if (touchReleasedCount == 2) {
            button = POINTER_BUTTON_RIGHT;
        } else if (touchReleasedCount == 3) {
            button = POINTER_BUTTON_MIDDLE;
        }
        ws.send("b" + button + ";1");
        if (button == POINTER_BUTTON_LEFT) {
            draggingTimeout = setTimeout(onDraggingTimeout, TOUCH_TIMEOUT);
        } else {
            ws.send("b" + button + ";0");
        }
    }
}

function handleCancel(evt) {
    var touches = evt.changedTouches;
    for (var i = 0; i < touches.length; i++) {
        var idx = ongoingTouchIndexById(touches[i].identifier);
        if (idx < 0) {
            continue;
        }
        ongoingTouches.splice(idx, 1);
        touchReleasedCount++;
        touchLastEnd = evt.timeStamp;
        touchMoved = true;
        if (scrolling) {
            ws.send("sf");
            scrolling = false;
        }
    }
}

function handleMove(evt) {
    var sumX = 0;
    var sumY = 0;
    var touches = evt.changedTouches;
    for (var i = 0; i < touches.length; i++) {
        var idx = ongoingTouchIndexById(touches[i].identifier);
        if (idx < 0) {
            continue;
        }
        if (!touchMoved) {
            var dist = Math.sqrt(Math.pow(touches[i].pageX - ongoingTouches[idx].pageXStart, 2) +
                Math.pow(touches[i].pageY - ongoingTouches[idx].pageYStart, 2));
            if (ongoingTouches.length > TOUCH_MOVE_THRESHOLD.length ||
                dist > TOUCH_MOVE_THRESHOLD[ongoingTouches.length - 1] ||
                evt.timeStamp - touchStart >= TOUCH_TIMEOUT) {
                touchMoved = true;
            }
        }
        var dx = touches[i].pageX - ongoingTouches[idx].pageX;
        var dy = touches[i].pageY - ongoingTouches[idx].pageY;
        var timeDelta = evt.timeStamp - ongoingTouches[idx].timeStamp;
        sumX += dx * calculatePointerAccelerationMult(Math.abs(dx) / timeDelta * 1000);
        sumY += dy * calculatePointerAccelerationMult(Math.abs(dy) / timeDelta * 1000);
        ongoingTouches[idx].pageX = touches[i].pageX;
        ongoingTouches[idx].pageY = touches[i].pageY;
        ongoingTouches[idx].timeStamp = evt.timeStamp;
    }
    if (touchMoved && evt.timeStamp - touchLastEnd >= TOUCH_TIMEOUT) {
        if (ongoingTouches.length == 1 || dragging) {
            moveXSum += sumX;
            moveYSum += sumY;
        } else if (ongoingTouches.length == 2) {
            scrollXSum -= sumX;
            scrollYSum -= sumY;
        }
        updateMoveAndScroll();
    }
}

function challengeResponse(message) {
    var shaObj = new jsSHA("SHA-256", "TEXT");
    shaObj.setHMACKey(message, "TEXT");
    shaObj.update(window.location.hash.substr(1));
    return btoa(shaObj.getHMAC("BYTES"));
}

window.addEventListener("load", function() {
    var authenticated = false;
    var opening = document.getElementById("opening");
    var closed = document.getElementById("closed");
    pad = document.getElementById("pad");
    padlabel = document.getElementById("padlabel");
    var keys = document.getElementById("keys");
    var keyboard = document.getElementById("keyboard");
    var fullscreenbutton = document.getElementById("fullscreenbutton");
    var text = document.getElementById("text");

    function showScene(scene) {
        [opening, closed, pad, keys, keyboard].forEach(function (e) {
            e.style.display = e == scene ? "flex" : "none";
        });
    }

    function showKeys() {
        exitFullscreen();
        showScene(keys);
        if (history.state != "keys") {
            history.pushState("keys", "");
        }
    }

    function showKeyboard() {
        exitFullscreen();
        showScene(keyboard);
        text.focus();
        if (history.state != "keyboard") {
            history.pushState("keyboard", "");
        }
    }

    text.value = "";
    showScene(opening);

    var wsProtocol = "wss:";
    if (location.protocol == "http:") {
        wsProtocol = "ws:";
    }
    ws = new WebSocket(wsProtocol + "//" + location.hostname +
        (location.port ? ":" + location.port : "") +
        "/ws");

    ws.onmessage = function(event) {
        if (authenticated) {
            ws.close();
            return;
        }
        authenticated = true;
        ws.send(challengeResponse(event.data));
        if (history.state == "keyboard") {
            showKeyboard();
        } else if (history.state == "keys") {
            showKeys()
        } else {
            showScene(pad);
        }
    };

    ws.onclose = function() {
        exitFullscreen();
        showScene(closed);
    };

    document.getElementById("keysbutton").addEventListener("click", showKeys);
    document.getElementById("keyboardbutton").addEventListener("click", showKeyboard);
    if (!fullscreenEnabled()) {
        fullscreenbutton.style.display = "none";
    }
    fullscreenbutton.addEventListener("click", function() {
        if (fullscreenElement()) {
            exitFullscreen();
        } else {
            requestFullscreen(pad);
        }
    });
    [{id: "prevtrackbutton", key: KEY_MEDIA_PREV_TRACK},
     {id: "playpausebutton", key: KEY_MEDIA_PLAY_PAUSE},
     {id: "nexttrackbutton", key: KEY_MEDIA_NEXT_TRACK},
     {id: "volumedownbutton", key: KEY_VOLUME_DOWN},
     {id: "volumemutebutton", key: KEY_VOLUME_MUTE},
     {id: "volumeupbutton", key: KEY_VOLUME_UP}].forEach(function(o) {
        document.getElementById(o.id).addEventListener("click",
            function() {
                ws.send("k" + o.key);
            });
     });
    document.getElementById("sendbutton").addEventListener("click",
        function() {
            if (text.value != "") {
                ws.send("t" + text.value);
                text.value = "";
            }
            window.history.back();
        });
    window.onpopstate = function() {
        if (pad.style.display != "none" ||
                keyboard.style.display != "none" ||
                keys.style.display != "none") {
            if (history.state == "keys") {
                showKeys();
            } else if (history.state == "keyboard") {
                showKeyboard();
            } else {
                showScene(pad);
            }
        }
    };
    document.getElementById("reloadbutton").addEventListener("click",
        function() {
            location.reload();
        });
    pad.addEventListener("touchstart", handleStart, false);
    pad.addEventListener("touchend", handleEnd, false);
    pad.addEventListener("touchcancel", handleCancel, false);
    pad.addEventListener("touchmove", handleMove, false);
}, false);
