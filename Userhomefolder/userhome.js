const profileBtn = document.querySelector(".profile-btn");
const dropdown = document.querySelector(".dropdown");

if (profileBtn && dropdown) {
    profileBtn.addEventListener("click", function (event) {
        event.stopPropagation();
        dropdown.classList.toggle("show");
    });

    document.addEventListener("click", function () {
        dropdown.classList.remove("show");
    });
}

(function () {
    const QUICK_BOOK_STORAGE_KEY = "ecodrive_home_quick_book_v1";
    const CHAT_STORAGE_KEY = "ecodrive_chat_messages_v1";
    const MAX_MESSAGES = 80;
    const CATEGORY_ROUTE_MAP = {
        "all": "userhome2.html",
        "2-wheel": "userhome2-2wheel.html",
        "3-wheel": "userhome2-3wheel.html",
        "4-wheel": "userhome2-4wheel.html"
    };
    const FALLBACK_CATALOG = [
        { id: 1, model: "BLITZ 2000", category: "2-Wheel", price: 68000, imageUrl: "image 1.png", detailUrl: "Ebikes/ebike1.0.html", stockCount: 1 },
        { id: 2, model: "BLITZ 1200", category: "2-Wheel", price: 45000, imageUrl: "image 2.png", detailUrl: "Ebikes/ebike2.0.html", stockCount: 1 },
        { id: 3, model: "FUN 350R II", category: "2-Wheel", price: 24000, imageUrl: "image 3.png", detailUrl: "Ebikes/ebike3.0.html", stockCount: 1 },
        { id: 7, model: "ECONO 500 MP", category: "3-Wheel", price: 51000, imageUrl: "image 7.png", detailUrl: "Ebikes/ebike7.0.html", stockCount: 1 },
        { id: 8, model: "ECONO 350 MINI-II", category: "3-Wheel", price: 39000, imageUrl: "image 8.png", detailUrl: "Ebikes/ebike8.0.html", stockCount: 1 },
        { id: 12, model: "ECONO 800 MP II", category: "3-Wheel", price: 67000, imageUrl: "image 12.png", detailUrl: "Ebikes/ebike12.0.html", stockCount: 1 },
        { id: 13, model: "E-CARGO 800J", category: "3-Wheel", price: 65000, imageUrl: "image 13.png", detailUrl: "Ebikes/ebike13.0.html", stockCount: 1 }
    ];
    const BEST_SELLER_CONFIG = [
        {
            matchers: ["ECONO 350 MINI-II"],
            detailId: 8,
            badge: "Best Seller",
            label: "ECONO 350 MINI-II",
            ratingLabel: "Top city pick"
        },
        {
            matchers: ["ECONO 500 MP"],
            detailId: 7,
            badge: "Popular",
            label: "ECONO 500 MP",
            ratingLabel: "Most requested"
        },
        {
            matchers: ["ECONO 800 MP II"],
            detailId: 12,
            badge: "Trusted",
            label: "ECONO 800 MP II",
            ratingLabel: "Showroom favorite"
        }
    ];
    const NEW_ARRIVAL_CONFIG = [
        {
            matchers: ["BLITZ 1200"],
            detailId: 2,
            badge: "New Arrival",
            label: "BLITZ 1200",
            ratingLabel: "Fresh in stock"
        },
        {
            matchers: ["BLITZ 2000"],
            detailId: 1,
            badge: "New Arrival",
            label: "BLITZ 2000",
            ratingLabel: "Fast commuter"
        },
        {
            matchers: ["FUN 350", "FUN 350R II", "FUN 1500 FI"],
            detailId: 3,
            badge: "New Arrival",
            label: "FUN 350",
            ratingLabel: "Compact ride"
        },
        {
            matchers: ["E-CARGO 800J", "E-CARGO 800"],
            detailId: 13,
            badge: "New Arrival",
            label: "E-CARGO 800J",
            ratingLabel: "Cargo ready"
        }
    ];
    const DEAL_CONFIG = [
        {
            matchers: ["BLITZ 1200"],
            detailId: 2,
            badge: "Hot Pick",
            label: "BLITZ 1200",
            ratingLabel: "Daily commute"
        },
        {
            matchers: ["ECONO 500 MP"],
            detailId: 7,
            badge: "Hot Pick",
            label: "ECONO 500 MP",
            ratingLabel: "Passenger ready"
        },
        {
            matchers: ["FUN 350", "FUN 350R II", "FUN 1500 FI"],
            detailId: 3,
            badge: "Spotlight",
            label: "FUN 350",
            ratingLabel: "Quick errands"
        },
        {
            matchers: ["E-CARGO 800J", "E-CARGO 800"],
            detailId: 13,
            badge: "Spotlight",
            label: "E-CARGO 800J",
            ratingLabel: "Workhorse"
        }
    ];
    const smartReply = (window.EcodriveChatbotBrain && typeof window.EcodriveChatbotBrain.createResponder === "function")
        ? window.EcodriveChatbotBrain.createResponder()
        : null;

    function normalizeText(value) {
        return String(value || "").trim().replace(/\s+/g, " ");
    }

    function normalizeKey(value) {
        return normalizeText(value)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "");
    }

    function formatCurrency(value) {
        const amount = Number(value || 0);
        return new Intl.NumberFormat("en-PH", {
            style: "currency",
            currency: "PHP",
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(amount);
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

    function normalizeColorVariants(input) {
        if (typeof input === "string") {
            try {
                input = JSON.parse(input);
            } catch (_error) {
                input = [];
            }
        }
        if (input && !Array.isArray(input) && typeof input === "object" && Array.isArray(input.variants)) {
            input = input.variants;
        }
        return Array.isArray(input) ? input : [];
    }

    function hasAvailableColorVariants(variantsInput) {
        return normalizeColorVariants(variantsInput).some(function (variant) {
            if (!variant || typeof variant !== "object") {
                return false;
            }
            const isActive = !(
                variant.isActive === false
                || variant.is_active === false
                || variant.isActive === 0
                || variant.is_active === 0
                || variant.isActive === "0"
                || variant.is_active === "0"
            );
            return isActive && normalizeStockCount(
                variant.stockCount !== undefined ? variant.stockCount : variant.stock_count,
                isActive ? 1 : 0
            ) > 0;
        });
    }

    function isProductAvailable(product) {
        if (!product || product.isActive === false || product.is_active === false) {
            return false;
        }
        const stockCount = normalizeStockCount(
            product.stockCount !== undefined ? product.stockCount : product.stock_count,
            product.isActive === false || product.is_active === false ? 0 : 1
        );
        return stockCount > 0 || hasAvailableColorVariants(product.colorVariants || product.color_variants || product.color_variants_json);
    }

    function extractDetailId(product) {
        const detailUrl = String(product && product.detailUrl || "").trim();
        const match = detailUrl.match(/ebike(\d+)\.0\.html/i);
        return match ? Number(match[1]) : 0;
    }

    function getProductHref(product) {
        const detailUrl = String(product && product.detailUrl || "").trim();
        return detailUrl || "userhome2.html";
    }

    function getCatalog() {
        if (window.EcodriveCatalog && typeof window.EcodriveCatalog.loadCatalog === "function") {
            return window.EcodriveCatalog.loadCatalog().catch(function () {
                return FALLBACK_CATALOG.slice();
            });
        }
        if (window.EcodriveCatalog && typeof window.EcodriveCatalog.getCachedCatalog === "function") {
            return Promise.resolve(window.EcodriveCatalog.getCachedCatalog());
        }
        return Promise.resolve(FALLBACK_CATALOG.slice());
    }

    function cloneFeaturedProduct(product, config) {
        return {
            id: product.id,
            detailUrl: getProductHref(product),
            imageUrl: String(product.imageUrl || "").trim(),
            model: config.label || product.model || "Ecodrive E-Bike",
            category: product.category || "E-Bike",
            price: Number(product.price || 0),
            badge: config.badge || "Featured",
            ratingLabel: config.ratingLabel || product.category || "Showroom pick"
        };
    }

    function matchesFeaturedConfig(product, config) {
        const detailId = extractDetailId(product);
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

    function pickConfiguredProducts(catalog, configs) {
        const usedKeys = new Set();
        const availableCatalog = (Array.isArray(catalog) ? catalog : []).filter(isProductAvailable);

        return configs
            .map(function (config) {
                const match = availableCatalog.find(function (product) {
                    const productKey = String(product.id || "") + "|" + String(product.detailUrl || product.model || "");
                    if (usedKeys.has(productKey)) {
                        return false;
                    }
                    return matchesFeaturedConfig(product, config);
                });

                if (!match) {
                    return null;
                }

                usedKeys.add(String(match.id || "") + "|" + String(match.detailUrl || match.model || ""));
                return cloneFeaturedProduct(match, config);
            })
            .filter(Boolean);
    }

    function createEmptyState(message) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = message;
        return empty;
    }

    function createProductCard(product, options) {
        const opts = options && typeof options === "object" ? options : {};
        const card = document.createElement("article");
        card.className = "home-product-card" + (opts.compact ? " compact-card" : "");

        const topline = document.createElement("div");
        topline.className = "card-topline";

        const badge = document.createElement("span");
        badge.className = "card-badge";
        badge.textContent = product.badge || opts.badge || "Featured";
        topline.appendChild(badge);

        const caption = document.createElement("small");
        caption.textContent = opts.caption || "Ready to ride";
        topline.appendChild(caption);
        card.appendChild(topline);

        const media = document.createElement("div");
        media.className = "card-media";
        const image = document.createElement("img");
        image.src = product.imageUrl || "image 2.png";
        image.alt = product.model || "Ecodrive E-Bike";
        media.appendChild(image);
        card.appendChild(media);

        const body = document.createElement("div");
        body.className = "card-body";

        const title = document.createElement("h3");
        title.className = "card-model";
        title.textContent = product.model || "Ecodrive E-Bike";
        body.appendChild(title);

        const meta = document.createElement("p");
        meta.className = "card-meta";
        meta.textContent = opts.description || "Showroom-ready electric vehicle for everyday routes.";
        body.appendChild(meta);

        const rating = document.createElement("div");
        rating.className = "rating-row";
        rating.innerHTML = "<span class=\"stars\">★★★★★</span>";
        const ratingNote = document.createElement("span");
        ratingNote.className = "rating-note";
        ratingNote.textContent = product.ratingLabel || opts.caption || product.category || "Featured";
        rating.appendChild(ratingNote);
        body.appendChild(rating);

        const priceRow = document.createElement("div");
        priceRow.className = "card-price-row";

        const price = document.createElement("p");
        price.className = "card-price";
        price.textContent = formatCurrency(product.price);
        priceRow.appendChild(price);

        const category = document.createElement("span");
        category.className = "card-category";
        category.textContent = product.category || "E-Bike";
        priceRow.appendChild(category);
        body.appendChild(priceRow);

        const action = document.createElement("button");
        action.className = "card-action";
        action.type = "button";
        action.textContent = opts.buttonLabel || "View Model";
        action.addEventListener("click", function () {
            window.location.href = product.detailUrl || "userhome2.html";
        });
        body.appendChild(action);

        card.appendChild(body);
        return card;
    }

    function renderCardList(container, products, options) {
        if (!container) {
            return;
        }

        container.innerHTML = "";
        if (!products.length) {
            container.appendChild(createEmptyState("No available models to show right now."));
            return;
        }

        const fragment = document.createDocumentFragment();
        products.forEach(function (product) {
            fragment.appendChild(createProductCard(product, options));
        });
        container.appendChild(fragment);
    }

    function setupQuickBookForm() {
        const form = document.getElementById("quick-book-form");
        const categoryInput = document.getElementById("quick-category");
        const dateInput = document.getElementById("quick-date");
        const locationInput = document.getElementById("quick-location");

        if (!(form && categoryInput && dateInput && locationInput)) {
            return;
        }

        const today = new Date();
        const isoDate = new Date(today.getTime() - (today.getTimezoneOffset() * 60000)).toISOString().split("T")[0];
        dateInput.min = isoDate;

        try {
            const saved = JSON.parse(localStorage.getItem(QUICK_BOOK_STORAGE_KEY) || "null");
            if (saved && typeof saved === "object") {
                if (saved.category && CATEGORY_ROUTE_MAP[String(saved.category).toLowerCase()]) {
                    categoryInput.value = saved.category;
                }
                if (saved.date) {
                    dateInput.value = saved.date;
                }
                if (saved.location) {
                    locationInput.value = saved.location;
                }
            }
        } catch (_error) {
            // ignore malformed draft
        }

        form.addEventListener("submit", function (event) {
            event.preventDefault();

            const draft = {
                category: String(categoryInput.value || "all"),
                date: String(dateInput.value || ""),
                location: normalizeText(locationInput.value || "")
            };
            localStorage.setItem(QUICK_BOOK_STORAGE_KEY, JSON.stringify(draft));

            const route = CATEGORY_ROUTE_MAP[String(draft.category).toLowerCase()] || CATEGORY_ROUTE_MAP.all;
            window.location.href = route;
        });
    }

    async function renderHomepageSections() {
        const bestSellerGrid = document.getElementById("best-sellers-grid");
        const newArrivalGrid = document.getElementById("new-arrivals-grid");
        const dealGrid = document.getElementById("deal-grid");

        if (!(bestSellerGrid || newArrivalGrid || dealGrid)) {
            return;
        }

        const catalog = await getCatalog();
        const bestSellers = pickConfiguredProducts(catalog, BEST_SELLER_CONFIG);
        const newArrivals = pickConfiguredProducts(catalog, NEW_ARRIVAL_CONFIG);
        const dealPicks = pickConfiguredProducts(catalog, DEAL_CONFIG);

        renderCardList(bestSellerGrid, bestSellers, {
            caption: "Best seller",
            description: "Reliable picks that customers usually check out first.",
            buttonLabel: "View Model"
        });
        renderCardList(newArrivalGrid, newArrivals, {
            compact: true,
            caption: "Just arrived",
            description: "New units now highlighted on the homepage.",
            buttonLabel: "See Details"
        });
        renderCardList(dealGrid, dealPicks, {
            compact: true,
            caption: "Featured deal",
            description: "Recommended models for commute, negosyo, and cargo work.",
            buttonLabel: "Open Model"
        });
    }

    function setupChatbot() {
        const toggle = document.getElementById("chatbot-toggle");
        const panel = document.getElementById("chat-panel");
        const closeBtn = document.getElementById("chat-close");
        const form = document.getElementById("chat-form");
        const input = document.getElementById("chat-input");
        const body = document.getElementById("chat-body");
        let liveChatRuntime = null;

        if (!(toggle && panel && closeBtn && form && input && body)) {
            return;
        }

        let messages = [];
        try {
            const parsed = JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) || "[]");
            if (Array.isArray(parsed)) {
                messages = parsed
                    .filter(function (entry) {
                        return entry && (entry.from === "user" || entry.from === "bot") && typeof entry.text === "string";
                    })
                    .slice(-MAX_MESSAGES);
            }
        } catch (_error) {
            messages = [];
        }

        function saveMessages() {
            localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages));
        }

        function renderMessage(message) {
            const element = document.createElement("div");
            element.className = "chat-message " + (message.from === "user" ? "user" : "bot");
            element.textContent = message.text;
            body.appendChild(element);
            body.scrollTop = body.scrollHeight;
        }

        function renderAllMessages() {
            body.innerHTML = "";
            messages.forEach(renderMessage);
        }

        function appendMessage(message, options) {
            const opts = options && typeof options === "object" ? options : {};
            messages.push(message);
            if (messages.length > MAX_MESSAGES) {
                messages = messages.slice(messages.length - MAX_MESSAGES);
            }
            saveMessages();
            renderMessage(message);
            if (!opts.skipSync && liveChatRuntime) {
                void liveChatRuntime.notifyLocalMessagesUpdated();
            }
        }

        function renderTyping() {
            const typing = document.createElement("div");
            typing.className = "chat-message bot typing";
            typing.textContent = "Typing...";
            typing.dataset.typing = "1";
            body.appendChild(typing);
            body.scrollTop = body.scrollHeight;
        }

        function removeTyping() {
            const typing = body.querySelector("[data-typing]");
            if (typing) {
                typing.remove();
            }
        }

        function sendBotReply(text) {
            if (liveChatRuntime && !liveChatRuntime.canBotReply()) {
                return;
            }
            const reply = smartReply
                ? smartReply(text)
                : "I can help with ebike models, prices, booking status, payment, installment, delivery, and repair.";

            renderTyping();
            setTimeout(function () {
                removeTyping();
                if (liveChatRuntime && !liveChatRuntime.canBotReply()) {
                    return;
                }
                appendMessage({ from: "bot", text: reply, time: Date.now() });
            }, 700 + Math.random() * 450);
        }

        function openPanel() {
            panel.classList.add("open");
            panel.setAttribute("aria-hidden", "false");
            renderAllMessages();
            input.focus();
            if (liveChatRuntime) {
                void liveChatRuntime.refreshFromServer();
            }
        }

        function closePanel() {
            panel.classList.remove("open");
            panel.setAttribute("aria-hidden", "true");
        }

        toggle.addEventListener("click", function (event) {
            event.stopPropagation();
            if (panel.classList.contains("open")) {
                closePanel();
            } else {
                openPanel();
            }
        });

        closeBtn.addEventListener("click", function (event) {
            event.stopPropagation();
            closePanel();
        });

        form.addEventListener("submit", function (event) {
            event.preventDefault();
            const text = normalizeText(input.value);
            if (!text) {
                return;
            }

            appendMessage({ from: "user", text: text, time: Date.now() });
            input.value = "";
            sendBotReply(text);
        });

        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape") {
                closePanel();
            }
        });

        if (messages.length === 0) {
            messages = [{
                from: "bot",
                text: "Hi! I'm Ecodrive Bot. Ask me about Ecodrive ebikes, prices, booking status, payment, or repair.",
                time: Date.now()
            }];
            saveMessages();
        }

        if (window.EcodriveChatbotBrain && typeof window.EcodriveChatbotBrain.attachLiveChat === "function") {
            liveChatRuntime = window.EcodriveChatbotBrain.attachLiveChat({
                getMessages: function () {
                    return messages;
                },
                setMessages: function (nextMessages) {
                    messages = Array.isArray(nextMessages) ? nextMessages : [];
                    saveMessages();
                    if (panel.classList.contains("open")) {
                        renderAllMessages();
                    }
                }
            });
            void liveChatRuntime.notifyLocalMessagesUpdated();
        }
    }

    document.addEventListener("DOMContentLoaded", function () {
        setupQuickBookForm();
        void renderHomepageSections();
        setupChatbot();
    });
})();
