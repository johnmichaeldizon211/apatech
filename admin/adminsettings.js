document.addEventListener("DOMContentLoaded", function () {
    if (!window.EcodriveSession || typeof window.EcodriveSession.requireRole !== "function" || !window.EcodriveSession.requireRole("admin")) {
        return;
    }

    const apiBase = String(
        (window.EcodriveSession && typeof window.EcodriveSession.getApiBase === "function"
            ? window.EcodriveSession.getApiBase()
            : localStorage.getItem("ecodrive_api_base")
                || localStorage.getItem("ecodrive_kyc_api_base")
                || "")
    )
        .trim()
        .replace(/\/+$/, "");

    const passwordForm = document.getElementById("passwordForm");
    const currentPasswordInput = document.getElementById("currentPasswordInput");
    const newPasswordInput = document.getElementById("newPasswordInput");
    const confirmPasswordInput = document.getElementById("confirmPasswordInput");
    const savePasswordBtn = document.getElementById("savePasswordBtn");
    const passwordStatus = document.getElementById("passwordStatus");

    if (
        !passwordForm ||
        !currentPasswordInput ||
        !newPasswordInput ||
        !confirmPasswordInput ||
        !savePasswordBtn ||
        !passwordStatus
    ) {
        return;
    }

    function getApiUrl(path) {
        return apiBase ? `${apiBase}${path}` : path;
    }

    function setStatus(element, message, isError) {
        element.textContent = String(message || "");
        element.classList.toggle("error", Boolean(isError));
    }

    passwordForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        setStatus(passwordStatus, "", false);

        const currentPassword = String(currentPasswordInput.value || "");
        const newPassword = String(newPasswordInput.value || "");
        const confirmPassword = String(confirmPasswordInput.value || "");

        if (!currentPassword) {
            setStatus(passwordStatus, "Current password is required.", true);
            return;
        }
        if (!newPassword) {
            setStatus(passwordStatus, "New password is required.", true);
            return;
        }
        if (newPassword !== confirmPassword) {
            setStatus(passwordStatus, "New password and confirmation do not match.", true);
            return;
        }

        savePasswordBtn.disabled = true;
        savePasswordBtn.textContent = "Updating...";

        try {
            const response = await fetch(getApiUrl("/api/admin/settings/password"), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    currentPassword: currentPassword,
                    newPassword: newPassword
                })
            });
            const data = await response.json().catch(function () {
                return {};
            });

            if (!response.ok || data.success !== true) {
                setStatus(passwordStatus, data.message || "Unable to update password.", true);
                return;
            }

            passwordForm.reset();
            setStatus(passwordStatus, data.message || "Password updated.", false);
        } catch (_error) {
            setStatus(passwordStatus, "Cannot connect to backend API.", true);
        } finally {
            savePasswordBtn.disabled = false;
            savePasswordBtn.textContent = "Update Password";
        }
    });

});
