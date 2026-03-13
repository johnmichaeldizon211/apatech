(function () {
    if (window.EcodriveReviews) {
        return;
    }

    const DEFAULT_API_BASE = "https://apatech.vercel.app";
    const CACHE_KEY = "ecodrive_reviews_cache_v1";
    const REVIEWED_KEY = "ecodrive_reviewed_orders_v1";
    const API_PATH = "/api/reviews";
    const MAX_REVIEW_IMAGES = 3;
    const MAX_REVIEW_IMAGE_BYTES = 2 * 1024 * 1024;

    function safeParse(value) {
        try {
            return JSON.parse(value);
        } catch (_error) {
            return null;
        }
    }

    function slugify(value) {
        return String(value || "")
            .toLowerCase()
            .replace(/model\s*:/gi, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
    }

    function formatDisplayDate(dateInput) {
        const date = dateInput instanceof Date ? dateInput : new Date(dateInput || "");
        if (Number.isNaN(date.getTime())) {
            return "";
        }
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        const hours = String(date.getHours()).padStart(2, "0");
        const minutes = String(date.getMinutes()).padStart(2, "0");
        return `${year}-${month}-${day} ${hours}:${minutes}`;
    }

    function getOrderKey(orderId, createdAt) {
        const id = String(orderId || "").trim().toLowerCase();
        if (id) {
            return `id:${id}`;
        }
        const created = String(createdAt || "").trim();
        return created ? `created:${created}` : "";
    }

    function resolveApiBase() {
        const stored = String(localStorage.getItem("ecodrive_reviews_api_base") || "").trim();
        const sessionBase = (window.EcodriveSession && typeof window.EcodriveSession.getApiBase === "function")
            ? String(window.EcodriveSession.getApiBase() || "").trim()
            : "";
        const host = window.location && window.location.hostname;
        const isLocalhost = host && (host === "localhost" || host === "127.0.0.1");
        if (isLocalhost) {
            const localBase = stored || sessionBase || window.location.origin;
            return localBase.replace(/\/+$/, "");
        }

        const resolved = sessionBase || DEFAULT_API_BASE;
        return resolved.replace(/\/+$/, "");
    }

    const API_BASE = resolveApiBase();

    function getApiUrl(query) {
        const suffix = query ? "?" + query : "";
        return API_BASE + API_PATH + suffix;
    }

    function readCache() {
        const parsed = safeParse(localStorage.getItem(CACHE_KEY));
        return parsed && typeof parsed === "object" ? parsed : {};
    }

    function saveCache(cache) {
        localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    }

    function getCachedReviews(productIdInput) {
        const key = slugify(productIdInput);
        if (!key) {
            return [];
        }
        const cache = readCache();
        return Array.isArray(cache[key]) ? cache[key] : [];
    }

    function setCachedReviews(productIdInput, reviews) {
        const key = slugify(productIdInput);
        if (!key) {
            return;
        }
        const cache = readCache();
        cache[key] = Array.isArray(reviews) ? reviews : [];
        saveCache(cache);
    }

    async function fetchReviews(productIdInput) {
        const productId = slugify(productIdInput);
        if (!productId) {
            return [];
        }
        try {
            const response = await fetch(getApiUrl("product_id=" + encodeURIComponent(productId)));
            const payload = await response.json().catch(function () {
                return {};
            });
            if (!response.ok || !payload || payload.success !== true) {
                throw new Error(payload && payload.message ? payload.message : "Unable to fetch reviews.");
            }
            const reviews = Array.isArray(payload.reviews) ? payload.reviews : [];
            setCachedReviews(productId, reviews);
            return reviews;
        } catch (_error) {
            return getCachedReviews(productId);
        }
    }

    function isDataImage(value) {
        return typeof value === "string" && /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(value);
    }

    function estimateDataUrlBytes(dataUrl) {
        if (!dataUrl || typeof dataUrl !== "string") {
            return 0;
        }
        const commaIndex = dataUrl.indexOf(",");
        if (commaIndex === -1) {
            return 0;
        }
        const base64 = dataUrl.slice(commaIndex + 1);
        return Math.floor(base64.length * 3 / 4);
    }

    function readFileAsDataUrl(file) {
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();
            reader.onload = function () {
                resolve(reader.result);
            };
            reader.onerror = function () {
                reject(new Error("Unable to read file"));
            };
            reader.readAsDataURL(file);
        });
    }

    async function normalizeReviewImages(images) {
        const list = Array.isArray(images) ? images : [];
        const output = [];
        for (let i = 0; i < list.length; i += 1) {
            if (output.length >= MAX_REVIEW_IMAGES) {
                break;
            }
            const image = list[i];
            if (!image) continue;
            let dataUrl = "";
            if (typeof image === "string") {
                dataUrl = image;
            } else if (image && typeof image === "object") {
                if (typeof image.src === "string") {
                    dataUrl = image.src;
                } else if (typeof image.dataUrl === "string") {
                    dataUrl = image.dataUrl;
                } else if (image.file instanceof File) {
                    if (image.file.size > MAX_REVIEW_IMAGE_BYTES) {
                        throw new Error("Each image must be under 2MB.");
                    }
                    dataUrl = await readFileAsDataUrl(image.file);
                }
            } else if (image instanceof File) {
                if (image.size > MAX_REVIEW_IMAGE_BYTES) {
                    throw new Error("Each image must be under 2MB.");
                }
                dataUrl = await readFileAsDataUrl(image);
            }
            if (!dataUrl || !isDataImage(dataUrl)) {
                continue;
            }
            if (estimateDataUrlBytes(dataUrl) > MAX_REVIEW_IMAGE_BYTES) {
                throw new Error("Each image must be under 2MB.");
            }
            output.push(dataUrl);
        }
        return output;
    }

    async function submitReview(input) {
        const review = input && typeof input === "object" ? input : {};
        const productName = String(review.productName || "").trim();
        const productId = slugify(review.productId || productName);
        const ratingValue = Number(review.rating || 0);
        const rating = Math.max(1, Math.min(5, Math.round(ratingValue)));

        if (!productId || !rating) {
            return { success: false, message: "Missing product or rating." };
        }

        let imagesPayload = [];
        try {
            imagesPayload = await normalizeReviewImages(review.images);
        } catch (error) {
            return { success: false, message: error.message || "Unable to attach images." };
        }
        const payload = {
            product_id: productId,
            product_name: productName,
            rating: rating,
            review_text: String(review.text || ""),
            reviewer_name: String(review.name || "Anonymous"),
            order_id: review.orderId ? String(review.orderId) : "",
            user_email: review.userEmail ? String(review.userEmail) : "",
            booking_status: review.status ? String(review.status) : "",
            fulfillment_status: review.fulfillmentStatus ? String(review.fulfillmentStatus) : "",
            images: imagesPayload
        };

        try {
            const responsePayload = await postReviewPayload(payload);
            if (!responsePayload || responsePayload.success !== true) {
                return {
                    success: false,
                    message: responsePayload && responsePayload.message ? responsePayload.message : "Unable to submit review."
                };
            }
            setCachedReviews(productId, Array.isArray(responsePayload.reviews) ? responsePayload.reviews : getCachedReviews(productId));
            markOrderReviewed(review.orderId, review.createdAt);
            return { success: true, reviews: responsePayload.reviews || [] };
        } catch (error) {
            return { success: false, message: error && error.message ? error.message : "Network error while submitting review." };
        }
    }

    function postReviewPayload(payload) {
        return new Promise(function (resolve, reject) {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", getApiUrl(""), true);
            xhr.setRequestHeader("Content-Type", "text/plain");
            xhr.onload = function () {
                const status = xhr.status || 0;
                const responseText = xhr.responseText || "";
                let parsed = {};
                if (responseText) {
                    try {
                        parsed = JSON.parse(responseText);
                    } catch (_error) {
                        parsed = {};
                    }
                }
                if (status >= 200 && status < 300) {
                    resolve(parsed);
                    return;
                }
                parsed = parsed && typeof parsed === "object" ? parsed : {};
                parsed.message = parsed.message || "Unable to submit review.";
                resolve(parsed);
            };
            xhr.onerror = function () {
                reject(new Error("Network error while submitting review."));
            };
            xhr.send(JSON.stringify(payload));
        });
    }

    function isOrderReviewed(orderId, createdAt) {
        const key = getOrderKey(orderId, createdAt);
        if (!key) {
            return false;
        }
        const parsed = safeParse(localStorage.getItem(REVIEWED_KEY));
        const list = Array.isArray(parsed) ? parsed : [];
        return list.includes(key);
    }

    function markOrderReviewed(orderId, createdAt) {
        const key = getOrderKey(orderId, createdAt);
        if (!key) {
            return false;
        }
        const parsed = safeParse(localStorage.getItem(REVIEWED_KEY));
        const list = Array.isArray(parsed) ? parsed : [];
        if (!list.includes(key)) {
            list.push(key);
            localStorage.setItem(REVIEWED_KEY, JSON.stringify(list));
        }
        return true;
    }

    window.EcodriveReviews = {
        slugify: slugify,
        getOrderKey: getOrderKey,
        fetchReviews: fetchReviews,
        submitReview: submitReview,
        getCachedReviews: getCachedReviews,
        isOrderReviewed: isOrderReviewed,
        markOrderReviewed: markOrderReviewed,
        formatDisplayDate: formatDisplayDate
    };
})();
