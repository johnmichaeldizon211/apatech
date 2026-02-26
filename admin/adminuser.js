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
    const chatStatusEl = document.getElementById("admin-chat-status");
    const chatMessagesEl = document.getElementById("admin-chat-messages");
    const chatForm = document.getElementById("admin-chat-form");
    const chatInput = document.getElementById("admin-chat-input");
    const chatSendBtn = document.getElementById("admin-chat-send");

    const CHAT_MODE_BOT = "bot";
    const CHAT_MODE_ADMIN = "admin";
    const CHAT_POLL_MS = 2500;

    const chatState = {
        selectedUser: null,
        mode: CHAT_MODE_BOT,
        pollTimer: null,
        loading: false,
        sending: false,
        latestMessageId: 0
    };

    if (!window.EcodriveSession || typeof window.EcodriveSession.requireRole !== "function" || !window.EcodriveSession.requireRole("admin")) {
        return;
    }

    function getApiUrl(path) {
        return API_BASE ? `${API_BASE}${path}` : path;
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
    }

    function clearChatMessages() {
        if (chatMessagesEl) {
            chatMessagesEl.innerHTML = "";
        }
        chatState.latestMessageId = 0;
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

            const textEl = document.createElement("p");
            textEl.textContent = String((message && message.text) || "");
            wrapper.appendChild(textEl);

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
        if (chatSendBtn) {
            chatSendBtn.disabled = false;
            chatSendBtn.textContent = "Send";
        }

        void loadChatThread(true);
        startChatPolling();
    }

    function closeChatModal() {
        stopChatPolling();
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
    }

    async function fetchUsersFromApi() {
        try {
            const response = await fetch(getApiUrl("/api/admin/users"), { method: "GET" });

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
            const response = await fetch(
                getApiUrl(`/api/admin/users/${encodeURIComponent(user.id)}/${action}`),
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
            const response = await fetch(
                getApiUrl(`/api/admin/chat/users/${encodeURIComponent(userId)}?limit=250`),
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
            const response = await fetch(
                getApiUrl(`/api/admin/chat/users/${encodeURIComponent(userId)}/${endpointSuffix}`),
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

    async function sendAdminChatMessage(userId, messageText) {
        if (!userId) {
            return { mode: "error", message: "User id is missing." };
        }

        try {
            const response = await fetch(
                getApiUrl(`/api/admin/chat/users/${encodeURIComponent(userId)}/messages`),
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        message: messageText
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
            setChatStatus("Chat API is unavailable. Make sure the backend server is running.", "error");
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
                setChatStatus("Chat API unavailable. Start the backend server.", "error");
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
                setChatStatus("Chat API unavailable. Start the backend server.", "error");
            } else {
                setChatStatus(result.message || "Unable to release takeover.", "error");
            }
            setChatMode(chatState.mode);
        });
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

            chatState.sending = true;
            if (chatSendBtn) {
                chatSendBtn.disabled = true;
                chatSendBtn.textContent = "Sending...";
            }

            const result = await sendAdminChatMessage(chatState.selectedUser.id, text);

            chatState.sending = false;
            if (chatSendBtn) {
                chatSendBtn.disabled = false;
                chatSendBtn.textContent = "Send";
            }

            if (result.mode === "ok") {
                if (chatInput) {
                    chatInput.value = "";
                    chatInput.focus();
                }
                setChatStatus("", "");
                await loadChatThread(true);
                return;
            }

            if (result.mode === "unavailable") {
                setChatStatus("Chat API unavailable. Start the backend server.", "error");
            } else {
                setChatStatus(result.message || "Unable to send message.", "error");
            }
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
    void loadUsers();
});
