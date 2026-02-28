(function () {
            const navbar = document.querySelector(".navbar");
            const navToggle = document.getElementById("nav-toggle");
            const navRight = document.getElementById("nav-right");
            const profileBtn = document.querySelector(".profile-menu .profile-btn");
            const dropdown = document.querySelector(".profile-menu .dropdown");
            const bookingRows = document.getElementById("bookingRows");
            const currentUserKey = "ecodrive_current_user_email";
            const bookingStorageKeys = ["ecodrive_bookings", "ecodrive_orders", "orders"];
            const API_BASE = String(
                localStorage.getItem("ecodrive_api_base") ||
                localStorage.getItem("ecodrive_kyc_api_base") ||
                (window.EcodriveSession && typeof window.EcodriveSession.getApiBase === "function"
                    ? window.EcodriveSession.getApiBase()
                    : "")
            )
                .trim()
                .replace(/\/+$/, "");
            const BOOKING_REFRESH_INTERVAL_MS = 3000;
            const REJECTED_NOTIFIED_KEY_PREFIX = "ecodrive_rejected_booking_notif_seen::";
            const RECEIPT_PDF_SCRIPT_SOURCES = [
                "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js",
                "https://unpkg.com/jspdf@2.5.2/dist/jspdf.umd.min.js"
            ];
            let bookingRefreshTimerId = null;
            let bookingRefreshInFlight = false;
            let latestRenderedBookingItems = [];
            let receiptPdfLibPromise = null;

            function isMobileMenuLayout() {
                return window.matchMedia("(max-width: 980px)").matches;
            }

            function closeNavMenu() {
                if (!navRight || !navToggle) {
                    return;
                }
                navRight.classList.remove("open");
                navToggle.setAttribute("aria-expanded", "false");
            }

            if (navToggle && navRight) {
                navToggle.addEventListener("click", function (event) {
                    event.stopPropagation();
                    const willOpen = !navRight.classList.contains("open");
                    navRight.classList.toggle("open", willOpen);
                    navToggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
                });

                navRight.addEventListener("click", function (event) {
                    const navLink = event.target.closest(".nav-links a");
                    if (navLink && isMobileMenuLayout()) {
                        closeNavMenu();
                    }
                });

                window.addEventListener("resize", function () {
                    if (!isMobileMenuLayout()) {
                        closeNavMenu();
                    }
                });

                document.addEventListener("click", function (event) {
                    if (!isMobileMenuLayout()) {
                        return;
                    }
                    if (navbar && !navbar.contains(event.target)) {
                        closeNavMenu();
                    }
                });
            }

            if (profileBtn && dropdown) {
                profileBtn.addEventListener("click", function (e) {
                    e.stopPropagation();
                    dropdown.classList.toggle("show");
                });

                dropdown.addEventListener("click", function (e) {
                    e.stopPropagation();
                });

                document.addEventListener("click", function () {
                    dropdown.classList.remove("show");
                });
            }

            function safeParse(value) {
                try {
                    return JSON.parse(value);
                } catch (_error) {
                    return null;
                }
            }

            function getApiUrl(path) {
                return API_BASE ? API_BASE + path : path;
            }

            async function cancelBookingViaApi(orderId) {
                const email = getCurrentUserEmail();
                if (!orderId || !email) {
                    return false;
                }

                try {
                    const response = await fetch(getApiUrl("/api/bookings/" + encodeURIComponent(orderId) + "/cancel"), {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            email: email
                        })
                    });

                    if (response.status === 404 || response.status === 405) {
                        return false;
                    }

                    const payload = await response.json().catch(function () {
                        return {};
                    });
                    return response.ok && payload && payload.success === true;
                } catch (_error) {
                    return false;
                }
            }

            function getCurrentUserEmail() {
                const localValue = (localStorage.getItem(currentUserKey) || "").trim().toLowerCase();
                if (localValue) {
                    return localValue;
                }
                return (sessionStorage.getItem(currentUserKey) || "").trim().toLowerCase();
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

            function getSourceOrderId(record) {
                return String((record && (record.orderId || record.id)) || "")
                    .trim()
                    .toLowerCase();
            }

            function normalizeColorText(value) {
                return String(value || "")
                    .trim()
                    .replace(/\s+/g, " ");
            }

            function splitModelAndColorFromModelText(modelText) {
                const normalizedModel = String(modelText || "").trim().replace(/\s+/g, " ");
                const match = normalizedModel.match(/^(.*)\(([^)]+)\)\s*$/);
                if (!match) {
                    return {
                        model: normalizedModel,
                        color: ""
                    };
                }

                const baseModel = String(match[1] || "").trim().replace(/\s+/g, " ");
                const suffixColor = normalizeColorText(match[2]);
                const looksLikeColor = suffixColor && !/\d/.test(suffixColor);
                if (!looksLikeColor || !baseModel) {
                    return {
                        model: normalizedModel,
                        color: ""
                    };
                }
                return {
                    model: baseModel,
                    color: suffixColor
                };
            }

            function getModelLabelFromRecord(record) {
                const modelText = String((record && (record.model || record.productName || record.itemName || "Ecodrive E-Bike")) || "Ecodrive E-Bike");
                const parsed = splitModelAndColorFromModelText(modelText);
                return parsed.model || "Ecodrive E-Bike";
            }

            function getBikeColorLabelFromRecord(record) {
                const direct = normalizeColorText(
                    record && (record.bikeColor || record.color || record.selectedColor || record.bike_color)
                );
                if (direct) {
                    return direct;
                }
                const modelText = String((record && (record.model || record.productName || record.itemName)) || "");
                return splitModelAndColorFromModelText(modelText).color;
            }

            function mergeBookingSnapshot(baseBooking, incomingBooking) {
                const base = (baseBooking && typeof baseBooking === "object") ? baseBooking : {};
                const incoming = (incomingBooking && typeof incomingBooking === "object") ? incomingBooking : {};
                const merged = Object.assign({}, base, incoming);
                const incomingColor = getBikeColorLabelFromRecord(incoming);
                const baseColor = getBikeColorLabelFromRecord(base);
                if (!incomingColor && baseColor) {
                    merged.bikeColor = baseColor;
                    merged.color = baseColor;
                }
                return merged;
            }

            function getSourceFallbackKey(record) {
                if (!record || typeof record !== "object") {
                    return "";
                }

                const model = String(getModelLabelFromRecord(record))
                    .trim()
                    .toLowerCase();
                const createdAt = String(record.createdAt || record.updatedAt || "").trim();
                const total = Number(record.total || record.subtotal || 0).toFixed(2);
                const userEmail = String(record.email || record.userEmail || "")
                    .trim()
                    .toLowerCase();

                if (!model && !createdAt && total === "0.00") {
                    return "";
                }

                return [model, createdAt, total, userEmail].join("|");
            }

            function getSourceIdentityKey(record) {
                const orderId = getSourceOrderId(record);
                if (orderId) {
                    return "id:" + orderId;
                }

                const fallback = getSourceFallbackKey(record);
                return fallback ? "fallback:" + fallback : "";
            }

            function mergeApiAndLocalRows(apiRows, localRows) {
                const apiList = Array.isArray(apiRows) ? apiRows : [];
                const localList = Array.isArray(localRows) ? localRows : [];
                const localByIdentity = new Map();
                const merged = [];
                const seen = new Set();

                localList.forEach(function (record) {
                    const key = getSourceIdentityKey(record);
                    if (!key || localByIdentity.has(key)) {
                        return;
                    }
                    localByIdentity.set(key, record);
                });

                apiList.forEach(function (record) {
                    const key = getSourceIdentityKey(record);
                    if (key) {
                        seen.add(key);
                    }
                    if (key && localByIdentity.has(key)) {
                        merged.push(mergeBookingSnapshot(localByIdentity.get(key), record));
                        return;
                    }
                    merged.push(record);
                });

                localList.forEach(function (record) {
                    const key = getSourceIdentityKey(record);
                    if (!key || !seen.has(key)) {
                        merged.push(record);
                    }
                });

                return merged;
            }

            async function fetchBookingsFromApi() {
                const email = getCurrentUserEmail();
                if (!email) {
                    return [];
                }

                try {
                    const response = await fetch(getApiUrl("/api/bookings?email=" + encodeURIComponent(email)), {
                        method: "GET"
                    });

                    if (response.status === 404 || response.status === 405) {
                        return [];
                    }

                    const payload = await response.json().catch(function () {
                        return {};
                    });
                    if (!response.ok || payload.success !== true || !Array.isArray(payload.bookings)) {
                        return [];
                    }

                    return payload.bookings;
                } catch (_error) {
                    return [];
                }
            }

            function canCancelBookingStatus(statusValue, fulfillmentValue) {
                const mergedStatus = (String(statusValue || "") + " " + String(fulfillmentValue || "")).toLowerCase();
                if (mergedStatus.includes("cancel")) {
                    return false;
                }
                if (mergedStatus.includes("reject")) {
                    return false;
                }
                if (mergedStatus.includes("completed") || mergedStatus.includes("delivered")) {
                    return false;
                }
                return true;
            }

            function canPrintReceiptStatus(statusValue, fulfillmentValue) {
                const mergedStatus = (String(statusValue || "") + " " + String(fulfillmentValue || "")).toLowerCase();
                if (mergedStatus.includes("cancel") || mergedStatus.includes("reject")) {
                    return false;
                }
                return (
                    mergedStatus.includes("approve")
                    || mergedStatus.includes("deliver")
                    || mergedStatus.includes("complete")
                    || mergedStatus.includes("picked up")
                    || mergedStatus.includes("released")
                );
            }

            function isCancelledBookingStatus(statusValue, fulfillmentValue) {
                const mergedStatus = (String(statusValue || "") + " " + String(fulfillmentValue || "")).toLowerCase();
                return mergedStatus.includes("cancel");
            }

            function isRejectedBookingStatus(statusValue, fulfillmentValue) {
                const mergedStatus = (String(statusValue || "") + " " + String(fulfillmentValue || "")).toLowerCase();
                if (mergedStatus.includes("cancel")) {
                    return false;
                }
                return mergedStatus.includes("reject");
            }

            function isHiddenBookingStatus(statusValue, fulfillmentValue) {
                return isCancelledBookingStatus(statusValue, fulfillmentValue)
                    || isRejectedBookingStatus(statusValue, fulfillmentValue);
            }

            function getRecordEmail(record) {
                return String((record && (record.email || record.userEmail)) || "").trim().toLowerCase();
            }

            function isRecordForCurrentUser(record, currentEmail) {
                if (!currentEmail) {
                    return true;
                }
                return getRecordEmail(record) === currentEmail;
            }

            function getRejectedNotifiedStorageKey() {
                const email = getCurrentUserEmail();
                return REJECTED_NOTIFIED_KEY_PREFIX + (email || "guest");
            }

            function readRejectedNotifiedIds() {
                const parsed = safeParse(localStorage.getItem(getRejectedNotifiedStorageKey()));
                if (!Array.isArray(parsed)) {
                    return [];
                }
                return parsed
                    .map(function (item) {
                        return String(item || "").trim();
                    })
                    .filter(Boolean);
            }

            function saveRejectedNotifiedIds(ids) {
                localStorage.setItem(getRejectedNotifiedStorageKey(), JSON.stringify(Array.from(ids)));
            }

            function getRejectedNotificationId(record) {
                const identityKey = getSourceIdentityKey(record);
                if (identityKey) {
                    return identityKey;
                }
                const orderId = getRecordOrderId(record).toLowerCase();
                return orderId ? "id:" + orderId : "";
            }

            function getBookingModelLabel(record) {
                return String(getModelLabelFromRecord(record) || "your booking").trim();
            }

            function captureRejectedBookingNotifications(records) {
                const rows = Array.isArray(records) ? records : [];
                const currentEmail = getCurrentUserEmail();
                const seenIds = new Set(readRejectedNotifiedIds());
                let seenChanged = false;
                const newlyRejected = [];
                const rejectedOrderIds = new Set();

                rows.forEach(function (record) {
                    if (!record || typeof record !== "object") {
                        return;
                    }
                    if (!isRecordForCurrentUser(record, currentEmail)) {
                        return;
                    }

                    const status = String(record.status || "");
                    const fulfillmentStatus = String(record.fulfillmentStatus || "");
                    if (!isRejectedBookingStatus(status, fulfillmentStatus)) {
                        return;
                    }

                    const recordOrderId = getRecordOrderId(record).toLowerCase();
                    if (recordOrderId) {
                        rejectedOrderIds.add(recordOrderId);
                    }

                    const notificationId = getRejectedNotificationId(record);
                    if (!notificationId || seenIds.has(notificationId)) {
                        return;
                    }

                    seenIds.add(notificationId);
                    seenChanged = true;
                    newlyRejected.push(record);
                });

                if (seenChanged) {
                    saveRejectedNotifiedIds(seenIds);
                }

                return {
                    newlyRejected: newlyRejected,
                    rejectedOrderIds: rejectedOrderIds
                };
            }

            function cleanupCancelledBookings(rejectedOrderIdsInput) {
                const currentEmail = getCurrentUserEmail();
                const rejectedOrderIds = rejectedOrderIdsInput instanceof Set
                    ? rejectedOrderIdsInput
                    : new Set();
                let changed = false;

                bookingStorageKeys.forEach(function (key) {
                    const parsed = safeParse(localStorage.getItem(key));
                    if (!Array.isArray(parsed)) {
                        return;
                    }

                    const filtered = parsed.filter(function (record) {
                        if (!record || typeof record !== "object") {
                            return false;
                        }

                        const status = String(record.status || "");
                        const fulfillmentStatus = String(record.fulfillmentStatus || "");
                        const recordOrderId = getRecordOrderId(record).toLowerCase();
                        if (recordOrderId && rejectedOrderIds.has(recordOrderId) && isRecordForCurrentUser(record, currentEmail)) {
                            return false;
                        }

                        if (!isHiddenBookingStatus(status, fulfillmentStatus)) {
                            return true;
                        }

                        return !isRecordForCurrentUser(record, currentEmail);
                    });

                    if (filtered.length !== parsed.length) {
                        localStorage.setItem(key, JSON.stringify(filtered));
                        changed = true;
                    }
                });

                const latest = safeParse(localStorage.getItem("latestBooking"));
                if (latest && typeof latest === "object") {
                    const latestStatus = String(latest.status || "");
                    const latestFulfillmentStatus = String(latest.fulfillmentStatus || "");
                    const latestOrderId = getRecordOrderId(latest).toLowerCase();
                    const shouldRemoveByOrderId = latestOrderId && rejectedOrderIds.has(latestOrderId) && isRecordForCurrentUser(latest, currentEmail);
                    const shouldRemoveByStatus = isHiddenBookingStatus(latestStatus, latestFulfillmentStatus) && isRecordForCurrentUser(latest, currentEmail);
                    if (shouldRemoveByOrderId || shouldRemoveByStatus) {
                        localStorage.removeItem("latestBooking");
                        changed = true;
                    }
                }

                return changed;
            }

            function normalizeBookings(rawBookings) {
                const currentEmail = getCurrentUserEmail();

                const normalized = rawBookings
                    .map(function (item, index) {
                        if (!item || typeof item !== "object") {
                            return null;
                        }

                        const entryEmail = String(item.email || item.userEmail || "").trim().toLowerCase();
                        if (currentEmail && entryEmail !== currentEmail) {
                            return null;
                        }

                        const createdAt = item.createdAt || item.updatedAt || new Date().toISOString();
                        const service = String(item.service || item.deliveryOption || "Delivery");
                        const status = String(item.status || "Preparing");
                        const fulfillmentStatus = String(item.fulfillmentStatus || (service === "Pick Up" ? "Ready to Pick up" : "In Process"));
                        if (isHiddenBookingStatus(status, fulfillmentStatus)) {
                            return null;
                        }

                        const rawOrderId = String(item.orderId || item.id || "").trim();
                        const modelLabel = getModelLabelFromRecord(item);
                        const bikeColor = getBikeColorLabelFromRecord(item);
                        const installment = getInstallmentPayload(item);
                        const rawTotal = toCurrencyNumber(item.total);
                        const installmentInitialDue = resolveInstallmentInitialDue({
                            payment: item.payment || item.paymentMethod || "",
                            service: service,
                            installment: installment
                        });
                        const totalDisplayAmount = installmentInitialDue > 0
                            ? installmentInitialDue
                            : rawTotal;
                        const totalDisplayNote = installmentInitialDue > 0
                            ? "DP + 1st hulog"
                            : "";
                        return {
                            orderId: String(rawOrderId || ("#EC-" + (1000 + index))),
                            dedupeOrderId: rawOrderId.toLowerCase(),
                            fullName: String(item.fullName || item.name || ""),
                            email: String(item.email || item.userEmail || ""),
                            model: String(modelLabel || "Ecodrive Ebike"),
                            bikeColor: String(bikeColor || ""),
                            createdAt: createdAt,
                            schedule: formatSchedule(item),
                            status: status,
                            total: rawTotal,
                            totalDisplayAmount: totalDisplayAmount,
                            totalDisplayNote: totalDisplayNote,
                            service: service,
                            payment: String(item.payment || item.paymentMethod || "Unspecified"),
                            installment: installment,
                            shippingAddress: String(item.shippingAddress || ""),
                            fulfillmentStatus: fulfillmentStatus,
                            receiptNumber: String(item.receiptNumber || item.receipt_number || ""),
                            receiptIssuedAt: item.receiptIssuedAt || item.receipt_issued_at || "",
                            trackingEta: String(item.trackingEta || item.eta || ""),
                            trackingLocation: String(item.trackingLocation || item.locationNote || item.location || ""),
                            canCancel: canCancelBookingStatus(status, fulfillmentStatus)
                        };
                    })
                    .filter(Boolean)
                    .sort(function (a, b) {
                        return String(b.createdAt).localeCompare(String(a.createdAt));
                    });

                const deduped = [];
                const seen = new Set();
                normalized.forEach(function (item) {
                    const key = item.dedupeOrderId
                        ? "id:" + item.dedupeOrderId
                        : "fallback:" + String(item.model || "").toLowerCase()
                            + "|" + String(item.createdAt || "")
                            + "|" + Number(item.total || 0).toFixed(2)
                            + "|" + String(item.service || "").toLowerCase();
                    if (!seen.has(key)) {
                        seen.add(key);
                        deduped.push(item);
                    }
                });

                return deduped;
            }

            function buildLocalDateFromParts(dateValue, timeValue) {
                const dateText = String(dateValue || "").trim();
                const dateMatch = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
                if (!dateMatch) {
                    return null;
                }

                const hoursMatch = String(timeValue || "").trim().match(/^(\d{2}):(\d{2})/);
                const year = Number(dateMatch[1]);
                const month = Number(dateMatch[2]) - 1;
                const day = Number(dateMatch[3]);
                const hours = hoursMatch ? Number(hoursMatch[1]) : 0;
                const minutes = hoursMatch ? Number(hoursMatch[2]) : 0;
                const value = new Date(year, month, day, hours, minutes, 0, 0);
                if (Number.isNaN(value.getTime())) {
                    return null;
                }
                return value;
            }

            function formatDate(dateValue) {
                const date = new Date(dateValue);
                if (Number.isNaN(date.getTime())) {
                    return "-";
                }

                return date.toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric"
                });
            }

            function formatSchedule(item) {
                if (!item || typeof item !== "object") {
                    return "-";
                }

                const explicitLabel = String(item.scheduleLabel || "").trim();
                if (explicitLabel) {
                    return explicitLabel;
                }

                const scheduleDate = item.scheduleDate || item.bookingDate || "";
                const scheduleTime = item.scheduleTime || item.bookingTime || "";
                const localSchedule = buildLocalDateFromParts(scheduleDate, scheduleTime);
                if (localSchedule) {
                    return localSchedule.toLocaleString("en-US", {
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                        hour12: true
                    });
                }

                const scheduledAt = new Date(item.scheduledAt || item.scheduleAt || "");
                if (!Number.isNaN(scheduledAt.getTime())) {
                    return scheduledAt.toLocaleString("en-US", {
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                        hour12: true
                    });
                }

                return "-";
            }

            function formatPeso(amount) {
                const value = Number(amount || 0);
                return "&#8369;" + value.toLocaleString("en-PH", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                });
            }

            function toCurrencyNumber(value) {
                const amount = Number(value || 0);
                if (!Number.isFinite(amount)) {
                    return 0;
                }
                return Number(amount.toFixed(2));
            }

            function getInstallmentPayload(record) {
                if (!record || typeof record !== "object") {
                    return null;
                }
                return record.installment && typeof record.installment === "object"
                    ? record.installment
                    : null;
            }

            function isInstallmentBookingRecord(record) {
                const payment = String(record && (record.payment || record.paymentMethod) || "").toLowerCase();
                const service = String(record && record.service || "").toLowerCase();
                return payment.includes("installment")
                    || service.includes("installment")
                    || Boolean(getInstallmentPayload(record));
            }

            function resolveInstallmentInitialDue(record) {
                if (!isInstallmentBookingRecord(record)) {
                    return 0;
                }

                const installment = getInstallmentPayload(record);
                if (!installment) {
                    return 0;
                }

                const minDp = toCurrencyNumber(
                    installment.planMinDp
                    || installment.minDp
                    || installment.downPayment
                    || installment.dp
                );
                const monthlyAmount = toCurrencyNumber(
                    installment.monthlyAmortization
                    || installment.monthlyAmount
                    || installment.monthlyPayment
                    || installment.monthly
                );
                const computed = toCurrencyNumber(
                    (minDp > 0 ? minDp : 0)
                    + (monthlyAmount > 0 ? monthlyAmount : 0)
                );

                if (computed > 0) {
                    return computed;
                }
                if (minDp > 0) {
                    return minDp;
                }
                if (monthlyAmount > 0) {
                    return monthlyAmount;
                }
                return 0;
            }

            function parseInstallmentReceiptMetrics(record) {
                if (!isInstallmentBookingRecord(record)) {
                    return null;
                }

                const installment = getInstallmentPayload(record);
                if (!installment) {
                    return null;
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

                const monthlyRaw = toCurrencyNumber(
                    installment.monthlyAmortization
                    || installment.monthlyAmount
                    || installment.monthlyPayment
                    || installment.monthly
                );
                const minDp = toCurrencyNumber(
                    installment.planMinDp
                    || installment.minDp
                    || installment.downPayment
                    || installment.dp
                );
                const totalRaw = toCurrencyNumber(record && record.total);
                const fallbackMonthly = (monthsToPay > 0 && totalRaw > 0)
                    ? toCurrencyNumber(Math.max((totalRaw - minDp) / monthsToPay, 0))
                    : 0;
                const monthlyPayment = monthlyRaw > 0 ? monthlyRaw : fallbackMonthly;

                const paymentHistory = Array.isArray(installment.paymentHistory)
                    ? installment.paymentHistory
                    : [];
                const historyPaidCount = paymentHistory.filter(function (entry) {
                    return String(entry && entry.status || "").toLowerCase().includes("paid");
                }).length;

                const paidCountRaw = Number(
                    installment.paidInstallments
                    || installment.paidCount
                    || installment.monthsPaid
                    || installment.installmentsPaid
                    || 0
                );
                let paidCount = Number.isFinite(paidCountRaw) && paidCountRaw > 0
                    ? Math.floor(paidCountRaw)
                    : 0;
                if (historyPaidCount > paidCount) {
                    paidCount = historyPaidCount;
                }
                if (monthsToPay > 0 && paidCount > monthsToPay) {
                    paidCount = monthsToPay;
                }

                let paidAmount = toCurrencyNumber(
                    installment.totalPaid
                    || installment.paidAmount
                    || installment.totalPaidAmount
                );
                if (!(paidAmount > 0) && paymentHistory.length > 0) {
                    paidAmount = toCurrencyNumber(
                        paymentHistory.reduce(function (sum, entry) {
                            return sum + toCurrencyNumber(
                                entry && (entry.amount || entry.value || entry.monthlyAmount)
                            );
                        }, 0)
                    );
                }
                if (!(paidAmount > 0) && monthlyPayment > 0 && paidCount > 0) {
                    paidAmount = toCurrencyNumber(monthlyPayment * paidCount);
                }

                let totalInstallmentPayable = (monthsToPay > 0 && monthlyPayment > 0)
                    ? toCurrencyNumber(monthlyPayment * monthsToPay)
                    : toCurrencyNumber(Math.max(totalRaw - minDp, 0));
                if (!(totalInstallmentPayable > 0)) {
                    totalInstallmentPayable = totalRaw;
                }

                const outstandingBalance = Math.max(
                    toCurrencyNumber(totalInstallmentPayable - paidAmount),
                    0
                );
                const totalPayableForReceipt = toCurrencyNumber(
                    totalInstallmentPayable + (minDp > 0 ? minDp : 0)
                ) || totalInstallmentPayable;

                return {
                    monthlyPayment: monthlyPayment,
                    paidCount: paidCount,
                    monthsToPay: monthsToPay,
                    paidAmount: paidAmount,
                    downPayment: minDp,
                    totalInstallmentPayable: totalInstallmentPayable,
                    outstandingBalance: outstandingBalance,
                    totalPayableForReceipt: totalPayableForReceipt,
                    progressLabel: monthsToPay > 0
                        ? (String(paidCount) + "/" + String(monthsToPay))
                        : (String(paidCount) + "/-")
                };
            }

            function formatReceiptAmountText(amount) {
                const value = Number(amount || 0);
                return "PHP " + value.toLocaleString("en-PH", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                });
            }

            function formatReceiptIssuedDate(value) {
                const date = new Date(value || "");
                if (Number.isNaN(date.getTime())) {
                    return "Date unavailable";
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

            function getReceiptNumber(item) {
                const existing = String(item && item.receiptNumber || "").trim();
                if (existing) {
                    return existing;
                }
                const orderId = String(item && item.orderId || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
                const dateBase = new Date(item && (item.receiptIssuedAt || item.createdAt) || "");
                const sourceDate = Number.isNaN(dateBase.getTime()) ? new Date() : dateBase;
                const year = sourceDate.getFullYear();
                const month = String(sourceDate.getMonth() + 1).padStart(2, "0");
                const day = String(sourceDate.getDate()).padStart(2, "0");
                const suffix = orderId.slice(-8) || "PENDING";
                return "ECR-" + year + month + day + "-" + suffix;
            }

            function buildPrintableReceiptHtml(item) {
                const receiptNumber = getReceiptNumber(item);
                const issuedAt = formatReceiptIssuedDate(item.receiptIssuedAt || item.createdAt);
                const printedAt = new Date().toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true
                });
                const customer = escapeHtml(String(item.fullName || "Customer"));
                const email = escapeHtml(String(item.email || "-"));
                const orderId = escapeHtml(String(item.orderId || "-"));
                const modelLabel = String(getModelLabelFromRecord(item) || "Ecodrive E-Bike");
                const bikeColorLabel = String(getBikeColorLabelFromRecord(item) || "").trim();
                const model = escapeHtml(modelLabel);
                const bikeColor = escapeHtml(bikeColorLabel || "-");
                const itemName = escapeHtml(
                    bikeColorLabel
                        ? (modelLabel + " (" + bikeColorLabel + ")")
                        : modelLabel
                );
                const service = escapeHtml(String(item.service || "-"));
                const payment = escapeHtml(String(item.payment || "-"));
                const schedule = escapeHtml(String(item.schedule || "-"));
                const status = escapeHtml(String(item.status || "-"));
                const fulfillment = escapeHtml(String(item.fulfillmentStatus || "-"));
                const trackingEta = escapeHtml(String(item.trackingEta || "Not set"));
                const trackingLocation = escapeHtml(String(item.trackingLocation || "Not set"));
                const shippingAddress = escapeHtml(String(item.shippingAddress || "-"));
                const installmentMetrics = parseInstallmentReceiptMetrics(item);
                const totalAmount = installmentMetrics
                    ? installmentMetrics.totalPayableForReceipt
                    : toCurrencyNumber(item.total || 0);
                const total = formatPeso(totalAmount);
                const encodedOrderId = encodeToken(item.orderId || "");
                const encodedCreatedAt = encodeToken(item.createdAt || "");
                const serviceLine = String(item.service || "").toLowerCase().includes("delivery")
                    ? "<div class=\"row\"><span class=\"label\">Address</span><span class=\"value\">" + shippingAddress + "</span></div>"
                    : "";
                const installmentInfoRows = installmentMetrics
                    ? (
                        "<div class=\"row\"><span class=\"label\">Monthly Payment</span><span class=\"value\">" + escapeHtml(formatPeso(installmentMetrics.monthlyPayment)) + "</span></div>"
                        + "<div class=\"row\"><span class=\"label\">Paid Installment</span><span class=\"value\">" + escapeHtml(installmentMetrics.progressLabel) + "</span></div>"
                        + "<div class=\"row\"><span class=\"label\">Total Paid</span><span class=\"value\">" + escapeHtml(
                            formatPeso(installmentMetrics.paidAmount)
                            + " / "
                            + formatPeso(installmentMetrics.totalInstallmentPayable)
                        ) + "</span></div>"
                    )
                    : "";
                const installmentTotalsRows = installmentMetrics
                    ? (
                        "<div class=\"row\"><span class=\"label\">Installment Total</span><span class=\"value\">" + escapeHtml(formatPeso(installmentMetrics.totalInstallmentPayable)) + "</span></div>"
                        + (
                            installmentMetrics.downPayment > 0
                                ? "<div class=\"row\"><span class=\"label\">Downpayment</span><span class=\"value\">" + escapeHtml(formatPeso(installmentMetrics.downPayment)) + "</span></div>"
                                : ""
                        )
                        + "<div class=\"row\"><span class=\"label\">Outstanding</span><span class=\"value\">" + escapeHtml(formatPeso(installmentMetrics.outstandingBalance)) + "</span></div>"
                        + "<div class=\"row strong\"><span class=\"label\">TOTAL PAYABLE</span><span class=\"value\">" + escapeHtml(formatPeso(installmentMetrics.totalPayableForReceipt)) + "</span></div>"
                    )
                    : (
                        "<div class=\"row\"><span class=\"label\">Subtotal</span><span class=\"value\">" + total + "</span></div>"
                        + "<div class=\"row\"><span class=\"label\">Discount</span><span class=\"value\">" + formatPeso(0) + "</span></div>"
                        + "<div class=\"row strong\"><span class=\"label\">TOTAL</span><span class=\"value\">" + total + "</span></div>"
                    );

                return "<!DOCTYPE html>"
                    + "<html lang=\"en\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">"
                    + "<title>Ecodrive Receipt " + escapeHtml(receiptNumber) + "</title>"
                    + "<style>"
                    + "*{box-sizing:border-box}"
                    + "body{margin:0;padding:14px;background:#e9edf2;font-family:'Courier New',Consolas,monospace;color:#111}"
                    + ".sheet{width:78mm;max-width:100%;margin:0 auto;background:#fff;border:1px dashed #a4abb5;padding:10px 9px}"
                    + ".center{text-align:center}.brand{font-size:16px;font-weight:700;letter-spacing:1px}.muted{font-size:9px;line-height:1.3}"
                    + ".hr{border-top:1px dashed #111;margin:6px 0}.row{display:flex;justify-content:space-between;gap:8px;font-size:10px;line-height:1.35}"
                    + ".label{flex:0 0 40%}.value{flex:1;text-align:right;word-break:break-word}"
                    + ".items-head,.item{display:flex;justify-content:space-between;gap:6px;font-size:10px;line-height:1.35}"
                    + ".item-name{flex:1;word-break:break-word}.item-qty{width:24px;text-align:center}.item-amount{width:74px;text-align:right}"
                    + ".totals{margin-top:4px}.strong{font-weight:700}.foot{margin-top:8px;text-align:center;font-size:9px;line-height:1.4}"
                    + ".actions{margin-top:10px;display:flex;gap:6px;justify-content:center}.actions button{border:1px solid #111;background:#fff;padding:6px 10px;font:inherit;font-size:10px;cursor:pointer}.actions .download{background:#1f4a92;border-color:#1f4a92;color:#fff}"
                    + "@media print{@page{size:80mm auto;margin:4mm}body{background:#fff;padding:0}.sheet{width:100%;max-width:none;border:none;padding:0}.actions{display:none}}"
                    + "</style></head><body><div class=\"sheet\">"
                    + "<div class=\"center brand\">ECODRIVE</div>"
                    + "<div class=\"center muted\">Official Booking Receipt</div>"
                    + "<div class=\"center muted\">" + escapeHtml(issuedAt) + "</div>"
                    + "<div class=\"hr\"></div>"
                    + "<div class=\"row\"><span class=\"label\">Receipt No</span><span class=\"value\">" + escapeHtml(receiptNumber) + "</span></div>"
                    + "<div class=\"row\"><span class=\"label\">Order ID</span><span class=\"value\">" + orderId + "</span></div>"
                    + "<div class=\"row\"><span class=\"label\">Customer</span><span class=\"value\">" + customer + "</span></div>"
                    + "<div class=\"row\"><span class=\"label\">Email</span><span class=\"value\">" + email + "</span></div>"
                    + "<div class=\"row\"><span class=\"label\">Model</span><span class=\"value\">" + model + "</span></div>"
                    + "<div class=\"row\"><span class=\"label\">Color</span><span class=\"value\">" + bikeColor + "</span></div>"
                    + "<div class=\"row\"><span class=\"label\">Service</span><span class=\"value\">" + service + "</span></div>"
                    + "<div class=\"row\"><span class=\"label\">Payment</span><span class=\"value\">" + payment + "</span></div>"
                    + "<div class=\"row\"><span class=\"label\">Schedule</span><span class=\"value\">" + schedule + "</span></div>"
                    + serviceLine
                    + "<div class=\"row\"><span class=\"label\">Status</span><span class=\"value\">" + status + "</span></div>"
                    + "<div class=\"row\"><span class=\"label\">Progress</span><span class=\"value\">" + fulfillment + "</span></div>"
                    + "<div class=\"row\"><span class=\"label\">ETA</span><span class=\"value\">" + trackingEta + "</span></div>"
                    + "<div class=\"row\"><span class=\"label\">Location</span><span class=\"value\">" + trackingLocation + "</span></div>"
                    + installmentInfoRows
                    + "<div class=\"hr\"></div>"
                    + "<div class=\"items-head strong\"><span class=\"item-name\">Item</span><span class=\"item-qty\">Qty</span><span class=\"item-amount\">Amount</span></div>"
                    + "<div class=\"item\"><span class=\"item-name\">" + itemName + "</span><span class=\"item-qty\">1</span><span class=\"item-amount\">" + total + "</span></div>"
                    + "<div class=\"hr\"></div>"
                    + "<div class=\"totals\">"
                    + installmentTotalsRows
                    + "</div>"
                    + "<div class=\"hr\"></div>"
                    + "<div class=\"foot\">Printed: " + escapeHtml(printedAt) + "<br>Generated by User Portal<br>THANK YOU</div>"
                    + "<div class=\"actions\">"
                    + "<button type=\"button\" class=\"download\" id=\"receiptDownloadBtn\" data-order-id=\"" + escapeHtml(encodedOrderId) + "\" data-created-at=\"" + escapeHtml(encodedCreatedAt) + "\">Download PDF</button>"
                    + "<button type=\"button\" id=\"receiptPrintBtn\">Print Receipt</button>"
                    + "</div>"
                    + "</div></bo" + "dy></ht" + "ml>";
            }

            function getReceiptDownloadFileName(item) {
                const fallbackDate = new Date().toISOString().slice(0, 10);
                const token = getReceiptNumber(item).replace(/[^a-zA-Z0-9_-]/g, "");
                return "Ecodrive-Receipt-" + (token || fallbackDate) + ".pdf";
            }

            function loadExternalScript(src) {
                return new Promise(function (resolve, reject) {
                    const existing = document.querySelector("script[data-receipt-pdf][src=\"" + src + "\"]");
                    if (existing) {
                        if (existing.dataset.loaded === "true") {
                            resolve();
                            return;
                        }
                        existing.addEventListener("load", function () {
                            resolve();
                        }, { once: true });
                        existing.addEventListener("error", function () {
                            reject(new Error("Unable to load " + src));
                        }, { once: true });
                        return;
                    }

                    const script = document.createElement("script");
                    script.src = src;
                    script.async = true;
                    script.setAttribute("data-receipt-pdf", "1");
                    script.addEventListener("load", function () {
                        script.dataset.loaded = "true";
                        resolve();
                    }, { once: true });
                    script.addEventListener("error", function () {
                        reject(new Error("Unable to load " + src));
                    }, { once: true });
                    document.head.appendChild(script);
                });
            }

            function ensureReceiptPdfLib() {
                if (window.jspdf && typeof window.jspdf.jsPDF === "function") {
                    return Promise.resolve(window.jspdf.jsPDF);
                }
                if (receiptPdfLibPromise) {
                    return receiptPdfLibPromise;
                }

                receiptPdfLibPromise = (async function () {
                    let lastError = new Error("Unable to load PDF library.");
                    for (const src of RECEIPT_PDF_SCRIPT_SOURCES) {
                        try {
                            await loadExternalScript(src);
                            if (window.jspdf && typeof window.jspdf.jsPDF === "function") {
                                return window.jspdf.jsPDF;
                            }
                        } catch (error) {
                            lastError = error;
                        }
                    }
                    receiptPdfLibPromise = null;
                    throw lastError;
                })();

                return receiptPdfLibPromise;
            }

            function drawReceiptPdf(item, JsPdfCtor) {
                const pageWidth = 226.77;
                const pageHeight = 640;
                const doc = new JsPdfCtor({ unit: "pt", format: [pageWidth, pageHeight] });
                const marginX = 11;
                const lineHeight = 12;
                const bottomMargin = 16;
                const contentWidth = pageWidth - (marginX * 2);
                const receiptNumber = getReceiptNumber(item);
                const issuedAt = formatReceiptIssuedDate(item.receiptIssuedAt || item.createdAt);
                const generatedAt = formatReceiptIssuedDate(new Date().toISOString());
                const installmentMetrics = parseInstallmentReceiptMetrics(item);
                const amountLabel = formatReceiptAmountText(
                    installmentMetrics
                        ? installmentMetrics.totalPayableForReceipt
                        : (item.total || 0)
                );
                const modelLabel = String(getModelLabelFromRecord(item) || "Ecodrive E-Bike");
                const bikeColorLabel = String(getBikeColorLabelFromRecord(item) || "").trim();
                const itemLabel = bikeColorLabel
                    ? (modelLabel + " (" + bikeColorLabel + ")")
                    : modelLabel;
                const deliveryAddress = String(item.service || "").toLowerCase().includes("delivery")
                    ? String(item.shippingAddress || "-")
                    : "";

                let y = 20;

                function writeCenter(text, size, weight) {
                    if (y > pageHeight - bottomMargin) {
                        doc.addPage([pageWidth, pageHeight]);
                        y = 20;
                    }
                    doc.setFont("courier", weight || "normal");
                    doc.setFontSize(size);
                    doc.text(String(text || ""), pageWidth / 2, y, { align: "center" });
                    y += lineHeight;
                }

                function writeRule() {
                    writeCenter("--------------------------------", 9, "normal");
                }

                function writeLine(text, weight) {
                    doc.setFont("courier", weight || "normal");
                    doc.setFontSize(9);
                    const wrapped = doc.splitTextToSize(String(text || ""), contentWidth);
                    wrapped.forEach(function (part) {
                        if (y > pageHeight - bottomMargin) {
                            doc.addPage([pageWidth, pageHeight]);
                            y = 20;
                        }
                        doc.text(part, marginX, y);
                        y += lineHeight;
                    });
                }

                writeCenter("ECODRIVE", 13, "bold");
                writeCenter("OFFICIAL BOOKING RECEIPT", 9, "normal");
                writeCenter(issuedAt, 8, "normal");
                writeRule();
                writeLine("Receipt No: " + receiptNumber);
                writeLine("Order ID: " + String(item.orderId || "-"));
                writeLine("Customer: " + String(item.fullName || "Customer"));
                writeLine("Email: " + String(item.email || "-"));
                writeLine("Model: " + modelLabel);
                writeLine("Color: " + String(bikeColorLabel || "-"));
                writeLine("Service: " + String(item.service || "-"));
                writeLine("Payment: " + String(item.payment || "-"));
                writeLine("Schedule: " + String(item.schedule || "-"));
                if (deliveryAddress) {
                    writeLine("Address: " + deliveryAddress);
                }
                writeLine("Status: " + String(item.status || "-"));
                writeLine("Progress: " + String(item.fulfillmentStatus || "-"));
                writeLine("ETA: " + String(item.trackingEta || "Not set"));
                writeLine("Location: " + String(item.trackingLocation || "Not set"));
                if (installmentMetrics) {
                    writeLine("Monthly Payment: " + formatReceiptAmountText(installmentMetrics.monthlyPayment));
                    writeLine("Paid Installment: " + installmentMetrics.progressLabel);
                    writeLine(
                        "Total Paid: "
                        + formatReceiptAmountText(installmentMetrics.paidAmount)
                        + " / "
                        + formatReceiptAmountText(installmentMetrics.totalInstallmentPayable)
                    );
                }
                writeRule();
                writeLine("1 x " + itemLabel);
                writeLine("Amount: " + amountLabel);
                writeRule();
                if (installmentMetrics) {
                    writeLine(
                        "Installment Total: "
                        + formatReceiptAmountText(installmentMetrics.totalInstallmentPayable)
                    );
                    if (installmentMetrics.downPayment > 0) {
                        writeLine("Downpayment: " + formatReceiptAmountText(installmentMetrics.downPayment));
                    }
                    writeLine(
                        "Outstanding: "
                        + formatReceiptAmountText(installmentMetrics.outstandingBalance)
                    );
                    writeLine(
                        "TOTAL PAYABLE: "
                        + formatReceiptAmountText(installmentMetrics.totalPayableForReceipt),
                        "bold"
                    );
                } else {
                    writeLine("Subtotal: " + amountLabel, "bold");
                    writeLine("Discount: " + formatReceiptAmountText(0));
                    writeLine("TOTAL: " + amountLabel, "bold");
                }
                writeRule();
                writeCenter("Generated: " + generatedAt, 8, "normal");
                writeCenter("Generated by User Portal", 8, "normal");
                writeCenter("THANK YOU", 9, "bold");

                return doc;
            }

            async function downloadReceiptPdf(item, triggerButton) {
                const button = triggerButton instanceof HTMLElement ? triggerButton : null;
                const originalLabel = button ? button.textContent : "";
                if (button) {
                    button.disabled = true;
                    button.textContent = "Preparing...";
                }

                try {
                    const JsPdfCtor = await ensureReceiptPdfLib();
                    const doc = drawReceiptPdf(item, JsPdfCtor);
                    doc.save(getReceiptDownloadFileName(item));
                } catch (error) {
                    console.error("Failed to generate receipt PDF", error);
                    window.alert("Unable to download PDF right now. Please use Print Receipt.");
                } finally {
                    if (button) {
                        button.disabled = false;
                        button.textContent = originalLabel || "Download PDF";
                    }
                }
            }

            function bindReceiptViewActions(popup) {
                if (!popup || popup.closed || !popup.document) {
                    return;
                }

                const printBtn = popup.document.getElementById("receiptPrintBtn");
                const downloadBtn = popup.document.getElementById("receiptDownloadBtn");

                if (printBtn && printBtn.dataset.bound !== "1") {
                    printBtn.dataset.bound = "1";
                    printBtn.addEventListener("click", function () {
                        popup.print();
                    });
                }

                if (downloadBtn && downloadBtn.dataset.bound !== "1") {
                    downloadBtn.dataset.bound = "1";
                    downloadBtn.addEventListener("click", async function () {
                        if (typeof window.__ecodriveDownloadReceiptFromPopup !== "function") {
                            popup.alert("Unable to download PDF right now. Please use Print Receipt.");
                            return;
                        }

                        const originalLabel = downloadBtn.textContent;
                        downloadBtn.disabled = true;
                        downloadBtn.textContent = "Preparing...";
                        try {
                            await window.__ecodriveDownloadReceiptFromPopup(
                                downloadBtn.getAttribute("data-order-id"),
                                downloadBtn.getAttribute("data-created-at")
                            );
                        } catch (_error) {
                            popup.alert("Unable to download PDF right now. Please use Print Receipt.");
                        } finally {
                            downloadBtn.disabled = false;
                            downloadBtn.textContent = originalLabel || "Download PDF";
                        }
                    });
                }
            }

            function openReceiptView(item) {
                const popup = window.open("", "_blank", "width=430,height=760");
                if (!popup) {
                    window.alert("Please allow pop-ups to view your receipt.");
                    return;
                }
                popup.document.open();
                popup.document.write(buildPrintableReceiptHtml(item));
                popup.document.close();
                bindReceiptViewActions(popup);
                popup.focus();
            }

            window.__ecodriveDownloadReceiptFromPopup = async function (orderIdToken, createdAtToken) {
                const orderId = decodeToken(orderIdToken);
                const createdAt = decodeToken(createdAtToken);
                const targetItem = latestRenderedBookingItems.find(function (item) {
                    return String(item.orderId || "") === String(orderId || "")
                        && String(item.createdAt || "") === String(createdAt || "");
                });
                if (!targetItem) {
                    window.alert("Receipt details are unavailable. Please refresh and try again.");
                    throw new Error("Receipt details unavailable");
                }
                await downloadReceiptPdf(targetItem);
            };

            function escapeHtml(value) {
                return String(value)
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/\"/g, "&quot;")
                    .replace(/'/g, "&#39;");
            }

            function decodeToken(value) {
                try {
                    return decodeURIComponent(String(value || ""));
                } catch (_error) {
                    return String(value || "");
                }
            }

            function encodeToken(value) {
                return encodeURIComponent(String(value || ""));
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

            function removeBookingFromArrayStorage(storageKey, orderId, createdAt) {
                const parsed = safeParse(localStorage.getItem(storageKey));
                if (!Array.isArray(parsed)) {
                    return false;
                }

                const filteredList = parsed.filter(function (record) {
                    return !matchesBookingRecord(record, orderId, createdAt);
                });

                if (filteredList.length === parsed.length) {
                    return false;
                }

                localStorage.setItem(storageKey, JSON.stringify(filteredList));
                return true;
            }

            function cancelBooking(orderId, createdAt) {
                let updated = false;

                bookingStorageKeys.forEach(function (key) {
                    if (removeBookingFromArrayStorage(key, orderId, createdAt)) {
                        updated = true;
                    }
                });

                const latest = safeParse(localStorage.getItem("latestBooking"));
                if (matchesBookingRecord(latest, orderId, createdAt)) {
                    localStorage.removeItem("latestBooking");
                    updated = true;
                }

                return updated;
            }

            async function renderRows() {
                if (!bookingRows) {
                    return;
                }

                const apiRows = await fetchBookingsFromApi();
                const localRows = readBookings();
                const sourceRows = apiRows.length > 0 ? mergeApiAndLocalRows(apiRows, localRows) : localRows;
                const rejectedSummary = captureRejectedBookingNotifications(sourceRows);
                cleanupCancelledBookings(rejectedSummary.rejectedOrderIds);
                const items = normalizeBookings(sourceRows);
                latestRenderedBookingItems = items.slice();
                const maxRows = 6;
                const htmlParts = [];

                items.slice(0, maxRows).forEach(function (item) {
                    const canPrintReceipt = canPrintReceiptStatus(item.status, item.fulfillmentStatus);
                    const modelDisplay = item.bikeColor
                        ? (String(item.model || "") + " (" + String(item.bikeColor || "") + ")")
                        : String(item.model || "");
                    const viewReceiptBtnHtml = canPrintReceipt
                        ? "<button type=\"button\" class=\"receipt-action-btn view-receipt-btn\" data-order-id=\"" + encodeToken(item.orderId) + "\" data-created-at=\"" + encodeToken(item.createdAt) + "\">View Receipt</button>"
                        : "";
                    const cancelBtnHtml = item.canCancel
                        ? "<button type=\"button\" class=\"cancel-btn\" data-order-id=\"" + encodeToken(item.orderId) + "\" data-created-at=\"" + encodeToken(item.createdAt) + "\">Cancel</button>"
                        : "";
                    const actionHtml = (viewReceiptBtnHtml || cancelBtnHtml)
                        ? "<div class=\"action-stack\">" + viewReceiptBtnHtml + cancelBtnHtml + "</div>"
                        : "<span class=\"cancelled-note\">N/A</span>";
                    const trackingEtaHtml = item.trackingEta
                        ? "<small class=\"fulfillment-eta\">ETA: " + escapeHtml(item.trackingEta) + "</small>"
                        : "";
                    const trackingLocationHtml = item.trackingLocation
                        ? "<small class=\"fulfillment-loc\">Loc: " + escapeHtml(item.trackingLocation) + "</small>"
                        : "";
                    const fulfillmentHtml = "<span class=\"fulfillment-main\">"
                        + escapeHtml(item.fulfillmentStatus)
                        + "</span>"
                        + trackingEtaHtml
                        + trackingLocationHtml;
                    const totalDisplayAmount = Number.isFinite(Number(item.totalDisplayAmount))
                        ? Number(item.totalDisplayAmount)
                        : Number(item.total || 0);
                    const totalDisplayNoteHtml = item.totalDisplayNote
                        ? "<small class=\"total-note\">" + escapeHtml(String(item.totalDisplayNote)) + "</small>"
                        : "";
                    const totalHtml = "<span class=\"total-wrap\">"
                        + "<span class=\"total\">" + formatPeso(totalDisplayAmount) + "</span>"
                        + totalDisplayNoteHtml
                        + "</span>";

                    htmlParts.push(
                        "<article class=\"table-row row-grid\">" +
                            "<span class=\"product\">" + escapeHtml(modelDisplay.toUpperCase()) + "</span>" +
                            "<span>" + escapeHtml(formatDate(item.createdAt)) + "</span>" +
                            "<span>" + escapeHtml(item.schedule) + "</span>" +
                            "<span>" + escapeHtml(item.status) + "</span>" +
                            totalHtml +
                            "<span><span class=\"service-pill\">" + escapeHtml(item.service) + "</span></span>" +
                            "<span class=\"fulfillment-wrap\">" + fulfillmentHtml + "</span>" +
                            "<span>" + actionHtml + "</span>" +
                        "</article>"
                    );
                });

                bookingRows.innerHTML = htmlParts.join("");

                if (rejectedSummary.newlyRejected.length > 0) {
                    if (rejectedSummary.newlyRejected.length === 1) {
                        const rejected = rejectedSummary.newlyRejected[0];
                        window.alert(
                            "Booking rejected by admin: " + getBookingModelLabel(rejected) + ". Inalis na ito sa iyong bookings."
                        );
                    } else {
                        window.alert(
                            String(rejectedSummary.newlyRejected.length)
                            + " booking requests were rejected by admin and removed from your bookings."
                        );
                    }
                }
            }

            async function refreshBookings(force) {
                if (bookingRefreshInFlight) {
                    return;
                }
                if (document.hidden && !force) {
                    return;
                }

                bookingRefreshInFlight = true;
                try {
                    await renderRows();
                } finally {
                    bookingRefreshInFlight = false;
                }
            }

            function startBookingAutoRefresh() {
                if (bookingRefreshTimerId) {
                    return;
                }
                bookingRefreshTimerId = window.setInterval(function () {
                    void refreshBookings(false);
                }, BOOKING_REFRESH_INTERVAL_MS);
            }

            function stopBookingAutoRefresh() {
                if (!bookingRefreshTimerId) {
                    return;
                }
                window.clearInterval(bookingRefreshTimerId);
                bookingRefreshTimerId = null;
            }

            if (bookingRows) {
                bookingRows.addEventListener("click", async function (event) {
                    const receiptBtn = event.target.closest(".view-receipt-btn");
                    if (receiptBtn) {
                        const orderId = decodeToken(receiptBtn.getAttribute("data-order-id"));
                        const createdAt = decodeToken(receiptBtn.getAttribute("data-created-at"));
                        const targetItem = latestRenderedBookingItems.find(function (item) {
                            return String(item.orderId || "") === String(orderId || "")
                                && String(item.createdAt || "") === String(createdAt || "");
                        });
                        if (!targetItem) {
                            window.alert("Receipt details are unavailable. Please refresh and try again.");
                            return;
                        }
                        openReceiptView(targetItem);
                        return;
                    }

                    const cancelBtn = event.target.closest(".cancel-btn");
                    if (!cancelBtn) {
                        return;
                    }

                    const orderId = decodeToken(cancelBtn.getAttribute("data-order-id"));
                    const createdAt = decodeToken(cancelBtn.getAttribute("data-created-at"));
                    if (!orderId) {
                        return;
                    }

                    if (!window.confirm("Do you want to cancel this booking?")) {
                        return;
                    }

                    await cancelBookingViaApi(orderId);
                    cancelBooking(orderId, createdAt);
                    await refreshBookings(true);
                });
            }

            document.addEventListener("visibilitychange", function () {
                if (document.hidden) {
                    stopBookingAutoRefresh();
                    return;
                }
                void refreshBookings(true);
                startBookingAutoRefresh();
            });

            window.addEventListener("beforeunload", stopBookingAutoRefresh);

            void refreshBookings(true);
            startBookingAutoRefresh();

            const botToggle = document.getElementById("chatbot-toggle");
            const chatPanel = document.getElementById("chat-panel");
            const chatClose = document.getElementById("chat-close");
            const chatForm = document.getElementById("chat-form");
            const chatInput = document.getElementById("chat-input");
            const chatBody = document.getElementById("chat-body");
            const chatKey = "ecodrive_chat_messages_v1";
            const maxChatMessages = 80;
            const chatState = {
                awaitingPriceModel: false
            };
            const smartReply = (window.EcodriveChatbotBrain && typeof window.EcodriveChatbotBrain.createResponder === "function")
                ? window.EcodriveChatbotBrain.createResponder()
                : null;
            let liveChatRuntime = null;
            const bikeCatalog = [
                { model: "BLITZ 2000", price: 68000, category: "2-Wheel", aliases: ["blitz 2000"] },
                { model: "BLITZ 1200", price: 45000, category: "2-Wheel", aliases: ["blitz 1200"] },
                { model: "FUN 350R II", price: 24000, category: "2-Wheel", aliases: ["fun 350r ii", "fun 350r", "fun 350"] },
                { model: "CANDY 800", price: 39000, category: "2-Wheel", aliases: ["candy 800"] },
                { model: "BLITZ 200R", price: 40000, category: "2-Wheel", aliases: ["blitz 200r"] },
                { model: "TRAVELLER 1500 (2-Wheel)", price: 78000, category: "2-Wheel", aliases: ["traveller 1500", "traveler 1500 2 wheel", "traveller 1500 2 wheel"] },
                { model: "ECONO 500 MP", price: 51000, category: "2-Wheel", aliases: ["econo 500 mp"] },
                { model: "ECONO 350 MINI-II", price: 39000, category: "2-Wheel", aliases: ["econo 350 mini ii", "econo 350 mini", "mini ii"] },
                { model: "ECARGO 100", price: 72500, category: "3-Wheel", aliases: ["ecargo 100", "e cargo 100"] },
                { model: "E-CAB 1000 (3-Wheel)", price: 65000, category: "3-Wheel", aliases: ["e cab 1000", "ecab 1000", "e-cab 1000 3 wheel"] },
                { model: "ECAB 1000 II", price: 90000, category: "3-Wheel", aliases: ["ecab 1000 ii", "ecab 1000 2"] },
                { model: "ECONO 800 MP II", price: 45000, category: "3-Wheel", aliases: ["econo 800 mp ii", "econo 800 mp 2"] },
                { model: "E-CARGO 800J", price: 65000, category: "4-Wheel", aliases: ["e cargo 800j", "ecargo 800j", "e-cargo 800j"] },
                { model: "TRAVELER 1500 (4-Wheel)", price: 130000, category: "4-Wheel", aliases: ["traveler 1500", "traveller 1500", "traveler 1500 4 wheel", "traveller 1500 4 wheel"] },
                { model: "E-CAB 1000 (4-Wheel)", price: 75000, category: "4-Wheel", aliases: ["e cab 1000", "ecab 1000", "e cab 1000 4 wheel", "ecab 1000 4 wheel"] },
                { model: "ECONO 800 MP", price: 60000, category: "4-Wheel", aliases: ["econo 800 mp"] }
            ];
            let chatMessages = [];

            const parsedMessages = safeParse(localStorage.getItem(chatKey));
            if (Array.isArray(parsedMessages)) {
                chatMessages = parsedMessages
                    .filter(function (entry) {
                        return entry && (entry.from === "user" || entry.from === "bot") && typeof entry.text === "string";
                    })
                    .slice(-maxChatMessages);
            }

            if (chatMessages.length === 0) {
                chatMessages = [{ from: "bot", text: "Hi! I'm Ecodrive Bot. Ask me about Ecodrive ebikes, prices, booking status, payment, or repair." }];
                localStorage.setItem(chatKey, JSON.stringify(chatMessages));
            }

            function normalizeText(value) {
                return String(value || "")
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, " ")
                    .trim();
            }

            function includesAny(text, keywords) {
                return keywords.some(function (keyword) {
                    return text.includes(keyword);
                });
            }

            function formatPesoText(amount) {
                return String.fromCharCode(8369) + Number(amount || 0).toLocaleString("en-PH", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                });
            }

            function getWheelFilter(normalizedQuestion) {
                if (includesAny(normalizedQuestion, ["2 wheel", "2 wheels", "two wheel", "2w", "dalawang gulong"])) return "2-Wheel";
                if (includesAny(normalizedQuestion, ["3 wheel", "3 wheels", "three wheel", "3w", "tatlong gulong"])) return "3-Wheel";
                if (includesAny(normalizedQuestion, ["4 wheel", "4 wheels", "four wheel", "4w", "apat na gulong"])) return "4-Wheel";
                return "";
            }

            function getCatalogByWheel(wheel) {
                if (!wheel) return bikeCatalog.slice();
                return bikeCatalog.filter(function (item) {
                    return item.category === wheel;
                });
            }

            function findModelMatches(questionText) {
                const normalizedQuestion = normalizeText(questionText);
                if (!normalizedQuestion) {
                    return [];
                }

                const wheelFilter = getWheelFilter(normalizedQuestion);
                const matches = bikeCatalog.filter(function (item) {
                    const directModel = normalizedQuestion.includes(normalizeText(item.model));
                    const aliasHit = item.aliases.some(function (alias) {
                        return normalizedQuestion.includes(normalizeText(alias));
                    });
                    if (!(directModel || aliasHit)) {
                        return false;
                    }
                    if (!wheelFilter) {
                        return true;
                    }
                    return item.category === wheelFilter;
                });

                return matches;
            }

            function getUserBookingSummary() {
                const userItems = normalizeBookings(readBookings());
                if (userItems.length === 0) {
                    return "Wala ka pang active booking. Pwede ka mag-book from Ebikes Products page.";
                }

                const latest = userItems[0];
                return "May " + userItems.length + " active booking(s). Latest: " + latest.model + " - " + latest.status + " (" + latest.fulfillmentStatus + ").";
            }

            function getCancelSummary() {
                const userItems = normalizeBookings(readBookings());
                if (userItems.length === 0) {
                    return "Wala ka pang active booking kaya wala pang kailangan i-cancel.";
                }

                const cancellableCount = userItems.filter(function (item) {
                    return item.canCancel;
                }).length;

                if (cancellableCount === 0) {
                    return "Sa ngayon, walang cancellable booking. Completed/Delivered orders cannot be cancelled.";
                }

                return "May " + cancellableCount + " booking(s) na puwedeng i-cancel. Gamitin lang ang Cancel button sa booking row.";
            }

            function addChatMessage(from, text) {
                chatMessages.push({
                    from: from,
                    text: String(text || "")
                });

                if (chatMessages.length > maxChatMessages) {
                    chatMessages = chatMessages.slice(chatMessages.length - maxChatMessages);
                }
            }

            function saveMessages() {
                localStorage.setItem(chatKey, JSON.stringify(chatMessages));
            }

            function renderMessages() {
                if (!chatBody) return;
                chatBody.innerHTML = "";

                chatMessages.forEach(function (entry) {
                    const bubble = document.createElement("div");
                    bubble.className = "chat-bubble " + (entry.from === "user" ? "user" : "bot");
                    bubble.textContent = entry.text;
                    chatBody.appendChild(bubble);
                });

                chatBody.scrollTop = chatBody.scrollHeight;
            }

            function getBotReply(text) {
                const normalized = normalizeText(text);
                const wheelFilter = getWheelFilter(normalized);
                const modelMatches = findModelMatches(text);
                const isPriceQuestion = includesAny(normalized, ["price", "presyo", "magkano", "mag kano", "hm", "how much", "cost"]);

                if (!normalized) {
                    return "Type your question and I will help.";
                }

                if (includesAny(normalized, ["help", "tulong", "ano pwede itanong", "what can you do"])) {
                    chatState.awaitingPriceModel = false;
                    return "Pwede mo itanong: available models, price ng model, cheapest ebike, booking status, payment options, installment, delivery/pick up, cancel booking, at repair booking.";
                }

                if (includesAny(normalized, ["hello", "hi", "hey", "good morning", "good afternoon", "good evening", "kumusta", "kamusta"])) {
                    chatState.awaitingPriceModel = false;
                    return "Hi! Ready ako tumulong about Ecodrive ebikes, prices, at bookings.";
                }

                if (includesAny(normalized, ["salamat", "thank you", "thanks"])) {
                    chatState.awaitingPriceModel = false;
                    return "You're welcome. Sabihin mo lang kung may tanong ka pa tungkol sa ebikes or booking mo.";
                }

                if (includesAny(normalized, ["pinakamura", "cheapest", "lowest"])) {
                    chatState.awaitingPriceModel = false;
                    const scoped = getCatalogByWheel(wheelFilter);
                    if (scoped.length === 0) {
                        return "Wala akong nakita na model para sa category na iyan.";
                    }
                    const cheapest = scoped.reduce(function (best, item) {
                        return item.price < best.price ? item : best;
                    }, scoped[0]);
                    return "Pinakamura sa " + (wheelFilter || "all categories") + " is " + cheapest.model + " at " + formatPesoText(cheapest.price) + ".";
                }

                if (includesAny(normalized, ["pinakamahal", "most expensive", "highest price", "premium"])) {
                    chatState.awaitingPriceModel = false;
                    const scoped = getCatalogByWheel(wheelFilter);
                    if (scoped.length === 0) {
                        return "Wala akong nakita na model para sa category na iyan.";
                    }
                    const expensive = scoped.reduce(function (best, item) {
                        return item.price > best.price ? item : best;
                    }, scoped[0]);
                    return "Pinakamahal sa " + (wheelFilter || "all categories") + " is " + expensive.model + " at " + formatPesoText(expensive.price) + ".";
                }

                if (isPriceQuestion || chatState.awaitingPriceModel) {
                    if (modelMatches.length === 1) {
                        chatState.awaitingPriceModel = false;
                        const selected = modelMatches[0];
                        return selected.model + " costs " + formatPesoText(selected.price) + " (" + selected.category + ").";
                    }

                    if (modelMatches.length > 1) {
                        chatState.awaitingPriceModel = false;
                        const priceOptions = modelMatches.map(function (item) {
                            return item.model + " - " + formatPesoText(item.price);
                        });
                        return "May maraming variant na tugma: " + priceOptions.join("; ") + ".";
                    }

                    chatState.awaitingPriceModel = true;
                    return "Anong model ang gusto mong i-check? Example: BLITZ 2000, ECARGO 100, o ECONO 500 MP.";
                }

                if (includesAny(normalized, ["book", "booking", "mag book", "magbook", "paano mag", "how to book", "confirm booking"])) {
                    chatState.awaitingPriceModel = false;
                    return "Para mag-book: pumili ng model sa Ebikes Products, pindutin ang Book Now, ilagay customer/shipping info, piliin payment, tapos Confirm Booking.";
                }

                if (includesAny(normalized, ["available", "models", "model", "catalog", "list", "anong ebike", "ano ebike", "products"])) {
                    chatState.awaitingPriceModel = false;
                    const scoped = getCatalogByWheel(wheelFilter);
                    if (scoped.length === 0) {
                        return "Wala akong model list para sa category na iyan.";
                    }
                    const preview = scoped.slice(0, 6).map(function (item) {
                        return item.model;
                    }).join(", ");
                    if (scoped.length > 6) {
                        return "Available " + (wheelFilter || "Ecodrive") + " models (" + scoped.length + "): " + preview + ", at iba pa. Sabihin mo lang yung model para sa exact price.";
                    }
                    return "Available " + (wheelFilter || "Ecodrive") + " models: " + preview + ".";
                }

                if (includesAny(normalized, ["status", "tracking", "track", "my order", "my booking", "order"])) {
                    chatState.awaitingPriceModel = false;
                    return getUserBookingSummary();
                }

                if (includesAny(normalized, ["cancel", "cancellation"])) {
                    chatState.awaitingPriceModel = false;
                    return getCancelSummary();
                }

                if (includesAny(normalized, ["payment", "gcash", "maya", "cod", "cash on delivery", "bayad"])) {
                    chatState.awaitingPriceModel = false;
                    return "Payment options: Cash on Delivery at Installment. Hindi na available ang GCash at Maya.";
                }

                if (includesAny(normalized, ["installment", "hulugan", "monthly", "downpayment"])) {
                    chatState.awaitingPriceModel = false;
                    return "Supported ang Installment flow. Sa payment page, piliin ang Installment then i-complete ang verification steps.";
                }

                if (includesAny(normalized, ["delivery", "pickup", "pick up", "shipping"])) {
                    chatState.awaitingPriceModel = false;
                    return "May Delivery at Pick Up options sa checkout. Delivery adds shipping fee; Pick Up has no shipping fee.";
                }

                if (includesAny(normalized, ["repair", "sira", "maintenance"])) {
                    chatState.awaitingPriceModel = false;
                    return "For repairs, punta sa Repair Booking page then ilagay ang issue details para ma-schedule ka.";
                }

                if (includesAny(normalized, ["contact", "phone", "email", "address", "location", "nasaan"])) {
                    chatState.awaitingPriceModel = false;
                    return "Contact Ecodrive: 09338288185, ecodrive@gmail.com, Poblacion, Baliwag, Bulacan.";
                }

                if (includesAny(normalized, ["ecodrive", "about", "ano ang ecodrive", "sino kayo"])) {
                    chatState.awaitingPriceModel = false;
                    return "Ecodrive offers electric bikes across 2-wheel, 3-wheel, at 4-wheel categories with booking and repair support.";
                }

                return "I can help with ebike models, prices, booking status, payment, installment, delivery, and repair. Type \"help\" for sample questions.";
            }

            function openChat() {
                if (!chatPanel) return;
                chatPanel.classList.add("open");
                chatPanel.setAttribute("aria-hidden", "false");
                renderMessages();
                if (chatInput) chatInput.focus();
                if (liveChatRuntime) {
                    void liveChatRuntime.refreshFromServer();
                }
            }

            function closeChat() {
                if (!chatPanel) return;
                chatPanel.classList.remove("open");
                chatPanel.setAttribute("aria-hidden", "true");
            }

            if (botToggle) {
                botToggle.addEventListener("click", function () {
                    if (!chatPanel) return;
                    if (chatPanel.classList.contains("open")) closeChat();
                    else openChat();
                });
            }

            if (chatClose) {
                chatClose.addEventListener("click", closeChat);
            }

            if (chatForm) {
                chatForm.addEventListener("submit", function (event) {
                    event.preventDefault();
                    const text = (chatInput && chatInput.value ? chatInput.value : "").trim();
                    if (!text) return;

                    addChatMessage("user", text);
                    const allowBotReply = !liveChatRuntime || liveChatRuntime.canBotReply();
                    if (allowBotReply) {
                        addChatMessage("bot", smartReply ? smartReply(text) : getBotReply(text));
                    }
                    saveMessages();
                    if (liveChatRuntime) {
                        void liveChatRuntime.notifyLocalMessagesUpdated();
                    }
                    renderMessages();

                    if (chatInput) {
                        chatInput.value = "";
                        chatInput.focus();
                    }
                });
            }

            if (window.EcodriveChatbotBrain && typeof window.EcodriveChatbotBrain.attachLiveChat === "function") {
                liveChatRuntime = window.EcodriveChatbotBrain.attachLiveChat({
                    getMessages: function () {
                        return chatMessages;
                    },
                    setMessages: function (nextMessages) {
                        chatMessages = Array.isArray(nextMessages) ? nextMessages : [];
                        saveMessages();
                        renderMessages();
                    }
                });
                void liveChatRuntime.notifyLocalMessagesUpdated();
            }

            document.addEventListener("keydown", function (event) {
                if (event.key === "Escape") {
                    closeChat();
                    closeNavMenu();
                    if (dropdown) {
                        dropdown.classList.remove("show");
                    }
                }
            });
        })();

