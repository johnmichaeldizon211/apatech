document.addEventListener("DOMContentLoaded", function () {
    const bookingStorageKeys = ["ecodrive_bookings", "ecodrive_orders", "orders"];
    const selectedBookingKey = "ecodrive_admin_selected_booking";
    const API_BASE = String(
        localStorage.getItem("ecodrive_api_base")
        || localStorage.getItem("ecodrive_kyc_api_base")
        || (window.EcodriveSession && typeof window.EcodriveSession.getApiBase === "function"
            ? window.EcodriveSession.getApiBase()
            : "")
    )
        .trim()
        .replace(/\/+$/, "");

    const detailsEmpty = document.getElementById("detailsEmpty");
    const detailsContent = document.getElementById("detailsContent");
    const approveBtn = document.getElementById("approveBtn");
    const rejectBtn = document.getElementById("rejectBtn");
    const modeInstallmentLayout = document.getElementById("modeInstallmentLayout");
    const modeCashLayout = document.getElementById("modeCashLayout");

    const instOrderDate = document.getElementById("instOrderDate");
    const instOrderStatus = document.getElementById("instOrderStatus");
    const instDeliveryMethod = document.getElementById("instDeliveryMethod");
    const instDeliveryStatus = document.getElementById("instDeliveryStatus");
    const instEstimatedDelivery = document.getElementById("instEstimatedDelivery");
    const instModelName = document.getElementById("instModelName");
    const instModelImage = document.getElementById("instModelImage");
    const instTotalPrice = document.getElementById("instTotalPrice");
    const instPaymentMethod = document.getElementById("instPaymentMethod");
    const instInstallmentPlan = document.getElementById("instInstallmentPlan");
    const instBreakdownTableBody = document.getElementById("instBreakdownTableBody");
    const instBreakdownFallback = document.getElementById("instBreakdownFallback");
    const instCustomerName = document.getElementById("instCustomerName");
    const instCustomerPhone = document.getElementById("instCustomerPhone");
    const instCustomerLocation = document.getElementById("instCustomerLocation");
    const instAccountStatus = document.getElementById("instAccountStatus");
    const instCustomerType = document.getElementById("instCustomerType");
    const instSummaryTotalOrder = document.getElementById("instSummaryTotalOrder");
    const instSummaryPaidInstallment = document.getElementById("instSummaryPaidInstallment");
    const instSummaryOutstandingBalance = document.getElementById("instSummaryOutstandingBalance");

    const cashOrderDate = document.getElementById("cashOrderDate");
    const cashOrderStatus = document.getElementById("cashOrderStatus");
    const cashDeliveryMethod = document.getElementById("cashDeliveryMethod");
    const cashDeliveryStatus = document.getElementById("cashDeliveryStatus");
    const cashEstimatedDelivery = document.getElementById("cashEstimatedDelivery");
    const cashModelName = document.getElementById("cashModelName");
    const cashModelImage = document.getElementById("cashModelImage");
    const cashTotalPrice = document.getElementById("cashTotalPrice");
    const cashPaymentMethod = document.getElementById("cashPaymentMethod");
    const cashCustomerName = document.getElementById("cashCustomerName");
    const cashCustomerPhone = document.getElementById("cashCustomerPhone");
    const cashCustomerLocation = document.getElementById("cashCustomerLocation");
    const cashAccountStatus = document.getElementById("cashAccountStatus");
    const cashCustomerType = document.getElementById("cashCustomerType");
    const cashPaymentTotalPrice = document.getElementById("cashPaymentTotalPrice");
    const cashPaymentDeliveryFee = document.getElementById("cashPaymentDeliveryFee");
    const cashPaymentGrandTotal = document.getElementById("cashPaymentGrandTotal");

    const adminGenerateReceiptBtn = document.getElementById("adminGenerateReceiptBtn");
    let currentBooking = null;
    let receiptPdfLibPromise = null;

    const RECEIPT_PDF_SCRIPT_SOURCES = [
        "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js",
        "https://unpkg.com/jspdf@2.5.2/dist/jspdf.umd.min.js"
    ];

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

    function getRecordOrderId(record) {
        return String((record && (record.orderId || record.id)) || "").trim();
    }

    function getRecordCreatedAt(record) {
        return String((record && (record.createdAt || record.updatedAt)) || "").trim();
    }

    function getRecordEmail(record) {
        return String((record && (record.email || record.userEmail)) || "").trim().toLowerCase();
    }

    function buildNameFromRecord(record) {
        const direct = String((record && (record.fullName || record.name)) || "").trim();
        if (direct) {
            return direct;
        }
        return getRecordEmail(record) || "Unknown Customer";
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

    function getModelLabelFromRecord(record) {
        const modelText = String((record && (record.model || record.productName || record.itemName || "Ecodrive E-Bike")) || "Ecodrive E-Bike");
        const parsed = splitModelAndColorFromModelText(modelText);
        return parsed.model || "Ecodrive E-Bike";
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

    function getPlanLabel(record) {
        const payment = String(record && record.payment || "").toLowerCase();
        const service = String(record && record.service || "").toLowerCase();
        if (payment.includes("installment") || service.includes("installment")) {
            return "Installment";
        }
        return "Full Payment";
    }

    function getBookingMode(record) {
        const payment = String(record && record.payment || "").toLowerCase();
        const service = String(record && record.service || "").toLowerCase();
        if (
            payment.includes("installment")
            || service.includes("installment")
            || Boolean(getInstallmentPayload(record))
        ) {
            return "installment";
        }
        return "cash";
    }

    function setTextContent(target, value, fallback) {
        if (!target) {
            return;
        }
        const text = String(value || "").trim();
        target.textContent = text || String(fallback || "-");
    }

    function toCurrencyNumber(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return 0;
        }
        return Number(numeric.toFixed(2));
    }

    function getInstallmentPayload(record) {
        if (!record || typeof record !== "object") {
            return null;
        }
        return record.installment && typeof record.installment === "object"
            ? record.installment
            : null;
    }

    function getCustomerLocation(record) {
        const address = String(record && record.shippingAddress || "").trim();
        if (address) {
            return address;
        }

        const installment = getInstallmentPayload(record);
        if (installment) {
            const locationParts = [
                installment.street,
                installment.barangay,
                installment.city,
                installment.province
            ]
                .map(function (part) {
                    return String(part || "").trim();
                })
                .filter(Boolean);
            if (locationParts.length > 0) {
                return locationParts.join(", ");
            }
        }
        return "N/A";
    }

    function getAccountStatusLabel(record) {
        const raw = String(
            (record && (record.accountStatus || record.customerAccountStatus || record.account_status)) || ""
        ).trim();
        return raw || "Active";
    }

    function getCustomerTypeLabel(mode) {
        return mode === "installment" ? "Installment Buyer" : "Cash Buyer";
    }

    function normalizeBikeImagePath(value) {
        const raw = String(value || "").trim().replace(/\\/g, "/");
        if (!raw) {
            return "../Userhomefolder/image 1.png";
        }
        if (/^https?:\/\//i.test(raw) || raw.startsWith("data:")) {
            return raw;
        }

        const cleaned = raw.replace(/^\.\//, "");
        if (cleaned.startsWith("../Userhomefolder/")) {
            return cleaned;
        }
        if (cleaned.startsWith("Userhomefolder/")) {
            return "../" + cleaned;
        }
        if (/^(?:\.\.\/)?image\s+\d+\.(png|jpg|jpeg|webp)$/i.test(cleaned)) {
            const filename = cleaned.replace(/^\.\.\//, "");
            return "../Userhomefolder/" + filename;
        }
        if (cleaned.startsWith("../")) {
            return cleaned;
        }
        if (cleaned.startsWith("/")) {
            return "." + cleaned;
        }
        return "../" + cleaned;
    }

    function setBikeImage(target, booking) {
        if (!target) {
            return;
        }
        target.src = normalizeBikeImagePath(
            booking && (booking.bikeImage || booking.image || booking.img)
        );
        target.alt = getModelLabelFromRecord(booking) + " image";
    }

    function applyStatusPill(target, value) {
        if (!target) {
            return;
        }
        const text = String(value || "").trim() || "-";
        const normalized = text.toLowerCase();
        target.classList.remove("success", "warning", "danger", "info");
        if (
            normalized.includes("paid")
            || normalized.includes("active")
            || normalized.includes("approve")
            || normalized.includes("released")
            || normalized.includes("complete")
            || normalized.includes("deliver")
        ) {
            target.classList.add("success");
        } else if (
            normalized.includes("reject")
            || normalized.includes("cancel")
            || normalized.includes("failed")
        ) {
            target.classList.add("danger");
        } else if (
            normalized.includes("pending")
            || normalized.includes("review")
            || normalized.includes("process")
            || normalized.includes("under")
        ) {
            target.classList.add("warning");
        } else {
            target.classList.add("info");
        }
        target.textContent = text;
    }

    function getEstimatedDeliveryLabel(record) {
        const eta = normalizeProgressText(record && record.trackingEta);
        if (eta) {
            return eta;
        }
        const serviceText = String(record && record.service || "").toLowerCase();
        if (serviceText.includes("pick")) {
            return "Ready once approved";
        }
        if (serviceText.includes("install")) {
            return "Based on installment review";
        }
        return "1-2 days";
    }

    function resolveCashPaymentBreakdown(record) {
        const subtotalRaw = Number(record && record.subtotal);
        const totalRaw = Number(record && record.total);
        const hasSubtotal = Number.isFinite(subtotalRaw) && subtotalRaw > 0;
        const hasTotal = Number.isFinite(totalRaw) && totalRaw > 0;

        let subtotal = hasSubtotal ? subtotalRaw : (hasTotal ? totalRaw : 0);
        let shippingFee = Number(record && record.shippingFee);
        const hasShippingFee = Number.isFinite(shippingFee);
        const isDelivery = String(record && record.service || "").toLowerCase().includes("delivery");

        if (!hasShippingFee) {
            if (hasTotal && hasSubtotal && totalRaw >= subtotalRaw) {
                shippingFee = totalRaw - subtotalRaw;
            } else if (isDelivery) {
                shippingFee = 250;
            } else {
                shippingFee = 0;
            }
        }
        shippingFee = toCurrencyNumber(shippingFee);

        let grandTotal = hasTotal ? totalRaw : (subtotal + shippingFee);
        if (grandTotal < subtotal) {
            grandTotal = subtotal;
        }

        subtotal = toCurrencyNumber(subtotal);
        grandTotal = toCurrencyNumber(grandTotal);

        return {
            subtotal: subtotal,
            shippingFee: shippingFee,
            grandTotal: grandTotal
        };
    }

    function parseInstallmentMetrics(record) {
        const installment = getInstallmentPayload(record);
        const monthsRaw = Number(
            installment && (installment.monthsToPay || installment.months || installment.installmentMonths)
        );
        const monthsToPay = Number.isFinite(monthsRaw) && monthsRaw > 0
            ? Math.floor(monthsRaw)
            : 0;

        const monthlyRaw = toCurrencyNumber(
            installment && (
                installment.monthlyAmortization
                || installment.monthlyAmount
                || installment.monthlyPayment
                || installment.monthly
            )
        );
        const minDp = toCurrencyNumber(
            installment && (
                installment.planMinDp
                || installment.minDp
                || installment.downPayment
                || installment.dp
            )
        );
        const srpFallback = toCurrencyNumber((record && (record.subtotal || record.total)) || 0);
        const srp = toCurrencyNumber(
            installment && (installment.planSrp || installment.srp || installment.srpValue)
        ) || srpFallback;

        const paidCountRaw = Number(
            installment && (
                installment.paidInstallments
                || installment.paidCount
                || installment.monthsPaid
                || installment.installmentsPaid
            )
        );
        let paidCount = Number.isFinite(paidCountRaw) && paidCountRaw > 0
            ? Math.floor(paidCountRaw)
            : 0;

        const paymentHistory = Array.isArray(installment && installment.paymentHistory)
            ? installment.paymentHistory
            : [];
        if (paymentHistory.length > 0) {
            const historyPaidCount = paymentHistory.filter(function (item) {
                return String(item && item.status || "").toLowerCase().includes("paid");
            }).length;
            if (historyPaidCount > paidCount) {
                paidCount = historyPaidCount;
            }
        }

        if (monthsToPay > 0 && paidCount > monthsToPay) {
            paidCount = monthsToPay;
        }

        const totalRaw = toCurrencyNumber(record && record.total);
        const fallbackMonthly = (monthsToPay > 0 && totalRaw > 0)
            ? toCurrencyNumber(Math.max((totalRaw - minDp) / monthsToPay, 0))
            : 0;
        const monthlyAmount = monthlyRaw > 0 ? monthlyRaw : fallbackMonthly;

        let paidAmount = toCurrencyNumber(
            installment && (installment.totalPaid || installment.paidAmount || installment.totalPaidAmount)
        );
        if (paidAmount <= 0 && paymentHistory.length > 0) {
            paidAmount = toCurrencyNumber(paymentHistory.reduce(function (sum, item) {
                return sum + toCurrencyNumber(item && (item.amount || item.value || item.monthlyAmount));
            }, 0));
        }
        if (paidAmount <= 0 && monthlyAmount > 0 && paidCount > 0) {
            paidAmount = toCurrencyNumber(monthlyAmount * paidCount);
        }

        const totalInstallmentAmount = (monthsToPay > 0 && monthlyAmount > 0)
            ? toCurrencyNumber(monthlyAmount * monthsToPay)
            : toCurrencyNumber(Math.max(totalRaw - minDp, 0));

        const outstandingBalance = Math.max(
            toCurrencyNumber(totalInstallmentAmount - paidAmount),
            0
        );

        const hasBreakdownData = Boolean(installment && monthsToPay > 0 && monthlyAmount > 0);
        const initialDueAmount = toCurrencyNumber(
            (minDp > 0 ? minDp : 0)
            + (monthlyAmount > 0 ? monthlyAmount : 0)
        );
        const fallbackInitialDue = toCurrencyNumber(totalRaw || srp || 0);

        return {
            installment: installment,
            monthsToPay: monthsToPay,
            monthlyAmount: monthlyAmount,
            minDp: minDp,
            srp: srp,
            paidCount: paidCount,
            paidAmount: paidAmount,
            totalInstallmentAmount: totalInstallmentAmount,
            outstandingBalance: outstandingBalance,
            hasBreakdownData: hasBreakdownData,
            initialDueAmount: initialDueAmount > 0 ? initialDueAmount : fallbackInitialDue
        };
    }

    function getInstallmentReceiptSummary(record, metricsInput) {
        if (getBookingMode(record) !== "installment") {
            return null;
        }

        const metrics = (metricsInput && typeof metricsInput === "object")
            ? metricsInput
            : parseInstallmentMetrics(record);
        const monthsToPayRaw = Number(metrics && metrics.monthsToPay);
        const monthsToPay = Number.isFinite(monthsToPayRaw) && monthsToPayRaw > 0
            ? Math.floor(monthsToPayRaw)
            : 0;
        const paidCountRaw = Number(metrics && metrics.paidCount);
        const paidCount = Number.isFinite(paidCountRaw) && paidCountRaw > 0
            ? Math.min(monthsToPay > 0 ? monthsToPay : paidCountRaw, Math.floor(paidCountRaw))
            : 0;
        const monthlyPayment = toCurrencyNumber(metrics && metrics.monthlyAmount);
        const downPayment = toCurrencyNumber(metrics && metrics.minDp);
        const totalRaw = toCurrencyNumber(record && record.total);

        let totalInstallmentPayable = toCurrencyNumber(metrics && metrics.totalInstallmentAmount);
        if (!(totalInstallmentPayable > 0) && monthsToPay > 0 && monthlyPayment > 0) {
            totalInstallmentPayable = toCurrencyNumber(monthlyPayment * monthsToPay);
        }
        if (!(totalInstallmentPayable > 0)) {
            totalInstallmentPayable = totalRaw;
        }

        let paidAmount = toCurrencyNumber(metrics && metrics.paidAmount);
        if (!(paidAmount > 0) && monthlyPayment > 0 && paidCount > 0) {
            paidAmount = toCurrencyNumber(monthlyPayment * paidCount);
        }

        const outstandingBalance = Math.max(
            toCurrencyNumber(totalInstallmentPayable - paidAmount),
            0
        );
        const totalPayableWithDownPayment = toCurrencyNumber(
            totalInstallmentPayable + (downPayment > 0 ? downPayment : 0)
        );
        const totalPayableForReceipt = totalPayableWithDownPayment > 0
            ? totalPayableWithDownPayment
            : totalInstallmentPayable;

        return {
            monthsToPay: monthsToPay,
            paidCount: paidCount,
            monthlyPayment: monthlyPayment,
            downPayment: downPayment,
            paidAmount: paidAmount,
            totalInstallmentPayable: totalInstallmentPayable,
            outstandingBalance: outstandingBalance,
            totalPayableForReceipt: totalPayableForReceipt,
            progressLabel: monthsToPay > 0
                ? `${paidCount}/${monthsToPay}`
                : `${paidCount}/-`,
            paidVsTotalLabel: `${formatPeso(paidAmount)} / ${formatPeso(totalInstallmentPayable)}`
        };
    }

    function addMonthsSafe(baseDate, monthsToAdd) {
        const source = baseDate instanceof Date ? baseDate : new Date();
        const monthOffset = Number(monthsToAdd || 0);
        const result = new Date(
            source.getFullYear(),
            source.getMonth() + monthOffset,
            source.getDate(),
            source.getHours(),
            source.getMinutes(),
            0,
            0
        );
        return Number.isNaN(result.getTime()) ? new Date() : result;
    }

    function formatShortDate(dateValue) {
        const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
        if (Number.isNaN(date.getTime())) {
            return "N/A";
        }
        return date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric"
        });
    }

    function buildInstallmentScheduleRows(record, metrics) {
        const rows = [];
        const totalMonths = Number(metrics && metrics.monthsToPay) || 0;
        if (totalMonths < 1) {
            return rows;
        }

        const scheduleDateText = String(
            record && (record.scheduleDate || record.bookingDate || record.date)
        ).trim();
        const scheduleTimeText = String(
            record && (record.scheduleTime || record.bookingTime || record.time)
        ).trim();
        const scheduleDate = buildLocalDateTimeFromParts(scheduleDateText, scheduleTimeText);
        const createdAtDate = new Date(record && record.createdAt || "");
        const baseDate = scheduleDate
            || (!Number.isNaN(createdAtDate.getTime()) ? createdAtDate : new Date());

        const paidCount = Number(metrics && metrics.paidCount) || 0;
        const monthlyAmount = toCurrencyNumber(metrics && metrics.monthlyAmount);

        for (let monthIndex = 0; monthIndex < totalMonths; monthIndex += 1) {
            const dueDate = addMonthsSafe(baseDate, monthIndex);
            const isPaid = monthIndex < paidCount;
            rows.push({
                month: monthIndex + 1,
                dueDate: formatShortDate(dueDate),
                amount: monthlyAmount,
                status: isPaid ? "Paid" : "Pending",
                action: isPaid ? "Paid" : "Mark as paid",
                isPaid: isPaid
            });
        }

        return rows;
    }

    function renderInstallmentBreakdownRows(rows) {
        if (!instBreakdownTableBody) {
            return;
        }
        instBreakdownTableBody.innerHTML = "";

        const list = Array.isArray(rows) ? rows : [];
        if (list.length < 1) {
            return;
        }

        const fragment = document.createDocumentFragment();
        list.forEach(function (item) {
            const tr = document.createElement("tr");
            const amountLabel = formatPeso(item.amount || 0);
            const statusClass = String(item.status || "").toLowerCase().includes("paid")
                ? "success"
                : "warning";
            const monthValue = Number(item.month || 0);
            const actionHtml = item.isPaid
                ? "<span class=\"readonly-chip\">" + escapeHtml(String(item.action || "Paid")) + "</span>"
                : "<button type=\"button\" class=\"inst-mark-paid-btn\" data-month=\""
                    + escapeHtml(String(monthValue))
                    + "\">Mark as paid</button>";

            tr.innerHTML = ""
                + "<td>" + escapeHtml(String(item.month || "-")) + "</td>"
                + "<td>" + escapeHtml(String(item.dueDate || "-")) + "</td>"
                + "<td>" + escapeHtml(amountLabel) + "</td>"
                + "<td><span class=\"status-pill " + statusClass + "\">" + escapeHtml(String(item.status || "-")) + "</span></td>"
                + "<td>" + actionHtml + "</td>";
            fragment.appendChild(tr);
        });
        instBreakdownTableBody.appendChild(fragment);
    }

    function renderInstallmentMode(record) {
        const metrics = parseInstallmentMetrics(record);
        const rows = buildInstallmentScheduleRows(record, metrics);
        const orderStatusText = getStatusLabel(record);
        const customerLocation = getCustomerLocation(record);

        setTextContent(instOrderDate, formatDateTime(getRecordCreatedAt(record)), "N/A");
        applyStatusPill(instOrderStatus, orderStatusText);
        setTextContent(instDeliveryMethod, String(record && record.service || "-"), "-");
        setTextContent(instDeliveryStatus, formatTrackingField(record && record.trackingLocation, "Not set"), "Not set");
        setTextContent(instEstimatedDelivery, getEstimatedDeliveryLabel(record), "-");

        setTextContent(instModelName, getModelLabelFromRecord(record), "-");
        setBikeImage(instModelImage, record);
        const installmentInitialDue = metrics.initialDueAmount || toCurrencyNumber(record && record.total || 0);
        setTextContent(instTotalPrice, formatPeso(installmentInitialDue), "-");
        setTextContent(instPaymentMethod, String(record && record.payment || "-"), "-");
        setTextContent(
            instInstallmentPlan,
            metrics.monthsToPay > 0 ? (metrics.monthsToPay + " months") : "Not set",
            "Not set"
        );

        setTextContent(instCustomerName, buildNameFromRecord(record), "-");
        setTextContent(instCustomerPhone, String(record && record.phone || "-"), "-");
        setTextContent(instCustomerLocation, customerLocation, "N/A");
        applyStatusPill(instAccountStatus, getAccountStatusLabel(record));
        setTextContent(instCustomerType, getCustomerTypeLabel("installment"), "Installment Buyer");

        setTextContent(instSummaryTotalOrder, "1", "1");
        setTextContent(
            instSummaryPaidInstallment,
            (metrics.paidCount || 0) + " / " + (metrics.monthsToPay || 0),
            "0 / 0"
        );
        setTextContent(instSummaryOutstandingBalance, formatPeso(metrics.outstandingBalance || 0), "-");

        renderInstallmentBreakdownRows(rows);
        if (instBreakdownFallback) {
            instBreakdownFallback.hidden = metrics.hasBreakdownData && rows.length > 0;
        }
    }

    function renderCashMode(record) {
        const cashBreakdown = resolveCashPaymentBreakdown(record);
        const orderStatusText = getStatusLabel(record);

        setTextContent(cashOrderDate, formatDateTime(getRecordCreatedAt(record)), "N/A");
        applyStatusPill(cashOrderStatus, orderStatusText);
        setTextContent(cashDeliveryMethod, String(record && record.service || "-"), "-");
        setTextContent(cashDeliveryStatus, formatTrackingField(record && record.trackingLocation, "Not set"), "Not set");
        setTextContent(cashEstimatedDelivery, getEstimatedDeliveryLabel(record), "-");

        setTextContent(cashModelName, getModelLabelFromRecord(record), "-");
        setBikeImage(cashModelImage, record);
        setTextContent(cashTotalPrice, formatPeso(cashBreakdown.subtotal), "-");
        setTextContent(cashPaymentMethod, String(record && record.payment || "-"), "-");

        setTextContent(cashCustomerName, buildNameFromRecord(record), "-");
        setTextContent(cashCustomerPhone, String(record && record.phone || "-"), "-");
        setTextContent(cashCustomerLocation, getCustomerLocation(record), "N/A");
        applyStatusPill(cashAccountStatus, getAccountStatusLabel(record));
        setTextContent(cashCustomerType, getCustomerTypeLabel("cash"), "Cash Buyer");

        setTextContent(cashPaymentTotalPrice, formatPeso(cashBreakdown.subtotal), "-");
        setTextContent(cashPaymentDeliveryFee, formatPeso(cashBreakdown.shippingFee), "-");
        setTextContent(cashPaymentGrandTotal, formatPeso(cashBreakdown.grandTotal), "-");
    }

    function updatePrimaryActionLabels(mode) {
        if (!approveBtn || !rejectBtn) {
            return;
        }
        if (mode === "installment") {
            approveBtn.textContent = "Approve Installment Application";
            rejectBtn.textContent = "Reject Application";
            return;
        }
        approveBtn.textContent = "Accept Booking";
        rejectBtn.textContent = "Reject Booking";
    }

    function getStatusLabel(record) {
        const status = String(record && record.status || "").trim();
        const fulfillment = String(record && record.fulfillmentStatus || "").trim();
        if (status && fulfillment && status.toLowerCase() !== fulfillment.toLowerCase()) {
            return status + " / " + fulfillment;
        }
        return status || fulfillment || "Pending review";
    }

    function normalizeProgressText(value) {
        return String(value || "").trim().replace(/\s+/g, " ");
    }

    function formatTrackingField(value, fallback) {
        const text = normalizeProgressText(value);
        if (text) {
            return text;
        }
        return String(fallback || "-");
    }


    function canPrintReceiptStatus(statusValue, fulfillmentValue) {
        const merged = (
            String(statusValue || "")
            + " "
            + String(fulfillmentValue || "")
        ).toLowerCase();

        if (!merged.trim()) {
            return false;
        }
        if (merged.includes("reject") || merged.includes("cancel")) {
            return false;
        }
        return (
            merged.includes("approve")
            || merged.includes("complete")
            || merged.includes("deliver")
            || merged.includes("picked up")
            || merged.includes("released")
        );
    }

    function getReceiptNumber(booking) {
        const existing = String(
            (booking && (booking.receiptNumber || booking.receipt_number)) || ""
        ).trim();
        if (existing) {
            return existing;
        }

        const orderId = getRecordOrderId(booking).replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
        const dateBase = new Date(
            (booking && (booking.receiptIssuedAt || booking.receipt_issued_at || booking.createdAt)) || ""
        );
        const sourceDate = Number.isNaN(dateBase.getTime()) ? new Date() : dateBase;
        const year = sourceDate.getFullYear();
        const month = String(sourceDate.getMonth() + 1).padStart(2, "0");
        const day = String(sourceDate.getDate()).padStart(2, "0");
        const suffix = orderId.slice(-8) || "PENDING";
        return "ECR-" + year + month + day + "-" + suffix;
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

    function formatReceiptAmountText(amount) {
        const value = Number(amount || 0);
        return "PHP " + value.toLocaleString("en-PH", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function getReceiptDownloadFileName(booking) {
        const fallbackDate = new Date().toISOString().slice(0, 10);
        const token = getReceiptNumber(booking).replace(/[^a-zA-Z0-9_-]/g, "");
        return "Ecodrive-Receipt-" + (token || fallbackDate) + ".pdf";
    }

    function buildPrintableReceiptHtml(booking) {
        const receiptNumber = getReceiptNumber(booking);
        const issuedAt = formatReceiptIssuedDate(
            booking && (booking.receiptIssuedAt || booking.receipt_issued_at || booking.createdAt)
        );
        const printedAt = new Date().toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true
        });
        const customer = escapeHtml(buildNameFromRecord(booking) || "Customer");
        const email = escapeHtml(getRecordEmail(booking) || "-");
        const orderId = escapeHtml(getRecordOrderId(booking) || "-");
        const model = escapeHtml(getModelLabelFromRecord(booking));
        const bikeColor = escapeHtml(getBikeColorLabelFromRecord(booking) || "-");
        const service = escapeHtml(String((booking && booking.service) || "-"));
        const payment = escapeHtml(String((booking && booking.payment) || "-"));
        const schedule = escapeHtml(formatScheduleFromRecord(booking));
        const status = escapeHtml(String((booking && booking.status) || "-"));
        const fulfillment = escapeHtml(String((booking && booking.fulfillmentStatus) || "-"));
        const trackingEta = escapeHtml(String((booking && booking.trackingEta) || "Not set"));
        const trackingLocation = escapeHtml(String((booking && booking.trackingLocation) || "Not set"));
        const shippingAddress = escapeHtml(String((booking && booking.shippingAddress) || "-"));
        const installmentSummary = getInstallmentReceiptSummary(booking);
        const totalAmount = installmentSummary
            ? installmentSummary.totalPayableForReceipt
            : toCurrencyNumber((booking && booking.total) || 0);
        const total = escapeHtml(formatPeso(totalAmount));
        const installmentInfoRows = installmentSummary
            ? (
                "<div class=\"row\"><span class=\"label\">Monthly Payment</span><span class=\"value\">" + escapeHtml(formatPeso(installmentSummary.monthlyPayment)) + "</span></div>"
                + "<div class=\"row\"><span class=\"label\">Paid Installment</span><span class=\"value\">" + escapeHtml(installmentSummary.progressLabel) + "</span></div>"
                + "<div class=\"row\"><span class=\"label\">Total Paid</span><span class=\"value\">" + escapeHtml(installmentSummary.paidVsTotalLabel) + "</span></div>"
            )
            : "";
        const installmentTotalsRows = installmentSummary
            ? (
                "<div class=\"row\"><span class=\"label\">Installment Total</span><span class=\"value\">" + escapeHtml(formatPeso(installmentSummary.totalInstallmentPayable)) + "</span></div>"
                + (
                    installmentSummary.downPayment > 0
                        ? "<div class=\"row\"><span class=\"label\">Downpayment</span><span class=\"value\">" + escapeHtml(formatPeso(installmentSummary.downPayment)) + "</span></div>"
                        : ""
                )
                + "<div class=\"row\"><span class=\"label\">Outstanding</span><span class=\"value\">" + escapeHtml(formatPeso(installmentSummary.outstandingBalance)) + "</span></div>"
                + "<div class=\"row strong\"><span class=\"label\">TOTAL PAYABLE</span><span class=\"value\">" + escapeHtml(formatPeso(installmentSummary.totalPayableForReceipt)) + "</span></div>"
            )
            : (
                "<div class=\"row\"><span class=\"label\">Subtotal</span><span class=\"value\">" + total + "</span></div>"
                + "<div class=\"row\"><span class=\"label\">Discount</span><span class=\"value\">" + escapeHtml(formatPeso(0)) + "</span></div>"
                + "<div class=\"row strong\"><span class=\"label\">TOTAL</span><span class=\"value\">" + total + "</span></div>"
            );
        const serviceLine = String((booking && booking.service) || "").toLowerCase().includes("delivery")
            ? "<div class=\"row\"><span class=\"label\">Address</span><span class=\"value\">" + shippingAddress + "</span></div>"
            : "";

        return "<!DOCTYPE html>"
            + "<html lang=\"en\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">"
            + "<title>Ecodrive Receipt " + escapeHtml(receiptNumber) + "</title>"
            + "<style>"
            + "*{box-sizing:border-box}body{margin:0;padding:14px;background:#e9edf2;font-family:'Courier New',Consolas,monospace;color:#111}"
            + ".sheet{width:78mm;max-width:100%;margin:0 auto;background:#fff;border:1px dashed #a4abb5;padding:10px 9px}"
            + ".center{text-align:center}.brand{font-size:16px;font-weight:700;letter-spacing:1px}.muted{font-size:9px;line-height:1.3}"
            + ".hr{border-top:1px dashed #111;margin:6px 0}.row{display:flex;justify-content:space-between;gap:8px;font-size:10px;line-height:1.35}"
            + ".label{flex:0 0 40%}.value{flex:1;text-align:right;word-break:break-word}.items-head,.item{display:flex;justify-content:space-between;gap:6px;font-size:10px;line-height:1.35}"
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
            + "<div class=\"row\"><span class=\"label\">Service</span><span class=\"value\">" + service + "</span></div>"
            + "<div class=\"row\"><span class=\"label\">Payment</span><span class=\"value\">" + payment + "</span></div>"
            + "<div class=\"row\"><span class=\"label\">Schedule</span><span class=\"value\">" + schedule + "</span></div>"
            + "<div class=\"row\"><span class=\"label\">Color</span><span class=\"value\">" + bikeColor + "</span></div>"
            + serviceLine
            + "<div class=\"row\"><span class=\"label\">Status</span><span class=\"value\">" + status + "</span></div>"
            + "<div class=\"row\"><span class=\"label\">Progress</span><span class=\"value\">" + fulfillment + "</span></div>"
            + "<div class=\"row\"><span class=\"label\">ETA</span><span class=\"value\">" + trackingEta + "</span></div>"
            + "<div class=\"row\"><span class=\"label\">Location</span><span class=\"value\">" + trackingLocation + "</span></div>"
            + installmentInfoRows
            + "<div class=\"hr\"></div>"
            + "<div class=\"items-head strong\"><span class=\"item-name\">Item</span><span class=\"item-qty\">Qty</span><span class=\"item-amount\">Amount</span></div>"
            + "<div class=\"item\"><span class=\"item-name\">" + model + "</span><span class=\"item-qty\">1</span><span class=\"item-amount\">" + total + "</span></div>"
            + "<div class=\"hr\"></div>"
            + "<div class=\"totals\">"
            + installmentTotalsRows
            + "</div>"
            + "<div class=\"hr\"></div>"
            + "<div class=\"foot\">Printed: " + escapeHtml(printedAt) + "<br>Generated by Admin Portal<br>THANK YOU</div>"
            + "<div class=\"actions\">"
            + "<button type=\"button\" class=\"download\" id=\"receiptDownloadBtn\">Download PDF</button>"
            + "<button type=\"button\" id=\"receiptPrintBtn\">Print Receipt</button>"
            + "</div>"
            + "</div></body></html>";
    }

    function loadExternalScript(src) {
        return new Promise(function (resolve, reject) {
            const existing = document.querySelector("script[data-admin-receipt-pdf][src=\"" + src + "\"]");
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
            script.setAttribute("data-admin-receipt-pdf", "1");
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

    function drawReceiptPdf(booking, JsPdfCtor) {
        const pageWidth = 226.77;
        const pageHeight = 640;
        const doc = new JsPdfCtor({ unit: "pt", format: [pageWidth, pageHeight] });
        const marginX = 11;
        const lineHeight = 12;
        const bottomMargin = 16;
        const contentWidth = pageWidth - (marginX * 2);
        const receiptNumber = getReceiptNumber(booking);
        const issuedAt = formatReceiptIssuedDate(
            booking && (booking.receiptIssuedAt || booking.receipt_issued_at || booking.createdAt)
        );
        const generatedAt = formatReceiptIssuedDate(new Date().toISOString());
        const installmentSummary = getInstallmentReceiptSummary(booking);
        const amountLabel = formatReceiptAmountText(
            installmentSummary
                ? installmentSummary.totalPayableForReceipt
                : ((booking && booking.total) || 0)
        );
        const deliveryAddress = String((booking && booking.service) || "").toLowerCase().includes("delivery")
            ? String((booking && booking.shippingAddress) || "-")
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
        writeLine("Order ID: " + String(getRecordOrderId(booking) || "-"));
        writeLine("Customer: " + String(buildNameFromRecord(booking) || "Customer"));
        writeLine("Email: " + String(getRecordEmail(booking) || "-"));
        writeLine("Service: " + String((booking && booking.service) || "-"));
        writeLine("Payment: " + String((booking && booking.payment) || "-"));
        writeLine("Schedule: " + String(formatScheduleFromRecord(booking)));
        writeLine("Color: " + String(getBikeColorLabelFromRecord(booking) || "-"));
        if (deliveryAddress) {
            writeLine("Address: " + deliveryAddress);
        }
        writeLine("Status: " + String((booking && booking.status) || "-"));
        writeLine("Progress: " + String((booking && booking.fulfillmentStatus) || "-"));
        writeLine("ETA: " + String((booking && booking.trackingEta) || "Not set"));
        writeLine("Location: " + String((booking && booking.trackingLocation) || "Not set"));
        if (installmentSummary) {
            writeLine("Monthly Payment: " + formatReceiptAmountText(installmentSummary.monthlyPayment));
            writeLine("Paid Installment: " + installmentSummary.progressLabel);
            writeLine(
                "Total Paid: "
                + formatReceiptAmountText(installmentSummary.paidAmount)
                + " / "
                + formatReceiptAmountText(installmentSummary.totalInstallmentPayable)
            );
        }
        writeRule();
        writeLine("1 x " + getModelLabelFromRecord(booking));
        writeLine("Amount: " + amountLabel);
        writeRule();
        if (installmentSummary) {
            writeLine(
                "Installment Total: "
                + formatReceiptAmountText(installmentSummary.totalInstallmentPayable)
            );
            if (installmentSummary.downPayment > 0) {
                writeLine("Downpayment: " + formatReceiptAmountText(installmentSummary.downPayment));
            }
            writeLine("Outstanding: " + formatReceiptAmountText(installmentSummary.outstandingBalance));
            writeLine(
                "TOTAL PAYABLE: "
                + formatReceiptAmountText(installmentSummary.totalPayableForReceipt),
                "bold"
            );
        } else {
            writeLine("Subtotal: " + amountLabel, "bold");
            writeLine("Discount: " + formatReceiptAmountText(0));
            writeLine("TOTAL: " + amountLabel, "bold");
        }
        writeRule();
        writeCenter("Generated: " + generatedAt, 8, "normal");
        writeCenter("Generated by Admin Portal", 8, "normal");
        writeCenter("THANK YOU", 9, "bold");

        return doc;
    }

    async function downloadReceiptPdf(booking, triggerButton) {
        const button = triggerButton instanceof HTMLElement ? triggerButton : null;
        const originalLabel = button ? button.textContent : "";
        if (button) {
            button.disabled = true;
            button.textContent = "Preparing...";
        }

        try {
            const JsPdfCtor = await ensureReceiptPdfLib();
            const doc = drawReceiptPdf(booking, JsPdfCtor);
            doc.save(getReceiptDownloadFileName(booking));
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

    function bindReceiptViewActions(popup, booking) {
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
                const originalLabel = downloadBtn.textContent;
                downloadBtn.disabled = true;
                downloadBtn.textContent = "Preparing...";
                try {
                    await downloadReceiptPdf(booking);
                } catch (_error) {
                    popup.alert("Unable to download PDF right now. Please use Print Receipt.");
                } finally {
                    downloadBtn.disabled = false;
                    downloadBtn.textContent = originalLabel || "Download PDF";
                }
            });
        }
    }

    function openReceiptView(booking) {
        const popup = window.open("", "_blank", "width=430,height=760");
        if (!popup) {
            window.alert("Please allow pop-ups to view your receipt.");
            return;
        }
        popup.document.open();
        popup.document.write(buildPrintableReceiptHtml(booking));
        popup.document.close();
        bindReceiptViewActions(popup, booking);
        popup.focus();
    }

    function updateReceiptActionButtons(booking) {
        const canGenerate = Boolean(
            booking
            && canPrintReceiptStatus(booking.status, booking.fulfillmentStatus)
        );
        const disabledHint = "Available after booking is approved.";
        if (adminGenerateReceiptBtn) {
            adminGenerateReceiptBtn.disabled = !canGenerate;
            adminGenerateReceiptBtn.title = canGenerate ? "View receipt, then print or download." : disabledHint;
        }
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

    function formatPeso(amount) {
        return String.fromCharCode(8369) + Number(amount || 0).toLocaleString("en-PH", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
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
            return "N/A";
        }

        const explicitLabel = String(record.scheduleLabel || "").trim();
        if (explicitLabel) {
            return explicitLabel;
        }

        const scheduleDate = record.scheduleDate || record.bookingDate || "";
        const scheduleTime = record.scheduleTime || record.bookingTime || "";
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

        return "N/A";
    }

    function matchesBookingRecord(record, orderId, createdAt) {
        if (!record || typeof record !== "object") {
            return false;
        }

        if (getRecordOrderId(record) !== String(orderId || "").trim()) {
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

    function readAllBookings() {
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

    function findBooking(orderId, createdAt) {
        const all = readAllBookings();
        const match = all.find(function (record) {
            return matchesBookingRecord(record, orderId, createdAt);
        });
        if (match) {
            return match;
        }

        const fallback = safeParse(localStorage.getItem(selectedBookingKey));
        if (matchesBookingRecord(fallback, orderId, createdAt)) {
            return fallback;
        }
        return null;
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
                changed = true;
                storageChanged = true;
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

    async function fetchBookingFromApi(orderId) {
        try {
            const response = await fetch(
                getApiUrl(`/api/admin/bookings/${encodeURIComponent(orderId)}`),
                {
                    method: "GET",
                    headers: buildApiHeaders()
                }
            );

            if (response.status === 404 || response.status === 405) {
                return { mode: "unavailable", booking: null };
            }

            const payload = await response.json().catch(function () {
                return {};
            });
            if (!response.ok || payload.success !== true || !payload.booking) {
                return { mode: "error", booking: null };
            }

            return { mode: "ok", booking: payload.booking };
        } catch (_error) {
            return { mode: "unavailable", booking: null };
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
                    message: payload.message || "Unable to update booking status.",
                    booking: null
                };
            }
            return {
                mode: "ok",
                booking: payload.booking && typeof payload.booking === "object"
                    ? payload.booking
                    : null
            };
        } catch (_error) {
            return { mode: "unavailable" };
        }
    }

    async function markInstallmentMonthPaidViaApi(orderId, monthNumber) {
        try {
            const response = await fetch(
                getApiUrl(`/api/admin/bookings/${encodeURIComponent(orderId)}/installment/mark-paid`),
                {
                    method: "POST",
                    headers: buildApiHeaders({
                        "Content-Type": "application/json"
                    }),
                    body: JSON.stringify({
                        month: monthNumber
                    })
                }
            );

            if (response.status === 404 || response.status === 405) {
                const payload404 = await response.json().catch(function () {
                    return {};
                });
                return {
                    mode: "error",
                    message: payload404.message || "Installment API endpoint is unavailable. Please restart the API server.",
                    booking: null
                };
            }

            const payload = await response.json().catch(function () {
                return {};
            });
            if (!response.ok || payload.success !== true || !payload.booking) {
                return {
                    mode: "error",
                    message: payload.message || "Unable to mark installment as paid.",
                    booking: null
                };
            }

            return {
                mode: "ok",
                booking: payload.booking,
                message: payload.message || "Installment updated."
            };
        } catch (_error) {
            return { mode: "unavailable", booking: null };
        }
    }

    function setEmptyState(show) {
        detailsEmpty.hidden = !show;
        detailsContent.hidden = show;
        approveBtn.disabled = show;
        rejectBtn.disabled = show;
        if (show) {
            updateReceiptActionButtons(null);
        }
    }

    function renderBookingDetails(booking) {
        const bookingMode = getBookingMode(booking);
        if (modeInstallmentLayout) {
            modeInstallmentLayout.hidden = bookingMode !== "installment";
        }
        if (modeCashLayout) {
            modeCashLayout.hidden = bookingMode !== "cash";
        }

        if (bookingMode === "installment") {
            renderInstallmentMode(booking);
        } else {
            renderCashMode(booking);
        }

        updatePrimaryActionLabels(bookingMode);
        updateReceiptActionButtons(booking);
    }

    async function initialize() {
        const params = new URLSearchParams(window.location.search);
        const orderId = String(params.get("orderId") || "").trim();
        const createdAt = String(params.get("createdAt") || "").trim();
        if (!orderId) {
            setEmptyState(true);
            return;
        }

        const localBooking = findBooking(orderId, createdAt);
        let booking = null;
        const apiResult = await fetchBookingFromApi(orderId);
        if (apiResult.mode === "ok") {
            booking = apiResult.booking;
        }

        if (!booking && localBooking) {
            booking = localBooking;
        } else if (booking && localBooking) {
            booking = mergeBookingSnapshot(localBooking, booking);
        }

        if (!booking) {
            setEmptyState(true);
            return;
        }

        currentBooking = booking;
        localStorage.setItem(selectedBookingKey, JSON.stringify(booking));
        setEmptyState(false);
        renderBookingDetails(currentBooking);

        approveBtn.addEventListener("click", async function () {
            if (!window.confirm("Approve this booking request?")) {
                return;
            }

            approveBtn.disabled = true;
            rejectBtn.disabled = true;
            const result = await updateBookingDecisionViaApi(orderId, "approve");
            if (result.mode === "ok") {
                if (result.booking) {
                    currentBooking = mergeBookingSnapshot(currentBooking, result.booking);
                    localStorage.setItem(selectedBookingKey, JSON.stringify(currentBooking));
                    renderBookingDetails(currentBooking);
                    alert("Booking approved.");
                } else {
                    window.location.href = "adminorder.html";
                }
                approveBtn.disabled = false;
                rejectBtn.disabled = false;
                return;
            }
            if (result.mode === "error") {
                alert(result.message || "Unable to update booking status.");
                approveBtn.disabled = false;
                rejectBtn.disabled = false;
                return;
            }
            alert("API unavailable. Unable to update booking status.");
            approveBtn.disabled = false;
            rejectBtn.disabled = false;
        });

        rejectBtn.addEventListener("click", async function () {
            if (!window.confirm("Reject this booking request?")) {
                return;
            }

            approveBtn.disabled = true;
            rejectBtn.disabled = true;
            const result = await updateBookingDecisionViaApi(orderId, "reject");
            if (result.mode === "ok") {
                window.location.href = "adminorder.html";
                return;
            }
            if (result.mode === "error") {
                alert(result.message || "Unable to update booking status.");
                approveBtn.disabled = false;
                rejectBtn.disabled = false;
                return;
            }
            alert("API unavailable. Unable to update booking status.");
            approveBtn.disabled = false;
            rejectBtn.disabled = false;
        });

        if (adminGenerateReceiptBtn) {
            adminGenerateReceiptBtn.addEventListener("click", function () {
                if (!currentBooking) {
                    return;
                }
                if (!canPrintReceiptStatus(currentBooking.status, currentBooking.fulfillmentStatus)) {
                    window.alert("Receipt is available only for approved or completed bookings.");
                    return;
                }
                openReceiptView(currentBooking);
            });
        }

        if (instBreakdownTableBody) {
            instBreakdownTableBody.addEventListener("click", async function (event) {
                const button = event.target && event.target.closest
                    ? event.target.closest(".inst-mark-paid-btn")
                    : null;
                if (!button || !(button instanceof HTMLButtonElement)) {
                    return;
                }
                if (!currentBooking || getBookingMode(currentBooking) !== "installment") {
                    return;
                }

                const monthNumber = Number(button.getAttribute("data-month") || 0);
                if (!Number.isFinite(monthNumber) || monthNumber < 1) {
                    window.alert("Invalid installment month.");
                    return;
                }
                if (!window.confirm(`Mark month ${monthNumber} as paid?`)) {
                    return;
                }

                const initialLabel = button.textContent || "Mark as paid";
                const activeButtons = Array.from(instBreakdownTableBody.querySelectorAll(".inst-mark-paid-btn"));
                activeButtons.forEach(function (target) {
                    target.disabled = true;
                });
                button.textContent = "Saving...";

                const result = await markInstallmentMonthPaidViaApi(orderId, monthNumber);
                if (result.mode === "ok" && result.booking) {
                    currentBooking = mergeBookingSnapshot(currentBooking, result.booking);
                    localStorage.setItem(selectedBookingKey, JSON.stringify(currentBooking));
                    renderBookingDetails(currentBooking);
                    window.alert(result.message || `Month ${monthNumber} marked as paid.`);
                    return;
                }

                if (result.mode === "error") {
                    window.alert(result.message || "Unable to mark installment as paid.");
                } else {
                    window.alert("API unavailable. Unable to update installment payment.");
                }

                activeButtons.forEach(function (target) {
                    target.disabled = false;
                });
                button.textContent = initialLabel;
            });
        }
    }

    void initialize();
});

