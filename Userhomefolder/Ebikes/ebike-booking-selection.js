(function () {
    function normalizeBranchStorageKey(value) {
        return String(value || "")
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
    }

    const branchCity = window.EcodriveSession && typeof window.EcodriveSession.getCurrentUser === "function"
        ? window.EcodriveSession.getCurrentUser().branchCity
        : "";
    const branchKey = normalizeBranchStorageKey(branchCity);
    const PRODUCT_STORAGE_KEY = branchKey ? `ecodrive_product_catalog:${branchKey}` : "ecodrive_product_catalog";
    const COLOR_VARIANT_STORAGE_KEY = branchKey ? `ecodrive_color_variant_availability_v1:${branchKey}` : "ecodrive_color_variant_availability_v1";
    const MODEL_SPEC_STORAGE_KEY = "ecodrive_model_spec_catalog_v1";
    const SPEC_FIELDS = [
        { key: "power", label: "Power" },
        { key: "battery", label: "Battery" },
        { key: "batteryType", label: "Battery Type" },
        { key: "speed", label: "Speed" },
        { key: "range", label: "Range" },
        { key: "chargingTime", label: "Charging time" }
    ];
    const API_BASE = String(
        localStorage.getItem("ecodrive_api_base")
        || localStorage.getItem("ecodrive_kyc_api_base")
        || (window.EcodriveSession && typeof window.EcodriveSession.getApiBase === "function"
            ? window.EcodriveSession.getApiBase()
            : "")
    )
        .trim()
        .replace(/\/+$/, "");

    function safeParse(raw) {
        try {
            return JSON.parse(raw);
        } catch (_error) {
            return null;
        }
    }

    function normalizeText(value) {
        return String(value || "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
    }

    function getApiUrl(path) {
        return API_BASE ? `${API_BASE}${path}` : path;
    }

    function parsePriceNumber(text) {
        if (!text) return 0;
        const match = String(text).match(/[\d,.]+/);
        if (!match) return 0;
        const value = Number(match[0].replace(/,/g, ""));
        return Number.isFinite(value) ? value : 0;
    }

    function formatPesoText(amount) {
        return "Price: "
            + String.fromCharCode(8369)
            + " "
            + Number(amount || 0).toLocaleString("en-PH", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
    }

    function readCatalogFromStorage() {
        const parsed = safeParse(localStorage.getItem(PRODUCT_STORAGE_KEY));
        return Array.isArray(parsed) ? parsed : [];
    }

    function saveCatalogToStorage(catalog) {
        localStorage.setItem(PRODUCT_STORAGE_KEY, JSON.stringify(catalog));
    }

    function normalizeModelKey(value) {
        return normalizeText(value);
    }

    function normalizeColorKey(value) {
        return normalizeText(value).replace(/\s+/g, "-");
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
                    label: formatColorLabel(source.label || source.name || source.color || source.key || ("Color " + String(index + 1))),
                    isActive: isActive,
                    stockCount: normalizeStockCount(
                        source.stockCount !== undefined ? source.stockCount : source.stock_count,
                        isActive ? 1 : 0
                    )
                };
            })
            .filter(Boolean);
    }

    function isColorVariantAvailable(variant) {
        return Boolean(variant) && variant.isActive !== false && normalizeStockCount(variant.stockCount, 0) > 0;
    }

    function isProductAvailable(productInput) {
        const product = productInput && typeof productInput === "object" ? productInput : {};
        const isActive = toIsActive(product.isActive !== undefined ? product.isActive : product.is_active);
        if (!isActive) {
            return false;
        }
        const stockCount = normalizeStockCount(
            product.stockCount !== undefined ? product.stockCount : product.stock_count,
            isActive ? 1 : 0
        );
        if (stockCount > 0) {
            return true;
        }
        return normalizeColorVariants(product.colorVariants || product.color_variants || product.color_variants_json)
            .some(function (variant) {
                return isColorVariantAvailable(variant);
            });
    }

    function readColorVariantState() {
        const parsed = safeParse(localStorage.getItem(COLOR_VARIANT_STORAGE_KEY));
        if (!parsed || typeof parsed !== "object") {
            return {};
        }
        return parsed;
    }

    function normalizeSpecValue(value) {
        return String(value || "")
            .replace(/\s+/g, " ")
            .trim();
    }

    function sanitizeSpecEntry(input) {
        const source = input && typeof input === "object" ? input : {};
        return {
            power: normalizeSpecValue(source.power),
            battery: normalizeSpecValue(source.battery),
            batteryType: normalizeSpecValue(source.batteryType || source.battery_type),
            speed: normalizeSpecValue(source.speed),
            range: normalizeSpecValue(source.range),
            chargingTime: normalizeSpecValue(source.chargingTime || source.charging_time)
        };
    }

    function readModelSpecState() {
        const parsed = safeParse(localStorage.getItem(MODEL_SPEC_STORAGE_KEY));
        if (!parsed || typeof parsed !== "object") {
            return {};
        }
        return parsed;
    }

    function normalizeSpecLabel(value) {
        return String(value || "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
    }

    function resolveSpecKeyByLabel(label) {
        const normalized = normalizeSpecLabel(label);
        if (!normalized) {
            return "";
        }
        if (normalized === "power") {
            return "power";
        }
        if (normalized === "battery") {
            return "battery";
        }
        if (normalized === "battery type") {
            return "batteryType";
        }
        if (normalized === "speed") {
            return "speed";
        }
        if (normalized === "range") {
            return "range";
        }
        if (normalized === "charging time" || normalized === "charging") {
            return "chargingTime";
        }
        return "";
    }

    function setSpecListItem(li, label, value) {
        if (!li) {
            return;
        }
        li.textContent = "";
        const strong = document.createElement("strong");
        strong.textContent = `${label}:`;
        li.appendChild(strong);
        li.appendChild(document.createTextNode(` ${value}`));
    }

    function buildSpecBindings() {
        const specList = document.querySelector(".spec-list");
        if (!specList) {
            return null;
        }

        const bindings = {};
        const rows = Array.from(specList.querySelectorAll("li"));
        rows.forEach(function (li) {
            const strong = li.querySelector("strong");
            if (!strong) {
                return;
            }
            const label = String(strong.textContent || "").replace(/\s*:\s*$/, "").trim();
            const key = resolveSpecKeyByLabel(label);
            if (!key || bindings[key]) {
                return;
            }
            bindings[key] = {
                li: li,
                label: label || key
            };
        });

        SPEC_FIELDS.forEach(function (field) {
            if (bindings[field.key]) {
                return;
            }
            const li = document.createElement("li");
            specList.appendChild(li);
            bindings[field.key] = {
                li: li,
                label: field.label
            };
        });

        return bindings;
    }

    function applyModelSpecs() {
        const modelName = getCurrentModelName();
        const modelKey = normalizeModelKey(modelName);
        if (!modelKey) {
            return;
        }

        const state = readModelSpecState();
        const rawEntry = state[modelKey];
        if (!rawEntry || typeof rawEntry !== "object") {
            return;
        }

        const entry = sanitizeSpecEntry(rawEntry);
        const hasAnyValue = SPEC_FIELDS.some(function (field) {
            return Boolean(entry[field.key]);
        });
        if (!hasAnyValue) {
            return;
        }

        const bindings = buildSpecBindings();
        if (!bindings) {
            return;
        }

        SPEC_FIELDS.forEach(function (field) {
            const value = entry[field.key];
            if (!value) {
                return;
            }
            const binding = bindings[field.key];
            if (!binding || !binding.li) {
                return;
            }
            setSpecListItem(binding.li, binding.label || field.label, value);
        });
    }

    function getCurrentModelName() {
        const modelEl = document.querySelector(".model-title");
        if (!modelEl) {
            return "";
        }
        return String(modelEl.textContent || "").replace(/^MODEL:\s*/i, "").trim();
    }

    function getDotClassColorToken(dot) {
        const tokens = String(dot && dot.className || "")
            .split(/\s+/)
            .map(function (token) {
                return token.trim();
            })
            .filter(Boolean);

        for (let i = 0; i < tokens.length; i += 1) {
            const token = tokens[i].toLowerCase();
            if (token !== "dot" && token !== "active") {
                return tokens[i];
            }
        }
        return "";
    }

    function getDotColorKey(dot, index) {
        const dataColor = String(dot && dot.getAttribute("data-color") || "").trim();
        const ariaLabel = String(dot && dot.getAttribute("aria-label") || "").replace(/\bcolor\b/ig, "").trim();
        const classToken = getDotClassColorToken(dot);
        const fallback = "Color " + String(Number(index) + 1);
        return normalizeColorKey(dataColor || ariaLabel || classToken || fallback);
    }

    function formatColorLabel(value) {
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

    function getDotColorLabel(dot, index) {
        const dataColor = String(dot && dot.getAttribute("data-color") || "").trim();
        const ariaLabel = String(dot && dot.getAttribute("aria-label") || "").replace(/\bcolor\b/ig, "").trim();
        const classToken = getDotClassColorToken(dot);
        const fallback = "Color " + String(Number(index) + 1);
        return formatColorLabel(dataColor || ariaLabel || classToken || fallback);
    }

    function setBookingAvailability(isAvailable) {
        const bookBtn = document.querySelector(".check-btn");
        const addToCartBtn = document.querySelector(".add-to-cart-btn-inline");
        if (!bookBtn) {
            return;
        }

        const allow = Boolean(isAvailable);
        const originalText = String(bookBtn.getAttribute("data-original-text") || bookBtn.textContent || "Book Now").trim() || "Book Now";
        bookBtn.setAttribute("data-original-text", originalText);

        bookBtn.disabled = !allow;
        bookBtn.style.opacity = allow ? "" : "0.65";
        bookBtn.style.pointerEvents = allow ? "" : "none";
        bookBtn.textContent = allow ? originalText : "Unavailable";

        if (addToCartBtn) {
            addToCartBtn.disabled = !allow;
            addToCartBtn.style.opacity = allow ? "" : "0.65";
            addToCartBtn.style.pointerEvents = allow ? "" : "none";
        }
    }

    function setColorAvailabilityMessage(message) {
        const colorPicker = document.querySelector(".color-picker");
        const priceRow = document.querySelector(".price-row");
        const host = colorPicker || priceRow;
        if (!host) {
            return;
        }

        const noteId = "color-availability-note";
        let note = document.getElementById(noteId);
        if (!message) {
            if (note) {
                note.remove();
            }
            return;
        }

        if (!note) {
            note = document.createElement("p");
            note.id = noteId;
            note.style.marginTop = "8px";
            note.style.fontSize = "13px";
            note.style.fontWeight = "600";
            note.style.color = "#9b1c1c";
            host.appendChild(note);
        }
        note.textContent = message;
    }

    async function applyColorAvailability() {
        const modelName = getCurrentModelName();
        const modelKey = normalizeModelKey(modelName);
        if (!modelKey) {
            return;
        }

        const product = await resolveProduct(modelName);
        const productAvailable = isProductAvailable(product);
        const productVariants = normalizeColorVariants(
            product && (product.colorVariants || product.color_variants || product.color_variants_json)
        );
        const state = readColorVariantState();
        const localVariants = Array.isArray(state[modelKey]) ? normalizeColorVariants(state[modelKey]) : [];
        const variants = productVariants.length ? productVariants : localVariants;
        if (!variants.length) {
            setBookingAvailability(productAvailable);
            setColorAvailabilityMessage(productAvailable ? "" : "This model is currently out of stock.");
            return;
        }

        const availability = {};
        variants.forEach(function (variant, index) {
            const key = normalizeColorKey(variant && (variant.key || variant.label || variant.name) || ("Color " + String(index + 1)));
            if (!key) {
                return;
            }
            availability[key] = isColorVariantAvailable(variant);
        });

        const dots = Array.from(document.querySelectorAll(".dot"));
        if (!dots.length) {
            return;
        }

        let visibleCount = 0;
        dots.forEach(function (dot, index) {
            const colorKey = getDotColorKey(dot, index);
            const isAllowed = Object.prototype.hasOwnProperty.call(availability, colorKey) ? availability[colorKey] : true;
            dot.disabled = !isAllowed;
            dot.style.display = isAllowed ? "" : "none";
            dot.setAttribute("aria-hidden", String(!isAllowed));
            if (isAllowed) {
                visibleCount += 1;
            } else {
                dot.classList.remove("active");
            }
        });

        if (visibleCount > 0) {
            const activeDot = document.querySelector(".dot.active:not([style*='display: none'])");
            if (!activeDot) {
                const firstVisible = dots.find(function (dot) {
                    return dot.style.display !== "none" && !dot.disabled;
                });
                if (firstVisible) {
                    firstVisible.click();
                }
            }
            setBookingAvailability(true);
            setColorAvailabilityMessage("");
            return;
        }

        setBookingAvailability(false);
        setColorAvailabilityMessage(productAvailable ? "This model currently has no available color." : "This model is currently out of stock.");
    }

    async function fetchCatalogFromApi() {
        try {
            const response = await fetch(getApiUrl("/api/products"), {
                method: "GET"
            });

            if (!response.ok) {
                return [];
            }

            const payload = await response.json().catch(function () {
                return {};
            });
            if (!payload || payload.success !== true || !Array.isArray(payload.products)) {
                return [];
            }

            saveCatalogToStorage(payload.products);
            return payload.products;
        } catch (_error) {
            return [];
        }
    }

    function findProductByModel(catalog, model) {
        const target = normalizeText(model);
        if (!target) {
            return null;
        }

        const list = Array.isArray(catalog) ? catalog : [];
        let partialMatch = null;

        for (let i = 0; i < list.length; i += 1) {
            const item = list[i];
            if (!item || typeof item !== "object") {
                continue;
            }
            const modelText = normalizeText(item.model);
            if (!modelText) {
                continue;
            }
            if (modelText === target) {
                return item;
            }
            if (!partialMatch && (modelText.includes(target) || target.includes(modelText))) {
                partialMatch = item;
            }
        }

        return partialMatch;
    }

    async function resolveProduct(model) {
        const localMatch = findProductByModel(readCatalogFromStorage(), model);
        if (localMatch) {
            return localMatch;
        }

        const apiCatalog = await fetchCatalogFromApi();
        return findProductByModel(apiCatalog, model);
    }

    function getSubtitleByBikeId() {
        const match = window.location.pathname.match(/ebike(\d+)\.0\.html/i);
        const bikeId = match ? Number(match[1]) : 0;
        if (bikeId >= 1 && bikeId <= 5) return "2-Wheel";
        if (bikeId === 6) return "4-Wheel";
        if (bikeId >= 7 && bikeId <= 16) return "3-Wheel";
        return "E-Bike";
    }

    function ensureBikeLayoutStyles() {
        const styleId = "ecodrive-bike-layout-style";
        if (document.getElementById(styleId)) {
            return;
        }

        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = `
.left-card{
    display:flex !important;
    flex-direction:column !important;
    align-items:center !important;
    padding-top:52px !important;
}
.bike-image-stage{
    width:min(420px,100%) !important;
    height:clamp(240px,32vw,320px) !important;
    display:flex !important;
    align-items:flex-end !important;
    justify-content:center !important;
    margin-top:0 !important;
    padding-bottom:8px !important;
    box-sizing:border-box !important;
}
.bike-img{
    width:100% !important;
    height:100% !important;
    max-width:420px !important;
    max-height:320px !important;
    display:block !important;
    object-fit:contain !important;
    object-position:center bottom !important;
    margin:0 auto !important;
    border:2px solid #3652a2 !important;
    border-radius:14px !important;
    background:#ffffff !important;
    padding:6px !important;
    box-sizing:border-box !important;
}
.left-card .color-picker{
    width:min(300px,100%) !important;
    margin:6px auto 0 !important;
    align-self:center !important;
}
@media (max-width: 768px){
    .left-card{
        padding-top:16px !important;
    }
    .bike-image-stage{
        height:clamp(210px,62vw,300px) !important;
        margin-top:0 !important;
    }
}
`;
        document.head.appendChild(style);
    }

    function ensureBikeImageStage(leftCard, bikeImage) {
        if (!leftCard || !bikeImage) {
            return null;
        }

        let stage = leftCard.querySelector(".bike-image-stage");
        const colorPicker = leftCard.querySelector(".color-picker");

        if (!stage) {
            stage = document.createElement("div");
            stage.className = "bike-image-stage";
            if (colorPicker) {
                leftCard.insertBefore(stage, colorPicker);
            } else {
                leftCard.insertBefore(stage, bikeImage.nextSibling);
            }
        }

        if (bikeImage.parentElement !== stage) {
            stage.appendChild(bikeImage);
        }

        return stage;
    }

    function applyBikeImageBorder() {
        const bikeImage = document.getElementById("bike-image");
        if (!bikeImage) {
            return;
        }
        ensureBikeLayoutStyles();
        const leftCard = bikeImage.closest(".left-card");
        ensureBikeImageStage(leftCard, bikeImage);
    }

    async function hydratePriceDisplay() {
        const modelEl = document.querySelector(".model-title");
        const priceEl = document.querySelector(".price");
        if (!modelEl || !priceEl) {
            return;
        }

        const model = String(modelEl.textContent || "").replace(/^MODEL:\s*/i, "").trim();
        if (!model) {
            return;
        }

        const product = await resolveProduct(model);
        const nextPrice = Number(product && product.price);
        if (!Number.isFinite(nextPrice) || nextPrice <= 0) {
            return;
        }

        priceEl.textContent = formatPesoText(nextPrice);
    }

    async function buildSelection() {
        const modelEl = document.querySelector(".model-title");
        const priceEl = document.querySelector(".price");
        const imageEl = document.getElementById("bike-image");
        const dots = Array.from(document.querySelectorAll(".dot"));
        const activeDot = document.querySelector(".dot.active");
        const activeDotIndex = activeDot ? dots.indexOf(activeDot) : -1;
        const selectedColor = activeDot
            ? getDotColorLabel(activeDot, activeDotIndex >= 0 ? activeDotIndex : 0)
            : "";

        const modelText = modelEl ? modelEl.textContent : "";
        const model = modelText.replace(/^MODEL:\s*/i, "").trim() || "Ecodrive E-Bike";
        const displayedPrice = parsePriceNumber(priceEl ? priceEl.textContent : "");
        const product = await resolveProduct(model);
        const latestPrice = Number(product && product.price);
        const total = Number.isFinite(latestPrice) && latestPrice > 0
            ? Number(latestPrice.toFixed(2))
            : displayedPrice;

        const selectedImage =
            (activeDot && activeDot.dataset && activeDot.dataset.image) ||
            (imageEl ? imageEl.getAttribute("src") : "") ||
            "../image 1.png";

        return {
            model: model,
            total: total,
            image: selectedImage,
            bikeImage: selectedImage,
            subtitle: String(product && product.category || getSubtitleByBikeId()),
            bikeColor: selectedColor,
            color: selectedColor,
            selectedColor: selectedColor
        };
    }

    async function persistSelection() {
        const selection = await buildSelection();
        localStorage.setItem("ecodrive_checkout_selection", JSON.stringify(selection));
        localStorage.setItem("ecodrive_selected_bike", JSON.stringify(selection));
        localStorage.setItem("selectedBike", JSON.stringify(selection));
    }

    async function buildCartItem() {
        const selection = await buildSelection();
        const product = await resolveProduct(selection.model);
        return {
            productId: Number(product && product.id || 0),
            model: selection.model,
            price: selection.total,
            imageUrl: selection.image,
            detailUrl: window.location.pathname + window.location.search,
            category: selection.subtitle,
            info: String(product && product.info || ""),
            selectedColor: selection.selectedColor,
            quantity: 1
        };
    }

    function ensureAddToCartButton() {
        const priceRow = document.querySelector(".price-row");
        const bookBtn = document.querySelector(".check-btn");
        if (!priceRow || !bookBtn) {
            return null;
        }

        let actionGroup = priceRow.querySelector(".bike-purchase-actions");
        if (!actionGroup) {
            actionGroup = document.createElement("div");
            actionGroup.className = "bike-purchase-actions";
            bookBtn.parentElement.insertBefore(actionGroup, bookBtn);
            actionGroup.appendChild(bookBtn);
        }

        let addToCartBtn = actionGroup.querySelector(".add-to-cart-btn-inline");
        if (!addToCartBtn) {
            addToCartBtn = document.createElement("button");
            addToCartBtn.type = "button";
            addToCartBtn.className = "add-to-cart-btn-inline";
            addToCartBtn.textContent = "Add to Cart";
            actionGroup.appendChild(addToCartBtn);
        }

        if (addToCartBtn.dataset.cartBound !== "1") {
            addToCartBtn.dataset.cartBound = "1";
            addToCartBtn.addEventListener("click", async function () {
                if (!window.EcodriveCart || typeof window.EcodriveCart.addItem !== "function") {
                    return;
                }
                const item = await buildCartItem();
                window.EcodriveCart.addItem(item);
            });
        }

        return addToCartBtn;
    }

    const REVIEW_STYLE_HREF = "ebike-reviews.css?v=20260313";
    const REVIEW_STORE_SRC = "../reviews-store.js?v=20260313g";

    function ensureReviewStyles() {
        if (document.querySelector("link[data-ebike-reviews]")) {
            return;
        }
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = REVIEW_STYLE_HREF;
        link.setAttribute("data-ebike-reviews", "1");
        document.head.appendChild(link);
    }

    function loadReviewsStore() {
        if (window.EcodriveReviews) {
            return Promise.resolve(window.EcodriveReviews);
        }
        return new Promise(function (resolve, reject) {
            const existing = document.querySelector("script[data-review-store]");
            if (existing) {
                if (window.EcodriveReviews) {
                    resolve(window.EcodriveReviews);
                    return;
                }
                existing.addEventListener("load", function () {
                    resolve(window.EcodriveReviews);
                }, { once: true });
                existing.addEventListener("error", function () {
                    reject(new Error("Unable to load review store."));
                }, { once: true });
                return;
            }
            const script = document.createElement("script");
            script.src = REVIEW_STORE_SRC;
            script.defer = true;
            script.setAttribute("data-review-store", "1");
            script.addEventListener("load", function () {
                resolve(window.EcodriveReviews);
            }, { once: true });
            script.addEventListener("error", function () {
                reject(new Error("Unable to load review store."));
            }, { once: true });
            document.head.appendChild(script);
        });
    }

    function resolveModelName() {
        const titleEl = document.querySelector(".model-title");
        if (!titleEl) {
            return "";
        }
        return String(titleEl.textContent || "")
            .replace(/model\s*:/i, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    function ensureReviewSection() {
        const existing = document.querySelector(".reviews-section");
        if (existing) {
            return existing;
        }
        const main = document.querySelector("main");
        if (!main) {
            return null;
        }
        const section = document.createElement("section");
        section.className = "reviews-section";
        section.id = "reviews";
        section.innerHTML = `
            <div class="reviews-header">
                <div class="rating-summary">
                    <div class="rating-score">
                        <span class="score" data-review-average>0.0</span>
                        <span class="out-of">out of 5</span>
                    </div>
                    <div class="rating-stars" data-review-average-stars>☆☆☆☆☆</div>
                    <div class="rating-count">Based on <span data-review-count>0</span> reviews</div>
                </div>
                <div class="rating-filters">
                    <button class="filter-btn active" type="button" data-filter="all">All (0)</button>
                    <button class="filter-btn" type="button" data-filter="5">5 Star (0)</button>
                    <button class="filter-btn" type="button" data-filter="4">4 Star (0)</button>
                    <button class="filter-btn" type="button" data-filter="3">3 Star (0)</button>
                    <button class="filter-btn" type="button" data-filter="2">2 Star (0)</button>
                    <button class="filter-btn" type="button" data-filter="1">1 Star (0)</button>
                </div>
            </div>
            <div class="review-form-card review-lock">
                <h3>Rate &amp; Review</h3>
                <p class="review-lock-note">
                    Reviews are available after your booking is delivered.
                    Go to the Bookings page to submit your rating and photos.
                </p>
            </div>
            <div class="review-list" data-review-list></div>
        `;
        main.insertAdjacentElement("afterend", section);
        return section;
    }

    function initReviewSection() {
        if (!window.EcodriveReviews) {
            return;
        }
        ensureReviewStyles();
        const section = ensureReviewSection();
        if (!section) {
            return;
        }

        const productName = resolveModelName();
        const fallbackKey = window.location.pathname.split("/").pop() || "";
        const productId = window.EcodriveReviews.slugify(productName || fallbackKey);

        const averageEl = section.querySelector("[data-review-average]");
        const averageStarsEl = section.querySelector("[data-review-average-stars]");
        const countEl = section.querySelector("[data-review-count]");
        const listEl = section.querySelector("[data-review-list]");
        const filterButtons = Array.from(section.querySelectorAll(".filter-btn"));
        let activeFilter = "all";
        let currentReviews = [];

        function renderStars(rating) {
            const full = "★".repeat(rating);
            const empty = "☆".repeat(5 - rating);
            return `${full}${empty}`;
        }

        function refreshSummary(reviews) {
            const count = reviews.length;
            const total = reviews.reduce(function (sum, review) {
                return sum + Number(review.rating || 0);
            }, 0);
            const average = count ? total / count : 0;
            if (averageEl) averageEl.textContent = average.toFixed(1);
            if (averageStarsEl) averageStarsEl.textContent = renderStars(Math.round(average || 0));
            if (countEl) countEl.textContent = String(count);

            const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
            reviews.forEach(function (review) {
                const rating = Number(review.rating || 0);
                if (counts[rating] !== undefined) {
                    counts[rating] += 1;
                }
            });
            filterButtons.forEach(function (button) {
                const filter = button.dataset.filter;
                if (filter === "all") {
                    button.textContent = `All (${count})`;
                } else {
                    const stars = Number(filter);
                    button.textContent = `${stars} Star (${counts[stars] || 0})`;
                }
            });
        }

        function buildReviewCard(review) {
            const card = document.createElement("div");
            card.className = "review-card";

            const avatar = document.createElement("div");
            avatar.className = "reviewer-avatar";
            avatar.textContent = review.name ? review.name.charAt(0).toUpperCase() : "U";

            const body = document.createElement("div");

            const head = document.createElement("div");
            head.className = "review-head";

            const nameWrap = document.createElement("div");
            const nameEl = document.createElement("div");
            nameEl.className = "review-name";
            nameEl.textContent = review.name || "Anonymous";
            const starsEl = document.createElement("div");
            starsEl.className = "review-stars";
            starsEl.textContent = renderStars(Number(review.rating || 0));
            nameWrap.appendChild(nameEl);
            nameWrap.appendChild(starsEl);

            const dateEl = document.createElement("div");
            dateEl.className = "review-date";
            dateEl.textContent = review.displayDate || "";

            head.appendChild(nameWrap);
            head.appendChild(dateEl);

            const textEl = document.createElement("p");
            textEl.className = "review-text";
            textEl.textContent = review.text || "";

            body.appendChild(head);
            body.appendChild(textEl);

            if (Array.isArray(review.images) && review.images.length > 0) {
                const media = document.createElement("div");
                media.className = "review-media";
                review.images.forEach(function (img) {
                    if (!img || !img.src) return;
                    const imageEl = document.createElement("img");
                    imageEl.src = img.src;
                    imageEl.alt = "Review image";
                    media.appendChild(imageEl);
                });
                body.appendChild(media);
            }

            card.appendChild(avatar);
            card.appendChild(body);
            return card;
        }

        function renderList(reviews) {
            if (!listEl) {
                return;
            }
            listEl.innerHTML = "";
            if (!reviews.length) {
                const empty = document.createElement("div");
                empty.className = "review-empty";
                empty.textContent = "No reviews yet. Be the first to share your experience.";
                listEl.appendChild(empty);
                return;
            }

            reviews.forEach(function (review) {
                listEl.appendChild(buildReviewCard(review));
            });
        }

        function applyFilter(reviews) {
            if (activeFilter === "all") {
                return reviews;
            }
            const target = Number(activeFilter);
            return reviews.filter(function (review) {
                return Number(review.rating || 0) === target;
            });
        }

        function refreshReviews() {
            return window.EcodriveReviews.fetchReviews(productId)
                .then(function (reviews) {
                    currentReviews = Array.isArray(reviews) ? reviews : [];
                    refreshSummary(currentReviews);
                    renderList(applyFilter(currentReviews));
                })
                .catch(function () {
                    currentReviews = window.EcodriveReviews.getCachedReviews(productId);
                    refreshSummary(currentReviews);
                    renderList(applyFilter(currentReviews));
                });
        }

        filterButtons.forEach(function (button) {
            button.addEventListener("click", function () {
                filterButtons.forEach(function (btn) {
                    btn.classList.remove("active");
                });
                button.classList.add("active");
                activeFilter = button.dataset.filter || "all";
                renderList(applyFilter(currentReviews));
            });
        });

        void refreshReviews();
    }

    document.addEventListener(
        "click",
        async function (event) {
            const button = event.target.closest(".check-btn");
            if (!button) return;

            event.preventDefault();
            event.stopImmediatePropagation();

            await persistSelection();

            const target = button.getAttribute("data-booking-url") || "../payment/booking.html";
            window.location.href = target;
        },
        true
    );

    void hydratePriceDisplay();
    applyBikeImageBorder();
    ensureAddToCartButton();
    void applyColorAvailability();
    loadReviewsStore()
        .then(function () {
            initReviewSection();
        })
        .catch(function () {});

    window.addEventListener("storage", function (event) {
        if (event.key === COLOR_VARIANT_STORAGE_KEY) {
            void applyColorAvailability();
        }
    });
})();

