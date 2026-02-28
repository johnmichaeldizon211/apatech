(function () {
    "use strict";

    const profileBtn = document.querySelector(".profile-menu .profile-btn");
    const dropdown = document.querySelector(".profile-menu .dropdown");
    const serviceButtons = Array.from(document.querySelectorAll(".mini-btn[data-service]"));
    const paymentButtons = Array.from(document.querySelectorAll(".pay-btn[data-payment]"));
    const codPaymentButton = paymentButtons.find(function (button) {
        return (button.getAttribute("data-payment") || "").toUpperCase() === "CASH ON DELIVERY";
    }) || null;
    const formError = document.getElementById("form-error");
    const fullNameInput = document.getElementById("full-name");
    const emailInput = document.getElementById("email");
    const phoneInput = document.getElementById("phone");
    const scheduleDateInput = document.getElementById("schedule-date");
    const scheduleTimeInput = document.getElementById("schedule-time");
    const shipAddressInput = document.getElementById("ship-address");
    const shipLabel = document.querySelector("label[for='ship-address']");
    const shipMapPanel = document.getElementById("ship-map-panel");
    const shipMapFrame = document.getElementById("ship-map-frame");
    const shipMapStatus = document.getElementById("ship-map-status");
    const findAddressBtn = document.getElementById("find-address-btn");
    const useLocationBtn = document.getElementById("use-location-btn");
    const summaryModel = document.getElementById("summary-model");
    const summarySubtitle = document.getElementById("summary-subtitle");
    const summaryImage = document.getElementById("summary-image");
    const subtotalEl = document.getElementById("summary-subtotal");
    const shippingEl = document.getElementById("summary-shipping");
    const totalEl = document.getElementById("summary-total");
    const confirmBtn = document.getElementById("confirm-btn");

    const logoutLink = document.getElementById("booking-logout-link");

    if (logoutLink) {
        logoutLink.addEventListener("click", function (event) {
            event.preventDefault();

            if (window.EcodriveSession && typeof window.EcodriveSession.logout === "function") {
                window.EcodriveSession.logout("../../frontpage.html");
                return;
            }

            ["ecodrive_auth_token", "ecodrive_auth_user", "ecodrive_auth_expires_at", "ecodrive_current_user_email"].forEach(function (key) {
                localStorage.removeItem(key);
                sessionStorage.removeItem(key);
            });
            window.location.href = "../../frontpage.html";
        });
    }

    if (
        !formError ||
        !fullNameInput ||
        !emailInput ||
        !phoneInput ||
        !scheduleDateInput ||
        !scheduleTimeInput ||
        !shipAddressInput ||
        !summaryModel ||
        !summarySubtitle ||
        !summaryImage ||
        !subtotalEl ||
        !shippingEl ||
        !totalEl ||
        !confirmBtn ||
        !shipMapPanel ||
        !shipMapFrame ||
        !shipMapStatus ||
        !findAddressBtn ||
        !useLocationBtn
    ) {
        return;
    }

    const INSTALLMENT_CHECKOUT_KEY = "ecodrive_installment_checkout";
    const INSTALLMENT_FORM_KEY = "ecodrive_installment_form";
    const CURRENT_USER_KEY = "ecodrive_current_user_email";
    const LEGACY_PROFILE_KEY = "ecodrive_profile_settings";
    const PROFILE_STORAGE_PREFIX = "ecodrive_profile_settings::";
    const USERS_KEY = "users";
    const bookingStorageKeys = ["ecodrive_bookings", "ecodrive_orders", "orders"];
    const API_BASE = String(
        localStorage.getItem("ecodrive_api_base")
        || localStorage.getItem("ecodrive_kyc_api_base")
        || (window.EcodriveSession && typeof window.EcodriveSession.getApiBase === "function"
            ? window.EcodriveSession.getApiBase()
            : "")
    )
        .trim()
        .replace(/\/+$/, "");
    const DEFAULT_MAP_COORDS = { lat: 14.5995, lng: 120.9842 };
    const PICKUP_SHOP_ADDRESS = "Poblacion Baliuag beside Southstar Drugs and Xaviery near St. Marys College";
    const PICKUP_SHOP_FALLBACK_COORDS = { lat: 14.9547, lng: 120.9009 };
    const MAX_BOOKINGS_PER_DAY = 5;

    let selectedService = "Delivery";
    let selectedPayment = "CASH ON DELIVERY";
    let shippingCoords = null;
    let rememberedDeliveryAddress = "";
    let rememberedDeliveryCoords = null;
    let lastMappedAddressToken = "";
    let addressDebounceTimer = null;
    let pickupCoords = {
        lat: PICKUP_SHOP_FALLBACK_COORDS.lat,
        lng: PICKUP_SHOP_FALLBACK_COORDS.lng
    };
    let pickupCoordsResolved = false;
    let pickupLookupPromise = null;
    let scheduleDateAvailabilityRequestId = 0;
    let bookingSubmitInFlight = false;
    const confirmBtnDefaultLabel = confirmBtn.textContent;

    if (profileBtn && dropdown) {
        profileBtn.addEventListener("click", function (event) {
            event.stopPropagation();
            dropdown.classList.toggle("show");
        });

        dropdown.addEventListener("click", function (event) {
            event.stopPropagation();
        });

        document.addEventListener("click", function () {
            dropdown.classList.remove("show");
        });
    }

    function safeParse(raw) {
        try {
            return JSON.parse(raw);
        } catch (_error) {
            return null;
        }
    }

    function getApiUrl(path) {
        return API_BASE ? `${API_BASE}${path}` : path;
    }

    function buildApiHeaders(baseHeaders) {
        const headers = Object.assign({}, baseHeaders || {});
        const token = (window.EcodriveSession && typeof window.EcodriveSession.getToken === "function")
            ? String(window.EcodriveSession.getToken() || "").trim()
            : "";
        if (token) {
            headers.Authorization = "Bearer " + token;
        }
        return headers;
    }

    function formatPeso(amount) {
        const value = Number(amount || 0);
        return "&#8369;" + value.toLocaleString("en-PH", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function normalizeColorLabel(value) {
        const cleaned = String(value || "")
            .replace(/\bcolor\b/ig, "")
            .replace(/[_-]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        if (!cleaned) {
            return "";
        }
        return cleaned.split(" ").map(function (token) {
            if (!token) {
                return "";
            }
            return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
        }).join(" ");
    }

    function normalizePhoneValue(phone) {
        const cleaned = String(phone || "").trim().replace(/[\s-]/g, "");
        if (/^\+639\d{9}$/.test(cleaned)) {
            return "0" + cleaned.slice(3);
        }
        if (/^639\d{9}$/.test(cleaned)) {
            return "0" + cleaned.slice(2);
        }
        return cleaned;
    }

    function padNumber(value) {
        return String(Number(value) || 0).padStart(2, "0");
    }

    function formatLocalDateInputValue(date) {
        const value = date instanceof Date ? date : new Date();
        const year = value.getFullYear();
        const month = padNumber(value.getMonth() + 1);
        const day = padNumber(value.getDate());
        return `${year}-${month}-${day}`;
    }

    function parseScheduleDateTime(dateValue, timeValue) {
        const dateText = String(dateValue || "").trim();
        const timeText = String(timeValue || "").trim();
        if (!dateText || !timeText) {
            return null;
        }

        const scheduleDate = new Date(`${dateText}T${timeText}:00`);
        if (Number.isNaN(scheduleDate.getTime())) {
            return null;
        }
        return scheduleDate;
    }

    function formatScheduleLabel(dateValue, timeValue) {
        const scheduleDate = parseScheduleDateTime(dateValue, timeValue);
        if (!scheduleDate) {
            return "";
        }

        return scheduleDate.toLocaleString("en-PH", {
            month: "long",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true
        });
    }

    function initializeScheduleInputs() {
        const now = new Date();
        const minimumDateValue = formatLocalDateInputValue(now);
        scheduleDateInput.min = minimumDateValue;

        if (!scheduleDateInput.value) {
            const defaultDate = new Date(now);
            defaultDate.setDate(defaultDate.getDate() + 1);
            scheduleDateInput.value = formatLocalDateInputValue(defaultDate);
        }

        if (!scheduleTimeInput.value) {
            scheduleTimeInput.value = "09:00";
        }
    }

    function formatScheduleDateDisplay(dateValue) {
        const normalized = String(dateValue || "").trim();
        if (!normalized) {
            return "the selected date";
        }

        const parsed = new Date(`${normalized}T00:00:00`);
        if (Number.isNaN(parsed.getTime())) {
            return normalized;
        }
        return parsed.toLocaleDateString("en-PH", {
            month: "long",
            day: "numeric",
            year: "numeric"
        });
    }

    function buildDateLimitMessage(dateValue, maxBookingsPerDay) {
        const maxPerDay = Number(maxBookingsPerDay || MAX_BOOKINGS_PER_DAY);
        return `Maximum booking limit reached for ${formatScheduleDateDisplay(dateValue)} (${maxPerDay} per day). Please choose another date.`;
    }

    async function fetchScheduleDateAvailability(dateValue) {
        const normalizedDate = String(dateValue || "").trim();
        if (!normalizedDate) {
            return {
                success: true,
                available: true,
                currentBookings: 0,
                maxBookingsPerDay: MAX_BOOKINGS_PER_DAY,
                message: ""
            };
        }

        try {
            const response = await fetch(getApiUrl(`/api/bookings/availability?date=${encodeURIComponent(normalizedDate)}`), {
                method: "GET",
                headers: buildApiHeaders({
                    "Accept": "application/json"
                })
            });

            if (response.status === 404 || response.status === 405) {
                return {
                    success: true,
                    available: true,
                    currentBookings: 0,
                    maxBookingsPerDay: MAX_BOOKINGS_PER_DAY,
                    message: ""
                };
            }

            if (response.status === 401 || response.status === 403) {
                return {
                    success: false,
                    available: true,
                    message: "Your session has expired. Please log in again."
                };
            }

            const payload = await response.json().catch(function () {
                return {};
            });

            if (!response.ok || !payload || payload.success !== true) {
                return {
                    success: false,
                    available: true,
                    message: String((payload && payload.message) || "Unable to check booking availability right now.")
                };
            }

            const maxPerDay = Number(payload.maxBookingsPerDay || MAX_BOOKINGS_PER_DAY);
            const currentBookings = Number(payload.currentBookings || 0);
            const available = payload.available !== false && currentBookings < maxPerDay;
            return {
                success: true,
                available: available,
                currentBookings: currentBookings,
                maxBookingsPerDay: maxPerDay,
                message: String(payload.message || "")
            };
        } catch (_error) {
            return {
                success: false,
                available: true,
                message: "Unable to check booking availability right now."
            };
        }
    }

    async function ensureScheduleDateAvailable(options) {
        const settings = (options && typeof options === "object") ? options : {};
        const dateValue = String((settings.dateValue !== undefined ? settings.dateValue : scheduleDateInput.value) || "").trim();
        if (!dateValue) {
            return true;
        }

        const requestId = ++scheduleDateAvailabilityRequestId;
        const result = await fetchScheduleDateAvailability(dateValue);
        if (requestId !== scheduleDateAvailabilityRequestId) {
            return true;
        }

        if (!result.success) {
            if (settings.showErrors) {
                showError(scheduleDateInput, result.message || "Unable to check booking availability right now.");
            }
            return false;
        }

        if (!result.available) {
            if (settings.resetDateOnLimit) {
                scheduleDateInput.value = "";
            }
            showError(
                scheduleDateInput,
                result.message || buildDateLimitMessage(dateValue, result.maxBookingsPerDay)
            );
            if (settings.focusInput) {
                scheduleDateInput.focus();
            }
            return false;
        }

        scheduleDateInput.classList.remove("invalid");
        return true;
    }

    function getCurrentUserEmail() {
        const localValue = (localStorage.getItem(CURRENT_USER_KEY) || "").trim().toLowerCase();
        if (localValue) return localValue;
        return (sessionStorage.getItem(CURRENT_USER_KEY) || "").trim().toLowerCase();
    }

    function getProfileStorageKey(emailValue) {
        const email = String(emailValue || "").trim().toLowerCase();
        return email ? PROFILE_STORAGE_PREFIX + email : LEGACY_PROFILE_KEY;
    }

    function getUsers() {
        const parsed = safeParse(localStorage.getItem(USERS_KEY));
        return Array.isArray(parsed) ? parsed : [];
    }

    function getCurrentUserFromUsers(emailValue) {
        const email = String(emailValue || "").trim().toLowerCase();
        if (!email) return null;
        const users = getUsers();
        return users.find(function (user) {
            return String((user && user.email) || "").trim().toLowerCase() === email;
        }) || null;
    }

    function buildNameFromUser(user) {
        if (!user || typeof user !== "object") return "";
        if (user.name) {
            return String(user.name).trim();
        }
        const first = String(user.firstName || "").trim();
        const middle = String(user.middleInitial || "").trim();
        const last = String(user.lastName || "").trim();
        const middleWithDot = middle ? middle.replace(/\.+$/, "") + "." : "";
        return [first, middleWithDot, last].filter(Boolean).join(" ").trim();
    }

    function getCurrentUserProfile() {
        const currentEmail = getCurrentUserEmail();
        const user = getCurrentUserFromUsers(currentEmail);
        const scopedProfile = safeParse(localStorage.getItem(getProfileStorageKey(currentEmail)));
        const legacyProfile = safeParse(localStorage.getItem(LEGACY_PROFILE_KEY));
        const profile = (scopedProfile && typeof scopedProfile === "object")
            ? scopedProfile
            : ((legacyProfile && typeof legacyProfile === "object") ? legacyProfile : {});

        return {
            fullName: String(
                profile.fullName ||
                profile.name ||
                buildNameFromUser(user) ||
                ""
            ).trim(),
            email: String(
                profile.email ||
                (user && user.email) ||
                currentEmail ||
                ""
            ).trim().toLowerCase(),
            phone: normalizePhoneValue(
                profile.phone ||
                (user && user.phone) ||
                ""
            ),
            address: String(
                profile.address ||
                (user && user.address) ||
                ""
            ).trim()
        };
    }

    function seedCustomerInfo() {
        const profile = getCurrentUserProfile();

        if (profile.fullName && !fullNameInput.value) {
            fullNameInput.value = profile.fullName;
        }
        if (profile.email && !emailInput.value) {
            emailInput.value = profile.email;
        }
        if (profile.phone && !phoneInput.value) {
            phoneInput.value = profile.phone;
        }
        if (profile.address) {
            rememberedDeliveryAddress = profile.address;
            if (!shipAddressInput.value) {
                shipAddressInput.value = profile.address;
            }
        }
    }

    function getFallbackBikeByReferrer() {
        const referrer = document.referrer || "";
        const match = referrer.match(/ebike(\d+)\.0\.html/i);
        const id = match ? Number(match[1]) : 0;
        const map = {
            1: { model: "BLITZ 2000", total: 68000, image: "../image 1.png", subtitle: "2-Wheel" },
            2: { model: "BLITZ 1200", total: 45000, image: "../image 2.png", subtitle: "2-Wheel" },
            3: { model: "FUN 1500 FI", total: 24000, image: "../image 3.png", subtitle: "2-Wheel" },
            4: { model: "CANDY 800", total: 39000, image: "../image 4.png", subtitle: "2-Wheel" },
            5: { model: "BLITZ 200R", total: 40000, image: "../image 5.png", subtitle: "2-Wheel" },
            6: { model: "TRAVELLER 1500", total: 78000, image: "../image 6.png", subtitle: "2-Wheel" },
            7: { model: "ECONO 500 MP", total: 51000, image: "../image 7.png", subtitle: "2-Wheel" },
            8: { model: "ECONO 350 MINI-II", total: 39000, image: "../image 8.png", subtitle: "2-Wheel" },
            9: { model: "ECARGO 100", total: 72500, image: "../image 9.png", subtitle: "3-Wheel" },
            10: { model: "ECONO 650 MP", total: 65000, image: "../image 10.png", subtitle: "3-Wheel" },
            11: { model: "ECAB 100V V2", total: 51500, image: "../image 11.png", subtitle: "3-Wheel" },
            12: { model: "ECONO 800 MP II", total: 67000, image: "../image 12.png", subtitle: "3-Wheel" },
            13: { model: "E-CARGO 800", total: 65000, image: "../image 13.png", subtitle: "4-Wheel" },
            14: { model: "E-CAB MAX 1500", total: 130000, image: "../image 14.png", subtitle: "4-Wheel" },
            15: { model: "E-CAB 1000", total: 75000, image: "../image 15.png", subtitle: "4-Wheel" },
            16: { model: "ECONO 800 MP", total: 60000, image: "../image 16.png", subtitle: "4-Wheel" }
        };
        return map[id] || null;
    }

    function extractSelection(value) {
        if (!value || typeof value !== "object") return null;
        const model = String(value.model || value.productName || value.itemName || value.name || "").trim();
        const subtotal = Number(value.total || value.price || value.amount || 0);
        const image = String(value.bikeImage || value.image || value.img || "").trim();
        const subtitle = String(value.subtitle || value.category || value.type || "").trim();
        const bikeColor = normalizeColorLabel(value.bikeColor || value.color || value.selectedColor || "");

        if (!model && !subtotal && !image) return null;
        return {
            model: model || "Ecodrive E-Bike",
            total: Number.isFinite(subtotal) && subtotal > 0 ? subtotal : 0,
            image: image || "../image 1.png",
            subtitle: subtitle || "E-Bike",
            bikeColor: bikeColor
        };
    }

    function getSelectedBike() {
        const params = new URLSearchParams(window.location.search);
        const queryModel = params.get("model");
        const queryTotal = Number(params.get("total") || params.get("price") || 0);
        const queryImage = params.get("image");
        const querySubtitle = params.get("subtitle") || params.get("category");
        const queryColor = normalizeColorLabel(params.get("bikeColor") || params.get("color") || params.get("selectedColor"));
        if (queryModel || queryTotal || queryImage) {
            return {
                model: String(queryModel || "Ecodrive E-Bike"),
                total: Number.isFinite(queryTotal) && queryTotal > 0 ? queryTotal : 68000,
                image: String(queryImage || "../image 1.png"),
                subtitle: String(querySubtitle || "E-Bike"),
                bikeColor: queryColor
            };
        }

        const candidates = [
            safeParse(localStorage.getItem("ecodrive_checkout_selection")),
            safeParse(localStorage.getItem("ecodrive_selected_bike")),
            safeParse(localStorage.getItem("selectedBike")),
            safeParse(localStorage.getItem("checkout_selection")),
            safeParse(localStorage.getItem("latestBooking"))
        ];

        for (let i = 0; i < candidates.length; i += 1) {
            const selected = extractSelection(candidates[i]);
            if (selected) return selected;
        }

        const fallback = getFallbackBikeByReferrer();
        if (fallback) return fallback;

        return {
            model: "Ecodrive E-Bike",
            total: 68000,
            image: "../image 1.png",
            subtitle: "E-Bike",
            bikeColor: ""
        };
    }

    function getMapEmbedUrl(lat, lng) {
        const x = Number(lng || 0);
        const y = Number(lat || 0);
        const delta = 0.01;
        const left = (x - delta).toFixed(6);
        const bottom = (y - delta).toFixed(6);
        const right = (x + delta).toFixed(6);
        const top = (y + delta).toFixed(6);
        const markerLat = y.toFixed(6);
        const markerLng = x.toFixed(6);
        return "https://www.openstreetmap.org/export/embed.html?bbox="
            + encodeURIComponent(left + "," + bottom + "," + right + "," + top)
            + "&layer=mapnik&marker="
            + encodeURIComponent(markerLat + "," + markerLng);
    }

    function getMapPageUrl(lat, lng) {
        const markerLat = Number(lat || 0).toFixed(6);
        const markerLng = Number(lng || 0).toFixed(6);
        return "https://www.openstreetmap.org/?mlat="
            + encodeURIComponent(markerLat)
            + "&mlon="
            + encodeURIComponent(markerLng)
            + "#map=18/"
            + encodeURIComponent(markerLat)
            + "/"
            + encodeURIComponent(markerLng);
    }

    function setAddressLabel(text) {
        if (shipLabel) {
            shipLabel.textContent = String(text || "");
        }
    }

    function setShippingCoords(lat, lng) {
        const nextLat = Number(lat);
        const nextLng = Number(lng);
        if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) {
            return false;
        }
        shippingCoords = {
            lat: Number(nextLat.toFixed(6)),
            lng: Number(nextLng.toFixed(6))
        };
        return true;
    }

    function applyPickupLocationState(statusMessage) {
        shipAddressInput.disabled = false;
        shipAddressInput.readOnly = true;
        shipAddressInput.value = PICKUP_SHOP_ADDRESS;
        shipAddressInput.placeholder = PICKUP_SHOP_ADDRESS;
        setMapEnabled(true);
        findAddressBtn.textContent = "Open Shop Map";
        useLocationBtn.disabled = true;
        setShippingCoords(pickupCoords.lat, pickupCoords.lng);
        renderMapFrame(pickupCoords.lat, pickupCoords.lng);
        lastMappedAddressToken = PICKUP_SHOP_ADDRESS.toLowerCase();
        setMapStatus(statusMessage || "Pick up location pinned to Ecodrive shop.", false);
    }

    async function fetchAddressCoordinates(address) {
        const trimmed = String(address || "").trim();
        if (!trimmed) {
            throw new Error("Address is required.");
        }

        const params = new URLSearchParams({
            format: "jsonv2",
            limit: "1",
            countrycodes: "ph",
            q: trimmed
        });
        const response = await fetch("https://nominatim.openstreetmap.org/search?" + params.toString(), {
            method: "GET",
            headers: { "Accept": "application/json" }
        });

        if (!response.ok) {
            throw new Error("Map service is unavailable right now.");
        }

        const rows = await response.json();
        if (!Array.isArray(rows) || rows.length < 1) {
            throw new Error("Location not found. Please make your address more specific.");
        }

        const row = rows[0];
        const lat = Number(row.lat);
        const lng = Number(row.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            throw new Error("Map service returned invalid coordinates.");
        }

        return {
            lat: lat,
            lng: lng
        };
    }

    async function resolvePickupCoordinates() {
        if (pickupCoordsResolved) {
            return pickupCoords;
        }
        if (pickupLookupPromise) {
            return pickupLookupPromise;
        }

        pickupLookupPromise = fetchAddressCoordinates(PICKUP_SHOP_ADDRESS)
            .then(function (coords) {
                pickupCoords = {
                    lat: Number(coords.lat.toFixed(6)),
                    lng: Number(coords.lng.toFixed(6))
                };
                pickupCoordsResolved = true;
                return pickupCoords;
            })
            .catch(function () {
                return null;
            })
            .finally(function () {
                pickupLookupPromise = null;
            });

        return pickupLookupPromise;
    }

    function renderMapFrame(lat, lng) {
        shipMapFrame.src = getMapEmbedUrl(lat, lng);
    }

    function setMapStatus(message, isError) {
        shipMapStatus.textContent = message || "";
        shipMapStatus.classList.toggle("error", Boolean(isError));
    }

    function setMapEnabled(enabled) {
        shipMapPanel.classList.toggle("disabled", !enabled);
        findAddressBtn.disabled = !enabled;
        useLocationBtn.disabled = !enabled;
    }

    function rememberCurrentDeliveryState() {
        const address = (shipAddressInput.value || "").trim();
        if (address) {
            rememberedDeliveryAddress = address;
        }
        if (shippingCoords && Number.isFinite(shippingCoords.lat) && Number.isFinite(shippingCoords.lng)) {
            rememberedDeliveryCoords = {
                lat: shippingCoords.lat,
                lng: shippingCoords.lng
            };
        }
    }

    function updateMapFrame(lat, lng, statusMessage) {
        const nextLat = Number(lat);
        const nextLng = Number(lng);
        if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) {
            return false;
        }

        shippingCoords = {
            lat: Number(nextLat.toFixed(6)),
            lng: Number(nextLng.toFixed(6))
        };
        rememberedDeliveryCoords = {
            lat: shippingCoords.lat,
            lng: shippingCoords.lng
        };
        renderMapFrame(nextLat, nextLng);
        if (statusMessage) {
            setMapStatus(statusMessage, false);
        }
        return true;
    }

    function markAddressAsChanged() {
        const currentToken = (shipAddressInput.value || "").trim().toLowerCase();
        if (!currentToken || currentToken === lastMappedAddressToken) {
            return;
        }
        shippingCoords = null;
        rememberedDeliveryCoords = null;
        setMapStatus("Address changed. Click Find on Map to refresh location.", false);
    }

    async function geocodeAddress(address, options) {
        const trimmed = String(address || "").trim();
        const silent = options && options.silent === true;
        if (!trimmed) {
            return null;
        }

        if (!silent) {
            setMapStatus("Finding address on map...", false);
        }

        try {
            const coords = await fetchAddressCoordinates(trimmed);
            const lat = Number(coords.lat);
            const lng = Number(coords.lng);

            updateMapFrame(lat, lng, "Location found on map.");
            rememberedDeliveryAddress = trimmed;
            lastMappedAddressToken = trimmed.toLowerCase();
            return {
                lat: lat,
                lng: lng
            };
        } catch (error) {
            if (!silent) {
                setMapStatus(error.message || "Unable to find this address right now.", true);
            }
            return null;
        }
    }

    async function reverseGeocode(lat, lng) {
        const params = new URLSearchParams({
            format: "jsonv2",
            lat: String(lat),
            lon: String(lng)
        });
        const response = await fetch("https://nominatim.openstreetmap.org/reverse?" + params.toString(), {
            method: "GET",
            headers: { "Accept": "application/json" }
        });
        if (!response.ok) {
            return "";
        }
        const payload = await response.json();
        return String((payload && payload.display_name) || "").trim();
    }

    function scheduleAddressMapLookup() {
        if (addressDebounceTimer) {
            clearTimeout(addressDebounceTimer);
        }
        addressDebounceTimer = setTimeout(function () {
            if (selectedService !== "Delivery") {
                return;
            }
            const value = (shipAddressInput.value || "").trim();
            if (value.length < 8) {
                return;
            }
            geocodeAddress(value, { silent: true });
        }, 850);
    }

    const selectedBike = getSelectedBike();

    function updateSummary() {
        const subtotal = Number(selectedBike.total || 0);
        const shippingFee = selectedService === "Delivery" ? 250 : 0;
        const grandTotal = subtotal + shippingFee;

        summaryModel.textContent = selectedBike.model.toUpperCase();
        summarySubtitle.textContent = (selectedBike.subtitle || "E-Bike") + (selectedBike.bikeColor ? (" | " + selectedBike.bikeColor) : "");
        summaryImage.src = selectedBike.image || "../image 1.png";
        subtotalEl.innerHTML = formatPeso(subtotal);
        shippingEl.innerHTML = formatPeso(shippingFee);
        totalEl.innerHTML = formatPeso(grandTotal);
        syncPaymentAvailability();

        if (selectedService === "Delivery") {
            setAddressLabel("Shipping Address");
            shipAddressInput.disabled = false;
            shipAddressInput.readOnly = false;
            shipAddressInput.placeholder = "Enter shipping address";
            setMapEnabled(true);
            findAddressBtn.textContent = "Find on Map";
            useLocationBtn.disabled = false;

            if ((shipAddressInput.value || "").trim() === PICKUP_SHOP_ADDRESS) {
                shipAddressInput.value = rememberedDeliveryAddress || "";
                shippingCoords = rememberedDeliveryCoords
                    ? {
                        lat: rememberedDeliveryCoords.lat,
                        lng: rememberedDeliveryCoords.lng
                    }
                    : null;
            }

            if (!shipAddressInput.value && rememberedDeliveryAddress) {
                shipAddressInput.value = rememberedDeliveryAddress;
            }

            if (!shippingCoords && rememberedDeliveryCoords) {
                updateMapFrame(rememberedDeliveryCoords.lat, rememberedDeliveryCoords.lng, "Delivery location restored.");
            } else if (!shippingCoords) {
                setMapStatus("Map preview updates when you change the address.", false);
            }
            return;
        }

        if (selectedService === "Pick Up") {
            setAddressLabel("Pick Up Location");
            applyPickupLocationState("Pick up location pinned to Ecodrive shop.");
            void resolvePickupCoordinates().then(function (coords) {
                if (coords && selectedService === "Pick Up") {
                    applyPickupLocationState("Pick up location pinned to Ecodrive shop.");
                }
            });
            return;
        }

        setAddressLabel("Shipping Address");
        shipAddressInput.readOnly = true;
        shipAddressInput.disabled = true;
        shipAddressInput.value = "";
        shippingCoords = null;
        lastMappedAddressToken = "";
        setMapEnabled(false);
        findAddressBtn.textContent = "Find on Map";

        if (selectedService === "Installment") {
            shipAddressInput.placeholder = "Installment flow will continue";
            setMapStatus("Shipping map is not required for installment.", false);
        } else {
            shipAddressInput.placeholder = "Not needed";
            setMapStatus("Shipping map is not required.", false);
        }
    }

    function clearError() {
        formError.textContent = "";
        [fullNameInput, emailInput, phoneInput, scheduleDateInput, scheduleTimeInput, shipAddressInput].forEach(function (input) {
            input.classList.remove("invalid");
        });
    }

    function showError(input, message) {
        if (input) input.classList.add("invalid");
        formError.textContent = message;
    }

    function setActiveButton(buttons, activeBtn) {
        buttons.forEach(function (button) {
            button.classList.toggle("active", button === activeBtn);
        });
    }

    function findPreferredPaymentButton() {
        const preference = ["CASH ON DELIVERY", "INSTALLMENT"];
        for (let i = 0; i < preference.length; i += 1) {
            const target = preference[i];
            const button = paymentButtons.find(function (item) {
                return !item.disabled && (item.getAttribute("data-payment") || "").toUpperCase() === target;
            });
            if (button) {
                return button;
            }
        }
        return paymentButtons.find(function (button) {
            return !button.disabled;
        }) || null;
    }

    function syncPaymentAvailability() {
        const codBlocked = selectedService === "Pick Up";
        if (codPaymentButton) {
            codPaymentButton.disabled = codBlocked;
            codPaymentButton.setAttribute("aria-disabled", codBlocked ? "true" : "false");
        }

        const activePaymentButton = paymentButtons.find(function (button) {
            return !button.disabled && (button.getAttribute("data-payment") || "") === selectedPayment;
        }) || null;

        if (activePaymentButton) {
            setActiveButton(paymentButtons, activePaymentButton);
            return;
        }

        const fallbackButton = findPreferredPaymentButton();
        if (fallbackButton) {
            selectedPayment = fallbackButton.getAttribute("data-payment") || "CASH ON DELIVERY";
            setActiveButton(paymentButtons, fallbackButton);
            return;
        }

        selectedPayment = "CASH ON DELIVERY";
        setActiveButton(paymentButtons, null);
    }

    function setBookingSubmitState(inFlight) {
        bookingSubmitInFlight = Boolean(inFlight);
        confirmBtn.disabled = bookingSubmitInFlight;
        confirmBtn.textContent = bookingSubmitInFlight ? "Saving..." : confirmBtnDefaultLabel;
    }

    function appendRecordToStorage(storageKey, record) {
        const parsed = safeParse(localStorage.getItem(storageKey));
        const list = Array.isArray(parsed) ? parsed : [];
        const incomingOrderId = String((record && (record.orderId || record.id)) || "")
            .trim()
            .toLowerCase();

        if (incomingOrderId) {
            const existingIndex = list.findIndex(function (item) {
                const itemOrderId = String((item && (item.orderId || item.id)) || "")
                    .trim()
                    .toLowerCase();
                return itemOrderId === incomingOrderId;
            });

            if (existingIndex >= 0) {
                list[existingIndex] = Object.assign({}, list[existingIndex], record);
                localStorage.setItem(storageKey, JSON.stringify(list));
                return;
            }
        }

        list.push(record);
        localStorage.setItem(storageKey, JSON.stringify(list));
    }

    function removeRecordsByOrderIds(storageKey, orderIds) {
        const ids = Array.isArray(orderIds)
            ? orderIds
                .map(function (value) {
                    return String(value || "").trim().toLowerCase();
                })
                .filter(Boolean)
            : [];
        if (!ids.length) {
            return;
        }

        const parsed = safeParse(localStorage.getItem(storageKey));
        if (!Array.isArray(parsed)) {
            return;
        }

        const next = parsed.filter(function (item) {
            const itemOrderId = String((item && (item.orderId || item.id)) || "")
                .trim()
                .toLowerCase();
            return !itemOrderId || !ids.includes(itemOrderId);
        });
        localStorage.setItem(storageKey, JSON.stringify(next));
    }

    async function saveBookingToApi(record) {
        try {
            const response = await fetch(getApiUrl("/api/bookings"), {
                method: "POST",
                headers: buildApiHeaders({
                    "Content-Type": "application/json"
                }),
                body: JSON.stringify(record)
            });

            if (response.status === 404 || response.status === 405) {
                return {
                    success: false,
                    message: "Booking service is currently unavailable."
                };
            }

            if (response.status === 401 || response.status === 403) {
                return {
                    success: false,
                    message: "Your session has expired. Please log in again."
                };
            }

            const payload = await response.json().catch(function () {
                return {};
            });
            if (!response.ok || !payload || payload.success !== true) {
                return {
                    success: false,
                    message: String((payload && payload.message) || "Unable to sync booking to server.")
                };
            }

            return {
                success: true,
                message: "",
                booking: payload.booking && typeof payload.booking === "object"
                    ? payload.booking
                    : null
            };
        } catch (_error) {
            return {
                success: false,
                message: "Network error while saving booking. Please try again."
            };
        }
    }

    async function saveBooking(record) {
        const apiResult = await saveBookingToApi(record);
        if (!apiResult || apiResult.success !== true) {
            return apiResult || { success: false, message: "Unable to sync booking to server." };
        }

        const persistedRecord = apiResult.booking && typeof apiResult.booking === "object"
            ? Object.assign({}, record, apiResult.booking)
            : Object.assign({}, record);
        const removeOrderIds = [record && record.orderId, persistedRecord && persistedRecord.orderId];

        bookingStorageKeys.forEach(function (key) {
            removeRecordsByOrderIds(key, removeOrderIds);
            appendRecordToStorage(key, persistedRecord);
        });
        localStorage.setItem("latestBooking", JSON.stringify(persistedRecord));
        return { success: true, message: "", booking: persistedRecord };
    }

    function buildOrderDraft() {
        const subtotal = Number(selectedBike.total || 0);
        const shippingFee = selectedService === "Delivery" ? 250 : 0;
        const orderId = "EC-" + Date.now();
        const isInstallmentPayment = selectedPayment === "INSTALLMENT";
        const scheduleDate = (scheduleDateInput.value || "").trim();
        const scheduleTime = (scheduleTimeInput.value || "").trim();
        const scheduleDateTime = parseScheduleDateTime(scheduleDate, scheduleTime);
        const hasDeliveryCoordinates = selectedService === "Delivery"
            && shippingCoords
            && Number.isFinite(shippingCoords.lat)
            && Number.isFinite(shippingCoords.lng);
        const hasPickupCoordinates = selectedService === "Pick Up"
            && shippingCoords
            && Number.isFinite(shippingCoords.lat)
            && Number.isFinite(shippingCoords.lng);
        const hasShippingCoordinates = hasDeliveryCoordinates || hasPickupCoordinates;
        const shippingAddress = selectedService === "Delivery"
            ? (shipAddressInput.value || "").trim()
            : (selectedService === "Pick Up" ? PICKUP_SHOP_ADDRESS : "");

        return {
            orderId: orderId,
            fullName: (fullNameInput.value || "").trim(),
            email: (emailInput.value || "").trim().toLowerCase(),
            phone: normalizePhoneValue(phoneInput.value || ""),
            model: selectedBike.model,
            bikeColor: normalizeColorLabel(selectedBike.bikeColor || selectedBike.color || ""),
            color: normalizeColorLabel(selectedBike.bikeColor || selectedBike.color || ""),
            bikeImage: selectedBike.image,
            subtotal: subtotal,
            shippingFee: shippingFee,
            total: subtotal + shippingFee,
            payment: isInstallmentPayment ? "Installment" : selectedPayment,
            service: selectedService,
            status: isInstallmentPayment ? "Application Review" : "Pending review",
            fulfillmentStatus: isInstallmentPayment
                ? "Under Review"
                : (selectedService === "Pick Up" ? "Ready to Pick up" : "In Process"),
            scheduleDate: scheduleDate,
            scheduleTime: scheduleTime,
            bookingDate: scheduleDate,
            bookingTime: scheduleTime,
            date: scheduleDate,
            time: scheduleTime,
            scheduledAt: scheduleDateTime ? scheduleDateTime.toISOString() : "",
            scheduleLabel: formatScheduleLabel(scheduleDate, scheduleTime),
            shippingAddress: shippingAddress,
            shippingCoordinates: hasShippingCoordinates ? { lat: shippingCoords.lat, lng: shippingCoords.lng } : null,
            shippingMapEmbedUrl: hasShippingCoordinates ? getMapEmbedUrl(shippingCoords.lat, shippingCoords.lng) : "",
            userEmail: getCurrentUserEmail(),
            createdAt: new Date().toISOString()
        };
    }

    function validateInputs() {
        clearError();

        const name = (fullNameInput.value || "").trim();
        const email = (emailInput.value || "").trim();
        const phone = normalizePhoneValue(phoneInput.value || "");
        const scheduleDate = (scheduleDateInput.value || "").trim();
        const scheduleTime = (scheduleTimeInput.value || "").trim();

        if (!name) {
            showError(fullNameInput, "Please enter your full name.");
            return false;
        }
        if (!email) {
            showError(emailInput, "Please enter your email.");
            return false;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            showError(emailInput, "Please enter a valid email address.");
            return false;
        }
        if (!/^09\d{9}$/.test(phone)) {
            showError(phoneInput, "Please enter a valid mobile number.");
            return false;
        }
        if (!scheduleDate) {
            showError(scheduleDateInput, "Please select your preferred booking date.");
            return false;
        }
        if (!scheduleTime) {
            showError(scheduleTimeInput, "Please select your preferred booking time.");
            return false;
        }

        const scheduleDateTime = parseScheduleDateTime(scheduleDate, scheduleTime);
        if (!scheduleDateTime) {
            showError(scheduleTimeInput, "Please provide a valid booking schedule.");
            return false;
        }
        if (scheduleDateTime.getTime() < Date.now()) {
            showError(scheduleTimeInput, "Please select a future date and time for your booking.");
            return false;
        }

        if (selectedService === "Delivery") {
            const address = (shipAddressInput.value || "").trim();
            if (!address) {
                showError(shipAddressInput, "Shipping address is required for delivery.");
                return false;
            }
        }

        return true;
    }

    serviceButtons.forEach(function (button) {
        button.addEventListener("click", function () {
            const nextService = button.getAttribute("data-service") || "Delivery";
            if (selectedService === "Delivery" && nextService !== "Delivery") {
                rememberCurrentDeliveryState();
            }

            selectedService = nextService;
            setActiveButton(serviceButtons, button);
            updateSummary();
            clearError();
        });
    });

    paymentButtons.forEach(function (button) {
        button.addEventListener("click", function () {
            if (button.disabled) {
                return;
            }
            selectedPayment = button.getAttribute("data-payment") || "CASH ON DELIVERY";
            setActiveButton(paymentButtons, button);
            clearError();
        });
    });

    scheduleDateInput.addEventListener("change", async function () {
        const selectedDate = (scheduleDateInput.value || "").trim();
        if (!selectedDate) {
            return;
        }
        await ensureScheduleDateAvailable({
            dateValue: selectedDate,
            showErrors: true,
            resetDateOnLimit: true,
            focusInput: true
        });
    });

    shipAddressInput.addEventListener("input", function () {
        if (selectedService !== "Delivery") {
            return;
        }
        markAddressAsChanged();
        scheduleAddressMapLookup();
    });

    shipAddressInput.addEventListener("blur", function () {
        if (selectedService !== "Delivery") {
            return;
        }
        const address = (shipAddressInput.value || "").trim();
        if (!address || shippingCoords) {
            return;
        }
        geocodeAddress(address, { silent: true });
    });

    findAddressBtn.addEventListener("click", async function () {
        if (selectedService === "Pick Up") {
            applyPickupLocationState("Pick up location pinned to Ecodrive shop.");
            window.open(getMapPageUrl(pickupCoords.lat, pickupCoords.lng), "_blank", "noopener");
            void resolvePickupCoordinates().then(function (coords) {
                if (coords && selectedService === "Pick Up") {
                    applyPickupLocationState("Pick up location pinned to Ecodrive shop.");
                }
            });
            return;
        }

        if (selectedService !== "Delivery") {
            return;
        }

        const address = (shipAddressInput.value || "").trim();
        if (!address) {
            setMapStatus("Enter a shipping address first.", true);
            shipAddressInput.focus();
            return;
        }

        await geocodeAddress(address, { silent: false });
    });

    useLocationBtn.addEventListener("click", function () {
        if (selectedService !== "Delivery") {
            return;
        }

        if (!navigator.geolocation) {
            setMapStatus("Geolocation is not supported in this browser.", true);
            return;
        }

        setMapStatus("Getting your current location...", false);
        navigator.geolocation.getCurrentPosition(
            async function (position) {
                const lat = Number(position.coords.latitude);
                const lng = Number(position.coords.longitude);
                updateMapFrame(lat, lng, "Current location pinned on map.");

                try {
                    const resolvedAddress = await reverseGeocode(lat, lng);
                    if (resolvedAddress) {
                        shipAddressInput.value = resolvedAddress;
                        rememberedDeliveryAddress = resolvedAddress;
                        lastMappedAddressToken = resolvedAddress.toLowerCase();
                        setMapStatus("Current location and address loaded.", false);
                    }
                } catch (_error) {
                    setMapStatus("Location pinned, but address lookup is unavailable.", false);
                }
            },
            function (error) {
                if (error && error.code === error.PERMISSION_DENIED) {
                    setMapStatus("Location access denied. Enable location permission to use this feature.", true);
                    return;
                }
                setMapStatus("Unable to get your current location right now.", true);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    });

    confirmBtn.addEventListener("click", async function () {
        if (bookingSubmitInFlight) {
            return;
        }
        setBookingSubmitState(true);
        try {
            if (!validateInputs()) {
                return;
            }
            if (selectedService === "Pick Up" && selectedPayment === "CASH ON DELIVERY") {
                syncPaymentAvailability();
                showError(null, "Cash on Delivery is not available for Pick up.");
                return;
            }

            const isDateAvailable = await ensureScheduleDateAvailable({
                showErrors: true,
                resetDateOnLimit: true,
                focusInput: true
            });
            if (!isDateAvailable) {
                return;
            }

            if (selectedService === "Delivery" && !shippingCoords) {
                const resolved = await geocodeAddress(shipAddressInput.value, { silent: false });
                if (!resolved) {
                    showError(shipAddressInput, "Please select a valid shipping location from the map.");
                    return;
                }
            }

            const order = buildOrderDraft();

            if (String(order.payment || "").toLowerCase().includes("installment")) {
                localStorage.setItem(INSTALLMENT_CHECKOUT_KEY, JSON.stringify(order));
                localStorage.removeItem(INSTALLMENT_FORM_KEY);
                window.location.href = "../installment/installment-step1.html";
                return;
            }

            if (order.payment === "CASH ON DELIVERY") {
                const saveResult = await saveBooking(order);
                if (!saveResult || saveResult.success !== true) {
                    showError(null, (saveResult && saveResult.message) || "Unable to save booking. Please try again.");
                    return;
                }
                window.location.href = "success.html";
                return;
            }

            showError(null, "Selected payment method is currently unavailable.");
        } finally {
            setBookingSubmitState(false);
        }
    });

    seedCustomerInfo();
    initializeScheduleInputs();
    renderMapFrame(DEFAULT_MAP_COORDS.lat, DEFAULT_MAP_COORDS.lng);
    if (shipAddressInput.value) {
        geocodeAddress(shipAddressInput.value, { silent: true });
    }
    updateSummary();
})();

