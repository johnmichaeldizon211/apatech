document.addEventListener("DOMContentLoaded", function () {
    const usersKey = "users";
    const bookingStorageKeys = ["ecodrive_bookings", "ecodrive_orders", "orders"];
    const watchedStorageKeys = new Set(bookingStorageKeys.concat(["latestBooking", usersKey]));
    const adminSelectedBookingKey = "ecodrive_admin_selected_booking";
    const API_BASE = String(
        (window.EcodriveSession && typeof window.EcodriveSession.getApiBase === "function"
            ? window.EcodriveSession.getApiBase()
            : localStorage.getItem("ecodrive_api_base")
                || localStorage.getItem("ecodrive_kyc_api_base")
                || "")
    )
        .trim()
        .replace(/\/+$/, "");

    const rowsContainer = document.getElementById("requestRows");
    const emptyState = document.getElementById("bookingEmptyState");
    const bookingCalendar = document.getElementById("bookingCalendar");
    const calendarMonthLabel = document.getElementById("calendarMonthLabel");
    const calendarSummary = document.getElementById("calendarSummary");
    const calendarPrevBtn = document.getElementById("calendarPrevBtn");
    const calendarNextBtn = document.getElementById("calendarNextBtn");
    const calendarDayModal = document.getElementById("calendarDayModal");
    const calendarDayModalTitle = document.getElementById("calendarDayModalTitle");
    const calendarDayModalMeta = document.getElementById("calendarDayModalMeta");
    const calendarDayModalList = document.getElementById("calendarDayModalList");

    if (!rowsContainer || !emptyState) {
        return;
    }

    if (!window.EcodriveSession || typeof window.EcodriveSession.requireRole !== "function" || !window.EcodriveSession.requireRole("admin")) {
        return;
    }

    const AUTO_REFRESH_INTERVAL_MS = 7000;
    const FULL_DAY_THRESHOLD = 3;
    const WEEKDAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
    const EMPTY_DAY_STATS = Object.freeze({
        total: 0,
        installment: 0,
        fullPayment: 0
    });
    let renderedItems = [];
    let loadRowsInFlight = false;
    let autoRefreshTimerId = null;
    let calendarMonthCursor = new Date();
    let latestCalendarRows = [];
    let selectedCalendarDateKey = "";
    let hasShownAuthExpiryNotice = false;

    calendarMonthCursor = new Date(calendarMonthCursor.getFullYear(), calendarMonthCursor.getMonth(), 1);

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

    function decodeToken(value) {
        try {
            return decodeURIComponent(String(value || ""));
        } catch (_error) {
            return String(value || "");
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

    function buildNameFromUser(user) {
        if (!user || typeof user !== "object") {
            return "";
        }

        if (user.name) {
            return String(user.name).trim();
        }

        const first = String(user.firstName || "").trim();
        const middle = String(user.middleInitial || "").trim();
        const last = String(user.lastName || "").trim();
        const middleWithDot = middle ? middle.replace(/\.+$/, "") + "." : "";
        return [first, middleWithDot, last].filter(Boolean).join(" ").trim();
    }

    function getUsersByEmailMap() {
        const parsed = safeParse(localStorage.getItem(usersKey));
        const users = Array.isArray(parsed) ? parsed : [];
        const map = {};

        users.forEach(function (user) {
            if (!user || typeof user !== "object") {
                return;
            }
            const email = String(user.email || "").trim().toLowerCase();
            if (!email) {
                return;
            }
            const name = buildNameFromUser(user);
            if (name) {
                map[email] = name;
            }
        });

        return map;
    }

    function getRecordEmail(record) {
        return String((record && (record.email || record.userEmail)) || "")
            .trim()
            .toLowerCase();
    }

    function readBookings() {
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

        return merged;
    }

    function buildCalendarDedupeKey(record, index) {
        if (!record || typeof record !== "object") {
            return "unknown|" + String(index || 0);
        }

        const orderId = String(record.orderId || record.id || "").trim().toLowerCase();
        const createdAt = String(record.createdAt || record.updatedAt || "").trim().toLowerCase();
        const email = String(record.email || record.userEmail || "").trim().toLowerCase();
        const model = String(record.model || record.productName || record.itemName || "").trim().toLowerCase();

        if (orderId) {
            return "order|" + orderId;
        }
        return [createdAt, email, model].join("|") || ("unknown|" + String(index || 0));
    }

    function hasMeaningfulValue(value) {
        if (value === null || value === undefined) {
            return false;
        }
        if (typeof value === "string") {
            return value.trim().length > 0;
        }
        return true;
    }

    function mergeCalendarRecord(existingRecord, nextRecord) {
        const existing = existingRecord && typeof existingRecord === "object" ? existingRecord : {};
        const incoming = nextRecord && typeof nextRecord === "object" ? nextRecord : {};
        const merged = Object.assign({}, existing);

        const preferredKeys = [
            "scheduleDate",
            "scheduleTime",
            "date",
            "time",
            "scheduledAt",
            "scheduleAt",
            "scheduleLabel",
            "schedule",
            "bookingDate",
            "bookingTime",
            "createdAt",
            "updatedAt",
            "status",
            "fulfillmentStatus",
            "payment",
            "service",
            "fullName",
            "name",
            "email",
            "userEmail",
            "model",
            "productName",
            "itemName"
        ];

        Object.keys(incoming).forEach(function (key) {
            if (!Object.prototype.hasOwnProperty.call(merged, key)) {
                merged[key] = incoming[key];
            }
        });

        preferredKeys.forEach(function (key) {
            if (!hasMeaningfulValue(merged[key]) && hasMeaningfulValue(incoming[key])) {
                merged[key] = incoming[key];
            }
        });

        return merged;
    }

    function mergeCalendarSources() {
        const merged = [];
        const keyToIndex = new Map();

        for (let sourceIndex = 0; sourceIndex < arguments.length; sourceIndex += 1) {
            const source = arguments[sourceIndex];
            if (!Array.isArray(source)) {
                continue;
            }

            source.forEach(function (record, index) {
                if (!record || typeof record !== "object") {
                    return;
                }

                const dedupeKey = buildCalendarDedupeKey(record, index);
                if (!dedupeKey) {
                    return;
                }

                if (!keyToIndex.has(dedupeKey)) {
                    keyToIndex.set(dedupeKey, merged.length);
                    merged.push(Object.assign({}, record));
                    return;
                }

                const targetIndex = Number(keyToIndex.get(dedupeKey));
                const currentValue = merged[targetIndex];
                merged[targetIndex] = mergeCalendarRecord(currentValue, record);
            });
        }

        return merged;
    }

    function getMergedStatus(record) {
        const statusText = String(record && record.status || "");
        const fulfillmentText = String(record && record.fulfillmentStatus || "");
        return (statusText + " " + fulfillmentText).toLowerCase();
    }

    function isPendingBooking(record) {
        const merged = getMergedStatus(record);
        if (!merged.trim()) {
            return true;
        }

        if (merged.includes("cancel")) return false;
        if (merged.includes("reject")) return false;
        if (merged.includes("approved")) return false;
        if (merged.includes("complete")) return false;
        if (merged.includes("deliver")) return false;
        return true;
    }

    function getBookingName(record, usersByEmailMap) {
        const localName = String(
            (record && (record.fullName || record.name)) ||
            ""
        ).trim();
        if (localName) {
            return localName;
        }

        const email = getRecordEmail(record);
        if (email && usersByEmailMap[email]) {
            return usersByEmailMap[email];
        }

        return email || "Unknown Customer";
    }

    function getPlanLabel(record) {
        const payment = String(record && record.payment || "").toLowerCase();
        const service = String(record && record.service || "").toLowerCase();
        if (payment.includes("installment") || service.includes("installment")) {
            return "Installment";
        }
        return "Full Payment";
    }

    function getStatusLabel(record) {
        const status = String(record && record.status || "").trim();
        const fulfillment = String(record && record.fulfillmentStatus || "").trim();
        if (status && fulfillment && status.toLowerCase() !== fulfillment.toLowerCase()) {
            return status + " / " + fulfillment;
        }
        return status || fulfillment || "Pending review";
    }

    function formatDateTime(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return "N/A";
        }
        return date.toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit"
        });
    }

    function buildLocalDateTimeFromParts(dateValue, timeValue) {
        const dateText = String(dateValue || "").trim();
        const dateMatch = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!dateMatch) {
            return null;
        }

        const timeMatch = String(timeValue || "").trim().match(/^(\d{2}):(\d{2})/);
        const year = Number(dateMatch[1]);
        const month = Number(dateMatch[2]) - 1;
        const day = Number(dateMatch[3]);
        const hours = timeMatch ? Number(timeMatch[1]) : 0;
        const minutes = timeMatch ? Number(timeMatch[2]) : 0;
        const value = new Date(year, month, day, hours, minutes, 0, 0);
        if (Number.isNaN(value.getTime())) {
            return null;
        }
        return value;
    }

    function formatScheduleFromRecord(record) {
        if (!record || typeof record !== "object") {
            return "Not set";
        }

        const explicitLabel = String(record.scheduleLabel || "").trim();
        if (explicitLabel) {
            return explicitLabel;
        }

        const scheduleDate = record.scheduleDate || record.bookingDate || record.date || "";
        const scheduleTime = record.scheduleTime || record.bookingTime || record.time || "";
        const scheduleFromParts = buildLocalDateTimeFromParts(scheduleDate, scheduleTime);
        if (scheduleFromParts) {
            return scheduleFromParts.toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
                hour12: true
            });
        }

        const scheduledAt = new Date(record.scheduledAt || record.scheduleAt || "");
        if (!Number.isNaN(scheduledAt.getTime())) {
            return scheduledAt.toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
                hour12: true
            });
        }

        return "Not set";
    }

    function formatDateKey(dateValue) {
        const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
        if (Number.isNaN(date.getTime())) {
            return "";
        }

        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    function createDateKey(year, monthIndex, day) {
        const month = String(monthIndex + 1).padStart(2, "0");
        const dayValue = String(day).padStart(2, "0");
        return `${year}-${month}-${dayValue}`;
    }

    function extractScheduleDateKey(record) {
        if (!record || typeof record !== "object") {
            return "";
        }

        const explicitDate = String(record.scheduleDate || record.bookingDate || record.date || "").trim();
        const dateMatch = explicitDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (dateMatch) {
            return `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
        }

        const scheduleLabelText = String(record.scheduleLabel || record.schedule || "").trim();
        if (scheduleLabelText) {
            const parsedLabel = new Date(scheduleLabelText);
            if (!Number.isNaN(parsedLabel.getTime())) {
                return formatDateKey(parsedLabel);
            }
        }

        const scheduledAt = String(record.scheduledAt || record.scheduleAt || "").trim();
        if (scheduledAt) {
            return formatDateKey(new Date(scheduledAt));
        }

        // Fallback for legacy rows without scheduling columns.
        const createdAt = String(record.createdAt || record.updatedAt || "").trim();
        if (createdAt) {
            return formatDateKey(new Date(createdAt));
        }
        return "";
    }

    function shouldIncludeInCalendar(record) {
        const merged = getMergedStatus(record);
        if (!merged.trim()) {
            return true;
        }
        if (merged.includes("cancel")) {
            return false;
        }
        if (merged.includes("reject")) {
            return false;
        }
        return true;
    }

    function getCalendarPlanType(record) {
        const payment = String(record && record.payment || "").toLowerCase();
        const service = String(record && record.service || "").toLowerCase();
        if (payment.includes("installment") || service.includes("installment")) {
            return "installment";
        }
        return "fullPayment";
    }

    function countBookingsPerDay(records) {
        const counts = Object.create(null);
        const source = Array.isArray(records) ? records : [];

        source.forEach(function (record) {
            if (!shouldIncludeInCalendar(record)) {
                return;
            }

            const key = extractScheduleDateKey(record);
            if (!key) {
                return;
            }

            if (!counts[key]) {
                counts[key] = {
                    total: 0,
                    installment: 0,
                    fullPayment: 0
                };
            }

            const bucket = counts[key];
            bucket.total += 1;

            const planType = getCalendarPlanType(record);
            if (planType === "installment") {
                bucket.installment += 1;
            } else {
                bucket.fullPayment += 1;
            }
        });

        return counts;
    }

    function summarizeMonthStats(dailyCounts, year, monthIndex) {
        const monthPrefix = String(year) + "-" + String(monthIndex + 1).padStart(2, "0") + "-";
        let total = 0;
        let installment = 0;
        let fullPayment = 0;
        let activeDays = 0;
        let fullCapacityDays = 0;

        Object.keys(dailyCounts).forEach(function (key) {
            if (!String(key).startsWith(monthPrefix)) {
                return;
            }

            const dayStats = dailyCounts[key] || EMPTY_DAY_STATS;
            const dayTotal = Number(dayStats.total || 0);
            const dayInstallment = Number(dayStats.installment || 0);
            const dayFullPayment = Number(dayStats.fullPayment || 0);

            total += dayTotal;
            installment += dayInstallment;
            fullPayment += dayFullPayment;

            if (dayTotal > 0) {
                activeDays += 1;
            }
            if (dayTotal >= FULL_DAY_THRESHOLD) {
                fullCapacityDays += 1;
            }
        });

        return {
            total: total,
            installment: installment,
            fullPayment: fullPayment,
            activeDays: activeDays,
            fullCapacityDays: fullCapacityDays
        };
    }

    function formatDateLabelFromKey(dateKey) {
        const match = String(dateKey || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) {
            return String(dateKey || "Selected date");
        }

        const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        if (Number.isNaN(date.getTime())) {
            return String(dateKey || "Selected date");
        }
        return date.toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric"
        });
    }

    function getScheduleSortValue(record) {
        const scheduleDate = record && (record.scheduleDate || record.bookingDate || record.date);
        const scheduleTime = record && (record.scheduleTime || record.bookingTime || record.time);
        const scheduledFromParts = buildLocalDateTimeFromParts(scheduleDate, scheduleTime);
        if (scheduledFromParts) {
            return scheduledFromParts.getTime();
        }

        const scheduledAt = new Date(record && (record.scheduledAt || record.scheduleAt || ""));
        if (!Number.isNaN(scheduledAt.getTime())) {
            return scheduledAt.getTime();
        }

        const createdAt = new Date(record && (record.createdAt || record.updatedAt || ""));
        if (!Number.isNaN(createdAt.getTime())) {
            return createdAt.getTime();
        }

        return Number.MAX_SAFE_INTEGER;
    }

    function getDayScheduleEntries(records, dateKey) {
        const source = Array.isArray(records) ? records : [];
        const usersByEmailMap = getUsersByEmailMap();
        return source
            .filter(function (record) {
                return shouldIncludeInCalendar(record) && extractScheduleDateKey(record) === dateKey;
            })
            .map(function (record, index) {
                return {
                    orderId: String(record.orderId || record.id || "").trim() || ("BOOKING-" + index),
                    createdAt: String(record.createdAt || record.updatedAt || "").trim(),
                    name: getBookingName(record, usersByEmailMap),
                    model: String(record.model || record.productName || record.itemName || "Ecodrive E-Bike"),
                    schedule: formatScheduleFromRecord(record),
                    plan: getPlanLabel(record),
                    status: getStatusLabel(record),
                    sortValue: getScheduleSortValue(record)
                };
            })
            .sort(function (a, b) {
                if (a.sortValue !== b.sortValue) {
                    return a.sortValue - b.sortValue;
                }
                return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
            });
    }

    function getStatusChipClass(statusText) {
        const value = String(statusText || "").toLowerCase();

        if (value.includes("reject")) {
            return "status-rejected";
        }
        if (value.includes("cancel")) {
            return "status-cancelled";
        }
        if (value.includes("deliver") || value.includes("complete")) {
            return "status-completed";
        }
        if (value.includes("process") || value.includes("in transit")) {
            return "status-processing";
        }
        if (value.includes("approved")) {
            return "status-approved";
        }
        if (value.includes("pending") || value.includes("review")) {
            return "status-pending";
        }

        return "status-default";
    }

    function renderDayScheduleModal(dateKey) {
        if (!calendarDayModal || !calendarDayModalTitle || !calendarDayModalMeta || !calendarDayModalList) {
            return;
        }

        const dayLabel = formatDateLabelFromKey(dateKey);
        const entries = getDayScheduleEntries(latestCalendarRows, dateKey);
        const installmentCount = entries.filter(function (entry) {
            return String(entry.plan || "").toLowerCase().includes("installment");
        }).length;
        const fullPaymentCount = Math.max(0, entries.length - installmentCount);

        calendarDayModalTitle.textContent = "Schedule for " + dayLabel;

        if (!entries.length) {
            calendarDayModalMeta.textContent = "0 booking for this date.";
            calendarDayModalList.innerHTML = "<p class=\"day-schedule-empty\">No scheduled e-bike bookings for this date.</p>";
            return;
        }

        calendarDayModalMeta.textContent = ""
            + entries.length + " booking(s) | "
            + "Installment: " + installmentCount + " | "
            + "Full payment: " + fullPaymentCount;

        calendarDayModalList.innerHTML = entries.map(function (entry) {
            const planClass = String(entry.plan || "").toLowerCase().includes("installment")
                ? "plan-installment"
                : "plan-full";
            const statusClass = getStatusChipClass(entry.status);
            return ""
                + "<article class=\"day-schedule-item\">"
                + "<div class=\"day-schedule-main\">"
                + "<span class=\"day-schedule-name\">" + escapeHtml(entry.name) + "</span>"
                + "<span class=\"day-schedule-model\">" + escapeHtml(entry.model) + "</span>"
                + "</div>"
                + "<div class=\"day-schedule-info\">"
                + "<span class=\"day-schedule-chip\">" + escapeHtml(entry.schedule) + "</span>"
                + "<span class=\"day-schedule-chip " + planClass + "\">" + escapeHtml(entry.plan) + "</span>"
                + "<span class=\"day-schedule-chip " + statusClass + "\">" + escapeHtml(entry.status) + "</span>"
                + "<span class=\"day-schedule-chip\">Order: " + escapeHtml(entry.orderId) + "</span>"
                + "</div>"
                + "<div class=\"day-schedule-actions\">"
                + "<button type=\"button\" class=\"day-schedule-view\" data-modal-action=\"view-booking\" data-order-id=\"" + encodeToken(entry.orderId) + "\" data-created-at=\"" + encodeToken(entry.createdAt) + "\">View</button>"
                + "</div>"
                + "</article>";
        }).join("");
    }

    function openDayScheduleModal(dateKey) {
        if (!calendarDayModal) {
            return;
        }

        const normalizedKey = String(dateKey || "").trim();
        if (!normalizedKey) {
            return;
        }

        selectedCalendarDateKey = normalizedKey;
        renderCalendar(latestCalendarRows);
        renderDayScheduleModal(normalizedKey);

        calendarDayModal.hidden = false;
        document.body.classList.add("modal-open");
    }

    function closeDayScheduleModal() {
        if (!calendarDayModal || calendarDayModal.hidden) {
            return;
        }

        calendarDayModal.hidden = true;
        selectedCalendarDateKey = "";
        document.body.classList.remove("modal-open");
        renderCalendar(latestCalendarRows);
    }

    function refreshDayScheduleModalIfOpen() {
        if (!calendarDayModal || calendarDayModal.hidden || !selectedCalendarDateKey) {
            return;
        }
        renderDayScheduleModal(selectedCalendarDateKey);
    }

    function renderCalendar(records) {
        if (!bookingCalendar || !calendarMonthLabel) {
            return;
        }

        const currentMonth = new Date(calendarMonthCursor.getFullYear(), calendarMonthCursor.getMonth(), 1);
        const year = currentMonth.getFullYear();
        const monthIndex = currentMonth.getMonth();
        const todayKey = formatDateKey(new Date());
        const dailyCounts = countBookingsPerDay(records);

        calendarMonthLabel.textContent = currentMonth.toLocaleDateString("en-US", {
            month: "long",
            year: "numeric"
        });

        if (calendarSummary) {
            const summary = summarizeMonthStats(dailyCounts, year, monthIndex);
            const monthText = currentMonth.toLocaleDateString("en-US", {
                month: "long",
                year: "numeric"
            });

            if (summary.total <= 0) {
                calendarSummary.textContent = "No scheduled e-bike bookings for " + monthText + ".";
            } else {
                calendarSummary.textContent = ""
                    + monthText + ": "
                    + summary.total + " scheduled bookings across "
                    + summary.activeDays + " day(s) "
                    + "(Inst: " + summary.installment + ", Full: " + summary.fullPayment + "). "
                    + summary.fullCapacityDays + " day(s) reached full capacity.";
            }
        }

        const firstWeekday = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
        const daysInCurrentMonth = new Date(year, monthIndex + 1, 0).getDate();
        const daysInPreviousMonth = new Date(year, monthIndex, 0).getDate();
        const totalCells = 42;

        let html = "<div class=\"calendar-weekdays\">"
            + WEEKDAY_LABELS.map(function (label) {
                return "<span>" + label + "</span>";
            }).join("")
            + "</div><div class=\"calendar-grid\">";

        for (let index = 0; index < totalCells; index += 1) {
            let dayNumber = 0;
            let cellYear = year;
            let cellMonthIndex = monthIndex;
            const classes = ["calendar-cell"];

            if (index < firstWeekday) {
                dayNumber = daysInPreviousMonth - firstWeekday + index + 1;
                cellMonthIndex = monthIndex - 1;
                if (cellMonthIndex < 0) {
                    cellMonthIndex = 11;
                    cellYear -= 1;
                }
                classes.push("other-month");
            } else if (index >= firstWeekday + daysInCurrentMonth) {
                dayNumber = index - (firstWeekday + daysInCurrentMonth) + 1;
                cellMonthIndex = monthIndex + 1;
                if (cellMonthIndex > 11) {
                    cellMonthIndex = 0;
                    cellYear += 1;
                }
                classes.push("other-month");
            } else {
                dayNumber = index - firstWeekday + 1;
            }

            const dateKey = createDateKey(cellYear, cellMonthIndex, dayNumber);
            const dayStats = dailyCounts[dateKey] || EMPTY_DAY_STATS;
            const count = Number(dayStats.total || 0);
            const installmentCount = Number(dayStats.installment || 0);
            const fullPaymentCount = Number(dayStats.fullPayment || 0);
            const isFullDay = count >= FULL_DAY_THRESHOLD;
            const isToday = dateKey === todayKey;
            const isSelected = dateKey === selectedCalendarDateKey;

            if (isToday) {
                classes.push("today");
            }
            if (isSelected) {
                classes.push("selected");
            }

            let badgeHtml = "";
            if (count > 0) {
                const bikesToShow = Math.min(count, 4);
                const bikeIcons = new Array(bikesToShow).fill("<span class=\"calendar-ebike-marker\" aria-hidden=\"true\"></span>").join("");
                badgeHtml += "<span class=\"calendar-icons\" aria-hidden=\"true\">" + bikeIcons + "</span>";
                if (count > bikesToShow) {
                    badgeHtml += "<span class=\"calendar-more\">+" + (count - bikesToShow) + "</span>";
                }
                badgeHtml += "<span class=\"calendar-badge booked\">" + count + " booked</span>";
                if (installmentCount > 0) {
                    badgeHtml += "<span class=\"calendar-badge installment\">Inst: " + installmentCount + "</span>";
                }
                if (fullPaymentCount > 0) {
                    badgeHtml += "<span class=\"calendar-badge full-payment\">Full: " + fullPaymentCount + "</span>";
                }
            }
            if (isFullDay) {
                badgeHtml += "<span class=\"calendar-badge full\">FULL CAPACITY</span>";
            }

            const dayAriaLabel = count > 0
                ? (formatDateLabelFromKey(dateKey) + ", " + count + " scheduled booking(s)")
                : (formatDateLabelFromKey(dateKey) + ", no scheduled bookings");

            html += "<article class=\"" + classes.join(" ") + "\""
                + " role=\"button\" tabindex=\"0\""
                + " data-calendar-date-key=\"" + dateKey + "\""
                + " data-calendar-booking-count=\"" + count + "\""
                + " aria-label=\"" + escapeHtml(dayAriaLabel) + "\">"
                + "<span class=\"calendar-day-number\">" + dayNumber + "</span>"
                + "<div class=\"calendar-badges\">" + badgeHtml + "</div>"
                + "</article>";
        }

        html += "</div>";
        bookingCalendar.innerHTML = html;
    }

    function normalizeBookings(raw, usersByEmailMap) {
        const normalized = raw
            .map(function (record, index) {
                if (!record || typeof record !== "object") {
                    return null;
                }

                if (!isPendingBooking(record)) {
                    return null;
                }

                const createdAt = String(record.createdAt || record.updatedAt || "").trim() || new Date().toISOString();
                const orderId = String(record.orderId || record.id || "").trim() || ("BOOKING-" + index);

                return {
                    orderId: orderId,
                    createdAt: createdAt,
                    name: getBookingName(record, usersByEmailMap),
                    model: String(record.model || record.productName || record.itemName || "Ecodrive E-Bike"),
                    schedule: formatScheduleFromRecord(record),
                    plan: getPlanLabel(record),
                    status: getStatusLabel(record),
                    email: getRecordEmail(record),
                    service: String(record.service || ""),
                    payment: String(record.payment || ""),
                    total: Number(record.total || 0),
                    shippingAddress: String(record.shippingAddress || "")
                };
            })
            .filter(Boolean)
            .sort(function (a, b) {
                return String(b.createdAt).localeCompare(String(a.createdAt));
            });

        const deduped = [];
        const seen = new Set();

        normalized.forEach(function (record) {
            const dedupeKey = [
                String(record.orderId || "").trim(),
                String(record.createdAt || "").trim(),
                String(record.email || "").trim().toLowerCase(),
                String(record.model || "").trim().toLowerCase()
            ].join("|");

            if (seen.has(dedupeKey)) {
                return;
            }

            seen.add(dedupeKey);
            deduped.push(record);
        });

        return deduped;
    }

    function renderRows(sourceRows) {
        const usersByEmailMap = getUsersByEmailMap();
        const baseRows = Array.isArray(sourceRows) ? sourceRows : readBookings();
        renderedItems = normalizeBookings(baseRows, usersByEmailMap);
        rowsContainer.innerHTML = "";

        if (!renderedItems.length) {
            emptyState.hidden = false;
            return;
        }

        emptyState.hidden = true;

        const fragment = document.createDocumentFragment();
        renderedItems.forEach(function (item) {
            const row = document.createElement("article");
            row.className = "request-row";
            row.innerHTML = ""
                + "<span>" + escapeHtml(item.name) + "</span>"
                + "<span>" + escapeHtml(item.model) + "</span>"
                + "<span>" + escapeHtml(item.schedule) + "</span>"
                + "<span>" + escapeHtml(item.plan) + "</span>"
                + "<span class=\"status\">" + escapeHtml(item.status) + "</span>"
                + "<span class=\"action-group\">"
                + "<button type=\"button\" class=\"action-btn approve\" data-action=\"approve\" data-order-id=\"" + encodeToken(item.orderId) + "\" data-created-at=\"" + encodeToken(item.createdAt) + "\">Approve</button>"
                + "<button type=\"button\" class=\"action-btn reject\" data-action=\"reject\" data-order-id=\"" + encodeToken(item.orderId) + "\" data-created-at=\"" + encodeToken(item.createdAt) + "\">Reject</button>"
                + "<button type=\"button\" class=\"action-btn view\" data-action=\"view\" data-order-id=\"" + encodeToken(item.orderId) + "\" data-created-at=\"" + encodeToken(item.createdAt) + "\">View</button>"
                + "</span>";
            fragment.appendChild(row);
        });

        rowsContainer.appendChild(fragment);
    }

    function getRecordOrderId(record) {
        return String((record && (record.orderId || record.id)) || "").trim();
    }

    function getRecordCreatedAt(record) {
        return String((record && (record.createdAt || record.updatedAt)) || "").trim();
    }

    function matchesBookingRecord(record, orderId, createdAt) {
        if (!record || typeof record !== "object") {
            return false;
        }

        const sameOrderId = getRecordOrderId(record) === String(orderId || "").trim();
        if (!sameOrderId) {
            return false;
        }

        const targetCreatedAt = String(createdAt || "").trim();
        if (!targetCreatedAt) {
            return true;
        }

        const recordCreatedAt = getRecordCreatedAt(record);
        if (!recordCreatedAt) {
            return true;
        }
        return recordCreatedAt === targetCreatedAt;
    }

    function applyDecisionToRecord(record, action) {
        const next = Object.assign({}, record);
        if (action === "approve") {
            next.status = "Approved";
            if (!String(next.fulfillmentStatus || "").trim()) {
                next.fulfillmentStatus = "In Process";
            }
            next.reviewDecision = "approved";
        } else {
            next.status = "Rejected";
            next.fulfillmentStatus = "Rejected";
            next.reviewDecision = "rejected";
        }
        next.reviewedAt = new Date().toISOString();
        return next;
    }

    function updateBookingDecision(orderId, createdAt, action) {
        let changed = false;

        bookingStorageKeys.forEach(function (storageKey) {
            const parsed = safeParse(localStorage.getItem(storageKey));
            if (!Array.isArray(parsed)) {
                return;
            }

            let storageChanged = false;
            const next = parsed.map(function (record) {
                if (!matchesBookingRecord(record, orderId, createdAt)) {
                    return record;
                }
                storageChanged = true;
                changed = true;
                return applyDecisionToRecord(record, action);
            });

            if (storageChanged) {
                localStorage.setItem(storageKey, JSON.stringify(next));
            }
        });

        const latest = safeParse(localStorage.getItem("latestBooking"));
        if (matchesBookingRecord(latest, orderId, createdAt)) {
            localStorage.setItem("latestBooking", JSON.stringify(applyDecisionToRecord(latest, action)));
            changed = true;
        }

        return changed;
    }

    async function fetchPendingBookingsFromApi() {
        try {
            const response = await fetch(getApiUrl("/api/admin/bookings?scope=pending"), {
                method: "GET",
                headers: buildApiHeaders()
            });

            if (response.status === 404 || response.status === 405) {
                return { mode: "unavailable", bookings: [] };
            }
            if (response.status === 401 || response.status === 403) {
                return { mode: "unauthorized", bookings: [] };
            }

            const payload = await response.json().catch(function () {
                return {};
            });
            if (!response.ok || payload.success !== true) {
                return { mode: "error", bookings: [] };
            }

            return {
                mode: "ok",
                bookings: Array.isArray(payload.bookings) ? payload.bookings : []
            };
        } catch (_error) {
            return { mode: "unavailable", bookings: [] };
        }
    }

    async function fetchAllBookingsFromApi() {
        try {
            const response = await fetch(getApiUrl("/api/admin/bookings?scope=all"), {
                method: "GET",
                headers: buildApiHeaders()
            });

            if (response.status === 404 || response.status === 405) {
                return { mode: "unavailable", bookings: [] };
            }
            if (response.status === 401 || response.status === 403) {
                return { mode: "unauthorized", bookings: [] };
            }

            const payload = await response.json().catch(function () {
                return {};
            });
            if (!response.ok || payload.success !== true) {
                return { mode: "error", bookings: [] };
            }

            return {
                mode: "ok",
                bookings: Array.isArray(payload.bookings) ? payload.bookings : []
            };
        } catch (_error) {
            return { mode: "unavailable", bookings: [] };
        }
    }

    async function updateBookingDecisionViaApi(orderId, action) {
        try {
            const response = await fetch(
                getApiUrl(`/api/admin/bookings/${encodeURIComponent(orderId)}/${action}`),
                {
                    method: "POST",
                    headers: buildApiHeaders()
                }
            );

            if (response.status === 404 || response.status === 405) {
                return { mode: "unavailable" };
            }

            const payload = await response.json().catch(function () {
                return {};
            });
            if (!response.ok || payload.success !== true) {
                return {
                    mode: "error",
                    message: payload.message || "Unable to update booking status."
                };
            }
            return { mode: "ok" };
        } catch (_error) {
            return { mode: "unavailable" };
        }
    }

    async function loadRows(force) {
        if (loadRowsInFlight) {
            return;
        }
        if (document.hidden && !force) {
            return;
        }

        loadRowsInFlight = true;
        try {
            const localRows = readBookings();
            const apiResults = await Promise.all([
                fetchPendingBookingsFromApi(),
                fetchAllBookingsFromApi()
            ]);
            const pendingApiResult = apiResults[0];
            const allApiResult = apiResults[1];

            if (pendingApiResult.mode === "unauthorized" || allApiResult.mode === "unauthorized") {
                if (!hasShownAuthExpiryNotice) {
                    hasShownAuthExpiryNotice = true;
                    alert("Admin session expired. Please log in again.");
                }
                if (window.EcodriveSession && typeof window.EcodriveSession.logout === "function") {
                    window.EcodriveSession.logout("../log in.html");
                } else {
                    window.location.href = "../log in.html";
                }
                return;
            }

            if (pendingApiResult.mode === "ok") {
                renderRows(pendingApiResult.bookings);
            } else {
                renderRows(localRows);
            }

            let calendarRows = localRows;
            if (allApiResult.mode === "ok") {
                calendarRows = mergeCalendarSources(
                    allApiResult.bookings,
                    pendingApiResult.mode === "ok" ? pendingApiResult.bookings : [],
                    localRows
                );
            } else if (pendingApiResult.mode === "ok") {
                calendarRows = mergeCalendarSources(pendingApiResult.bookings, localRows);
            }

            latestCalendarRows = Array.isArray(calendarRows) ? calendarRows.slice() : [];
            renderCalendar(latestCalendarRows);
            refreshDayScheduleModalIfOpen();
        } finally {
            loadRowsInFlight = false;
        }
    }

    function startAutoRefresh() {
        if (autoRefreshTimerId) {
            return;
        }
        autoRefreshTimerId = window.setInterval(function () {
            void loadRows(false);
        }, AUTO_REFRESH_INTERVAL_MS);
    }

    function stopAutoRefresh() {
        if (!autoRefreshTimerId) {
            return;
        }
        window.clearInterval(autoRefreshTimerId);
        autoRefreshTimerId = null;
    }

    function openDetailsPage(orderId, createdAt) {
        const selected = renderedItems.find(function (item) {
            return item.orderId === orderId && item.createdAt === createdAt;
        });
        if (selected) {
            localStorage.setItem(adminSelectedBookingKey, JSON.stringify(selected));
        }

        const query = new URLSearchParams();
        query.set("orderId", orderId);
        if (createdAt) {
            query.set("createdAt", createdAt);
        }
        window.location.href = "adminorder-view.html?" + query.toString();
    }

    if (calendarPrevBtn) {
        calendarPrevBtn.addEventListener("click", function () {
            calendarMonthCursor = new Date(calendarMonthCursor.getFullYear(), calendarMonthCursor.getMonth() - 1, 1);
            renderCalendar(latestCalendarRows);
        });
    }

    if (calendarNextBtn) {
        calendarNextBtn.addEventListener("click", function () {
            calendarMonthCursor = new Date(calendarMonthCursor.getFullYear(), calendarMonthCursor.getMonth() + 1, 1);
            renderCalendar(latestCalendarRows);
        });
    }

    if (bookingCalendar) {
        bookingCalendar.addEventListener("click", function (event) {
            const dateCell = event.target.closest("[data-calendar-date-key]");
            if (!dateCell || !bookingCalendar.contains(dateCell)) {
                return;
            }
            openDayScheduleModal(dateCell.getAttribute("data-calendar-date-key"));
        });

        bookingCalendar.addEventListener("keydown", function (event) {
            if (event.key !== "Enter" && event.key !== " ") {
                return;
            }

            const dateCell = event.target.closest("[data-calendar-date-key]");
            if (!dateCell || !bookingCalendar.contains(dateCell)) {
                return;
            }
            event.preventDefault();
            openDayScheduleModal(dateCell.getAttribute("data-calendar-date-key"));
        });
    }

    if (calendarDayModal) {
        calendarDayModal.addEventListener("click", function (event) {
            const closeTarget = event.target.closest("[data-modal-close]");
            if (closeTarget) {
                closeDayScheduleModal();
                return;
            }

            const viewTarget = event.target.closest("[data-modal-action=\"view-booking\"]");
            if (!viewTarget) {
                return;
            }

            const orderId = decodeToken(viewTarget.getAttribute("data-order-id"));
            const createdAt = decodeToken(viewTarget.getAttribute("data-created-at"));
            if (!orderId) {
                return;
            }

            closeDayScheduleModal();
            openDetailsPage(orderId, createdAt);
        });
    }

    rowsContainer.addEventListener("click", async function (event) {
        const actionButton = event.target.closest("[data-action]");
        if (!actionButton) {
            return;
        }

        const action = String(actionButton.getAttribute("data-action") || "").trim().toLowerCase();
        const orderId = decodeToken(actionButton.getAttribute("data-order-id"));
        const createdAt = decodeToken(actionButton.getAttribute("data-created-at"));
        if (!orderId) {
            return;
        }

        if (action === "view") {
            openDetailsPage(orderId, createdAt);
            return;
        }

        if (action !== "approve" && action !== "reject") {
            return;
        }

        const confirmMessage = action === "approve"
            ? "Approve this booking request?"
            : "Reject this booking request?";
        if (!window.confirm(confirmMessage)) {
            return;
        }

        const apiResult = await updateBookingDecisionViaApi(orderId, action);
        if (apiResult.mode === "ok") {
            await loadRows(true);
            return;
        }

        if (apiResult.mode === "error") {
            alert(apiResult.message || "Unable to update booking status.");
            return;
        }
        alert("API unavailable. Unable to update booking status.");
    });

    window.addEventListener("storage", function (event) {
        if (!event.key || watchedStorageKeys.has(event.key)) {
            void loadRows(true);
        }
    });

    document.addEventListener("visibilitychange", function () {
        if (document.hidden) {
            stopAutoRefresh();
            return;
        }
        void loadRows(true);
        startAutoRefresh();
    });

    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && calendarDayModal && !calendarDayModal.hidden) {
            closeDayScheduleModal();
        }
    });

    window.addEventListener("beforeunload", stopAutoRefresh);

    void loadRows(true);
    startAutoRefresh();
});
