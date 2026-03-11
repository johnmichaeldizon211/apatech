(function (global) {
    "use strict";

    const STORAGE_KEY = "ecodrive_product_catalog";
    const CHECKOUT_SELECTION_KEYS = [
        "ecodrive_checkout_selection",
        "ecodrive_selected_bike",
        "selectedBike"
    ];
    const ROOT = document.documentElement;
    const CURRENT_FILE = String((window.location.pathname || "").split("/").pop() || "").toLowerCase();
    const IS_USERHOME_CATALOG_PAGE = CURRENT_FILE.startsWith("userhome2");
    const API_BASE = String(
        localStorage.getItem("ecodrive_api_base")
        || localStorage.getItem("ecodrive_kyc_api_base")
        || (global.EcodriveSession && typeof global.EcodriveSession.getApiBase === "function"
            ? global.EcodriveSession.getApiBase()
            : "")
    )
        .trim()
        .replace(/\/+$/, "");
    if (IS_USERHOME_CATALOG_PAGE) {
        ROOT.classList.add("catalog-loading");
    }

    const DEFAULT_PRODUCTS = [
        { id: 1, model: "BLITZ 2000", price: 68000, category: "2-Wheel", imageUrl: "/Userhomefolder/image 1.png", detailUrl: "/Userhomefolder/Ebikes/ebike1.0.html", isActive: true },
        { id: 2, model: "BLITZ 1200", price: 45000, category: "2-Wheel", imageUrl: "/Userhomefolder/image 2.png", detailUrl: "/Userhomefolder/Ebikes/ebike2.0.html", isActive: true },
        { id: 3, model: "FUN 1500 FI", price: 24000, category: "2-Wheel", imageUrl: "/Userhomefolder/image 3.png", detailUrl: "/Userhomefolder/Ebikes/ebike3.0.html", isActive: true },
        { id: 4, model: "CANDY 800", price: 39000, category: "2-Wheel", imageUrl: "/Userhomefolder/image 4.png", detailUrl: "/Userhomefolder/Ebikes/ebike4.0.html", isActive: true },
        { id: 5, model: "BLITZ 200R", price: 40000, category: "2-Wheel", imageUrl: "/Userhomefolder/image 5.png", detailUrl: "/Userhomefolder/Ebikes/ebike5.0.html", isActive: true },
        { id: 6, model: "TRAVELLER 1500", price: 78000, category: "4-Wheel", imageUrl: "/Userhomefolder/image 6.png", detailUrl: "/Userhomefolder/Ebikes/ebike6.0.html", isActive: true },
        { id: 7, model: "ECONO 500 MP", price: 51000, category: "3-Wheel", imageUrl: "/Userhomefolder/image 7.png", detailUrl: "/Userhomefolder/Ebikes/ebike7.0.html", isActive: true },
        { id: 8, model: "ECONO 350 MINI-II", price: 39000, category: "3-Wheel", imageUrl: "/Userhomefolder/image 8.png", detailUrl: "/Userhomefolder/Ebikes/ebike8.0.html", isActive: true },
        { id: 9, model: "ECARGO 100", price: 72500, category: "3-Wheel", imageUrl: "/Userhomefolder/image 9.png", detailUrl: "/Userhomefolder/Ebikes/ebike9.0.html", isActive: true },
        { id: 10, model: "ECONO 650 MP", price: 65000, category: "3-Wheel", imageUrl: "/Userhomefolder/image 10.png", detailUrl: "/Userhomefolder/Ebikes/ebike10.0.html", isActive: true },
        { id: 11, model: "ECAB 100V V2", price: 51500, category: "3-Wheel", imageUrl: "/Userhomefolder/image 11.png", detailUrl: "/Userhomefolder/Ebikes/ebike11.0.html", isActive: true },
        { id: 12, model: "ECONO 800 MP II", price: 67000, category: "3-Wheel", imageUrl: "/Userhomefolder/image 12.png", detailUrl: "/Userhomefolder/Ebikes/ebike12.0.html", isActive: true },
        { id: 13, model: "E-CARGO 800", price: 65000, category: "3-Wheel", imageUrl: "/Userhomefolder/image 13.png", detailUrl: "/Userhomefolder/Ebikes/ebike13.0.html", isActive: true },
        { id: 14, model: "E-CAB MAX 1500", price: 130000, category: "3-Wheel", imageUrl: "/Userhomefolder/image 14.png", detailUrl: "/Userhomefolder/Ebikes/ebike14.0.html", isActive: true },
        { id: 15, model: "E-CAB 1000", price: 75000, category: "3-Wheel", imageUrl: "/Userhomefolder/image 15.png", detailUrl: "/Userhomefolder/Ebikes/ebike15.0.html", isActive: true },
        { id: 16, model: "ECONO 800 MP", price: 60000, category: "3-Wheel", imageUrl: "/Userhomefolder/image 16.png", detailUrl: "/Userhomefolder/Ebikes/ebike16.0.html", isActive: true }
    ];
    const SUGGESTED_CONFIG = [
        { matchers: ["ECONO 350 MINI-II"], detailId: 8, badge: "Best Seller" },
        { matchers: ["ECONO 500 MP"], detailId: 7, badge: "Popular" },
        { matchers: ["BLITZ 2000"], detailId: 1, badge: "Top Pick" },
        { matchers: ["E-CARGO 800", "E-CARGO 800J"], detailId: 13, badge: "Suggested" }
    ];
    const BEST_SELLER_FILTER_CONFIG = [
        { matchers: ["ECONO 350 MINI-II"], detailId: 8 },
        { matchers: ["ECONO 500 MP"], detailId: 7 },
        { matchers: ["BLITZ 2000"], detailId: 1 }
    ];
    const RECOMMENDED_FILTER_CONFIG = [
        { matchers: ["E-CARGO 800", "E-CARGO 800J"], detailId: 13 },
        { matchers: ["ECONO 800 MP II"], detailId: 12 },
        { matchers: ["ECAB 100V V2", "E-CAB MAX 1500"], detailId: 11 }
    ];
    const DEFAULT_IMAGE_BY_MODEL = DEFAULT_PRODUCTS.reduce(function (map, item) {
        const key = String(item && item.model || "").trim().toLowerCase();
        if (key && item && item.imageUrl) {
            map[key] = String(item.imageUrl);
        }
        return map;
    }, {});
    let globalBookingStats = null;
    let bookingStatsPromise = null;

    function safeParse(raw) {
        try {
            return JSON.parse(raw);
        } catch (_error) {
            return null;
        }
    }

    function normalizeText(value) {
        return String(value || "").trim().replace(/\s+/g, " ");
    }

    function normalizeKey(value) {
        return normalizeText(value)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "");
    }

    function parseWheelCategory(value) {
        const raw = normalizeText(value).toLowerCase();
        if (!raw) {
            return "";
        }
        const compact = raw.replace(/[\s_-]+/g, "");
        if (compact === "2wheel" || compact === "2wheels") {
            return "2-Wheel";
        }
        if (compact === "3wheel" || compact === "3wheels") {
            return "3-Wheel";
        }
        if (compact === "4wheel" || compact === "4wheels") {
            return "4-Wheel";
        }
        if (compact === "other") {
            return "Other";
        }
        return "";
    }

    function inferCategoryFromDetailUrl(detailUrl) {
        const raw = String(detailUrl || "").trim();
        if (!raw) {
            return "";
        }
        const match = raw.match(/ebike(\d+)\.0\.html/i);
        if (!match) {
            return "";
        }
        const bikeId = Number(match[1]);
        if (!Number.isFinite(bikeId)) {
            return "";
        }
        if (bikeId >= 1 && bikeId <= 5) {
            return "2-Wheel";
        }
        if (bikeId === 6) {
            return "4-Wheel";
        }
        if (bikeId >= 7 && bikeId <= 16) {
            return "3-Wheel";
        }
        return "";
    }

    function extractDetailId(detailUrl) {
        const raw = String(detailUrl || "").trim();
        const match = raw.match(/ebike(\d+)\.0\.html/i);
        return match ? Number(match[1]) : 0;
    }

    function resolveCategory(rawCategory, detailUrl) {
        const fromDetail = inferCategoryFromDetailUrl(detailUrl);
        if (fromDetail) {
            return fromDetail;
        }
        const parsed = parseWheelCategory(rawCategory);
        return parsed || "Other";
    }

    function normalizeCategory(value) {
        return parseWheelCategory(value) || "Other";
    }

    function matchesSuggestedConfig(product, config) {
        const detailId = extractDetailId(product && product.detailUrl);
        if (config.detailId && detailId === config.detailId) {
            return true;
        }
        const modelKey = normalizeKey(product && product.model);
        if (!modelKey) {
            return false;
        }
        return (config.matchers || []).some(function (matcher) {
            const matcherKey = normalizeKey(matcher);
            return matcherKey && (modelKey === matcherKey || modelKey.includes(matcherKey) || matcherKey.includes(modelKey));
        });
    }

    function pickSuggestedProducts(catalog, configs) {
        const available = (Array.isArray(catalog) ? catalog : []).filter(isCatalogProductAvailable);
        const used = new Set();
        return (configs || [])
            .map(function (config) {
                const match = available.find(function (product) {
                    const key = String(product.id || "") + "|" + String(product.detailUrl || product.model || "");
                    if (used.has(key)) {
                        return false;
                    }
                    return matchesSuggestedConfig(product, config);
                });
                if (!match) {
                    return null;
                }
                used.add(String(match.id || "") + "|" + String(match.detailUrl || match.model || ""));
                return Object.assign({}, match, { suggestedBadge: config.badge || "Suggested" });
            })
            .filter(Boolean);
    }

    function extractModelFromRecord(record) {
        if (!record || typeof record !== "object") {
            return "";
        }
        return String(
            record.model
            || record.bikeModel
            || record.selectedModel
            || (record.selectedBike && record.selectedBike.model)
            || (record.item && record.item.model)
            || ""
        ).trim();
    }

    function readBookingRecordsFromStorage() {
        const keys = ["ecodrive_bookings", "ecodrive_orders", "orders"];
        const records = [];
        keys.forEach(function (key) {
            const parsed = safeParse(localStorage.getItem(key));
            if (Array.isArray(parsed)) {
                parsed.forEach(function (entry) {
                    if (entry && typeof entry === "object") {
                        records.push(entry);
                    }
                });
            }
        });
        const latest = safeParse(localStorage.getItem("latestBooking"));
        if (latest && typeof latest === "object") {
            records.push(latest);
        }
        return records;
    }

    function getLocalBookingCountsMap() {
        const counts = new Map();
        const records = readBookingRecordsFromStorage();
        records.forEach(function (record) {
            const model = extractModelFromRecord(record);
            if (!model) {
                return;
            }
            const key = normalizeKey(model);
            if (!key) {
                return;
            }
            counts.set(key, (counts.get(key) || 0) + 1);
        });
        return counts;
    }

    function getBookingCountsMap() {
        if (globalBookingStats && globalBookingStats.counts instanceof Map) {
            return globalBookingStats.counts;
        }
        return getLocalBookingCountsMap();
    }

    function getBookedRanking(products, countsMap) {
        const list = (Array.isArray(products) ? products : [])
            .map(function (product) {
                const key = normalizeKey(product && product.model);
                const count = key && countsMap ? (countsMap.get(key) || 0) : 0;
                return { product: product, count: count };
            })
            .filter(function (entry) {
                return entry.product && entry.count > 0;
            })
            .sort(function (a, b) {
                if (b.count !== a.count) {
                    return b.count - a.count;
                }
                return String(a.product.model || "").localeCompare(String(b.product.model || ""));
            });
        return list;
    }

    function buildHighlightProduct(product, count, badge) {
        return Object.assign({}, product, {
            badge: badge,
            ratingLabel: count > 0 ? count + " bookings" : (product.category || "Suggested")
        });
    }

    function getBookingHighlights(catalog, options) {
        const opts = options && typeof options === "object" ? options : {};
        const limitBest = Number.isFinite(opts.limitBest) ? opts.limitBest : 3;
        const limitPopular = Number.isFinite(opts.limitPopular) ? opts.limitPopular : 3;
        const counts = getBookingCountsMap();
        const ranking = getBookedRanking(catalog, counts);
        const bestSellers = ranking.slice(0, limitBest).map(function (entry) {
            return buildHighlightProduct(entry.product, entry.count, "Best Seller");
        });
        let mostPopular = ranking.slice(limitBest, limitBest + limitPopular).map(function (entry) {
            return buildHighlightProduct(entry.product, entry.count, "Most Popular");
        });
        if (!mostPopular.length && ranking.length) {
            mostPopular = ranking.slice(0, limitPopular).map(function (entry) {
                return buildHighlightProduct(entry.product, entry.count, "Most Popular");
            });
        }
        return {
            bestSellers: bestSellers,
            mostPopular: mostPopular,
            hasData: ranking.length > 0
        };
    }

    function pickFallbackMatches(products, configs) {
        return (Array.isArray(products) ? products : []).filter(function (item) {
            return matchesSuggestedConfig(item, configs);
        });
    }

    function applyPricePreset(products, preset) {
        const mode = String(preset || "").trim().toLowerCase();
        if (!mode) {
            return products;
        }
        const counts = getBookingCountsMap();
        const ranking = getBookedRanking(products, counts);
        if (mode === "best") {
            if (ranking.length) {
                return ranking.slice(0, 3).map(function (entry) { return entry.product; });
            }
            return pickFallbackMatches(products, BEST_SELLER_FILTER_CONFIG);
        }
        if (mode === "recommended") {
            if (ranking.length > 3) {
                return ranking.slice(3, 6).map(function (entry) { return entry.product; });
            }
            if (ranking.length) {
                return ranking.slice(0, 3).map(function (entry) { return entry.product; });
            }
            return pickFallbackMatches(products, RECOMMENDED_FILTER_CONFIG);
        }

        const prices = products
            .map(function (item) { return Number(item.price || 0); })
            .filter(function (price) { return Number.isFinite(price) && price > 0; })
            .sort(function (a, b) { return a - b; });
        if (!prices.length) {
            return products;
        }
        const lowIndex = Math.floor((prices.length - 1) / 3);
        const midIndex = Math.floor((prices.length - 1) * 2 / 3);
        const lowMax = prices[lowIndex];
        const midMax = prices[midIndex];

        if (mode === "low") {
            return products.filter(function (item) {
                return Number(item.price || 0) <= lowMax;
            });
        }
        if (mode === "mid") {
            return products.filter(function (item) {
                const price = Number(item.price || 0);
                return price > lowMax && price <= midMax;
            });
        }
        if (mode === "high") {
            return products.filter(function (item) {
                return Number(item.price || 0) > midMax;
            });
        }
        return products;
    }

    function parsePrice(value) {
        const parsed = Number(String(value || "").replace(/[^0-9.]/g, ""));
        if (!Number.isFinite(parsed) || parsed < 0) {
            return 0;
        }
        return Number(parsed.toFixed(2));
    }

    function isInlineDataImage(value) {
        return /^data:image\//i.test(String(value || "").trim());
    }

    function toIsActive(value) {
        if (value === false || value === 0 || value === "0") {
            return false;
        }
        const normalized = String(value === undefined || value === null ? "1" : value).trim().toLowerCase();
        if (normalized === "false" || normalized === "no") {
            return false;
        }
        return true;
    }

    function normalizeStockCount(value, fallbackValue) {
        const numeric = Number.parseInt(String(value === undefined || value === null ? "" : value).trim(), 10);
        if (Number.isFinite(numeric) && numeric >= 0) {
            return numeric;
        }
        const fallback = Number.parseInt(String(fallbackValue === undefined || fallbackValue === null ? "" : fallbackValue).trim(), 10);
        if (Number.isFinite(fallback) && fallback >= 0) {
            return fallback;
        }
        return 0;
    }

    function normalizeColorKey(value) {
        return String(value || "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .trim()
            .replace(/\s+/g, "-")
            .slice(0, 64);
    }

    function normalizeColorVariants(input) {
        let rows = input;
        if (typeof rows === "string") {
            rows = safeParse(rows);
        }
        if (rows && !Array.isArray(rows) && typeof rows === "object" && Array.isArray(rows.variants)) {
            rows = rows.variants;
        }
        if (!Array.isArray(rows)) {
            return [];
        }

        const seen = new Set();
        return rows
            .map(function (item, index) {
                const source = item && typeof item === "object" ? item : {};
                const key = normalizeColorKey(
                    source.key || source.color || source.name || source.label || ("color " + String(index + 1))
                );
                if (!key || seen.has(key)) {
                    return null;
                }
                seen.add(key);
                const isActive = toIsActive(source.isActive !== undefined ? source.isActive : source.is_active);
                return {
                    key: key,
                    label: normalizeText(source.label || source.name || source.color || source.key || ("Color " + String(index + 1))),
                    isActive: isActive,
                    stockCount: normalizeStockCount(
                        source.stockCount !== undefined ? source.stockCount : source.stock_count,
                        isActive ? 1 : 0
                    )
                };
            })
            .filter(Boolean);
    }

    function hasAvailableColorVariants(variantsInput) {
        const variants = normalizeColorVariants(variantsInput);
        return variants.some(function (variant) {
            return variant.isActive !== false && normalizeStockCount(variant.stockCount, 0) > 0;
        });
    }

    function isCatalogProductAvailable(product) {
        if (!product || product.isActive === false) {
            return false;
        }
        return normalizeStockCount(
            product.stockCount !== undefined ? product.stockCount : product.stock_count,
            product.isActive === false || product.is_active === false ? 0 : 1
        ) > 0
            || hasAvailableColorVariants(product.colorVariants);
    }

    function normalizeProduct(item, fallbackId) {
        const source = item && typeof item === "object" ? item : {};
        const model = normalizeText(source.model || source.name).slice(0, 180);
        if (!model) {
            return null;
        }

        const parsedId = Number(source.id);
        const id = Number.isFinite(parsedId) && parsedId > 0 ? parsedId : Number(fallbackId || 0);
        const imageUrl = String(source.imageUrl || source.image || source.bikeImage || "").trim();
        const detailUrl = String(source.detailUrl || source.detailsUrl || "").trim();
        const normalizedDetailUrl = resolveAssetPath(detailUrl);
        const info = normalizeText(source.info || source.productInfo || source.description).slice(0, 255);

        return {
            id: id,
            model: model,
            price: parsePrice(source.price),
            category: resolveCategory(source.category, normalizedDetailUrl || detailUrl),
            info: info,
            imageUrl: resolveAssetPath(imageUrl || getDefaultImageForModel(model)),
            detailUrl: normalizedDetailUrl,
            stockCount: normalizeStockCount(
                source.stockCount !== undefined ? source.stockCount : source.stock_count,
                toIsActive(source.isActive !== undefined ? source.isActive : source.is_active) ? 1 : 0
            ),
            colorVariants: normalizeColorVariants(source.colorVariants || source.color_variants || source.color_variants_json),
            isActive: toIsActive(source.isActive !== undefined ? source.isActive : source.is_active)
        };
    }

    function getCategoryOrder(category) {
        if (category === "2-Wheel") return 1;
        if (category === "3-Wheel") return 2;
        if (category === "4-Wheel") return 3;
        return 4;
    }

    function getProductDedupKey(item) {
        const detail = String(item && item.detailUrl || "").trim().toLowerCase();
        if (detail) {
            return "detail:" + detail;
        }
        return "model:" + String(item && item.model || "").trim().toLowerCase() + "|category:" + String(item && item.category || "").trim();
    }

    function pickPreferredDuplicate(existingItem, candidateItem) {
        if (!existingItem) {
            return candidateItem;
        }
        const existingActive = existingItem.isActive !== false;
        const candidateActive = candidateItem.isActive !== false;
        if (existingActive !== candidateActive) {
            return candidateActive ? candidateItem : existingItem;
        }
        const existingAvailable = isCatalogProductAvailable(existingItem);
        const candidateAvailable = isCatalogProductAvailable(candidateItem);
        if (existingAvailable !== candidateAvailable) {
            return candidateAvailable ? candidateItem : existingItem;
        }
        const existingId = Number(existingItem.id) || 0;
        const candidateId = Number(candidateItem.id) || 0;
        if (candidateId >= existingId) {
            return candidateItem;
        }
        return existingItem;
    }

    function sanitizeCatalog(input) {
        const rows = Array.isArray(input) ? input : [];
        const normalizedRows = rows
            .map(function (item, index) {
                return normalizeProduct(item, index + 1);
            })
            .filter(Boolean);

        const dedupedMap = new Map();
        normalizedRows.forEach(function (item) {
            const key = getProductDedupKey(item);
            dedupedMap.set(key, pickPreferredDuplicate(dedupedMap.get(key), item));
        });

        return Array.from(dedupedMap.values()).sort(function (left, right) {
            const categoryDiff = getCategoryOrder(left.category) - getCategoryOrder(right.category);
            if (categoryDiff !== 0) {
                return categoryDiff;
            }
            return String(left.model || "").localeCompare(String(right.model || ""));
        });
    }

    function readCatalogFromLocal() {
        const parsed = safeParse(localStorage.getItem(STORAGE_KEY));
        if (!Array.isArray(parsed)) {
            return [];
        }
        return sanitizeCatalog(parsed);
    }

    function saveCatalogToLocal(list) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    }

    function getApiUrl(path) {
        return API_BASE ? `${API_BASE}${path}` : path;
    }

    function getApiHeaders() {
        const headers = {};
        const token = global.EcodriveSession && typeof global.EcodriveSession.getToken === "function"
            ? String(global.EcodriveSession.getToken() || "").trim()
            : "";
        if (token) {
            headers.Authorization = "Bearer " + token;
        }
        return headers;
    }

    function normalizeBookingStatsPayload(payload) {
        if (!payload || payload.success !== true || !Array.isArray(payload.models)) {
            return null;
        }
        const counts = new Map();
        payload.models.forEach(function (row) {
            const model = String(row && row.model || "").trim();
            const key = normalizeKey(model);
            if (!key) {
                return;
            }
            const count = Number(row && row.bookings || 0);
            const numeric = Number.isFinite(count) ? count : 0;
            counts.set(key, (counts.get(key) || 0) + numeric);
        });
        return {
            counts: counts,
            asOf: payload.asOf || null
        };
    }

    async function fetchBookingStatsFromApi() {
        try {
            const response = await fetch(getApiUrl("/api/bookings/stats"), {
                method: "GET",
                headers: getApiHeaders()
            });
            if (!response.ok) {
                return null;
            }
            const payload = await response.json().catch(function () {
                return null;
            });
            return normalizeBookingStatsPayload(payload);
        } catch (_error) {
            return null;
        }
    }

    function ensureBookingStatsLoaded() {
        if (globalBookingStats) {
            return Promise.resolve(globalBookingStats);
        }
        if (bookingStatsPromise) {
            return bookingStatsPromise;
        }
        bookingStatsPromise = fetchBookingStatsFromApi()
            .then(function (result) {
                if (result) {
                    globalBookingStats = result;
                }
                return globalBookingStats;
            })
            .catch(function () {
                return null;
            })
            .finally(function () {
                bookingStatsPromise = null;
            });
        return bookingStatsPromise;
    }

    function getDefaultImageForModel(model) {
        const key = String(model || "").trim().toLowerCase();
        const fromModel = key ? DEFAULT_IMAGE_BY_MODEL[key] : "";
        return fromModel || "/Userhomefolder/image 1.png";
    }

    function getAppBasePath() {
        const pathname = String(window.location.pathname || "").replace(/\\/g, "/");
        const userhomeIndex = pathname.toLowerCase().lastIndexOf("/userhomefolder/");
        if (userhomeIndex > 0) {
            return pathname.slice(0, userhomeIndex);
        }
        return "";
    }

    function resolveAssetPath(path) {
        const raw = String(path || "").trim();
        if (!raw) {
            return "";
        }

        if (/^(?:https?:)?\/\//i.test(raw) || /^data:/i.test(raw) || /^blob:/i.test(raw)) {
            return raw;
        }

        const normalized = raw.replace(/\\/g, "/");
        const appBase = getAppBasePath();

        if (normalized.startsWith("/")) {
            if (!appBase) {
                return normalized;
            }
            if (normalized.toLowerCase().startsWith(`${appBase.toLowerCase()}/`)) {
                return normalized;
            }
            return `${appBase}${normalized}`;
        }

        if (normalized.startsWith("../")) {
            return resolveAssetPath(`/Userhomefolder/${normalized.slice(3)}`);
        }

        if (normalized.startsWith("./")) {
            return normalized.slice(2);
        }

        return normalized;
    }

    async function fetchCatalogFromApi() {
        try {
            const response = await fetch(getApiUrl("/api/products"), {
                method: "GET"
            });

            if (response.status === 404 || response.status === 405) {
                return null;
            }

            const payload = await response.json().catch(function () {
                return {};
            });
            if (!response.ok || payload.success !== true || !Array.isArray(payload.products)) {
                return null;
            }

            const normalized = sanitizeCatalog(payload.products);
            // Keep local cache in sync even when API has zero active products.
            saveCatalogToLocal(normalized);
            return normalized;
        } catch (_error) {
            return null;
        }
    }

    async function loadCatalog() {
        const apiCatalog = await fetchCatalogFromApi();
        if (Array.isArray(apiCatalog)) {
            return apiCatalog;
        }

        const localCatalog = readCatalogFromLocal();
        if (localCatalog.length) {
            return localCatalog;
        }

        const defaults = sanitizeCatalog(DEFAULT_PRODUCTS);
        saveCatalogToLocal(defaults);
        return defaults;
    }

    function formatPriceLabel(amount) {
        return "PRICE " + String.fromCharCode(8369) + Number(amount || 0).toLocaleString("en-PH", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function formatPeso(amount) {
        return new Intl.NumberFormat("en-PH", {
            style: "currency",
            currency: "PHP",
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(Number(amount || 0));
    }

    function buildBookingUrl(product) {
        const params = new URLSearchParams();
        params.set("model", product.model || "Ecodrive E-Bike");
        params.set("price", String(Number(product.price || 0)));
        const imageForQuery = resolveAssetPath(product.imageUrl || getDefaultImageForModel(product.model));
        if (imageForQuery && !isInlineDataImage(imageForQuery) && imageForQuery.length <= 1000) {
            params.set("image", imageForQuery);
        }
        params.set("subtitle", product.category || "E-Bike");
        params.set("info", product.info || "");
        return resolveAssetPath("/Userhomefolder/payment/booking.html") + "?" + params.toString();
    }

    function buildCheckoutSelection(product) {
        const image = resolveAssetPath(product.imageUrl || getDefaultImageForModel(product.model));
        return {
            model: String(product.model || "Ecodrive E-Bike"),
            total: Number(product.price || 0),
            image: image,
            bikeImage: image,
            subtitle: String(product.category || "E-Bike"),
            info: String(product.info || "")
        };
    }

    function persistCheckoutSelection(product) {
        const selection = buildCheckoutSelection(product);
        CHECKOUT_SELECTION_KEYS.forEach(function (key) {
            localStorage.setItem(key, JSON.stringify(selection));
        });
    }

    function getProductActionUrl(product) {
        const detailUrl = String(product.detailUrl || "").trim();
        if (detailUrl) {
            return resolveAssetPath(detailUrl);
        }
        const productId = Number(product && product.id || 0);
        if (Number.isFinite(productId) && productId > 0) {
            return resolveAssetPath(`/Userhomefolder/Ebikes/model-detail.html?productId=${productId}`);
        }
        return buildBookingUrl(product);
    }

    function createCard(product) {
        const card = document.createElement("article");
        card.className = "card";

        const imageWrap = document.createElement("div");
        imageWrap.className = "img-wrap";
        const image = document.createElement("img");
        const fallbackImage = resolveAssetPath(getDefaultImageForModel(product.model));
        image.src = resolveAssetPath(product.imageUrl || fallbackImage);
        image.alt = product.model || "E-Bike";
        image.onerror = function () {
            if (image.src !== fallbackImage) {
                image.src = fallbackImage;
            }
        };
        imageWrap.appendChild(image);
        card.appendChild(imageWrap);

        const body = document.createElement("div");
        body.className = "card-body";

        const title = document.createElement("h3");
        title.className = "prod-name";
        title.textContent = product.model || "E-Bike";
        body.appendChild(title);

        const info = document.createElement("p");
        info.className = "prod-info";
        info.textContent = product.info || product.category || "E-Bike";
        body.appendChild(info);

        const price = document.createElement("p");
        price.className = "price";
        price.textContent = formatPriceLabel(product.price);
        body.appendChild(price);

        const button = document.createElement("button");
        button.className = "btn";
        button.type = "button";
        button.textContent = "Book Now";
        button.addEventListener("click", function () {
            persistCheckoutSelection(product);
            window.location.href = getProductActionUrl(product);
        });
        body.appendChild(button);

        card.appendChild(body);
        return card;
    }

    function createSuggestedCard(product) {
        const card = document.createElement("article");
        card.className = "suggested-card";

        const badge = document.createElement("span");
        badge.className = "suggested-badge";
        badge.textContent = product.suggestedBadge || "Suggested";
        card.appendChild(badge);

        const image = document.createElement("img");
        image.src = resolveAssetPath(product.imageUrl || getDefaultImageForModel(product.model));
        image.alt = product.model || "E-Bike";
        card.appendChild(image);

        const title = document.createElement("h3");
        title.className = "suggested-title";
        title.textContent = product.model || "E-Bike";
        card.appendChild(title);

        const meta = document.createElement("div");
        meta.className = "suggested-meta";
        const price = document.createElement("span");
        price.textContent = formatPeso(product.price);
        const category = document.createElement("span");
        category.textContent = product.category || "E-Bike";
        meta.appendChild(price);
        meta.appendChild(category);
        card.appendChild(meta);

        const action = document.createElement("button");
        action.className = "suggested-action";
        action.type = "button";
        action.textContent = "View";
        action.addEventListener("click", function () {
            window.location.href = getProductActionUrl(product);
        });
        card.appendChild(action);

        return card;
    }

    function renderSuggestedSection(catalog) {
        const grid = document.getElementById("suggested-grid");
        if (!grid) {
            return;
        }
        const counts = getBookingCountsMap();
        const ranked = getBookedRanking(catalog, counts);
        let picks = ranked.slice(0, 4).map(function (entry, index) {
            const badge = index < 2 ? "Best Seller" : "Recommended";
            return Object.assign({}, entry.product, {
                suggestedBadge: badge
            });
        });
        if (!picks.length) {
            picks = pickSuggestedProducts(catalog, SUGGESTED_CONFIG);
        }
        grid.innerHTML = "";
        if (!picks.length) {
            return;
        }
        const fragment = document.createDocumentFragment();
        picks.forEach(function (product) {
            fragment.appendChild(createSuggestedCard(product));
        });
        grid.appendChild(fragment);
    }

    function detectCategoryFromPage() {
        const fileName = String(window.location.pathname.split("/").pop() || "").toLowerCase();
        if (fileName.includes("2wheel")) {
            return "2-Wheel";
        }
        if (fileName.includes("3wheel")) {
            return "3-Wheel";
        }
        if (fileName.includes("4wheel")) {
            return "4-Wheel";
        }
        return "";
    }

    function getFilterState() {
        const searchInput = document.getElementById("catalog-search");
        const wheelSelect = document.getElementById("catalog-wheel");
        const priceSelect = document.getElementById("catalog-price");

        const query = normalizeText(searchInput && searchInput.value).toLowerCase();
        const wheel = wheelSelect ? normalizeText(wheelSelect.value) : "";
        const pricePreset = priceSelect ? normalizeText(priceSelect.value) : "";

        return {
            query: query,
            wheel: wheel,
            pricePreset: pricePreset
        };
    }

    function renderProducts(container, catalog, categoryFilter, filterState) {
        if (!container) {
            return;
        }

        const filters = filterState && typeof filterState === "object" ? filterState : {};
        const normalizedCategory = parseWheelCategory(categoryFilter);
        const wheelFilter = parseWheelCategory(filters.wheel);
        const activeCategory = wheelFilter || normalizedCategory;
        const shouldFilterCategory = Boolean(activeCategory);
        const query = normalizeText(filters.query).toLowerCase();
        const pricePreset = normalizeText(filters.pricePreset).toLowerCase();

        const scoped = catalog
            .filter(function (item) {
                return isCatalogProductAvailable(item);
            })
            .filter(function (item) {
                if (!shouldFilterCategory) {
                    return true;
                }
                return item.category === activeCategory;
            })
            .filter(function (item) {
                if (!query) {
                    return true;
                }
                const haystack = normalizeKey([item.model, item.category, item.info].filter(Boolean).join(" "));
                const needle = normalizeKey(query);
                return needle ? haystack.includes(needle) : true;
            });

        const priced = applyPricePreset(scoped, pricePreset);
        const finalList = priced;

        container.innerHTML = "";

        if (!finalList.length) {
            const emptyCard = document.createElement("article");
            emptyCard.className = "card";
            emptyCard.innerHTML = "<div class=\"card-body\"><h3 class=\"prod-name\">No models available</h3><p class=\"price\">Try adjusting the filters.</p></div>";
            container.appendChild(emptyCard);
            return;
        }

        const fragment = document.createDocumentFragment();
        finalList.forEach(function (product) {
            fragment.appendChild(createCard(product));
        });
        container.appendChild(fragment);
    }

    async function renderPageProducts(options) {
        const opts = options && typeof options === "object" ? options : {};
        const container = opts.container
            ? (typeof opts.container === "string" ? document.querySelector(opts.container) : opts.container)
            : document.querySelector("section.products");

        if (!container) {
            clearCatalogLoading();
            return [];
        }

        try {
            const catalog = await loadCatalog();
            await ensureBookingStatsLoaded();
            const categoryFilter = opts.category || detectCategoryFromPage();
            const filterState = getFilterState();
            renderProducts(container, catalog, categoryFilter, filterState);
            renderSuggestedSection(catalog);
            return catalog;
        } finally {
            clearCatalogLoading();
        }
    }

    function getCachedCatalog() {
        const local = readCatalogFromLocal();
        if (local.length) {
            return local;
        }
        return sanitizeCatalog(DEFAULT_PRODUCTS);
    }

    function clearCatalogLoading() {
        if (!IS_USERHOME_CATALOG_PAGE) {
            return;
        }
        ROOT.classList.remove("catalog-loading");
    }

    function setupCatalogFilters() {
        const searchInput = document.getElementById("catalog-search");
        const wheelSelect = document.getElementById("catalog-wheel");
        const priceSelect = document.getElementById("catalog-price");
        const clearBtn = document.getElementById("catalog-clear");
        if (!(searchInput || wheelSelect || priceSelect || clearBtn)) {
            return;
        }

        let debounceId = null;
        function scheduleRender() {
            if (debounceId) {
                clearTimeout(debounceId);
            }
            debounceId = setTimeout(function () {
                void renderPageProducts();
            }, 160);
        }

        if (searchInput) {
            searchInput.addEventListener("input", scheduleRender);
        }
        if (wheelSelect) {
            wheelSelect.addEventListener("change", scheduleRender);
        }
        if (priceSelect) {
            priceSelect.addEventListener("change", scheduleRender);
        }
        if (clearBtn) {
            clearBtn.addEventListener("click", function () {
                if (searchInput) searchInput.value = "";
                if (wheelSelect) wheelSelect.value = "";
                if (priceSelect) priceSelect.value = "";
                scheduleRender();
            });
        }
    }

    document.addEventListener("DOMContentLoaded", function () {
        if (!IS_USERHOME_CATALOG_PAGE) {
            return;
        }
        setupCatalogFilters();
        void renderPageProducts();
    });

    window.addEventListener("storage", function (event) {
        if (event.key !== STORAGE_KEY) {
            return;
        }
        if (!IS_USERHOME_CATALOG_PAGE) {
            return;
        }
        void renderPageProducts();
    });

    global.EcodriveCatalog = {
        loadCatalog: loadCatalog,
        renderPageProducts: renderPageProducts,
        getCachedCatalog: getCachedCatalog,
        getBookingHighlights: getBookingHighlights,
        ensureBookingStatsLoaded: ensureBookingStatsLoaded
    };
})(window);

