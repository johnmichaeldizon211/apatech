document.addEventListener("DOMContentLoaded", function () {
    const storageKey = "ecodrive_product_catalog";
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

    const gridEl = document.getElementById("product-grid");
    const statusEl = document.getElementById("price-status");

    if (!gridEl || !statusEl) {
        return;
    }

    const defaultProducts = [
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

    let products = [];
    let apiAvailable = false;

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

    function toFiniteNumber(value, fallback) {
        const num = Number(value);
        if (!Number.isFinite(num)) {
            return fallback;
        }
        return num;
    }

    function normalizeModelKey(value) {
        return String(value || "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
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

    function formatPeso(amount) {
        return String.fromCharCode(8369) + toFiniteNumber(amount, 0).toLocaleString("en-PH", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
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

                    if (luminance < 205 || saturation > 85) {
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

                const componentSeen = new Uint8Array(total);
                const queue = [];
                const component = [];
                const strongLightThreshold = Math.max(900, Math.floor(total * 0.01));
                const mediumLightThreshold = Math.max(260, Math.floor(total * 0.002));

                function isStrongLightPixel(index) {
                    const offset = index * 4;
                    const alpha = pixels[offset + 3];
                    if (!alpha) {
                        return false;
                    }
                    const red = pixels[offset];
                    const green = pixels[offset + 1];
                    const blue = pixels[offset + 2];
                    const max = Math.max(red, green, blue);
                    const min = Math.min(red, green, blue);
                    const luminance = (red + green + blue) / 3;
                    const saturation = max - min;
                    return luminance >= 205 && saturation <= 108;
                }

                for (let seed = 0; seed < total; seed += 1) {
                    if (componentSeen[seed] || !isStrongLightPixel(seed)) {
                        continue;
                    }

                    component.length = 0;
                    queue.length = 0;
                    let touchesBorder = false;
                    let minX = width;
                    let minY = height;
                    let maxX = 0;
                    let maxY = 0;
                    componentSeen[seed] = 1;
                    queue.push(seed);

                    while (queue.length) {
                        const index = queue.pop();
                        component.push(index);

                        const y = Math.floor(index / width);
                        const x = index - (y * width);
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
                            touchesBorder = true;
                        }

                        const neighbors = [];
                        if (x > 0) neighbors.push(index - 1);
                        if (x < width - 1) neighbors.push(index + 1);
                        if (y > 0) neighbors.push(index - width);
                        if (y < height - 1) neighbors.push(index + width);

                        for (let n = 0; n < neighbors.length; n += 1) {
                            const neighbor = neighbors[n];
                            if (componentSeen[neighbor] || !isStrongLightPixel(neighbor)) {
                                continue;
                            }
                            componentSeen[neighbor] = 1;
                            queue.push(neighbor);
                        }
                    }

                    const bboxArea = Math.max(1, (maxX - minX + 1) * (maxY - minY + 1));
                    const fillRatio = component.length / bboxArea;
                    const shouldRemoveComponent = touchesBorder
                        || component.length >= strongLightThreshold
                        || (component.length >= mediumLightThreshold && fillRatio >= 0.42);
                    if (shouldRemoveComponent) {
                        for (let c = 0; c < component.length; c += 1) {
                            pixels[(component[c] * 4) + 3] = 0;
                        }
                    }
                }

                const foregroundMask = new Uint8Array(total);
                let seedCount = 0;
                for (let index = 0; index < total; index += 1) {
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
                    if (luminance <= 182 || saturation >= 48) {
                        foregroundMask[index] = 1;
                        seedCount += 1;
                    }
                }

                if (seedCount > 120) {
                    const growSteps = Math.max(2, Math.min(5, Math.round(Math.min(width, height) * 0.008)));
                    let activeMask = foregroundMask;
                    for (let step = 0; step < growSteps; step += 1) {
                        const nextMask = activeMask.slice();
                        for (let index = 0; index < total; index += 1) {
                            if (!activeMask[index]) {
                                continue;
                            }
                            const y = Math.floor(index / width);
                            const x = index - (y * width);
                            if (x > 0) nextMask[index - 1] = 1;
                            if (x < width - 1) nextMask[index + 1] = 1;
                            if (y > 0) nextMask[index - width] = 1;
                            if (y < height - 1) nextMask[index + width] = 1;
                        }
                        activeMask = nextMask;
                    }

                    for (let index = 0; index < total; index += 1) {
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
                        if (luminance >= 186 && saturation <= 124 && !activeMask[index]) {
                            pixels[offset + 3] = 0;
                        }
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

                    if (luminance >= 225 && saturation <= 90) {
                        pixels[offset + 3] = Math.round(alpha * 0.08);
                    } else if (luminance >= 205 && saturation <= 108) {
                        pixels[offset + 3] = Math.round(alpha * 0.32);
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

    function getCategoryOrder(category) {
        if (category === "2-Wheel") return 1;
        if (category === "3-Wheel") return 2;
        if (category === "4-Wheel") return 3;
        return 4;
    }

    function sortProducts(items) {
        return items.slice().sort(function (left, right) {
            const categoryDiff = getCategoryOrder(left.category) - getCategoryOrder(right.category);
            if (categoryDiff !== 0) {
                return categoryDiff;
            }
            return String(left.model || "").localeCompare(String(right.model || ""));
        });
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

    function dedupeProductsByModelAndCategory(items) {
        const rows = Array.isArray(items) ? items : [];
        const byKey = {};
        const keyOrder = [];

        rows.forEach(function (product) {
            const modelKey = normalizeModelKey(product.model);
            const categoryKey = normalizeCategory(product.category);
            if (!modelKey) {
                return;
            }
            const dedupeKey = `${modelKey}__${categoryKey}`;
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

    function normalizeProduct(input, fallbackId) {
        const source = input && typeof input === "object" ? input : {};
        const model = normalizeText(source.model || source.name).slice(0, 180);
        if (!model) {
            return null;
        }

        const parsedPrice = parsePrice(source.price);
        const price = Number.isFinite(parsedPrice) ? parsedPrice : 0;
        const rawId = Number(source.id);
        const id = Number.isFinite(rawId) && rawId > 0 ? rawId : Number(fallbackId || 0);
        const imageUrl = String(source.imageUrl || source.image || source.bikeImage || "").trim();
        const detailUrl = String(source.detailUrl || source.detailsUrl || "").trim();
        const normalizedDetailUrl = resolveAssetPath(detailUrl);
        const info = normalizeText(source.info || source.productInfo || source.description).slice(0, 255);

        return {
            id: id,
            model: model,
            price: price,
            category: resolveCategory(source.category, normalizedDetailUrl || detailUrl),
            info: info,
            imageUrl: resolveAssetPath(imageUrl || "/Userhomefolder/image 1.png"),
            detailUrl: normalizedDetailUrl,
            isActive: toIsActive(source.isActive)
        };
    }

    function sanitizeProducts(input) {
        const rows = Array.isArray(input) ? input : [];
        const list = [];
        rows.forEach(function (row, index) {
            const normalized = normalizeProduct(row, index + 1);
            if (normalized) {
                list.push(normalized);
            }
        });
        return sortProducts(dedupeProductsByModelAndCategory(list));
    }

    function readProductsFromLocal() {
        const parsed = safeParse(localStorage.getItem(storageKey));
        if (!Array.isArray(parsed)) {
            return [];
        }
        return sanitizeProducts(parsed);
    }

    function saveProductsToLocal(list) {
        localStorage.setItem(storageKey, JSON.stringify(sanitizeProducts(list)));
    }

    function setStatus(message, tone) {
        statusEl.textContent = message;
        statusEl.classList.remove("is-success", "is-warning", "is-error");
        if (tone === "success") {
            statusEl.classList.add("is-success");
        } else if (tone === "warning") {
            statusEl.classList.add("is-warning");
        } else if (tone === "error") {
            statusEl.classList.add("is-error");
        }
    }

    function createPriceLabel(product) {
        const wrapper = document.createElement("p");
        wrapper.className = "price";

        const priceText = document.createElement("span");
        priceText.textContent = `Price: ${formatPeso(product.price)}`;
        wrapper.appendChild(priceText);

        const editButton = document.createElement("button");
        editButton.className = "edit-btn";
        editButton.type = "button";
        editButton.setAttribute("data-id", String(product.id));
        editButton.setAttribute("aria-label", `Edit ${product.model}`);
        editButton.innerHTML = "&#9998;";
        wrapper.appendChild(editButton);

        return wrapper;
    }

    function createProductCard(product) {
        const card = document.createElement("article");
        card.className = "panel product-card";

        const image = document.createElement("img");
        const sourceImage = resolveAssetPath(product.imageUrl || "/Userhomefolder/image 1.png");
        image.alt = product.model;
        image.loading = "lazy";
        image.decoding = "async";
        image.onload = function () {
            stripLightBackdropFromImage(image);
        };
        image.onerror = function () {
            image.onerror = null;
            image.removeAttribute("data-bg-processed");
            image.src = resolveAssetPath("/Userhomefolder/image 1.png");
        };
        image.src = sourceImage;
        if (image.complete && Number(image.naturalWidth || 0) > 0) {
            requestAnimationFrame(function () {
                stripLightBackdropFromImage(image);
            });
        }
        card.appendChild(image);

        const title = document.createElement("h3");
        title.textContent = product.model;
        card.appendChild(title);

        const category = document.createElement("p");
        category.className = "product-category";
        category.textContent = product.category || "Other";
        card.appendChild(category);

        card.appendChild(createPriceLabel(product));
        return card;
    }

    function renderProducts() {
        gridEl.innerHTML = "";
        const activeProducts = products.filter(function (item) {
            return item.isActive !== false;
        });

        if (!activeProducts.length) {
            const emptyCard = document.createElement("article");
            emptyCard.className = "panel product-card product-card-empty";
            emptyCard.textContent = "No models available.";
            gridEl.appendChild(emptyCard);
            return;
        }

        const fragment = document.createDocumentFragment();
        activeProducts.forEach(function (product) {
            fragment.appendChild(createProductCard(product));
        });
        gridEl.appendChild(fragment);
        requestAnimationFrame(function () {
            const images = Array.from(gridEl.querySelectorAll(".product-card img"));
            images.forEach(function (img) {
                if (img.complete && Number(img.naturalWidth || 0) > 0) {
                    stripLightBackdropFromImage(img);
                }
            });
        });
    }

    function findProductById(id) {
        return products.find(function (item) {
            return Number(item.id) === Number(id);
        }) || null;
    }

    async function fetchProductsFromApi() {
        try {
            const response = await fetch(getApiUrl("/api/admin/products"), {
                method: "GET"
            });

            if (response.status === 404 || response.status === 405) {
                return { mode: "unavailable", products: [] };
            }

            const payload = await response.json().catch(function () {
                return {};
            });
            if (!response.ok || payload.success !== true) {
                return {
                    mode: "error",
                    message: payload.message || "Failed to load products."
                };
            }

            return {
                mode: "ok",
                products: sanitizeProducts(payload.products)
            };
        } catch (_error) {
            return { mode: "unavailable", products: [] };
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

    async function handleEdit(productId) {
        const target = findProductById(productId);
        if (!target) {
            return;
        }

        const rawPrice = window.prompt(
            `Update price for ${target.model}:`,
            String(target.price)
        );
        if (rawPrice === null) {
            return;
        }

        const nextPrice = parsePrice(rawPrice);
        if (!Number.isFinite(nextPrice)) {
            window.alert("Invalid price. Enter numbers only.");
            return;
        }

        if (apiAvailable && Number(target.id) > 0) {
            const apiResult = await updateProductViaApi(target.id, { price: nextPrice });
            if (apiResult.mode === "ok" && apiResult.product) {
                products = sanitizeProducts(products.map(function (item) {
                    return Number(item.id) === Number(target.id) ? apiResult.product : item;
                }));
                saveProductsToLocal(products);
                renderProducts();
                setStatus(`Updated ${target.model} price.`, "success");
                return;
            }

            if (apiResult.mode === "error") {
                window.alert(apiResult.message || "Unable to update model price.");
                return;
            }
        }
        window.alert("Unable to update model price because the API is unavailable.");
    }

    gridEl.addEventListener("click", function (event) {
        const button = event.target.closest(".edit-btn");
        if (!button) {
            return;
        }
        const productId = Number(button.getAttribute("data-id"));
        if (!Number.isFinite(productId)) {
            return;
        }
        void handleEdit(productId);
    });

    window.addEventListener("storage", function (event) {
        if (event.key !== storageKey || apiAvailable) {
            return;
        }
        products = readProductsFromLocal();
        renderProducts();
    });

    async function init() {
        setStatus("Loading models...", "warning");
        const apiResult = await fetchProductsFromApi();

        if (apiResult.mode === "ok") {
            apiAvailable = true;
            products = apiResult.products.length
                ? apiResult.products
                : [];
            saveProductsToLocal(products);
            renderProducts();
            setStatus("", "");
            return;
        }

        products = readProductsFromLocal();
        renderProducts();

        if (products.length) {
            setStatus("Live API unavailable. Showing last synced catalog.", "warning");
            return;
        }

        if (apiResult.mode === "error") {
            setStatus(apiResult.message || "Unable to load product catalog.", "error");
            return;
        }

        setStatus("API unavailable. Unable to load product catalog.", "error");
    }

    void init();
});

