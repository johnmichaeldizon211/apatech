document.addEventListener("DOMContentLoaded", function () {
    var OTP_TTL_MS = 5 * 60 * 1000;

    var form = document.getElementById("signup-form");
    var verificationStep = document.getElementById("signup-verification-step");

    var firstNameInput = document.getElementById("firstName");
    var middleInitialInput = document.getElementById("middleInitial");
    var lastNameInput = document.getElementById("lastName");
    var emailInput = document.getElementById("email");
    var phoneInput = document.getElementById("phone");
    var addressInput = document.getElementById("address");
    var passwordInput = document.getElementById("password");

    var continueBtn = document.getElementById("continue-btn");
    var backToFormBtn = document.getElementById("back-to-form-btn");

    var verifyContactValue = document.getElementById("verify-contact-value");
    var verificationStatus = document.getElementById("verification-status");
    var otpTimer = document.getElementById("otp-timer");

    var verifyCodeBtn = document.getElementById("verify-code-btn");
    var resendCodeBtn = document.getElementById("resend-code-btn");
    var otpInputs = Array.from(document.querySelectorAll("#otp-inputs .otp-digit"));

    var toast = document.getElementById("toast");

    var firstNameErr = document.getElementById("firstName-error");
    var middleInitialErr = document.getElementById("middleInitial-error");
    var lastNameErr = document.getElementById("lastName-error");
    var emailErr = document.getElementById("email-error");
    var phoneErr = document.getElementById("phone-error");
    var addressErr = document.getElementById("address-error");
    var passwordErr = document.getElementById("password-error");

    if (
        !form ||
        !verificationStep ||
        !continueBtn ||
        !verifyCodeBtn ||
        !resendCodeBtn ||
        !backToFormBtn
    ) {
        return;
    }

    var touched = {
        firstName: false,
        middleInitial: false,
        lastName: false,
        email: false,
        phone: false,
        address: false,
        password: false
    };
    var submitted = false;
    var isFormValid = false;

    var verificationState = {
        requestId: "",
        verified: false,
        method: "email",
        expiresAt: 0,
        timerId: 0
    };

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

    function getApiBaseLabel() {
        if (window.EcodriveSession && typeof window.EcodriveSession.getApiBase === "function") {
            return String(window.EcodriveSession.getApiBase() || "").trim();
        }
        return String(
            localStorage.getItem("ecodrive_api_base") ||
            localStorage.getItem("ecodrive_kyc_api_base") ||
            ""
        ).trim();
    }

    function getApiUnavailableMessage() {
        var base = getApiBaseLabel() || "unset";
        return "API is unavailable (" + base + "). Run: cd APATECH/api && node kyc-server.js";
    }

    function normalizeMiddleInitial(value) {
        var cleaned = String(value || "").trim().replace(/[^a-zA-Z]/g, "");
        return cleaned ? cleaned.slice(0, 1).toUpperCase() : "";
    }

    function normalizePhone(value) {
        var cleaned = String(value || "").trim().replace(/[\s-]/g, "");
        if (/^\+639\d{9}$/.test(cleaned)) {
            return "0" + cleaned.slice(3);
        }
        if (/^639\d{9}$/.test(cleaned)) {
            return "0" + cleaned.slice(2);
        }
        return cleaned;
    }

    function isValidEmail(value) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
    }

    function isValidPhone(value) {
        return /^(\+639|09)\d{9}$/.test(String(value || "").trim().replace(/[\s-]/g, ""));
    }

    function isStrongPassword(value) {
        return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/.test(String(value || ""));
    }

    function setFieldError(input, errorNode, message, show) {
        if (!input || !errorNode) {
            return;
        }
        errorNode.textContent = show ? String(message || "") : "";
        input.classList.toggle("invalid", Boolean(show && message));
    }

    function showToast(message, type) {
        if (!toast) {
            return;
        }
        toast.textContent = String(message || "");
        toast.className = "toast show " + (type === "error" ? "error" : "success");
        window.setTimeout(function () {
            toast.className = "toast";
        }, 3200);
    }

    function setVerificationStatus(message, type) {
        if (!verificationStatus) {
            return;
        }
        verificationStatus.textContent = String(message || "");
        verificationStatus.classList.remove("error", "success");
        if (type === "error" || type === "success") {
            verificationStatus.classList.add(type);
        }
    }

    function clearOtpInputs() {
        otpInputs.forEach(function (input) {
            input.value = "";
        });
    }

    function getOtpCode() {
        return otpInputs.map(function (input) {
            return String(input.value || "").trim();
        }).join("");
    }

    function collectSignupPayload() {
        return {
            firstName: String(firstNameInput.value || "").trim(),
            middleInitial: normalizeMiddleInitial(middleInitialInput.value),
            lastName: String(lastNameInput.value || "").trim(),
            email: String(emailInput.value || "").trim().toLowerCase(),
            phone: normalizePhone(phoneInput.value),
            address: String(addressInput.value || "").trim(),
            password: String(passwordInput.value || "")
        };
    }

    function maskEmail(email) {
        var parts = String(email || "").trim().toLowerCase().split("@");
        if (parts.length !== 2) {
            return String(email || "");
        }
        var left = parts[0];
        var right = parts[1];
        var visible = left.slice(0, Math.min(2, left.length));
        return visible + "*".repeat(Math.max(1, left.length - visible.length)) + "@" + right;
    }

    function stopOtpCountdown() {
        if (verificationState.timerId) {
            window.clearInterval(verificationState.timerId);
            verificationState.timerId = 0;
        }
    }

    function formatRemainingTime(ms) {
        var totalSeconds = Math.ceil(Math.max(0, Number(ms || 0)) / 1000);
        var minutes = Math.floor(totalSeconds / 60);
        var seconds = totalSeconds % 60;
        return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
    }

    function updateOtpTimer() {
        var expiresAt = Number(verificationState.expiresAt || 0);
        var hasRequest = Boolean(verificationState.requestId);
        var remainingMs = hasRequest ? Math.max(0, expiresAt - Date.now()) : 0;

        if (otpTimer) {
            otpTimer.textContent = "Remaining time: " + formatRemainingTime(remainingMs) + "s";
        }

        if (verifyCodeBtn) {
            verifyCodeBtn.disabled = !hasRequest || remainingMs <= 0;
        }

        if (remainingMs === 0 && hasRequest) {
            stopOtpCountdown();
            verificationState.requestId = "";
            verificationState.verified = false;
            verificationState.method = "email";
            setVerificationStatus("Code expired. Please resend a new code.", "error");
            if (verifyCodeBtn) {
                verifyCodeBtn.disabled = true;
            }
            if (resendCodeBtn) {
                resendCodeBtn.disabled = false;
            }
        }
    }

    function startOtpCountdown() {
        stopOtpCountdown();
        updateOtpTimer();
        verificationState.timerId = window.setInterval(updateOtpTimer, 1000);
    }

    function resetVerificationState() {
        stopOtpCountdown();
        verificationState.requestId = "";
        verificationState.verified = false;
        verificationState.method = "email";
        verificationState.expiresAt = 0;
        clearOtpInputs();
        if (otpTimer) {
            otpTimer.textContent = "Remaining time: 00:00s";
        }
        if (verifyCodeBtn) {
            verifyCodeBtn.disabled = true;
            verifyCodeBtn.textContent = "Verify";
        }
        if (resendCodeBtn) {
            resendCodeBtn.disabled = true;
        }
        setVerificationStatus("", "");
        refreshVerificationUi();
    }

    function refreshVerificationUi() {
        var payload = collectSignupPayload();
        if (verifyContactValue) {
            verifyContactValue.textContent = maskEmail(payload.email) || "-";
        }
    }

    function validateForm() {
        var firstName = String(firstNameInput.value || "").trim();
        var middleInitialRaw = String(middleInitialInput.value || "").trim();
        var lastName = String(lastNameInput.value || "").trim();
        var email = String(emailInput.value || "").trim();
        var phone = String(phoneInput.value || "").trim();
        var address = String(addressInput.value || "").trim();
        var password = String(passwordInput.value || "");

        var firstNameMsg = firstName.length < 2 ? "Please enter your first name." : "";
        var middleInitialMsg = (
            middleInitialRaw &&
            !/^[a-zA-Z][.]?$/.test(middleInitialRaw)
        ) ? "Use one letter only for middle initial." : "";
        var lastNameMsg = lastName.length < 2 ? "Please enter your last name." : "";
        var emailMsg = !isValidEmail(email) ? "Please enter a valid email." : "";
        var phoneMsg = !isValidPhone(phone) ? "Use 09XXXXXXXXX or +639XXXXXXXXX." : "";
        var addressMsg = address.length < 5 ? "Please enter a complete address." : "";
        var passwordMsg = !isStrongPassword(password)
            ? "Password must be 8+ chars and include upper, lower, number and symbol."
            : "";

        setFieldError(firstNameInput, firstNameErr, firstNameMsg, touched.firstName || submitted);
        setFieldError(middleInitialInput, middleInitialErr, middleInitialMsg, touched.middleInitial || submitted);
        setFieldError(lastNameInput, lastNameErr, lastNameMsg, touched.lastName || submitted);
        setFieldError(emailInput, emailErr, emailMsg, touched.email || submitted);
        setFieldError(phoneInput, phoneErr, phoneMsg, touched.phone || submitted);
        setFieldError(addressInput, addressErr, addressMsg, touched.address || submitted);
        setFieldError(passwordInput, passwordErr, passwordMsg, touched.password || submitted);

        isFormValid = !firstNameMsg && !middleInitialMsg && !lastNameMsg && !emailMsg && !phoneMsg && !addressMsg && !passwordMsg;
        continueBtn.disabled = !isFormValid;
        return isFormValid;
    }

    function showFormStep() {
        form.hidden = false;
        verificationStep.hidden = true;
    }

    function showVerificationStep() {
        form.hidden = true;
        verificationStep.hidden = false;
        refreshVerificationUi();
    }

    function bindOtpInputs() {
        otpInputs.forEach(function (input, index) {
            input.addEventListener("input", function () {
                input.value = String(input.value || "").replace(/\D/g, "").slice(-1);
                if (input.value && index < otpInputs.length - 1) {
                    otpInputs[index + 1].focus();
                }
            });

            input.addEventListener("keydown", function (event) {
                if (event.key === "Backspace" && !input.value && index > 0) {
                    otpInputs[index - 1].focus();
                }
            });
        });
    }

    async function sendSignupCode() {
        if (!validateForm()) {
            submitted = true;
            Object.keys(touched).forEach(function (key) {
                touched[key] = true;
            });
            validateForm();
            showToast("Please complete the form first.", "error");
            showFormStep();
            return;
        }

        var payload = collectSignupPayload();
        resendCodeBtn.disabled = true;
        verifyCodeBtn.disabled = true;
        setVerificationStatus("", "");

        try {
            var response = await fetch(getApiUrl("/api/signup/send-code"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    method: "email",
                    email: payload.email,
                    phone: payload.phone
                })
            });

            var body = await response.json().catch(function () {
                return {};
            });

            if (!response.ok || body.success !== true) {
                var message = body.message || "Unable to send verification code.";
                var lowerMessage = String(message || "").toLowerCase();
                if (response.status === 409 && (lowerMessage.includes("mobile") || lowerMessage.includes("phone"))) {
                    setFieldError(phoneInput, phoneErr, message, true);
                    showFormStep();
                    showToast("Please use another mobile number.", "error");
                    resendCodeBtn.disabled = false;
                    return;
                }
                if (response.status === 409) {
                    setFieldError(emailInput, emailErr, message, true);
                    showFormStep();
                    showToast(message, "error");
                    resendCodeBtn.disabled = false;
                    return;
                }
                if (lowerMessage.includes("email")) {
                    setFieldError(emailInput, emailErr, message, true);
                } else if (lowerMessage.includes("mobile")) {
                    setFieldError(phoneInput, phoneErr, message, true);
                }
                setVerificationStatus(message, "error");
                showToast(message, "error");
                resendCodeBtn.disabled = false;
                return;
            }

            verificationState.requestId = String(body.requestId || "");
            verificationState.verified = false;
            verificationState.method = "email";
            verificationState.expiresAt = Date.now() + (
                Number.isFinite(Number(body.expiresInMs)) && Number(body.expiresInMs) > 0
                    ? Number(body.expiresInMs)
                    : OTP_TTL_MS
            );
            clearOtpInputs();
            if (otpInputs[0]) {
                otpInputs[0].focus();
            }
            startOtpCountdown();

            var deliveryMode = String(((body.delivery || {}).mode || "")).trim().toLowerCase();
            var serverMessage = String(body.message || "").trim();
            var isDemoMode = deliveryMode === "demo" || /demo/i.test(serverMessage);
            if (isDemoMode) {
                var demoCode = String(body.demoCode || "").trim();
                var demoMessage = demoCode
                    ? "Demo mode only. Use this code: " + demoCode + "."
                    : "Demo mode only. Verification code generated locally.";
                if (body.deliveryReason) {
                    demoMessage += " " + String(body.deliveryReason || "").trim();
                }
                setVerificationStatus(demoMessage, "success");
                showToast(demoMessage, "success");
            } else {
                var sentMessage = serverMessage || "Verification code sent to your email.";
                setVerificationStatus(sentMessage, "success");
                showToast(sentMessage, "success");
            }
            resendCodeBtn.disabled = false;
        } catch (_error) {
            var apiMessage = getApiUnavailableMessage();
            setVerificationStatus(apiMessage, "error");
            showToast(apiMessage, "error");
            resendCodeBtn.disabled = false;
        } finally {
            refreshVerificationUi();
            updateOtpTimer();
        }
    }

    async function verifySignupCode() {
        if (!verificationState.requestId) {
            setVerificationStatus("Send or resend a code first.", "error");
            return;
        }
        if (Date.now() > Number(verificationState.expiresAt || 0)) {
            verificationState.requestId = "";
            verificationState.verified = false;
            setVerificationStatus("Code expired. Please resend a new code.", "error");
            updateOtpTimer();
            return;
        }

        var code = getOtpCode();
        if (!/^\d{4}$/.test(code)) {
            setVerificationStatus("Enter the 4-digit code.", "error");
            return;
        }

        var payload = collectSignupPayload();
        var defaultLabel = verifyCodeBtn.textContent;
        var shouldRestoreVerifyButton = true;
        verifyCodeBtn.disabled = true;
        verifyCodeBtn.textContent = "Verifying...";

        try {
            var response = await fetch(getApiUrl("/api/signup/verify-code"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    requestId: verificationState.requestId,
                    code: code,
                    method: "email",
                    email: payload.email,
                    phone: payload.phone
                })
            });

            var body = await response.json().catch(function () {
                return {};
            });
            if (!response.ok || body.verified !== true) {
                setVerificationStatus(body.message || "Invalid verification code.", "error");
                return;
            }

            verificationState.verified = true;
            verificationState.method = "email";
            stopOtpCountdown();
            setVerificationStatus(body.message || "Code verified. Creating your account...", "success");
            shouldRestoreVerifyButton = false;
            await submitSignup();
        } catch (_error) {
            setVerificationStatus(getApiUnavailableMessage(), "error");
        } finally {
            if (shouldRestoreVerifyButton) {
                verifyCodeBtn.disabled = false;
                verifyCodeBtn.textContent = defaultLabel;
            }
            refreshVerificationUi();
        }
    }

    async function submitSignup() {
        submitted = true;
        Object.keys(touched).forEach(function (key) {
            touched[key] = true;
        });
        if (!validateForm()) {
            showFormStep();
            showToast("Please fix form errors first.", "error");
            return;
        }

        if (!verificationState.verified || !verificationState.requestId || verificationState.method !== "email") {
            showToast("Email verification is required before signup.", "error");
            verifyCodeBtn.disabled = false;
            verifyCodeBtn.textContent = "Verify";
            return;
        }

        verifyCodeBtn.disabled = true;
        verifyCodeBtn.textContent = "Creating...";

        var payload = collectSignupPayload();
        payload.verificationRequestId = verificationState.requestId;
        payload.verificationMethod = "email";

        var response;
        try {
            response = await fetch(getApiUrl("/api/signup"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
        } catch (_error) {
            showToast(getApiUnavailableMessage(), "error");
            verifyCodeBtn.disabled = false;
            verifyCodeBtn.textContent = "Verify";
            return;
        }

        var body = await response.json().catch(function () {
            return {};
        });

        if (!response.ok || body.success !== true) {
            var message = body.message || "Signup failed. Please try again.";
            if (response.status === 409 && message.toLowerCase().includes("mobile")) {
                setFieldError(phoneInput, phoneErr, message, true);
                resetVerificationState();
                showFormStep();
            } else if (response.status === 409) {
                setFieldError(emailInput, emailErr, message, true);
                resetVerificationState();
                showFormStep();
            } else if (message.toLowerCase().includes("verification")) {
                setVerificationStatus(message, "error");
            } else {
                showToast(message, "error");
            }
            verifyCodeBtn.disabled = false;
            verifyCodeBtn.textContent = "Verify";
            return;
        }

        if (!window.EcodriveSession || typeof window.EcodriveSession.setSession !== "function") {
            showToast("Session layer failed to load. Try refreshing the page.", "error");
            verifyCodeBtn.disabled = false;
            verifyCodeBtn.textContent = "Verify";
            return;
        }

        var didSave = window.EcodriveSession.setSession({
            token: String(body.token || ""),
            user: body.user || {},
            expiresAt: body.expiresAt ? new Date(body.expiresAt).getTime() : 0,
            expiresInMs: Number(body.expiresInMs || 0)
        }, true);

        if (!didSave) {
            showToast("Account created but login session failed. Please log in manually.", "error");
            window.setTimeout(function () {
                window.location.href = "log in.html";
            }, 900);
            return;
        }

        showToast("Account created successfully.", "success");
        window.setTimeout(function () {
            window.location.href = "Userhomefolder/userhome.html";
        }, 850);
    }

    [
        { key: "firstName", input: firstNameInput },
        { key: "middleInitial", input: middleInitialInput },
        { key: "lastName", input: lastNameInput },
        { key: "email", input: emailInput },
        { key: "phone", input: phoneInput },
        { key: "address", input: addressInput },
        { key: "password", input: passwordInput }
    ].forEach(function (entry) {
        if (!entry.input) {
            return;
        }
        entry.input.addEventListener("blur", function () {
            touched[entry.key] = true;
            validateForm();
        });
        entry.input.addEventListener("input", function () {
            if (entry.key === "middleInitial") {
                entry.input.value = normalizeMiddleInitial(entry.input.value);
            }
            if (entry.key === "email" || entry.key === "phone") {
                resetVerificationState();
            }
            validateForm();
            refreshVerificationUi();
        });
    });

    bindOtpInputs();

    document.querySelectorAll(".toggle-password").forEach(function (btn) {
        btn.addEventListener("click", function () {
            var targetId = btn.getAttribute("data-target");
            var target = targetId ? document.getElementById(targetId) : null;
            if (!target) {
                return;
            }
            var reveal = target.type === "password";
            target.type = reveal ? "text" : "password";
            btn.textContent = reveal ? "Hide" : "Show";
        });
    });

    form.addEventListener("submit", function (event) {
        event.preventDefault();
        submitted = true;
        Object.keys(touched).forEach(function (key) {
            touched[key] = true;
        });
        if (!validateForm()) {
            return;
        }
        resetVerificationState();
        showVerificationStep();
        void sendSignupCode();
    });

    backToFormBtn.addEventListener("click", function () {
        resetVerificationState();
        showFormStep();
    });

    verifyCodeBtn.addEventListener("click", function () {
        void verifySignupCode();
    });

    resendCodeBtn.addEventListener("click", function () {
        void sendSignupCode();
    });

    showFormStep();
    refreshVerificationUi();
    validateForm();
    resetVerificationState();
});
