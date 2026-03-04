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
    const CHAT_POLL_MS = 2500;
    const CHAT_MAX_MEDIA_BYTES = Number.POSITIVE_INFINITY;
    const CHAT_MAX_MEDIA_DATA_URL_LENGTH = Number.POSITIVE_INFINITY;

    const chatState = {
        selectedUser: null,
        mode: CHAT_MODE_BOT,
        pollTimer: null,
        loading: false,
        sending: false,
        latestMessageId: 0
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

    function getApiUrl(path) {
        const normalizedPath = normalizeApiPath(path);
        return API_BASE ? `${API_BASE}${normalizedPath}` : normalizedPath;
    }

    function buildApiFetchCandidates(path) {
        const normalizedPath = normalizeApiPath(path);
        const primaryUrl = getApiUrl(normalizedPath);
        const candidates = [primaryUrl];

        if (API_BASE && primaryUrl !== normalizedPath) {
            let shouldAppendSameOrigin = true;
            try {
                const apiOrigin = String(new URL(API_BASE).origin || "").trim().toLowerCase();
                const currentOrigin = window.location && window.location.origin
                    ? String(window.location.origin).trim().toLowerCase()
                    : "";
                if (apiOrigin && currentOrigin && apiOrigin === currentOrigin) {
                    shouldAppendSameOrigin = false;
                }
            } catch (_error) {
                // keep same-origin candidate as fallback
            }

            if (shouldAppendSameOrigin) {
                candidates.push(normalizedPath);
            }
        }

        return candidates.filter((entry, index, source) => entry && source.indexOf(entry) === index);
    }

    async function fetchWithApiFallback(path, options) {
        const candidates = buildApiFetchCandidates(path);
        let lastError = null;
        for (let i = 0; i < candidates.length; i += 1) {
            try {
                return await fetch(candidates[i], options);
            } catch (error) {
                lastError = error;
            }
        }
        throw (lastError || new Error("Network request failed."));
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
        chatStatusEl.textContent = String(message || "");
        chatStatusEl.classList.remove("error", "success");
        if (tone === "error" || tone === "success") {
            chatStatusEl.classList.add(tone);
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
            chatTakeoverBtn.disabled = mode === CHAT_MODE_ADMIN || !chatState.selectedUser;
        }
        if (chatReleaseBtn) {
            chatReleaseBtn.disabled = mode !== CHAT_MODE_ADMIN || !chatState.selectedUser;
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
            clearInterval(chatState.pollTimer);
            chatState.pollTimer = null;
        }
    }

    function startChatPolling() {
        stopChatPolling();
        chatState.pollTimer = setInterval(() => {
            void loadChatThread(false);
        }, CHAT_POLL_MS);
    }

    function openChatModal(user) {
        chatState.selectedUser = user;
        setChatStatus("", "");
        clearChatMessages();
        setChatMode(CHAT_MODE_BOT);

        if (chatUserLabel) {
            const name = String(user && user.name ? user.name : "N/A");
            const email = String(user && user.email ? user.email : "N/A");
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

    async function fetchAdminChatThread(userId) {
        if (!userId) {
            return { mode: "error", message: "User id is missing." };
        }

        try {
            const response = await fetchWithApiFallback(
                `/api/admin/chat/users/${encodeURIComponent(userId)}?limit=250`,
                { method: "GET" }
            );

            if (response.status === 404 || response.status === 405) {
                return { mode: "unavailable" };
            }

            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload.success !== true) {
                return {
                    mode: "error",
                    message: payload.message || "Unable to load user chat."
                };
            }

            return {
                mode: "ok",
                payload: payload
            };
        } catch (_error) {
            return { mode: "unavailable" };
        }
    }

    async function postAdminChatAction(userId, endpointSuffix, body) {
        if (!userId) {
            return { mode: "error", message: "User id is missing." };
        }

        try {
            const response = await fetchWithApiFallback(
                `/api/admin/chat/users/${encodeURIComponent(userId)}/${endpointSuffix}`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(body || {})
                }
            );

            if (response.status === 404 || response.status === 405) {
                return { mode: "unavailable" };
            }

            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload.success !== true) {
                return {
                    mode: "error",
                    message: payload.message || "Unable to complete chat action."
                };
            }

            return {
                mode: "ok",
                payload: payload
            };
        } catch (_error) {
            return { mode: "unavailable" };
        }
    }

    async function clearAdminChatThread(userEmail) {
        const email = String(userEmail || "").trim().toLowerCase();
        if (!email) {
            return { mode: "error", message: "User email is missing." };
        }

        try {
            const response = await fetchWithApiFallback(
                "/api/chat/thread/clear",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        email: email
                    })
                }
            );

            if (response.status === 404 || response.status === 405) {
                return { mode: "unavailable" };
            }

            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload.success !== true) {
                return {
                    mode: "error",
                    message: payload.message || "Unable to clear chat conversation."
                };
            }

            return {
                mode: "ok",
                payload: payload
            };
        } catch (_error) {
            return { mode: "unavailable" };
        }
    }

    async function sendAdminChatMessage(userId, payloadInput) {
        if (!userId) {
            return { mode: "error", message: "User id is missing." };
        }
        const payload = toOutgoingMediaPayload(payloadInput || {});
        if (!payload) {
            return { mode: "error", message: "Message text or media is required." };
        }

        try {
            const response = await fetchWithApiFallback(
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
                }
            );

            if (response.status === 404 || response.status === 405) {
                return { mode: "unavailable" };
            }

            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload.success !== true) {
                return {
                    mode: "error",
                    message: payload.message || "Unable to send admin message."
                };
            }

            return {
                mode: "ok",
                payload: payload
            };
        } catch (_error) {
            return { mode: "unavailable" };
        }
    }

    async function loadChatThread(forceScroll) {
        if (!chatState.selectedUser || !chatState.selectedUser.id || chatState.loading) {
            return;
        }

        const requestUserId = Number(chatState.selectedUser.id || 0);
        chatState.loading = true;
        const previousLatestId = chatState.latestMessageId;
        const result = await fetchAdminChatThread(requestUserId);
        chatState.loading = false;

        if (!chatState.selectedUser || Number(chatState.selectedUser.id || 0) !== requestUserId) {
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
            return;
        }

        if (result.mode === "unavailable") {
            setChatStatus("Chat API unavailable. Refresh this page or clear old API base cache.", "error");
            return;
        }
        setChatStatus(result.message || "Unable to load chat thread.", "error");
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
            } else if (result.mode === "unavailable") {
                setChatStatus("Chat API unavailable. Refresh this page or clear old API base cache.", "error");
            } else {
                setChatStatus(result.message || "Unable to start takeover.", "error");
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
            } else if (result.mode === "unavailable") {
                setChatStatus("Chat API unavailable. Refresh this page or clear old API base cache.", "error");
            } else {
                setChatStatus(result.message || "Unable to release takeover.", "error");
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
            if (!chatState.selectedUser || !chatState.selectedUser.email) {
                return;
            }
            if (!window.confirm("Delete this user's entire chat conversation?")) {
                return;
            }

            chatClearBtn.disabled = true;
            const originalText = chatClearBtn.textContent;
            chatClearBtn.textContent = "Deleting...";

            const result = await clearAdminChatThread(chatState.selectedUser.email);

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

            if (result.mode === "unavailable") {
                setChatStatus("Chat API unavailable. Refresh this page or clear old API base cache.", "error");
            } else {
                setChatStatus(result.message || "Unable to delete conversation.", "error");
            }
        });
    }

    async function submitAdminMessage(payloadInput, optionsInput) {
        const options = optionsInput && typeof optionsInput === "object" ? optionsInput : {};
        if (!chatState.selectedUser || !chatState.selectedUser.id || chatState.sending) {
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

        const result = await sendAdminChatMessage(chatState.selectedUser.id, payloadInput);

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

        if (result.mode === "unavailable") {
            setChatStatus("Chat API unavailable. Refresh this page or clear old API base cache.", "error");
        } else {
            setChatStatus(result.message || "Unable to send message.", "error");
        }
        return false;
    }

    if (chatForm) {
        chatForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (!chatState.selectedUser || !chatState.selectedUser.id || chatState.sending) {
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
        if (!file || !chatState.selectedUser || !chatState.selectedUser.id) {
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
