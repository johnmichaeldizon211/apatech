document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("settingsForm");
  const statusMsg = document.getElementById("statusMsg");
  const saveBtn = form.querySelector(".save-btn");
  const securityForm = document.getElementById("securityForm");
  const securityStatusMsg = document.getElementById("securityStatusMsg");
  const avatarImage = document.getElementById("avatarImage");
  const avatarInput = document.getElementById("avatarInput");
  const avatarMsg = document.getElementById("avatarMsg");
  const removeAvatarBtn = document.getElementById("removeAvatarBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const menuButtons = document.querySelectorAll(".menu-buttons button");
  const sections = document.querySelectorAll(".settings-section");
  const orderList = document.getElementById("orderList");
  const orderStatusMsg = document.getElementById("orderStatusMsg");
  const topProfileBtn = document.querySelector(".top-nav .profile-menu .profile-btn");
  const topDropdown = document.querySelector(".top-nav .profile-menu .dropdown");
  const topLogoutLink = document.getElementById("topLogoutLink");
  const chatToggle = document.getElementById("chatbot-toggle");
  const chatPanel = document.getElementById("chat-panel");
  const chatClose = document.getElementById("chat-close");
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");
  const chatBody = document.getElementById("chat-body");

  const fields = {
    fullName: document.getElementById("fullName"),
    email: document.getElementById("email"),
    phone: document.getElementById("phone"),
    address: document.getElementById("address")
  };

  const errors = {
    fullName: document.getElementById("fullNameError"),
    email: document.getElementById("emailError"),
    phone: document.getElementById("phoneError"),
    address: document.getElementById("addressError")
  };

  const securityFields = {
    currentPassword: document.getElementById("currentPassword"),
    newSecurityPassword: document.getElementById("newSecurityPassword"),
    confirmSecurityPassword: document.getElementById("confirmSecurityPassword")
  };

  const securityErrors = {
    currentPassword: document.getElementById("currentPasswordError"),
    newSecurityPassword: document.getElementById("newSecurityPasswordError"),
    confirmSecurityPassword: document.getElementById("confirmSecurityPasswordError")
  };

  const legacyStorageKey = "ecodrive_profile_settings";
  const securityStorageKey = "ecodrive_security_settings";
  const usersKey = "users";
  const currentUserKey = "ecodrive_current_user_email";
  const orderStorageKeys = ["ecodrive_orders", "orders", "ecodrive_bookings"];
  const ORDER_REFRESH_INTERVAL_MS = 3000;
  const watchedOrderStorageKeys = new Set(orderStorageKeys.concat(["latestBooking"]));
  const rejectedOrderNotifiedKeyPrefix = "ecodrive_rejected_booking_notif_seen::";
  const RECEIPT_PDF_SCRIPT_SOURCES = [
    "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js",
    "https://unpkg.com/jspdf@2.5.2/dist/jspdf.umd.min.js"
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
  const defaultAvatarSrc = avatarImage.getAttribute("src");
  let activeProfileKey = getProfileStorageKey(getCurrentUserEmail());
  let activateSectionById = null;
  let orderRefreshTimerId = null;
  let orderRefreshInFlight = false;
  let latestRenderedOrders = [];
  let receiptPdfLibPromise = null;

  if (!ensureAuthenticatedUser()) {
    return;
  }

  loadSavedData();
  void hydrateProfileFromApi();
  void refreshOrderStatus(true);
  bindSectionSwitching();
  bindTopProfileMenu();
  bindChatbot();
  bindAvatarUpload();
  bindAvatarRemove();
  bindLogout();
  bindProfileLiveValidation();
  bindSecurityLiveValidation();
  bindOrderAutoRefresh();
  bindOrderReceiptPrinting();

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    clearFeedback();

    const data = {
      fullName: fields.fullName.value.trim(),
      email: fields.email.value.trim(),
      phone: fields.phone.value.trim().replace(/[\s-]/g, ""),
      address: fields.address.value.trim()
    };

    const isValid = validate(data);
    if (!isValid) {
      setStatus("Please fix the highlighted fields.", true);
      return;
    }

    const payload = {
      fullName: data.fullName,
      email: data.email,
      phone: data.phone,
      address: data.address,
      updatedAt: new Date().toISOString()
    };

    saveProfile(payload);
  });

  securityForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearSecurityFeedback();

    const currentPassword = securityFields.currentPassword.value;
    const newPassword = securityFields.newSecurityPassword.value;
    const confirmPassword = securityFields.confirmSecurityPassword.value;

    const validSecurity = validateSecurity({
      currentPassword,
      newSecurityPassword: newPassword,
      confirmSecurityPassword: confirmPassword
    });
    if (!validSecurity) {
      setSecurityStatus("Please fix the highlighted fields.", true);
      return;
    }

    const currentEmail = getCurrentUserEmail();
    let passwordUpdated = false;
    let usedApi = false;

    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(currentEmail)) {
      try {
        const response = await fetch(getApiUrl("/api/profile/password"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            email: currentEmail,
            currentPassword: currentPassword,
            newPassword: newPassword
          })
        });

        if (response.status !== 404 && response.status !== 405) {
          const data = await response.json().catch(() => ({}));
          usedApi = true;
          if (!response.ok || data.success !== true) {
            setSecurityStatus(data.message || "Unable to update password.", true);
            return;
          }
          passwordUpdated = updateCurrentUserPassword(currentPassword, newPassword, true);
        }
      } catch (_error) {
        usedApi = false;
      }
    }

    if (!usedApi) {
      passwordUpdated = updateCurrentUserPassword(currentPassword, newPassword);
    }

    if (!passwordUpdated) {
      setSecurityStatus("Current password is incorrect or user is not found.", true);
      return;
    }

    localStorage.setItem(
      securityStorageKey,
      JSON.stringify({
        updatedAt: new Date().toISOString()
      })
    );

    securityForm.reset();
    setSecurityStatus(usedApi ? "Password updated successfully." : "Password updated locally.", false);
  });

  function getApiUrl(path) {
    return API_BASE ? `${API_BASE}${path}` : path;
  }

  function isOrderSectionActive() {
    const section = document.getElementById("orderSection");
    return Boolean(section) && !section.classList.contains("hidden");
  }

  async function refreshOrderStatus(force) {
    if (orderRefreshInFlight) {
      return;
    }
    if (document.hidden && !force) {
      return;
    }
    if (!isOrderSectionActive() && !force) {
      return;
    }

    orderRefreshInFlight = true;
    try {
      await renderOrderStatus();
    } finally {
      orderRefreshInFlight = false;
    }
  }

  function startOrderAutoRefresh() {
    if (orderRefreshTimerId || !isOrderSectionActive()) {
      return;
    }
    orderRefreshTimerId = window.setInterval(() => {
      void refreshOrderStatus(false);
    }, ORDER_REFRESH_INTERVAL_MS);
  }

  function stopOrderAutoRefresh() {
    if (!orderRefreshTimerId) {
      return;
    }
    window.clearInterval(orderRefreshTimerId);
    orderRefreshTimerId = null;
  }

  function bindOrderAutoRefresh() {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        stopOrderAutoRefresh();
        return;
      }
      void refreshOrderStatus(true);
      startOrderAutoRefresh();
    });

    window.addEventListener("storage", (event) => {
      if (!event.key || watchedOrderStorageKeys.has(event.key)) {
        void refreshOrderStatus(true);
      }
    });

    window.addEventListener("beforeunload", stopOrderAutoRefresh);
  }

  function bindSectionSwitching() {
    activateSectionById = (targetId) => {
      if (!targetId) {
        return;
      }

      menuButtons.forEach((button) => {
        const isActive = button.dataset.target === targetId;
        button.classList.toggle("active", isActive);
      });

      sections.forEach((section) => {
        const isTarget = section.id === targetId;
        section.classList.toggle("hidden", !isTarget);
        section.setAttribute("aria-hidden", String(!isTarget));
      });

      if (targetId === "orderSection") {
        void refreshOrderStatus(true);
        startOrderAutoRefresh();
      } else {
        stopOrderAutoRefresh();
      }
    };

    sections.forEach((section) => {
      section.setAttribute("aria-hidden", String(section.classList.contains("hidden")));
    });

    const initialTarget = window.location.hash ? window.location.hash.slice(1) : "";
    if (initialTarget && document.getElementById(initialTarget)) {
      activateSectionById(initialTarget);
    }

    window.addEventListener("hashchange", () => {
      const hashTarget = window.location.hash ? window.location.hash.slice(1) : "";
      if (hashTarget && document.getElementById(hashTarget) && activateSectionById) {
        activateSectionById(hashTarget);
      }
    });

    menuButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const targetId = button.dataset.target;
        if (!targetId) {
          return;
        }

        if (activateSectionById) {
          activateSectionById(targetId);
        }

        window.location.hash = targetId;
      });
    });
  }

  function bindTopProfileMenu() {
    if (!topProfileBtn || !topDropdown) {
      return;
    }

    topProfileBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      topDropdown.classList.toggle("show");
    });

    topDropdown.addEventListener("click", (event) => {
      event.stopPropagation();
      const targetLink = event.target.closest("[data-target-section]");
      if (!targetLink) {
        return;
      }

      event.preventDefault();
      const targetId = targetLink.getAttribute("data-target-section");
      if (targetId && activateSectionById) {
        activateSectionById(targetId);
        window.location.hash = targetId;
      }

      topDropdown.classList.remove("show");
    });

    document.addEventListener("click", () => {
      topDropdown.classList.remove("show");
    });
  }

  function bindChatbot() {
    if (!chatToggle || !chatPanel || !chatClose || !chatForm || !chatInput || !chatBody) {
      return;
    }

    const STORAGE_KEY = "ecodrive_chat_messages_v1";
    let messages = [];

    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      messages = Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      messages = [];
    }

    function saveMessages() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    }

    function renderMessage(msg) {
      const el = document.createElement("div");
      el.className = "chat-message " + (msg.from === "user" ? "user" : "bot");
      if (msg.typing) {
        el.classList.add("typing");
      }
      el.textContent = msg.text;
      if (msg.typing) {
        el.setAttribute("data-typing", "1");
      }
      chatBody.appendChild(el);
      chatBody.scrollTop = chatBody.scrollHeight;
    }

    function renderAll() {
      chatBody.innerHTML = "";
      messages.forEach(renderMessage);
    }

    function appendMessage(msg) {
      messages.push(msg);
      saveMessages();
      renderMessage(msg);
    }

    function removeTyping() {
      const typing = chatBody.querySelector("[data-typing='1']");
      if (typing) {
        typing.remove();
      }
    }

    function botReply(text) {
      const inputText = String(text || "").toLowerCase();
      let reply = "Thanks! We'll get back to you shortly.";

      if (inputText.includes("hi") || inputText.includes("hello")) {
        reply = "Hi there! How can I help you today?";
      } else if (inputText.includes("price") || inputText.includes("cost")) {
        reply = "Our prices vary by model. Which model are you interested in?";
      } else if (inputText.includes("delivery")) {
        reply = "We offer pickup and delivery options. Which do you prefer?";
      } else if (inputText.includes("book") || inputText.includes("booking")) {
        reply = "You can continue your booking from the Bookings page in the top menu.";
      } else if (inputText.includes("contact")) {
        reply = "You can view our contact details in the Contact page.";
      }

      renderMessage({ from: "bot", text: "Typing...", typing: true });

      setTimeout(() => {
        removeTyping();
        appendMessage({ from: "bot", text: reply, time: Date.now() });
      }, 700 + Math.random() * 500);
    }

    function openPanel() {
      chatPanel.classList.add("open");
      chatPanel.setAttribute("aria-hidden", "false");
      renderAll();
      chatInput.focus();
    }

    function closePanel() {
      chatPanel.classList.remove("open");
      chatPanel.setAttribute("aria-hidden", "true");
    }

    chatToggle.addEventListener("click", (event) => {
      event.stopPropagation();
      if (chatPanel.classList.contains("open")) {
        closePanel();
      } else {
        openPanel();
      }
    });

    chatClose.addEventListener("click", (event) => {
      event.stopPropagation();
      closePanel();
    });

    chatPanel.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    chatForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = chatInput.value.trim();
      if (!text) {
        return;
      }

      appendMessage({ from: "user", text: text, time: Date.now() });
      chatInput.value = "";
      botReply(text);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePanel();
      }
    });

    if (messages.length === 0) {
      messages = [{
        from: "bot",
        text: "Hello! I'm Ecodrive Bot. Ask me about products, booking, or delivery.",
        time: Date.now()
      }];
      saveMessages();
    }
  }

  async function loadOrdersFromApi(email) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return { mode: "unavailable", orders: [] };
    }

    try {
      const response = await fetch(
        getApiUrl(`/api/bookings?email=${encodeURIComponent(normalizedEmail)}`),
        { method: "GET" }
      );

      if (response.status === 404 || response.status === 405) {
        return { mode: "unavailable", orders: [] };
      }

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success !== true) {
        return { mode: "error", orders: [] };
      }

      return {
        mode: "ok",
        orders: Array.isArray(payload.bookings) ? payload.bookings : []
      };
    } catch (_error) {
      return { mode: "unavailable", orders: [] };
    }
  }

  async function renderOrderStatus() {
    if (!orderList || !orderStatusMsg) {
      return;
    }

    const currentEmail = getCurrentUserEmail();
    const localOrders = readOrders();
    const apiResult = await loadOrdersFromApi(currentEmail);
    const rawOrders = apiResult.mode === "ok"
      ? mergeApiAndLocalOrders(apiResult.orders, localOrders)
      : localOrders;
    const rejectedSummary = captureRejectedOrderNotifications(rawOrders, currentEmail);
    cleanupHiddenOrdersInLocalStorage(currentEmail, rejectedSummary.rejectedOrderIds);
    const normalizedOrders = normalizeOrders(rawOrders, currentEmail);
    latestRenderedOrders = normalizedOrders.slice();

    orderList.innerHTML = "";

    if (!normalizedOrders.length) {
      if (apiResult.mode === "error") {
        orderStatusMsg.textContent = "Unable to load order status right now. Please try again.";
        orderStatusMsg.classList.add("error");
        return;
      }
      if (rejectedSummary.newlyRejected.length > 0) {
        orderStatusMsg.textContent = buildRejectedOrderMessage(rejectedSummary.newlyRejected);
        orderStatusMsg.classList.remove("error");
        return;
      }
      orderStatusMsg.textContent = "No orders yet. Your next booking will appear here.";
      orderStatusMsg.classList.remove("error");
      return;
    }

    if (rejectedSummary.newlyRejected.length > 0) {
      orderStatusMsg.textContent = buildRejectedOrderMessage(rejectedSummary.newlyRejected);
      orderStatusMsg.classList.remove("error");
    } else {
      orderStatusMsg.textContent = "";
      orderStatusMsg.classList.remove("error");
    }
    normalizedOrders.forEach((order) => {
      const card = document.createElement("article");
      card.className = "order-item";
      const statusClass = getStatusClassName(order.status, order.fulfillmentStatus);
      const trackingLabel = buildTrackingLabel(order);
      const canPrintReceipt = isReceiptEligibleStatus(order.status, order.fulfillmentStatus);
      const receiptNumber = getReceiptNumberForOrder(order);
      const receiptIssuedLabel = formatReceiptIssuedDate(order.receiptIssuedAt || order.createdAt);
      const receiptLine = canPrintReceipt
        ? `<p class="order-line order-receipt-line">Receipt No: ${escapeHtml(receiptNumber)} (${escapeHtml(receiptIssuedLabel)})</p>`
        : "";
      const trackingEtaLine = order.trackingEta
        ? `<p class="order-line order-tracking-meta">ETA: ${escapeHtml(order.trackingEta)}</p>`
        : "";
      const trackingLocationLine = order.trackingLocation
        ? `<p class="order-line order-tracking-meta">Current Location: ${escapeHtml(order.trackingLocation)}</p>`
        : "";
      const deliveryAddressLine = isDeliveryService(order.service) && order.shippingAddress
        ? `<p class="order-line">Delivery Address: ${escapeHtml(order.shippingAddress)}</p>`
        : "";
      card.innerHTML = `
        <div class="order-item-head">
          <h3>${escapeHtml(order.orderId)}</h3>
          <span class="order-date">${escapeHtml(formatOrderDate(order.createdAt))}</span>
        </div>
        <p class="order-line">Model: ${escapeHtml(order.model)}</p>
        <p class="order-line">Service: ${escapeHtml(order.service)}</p>
        <p class="order-line">Payment: ${escapeHtml(order.payment)}</p>
        <p class="order-line">Schedule: <span class="order-schedule">${escapeHtml(order.schedule)}</span></p>
        <p class="order-line">Total: ${escapeHtml(formatPeso(order.total))}</p>
        ${receiptLine}
        <p class="order-line order-tracking-line">Tracking: ${escapeHtml(trackingLabel)}</p>
        ${trackingEtaLine}
        ${trackingLocationLine}
        ${deliveryAddressLine}
        <p class="order-meta">
          <span class="status-chip ${statusClass}">${escapeHtml(order.status)}</span>
          <span class="fulfillment-text">${escapeHtml(order.fulfillmentStatus)}</span>
        </p>
        ${canPrintReceipt
          ? `<div class="order-actions">
              <button type="button" class="order-action-btn order-view-receipt-btn" data-order-id="${encodeToken(order.orderId)}" data-created-at="${encodeToken(order.createdAt)}">View Receipt</button>
            </div>`
          : ""}
      `;
      orderList.appendChild(card);
    });
  }

  function bindProfileLiveValidation() {
    Object.keys(fields).forEach((key) => {
      fields[key].addEventListener("input", () => {
        fields[key].classList.remove("input-invalid");
        errors[key].textContent = "";
      });
    });
  }

  function bindSecurityLiveValidation() {
    Object.keys(securityFields).forEach((key) => {
      securityFields[key].addEventListener("input", () => {
        securityFields[key].classList.remove("input-invalid");
        securityErrors[key].textContent = "";
      });
    });
  }

  async function saveProfile(payload) {
    setSubmitting(true);

    try {
      const response = await fetch(getApiUrl("/api/profile/settings"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...payload,
          currentEmail: getCurrentUserEmail(),
          avatar: readProfileData().avatar || ""
        })
      });

      if (!response.ok) {
        throw new Error("Profile API request failed.");
      }

      const data = await response.json();
      if (!data || data.success !== true) {
        throw new Error("Profile API returned unsuccessful response.");
      }

      const profile = data.profile || payload;
      persistLocal({
        fullName: profile.fullName || payload.fullName,
        email: profile.email || payload.email,
        phone: profile.phone || payload.phone,
        address: profile.address || payload.address,
        avatar: typeof profile.avatar === "string" ? profile.avatar : (readProfileData().avatar || ""),
        updatedAt: new Date().toISOString()
      });
      if (typeof profile.avatar === "string" && profile.avatar) {
        avatarImage.src = profile.avatar;
      }
      setStatus("Profile settings saved.", false);
    } catch (error) {
      console.warn("Profile save API unavailable. Falling back to local storage.", error);
      persistLocal(payload);
      setStatus("Saved locally (backend unavailable).", false);
    } finally {
      setSubmitting(false);
    }
  }

  function validate(data) {
    let valid = true;

    if (data.fullName.length < 2) {
      showError("fullName", "Enter at least 2 characters.");
      valid = false;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.email)) {
      showError("email", "Enter a valid email address.");
      valid = false;
    }

    const phoneRegex = /^(\+639|09)\d{9}$/;
    if (!phoneRegex.test(data.phone)) {
      showError("phone", "Use 09XXXXXXXXX or +639XXXXXXXXX.");
      valid = false;
    }

    if (data.address.length < 5) {
      showError("address", "Enter a complete address.");
      valid = false;
    }


    return valid;
  }

  function showError(fieldName, message) {
    fields[fieldName].classList.add("input-invalid");
    errors[fieldName].textContent = message;
  }

  function showSecurityError(fieldName, message) {
    securityFields[fieldName].classList.add("input-invalid");
    securityErrors[fieldName].textContent = message;
  }

  function clearFeedback() {
    Object.keys(fields).forEach((key) => {
      fields[key].classList.remove("input-invalid");
      errors[key].textContent = "";
    });

    statusMsg.textContent = "";
    statusMsg.classList.remove("error");
  }

  function setStatus(message, isError) {
    statusMsg.textContent = message;
    statusMsg.classList.toggle("error", isError);
  }

  function setSecurityStatus(message, isError) {
    securityStatusMsg.textContent = message;
    securityStatusMsg.classList.toggle("error", isError);
  }

  function clearSecurityStatus() {
    securityStatusMsg.textContent = "";
    securityStatusMsg.classList.remove("error");
  }

  function clearSecurityFeedback() {
    Object.keys(securityFields).forEach((key) => {
      securityFields[key].classList.remove("input-invalid");
      securityErrors[key].textContent = "";
    });
    clearSecurityStatus();
  }

  function validateSecurity(data) {
    let valid = true;

    if (!data.currentPassword) {
      showSecurityError("currentPassword", "Current password is required.");
      valid = false;
    }

    const hasUpper = /[A-Z]/.test(data.newSecurityPassword);
    const hasLower = /[a-z]/.test(data.newSecurityPassword);
    const hasNumber = /\d/.test(data.newSecurityPassword);
    const hasSymbol = /[\W_]/.test(data.newSecurityPassword);

    if (!data.newSecurityPassword) {
      showSecurityError("newSecurityPassword", "New password is required.");
      valid = false;
    } else if (data.newSecurityPassword.length < 8 || !hasUpper || !hasLower || !hasNumber || !hasSymbol) {
      showSecurityError("newSecurityPassword", "Use 8+ chars with upper, lower, number, and symbol.");
      valid = false;
    }

    if (!data.confirmSecurityPassword) {
      showSecurityError("confirmSecurityPassword", "Please confirm your new password.");
      valid = false;
    } else if (data.newSecurityPassword !== data.confirmSecurityPassword) {
      showSecurityError("confirmSecurityPassword", "New password and confirmation do not match.");
      valid = false;
    }

    return valid;
  }

  function setSubmitting(isSubmitting) {
    saveBtn.disabled = isSubmitting;
    saveBtn.textContent = isSubmitting ? "Saving..." : "Save Changes";
  }

  function persistLocal(payload) {
    const existing = readProfileData();
    const profileOnly = {
      fullName: payload.fullName,
      email: payload.email.trim().toLowerCase(),
      phone: payload.phone,
      address: payload.address,
      avatar: typeof payload.avatar === "string" ? payload.avatar : (existing.avatar || ""),
      updatedAt: payload.updatedAt
    };

    const previousEmail = getCurrentUserEmail();
    const nextEmail = profileOnly.email;
    if (nextEmail) {
      setCurrentUserEmail(nextEmail);
      activeProfileKey = getProfileStorageKey(nextEmail);
      if (previousEmail && previousEmail !== nextEmail) {
        localStorage.removeItem(getProfileStorageKey(previousEmail));
      }
    }

    localStorage.setItem(activeProfileKey, JSON.stringify(profileOnly));
    localStorage.removeItem(legacyStorageKey);
    syncCurrentUserProfile(profileOnly);
  }

  function loadSavedData() {
    const currentEmail = getCurrentUserEmail();
    activeProfileKey = getProfileStorageKey(currentEmail);

    const saved = readProfileData();
    if (saved.fullName) {
      fields.fullName.value = saved.fullName;
    }
    if (saved.email) {
      fields.email.value = saved.email;
    }
    if (saved.phone) {
      fields.phone.value = saved.phone;
    }
    if (saved.address) {
      fields.address.value = saved.address;
    }
    if (saved.avatar) {
      avatarImage.src = saved.avatar;
    }

    const currentUser = getCurrentUser();
    if (currentUser) {
      if (!fields.fullName.value) {
        fields.fullName.value = currentUser.name || "";
      }
      if (!fields.email.value) {
        fields.email.value = currentUser.email || "";
      }
      if (!fields.phone.value) {
        fields.phone.value = currentUser.phone || "";
      }
      if (!fields.address.value) {
        fields.address.value = currentUser.address || "";
      }
      if (!saved.avatar && currentUser.avatar) {
        avatarImage.src = currentUser.avatar;
      }
    }
  }

  async function hydrateProfileFromApi() {
    const currentEmail = getCurrentUserEmail();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(currentEmail)) {
      return;
    }

    try {
      const response = await fetch(
        getApiUrl(`/api/profile/settings?email=${encodeURIComponent(currentEmail)}`),
        { method: "GET" }
      );
      if (response.status === 404 || response.status === 405) {
        return;
      }

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success !== true || !payload.profile) {
        return;
      }

      const profile = payload.profile;
      const existing = readProfileData();
      const merged = {
        fullName: profile.fullName || fields.fullName.value || existing.fullName || "",
        email: String(profile.email || currentEmail).trim().toLowerCase(),
        phone: profile.phone || fields.phone.value || existing.phone || "",
        address: profile.address || fields.address.value || existing.address || "",
        avatar: typeof profile.avatar === "string" ? profile.avatar : (existing.avatar || ""),
        updatedAt: new Date().toISOString()
      };

      fields.fullName.value = merged.fullName;
      fields.email.value = merged.email;
      fields.phone.value = merged.phone;
      fields.address.value = merged.address;
      if (merged.avatar) {
        avatarImage.src = merged.avatar;
      }

      persistLocal(merged);
    } catch (_error) {
      // Keep local fallback when API is unavailable.
    }
  }

  function bindAvatarUpload() {
    avatarInput.addEventListener("change", () => {
      const file = avatarInput.files && avatarInput.files[0];
      if (!file) {
        return;
      }

      const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
      if (!allowedTypes.includes(file.type)) {
        setAvatarMsg("Use JPG, PNG, or WEBP only.", true);
        avatarInput.value = "";
        return;
      }

      const maxBytes = 2 * 1024 * 1024;
      if (file.size > maxBytes) {
        setAvatarMsg("Image too large. Max size is 2MB.", true);
        avatarInput.value = "";
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        avatarImage.src = dataUrl;
        saveAvatar(dataUrl);
        setAvatarMsg("Profile picture updated.", false);
      };
      reader.onerror = () => {
        setAvatarMsg("Could not read image file.", true);
      };
      reader.readAsDataURL(file);
    });
  }

  function bindAvatarRemove() {
    removeAvatarBtn.addEventListener("click", () => {
      avatarImage.src = defaultAvatarSrc;
      avatarInput.value = "";
      clearSavedAvatar();
      setAvatarMsg("Profile picture removed.", false);
    });
  }

  function bindLogout() {
    const runLogout = (event) => {
      if (event) {
        event.preventDefault();
      }
      localStorage.removeItem(currentUserKey);
      sessionStorage.removeItem(currentUserKey);
      window.location.href = "../frontpage.html";
    };

    if (logoutBtn) {
      logoutBtn.addEventListener("click", runLogout);
    }

    if (topLogoutLink) {
      topLogoutLink.addEventListener("click", runLogout);
    }
  }

  async function syncAvatarToApi(avatarValue) {
    const currentEmail = getCurrentUserEmail();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(currentEmail)) {
      return;
    }

    const payload = {
      fullName: fields.fullName.value.trim(),
      email: fields.email.value.trim() || currentEmail,
      phone: fields.phone.value.trim().replace(/[\s-]/g, ""),
      address: fields.address.value.trim(),
      avatar: typeof avatarValue === "string" ? avatarValue : "",
      currentEmail: currentEmail
    };

    if (!payload.fullName || !payload.phone || !payload.address) {
      return;
    }

    try {
      await fetch(getApiUrl("/api/profile/settings"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
    } catch (_error) {
      // Keep local avatar when API is unavailable.
    }
  }

  function saveAvatar(dataUrl) {
    const existing = readProfileData();
    const nextData = {
      ...existing,
      email: existing.email || getCurrentUserEmail(),
      avatar: dataUrl,
      updatedAt: new Date().toISOString()
    };
    localStorage.setItem(activeProfileKey, JSON.stringify(nextData));
    syncCurrentUserProfile({ avatar: dataUrl, email: nextData.email });
    localStorage.removeItem(legacyStorageKey);
    void syncAvatarToApi(dataUrl);
  }

  function clearSavedAvatar() {
    const existing = readProfileData();
    const nextData = {
      ...existing,
      email: existing.email || getCurrentUserEmail(),
      avatar: "",
      updatedAt: new Date().toISOString()
    };
    localStorage.setItem(activeProfileKey, JSON.stringify(nextData));
    syncCurrentUserProfile({ avatar: "", email: nextData.email });
    localStorage.removeItem(legacyStorageKey);
    void syncAvatarToApi("");
  }

  function setAvatarMsg(message, isError) {
    avatarMsg.textContent = message;
    avatarMsg.classList.toggle("error", isError);
  }

  function safeParse(value) {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return {};
    }
  }

  function readOrders() {
    const mergedOrders = [];

    for (const key of orderStorageKeys) {
      const parsed = safeParse(localStorage.getItem(key));
      if (Array.isArray(parsed) && parsed.length > 0) {
        mergedOrders.push(...parsed);
      }
    }

    const latestBooking = safeParse(localStorage.getItem("latestBooking"));
    if (latestBooking && typeof latestBooking === "object" && !Array.isArray(latestBooking)) {
      mergedOrders.push(latestBooking);
    }

    return mergedOrders;
  }

  function getOrderSourceId(record) {
    return String((record && (record.orderId || record.id)) || "")
      .trim()
      .toLowerCase();
  }

  function getOrderSourceFallbackKey(record) {
    if (!record || typeof record !== "object") {
      return "";
    }

    const model = String(record.model || record.productName || record.itemName || record.vehicle || "")
      .trim()
      .toLowerCase();
    const createdAt = String(record.createdAt || record.updatedAt || "").trim();
    const total = Number(record.total || record.subtotal || 0).toFixed(2);
    const email = normalizeEmail(record.userEmail || record.email || "");

    if (!model && !createdAt && total === "0.00") {
      return "";
    }

    return `${model}|${createdAt}|${total}|${email}`;
  }

  function getOrderSourceKey(record) {
    const orderId = getOrderSourceId(record);
    if (orderId) {
      return `id:${orderId}`;
    }
    const fallback = getOrderSourceFallbackKey(record);
    return fallback ? `fallback:${fallback}` : "";
  }

  function getMergedOrderStatus(statusValue, fulfillmentValue) {
    return `${String(statusValue || "")} ${String(fulfillmentValue || "")}`.toLowerCase();
  }

  function isCancelledOrderStatus(statusValue, fulfillmentValue) {
    return getMergedOrderStatus(statusValue, fulfillmentValue).includes("cancel");
  }

  function isRejectedOrderStatus(statusValue, fulfillmentValue) {
    const merged = getMergedOrderStatus(statusValue, fulfillmentValue);
    if (merged.includes("cancel")) {
      return false;
    }
    return merged.includes("reject");
  }

  function isHiddenOrderStatus(statusValue, fulfillmentValue) {
    return isCancelledOrderStatus(statusValue, fulfillmentValue)
      || isRejectedOrderStatus(statusValue, fulfillmentValue);
  }

  function getRecordOrderEmail(record) {
    return normalizeEmail((record && (record.userEmail || record.email)) || "");
  }

  function isOrderRecordForCurrentUser(record, currentEmail) {
    const target = normalizeEmail(currentEmail);
    if (!target) {
      return true;
    }
    return getRecordOrderEmail(record) === target;
  }

  function getRejectedNotifiedStorageKey(email) {
    const normalized = normalizeEmail(email);
    return rejectedOrderNotifiedKeyPrefix + (normalized || "guest");
  }

  function readRejectedNotifiedIds(email) {
    const parsed = safeParse(localStorage.getItem(getRejectedNotifiedStorageKey(email)));
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  }

  function saveRejectedNotifiedIds(email, ids) {
    localStorage.setItem(getRejectedNotifiedStorageKey(email), JSON.stringify(Array.from(ids)));
  }

  function getRejectedNotificationId(record) {
    const sourceKey = getOrderSourceKey(record);
    if (sourceKey) {
      return sourceKey;
    }
    const orderId = getOrderSourceId(record);
    return orderId ? `id:${orderId}` : "";
  }

  function getRejectedOrderLabel(record) {
    return String((record && (record.model || record.productName || record.itemName || record.vehicle)) || "your booking")
      .trim();
  }

  function buildRejectedOrderMessage(rejectedOrders) {
    const rows = Array.isArray(rejectedOrders) ? rejectedOrders : [];
    if (rows.length === 1) {
      return `Booking rejected by admin: ${getRejectedOrderLabel(rows[0])}. Inalis na ito sa active bookings mo.`;
    }
    if (rows.length > 1) {
      return `${rows.length} booking requests were rejected by admin and removed from your active bookings.`;
    }
    return "";
  }

  function captureRejectedOrderNotifications(rawOrders, currentEmail) {
    const rows = Array.isArray(rawOrders) ? rawOrders : [];
    const seenIds = new Set(readRejectedNotifiedIds(currentEmail));
    let seenChanged = false;
    const newlyRejected = [];
    const rejectedOrderIds = new Set();

    rows.forEach((record) => {
      if (!record || typeof record !== "object") {
        return;
      }
      if (!isOrderRecordForCurrentUser(record, currentEmail)) {
        return;
      }

      const status = String(record.status || "");
      const fulfillmentStatus = String(record.fulfillmentStatus || "");
      if (!isRejectedOrderStatus(status, fulfillmentStatus)) {
        return;
      }

      const orderId = getOrderSourceId(record);
      if (orderId) {
        rejectedOrderIds.add(orderId);
      }

      const notificationId = getRejectedNotificationId(record);
      if (!notificationId || seenIds.has(notificationId)) {
        return;
      }

      seenIds.add(notificationId);
      seenChanged = true;
      newlyRejected.push(record);
    });

    if (seenChanged) {
      saveRejectedNotifiedIds(currentEmail, seenIds);
    }

    return {
      newlyRejected,
      rejectedOrderIds
    };
  }

  function cleanupHiddenOrdersInLocalStorage(currentEmail, rejectedOrderIdsInput) {
    const targetEmail = normalizeEmail(currentEmail);
    const rejectedOrderIds = rejectedOrderIdsInput instanceof Set
      ? rejectedOrderIdsInput
      : new Set();

    orderStorageKeys.forEach((key) => {
      const parsed = safeParse(localStorage.getItem(key));
      if (!Array.isArray(parsed)) {
        return;
      }

      const filtered = parsed.filter((record) => {
        if (!record || typeof record !== "object") {
          return false;
        }
        if (!isOrderRecordForCurrentUser(record, targetEmail)) {
          return true;
        }

        const orderId = getOrderSourceId(record);
        if (orderId && rejectedOrderIds.has(orderId)) {
          return false;
        }

        const status = String(record.status || "");
        const fulfillmentStatus = String(record.fulfillmentStatus || "");
        return !isHiddenOrderStatus(status, fulfillmentStatus);
      });

      if (filtered.length !== parsed.length) {
        localStorage.setItem(key, JSON.stringify(filtered));
      }
    });

    const latestBooking = safeParse(localStorage.getItem("latestBooking"));
    if (latestBooking && typeof latestBooking === "object" && !Array.isArray(latestBooking)) {
      const latestEmail = getRecordOrderEmail(latestBooking);
      if (!targetEmail || latestEmail === targetEmail) {
        const latestOrderId = getOrderSourceId(latestBooking);
        const status = String(latestBooking.status || "");
        const fulfillmentStatus = String(latestBooking.fulfillmentStatus || "");
        if ((latestOrderId && rejectedOrderIds.has(latestOrderId)) || isHiddenOrderStatus(status, fulfillmentStatus)) {
          localStorage.removeItem("latestBooking");
        }
      }
    }
  }

  function mergeApiAndLocalOrders(apiOrders, localOrders) {
    const apiList = Array.isArray(apiOrders) ? apiOrders : [];
    const localList = Array.isArray(localOrders) ? localOrders : [];
    const merged = apiList.slice();
    const seen = new Set();

    apiList.forEach((record) => {
      const key = getOrderSourceKey(record);
      if (key) {
        seen.add(key);
      }
    });

    localList.forEach((record) => {
      const key = getOrderSourceKey(record);
      if (!key || !seen.has(key)) {
        merged.push(record);
      }
    });

    return merged;
  }

  function normalizeOrders(rawOrders, currentEmail) {
    const lowerEmail = normalizeEmail(currentEmail);
    const normalized = rawOrders
      .map((item, index) => {
        if (!item || typeof item !== "object") {
          return null;
        }

        const itemEmails = [
          normalizeEmail(item.userEmail),
          normalizeEmail(item.email)
        ].filter(Boolean);

        if (lowerEmail && itemEmails.length && !itemEmails.includes(lowerEmail)) {
          return null;
        }

        if (lowerEmail && itemEmails.length === 0) {
          return null;
        }

        const service = String(item.service || item.deliveryOption || "Delivery");
        const rawOrderId = String(item.orderId || item.id || "").trim();
        const status = String(item.status || "Pending review");
        const fulfillmentStatus = String(
          item.fulfillmentStatus
          || (service === "Pick Up" ? "Ready to Pick up" : "In Process")
        );
        if (isHiddenOrderStatus(status, fulfillmentStatus)) {
          return null;
        }

        return {
          orderId: String(rawOrderId || `#EC-${1000 + index}`),
          dedupeOrderId: rawOrderId.toLowerCase(),
          fullName: String(item.fullName || item.name || ""),
          email: String(item.email || item.userEmail || ""),
          model: String(item.model || item.productName || item.itemName || item.vehicle || "Ecodrive Ebike"),
          schedule: formatOrderScheduleFromRecord(item),
          status: status,
          fulfillmentStatus: fulfillmentStatus,
          service: service,
          payment: String(item.payment || item.paymentMethod || "Unspecified"),
          total: Number(item.total || item.subtotal || 0),
          createdAt: item.createdAt || item.updatedAt || "",
          shippingAddress: String(item.shippingAddress || ""),
          receiptNumber: String(item.receiptNumber || item.receipt_number || ""),
          receiptIssuedAt: item.receiptIssuedAt || item.receipt_issued_at || "",
          trackingEta: String(item.trackingEta || item.eta || ""),
          trackingLocation: String(
            item.trackingLocation
            || item.locationNote
            || item.location
            || ""
          )
        };
      })
      .filter(Boolean);

    if (!normalized.length) {
      return [];
    }

    normalized.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    const deduped = [];
    const seen = new Set();
    normalized.forEach((item) => {
      const key = item.dedupeOrderId
        ? `id:${item.dedupeOrderId}`
        : `fallback:${String(item.model || "").toLowerCase()}|${String(item.createdAt || "")}|${Number(item.total || 0).toFixed(2)}|${String(item.service || "").toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(item);
      }
    });

    return deduped.slice(0, 10);
  }

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function buildLocalDateTimeFromParts(dateValue, timeValue) {
    const dateText = String(dateValue || "").trim();
    const dateMatch = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!dateMatch) {
      return null;
    }

    const timeMatch = String(timeValue || "").trim().match(/^(\d{2}):(\d{2})/);
    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]) - 1;
    const day = Number(dateMatch[3]);
    const hours = timeMatch ? Number(timeMatch[1]) : 0;
    const minutes = timeMatch ? Number(timeMatch[2]) : 0;
    const value = new Date(year, month, day, hours, minutes, 0, 0);
    if (Number.isNaN(value.getTime())) {
      return null;
    }
    return value;
  }

  function formatOrderScheduleFromRecord(record) {
    if (!record || typeof record !== "object") {
      return "-";
    }

    const explicitLabel = String(record.scheduleLabel || "").trim();
    if (explicitLabel) {
      return explicitLabel;
    }

    const scheduleDate = record.scheduleDate || record.bookingDate || "";
    const scheduleTime = record.scheduleTime || record.bookingTime || "";
    const scheduleFromParts = buildLocalDateTimeFromParts(scheduleDate, scheduleTime);
    if (scheduleFromParts) {
      return scheduleFromParts.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true
      });
    }

    const scheduledAt = new Date(record.scheduledAt || record.scheduleAt || "");
    if (!Number.isNaN(scheduledAt.getTime())) {
      return scheduledAt.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true
      });
    }

    return "-";
  }

  function formatOrderDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "-";
    }

    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  }

  function formatPeso(value) {
    const amount = Number(value || 0);
    return `\u20B1${amount.toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }

  function formatPesoText(value) {
    const amount = Number(value || 0);
    return `PHP ${amount.toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }

  function isDeliveryService(serviceValue) {
    return String(serviceValue || "").trim().toLowerCase().includes("delivery");
  }

  function buildTrackingLabel(order) {
    const service = String(order && order.service || "").trim().toLowerCase();
    const status = String(order && order.status || "").trim();
    const fulfillment = String(order && order.fulfillmentStatus || "").trim();
    const trackingEta = String(order && order.trackingEta || "").trim();
    const merged = `${status} ${fulfillment}`.toLowerCase();

    if (service.includes("delivery")) {
      if (merged.includes("delivered") || merged.includes("completed")) {
        return "Delivered";
      }
      if (merged.includes("arriving")) {
        return "Arriving soon";
      }
      if (merged.includes("out for delivery")) {
        if (trackingEta) {
          return `Rider is on the way (ETA ${trackingEta})`;
        }
        return "Rider is on the way";
      }
      if (merged.includes("rider assigned")) {
        return "Rider assigned";
      }
      if (merged.includes("dispatch")) {
        return "Preparing for dispatch";
      }
      if (merged.includes("approve")) {
        return "Order approved. Preparing for dispatch";
      }
    }

    if (service.includes("pick")) {
      if (merged.includes("picked up")) {
        return "Picked up";
      }
      if (merged.includes("ready")) {
        return "Ready for pick up";
      }
    }

    return fulfillment || status || "In Process";
  }

  function isReceiptEligibleStatus(statusValue, fulfillmentValue) {
    const merged = `${String(statusValue || "")} ${String(fulfillmentValue || "")}`.toLowerCase();
    if (merged.includes("reject") || merged.includes("cancel")) {
      return false;
    }
    return (
      merged.includes("approve")
      || merged.includes("deliver")
      || merged.includes("complete")
      || merged.includes("picked up")
      || merged.includes("released")
    );
  }

  function encodeToken(value) {
    return encodeURIComponent(String(value || ""));
  }

  function decodeToken(value) {
    try {
      return decodeURIComponent(String(value || ""));
    } catch (_error) {
      return String(value || "");
    }
  }

  function getReceiptNumberForOrder(order) {
    const existing = String(order && order.receiptNumber || "").trim();
    if (existing) {
      return existing;
    }
    const orderId = String(order && order.orderId || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const dateBase = new Date(order && (order.receiptIssuedAt || order.createdAt) || "");
    const year = Number.isNaN(dateBase.getTime()) ? new Date().getFullYear() : dateBase.getFullYear();
    const month = String((Number.isNaN(dateBase.getTime()) ? new Date().getMonth() : dateBase.getMonth()) + 1).padStart(2, "0");
    const day = String(Number.isNaN(dateBase.getTime()) ? new Date().getDate() : dateBase.getDate()).padStart(2, "0");
    const suffix = orderId.slice(-8) || "PENDING";
    return `ECR-${year}${month}${day}-${suffix}`;
  }

  function formatReceiptIssuedDate(value) {
    const date = new Date(value || "");
    if (Number.isNaN(date.getTime())) {
      return "Date unavailable";
    }
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    });
  }

  function buildPrintableReceiptHtml(order) {
    const receiptNumber = getReceiptNumberForOrder(order);
    const issuedAt = formatReceiptIssuedDate(order.receiptIssuedAt || order.createdAt);
    const printedAt = new Date().toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    });
    const customer = escapeHtml(String(order.fullName || "Customer"));
    const email = escapeHtml(String(order.email || "-"));
    const orderId = escapeHtml(String(order.orderId || "-"));
    const model = escapeHtml(String(order.model || "Ecodrive E-Bike"));
    const service = escapeHtml(String(order.service || "-"));
    const payment = escapeHtml(String(order.payment || "-"));
    const schedule = escapeHtml(String(order.schedule || "-"));
    const status = escapeHtml(String(order.status || "-"));
    const fulfillment = escapeHtml(String(order.fulfillmentStatus || "-"));
    const trackingEta = escapeHtml(String(order.trackingEta || "Not set"));
    const trackingLocation = escapeHtml(String(order.trackingLocation || "Not set"));
    const shippingAddress = escapeHtml(String(order.shippingAddress || "-"));
    const total = escapeHtml(formatPeso(order.total || 0));
    const trackingLabel = escapeHtml(buildTrackingLabel(order));
    const encodedOrderId = encodeToken(order.orderId || "");
    const encodedCreatedAt = encodeToken(order.createdAt || "");
    const serviceLine = isDeliveryService(order.service)
      ? `<div class="row"><span class="label">Address</span><span class="value">${shippingAddress}</span></div>`
      : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ecodrive Receipt ${escapeHtml(receiptNumber)}</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;padding:14px;background:#e9edf2;font-family:"Courier New",Consolas,monospace;color:#111}
    .sheet{width:78mm;max-width:100%;margin:0 auto;background:#fff;border:1px dashed #a4abb5;padding:10px 9px}
    .center{text-align:center}
    .brand{font-size:16px;font-weight:700;letter-spacing:1px}
    .muted{font-size:9px;line-height:1.3}
    .hr{border-top:1px dashed #111;margin:6px 0}
    .row{display:flex;justify-content:space-between;gap:8px;font-size:10px;line-height:1.35}
    .label{flex:0 0 40%}
    .value{flex:1;text-align:right;word-break:break-word}
    .items-head,.item{display:flex;justify-content:space-between;gap:6px;font-size:10px;line-height:1.35}
    .item-name{flex:1;word-break:break-word}
    .item-qty{width:24px;text-align:center}
    .item-amount{width:74px;text-align:right}
    .totals{margin-top:4px}
    .strong{font-weight:700}
    .foot{margin-top:8px;text-align:center;font-size:9px;line-height:1.4}
    .actions{margin-top:10px;display:flex;gap:6px;justify-content:center}
    .actions button{border:1px solid #111;background:#fff;padding:6px 10px;font:inherit;font-size:10px;cursor:pointer}
    .actions .download{background:#1f4a92;border-color:#1f4a92;color:#fff}
    @media print{
      @page{size:80mm auto;margin:4mm}
      body{background:#fff;padding:0}
      .sheet{width:100%;max-width:none;border:none;padding:0}
      .actions{display:none}
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="center brand">ECODRIVE</div>
    <div class="center muted">Official Booking Receipt</div>
    <div class="center muted">${escapeHtml(issuedAt)}</div>
    <div class="hr"></div>

    <div class="row"><span class="label">Receipt No</span><span class="value">${escapeHtml(receiptNumber)}</span></div>
    <div class="row"><span class="label">Order ID</span><span class="value">${orderId}</span></div>
    <div class="row"><span class="label">Customer</span><span class="value">${customer}</span></div>
    <div class="row"><span class="label">Email</span><span class="value">${email}</span></div>
    <div class="row"><span class="label">Service</span><span class="value">${service}</span></div>
    <div class="row"><span class="label">Payment</span><span class="value">${payment}</span></div>
    <div class="row"><span class="label">Schedule</span><span class="value">${schedule}</span></div>
    ${serviceLine}
    <div class="row"><span class="label">Status</span><span class="value">${status}</span></div>
    <div class="row"><span class="label">Tracking</span><span class="value">${trackingLabel}</span></div>
    <div class="row"><span class="label">ETA</span><span class="value">${trackingEta}</span></div>
    <div class="row"><span class="label">Location</span><span class="value">${trackingLocation}</span></div>
    <div class="row"><span class="label">Progress</span><span class="value">${fulfillment}</span></div>

    <div class="hr"></div>
    <div class="items-head strong"><span class="item-name">Item</span><span class="item-qty">Qty</span><span class="item-amount">Amount</span></div>
    <div class="item"><span class="item-name">${model}</span><span class="item-qty">1</span><span class="item-amount">${total}</span></div>

    <div class="hr"></div>
    <div class="totals">
      <div class="row"><span class="label">Subtotal</span><span class="value">${total}</span></div>
      <div class="row"><span class="label">Discount</span><span class="value">${escapeHtml(formatPeso(0))}</span></div>
      <div class="row strong"><span class="label">TOTAL</span><span class="value">${total}</span></div>
    </div>

    <div class="hr"></div>
    <div class="foot">
      Printed: ${escapeHtml(printedAt)}<br>
      Generated by User Portal<br>
      THANK YOU
    </div>
    <div class="actions">
      <button type="button" class="download" id="receiptDownloadBtn" data-order-id="${escapeHtml(encodedOrderId)}" data-created-at="${escapeHtml(encodedCreatedAt)}">Download PDF</button>
      <button type="button" id="receiptPrintBtn">Print Receipt</button>
    </div>
  </div>
</body>
</html>`;
  }

  function getReceiptDownloadFileName(order) {
    const fallbackDate = new Date().toISOString().slice(0, 10);
    const token = getReceiptNumberForOrder(order).replace(/[^a-zA-Z0-9_-]/g, "");
    return `Ecodrive-Receipt-${token || fallbackDate}.pdf`;
  }

  function loadExternalScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-receipt-pdf][src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === "true") {
          resolve();
          return;
        }
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error(`Unable to load ${src}`)), { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.setAttribute("data-receipt-pdf", "1");
      script.addEventListener("load", () => {
        script.dataset.loaded = "true";
        resolve();
      }, { once: true });
      script.addEventListener("error", () => reject(new Error(`Unable to load ${src}`)), { once: true });
      document.head.appendChild(script);
    });
  }

  function ensureReceiptPdfLib() {
    if (window.jspdf && typeof window.jspdf.jsPDF === "function") {
      return Promise.resolve(window.jspdf.jsPDF);
    }
    if (receiptPdfLibPromise) {
      return receiptPdfLibPromise;
    }

    receiptPdfLibPromise = (async () => {
      let lastError = new Error("Unable to load PDF library.");
      for (const src of RECEIPT_PDF_SCRIPT_SOURCES) {
        try {
          await loadExternalScript(src);
          if (window.jspdf && typeof window.jspdf.jsPDF === "function") {
            return window.jspdf.jsPDF;
          }
        } catch (error) {
          lastError = error;
        }
      }
      receiptPdfLibPromise = null;
      throw lastError;
    })();

    return receiptPdfLibPromise;
  }

  function drawReceiptPdf(order, JsPdfCtor) {
    const pageWidth = 226.77;
    const pageHeight = 640;
    const doc = new JsPdfCtor({ unit: "pt", format: [pageWidth, pageHeight] });
    const marginX = 11;
    const lineHeight = 12;
    const bottomMargin = 16;
    const contentWidth = pageWidth - (marginX * 2);
    const receiptNumber = getReceiptNumberForOrder(order);
    const issuedAt = formatReceiptIssuedDate(order.receiptIssuedAt || order.createdAt);
    const generatedAt = formatReceiptIssuedDate(new Date().toISOString());
    const amountLabel = formatPesoText(order.total || 0);
    const trackingLabel = buildTrackingLabel(order);
    const deliveryAddress = isDeliveryService(order.service) ? String(order.shippingAddress || "-") : "";

    let y = 20;

    const writeCenter = (text, size, weight) => {
      if (y > pageHeight - bottomMargin) {
        doc.addPage([pageWidth, pageHeight]);
        y = 20;
      }
      doc.setFont("courier", weight || "normal");
      doc.setFontSize(size);
      doc.text(String(text || ""), pageWidth / 2, y, { align: "center" });
      y += lineHeight;
    };

    const writeRule = () => {
      writeCenter("--------------------------------", 9, "normal");
    };

    const writeLine = (text, weight) => {
      doc.setFont("courier", weight || "normal");
      doc.setFontSize(9);
      const wrapped = doc.splitTextToSize(String(text || ""), contentWidth);
      wrapped.forEach((part) => {
        if (y > pageHeight - bottomMargin) {
          doc.addPage([pageWidth, pageHeight]);
          y = 20;
        }
        doc.text(part, marginX, y);
        y += lineHeight;
      });
    };

    writeCenter("ECODRIVE", 13, "bold");
    writeCenter("OFFICIAL BOOKING RECEIPT", 9, "normal");
    writeCenter(issuedAt, 8, "normal");
    writeRule();
    writeLine(`Receipt No: ${receiptNumber}`);
    writeLine(`Order ID: ${String(order.orderId || "-")}`);
    writeLine(`Customer: ${String(order.fullName || "Customer")}`);
    writeLine(`Email: ${String(order.email || "-")}`);
    writeLine(`Service: ${String(order.service || "-")}`);
    writeLine(`Payment: ${String(order.payment || "-")}`);
    writeLine(`Schedule: ${String(order.schedule || "-")}`);
    if (deliveryAddress) {
      writeLine(`Address: ${deliveryAddress}`);
    }
    writeLine(`Status: ${String(order.status || "-")}`);
    writeLine(`Tracking: ${trackingLabel}`);
    writeLine(`ETA: ${String(order.trackingEta || "Not set")}`);
    writeLine(`Location: ${String(order.trackingLocation || "Not set")}`);
    writeLine(`Progress: ${String(order.fulfillmentStatus || "-")}`);
    writeRule();
    writeLine(`1 x ${String(order.model || "Ecodrive E-Bike")}`);
    writeLine(`Amount: ${amountLabel}`);
    writeRule();
    writeLine(`Subtotal: ${amountLabel}`, "bold");
    writeLine(`Discount: ${formatPesoText(0)}`);
    writeLine(`TOTAL: ${amountLabel}`, "bold");
    writeRule();
    writeCenter(`Generated: ${generatedAt}`, 8, "normal");
    writeCenter("Generated by User Portal", 8, "normal");
    writeCenter("THANK YOU", 9, "bold");

    return doc;
  }

  async function downloadReceiptPdf(order, triggerButton) {
    const button = triggerButton instanceof HTMLElement ? triggerButton : null;
    const originalLabel = button ? button.textContent : "";
    if (button) {
      button.disabled = true;
      button.textContent = "Preparing...";
    }

    try {
      const JsPdfCtor = await ensureReceiptPdfLib();
      const doc = drawReceiptPdf(order, JsPdfCtor);
      doc.save(getReceiptDownloadFileName(order));
    } catch (error) {
      console.error("Failed to generate receipt PDF", error);
      window.alert("Unable to download PDF right now. Please use Print Receipt.");
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalLabel || "Download PDF";
      }
    }
  }

  function bindReceiptViewActions(popup) {
    if (!popup || popup.closed || !popup.document) {
      return;
    }

    const printBtn = popup.document.getElementById("receiptPrintBtn");
    const downloadBtn = popup.document.getElementById("receiptDownloadBtn");

    if (printBtn && printBtn.dataset.bound !== "1") {
      printBtn.dataset.bound = "1";
      printBtn.addEventListener("click", () => {
        popup.print();
      });
    }

    if (downloadBtn && downloadBtn.dataset.bound !== "1") {
      downloadBtn.dataset.bound = "1";
      downloadBtn.addEventListener("click", async () => {
        if (typeof window.__ecodriveDownloadReceiptFromPopup !== "function") {
          popup.alert("Unable to download PDF right now. Please use Print Receipt.");
          return;
        }

        const originalLabel = downloadBtn.textContent;
        downloadBtn.disabled = true;
        downloadBtn.textContent = "Preparing...";
        try {
          await window.__ecodriveDownloadReceiptFromPopup(
            downloadBtn.getAttribute("data-order-id"),
            downloadBtn.getAttribute("data-created-at")
          );
        } catch (_error) {
          popup.alert("Unable to download PDF right now. Please use Print Receipt.");
        } finally {
          downloadBtn.disabled = false;
          downloadBtn.textContent = originalLabel || "Download PDF";
        }
      });
    }
  }

  function openReceiptView(order) {
    const popup = window.open("", "_blank", "width=430,height=760");
    if (!popup) {
      window.alert("Please allow pop-ups to view your receipt.");
      return;
    }
    popup.document.open();
    popup.document.write(buildPrintableReceiptHtml(order));
    popup.document.close();
    bindReceiptViewActions(popup);
    popup.focus();
  }

  window.__ecodriveDownloadReceiptFromPopup = async (orderIdToken, createdAtToken) => {
    const orderId = decodeToken(orderIdToken);
    const createdAt = decodeToken(createdAtToken);
    const target = latestRenderedOrders.find((item) => {
      return String(item.orderId || "") === String(orderId || "")
        && String(item.createdAt || "") === String(createdAt || "");
    });
    if (!target) {
      window.alert("Receipt details are unavailable. Please refresh and try again.");
      throw new Error("Receipt details unavailable");
    }
    await downloadReceiptPdf(target);
  };

  function bindOrderReceiptPrinting() {
    if (!orderList) {
      return;
    }
    orderList.addEventListener("click", async (event) => {
      const button = event.target.closest(".order-view-receipt-btn");
      if (!button) {
        return;
      }
      const orderId = decodeToken(button.getAttribute("data-order-id"));
      const createdAt = decodeToken(button.getAttribute("data-created-at"));
      const target = latestRenderedOrders.find((item) => {
        return String(item.orderId || "") === String(orderId || "")
          && String(item.createdAt || "") === String(createdAt || "");
      });
      if (!target) {
        window.alert("Receipt details are unavailable. Please refresh and try again.");
        return;
      }
      openReceiptView(target);
    });
  }

  function getStatusClassName(statusValue, fulfillmentValue) {
    const merged = `${String(statusValue || "")} ${String(fulfillmentValue || "")}`.toLowerCase();
    if (merged.includes("reject")) {
      return "rejected";
    }
    if (merged.includes("cancel")) {
      return "cancelled";
    }
    if (merged.includes("approve")) {
      return "approved";
    }
    if (
      merged.includes("completed")
      || merged.includes("delivered")
      || merged.includes("ready")
    ) {
      return "completed";
    }
    return "pending";
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getUsers() {
    try {
      const raw = localStorage.getItem(usersKey);
      const users = raw ? JSON.parse(raw) : [];
      return Array.isArray(users) ? users : [];
    } catch (_error) {
      return [];
    }
  }

  function getCurrentUserEmail() {
    const localValue = (localStorage.getItem(currentUserKey) || "").trim().toLowerCase();
    if (localValue) {
      return localValue;
    }
    return (sessionStorage.getItem(currentUserKey) || "").trim().toLowerCase();
  }

  function ensureAuthenticatedUser() {
    const email = getCurrentUserEmail();
    if (email) {
      return true;
    }
    window.location.href = "../log in.html";
    return false;
  }

  function setCurrentUserEmail(emailValue) {
    const nextEmail = String(emailValue || "").trim().toLowerCase();
    if (!nextEmail) {
      return;
    }

    if (localStorage.getItem(currentUserKey)) {
      localStorage.setItem(currentUserKey, nextEmail);
      sessionStorage.removeItem(currentUserKey);
      return;
    }

    if (sessionStorage.getItem(currentUserKey)) {
      sessionStorage.setItem(currentUserKey, nextEmail);
      localStorage.removeItem(currentUserKey);
      return;
    }

    localStorage.setItem(currentUserKey, nextEmail);
  }

  function getProfileStorageKey(emailValue) {
    const email = String(emailValue || "").trim().toLowerCase();
    return email ? `ecodrive_profile_settings::${email}` : legacyStorageKey;
  }

  function readProfileData() {
    const rawActive = localStorage.getItem(activeProfileKey);
    if (rawActive) {
      return safeParse(rawActive);
    }

    const rawLegacy = localStorage.getItem(legacyStorageKey);
    if (rawLegacy) {
      return safeParse(rawLegacy);
    }

    return {};
  }

  function getCurrentUser() {
    const email = getCurrentUserEmail();
    if (!email) {
      return null;
    }
    const users = getUsers();
    return users.find((user) => String(user.email || "").toLowerCase() === email) || null;
  }

  function updateCurrentUserPassword(currentPassword, newPassword, skipCurrentCheck) {
    const email = getCurrentUserEmail();
    if (!email) {
      return false;
    }

    const users = getUsers();
    const index = users.findIndex((user) => String(user.email || "").toLowerCase() === email);
    if (index < 0) {
      return Boolean(skipCurrentCheck);
    }

    if (!skipCurrentCheck && String(users[index].password || "") !== currentPassword) {
      return false;
    }

    users[index] = {
      ...users[index],
      password: newPassword
    };
    localStorage.setItem(usersKey, JSON.stringify(users));
    return true;
  }

  function syncCurrentUserProfile(profile) {
    const currentEmail = getCurrentUserEmail();
    const targetEmail = String(profile.email || currentEmail || "").trim().toLowerCase();
    if (!targetEmail) {
      return;
    }

    const users = getUsers();
    const index = users.findIndex((user) => String(user.email || "").toLowerCase() === currentEmail);
    if (index < 0) {
      return;
    }

    users[index] = {
      ...users[index],
      name: profile.fullName || users[index].name || "",
      email: targetEmail,
      phone: typeof profile.phone === "string" ? profile.phone : users[index].phone,
      address: typeof profile.address === "string" ? profile.address : users[index].address,
      avatar: typeof profile.avatar === "string" ? profile.avatar : users[index].avatar,
      password: users[index].password
    };
    localStorage.setItem(usersKey, JSON.stringify(users));
    setCurrentUserEmail(targetEmail);
  }
});




