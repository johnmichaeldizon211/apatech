(function (global) {
    "use strict";

    var CART_STORAGE_PREFIX = "ecodrive_cart::";
    var CHECKOUT_SELECTION_KEYS = [
        "ecodrive_checkout_selection",
        "ecodrive_selected_bike",
        "selectedBike"
    ];
    var CURRENT_FILE = String((global.location && global.location.pathname || "").split("/").pop() || "").toLowerCase();
    var CART_PAGE_ID = "cart-root";
    var TOAST_STACK_ID = "ecodrive-cart-toast-stack";

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

    function normalizeQuantity(value, fallbackValue) {
        var parsed = Number.parseInt(String(value === undefined || value === null ? "" : value).trim(), 10);
        if (Number.isFinite(parsed) && parsed >= 0) {
            return Math.min(parsed, 99);
        }
        var fallback = Number.parseInt(String(fallbackValue === undefined || fallbackValue === null ? "" : fallbackValue).trim(), 10);
        if (Number.isFinite(fallback) && fallback >= 0) {
            return Math.min(fallback, 99);
        }
        return 0;
    }

    function parsePrice(value) {
        var parsed = Number(String(value === undefined || value === null ? "" : value).replace(/[^0-9.]/g, ""));
        if (!Number.isFinite(parsed) || parsed < 0) {
            return 0;
        }
        return Number(parsed.toFixed(2));
    }

    function getAppBasePath() {
        var pathname = String(global.location && global.location.pathname || "").replace(/\\/g, "/");
        var lower = pathname.toLowerCase();
        var userhomeIndex = lower.lastIndexOf("/userhomefolder/");
        if (userhomeIndex > 0) {
            return pathname.slice(0, userhomeIndex);
        }
        var settingsIndex = lower.lastIndexOf("/usersetting.html/");
        if (settingsIndex > 0) {
            return pathname.slice(0, settingsIndex);
        }
        return "";
    }

    function resolveAppPath(path) {
        var raw = String(path || "").trim();
        if (!raw) {
            return "";
        }
        if (/^(?:https?:)?\/\//i.test(raw) || /^data:/i.test(raw) || /^blob:/i.test(raw)) {
            return raw;
        }

        var normalized = raw.replace(/\\/g, "/");
        var appBase = getAppBasePath();

        if (normalized.startsWith("/")) {
            if (!appBase) {
                return normalized;
            }
            if (normalized.toLowerCase().indexOf(appBase.toLowerCase() + "/") === 0) {
                return normalized;
            }
            return appBase + normalized;
        }

        if (normalized.startsWith("../")) {
            return resolveAppPath("/Userhomefolder/" + normalized.slice(3));
        }

        if (normalized.startsWith("./")) {
            return resolveAppPath("/Userhomefolder/" + normalized.slice(2));
        }

        if (normalized.toLowerCase().startsWith("userhomefolder/") || normalized.toLowerCase().startsWith("usersetting.html/")) {
            return resolveAppPath("/" + normalized);
        }

        if (normalized.toLowerCase().startsWith("ebikes/")) {
            return resolveAppPath("/Userhomefolder/" + normalized);
        }

        if (normalized.indexOf("/") === -1) {
            return resolveAppPath("/Userhomefolder/" + normalized);
        }

        return normalized;
    }

    function getCurrentEmail() {
        if (global.EcodriveSession && typeof global.EcodriveSession.getCurrentEmail === "function") {
            return normalizeText(global.EcodriveSession.getCurrentEmail()).toLowerCase();
        }
        return normalizeText(localStorage.getItem("ecodrive_current_user_email")).toLowerCase();
    }

    function getCartStorageKey() {
        return CART_STORAGE_PREFIX + (getCurrentEmail() || "guest");
    }

    function createCartId() {
        return "cart-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    }

    function formatPeso(amount) {
        return new Intl.NumberFormat("en-PH", {
            style: "currency",
            currency: "PHP",
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(Number(amount || 0));
    }

    function normalizeItem(input) {
        var source = input && typeof input === "object" ? input : {};
        var model = normalizeText(source.model || source.name);
        if (!model) {
            return null;
        }

        return {
            cartId: normalizeText(source.cartId) || createCartId(),
            productId: Number(source.productId || source.id || 0) || 0,
            model: model,
            price: parsePrice(source.price || source.total),
            imageUrl: resolveAppPath(source.imageUrl || source.image || source.bikeImage || "image 1.png"),
            detailUrl: resolveAppPath(source.detailUrl || source.href || source.url || ""),
            category: normalizeText(source.category || source.subtitle || "E-Bike"),
            info: normalizeText(source.info || source.description || ""),
            selectedColor: normalizeText(source.selectedColor || source.color || source.bikeColor || ""),
            quantity: Math.max(1, normalizeQuantity(source.quantity, 1)),
            addedAt: Number(source.addedAt || Date.now()) || Date.now()
        };
    }

    function getItemMatchKey(item) {
        var product = normalizeItem(item);
        if (!product) {
            return "";
        }
        return [
            product.productId || 0,
            normalizeModelKey(product.model),
            String(product.detailUrl || "").toLowerCase(),
            normalizeText(product.selectedColor).toLowerCase()
        ].join("|");
    }

    function readItems() {
        var parsed = safeParse(localStorage.getItem(getCartStorageKey()));
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.map(normalizeItem).filter(Boolean);
    }

    function writeItems(items) {
        var normalized = Array.isArray(items) ? items.map(normalizeItem).filter(Boolean) : [];
        localStorage.setItem(getCartStorageKey(), JSON.stringify(normalized));
        dispatchUpdated(normalized);
        return normalized;
    }

    function getItemCount(itemsInput) {
        var items = Array.isArray(itemsInput) ? itemsInput : readItems();
        return items.reduce(function (sum, item) {
            return sum + normalizeQuantity(item && item.quantity, 0);
        }, 0);
    }

    function getCartTotal(itemsInput) {
        var items = Array.isArray(itemsInput) ? itemsInput : readItems();
        return items.reduce(function (sum, item) {
            var price = parsePrice(item && item.price);
            var quantity = normalizeQuantity(item && item.quantity, 0);
            return sum + price * quantity;
        }, 0);
    }

    function dispatchUpdated(items) {
        updateCartBadges(items);
        renderCartPage();
        global.dispatchEvent(new CustomEvent("ecodrive:cart-updated", {
            detail: {
                items: items.slice(),
                count: getItemCount(items),
                total: getCartTotal(items)
            }
        }));
    }

    function ensureToastStack() {
        var stack = document.getElementById(TOAST_STACK_ID);
        if (stack) {
            return stack;
        }
        stack = document.createElement("div");
        stack.id = TOAST_STACK_ID;
        stack.className = "cart-toast-stack";
        document.body.appendChild(stack);
        return stack;
    }

    function showToast(message) {
        if (!document.body) {
            return;
        }
        var stack = ensureToastStack();
        var toast = document.createElement("div");
        toast.className = "cart-toast";
        toast.textContent = normalizeText(message) || "Cart updated.";
        stack.appendChild(toast);

        global.setTimeout(function () {
            toast.style.opacity = "0";
            toast.style.transform = "translateY(6px)";
            toast.style.transition = "opacity 0.18s ease, transform 0.18s ease";
            global.setTimeout(function () {
                toast.remove();
            }, 180);
        }, 1900);
    }

    function addItem(itemInput, options) {
        var opts = options && typeof options === "object" ? options : {};
        var item = normalizeItem(itemInput);
        if (!item) {
            return { ok: false, items: readItems() };
        }

        var items = readItems();
        var matchKey = getItemMatchKey(item);
        var existing = items.find(function (entry) {
            return getItemMatchKey(entry) === matchKey;
        });

        if (existing) {
            existing.quantity = normalizeQuantity(existing.quantity + item.quantity, existing.quantity);
            existing.price = item.price || existing.price;
            existing.imageUrl = item.imageUrl || existing.imageUrl;
            existing.detailUrl = item.detailUrl || existing.detailUrl;
            existing.category = item.category || existing.category;
            existing.info = item.info || existing.info;
            existing.selectedColor = item.selectedColor || existing.selectedColor;
        } else {
            items.unshift(item);
        }

        var nextItems = writeItems(items);
        if (opts.silent !== true) {
            showToast(item.model + " added to cart.");
        }
        return {
            ok: true,
            item: item,
            items: nextItems
        };
    }

    function removeItem(cartId, options) {
        var opts = options && typeof options === "object" ? options : {};
        var id = normalizeText(cartId);
        if (!id) {
            return readItems();
        }
        var items = readItems().filter(function (item) {
            return normalizeText(item.cartId) !== id;
        });
        var nextItems = writeItems(items);
        if (opts.silent !== true) {
            showToast("Item removed from cart.");
        }
        return nextItems;
    }

    function updateQuantity(cartId, nextQuantity, options) {
        var opts = options && typeof options === "object" ? options : {};
        var id = normalizeText(cartId);
        if (!id) {
            return readItems();
        }

        var quantity = Number.parseInt(String(nextQuantity || "").trim(), 10);
        if (!Number.isFinite(quantity) || quantity <= 0) {
            return removeItem(id, opts);
        }

        var items = readItems();
        var changed = false;
        items.forEach(function (item) {
            if (normalizeText(item.cartId) !== id) {
                return;
            }
            item.quantity = normalizeQuantity(quantity, item.quantity);
            changed = true;
        });
        if (!changed) {
            return items;
        }
        var nextItems = writeItems(items);
        if (opts.silent !== true) {
            showToast("Cart quantity updated.");
        }
        return nextItems;
    }

    function clearCart(options) {
        var opts = options && typeof options === "object" ? options : {};
        localStorage.removeItem(getCartStorageKey());
        var nextItems = [];
        dispatchUpdated(nextItems);
        if (opts.silent !== true) {
            showToast("Cart cleared.");
        }
        return nextItems;
    }

    function buildCheckoutSelection(itemInput) {
        var item = normalizeItem(itemInput);
        if (!item) {
            return null;
        }
        return {
            model: item.model,
            total: item.price,
            image: item.imageUrl,
            bikeImage: item.imageUrl,
            subtitle: item.category || "E-Bike",
            info: item.info || "",
            bikeColor: item.selectedColor || "",
            color: item.selectedColor || "",
            selectedColor: item.selectedColor || ""
        };
    }

    function buildBookingUrl(itemInput) {
        var item = normalizeItem(itemInput);
        if (!item) {
            return resolveAppPath("/Userhomefolder/payment/booking.html");
        }

        var params = new URLSearchParams();
        params.set("model", item.model || "Ecodrive E-Bike");
        params.set("price", String(item.price || 0));
        params.set("subtitle", item.category || "E-Bike");
        params.set("info", item.info || "");
        if (item.imageUrl) {
            params.set("image", item.imageUrl);
        }
        if (item.selectedColor) {
            params.set("color", item.selectedColor);
        }
        return resolveAppPath("/Userhomefolder/payment/booking.html") + "?" + params.toString();
    }

    function goToBooking(itemInput) {
        var selection = buildCheckoutSelection(itemInput);
        if (!selection) {
            return;
        }
        CHECKOUT_SELECTION_KEYS.forEach(function (key) {
            localStorage.setItem(key, JSON.stringify(selection));
        });
        global.location.href = buildBookingUrl(itemInput);
    }

    function getCartPageUrl() {
        return resolveAppPath("/Userhomefolder/cart.html");
    }

    function getProductsPageUrl() {
        return resolveAppPath("/Userhomefolder/userhome2.html");
    }

    function updateCartBadges(itemsInput) {
        var count = getItemCount(itemsInput);
        var text = count > 99 ? "99+" : String(count);
        var badges = document.querySelectorAll(".cart-nav-count");
        for (var i = 0; i < badges.length; i += 1) {
            var badge = badges[i];
            if (count > 0) {
                badge.hidden = false;
                badge.textContent = text;
            } else {
                badge.hidden = true;
                badge.textContent = "";
            }
        }
    }

    function injectNavCart() {
        var profileMenu = document.querySelector(".navbar .profile-menu") || document.querySelector(".top-nav .profile-menu");
        if (!profileMenu || !profileMenu.parentElement) {
            return;
        }

        if (!document.querySelector(".cart-nav-btn")) {
            var button = document.createElement("a");
            button.className = "cart-nav-btn";
            button.href = getCartPageUrl();
            button.setAttribute("aria-label", "Open cart");
            button.innerHTML = "<span class=\"cart-nav-icon\">&#128722;</span><span class=\"cart-nav-text\">Cart</span><span class=\"cart-nav-count\" hidden></span>";
            if (CURRENT_FILE === "cart.html") {
                button.classList.add("active");
            }
            profileMenu.parentElement.insertBefore(button, profileMenu);
        }

        updateCartBadges(readItems());
    }

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function renderCartPage() {
        if (CURRENT_FILE !== "cart.html") {
            return;
        }

        var root = document.getElementById(CART_PAGE_ID);
        if (!root) {
            return;
        }

        var items = readItems();
        if (!items.length) {
            root.innerHTML = ""
                + "<section class=\"cart-empty\">"
                + "<h2>Your cart is empty</h2>"
                + "<p>Browse the lineup and add your preferred Ecodrive models here.</p>"
                + "<a class=\"cart-summary-btn primary\" href=\"" + escapeHtml(getProductsPageUrl()) + "\">Browse Ebikes</a>"
                + "</section>";
            return;
        }

        var itemsHtml = items.map(function (item) {
            var quantity = normalizeQuantity(item.quantity, 1);
            var itemTotal = item.price * quantity;
            var meta = [
                "<span class=\"cart-chip\">" + escapeHtml(item.category || "E-Bike") + "</span>"
            ];
            if (item.selectedColor) {
                meta.push("<span class=\"cart-chip\">Color: " + escapeHtml(item.selectedColor) + "</span>");
            }

            return ""
                + "<article class=\"cart-item\">"
                + "<div class=\"cart-item-product\">"
                + "<div class=\"cart-item-media\"><img src=\"" + escapeHtml(item.imageUrl || resolveAppPath("/Userhomefolder/image 1.png")) + "\" alt=\"" + escapeHtml(item.model) + "\"></div>"
                + "<div class=\"cart-item-body\">"
                + "<h3>" + escapeHtml(item.model) + "</h3>"
                + "<div class=\"cart-item-meta\">" + meta.join("") + "</div>"
                + "<p class=\"cart-item-copy\">" + escapeHtml(item.info || "Saved in your cart. Continue shopping or book this model when you're ready.") + "</p>"
                + "</div>"
                + "</div>"
                + "<div class=\"cart-price\">"
                + "<span class=\"cart-cell-label\">Unit Price</span>"
                + "<strong>" + escapeHtml(formatPeso(item.price)) + "</strong>"
                + "<span>each</span>"
                + "</div>"
                + "<div class=\"cart-qty-wrap\">"
                + "<span class=\"cart-cell-label\">Quantity</span>"
                + "<div class=\"cart-qty\">"
                + "<button type=\"button\" data-cart-action=\"decrease\" data-cart-id=\"" + escapeHtml(item.cartId) + "\" aria-label=\"Decrease quantity\">-</button>"
                + "<strong>" + escapeHtml(String(quantity)) + "</strong>"
                + "<button type=\"button\" data-cart-action=\"increase\" data-cart-id=\"" + escapeHtml(item.cartId) + "\" aria-label=\"Increase quantity\">+</button>"
                + "</div>"
                + "</div>"
                + "<div class=\"cart-total\">"
                + "<span class=\"cart-cell-label\">Subtotal</span>"
                + "<strong>" + escapeHtml(formatPeso(itemTotal)) + "</strong>"
                + "<span>" + escapeHtml(quantity === 1 ? "1 saved unit" : String(quantity) + " saved units") + "</span>"
                + "</div>"
                + "<div class=\"cart-side-actions\">"
                + "<span class=\"cart-cell-label\">Actions</span>"
                + "<div class=\"cart-actions\">"
                + "<a class=\"cart-item-btn\" href=\"" + escapeHtml(item.detailUrl || getProductsPageUrl()) + "\">View Model</a>"
                + "<button type=\"button\" class=\"cart-item-btn\" data-cart-action=\"book\" data-cart-id=\"" + escapeHtml(item.cartId) + "\">Book This Model</button>"
                + "<button type=\"button\" class=\"cart-remove-btn\" data-cart-action=\"remove\" data-cart-id=\"" + escapeHtml(item.cartId) + "\">Remove</button>"
                + "</div>"
                + "</div>"
                + "</article>";
        }).join("");

        root.innerHTML = ""
            + "<div class=\"cart-layout\">"
            + "<section class=\"cart-panel\">"
            + "<div class=\"cart-panel-head\">"
                + "<div><h2>Your saved ebikes</h2><p>Items stay in your cart for this signed-in account.</p></div>"
                + "<button type=\"button\" class=\"cart-clear-btn\" data-cart-action=\"clear\">Clear cart</button>"
                + "</div>"
            + "<div class=\"cart-table-head\">"
            + "<span>Product</span>"
            + "<span>Unit Price</span>"
            + "<span>Quantity</span>"
            + "<span>Subtotal</span>"
            + "<span>Actions</span>"
            + "</div>"
            + "<div class=\"cart-items\">" + itemsHtml + "</div>"
            + "</section>"
            + "<aside class=\"cart-summary\">"
            + "<div class=\"cart-summary-head\">"
            + "<div><h2>Cart summary</h2><p>Review your saved models before booking.</p></div>"
            + "</div>"
            + "<div class=\"cart-summary-metrics\">"
            + "<div class=\"cart-summary-row\"><span>Total items</span><strong>" + escapeHtml(String(getItemCount(items))) + "</strong></div>"
            + "<div class=\"cart-summary-row\"><span>Saved models</span><strong>" + escapeHtml(String(items.length)) + "</strong></div>"
            + "<div class=\"cart-summary-row total\"><span>Total value</span><strong>" + escapeHtml(formatPeso(getCartTotal(items))) + "</strong></div>"
            + "</div>"
            + "<div class=\"cart-summary-note\">Bookings still go through one model at a time. Use <strong>Book This Model</strong> on any cart item to continue with the existing checkout flow.</div>"
            + "<div class=\"cart-summary-actions\">"
            + "<a class=\"cart-summary-btn primary\" href=\"" + escapeHtml(getProductsPageUrl()) + "\">Continue Shopping</a>"
            + "<button type=\"button\" class=\"cart-summary-btn secondary\" data-cart-action=\"clear\">Remove All Items</button>"
            + "</div>"
            + "</aside>"
            + "</div>";
    }

    function getItemById(cartId) {
        var id = normalizeText(cartId);
        if (!id) {
            return null;
        }
        return readItems().find(function (item) {
            return normalizeText(item.cartId) === id;
        }) || null;
    }

    function bindCartPageEvents() {
        var root = document.getElementById(CART_PAGE_ID);
        if (!root || root.dataset.cartBound === "1") {
            return;
        }
        root.dataset.cartBound = "1";

        root.addEventListener("click", function (event) {
            var trigger = event.target.closest("[data-cart-action]");
            if (!trigger) {
                return;
            }

            var action = String(trigger.getAttribute("data-cart-action") || "");
            var cartId = String(trigger.getAttribute("data-cart-id") || "");
            var item = cartId ? getItemById(cartId) : null;

            if (action === "increase" && item) {
                updateQuantity(cartId, normalizeQuantity(item.quantity, 1) + 1, { silent: true });
                return;
            }
            if (action === "decrease" && item) {
                updateQuantity(cartId, normalizeQuantity(item.quantity, 1) - 1, { silent: true });
                return;
            }
            if (action === "remove" && item) {
                removeItem(cartId, { silent: true });
                return;
            }
            if (action === "book" && item) {
                goToBooking(item);
                return;
            }
            if (action === "clear") {
                clearCart({ silent: true });
            }
        });
    }

    function init() {
        injectNavCart();
        renderCartPage();
        bindCartPageEvents();
    }

    global.addEventListener("storage", function (event) {
        var key = String(event && event.key || "");
        if (key === getCartStorageKey() || key.indexOf(CART_STORAGE_PREFIX) === 0) {
            var items = readItems();
            updateCartBadges(items);
            renderCartPage();
        }
    });

    global.addEventListener("ecodrive:cart-refresh", function () {
        var items = readItems();
        updateCartBadges(items);
        renderCartPage();
    });

    global.EcodriveCart = {
        addItem: addItem,
        removeItem: removeItem,
        updateQuantity: updateQuantity,
        clearCart: clearCart,
        getItems: readItems,
        getItemCount: getItemCount,
        getCartTotal: getCartTotal,
        getCartPageUrl: getCartPageUrl,
        goToBooking: goToBooking,
        buildCheckoutSelection: buildCheckoutSelection
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})(window);
