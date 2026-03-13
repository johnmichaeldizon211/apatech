(function () {
    if (window.EcodriveReviews) {
        return;
    }

    const DEFAULT_HOST = "ecodrivebookingplatform.shop";
    const DEFAULT_API_BASE = "https://" + DEFAULT_HOST;
    const CACHE_KEY = "ecodrive_reviews_cache_v1";
    const REVIEWED_KEY = "ecodrive_reviewed_orders_v1";
    const API_PATH = "/api/reviews.php";

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
        const stored = String(
            localStorage.getItem("ecodrive_reviews_api_base") || ""
        ).trim();

        if (stored) {
            return stored.replace(/\/+$/, "");
        }

        const host = window.location && window.location.hostname;
        if (host && (host === "localhost" || host === "127.0.0.1")) {
            return window.location.origin.replace(/\/+$/, "");
        }

        return DEFAULT_API_BASE;
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

    function dataUrlToBlob(dataUrl) {
        if (!dataUrl || typeof dataUrl !== "string") {
            return null;
        }
        const parts = dataUrl.split(",");
        if (parts.length < 2) {
            return null;
        }
        const match = parts[0].match(/data:([^;]+);base64/i);
        const mime = match ? match[1] : "image/jpeg";
        const binary = atob(parts[1]);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i += 1) {
            bytes[i] = binary.charCodeAt(i);
        }
        return new Blob([bytes], { type: mime });
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

        const form = new FormData();
        form.append("product_id", productId);
        form.append("product_name", productName);
        form.append("rating", String(rating));
        form.append("review_text", String(review.text || ""));
        form.append("reviewer_name", String(review.name || "Anonymous"));
        if (review.orderId) {
            form.append("order_id", String(review.orderId));
        }
        if (review.userEmail) {
            form.append("user_email", String(review.userEmail));
        }

        if (Array.isArray(review.images)) {
            review.images.forEach(function (image, index) {
                if (!image) return;
                if (image instanceof File) {
                    form.append("images[]", image, image.name || `review-${index + 1}.jpg`);
                    return;
                }
                if (image.file instanceof File) {
                    form.append("images[]", image.file, image.file.name || `review-${index + 1}.jpg`);
                    return;
                }
                if (image.src) {
                    const blob = dataUrlToBlob(image.src);
                    if (blob) {
                        form.append("images[]", blob, image.name || `review-${index + 1}.jpg`);
                    }
                }
            });
        }

        try {
            const response = await fetch(getApiUrl(""), {
                method: "POST",
                body: form
            });
            const payload = await response.json().catch(function () {
                return {};
            });
            if (!response.ok || !payload || payload.success !== true) {
                return { success: false, message: payload && payload.message ? payload.message : "Unable to submit review." };
            }
            setCachedReviews(productId, Array.isArray(payload.reviews) ? payload.reviews : getCachedReviews(productId));
            markOrderReviewed(review.orderId, review.createdAt);
            return { success: true, reviews: payload.reviews || [] };
        } catch (_error) {
            return { success: false, message: "Network error while submitting review." };
        }
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
