document.addEventListener("DOMContentLoaded", function () {
    const bookingStorageKeys = ["ecodrive_bookings", "ecodrive_orders", "orders"];
    const selectedBookingKey = "ecodrive_admin_selected_booking";
    const API_BASE = String(
        (window.EcodriveSession && typeof window.EcodriveSession.getApiBase === "function"
            ? window.EcodriveSession.getApiBase()
            : localStorage.getItem("ecodrive_api_base")
                || localStorage.getItem("ecodrive_kyc_api_base")
                || "")
    )
        .trim()
        .replace(/\/+$/, "");

    const rowsContainer = document.getElementById("historyRows");
    const emptyState = document.getElementById("historyEmptyState");
    if (!rowsContainer || !emptyState) {
        return;
    }
    if (!window.EcodriveSession || typeof window.EcodriveSession.requireRole !== "function" || !window.EcodriveSession.requireRole("admin")) {
        return;
    }

    function safeParse(raw) {
        try {
            return JSON.parse(raw);
        } catch (_error) {
            return null;
        }
    }

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function encodeToken(value) {
        return encodeURIComponent(String(value || ""));
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

    function formatPeso(value) {
        return "\u20B1" + Number(value || 0).toLocaleString("en-PH", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function normalizeColorText(value) {
        return String(value || "").trim().replace(/\s+/g, " ");
    }

    function splitModelAndColorFromModelText(modelText) {
        const normalizedModel = String(modelText || "").trim().replace(/\s+/g, " ");
        const match = normalizedModel.match(/^(.*)\(([^)]+)\)\s*$/);
        if (!match) {
            return { model: normalizedModel, color: "" };
        }
        const model = String(match[1] || "").trim();
        const color = normalizeColorText(match[2] || "");
        if (!model || !color || /\d/.test(color)) {
            return { model: normalizedModel, color: "" };
        }
        return { model: model, color: color };
    }

    function getModelLabel(record) {
        const modelText = String((record && (record.model || record.productName || record.itemName || "Ecodrive E-Bike")) || "Ecodrive E-Bike");
        return splitModelAndColorFromModelText(modelText).model || "Ecodrive E-Bike";
    }

    function getBikeColorLabel(record) {
        const direct = normalizeColorText(record && (record.bikeColor || record.color || record.selectedColor || record.bike_color));
        if (direct) {
            return direct;
        }
        const modelText = String((record && (record.model || record.productName || record.itemName)) || "");
        return splitModelAndColorFromModelText(modelText).color;
    }

    function getRecordOrderId(record) {
        return String((record && (record.orderId || record.id)) || "").trim();
    }

    function getRecordCreatedAt(record) {
        return String((record && (record.createdAt || record.updatedAt)) || "").trim();
    }

    function parseInstallmentPayload(record) {
        if (!record || typeof record !== "object") {
            return null;
        }
        if (record.installment && typeof record.installment === "object") {
            return record.installment;
        }
        const raw = safeParse(record.installment_payload);
        if (raw && typeof raw === "object") {
            return raw;
        }
        return null;
    }

    function isInstallmentRecord(record) {
        const payment = String(record && record.payment || "").toLowerCase();
        const service = String(record && record.service || "").toLowerCase();
        return payment.includes("installment")
            || service.includes("installment")
            || Boolean(parseInstallmentPayload(record));
    }

    function getInstallmentProgressLabel(record) {
        if (!isInstallmentRecord(record)) {
            return "-";
        }
        const installment = parseInstallmentPayload(record);
        if (!installment) {
            return "0/?";
        }
        const monthsRaw = Number(
            installment.monthsToPay
            || installment.months
            || installment.installmentMonths
            || 0
        );
        const monthsToPay = Number.isFinite(monthsRaw) && monthsRaw > 0
            ? Math.floor(monthsRaw)
            : 0;
        const paidCount = Array.isArray(installment.paymentHistory)
            ? installment.paymentHistory.filter(function (entry) {
                const monthRaw = Number(entry && (entry.month || entry.installmentMonth) || 0);
                const status = String(entry && entry.status || "").toLowerCase();
                return monthRaw > 0 && status.includes("paid");
            }).length
            : 0;
        if (monthsToPay > 0) {
            return String(Math.min(paidCount, monthsToPay)) + "/" + String(monthsToPay);
        }
        return String(paidCount) + "/?";
    }

    function getPlanLabel(record) {
        return isInstallmentRecord(record) ? "Installment" : "Full Payment";
    }

    function getStatusLabel(record) {
        const status = String(record && record.status || "").trim();
        const fulfillment = String(record && record.fulfillmentStatus || "").trim();
        if (status && fulfillment && status.toLowerCase() !== fulfillment.toLowerCase()) {
            return status + " / " + fulfillment;
        }
        return status || fulfillment || "Pending review";
    }

    function getStatusClass(statusText) {
        const value = String(statusText || "").toLowerCase();
        if (value.includes("complete") || value.includes("deliver") || value.includes("picked up") || value.includes("released")) {
            return "success";
        }
        if (value.includes("approve") || value.includes("active")) {
            return "info";
        }
        if (value.includes("pending") || value.includes("review") || value.includes("process")) {
            return "warning";
        }
        if (value.includes("reject") || value.includes("cancel")) {
            return "danger";
        }
        return "default";
    }

    function formatDateTime(value) {
        const date = new Date(value || "");
        if (Number.isNaN(date.getTime())) {
            return "Not set";
        }
        return date.toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true
        });
    }

    function buildLocalDateTimeFromParts(dateValue, timeValue) {
        const dateText = String(dateValue || "").trim();
        const dateMatch = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!dateMatch) {
            return null;
        }
        const timeMatch = String(timeValue || "").trim().match(/^(\d{2}):(\d{2})/);
        const value = new Date(
            Number(dateMatch[1]),
            Number(dateMatch[2]) - 1,
            Number(dateMatch[3]),
            timeMatch ? Number(timeMatch[1]) : 0,
            timeMatch ? Number(timeMatch[2]) : 0
        );
        if (Number.isNaN(value.getTime())) {
            return null;
        }
        return value;
    }

    function formatScheduleFromRecord(record) {
        if (!record || typeof record !== "object") {
            return "Not set";
        }
        const explicit = String(record.scheduleLabel || "").trim();
        if (explicit) {
            return explicit;
        }
        const fromParts = buildLocalDateTimeFromParts(record.scheduleDate || record.bookingDate, record.scheduleTime || record.bookingTime);
        if (fromParts) {
            return formatDateTime(fromParts.toISOString());
        }
        const scheduledAt = String(record.scheduledAt || record.scheduleAt || "").trim();
        if (scheduledAt) {
            return formatDateTime(scheduledAt);
        }
        return "Not set";
    }

    function isHistoryRecord(record) {
        const status = String(record && record.status || "").toLowerCase();
        const fulfillment = String(record && record.fulfillmentStatus || "").toLowerCase();
        const reviewDecision = String(record && record.reviewDecision || "").toLowerCase();
        const merged = `${status} ${fulfillment} ${reviewDecision}`.trim();
        if (!merged) {
            return false;
        }
        if (reviewDecision === "approved" || reviewDecision === "rejected") {
            return true;
        }
        if (merged.includes("pending review") || merged.includes("under review")) {
            return false;
        }
        return merged.includes("approve")
            || merged.includes("complete")
            || merged.includes("deliver")
            || merged.includes("picked up")
            || merged.includes("released")
            || merged.includes("reject")
            || merged.includes("cancel")
            || merged.includes("active")
            || merged.includes("installment");
    }

    function dedupeRecords(records) {
        const seen = new Set();
        const list = [];
        (Array.isArray(records) ? records : []).forEach(function (record, index) {
            if (!record || typeof record !== "object") {
                return;
            }
            const key = [
                getRecordOrderId(record) || ("order-" + index),
                getRecordCreatedAt(record),
                String(record.email || record.userEmail || "").trim().toLowerCase()
            ].join("|");
            if (seen.has(key)) {
                return;
            }
            seen.add(key);
            list.push(record);
        });
        return list;
    }

    function readLocalBookings() {
        const merged = [];
        bookingStorageKeys.forEach(function (key) {
            const parsed = safeParse(localStorage.getItem(key));
            if (Array.isArray(parsed)) {
                merged.push.apply(merged, parsed);
            }
        });
        const latest = safeParse(localStorage.getItem("latestBooking"));
        if (latest && typeof latest === "object") {
            merged.push(latest);
        }
        return dedupeRecords(merged);
    }

    async function fetchBookingsFromApi() {
        try {
            const response = await fetch(getApiUrl("/api/admin/bookings?scope=all"), {
                method: "GET",
                headers: buildApiHeaders()
            });
            if (!response.ok) {
                return { success: false, bookings: [] };
            }
            const payload = await response.json().catch(function () {
                return {};
            });
            if (!payload || payload.success !== true || !Array.isArray(payload.bookings)) {
                return { success: false, bookings: [] };
            }
            return { success: true, bookings: dedupeRecords(payload.bookings) };
        } catch (_error) {
            return { success: false, bookings: [] };
        }
    }

    function normalizeRows(records) {
        return dedupeRecords(records)
            .filter(isHistoryRecord)
            .map(function (record) {
                const color = getBikeColorLabel(record);
                const model = getModelLabel(record);
                return {
                    orderId: getRecordOrderId(record),
                    createdAt: getRecordCreatedAt(record),
                    name: String(record.fullName || record.name || record.email || record.userEmail || "Unknown Customer").trim(),
                    model: color ? `${model} (${color})` : model,
                    schedule: formatScheduleFromRecord(record),
                    plan: getPlanLabel(record),
                    status: getStatusLabel(record),
                    fulfillment: String(record.fulfillmentStatus || "-").trim() || "-",
                    hulog: getInstallmentProgressLabel(record),
                    total: Number(record.total || 0),
                    raw: record
                };
            })
            .sort(function (a, b) {
                return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
            });
    }

    function renderRows(records) {
        const rows = normalizeRows(records);
        rowsContainer.innerHTML = "";
        if (rows.length < 1) {
            emptyState.hidden = false;
            return;
        }
        emptyState.hidden = true;

        const fragment = document.createDocumentFragment();
        rows.forEach(function (item) {
            const row = document.createElement("article");
            row.className = "history-row";
            row.innerHTML = ""
                + "<span>" + escapeHtml(item.name) + "</span>"
                + "<span>" + escapeHtml(item.model) + "</span>"
                + "<span>" + escapeHtml(item.schedule) + "</span>"
                + "<span>" + escapeHtml(item.plan) + "</span>"
                + "<span><span class=\"status-chip " + getStatusClass(item.status) + "\">" + escapeHtml(item.status) + "</span></span>"
                + "<span>" + escapeHtml(item.fulfillment) + "</span>"
                + "<span>" + escapeHtml(item.hulog) + "</span>"
                + "<span>" + escapeHtml(formatPeso(item.total)) + "</span>"
                + "<span><button type=\"button\" class=\"action-btn\" data-action=\"view\" data-order-id=\"" + encodeToken(item.orderId) + "\" data-created-at=\"" + encodeToken(item.createdAt) + "\">View</button></span>";
            fragment.appendChild(row);
        });
        rowsContainer.appendChild(fragment);
    }

    async function initialize() {
        const localRows = readLocalBookings();
        renderRows(localRows);
        const apiResult = await fetchBookingsFromApi();
        if (apiResult.success && Array.isArray(apiResult.bookings)) {
            renderRows(apiResult.bookings);
        }
    }

    rowsContainer.addEventListener("click", function (event) {
        const button = event.target && event.target.closest ? event.target.closest("[data-action='view']") : null;
        if (!button) {
            return;
        }
        const orderId = decodeURIComponent(String(button.getAttribute("data-order-id") || ""));
        const createdAt = decodeURIComponent(String(button.getAttribute("data-created-at") || ""));
        if (!orderId) {
            return;
        }

        const localRows = normalizeRows(readLocalBookings());
        const selected = localRows.find(function (row) {
            return String(row.orderId || "") === orderId
                && (!createdAt || String(row.createdAt || "") === createdAt);
        });
        if (selected && selected.raw) {
            localStorage.setItem(selectedBookingKey, JSON.stringify(selected.raw));
        }
        window.location.href = `adminorder-view.html?orderId=${encodeToken(orderId)}&createdAt=${encodeToken(createdAt)}`;
    });

    void initialize();
});
