(function (global) {
    "use strict";

    var TOKEN_KEY = "ecodrive_auth_token";
    var USER_KEY = "ecodrive_auth_user";
    var EXPIRES_AT_KEY = "ecodrive_auth_expires_at";
    var CURRENT_USER_KEY = "ecodrive_current_user_email";
    var API_BASE_KEY = "ecodrive_api_base";
    var LEGACY_API_BASE_KEY = "ecodrive_kyc_api_base";
    var DEFAULT_LOCAL_API_BASE = "http://127.0.0.1:5050";
    var DEFAULT_RENDER_API_BASE = "https://apatech.onrender.com";
    var DEFAULT_REMOTE_API_BASE = DEFAULT_RENDER_API_BASE;
    var DEFAULT_API_BASE = detectDefaultApiBase();
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
        return host === "apatech-production.up.railway.app";
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

        if (isDeprecatedApiBase(storedBase)) {
            return true;
        }

        // When frontend is opened from local static server, prefer deployed API host.
        if (isLocalHost(currentHost)) {
            return isLocalApiBase(storedBase);
        }

        if (isLocalHost(storedHost)) {
            return true;
        }

        // When frontend is hosted on Render, default to same-origin API host.
        if (/\.onrender\.com$/i.test(currentHost) && storedHost !== currentHost) {
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

            return originalFetch(input, requestInit).then(function (response) {
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

    ensureApiBaseConfig();
    ensurePageAccess();

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
