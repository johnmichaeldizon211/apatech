(function (global) {
    "use strict";

    const STORAGE_KEY = "ecodrive_product_catalog";
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
        { id: 6, model: "TRAVELLER 1500", price: 78000, category: "2-Wheel", imageUrl: "/Userhomefolder/image 6.png", detailUrl: "/Userhomefolder/Ebikes/ebike6.0.html", isActive: true },
        { id: 7, model: "ECONO 500 MP", price: 51000, category: "2-Wheel", imageUrl: "/Userhomefolder/image 7.png", detailUrl: "/Userhomefolder/Ebikes/ebike7.0.html", isActive: true },
        { id: 8, model: "ECONO 350 MINI-II", price: 39000, category: "2-Wheel", imageUrl: "/Userhomefolder/image 8.png", detailUrl: "/Userhomefolder/Ebikes/ebike8.0.html", isActive: true },
        { id: 9, model: "ECARGO 100", price: 72500, category: "3-Wheel", imageUrl: "/Userhomefolder/image 9.png", detailUrl: "/Userhomefolder/Ebikes/ebike9.0.html", isActive: true },
        { id: 10, model: "ECONO 650 MP", price: 65000, category: "3-Wheel", imageUrl: "/Userhomefolder/image 10.png", detailUrl: "/Userhomefolder/Ebikes/ebike10.0.html", isActive: true },
        { id: 11, model: "ECAB 100V V2", price: 51500, category: "3-Wheel", imageUrl: "/Userhomefolder/image 11.png", detailUrl: "/Userhomefolder/Ebikes/ebike11.0.html", isActive: true },
        { id: 12, model: "ECONO 800 MP II", price: 67000, category: "3-Wheel", imageUrl: "/Userhomefolder/image 12.png", detailUrl: "/Userhomefolder/Ebikes/ebike12.0.html", isActive: true },
        { id: 13, model: "E-CARGO 800", price: 65000, category: "4-Wheel", imageUrl: "/Userhomefolder/image 13.png", detailUrl: "/Userhomefolder/Ebikes/ebike13.0.html", isActive: true },
        { id: 14, model: "E-CAB MAX 1500", price: 130000, category: "4-Wheel", imageUrl: "/Userhomefolder/image 14.png", detailUrl: "/Userhomefolder/Ebikes/ebike14.0.html", isActive: true },
        { id: 15, model: "E-CAB 1000", price: 75000, category: "4-Wheel", imageUrl: "/Userhomefolder/image 15.png", detailUrl: "/Userhomefolder/Ebikes/ebike15.0.html", isActive: true },
        { id: 16, model: "ECONO 800 MP", price: 60000, category: "4-Wheel", imageUrl: "/Userhomefolder/image 16.png", detailUrl: "/Userhomefolder/Ebikes/ebike16.0.html", isActive: true }
    ];
    const DEFAULT_IMAGE_BY_MODEL = DEFAULT_PRODUCTS.reduce(function (map, item) {
        const key = String(item && item.model || "").trim().toLowerCase();
        if (key && item && item.imageUrl) {
            map[key] = String(item.imageUrl);
        }
        return map;
    }, {});

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
        if (bikeId === 8) {
            return "2-Wheel";
        }
        if (bikeId >= 7 && bikeId <= 16) {
            return "3-Wheel";
        }
        return "";
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

    function parsePrice(value) {
        const parsed = Number(String(value || "").replace(/[^0-9.]/g, ""));
        if (!Number.isFinite(parsed) || parsed < 0) {
            return 0;
        }
        return Number(parsed.toFixed(2));
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
            isActive: toIsActive(source.isActive)
        };
    }

    function getCategoryOrder(category) {
        if (category === "2-Wheel") return 1;
        if (category === "3-Wheel") return 2;
        if (category === "4-Wheel") return 3;
        return 4;
    }

    function sanitizeCatalog(input) {
        const rows = Array.isArray(input) ? input : [];
        return rows
            .map(function (item, index) {
                return normalizeProduct(item, index + 1);
            })
            .filter(Boolean)
            .sort(function (left, right) {
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

    function buildBookingUrl(product) {
        const params = new URLSearchParams();
        params.set("model", product.model || "Ecodrive E-Bike");
        params.set("price", String(Number(product.price || 0)));
        params.set("image", resolveAssetPath(product.imageUrl || getDefaultImageForModel(product.model)));
        params.set("subtitle", product.category || "E-Bike");
        params.set("info", product.info || "");
        return resolveAssetPath("/Userhomefolder/payment/booking.html") + "?" + params.toString();
    }

    function getProductActionUrl(product) {
        const detailUrl = String(product.detailUrl || "").trim();
        if (detailUrl) {
            return resolveAssetPath(detailUrl);
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
            window.location.href = getProductActionUrl(product);
        });
        body.appendChild(button);

        card.appendChild(body);
        return card;
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

    function renderProducts(container, catalog, categoryFilter) {
        if (!container) {
            return;
        }

        const normalizedCategory = parseWheelCategory(categoryFilter);
        const shouldFilter = Boolean(normalizedCategory);
        const scoped = catalog
            .filter(function (item) {
                return item.isActive !== false;
            })
            .filter(function (item) {
                if (!shouldFilter) {
                    return true;
                }
                return item.category === normalizedCategory;
            });

        container.innerHTML = "";

        if (!scoped.length) {
            const emptyCard = document.createElement("article");
            emptyCard.className = "card";
            emptyCard.innerHTML = "<div class=\"card-body\"><h3 class=\"prod-name\">No models available</h3><p class=\"price\">Please check again later.</p></div>";
            container.appendChild(emptyCard);
            return;
        }

        const fragment = document.createDocumentFragment();
        scoped.forEach(function (product) {
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
            const categoryFilter = opts.category || detectCategoryFromPage();
            renderProducts(container, catalog, categoryFilter);
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

    document.addEventListener("DOMContentLoaded", function () {
        if (!IS_USERHOME_CATALOG_PAGE) {
            return;
        }
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
        getCachedCatalog: getCachedCatalog
    };
})(window);

