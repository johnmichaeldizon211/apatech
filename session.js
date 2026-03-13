(function (global) {
    "use strict";

    var TOKEN_KEY = "ecodrive_auth_token";
    var USER_KEY = "ecodrive_auth_user";
    var EXPIRES_AT_KEY = "ecodrive_auth_expires_at";
    var CURRENT_USER_KEY = "ecodrive_current_user_email";
    var API_BASE_KEY = "ecodrive_api_base";
    var LEGACY_API_BASE_KEY = "ecodrive_kyc_api_base";
    var DEFAULT_LOCAL_API_BASE = "http://127.0.0.1:5050";
    var DEFAULT_VERCEL_API_BASE = "https://apatech.vercel.app";
    var DEFAULT_REMOTE_API_BASE = "https://apatech-production.up.railway.app";
    var EXTERNAL_API_FRONTEND_HOSTS = {
        "ecodrivebookingplatform.shop": true,
        "www.ecodrivebookingplatform.shop": true
    };
    var DEFAULT_API_BASE = detectDefaultApiBase();
    var USER_CHAT_WIDGET_SRC = "/Userhomefolder/chatbot-widget.js?v=20260304c";
    var USER_CART_STYLE_HREF = "/Userhomefolder/cart.css?v=20260310d";
    var USER_CART_SCRIPT_SRC = "/Userhomefolder/cart.js?v=20260310b";
    var PROFILE_STORAGE_PREFIX = "ecodrive_profile_settings::";
    var LEGACY_PROFILE_STORAGE_KEY = "ecodrive_profile_settings";
    var USERS_STORAGE_KEY = "users";
    var originalFetch = typeof global.fetch === "function" ? global.fetch.bind(global) : null;

    function trimSlashes(value) {
        return String(value || "").trim().replace(/\/+$/, "");
    }

    function isLocalHost(hostname) {
        var host = String(hostname || "").trim().toLowerCase();
        return (
            host === "localhost" ||
            host === "127.0.0.1" ||
            host === "0.0.0.0" ||
            host.endsWith(".local")
        );
    }

    function getCurrentOrigin() {
        if (!global.location || !global.location.origin) {
            return "";
        }
        return trimSlashes(global.location.origin);
    }

    function getAppBasePath() {
        if (!global.location) {
            return "";
        }
        var pathname = String(global.location.pathname || "").replace(/\\/g, "/");
        var lower = pathname.toLowerCase();
        var userhomeIndex = lower.lastIndexOf("/userhomefolder/");
        if (userhomeIndex > 0) {
            return pathname.slice(0, userhomeIndex);
        }
        var settingsIndex = lower.lastIndexOf("/usersetting.html/");
        if (settingsIndex > 0) {
            return pathname.slice(0, settingsIndex);
        }
        return "";
    }

    function resolveUserAppAssetPath(pathInput) {
        var raw = String(pathInput || "").trim();
        if (!raw) {
            return "";
        }
        if (/^(?:https?:)?\/\//i.test(raw) || /^data:/i.test(raw) || /^blob:/i.test(raw)) {
            return raw;
        }

        var normalized = raw.replace(/\\/g, "/");
        if (!normalized.startsWith("/")) {
            normalized = "/" + normalized;
        }

        var appBase = getAppBasePath();
        if (!appBase) {
            return normalized;
        }

        if (normalized.toLowerCase().indexOf(appBase.toLowerCase() + "/") === 0) {
            return normalized;
        }
        return appBase + normalized;
    }

    function isExternalApiFrontendHost(hostnameInput) {
        var host = String(hostnameInput || "").trim().toLowerCase();
        return EXTERNAL_API_FRONTEND_HOSTS[host] === true;
    }

    function getHostFromApiBase(baseInput) {
        var base = trimSlashes(baseInput);
        if (!base) {
            return "";
        }
        try {
            return String(new URL(base).hostname || "").trim().toLowerCase();
        } catch (_error) {
            var match = base.match(/^https?:\/\/([^/:?#]+)/i);
            return match && match[1] ? String(match[1]).trim().toLowerCase() : "";
        }
    }

    function isDeprecatedApiBase(baseInput) {
        var host = getHostFromApiBase(baseInput);
        return (
            host === "apatech-production.up.railway.app" ||
            host === "apatech.onrender.com"
        );
    }

    function isSameOriginApiBase(baseInput) {
        var base = trimSlashes(baseInput);
        var currentOrigin = getCurrentOrigin();
        if (!base || !currentOrigin) {
            return false;
        }
        try {
            return trimSlashes(new URL(base).origin) === currentOrigin;
        } catch (_error) {
            return false;
        }
    }

    function isLegacyLocalFrontendApiBase(baseInput) {
        var base = trimSlashes(baseInput);
        if (!base) {
            return false;
        }
        return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0):5500$/i.test(base);
    }

    function shouldPreferCurrentOriginBase(storedBaseInput) {
        var storedBase = trimSlashes(storedBaseInput);
        if (!storedBase || !global.location) {
            return false;
        }

        var currentHost = String(global.location.hostname || "").trim().toLowerCase();
        var storedHost = getHostFromApiBase(storedBase);
        if (!storedHost) {
            return false;
        }

        if (isExternalApiFrontendHost(currentHost)) {
            var preferredHost = getHostFromApiBase(DEFAULT_REMOTE_API_BASE);
            if (preferredHost && storedHost !== preferredHost) {
                return true;
            }
        }

        if (isDeprecatedApiBase(storedBase)) {
            return true;
        }

        // On localhost, prefer local API and avoid sticky remote fallback base.
        if (isLocalHost(currentHost)) {
            if (!isLocalHost(storedHost)) {
                return true;
            }
            return isSameOriginApiBase(storedBase) || isLegacyLocalFrontendApiBase(storedBase);
        }

        if (isLocalHost(storedHost)) {
            return true;
        }

        // When frontend is hosted on Render, default to same-origin API host.
        if (/\.onrender\.com$/i.test(currentHost) && storedHost !== currentHost) {
            return true;
        }

        // For Vercel preview/prod deployments, avoid sticky API base from another deployment host.
        if (/\.vercel\.app$/i.test(currentHost) && storedHost !== currentHost) {
            return true;
        }

        return false;
    }

    function isLocalApiBase(baseInput) {
        var base = trimSlashes(baseInput);
        if (!base) {
            return false;
        }
        try {
            var parsed = new URL(base);
            return isLocalHost(parsed.hostname);
        } catch (_error) {
            return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i.test(base);
        }
    }

    function detectDefaultApiBase() {
        var fromWindow = trimSlashes(global.ECODRIVE_API_BASE || global.__ECODRIVE_API_BASE || "");
        if (fromWindow) {
            return fromWindow;
        }
        if (global.location && isLocalHost(global.location.hostname)) {
            return DEFAULT_LOCAL_API_BASE;
        }
        if (
            global.location
            && isExternalApiFrontendHost(global.location.hostname)
        ) {
            return DEFAULT_REMOTE_API_BASE;
        }
        return getCurrentOrigin() || DEFAULT_REMOTE_API_BASE;
    }

    function normalizeConfiguredApiBase(baseInput) {
        var base = trimSlashes(baseInput);
        if (!base) {
            return "";
        }

        if (shouldPreferCurrentOriginBase(base)) {
            return DEFAULT_API_BASE;
        }

        return base;
    }

    function getStorageValue(key) {
        var sessionValue = sessionStorage.getItem(key);
        if (sessionValue !== null && sessionValue !== undefined) {
            return String(sessionValue);
        }
        var localValue = localStorage.getItem(key);
        if (localValue !== null && localValue !== undefined) {
            return String(localValue);
        }
        return "";
    }

    function setStorageValue(key, value, remember) {
        var target = remember ? localStorage : sessionStorage;
        var other = remember ? sessionStorage : localStorage;
        target.setItem(key, value);
        other.removeItem(key);
    }

    function removeStorageValue(key) {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
    }

    function readUser() {
        var raw = getStorageValue(USER_KEY);
        if (!raw) {
            return null;
        }
        try {
            var parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? parsed : null;
        } catch (_error) {
            return null;
        }
    }

    function safeParseObject(raw) {
        if (!raw) {
            return null;
        }
        try {
            var parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? parsed : null;
        } catch (_error) {
            return null;
        }
    }

    function normalizeAvatarValue(value) {
        return String(value || "").trim();
    }

    function readProfileByEmail(emailInput) {
        var email = String(emailInput || "").trim().toLowerCase();
        if (email) {
            var scoped = safeParseObject(localStorage.getItem(PROFILE_STORAGE_PREFIX + email));
            if (scoped) {
                return scoped;
            }
        }
        return safeParseObject(localStorage.getItem(LEGACY_PROFILE_STORAGE_KEY));
    }

    function readUsersList() {
        var parsed = safeParseObject(localStorage.getItem(USERS_STORAGE_KEY));
        return Array.isArray(parsed) ? parsed : [];
    }

    function getAvatarFromUsers(emailInput) {
        var email = String(emailInput || "").trim().toLowerCase();
        if (!email) {
            return "";
        }
        var users = readUsersList();
        for (var i = 0; i < users.length; i += 1) {
            var user = users[i];
            if (!user || typeof user !== "object") {
                continue;
            }
            var candidateEmail = String(user.email || "").trim().toLowerCase();
            if (candidateEmail === email) {
                return normalizeAvatarValue(user.avatar);
            }
        }
        return "";
    }

    function isExpired() {
        var raw = getStorageValue(EXPIRES_AT_KEY);
        if (!raw) {
            return false;
        }
        var expiresAt = Number(raw);
        if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
            return false;
        }
        return Date.now() >= expiresAt;
    }

    function clearSession() {
        removeStorageValue(TOKEN_KEY);
        removeStorageValue(USER_KEY);
        removeStorageValue(EXPIRES_AT_KEY);
        removeStorageValue(CURRENT_USER_KEY);
    }

    function getToken() {
        if (isExpired()) {
            clearSession();
            return "";
        }
        return getStorageValue(TOKEN_KEY);
    }

    function getCurrentUser() {
        if (isExpired()) {
            clearSession();
            return null;
        }
        return readUser();
    }

    function getCurrentEmail() {
        var user = getCurrentUser();
        if (user && user.email) {
            return String(user.email).trim().toLowerCase();
        }
        var legacy = getStorageValue(CURRENT_USER_KEY);
        return String(legacy || "").trim().toLowerCase();
    }

    function getStoredAvatarUrl() {
        var email = getCurrentEmail();
        var profile = readProfileByEmail(email);
        var avatar = normalizeAvatarValue(profile && profile.avatar);
        if (avatar) {
            return avatar;
        }

        var user = getCurrentUser();
        avatar = normalizeAvatarValue(user && user.avatar);
        if (avatar) {
            return avatar;
        }

        return getAvatarFromUsers(email);
    }

    function applyUserAvatarToPage(avatarInput) {
        if (!global.document || !global.location) {
            return;
        }
        var path = String(global.location.pathname || "").toLowerCase();
        if (!isUserAppPage(path) || path.indexOf("/admin/") !== -1) {
            return;
        }

        var avatar = normalizeAvatarValue(avatarInput);
        var nodes = global.document.querySelectorAll(".profile-menu .profile-btn img");
        if (!nodes || !nodes.length) {
            return;
        }

        for (var i = 0; i < nodes.length; i += 1) {
            var image = nodes[i];
            if (!image.dataset.ecodriveDefaultSrc) {
                image.dataset.ecodriveDefaultSrc = image.getAttribute("src") || "";
            }
            if (avatar) {
                image.src = avatar;
            } else if (image.dataset.ecodriveDefaultSrc) {
                image.src = image.dataset.ecodriveDefaultSrc;
            }
        }
    }

    function syncUserAvatarFromStorage() {
        applyUserAvatarToPage(getStoredAvatarUrl());
    }

    function getApiBase() {
        var base = normalizeConfiguredApiBase(getStorageValue(API_BASE_KEY));
        if (base) {
            return base;
        }
        base = normalizeConfiguredApiBase(getStorageValue(LEGACY_API_BASE_KEY));
        if (base) {
            return base;
        }
        return DEFAULT_API_BASE;
    }

    function setApiBase(baseInput, remember) {
        var base = trimSlashes(baseInput);
        if (!base) {
            return "";
        }
        setStorageValue(API_BASE_KEY, base, remember !== false);
        setStorageValue(LEGACY_API_BASE_KEY, base, remember !== false);
        return base;
    }

    function ensureApiBaseConfig() {
        try {
            var storedBase = trimSlashes(getStorageValue(API_BASE_KEY) || getStorageValue(LEGACY_API_BASE_KEY));
            var preferredBase = trimSlashes(DEFAULT_API_BASE);
            if (!preferredBase) {
                return "";
            }

            var shouldUsePreferredBase = (
                !storedBase ||
                shouldPreferCurrentOriginBase(storedBase)
            );
            var baseToUse = shouldUsePreferredBase ? preferredBase : storedBase;

            localStorage.setItem(API_BASE_KEY, baseToUse);
            localStorage.setItem(LEGACY_API_BASE_KEY, baseToUse);
            sessionStorage.removeItem(API_BASE_KEY);
            sessionStorage.removeItem(LEGACY_API_BASE_KEY);
            return baseToUse;
        } catch (_error) {
            return trimSlashes(DEFAULT_API_BASE);
        }
    }

    function getApiUrl(path) {
        var normalizedPath = String(path || "");
        if (/^https?:\/\//i.test(normalizedPath)) {
            return normalizedPath;
        }
        if (!normalizedPath.startsWith("/")) {
            normalizedPath = "/" + normalizedPath;
        }
        return getApiBase() + normalizedPath;
    }

    function setSession(payload, remember) {
        var source = payload && typeof payload === "object" ? payload : {};
        var token = String(source.token || "").trim();
        var user = source.user && typeof source.user === "object" ? source.user : {};
        var userEmail = String(user.email || "").trim().toLowerCase();
        var expiresAt = Number(source.expiresAt || 0);
        var expiresInMs = Number(source.expiresInMs || 0);

        if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
            expiresAt = Date.now() + (Number.isFinite(expiresInMs) && expiresInMs > 0 ? expiresInMs : 24 * 60 * 60 * 1000);
        }

        if (!token || !userEmail) {
            clearSession();
            return false;
        }

        setStorageValue(TOKEN_KEY, token, Boolean(remember));
        setStorageValue(USER_KEY, JSON.stringify(user), Boolean(remember));
        setStorageValue(EXPIRES_AT_KEY, String(expiresAt), Boolean(remember));
        setStorageValue(CURRENT_USER_KEY, userEmail, Boolean(remember));
        syncUserAvatarFromStorage();
        return true;
    }

    function isApiRequest(input) {
        var url = "";
        if (typeof input === "string") {
            url = input;
        } else if (input && typeof input.url === "string") {
            url = input.url;
        }

        if (!url) {
            return false;
        }
        if (url.startsWith("/api/")) {
            return true;
        }

        var base = getApiBase();
        if (!base) {
            return false;
        }
        return url.startsWith(base + "/api/");
    }

    function getRequestUrl(input) {
        if (typeof input === "string") {
            return input;
        }
        if (input && typeof input.url === "string") {
            return input.url;
        }
        return "";
    }

    function buildRemoteFallbackUrl(input) {
        var remoteBase = trimSlashes(DEFAULT_REMOTE_API_BASE);
        if (!remoteBase) {
            return "";
        }

        var requestUrl = getRequestUrl(input);
        if (!requestUrl) {
            return "";
        }

        if (requestUrl.startsWith("/api/")) {
            return remoteBase + requestUrl;
        }

        var apiBase = trimSlashes(getApiBase());
        if (apiBase && requestUrl.startsWith(apiBase + "/api/")) {
            return remoteBase + requestUrl.slice(apiBase.length);
        }

        var absoluteUrl = "";
        try {
            absoluteUrl = String(new URL(requestUrl, global.location && global.location.href ? global.location.href : remoteBase));
        } catch (_error) {
            return "";
        }

        try {
            var parsed = new URL(absoluteUrl);
            if (isLocalHost(parsed.hostname) && parsed.pathname.indexOf("/api/") === 0) {
                return remoteBase + parsed.pathname + parsed.search;
            }
        } catch (_error) {
            return "";
        }

        return "";
    }

    function shouldAttemptRemoteFallback(input) {
        if (typeof input !== "string") {
            return false;
        }
        if (!isLocalApiBase(getApiBase())) {
            return false;
        }
        var requestUrl = getRequestUrl(input);
        if (/\/api\/(login|signup|request-password-otp|verify-password-otp|reset-password)(?:\?|$)/i.test(requestUrl)) {
            return false;
        }
        return Boolean(buildRemoteFallbackUrl(input));
    }

    function isLikelyNetworkError(error) {
        if (!error) {
            return false;
        }
        var message = String(error && error.message || "").toLowerCase();
        var name = String(error && error.name || "").toLowerCase();
        return (
            name === "typeerror"
            || message.indexOf("failed to fetch") !== -1
            || message.indexOf("networkerror") !== -1
            || message.indexOf("network request failed") !== -1
            || message.indexOf("load failed") !== -1
        );
    }

    function shouldBePublicPage(pathname) {
        var path = String(pathname || "").toLowerCase();
        return (
            path.endsWith("/log%20in.html") ||
            path.endsWith("/log in.html") ||
            path.endsWith("/signup.html") ||
            path.endsWith("/forgot.html") ||
            path.endsWith("/frontpage.html") ||
            path.endsWith("/")
        );
    }

    function isUserAppPage(pathname) {
        var path = String(pathname || "").toLowerCase();
        return path.indexOf("/userhomefolder/") !== -1 || path.indexOf("/usersetting.html/") !== -1;
    }

    function ensureUserChatWidget() {
        if (!global.document || !global.location) {
            return;
        }

        var path = String(global.location.pathname || "").toLowerCase();
        if (!isUserAppPage(path) || path.indexOf("/admin/") !== -1) {
            return;
        }

        if (global.document.querySelector("script[data-ecodrive-user-chat-widget='1']")) {
            return;
        }

        var script = global.document.createElement("script");
        script.src = resolveUserAppAssetPath(USER_CHAT_WIDGET_SRC);
        script.async = true;
        script.setAttribute("data-ecodrive-user-chat-widget", "1");
        global.document.head.appendChild(script);
    }

    function ensureUserCartAssets() {
        if (!global.document || !global.location) {
            return;
        }

        var path = String(global.location.pathname || "").toLowerCase();
        if (!isUserAppPage(path) || path.indexOf("/admin/") !== -1) {
            return;
        }

        if (!global.document.querySelector("link[data-ecodrive-user-cart-style='1']")) {
            var link = global.document.createElement("link");
            link.rel = "stylesheet";
            link.href = resolveUserAppAssetPath(USER_CART_STYLE_HREF);
            link.setAttribute("data-ecodrive-user-cart-style", "1");
            global.document.head.appendChild(link);
        }

        if (!global.document.querySelector("script[data-ecodrive-user-cart-script='1']")) {
            var script = global.document.createElement("script");
            script.src = resolveUserAppAssetPath(USER_CART_SCRIPT_SRC);
            script.async = false;
            script.setAttribute("data-ecodrive-user-cart-script", "1");
            global.document.head.appendChild(script);
        }
    }

    function redirectToLogin() {
        if (!global.location) {
            return;
        }
        var path = String(global.location.pathname || "").toLowerCase();
        if (shouldBePublicPage(path)) {
            return;
        }
        global.location.href = "/log in.html";
    }

    function requireRole(role) {
        var user = getCurrentUser();
        var token = getToken();
        if (!user || !token) {
            clearSession();
            redirectToLogin();
            return false;
        }

        var normalizedRole = String(role || "").trim().toLowerCase();
        var currentRole = String(user.role || "").trim().toLowerCase();
        if (normalizedRole === "admin" && currentRole !== "admin") {
            redirectToLogin();
            return false;
        }
        if (normalizedRole === "user" && currentRole !== "user" && currentRole !== "admin") {
            redirectToLogin();
            return false;
        }
        return true;
    }

    function isAdmin() {
        var user = getCurrentUser();
        return user && String(user.role || "").trim().toLowerCase() === "admin";
    }

    function logout(redirectTo) {
        clearSession();
        if (global.location) {
            global.location.href = redirectTo || "/log in.html";
        }
    }

    function ensurePageAccess() {
        if (!global.location) {
            return;
        }
        var path = String(global.location.pathname || "").toLowerCase();
        if (!path.endsWith(".html")) {
            return;
        }
        if (path.indexOf("/admin/") !== -1) {
            requireRole("admin");
            return;
        }
        if (path.indexOf("/userhomefolder/") !== -1 || path.indexOf("/usersetting.html/") !== -1) {
            requireRole("user");
        }
    }

    if (originalFetch) {
        global.fetch = function (input, init) {
            if (!isApiRequest(input)) {
                return originalFetch(input, init);
            }

            var token = getToken();
            var requestInit = init ? Object.assign({}, init) : {};
            var incomingHeaders = requestInit.headers;
            if (!incomingHeaders && typeof Request !== "undefined" && input instanceof Request) {
                incomingHeaders = input.headers;
            }
            var headers = new Headers(incomingHeaders || {});
            if (token && !headers.has("Authorization")) {
                headers.set("Authorization", "Bearer " + token);
            }
            requestInit.headers = headers;
            var fallbackUrl = shouldAttemptRemoteFallback(input) ? buildRemoteFallbackUrl(input) : "";

            return originalFetch(input, requestInit)
                .catch(function (error) {
                    if (!fallbackUrl || !isLikelyNetworkError(error)) {
                        throw error;
                    }
                    return originalFetch(fallbackUrl, requestInit);
                })
                .then(function (response) {
                    if (response.status === 401 && !shouldBePublicPage(global.location && global.location.pathname)) {
                        clearSession();
                    }
                    return response;
                });
        };
    }

    document.addEventListener("click", function (event) {
        var trigger = event.target.closest("#logoutBtn, #topLogoutLink, .logout-btn, a[href*='log%20in.html'], a[href*='log in.html']");
        if (!trigger) {
            return;
        }
        clearSession();
    });

    global.addEventListener("storage", function (event) {
        var key = event && typeof event.key === "string" ? event.key : "";
        if (
            key === CURRENT_USER_KEY
            || key === USER_KEY
            || key === USERS_STORAGE_KEY
            || key === LEGACY_PROFILE_STORAGE_KEY
            || key.indexOf(PROFILE_STORAGE_PREFIX) === 0
        ) {
            syncUserAvatarFromStorage();
        }
    });

    global.addEventListener("ecodrive:profile-updated", function (event) {
        var detail = event && event.detail && typeof event.detail === "object"
            ? event.detail
            : {};
        if (Object.prototype.hasOwnProperty.call(detail, "avatar")) {
            applyUserAvatarToPage(detail.avatar);
            return;
        }
        syncUserAvatarFromStorage();
    });

    if (global.document.readyState === "loading") {
        global.document.addEventListener("DOMContentLoaded", syncUserAvatarFromStorage);
    } else {
        syncUserAvatarFromStorage();
    }

    ensureApiBaseConfig();
    ensurePageAccess();
    ensureUserCartAssets();
    ensureUserChatWidget();

    global.EcodriveSession = {
        setSession: setSession,
        clearSession: clearSession,
        getToken: getToken,
        getCurrentUser: getCurrentUser,
        getCurrentEmail: getCurrentEmail,
        getApiBase: getApiBase,
        setApiBase: setApiBase,
        getApiUrl: getApiUrl,
        requireRole: requireRole,
        isAdmin: isAdmin,
        logout: logout
    };
})(window);
