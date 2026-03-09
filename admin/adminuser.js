document.addEventListener("DOMContentLoaded", () => {
    const API_BASE = String(
        (window.EcodriveSession && typeof window.EcodriveSession.getApiBase === "function"
            ? window.EcodriveSession.getApiBase()
            : localStorage.getItem("ecodrive_api_base")
                || localStorage.getItem("ecodrive_kyc_api_base")
                || "")
    )
        .trim()
        .replace(/\/+$/, "");

    const totalUsersEl = document.getElementById("stat-total-users");
    const activeUsersEl = document.getElementById("stat-active-users");
    const newUsersEl = document.getElementById("stat-new-users");
    const blockedUsersEl = document.getElementById("stat-blocked-users");
    const usersTableBody = document.getElementById("users-table-body");
    const usersEmptyState = document.getElementById("users-empty-state");

    const chatModal = document.getElementById("admin-chat-modal");
    const chatCloseBtn = document.getElementById("admin-chat-close");
    const chatUserLabel = document.getElementById("admin-chat-user-label");
    const chatModePill = document.getElementById("admin-chat-mode-pill");
    const chatTakeoverBtn = document.getElementById("admin-chat-takeover");
    const chatReleaseBtn = document.getElementById("admin-chat-release");
    const chatClearBtn = document.getElementById("admin-chat-clear");
    const chatStatusEl = document.getElementById("admin-chat-status");
    const chatMessagesEl = document.getElementById("admin-chat-messages");
    const chatForm = document.getElementById("admin-chat-form");
    const chatInput = document.getElementById("admin-chat-input");
    const chatSendBtn = document.getElementById("admin-chat-send");
    const chatAttachBtn = document.getElementById("admin-chat-attach");
    const chatVoiceBtn = document.getElementById("admin-chat-voice");
    const chatMediaInput = document.getElementById("admin-chat-media-input");

    const CHAT_MODE_BOT = "bot";
    const CHAT_MODE_ADMIN = "admin";
    const CHAT_POLL_BASE_MS = 2500;
    const CHAT_POLL_BACKOFF_MS = 8000;
    const CHAT_POLL_MAX_MS = 15000;
    const CHAT_POLL_FAILURE_STEP = 4;
    const CHAT_REQUEST_TIMEOUT_MS = 12000;
    const CHAT_MAX_MEDIA_BYTES = Number.POSITIVE_INFINITY;
    const CHAT_MAX_MEDIA_DATA_URL_LENGTH = Number.POSITIVE_INFINITY;

    const chatState = {
        selectedUser: null,
        mode: CHAT_MODE_BOT,
        pollTimer: null,
        pollIntervalMs: CHAT_POLL_BASE_MS,
        consecutiveFailures: 0,
        lastFailureType: "",
        loading: false,
        sending: false,
        latestMessageId: 0,
        lastStatusKey: ""
    };
    const voiceState = {
        recording: false,
        mediaRecorder: null,
        stream: null,
        chunks: []
    };

    if (!window.EcodriveSession || typeof window.EcodriveSession.requireRole !== "function" || !window.EcodriveSession.requireRole("admin")) {
        return;
    }

    function normalizeApiPath(pathInput) {
        let normalized = String(pathInput || "").trim();
        if (!normalized.startsWith("/")) {
            normalized = `/${normalized}`;
        }
        return normalized;
    }

    function normalizeChatEmail(value) {
        return String(value || "").trim().toLowerCase();
    }

    function getApiUrl(path) {
        const normalizedPath = normalizeApiPath(path);
        return API_BASE ? `${API_BASE}${normalizedPath}` : normalizedPath;
    }

    function buildApiFetchCandidates(path) {
        const normalizedPath = normalizeApiPath(path);
        const candidates = [normalizedPath];
        const configuredBaseUrl = getApiUrl(normalizedPath);
        if (configuredBaseUrl && configuredBaseUrl !== normalizedPath) {
            candidates.push(configuredBaseUrl);
        }
        return candidates.filter((entry, index, source) => entry && source.indexOf(entry) === index);
    }

    function shouldRetryNextCandidate(response, hasRemainingCandidate) {
        if (!response || !hasRemainingCandidate) {
            return false;
        }
        const retryStatuses = new Set([404, 405, 408, 429, 500, 502, 503, 504]);
        return retryStatuses.has(Number(response.status || 0));
    }

    async function fetchWithApiFallback(path, options) {
        const candidates = buildApiFetchCandidates(path);
        let lastError = null;
        let lastResponse = null;
        for (let i = 0; i < candidates.length; i += 1) {
            try {
                const response = await fetch(candidates[i], options);
                lastResponse = response;
                if (shouldRetryNextCandidate(response, i < candidates.length - 1)) {
                    continue;
                }
                return response;
            } catch (error) {
                lastError = error;
            }
        }
        if (lastResponse) {
            return lastResponse;
        }
        throw (lastError || new Error("Network request failed."));
    }

    function shouldUseGenericChatFallback(result) {
        if (!result || result.ok) {
            return false;
        }
        const status = Number(result.status || 0);
        if (status === 401 || status === 403) {
            return false;
        }
        if (status < 1) {
            return true;
        }
        return status === 400
            || status === 404
            || status === 405
            || status === 408
            || status === 429
            || status === 500
            || status === 501
            || status === 502
            || status === 503
            || status === 504;
    }

    function readErrorMessageFromPayload(payloadInput) {
        const payload = payloadInput && typeof payloadInput === "object" ? payloadInput : null;
        if (!payload) {
            return "";
        }
        if (typeof payload.message === "string" && payload.message.trim()) {
            return payload.message.trim();
        }
        if (typeof payload.error === "string" && payload.error.trim()) {
            return payload.error.trim();
        }
        if (typeof payload.reason === "string" && payload.reason.trim()) {
            return payload.reason.trim();
        }
        return "";
    }

    async function requestChatApi(path, optionsInput, _metaInput) {
        const options = optionsInput && typeof optionsInput === "object" ? optionsInput : {};
        const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        const timeoutId = controller
            ? setTimeout(() => controller.abort(), CHAT_REQUEST_TIMEOUT_MS)
            : null;

        const normalizedPath = normalizeApiPath(path);
        const configuredUrl = getApiUrl(normalizedPath);
        const candidates = [];
        if (configuredUrl && configuredUrl !== normalizedPath) {
            candidates.push(configuredUrl);
        }
        candidates.push(normalizedPath);
        let response = null;
        let lastError = null;
        try {
            for (let i = 0; i < candidates.length; i += 1) {
                try {
                    response = await fetch(candidates[i], {
                        ...options,
                        signal: controller ? controller.signal : options.signal
                    });
                } catch (error) {
                    lastError = error;
                    if (i < candidates.length - 1) {
                        continue;
                    }
                    throw error;
                }

                if (!shouldRetryNextCandidate(response, i < candidates.length - 1)) {
                    break;
                }
            }
        } catch (error) {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            const fallbackMessage = error && error.name === "AbortError"
                ? "Request timed out. Please try again."
                : "Unable to reach chat API.";
            return {
                ok: false,
                status: 0,
                payload: null,
                networkError: true,
                errorMessage: error && error.message ? error.message : (lastError && lastError.message ? lastError.message : fallbackMessage)
            };
        }

        if (timeoutId) {
            clearTimeout(timeoutId);
        }

        const payload = await response.json().catch(() => null);
        if (response.ok) {
            return {
                ok: true,
                status: Number(response.status || 200),
                payload: payload,
                networkError: false,
                errorMessage: ""
            };
        }

        const payloadMessage = readErrorMessageFromPayload(payload);
        return {
            ok: false,
            status: Number(response.status || 0),
            payload: payload,
            networkError: false,
            errorMessage: payloadMessage || response.statusText || "Chat request failed."
        };
    }

    function normalizeChatApiFailure(resultInput, fallbackMessage) {
        const result = resultInput && typeof resultInput === "object" ? resultInput : {};
        if (result.ok) {
            return { mode: "ok", payload: result.payload, status: Number(result.status || 200) };
        }

        const status = Number(result.status || 0);
        const networkError = Boolean(result.networkError) || status < 1;
        let failureType = "http";
        if (networkError) {
            failureType = "network";
        } else if (status === 401 || status === 403) {
            failureType = "auth";
        } else if (status >= 500) {
            failureType = "server";
        }

        const payloadMessage = readErrorMessageFromPayload(result.payload);
        return {
            mode: "error",
            status: status,
            failureType: failureType,
            payload: result.payload && typeof result.payload === "object" ? result.payload : {},
            message: payloadMessage || String(result.errorMessage || fallbackMessage || "Chat request failed.")
        };
    }

    function getChatFailureMessage(resultInput, fallbackMessage, optionsInput) {
        const result = resultInput && typeof resultInput === "object" ? resultInput : {};
        const options = optionsInput && typeof optionsInput === "object" ? optionsInput : {};

        if (result.failureType === "network") {
            return options.retrying ? "Connection issue, retrying..." : "Connection issue. Please check your internet and retry.";
        }
        if (result.failureType === "auth") {
            return result.message || "Admin session expired. Please sign in again.";
        }
        if (Number(result.status || 0) === 404 && result.message) {
            return result.message;
        }
        if (result.failureType === "server") {
            return result.message || "Backend error while processing chat request.";
        }
        return result.message || fallbackMessage || "Unable to process chat request.";
    }

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function normalizeChatMode(value) {
        return String(value || "").trim().toLowerCase() === CHAT_MODE_ADMIN ? CHAT_MODE_ADMIN : CHAT_MODE_BOT;
    }

    function formatDateTime(value) {
        if (!value) {
            return "";
        }
        const stamp = new Date(value);
        if (Number.isNaN(stamp.getTime())) {
            return "";
        }
        return stamp.toLocaleString("en-PH", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true
        });
    }

    function isNearBottom(element) {
        if (!element) return true;
        return element.scrollHeight - element.scrollTop - element.clientHeight < 48;
    }

    function scrollToBottom(element) {
        if (!element) return;
        element.scrollTop = element.scrollHeight;
    }

    function setChatStatus(message, tone) {
        if (!chatStatusEl) return;
        const normalizedTone = tone === "error" || tone === "success" ? tone : "";
        const normalizedMessage = String(message || "");
        const statusKey = `${normalizedTone}|${normalizedMessage}`;
        if (chatState.lastStatusKey === statusKey) {
            return;
        }
        chatState.lastStatusKey = statusKey;

        chatStatusEl.textContent = normalizedMessage;
        chatStatusEl.classList.remove("error", "success");
        if (normalizedTone) {
            chatStatusEl.classList.add(normalizedTone);
        }
    }

    function setChatMode(modeInput) {
        const mode = normalizeChatMode(modeInput);
        chatState.mode = mode;
        if (!chatModePill) return;

        chatModePill.classList.remove("bot", "admin");
        chatModePill.classList.add(mode);
        chatModePill.textContent = mode === CHAT_MODE_ADMIN ? "Admin Takeover" : "Bot Active";

        if (chatTakeoverBtn) {
            chatTakeoverBtn.disabled = mode === CHAT_MODE_ADMIN || !chatState.selectedUser || !chatState.selectedUser.id;
        }
        if (chatReleaseBtn) {
            chatReleaseBtn.disabled = mode !== CHAT_MODE_ADMIN || !chatState.selectedUser || !chatState.selectedUser.id;
        }
        if (chatClearBtn) {
            chatClearBtn.disabled = !chatState.selectedUser;
        }
    }

    function clearChatMessages() {
        if (chatMessagesEl) {
            chatMessagesEl.innerHTML = "";
        }
        chatState.latestMessageId = 0;
    }

    function resetVoiceState() {
        voiceState.recording = false;
        voiceState.chunks = [];
        voiceState.mediaRecorder = null;
        if (voiceState.stream && typeof voiceState.stream.getTracks === "function") {
            voiceState.stream.getTracks().forEach((track) => {
                try {
                    track.stop();
                } catch (_error) {
                    // ignore track stop issues
                }
            });
        }
        voiceState.stream = null;

        if (chatVoiceBtn) {
            chatVoiceBtn.classList.remove("recording");
            chatVoiceBtn.textContent = "Voice";
        }
    }

    function renderStats(stats) {
        totalUsersEl.textContent = String(stats.totalUsers || 0);
        activeUsersEl.textContent = String(stats.activeUsers || 0);
        newUsersEl.textContent = String(stats.newUsersThisMonth || 0);
        blockedUsersEl.textContent = String(stats.blockedUsers || 0);
    }

    function renderChatMessages(messages, forceScroll) {
        if (!chatMessagesEl) {
            return;
        }
        const list = Array.isArray(messages) ? messages : [];
        const shouldStickToBottom = Boolean(forceScroll) || isNearBottom(chatMessagesEl);

        chatMessagesEl.innerHTML = "";
        let latestId = 0;

        list.forEach((message) => {
            const role = String(message && message.role ? message.role : "bot").toLowerCase();
            const className = role === "admin"
                ? "admin"
                : (role === "user" ? "user" : (role === "system" ? "system" : "bot"));
            const wrapper = document.createElement("article");
            wrapper.className = `chat-msg ${className}`;

            const fallbackMediaText = fallbackTextForMedia(
                message && (message.mediaType || message.media_type || message.messageType)
            );
            const displayText = String((message && message.text) || "").trim() || fallbackMediaText;
            const textEl = document.createElement("p");
            textEl.textContent = displayText;
            wrapper.appendChild(textEl);

            const previewNode = createMediaPreviewNode(message);
            if (previewNode) {
                wrapper.classList.add("has-media");
                wrapper.appendChild(previewNode);
            }

            const metaEl = document.createElement("div");
            metaEl.className = "chat-msg-meta";
            const label = className === "admin"
                ? "Admin"
                : (className === "user" ? "User" : (className === "system" ? "System" : "Bot"));
            const stamp = formatDateTime(message && message.createdAt);
            metaEl.textContent = stamp ? `${label} - ${stamp}` : label;
            wrapper.appendChild(metaEl);

            chatMessagesEl.appendChild(wrapper);

            const parsedId = Number(message && message.id ? message.id : 0);
            if (Number.isFinite(parsedId) && parsedId > latestId) {
                latestId = parsedId;
            }
        });

        chatState.latestMessageId = latestId;

        if (shouldStickToBottom) {
            scrollToBottom(chatMessagesEl);
        }
    }

    function stopChatPolling() {
        if (chatState.pollTimer) {
            clearTimeout(chatState.pollTimer);
            chatState.pollTimer = null;
        }
    }

    function nextPollIntervalMsForFailures(failureCountInput) {
        const failureCount = Number(failureCountInput || 0);
        if (!Number.isFinite(failureCount) || failureCount < CHAT_POLL_FAILURE_STEP) {
            return CHAT_POLL_BASE_MS;
        }
        if (failureCount >= CHAT_POLL_FAILURE_STEP * 2) {
            return CHAT_POLL_MAX_MS;
        }
        return CHAT_POLL_BACKOFF_MS;
    }

    function recordChatPollSuccess() {
        chatState.consecutiveFailures = 0;
        chatState.lastFailureType = "";
        chatState.pollIntervalMs = CHAT_POLL_BASE_MS;
    }

    function recordChatPollFailure(failureTypeInput) {
        chatState.consecutiveFailures += 1;
        chatState.lastFailureType = String(failureTypeInput || "http");
        chatState.pollIntervalMs = nextPollIntervalMsForFailures(chatState.consecutiveFailures);
    }

    function scheduleNextChatPoll() {
        if (!chatState.selectedUser || !chatModal || !chatModal.classList.contains("open") || document.hidden) {
            return;
        }
        stopChatPolling();
        chatState.pollTimer = setTimeout(async () => {
            chatState.pollTimer = null;
            await loadChatThread(false, { isPolling: true });
            scheduleNextChatPoll();
        }, chatState.pollIntervalMs);
    }

    function startChatPolling() {
        stopChatPolling();
        recordChatPollSuccess();
        scheduleNextChatPoll();
    }

    function openChatModal(user) {
        const selected = user && typeof user === "object" ? user : {};
        chatState.selectedUser = {
            id: Number(selected.id || 0),
            name: String(selected.name || "N/A"),
            email: normalizeChatEmail(selected.email || ""),
            chatMode: normalizeChatMode(selected.chatMode)
        };
        recordChatPollSuccess();
        setChatStatus("", "");
        clearChatMessages();
        setChatMode(CHAT_MODE_BOT);

        if (chatUserLabel) {
            const name = String(chatState.selectedUser && chatState.selectedUser.name ? chatState.selectedUser.name : "N/A");
            const email = String(chatState.selectedUser && chatState.selectedUser.email ? chatState.selectedUser.email : "N/A");
            chatUserLabel.textContent = `${name} (${email})`;
        }

        if (chatModal) {
            chatModal.classList.add("open");
            chatModal.setAttribute("aria-hidden", "false");
        }

        if (chatInput) {
            chatInput.value = "";
            chatInput.focus();
        }
        if (chatMediaInput) {
            chatMediaInput.value = "";
        }
        if (chatSendBtn) {
            chatSendBtn.disabled = false;
            chatSendBtn.textContent = "Send";
        }
        if (chatAttachBtn) {
            chatAttachBtn.disabled = false;
        }
        if (chatVoiceBtn) {
            chatVoiceBtn.disabled = false;
            chatVoiceBtn.classList.remove("recording");
            chatVoiceBtn.textContent = "Voice";
        }

        void loadChatThread(true);
        startChatPolling();
    }

    function closeChatModal() {
        stopChatPolling();
        resetVoiceState();
        chatState.selectedUser = null;
        chatState.mode = CHAT_MODE_BOT;
        chatState.pollIntervalMs = CHAT_POLL_BASE_MS;
        chatState.consecutiveFailures = 0;
        chatState.lastFailureType = "";
        chatState.loading = false;
        chatState.sending = false;
        chatState.latestMessageId = 0;
        setChatStatus("", "");
        clearChatMessages();

        if (chatModal) {
            chatModal.classList.remove("open");
            chatModal.setAttribute("aria-hidden", "true");
        }
        if (chatSendBtn) {
            chatSendBtn.disabled = true;
            chatSendBtn.textContent = "Send";
        }
        if (chatAttachBtn) {
            chatAttachBtn.disabled = true;
        }
        if (chatVoiceBtn) {
            chatVoiceBtn.disabled = true;
            chatVoiceBtn.classList.remove("recording");
            chatVoiceBtn.textContent = "Voice";
        }
        if (chatClearBtn) {
            chatClearBtn.disabled = true;
        }
    }

    async function fetchUsersFromApi() {
        try {
            const response = await fetchWithApiFallback("/api/admin/users", { method: "GET" });

            if (response.status === 404 || response.status === 405) {
                return { mode: "unavailable" };
            }

            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.success !== true) {
                return {
                    mode: "error",
                    message: data.message || "Failed to load users from API."
                };
            }

            return { mode: "ok", data: data };
        } catch (_error) {
            return { mode: "unavailable" };
        }
    }

    async function updateUserStatus(user, action) {
        if (!user || !user.id) {
            return { mode: "error", message: "User id is missing." };
        }

        try {
            const response = await fetchWithApiFallback(
                `/api/admin/users/${encodeURIComponent(user.id)}/${action}`,
                { method: "POST" }
            );

            if (response.status === 404 || response.status === 405) {
                return { mode: "unavailable" };
            }

            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.success !== true) {
                return {
                    mode: "error",
                    message: data.message || "Unable to update user status."
                };
            }

            return { mode: "ok" };
        } catch (_error) {
            return { mode: "unavailable" };
        }
    }

    async function fetchChatThreadByEmail(userInput, limitInput) {
        const user = userInput && typeof userInput === "object" ? userInput : {};
        const userId = Number(user.id || 0);
        const email = normalizeChatEmail(user.email);
        if (userId < 1 && !email) {
            return { mode: "error", failureType: "http", status: 400, message: "User id or email is missing." };
        }

        const params = new URLSearchParams();
        if (userId > 0) {
            params.set("userId", String(Math.floor(userId)));
        }
        if (email) {
            params.set("email", email);
        }
        const limit = Number(limitInput || 0);
        if (Number.isFinite(limit) && limit > 0) {
            params.set("limit", String(Math.floor(limit)));
        }

        const apiResult = await requestChatApi(
            `/api/chat/thread?${params.toString()}`,
            { method: "GET" },
            { action: "thread-fallback", userId, email }
        );
        return normalizeChatApiFailure(apiResult, "Unable to load user chat.");
    }

    async function postAdminChatAction(userId, endpointSuffix, body) {
        if (!userId) {
            return { mode: "error", failureType: "http", status: 400, message: "User id is missing." };
        }

        const apiResult = await requestChatApi(
            `/api/admin/chat/users/${encodeURIComponent(userId)}/${endpointSuffix}`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(body || {})
            },
            { action: endpointSuffix, userId }
        );
        return normalizeChatApiFailure(apiResult, "Unable to complete chat action.");
    }

    async function clearAdminChatThread(userInput) {
        const user = userInput && typeof userInput === "object" ? userInput : {};
        const userId = Number(user.id || 0);
        const email = normalizeChatEmail(user.email);
        if (userId < 1 && !email) {
            return { mode: "error", failureType: "http", status: 400, message: "User id or email is missing." };
        }

        const apiResult = await requestChatApi(
            "/api/chat/thread/clear",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    userId: userId > 0 ? userId : undefined,
                    email: email || undefined
                })
            },
            { action: "clear-thread", userId, email }
        );
        return normalizeChatApiFailure(apiResult, "Unable to clear chat conversation.");
    }

    async function fetchAdminChatThread(userInput) {
        const user = userInput && typeof userInput === "object" ? userInput : {};
        const userId = Number(user.id || 0);
        const userEmail = normalizeChatEmail(user.email);

        if (userId > 0) {
            const primaryResult = await requestChatApi(
                `/api/admin/chat/users/${encodeURIComponent(userId)}?limit=250`,
                { method: "GET" },
                { action: "admin-thread", userId }
            );
            if (primaryResult.ok) {
                return normalizeChatApiFailure(primaryResult, "Unable to load user chat.");
            }
            if (shouldUseGenericChatFallback(primaryResult)) {
                return fetchChatThreadByEmail({ id: userId, email: userEmail }, 250);
            }
            return normalizeChatApiFailure(primaryResult, "Unable to load user chat.");
        }

        if (userEmail) {
            return fetchChatThreadByEmail({ email: userEmail }, 250);
        }

        return { mode: "error", failureType: "http", status: 400, message: "User id or email is missing." };
    }

    async function sendAdminChatMessage(userInput, payloadInput) {
        const user = userInput && typeof userInput === "object" ? userInput : {};
        const userId = Number(user.id || 0);
        const userEmail = normalizeChatEmail(user.email);
        if (userId < 1 && !userEmail) {
            return { mode: "error", failureType: "http", status: 400, message: "User id or email is missing." };
        }

        const payload = toOutgoingMediaPayload(payloadInput || {});
        if (!payload) {
            return { mode: "error", failureType: "http", status: 400, message: "Message text or media is required." };
        }

        if (userId > 0) {
            const primaryResult = await requestChatApi(
                `/api/admin/chat/users/${encodeURIComponent(userId)}/messages`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        message: payload.text,
                        mediaType: payload.mediaType,
                        mediaDataUrl: payload.mediaDataUrl,
                        mediaMime: payload.mediaMime,
                        mediaName: payload.mediaName,
                        mediaSizeBytes: payload.mediaSizeBytes
                    })
                },
                { action: "admin-send", userId }
            );

            if (primaryResult.ok) {
                return normalizeChatApiFailure(primaryResult, "Unable to send admin message.");
            }
            if (!shouldUseGenericChatFallback(primaryResult)) {
                return normalizeChatApiFailure(primaryResult, "Unable to send admin message.");
            }
        }

        const genericBody = {
            userId: userId > 0 ? userId : undefined,
            email: userEmail || undefined,
            entries: [
                {
                    role: "admin",
                    message: payload.text,
                    mediaType: payload.mediaType,
                    mediaDataUrl: payload.mediaDataUrl,
                    mediaMime: payload.mediaMime,
                    mediaName: payload.mediaName,
                    mediaSizeBytes: payload.mediaSizeBytes,
                    clientMessageId: `admin-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
                }
            ]
        };
        const fallbackResult = await requestChatApi(
            "/api/chat/messages",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(genericBody)
            },
            { action: "send-fallback", userId, email: userEmail }
        );
        return normalizeChatApiFailure(fallbackResult, "Unable to send admin message.");
    }

    async function loadChatThread(forceScroll, optionsInput) {
        const options = optionsInput && typeof optionsInput === "object" ? optionsInput : {};
        const isPolling = Boolean(options.isPolling);
        if (!chatState.selectedUser || chatState.loading) {
            return;
        }

        const requestUserId = Number(chatState.selectedUser.id || 0);
        const requestUserEmail = normalizeChatEmail(chatState.selectedUser.email);
        const requestUserKey = `${requestUserId}|${requestUserEmail}`;
        chatState.loading = true;
        const previousLatestId = chatState.latestMessageId;
        const result = await fetchAdminChatThread({
            id: requestUserId,
            email: requestUserEmail
        });
        chatState.loading = false;

        if (!chatState.selectedUser) {
            return;
        }
        const activeUserKey = `${Number(chatState.selectedUser.id || 0)}|${normalizeChatEmail(chatState.selectedUser.email)}`;
        if (activeUserKey !== requestUserKey) {
            return;
        }

        if (result.mode === "ok") {
            const payload = result.payload || {};
            const thread = payload.thread || {};
            const messages = Array.isArray(payload.messages) ? payload.messages : [];
            setChatMode(thread.mode);

            let shouldScroll = Boolean(forceScroll);
            if (!shouldScroll) {
                const incomingLatestId = messages.reduce((maxId, item) => {
                    const id = Number(item && item.id ? item.id : 0);
                    return id > maxId ? id : maxId;
                }, 0);
                shouldScroll = incomingLatestId > previousLatestId;
            }

            renderChatMessages(messages, shouldScroll);
            setChatStatus("", "");
            if (isPolling) {
                recordChatPollSuccess();
            }
            return;
        }

        if (isPolling) {
            recordChatPollFailure(result.failureType);
        }
        setChatStatus(
            getChatFailureMessage(result, "Unable to load chat thread.", { retrying: isPolling }),
            "error"
        );
    }

    async function loadUsers() {
        usersTableBody.innerHTML = "";
        usersEmptyState.style.display = "grid";

        const apiResult = await fetchUsersFromApi();
        if (apiResult.mode === "ok") {
            renderStats(apiResult.data.stats || {});
            renderUsers(apiResult.data.users || []);
            return;
        }

        renderStats({
            totalUsers: 0,
            activeUsers: 0,
            newUsersThisMonth: 0,
            blockedUsers: 0
        });
        renderUsers([]);
    }

    function renderUsers(users) {
        usersTableBody.innerHTML = "";

        if (!Array.isArray(users) || users.length === 0) {
            usersEmptyState.style.display = "grid";
            return;
        }

        usersEmptyState.style.display = "none";

        users.forEach((user) => {
            const status = String(user.status || "active").toLowerCase() === "blocked" ? "blocked" : "active";
            const nextAction = status === "blocked" ? "unblock" : "block";

            const row = document.createElement("article");
            row.className = "user-row";
            row.innerHTML = `
                <span class="user-cell">${escapeHtml(user.name || "N/A")}</span>
                <span class="user-cell">${escapeHtml(user.email || "N/A")}</span>
                <span class="user-cell">${escapeHtml(user.role || "user")}</span>
                <span class="user-cell">
                    <span class="status-pill ${status}">${status === "blocked" ? "Blocked" : "Active"}</span>
                </span>
                <span class="user-cell user-actions">
                    <button class="action-btn ${nextAction}" type="button">
                        ${nextAction === "block" ? "Block" : "Unblock"}
                    </button>
                    <button class="action-btn message" type="button">Message</button>
                </span>
            `;

            const actionBtn = row.querySelector(`.action-btn.${nextAction}`);
            if (actionBtn) {
                actionBtn.addEventListener("click", async () => {
                    actionBtn.disabled = true;
                    actionBtn.textContent = nextAction === "block" ? "Blocking..." : "Unblocking...";

                    const result = await updateUserStatus(user, nextAction);
                    if (result.mode === "ok") {
                        await loadUsers();
                        return;
                    }

                    if (result.mode === "unavailable") {
                        alert("API unavailable. Please make sure the backend server is running.");
                    } else {
                        alert(result.message || "Unable to update user status.");
                    }
                    actionBtn.disabled = false;
                    actionBtn.textContent = nextAction === "block" ? "Block" : "Unblock";
                });
            }

            const messageBtn = row.querySelector(".action-btn.message");
            if (messageBtn) {
                messageBtn.addEventListener("click", () => {
                    openChatModal({
                        id: Number(user.id || 0),
                        name: String(user.name || "N/A"),
                        email: String(user.email || "N/A"),
                        chatMode: normalizeChatMode(user.chatMode)
                    });
                });
            }

            usersTableBody.appendChild(row);
        });
    }

    if (chatCloseBtn) {
        chatCloseBtn.addEventListener("click", closeChatModal);
    }

    if (chatModal) {
        chatModal.addEventListener("click", (event) => {
            if (event.target === chatModal) {
                closeChatModal();
            }
        });
    }

    if (chatTakeoverBtn) {
        chatTakeoverBtn.addEventListener("click", async () => {
            if (!chatState.selectedUser || !chatState.selectedUser.id) {
                return;
            }
            chatTakeoverBtn.disabled = true;
            const result = await postAdminChatAction(chatState.selectedUser.id, "takeover", {});
            if (result.mode === "ok") {
                setChatStatus("Admin takeover is now active. Chatbot replies are paused.", "success");
                await loadChatThread(true);
            } else {
                setChatStatus(getChatFailureMessage(result, "Unable to start takeover."), "error");
            }
            setChatMode(chatState.mode);
        });
    }

    if (chatReleaseBtn) {
        chatReleaseBtn.addEventListener("click", async () => {
            if (!chatState.selectedUser || !chatState.selectedUser.id) {
                return;
            }
            chatReleaseBtn.disabled = true;
            const result = await postAdminChatAction(chatState.selectedUser.id, "release", {});
            if (result.mode === "ok") {
                setChatStatus("Chatbot has been re-enabled for this user.", "success");
                await loadChatThread(true);
            } else {
                setChatStatus(getChatFailureMessage(result, "Unable to release takeover."), "error");
            }
            setChatMode(chatState.mode);
        });
    }

    function inferMediaTypeFromMime(mimeInput) {
        const mime = String(mimeInput || "").trim().toLowerCase();
        if (mime.startsWith("image/")) return "image";
        if (mime.startsWith("video/")) return "video";
        if (mime.startsWith("audio/")) return "audio";
        return "";
    }

    function normalizeMediaType(value, fallbackType) {
        const fallback = String(fallbackType || "").trim().toLowerCase();
        const normalized = String(value || fallback).trim().toLowerCase();
        if (normalized === "image" || normalized === "video" || normalized === "audio") {
            return normalized;
        }
        if (fallback === "image" || fallback === "video" || fallback === "audio") {
            return fallback;
        }
        return "";
    }

    function fallbackTextForMedia(mediaTypeInput) {
        const mediaType = normalizeMediaType(mediaTypeInput, "");
        if (mediaType === "image") return "[Image]";
        if (mediaType === "video") return "[Video]";
        if (mediaType === "audio") return "[Voice message]";
        return "";
    }

    function normalizeMediaDataUrl(rawValue, requestedTypeInput) {
        const raw = String(rawValue || "").trim();
        if (!raw || raw.length > CHAT_MAX_MEDIA_DATA_URL_LENGTH) {
            return null;
        }

        const loweredRaw = raw.toLowerCase();
        const prefix = "data:";
        const marker = ";base64,";
        const markerIndex = loweredRaw.indexOf(marker);
        if (!loweredRaw.startsWith(prefix) || markerIndex <= prefix.length) {
            return null;
        }

        const mimeSection = raw.slice(prefix.length, markerIndex).trim();
        const mime = String((mimeSection.split(";")[0] || "")).trim().toLowerCase().slice(0, 120);
        const base64 = String(raw.slice(markerIndex + marker.length) || "").replace(/\s+/g, "");
        if (!mime || !base64 || !/^[a-zA-Z0-9+/=]+$/.test(base64)) {
            return null;
        }

        const inferredType = inferMediaTypeFromMime(mime);
        const requestedType = normalizeMediaType(requestedTypeInput, inferredType);
        const mediaType = requestedType || inferredType;
        if (!mediaType) {
            return null;
        }
        if (
            (mediaType === "image" && !mime.startsWith("image/"))
            || (mediaType === "video" && !mime.startsWith("video/"))
            || (mediaType === "audio" && !mime.startsWith("audio/"))
        ) {
            return null;
        }

        return {
            mediaType,
            mediaMime: mime,
            mediaDataUrl: `data:${mime};base64,${base64}`
        };
    }

    function toOutgoingMediaPayload(rawPayload) {
        const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
        const normalizedMedia = normalizeMediaDataUrl(
            payload.mediaDataUrl || payload.media_data_url || payload.mediaUrl || "",
            payload.mediaType || payload.media_type || payload.messageType || ""
        );
        const text = String(payload.text || payload.message || payload.messageText || "").trim();
        const mediaType = normalizedMedia ? normalizedMedia.mediaType : "";
        const fallbackText = mediaType ? fallbackTextForMedia(mediaType) : "";

        if (!text && !normalizedMedia) {
            return null;
        }

        return {
            text: text || fallbackText,
            mediaType: mediaType,
            mediaDataUrl: normalizedMedia ? normalizedMedia.mediaDataUrl : "",
            mediaMime: normalizedMedia ? normalizedMedia.mediaMime : "",
            mediaName: String(payload.mediaName || payload.media_name || "").trim().slice(0, 255),
            mediaSizeBytes: Number(payload.mediaSizeBytes || payload.media_size_bytes || 0) || 0
        };
    }

    function createMediaPreviewNode(messageInput) {
        const message = messageInput && typeof messageInput === "object" ? messageInput : {};
        const normalizedMedia = normalizeMediaDataUrl(
            message.mediaDataUrl || message.media_data_url || message.mediaUrl || "",
            message.mediaType || message.media_type || message.messageType || inferMediaTypeFromMime(message.mediaMime || message.media_mime || "")
        );
        if (!normalizedMedia) {
            return null;
        }

        const wrap = document.createElement("div");
        wrap.className = "chat-media-preview";

        if (normalizedMedia.mediaType === "image") {
            const image = document.createElement("img");
            image.src = normalizedMedia.mediaDataUrl;
            image.alt = String(message.mediaName || "Chat image attachment");
            image.loading = "lazy";
            wrap.appendChild(image);
            return wrap;
        }

        if (normalizedMedia.mediaType === "video") {
            const video = document.createElement("video");
            video.src = normalizedMedia.mediaDataUrl;
            video.controls = true;
            video.preload = "metadata";
            wrap.appendChild(video);
            return wrap;
        }

        if (normalizedMedia.mediaType === "audio") {
            const audio = document.createElement("audio");
            audio.src = normalizedMedia.mediaDataUrl;
            audio.controls = true;
            audio.preload = "metadata";
            wrap.appendChild(audio);
            return wrap;
        }

        return null;
    }

    function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            if (!file || typeof FileReader === "undefined") {
                reject(new Error("File reading is not supported on this browser."));
                return;
            }
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(new Error("Failed to read media file."));
            reader.readAsDataURL(file);
        });
    }

    if (chatClearBtn) {
        chatClearBtn.addEventListener("click", async () => {
            if (!chatState.selectedUser || (!chatState.selectedUser.id && !chatState.selectedUser.email)) {
                return;
            }
            if (!window.confirm("Delete this user's entire chat conversation?")) {
                return;
            }

            chatClearBtn.disabled = true;
            const originalText = chatClearBtn.textContent;
            chatClearBtn.textContent = "Deleting...";

            const result = await clearAdminChatThread(chatState.selectedUser);

            chatClearBtn.textContent = originalText;
            setChatMode(chatState.mode);

            if (result.mode === "ok") {
                const payload = result.payload || {};
                const thread = payload.thread || {};
                setChatMode(thread.mode);
                renderChatMessages([], true);
                chatState.latestMessageId = 0;
                if (chatInput) {
                    chatInput.value = "";
                }
                setChatStatus(payload.message || "Chat conversation deleted.", "success");
                return;
            }

            setChatStatus(getChatFailureMessage(result, "Unable to delete conversation."), "error");
        });
    }

    async function submitAdminMessage(payloadInput, optionsInput) {
        const options = optionsInput && typeof optionsInput === "object" ? optionsInput : {};
        if (
            !chatState.selectedUser
            || (!chatState.selectedUser.id && !chatState.selectedUser.email)
            || chatState.sending
        ) {
            return false;
        }

        chatState.sending = true;
        if (chatSendBtn) {
            chatSendBtn.disabled = true;
            chatSendBtn.textContent = "Sending...";
        }
        if (chatAttachBtn) {
            chatAttachBtn.disabled = true;
        }
        if (chatVoiceBtn) {
            chatVoiceBtn.disabled = true;
        }

        const result = await sendAdminChatMessage(chatState.selectedUser, payloadInput);

        chatState.sending = false;
        if (chatSendBtn) {
            chatSendBtn.disabled = false;
            chatSendBtn.textContent = "Send";
        }
        if (chatAttachBtn) {
            chatAttachBtn.disabled = false;
        }
        if (chatVoiceBtn) {
            chatVoiceBtn.disabled = false;
        }

        if (result.mode === "ok") {
            if (options.clearText !== false && chatInput) {
                chatInput.value = "";
                chatInput.focus();
            }
            if (options.successStatus) {
                setChatStatus(options.successStatus, "success");
            } else {
                setChatStatus("", "");
            }
            await loadChatThread(true);
            return true;
        }

        setChatStatus(getChatFailureMessage(result, "Unable to send message."), "error");
        return false;
    }

    if (chatForm) {
        chatForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (
                !chatState.selectedUser
                || (!chatState.selectedUser.id && !chatState.selectedUser.email)
                || chatState.sending
            ) {
                return;
            }

            const text = String(chatInput && chatInput.value ? chatInput.value : "").trim();
            if (!text) {
                return;
            }
            await submitAdminMessage({ text });
        });
    }

    async function sendAdminMediaFile(fileInput, preferredType) {
        const file = fileInput || null;
        if (!file || !chatState.selectedUser || (!chatState.selectedUser.id && !chatState.selectedUser.email)) {
            return;
        }
        const fileName = typeof file.name === "string" && file.name
            ? file.name
            : (String(preferredType || "").toLowerCase() === "audio" ? "voice-message.webm" : "chat-media");

        const mediaType = normalizeMediaType(preferredType, inferMediaTypeFromMime(file.type || ""));
        if (!mediaType) {
            setChatStatus("Unsupported file type. Only image, video, and audio are allowed.", "error");
            return;
        }
        try {
            setChatStatus("Preparing " + mediaType + " file...", "");
            const dataUrl = await readFileAsDataUrl(file);
            const payload = toOutgoingMediaPayload({
                text: fallbackTextForMedia(mediaType),
                mediaType: mediaType,
                mediaDataUrl: dataUrl,
                mediaName: fileName,
                mediaSizeBytes: file.size || 0
            });
            if (!payload) {
                setChatStatus("Unsupported media attachment.", "error");
                return;
            }
            await submitAdminMessage(payload, {
                clearText: false,
                successStatus: "Media message sent."
            });
        } catch (error) {
            setChatStatus(error && error.message ? error.message : "Unable to process media file.", "error");
        }
    }

    if (chatAttachBtn && chatMediaInput) {
        chatAttachBtn.addEventListener("click", () => {
            if (!chatState.selectedUser || !chatState.selectedUser.id || chatState.sending) {
                return;
            }
            chatMediaInput.value = "";
            chatMediaInput.click();
        });

        chatMediaInput.addEventListener("change", async () => {
            const selectedFile = chatMediaInput.files && chatMediaInput.files[0]
                ? chatMediaInput.files[0]
                : null;
            chatMediaInput.value = "";
            if (!selectedFile) {
                return;
            }
            await sendAdminMediaFile(selectedFile);
        });
    }

    async function startVoiceRecording() {
        if (!chatVoiceBtn || !chatState.selectedUser || !chatState.selectedUser.id || chatState.sending) {
            return;
        }
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function" || typeof MediaRecorder === "undefined") {
            setChatStatus("Voice recording is not supported on this browser.", "error");
            return;
        }

        try {
            setChatStatus("Requesting microphone permission...", "");
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recorderOptions = {};
            if (typeof MediaRecorder.isTypeSupported === "function") {
                const preferredMimeTypes = [
                    "audio/webm;codecs=opus",
                    "audio/webm",
                    "audio/ogg;codecs=opus",
                    "audio/ogg",
                    "audio/mp4"
                ];
                for (const mimeType of preferredMimeTypes) {
                    if (MediaRecorder.isTypeSupported(mimeType)) {
                        recorderOptions.mimeType = mimeType;
                        break;
                    }
                }
            }

            const recorder = new MediaRecorder(stream, recorderOptions);
            voiceState.recording = true;
            voiceState.mediaRecorder = recorder;
            voiceState.stream = stream;
            voiceState.chunks = [];

            recorder.addEventListener("dataavailable", (event) => {
                if (event && event.data && event.data.size > 0) {
                    voiceState.chunks.push(event.data);
                }
            });

            recorder.start();
            chatVoiceBtn.classList.add("recording");
            chatVoiceBtn.textContent = "Stop";
            setChatStatus("Recording voice note... click Stop to send.", "");
        } catch (error) {
            resetVoiceState();
            setChatStatus(error && error.message ? error.message : "Unable to access microphone.", "error");
        }
    }

    async function stopVoiceRecording() {
        if (!voiceState.recording || !voiceState.mediaRecorder) {
            return;
        }
        const recorder = voiceState.mediaRecorder;
        voiceState.recording = false;
        if (chatVoiceBtn) {
            chatVoiceBtn.classList.remove("recording");
            chatVoiceBtn.textContent = "Processing...";
        }

        await new Promise((resolve) => {
            recorder.addEventListener("stop", resolve, { once: true });
            try {
                recorder.stop();
            } catch (_error) {
                resolve();
            }
        });

        const chunks = voiceState.chunks.slice();
        const mimeType = String(recorder.mimeType || "audio/webm").trim() || "audio/webm";
        const blob = new Blob(chunks, { type: mimeType });
        resetVoiceState();

        if (!blob || !blob.size) {
            setChatStatus("Voice recording is empty. Try again.", "error");
            return;
        }

        await sendAdminMediaFile(blob, "audio");
    }

    if (chatVoiceBtn) {
        chatVoiceBtn.addEventListener("click", async () => {
            if (voiceState.recording) {
                await stopVoiceRecording();
                return;
            }
            await startVoiceRecording();
        });
    }

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && chatModal && chatModal.classList.contains("open")) {
            closeChatModal();
        }
    });

    document.addEventListener("visibilitychange", () => {
        if (!chatModal || !chatModal.classList.contains("open")) {
            return;
        }
        if (document.hidden) {
            stopChatPolling();
        } else {
            startChatPolling();
            void loadChatThread(false);
        }
    });

    setChatMode(CHAT_MODE_BOT);
    if (chatSendBtn) {
        chatSendBtn.disabled = true;
    }
    if (chatAttachBtn) {
        chatAttachBtn.disabled = true;
    }
    if (chatVoiceBtn) {
        chatVoiceBtn.disabled = true;
    }
    if (chatClearBtn) {
        chatClearBtn.disabled = true;
    }
    void loadUsers();
});
