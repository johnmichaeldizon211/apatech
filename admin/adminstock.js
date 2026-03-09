document.addEventListener("DOMContentLoaded", function () {
    const storageKey = "ecodrive_product_catalog";
    const colorStorageKey = "ecodrive_color_variant_availability_v1";
    const specStorageKey = "ecodrive_model_spec_catalog_v1";
    const inventoryStorageKey = "ecodrive_product_inventory_v1";
    const apiBase = String(
        (window.EcodriveSession && typeof window.EcodriveSession.getApiBase === "function"
            ? window.EcodriveSession.getApiBase()
            : localStorage.getItem("ecodrive_api_base")
                || localStorage.getItem("ecodrive_kyc_api_base")
                || "")
    )
        .trim()
        .replace(/\/+$/, "");

    if (!window.EcodriveSession || typeof window.EcodriveSession.requireRole !== "function" || !window.EcodriveSession.requireRole("admin")) {
        return;
    }

    const stockGridEl = document.getElementById("stock-grid");
    const statusEl = document.getElementById("stock-status");
    const statTotalModelsEl = document.getElementById("stock-total-models");
    const statAvailableEl = document.getElementById("stock-total-available");
    const statUnavailableEl = document.getElementById("stock-total-unavailable");
    const statNewThisMonthEl = document.getElementById("stock-new-this-month");
    const openAddBtn = document.getElementById("open-add-model");
    const addFormPanel = document.getElementById("stock-add-form-panel");
    const addFormTitleEl = document.getElementById("stock-form-title");
    const addForm = document.getElementById("stock-add-form");
    const modelInput = document.getElementById("stock-model-input");
    const categoryInput = document.getElementById("stock-category-input");
    const priceInput = document.getElementById("stock-price-input");
    const infoInput = document.getElementById("stock-info-input");
    const specPowerInput = document.getElementById("stock-spec-power-input");
    const specBatteryInput = document.getElementById("stock-spec-battery-input");
    const specBatteryTypeInput = document.getElementById("stock-spec-battery-type-input");
    const specSpeedInput = document.getElementById("stock-spec-speed-input");
    const specRangeInput = document.getElementById("stock-spec-range-input");
    const specChargingTimeInput = document.getElementById("stock-spec-charging-time-input");
    const imageFileInput = document.getElementById("stock-image-file-input");
    const imageInput = document.getElementById("stock-image-input");
    const detailInput = document.getElementById("stock-detail-input");
    const colorCountInput = document.getElementById("stock-color-count-input");
    const colorInputListEl = document.getElementById("stock-color-input-list");
    const colorEditNoteEl = document.getElementById("stock-color-edit-note");
    const saveBtn = document.getElementById("stock-save-btn");
    const cancelBtn = document.getElementById("stock-cancel-btn");
    const addStatusEl = document.getElementById("stock-add-status");
    const colorModelSelectEl = document.getElementById("stock-color-model-select");
    const colorStatusEl = document.getElementById("stock-color-status");
    const colorListEl = document.getElementById("stock-color-list");

    if (
        !stockGridEl ||
        !statusEl ||
        !statTotalModelsEl ||
        !statAvailableEl ||
        !statUnavailableEl ||
        !statNewThisMonthEl ||
        !openAddBtn ||
        !addFormPanel ||
        !addFormTitleEl ||
        !addForm ||
        !modelInput ||
        !categoryInput ||
        !priceInput ||
        !infoInput ||
        !specPowerInput ||
        !specBatteryInput ||
        !specBatteryTypeInput ||
        !specSpeedInput ||
        !specRangeInput ||
        !specChargingTimeInput ||
        !imageFileInput ||
        !imageInput ||
        !detailInput ||
        !colorCountInput ||
        !colorInputListEl ||
        !colorEditNoteEl ||
        !saveBtn ||
        !cancelBtn ||
        !addStatusEl ||
        !colorModelSelectEl ||
        !colorStatusEl ||
        !colorListEl
    ) {
        return;
    }

    let products = [];
    let apiAvailable = false;
    let colorVariantsByModel = {};
    let modelSpecsByModel = {};
    let productInventoryByKey = {};
    let editingProductId = null;
    const minAddColorCount = 1;
    const maxAddColorCount = 12;
    const modelSpecFieldDefs = [
        { key: "power", label: "Power" },
        { key: "battery", label: "Battery" },
        { key: "batteryType", label: "Battery Type" },
        { key: "speed", label: "Speed" },
        { key: "range", label: "Range" },
        { key: "chargingTime", label: "Charging Time" }
    ];

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
        const numeric = Number(String(value || "").replace(/[^0-9.]/g, ""));
        if (!Number.isFinite(numeric) || numeric < 0) {
            return NaN;
        }
        return Number(numeric.toFixed(2));
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

    function formatPeso(value) {
        return String.fromCharCode(8369) + Number(value || 0).toLocaleString("en-PH", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function normalizeStockCount(value, fallbackValue) {
        const parsed = Number.parseInt(String(value === undefined || value === null ? "" : value).trim(), 10);
        if (Number.isFinite(parsed) && parsed >= 0) {
            return parsed;
        }
        const fallback = Number.parseInt(String(fallbackValue === undefined || fallbackValue === null ? "" : fallbackValue).trim(), 10);
        if (Number.isFinite(fallback) && fallback >= 0) {
            return fallback;
        }
        return 0;
    }

    function getDefaultProductStockCount(product) {
        return normalizeStockCount(
            product && (product.stockCount !== undefined ? product.stockCount : product.stock_count),
            toIsActive(product && product.isActive) ? 1 : 0
        );
    }

    function getProductInventoryKey(product) {
        const source = product && typeof product === "object" ? product : {};
        const id = Number(source.id);
        if (Number.isFinite(id) && id > 0) {
            return `id:${id}`;
        }
        const modelKey = normalizeModelKey(source.model);
        if (!modelKey) {
            return "";
        }
        return `model:${modelKey}|category:${normalizeCategory(source.category)}`;
    }

    function sanitizeProductInventoryMap(input) {
        const source = input && typeof input === "object" ? input : {};
        const output = {};

        Object.keys(source).forEach(function (key) {
            const normalizedKey = String(key || "").trim();
            if (!normalizedKey) {
                return;
            }
            output[normalizedKey] = normalizeStockCount(source[key], 0);
        });

        return output;
    }

    function readProductInventoryFromLocal() {
        return sanitizeProductInventoryMap(safeParse(localStorage.getItem(inventoryStorageKey)));
    }

    function saveProductInventoryToLocal(map) {
        localStorage.setItem(inventoryStorageKey, JSON.stringify(sanitizeProductInventoryMap(map)));
    }

    function ensureProductInventoryEntries(list, preferProductValues) {
        const rows = Array.isArray(list) ? list : [];
        const nextMap = Object.assign({}, sanitizeProductInventoryMap(productInventoryByKey));
        let changed = false;

        rows.forEach(function (product) {
            const key = getProductInventoryKey(product);
            if (!key) {
                return;
            }

            const productCount = getDefaultProductStockCount(product);
            if (preferProductValues) {
                if (nextMap[key] !== productCount) {
                    nextMap[key] = productCount;
                    changed = true;
                }
                return;
            }

            if (!Object.prototype.hasOwnProperty.call(nextMap, key)) {
                nextMap[key] = productCount;
                changed = true;
            }
        });

        productInventoryByKey = nextMap;
        if (changed) {
            saveProductInventoryToLocal(productInventoryByKey);
        }
    }

    function getProductStockCount(product) {
        const key = getProductInventoryKey(product);
        if (key && Object.prototype.hasOwnProperty.call(productInventoryByKey, key)) {
            return normalizeStockCount(productInventoryByKey[key], getDefaultProductStockCount(product));
        }
        return getDefaultProductStockCount(product);
    }

    function setProductStockCount(product, nextCount) {
        const key = getProductInventoryKey(product);
        if (!key) {
            return 0;
        }
        const stockCount = normalizeStockCount(nextCount, 0);
        productInventoryByKey = Object.assign({}, productInventoryByKey, {
            [key]: stockCount
        });
        saveProductInventoryToLocal(productInventoryByKey);
        return stockCount;
    }

    async function readImageFileAsDataUrl(file) {
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();
            reader.onload = function () {
                resolve(String(reader.result || ""));
            };
            reader.onerror = function () {
                reject(new Error("Unable to read selected image file."));
            };
            reader.readAsDataURL(file);
        });
    }

    function getApiUrl(path) {
        return apiBase ? `${apiBase}${path}` : path;
    }

    function getAppBasePath() {
        const pathname = String(window.location.pathname || "").replace(/\\/g, "/");
        const adminIndex = pathname.toLowerCase().lastIndexOf("/admin/");
        if (adminIndex > 0) {
            return pathname.slice(0, adminIndex);
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

        if (normalized.startsWith("./")) {
            return normalized.slice(2);
        }

        return normalized;
    }

    function getCategoryOrder(category) {
        if (category === "2-Wheel") return 1;
        if (category === "3-Wheel") return 2;
        if (category === "4-Wheel") return 3;
        return 4;
    }

    function normalizeProduct(input, fallbackId) {
        const source = input && typeof input === "object" ? input : {};
        const model = normalizeText(source.model || source.name).slice(0, 180);
        if (!model) {
            return null;
        }

        const rawId = Number(source.id);
        const id = Number.isFinite(rawId) && rawId > 0 ? rawId : Number(fallbackId || 0);
        const imageUrl = String(source.imageUrl || source.image || source.bikeImage || "").trim();
        const createdAt = String(source.createdAt || source.created_at || "").trim();
        const parsedPrice = parsePrice(source.price);
        const info = normalizeText(source.info || source.productInfo || source.description).slice(0, 255);
        const detailUrl = String(source.detailUrl || source.detailsUrl || source.detail_url || "").trim();
        const normalizedDetailUrl = resolveAssetPath(detailUrl);

        return {
            id: id,
            model: model,
            price: Number.isFinite(parsedPrice) ? parsedPrice : 0,
            category: resolveCategory(source.category, normalizedDetailUrl || detailUrl),
            info: info,
            imageUrl: resolveAssetPath(imageUrl || "/Userhomefolder/image 1.png"),
            detailUrl: normalizedDetailUrl,
            stockCount: normalizeStockCount(
                source.stockCount !== undefined ? source.stockCount : source.stock_count,
                toIsActive(source.isActive) ? 1 : 0
            ),
            colorVariants: sanitizeColorVariantList(source.colorVariants || source.color_variants),
            isActive: toIsActive(source.isActive),
            createdAt: createdAt || null
        };
    }

    function sanitizeProducts(input) {
        const rows = Array.isArray(input) ? input : [];
        const normalized = rows
            .map(function (row, index) {
                return normalizeProduct(row, index + 1);
            })
            .filter(Boolean)
            .sort(function (left, right) {
                const categoryDiff = getCategoryOrder(left.category) - getCategoryOrder(right.category);
                if (categoryDiff !== 0) {
                    return categoryDiff;
                }
                return String(left.model || "").localeCompare(String(right.model || ""));
            });
        return dedupeProductsByModelAndCategory(normalized);
    }

    function readProductsFromLocal() {
        const parsed = safeParse(localStorage.getItem(storageKey));
        if (!Array.isArray(parsed)) {
            return [];
        }
        return sanitizeProducts(parsed);
    }

    function saveProductsToLocal(items) {
        localStorage.setItem(storageKey, JSON.stringify(items));
    }

    function normalizeModelKey(value) {
        return String(value || "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
    }

    function normalizeModelSpecValue(value) {
        return normalizeText(value).slice(0, 120);
    }

    function sanitizeModelSpecEntry(input) {
        const source = input && typeof input === "object" ? input : {};
        return {
            power: normalizeModelSpecValue(source.power),
            battery: normalizeModelSpecValue(source.battery),
            batteryType: normalizeModelSpecValue(source.batteryType || source.battery_type),
            speed: normalizeModelSpecValue(source.speed),
            range: normalizeModelSpecValue(source.range),
            chargingTime: normalizeModelSpecValue(source.chargingTime || source.charging_time)
        };
    }

    function sanitizeModelSpecMap(input) {
        const source = input && typeof input === "object" ? input : {};
        const output = {};

        Object.keys(source).forEach(function (key) {
            const modelKey = normalizeModelKey(key);
            if (!modelKey) {
                return;
            }

            const entry = sanitizeModelSpecEntry(source[key]);
            const hasValue = modelSpecFieldDefs.some(function (field) {
                return Boolean(entry[field.key]);
            });
            if (hasValue) {
                output[modelKey] = entry;
            }
        });

        return output;
    }

    function readModelSpecsFromLocal() {
        return sanitizeModelSpecMap(safeParse(localStorage.getItem(specStorageKey)));
    }

    function saveModelSpecsToLocal(map) {
        localStorage.setItem(specStorageKey, JSON.stringify(sanitizeModelSpecMap(map)));
    }

    function collectAddModelSpecs() {
        const entry = sanitizeModelSpecEntry({
            power: specPowerInput.value,
            battery: specBatteryInput.value,
            batteryType: specBatteryTypeInput.value,
            speed: specSpeedInput.value,
            range: specRangeInput.value,
            chargingTime: specChargingTimeInput.value
        });

        for (let index = 0; index < modelSpecFieldDefs.length; index += 1) {
            const field = modelSpecFieldDefs[index];
            if (!entry[field.key]) {
                return { error: `${field.label} is required.` };
            }
        }

        return { entry: entry };
    }

    function toTimestamp(value) {
        const raw = String(value || "").trim();
        if (!raw) {
            return 0;
        }
        const date = new Date(raw);
        const time = date.getTime();
        return Number.isFinite(time) ? time : 0;
    }

    function scoreProductCompleteness(product) {
        let score = 0;
        if (String(product.detailUrl || "").trim()) {
            score += 4;
        }
        if (String(product.imageUrl || "").trim()) {
            score += 2;
        }
        if (String(product.info || "").trim()) {
            score += 1;
        }
        if (toIsActive(product.isActive)) {
            score += 1;
        }
        return score;
    }

    function pickPreferredProduct(existing, candidate) {
        const existingScore = scoreProductCompleteness(existing);
        const candidateScore = scoreProductCompleteness(candidate);
        if (candidateScore > existingScore) {
            return candidate;
        }
        if (candidateScore < existingScore) {
            return existing;
        }

        const existingTime = toTimestamp(existing.createdAt);
        const candidateTime = toTimestamp(candidate.createdAt);
        if (candidateTime > existingTime) {
            return candidate;
        }
        if (candidateTime < existingTime) {
            return existing;
        }

        return Number(candidate.id || 0) > Number(existing.id || 0) ? candidate : existing;
    }

    function dedupeProductsByModelAndCategory(list) {
        const ordered = Array.isArray(list) ? list : [];
        const byKey = {};
        const keyOrder = [];

        ordered.forEach(function (product) {
            const modelKey = normalizeModelKey(product.model);
            const categoryKey = normalizeCategory(product.category);
            const dedupeKey = `${modelKey}__${categoryKey}`;
            if (!modelKey) {
                return;
            }

            if (!Object.prototype.hasOwnProperty.call(byKey, dedupeKey)) {
                byKey[dedupeKey] = product;
                keyOrder.push(dedupeKey);
                return;
            }

            byKey[dedupeKey] = pickPreferredProduct(byKey[dedupeKey], product);
        });

        return keyOrder.map(function (key) {
            return byKey[key];
        });
    }

    function normalizeColorKey(value) {
        return String(value || "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .trim()
            .replace(/\s+/g, "-");
    }

    function formatColorLabel(value, fallbackIndex) {
        const raw = String(value || "")
            .replace(/\bcolor\b/ig, "")
            .trim();
        if (raw) {
            return raw.charAt(0).toUpperCase() + raw.slice(1);
        }
        return `Color ${fallbackIndex + 1}`;
    }

    function sanitizeColorVariant(input, fallbackIndex) {
        const source = input && typeof input === "object" ? input : {};
        const key = normalizeColorKey(source.key || source.color || source.name || source.label || `color ${fallbackIndex + 1}`);
        if (!key) {
            return null;
        }

        return {
            key: key,
            label: formatColorLabel(source.label || source.name || source.color || source.key, fallbackIndex),
            imageUrl: String(source.imageUrl || source.image || "").trim(),
            isActive: toIsActive(source.isActive),
            stockCount: normalizeStockCount(
                source.stockCount !== undefined ? source.stockCount : source.stock_count,
                toIsActive(source.isActive) ? 1 : 0
            )
        };
    }

    function sanitizeColorVariantList(input) {
        const rows = Array.isArray(input) ? input : [];
        const seen = {};
        const output = [];
        rows.forEach(function (row, index) {
            const normalized = sanitizeColorVariant(row, index);
            if (!normalized || seen[normalized.key]) {
                return;
            }
            seen[normalized.key] = true;
            output.push(normalized);
        });
        return output;
    }

    function sanitizeColorVariantMap(input) {
        const source = input && typeof input === "object" ? input : {};
        const output = {};
        Object.keys(source).forEach(function (key) {
            const modelKey = normalizeModelKey(key);
            if (!modelKey) {
                return;
            }
            const list = sanitizeColorVariantList(source[key]);
            if (list.length) {
                output[modelKey] = list;
            }
        });
        return output;
    }

    function getProductColorVariants(product) {
        const modelKey = normalizeModelKey(product && product.model);
        if (modelKey && Array.isArray(colorVariantsByModel[modelKey])) {
            return sanitizeColorVariantList(colorVariantsByModel[modelKey]);
        }
        return sanitizeColorVariantList(product && (product.colorVariants || product.color_variants));
    }

    function hasAvailableProductColorStock(product) {
        return getProductColorVariants(product).some(function (variant) {
            return variant.isActive !== false && normalizeStockCount(variant.stockCount, 0) > 0;
        });
    }

    function isProductCustomerAvailable(product) {
        if (!product || !product.isActive) {
            return false;
        }
        return getProductStockCount(product) > 0 || hasAvailableProductColorStock(product);
    }

    function clampAddColorCount(value) {
        const parsed = Number.parseInt(String(value || "").trim(), 10);
        if (!Number.isFinite(parsed)) {
            return minAddColorCount;
        }
        return Math.max(minAddColorCount, Math.min(maxAddColorCount, parsed));
    }

    function getAddColorInputValues() {
        return Array.from(colorInputListEl.querySelectorAll(".stock-color-name-input"))
            .map(function (input) {
                return normalizeText(input.value).slice(0, 64);
            });
    }

    function renderAddColorInputs(requestedCount, preferredValues) {
        const count = clampAddColorCount(requestedCount);
        const values = Array.isArray(preferredValues) && preferredValues.length
            ? preferredValues
            : getAddColorInputValues();

        colorCountInput.value = String(count);
        colorInputListEl.innerHTML = "";

        const fragment = document.createDocumentFragment();
        for (let index = 0; index < count; index += 1) {
            const row = document.createElement("div");
            row.className = "stock-color-input-item";

            const label = document.createElement("label");
            const inputId = `stock-color-name-${index + 1}`;
            label.setAttribute("for", inputId);
            label.textContent = `Color ${index + 1}`;

            const input = document.createElement("input");
            input.id = inputId;
            input.type = "text";
            input.className = "stock-color-name-input";
            input.maxLength = 64;
            input.placeholder = index === 0 ? "Black" : `Color ${index + 1}`;
            input.autocomplete = "off";
            input.value = normalizeText(values[index] || "").slice(0, 64);
            input.disabled = Boolean(editingProductId);

            row.appendChild(label);
            row.appendChild(input);
            fragment.appendChild(row);
        }

        colorInputListEl.appendChild(fragment);
    }

    function syncAddFormModeUi() {
        const isEditing = Number.isFinite(editingProductId) && editingProductId > 0;
        addFormTitleEl.textContent = isEditing ? "Edit E-bike Model" : "Add E-bike Model";
        saveBtn.textContent = isEditing ? "Update Model" : "Save Model";
        colorCountInput.disabled = isEditing;
        colorEditNoteEl.classList.toggle("is-hidden", !isEditing);
        Array.from(colorInputListEl.querySelectorAll(".stock-color-name-input")).forEach(function (input) {
            input.disabled = isEditing;
        });
    }

    function clearEditState() {
        editingProductId = null;
        syncAddFormModeUi();
    }

    function populateFormForEdit(product) {
        const target = product && typeof product === "object" ? product : null;
        if (!target) {
            return;
        }

        const modelKey = normalizeModelKey(target.model);
        const specs = modelKey ? sanitizeModelSpecEntry(modelSpecsByModel[modelKey]) : sanitizeModelSpecEntry({});
        const variants = modelKey && Array.isArray(colorVariantsByModel[modelKey])
            ? colorVariantsByModel[modelKey]
            : [];
        const colorNames = variants.length
            ? variants.map(function (variant) {
                return normalizeText(variant.label).slice(0, 64);
            })
            : [""];

        editingProductId = Number(target.id);
        addForm.reset();
        modelInput.value = target.model || "";
        categoryInput.value = normalizeCategory(target.category);
        priceInput.value = String(Number(target.price || 0));
        infoInput.value = target.info || "";
        specPowerInput.value = specs.power || "";
        specBatteryInput.value = specs.battery || "";
        specBatteryTypeInput.value = specs.batteryType || "";
        specSpeedInput.value = specs.speed || "";
        specRangeInput.value = specs.range || "";
        specChargingTimeInput.value = specs.chargingTime || "";
        imageFileInput.value = "";
        imageInput.value = target.imageUrl || "/Userhomefolder/image 1.png";
        detailInput.value = target.detailUrl || "";
        colorCountInput.value = String(clampAddColorCount(colorNames.length));
        renderAddColorInputs(colorNames.length, colorNames);
        setAddStatus("", "");
        syncAddFormModeUi();
    }

    function collectAddColorVariants(defaultImageUrl) {
        const count = clampAddColorCount(colorCountInput.value);
        renderAddColorInputs(count);
        const inputs = Array.from(colorInputListEl.querySelectorAll(".stock-color-name-input"));
        const seen = {};
        const variants = [];
        const imageUrl = resolveAssetPath(String(defaultImageUrl || "").trim() || "/Userhomefolder/image 1.png");

        for (let index = 0; index < inputs.length; index += 1) {
            const label = normalizeText(inputs[index].value).slice(0, 64);
            if (!label) {
                return { error: `Color ${index + 1} name is required.` };
            }

            const key = normalizeColorKey(label);
            if (!key) {
                return { error: `Color ${index + 1} name is invalid.` };
            }
            if (seen[key]) {
                return { error: "Duplicate color names are not allowed." };
            }

            seen[key] = true;
            variants.push({
                key: key,
                label: formatColorLabel(label, index),
                imageUrl: imageUrl,
                isActive: true,
                stockCount: 1
            });
        }

        return {
            variants: sanitizeColorVariantList(variants)
        };
    }

    function readColorVariantsFromLocal() {
        return sanitizeColorVariantMap(safeParse(localStorage.getItem(colorStorageKey)));
    }

    function saveColorVariantsToLocal(map) {
        localStorage.setItem(colorStorageKey, JSON.stringify(sanitizeColorVariantMap(map)));
    }

    function setColorStatus(message, tone) {
        colorStatusEl.textContent = String(message || "");
        colorStatusEl.classList.remove("is-success", "is-warning", "is-error", "is-muted");
        if (tone === "success") {
            colorStatusEl.classList.add("is-success");
        } else if (tone === "warning") {
            colorStatusEl.classList.add("is-warning");
        } else if (tone === "error") {
            colorStatusEl.classList.add("is-error");
        } else if (tone === "muted") {
            colorStatusEl.classList.add("is-muted");
        }
    }

    function getColorClassToken(className) {
        const tokens = String(className || "")
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

    function resolveImageUrlFromDetail(imageUrl, detailUrl) {
        const raw = String(imageUrl || "").trim();
        if (!raw) {
            return "";
        }
        if (/^data:image\//i.test(raw)) {
            return raw;
        }
        if (/^https?:\/\//i.test(raw)) {
            return raw;
        }
        if (raw.startsWith("/")) {
            return resolveAssetPath(raw);
        }
        if (detailUrl) {
            try {
                const baseUrl = new URL(detailUrl, window.location.origin);
                const resolved = new URL(raw, baseUrl);
                return resolveAssetPath(`${resolved.pathname}${resolved.search}${resolved.hash}`);
            } catch (_error) {
                // continue with fallback normalization
            }
        }
        if (raw.startsWith("../")) {
            return resolveAssetPath(`/Userhomefolder/${raw.slice(3)}`);
        }
        if (raw.startsWith("./")) {
            return resolveAssetPath(raw.slice(2));
        }
        return resolveAssetPath(raw);
    }

    function stripLightBackdropFromImage(imageEl) {
        if (!imageEl) {
            return;
        }
        const processState = String(imageEl.getAttribute("data-bg-processed") || "");
        if (processState === "processing" || processState === "1") {
            return;
        }

        const source = String(imageEl.currentSrc || imageEl.src || "").trim();
        if (!source || /^data:image\/svg\+xml/i.test(source)) {
            imageEl.setAttribute("data-bg-processed", "1");
            return;
        }

        imageEl.setAttribute("data-bg-processed", "processing");

        const probe = new Image();
        probe.crossOrigin = "anonymous";
        probe.decoding = "async";
        probe.onload = function () {
            try {
                const width = Number(probe.naturalWidth || 0);
                const height = Number(probe.naturalHeight || 0);
                if (!width || !height || (width * height) > 2200000) {
                    imageEl.setAttribute("data-bg-processed", "1");
                    return;
                }

                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d", { willReadFrequently: true });
                if (!ctx) {
                    imageEl.setAttribute("data-bg-processed", "1");
                    return;
                }

                ctx.drawImage(probe, 0, 0, width, height);
                const frame = ctx.getImageData(0, 0, width, height);
                const pixels = frame.data;
                const total = width * height;
                const visited = new Uint8Array(total);
                const stack = [];

                function push(index) {
                    if (index < 0 || index >= total || visited[index]) {
                        return;
                    }
                    visited[index] = 1;
                    stack.push(index);
                }

                push(0);
                push(width - 1);
                push(total - width);
                push(total - 1);

                while (stack.length) {
                    const index = stack.pop();
                    const offset = index * 4;
                    const alpha = pixels[offset + 3];
                    if (!alpha) {
                        continue;
                    }

                    const red = pixels[offset];
                    const green = pixels[offset + 1];
                    const blue = pixels[offset + 2];
                    const max = Math.max(red, green, blue);
                    const min = Math.min(red, green, blue);
                    const luminance = (red + green + blue) / 3;
                    const saturation = max - min;

                    if (luminance < 220 || saturation > 60) {
                        continue;
                    }

                    pixels[offset + 3] = 0;

                    const x = index % width;
                    if (x > 0) {
                        push(index - 1);
                    }
                    if (x < width - 1) {
                        push(index + 1);
                    }
                    if (index >= width) {
                        push(index - width);
                    }
                    if (index < total - width) {
                        push(index + width);
                    }
                }

                for (let offset = 0; offset < pixels.length; offset += 4) {
                    const alpha = pixels[offset + 3];
                    if (!alpha) {
                        continue;
                    }

                    const red = pixels[offset];
                    const green = pixels[offset + 1];
                    const blue = pixels[offset + 2];
                    const max = Math.max(red, green, blue);
                    const min = Math.min(red, green, blue);
                    const luminance = (red + green + blue) / 3;
                    const saturation = max - min;

                    if (luminance >= 238 && saturation <= 35) {
                        pixels[offset + 3] = Math.round(alpha * 0.35);
                    } else if (luminance >= 228 && saturation <= 45) {
                        pixels[offset + 3] = Math.round(alpha * 0.68);
                    }
                }

                ctx.putImageData(frame, 0, 0);
                const processedUrl = canvas.toDataURL("image/png");
                if (processedUrl) {
                    imageEl.src = processedUrl;
                }
            } catch (_error) {
                // keep original source on failure
            }
            imageEl.setAttribute("data-bg-processed", "1");
        };
        probe.onerror = function () {
            imageEl.setAttribute("data-bg-processed", "1");
        };
        probe.src = source;
    }

    async function readColorVariantsFromDetailPage(product) {
        const detailUrl = resolveAssetPath(String(product && product.detailUrl || "").trim());
        if (!detailUrl) {
            return [];
        }

        try {
            const response = await fetch(detailUrl, { method: "GET" });
            if (!response.ok) {
                return [];
            }
            const markup = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(markup, "text/html");
            const primaryColorPicker = doc.querySelector(".color-picker");
            const dots = primaryColorPicker
                ? Array.from(primaryColorPicker.querySelectorAll(".dot"))
                : Array.from(doc.querySelectorAll(".dot"));
            if (!dots.length) {
                return [];
            }

            const variants = dots.map(function (dot, index) {
                const dataColor = String(dot.getAttribute("data-color") || "").trim();
                const ariaLabel = String(dot.getAttribute("aria-label") || "").replace(/\bcolor\b/ig, "").trim();
                const classColor = getColorClassToken(dot.getAttribute("class"));
                const colorName = dataColor || ariaLabel || classColor || `Color ${index + 1}`;
                const imageUrl = resolveImageUrlFromDetail(
                    String(dot.getAttribute("data-image") || "").trim(),
                    detailUrl
                );
                return {
                    key: colorName,
                    label: colorName,
                    imageUrl: imageUrl,
                    isActive: true
                };
            });

            return sanitizeColorVariantList(variants);
        } catch (_error) {
            return [];
        }
    }

    function mergeColorVariants(product, detectedList, existingList) {
        const fallback = sanitizeColorVariantList([{
            key: "default",
            label: "Default",
            imageUrl: product.imageUrl || "/Userhomefolder/image 1.png",
            isActive: true,
            stockCount: 1
        }]);
        const sanitizedExisting = sanitizeColorVariantList(existingList);
        const discovered = detectedList.length
            ? detectedList
            : (sanitizedExisting.length ? sanitizedExisting : fallback);
        const existingByKey = {};
        sanitizedExisting.forEach(function (item) {
            existingByKey[item.key] = item;
        });

        const merged = discovered.map(function (item, index) {
            const previous = existingByKey[item.key];
            return {
                key: item.key,
                label: item.label || (previous ? previous.label : formatColorLabel(item.key, index)),
                imageUrl: item.imageUrl || (previous ? previous.imageUrl : product.imageUrl || ""),
                isActive: previous ? toIsActive(previous.isActive) : true,
                stockCount: previous
                    ? normalizeStockCount(previous.stockCount, 1)
                    : normalizeStockCount(item.stockCount, 1)
            };
        });

        const mergedByKey = {};
        merged.forEach(function (item) {
            mergedByKey[item.key] = true;
        });

        sanitizedExisting.forEach(function (item, index) {
            if (mergedByKey[item.key]) {
                return;
            }

            merged.push({
                key: item.key,
                label: item.label || formatColorLabel(item.key, index),
                imageUrl: item.imageUrl || product.imageUrl || "",
                isActive: toIsActive(item.isActive),
                stockCount: normalizeStockCount(item.stockCount, 1)
            });
        });

        return sanitizeColorVariantList(merged);
    }

    function getModelOptions() {
        const seen = {};
        const options = [];
        getVisibleProducts().forEach(function (product) {
            const modelKey = normalizeModelKey(product.model);
            if (!modelKey || seen[modelKey]) {
                return;
            }
            seen[modelKey] = true;
            options.push({
                key: modelKey,
                label: product.model
            });
        });
        options.sort(function (left, right) {
            return String(left.label || "").localeCompare(String(right.label || ""));
        });
        return options;
    }

    function getModelLabelByKey(modelKey) {
        const option = getModelOptions().find(function (item) {
            return item.key === modelKey;
        });
        return option ? option.label : modelKey;
    }

    function findProductByModelKey(modelKey) {
        const targetKey = String(modelKey || "").trim();
        if (!targetKey) {
            return null;
        }
        return products.find(function (item) {
            return normalizeModelKey(item.model) === targetKey;
        }) || null;
    }

    function saveColorVariantsForModel(modelKey, variants) {
        const key = String(modelKey || "").trim();
        if (!key) {
            return;
        }

        const nextMap = Object.assign({}, colorVariantsByModel);
        const sanitized = sanitizeColorVariantList(variants);
        if (sanitized.length) {
            nextMap[key] = sanitized;
        } else {
            delete nextMap[key];
        }
        colorVariantsByModel = sanitizeColorVariantMap(nextMap);
        saveColorVariantsToLocal(colorVariantsByModel);
    }

    function renderColorModelOptions() {
        const options = getModelOptions();
        const previous = String(colorModelSelectEl.value || "");
        colorModelSelectEl.innerHTML = "";

        if (!options.length) {
            const empty = document.createElement("option");
            empty.value = "";
            empty.textContent = "No models";
            colorModelSelectEl.appendChild(empty);
            colorModelSelectEl.disabled = true;
            return;
        }

        options.forEach(function (item) {
            const option = document.createElement("option");
            option.value = item.key;
            option.textContent = item.label;
            colorModelSelectEl.appendChild(option);
        });

        colorModelSelectEl.disabled = false;
        const hasPrevious = options.some(function (item) {
            return item.key === previous;
        });
        colorModelSelectEl.value = hasPrevious ? previous : options[0].key;
    }

    function renderColorVariantList() {
        const modelKey = String(colorModelSelectEl.value || "").trim();
        colorListEl.innerHTML = "";

        if (!modelKey) {
            return;
        }

        const variants = Array.isArray(colorVariantsByModel[modelKey]) ? colorVariantsByModel[modelKey] : [];
        if (!variants.length) {
            const empty = document.createElement("article");
            empty.className = "color-item";
            empty.innerHTML = "<p class=\"color-item-name\">No color variants found.</p>";
            colorListEl.appendChild(empty);
            return;
        }

        const fragment = document.createDocumentFragment();
        variants.forEach(function (variant) {
            const stockCount = normalizeStockCount(variant.stockCount, variant.isActive ? 1 : 0);
            const statusMeta = getColorVariantStatusMeta(variant);
            const row = document.createElement("article");
            row.className = "color-item";

            const main = document.createElement("div");
            main.className = "color-item-main";

            const head = document.createElement("div");
            head.className = "color-item-head";

            const image = document.createElement("img");
            image.className = "color-item-image";
            image.alt = `${variant.label} preview`;
            image.src = resolveAssetPath(variant.imageUrl || "/Userhomefolder/image 1.png");
            image.loading = "lazy";
            image.onload = function () {
                stripLightBackdropFromImage(image);
            };
            image.onerror = function () {
                image.onerror = null;
                image.src = resolveAssetPath("/Userhomefolder/image 1.png");
            };
            head.appendChild(image);

            const titleWrap = document.createElement("div");
            titleWrap.className = "color-item-title-wrap";

            const name = document.createElement("p");
            name.className = "color-item-name";
            name.textContent = variant.label;
            titleWrap.appendChild(name);

            head.appendChild(titleWrap);
            main.appendChild(head);

            const status = document.createElement("p");
            status.className = `color-item-status ${statusMeta.className}`;
            status.textContent = statusMeta.label;
            main.appendChild(status);

            const controls = document.createElement("div");
            controls.className = "color-item-controls";

            const stockBlock = document.createElement("div");
            stockBlock.className = "color-stock-block";

            const meta = document.createElement("p");
            meta.className = "color-item-meta";
            meta.textContent = "Pieces Left";
            stockBlock.appendChild(meta);

            const counter = document.createElement("div");
            counter.className = "color-counter";

            const minusBtn = document.createElement("button");
            minusBtn.type = "button";
            minusBtn.className = "color-counter-btn";
            minusBtn.setAttribute("data-model-key", modelKey);
            minusBtn.setAttribute("data-color-key", variant.key);
            minusBtn.setAttribute("data-delta", "-1");
            minusBtn.setAttribute("aria-label", `Decrease stock for ${variant.label}`);
            minusBtn.textContent = "-";
            minusBtn.disabled = !variant.isActive || stockCount <= 0;
            counter.appendChild(minusBtn);

            const counterValue = document.createElement("span");
            counterValue.className = "color-counter-value";
            counterValue.textContent = `${stockCount} pcs`;
            counter.appendChild(counterValue);

            const plusBtn = document.createElement("button");
            plusBtn.type = "button";
            plusBtn.className = "color-counter-btn";
            plusBtn.setAttribute("data-model-key", modelKey);
            plusBtn.setAttribute("data-color-key", variant.key);
            plusBtn.setAttribute("data-delta", "1");
            plusBtn.setAttribute("aria-label", `Increase stock for ${variant.label}`);
            plusBtn.textContent = "+";
            plusBtn.disabled = !variant.isActive;
            counter.appendChild(plusBtn);

            stockBlock.appendChild(counter);
            controls.appendChild(stockBlock);

            const button = document.createElement("button");
            button.type = "button";
            button.className = `color-toggle-btn ${variant.isActive ? "remove" : "restore"}`;
            button.setAttribute("data-model-key", modelKey);
            button.setAttribute("data-color-key", variant.key);
            button.setAttribute("data-next-active", variant.isActive ? "0" : "1");
            button.textContent = variant.isActive ? "Remove Color" : "Restore Color";

            controls.appendChild(button);
            row.appendChild(main);
            row.appendChild(controls);
            fragment.appendChild(row);
        });
        colorListEl.appendChild(fragment);
    }

    function renderColorManager() {
        renderColorModelOptions();
        renderColorVariantList();
    }

    async function syncColorVariantsFromProducts() {
        const localSnapshot = sanitizeColorVariantMap(colorVariantsByModel);
        const serverSnapshot = {};
        const preferredProductsByModel = {};
        products.forEach(function (product) {
            const modelKey = normalizeModelKey(product.model);
            if (!modelKey) {
                return;
            }

            const serverVariants = sanitizeColorVariantList(product.colorVariants);
            if (serverVariants.length) {
                serverSnapshot[modelKey] = serverVariants;
            }

            const previous = preferredProductsByModel[modelKey];
            if (!previous) {
                preferredProductsByModel[modelKey] = product;
                return;
            }

            const previousHasDetail = Boolean(String(previous.detailUrl || "").trim());
            const currentHasDetail = Boolean(String(product.detailUrl || "").trim());
            if (!previousHasDetail && currentHasDetail) {
                preferredProductsByModel[modelKey] = product;
            }
        });
        const snapshot = apiAvailable
            ? sanitizeColorVariantMap(Object.assign({}, localSnapshot, serverSnapshot))
            : localSnapshot;

        const tasks = Object.keys(preferredProductsByModel).map(async function (modelKey) {
            const product = preferredProductsByModel[modelKey];
            const existingList = Array.isArray(snapshot[modelKey]) ? snapshot[modelKey] : [];
            const detectedList = await readColorVariantsFromDetailPage(product);
            const mergedList = mergeColorVariants(product, detectedList, existingList);
            return {
                modelKey: modelKey,
                list: mergedList
            };
        });

        const resolved = await Promise.all(tasks);
        const nextMap = Object.assign({}, snapshot);
        resolved.forEach(function (entry) {
            if (!entry || !entry.modelKey || !entry.list.length) {
                return;
            }
            nextMap[entry.modelKey] = entry.list;
        });

        colorVariantsByModel = sanitizeColorVariantMap(nextMap);
        saveColorVariantsToLocal(colorVariantsByModel);
        renderColorManager();
    }

    async function persistColorVariantsForModel(modelKey, nextVariants) {
        const targetProduct = findProductByModelKey(modelKey);
        const sanitized = sanitizeColorVariantList(nextVariants);

        if (apiAvailable && targetProduct && Number(targetProduct.id) > 0) {
            const apiResult = await updateProductViaApi(targetProduct.id, {
                colorVariants: sanitized
            });
            if (apiResult.mode === "ok" && apiResult.product) {
                const normalized = replaceProductInState(apiResult.product, modelKey);
                return {
                    mode: "ok",
                    product: normalized,
                    variants: normalized ? sanitizeColorVariantList(normalized.colorVariants) : sanitized
                };
            }
            if (apiResult.mode === "error") {
                return apiResult;
            }
        }

        saveColorVariantsForModel(modelKey, sanitized);
        if (targetProduct) {
            products = sanitizeProducts(
                products.map(function (item) {
                    if (Number(item.id) !== Number(targetProduct.id)) {
                        return item;
                    }
                    return Object.assign({}, item, {
                        colorVariants: sanitized
                    });
                })
            );
            saveProductsToLocal(products);
        }

        return {
            mode: "local",
            variants: sanitized
        };
    }

    async function handleToggleColorVariant(modelKey, colorKey, shouldBeActive) {
        const variants = Array.isArray(colorVariantsByModel[modelKey]) ? colorVariantsByModel[modelKey] : [];
        const target = variants.find(function (item) {
            return item.key === colorKey;
        });
        if (!target || target.isActive === shouldBeActive) {
            return;
        }

        const nextVariants = sanitizeColorVariantList(
            variants.map(function (item) {
                if (item.key !== colorKey) {
                    return item;
                }
                return Object.assign({}, item, {
                    isActive: shouldBeActive
                });
            })
        );
        const result = await persistColorVariantsForModel(modelKey, nextVariants);
        if (result.mode === "error") {
            setColorStatus(result.message || "Unable to update color status.", "error");
            return;
        }

        if (result.mode === "ok") {
            colorVariantsByModel = sanitizeColorVariantMap(Object.assign({}, colorVariantsByModel, {
                [modelKey]: result.variants
            }));
        } else {
            colorVariantsByModel[modelKey] = result.variants;
        }
        renderColorVariantList();

        const modelLabel = getModelLabelByKey(modelKey);
        const message = shouldBeActive
            ? `${target.label} restored for ${modelLabel}.`
            : `${target.label} removed for ${modelLabel}.`;
        setColorStatus(message, result.mode === "local" ? "warning" : "success");
    }

    async function handleAdjustColorVariantStock(modelKey, colorKey, delta) {
        const step = Number(delta);
        if (!Number.isFinite(step) || !step) {
            return;
        }

        const variants = Array.isArray(colorVariantsByModel[modelKey]) ? colorVariantsByModel[modelKey] : [];
        const target = variants.find(function (item) {
            return item.key === colorKey;
        });
        if (!target || !target.isActive) {
            return;
        }

        const nextCount = normalizeStockCount(target.stockCount, 1) + step;
        if (nextCount < 0) {
            return;
        }

        const nextVariants = sanitizeColorVariantList(
            variants.map(function (item) {
                if (item.key !== colorKey) {
                    return item;
                }
                return Object.assign({}, item, {
                    stockCount: nextCount
                });
            })
        );
        const result = await persistColorVariantsForModel(modelKey, nextVariants);
        if (result.mode === "error") {
            setColorStatus(result.message || "Unable to update color stock.", "error");
            return;
        }

        if (result.mode === "ok") {
            colorVariantsByModel = sanitizeColorVariantMap(Object.assign({}, colorVariantsByModel, {
                [modelKey]: result.variants
            }));
        } else {
            colorVariantsByModel[modelKey] = result.variants;
        }
        renderColorVariantList();

        const modelLabel = getModelLabelByKey(modelKey);
        setColorStatus(
            `${target.label} stock for ${modelLabel}: ${nextCount} pc(s).`,
            result.mode === "local" ? "warning" : "success"
        );
    }

    function bindColorManager() {
        colorModelSelectEl.addEventListener("change", function () {
            renderColorVariantList();
            setColorStatus("", "");
        });

        colorListEl.addEventListener("click", function (event) {
            const counterButton = event.target.closest(".color-counter-btn");
            if (counterButton) {
                const modelKey = String(counterButton.getAttribute("data-model-key") || "").trim();
                const colorKey = String(counterButton.getAttribute("data-color-key") || "").trim();
                const delta = Number(counterButton.getAttribute("data-delta"));
                if (!modelKey || !colorKey || !Number.isFinite(delta)) {
                    return;
                }
                void handleAdjustColorVariantStock(modelKey, colorKey, delta);
                return;
            }

            const button = event.target.closest(".color-toggle-btn");
            if (!button) {
                return;
            }

            const modelKey = String(button.getAttribute("data-model-key") || "").trim();
            const colorKey = String(button.getAttribute("data-color-key") || "").trim();
            if (!modelKey || !colorKey) {
                return;
            }

            const shouldBeActive = button.getAttribute("data-next-active") === "1";
            void handleToggleColorVariant(modelKey, colorKey, shouldBeActive);
        });
    }

    function setStatus(message, tone) {
        statusEl.textContent = message;
        statusEl.classList.remove("is-success", "is-warning", "is-error", "is-muted");
        if (tone === "success") {
            statusEl.classList.add("is-success");
        } else if (tone === "warning") {
            statusEl.classList.add("is-warning");
        } else if (tone === "error") {
            statusEl.classList.add("is-error");
        } else if (tone === "muted") {
            statusEl.classList.add("is-muted");
        }
    }

    function getVisibleProducts() {
        return products.filter(function (item) {
            return Boolean(item && item.isActive);
        });
    }

    function setAddStatus(message, tone) {
        addStatusEl.textContent = String(message || "");
        addStatusEl.classList.remove("is-success", "is-warning", "is-error", "is-muted");
        if (tone === "success") {
            addStatusEl.classList.add("is-success");
        } else if (tone === "warning") {
            addStatusEl.classList.add("is-warning");
        } else if (tone === "error") {
            addStatusEl.classList.add("is-error");
        } else if (tone === "muted") {
            addStatusEl.classList.add("is-muted");
        }
    }

    function toggleAddPanel(show) {
        const shouldShow = Boolean(show);
        addFormPanel.classList.toggle("is-hidden", !shouldShow);
        addFormPanel.setAttribute("aria-hidden", String(!shouldShow));
    }

    function getProductStatusMeta(product) {
        if (!product || !product.isActive) {
            return {
                className: "out",
                label: "Unavailable"
            };
        }

        if (isProductCustomerAvailable(product)) {
            return {
                className: "available",
                label: "Available"
            };
        }

        return {
            className: "out-stock",
            label: "Out of Stock"
        };
    }

    function getColorVariantStatusMeta(variant) {
        if (!variant || !variant.isActive) {
            return {
                className: "removed",
                label: "Removed"
            };
        }

        if (normalizeStockCount(variant.stockCount, 1) > 0) {
            return {
                className: "available",
                label: "Available"
            };
        }

        return {
            className: "out",
            label: "Out of Stock"
        };
    }

    function resetAddForm() {
        addForm.reset();
        clearEditState();
        categoryInput.value = "2-Wheel";
        imageFileInput.value = "";
        imageInput.value = "/Userhomefolder/image 1.png";
        colorCountInput.value = String(minAddColorCount);
        renderAddColorInputs(minAddColorCount, [""]);
        setAddStatus("", "");
        syncAddFormModeUi();
    }

    function createStockCard(product) {
        const stockCount = getProductStockCount(product);
        const statusMeta = getProductStatusMeta(product);
        const card = document.createElement("article");
        card.className = "panel stock-card";

        const model = document.createElement("p");
        model.className = "model";
        model.textContent = `MODEL: ${product.model}`;
        card.appendChild(model);

        const category = document.createElement("p");
        category.className = "stock-category";
        category.textContent = product.category;
        card.appendChild(category);

        const price = document.createElement("p");
        price.className = "stock-price";
        price.textContent = `Price: ${formatPeso(product.price)}`;
        card.appendChild(price);

        const info = document.createElement("p");
        info.className = "stock-info";
        info.textContent = product.info || "No model info yet.";
        card.appendChild(info);

        const image = document.createElement("img");
        image.src = resolveAssetPath(product.imageUrl || "/Userhomefolder/image 1.png");
        image.alt = product.model;
        image.loading = "lazy";
        image.onload = function () {
            stripLightBackdropFromImage(image);
        };
        image.onerror = function () {
            image.onerror = null;
            image.src = resolveAssetPath("/Userhomefolder/image 1.png");
        };
        card.appendChild(image);

        const quantityBlock = document.createElement("div");
        quantityBlock.className = "stock-quantity-block";

        const quantityLabel = document.createElement("p");
        quantityLabel.className = "stock-quantity-label";
        quantityLabel.textContent = "Pieces Left";
        quantityBlock.appendChild(quantityLabel);

        const counter = document.createElement("div");
        counter.className = "stock-counter";

        const minusBtn = document.createElement("button");
        minusBtn.type = "button";
        minusBtn.className = "stock-counter-btn";
        minusBtn.setAttribute("data-id", String(product.id));
        minusBtn.setAttribute("data-delta", "-1");
        minusBtn.setAttribute("aria-label", `Decrease stock for ${product.model}`);
        minusBtn.textContent = "-";
        minusBtn.disabled = !product.isActive || stockCount <= 0;
        counter.appendChild(minusBtn);

        const counterValue = document.createElement("span");
        counterValue.className = "stock-counter-value";
        counterValue.textContent = `${stockCount} pcs`;
        counter.appendChild(counterValue);

        const plusBtn = document.createElement("button");
        plusBtn.type = "button";
        plusBtn.className = "stock-counter-btn";
        plusBtn.setAttribute("data-id", String(product.id));
        plusBtn.setAttribute("data-delta", "1");
        plusBtn.setAttribute("aria-label", `Increase stock for ${product.model}`);
        plusBtn.textContent = "+";
        plusBtn.disabled = !product.isActive;
        counter.appendChild(plusBtn);

        quantityBlock.appendChild(counter);
        card.appendChild(quantityBlock);

        const status = document.createElement("p");
        status.className = `status ${statusMeta.className}`;
        status.textContent = statusMeta.label;
        card.appendChild(status);

        const actions = document.createElement("div");
        actions.className = "stock-actions";

        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className = "stock-action-btn edit";
        editButton.setAttribute("data-id", String(product.id));
        editButton.setAttribute("data-action", "edit");
        editButton.textContent = "Edit";
        actions.appendChild(editButton);

        const actionButton = document.createElement("button");
        actionButton.type = "button";
        actionButton.className = `stock-action-btn ${product.isActive ? "remove" : "restore"}`;
        actionButton.setAttribute("data-id", String(product.id));
        actionButton.setAttribute("data-next-active", product.isActive ? "0" : "1");
        actionButton.setAttribute("data-action", "toggle-active");
        actionButton.textContent = product.isActive ? "Remove" : "Restore";
        actions.appendChild(actionButton);

        card.appendChild(actions);

        return card;
    }

    function renderStats() {
        const visibleProducts = getVisibleProducts();
        const totalModels = visibleProducts.length;
        const available = visibleProducts.filter(function (item) {
            return isProductCustomerAvailable(item);
        }).length;
        const unavailable = visibleProducts.filter(function (item) {
            return !isProductCustomerAvailable(item);
        }).length;

        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const newThisMonth = visibleProducts.filter(function (item) {
            const raw = String(item.createdAt || "").trim();
            if (!raw) {
                return false;
            }
            const date = new Date(raw);
            if (Number.isNaN(date.getTime())) {
                return false;
            }
            return date >= monthStart;
        }).length;

        statTotalModelsEl.textContent = String(totalModels);
        statAvailableEl.textContent = String(available);
        statUnavailableEl.textContent = String(unavailable);
        statNewThisMonthEl.textContent = String(newThisMonth);
    }

    function renderStockCards() {
        const visibleProducts = getVisibleProducts();
        stockGridEl.innerHTML = "";
        if (!visibleProducts.length) {
            const emptyCard = document.createElement("article");
            emptyCard.className = "panel stock-card stock-card-empty";
            emptyCard.textContent = "No models found.";
            stockGridEl.appendChild(emptyCard);
            return;
        }

        const fragment = document.createDocumentFragment();
        visibleProducts.forEach(function (item) {
            fragment.appendChild(createStockCard(item));
        });
        stockGridEl.appendChild(fragment);
    }

    function isDuplicateModel(model, category, ignoredProductId) {
        const modelLower = normalizeText(model).toLowerCase();
        const categoryNormalized = normalizeCategory(category);
        return products.some(function (item) {
            return (
                Number(item.id) !== Number(ignoredProductId || 0)
                && normalizeText(item.model).toLowerCase() === modelLower
                && normalizeCategory(item.category) === categoryNormalized
            );
        });
    }

    async function fetchProductsFromApi() {
        const endpoints = [
            "/api/admin/products",
            "/api/products"
        ];
        let sawHttpError = false;
        let lastMessage = "Unable to load stock models.";

        for (let i = 0; i < endpoints.length; i += 1) {
            const endpoint = endpoints[i];
            let response;

            try {
                response = await fetch(getApiUrl(endpoint), {
                    method: "GET"
                });
            } catch (_networkError) {
                continue;
            }

            if (response.status === 404 || response.status === 405) {
                continue;
            }

            const payload = await response.json().catch(function () {
                return {};
            });

            if (!response.ok || payload.success !== true) {
                sawHttpError = true;
                lastMessage = payload.message || `Request failed (${response.status}).`;
                continue;
            }

            return {
                mode: "ok",
                products: sanitizeProducts(payload.products)
            };
        }

        if (sawHttpError) {
            return {
                mode: "error",
                message: lastMessage
            };
        }

        return { mode: "unavailable", products: [] };
    }

    async function createProductViaApi(payload) {
        try {
            const response = await fetch(getApiUrl("/api/admin/products"), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            if (response.status === 404 || response.status === 405) {
                return { mode: "unavailable" };
            }

            const body = await response.json().catch(function () {
                return {};
            });
            if (!response.ok || body.success !== true) {
                return {
                    mode: "error",
                    message: body.message || "Unable to add model."
                };
            }

            return {
                mode: "ok",
                product: normalizeProduct(body.product, Date.now())
            };
        } catch (_error) {
            return { mode: "unavailable" };
        }
    }

    async function updateProductViaApi(productId, payload) {
        try {
            const response = await fetch(
                getApiUrl(`/api/admin/products/${encodeURIComponent(productId)}`),
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(payload)
                }
            );

            if (response.status === 404 || response.status === 405) {
                return { mode: "unavailable" };
            }

            const body = await response.json().catch(function () {
                return {};
            });
            if (!response.ok || body.success !== true) {
                return {
                    mode: "error",
                    message: body.message || "Unable to update model."
                };
            }

            return {
                mode: "ok",
                product: normalizeProduct(body.product, productId)
            };
        } catch (_error) {
            return { mode: "unavailable" };
        }
    }

    function findProductById(productId) {
        return products.find(function (item) {
            return Number(item.id) === Number(productId);
        }) || null;
    }

    function replaceProductInState(nextProduct, previousModelKey) {
        const normalized = normalizeProduct(nextProduct, nextProduct && nextProduct.id);
        if (!normalized) {
            return null;
        }

        const hasExisting = products.some(function (item) {
            return Number(item.id) === Number(normalized.id);
        });

        products = sanitizeProducts(
            hasExisting
                ? products.map(function (item) {
                    return Number(item.id) === Number(normalized.id) ? normalized : item;
                })
                : products.concat(normalized)
        );
        saveProductsToLocal(products);
        ensureProductInventoryEntries(products);
        setProductStockCount(normalized, normalized.stockCount);

        const oldModelKey = String(previousModelKey || "").trim();
        const nextModelKey = normalizeModelKey(normalized.model);
        if (oldModelKey && oldModelKey !== nextModelKey) {
            const nextMap = Object.assign({}, colorVariantsByModel);
            delete nextMap[oldModelKey];
            colorVariantsByModel = sanitizeColorVariantMap(nextMap);
            saveColorVariantsToLocal(colorVariantsByModel);
        }
        if (nextModelKey) {
            saveColorVariantsForModel(nextModelKey, normalized.colorVariants);
        }

        return normalized;
    }

    async function handleAdjustProductStock(productId, delta) {
        const target = findProductById(productId);
        const step = Number(delta);
        if (!target || !Number.isFinite(step) || !step || !target.isActive) {
            return;
        }

        const currentCount = getProductStockCount(target);
        const nextCount = currentCount + step;
        if (nextCount < 0) {
            return;
        }

        if (apiAvailable && Number(target.id) > 0) {
            const apiResult = await updateProductViaApi(target.id, { stockCount: nextCount });
            if (apiResult.mode === "ok" && apiResult.product) {
                replaceProductInState(apiResult.product, normalizeModelKey(target.model));
                renderStats();
                renderStockCards();
                renderColorManager();
                setStatus(`${target.model} stock updated to ${nextCount} pc(s).`, "success");
                return;
            }
            if (apiResult.mode === "error") {
                setStatus(apiResult.message || "Unable to update stock count.", "error");
                return;
            }
        }

        setProductStockCount(target, nextCount);
        products = sanitizeProducts(
            products.map(function (item) {
                if (Number(item.id) !== Number(target.id)) {
                    return item;
                }
                return Object.assign({}, item, { stockCount: nextCount });
            })
        );
        saveProductsToLocal(products);
        renderStats();
        renderStockCards();
        setStatus(`API unavailable. ${target.model} stock updated locally to ${nextCount} pc(s).`, "warning");
    }

    function beginEditProduct(productId) {
        const target = findProductById(productId);
        if (!target) {
            setStatus("Model not found.", "error");
            return;
        }

        populateFormForEdit(target);
        toggleAddPanel(true);
        addFormPanel.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }

    async function handleToggleModelActive(productId, shouldBeActive) {
        const target = findProductById(productId);
        if (!target) {
            return;
        }

        if (target.isActive === shouldBeActive) {
            return;
        }

        const actionLabel = shouldBeActive ? "restore" : "remove";
        const confirmMessage = shouldBeActive
            ? `Restore ${target.model} to available products?`
            : `Remove ${target.model} from available stocks?`;
        if (!window.confirm(confirmMessage)) {
            return;
        }

        if (apiAvailable && Number(target.id) > 0) {
            const apiResult = await updateProductViaApi(target.id, { isActive: shouldBeActive });
            if (apiResult.mode === "ok" && apiResult.product) {
                replaceProductInState(apiResult.product, normalizeModelKey(target.model));
                renderStats();
                renderStockCards();
                renderColorManager();
                setStatus(`${target.model} ${actionLabel}d successfully.`, "success");
                return;
            }

            if (apiResult.mode === "error") {
                setStatus(apiResult.message || "Unable to update stock status.", "error");
                return;
            }
        }

        products = sanitizeProducts(
            products.map(function (item) {
                if (Number(item.id) !== Number(target.id)) {
                    return item;
                }
                return Object.assign({}, item, { isActive: shouldBeActive });
            })
        );
        saveProductsToLocal(products);
        ensureProductInventoryEntries(products);
        renderStats();
        renderStockCards();
        renderColorManager();
        setStatus(`API unavailable. ${target.model} ${actionLabel}d locally.`, "warning");
    }

    async function handleAddSubmit(event) {
        event.preventDefault();
        setAddStatus("", "");

        const editingTarget = Number.isFinite(editingProductId) && editingProductId > 0
            ? findProductById(editingProductId)
            : null;
        if (editingProductId && !editingTarget) {
            setAddStatus("The selected model could not be found.", "error");
            clearEditState();
            return;
        }

        const model = normalizeText(modelInput.value).slice(0, 180);
        const selectedCategory = categoryInput.value;
        const price = parsePrice(priceInput.value);
        const info = normalizeText(infoInput.value).slice(0, 255);
        const selectedImageFile = imageFileInput.files && imageFileInput.files[0] ? imageFileInput.files[0] : null;
        let imageUrl = resolveAssetPath(String(imageInput.value || "").trim() || "/Userhomefolder/image 1.png");
        const detailUrl = normalizeText(detailInput.value).slice(0, 255);
        const category = resolveCategory(selectedCategory, detailUrl);

        if (model.length < 2) {
            setAddStatus("Model name is required.", "error");
            return;
        }
        if (!Number.isFinite(price)) {
            setAddStatus("Price must be a valid number.", "error");
            return;
        }
        if (info.length < 2) {
            setAddStatus("Info is required.", "error");
            return;
        }
        if (selectedImageFile) {
            const allowedTypes = ["image/png", "image/jpeg", "image/webp"];
            if (!allowedTypes.includes(String(selectedImageFile.type || "").toLowerCase())) {
                setAddStatus("Use PNG, JPG, or WEBP image file only.", "error");
                return;
            }
            const maxImageBytes = 2 * 1024 * 1024;
            if (Number(selectedImageFile.size || 0) > maxImageBytes) {
                setAddStatus("Image file is too large. Max size is 2MB.", "error");
                return;
            }
            try {
                imageUrl = await readImageFileAsDataUrl(selectedImageFile);
            } catch (_error) {
                setAddStatus("Unable to read the selected image file.", "error");
                return;
            }
        }
        if (isDuplicateModel(model, category, editingTarget ? editingTarget.id : 0)) {
            setAddStatus("That model already exists in the selected category.", "error");
            return;
        }

        let nextColorVariants = [];
        if (editingTarget) {
            const existingModelKey = normalizeModelKey(editingTarget.model);
            nextColorVariants = existingModelKey && Array.isArray(colorVariantsByModel[existingModelKey])
                ? sanitizeColorVariantList(colorVariantsByModel[existingModelKey])
                : sanitizeColorVariantList(editingTarget.colorVariants);
        } else {
            const colorVariantResult = collectAddColorVariants(imageUrl);
            if (colorVariantResult.error) {
                setAddStatus(colorVariantResult.error, "error");
                return;
            }
            nextColorVariants = Array.isArray(colorVariantResult.variants)
                ? colorVariantResult.variants
                : [];
        }

        const specResult = collectAddModelSpecs();
        if (specResult.error) {
            setAddStatus(specResult.error, "error");
            return;
        }
        const nextModelSpecs = specResult.entry;

        if (!editingTarget && !apiAvailable) {
            setAddStatus("Cannot add model while API is unavailable.", "error");
            return;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = editingTarget ? "Updating..." : "Saving...";

        try {
            const normalizedColorVariants = sanitizeColorVariantList(
                nextColorVariants.map(function (variant) {
                    return Object.assign({}, variant, {
                        imageUrl: resolveAssetPath(variant.imageUrl || imageUrl)
                    });
                })
            );
            const currentStockCount = editingTarget
                ? getProductStockCount(editingTarget)
                : 1;
            const payload = {
                model: model,
                category: category,
                price: price,
                info: info,
                imageUrl: resolveAssetPath(imageUrl),
                detailUrl: resolveAssetPath(detailUrl),
                stockCount: currentStockCount,
                colorVariants: normalizedColorVariants,
                isActive: editingTarget ? editingTarget.isActive : true
            };

            if (editingTarget) {
                let updatedProduct = null;
                let statusTone = "success";
                let statusMessage = `${model} updated successfully.`;

                if (apiAvailable && Number(editingTarget.id) > 0) {
                    const apiResult = await updateProductViaApi(editingTarget.id, payload);
                    if (apiResult.mode === "ok" && apiResult.product) {
                        updatedProduct = apiResult.product;
                    } else if (apiResult.mode === "error") {
                        setAddStatus(apiResult.message || "Unable to update model.", "error");
                        return;
                    }
                }

                if (!updatedProduct) {
                    updatedProduct = normalizeProduct(Object.assign({}, editingTarget, payload), editingTarget.id);
                    statusTone = "warning";
                    statusMessage = `API unavailable. ${model} updated locally.`;
                }

                const previousModelKey = normalizeModelKey(editingTarget.model);
                const normalizedUpdatedProduct = replaceProductInState(updatedProduct, previousModelKey) || updatedProduct;
                const nextModelKey = normalizeModelKey(model);
                if (previousModelKey && previousModelKey !== nextModelKey) {
                    delete modelSpecsByModel[previousModelKey];
                }

                if (nextModelKey) {
                    saveColorVariantsForModel(nextModelKey, normalizedUpdatedProduct.colorVariants || normalizedColorVariants);
                }

                if (nextModelKey) {
                    modelSpecsByModel[nextModelKey] = sanitizeModelSpecEntry(nextModelSpecs);
                    saveModelSpecsToLocal(modelSpecsByModel);
                }

                renderStats();
                renderStockCards();
                renderColorManager();
                if (nextModelKey) {
                    colorModelSelectEl.value = nextModelKey;
                    renderColorVariantList();
                }

                setStatus(statusMessage, statusTone);
                resetAddForm();
                toggleAddPanel(false);
                return;
            }

            const apiResult = await createProductViaApi(payload);
            if (apiResult.mode === "ok" && apiResult.product) {
                const normalizedCreatedProduct = replaceProductInState(apiResult.product, "") || apiResult.product;
                const modelKey = normalizeModelKey(model);
                if (modelKey) {
                    saveColorVariantsForModel(modelKey, normalizedCreatedProduct.colorVariants || normalizedColorVariants);
                }

                if (modelKey) {
                    modelSpecsByModel[modelKey] = sanitizeModelSpecEntry(nextModelSpecs);
                    saveModelSpecsToLocal(modelSpecsByModel);
                }

                renderStats();
                renderStockCards();
                await syncColorVariantsFromProducts();
                if (modelKey) {
                    colorModelSelectEl.value = modelKey;
                    renderColorVariantList();
                }

                setStatus(`Added ${model} with ${nextColorVariants.length} color(s).`, "success");
                resetAddForm();
                toggleAddPanel(false);
                return;
            }

            if (apiResult.mode === "error") {
                setAddStatus(apiResult.message || "Unable to add model.", "error");
                return;
            }
            setAddStatus("API unavailable. Unable to add model.", "error");
        } finally {
            saveBtn.disabled = false;
            syncAddFormModeUi();
        }
    }

    function bindAddForm() {
        openAddBtn.addEventListener("click", function () {
            resetAddForm();
            toggleAddPanel(true);
            setAddStatus("", "");
        });

        cancelBtn.addEventListener("click", function () {
            resetAddForm();
            toggleAddPanel(false);
        });

        imageFileInput.addEventListener("change", function () {
            const file = imageFileInput.files && imageFileInput.files[0] ? imageFileInput.files[0] : null;
            if (!file) {
                return;
            }
            setAddStatus(`Selected image: ${file.name}`, "muted");
        });

        colorCountInput.addEventListener("input", function () {
            renderAddColorInputs(colorCountInput.value);
        });

        colorCountInput.addEventListener("change", function () {
            renderAddColorInputs(colorCountInput.value);
        });

        addForm.addEventListener("submit", function (event) {
            void handleAddSubmit(event);
        });
    }

    stockGridEl.addEventListener("click", function (event) {
        const counterBtn = event.target.closest(".stock-counter-btn");
        if (counterBtn) {
            const productId = Number(counterBtn.getAttribute("data-id"));
            const delta = Number(counterBtn.getAttribute("data-delta"));
            if (!Number.isFinite(productId) || !Number.isFinite(delta)) {
                return;
            }
            void handleAdjustProductStock(productId, delta);
            return;
        }

        const actionBtn = event.target.closest(".stock-action-btn");
        if (!actionBtn) {
            return;
        }

        const productId = Number(actionBtn.getAttribute("data-id"));
        if (!Number.isFinite(productId)) {
            return;
        }

        if (actionBtn.getAttribute("data-action") === "edit") {
            beginEditProduct(productId);
            return;
        }

        const nextActive = actionBtn.getAttribute("data-next-active") === "1";
        void handleToggleModelActive(productId, nextActive);
    });

    window.addEventListener("storage", function (event) {
        if (event.key === inventoryStorageKey) {
            productInventoryByKey = readProductInventoryFromLocal();
            renderStats();
            renderStockCards();
            return;
        }

        if (event.key === colorStorageKey) {
            colorVariantsByModel = readColorVariantsFromLocal();
            renderColorManager();
            return;
        }

        if (event.key === specStorageKey) {
            modelSpecsByModel = readModelSpecsFromLocal();
            return;
        }

        if (event.key !== storageKey || apiAvailable) {
            return;
        }
        products = readProductsFromLocal();
        ensureProductInventoryEntries(products);
        renderStats();
        renderStockCards();
        void syncColorVariantsFromProducts();
    });

    async function init() {
        toggleAddPanel(false);
        resetAddForm();
        bindAddForm();
        bindColorManager();
        productInventoryByKey = readProductInventoryFromLocal();
        colorVariantsByModel = readColorVariantsFromLocal();
        modelSpecsByModel = readModelSpecsFromLocal();
        renderColorManager();
        setColorStatus("Loading color variants...", "muted");

        setStatus("Loading stock data...", "muted");
        const apiResult = await fetchProductsFromApi();

        if (apiResult.mode === "ok") {
            apiAvailable = true;
            products = apiResult.products.length ? apiResult.products : [];
            saveProductsToLocal(products);
            ensureProductInventoryEntries(products, true);
            renderStats();
            renderStockCards();
            await syncColorVariantsFromProducts();
            setColorStatus("", "");
            setStatus("", "");
            return;
        }

        products = readProductsFromLocal();
        ensureProductInventoryEntries(products);
        renderStats();
        renderStockCards();
        await syncColorVariantsFromProducts();
        setColorStatus("Color availability synced from local data.", "warning");

        if (products.length) {
            setStatus("Live API unavailable. Showing last synced stock data.", "warning");
        } else if (apiResult.mode === "error") {
            setStatus(apiResult.message || "Unable to load stock data.", "error");
        } else {
            setStatus("API unavailable. Unable to load stock data.", "error");
        }
    }

    void init();
});

