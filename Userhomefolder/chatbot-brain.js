(function (global) {
    "use strict";

    var DEFAULT_BIKE_CATALOG = [
        { model: "BLITZ 2000", price: 68000, category: "2-Wheel", aliases: ["blitz 2000"] },
        { model: "BLITZ 1200", price: 45000, category: "2-Wheel", aliases: ["blitz 1200"] },
        { model: "FUN 1500 FI", price: 24000, category: "2-Wheel", aliases: ["fun 1500 fi", "fun 1500"] },
        { model: "CANDY 800", price: 39000, category: "2-Wheel", aliases: ["candy 800"] },
        { model: "BLITZ 200R", price: 40000, category: "2-Wheel", aliases: ["blitz 200r"] },
        { model: "TRAVELLER 1500", price: 78000, category: "4-Wheel", aliases: ["traveller 1500", "traveler 1500", "traveller 1500 4 wheel", "traveler 1500 4 wheel"] },
        { model: "ECONO 500 MP", price: 51000, category: "3-Wheel", aliases: ["econo 500 mp"] },
        { model: "ECONO 350 MINI-II", price: 39000, category: "3-Wheel", aliases: ["econo 350 mini ii", "econo 350 mini", "mini ii"] },
        { model: "ECARGO 100", price: 72500, category: "3-Wheel", aliases: ["ecargo 100", "e cargo 100"] },
        { model: "ECONO 650 MP", price: 65000, category: "3-Wheel", aliases: ["econo 650 mp"] },
        { model: "ECAB 100V V2", price: 51500, category: "3-Wheel", aliases: ["ecab 100v v2", "ecab 1000 ii", "ecab v2"] },
        { model: "ECONO 800 MP II", price: 67000, category: "3-Wheel", aliases: ["econo 800 mp ii", "econo 800 mp 2"] },
        { model: "E-CARGO 800", price: 65000, category: "3-Wheel", aliases: ["e cargo 800", "ecargo 800"] },
        { model: "E-CAB MAX 1500", price: 130000, category: "3-Wheel", aliases: ["e cab max 1500", "ecab max 1500"] },
        { model: "E-CAB 1000", price: 75000, category: "3-Wheel", aliases: ["e cab 1000", "ecab 1000"] },
        { model: "ECONO 800 MP", price: 60000, category: "3-Wheel", aliases: ["econo 800 mp"] }
    ];

    function normalizeBranchStorageKey(value) {
        return String(value || "")
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
    }

    var branchCity = global.EcodriveSession && typeof global.EcodriveSession.getCurrentUser === "function"
        ? global.EcodriveSession.getCurrentUser().branchCity
        : "";
    var branchKey = normalizeBranchStorageKey(branchCity);
    var PRODUCT_STORAGE_KEY = branchKey ? "ecodrive_product_catalog:" + branchKey : "ecodrive_product_catalog";
    var BOOKING_KEYS = ["ecodrive_bookings", "ecodrive_orders", "orders"];
    var CURRENT_USER_KEY = "ecodrive_current_user_email";
    var LEGACY_CHAT_STORAGE_KEY = "ecodrive_chat_messages_v1";
    var SCOPED_CHAT_STORAGE_PREFIX = "ecodrive_chat_messages_v2::";
    var CHAT_THREAD_MODE_BOT = "bot";
    var CHAT_THREAD_MODE_ADMIN = "admin";
    var CHAT_SYNC_INTERVAL_MS = 3000;
    var CHAT_MAX_LOCAL_MESSAGES = 180;
    var CHAT_MAX_PUSH_BATCH = 60;
    var CHAT_MAX_MEDIA_BYTES = Number.POSITIVE_INFINITY;
    var CHAT_MAX_MEDIA_DATA_URL_LENGTH = Number.POSITIVE_INFINITY;
    var CHAT_ALLOWED_MEDIA_TYPES = {
        image: true,
        video: true,
        audio: true
    };
    var API_BASE = String(
        localStorage.getItem("ecodrive_api_base")
        || localStorage.getItem("ecodrive_kyc_api_base")
        || (global.EcodriveSession && typeof global.EcodriveSession.getApiBase === "function"
            ? global.EcodriveSession.getApiBase()
            : "")
    )
        .trim()
        .replace(/\/+$/, "");

    var liveCatalog = DEFAULT_BIKE_CATALOG.slice();
    var defaultAliasMap = buildDefaultAliasMap();
    var latestLiveChatRuntime = null;

    function safeParse(raw) {
        try {
            return JSON.parse(raw);
        } catch (_error) {
            return null;
        }
    }

    function normalizeText(value) {
        return String(value || "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
    }

    function getScopedChatStorageKey() {
        var email = String(getCurrentUserEmail() || "").trim().toLowerCase();
        var ownerId = email
            ? email.replace(/[^a-z0-9@._-]+/g, "_")
            : "guest";
        return SCOPED_CHAT_STORAGE_PREFIX + ownerId;
    }

    function mapChatStorageKey(key) {
        var raw = String(key || "");
        if (raw === LEGACY_CHAT_STORAGE_KEY) {
            return getScopedChatStorageKey();
        }
        return raw;
    }

    function patchLegacyChatStorageMapping() {
        if (!global || !global.localStorage) {
            return;
        }
        if (global.__ecodriveChatScopedPatchApplied) {
            return;
        }

        try {
            var storageProto = Object.getPrototypeOf(global.localStorage);
            if (!storageProto || storageProto.__ecodriveChatScopedPatchApplied) {
                global.__ecodriveChatScopedPatchApplied = true;
                return;
            }

            var originalGetItem = storageProto.getItem;
            var originalSetItem = storageProto.setItem;
            var originalRemoveItem = storageProto.removeItem;

            storageProto.getItem = function (key) {
                return originalGetItem.call(this, mapChatStorageKey(key));
            };

            storageProto.setItem = function (key, value) {
                return originalSetItem.call(this, mapChatStorageKey(key), value);
            };

            storageProto.removeItem = function (key) {
                return originalRemoveItem.call(this, mapChatStorageKey(key));
            };

            storageProto.__ecodriveChatScopedPatchApplied = true;
            global.__ecodriveChatScopedPatchApplied = true;
        } catch (_error) {
            // keep default storage methods if patching is blocked
        }
    }

    function getSuggestionQuestions() {
        return [
            "Ano available na 2-wheel models?",
            "Magkano ang BLITZ 2000?",
            "Ano payment options?",
            "Paano mag-book ng ebike?",
            "Ano status ng booking ko?",
            "Paano magpa-repair booking?"
        ];
    }

    function ensureChatEnhancerStyles() {
        if (!global.document || global.document.getElementById("ecodrive-chat-enhancer-style")) {
            return;
        }

        var style = global.document.createElement("style");
        style.id = "ecodrive-chat-enhancer-style";
        style.textContent = [
            ".chat-clear-btn{margin-left:8px;border:1.5px solid #b13232;background:#fff5f5;color:#9f2222;border-radius:8px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;}",
            ".chat-suggestions{display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px 0;}",
            ".chat-suggestions.is-hidden{display:none;}",
            ".chat-suggestion-btn{border:1.5px solid #3557a1;background:#f4f7ff;color:#123f79;border-radius:999px;padding:5px 10px;font-size:11px;font-weight:600;cursor:pointer;}",
            ".chat-suggestion-btn:hover{background:#e8eeff;}",
            ".chat-form.ecodrive-chat-media-ready{display:grid;grid-template-columns:auto auto auto 1fr auto;gap:7px;align-items:center;}",
            ".chat-form.ecodrive-chat-media-ready input[type='text']{min-width:0;}",
            ".chat-media-btn,.chat-voice-btn{height:34px;width:34px;min-width:34px;border:1.5px solid #3353a6;background:#eef3ff;color:#143b80;border-radius:999px;font-size:16px;font-weight:700;cursor:pointer;padding:0;display:inline-flex;align-items:center;justify-content:center;line-height:1;}",
            ".chat-media-btn span,.chat-voice-btn span{pointer-events:none;}",
            ".chat-voice-btn.recording{background:#ffe7e7;border-color:#b42318;color:#8f1d1d;}",
            ".chat-media-status{grid-column:1/-1;font-size:11px;color:#2348c7;line-height:1.35;padding:2px 0 0;word-break:break-word;}",
            ".chat-media-status.error{color:#b42318;}",
            ".chat-media-preview{margin-top:6px;display:grid;gap:6px;}",
            ".chat-media-preview img,.chat-media-preview video{display:block;width:100%;max-width:220px;max-height:180px;object-fit:contain;border-radius:8px;border:1px solid rgba(53,87,161,.35);background:#e9eef8;}",
            ".chat-media-preview audio{display:block;width:min(230px,100%);}",
            ".chat-message.has-media,.chat-bubble.has-media{padding-bottom:8px;}",
            ".chat-camera-overlay{position:fixed;inset:0;z-index:1200;background:rgba(12,20,42,.74);display:flex;align-items:center;justify-content:center;padding:12px;}",
            ".chat-camera-sheet{width:min(420px,96vw);background:#0a162f;border:1.5px solid rgba(173,196,255,.34);border-radius:14px;padding:10px;box-shadow:0 12px 26px rgba(9,18,38,.55);}",
            ".chat-camera-preview{display:block;width:100%;aspect-ratio:3/4;background:#081125;border-radius:10px;object-fit:cover;}",
            ".chat-camera-actions{display:flex;align-items:center;justify-content:center;gap:10px;padding-top:10px;}",
            ".chat-camera-action{height:42px;min-width:42px;border:1.5px solid #4b6bc7;background:#f2f6ff;color:#143b80;border-radius:999px;padding:0 14px;font-size:12px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;}",
            ".chat-camera-action.capture{height:50px;min-width:50px;padding:0;border:2px solid #dce6ff;background:#fff;font-size:20px;}",
            ".chat-camera-action.is-disabled{opacity:.55;cursor:not-allowed;}",
            ".chat-camera-action:disabled{opacity:.55;cursor:not-allowed;}",
            "@media (max-width:560px){.chat-camera-sheet{width:100%;max-width:none;}.chat-camera-preview{aspect-ratio:9/16;}}"
        ].join("");

        global.document.head.appendChild(style);
    }

    function getActiveLiveChatRuntime() {
        if (latestLiveChatRuntime && typeof latestLiveChatRuntime.getLocalMessages === "function") {
            return latestLiveChatRuntime;
        }
        return null;
    }

    function createMediaNode(message) {
        if (!message || !message.mediaDataUrl || !global.document) {
            return null;
        }

        var mediaType = normalizeChatMediaType(message.mediaType, inferChatMediaTypeFromMime(message.mediaMime || ""));
        if (!mediaType) {
            return null;
        }

        var wrap = global.document.createElement("div");
        wrap.className = "chat-media-preview";

        if (mediaType === "image") {
            var image = global.document.createElement("img");
            image.src = message.mediaDataUrl;
            image.alt = normalizeChatMediaName(message.mediaName || "") || "Chat image attachment";
            image.loading = "lazy";
            wrap.appendChild(image);
            return wrap;
        }

        if (mediaType === "video") {
            var video = global.document.createElement("video");
            video.src = message.mediaDataUrl;
            video.controls = true;
            video.preload = "metadata";
            wrap.appendChild(video);
            return wrap;
        }

        if (mediaType === "audio") {
            var audio = global.document.createElement("audio");
            audio.src = message.mediaDataUrl;
            audio.controls = true;
            audio.preload = "metadata";
            wrap.appendChild(audio);
            return wrap;
        }

        return null;
    }

    function decorateChatBodyWithMedia(chatBody) {
        if (!chatBody || !global.document) {
            return;
        }

        var runtime = getActiveLiveChatRuntime();
        if (!runtime || typeof runtime.getLocalMessages !== "function") {
            return;
        }

        var messages = runtime.getLocalMessages();
        if (!Array.isArray(messages) || !messages.length) {
            return;
        }

        var bubbles = Array.prototype.slice.call(
            chatBody.querySelectorAll(".chat-bubble, .chat-message, .chat-msg")
        ).filter(function (node) {
            return node && node.nodeType === 1 && !node.hasAttribute("data-typing");
        });
        if (!bubbles.length) {
            return;
        }

        var messageIndex = messages.length - 1;
        var bubbleIndex = bubbles.length - 1;
        while (messageIndex >= 0 && bubbleIndex >= 0) {
            var message = messages[messageIndex];
            var bubble = bubbles[bubbleIndex];
            var hasMedia = Boolean(message && message.mediaDataUrl);
            var existingPreview = bubble.querySelector(".chat-media-preview");

            if (!hasMedia && existingPreview) {
                existingPreview.remove();
                bubble.classList.remove("has-media");
            } else if (hasMedia && !existingPreview) {
                var previewNode = createMediaNode(message);
                if (previewNode) {
                    bubble.appendChild(previewNode);
                    bubble.classList.add("has-media");
                }
            } else if (hasMedia && existingPreview) {
                var mediaElement = existingPreview.querySelector("img,video,audio");
                if (mediaElement && mediaElement.src !== message.mediaDataUrl) {
                    mediaElement.src = message.mediaDataUrl;
                }
                bubble.classList.add("has-media");
            }

            messageIndex -= 1;
            bubbleIndex -= 1;
        }
    }

    function readFileAsDataUrl(file) {
        return new Promise(function (resolve, reject) {
            if (!file || typeof FileReader === "undefined") {
                reject(new Error("File reading is not supported on this browser."));
                return;
            }
            var reader = new FileReader();
            reader.onload = function () {
                resolve(String(reader.result || ""));
            };
            reader.onerror = function () {
                reject(new Error("Failed to read file."));
            };
            reader.readAsDataURL(file);
        });
    }

    function resolveMediaTypeFromFile(file) {
        var mime = String(file && file.type ? file.type : "").trim().toLowerCase();
        return inferChatMediaTypeFromMime(mime);
    }

    function appendUserMediaMessage(payload) {
        var runtime = getActiveLiveChatRuntime();
        var nextEntry = {
            from: "user",
            text: payload && payload.text ? payload.text : "",
            mediaType: payload && payload.mediaType ? payload.mediaType : "",
            mediaDataUrl: payload && payload.mediaDataUrl ? payload.mediaDataUrl : "",
            mediaMime: payload && payload.mediaMime ? payload.mediaMime : "",
            mediaName: payload && payload.mediaName ? payload.mediaName : "",
            mediaSizeBytes: payload && payload.mediaSizeBytes ? payload.mediaSizeBytes : 0,
            createdAt: new Date().toISOString()
        };

        if (!runtime || typeof runtime.appendLocalMessage !== "function") {
            var normalized = normalizeLocalChatMessage(nextEntry);
            if (!normalized) {
                throw new Error("Unable to add media message.");
            }

            var localMessages = normalizeLocalChatMessages(
                safeParse(localStorage.getItem(getScopedChatStorageKey()))
                || safeParse(localStorage.getItem(LEGACY_CHAT_STORAGE_KEY))
                || []
            );
            localMessages.push(normalized);
            localMessages = normalizeLocalChatMessages(localMessages);
            localStorage.setItem(getScopedChatStorageKey(), JSON.stringify(localMessages));

            var chatBody = global.document ? global.document.getElementById("chat-body") : null;
            if (chatBody) {
                var bubble = global.document.createElement("div");
                bubble.className = chatBody.querySelector(".chat-message")
                    ? "chat-message user has-media"
                    : "chat-bubble user has-media";
                bubble.textContent = normalized.text;
                var previewNode = createMediaNode(normalized);
                if (previewNode) {
                    bubble.appendChild(previewNode);
                }
                chatBody.appendChild(bubble);
                chatBody.scrollTop = chatBody.scrollHeight;
            }
            return normalized;
        }

        var inserted = runtime.appendLocalMessage(nextEntry);
        if (!inserted) {
            throw new Error("Unable to add media message.");
        }
        if (typeof runtime.notifyLocalMessagesUpdated === "function") {
            void runtime.notifyLocalMessagesUpdated();
        }
        return inserted;
    }

    function injectChatEnhancements() {
        if (!global.document) {
            return;
        }

        var panel = global.document.getElementById("chat-panel");
        var header = panel ? panel.querySelector(".chat-header") : null;
        var body = panel ? panel.querySelector("#chat-body") : null;
        var form = panel ? panel.querySelector("#chat-form") : null;
        var input = panel ? panel.querySelector("#chat-input") : null;

        if (!(panel && header && body && form && input)) {
            return;
        }

        ensureChatEnhancerStyles();

        if (!header.querySelector(".chat-clear-btn")) {
            var clearBtn = global.document.createElement("button");
            clearBtn.type = "button";
            clearBtn.className = "chat-clear-btn";
            clearBtn.textContent = "Delete Chat";
            clearBtn.setAttribute("aria-label", "Delete chatbot conversation");

            clearBtn.addEventListener("click", async function () {
                if (!global.confirm("Delete this chatbot conversation?")) {
                    return;
                }

                if (typeof fetch === "function") {
                    try {
                        var response = await fetch(getApiUrl("/api/chat/thread/clear"), {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json"
                            },
                            body: JSON.stringify({})
                        });
                        if (response && response.ok) {
                            await response.json().catch(function () {
                                return {};
                            });
                        }
                    } catch (_error) {
                        // fallback to local clear below
                    }
                }

                try {
                    global.localStorage.removeItem(LEGACY_CHAT_STORAGE_KEY);
                    global.localStorage.removeItem(getScopedChatStorageKey());
                } catch (_error) {
                    // ignore
                }
                if (global.location && typeof global.location.reload === "function") {
                    global.location.reload();
                }
            });

            var closeButton = header.querySelector("#chat-close, .chat-close, button[aria-label='Close chat']");
            if (closeButton && closeButton.parentNode === header) {
                header.insertBefore(clearBtn, closeButton);
            } else {
                header.appendChild(clearBtn);
            }
        }

        var suggestionWrap = panel.querySelector(".chat-suggestions");
        var suggestionQuestions = getSuggestionQuestions();
        if (!suggestionWrap) {
            suggestionWrap = global.document.createElement("div");
            suggestionWrap.className = "chat-suggestions is-hidden";
            panel.insertBefore(suggestionWrap, form);
        }

        function renderSuggestionChips(queryText) {
            if (!suggestionWrap) {
                return;
            }

            var query = String(queryText || "").trim().toLowerCase();
            suggestionWrap.innerHTML = "";
            if (!query) {
                suggestionWrap.classList.add("is-hidden");
                return;
            }

            var matches = suggestionQuestions.filter(function (question) {
                return String(question || "").toLowerCase().indexOf(query) >= 0;
            }).slice(0, 4);

            if (!matches.length) {
                suggestionWrap.classList.add("is-hidden");
                return;
            }

            matches.forEach(function (question) {
                var chip = global.document.createElement("button");
                chip.type = "button";
                chip.className = "chat-suggestion-btn";
                chip.textContent = question;
                chip.addEventListener("click", function () {
                    input.value = question;
                    renderSuggestionChips("");
                    if (typeof form.requestSubmit === "function") {
                        form.requestSubmit();
                    } else {
                        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
                    }
                });
                suggestionWrap.appendChild(chip);
            });

            suggestionWrap.classList.remove("is-hidden");
        }

        if (!input.dataset.ecodriveSuggestionBound) {
            input.dataset.ecodriveSuggestionBound = "1";
            input.addEventListener("input", function () {
                renderSuggestionChips(input.value);
            });
            input.addEventListener("focus", function () {
                renderSuggestionChips(input.value);
            });
        }

        if (!form.dataset.ecodriveSuggestionSubmitBound) {
            form.dataset.ecodriveSuggestionSubmitBound = "1";
            form.addEventListener("submit", function () {
                global.setTimeout(function () {
                    renderSuggestionChips("");
                }, 0);
            });
        }

        renderSuggestionChips("");

        form.classList.add("ecodrive-chat-media-ready");

        var mediaInput = form.querySelector(".chat-media-input");
        if (!mediaInput) {
            mediaInput = global.document.createElement("input");
            mediaInput.type = "file";
            mediaInput.className = "chat-media-input";
            mediaInput.accept = "image/*,video/*";
            mediaInput.style.display = "none";
            form.appendChild(mediaInput);
        }

        var cameraInput = form.querySelector(".chat-camera-input");
        if (!cameraInput) {
            cameraInput = global.document.createElement("input");
            cameraInput.type = "file";
            cameraInput.className = "chat-camera-input";
            cameraInput.accept = "image/*";
            cameraInput.style.display = "none";
            form.appendChild(cameraInput);
        }

        var cameraBtn = form.querySelector(".chat-camera-btn");
        if (!cameraBtn) {
            cameraBtn = global.document.createElement("button");
            cameraBtn.type = "button";
            cameraBtn.className = "chat-media-btn chat-camera-btn";
            cameraBtn.innerHTML = "<span aria-hidden=\"true\">&#128247;</span>";
            cameraBtn.setAttribute("aria-label", "Take a photo");
            if (input.parentNode === form) {
                form.insertBefore(cameraBtn, input);
            } else {
                form.appendChild(cameraBtn);
            }
        }

        var mediaBtn = form.querySelector(".chat-gallery-btn");
        if (!mediaBtn) {
            mediaBtn = global.document.createElement("button");
            mediaBtn.type = "button";
            mediaBtn.className = "chat-media-btn chat-gallery-btn";
            mediaBtn.innerHTML = "<span aria-hidden=\"true\">&#128443;</span>";
            mediaBtn.setAttribute("aria-label", "Send image or video");
            if (input.parentNode === form) {
                form.insertBefore(mediaBtn, input);
            } else {
                form.appendChild(mediaBtn);
            }
        }

        var voiceBtn = form.querySelector(".chat-voice-btn");
        if (!voiceBtn) {
            voiceBtn = global.document.createElement("button");
            voiceBtn.type = "button";
            voiceBtn.className = "chat-voice-btn";
            voiceBtn.innerHTML = "<span aria-hidden=\"true\">&#127908;</span>";
            voiceBtn.setAttribute("aria-label", "Record voice message");
            if (input.parentNode === form) {
                form.insertBefore(voiceBtn, input);
            } else {
                form.appendChild(voiceBtn);
            }
        }

        var mediaStatus = panel.querySelector(".chat-media-status");
        if (!mediaStatus) {
            mediaStatus = global.document.createElement("div");
            mediaStatus.className = "chat-media-status";
            mediaStatus.setAttribute("aria-live", "polite");
            form.appendChild(mediaStatus);
        }

        function setMediaStatus(message, isError) {
            mediaStatus.textContent = String(message || "");
            mediaStatus.classList.toggle("error", Boolean(isError));
        }

        if (!form.dataset.ecodriveMediaBound) {
            form.dataset.ecodriveMediaBound = "1";
            var voiceState = {
                recording: false,
                mediaRecorder: null,
                stream: null,
                chunks: []
            };
            var cameraState = {
                overlay: null,
                video: null,
                switchBtn: null,
                captureBtn: null,
                closeBtn: null,
                stream: null,
                facingMode: "environment",
                opening: false
            };

            function supportsCameraApi() {
                return Boolean(
                    global.navigator
                    && global.navigator.mediaDevices
                    && typeof global.navigator.mediaDevices.getUserMedia === "function"
                );
            }

            function stopCameraStream() {
                if (!cameraState.stream || typeof cameraState.stream.getTracks !== "function") {
                    cameraState.stream = null;
                    return;
                }
                cameraState.stream.getTracks().forEach(function (track) {
                    try {
                        track.stop();
                    } catch (_error) {
                        // ignore
                    }
                });
                cameraState.stream = null;
            }

            function closeCameraOverlay() {
                stopCameraStream();
                cameraState.opening = false;
                if (cameraState.video) {
                    cameraState.video.srcObject = null;
                }
                if (cameraState.overlay && cameraState.overlay.parentNode) {
                    cameraState.overlay.parentNode.removeChild(cameraState.overlay);
                }
                cameraState.overlay = null;
                cameraState.video = null;
                cameraState.switchBtn = null;
                cameraState.captureBtn = null;
                cameraState.closeBtn = null;
            }

            async function updateCameraSwitchAvailability() {
                if (!cameraState.switchBtn) {
                    return;
                }
                if (
                    !global.navigator
                    || !global.navigator.mediaDevices
                    || typeof global.navigator.mediaDevices.enumerateDevices !== "function"
                ) {
                    cameraState.switchBtn.disabled = false;
                    cameraState.switchBtn.classList.remove("is-disabled");
                    return;
                }
                try {
                    var devices = await global.navigator.mediaDevices.enumerateDevices();
                    var videoInputs = (Array.isArray(devices) ? devices : []).filter(function (device) {
                        return device && device.kind === "videoinput";
                    });
                    var canSwitch = videoInputs.length >= 2;
                    cameraState.switchBtn.disabled = !canSwitch;
                    cameraState.switchBtn.classList.toggle("is-disabled", !canSwitch);
                } catch (_error) {
                    cameraState.switchBtn.disabled = false;
                    cameraState.switchBtn.classList.remove("is-disabled");
                }
            }

            function ensureCameraOverlay() {
                if (cameraState.overlay && cameraState.overlay.parentNode) {
                    return;
                }

                var overlay = global.document.createElement("div");
                overlay.className = "chat-camera-overlay";
                overlay.innerHTML = ""
                    + "<div class=\"chat-camera-sheet\" role=\"dialog\" aria-label=\"Capture photo\">"
                    + "  <video class=\"chat-camera-preview\" autoplay playsinline muted></video>"
                    + "  <div class=\"chat-camera-actions\">"
                    + "    <button type=\"button\" class=\"chat-camera-action switch\" aria-label=\"Switch camera\">Switch</button>"
                    + "    <button type=\"button\" class=\"chat-camera-action capture\" aria-label=\"Capture photo\">&#9679;</button>"
                    + "    <button type=\"button\" class=\"chat-camera-action close\" aria-label=\"Close camera\">Close</button>"
                    + "  </div>"
                    + "</div>";
                global.document.body.appendChild(overlay);

                cameraState.overlay = overlay;
                cameraState.video = overlay.querySelector(".chat-camera-preview");
                cameraState.switchBtn = overlay.querySelector(".chat-camera-action.switch");
                cameraState.captureBtn = overlay.querySelector(".chat-camera-action.capture");
                cameraState.closeBtn = overlay.querySelector(".chat-camera-action.close");

                overlay.addEventListener("click", function (event) {
                    if (event.target === overlay) {
                        closeCameraOverlay();
                    }
                });
                if (cameraState.closeBtn) {
                    cameraState.closeBtn.addEventListener("click", function () {
                        closeCameraOverlay();
                    });
                }
                if (cameraState.switchBtn) {
                    cameraState.switchBtn.addEventListener("click", function () {
                        if (cameraState.opening || cameraState.switchBtn.disabled) {
                            return;
                        }
                        var previousFacingMode = cameraState.facingMode;
                        cameraState.facingMode = cameraState.facingMode === "environment"
                            ? "user"
                            : "environment";
                        void startCameraPreview().catch(function (error) {
                            cameraState.facingMode = previousFacingMode;
                            setMediaStatus(error && error.message ? error.message : "Unable to switch camera.", true);
                            void startCameraPreview().catch(function () {
                                // keep overlay open even if preview restart fails
                            });
                        });
                    });
                }
                if (cameraState.captureBtn) {
                    cameraState.captureBtn.addEventListener("click", function () {
                        void capturePhotoFromCamera();
                    });
                }
            }

            async function startCameraPreview() {
                if (!supportsCameraApi()) {
                    throw new Error("Camera is not supported on this browser.");
                }
                ensureCameraOverlay();
                if (!cameraState.video) {
                    throw new Error("Unable to open camera preview.");
                }

                cameraState.opening = true;
                try {
                    stopCameraStream();
                    var stream = null;
                    try {
                        stream = await global.navigator.mediaDevices.getUserMedia({
                            video: {
                                facingMode: {
                                    ideal: cameraState.facingMode
                                }
                            },
                            audio: false
                        });
                    } catch (primaryError) {
                        stream = await global.navigator.mediaDevices.getUserMedia({
                            video: {
                                facingMode: cameraState.facingMode
                            },
                            audio: false
                        });
                    }

                    cameraState.stream = stream;
                    cameraState.video.srcObject = stream;
                    try {
                        await cameraState.video.play();
                    } catch (_error) {
                        // autoplay can fail silently; live stream still works after user taps
                    }
                    await updateCameraSwitchAvailability();
                } finally {
                    cameraState.opening = false;
                }
            }

            async function capturePhotoFromCamera() {
                if (!cameraState.video || !cameraState.captureBtn) {
                    return;
                }
                if (!cameraState.video.videoWidth || !cameraState.video.videoHeight) {
                    setMediaStatus("Camera is not ready yet.", true);
                    return;
                }

                cameraState.captureBtn.disabled = true;
                try {
                    var canvas = global.document.createElement("canvas");
                    canvas.width = cameraState.video.videoWidth;
                    canvas.height = cameraState.video.videoHeight;
                    var context = canvas.getContext("2d");
                    if (!context) {
                        throw new Error("Unable to capture image.");
                    }
                    context.drawImage(cameraState.video, 0, 0, canvas.width, canvas.height);

                    var blob = await new Promise(function (resolve) {
                        canvas.toBlob(resolve, "image/jpeg", 0.92);
                    });
                    if (!blob) {
                        throw new Error("Unable to capture image.");
                    }

                    var filename = "camera-photo-" + Date.now() + ".jpg";
                    var imageFile = null;
                    try {
                        imageFile = new File([blob], filename, { type: "image/jpeg" });
                    } catch (_error) {
                        imageFile = blob;
                        imageFile.name = filename;
                    }

                    closeCameraOverlay();
                    await handleSelectedMediaFile(imageFile, "image");
                } catch (error) {
                    setMediaStatus(error && error.message ? error.message : "Unable to capture image.", true);
                } finally {
                    if (cameraState.captureBtn) {
                        cameraState.captureBtn.disabled = false;
                    }
                }
            }

            async function openCameraCapture() {
                if (!supportsCameraApi()) {
                    cameraInput.click();
                    return;
                }
                setMediaStatus("Opening camera...", false);
                try {
                    await startCameraPreview();
                    setMediaStatus("Camera ready. Capture your photo.", false);
                } catch (error) {
                    closeCameraOverlay();
                    setMediaStatus(error && error.message ? error.message : "Unable to open camera.", true);
                    cameraInput.click();
                }
            }

            function setVoiceButtonIdleState() {
                voiceBtn.innerHTML = "<span aria-hidden=\"true\">&#127908;</span>";
                voiceBtn.setAttribute("aria-label", "Record voice message");
            }

            function setVoiceButtonRecordingState() {
                voiceBtn.innerHTML = "<span aria-hidden=\"true\">&#9632;</span>";
                voiceBtn.setAttribute("aria-label", "Stop voice recording");
            }

            async function sendMediaData(dataUrl, requestedType, mediaNameInput, mediaSizeBytesInput) {
                var normalized = normalizeChatMediaDataUrl(dataUrl, requestedType);
                if (!normalized) {
                    setMediaStatus("Unsupported media file. Use image, video, or audio.", true);
                    return;
                }

                try {
                    appendUserMediaMessage({
                        text: getChatMediaFallbackText(normalized.mediaType),
                        mediaType: normalized.mediaType,
                        mediaDataUrl: normalized.mediaDataUrl,
                        mediaMime: normalized.mediaMime,
                        mediaName: normalizeChatMediaName(mediaNameInput || ""),
                        mediaSizeBytes: Number(mediaSizeBytesInput || normalized.mediaSizeBytes) || normalized.mediaSizeBytes
                    });
                    decorateChatBodyWithMedia(body);
                    setMediaStatus("Sent " + normalized.mediaType + " message.", false);
                } catch (error) {
                    setMediaStatus(error && error.message ? error.message : "Unable to send media right now.", true);
                }
            }

            cameraBtn.addEventListener("click", function () {
                setMediaStatus("", false);
                void openCameraCapture();
            });

            mediaBtn.addEventListener("click", function () {
                setMediaStatus("", false);
                mediaInput.click();
            });

            async function handleSelectedMediaFile(selected, forcedMediaType) {
                var mediaType = forcedMediaType || resolveMediaTypeFromFile(selected);
                if (!mediaType) {
                    setMediaStatus("Unsupported file type. Only image, video, and audio are allowed.", true);
                    return;
                }

                setMediaStatus("Preparing " + mediaType + "...", false);
                try {
                    var dataUrl = await readFileAsDataUrl(selected);
                    await sendMediaData(dataUrl, mediaType, selected.name || "", selected.size || 0);
                } catch (error) {
                    setMediaStatus(error && error.message ? error.message : "Unable to read file.", true);
                }
            }

            mediaInput.addEventListener("change", async function () {
                var selected = mediaInput.files && mediaInput.files[0] ? mediaInput.files[0] : null;
                mediaInput.value = "";
                if (!selected) {
                    return;
                }
                await handleSelectedMediaFile(selected, "");
            });

            cameraInput.addEventListener("change", async function () {
                var selected = cameraInput.files && cameraInput.files[0] ? cameraInput.files[0] : null;
                cameraInput.value = "";
                if (!selected) {
                    return;
                }
                await handleSelectedMediaFile(selected, "image");
            });

            function resetVoiceState() {
                voiceState.recording = false;
                voiceBtn.classList.remove("recording");
                setVoiceButtonIdleState();
                if (voiceState.stream && typeof voiceState.stream.getTracks === "function") {
                    voiceState.stream.getTracks().forEach(function (track) {
                        try {
                            track.stop();
                        } catch (_error) {
                            // ignore
                        }
                    });
                }
                voiceState.stream = null;
                voiceState.mediaRecorder = null;
                voiceState.chunks = [];
            }

            async function stopVoiceRecording() {
                if (!voiceState.recording || !voiceState.mediaRecorder) {
                    return;
                }
                var recorder = voiceState.mediaRecorder;
                voiceState.recording = false;
                voiceBtn.innerHTML = "<span aria-hidden=\"true\">&#8987;</span>";
                voiceBtn.setAttribute("aria-label", "Processing voice message");
                voiceBtn.classList.remove("recording");

                await new Promise(function (resolve) {
                    recorder.addEventListener("stop", resolve, { once: true });
                    try {
                        recorder.stop();
                    } catch (_error) {
                        resolve();
                    }
                });

                var chunks = voiceState.chunks.slice();
                var mimeType = String(recorder.mimeType || "audio/webm").trim() || "audio/webm";
                var blob = new Blob(chunks, { type: mimeType });
                resetVoiceState();

                if (!blob || !blob.size) {
                    setMediaStatus("Voice recording is empty. Try again.", true);
                    return;
                }

                setMediaStatus("Uploading voice message...", false);
                try {
                    var voiceDataUrl = await readFileAsDataUrl(blob);
                    await sendMediaData(voiceDataUrl, "audio", "voice-message.webm", blob.size);
                } catch (error) {
                    setMediaStatus(error && error.message ? error.message : "Unable to process voice recording.", true);
                } finally {
                    setVoiceButtonIdleState();
                }
            }

            async function startVoiceRecording() {
                if (!global.navigator || !global.navigator.mediaDevices || typeof global.navigator.mediaDevices.getUserMedia !== "function" || typeof global.MediaRecorder === "undefined") {
                    setMediaStatus("Voice recording is not supported on this browser.", true);
                    return;
                }

                setMediaStatus("Requesting microphone permission...", false);
                try {
                    var stream = await global.navigator.mediaDevices.getUserMedia({ audio: true });
                    var options = {};
                    if (typeof global.MediaRecorder.isTypeSupported === "function") {
                        var preferred = [
                            "audio/webm;codecs=opus",
                            "audio/webm",
                            "audio/ogg;codecs=opus",
                            "audio/ogg",
                            "audio/mp4"
                        ];
                        for (var i = 0; i < preferred.length; i += 1) {
                            if (global.MediaRecorder.isTypeSupported(preferred[i])) {
                                options.mimeType = preferred[i];
                                break;
                            }
                        }
                    }

                    var recorder = new global.MediaRecorder(stream, options);
                    voiceState.recording = true;
                    voiceState.stream = stream;
                    voiceState.mediaRecorder = recorder;
                    voiceState.chunks = [];

                    recorder.addEventListener("dataavailable", function (event) {
                        if (event && event.data && event.data.size > 0) {
                            voiceState.chunks.push(event.data);
                        }
                    });
                    recorder.start();

                    voiceBtn.classList.add("recording");
                    setVoiceButtonRecordingState();
                    setMediaStatus("Recording voice... click Stop when done.", false);
                } catch (error) {
                    resetVoiceState();
                    setMediaStatus(error && error.message ? error.message : "Unable to access microphone.", true);
                }
            }

            setVoiceButtonIdleState();

            voiceBtn.addEventListener("click", function () {
                if (voiceState.recording) {
                    void stopVoiceRecording();
                    return;
                }
                void startVoiceRecording();
            });

            if (!form.dataset.ecodriveCameraCleanupBound) {
                form.dataset.ecodriveCameraCleanupBound = "1";
                global.addEventListener("pagehide", function () {
                    closeCameraOverlay();
                });
            }
        }

        decorateChatBodyWithMedia(body);
        if (!body.dataset.ecodriveMediaObserverBound && typeof MutationObserver === "function") {
            body.dataset.ecodriveMediaObserverBound = "1";
            var observer = new MutationObserver(function () {
                decorateChatBodyWithMedia(body);
            });
            observer.observe(body, {
                childList: true,
                subtree: true
            });
        }
    }

    function setupChatEnhancer() {
        patchLegacyChatStorageMapping();
        if (!global.document) {
            return;
        }

        if (global.document.readyState === "loading") {
            global.document.addEventListener("DOMContentLoaded", injectChatEnhancements);
        } else {
            injectChatEnhancements();
        }
    }

    function normalizeCategory(value) {
        var raw = String(value || "").trim().toLowerCase();
        if (!raw) {
            return "Other";
        }
        if (raw.indexOf("2") >= 0) return "2-Wheel";
        if (raw.indexOf("3") >= 0) return "3-Wheel";
        if (raw.indexOf("4") >= 0) return "4-Wheel";
        return "Other";
    }

    function includesAny(text, keywords) {
        return keywords.some(function (keyword) {
            return text.indexOf(keyword) >= 0;
        });
    }

    function formatPeso(amount) {
        return String.fromCharCode(8369) + Number(amount || 0).toLocaleString("en-PH", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function toPriceNumber(value) {
        var parsed = Number(String(value || "").replace(/[^0-9.]/g, ""));
        if (!Number.isFinite(parsed) || parsed < 0) {
            return 0;
        }
        return Number(parsed.toFixed(2));
    }

    function toIsActive(value) {
        if (value === false || value === 0 || value === "0") {
            return false;
        }
        var normalized = String(value === undefined || value === null ? "1" : value).trim().toLowerCase();
        if (normalized === "false" || normalized === "no") {
            return false;
        }
        return true;
    }

    function buildDefaultAliasMap() {
        var map = {};
        DEFAULT_BIKE_CATALOG.forEach(function (item) {
            var key = normalizeText(item && item.model);
            if (!key) return;
            map[key] = Array.isArray(item.aliases) ? item.aliases.slice() : [];
        });
        return map;
    }

    function dedupeAliasList(values) {
        var seen = {};
        var output = [];
        (values || []).forEach(function (entry) {
            var normalized = normalizeText(entry);
            if (!normalized || seen[normalized]) {
                return;
            }
            seen[normalized] = true;
            output.push(normalized);
        });
        return output;
    }

    function buildAliases(model, extraAliases) {
        var rawModel = String(model || "").trim();
        var aliasPool = [];

        aliasPool.push(rawModel);
        aliasPool.push(rawModel.replace(/-/g, " "));
        aliasPool.push(rawModel.replace(/\bii\b/ig, "2"));
        aliasPool.push(rawModel.replace(/\bv2\b/ig, "version 2"));
        aliasPool.push(rawModel.replace(/traveller/ig, "traveler"));
        aliasPool.push(rawModel.replace(/traveler/ig, "traveller"));

        if (Array.isArray(extraAliases)) {
            aliasPool = aliasPool.concat(extraAliases);
        }

        return dedupeAliasList(aliasPool);
    }

    function getCategoryOrder(category) {
        if (category === "2-Wheel") return 1;
        if (category === "3-Wheel") return 2;
        if (category === "4-Wheel") return 3;
        return 4;
    }

    function normalizeCatalogItem(source) {
        var item = source && typeof source === "object" ? source : {};
        var model = String(item.model || item.name || "").trim();
        if (!model) {
            return null;
        }

        var normalizedModelKey = normalizeText(model);
        var defaultAliases = defaultAliasMap[normalizedModelKey] || [];
        var sourceAliases = Array.isArray(item.aliases) ? item.aliases : [];

        return {
            model: model,
            price: toPriceNumber(item.price),
            category: normalizeCategory(item.category),
            aliases: buildAliases(model, defaultAliases.concat(sourceAliases))
        };
    }

    function buildCatalogFromProducts(input) {
        var list = Array.isArray(input) ? input : [];
        var normalized = [];

        list.forEach(function (row) {
            if (!row || typeof row !== "object") {
                return;
            }
            if (!toIsActive(row.isActive)) {
                return;
            }
            var next = normalizeCatalogItem(row);
            if (next) {
                normalized.push(next);
            }
        });

        if (!normalized.length) {
            return DEFAULT_BIKE_CATALOG.map(function (item) {
                return {
                    model: item.model,
                    price: toPriceNumber(item.price),
                    category: normalizeCategory(item.category),
                    aliases: buildAliases(item.model, item.aliases)
                };
            });
        }

        return normalized.sort(function (left, right) {
            var categoryDiff = getCategoryOrder(left.category) - getCategoryOrder(right.category);
            if (categoryDiff !== 0) {
                return categoryDiff;
            }
            return String(left.model).localeCompare(String(right.model));
        });
    }

    function readCatalogFromStorage() {
        var parsed = safeParse(localStorage.getItem(PRODUCT_STORAGE_KEY));
        if (!Array.isArray(parsed) || !parsed.length) {
            return null;
        }
        return buildCatalogFromProducts(parsed);
    }

    function getApiUrl(path) {
        return API_BASE ? API_BASE + path : path;
    }

    function refreshCatalogFromStorage() {
        var localCatalog = readCatalogFromStorage();
        if (localCatalog && localCatalog.length) {
            liveCatalog = localCatalog;
            return;
        }
        liveCatalog = buildCatalogFromProducts(DEFAULT_BIKE_CATALOG);
    }

    async function refreshCatalogFromApi() {
        if (typeof fetch !== "function") {
            return;
        }

        try {
            var response = await fetch(getApiUrl("/api/products"), { method: "GET" });
            if (!response.ok) {
                return;
            }

            var payload = await response.json().catch(function () {
                return {};
            });
            if (!payload || payload.success !== true || !Array.isArray(payload.products)) {
                return;
            }

            localStorage.setItem(PRODUCT_STORAGE_KEY, JSON.stringify(payload.products));
            var apiCatalog = buildCatalogFromProducts(payload.products);
            if (apiCatalog.length) {
                liveCatalog = apiCatalog;
            }
        } catch (_error) {
            // keep current catalog
        }
    }

    function startCatalogSync() {
        refreshCatalogFromStorage();
        void refreshCatalogFromApi();

        window.addEventListener("storage", function (event) {
            if (event.key !== PRODUCT_STORAGE_KEY) {
                return;
            }
            refreshCatalogFromStorage();
        });
    }

    function getActiveCatalog() {
        if (Array.isArray(liveCatalog) && liveCatalog.length) {
            return liveCatalog.slice();
        }
        return buildCatalogFromProducts(DEFAULT_BIKE_CATALOG);
    }

    function getWheelFilter(normalizedQuestion) {
        if (includesAny(normalizedQuestion, ["2 wheel", "2 wheels", "two wheel", "2w", "dalawang gulong"])) return "2-Wheel";
        if (includesAny(normalizedQuestion, ["3 wheel", "3 wheels", "three wheel", "3w", "tatlong gulong"])) return "3-Wheel";
        if (includesAny(normalizedQuestion, ["4 wheel", "4 wheels", "four wheel", "4w", "apat na gulong"])) return "4-Wheel";
        return "";
    }

    function getCatalogByWheel(wheel) {
        var catalog = getActiveCatalog();
        if (!wheel) return catalog;
        return catalog.filter(function (item) {
            return item.category === wheel;
        });
    }

    function findModelMatches(questionText) {
        var normalizedQuestion = normalizeText(questionText);
        var wheelFilter = getWheelFilter(normalizedQuestion);
        var catalog = getActiveCatalog();

        if (!normalizedQuestion) return [];

        return catalog.filter(function (item) {
            var directModel = normalizedQuestion.indexOf(normalizeText(item.model)) >= 0;
            var aliasHit = item.aliases.some(function (alias) {
                return normalizedQuestion.indexOf(normalizeText(alias)) >= 0;
            });

            if (!(directModel || aliasHit)) return false;
            if (!wheelFilter) return true;
            return item.category === wheelFilter;
        });
    }

    function getCurrentUserEmail() {
        var localValue = String(localStorage.getItem(CURRENT_USER_KEY) || "").trim().toLowerCase();
        if (localValue) return localValue;
        return String(sessionStorage.getItem(CURRENT_USER_KEY) || "").trim().toLowerCase();
    }

    function normalizeChatMode(value) {
        var mode = String(value || "").trim().toLowerCase();
        return mode === CHAT_THREAD_MODE_ADMIN ? CHAT_THREAD_MODE_ADMIN : CHAT_THREAD_MODE_BOT;
    }

    function normalizeChatFrom(value) {
        var from = String(value || "").trim().toLowerCase();
        if (from === "user" || from === "bot" || from === "admin" || from === "system") {
            return from;
        }
        return "bot";
    }

    function normalizeMessageText(value) {
        return String(value || "")
            .replace(/\s+/g, " ")
            .trim();
    }

    function normalizeChatMediaType(value, fallbackType) {
        var fallback = String(fallbackType || "").trim().toLowerCase();
        var normalized = String(value || fallback || "").trim().toLowerCase();
        if (normalized && Object.prototype.hasOwnProperty.call(CHAT_ALLOWED_MEDIA_TYPES, normalized)) {
            return normalized;
        }
        if (fallback && Object.prototype.hasOwnProperty.call(CHAT_ALLOWED_MEDIA_TYPES, fallback)) {
            return fallback;
        }
        return "";
    }

    function inferChatMediaTypeFromMime(mimeInput) {
        var mime = String(mimeInput || "").trim().toLowerCase();
        if (mime.indexOf("image/") === 0) {
            return "image";
        }
        if (mime.indexOf("video/") === 0) {
            return "video";
        }
        if (mime.indexOf("audio/") === 0) {
            return "audio";
        }
        return "";
    }

    function estimateBase64Bytes(base64Input) {
        var base64 = String(base64Input || "").replace(/\s+/g, "");
        if (!base64) {
            return 0;
        }
        var padding = 0;
        if (/==$/.test(base64)) {
            padding = 2;
        } else if (/=$/.test(base64)) {
            padding = 1;
        }
        return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
    }

    function normalizeChatMediaName(value) {
        return String(value || "")
            .replace(/[\r\n\t]+/g, " ")
            .trim()
            .slice(0, 255);
    }

    function getChatMediaFallbackText(mediaTypeInput) {
        var mediaType = normalizeChatMediaType(mediaTypeInput, "");
        if (mediaType === "image") {
            return "[Image]";
        }
        if (mediaType === "video") {
            return "[Video]";
        }
        if (mediaType === "audio") {
            return "[Voice message]";
        }
        return "";
    }

    function normalizeChatMediaDataUrl(rawValue, requestedTypeInput) {
        var raw = String(rawValue || "").trim();
        if (!raw) {
            return null;
        }
        if (raw.length > CHAT_MAX_MEDIA_DATA_URL_LENGTH) {
            return null;
        }

        var loweredRaw = raw.toLowerCase();
        var prefix = "data:";
        var marker = ";base64,";
        var markerIndex = loweredRaw.indexOf(marker);
        if (loweredRaw.indexOf(prefix) !== 0 || markerIndex <= prefix.length) {
            return null;
        }

        var mimeSection = raw.slice(prefix.length, markerIndex).trim();
        var mime = String((mimeSection.split(";")[0] || "")).trim().toLowerCase().slice(0, 120);
        var base64 = String(raw.slice(markerIndex + marker.length) || "").replace(/\s+/g, "");
        if (!mime || !base64 || !/^[a-zA-Z0-9+/=]+$/.test(base64)) {
            return null;
        }

        var inferredType = inferChatMediaTypeFromMime(mime);
        var requestedType = normalizeChatMediaType(requestedTypeInput, inferredType);
        var mediaType = requestedType || inferredType;
        if (!mediaType) {
            return null;
        }
        if (
            (mediaType === "image" && mime.indexOf("image/") !== 0)
            || (mediaType === "video" && mime.indexOf("video/") !== 0)
            || (mediaType === "audio" && mime.indexOf("audio/") !== 0)
        ) {
            return null;
        }

        var sizeBytes = estimateBase64Bytes(base64);
        if (!sizeBytes || sizeBytes > CHAT_MAX_MEDIA_BYTES) {
            return null;
        }

        return {
            mediaType: mediaType,
            mediaDataUrl: "data:" + mime + ";base64," + base64,
            mediaMime: mime,
            mediaSizeBytes: sizeBytes
        };
    }

    function normalizeLocalChatMessage(entry) {
        var source = entry && typeof entry === "object" ? entry : {};
        var media = normalizeChatMediaDataUrl(
            source.mediaDataUrl || source.media_data_url || source.mediaUrl || source.media_url || "",
            source.mediaType || source.media_type || source.messageType || source.message_type
        );
        var mediaType = media ? media.mediaType : "";
        var mediaDataUrl = media ? media.mediaDataUrl : "";
        var mediaMime = media ? media.mediaMime : normalizeMessageText(source.mediaMime || source.media_mime || "").slice(0, 120);
        var mediaSizeBytes = media ? media.mediaSizeBytes : Number(source.mediaSizeBytes || source.media_size_bytes || 0);
        if (!Number.isFinite(mediaSizeBytes) || mediaSizeBytes < 1) {
            mediaSizeBytes = 0;
        } else {
            mediaSizeBytes = Math.floor(mediaSizeBytes);
        }
        var mediaName = normalizeChatMediaName(source.mediaName || source.media_name || "");
        var text = normalizeMessageText(source.text || source.message || "");
        if (!text && mediaType) {
            text = getChatMediaFallbackText(mediaType);
        }
        if (!text && !mediaDataUrl) {
            return null;
        }

        var createdAt = source.createdAt || source.created_at || "";
        var normalizedCreatedAt = String(createdAt || "").trim();
        if (!normalizedCreatedAt) {
            normalizedCreatedAt = new Date().toISOString();
        }

        var serverMessageId = Number(source.serverMessageId || source.server_message_id || source.id || 0);
        if (!Number.isFinite(serverMessageId) || serverMessageId < 1) {
            serverMessageId = 0;
        } else {
            serverMessageId = Math.floor(serverMessageId);
        }

        var clientMessageId = String(source.clientMessageId || source.client_message_id || "").trim().slice(0, 120);

        return {
            from: normalizeChatFrom(source.from),
            text: text,
            mediaType: mediaType,
            mediaDataUrl: mediaDataUrl,
            mediaMime: mediaMime,
            mediaName: mediaName,
            mediaSizeBytes: mediaSizeBytes,
            createdAt: normalizedCreatedAt,
            clientMessageId: clientMessageId,
            serverMessageId: serverMessageId
        };
    }

    function normalizeLocalChatMessages(input) {
        var source = Array.isArray(input) ? input : [];
        var normalized = source
            .map(normalizeLocalChatMessage)
            .filter(Boolean);
        if (normalized.length > CHAT_MAX_LOCAL_MESSAGES) {
            normalized = normalized.slice(normalized.length - CHAT_MAX_LOCAL_MESSAGES);
        }
        return normalized;
    }

    function buildChatClientMessageId(from, index) {
        var role = normalizeChatFrom(from);
        var random = Math.random().toString(16).slice(2, 10);
        return "msg_" + role + "_" + Date.now() + "_" + String(index || 0) + "_" + random;
    }

    function mapServerRoleToLocalFrom(role) {
        var normalizedRole = String(role || "").trim().toLowerCase();
        if (normalizedRole === "user") {
            return "user";
        }
        if (normalizedRole === "admin") {
            return "admin";
        }
        if (normalizedRole === "system") {
            return "system";
        }
        return "bot";
    }

    function mapServerMessageToLocal(serverMessage) {
        var source = serverMessage && typeof serverMessage === "object" ? serverMessage : {};
        var role = String(source.role || source.senderRole || "").trim().toLowerCase();
        var from = mapServerRoleToLocalFrom(role);
        var mediaTypeFromServer = normalizeChatMediaType(
            source.mediaType || source.media_type || source.messageType || source.message_type,
            inferChatMediaTypeFromMime(source.mediaMime || source.media_mime || "")
        );
        var mediaDataUrl = source.mediaDataUrl || source.media_data_url || source.mediaUrl || source.media_url || "";
        var normalizedMedia = normalizeChatMediaDataUrl(mediaDataUrl, mediaTypeFromServer);
        var text = normalizeMessageText(source.text || source.message || source.messageText || source.message_text || "");
        if (!text && normalizedMedia && normalizedMedia.mediaType) {
            text = getChatMediaFallbackText(normalizedMedia.mediaType);
        }
        if (!text && !normalizedMedia) {
            return null;
        }

        var displayText = text;
        if (from === "admin" && displayText.indexOf("Admin: ") !== 0) {
            displayText = "Admin: " + displayText;
        }

        return normalizeLocalChatMessage({
            from: from,
            text: displayText,
            mediaType: normalizedMedia ? normalizedMedia.mediaType : "",
            mediaDataUrl: normalizedMedia ? normalizedMedia.mediaDataUrl : "",
            mediaMime: normalizedMedia ? normalizedMedia.mediaMime : "",
            mediaName: source.mediaName || source.media_name || "",
            mediaSizeBytes: normalizedMedia ? normalizedMedia.mediaSizeBytes : (source.mediaSizeBytes || source.media_size_bytes || 0),
            createdAt: source.createdAt || source.created_at || new Date().toISOString(),
            clientMessageId: source.clientMessageId || source.client_message_id || "",
            serverMessageId: source.id || source.serverMessageId || 0
        });
    }

    function mergeServerMessages(localMessages, serverMessages) {
        var nextMessages = normalizeLocalChatMessages(localMessages);
        var changed = false;
        var serverIdMap = {};
        var clientIdMap = {};

        nextMessages.forEach(function (entry, index) {
            if (entry.serverMessageId > 0) {
                serverIdMap[String(entry.serverMessageId)] = index;
            }
            if (entry.clientMessageId) {
                clientIdMap[entry.clientMessageId] = index;
            }
        });

        (Array.isArray(serverMessages) ? serverMessages : [])
            .map(mapServerMessageToLocal)
            .filter(Boolean)
            .forEach(function (entry) {
                var serverKey = entry.serverMessageId > 0 ? String(entry.serverMessageId) : "";
                var clientKey = entry.clientMessageId;

                if (clientKey && Object.prototype.hasOwnProperty.call(clientIdMap, clientKey)) {
                    var existingByClient = nextMessages[clientIdMap[clientKey]];
                    if (existingByClient.serverMessageId !== entry.serverMessageId && entry.serverMessageId > 0) {
                        existingByClient.serverMessageId = entry.serverMessageId;
                        changed = true;
                    }
                    if (existingByClient.from !== entry.from && (entry.from === "admin" || entry.from === "system" || entry.from === "user")) {
                        existingByClient.from = entry.from;
                        changed = true;
                    }
                    if (existingByClient.text !== entry.text && entry.text) {
                        existingByClient.text = entry.text;
                        changed = true;
                    }
                    if (existingByClient.mediaType !== entry.mediaType) {
                        existingByClient.mediaType = entry.mediaType || "";
                        changed = true;
                    }
                    if (existingByClient.mediaDataUrl !== entry.mediaDataUrl) {
                        existingByClient.mediaDataUrl = entry.mediaDataUrl || "";
                        changed = true;
                    }
                    if (existingByClient.mediaMime !== entry.mediaMime) {
                        existingByClient.mediaMime = entry.mediaMime || "";
                        changed = true;
                    }
                    if (existingByClient.mediaName !== entry.mediaName) {
                        existingByClient.mediaName = entry.mediaName || "";
                        changed = true;
                    }
                    if (existingByClient.mediaSizeBytes !== entry.mediaSizeBytes) {
                        existingByClient.mediaSizeBytes = Number(entry.mediaSizeBytes || 0) || 0;
                        changed = true;
                    }
                    return;
                }

                if (serverKey && Object.prototype.hasOwnProperty.call(serverIdMap, serverKey)) {
                    var existingByServer = nextMessages[serverIdMap[serverKey]];
                    if (existingByServer) {
                        if (existingByServer.from !== entry.from) {
                            existingByServer.from = entry.from;
                            changed = true;
                        }
                        if (existingByServer.text !== entry.text && entry.text) {
                            existingByServer.text = entry.text;
                            changed = true;
                        }
                        if (existingByServer.mediaType !== entry.mediaType) {
                            existingByServer.mediaType = entry.mediaType || "";
                            changed = true;
                        }
                        if (existingByServer.mediaDataUrl !== entry.mediaDataUrl) {
                            existingByServer.mediaDataUrl = entry.mediaDataUrl || "";
                            changed = true;
                        }
                        if (existingByServer.mediaMime !== entry.mediaMime) {
                            existingByServer.mediaMime = entry.mediaMime || "";
                            changed = true;
                        }
                        if (existingByServer.mediaName !== entry.mediaName) {
                            existingByServer.mediaName = entry.mediaName || "";
                            changed = true;
                        }
                        if (existingByServer.mediaSizeBytes !== entry.mediaSizeBytes) {
                            existingByServer.mediaSizeBytes = Number(entry.mediaSizeBytes || 0) || 0;
                            changed = true;
                        }
                    }
                    return;
                }

                nextMessages.push(entry);
                changed = true;
                if (serverKey) {
                    serverIdMap[serverKey] = nextMessages.length - 1;
                }
                if (clientKey) {
                    clientIdMap[clientKey] = nextMessages.length - 1;
                }
            });

        return {
            changed: changed,
            messages: normalizeLocalChatMessages(nextMessages)
        };
    }

    function attachLiveChat(options) {
        var opts = options && typeof options === "object" ? options : {};
        var getMessages = typeof opts.getMessages === "function"
            ? opts.getMessages
            : function () { return []; };
        var setMessages = typeof opts.setMessages === "function"
            ? opts.setMessages
            : function () {};
        var syncIntervalMs = Number(opts.syncIntervalMs);
        if (!Number.isFinite(syncIntervalMs) || syncIntervalMs < 1500) {
            syncIntervalMs = CHAT_SYNC_INTERVAL_MS;
        }

        var currentMode = CHAT_THREAD_MODE_BOT;
        var pushInFlight = false;
        var pullInFlight = false;
        var destroyed = false;
        var pollTimer = null;
        var initialPullDone = false;

        function readLocalMessages() {
            var messages = [];
            try {
                messages = getMessages();
            } catch (_error) {
                messages = [];
            }
            return normalizeLocalChatMessages(messages);
        }

        function writeLocalMessages(nextMessages) {
            var normalized = normalizeLocalChatMessages(nextMessages);
            try {
                setMessages(normalized);
            } catch (_error) {
                // caller-controlled renderer/storage
            }
        }

        async function refreshFromServer() {
            if (destroyed || pullInFlight || typeof fetch !== "function") {
                return;
            }
            var currentEmail = getCurrentUserEmail();
            if (!currentEmail) {
                return;
            }

            pullInFlight = true;
            try {
                var response = await fetch(getApiUrl("/api/chat/thread?limit=" + String(CHAT_MAX_LOCAL_MESSAGES)), {
                    method: "GET"
                });
                if (!response.ok) {
                    return;
                }

                var payload = await response.json().catch(function () {
                    return {};
                });
                if (!payload || payload.success !== true) {
                    return;
                }

                currentMode = normalizeChatMode(payload.thread && payload.thread.mode);

                var localMessages = readLocalMessages();
                var merged = mergeServerMessages(localMessages, payload.messages);
                if (merged.changed) {
                    writeLocalMessages(merged.messages);
                }

                initialPullDone = true;
            } catch (_error) {
                // keep local chat usable offline
            } finally {
                pullInFlight = false;
            }
        }

        async function notifyLocalMessagesUpdated() {
            if (destroyed || pushInFlight || typeof fetch !== "function") {
                return;
            }
            var currentEmail = getCurrentUserEmail();
            if (!currentEmail) {
                return;
            }

            var localMessages = readLocalMessages();
            var changed = false;
            var outboundEntries = [];

            localMessages = localMessages.filter(function (entry, index) {
                if (!entry.clientMessageId && (entry.from === "user" || entry.from === "bot")) {
                    entry.clientMessageId = buildChatClientMessageId(entry.from, index);
                    changed = true;
                }

                if (currentMode === CHAT_THREAD_MODE_ADMIN && entry.from === "bot" && !entry.serverMessageId) {
                    changed = true;
                    return false;
                }

                if ((entry.from === "user" || entry.from === "bot") && !entry.serverMessageId) {
                    outboundEntries.push({
                        role: entry.from,
                        text: entry.text,
                        mediaType: entry.mediaType || "",
                        mediaDataUrl: entry.mediaDataUrl || "",
                        mediaMime: entry.mediaMime || "",
                        mediaName: entry.mediaName || "",
                        mediaSizeBytes: Number(entry.mediaSizeBytes || 0) || 0,
                        clientMessageId: entry.clientMessageId,
                        createdAt: entry.createdAt
                    });
                }

                return true;
            });

            if (changed) {
                writeLocalMessages(localMessages);
            }

            if (!outboundEntries.length) {
                if (!initialPullDone) {
                    await refreshFromServer();
                }
                return;
            }

            pushInFlight = true;
            try {
                var response = await fetch(getApiUrl("/api/chat/messages"), {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        entries: outboundEntries.slice(-CHAT_MAX_PUSH_BATCH)
                    })
                });
                if (!response.ok) {
                    return;
                }

                var payload = await response.json().catch(function () {
                    return {};
                });
                if (!payload || payload.success !== true) {
                    return;
                }

                currentMode = normalizeChatMode(payload.thread && payload.thread.mode);
                var mergedAfterPush = mergeServerMessages(readLocalMessages(), payload.messages);
                if (mergedAfterPush.changed) {
                    writeLocalMessages(mergedAfterPush.messages);
                }

                await refreshFromServer();
            } catch (_error) {
                // keep local queue and retry later
            } finally {
                pushInFlight = false;
            }
        }

        function canBotReply() {
            return currentMode !== CHAT_THREAD_MODE_ADMIN;
        }

        function appendLocalMessage(entry) {
            var normalized = normalizeLocalChatMessage(entry);
            if (!normalized) {
                return null;
            }
            var localMessages = readLocalMessages();
            localMessages.push(normalized);
            writeLocalMessages(localMessages);
            return normalized;
        }

        function getLocalMessages() {
            return readLocalMessages();
        }

        function stop() {
            destroyed = true;
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
            if (latestLiveChatRuntime && latestLiveChatRuntime.__runtimeId === runtimeId) {
                latestLiveChatRuntime = null;
            }
        }

        pollTimer = setInterval(function () {
            void refreshFromServer();
        }, syncIntervalMs);

        void refreshFromServer();
        var runtimeId = "chat_rt_" + Date.now() + "_" + Math.random().toString(16).slice(2, 10);
        var runtime = {
            __runtimeId: runtimeId,
            canBotReply: canBotReply,
            refreshFromServer: refreshFromServer,
            notifyLocalMessagesUpdated: notifyLocalMessagesUpdated,
            appendLocalMessage: appendLocalMessage,
            getLocalMessages: getLocalMessages,
            stop: stop,
            getMode: function () {
                return currentMode;
            }
        };
        latestLiveChatRuntime = runtime;
        return runtime;
    }

    function isCancelled(statusValue, fulfillmentValue) {
        var merged = (String(statusValue || "") + " " + String(fulfillmentValue || "")).toLowerCase();
        return merged.indexOf("cancel") >= 0;
    }

    function canCancel(statusValue, fulfillmentValue) {
        var merged = (String(statusValue || "") + " " + String(fulfillmentValue || "")).toLowerCase();
        if (merged.indexOf("cancel") >= 0) return false;
        if (merged.indexOf("completed") >= 0 || merged.indexOf("delivered") >= 0) return false;
        return true;
    }

    function readBookingsForUser() {
        var currentEmail = getCurrentUserEmail();
        var merged = [];

        BOOKING_KEYS.forEach(function (key) {
            var parsed = safeParse(localStorage.getItem(key));
            if (Array.isArray(parsed)) {
                merged = merged.concat(parsed);
            }
        });

        var latest = safeParse(localStorage.getItem("latestBooking"));
        if (latest && typeof latest === "object") {
            merged.push(latest);
        }

        return merged
            .map(function (item, index) {
                if (!item || typeof item !== "object") return null;
                var recordEmail = String(item.email || item.userEmail || "").trim().toLowerCase();
                if (currentEmail && recordEmail !== currentEmail) return null;

                var status = String(item.status || "Preparing");
                var service = String(item.service || item.deliveryOption || "Delivery");
                var fulfillmentStatus = String(item.fulfillmentStatus || (service === "Pick Up" ? "Ready to Pick up" : "In Process"));
                if (isCancelled(status, fulfillmentStatus)) return null;

                return {
                    orderId: String(item.orderId || item.id || ("#EC-" + (1000 + index))),
                    model: String(item.model || item.productName || item.itemName || "Ecodrive E-Bike"),
                    status: status,
                    fulfillmentStatus: fulfillmentStatus,
                    createdAt: String(item.createdAt || item.updatedAt || ""),
                    canCancel: canCancel(status, fulfillmentStatus)
                };
            })
            .filter(Boolean)
            .sort(function (a, b) {
                return String(b.createdAt).localeCompare(String(a.createdAt));
            });
    }

    function getBookingSummary() {
        var items = readBookingsForUser();
        if (!items.length) {
            return "Wala ka pang active booking. Pwede ka mag-book from Ebikes Products page.";
        }
        var latest = items[0];
        return "May " + items.length + " active booking(s). Latest: " + latest.model + " - " + latest.status + " (" + latest.fulfillmentStatus + ").";
    }

    function getCancelSummary() {
        var items = readBookingsForUser();
        if (!items.length) {
            return "Wala ka pang active booking kaya wala pang kailangan i-cancel.";
        }

        var cancellableCount = items.filter(function (item) {
            return item.canCancel;
        }).length;

        if (!cancellableCount) {
            return "Sa ngayon, walang cancellable booking. Completed or delivered orders cannot be cancelled.";
        }
        return "May " + cancellableCount + " booking(s) na puwedeng i-cancel. Gamitin ang Cancel button sa Bookings page.";
    }

    function getReply(text, state) {
        var localState = state || {};
        if (typeof localState.awaitingPriceModel !== "boolean") {
            localState.awaitingPriceModel = false;
        }

        var normalized = normalizeText(text);
        var wheelFilter = getWheelFilter(normalized);
        var modelMatches = findModelMatches(text);
        var isPriceQuestion = includesAny(normalized, ["price", "presyo", "magkano", "mag kano", "hm", "how much", "cost"]);

        if (!normalized) {
            return "Type your question and I will help.";
        }

        if (includesAny(normalized, ["help", "tulong", "what can you do", "ano pwede itanong"])) {
            localState.awaitingPriceModel = false;
            return "Pwede mo itanong: available models, model price, cheapest ebike, booking status, payment options, installment, delivery or pick up, cancel booking, at repair booking.";
        }

        if (includesAny(normalized, ["hello", "hi", "hey", "kumusta", "kamusta", "good morning", "good afternoon", "good evening"])) {
            localState.awaitingPriceModel = false;
            return "Hi! Ready ako tumulong tungkol sa Ecodrive ebikes, prices, at bookings.";
        }

        if (includesAny(normalized, ["salamat", "thanks", "thank you"])) {
            localState.awaitingPriceModel = false;
            return "You are welcome. Sabihin mo lang kung may tanong ka pa.";
        }

        if (includesAny(normalized, ["pinakamura", "cheapest", "lowest"])) {
            localState.awaitingPriceModel = false;
            var cheapestPool = getCatalogByWheel(wheelFilter);
            if (!cheapestPool.length) return "Wala akong nakita na model para sa category na iyan.";
            var cheapest = cheapestPool.reduce(function (best, item) {
                return item.price < best.price ? item : best;
            }, cheapestPool[0]);
            return "Pinakamura sa " + (wheelFilter || "all categories") + " is " + cheapest.model + " at " + formatPeso(cheapest.price) + ".";
        }

        if (includesAny(normalized, ["pinakamahal", "most expensive", "highest price", "premium"])) {
            localState.awaitingPriceModel = false;
            var expensivePool = getCatalogByWheel(wheelFilter);
            if (!expensivePool.length) return "Wala akong nakita na model para sa category na iyan.";
            var expensive = expensivePool.reduce(function (best, item) {
                return item.price > best.price ? item : best;
            }, expensivePool[0]);
            return "Pinakamahal sa " + (wheelFilter || "all categories") + " is " + expensive.model + " at " + formatPeso(expensive.price) + ".";
        }

        if (isPriceQuestion || localState.awaitingPriceModel) {
            if (modelMatches.length === 1) {
                localState.awaitingPriceModel = false;
                return modelMatches[0].model + " costs " + formatPeso(modelMatches[0].price) + " (" + modelMatches[0].category + ").";
            }
            if (modelMatches.length > 1) {
                localState.awaitingPriceModel = false;
                return "May maraming variant na tugma: " + modelMatches.map(function (item) {
                    return item.model + " - " + formatPeso(item.price);
                }).join("; ") + ".";
            }
            localState.awaitingPriceModel = true;
            return "Anong model ang gusto mong i-check? Example: BLITZ 2000, ECARGO 100, or ECONO 500 MP.";
        }

        if (includesAny(normalized, ["book", "booking", "mag book", "magbook", "how to book", "confirm booking"])) {
            localState.awaitingPriceModel = false;
            return "Para mag-book: pumili ng model sa Ebikes Products, click Book Now, fill in customer and shipping info, piliin payment, then Confirm Booking.";
        }

        if (includesAny(normalized, ["available", "models", "model", "catalog", "list", "ano available", "anong ebike", "products"])) {
            localState.awaitingPriceModel = false;
            var availablePool = getCatalogByWheel(wheelFilter);
            if (!availablePool.length) return "Wala akong model list para sa category na iyan.";
            var preview = availablePool.slice(0, 6).map(function (item) {
                return item.model;
            }).join(", ");
            if (availablePool.length > 6) {
                return "Available " + (wheelFilter || "Ecodrive") + " models (" + availablePool.length + "): " + preview + ", at iba pa. Sabihin mo lang yung model para sa exact price.";
            }
            return "Available " + (wheelFilter || "Ecodrive") + " models: " + preview + ".";
        }

        if (includesAny(normalized, ["status", "tracking", "track", "my order", "my booking", "order"])) {
            localState.awaitingPriceModel = false;
            return getBookingSummary();
        }

        if (includesAny(normalized, ["cancel", "cancellation"])) {
            localState.awaitingPriceModel = false;
            return getCancelSummary();
        }

        if (includesAny(normalized, ["payment", "gcash", "maya", "cod", "cash on delivery", "bayad"])) {
            localState.awaitingPriceModel = false;
            return "Payment options: GCash, Maya, at Cash on Delivery. Pumili sa checkout page bago i-confirm ang booking.";
        }

        if (includesAny(normalized, ["installment", "hulugan", "monthly", "downpayment"])) {
            localState.awaitingPriceModel = false;
            return "Supported ang installment flow. Sa payment page, piliin ang Installment then complete the verification steps.";
        }

        if (includesAny(normalized, ["delivery", "pickup", "pick up", "shipping"])) {
            localState.awaitingPriceModel = false;
            return "May Delivery at Pick Up options sa checkout. Delivery adds shipping fee; Pick Up has no shipping fee.";
        }

        if (includesAny(normalized, ["repair", "sira", "maintenance"])) {
            localState.awaitingPriceModel = false;
            return "For repairs, punta sa Repair Booking page then ilagay ang issue details para ma-schedule ka.";
        }

        if (includesAny(normalized, ["contact", "phone", "email", "address", "location", "nasaan"])) {
            localState.awaitingPriceModel = false;
            return "Contact Ecodrive: 09338288185, ecodrive@gmail.com, Poblacion, Baliwag, Bulacan.";
        }

        if (includesAny(normalized, ["ecodrive", "about", "ano ang ecodrive", "sino kayo"])) {
            localState.awaitingPriceModel = false;
            return "Ecodrive offers electric bikes across 2-wheel, 3-wheel, at 4-wheel categories with booking and repair support.";
        }

        return "I can help with ebike models, prices, booking status, payment, installment, delivery, and repair. Type \"help\" for sample questions.";
    }

    function createResponder() {
        var state = { awaitingPriceModel: false };
        return function (text) {
            return getReply(text, state);
        };
    }

    startCatalogSync();
    setupChatEnhancer();

    global.EcodriveChatbotBrain = {
        createResponder: createResponder,
        getReply: function (text, state) {
            return getReply(text, state || { awaitingPriceModel: false });
        },
        attachLiveChat: attachLiveChat,
        getScopedStorageKey: getScopedChatStorageKey,
        getSuggestionQuestions: getSuggestionQuestions
    };
})(window);
