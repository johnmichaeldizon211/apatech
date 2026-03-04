(function () {
    "use strict";

    const PRODUCT_STORAGE_KEY = "ecodrive_product_catalog";
    const MODEL_SPEC_STORAGE_KEY = "ecodrive_model_spec_catalog_v1";
    const CHECKOUT_SELECTION_KEYS = [
        "ecodrive_checkout_selection",
        "ecodrive_selected_bike",
        "selectedBike"
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

    const modelChipEl = document.getElementById("model-chip");
    const modelTitleEl = document.getElementById("model-title");
    const modelPriceEl = document.getElementById("model-price");
    const modelInfoEl = document.getElementById("model-info");
    const modelImageEl = document.getElementById("model-image");
    const modelSpecsEl = document.getElementById("model-specs");
    const modelStatusEl = document.getElementById("model-status");
    const bookNowBtn = document.getElementById("book-now-btn");

    const profileBtn = document.querySelector(".profile-menu .profile-btn");
    const dropdown = document.querySelector(".profile-menu .dropdown");
    const logoutBtn = document.querySelector(".profile-menu .logout-btn");

    let currentProduct = null;

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

    function normalizeModelKey(value) {
        return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    }

    function getApiUrl(path) {
        return API_BASE ? `${API_BASE}${path}` : path;
    }

    function formatPeso(amount) {
        return "PHP " + Number(amount || 0).toLocaleString("en-PH", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function isInlineDataImage(value) {
        return /^data:image\//i.test(String(value || "").trim());
    }

    function parseProductIdFromQuery() {
        const params = new URLSearchParams(window.location.search || "");
        const raw = String(params.get("productId") || "").trim();
        const id = Number(raw);
        if (!Number.isFinite(id) || id < 1) {
            return 0;
        }
        return Math.floor(id);
    }

    function parseModelFromQuery() {
        const params = new URLSearchParams(window.location.search || "");
        return normalizeText(params.get("model"));
    }

    function readCatalogFromLocal() {
        const parsed = safeParse(localStorage.getItem(PRODUCT_STORAGE_KEY));
        return Array.isArray(parsed) ? parsed : [];
    }

    function findProductByModel(list, modelInput) {
        const model = normalizeModelKey(modelInput);
        if (!model) {
            return null;
        }
        const rows = Array.isArray(list) ? list : [];
        let partial = null;
        for (let i = 0; i < rows.length; i += 1) {
            const row = rows[i] && typeof rows[i] === "object" ? rows[i] : {};
            const candidate = normalizeModelKey(row.model);
            if (!candidate) {
                continue;
            }
            if (candidate === model) {
                return row;
            }
            if (!partial && (candidate.includes(model) || model.includes(candidate))) {
                partial = row;
            }
        }
        return partial;
    }

    function setStatus(message, tone) {
        if (!modelStatusEl) {
            return;
        }
        modelStatusEl.textContent = String(message || "");
        modelStatusEl.classList.remove("error");
        if (tone === "error") {
            modelStatusEl.classList.add("error");
        }
    }

    function readModelSpecs(model) {
        const specsState = safeParse(localStorage.getItem(MODEL_SPEC_STORAGE_KEY));
        if (!specsState || typeof specsState !== "object") {
            return null;
        }
        const key = normalizeModelKey(model);
        if (!key) {
            return null;
        }
        const entry = specsState[key];
        if (!entry || typeof entry !== "object") {
            return null;
        }
        return {
            power: normalizeText(entry.power),
            battery: normalizeText(entry.battery),
            batteryType: normalizeText(entry.batteryType || entry.battery_type),
            speed: normalizeText(entry.speed),
            range: normalizeText(entry.range),
            chargingTime: normalizeText(entry.chargingTime || entry.charging_time)
        };
    }

    function renderSpecs(product) {
        if (!modelSpecsEl) {
            return;
        }
        const list = [];
        const specs = readModelSpecs(product.model);
        if (specs) {
            if (specs.power) list.push({ label: "Power", value: specs.power });
            if (specs.battery) list.push({ label: "Battery", value: specs.battery });
            if (specs.batteryType) list.push({ label: "Battery Type", value: specs.batteryType });
            if (specs.speed) list.push({ label: "Speed", value: specs.speed });
            if (specs.range) list.push({ label: "Range", value: specs.range });
            if (specs.chargingTime) list.push({ label: "Charging Time", value: specs.chargingTime });
        }
        if (!list.length) {
            list.push({ label: "Category", value: normalizeText(product.category) || "E-Bike" });
        }

        modelSpecsEl.innerHTML = "";
        list.forEach(function (item) {
            const li = document.createElement("li");
            li.innerHTML = `<strong>${item.label}:</strong> ${item.value}`;
            modelSpecsEl.appendChild(li);
        });
    }

    function toBookingUrl(product) {
        const params = new URLSearchParams();
        params.set("model", String(product.model || "Ecodrive E-Bike"));
        params.set("price", String(Number(product.price || 0)));
        params.set("subtitle", String(product.category || "E-Bike"));
        params.set("info", String(product.info || ""));
        const image = String(product.imageUrl || "").trim();
        if (image && !isInlineDataImage(image) && image.length <= 1000) {
            params.set("image", image);
        }
        return `../payment/booking.html?${params.toString()}`;
    }

    function persistSelection(product) {
        const image = String(product.imageUrl || "").trim();
        const payload = {
            model: String(product.model || "Ecodrive E-Bike"),
            total: Number(product.price || 0),
            image: image || "../image 1.png",
            bikeImage: image || "../image 1.png",
            subtitle: String(product.category || "E-Bike"),
            bikeColor: "",
            color: "",
            selectedColor: ""
        };
        CHECKOUT_SELECTION_KEYS.forEach(function (key) {
            localStorage.setItem(key, JSON.stringify(payload));
        });
    }

    function renderProduct(productInput) {
        const product = productInput && typeof productInput === "object" ? productInput : {};
        currentProduct = product;
        const model = normalizeText(product.model) || "Ecodrive E-Bike";
        const category = normalizeText(product.category) || "E-Bike";
        const info = normalizeText(product.info) || "No additional information yet for this model.";
        const image = String(product.imageUrl || "").trim() || "../image 1.png";

        document.title = `Ecodrive - ${model}`;
        modelChipEl.textContent = category;
        modelTitleEl.textContent = `MODEL: ${model}`;
        modelPriceEl.textContent = `Price: ${formatPeso(product.price)}`;
        modelInfoEl.textContent = info;
        modelImageEl.src = image;
        modelImageEl.alt = `${model} image`;
        renderSpecs(product);
        bookNowBtn.disabled = false;
        setStatus("", "");
    }

    function renderUnavailable(message) {
        currentProduct = null;
        document.title = "Ecodrive Model Unavailable";
        modelChipEl.textContent = "Unavailable";
        modelTitleEl.textContent = "MODEL NOT AVAILABLE";
        modelPriceEl.textContent = "Price: PHP 0.00";
        modelInfoEl.textContent = "This model was removed or is not active right now.";
        modelImageEl.src = "../image 1.png";
        modelImageEl.alt = "Unavailable model";
        modelSpecsEl.innerHTML = "";
        const note = document.createElement("li");
        note.innerHTML = "<strong>Notice:</strong> This model is not available for booking.";
        modelSpecsEl.appendChild(note);
        bookNowBtn.disabled = true;
        setStatus(message || "Model unavailable.", "error");
    }

    async function fetchProductById(productId) {
        try {
            const response = await fetch(getApiUrl(`/api/products/${encodeURIComponent(productId)}`), {
                method: "GET"
            });
            const payload = await response.json().catch(function () {
                return {};
            });
            if (!response.ok || !payload || payload.success !== true || !payload.product) {
                return {
                    ok: false,
                    message: payload && payload.message ? payload.message : "Unable to load model details."
                };
            }
            return {
                ok: true,
                product: payload.product
            };
        } catch (_error) {
            return { ok: false, message: "Unable to load model details right now." };
        }
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
            localStorage.setItem(PRODUCT_STORAGE_KEY, JSON.stringify(payload.products));
            return payload.products;
        } catch (_error) {
            return [];
        }
    }

    function wireProfileMenu() {
        if (profileBtn && dropdown) {
            profileBtn.addEventListener("click", function (event) {
                event.stopPropagation();
                dropdown.classList.toggle("show");
            });
            dropdown.addEventListener("click", function (event) {
                event.stopPropagation();
            });
            document.addEventListener("click", function () {
                dropdown.classList.remove("show");
            });
        }

        if (logoutBtn) {
            logoutBtn.addEventListener("click", function (event) {
                event.preventDefault();
                if (window.EcodriveSession && typeof window.EcodriveSession.logout === "function") {
                    window.EcodriveSession.logout("../../frontpage.html");
                    return;
                }
                window.location.href = "../../frontpage.html";
            });
        }
    }

    async function init() {
        wireProfileMenu();

        if (bookNowBtn) {
            bookNowBtn.addEventListener("click", function () {
                if (!currentProduct) {
                    setStatus("This model is unavailable for booking.", "error");
                    return;
                }
                persistSelection(currentProduct);
                window.location.href = toBookingUrl(currentProduct);
            });
        }

        const productId = parseProductIdFromQuery();
        if (productId > 0) {
            const result = await fetchProductById(productId);
            if (result.ok && result.product) {
                renderProduct(result.product);
                return;
            }
            renderUnavailable(result.message || "Model not found.");
            return;
        }

        const queryModel = parseModelFromQuery();
        if (queryModel) {
            const apiCatalog = await fetchCatalogFromApi();
            const product = findProductByModel(apiCatalog, queryModel)
                || findProductByModel(readCatalogFromLocal(), queryModel);
            if (product) {
                renderProduct(product);
                return;
            }
        }

        renderUnavailable("Model not found.");
    }

    init();
})();
