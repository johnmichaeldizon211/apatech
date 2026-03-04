(function (global) {
    "use strict";

    var HOLD_TO_DRAG_DELAY_MS = 220;
    var DRAG_MOVE_TOLERANCE_PX = 5;
    var POSITION_STORAGE_KEY = "ecodrive_chat_widget_position_v1";
    var MESSAGE_STORAGE_KEY = "ecodrive_chat_messages_v1";
    var BRAIN_SCRIPT_SRC = "/Userhomefolder/chatbot-brain.js?v=20260304d";
    var MAX_MEDIA_DATA_URL_LENGTH = 8 * 1024 * 1024;

    function safeParse(raw) {
        try {
            return JSON.parse(raw);
        } catch (_error) {
            return null;
        }
    }

    function isFn(value) {
        return typeof value === "function";
    }

    function readStoredPosition() {
        try {
            var parsed = safeParse(localStorage.getItem(POSITION_STORAGE_KEY));
            if (!parsed || typeof parsed !== "object") {
                return null;
            }
            var left = Number(parsed.left);
            var top = Number(parsed.top);
            if (!Number.isFinite(left) || !Number.isFinite(top)) {
                return null;
            }
            return { left: left, top: top };
        } catch (_error) {
            return null;
        }
    }

    function writeStoredPosition(pos) {
        if (!pos || !Number.isFinite(pos.left) || !Number.isFinite(pos.top)) {
            return;
        }
        try {
            localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify({
                left: Math.round(pos.left),
                top: Math.round(pos.top)
            }));
        } catch (_error) {
            // ignore storage failures
        }
    }

    function ensureWidgetStyles() {
        if (!global.document || global.document.getElementById("ecodrive-user-chat-widget-style")) {
            return;
        }

        var style = global.document.createElement("style");
        style.id = "ecodrive-user-chat-widget-style";
        style.textContent = [
            "body.ecodrive-chat-dragging{user-select:none;cursor:grabbing;}",
            "#chatbot-toggle.ecodrive-chat-draggable{touch-action:none;}",
            "#chatbot-toggle.ecodrive-chat-drag-ready{cursor:grabbing;}",
            ".ecodrive-chat-generated-toggle{position:fixed;top:84px;right:12px;width:38px;height:38px;border:2px solid #2f4fa7;border-radius:50%;background:#fff;color:#2f4fa7;font-size:20px;line-height:1;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 14px rgba(45,74,160,.12);cursor:pointer;z-index:999;font-family:'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif;}",
            ".ecodrive-chat-generated-panel{position:fixed;top:134px;right:12px;width:min(310px,calc(100vw - 24px));background:#fff;border:1.5px solid #2f4fa7;border-radius:12px;box-shadow:0 12px 24px rgba(24,44,95,.2);display:none;overflow:hidden;z-index:1000;}",
            ".ecodrive-chat-generated-panel.open{display:block;}",
            ".ecodrive-chat-generated-panel .chat-header{height:40px;background:#d7e8ef;border-bottom:1px solid #c2d6df;padding:0 10px;display:flex;align-items:center;justify-content:space-between;color:#123f79;font-size:12px;font-weight:700;}",
            ".ecodrive-chat-generated-panel .chat-close{width:24px;height:24px;border:none;border-radius:6px;background:#e9f1f4;color:#2f4fa7;cursor:pointer;font-size:14px;line-height:1;}",
            ".ecodrive-chat-generated-body{height:220px;background:#f4f6fb;overflow-y:auto;padding:10px;display:grid;align-content:start;gap:8px;}",
            ".ecodrive-chat-generated-panel .chat-bubble{max-width:88%;padding:8px 10px;border-radius:10px;font-size:12px;line-height:1.35;word-break:break-word;}",
            ".ecodrive-chat-generated-panel .chat-bubble.bot{background:#e6ecfa;color:#143b80;justify-self:start;}",
            ".ecodrive-chat-generated-panel .chat-bubble.user{background:#2f4ca5;color:#fff;justify-self:end;}",
            ".ecodrive-chat-generated-form{border-top:1px solid #d8e1ec;background:#fff;padding:8px;display:grid;grid-template-columns:1fr auto;gap:7px;}",
            ".ecodrive-chat-generated-form input{height:34px;border:2px solid #292929;border-radius:8px;font-size:12px;padding:0 9px;}",
            ".ecodrive-chat-generated-form button{height:34px;min-width:62px;border:none;border-radius:8px;background:#2f4ca5;color:#fff;font-size:12px;cursor:pointer;}",
            "@media (max-width:480px){.ecodrive-chat-generated-toggle{top:78px;right:10px;}.ecodrive-chat-generated-panel{top:126px;right:10px;width:calc(100vw - 20px);}}"
        ].join("");

        global.document.head.appendChild(style);
    }

    function getChatElements() {
        if (!global.document) {
            return null;
        }
        return {
            toggle: global.document.getElementById("chatbot-toggle"),
            panel: global.document.getElementById("chat-panel"),
            close: global.document.getElementById("chat-close"),
            form: global.document.getElementById("chat-form"),
            input: global.document.getElementById("chat-input"),
            body: global.document.getElementById("chat-body")
        };
    }

    function hasCompleteChatElements(elements) {
        return Boolean(
            elements
            && elements.toggle
            && elements.panel
            && elements.close
            && elements.form
            && elements.input
            && elements.body
        );
    }

    function hasAnyChatElement(elements) {
        return Boolean(
            elements
            && (
                elements.toggle
                || elements.panel
                || elements.close
                || elements.form
                || elements.input
                || elements.body
            )
        );
    }

    function injectGeneratedWidget() {
        if (!global.document || !global.document.body) {
            return null;
        }

        var toggle = global.document.createElement("button");
        toggle.type = "button";
        toggle.id = "chatbot-toggle";
        toggle.className = "chatbot ecodrive-chat-generated-toggle";
        toggle.setAttribute("aria-label", "Open chatbot");
        toggle.textContent = "🤖";

        var panel = global.document.createElement("section");
        panel.id = "chat-panel";
        panel.className = "chat-panel ecodrive-chat-generated-panel";
        panel.setAttribute("aria-hidden", "true");
        panel.setAttribute("aria-live", "polite");
        panel.innerHTML = ""
            + "<header class=\"chat-header\">"
            + "  <strong>Ecodrive Bot</strong>"
            + "  <button type=\"button\" id=\"chat-close\" class=\"chat-close\" aria-label=\"Close chat\">x</button>"
            + "</header>"
            + "<div class=\"chat-body ecodrive-chat-generated-body\" id=\"chat-body\" role=\"log\" aria-live=\"polite\"></div>"
            + "<form class=\"chat-form ecodrive-chat-generated-form\" id=\"chat-form\" action=\"#\">"
            + "  <input type=\"text\" id=\"chat-input\" placeholder=\"Type your message\" aria-label=\"Type your message\">"
            + "  <button type=\"submit\" id=\"chat-send\" aria-label=\"Send message\">Send</button>"
            + "</form>";

        global.document.body.appendChild(toggle);
        global.document.body.appendChild(panel);

        return getChatElements();
    }

    function loadBrainScript(callback) {
        var done = false;
        function finish() {
            if (done) {
                return;
            }
            done = true;
            if (isFn(callback)) {
                callback();
            }
        }

        if (global.EcodriveChatbotBrain) {
            finish();
            return;
        }

        var existing = global.document.querySelector("script[src*='chatbot-brain.js']");
        if (existing) {
            existing.addEventListener("load", finish, { once: true });
            existing.addEventListener("error", finish, { once: true });
            global.setTimeout(finish, 1500);
            return;
        }

        var script = global.document.createElement("script");
        script.src = BRAIN_SCRIPT_SRC;
        script.async = true;
        script.addEventListener("load", finish, { once: true });
        script.addEventListener("error", finish, { once: true });
        global.document.head.appendChild(script);
    }

    function createFallbackReply() {
        return function () {
            return "I can help with ebike models, prices, booking status, payment, installment, delivery, and repair.";
        };
    }

    function inferMediaTypeFromMime(mimeInput) {
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

    function normalizeMediaType(value) {
        var normalized = String(value || "").trim().toLowerCase();
        if (normalized === "image" || normalized === "video" || normalized === "audio") {
            return normalized;
        }
        return "";
    }

    function normalizeMediaDataUrl(value, requestedTypeInput) {
        var raw = String(value || "").trim();
        if (!raw || raw.length > MAX_MEDIA_DATA_URL_LENGTH) {
            return null;
        }
        var match = raw.match(/^data:([^;,]+);base64,([a-zA-Z0-9+/=\s]+)$/);
        if (!match) {
            return null;
        }
        var mime = String(match[1] || "").trim().toLowerCase().slice(0, 120);
        var base64 = String(match[2] || "").replace(/\s+/g, "");
        if (!mime || !base64) {
            return null;
        }

        var inferred = inferMediaTypeFromMime(mime);
        var requested = normalizeMediaType(requestedTypeInput);
        var mediaType = requested || inferred;
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

        return {
            mediaType: mediaType,
            mediaMime: mime,
            mediaDataUrl: "data:" + mime + ";base64," + base64
        };
    }

    function fallbackTextForMedia(mediaType) {
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

    function normalizeMessages(raw) {
        var list = Array.isArray(raw) ? raw : [];
        return list
            .map(function (entry) {
                if (!entry || typeof entry !== "object") {
                    return null;
                }
                var from = String(entry.from || "bot").toLowerCase();
                if (from !== "user" && from !== "admin" && from !== "system") {
                    from = "bot";
                }
                var media = normalizeMediaDataUrl(
                    entry.mediaDataUrl || entry.media_data_url || entry.mediaUrl || entry.media_url || "",
                    entry.mediaType || entry.media_type || entry.messageType || entry.message_type
                );
                var mediaType = media ? media.mediaType : "";
                var text = String(entry.text || "").trim();
                if (!text && mediaType) {
                    text = fallbackTextForMedia(mediaType);
                }
                if (!text && !media) {
                    return null;
                }
                return {
                    from: from,
                    text: text,
                    mediaType: mediaType,
                    mediaDataUrl: media ? media.mediaDataUrl : "",
                    mediaMime: media ? media.mediaMime : "",
                    mediaName: String(entry.mediaName || entry.media_name || "").trim().slice(0, 255),
                    mediaSizeBytes: Number(entry.mediaSizeBytes || entry.media_size_bytes || 0) || 0,
                    createdAt: String(entry.createdAt || ""),
                    clientMessageId: String(entry.clientMessageId || entry.client_message_id || "").trim(),
                    serverMessageId: Number(entry.serverMessageId || entry.server_message_id || entry.id || 0) || 0
                };
            })
            .filter(Boolean);
    }

    function readStoredMessages() {
        try {
            var parsed = safeParse(localStorage.getItem(MESSAGE_STORAGE_KEY));
            return normalizeMessages(parsed);
        } catch (_error) {
            return [];
        }
    }

    function saveStoredMessages(messages) {
        try {
            localStorage.setItem(MESSAGE_STORAGE_KEY, JSON.stringify(normalizeMessages(messages)));
        } catch (_error) {
            // ignore storage failures
        }
    }

    function renderGeneratedMessages(body, messages) {
        if (!body) {
            return;
        }
        body.innerHTML = "";
        normalizeMessages(messages).forEach(function (entry) {
            var bubble = global.document.createElement("div");
            bubble.className = "chat-bubble " + (entry.from === "user" ? "user" : "bot");
            bubble.textContent = entry.text;
            if (entry.mediaDataUrl) {
                var previewWrap = global.document.createElement("div");
                previewWrap.className = "chat-media-preview";
                if (entry.mediaType === "image") {
                    var image = global.document.createElement("img");
                    image.src = entry.mediaDataUrl;
                    image.alt = entry.mediaName || "Chat image attachment";
                    image.loading = "lazy";
                    previewWrap.appendChild(image);
                } else if (entry.mediaType === "video") {
                    var video = global.document.createElement("video");
                    video.src = entry.mediaDataUrl;
                    video.controls = true;
                    video.preload = "metadata";
                    previewWrap.appendChild(video);
                } else if (entry.mediaType === "audio") {
                    var audio = global.document.createElement("audio");
                    audio.src = entry.mediaDataUrl;
                    audio.controls = true;
                    audio.preload = "metadata";
                    previewWrap.appendChild(audio);
                }
                if (previewWrap.childNodes.length > 0) {
                    bubble.classList.add("has-media");
                    bubble.appendChild(previewWrap);
                }
            }
            body.appendChild(bubble);
        });
        body.scrollTop = body.scrollHeight;
    }

    function bindGeneratedChat(elements) {
        if (!hasCompleteChatElements(elements) || elements.toggle.dataset.ecodriveGeneratedChatBound === "1") {
            return;
        }

        var toggle = elements.toggle;
        var panel = elements.panel;
        var closeBtn = elements.close;
        var form = elements.form;
        var input = elements.input;
        var body = elements.body;
        var messages = readStoredMessages();
        var responder = createFallbackReply();
        var liveRuntime = null;

        if (!messages.length) {
            messages = [{
                from: "bot",
                text: "Hi! I'm Ecodrive Bot. Ask me about Ecodrive ebikes, prices, booking status, payment, or repair."
            }];
            saveStoredMessages(messages);
        }

        function attachLiveRuntime() {
            if (!global.EcodriveChatbotBrain) {
                return;
            }
            if (isFn(global.EcodriveChatbotBrain.createResponder)) {
                responder = global.EcodriveChatbotBrain.createResponder();
            }
            if (liveRuntime || !isFn(global.EcodriveChatbotBrain.attachLiveChat)) {
                return;
            }
            liveRuntime = global.EcodriveChatbotBrain.attachLiveChat({
                getMessages: function () {
                    return messages;
                },
                setMessages: function (nextMessages) {
                    messages = normalizeMessages(nextMessages);
                    saveStoredMessages(messages);
                    renderGeneratedMessages(body, messages);
                }
            });
            void liveRuntime.notifyLocalMessagesUpdated();
        }

        function openPanel() {
            panel.classList.add("open");
            panel.setAttribute("aria-hidden", "false");
            renderGeneratedMessages(body, messages);
            if (input) {
                input.focus();
            }
            if (liveRuntime && isFn(liveRuntime.refreshFromServer)) {
                void liveRuntime.refreshFromServer();
            }
        }

        function closePanel() {
            panel.classList.remove("open");
            panel.setAttribute("aria-hidden", "true");
        }

        toggle.addEventListener("click", function (event) {
            event.stopPropagation();
            if (panel.classList.contains("open")) {
                closePanel();
            } else {
                openPanel();
            }
        });

        closeBtn.addEventListener("click", function (event) {
            event.stopPropagation();
            closePanel();
        });

        panel.addEventListener("click", function (event) {
            event.stopPropagation();
        });

        form.addEventListener("submit", function (event) {
            event.preventDefault();
            var text = String(input && input.value ? input.value : "").trim();
            if (!text) {
                return;
            }

            messages.push({ from: "user", text: text });
            if (!liveRuntime || (isFn(liveRuntime.canBotReply) && liveRuntime.canBotReply())) {
                messages.push({ from: "bot", text: responder(text) });
            }
            saveStoredMessages(messages);
            renderGeneratedMessages(body, messages);
            if (liveRuntime && isFn(liveRuntime.notifyLocalMessagesUpdated)) {
                void liveRuntime.notifyLocalMessagesUpdated();
            }

            if (input) {
                input.value = "";
                input.focus();
            }
        });

        global.document.addEventListener("keydown", function (event) {
            if (event.key === "Escape") {
                closePanel();
            }
        });

        renderGeneratedMessages(body, messages);
        attachLiveRuntime();
        loadBrainScript(attachLiveRuntime);

        elements.toggle.dataset.ecodriveGeneratedChatBound = "1";
    }

    function getPanelMetrics(panel) {
        var width = panel.offsetWidth;
        var height = panel.offsetHeight;

        if (!Number.isFinite(width) || width <= 0) {
            width = parseFloat(global.getComputedStyle(panel).width) || 320;
        }
        if (!Number.isFinite(height) || height <= 0) {
            height = parseFloat(global.getComputedStyle(panel).height) || 320;
        }

        return {
            width: width,
            height: height
        };
    }

    function applyWidgetPosition(toggle, panel, leftInput, topInput) {
        var margin = 8;
        var toggleRect = toggle.getBoundingClientRect();
        var toggleWidth = Number(toggleRect.width) > 0 ? toggleRect.width : 44;
        var toggleHeight = Number(toggleRect.height) > 0 ? toggleRect.height : 44;
        var maxLeft = Math.max(margin, global.innerWidth - toggleWidth - margin);
        var maxTop = Math.max(margin, global.innerHeight - toggleHeight - margin);

        var left = Math.max(margin, Math.min(Number(leftInput || 0), maxLeft));
        var top = Math.max(margin, Math.min(Number(topInput || 0), maxTop));

        toggle.style.left = left + "px";
        toggle.style.top = top + "px";
        toggle.style.right = "auto";
        toggle.style.bottom = "auto";

        var panelMetrics = getPanelMetrics(panel);
        var panelLeft = left + toggleWidth - panelMetrics.width;
        var panelTop = top + toggleHeight + 10;
        var maxPanelLeft = Math.max(margin, global.innerWidth - panelMetrics.width - margin);
        panelLeft = Math.max(margin, Math.min(panelLeft, maxPanelLeft));
        if (panelTop + panelMetrics.height > global.innerHeight - margin) {
            panelTop = top - panelMetrics.height - 10;
        }
        if (panelTop < margin) {
            panelTop = margin;
        }

        panel.style.left = panelLeft + "px";
        panel.style.top = panelTop + "px";
        panel.style.right = "auto";
        panel.style.bottom = "auto";

        return { left: left, top: top };
    }

    function enableHoldDrag(toggle, panel) {
        if (!toggle || !panel || toggle.dataset.ecodriveDragReady === "1") {
            return;
        }
        toggle.dataset.ecodriveDragReady = "1";
        toggle.classList.add("ecodrive-chat-draggable");

        var state = {
            pointerId: null,
            startX: 0,
            startY: 0,
            originLeft: 0,
            originTop: 0,
            holdTimer: 0,
            holdReady: false,
            dragging: false,
            suppressClickUntil: 0
        };

        function clearHoldTimer() {
            if (state.holdTimer) {
                global.clearTimeout(state.holdTimer);
                state.holdTimer = 0;
            }
        }

        function clearDragVisual() {
            toggle.classList.remove("ecodrive-chat-drag-ready");
            if (global.document && global.document.body) {
                global.document.body.classList.remove("ecodrive-chat-dragging");
            }
        }

        function onPointerDown(event) {
            if (state.pointerId !== null) {
                return;
            }
            if (event.button !== undefined && event.button !== 0) {
                return;
            }

            var rect = toggle.getBoundingClientRect();
            state.pointerId = event.pointerId;
            state.startX = event.clientX;
            state.startY = event.clientY;
            state.originLeft = rect.left;
            state.originTop = rect.top;
            state.holdReady = false;
            state.dragging = false;

            clearHoldTimer();
            state.holdTimer = global.setTimeout(function () {
                state.holdReady = true;
                toggle.classList.add("ecodrive-chat-drag-ready");
                if (global.document && global.document.body) {
                    global.document.body.classList.add("ecodrive-chat-dragging");
                }
                if (isFn(toggle.setPointerCapture)) {
                    try {
                        toggle.setPointerCapture(state.pointerId);
                    } catch (_error) {
                        // ignore pointer capture errors
                    }
                }
            }, HOLD_TO_DRAG_DELAY_MS);
        }

        function onPointerMove(event) {
            if (state.pointerId === null || event.pointerId !== state.pointerId) {
                return;
            }

            var deltaX = event.clientX - state.startX;
            var deltaY = event.clientY - state.startY;

            if (!state.holdReady) {
                if (Math.abs(deltaX) > DRAG_MOVE_TOLERANCE_PX || Math.abs(deltaY) > DRAG_MOVE_TOLERANCE_PX) {
                    clearHoldTimer();
                }
                return;
            }

            event.preventDefault();
            state.dragging = true;
            applyWidgetPosition(
                toggle,
                panel,
                state.originLeft + deltaX,
                state.originTop + deltaY
            );
        }

        function endPointer(event) {
            if (state.pointerId === null) {
                return;
            }
            if (event.pointerId !== undefined && event.pointerId !== state.pointerId) {
                return;
            }

            var wasDragging = state.dragging;
            state.pointerId = null;
            state.holdReady = false;
            state.dragging = false;
            clearHoldTimer();
            clearDragVisual();

            if (wasDragging) {
                var rect = toggle.getBoundingClientRect();
                writeStoredPosition({
                    left: rect.left,
                    top: rect.top
                });
                state.suppressClickUntil = Date.now() + 350;
            }
        }

        toggle.addEventListener("pointerdown", onPointerDown);
        global.addEventListener("pointermove", onPointerMove, { passive: false });
        global.addEventListener("pointerup", endPointer);
        global.addEventListener("pointercancel", endPointer);

        toggle.addEventListener("click", function (event) {
            if (Date.now() < state.suppressClickUntil) {
                event.preventDefault();
                event.stopPropagation();
                if (isFn(event.stopImmediatePropagation)) {
                    event.stopImmediatePropagation();
                }
            }
        }, true);

        var saved = readStoredPosition();
        if (saved) {
            applyWidgetPosition(toggle, panel, saved.left, saved.top);
        } else if (toggle.classList.contains("ecodrive-chat-generated-toggle")) {
            var generatedRect = toggle.getBoundingClientRect();
            applyWidgetPosition(toggle, panel, generatedRect.left, generatedRect.top);
        }

        global.addEventListener("resize", function () {
            var hasInlinePosition = Boolean(toggle.style.left) && Boolean(toggle.style.top);
            if (!hasInlinePosition && !readStoredPosition()) {
                return;
            }
            var rect = toggle.getBoundingClientRect();
            var applied = applyWidgetPosition(toggle, panel, rect.left, rect.top);
            writeStoredPosition(applied);
        });

        if (typeof MutationObserver === "function") {
            var observer = new MutationObserver(function () {
                var hasInlinePosition = Boolean(toggle.style.left) && Boolean(toggle.style.top);
                if (!hasInlinePosition && !readStoredPosition()) {
                    return;
                }
                var rect = toggle.getBoundingClientRect();
                applyWidgetPosition(toggle, panel, rect.left, rect.top);
            });
            observer.observe(panel, {
                attributes: true,
                attributeFilter: ["class", "aria-hidden", "style"]
            });
        }
    }

    function initializeWidget() {
        ensureWidgetStyles();

        var elements = getChatElements();
        var isComplete = hasCompleteChatElements(elements);
        var injected = false;

        if (!isComplete && !hasAnyChatElement(elements)) {
            elements = injectGeneratedWidget();
            isComplete = hasCompleteChatElements(elements);
            injected = true;
        }

        if (!isComplete) {
            return;
        }

        if (injected) {
            bindGeneratedChat(elements);
        }
        enableHoldDrag(elements.toggle, elements.panel);
    }

    if (global.document.readyState === "loading") {
        global.document.addEventListener("DOMContentLoaded", initializeWidget);
    } else {
        initializeWidget();
    }
})(window);
