document.addEventListener("DOMContentLoaded", function () {
    var OTP_TTL_MS = 5 * 60 * 1000;

    var contactInput = document.getElementById("contact-input");
    var sendCodeBtn = document.getElementById("send-code-btn");
    var verifyCodeBtn = document.getElementById("verify-code-btn");
    var resendCodeBtn = document.getElementById("resend-code-btn");
    var resetPasswordBtn = document.getElementById("reset-password-btn");
    var newPasswordInput = document.getElementById("new-password");
    var confirmPasswordInput = document.getElementById("confirm-password");
    var maskedContact = document.getElementById("masked-contact");
    var formMessage = document.getElementById("form-message");
    var steps = Array.from(document.querySelectorAll(".step"));
    var otpInputs = Array.from(document.querySelectorAll(".otp-digit"));

    if (!contactInput || !sendCodeBtn || !verifyCodeBtn || !resetPasswordBtn) {
        return;
    }

    var state = {
        method: "email",
        contact: "",
        requestId: "",
        accountEmail: "",
        otpExpiresAt: 0,
        otpVerified: false
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

    function showMessage(message, type) {
        if (!formMessage) {
            return;
        }
        formMessage.textContent = String(message || "");
        formMessage.classList.remove("error", "success");
        if (type === "error" || type === "success") {
            formMessage.classList.add(type);
        }
    }

    function clearMessage() {
        showMessage("", "");
    }

    function goToStep(stepName) {
        steps.forEach(function (step) {
            var active = step.dataset.step === stepName;
            step.hidden = !active;
            step.classList.toggle("is-active", active);
        });
    }

    function clearOtpInputs() {
        otpInputs.forEach(function (input) {
            input.value = "";
        });
    }

    function getOtpCode() {
        return otpInputs.map(function (input) {
            return String(input.value || "");
        }).join("");
    }

    function maskEmail(email) {
        var normalizedEmail = String(email || "").trim().toLowerCase();
        var parts = normalizedEmail.split("@");
        if (parts.length !== 2) {
            return normalizedEmail;
        }
        var left = parts[0];
        var right = parts[1];
        var visible = left.slice(0, Math.min(2, left.length));
        return visible + "*".repeat(Math.max(1, left.length - visible.length)) + "@" + right;
    }

    function validateContact(value) {
        var raw = String(value || "").trim();
        if (!raw) {
            return "Email is required.";
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
            return "Please enter a valid email address.";
        }
        return "";
    }

    function validatePassword(newPassword, confirmPassword) {
        if (!newPassword) {
            return "New password is required.";
        }
        if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/.test(newPassword)) {
            return "Password must be 8+ chars with upper, lower, number and symbol.";
        }
        if (newPassword !== confirmPassword) {
            return "Passwords do not match.";
        }
        return "";
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

    bindOtpInputs();
    goToStep("contact");

    sendCodeBtn.addEventListener("click", async function () {
        clearMessage();
        var contact = String(contactInput.value || "").trim().toLowerCase();
        var contactError = validateContact(contact);
        if (contactError) {
            showMessage(contactError, "error");
            return;
        }

        var defaultLabel = sendCodeBtn.textContent;
        sendCodeBtn.disabled = true;
        sendCodeBtn.textContent = "Sending...";

        try {
            var response = await fetch(getApiUrl("/api/forgot/send-code"), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    method: "email",
                    contact: contact
                })
            });

            var payload = await response.json().catch(function () {
                return {};
            });
            if (!response.ok || payload.success !== true) {
                showMessage(payload.message || "Unable to send verification code.", "error");
                return;
            }

            state.method = "email";
            state.contact = contact;
            state.requestId = String(payload.requestId || "");
            state.accountEmail = String(payload.accountEmail || contact).trim().toLowerCase();
            state.otpVerified = false;

            var expiresInMs = Number(payload.expiresInMs);
            state.otpExpiresAt = Date.now() + (
                Number.isFinite(expiresInMs) && expiresInMs > 0
                    ? expiresInMs
                    : OTP_TTL_MS
            );

            maskedContact.textContent = maskEmail(contact);
            clearOtpInputs();
            goToStep("otp");
            if (otpInputs[0]) {
                otpInputs[0].focus();
            }

            var deliveryMode = String(((payload.delivery || {}).mode || "")).trim().toLowerCase();
            var serverMessage = String(payload.message || "").trim();
            var isDemoDelivery = deliveryMode === "demo" || /demo/i.test(serverMessage);
            if (isDemoDelivery) {
                var demoCode = String(payload.demoCode || "").trim();
                var deliveryReason = String(payload.deliveryReason || "").trim();
                var demoMessage = demoCode
                    ? "Demo mode only. Use this code: " + demoCode + "."
                    : "Demo mode only. Verification code was generated locally.";
                if (deliveryReason) {
                    demoMessage += " " + deliveryReason;
                }
                demoMessage += " Configure email provider for real delivery.";
                showMessage(demoMessage, "success");
            } else {
                showMessage(serverMessage || "Code sent. Please check your email.", "success");
            }
        } catch (_error) {
            showMessage("API is unavailable. Please start the backend server.", "error");
        } finally {
            sendCodeBtn.disabled = false;
            sendCodeBtn.textContent = defaultLabel;
        }
    });

    resendCodeBtn.addEventListener("click", function () {
        if (!state.contact) {
            showMessage("Enter email first.", "error");
            goToStep("contact");
            return;
        }
        sendCodeBtn.click();
    });

    verifyCodeBtn.addEventListener("click", async function () {
        clearMessage();
        var code = getOtpCode();
        if (!/^\d{4}$/.test(code)) {
            showMessage("Enter all 4 digits of the code.", "error");
            return;
        }
        if (!state.requestId) {
            showMessage("Request a new code first.", "error");
            return;
        }
        if (Date.now() > state.otpExpiresAt) {
            showMessage("Code expired. Request a new code.", "error");
            return;
        }

        var defaultLabel = verifyCodeBtn.textContent;
        verifyCodeBtn.disabled = true;
        verifyCodeBtn.textContent = "Verifying...";

        try {
            var response = await fetch(getApiUrl("/api/forgot/verify-code"), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    requestId: state.requestId,
                    code: code
                })
            });
            var payload = await response.json().catch(function () {
                return {};
            });

            if (!response.ok || payload.verified !== true) {
                showMessage(payload.message || "Invalid verification code.", "error");
                return;
            }

            state.otpVerified = true;
            goToStep("password");
            newPasswordInput.focus();
            showMessage("Code verified. You can now reset your password.", "success");
        } catch (_error) {
            showMessage("API is unavailable. Please start the backend server.", "error");
        } finally {
            verifyCodeBtn.disabled = false;
            verifyCodeBtn.textContent = defaultLabel;
        }
    });

    resetPasswordBtn.addEventListener("click", async function () {
        clearMessage();
        if (!state.otpVerified) {
            showMessage("Please verify the code first.", "error");
            goToStep("otp");
            return;
        }

        var newPassword = String(newPasswordInput.value || "");
        var confirmPassword = String(confirmPasswordInput.value || "");
        var passwordError = validatePassword(newPassword, confirmPassword);
        if (passwordError) {
            showMessage(passwordError, "error");
            return;
        }

        var defaultLabel = resetPasswordBtn.textContent;
        resetPasswordBtn.disabled = true;
        resetPasswordBtn.textContent = "Saving...";

        try {
            var response = await fetch(getApiUrl("/api/reset-password"), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    requestId: state.requestId,
                    email: state.accountEmail,
                    method: "email",
                    contact: state.contact,
                    newPassword: newPassword
                })
            });

            var payload = await response.json().catch(function () {
                return {};
            });
            if (!response.ok || payload.success !== true) {
                showMessage(payload.message || "Unable to reset password.", "error");
                return;
            }

            showMessage("Password reset successful. Redirecting to login...", "success");
            window.setTimeout(function () {
                window.location.href = "log in.html";
            }, 900);
        } catch (_error) {
            showMessage("API is unavailable. Please start the backend server.", "error");
        } finally {
            resetPasswordBtn.disabled = false;
            resetPasswordBtn.textContent = defaultLabel;
        }
    });
});
