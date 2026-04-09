document.addEventListener("DOMContentLoaded", function () {
    var OTP_TTL_MS = 5 * 60 * 1000;
    var ALLOWED_PROVINCE = "Bulacan";
    var ALLOWED_CITY_CONFIG = [
        { label: "City of Baliwag", aliases: ["Baliwag City", "City of Baliuag", "Baliuag City", "Baliwag", "Baliuag"] },
        { label: "San Ildefonso", aliases: [] },
        { label: "San Rafael", aliases: [] },
        { label: "Pulilan", aliases: ["Pullilan"] },
        { label: "Bustos", aliases: [] }
    ];
    var BARANGAY_CACHE_KEY = "ecodrive_bulacan_barangays_v1";
    var PSGC_API_BASE = "https://psgc.cloud/api/v2";
    var PSGC_TIMEOUT_MS = 15000;
    var FALLBACK_BARANGAYS_BY_CITY = {
        "City of Baliwag": ["Bagong Nayon", "Concepcion", "Makinabang", "Poblacion", "Sabang", "San Jose", "Santo Nino", "Tarcan"],
        "San Ildefonso": ["Akle", "Anyatam", "Bubulong Munti", "Garlang", "Malipampang", "Sapang Putik", "Umpucan"],
        "San Rafael": ["Banca-banca", "Caingin", "Lico", "Maasim", "Poblacion", "Talacsan", "Tukod"],
        "Pulilan": ["Balatong A", "Balatong B", "Cutcot", "Lumbac", "Longos", "Poblacion", "Santa Peregrina"],
        "Bustos": ["Bonga Mayor", "Buisan", "Camachile", "Cambaog", "Poblacion", "Tibagan", "Talampas"]
    };

    var form = document.getElementById("signup-form");
    var verificationStep = document.getElementById("signup-verification-step");

    var fullNameInput = document.getElementById("fullName");
    var emailInput = document.getElementById("email");
    var phoneInput = document.getElementById("phone");
    var streetInput = document.getElementById("street");
    var provinceSelect = document.getElementById("province");
    var citySelect = document.getElementById("city");
    var barangaySelect = document.getElementById("barangay");
    var passwordInput = document.getElementById("password");
    var confirmPasswordInput = document.getElementById("confirmPassword");

    var continueBtn = document.getElementById("continue-btn");
    var backToFormBtn = document.getElementById("back-to-form-btn");

    var verifyContactValue = document.getElementById("verify-contact-value");
    var verificationStatus = document.getElementById("verification-status");
    var otpTimer = document.getElementById("otp-timer");

    var verifyCodeBtn = document.getElementById("verify-code-btn");
    var resendCodeBtn = document.getElementById("resend-code-btn");
    var otpInputs = Array.from(document.querySelectorAll("#otp-inputs .otp-digit"));

    var toast = document.getElementById("toast");

    var fullNameErr = document.getElementById("fullName-error");
    var emailErr = document.getElementById("email-error");
    var phoneErr = document.getElementById("phone-error");
    var streetErr = document.getElementById("street-error");
    var provinceErr = document.getElementById("province-error");
    var cityErr = document.getElementById("city-error");
    var barangayErr = document.getElementById("barangay-error");
    var passwordErr = document.getElementById("password-error");
    var confirmPasswordErr = document.getElementById("confirmPassword-error");

    if (
        !form ||
        !verificationStep ||
        !continueBtn ||
        !verifyCodeBtn ||
        !resendCodeBtn ||
        !backToFormBtn ||
        !fullNameInput ||
        !emailInput ||
        !phoneInput ||
        !streetInput ||
        !provinceSelect ||
        !citySelect ||
        !barangaySelect ||
        !passwordInput ||
        !confirmPasswordInput
    ) {
        return;
    }

    var touched = {
        fullName: false,
        email: false,
        phone: false,
        street: false,
        province: false,
        city: false,
        barangay: false,
        password: false,
        confirmPassword: false
    };
    var submitted = false;
    var isFormValid = false;
    var ALLOWED_CITY_LABELS = ALLOWED_CITY_CONFIG.map(function (item) {
        return String(item.label || "").trim();
    }).filter(Boolean);
    var CITY_ALIAS_TO_CANONICAL = (function buildCityAliasMap() {
        var map = new Map();
        ALLOWED_CITY_CONFIG.forEach(function (item) {
            var canonical = String(item.label || "").trim();
            if (!canonical) {
                return;
            }
            var tokens = [canonical].concat(Array.isArray(item.aliases) ? item.aliases : []);
            tokens.forEach(function (token) {
                var normalized = String(token || "").trim().toLowerCase();
                if (normalized) {
                    map.set(normalized, canonical);
                }
            });
        });
        return map;
    })();
    var psgcCityRowsByCanonical = {};
    var barangayCacheByCity = {};

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

    function parseFullName(value) {
        var cleaned = String(value || "").trim().replace(/\s+/g, " ");
        var parts = cleaned ? cleaned.split(" ") : [];
        var first = parts[0] || "";
        var last = parts.length > 1 ? parts[parts.length - 1] : "";
        var middle = parts.length > 2 ? parts.slice(1, -1).join(" ") : "";
        var middleInitial = middle ? middle.trim().charAt(0).toUpperCase() : "";
        return {
            full: cleaned,
            first: first,
            last: last,
            middleInitial: middleInitial
        };
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

    function normalizeAddressPart(value) {
        return String(value || "").trim().replace(/\s+/g, " ");
    }

    function sortUniqueTextList(listInput) {
        var values = Array.isArray(listInput) ? listInput : [];
        var unique = Array.from(new Set(values.map(function (item) {
            return normalizeAddressPart(item);
        }).filter(Boolean)));
        return unique.sort(function (a, b) {
            return String(a).localeCompare(String(b), "en", { sensitivity: "base" });
        });
    }

    function resolveAllowedCityName(value) {
        var cleaned = normalizeAddressPart(value);
        if (!cleaned) {
            return "";
        }
        return CITY_ALIAS_TO_CANONICAL.get(cleaned.toLowerCase()) || "";
    }

    function normalizeProvinceName(value) {
        var cleaned = normalizeAddressPart(value);
        return cleaned.toLowerCase() === ALLOWED_PROVINCE.toLowerCase()
            ? ALLOWED_PROVINCE
            : "";
    }

    function parseLocationApiRows(payload) {
        var list = Array.isArray(payload)
            ? payload
            : (payload && Array.isArray(payload.data) ? payload.data : []);
        return list
            .map(function (row) {
                if (!row || typeof row !== "object") {
                    return null;
                }
                var name = normalizeAddressPart(row.name || row.city || row.municipality || row.barangay);
                var code = normalizeAddressPart(row.code || row.psgc_code || row.id || name);
                if (!name) {
                    return null;
                }
                return { name: name, code: code || name };
            })
            .filter(Boolean);
    }

    async function fetchPsgcRows(url) {
        var controller = typeof AbortController === "function" ? new AbortController() : null;
        var timer = controller ? setTimeout(function () {
            controller.abort();
        }, PSGC_TIMEOUT_MS) : null;
        try {
            var response = await fetch(url, {
                method: "GET",
                headers: { "Accept": "application/json" },
                signal: controller ? controller.signal : undefined
            });
            if (!response.ok) {
                return [];
            }
            var payload = await response.json().catch(function () {
                return [];
            });
            return parseLocationApiRows(payload);
        } catch (_error) {
            return [];
        } finally {
            if (timer) {
                clearTimeout(timer);
            }
        }
    }

    function readBarangayCache() {
        try {
            var raw = JSON.parse(localStorage.getItem(BARANGAY_CACHE_KEY));
            if (!raw || typeof raw !== "object") {
                return {};
            }
            var next = {};
            Object.keys(raw).forEach(function (cityName) {
                var canonical = resolveAllowedCityName(cityName);
                if (!canonical) {
                    return;
                }
                var list = sortUniqueTextList(raw[cityName]);
                if (list.length) {
                    next[canonical] = list;
                }
            });
            return next;
        } catch (_error) {
            return {};
        }
    }

    function saveBarangayCache(cacheInput) {
        var cache = cacheInput && typeof cacheInput === "object" ? cacheInput : {};
        var payload = {};
        Object.keys(cache).forEach(function (cityName) {
            var canonical = resolveAllowedCityName(cityName);
            if (!canonical) {
                return;
            }
            var list = sortUniqueTextList(cache[cityName]);
            if (list.length) {
                payload[canonical] = list;
            }
        });
        localStorage.setItem(BARANGAY_CACHE_KEY, JSON.stringify(payload));
    }

    function renderSelectValues(selectEl, placeholder, values, selectedValue, opts) {
        if (!(selectEl instanceof HTMLSelectElement)) {
            return "";
        }
        var options = opts && typeof opts === "object" ? opts : {};
        var allowBlank = options.allowBlank !== false;
        var selected = normalizeAddressPart(selectedValue);
        var sortedValues = sortUniqueTextList(values);
        selectEl.innerHTML = "";

        if (allowBlank) {
            var placeholderOption = document.createElement("option");
            placeholderOption.value = "";
            placeholderOption.textContent = placeholder;
            selectEl.appendChild(placeholderOption);
        }

        sortedValues.forEach(function (value) {
            var option = document.createElement("option");
            option.value = value;
            option.textContent = value;
            selectEl.appendChild(option);
        });

        if (selected && sortedValues.includes(selected)) {
            selectEl.value = selected;
            return selected;
        }
        selectEl.value = allowBlank ? "" : (sortedValues[0] || "");
        return selectEl.value;
    }

    async function preloadAllowedBulacanCities() {
        if (Object.keys(psgcCityRowsByCanonical).length) {
            return psgcCityRowsByCanonical;
        }
        var provinces = await fetchPsgcRows(PSGC_API_BASE + "/provinces");
        var bulacan = provinces.find(function (row) {
            return normalizeAddressPart(row.name).toLowerCase() === ALLOWED_PROVINCE.toLowerCase();
        });
        if (!bulacan) {
            return psgcCityRowsByCanonical;
        }
        var cityRows = await fetchPsgcRows(
            PSGC_API_BASE + "/provinces/" + encodeURIComponent(bulacan.code) + "/cities-municipalities"
        );
        cityRows.forEach(function (row) {
            var canonical = resolveAllowedCityName(row.name);
            if (canonical && !psgcCityRowsByCanonical[canonical]) {
                psgcCityRowsByCanonical[canonical] = row;
            }
        });
        return psgcCityRowsByCanonical;
    }

    async function fetchBarangaysForAllowedCity(cityName) {
        var canonicalCity = resolveAllowedCityName(cityName);
        if (!canonicalCity) {
            return [];
        }
        if (Array.isArray(barangayCacheByCity[canonicalCity]) && barangayCacheByCity[canonicalCity].length) {
            return barangayCacheByCity[canonicalCity];
        }
        await preloadAllowedBulacanCities();
        var cityRow = psgcCityRowsByCanonical[canonicalCity];
        var rows = [];
        if (cityRow && cityRow.code) {
            rows = await fetchPsgcRows(
                PSGC_API_BASE + "/cities-municipalities/" + encodeURIComponent(cityRow.code) + "/barangays"
            );
        }
        var names = sortUniqueTextList(rows.map(function (row) {
            return row.name;
        }));
        if (names.length) {
            barangayCacheByCity[canonicalCity] = names;
            saveBarangayCache(barangayCacheByCity);
            return names;
        }
        var fallback = sortUniqueTextList(FALLBACK_BARANGAYS_BY_CITY[canonicalCity] || []);
        if (fallback.length) {
            barangayCacheByCity[canonicalCity] = fallback;
            return fallback;
        }
        return [];
    }

    async function syncBarangayOptionsByCity(cityValue, preferredBarangay) {
        var canonicalCity = resolveAllowedCityName(cityValue);
        if (!canonicalCity) {
            renderSelectValues(barangaySelect, "Select barangay", [], "", { allowBlank: true });
            barangaySelect.disabled = true;
            return "";
        }
        citySelect.value = canonicalCity;
        barangaySelect.disabled = true;
        renderSelectValues(barangaySelect, "Loading barangays...", [], "", { allowBlank: true });
        var rows = await fetchBarangaysForAllowedCity(canonicalCity);
        var selected = renderSelectValues(
            barangaySelect,
            rows.length ? "Select barangay" : "No barangays available",
            rows,
            preferredBarangay,
            { allowBlank: true }
        );
        barangaySelect.disabled = rows.length < 1;
        return selected;
    }

    async function initializeLocationSelectors() {
        barangayCacheByCity = readBarangayCache();
        renderSelectValues(
            citySelect,
            "Select city / municipality",
            ALLOWED_CITY_LABELS,
            citySelect.value,
            { allowBlank: true }
        );
        provinceSelect.innerHTML = "";
        var provinceOption = document.createElement("option");
        provinceOption.value = ALLOWED_PROVINCE;
        provinceOption.textContent = ALLOWED_PROVINCE;
        provinceSelect.appendChild(provinceOption);
        provinceSelect.value = ALLOWED_PROVINCE;
        provinceSelect.disabled = true;

        var seededCity = resolveAllowedCityName(citySelect.value);
        if (seededCity) {
            await syncBarangayOptionsByCity(seededCity, barangaySelect.value);
        } else {
            renderSelectValues(barangaySelect, "Select barangay", [], "", { allowBlank: true });
            barangaySelect.disabled = true;
        }
    }

    function buildAddressFromParts(parts) {
        var street = normalizeAddressPart(parts.street);
        var barangay = normalizeAddressPart(parts.barangay);
        var city = normalizeAddressPart(parts.city);
        var province = normalizeAddressPart(parts.province || ALLOWED_PROVINCE);
        return [street, barangay, city, province].filter(Boolean).join(", ");
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
        var nameParts = parseFullName(fullNameInput.value);
        var addressParts = {
            street: normalizeAddressPart(streetInput.value),
            barangay: normalizeAddressPart(barangaySelect.value),
            city: resolveAllowedCityName(citySelect.value),
            province: normalizeProvinceName(provinceSelect.value || ALLOWED_PROVINCE)
        };
        return {
            firstName: nameParts.first,
            middleInitial: nameParts.middleInitial,
            lastName: nameParts.last,
            email: String(emailInput.value || "").trim().toLowerCase(),
            phone: normalizePhone(phoneInput.value),
            address: buildAddressFromParts(addressParts),
            addressParts: addressParts,
            password: String(passwordInput.value || "")
        };
    }

    function persistSignupProfile(payload) {
        var profileEmail = String(payload.email || "").trim().toLowerCase();
        if (!profileEmail) {
            return;
        }
        var profile = {
            fullName: String(fullNameInput.value || "").trim(),
            email: profileEmail,
            phone: payload.phone || "",
            address: payload.address || "",
            updatedAt: new Date().toISOString()
        };
        try {
            localStorage.setItem("ecodrive_profile_settings::" + profileEmail, JSON.stringify(profile));
            localStorage.setItem("ecodrive_profile_settings", JSON.stringify(profile));
        } catch (_error) {
            // ignore storage errors
        }
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
        var fullName = String(fullNameInput.value || "").trim();
        var email = String(emailInput.value || "").trim();
        var phone = String(phoneInput.value || "").trim();
        var password = String(passwordInput.value || "");
        var confirmPassword = String(confirmPasswordInput.value || "");
        var street = normalizeAddressPart(streetInput.value);
        var barangay = normalizeAddressPart(barangaySelect.value);
        var city = resolveAllowedCityName(citySelect.value);
        var province = normalizeProvinceName(provinceSelect.value || ALLOWED_PROVINCE);

        var nameParts = parseFullName(fullName);
        var fullNameMsg = (
            nameParts.full.length < 3 ||
            nameParts.first.length < 2 ||
            nameParts.last.length < 2
        ) ? "Please enter your full name." : "";
        var emailMsg = !isValidEmail(email) ? "Please enter a valid email." : "";
        var phoneMsg = !isValidPhone(phone) ? "Use 09XXXXXXXXX or +639XXXXXXXXX." : "";
        var streetMsg = !street ? "House / Street is required." : "";
        var barangayMsg = !barangay ? "Barangay is required." : "";
        var cityMsg = !city
            ? "City must be City of Baliwag, San Ildefonso, San Rafael, Pulilan, or Bustos."
            : "";
        var provinceMsg = !province ? "Province must be Bulacan." : "";
        var passwordMsg = !isStrongPassword(password)
            ? "Password must be 8+ chars and include upper, lower, number and symbol."
            : "";
        var confirmPasswordMsg = password !== confirmPassword ? "Passwords do not match." : "";

        setFieldError(fullNameInput, fullNameErr, fullNameMsg, touched.fullName || submitted);
        setFieldError(emailInput, emailErr, emailMsg, touched.email || submitted);
        setFieldError(phoneInput, phoneErr, phoneMsg, touched.phone || submitted);
        setFieldError(streetInput, streetErr, streetMsg, touched.street || submitted);
        setFieldError(barangaySelect, barangayErr, barangayMsg, touched.barangay || submitted);
        setFieldError(citySelect, cityErr, cityMsg, touched.city || submitted);
        setFieldError(provinceSelect, provinceErr, provinceMsg, touched.province || submitted);
        setFieldError(passwordInput, passwordErr, passwordMsg, touched.password || submitted);
        setFieldError(
            confirmPasswordInput,
            confirmPasswordErr,
            confirmPasswordMsg,
            touched.confirmPassword || submitted
        );

        isFormValid = !fullNameMsg
            && !emailMsg
            && !phoneMsg
            && !streetMsg
            && !barangayMsg
            && !cityMsg
            && !provinceMsg
            && !passwordMsg
            && !confirmPasswordMsg;
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

        persistSignupProfile(payload);
        showToast("Account created successfully.", "success");
        window.setTimeout(function () {
            window.location.href = "Userhomefolder/userhome.html";
        }, 850);
    }

    [
        { key: "fullName", input: fullNameInput },
        { key: "email", input: emailInput },
        { key: "phone", input: phoneInput },
        { key: "street", input: streetInput },
        { key: "province", input: provinceSelect },
        { key: "city", input: citySelect },
        { key: "barangay", input: barangaySelect },
        { key: "password", input: passwordInput },
        { key: "confirmPassword", input: confirmPasswordInput }
    ].forEach(function (entry) {
        if (!entry.input) {
            return;
        }
        entry.input.addEventListener("blur", function () {
            touched[entry.key] = true;
            validateForm();
        });
        var handleChange = function () {
            if (entry.key === "email" || entry.key === "phone") {
                resetVerificationState();
            }
            validateForm();
            refreshVerificationUi();
        };
        entry.input.addEventListener("input", handleChange);
        entry.input.addEventListener("change", handleChange);
    });

    bindOtpInputs();

    void initializeLocationSelectors();
    citySelect.addEventListener("change", function () {
        void syncBarangayOptionsByCity(citySelect.value, "");
    });
    provinceSelect.addEventListener("change", function () {
        provinceSelect.value = ALLOWED_PROVINCE;
    });

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
