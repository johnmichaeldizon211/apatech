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

    const detailsEmpty = document.getElementById("detailsEmpty");
    const detailsContent = document.getElementById("detailsContent");
    const approveBtn = document.getElementById("approveBtn");
    const rejectBtn = document.getElementById("rejectBtn");

    const detailOrderId = document.getElementById("detailOrderId");
    const detailCreatedAt = document.getElementById("detailCreatedAt");
    const detailName = document.getElementById("detailName");
    const detailEmail = document.getElementById("detailEmail");
    const detailModel = document.getElementById("detailModel");
    const detailColor = document.getElementById("detailColor");
    const detailService = document.getElementById("detailService");
    const detailSchedule = document.getElementById("detailSchedule");
    const detailPlan = document.getElementById("detailPlan");
    const detailPayment = document.getElementById("detailPayment");
    const detailPaymentStatus = document.getElementById("detailPaymentStatus");
    const detailStatus = document.getElementById("detailStatus");
    const detailTrackingEta = document.getElementById("detailTrackingEta");
    const detailTrackingLocation = document.getElementById("detailTrackingLocation");
    const detailTotal = document.getElementById("detailTotal");
    const detailAddress = document.getElementById("detailAddress");
    const paymentStatusSelect = document.getElementById("paymentStatusSelect");
    const savePaymentStatusBtn = document.getElementById("savePaymentStatusBtn");
    const paymentStatusFeedback = document.getElementById("paymentStatusFeedback");
    const fulfillmentStatusSelect = document.getElementById("fulfillmentStatusSelect");
    const fulfillmentEtaInput = document.getElementById("fulfillmentEtaInput");
    const fulfillmentLocationInput = document.getElementById("fulfillmentLocationInput");
    const saveFulfillmentStatusBtn = document.getElementById("saveFulfillmentStatusBtn");
    const fulfillmentStatusFeedback = document.getElementById("fulfillmentStatusFeedback");
    const adminGenerateReceiptBtn = document.getElementById("adminGenerateReceiptBtn");
    let currentBooking = null;
    let receiptPdfLibPromise = null;

    const PAYMENT_STATUS_LABELS = {
        awaiting_payment_confirmation: "Awaiting Payment Confirmation",
        pending_cod: "Pending COD",
        installment_review: "Installment Review",
        paid: "Paid",
        failed: "Failed",
        refunded: "Refunded",
        not_applicable: "Not Applicable"
    };

    const FULFILLMENT_STATUS_PRESETS = {
        delivery: [
            "Preparing for Dispatch",
            "Rider Assigned",
            "Out for Delivery",
            "Arriving Soon",
            "Delivered"
        ],
        pickup: [
            "Preparing for Pick up",
            "Ready for Pick up",
            "Picked Up"
        ],
        installment: [
            "Application Approved",
            "Documents Verified",
            "Ready for Release",
            "Released"
        ],
        fallback: [
            "In Process",
            "Completed"
        ]
    };

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

    function getStatusLabel(record) {
        const status = String(record && record.status || "").trim();
        const fulfillment = String(record && record.fulfillmentStatus || "").trim();
        if (status && fulfillment && status.toLowerCase() !== fulfillment.toLowerCase()) {
            return status + " / " + fulfillment;
        }
        return status || fulfillment || "Pending review";
    }

    function formatPaymentStatus(value) {
        const normalized = normalizePaymentStatusValue(value);
        if (!normalized) {
            return "-";
        }
        if (Object.prototype.hasOwnProperty.call(PAYMENT_STATUS_LABELS, normalized)) {
            return PAYMENT_STATUS_LABELS[normalized];
        }
        return normalized;
    }

    function normalizePaymentStatusValue(value) {
        return String(value || "")
            .trim()
            .toLowerCase()
            .replace(/[\s\-]+/g, "_");
    }

    function setPaymentStatusFeedback(message, tone) {
        if (!paymentStatusFeedback) {
            return;
        }
        paymentStatusFeedback.textContent = String(message || "");
        paymentStatusFeedback.classList.remove("success", "error", "muted");
        if (tone === "success" || tone === "error" || tone === "muted") {
            paymentStatusFeedback.classList.add(tone);
        }
    }

    function setFulfillmentStatusFeedback(message, tone) {
        if (!fulfillmentStatusFeedback) {
            return;
        }
        fulfillmentStatusFeedback.textContent = String(message || "");
        fulfillmentStatusFeedback.classList.remove("success", "error", "muted");
        if (tone === "success" || tone === "error" || tone === "muted") {
            fulfillmentStatusFeedback.classList.add(tone);
        }
    }

    function normalizeServiceKey(value) {
        const normalized = String(value || "").trim().toLowerCase();
        if (normalized.includes("pick")) {
            return "pickup";
        }
        if (normalized.includes("install")) {
            return "installment";
        }
        if (normalized.includes("delivery")) {
            return "delivery";
        }
        return "fallback";
    }

    function normalizeProgressText(value) {
        return String(value || "").trim().replace(/\s+/g, " ");
    }

    function normalizeTrackingEta(value) {
        return normalizeProgressText(value).slice(0, 80);
    }

    function normalizeTrackingLocation(value) {
        return normalizeProgressText(value).slice(0, 120);
    }

    function formatTrackingField(value, fallback) {
        const text = normalizeProgressText(value);
        if (text) {
            return text;
        }
        return String(fallback || "-");
    }

    function getFulfillmentPresetOptions(serviceValue) {
        const serviceKey = normalizeServiceKey(serviceValue);
        if (Object.prototype.hasOwnProperty.call(FULFILLMENT_STATUS_PRESETS, serviceKey)) {
            return FULFILLMENT_STATUS_PRESETS[serviceKey];
        }
        return FULFILLMENT_STATUS_PRESETS.fallback;
    }

    function renderFulfillmentOptionsForBooking(booking) {
        if (!fulfillmentStatusSelect) {
            return;
        }

        const options = getFulfillmentPresetOptions(booking && booking.service);
        const currentValue = normalizeProgressText(booking && booking.fulfillmentStatus);
        const optionValues = options.slice();
        const seen = new Set(optionValues.map(function (item) {
            return normalizeProgressText(item).toLowerCase();
        }));

        if (currentValue && !seen.has(currentValue.toLowerCase())) {
            optionValues.unshift(currentValue);
        }

        fulfillmentStatusSelect.innerHTML = "";
        optionValues.forEach(function (label) {
            const option = document.createElement("option");
            option.value = label;
            option.textContent = label;
            fulfillmentStatusSelect.appendChild(option);
        });

        if (currentValue && optionValues.includes(currentValue)) {
            fulfillmentStatusSelect.value = currentValue;
        } else if (optionValues.length > 0) {
            fulfillmentStatusSelect.value = optionValues[0];
        }
    }

    function buildFulfillmentStatusPayload(baseStatus) {
        const statusText = normalizeProgressText(baseStatus);
        if (!statusText) {
            return "";
        }
        return statusText.slice(0, 80);
    }

    function canUpdateFulfillmentStatus(booking) {
        if (!booking || typeof booking !== "object") {
            return false;
        }
        const merged = (
            String(booking.status || "")
            + " "
            + String(booking.fulfillmentStatus || "")
            + " "
            + String(booking.reviewDecision || "")
        ).toLowerCase();
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
        const total = escapeHtml(formatPeso((booking && booking.total) || 0));
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
            + "<div class=\"hr\"></div>"
            + "<div class=\"items-head strong\"><span class=\"item-name\">Item</span><span class=\"item-qty\">Qty</span><span class=\"item-amount\">Amount</span></div>"
            + "<div class=\"item\"><span class=\"item-name\">" + model + "</span><span class=\"item-qty\">1</span><span class=\"item-amount\">" + total + "</span></div>"
            + "<div class=\"hr\"></div>"
            + "<div class=\"totals\">"
            + "<div class=\"row\"><span class=\"label\">Subtotal</span><span class=\"value\">" + total + "</span></div>"
            + "<div class=\"row\"><span class=\"label\">Discount</span><span class=\"value\">" + escapeHtml(formatPeso(0)) + "</span></div>"
            + "<div class=\"row strong\"><span class=\"label\">TOTAL</span><span class=\"value\">" + total + "</span></div>"
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
        const amountLabel = formatReceiptAmountText((booking && booking.total) || 0);
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
        writeRule();
        writeLine("1 x " + getModelLabelFromRecord(booking));
        writeLine("Amount: " + amountLabel);
        writeRule();
        writeLine("Subtotal: " + amountLabel, "bold");
        writeLine("Discount: " + formatReceiptAmountText(0));
        writeLine("TOTAL: " + amountLabel, "bold");
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
                { method: "GET" }
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
                { method: "POST" }
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

    async function updateBookingPaymentStatusViaApi(orderId, paymentStatus) {
        try {
            const response = await fetch(
                getApiUrl(`/api/admin/bookings/${encodeURIComponent(orderId)}/payment-status`),
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        paymentStatus: paymentStatus
                    })
                }
            );

            if (response.status === 404 || response.status === 405) {
                return { mode: "unavailable", booking: null };
            }

            const payload = await response.json().catch(function () {
                return {};
            });
            if (!response.ok || payload.success !== true || !payload.booking) {
                return {
                    mode: "error",
                    message: payload.message || "Unable to update payment status.",
                    booking: null
                };
            }

            return { mode: "ok", booking: payload.booking };
        } catch (_error) {
            return { mode: "unavailable", booking: null };
        }
    }

    async function updateBookingFulfillmentStatusViaApi(orderId, fulfillmentStatus, trackingEta, trackingLocation) {
        try {
            const response = await fetch(
                getApiUrl(`/api/admin/bookings/${encodeURIComponent(orderId)}/fulfillment-status`),
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        fulfillmentStatus: fulfillmentStatus,
                        trackingEta: trackingEta,
                        trackingLocation: trackingLocation
                    })
                }
            );

            if (response.status === 404 || response.status === 405) {
                return { mode: "unavailable", booking: null };
            }

            const payload = await response.json().catch(function () {
                return {};
            });
            if (!response.ok || payload.success !== true || !payload.booking) {
                return {
                    mode: "error",
                    message: payload.message || "Unable to update fulfillment status.",
                    booking: null
                };
            }

            return { mode: "ok", booking: payload.booking };
        } catch (_error) {
            return { mode: "unavailable", booking: null };
        }
    }

    function setEmptyState(show) {
        detailsEmpty.hidden = !show;
        detailsContent.hidden = show;
        approveBtn.disabled = show;
        rejectBtn.disabled = show;
        if (paymentStatusSelect) {
            paymentStatusSelect.disabled = show;
        }
        if (savePaymentStatusBtn) {
            savePaymentStatusBtn.disabled = show;
        }
        if (fulfillmentStatusSelect) {
            fulfillmentStatusSelect.disabled = show;
        }
        if (fulfillmentEtaInput) {
            fulfillmentEtaInput.disabled = show;
        }
        if (fulfillmentLocationInput) {
            fulfillmentLocationInput.disabled = show;
        }
        if (saveFulfillmentStatusBtn) {
            saveFulfillmentStatusBtn.disabled = show;
        }
        if (show) {
            updateReceiptActionButtons(null);
        }
    }

    function renderBookingDetails(booking) {
        detailOrderId.textContent = getRecordOrderId(booking) || "-";
        detailCreatedAt.textContent = formatDateTime(getRecordCreatedAt(booking));
        detailName.textContent = buildNameFromRecord(booking);
        detailEmail.textContent = getRecordEmail(booking) || "-";
        detailModel.textContent = getModelLabelFromRecord(booking);
        if (detailColor) {
            detailColor.textContent = getBikeColorLabelFromRecord(booking) || "-";
        }
        detailService.textContent = String(booking.service || "-");
        detailSchedule.textContent = formatScheduleFromRecord(booking);
        detailPlan.textContent = getPlanLabel(booking);
        detailPayment.textContent = String(booking.payment || "-");
        if (detailPaymentStatus) {
            detailPaymentStatus.textContent = formatPaymentStatus(booking.paymentStatus);
        }
        if (paymentStatusSelect) {
            const normalizedPaymentStatus = normalizePaymentStatusValue(booking.paymentStatus);
            if (normalizedPaymentStatus && paymentStatusSelect.querySelector(`option[value="${normalizedPaymentStatus}"]`)) {
                paymentStatusSelect.value = normalizedPaymentStatus;
            }
        }
        renderFulfillmentOptionsForBooking(booking);
        const allowFulfillmentUpdate = canUpdateFulfillmentStatus(booking);
        if (fulfillmentStatusSelect) {
            fulfillmentStatusSelect.disabled = !allowFulfillmentUpdate;
        }
        if (fulfillmentEtaInput) {
            fulfillmentEtaInput.disabled = !allowFulfillmentUpdate;
        }
        if (fulfillmentLocationInput) {
            fulfillmentLocationInput.disabled = !allowFulfillmentUpdate;
        }
        if (saveFulfillmentStatusBtn) {
            saveFulfillmentStatusBtn.disabled = !allowFulfillmentUpdate;
        }
        detailStatus.textContent = getStatusLabel(booking);
        if (detailTrackingEta) {
            detailTrackingEta.textContent = formatTrackingField(booking.trackingEta, "Not set");
        }
        if (detailTrackingLocation) {
            detailTrackingLocation.textContent = formatTrackingField(booking.trackingLocation, "Not set");
        }
        detailTotal.textContent = formatPeso(booking.total || 0);
        detailAddress.textContent = String(booking.shippingAddress || "N/A");
        if (fulfillmentEtaInput) {
            fulfillmentEtaInput.value = normalizeTrackingEta(booking.trackingEta);
        }
        if (fulfillmentLocationInput) {
            fulfillmentLocationInput.value = normalizeTrackingLocation(booking.trackingLocation);
        }
        setPaymentStatusFeedback("", "muted");
        if (allowFulfillmentUpdate) {
            setFulfillmentStatusFeedback("", "muted");
        } else {
            setFulfillmentStatusFeedback("Approve this booking first before updating fulfillment progress.", "muted");
        }
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

        if (savePaymentStatusBtn && paymentStatusSelect) {
            savePaymentStatusBtn.addEventListener("click", async function () {
                if (!currentBooking) {
                    return;
                }
                const nextStatus = normalizePaymentStatusValue(paymentStatusSelect.value);
                if (!nextStatus) {
                    setPaymentStatusFeedback("Select a valid payment status first.", "error");
                    return;
                }
                const currentStatus = normalizePaymentStatusValue(currentBooking.paymentStatus);
                if (nextStatus === currentStatus) {
                    setPaymentStatusFeedback("Payment status is already up to date.", "muted");
                    return;
                }

                savePaymentStatusBtn.disabled = true;
                paymentStatusSelect.disabled = true;
                setPaymentStatusFeedback("Updating payment status...", "muted");

                const result = await updateBookingPaymentStatusViaApi(orderId, nextStatus);
                if (result.mode === "ok" && result.booking) {
                    currentBooking = mergeBookingSnapshot(currentBooking, result.booking);
                    localStorage.setItem(selectedBookingKey, JSON.stringify(currentBooking));
                    renderBookingDetails(currentBooking);
                    setPaymentStatusFeedback("Payment status updated successfully.", "success");
                    savePaymentStatusBtn.disabled = false;
                    paymentStatusSelect.disabled = false;
                    return;
                }

                if (result.mode === "error") {
                    setPaymentStatusFeedback(result.message || "Unable to update payment status.", "error");
                    savePaymentStatusBtn.disabled = false;
                    paymentStatusSelect.disabled = false;
                    return;
                }

                setPaymentStatusFeedback("API unavailable. Unable to update payment status.", "error");
                savePaymentStatusBtn.disabled = false;
                paymentStatusSelect.disabled = false;
            });
        }

        if (saveFulfillmentStatusBtn && fulfillmentStatusSelect) {
            saveFulfillmentStatusBtn.addEventListener("click", async function () {
                if (!currentBooking) {
                    return;
                }

                const baseStatus = normalizeProgressText(fulfillmentStatusSelect.value);
                const nextTrackingEta = fulfillmentEtaInput
                    ? normalizeTrackingEta(fulfillmentEtaInput.value)
                    : "";
                const locationNote = fulfillmentLocationInput
                    ? normalizeTrackingLocation(fulfillmentLocationInput.value)
                    : "";
                const nextFulfillmentStatus = buildFulfillmentStatusPayload(baseStatus);
                if (!nextFulfillmentStatus) {
                    setFulfillmentStatusFeedback("Select a fulfillment status first.", "error");
                    return;
                }

                const currentFulfillmentStatus = normalizeProgressText(currentBooking.fulfillmentStatus);
                const currentTrackingEta = normalizeTrackingEta(currentBooking.trackingEta);
                const currentTrackingLocation = normalizeTrackingLocation(currentBooking.trackingLocation);
                const isStatusSame = nextFulfillmentStatus.toLowerCase() === currentFulfillmentStatus.toLowerCase();
                const isEtaSame = nextTrackingEta.toLowerCase() === currentTrackingEta.toLowerCase();
                const isLocationSame = locationNote.toLowerCase() === currentTrackingLocation.toLowerCase();
                if (isStatusSame && isEtaSame && isLocationSame) {
                    setFulfillmentStatusFeedback("Fulfillment, ETA, and location are already up to date.", "muted");
                    return;
                }

                saveFulfillmentStatusBtn.disabled = true;
                fulfillmentStatusSelect.disabled = true;
                if (fulfillmentEtaInput) {
                    fulfillmentEtaInput.disabled = true;
                }
                if (fulfillmentLocationInput) {
                    fulfillmentLocationInput.disabled = true;
                }
                setFulfillmentStatusFeedback("Updating fulfillment status, ETA, and location...", "muted");

                const result = await updateBookingFulfillmentStatusViaApi(
                    orderId,
                    nextFulfillmentStatus,
                    nextTrackingEta,
                    locationNote
                );
                if (result.mode === "ok" && result.booking) {
                    currentBooking = mergeBookingSnapshot(currentBooking, result.booking);
                    localStorage.setItem(selectedBookingKey, JSON.stringify(currentBooking));
                    renderBookingDetails(currentBooking);
                    setFulfillmentStatusFeedback("Fulfillment, ETA, and location updated successfully.", "success");
                    saveFulfillmentStatusBtn.disabled = false;
                    fulfillmentStatusSelect.disabled = false;
                    if (fulfillmentEtaInput) {
                        fulfillmentEtaInput.disabled = false;
                    }
                    if (fulfillmentLocationInput) {
                        fulfillmentLocationInput.disabled = false;
                    }
                    return;
                }

                if (result.mode === "error") {
                    setFulfillmentStatusFeedback(result.message || "Unable to update fulfillment status.", "error");
                    saveFulfillmentStatusBtn.disabled = false;
                    fulfillmentStatusSelect.disabled = false;
                    if (fulfillmentEtaInput) {
                        fulfillmentEtaInput.disabled = false;
                    }
                    if (fulfillmentLocationInput) {
                        fulfillmentLocationInput.disabled = false;
                    }
                    return;
                }

                setFulfillmentStatusFeedback("API unavailable. Unable to update fulfillment status.", "error");
                saveFulfillmentStatusBtn.disabled = false;
                fulfillmentStatusSelect.disabled = false;
                if (fulfillmentEtaInput) {
                    fulfillmentEtaInput.disabled = false;
                }
                if (fulfillmentLocationInput) {
                    fulfillmentLocationInput.disabled = false;
                }
            });
        }
    }

    void initialize();
});

