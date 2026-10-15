"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
const { chromium } = require("playwright");
const base = process.env.LOCAL_TEST_BASE_URL || "http://127.0.0.1:5050";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname)) throw new Error("Tests may only target localhost.");
const root = path.resolve(__dirname, "..");
const stamp = Date.now().toString();
const email = `browser-smoke-${stamp}@example.test`;
const phone = "09" + stamp.slice(-9);
const password = "BrowserTest123!";
let browser;
let db;
let failures = [];

async function waitForVisible(page, selector) {
    await page.locator(selector).waitFor({ state: "visible", timeout: 15000 });
}

async function waitForOption(page, selector, value) {
    const option = page.locator(`${selector} option[value="${value}"]`);
    for (let attempt = 0; attempt < 60; attempt += 1) {
        if (await option.count()) return;
        await page.waitForTimeout(250);
    }
    throw new Error(`Timed out waiting for ${selector} option ${value}.`);
}

async function main() {
    const health = await fetch(`${base}/api/health`).then((response) => response.json());
    assert.equal(health.localDemoMode, true, "Refusing to run browser tests outside local demo mode.");
    const executablePath = process.env.LOCAL_BROWSER_PATH || undefined;
    browser = await chromium.launch({ channel: executablePath ? undefined : "chrome", executablePath, headless: true });
    const page = await browser.newPage();
    page.on("pageerror", (error) => failures.push(`page error: ${error.message}`));
    page.on("console", (message) => {
        if (message.type() === "error") {
            const location = message.location();
            failures.push(`console error: ${message.text()} (${location.url || "unknown"})`);
        }
    });
    page.on("requestfailed", (request) => failures.push(`request failed: ${request.url()} (${request.failure()?.errorText || "unknown"})`));
    page.on("response", async (response) => {
        if (response.status() < 500) return;
        const responseText = await response.text().catch(() => "");
        failures.push(`HTTP ${response.status()}: ${response.url()}${responseText ? ` (${responseText})` : ""}`);
    });

    for (const route of ["/", "/log%20in.html", "/forgot.html", "/signup.html", "/Userhomefolder/userhome2.html", "/admin/admin.html"]) {
        await page.goto(base + route, { waitUntil: "networkidle" });
        assert.ok((await page.title()).trim(), `${route} needs a document title`);
    }

    await page.goto(`${base}/signup.html`, { waitUntil: "networkidle" });
    await page.locator("#fullName").fill("Browser Smoke");
    await page.locator("#email").fill(email);
    await page.locator("#phone").fill(phone);
    await page.locator("#street").fill("123 Browser Street");
    await page.locator("#city").selectOption({ label: "City of Baliwag" });
    await waitForOption(page, "#barangay", "Concepcion");
    await page.locator("#barangay").selectOption({ label: "Concepcion" });
    await page.locator("#password").fill(password);
    await page.locator("#confirmPassword").fill(password);
    await page.locator("#continue-btn").click();
    await waitForVisible(page, "#signup-verification-step:not([hidden])");
    const status = await page.locator("#verification-status").innerText();
    const codeMatch = status.match(/\b(\d{4})\b/);
    assert.ok(codeMatch, `Demo code not shown: ${status}`);
    const otpInputs = page.locator("#otp-inputs input");
    assert.equal(await otpInputs.count(), 4);
    for (let index = 0; index < 4; index++) await otpInputs.nth(index).fill(codeMatch[1][index]);
    await page.locator("#verify-code-btn").click();
    await page.waitForURL(/Userhomefolder\/userhome\.html/, { timeout: 15000 });
    assert.match(await page.locator("body").innerText(), /Browser Smoke|Welcome|Ecodrive/i);

    await page.evaluate(() => {
        localStorage.setItem("latestBooking", JSON.stringify({
            orderId: "STALE-DEMO-ORDER",
            email: "another-account@example.test",
            model: "E-CAB MAX 1500",
            total: 130250,
            createdAt: "2026-04-04T00:00:00.000Z"
        }));
    });
    await page.goto(`${base}/Userhomefolder/bookings/bookings.html`, { waitUntil: "networkidle" });
    await waitForVisible(page, ".booking-empty-state");
    assert.match(await page.locator("#bookingRows").innerText(), /do not have any bookings yet/i);

    const repairDate = new Date();
    repairDate.setDate(repairDate.getDate() + 2);
    const repairDateValue = `${repairDate.getFullYear()}-${String(repairDate.getMonth() + 1).padStart(2, "0")}-${String(repairDate.getDate()).padStart(2, "0")}`;
    await page.goto(`${base}/Userhomefolder/priv,rep/repair.html`, { waitUntil: "networkidle" });
    await page.locator("#repair-name").fill("Browser Smoke");
    await page.locator("#repair-email").fill(email);
    await page.locator("#repair-phone").fill(phone);
    await page.locator("#repair-vehicle").selectOption({ label: "BLITZ 1200" });
    await page.locator("#repair-date").fill(repairDateValue);
    await page.locator("#repair-time").fill("10:00");
    await page.getByText("Home Service", { exact: true }).click();
    await page.locator("#repair-ship-street").fill("123 Browser Street");
    await page.locator("#repair-ship-barangay").fill("Concepcion");
    await page.locator("#repair-ship-city").fill("City of Baliwag");
    await page.locator("#repair-ship-province").fill("Bulacan");
    await page.locator("#repair-find-address-btn").click();
    await page.locator("#repair-ship-map-status").waitFor({ state: "visible" });
    assert.match(await page.locator("#repair-ship-map-status").innerText(), /Location found on map/i);
    await page.locator("#repair-details").fill("Local browser repair booking test.");
    await page.locator("#repair-form").press("Control+Enter").catch(() => {});
    await page.locator(".book-btn").click();
    await page.waitForURL(/repair-success\.html/, { timeout: 15000 });

    await page.goto(`${base}/log%20in.html`, { waitUntil: "networkidle" });
    await page.locator("#email").fill("ecodrive");
    await page.locator("#password").fill(process.env.LOCAL_ADMIN_PASSWORD || "ecodriveadmin123");
    await page.locator("#loginForm").press("Enter");
    await page.waitForURL(/admin\/admin\.html/, { timeout: 15000 });
    await page.waitForTimeout(500);
    assert.match(await page.locator("body").innerText(), /Dashboard/);
    assert.ok((await page.locator("#stat-total-users").innerText()).trim().length > 0);

    await page.goto(`${base}/forgot.html`, { waitUntil: "networkidle" });
    await page.locator("#contact-input").fill(email);
    await page.locator("#send-code-btn").click();
    await waitForVisible(page, "#step-otp.is-active");
    const resetStatus = await page.locator("#form-message").innerText();
    const resetCode = resetStatus.match(/\b(\d{4})\b/);
    assert.ok(resetCode, `Reset demo code not shown: ${resetStatus}`);
    const resetInputs = page.locator("#otp-inputs input");
    for (let index = 0; index < 4; index++) await resetInputs.nth(index).fill(resetCode[1][index]);
    await page.locator("#verify-code-btn").click();
    await waitForVisible(page, "#step-password.is-active");
    await page.locator("#new-password").fill("BrowserChanged123!");
    await page.locator("#confirm-password").fill("BrowserChanged123!");
    await page.locator("#reset-password-btn").click();
    await page.waitForURL(/log%20in\.html/, { timeout: 15000 });

    assert.deepEqual(failures, [], `Browser errors:\n${failures.join("\n")}`);
    console.log("PASS: public pages, signup UI, local address data, local repair map and booking, demo OTP UI, customer and admin login handoff, dashboard, and password reset UI");
}

async function cleanup() {
    if (!db) {
        const configPath = path.join(root, ".local", "config.json");
        if (!fs.existsSync(configPath)) return;
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
        db = await mysql.createConnection({ host: "127.0.0.1", port: Number(process.env.LOCAL_DB_PORT || 3307), user: "root", password: config.dbPassword, database: "ecodrive_local" });
    }
    await db.execute("DELETE FROM ebike_reviews WHERE user_email = ?", [email]);
    await db.execute("DELETE FROM bookings WHERE user_email = ?", [email]);
    await db.execute("DELETE FROM chat_threads WHERE user_email = ?", [email]);
    await db.execute("DELETE FROM users WHERE email = ?", [email]);
    await db.end();
}

main().catch((error) => { console.error("FAIL:", error.stack); process.exitCode = 1; }).finally(async () => {
    if (browser) await browser.close();
    await cleanup();
});
