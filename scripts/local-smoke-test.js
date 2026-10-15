"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
const base = process.env.LOCAL_TEST_BASE_URL || "http://127.0.0.1:5050";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname)) throw new Error("Tests may only target localhost.");
const root = path.resolve(__dirname, "..");
const stamp = Date.now().toString();
const email = `local-smoke-${stamp}@example.test`;
const phone = "09" + stamp.slice(-9);
const password = "SmokeTest123!";
const addressParts = { street: "123 Test Street", province: "Bulacan", city: "City of Baliwag", barangay: "Concepcion" };
let checks = 0;
let db;
let product;
let reserved = 0;

async function request(route, { method = "GET", body, token, status = 200 } = {}) {
    const response = await fetch(base + route, {
        method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000)
    });
    const text = await response.text();
    let result;
    try { result = JSON.parse(text); } catch { throw new Error(`${route} returned non-JSON: ${text.slice(0, 120)}`); }
    assert.equal(response.status, status, `${method} ${route}: ${text.slice(0, 500)}`);
    checks++;
    return result;
}
const post = (route, body, token, status = 200) => request(route, { method: "POST", body, token, status });

async function main() {
    const health = await request("/api/health");
    assert.equal(health.localDemoMode, true, "Refusing to run against a non-demo server.");
    assert.equal(health.dbReady, true);
    assert.equal(health.demoOtpEnabled, true);
    const config = JSON.parse(fs.readFileSync(path.join(root, ".local/config.json"), "utf8"));
    db = await mysql.createConnection({ host: "127.0.0.1", port: Number(process.env.LOCAL_DB_PORT || 3307), user: "root", password: config.dbPassword, database: "ecodrive_local" });
    const admins = {};
    for (const username of ["ecodrive", "ecodrivepulilan", "ecodrivesanildefonso", "ecodrivesanrafael", "ecodrivebustos"]) {
        const login = await post("/api/login", { email: username, password: process.env.LOCAL_ADMIN_PASSWORD || "ecodriveadmin123" });
        assert.equal(login.user.role, "admin");
        admins[username] = login.token;
        for (const route of ["/api/auth/me", "/api/admin/dashboard", "/api/admin/users", "/api/admin/bookings?scope=all", "/api/admin/products", "/api/admin/settings"]) {
            await request(route, { token: login.token });
        }
    }
    console.log("PASS: all five branch admin accounts and dashboards");
    const admin = admins.ecodrive;
    await request("/api/admin/users", { status: 401 });
    const products = await request("/api/products?branchCity=City%20of%20Baliwag");
    assert.equal(products.products.length, 16);
    product = products.products.find(item => item.model === "BLITZ 1200");
    assert.ok(product && product.stockCount > 3);
    await request(`/api/products/${product.id}`);
    const province = await request("/api/locations/provinces");
    const cities = await request(`/api/locations/provinces/${province.data[0].code}/cities-municipalities`);
    assert.equal(cities.data.length, 5);
    for (const city of cities.data) {
        const barangays = await request(`/api/locations/cities-municipalities/${city.code}/barangays`);
        assert.ok(barangays.data.length > 5);
    }
    const otp = await post("/api/signup/send-code", { method: "email", email, phone });
    assert.equal(otp.delivery.mode, "demo");
    assert.match(otp.demoCode, /^\d{4}$/);
    const wrong = await post("/api/signup/verify-code", { requestId: otp.requestId, code: otp.demoCode === "0000" ? "0001" : "0000", email, phone, method: "email" });
    assert.equal(wrong.verified, false);
    const verified = await post("/api/signup/verify-code", { requestId: otp.requestId, code: otp.demoCode, email, phone, method: "email" });
    assert.equal(verified.verified, true);
    const signup = await post("/api/signup", { firstName: "Local", lastName: "Smoke", email, phone, password, addressParts, verificationRequestId: otp.requestId, verificationMethod: "email" }, undefined, 201);
    let token = signup.token;
    const userId = signup.user.id;
    assert.ok(token && userId);
    await request("/api/admin/users", { token, status: 403 });
    token = (await post("/api/login", { email, password })).token;
    await request("/api/auth/me", { token });
    await request(`/api/profile/settings?email=${encodeURIComponent(email)}`, { token });
    const profile = await post("/api/profile/settings", { lookupEmail: email, email, fullName: "Local Smoke", phone, addressParts, address: "123 Test Street, Concepcion, City of Baliwag, Bulacan" }, token);
    token = profile.token || token;
    console.log("PASS: demo OTP, signup, login, profile and access checks");

    const schedule = new Date(); schedule.setDate(schedule.getDate() + 2);
    const date = `${schedule.getFullYear()}-${String(schedule.getMonth() + 1).padStart(2, "0")}-${String(schedule.getDate()).padStart(2, "0")}`;
    const bookingBody = { fullName: "Local Smoke", email, userEmail: email, phone, model: product.model, bikeImage: product.imageUrl, service: "Delivery", payment: "CASH ON DELIVERY", branchCity: addressParts.city, shippingAddressParts: addressParts, scheduleDate: date, scheduleTime: "10:00", subtotal: product.price, shippingFee: 0, total: product.price };
    await request(`/api/bookings/availability?date=${date}`, { token });
    const create = async (overrides = {}) => {
        const response = await post("/api/bookings", { ...bookingBody, ...overrides }, token, 201);
        assert.ok(response.booking && response.booking.orderId);
        return response.booking;
    };
    const delivery = await create();
    const order = delivery.orderId;
    await request(`/api/admin/bookings/${order}`, { token: admins.ecodrivepulilan, status: 403 });
    await post(`/api/admin/bookings/${order}/approve`, {}, admins.ecodrivepulilan, 403);
    await post(`/api/admin/bookings/${order}/approve`, {}, admin); reserved++;
    await post(`/api/admin/bookings/${order}/approve`, {}, admin);
    const afterApprove = await request(`/api/products/${product.id}?branchCity=City%20of%20Baliwag`);
    assert.equal(afterApprove.product.stockCount, product.stockCount - 1, "Repeat approval must not reserve inventory twice.");
    await post(`/api/admin/bookings/${order}/reject`, {}, admin, 409);
    await post(`/api/admin/bookings/${order}/payment-status`, { paymentStatus: "paid" }, admin);
    await post(`/api/admin/bookings/${order}/fulfillment-status`, { fulfillmentStatus: "Delivered successfully", trackingLocation: "Test address" }, admin);
    const review = { product_id: "blitz-1200", product_name: product.model, order_id: order, reviewer_name: "Local Smoke", rating: 5, review_text: "Automated local test review", user_email: email, images: [] };
    await post("/api/reviews", review, undefined, 401);
    await post("/api/reviews", { ...review, order_id: "NONEXISTENT-LOCAL", booking_status: "Completed", fulfillment_status: "Delivered" }, token, 403);
    await post("/api/reviews", review, token, 201);
    await post("/api/reviews", review, token, 409);
    const reviews = await request("/api/reviews?product_id=blitz-1200");
    assert.ok(reviews.reviews.length);
    const cancelled = await create();
    await post(`/api/bookings/${cancelled.orderId}/cancel`, {}, token);
    await post(`/api/admin/bookings/${cancelled.orderId}/approve`, {}, admin, 409);
    const rejected = await create();
    await post(`/api/admin/bookings/${rejected.orderId}/reject`, {}, admin);
    await post(`/api/admin/bookings/${rejected.orderId}/approve`, {}, admin, 409);
    const pickup = await create({ service: "Pick Up", scheduleTime: "11:00" });
    await post(`/api/admin/bookings/${pickup.orderId}/approve`, {}, admin); reserved++;
    await request(`/api/bookings?email=${encodeURIComponent(email)}`, { token });
    await request("/api/bookings/stats");
    console.log("PASS: delivery, pickup, approval, stock, payments, fulfillment, reviews, cancellation and branch isolation");

    const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBqkAAAAASUVORK5CYII=";
    const documents = Object.fromEntries(["validId1", "validId2", "proofOfIncome", "proofOfBilling", "brgyCertificate"].map(key => [key, { fileName: "test.png", dataUrl: image }]));
    const installment = await create({ service: "Installment", payment: "INSTALLMENT", scheduleDate: "", scheduleTime: "", installment: { province: "Bulacan", city: "City of Baliwag", employmentType: "None", monthsToPay: 12, downPayment: 5000, monthlyAmortization: 4000, requirementsUploads: documents } });
    await post(`/api/admin/bookings/${installment.orderId}/approve`, {}, admin); reserved++;
    const paid = await post(`/api/admin/bookings/${installment.orderId}/installment/mark-paid`, { month: 1 }, admin);
    assert.ok(paid.booking);
    await request(`/api/admin/bookings/${installment.orderId}`, { token: admin });
    await post("/api/kyc/verify-id", { idType: "National ID", idImage: "invalid" }, token, 400);
    console.log("PASS: installment uploads, admin review, first payment and invalid ID validation");

    await request("/api/chat/thread", { token });
    await post("/api/chat/messages", { message: "Hello, I need help with my booking.", clientMessageId: `smoke-${stamp}` }, token);
    await request(`/api/admin/chat/users/${userId}`, { token: admin });
    await post(`/api/admin/chat/users/${userId}/takeover`, {}, admin);
    await post(`/api/admin/chat/users/${userId}/messages`, { message: "Local admin reply", clientMessageId: `reply-${stamp}` }, admin);
    await post(`/api/admin/chat/users/${userId}/release`, {}, admin);
    await post("/api/chat/thread/clear", {}, token);
    await post(`/api/admin/users/${userId}/block`, {}, admin);
    await request("/api/auth/me", { token, status: 403 });
    await post("/api/login", { email, password }, undefined, 403);
    await post(`/api/admin/users/${userId}/unblock`, {}, admin);
    token = (await post("/api/login", { email, password })).token;
    const resetOtp = await post("/api/forgot/send-code", { contact: email, method: "email" });
    assert.match(resetOtp.demoCode, /^\d{4}$/);
    await post("/api/forgot/verify-code", { requestId: resetOtp.requestId, code: resetOtp.demoCode });
    await post("/api/reset-password", { requestId: resetOtp.requestId, email, newPassword: "ChangedSmoke123!" });
    token = (await post("/api/login", { email, password: "ChangedSmoke123!" })).token;
    await post("/api/logout", {}, token);
    await request("/api/auth/me", { token, status: 401 });
    console.log("PASS: customer/admin chat, block/unblock, demo password reset and logout revocation");

    for (const route of ["/.git/config", "/.local/config.json", "/api/admin-credentials.json", "/scripts/local-start.js", "/node_modules/mysql2/package.json"]) {
        const response = await fetch(base + route);
        assert.equal(response.status, 404, `${route} must not be public`); checks++;
    }
    console.log(`PASS: ${checks} HTTP checks plus behavior assertions`);
}

async function cleanup() {
    if (!db) return;
    // Remove only this run's synthetic records; never reset the local database.
    await db.execute("DELETE FROM ebike_reviews WHERE user_email = ?", [email]);
    await db.execute("DELETE FROM bookings WHERE user_email = ?", [email]);
    await db.execute("DELETE FROM chat_threads WHERE user_email = ?", [email]);
    await db.execute("DELETE FROM users WHERE email = ?", [email]);
    if (reserved && product) await db.execute("UPDATE product_branch_inventory SET stock_count = stock_count + ? WHERE product_id = ? AND branch_city = ?", [reserved, product.id, "City of Baliwag"]);
    await db.end();
}
main().catch(error => { console.error("FAIL:", error.stack); process.exitCode = 1; }).finally(cleanup);
