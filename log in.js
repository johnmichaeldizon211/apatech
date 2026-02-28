document.addEventListener("DOMContentLoaded", function () {
    var form = document.getElementById("loginForm");
    var loginIdInput = document.getElementById("email");
    var passwordInput = document.getElementById("password");
    var rememberInput = document.getElementById("remember");
    var loginError = document.getElementById("loginError");

    if (!form || !loginIdInput || !passwordInput) {
        return;
    }

    function normalizeLoginIdentifier(value) {
        return String(value || "")
            .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, "")
            .trim()
            .toLowerCase();
    }

    function getApiUrl(path) {
        if (window.EcodriveSession && typeof window.EcodriveSession.getApiUrl === "function") {
            return window.EcodriveSession.getApiUrl(path);
        }
        var base = String(
            localStorage.getItem("ecodrive_api_base") ||
            localStorage.getItem("ecodrive_kyc_api_base") ||
            (window.EcodriveSession && typeof window.EcodriveSession.getApiBase === "function"
                ? window.EcodriveSession.getApiBase()
                : "")
        )
            .trim()
            .replace(/\/+$/, "");
        return base ? base + path : path;
    }

    function getActiveApiBase() {
        if (window.EcodriveSession && typeof window.EcodriveSession.getApiBase === "function") {
            return String(window.EcodriveSession.getApiBase() || "").trim().replace(/\/+$/, "");
        }
        return String(
            localStorage.getItem("ecodrive_api_base")
            || localStorage.getItem("ecodrive_kyc_api_base")
            || ""
        ).trim().replace(/\/+$/, "");
    }

    function setError(message) {
        if (loginError) {
            loginError.textContent = String(message || "");
            return;
        }
        alert(String(message || "Login failed."));
    }

    function clearError() {
        if (loginError) {
            loginError.textContent = "";
        }
    }

    form.addEventListener("submit", async function (event) {
        event.preventDefault();
        clearError();

        var loginIdValue = normalizeLoginIdentifier(loginIdInput.value);
        var passwordValue = String(passwordInput.value || "").trim();
        var remember = rememberInput ? Boolean(rememberInput.checked) : false;

        if (!loginIdValue || !passwordValue) {
            setError("Please enter both email/username and password.");
            return;
        }

        var response;
        try {
            response = await fetch(getApiUrl("/api/login"), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    email: loginIdValue,
                    username: loginIdValue,
                    password: passwordValue
                })
            });
        } catch (_error) {
            setError("API is unavailable. Please check your API service connection.");
            return;
        }

        var payload = await response.json().catch(function () {
            return {};
        });
        if (!response.ok || payload.success !== true) {
            var backendMessage = String(payload.message || "").trim();
            if (/admin credentials are not initialized/i.test(backendMessage)) {
                var activeApiBase = getActiveApiBase() || "(relative /api)";
                setError(
                    backendMessage
                    + " Active API base: "
                    + activeApiBase
                    + ". Configure admin credentials on that API server."
                );
                return;
            }
            setError(backendMessage || "Invalid email/username or password.");
            return;
        }

        var user = payload.user && typeof payload.user === "object" ? payload.user : {};
        var token = String(payload.token || "").trim();
        var expiresAt = payload.expiresAt ? new Date(payload.expiresAt).getTime() : 0;

        if (!window.EcodriveSession || typeof window.EcodriveSession.setSession !== "function") {
            setError("Session layer failed to load. Refresh and try again.");
            return;
        }

        var didSave = window.EcodriveSession.setSession({
            token: token,
            user: user,
            expiresAt: expiresAt,
            expiresInMs: Number(payload.expiresInMs || 0)
        }, remember);

        if (!didSave) {
            setError("Unable to create login session. Please try again.");
            return;
        }

        var role = String(user.role || "").trim().toLowerCase();
        if (role === "admin") {
            window.location.href = "admin/admin.html";
            return;
        }
        window.location.href = "Userhomefolder/userhome.html";
    });
});
