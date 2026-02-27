const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const dns = require("dns");

function loadDotEnvFile() {
    const envPath = path.join(__dirname, ".env");
    if (!fs.existsSync(envPath)) {
        return;
    }

    const raw = fs.readFileSync(envPath, "utf8");
    raw.split(/\r?\n/).forEach((line) => {
        const cleaned = String(line || "").trim();
        if (!cleaned || cleaned.startsWith("#")) {
            return;
        }

        const separatorIndex = cleaned.indexOf("=");
        if (separatorIndex < 1) {
            return;
        }

        const key = cleaned.slice(0, separatorIndex).trim();
        if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) {
            return;
        }

        let value = cleaned.slice(separatorIndex + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        process.env[key] = value;
    });
}

loadDotEnvFile();

let nodemailer = null;
try {
    nodemailer = require("nodemailer");
} catch (_error) {
    nodemailer = null;
}

let mysql = null;
try {
    mysql = require("mysql2/promise");
} catch (_error) {
    mysql = null;
}

const PORT = process.env.KYC_PORT ? Number(process.env.KYC_PORT) : 5050;
const PUBLIC_API_BASE = String(process.env.PUBLIC_API_BASE || "").trim().replace(/\/+$/, "");

const NODE_ENV = String(process.env.NODE_ENV || "development").trim().toLowerCase();
const IS_PRODUCTION = NODE_ENV === "production";
const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const otpSessions = new Map();
const signupOtpSessions = new Map();
const EMAIL_DOMAIN_LOOKUP_TTL_MS = 10 * 60 * 1000;
const emailDomainLookupCache = new Map();
const dnsPromises = dns && dns.promises ? dns.promises : null;
const RAW_SESSION_TTL_MS = Number(process.env.AUTH_SESSION_TTL_MS || "");
const SESSION_TTL_MS = (
    Number.isFinite(RAW_SESSION_TTL_MS) && RAW_SESSION_TTL_MS >= 5 * 60 * 1000
)
    ? RAW_SESSION_TTL_MS
    : 24 * 60 * 60 * 1000;
const authSessions = new Map();
const ALLOW_DEMO_OTP = String(process.env.ALLOW_DEMO_OTP || "").trim().toLowerCase() === "true";
const DEMO_OTP_ENABLED = ALLOW_DEMO_OTP && !IS_PRODUCTION;
const CORS_ALLOWED_ORIGINS = buildAllowedCorsOrigins(String(process.env.CORS_ALLOWED_ORIGINS || ""));
const RATE_LIMIT_WINDOW_MS = parsePositiveInt(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000);
const LOGIN_RATE_LIMIT_MAX = parsePositiveInt(process.env.LOGIN_RATE_LIMIT_MAX, 10);
const OTP_SEND_RATE_LIMIT_MAX = parsePositiveInt(process.env.OTP_SEND_RATE_LIMIT_MAX, 6);
const OTP_VERIFY_RATE_LIMIT_MAX = parsePositiveInt(process.env.OTP_VERIFY_RATE_LIMIT_MAX, 10);
const rateLimitBuckets = new Map();

const DEFAULT_ADMIN_LOGIN_ID = String(process.env.ADMIN_LOGIN_ID || "").trim();
const DEFAULT_ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "");
const ADMIN_CREDENTIALS_PATH = path.join(__dirname, "admin-credentials.json");
let adminCredentialsCache = null;

const DB_HOST = String(process.env.DB_HOST || "127.0.0.1").trim();
const DB_PORT = Number(process.env.DB_PORT || "3306");
const DB_USER = String(process.env.DB_USER || "root").trim();
const DB_PASSWORD = String(process.env.DB_PASSWORD || "").trim();
const DB_NAME = String(process.env.DB_NAME || "ecodrive_db").trim();
let dbPool = null;

const SMTP_HOST = String(process.env.SMTP_HOST || "").trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || "587");
const SMTP_USER = String(process.env.SMTP_USER || "").trim();
const SMTP_PASS = String(process.env.SMTP_PASS || "").trim();
const SMTP_FROM = String(process.env.SMTP_FROM || "").trim();
const SMTP_SECURE = String(process.env.SMTP_SECURE || "").trim().toLowerCase() === "true";

const SMS_WEBHOOK_URL = String(process.env.SMS_WEBHOOK_URL || "").trim();
const SMS_WEBHOOK_TOKEN = String(process.env.SMS_WEBHOOK_TOKEN || "").trim();
const SEMAPHORE_RELAY_TOKEN = String(process.env.SEMAPHORE_RELAY_TOKEN || SMS_WEBHOOK_TOKEN).trim();
const SEMAPHORE_API_KEY = String(process.env.SEMAPHORE_API_KEY || "").trim();
const SEMAPHORE_SENDERNAME = String(process.env.SEMAPHORE_SENDERNAME || "").trim();
const SEMAPHORE_API_BASE = String(process.env.SEMAPHORE_API_BASE || "https://api.semaphore.co/api/v4")
    .trim()
    .replace(/\/+$/, "");
const SEMAPHORE_REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.SEMAPHORE_REQUEST_TIMEOUT_MS, 15000);
let smtpTransport = null;

const DEFAULT_PRODUCT_CATALOG = [
    { model: "BLITZ 2000", price: 68000, category: "2-Wheel", imageUrl: "/Userhomefolder/image 1.png", detailUrl: "/Userhomefolder/Ebikes/ebike1.0.html" },
    { model: "BLITZ 1200", price: 45000, category: "2-Wheel", imageUrl: "/Userhomefolder/image 2.png", detailUrl: "/Userhomefolder/Ebikes/ebike2.0.html" },
    { model: "FUN 1500 FI", price: 74000, category: "2-Wheel", imageUrl: "/Userhomefolder/image 3.png", detailUrl: "/Userhomefolder/Ebikes/ebike3.0.html" },
    { model: "CANDY 800", price: 58000, category: "2-Wheel", imageUrl: "/Userhomefolder/image 4.png", detailUrl: "/Userhomefolder/Ebikes/ebike4.0.html" },
    { model: "BLITZ 200R", price: 74000, category: "2-Wheel", imageUrl: "/Userhomefolder/image 5.png", detailUrl: "/Userhomefolder/Ebikes/ebike5.0.html" },
    { model: "TRAVELLER 1500", price: 79000, category: "2-Wheel", imageUrl: "/Userhomefolder/image 6.png", detailUrl: "/Userhomefolder/Ebikes/ebike6.0.html" },
    { model: "ECONO 500 MP", price: 51500, category: "2-Wheel", imageUrl: "/Userhomefolder/image 7.png", detailUrl: "/Userhomefolder/Ebikes/ebike7.0.html" },
    { model: "ECONO 350 MINI-II", price: 58000, category: "2-Wheel", imageUrl: "/Userhomefolder/image 8.png", detailUrl: "/Userhomefolder/Ebikes/ebike8.0.html" },
    { model: "ECARGO 100", price: 72500, category: "3-Wheel", imageUrl: "/Userhomefolder/image 9.png", detailUrl: "/Userhomefolder/Ebikes/ebike9.0.html" },
    { model: "ECONO 650 MP", price: 65000, category: "3-Wheel", imageUrl: "/Userhomefolder/image 10.png", detailUrl: "/Userhomefolder/Ebikes/ebike10.0.html" },
    { model: "ECAB 100V V2", price: 51500, category: "3-Wheel", imageUrl: "/Userhomefolder/image 11.png", detailUrl: "/Userhomefolder/Ebikes/ebike11.0.html" },
    { model: "ECONO 800 MP II", price: 67000, category: "3-Wheel", imageUrl: "/Userhomefolder/image 12.png", detailUrl: "/Userhomefolder/Ebikes/ebike12.0.html" },
    { model: "E-CARGO 800", price: 205000, category: "4-Wheel", imageUrl: "/Userhomefolder/image 13.png", detailUrl: "/Userhomefolder/Ebikes/ebike13.0.html" },
    { model: "E-CAB MAX 1500", price: 130000, category: "4-Wheel", imageUrl: "/Userhomefolder/image 14.png", detailUrl: "/Userhomefolder/Ebikes/ebike14.0.html" },
    { model: "E-CAB 1000", price: 75000, category: "4-Wheel", imageUrl: "/Userhomefolder/image 15.png", detailUrl: "/Userhomefolder/Ebikes/ebike15.0.html" },
    { model: "ECONO 800 MP", price: 100000, category: "4-Wheel", imageUrl: "/Userhomefolder/image 16.png", detailUrl: "/Userhomefolder/Ebikes/ebike16.0.html" }
];
const MAX_PRODUCT_IMAGE_DATA_URL_LENGTH = 3 * 1024 * 1024;
const MAX_BOOKINGS_PER_DAY = 5;
const ALLOWED_PAYMENT_STATUSES = new Set([
    "awaiting_payment_confirmation",
    "pending_cod",
    "installment_review",
    "paid",
    "failed",
    "refunded",
    "not_applicable"
]);
const CHAT_THREAD_MODE_BOT = "bot";
const CHAT_THREAD_MODE_ADMIN = "admin";
const CHAT_ALLOWED_MESSAGE_ROLES = new Set(["user", "bot", "admin", "system"]);
const MAX_CHAT_MESSAGE_TEXT_LENGTH = 2000;
const DEFAULT_CHAT_MESSAGE_LIMIT = 180;
const MAX_CHAT_MESSAGE_LIMIT = 300;

function sendJson(res, statusCode, payload, extraHeaders) {
    const responseHeaders = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400"
    };
    const allowedOrigin = resolveAllowedCorsOrigin(res && res.req);
    if (allowedOrigin) {
        responseHeaders["Access-Control-Allow-Origin"] = allowedOrigin;
        responseHeaders["Vary"] = "Origin";
    }
    if (extraHeaders && typeof extraHeaders === "object") {
        Object.assign(responseHeaders, extraHeaders);
    }
    res.writeHead(statusCode, responseHeaders);
    res.end(JSON.stringify(payload));
}

function parsePositiveInt(rawValue, fallbackValue) {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallbackValue;
    }
    return Math.floor(parsed);
}

function extractOrigin(value) {
    const raw = String(value || "").trim();
    if (!raw) {
        return "";
    }
    try {
        return new URL(raw).origin;
    } catch (_error) {
        return "";
    }
}

function buildAllowedCorsOrigins(rawInput) {
    const origins = new Set();
    const addOrigin = (value) => {
        const origin = extractOrigin(value);
        if (!origin) {
            return;
        }
        origins.add(origin);
    };

    String(rawInput || "")
        .split(",")
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .forEach(addOrigin);

    addOrigin("http://127.0.0.1:5500");
    addOrigin("http://localhost:5500");
    addOrigin("http://127.0.0.1:5050");
    addOrigin("http://localhost:5050");
    addOrigin(PUBLIC_API_BASE);

    return origins;
}

function resolveAllowedCorsOrigin(req) {
    const requestOrigin = String((req && req.headers && req.headers.origin) || "").trim();
    if (!requestOrigin) {
        return "";
    }
    const normalizedOrigin = extractOrigin(requestOrigin);
    if (!normalizedOrigin) {
        return "";
    }
    if (CORS_ALLOWED_ORIGINS.has(normalizedOrigin)) {
        return normalizedOrigin;
    }
    // Allow local frontend dev servers on any port.
    try {
        const parsed = new URL(normalizedOrigin);
        const protocol = String(parsed.protocol || "").toLowerCase();
        const host = String(parsed.hostname || "").trim().toLowerCase();
        const isLocalHost = host === "127.0.0.1" || host === "localhost" || host === "0.0.0.0";
        if ((protocol === "http:" || protocol === "https:") && isLocalHost) {
            return normalizedOrigin;
        }
    } catch (_error) {
        return "";
    }
    return "";
}

function getRequestIp(req) {
    const forwarded = String((req && req.headers && req.headers["x-forwarded-for"]) || "").trim();
    if (forwarded) {
        const first = forwarded.split(",")[0];
        const cleaned = String(first || "").trim();
        if (cleaned) {
            return cleaned;
        }
    }
    return String((req && req.socket && req.socket.remoteAddress) || "unknown").trim().toLowerCase();
}

function clearExpiredRateLimitBuckets() {
    const now = Date.now();
    for (const [key, bucket] of rateLimitBuckets.entries()) {
        if (!bucket || Number(bucket.resetAt || 0) <= now) {
            rateLimitBuckets.delete(key);
        }
    }
}

function consumeRateLimitBucket(key, maxAttempts, windowMs) {
    clearExpiredRateLimitBuckets();
    const now = Date.now();
    const max = parsePositiveInt(maxAttempts, 1);
    const ttl = parsePositiveInt(windowMs, 60 * 1000);
    const current = rateLimitBuckets.get(key);

    if (!current || Number(current.resetAt || 0) <= now) {
        const next = {
            count: 1,
            resetAt: now + ttl
        };
        rateLimitBuckets.set(key, next);
        return {
            allowed: true,
            remaining: Math.max(0, max - next.count),
            retryAfterMs: 0
        };
    }

    current.count += 1;
    rateLimitBuckets.set(key, current);
    if (current.count > max) {
        return {
            allowed: false,
            remaining: 0,
            retryAfterMs: Math.max(0, Number(current.resetAt || 0) - now)
        };
    }

    return {
        allowed: true,
        remaining: Math.max(0, max - current.count),
        retryAfterMs: 0
    };
}

function enforceRateLimit(req, res, scope, identity, maxAttempts, windowMs) {
    const ip = getRequestIp(req);
    const scopedKey = [
        String(scope || "general").trim().toLowerCase(),
        ip,
        String(identity || "").trim().toLowerCase()
    ].join("|");
    const result = consumeRateLimitBucket(scopedKey, maxAttempts, windowMs);
    if (result.allowed) {
        return true;
    }

    const retryAfterSeconds = Math.max(1, Math.ceil(Number(result.retryAfterMs || 0) / 1000));
    sendJson(
        res,
        429,
        {
            success: false,
            code: "RATE_LIMITED",
            message: "Too many requests. Please wait before trying again.",
            retryAfterSeconds: retryAfterSeconds
        },
        {
            "Retry-After": String(retryAfterSeconds)
        }
    );
    return false;
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let raw = "";
        req.on("data", (chunk) => {
            raw += chunk;
            if (raw.length > 8 * 1024 * 1024) {
                reject(new Error("Payload too large"));
                req.destroy();
            }
        });
        req.on("end", () => {
            try {
                const parsed = raw ? JSON.parse(raw) : {};
                resolve(parsed);
            } catch (_error) {
                reject(new Error("Invalid JSON payload"));
            }
        });
        req.on("error", reject);
    });
}

function createHttpError(statusCode, message, details) {
    const error = new Error(String(message || "Request failed."));
    error.statusCode = Number(statusCode) || 500;
    if (details && typeof details === "object") {
        error.details = details;
    }
    return error;
}

function normalizeWalletPaymentMethod(value) {
    const normalized = String(value || "").trim().toUpperCase();
    if (normalized === "MAYA" || normalized === "PAYMAYA") {
        return "MAYA";
    }
    if (normalized === "GCASH") {
        return "GCASH";
    }
    return "";
}

function isDataImage(value) {
    return typeof value === "string" && /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(value);
}

function createVerificationToken(source) {
    const random = crypto.randomBytes(10).toString("hex");
    return `${source}_${Date.now()}_${random}`;
}

function estimateDistance(a, b) {
    const left = String(a || "");
    const right = String(b || "");
    if (!left || !right) {
        return 1;
    }

    const min = Math.min(left.length, right.length);
    let same = 0;
    for (let i = 0; i < min; i += 97) {
        if (left.charCodeAt(i) === right.charCodeAt(i)) {
            same += 1;
        }
    }

    const similarity = same / Math.max(1, Math.floor(min / 97));
    return Number((0.85 - similarity * 0.55).toFixed(3));
}

function htmlEscape(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function normalizeMobile(value) {
    const raw = String(value || "").trim().replace(/[^\d+]/g, "");
    if (/^09\d{9}$/.test(raw)) {
        return raw;
    }
    if (/^\+639\d{9}$/.test(raw)) {
        return `0${raw.slice(3)}`;
    }
    if (/^639\d{9}$/.test(raw)) {
        return `0${raw.slice(2)}`;
    }
    return raw.replace(/\D/g, "");
}

function isValidMobile(value) {
    const normalized = String(value || "").trim().replace(/[\s-]/g, "");
    return /^(\+639|09)\d{9}$/.test(normalized);
}

function normalizeMiddleInitial(value) {
    const cleaned = String(value || "").trim().replace(/[^a-zA-Z]/g, "");
    if (!cleaned) {
        return "";
    }
    return cleaned.slice(0, 1).toUpperCase();
}

function normalizeNamePart(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
}

function buildFullName(firstName, middleInitial, lastName) {
    const middlePart = middleInitial ? `${middleInitial}.` : "";
    return [firstName, middlePart, lastName].filter(Boolean).join(" ");
}

function isStrongPassword(password) {
    return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/.test(String(password || ""));
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const derived = crypto.scryptSync(String(password || ""), salt, 64).toString("hex");
    return `scrypt:${salt}:${derived}`;
}

function verifyPassword(plainPassword, storedHash) {
    const plain = String(plainPassword || "");
    const stored = String(storedHash || "");

    if (!stored) {
        return false;
    }

    if (!stored.startsWith("scrypt:")) {
        return plain === stored;
    }

    const parts = stored.split(":");
    if (parts.length !== 3) {
        return false;
    }

    const salt = parts[1];
    const hashHex = parts[2];

    try {
        const left = Buffer.from(hashHex, "hex");
        const right = Buffer.from(crypto.scryptSync(plain, salt, 64).toString("hex"), "hex");
        return left.length === right.length && crypto.timingSafeEqual(left, right);
    } catch (_error) {
        return false;
    }
}

function safeTokenEquals(leftValue, rightValue) {
    const left = String(leftValue || "");
    const right = String(rightValue || "");
    if (!left || !right) {
        return false;
    }
    try {
        const leftBuffer = Buffer.from(left, "utf8");
        const rightBuffer = Buffer.from(right, "utf8");
        return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
    } catch (_error) {
        return false;
    }
}

function isSemaphoreConfigured() {
    return Boolean(SEMAPHORE_API_KEY && SEMAPHORE_API_BASE);
}

function isSmsWebhookConfigured() {
    return Boolean(SMS_WEBHOOK_URL);
}

function isSmsDeliveryConfigured() {
    return isSemaphoreConfigured() || isSmsWebhookConfigured();
}

function normalizeAdminLoginId(value) {
    return String(value || "").trim().toLowerCase();
}

function isValidAdminLoginId(value) {
    const normalized = normalizeAdminLoginId(value);
    if (normalized.length < 3 || normalized.length > 190) {
        return false;
    }
    return /^[a-z0-9._@+\-]+$/.test(normalized);
}

function sanitizeAdminCredentials(rawInput) {
    const raw = rawInput && typeof rawInput === "object" ? rawInput : {};
    const loginId = normalizeAdminLoginId(raw.loginId || raw.username || raw.email);
    const passwordHash = String(raw.passwordHash || "").trim();
    if (!isValidAdminLoginId(loginId) || !passwordHash) {
        return null;
    }
    return {
        loginId: loginId,
        passwordHash: passwordHash,
        updatedAt: String(raw.updatedAt || new Date().toISOString())
    };
}

function createDefaultAdminCredentials() {
    const loginId = normalizeAdminLoginId(DEFAULT_ADMIN_LOGIN_ID);
    const password = String(DEFAULT_ADMIN_PASSWORD || "");
    if (!isValidAdminLoginId(loginId) || !password) {
        return null;
    }

    return {
        loginId: loginId,
        passwordHash: hashPassword(password),
        updatedAt: new Date().toISOString()
    };
}

function readAdminCredentialsFromDisk() {
    if (!fs.existsSync(ADMIN_CREDENTIALS_PATH)) {
        return null;
    }

    try {
        const raw = fs.readFileSync(ADMIN_CREDENTIALS_PATH, "utf8");
        const parsed = raw ? JSON.parse(raw) : {};
        return sanitizeAdminCredentials(parsed);
    } catch (_error) {
        return null;
    }
}

function writeAdminCredentialsToDisk(credentialsInput) {
    const credentials = sanitizeAdminCredentials(credentialsInput);
    if (!credentials) {
        throw new Error("Invalid admin credentials payload.");
    }

    fs.writeFileSync(
        ADMIN_CREDENTIALS_PATH,
        JSON.stringify(credentials, null, 2) + "\n",
        "utf8"
    );
}

function getAdminCredentials() {
    if (adminCredentialsCache) {
        return adminCredentialsCache;
    }

    const fromDisk = readAdminCredentialsFromDisk();
    if (fromDisk) {
        adminCredentialsCache = fromDisk;
        return adminCredentialsCache;
    }

    const fallback = createDefaultAdminCredentials();
    if (!fallback) {
        return null;
    }

    adminCredentialsCache = fallback;
    if (!fs.existsSync(ADMIN_CREDENTIALS_PATH)) {
        try {
            writeAdminCredentialsToDisk(fallback);
        } catch (error) {
            console.warn("[admin-auth] Unable to persist admin credentials:", error.message || error);
        }
    }
    return adminCredentialsCache;
}

function saveAdminCredentials(updatesInput) {
    const current = getAdminCredentials();
    if (!current) {
        throw new Error("Admin credentials are not initialized. Set ADMIN_LOGIN_ID and ADMIN_PASSWORD or create admin-credentials.json.");
    }
    const updates = updatesInput && typeof updatesInput === "object" ? updatesInput : {};
    const candidate = {
        loginId: Object.prototype.hasOwnProperty.call(updates, "loginId")
            ? normalizeAdminLoginId(updates.loginId)
            : current.loginId,
        passwordHash: Object.prototype.hasOwnProperty.call(updates, "passwordHash")
            ? String(updates.passwordHash || "").trim()
            : current.passwordHash,
        updatedAt: new Date().toISOString()
    };

    const sanitized = sanitizeAdminCredentials(candidate);
    if (!sanitized) {
        throw new Error("Invalid admin credentials.");
    }

    writeAdminCredentialsToDisk(sanitized);
    adminCredentialsCache = sanitized;
    return adminCredentialsCache;
}

function normalizeContact(method, value) {
    if (method === "email") {
        return normalizeEmail(value);
    }
    if (method === "mobile") {
        return normalizeMobile(value);
    }
    return "";
}

function generateOtpCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
}

function clearExpiredOtpSessions() {
    const now = Date.now();
    for (const [requestId, session] of otpSessions.entries()) {
        if (!session || session.expiresAt <= now) {
            otpSessions.delete(requestId);
        }
    }
}

function clearExpiredSignupOtpSessions() {
    const now = Date.now();
    for (const [requestId, session] of signupOtpSessions.entries()) {
        if (!session || session.expiresAt <= now) {
            signupOtpSessions.delete(requestId);
        }
    }
}

function isNegativeDnsError(error) {
    const code = String((error && error.code) || "").trim().toUpperCase();
    return code === "ENOTFOUND" || code === "ENODATA" || code === "NXDOMAIN";
}

function getCachedEmailDomainLookup(domain) {
    const cached = emailDomainLookupCache.get(domain);
    if (!cached) {
        return null;
    }
    if (Number(cached.expiresAt || 0) <= Date.now()) {
        emailDomainLookupCache.delete(domain);
        return null;
    }
    return cached;
}

function setCachedEmailDomainLookup(domain, exists) {
    emailDomainLookupCache.set(domain, {
        exists: Boolean(exists),
        expiresAt: Date.now() + EMAIL_DOMAIN_LOOKUP_TTL_MS
    });
}

async function validateEmailDomainExists(email) {
    const normalized = normalizeEmail(email);
    const atIndex = normalized.lastIndexOf("@");
    const domain = atIndex > 0 ? normalized.slice(atIndex + 1) : "";
    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
        return { valid: false, uncertain: false };
    }
    if (!dnsPromises) {
        return { valid: true, uncertain: true };
    }

    const cached = getCachedEmailDomainLookup(domain);
    if (cached) {
        return { valid: cached.exists, uncertain: false };
    }

    let hasMxRecord = false;
    try {
        const mx = await dnsPromises.resolveMx(domain);
        hasMxRecord = Array.isArray(mx) && mx.length > 0;
    } catch (error) {
        if (!isNegativeDnsError(error)) {
            return { valid: true, uncertain: true };
        }
    }

    if (hasMxRecord) {
        setCachedEmailDomainLookup(domain, true);
        return { valid: true, uncertain: false };
    }

    let hasIpRecord = false;
    try {
        const ipv4 = await dnsPromises.resolve4(domain);
        hasIpRecord = Array.isArray(ipv4) && ipv4.length > 0;
    } catch (error) {
        if (!isNegativeDnsError(error)) {
            return { valid: true, uncertain: true };
        }
    }

    if (!hasIpRecord) {
        try {
            const ipv6 = await dnsPromises.resolve6(domain);
            hasIpRecord = Array.isArray(ipv6) && ipv6.length > 0;
        } catch (error) {
            if (!isNegativeDnsError(error)) {
                return { valid: true, uncertain: true };
            }
        }
    }

    setCachedEmailDomainLookup(domain, hasIpRecord);
    return { valid: hasIpRecord, uncertain: false };
}

async function findSignupContactConflict(pool, email, phone) {
    const [rows] = await pool.execute(
        `SELECT email, phone
         FROM users
         WHERE email = ? OR phone = ?
         LIMIT 5`,
        [email, phone]
    );

    if (!Array.isArray(rows) || rows.length === 0) {
        return "";
    }

    for (const row of rows) {
        if (normalizeMobile(row.phone) === phone) {
            return "phone";
        }
        if (normalizeEmail(row.email) === email) {
            return "email";
        }
    }
    return "";
}

function getVerifiedSignupOtpSession(requestId, expectedMethod) {
    const token = String(requestId || "").trim();
    if (!token) {
        return null;
    }

    const session = signupOtpSessions.get(token);
    if (!session) {
        return null;
    }

    if (!session.verified || session.expiresAt <= Date.now()) {
        signupOtpSessions.delete(token);
        return null;
    }

    if (expectedMethod && session.method !== expectedMethod) {
        return null;
    }

    return session;
}

function clearExpiredAuthSessions() {
    const now = Date.now();
    for (const [token, session] of authSessions.entries()) {
        if (!session || session.expiresAt <= now) {
            authSessions.delete(token);
        }
    }
}

function normalizeUserRole(value) {
    return String(value || "").trim().toLowerCase() === "admin" ? "admin" : "user";
}

function createAuthSession(userInput) {
    const user = userInput && typeof userInput === "object" ? userInput : {};
    const now = Date.now();
    const token = crypto.randomBytes(32).toString("hex");

    const session = {
        token: token,
        userId: Number(user.id || 0),
        role: normalizeUserRole(user.role),
        email: normalizeEmail(user.email),
        name: String(user.name || "").trim(),
        createdAt: now,
        expiresAt: now + SESSION_TTL_MS
    };

    authSessions.set(token, session);
    clearExpiredAuthSessions();
    return session;
}

function getAuthTokenFromRequest(req) {
    const raw = String((req && req.headers && req.headers.authorization) || "").trim();
    if (!raw) {
        return "";
    }
    const match = raw.match(/^Bearer\s+(.+)$/i);
    if (!match) {
        return "";
    }
    return String(match[1] || "").trim();
}

function getAuthSessionFromRequest(req) {
    clearExpiredAuthSessions();
    const token = getAuthTokenFromRequest(req);
    if (!token) {
        return null;
    }
    const session = authSessions.get(token);
    if (!session) {
        return null;
    }
    if (session.expiresAt <= Date.now()) {
        authSessions.delete(token);
        return null;
    }
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    authSessions.set(token, session);
    return session;
}

function requireAuthSession(req, res, options) {
    const opts = options && typeof options === "object" ? options : {};
    const session = getAuthSessionFromRequest(req);
    if (!session) {
        sendJson(res, 401, {
            success: false,
            message: "Authentication required. Please sign in again."
        });
        return null;
    }

    if (opts.role && normalizeUserRole(opts.role) !== session.role) {
        sendJson(res, 403, {
            success: false,
            message: "You do not have permission to access this resource."
        });
        return null;
    }

    return session;
}

function getAuthResponse(session) {
    if (!session) {
        return {
            token: "",
            expiresInMs: SESSION_TTL_MS,
            expiresAt: null
        };
    }

    return {
        token: String(session.token || ""),
        expiresInMs: SESSION_TTL_MS,
        expiresAt: new Date(session.expiresAt).toISOString()
    };
}

function canAccessEmail(session, targetEmail) {
    if (!session) {
        return false;
    }

    if (session.role === "admin") {
        return true;
    }

    return normalizeEmail(targetEmail) === normalizeEmail(session.email);
}

function isDbConfigured() {
    return Boolean(mysql && DB_HOST && Number.isFinite(DB_PORT) && DB_PORT > 0 && DB_USER && DB_NAME);
}

async function getDbPool() {
    if (!mysql) {
        throw new Error("Missing mysql2 package. Run: npm install mysql2");
    }
    if (!isDbConfigured()) {
        throw new Error("MySQL is not configured. Set DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME.");
    }
    if (dbPool) {
        return dbPool;
    }

    dbPool = mysql.createPool({
        host: DB_HOST,
        port: DB_PORT,
        user: DB_USER,
        password: DB_PASSWORD,
        database: DB_NAME,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });
    return dbPool;
}

async function ensureDbSchema() {
    if (!isDbConfigured()) {
        return;
    }

    try {
        const pool = await getDbPool();
        try {
            await pool.execute(
                "ALTER TABLE users ADD COLUMN avatar_data_url MEDIUMTEXT NULL AFTER address"
            );
        } catch (alterError) {
            console.warn("[db-schema] Unable to add users.avatar_data_url automatically:", alterError.message || alterError);
        }

        await pool.execute(
            `CREATE TABLE IF NOT EXISTS bookings (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                order_id VARCHAR(64) NOT NULL,
                user_id BIGINT UNSIGNED NULL,
                full_name VARCHAR(200) NOT NULL,
                email VARCHAR(190) NOT NULL,
                phone VARCHAR(20) NOT NULL,
                model VARCHAR(180) NOT NULL,
                bike_color VARCHAR(64) NULL,
                bike_image VARCHAR(255) NULL,
                subtotal DECIMAL(12,2) NOT NULL DEFAULT 0.00,
                shipping_fee DECIMAL(12,2) NOT NULL DEFAULT 0.00,
                total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
                payment_method VARCHAR(80) NOT NULL,
                payment_status VARCHAR(64) NOT NULL DEFAULT 'awaiting_payment_confirmation',
                service_type VARCHAR(40) NOT NULL,
                schedule_date DATE NULL,
                schedule_time TIME NULL,
                status VARCHAR(80) NOT NULL DEFAULT 'Pending review',
                fulfillment_status VARCHAR(80) NOT NULL DEFAULT 'In Process',
                tracking_eta VARCHAR(80) NULL,
                tracking_location VARCHAR(120) NULL,
                receipt_number VARCHAR(40) NULL,
                receipt_issued_at TIMESTAMP NULL DEFAULT NULL,
                shipping_address VARCHAR(255) NULL,
                shipping_lat DECIMAL(10,6) NULL,
                shipping_lng DECIMAL(10,6) NULL,
                shipping_map_embed_url TEXT NULL,
                user_email VARCHAR(190) NULL,
                installment_payload LONGTEXT NULL,
                review_decision ENUM('approved', 'rejected', 'none') NOT NULL DEFAULT 'none',
                reviewed_at TIMESTAMP NULL DEFAULT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY uq_bookings_order_id (order_id),
                KEY idx_bookings_email (email),
                KEY idx_bookings_user_email (user_email),
                KEY idx_bookings_payment_status (payment_status),
                KEY idx_bookings_review_decision (review_decision),
                KEY idx_bookings_created_at (created_at),
                CONSTRAINT fk_bookings_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        );

        try {
            await pool.execute(
                "ALTER TABLE bookings ADD COLUMN schedule_date DATE NULL AFTER service_type"
            );
        } catch (alterError) {
            console.warn("[db-schema] Unable to add bookings.schedule_date automatically:", alterError.message || alterError);
        }

        try {
            await pool.execute(
                "ALTER TABLE bookings ADD COLUMN bike_color VARCHAR(64) NULL AFTER model"
            );
        } catch (alterError) {
            console.warn("[db-schema] Unable to add bookings.bike_color automatically:", alterError.message || alterError);
        }

        try {
            await pool.execute(
                "ALTER TABLE bookings ADD COLUMN payment_status VARCHAR(64) NOT NULL DEFAULT 'awaiting_payment_confirmation' AFTER payment_method"
            );
        } catch (alterError) {
            console.warn("[db-schema] Unable to add bookings.payment_status automatically:", alterError.message || alterError);
        }

        try {
            await pool.execute(
                "ALTER TABLE bookings ADD COLUMN schedule_time TIME NULL AFTER schedule_date"
            );
        } catch (alterError) {
            console.warn("[db-schema] Unable to add bookings.schedule_time automatically:", alterError.message || alterError);
        }

        try {
            await pool.execute(
                "ALTER TABLE bookings ADD COLUMN tracking_eta VARCHAR(80) NULL AFTER fulfillment_status"
            );
        } catch (alterError) {
            console.warn("[db-schema] Unable to add bookings.tracking_eta automatically:", alterError.message || alterError);
        }

        try {
            await pool.execute(
                "ALTER TABLE bookings ADD COLUMN tracking_location VARCHAR(120) NULL AFTER tracking_eta"
            );
        } catch (alterError) {
            console.warn("[db-schema] Unable to add bookings.tracking_location automatically:", alterError.message || alterError);
        }

        try {
            await pool.execute(
                "ALTER TABLE bookings ADD COLUMN receipt_number VARCHAR(40) NULL AFTER tracking_location"
            );
        } catch (alterError) {
            console.warn("[db-schema] Unable to add bookings.receipt_number automatically:", alterError.message || alterError);
        }

        try {
            await pool.execute(
                "ALTER TABLE bookings ADD COLUMN receipt_issued_at TIMESTAMP NULL DEFAULT NULL AFTER receipt_number"
            );
        } catch (alterError) {
            console.warn("[db-schema] Unable to add bookings.receipt_issued_at automatically:", alterError.message || alterError);
        }

        await pool.execute(
            `CREATE TABLE IF NOT EXISTS products (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                model VARCHAR(180) NOT NULL,
                price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
                category ENUM('2-Wheel', '3-Wheel', '4-Wheel', 'Other') NOT NULL DEFAULT 'Other',
                product_info VARCHAR(255) NULL,
                image_url MEDIUMTEXT NULL,
                detail_url VARCHAR(255) NULL,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY uq_products_model_category (model, category),
                KEY idx_products_active_category (is_active, category),
                KEY idx_products_created_at (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        );

        try {
            await pool.execute(
                "ALTER TABLE products ADD COLUMN product_info VARCHAR(255) NULL AFTER category"
            );
        } catch (alterError) {
            console.warn("[db-schema] Unable to add products.product_info automatically:", alterError.message || alterError);
        }

        try {
            await pool.execute(
                "ALTER TABLE products MODIFY COLUMN image_url MEDIUMTEXT NULL"
            );
        } catch (alterError) {
            console.warn("[db-schema] Unable to widen products.image_url automatically:", alterError.message || alterError);
        }

        if (Array.isArray(DEFAULT_PRODUCT_CATALOG) && DEFAULT_PRODUCT_CATALOG.length > 0) {
            const placeholders = [];
            const values = [];
            DEFAULT_PRODUCT_CATALOG.forEach((item) => {
                placeholders.push("(?, ?, ?, ?, ?, ?, 1)");
                values.push(
                    String(item.model || "").slice(0, 180),
                    Number(item.price || 0),
                    String(item.category || "Other"),
                    item.info ? normalizeText(item.info).slice(0, 255) : null,
                    item.imageUrl ? String(item.imageUrl).slice(0, 255) : null,
                    item.detailUrl ? String(item.detailUrl).slice(0, 255) : null
                );
            });

            await pool.execute(
                `INSERT IGNORE INTO products (
                    model,
                    price,
                    category,
                    product_info,
                    image_url,
                    detail_url,
                    is_active
                ) VALUES ${placeholders.join(", ")}`,
                values
            );
        }

        await pool.execute(
            `CREATE TABLE IF NOT EXISTS chat_threads (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                user_id BIGINT UNSIGNED NULL,
                user_email VARCHAR(190) NOT NULL,
                mode ENUM('bot', 'admin') NOT NULL DEFAULT 'bot',
                takeover_by_admin_id BIGINT UNSIGNED NULL,
                takeover_by_admin_email VARCHAR(190) NULL,
                takeover_started_at TIMESTAMP NULL DEFAULT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY uq_chat_threads_user_email (user_email),
                KEY idx_chat_threads_mode (mode),
                KEY idx_chat_threads_user_id (user_id),
                KEY idx_chat_threads_updated_at (updated_at),
                CONSTRAINT fk_chat_threads_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        );

        try {
            await pool.execute(
                "ALTER TABLE chat_threads ADD COLUMN mode ENUM('bot', 'admin') NOT NULL DEFAULT 'bot' AFTER user_email"
            );
        } catch (alterError) {
            console.warn("[db-schema] Unable to add chat_threads.mode automatically:", alterError.message || alterError);
        }

        try {
            await pool.execute(
                "ALTER TABLE chat_threads ADD COLUMN takeover_by_admin_id BIGINT UNSIGNED NULL AFTER mode"
            );
        } catch (alterError) {
            console.warn("[db-schema] Unable to add chat_threads.takeover_by_admin_id automatically:", alterError.message || alterError);
        }

        try {
            await pool.execute(
                "ALTER TABLE chat_threads ADD COLUMN takeover_by_admin_email VARCHAR(190) NULL AFTER takeover_by_admin_id"
            );
        } catch (alterError) {
            console.warn("[db-schema] Unable to add chat_threads.takeover_by_admin_email automatically:", alterError.message || alterError);
        }

        try {
            await pool.execute(
                "ALTER TABLE chat_threads ADD COLUMN takeover_started_at TIMESTAMP NULL DEFAULT NULL AFTER takeover_by_admin_email"
            );
        } catch (alterError) {
            console.warn("[db-schema] Unable to add chat_threads.takeover_started_at automatically:", alterError.message || alterError);
        }

        await pool.execute(
            `CREATE TABLE IF NOT EXISTS chat_messages (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                thread_id BIGINT UNSIGNED NOT NULL,
                sender_role ENUM('user', 'bot', 'admin', 'system') NOT NULL,
                sender_label VARCHAR(80) NULL,
                message_text TEXT NOT NULL,
                client_message_id VARCHAR(120) NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_chat_messages_thread_created (thread_id, created_at, id),
                UNIQUE KEY uq_chat_messages_thread_client_id (thread_id, client_message_id),
                CONSTRAINT fk_chat_messages_thread_id FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        );

        try {
            await pool.execute(
                "ALTER TABLE chat_messages ADD COLUMN client_message_id VARCHAR(120) NULL AFTER message_text"
            );
        } catch (alterError) {
            console.warn("[db-schema] Unable to add chat_messages.client_message_id automatically:", alterError.message || alterError);
        }
    } catch (error) {
        console.warn("[db-schema] Unable to auto-prepare schema:", error.message || error);
    }
}

function isSmtpConfigured() {
    return Boolean(
        nodemailer &&
        SMTP_HOST &&
        Number.isFinite(SMTP_PORT) &&
        SMTP_PORT > 0 &&
        SMTP_USER &&
        SMTP_PASS &&
        SMTP_FROM
    );
}

function getSmtpTransport() {
    if (!isSmtpConfigured()) {
        return null;
    }
    if (smtpTransport) {
        return smtpTransport;
    }

    smtpTransport = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_SECURE,
        auth: {
            user: SMTP_USER,
            pass: SMTP_PASS
        }
    });
    return smtpTransport;
}

async function sendOtpEmail(email, code, options) {
    const opts = options && typeof options === "object" ? options : {};
    const subject = String(opts.subject || "Ecodrive verification code").trim() || "Ecodrive verification code";
    const transport = getSmtpTransport();
    if (!transport) {
        return { sent: false, reason: "SMTP is not configured." };
    }

    try {
        await transport.sendMail({
            from: SMTP_FROM,
            to: email,
            subject: subject,
            text: `Your Ecodrive verification code is ${code}. It expires in 5 minutes.`,
            html: `<p>Your Ecodrive verification code is <strong>${htmlEscape(code)}</strong>.</p><p>This code expires in 5 minutes.</p>`
        });
        return { sent: true, provider: "smtp" };
    } catch (error) {
        return { sent: false, reason: error.message || "SMTP send failed." };
    }
}

function buildBookingScheduleLabelForEmail(record) {
    const booking = record && typeof record === "object" ? record : {};
    const scheduleDate = formatBookingDateValue(
        booking.scheduleDate
        || booking.schedule_date
        || booking.bookingDate
        || booking.date
    );
    const scheduleTime = formatBookingTimeValue(
        booking.scheduleTime
        || booking.schedule_time
        || booking.bookingTime
        || booking.time
    );

    if (!scheduleDate && !scheduleTime) {
        return "Not specified";
    }

    const localDate = buildLocalDateTimeFromParts(scheduleDate, scheduleTime);
    if (localDate) {
        return localDate.toLocaleString("en-PH", {
            month: "long",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true
        });
    }

    if (scheduleDate && scheduleTime) {
        return `${scheduleDate} ${scheduleTime.slice(0, 5)}`;
    }
    return scheduleDate || scheduleTime;
}

async function sendBookingRejectedEmail(record, options) {
    const booking = record && typeof record === "object" ? record : {};
    const opts = options && typeof options === "object" ? options : {};
    const recipientEmail = normalizeEmail(booking.email || booking.userEmail);
    if (!isValidEmail(recipientEmail)) {
        return { sent: false, reason: "Booking has no valid email recipient." };
    }

    const transport = getSmtpTransport();
    if (!transport) {
        return { sent: false, reason: "SMTP is not configured." };
    }

    const fullName = normalizeText(booking.fullName || booking.name || "") || "Customer";
    const orderId = String(booking.orderId || booking.order_id || "").trim() || "N/A";
    const model = normalizeText(booking.model || booking.productName || booking.itemName || "") || "Ecodrive E-Bike";
    const service = normalizeText(booking.service || booking.service_type || "") || "Delivery";
    const scheduleLabel = buildBookingScheduleLabelForEmail(booking);
    const reasonText = normalizeText(opts.reason || "");
    const reasonSection = reasonText ? `Reason: ${reasonText}` : "";
    const subject = `Ecodrive booking update (${orderId})`;

    const textLines = [
        `Hi ${fullName},`,
        "",
        "Your booking request has been rejected by Ecodrive admin.",
        `Order ID: ${orderId}`,
        `Model: ${model}`,
        `Service: ${service}`,
        `Schedule: ${scheduleLabel}`
    ];
    if (reasonSection) {
        textLines.push(reasonSection);
    }
    textLines.push(
        "",
        "This booking was removed from your active bookings. You may submit a new booking request anytime.",
        "",
        "Ecodrive Team"
    );

    const reasonHtml = reasonText
        ? `<p><strong>Reason:</strong> ${htmlEscape(reasonText)}</p>`
        : "";

    try {
        await transport.sendMail({
            from: SMTP_FROM,
            to: recipientEmail,
            subject: subject,
            text: textLines.join("\n"),
            html: [
                `<p>Hi ${htmlEscape(fullName)},</p>`,
                "<p>Your booking request has been <strong>rejected</strong> by Ecodrive admin.</p>",
                "<ul>",
                `<li><strong>Order ID:</strong> ${htmlEscape(orderId)}</li>`,
                `<li><strong>Model:</strong> ${htmlEscape(model)}</li>`,
                `<li><strong>Service:</strong> ${htmlEscape(service)}</li>`,
                `<li><strong>Schedule:</strong> ${htmlEscape(scheduleLabel)}</li>`,
                "</ul>",
                reasonHtml,
                "<p>This booking was removed from your active bookings. You may submit a new booking request anytime.</p>",
                "<p>Ecodrive Team</p>"
            ].join("")
        });
        return { sent: true, provider: "smtp" };
    } catch (error) {
        return { sent: false, reason: error.message || "SMTP send failed." };
    }
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

function parseSemaphoreApiMessage(payloadInput) {
    if (Array.isArray(payloadInput) && payloadInput.length > 0) {
        const first = payloadInput[0];
        if (first && typeof first === "object") {
            return first;
        }
    }
    if (payloadInput && typeof payloadInput === "object") {
        return payloadInput;
    }
    return null;
}

function normalizeSemaphoreErrorMessage(payloadInput, fallbackMessage) {
    const fallback = String(fallbackMessage || "Semaphore request failed.");
    const payload = payloadInput && typeof payloadInput === "object" ? payloadInput : {};
    const candidates = [
        payload.error,
        payload.message,
        payload.details,
        payload.status
    ];
    for (let i = 0; i < candidates.length; i += 1) {
        const text = String(candidates[i] || "").trim();
        if (text) {
            return text;
        }
    }
    return fallback;
}

function isSemaphoreDeliveryStatusSuccessful(statusInput) {
    const status = String(statusInput || "").trim().toLowerCase();
    if (!status) {
        return true;
    }
    return status === "queued" || status === "pending" || status === "sent" || status === "success";
}

async function sendSmsViaSemaphore(numberInput, messageInput, options) {
    const opts = options && typeof options === "object" ? options : {};
    const number = normalizeMobile(numberInput);
    const message = String(messageInput || "").trim();
    if (!isSemaphoreConfigured()) {
        return { sent: false, reason: "Semaphore relay is not configured." };
    }
    if (!isValidMobile(number)) {
        return { sent: false, reason: "Invalid mobile number." };
    }
    if (!message) {
        return { sent: false, reason: "SMS message is required." };
    }
    if (typeof fetch !== "function") {
        return { sent: false, reason: "Global fetch is unavailable in this Node version." };
    }

    const params = new URLSearchParams();
    params.set("apikey", SEMAPHORE_API_KEY);
    params.set("number", number);
    params.set("message", message);
    if (SEMAPHORE_SENDERNAME) {
        params.set("sendername", SEMAPHORE_SENDERNAME);
    }

    const endpoint = `${SEMAPHORE_API_BASE}/messages`;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeoutMs = Number(opts.timeoutMs || SEMAPHORE_REQUEST_TIMEOUT_MS);
    const timeoutId = controller
        ? setTimeout(() => {
            controller.abort();
        }, timeoutMs)
        : null;

    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: params.toString(),
            signal: controller ? controller.signal : undefined
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            return {
                sent: false,
                reason: normalizeSemaphoreErrorMessage(
                    payload,
                    `Semaphore API returned ${response.status}.`
                ),
                statusCode: response.status
            };
        }

        const apiMessage = parseSemaphoreApiMessage(payload);
        const statusText = String((apiMessage && apiMessage.status) || "").trim();
        const messageId = String((apiMessage && (apiMessage.message_id || apiMessage.messageId)) || "").trim();
        if (!isSemaphoreDeliveryStatusSuccessful(statusText)) {
            return {
                sent: false,
                reason: `Semaphore delivery status is ${statusText || "unknown"}.`,
                status: statusText || "unknown",
                messageId: messageId
            };
        }
        return {
            sent: true,
            provider: "semaphore",
            status: statusText || "queued",
            messageId: messageId
        };
    } catch (error) {
        if (error && error.name === "AbortError") {
            return { sent: false, reason: "Semaphore request timed out." };
        }
        return { sent: false, reason: error.message || "Semaphore request failed." };
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
}

async function handleSmsSemaphoreRelay(req, res) {
    try {
        if (!isSemaphoreConfigured()) {
            sendJson(res, 503, {
                success: false,
                message: "Semaphore relay is not configured. Set SEMAPHORE_API_KEY first."
            });
            return;
        }
        if (!SEMAPHORE_RELAY_TOKEN) {
            sendJson(res, 503, {
                success: false,
                message: "SEMAPHORE_RELAY_TOKEN (or SMS_WEBHOOK_TOKEN) is required for the semaphore relay endpoint."
            });
            return;
        }

        const providedToken = getAuthTokenFromRequest(req);
        if (!safeTokenEquals(providedToken, SEMAPHORE_RELAY_TOKEN)) {
            sendJson(res, 401, { success: false, message: "Unauthorized SMS relay request." });
            return;
        }

        const body = await readBody(req);
        const mobile = normalizeMobile(body.to || body.number || body.mobile);
        const code = String(body.code || "").trim();
        const message = String(body.message || "").trim()
            || (code ? `Your Ecodrive verification code is ${code}. It expires in 5 minutes.` : "");

        if (!isValidMobile(mobile)) {
            sendJson(res, 400, { success: false, message: "A valid PH mobile number is required." });
            return;
        }
        if (!message) {
            sendJson(res, 400, { success: false, message: "SMS message is required." });
            return;
        }

        const result = await sendSmsViaSemaphore(mobile, message, {
            timeoutMs: SEMAPHORE_REQUEST_TIMEOUT_MS
        });
        if (!result.sent) {
            sendJson(res, 502, {
                success: false,
                message: result.reason || "Semaphore delivery failed."
            });
            return;
        }

        sendJson(res, 200, {
            success: true,
            provider: "semaphore",
            status: result.status || "queued",
            messageId: result.messageId || ""
        });
    } catch (error) {
        sendJson(res, 500, { success: false, message: error.message || "Unable to process semaphore relay request." });
    }
}

async function sendOtpSms(mobile, code) {
    const normalizedMobile = normalizeMobile(mobile);
    const message = `Your Ecodrive verification code is ${code}. It expires in 5 minutes.`;
    if (!isValidMobile(normalizedMobile)) {
        return { sent: false, reason: "Invalid mobile number." };
    }

    // Preferred path: send directly to Semaphore from this backend.
    if (isSemaphoreConfigured()) {
        const semaphoreResult = await sendSmsViaSemaphore(normalizedMobile, message, {
            timeoutMs: SEMAPHORE_REQUEST_TIMEOUT_MS
        });
        if (semaphoreResult.sent) {
            return semaphoreResult;
        }
        if (!isSmsWebhookConfigured()) {
            return semaphoreResult;
        }
    }

    // Backward compatibility: allow custom external SMS webhook fallback.
    if (!isSmsWebhookConfigured()) {
        return {
            sent: false,
            reason: "SMS provider is not configured. Set SEMAPHORE_API_KEY (recommended) or SMS_WEBHOOK_URL."
        };
    }
    if (typeof fetch !== "function") {
        return { sent: false, reason: "Global fetch is unavailable in this Node version." };
    }

    const headers = { "Content-Type": "application/json" };
    if (SEMAPHORE_RELAY_TOKEN) {
        headers.Authorization = `Bearer ${SEMAPHORE_RELAY_TOKEN}`;
    }

    try {
        const response = await fetch(SMS_WEBHOOK_URL, {
            method: "POST",
            headers: headers,
            body: JSON.stringify({
                to: normalizedMobile,
                code: code,
                message: message
            })
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            return {
                sent: false,
                reason: normalizeSemaphoreErrorMessage(payload, `SMS webhook returned ${response.status}.`),
                statusCode: response.status
            };
        }

        const provider = String(payload.provider || "sms-webhook").trim() || "sms-webhook";
        const status = String(payload.status || "queued").trim() || "queued";
        const messageId = String(payload.messageId || payload.message_id || "").trim();
        return { sent: true, provider: provider, status: status, messageId: messageId };
    } catch (error) {
        return { sent: false, reason: error.message || "SMS delivery failed." };
    }
}

async function deliverOtp(method, contact, code, options) {
    if (method === "email") {
        return sendOtpEmail(contact, code, options);
    }
    if (method === "mobile") {
        return sendOtpSms(contact, code);
    }
    return { sent: false, reason: "Unsupported delivery method." };
}

function getDuplicateField(errorMessage) {
    const msg = String(errorMessage || "").toLowerCase();
    if (msg.includes("email")) {
        return "email";
    }
    if (msg.includes("phone")) {
        return "phone";
    }
    return "";
}

function normalizeText(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeChatMode(value) {
    const mode = String(value || "").trim().toLowerCase();
    return mode === CHAT_THREAD_MODE_ADMIN ? CHAT_THREAD_MODE_ADMIN : CHAT_THREAD_MODE_BOT;
}

function normalizeChatMessageRole(value, fallbackRole) {
    const fallback = String(fallbackRole || "user").trim().toLowerCase();
    const role = String(value || fallback).trim().toLowerCase();
    if (CHAT_ALLOWED_MESSAGE_ROLES.has(role)) {
        return role;
    }
    if (CHAT_ALLOWED_MESSAGE_ROLES.has(fallback)) {
        return fallback;
    }
    return "user";
}

function normalizeChatMessageText(value) {
    const text = normalizeText(value);
    if (!text) {
        return "";
    }
    return text.slice(0, MAX_CHAT_MESSAGE_TEXT_LENGTH);
}

function normalizeChatClientMessageId(value) {
    const cleaned = String(value || "").trim().replace(/[^a-zA-Z0-9._\-:]/g, "");
    if (!cleaned) {
        return "";
    }
    return cleaned.slice(0, 120);
}

function parseChatMessageLimit(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return DEFAULT_CHAT_MESSAGE_LIMIT;
    }
    return Math.min(MAX_CHAT_MESSAGE_LIMIT, Math.floor(parsed));
}

function parsePositiveId(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return 0;
    }
    return Math.floor(parsed);
}

function normalizeOrderId(value, allowFallback) {
    const cleaned = normalizeText(value).replace(/[^\w\-]/g, "");
    if (cleaned) {
        return cleaned.slice(0, 64);
    }
    if (allowFallback !== false) {
        return generateOrderId();
    }
    return "";
}

function generateOrderId() {
    return `EC-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

function buildReceiptNumber(orderId, issuedAtInput) {
    const issuedAt = issuedAtInput instanceof Date && !Number.isNaN(issuedAtInput.getTime())
        ? issuedAtInput
        : new Date();
    const year = issuedAt.getFullYear();
    const month = String(issuedAt.getMonth() + 1).padStart(2, "0");
    const day = String(issuedAt.getDate()).padStart(2, "0");
    const datePart = `${year}${month}${day}`;
    const normalizedOrderId = normalizeOrderId(orderId, false).replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const suffix = normalizedOrderId.slice(-8) || crypto.randomBytes(4).toString("hex").toUpperCase();
    return `ECR-${datePart}-${suffix}`.slice(0, 40);
}

function normalizeServiceType(value) {
    const raw = normalizeText(value).toLowerCase();
    if (raw === "pick up" || raw === "pickup") {
        return "Pick Up";
    }
    if (raw === "installment") {
        return "Installment";
    }
    return "Delivery";
}

function normalizeOrderStatus(value, serviceType) {
    const status = normalizeText(value);
    if (status) {
        return status.slice(0, 80);
    }
    if (serviceType === "Installment") {
        return "Application Review";
    }
    return "Pending review";
}

function normalizeFulfillmentStatus(value, serviceType) {
    const status = normalizeText(value);
    if (status) {
        return status.slice(0, 80);
    }
    if (serviceType === "Pick Up") {
        return "Ready to Pick up";
    }
    if (serviceType === "Installment") {
        return "Under Review";
    }
    return "In Process";
}

function getDefaultPaymentStatus(paymentMethod, serviceType) {
    const method = normalizeText(paymentMethod).toLowerCase();
    const service = normalizeServiceType(serviceType);

    if (method.includes("repair")) {
        return "not_applicable";
    }
    if (method.includes("cash on delivery")) {
        return "pending_cod";
    }
    if (method.includes("installment") || service === "Installment") {
        return "installment_review";
    }
    return "awaiting_payment_confirmation";
}

function normalizePaymentStatus(value, fallbackValue) {
    const fallback = String(fallbackValue || "awaiting_payment_confirmation").trim().toLowerCase();
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized && ALLOWED_PAYMENT_STATUSES.has(normalized)) {
        return normalized;
    }
    return ALLOWED_PAYMENT_STATUSES.has(fallback) ? fallback : "awaiting_payment_confirmation";
}

function parseAmount(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) {
        return 0;
    }
    return Number(amount.toFixed(2));
}

function normalizeProductModel(value) {
    return normalizeText(value).slice(0, 180);
}

function normalizeProductCategory(value) {
    const raw = normalizeText(value).toLowerCase();
    if (!raw) {
        return "Other";
    }
    if (raw.includes("2")) {
        return "2-Wheel";
    }
    if (raw.includes("3")) {
        return "3-Wheel";
    }
    if (raw.includes("4")) {
        return "4-Wheel";
    }
    return "Other";
}

function normalizeProductPrice(value) {
    if (typeof value === "number") {
        if (!Number.isFinite(value) || value < 0) {
            return null;
        }
        return Number(value.toFixed(2));
    }

    const numeric = Number(String(value || "").replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(numeric) || numeric < 0) {
        return null;
    }
    return Number(numeric.toFixed(2));
}

function normalizeProductUrl(value) {
    const cleaned = String(value || "").trim();
    if (!cleaned) {
        return "";
    }
    return cleaned.slice(0, 255);
}

function normalizeProductImage(value) {
    const cleaned = String(value || "").trim();
    if (!cleaned) {
        return "";
    }
    if (isDataImage(cleaned)) {
        return cleaned;
    }
    return cleaned.slice(0, 255);
}

function normalizeProductInfo(value) {
    return normalizeText(value).slice(0, 255);
}

function normalizeOptionalBoolean(value, fallback) {
    if (value === undefined || value === null || value === "") {
        return Boolean(fallback);
    }
    if (typeof value === "boolean") {
        return value;
    }
    const normalized = String(value).trim().toLowerCase();
    if (normalized === "0" || normalized === "false" || normalized === "no") {
        return false;
    }
    if (normalized === "1" || normalized === "true" || normalized === "yes") {
        return true;
    }
    return Boolean(fallback);
}

function normalizeOptionalNumber(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
        return null;
    }
    return Number(num.toFixed(6));
}

function normalizeScheduleDate(value) {
    const cleaned = String(value || "").trim();
    if (!cleaned) {
        return null;
    }

    const match = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
        return null;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const stamp = Date.UTC(year, month - 1, day);
    const parsed = new Date(stamp);

    if (
        !Number.isFinite(stamp)
        || parsed.getUTCFullYear() !== year
        || parsed.getUTCMonth() + 1 !== month
        || parsed.getUTCDate() !== day
    ) {
        return null;
    }

    return `${match[1]}-${match[2]}-${match[3]}`;
}

function normalizeScheduleTime(value) {
    const cleaned = String(value || "").trim();
    if (!cleaned) {
        return null;
    }

    const match = cleaned.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) {
        return null;
    }

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3] || 0);
    if (
        !Number.isInteger(hours)
        || !Number.isInteger(minutes)
        || !Number.isInteger(seconds)
        || hours < 0
        || hours > 23
        || minutes < 0
        || minutes > 59
        || seconds < 0
        || seconds > 59
    ) {
        return null;
    }

    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatBookingDateValue(value) {
    if (!value) {
        return "";
    }
    if (value instanceof Date) {
        const year = value.getFullYear();
        const month = String(value.getMonth() + 1).padStart(2, "0");
        const day = String(value.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    const raw = String(value).trim();
    if (!raw) {
        return "";
    }
    const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) {
        return match[1];
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
        return "";
    }
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const day = String(parsed.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function formatBookingTimeValue(value) {
    if (!value) {
        return "";
    }
    if (value instanceof Date) {
        const hours = String(value.getHours()).padStart(2, "0");
        const minutes = String(value.getMinutes()).padStart(2, "0");
        const seconds = String(value.getSeconds()).padStart(2, "0");
        return `${hours}:${minutes}:${seconds}`;
    }

    const raw = String(value).trim();
    if (!raw) {
        return "";
    }
    const match = raw.match(/^(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!match) {
        return "";
    }
    return `${match[1]}:${match[2]}:${match[3] || "00"}`;
}

function getReviewDecisionFromStatus(status, fulfillmentStatus) {
    const merged = `${String(status || "")} ${String(fulfillmentStatus || "")}`.toLowerCase();
    if (merged.includes("reject")) {
        return "rejected";
    }
    if (merged.includes("approve")) {
        return "approved";
    }
    return "none";
}

async function countActiveBookingsByScheduleDate(pool, scheduleDate, excludeOrderId) {
    const normalizedDate = normalizeScheduleDate(scheduleDate);
    if (!normalizedDate) {
        return 0;
    }

    const normalizedExcludeOrderId = normalizeOrderId(excludeOrderId, false);
    const params = [normalizedDate];
    const excludeClause = normalizedExcludeOrderId
        ? "AND order_id <> ?"
        : "";
    if (normalizedExcludeOrderId) {
        params.push(normalizedExcludeOrderId);
    }

    const [rows] = await pool.execute(
        `SELECT COUNT(*) AS total
         FROM bookings
         WHERE schedule_date = ?
           AND review_decision <> 'rejected'
           AND LOWER(status) NOT LIKE '%cancel%'
           AND LOWER(fulfillment_status) NOT LIKE '%cancel%'
           ${excludeClause}`,
        params
    );
    const row = Array.isArray(rows) && rows.length ? rows[0] : null;
    return Number((row && row.total) || 0);
}

function hasReachedDailyBookingLimit(count) {
    return Number(count || 0) >= MAX_BOOKINGS_PER_DAY;
}

function mapProductRow(row) {
    return {
        id: Number(row.id || 0),
        model: String(row.model || "Ecodrive E-Bike"),
        price: Number(row.price || 0),
        category: String(row.category || "Other"),
        info: String(row.product_info || ""),
        imageUrl: String(row.image_url || ""),
        detailUrl: String(row.detail_url || ""),
        isActive: Number(row.is_active || 0) > 0,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null
    };
}

function mapBookingRow(row) {
    let installment = null;
    if (row && row.installment_payload) {
        try {
            installment = JSON.parse(row.installment_payload);
        } catch (_error) {
            installment = null;
        }
    }

    return {
        id: Number(row.id || 0),
        orderId: String(row.order_id || ""),
        fullName: String(row.full_name || ""),
        email: String(row.email || ""),
        phone: String(row.phone || ""),
        model: String(row.model || "Ecodrive E-Bike"),
        bikeColor: String(row.bike_color || ""),
        color: String(row.bike_color || ""),
        bikeImage: String(row.bike_image || ""),
        subtotal: Number(row.subtotal || 0),
        shippingFee: Number(row.shipping_fee || 0),
        total: Number(row.total || 0),
        payment: String(row.payment_method || ""),
        paymentStatus: normalizePaymentStatus(
            row.payment_status,
            getDefaultPaymentStatus(row.payment_method, row.service_type)
        ),
        service: String(row.service_type || ""),
        status: String(row.status || ""),
        fulfillmentStatus: String(row.fulfillment_status || ""),
        trackingEta: String(row.tracking_eta || ""),
        trackingLocation: String(row.tracking_location || ""),
        receiptNumber: String(row.receipt_number || ""),
        receiptIssuedAt: row.receipt_issued_at || null,
        scheduleDate: formatBookingDateValue(row.schedule_date),
        scheduleTime: formatBookingTimeValue(row.schedule_time),
        shippingAddress: String(row.shipping_address || ""),
        shippingCoordinates: (
            row.shipping_lat !== null &&
            row.shipping_lat !== undefined &&
            row.shipping_lng !== null &&
            row.shipping_lng !== undefined
        )
            ? {
                lat: Number(row.shipping_lat),
                lng: Number(row.shipping_lng)
            }
            : null,
        shippingMapEmbedUrl: String(row.shipping_map_embed_url || ""),
        userEmail: String(row.user_email || ""),
        reviewedAt: row.reviewed_at || null,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
        installment: installment
    };
}

function mapChatThreadRow(row) {
    return {
        id: Number(row.id || 0),
        userId: Number(row.user_id || 0),
        userEmail: String(row.user_email || ""),
        mode: normalizeChatMode(row.mode),
        takeoverByAdminId: Number(row.takeover_by_admin_id || 0),
        takeoverByAdminEmail: String(row.takeover_by_admin_email || ""),
        takeoverStartedAt: row.takeover_started_at || null,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null
    };
}

function mapChatMessageRow(row) {
    return {
        id: Number(row.id || 0),
        threadId: Number(row.thread_id || 0),
        role: normalizeChatMessageRole(row.sender_role, "user"),
        senderLabel: String(row.sender_label || ""),
        text: String(row.message_text || ""),
        clientMessageId: String(row.client_message_id || ""),
        createdAt: row.created_at || null
    };
}

async function findChatUserById(pool, userId) {
    const parsedId = parsePositiveId(userId);
    if (!parsedId) {
        return null;
    }

    const [rows] = await pool.execute(
        `SELECT id, full_name, email
         FROM users
         WHERE id = ? AND role = 'user'
         LIMIT 1`,
        [parsedId]
    );

    return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function findChatUserByEmail(pool, email) {
    const normalizedEmail = normalizeEmail(email);
    if (!isValidEmail(normalizedEmail)) {
        return null;
    }

    const [rows] = await pool.execute(
        `SELECT id, full_name, email
         FROM users
         WHERE email = ? AND role = 'user'
         LIMIT 1`,
        [normalizedEmail]
    );

    return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function getOrCreateChatThreadForUser(pool, userRow) {
    const user = userRow && typeof userRow === "object" ? userRow : {};
    const userId = parsePositiveId(user.id);
    const userEmail = normalizeEmail(user.email);
    if (!userId || !isValidEmail(userEmail)) {
        return null;
    }

    const [existingRows] = await pool.execute(
        `SELECT *
         FROM chat_threads
         WHERE user_email = ?
         LIMIT 1`,
        [userEmail]
    );

    if (Array.isArray(existingRows) && existingRows.length) {
        const existing = existingRows[0];
        if (Number(existing.user_id || 0) !== userId) {
            await pool.execute(
                `UPDATE chat_threads
                 SET user_id = ?, updated_at = NOW()
                 WHERE id = ?`,
                [userId, Number(existing.id || 0)]
            );
            const [updatedRows] = await pool.execute(
                `SELECT *
                 FROM chat_threads
                 WHERE id = ?
                 LIMIT 1`,
                [Number(existing.id || 0)]
            );
            return Array.isArray(updatedRows) && updatedRows.length
                ? mapChatThreadRow(updatedRows[0])
                : mapChatThreadRow(existing);
        }
        return mapChatThreadRow(existing);
    }

    await pool.execute(
        `INSERT INTO chat_threads (
            user_id,
            user_email,
            mode
        ) VALUES (?, ?, ?)`,
        [userId, userEmail, CHAT_THREAD_MODE_BOT]
    );

    const [rows] = await pool.execute(
        `SELECT *
         FROM chat_threads
         WHERE user_email = ?
         LIMIT 1`,
        [userEmail]
    );
    if (!Array.isArray(rows) || rows.length < 1) {
        return null;
    }
    return mapChatThreadRow(rows[0]);
}

async function listChatMessagesForThread(pool, threadId, options) {
    const parsedThreadId = parsePositiveId(threadId);
    if (!parsedThreadId) {
        return [];
    }

    const opts = options && typeof options === "object" ? options : {};
    const afterId = parsePositiveId(opts.afterId);
    const limit = parseChatMessageLimit(opts.limit);

    const queryParts = [
        "SELECT * FROM chat_messages WHERE thread_id = ?"
    ];
    const params = [parsedThreadId];
    if (afterId > 0) {
        queryParts.push("AND id > ?");
        params.push(afterId);
    }
    queryParts.push("ORDER BY id ASC");
    queryParts.push("LIMIT ?");
    params.push(limit);

    const [rows] = await pool.execute(queryParts.join(" "), params);
    if (!Array.isArray(rows)) {
        return [];
    }
    return rows.map(mapChatMessageRow);
}

async function listChatMessagesByClientMessageIds(pool, threadId, clientMessageIds) {
    const parsedThreadId = parsePositiveId(threadId);
    if (!parsedThreadId) {
        return [];
    }

    const normalizedIds = Array.isArray(clientMessageIds)
        ? clientMessageIds
            .map((value) => normalizeChatClientMessageId(value))
            .filter(Boolean)
        : [];
    if (!normalizedIds.length) {
        return [];
    }

    const placeholders = normalizedIds.map(() => "?").join(", ");
    const [rows] = await pool.execute(
        `SELECT *
         FROM chat_messages
         WHERE thread_id = ?
           AND client_message_id IN (${placeholders})
         ORDER BY id ASC`,
        [parsedThreadId].concat(normalizedIds)
    );

    if (!Array.isArray(rows)) {
        return [];
    }
    return rows.map(mapChatMessageRow);
}

async function setChatThreadMode(pool, threadId, mode, adminSession) {
    const parsedThreadId = parsePositiveId(threadId);
    const normalizedMode = normalizeChatMode(mode);
    if (!parsedThreadId) {
        return null;
    }

    const admin = adminSession && typeof adminSession === "object" ? adminSession : null;
    const takeoverAdminId = admin ? parsePositiveId(admin.userId) : 0;
    const takeoverAdminEmail = admin ? normalizeEmail(admin.email) : "";

    if (normalizedMode === CHAT_THREAD_MODE_ADMIN) {
        await pool.execute(
            `UPDATE chat_threads
             SET mode = ?,
                 takeover_by_admin_id = ?,
                 takeover_by_admin_email = ?,
                 takeover_started_at = NOW(),
                 updated_at = NOW()
             WHERE id = ?`,
            [
                CHAT_THREAD_MODE_ADMIN,
                takeoverAdminId || null,
                takeoverAdminEmail || null,
                parsedThreadId
            ]
        );
    } else {
        await pool.execute(
            `UPDATE chat_threads
             SET mode = ?,
                 takeover_by_admin_id = NULL,
                 takeover_by_admin_email = NULL,
                 takeover_started_at = NULL,
                 updated_at = NOW()
             WHERE id = ?`,
            [CHAT_THREAD_MODE_BOT, parsedThreadId]
        );
    }

    const [rows] = await pool.execute(
        `SELECT *
         FROM chat_threads
         WHERE id = ?
         LIMIT 1`,
        [parsedThreadId]
    );
    if (!Array.isArray(rows) || rows.length < 1) {
        return null;
    }
    return mapChatThreadRow(rows[0]);
}

async function insertChatMessage(pool, threadId, role, text, options) {
    const parsedThreadId = parsePositiveId(threadId);
    if (!parsedThreadId) {
        return null;
    }

    const opts = options && typeof options === "object" ? options : {};
    const senderRole = normalizeChatMessageRole(role, "user");
    const messageText = normalizeChatMessageText(text);
    if (!messageText) {
        return null;
    }

    const senderLabel = normalizeText(opts.senderLabel || "").slice(0, 80) || null;
    const clientMessageId = normalizeChatClientMessageId(opts.clientMessageId || "");

    const [result] = await pool.execute(
        `INSERT IGNORE INTO chat_messages (
            thread_id,
            sender_role,
            sender_label,
            message_text,
            client_message_id
        ) VALUES (?, ?, ?, ?, ?)`,
        [
            parsedThreadId,
            senderRole,
            senderLabel,
            messageText,
            clientMessageId || null
        ]
    );

    if (result && Number(result.affectedRows || 0) > 0) {
        const [rows] = await pool.execute(
            `SELECT *
             FROM chat_messages
             WHERE id = ?
             LIMIT 1`,
            [Number(result.insertId || 0)]
        );
        if (Array.isArray(rows) && rows.length) {
            return mapChatMessageRow(rows[0]);
        }
    }

    if (clientMessageId) {
        const [rows] = await pool.execute(
            `SELECT *
             FROM chat_messages
             WHERE thread_id = ?
               AND client_message_id = ?
             LIMIT 1`,
            [parsedThreadId, clientMessageId]
        );
        if (Array.isArray(rows) && rows.length) {
            return mapChatMessageRow(rows[0]);
        }
    }

    return null;
}

async function handleSignupSendCode(req, res) {
    try {
        clearExpiredSignupOtpSessions();
        const body = await readBody(req);

        const method = String(body.method || "").trim().toLowerCase();
        const email = normalizeEmail(body.email);
        const phone = normalizeMobile(body.phone);

        if (method !== "email" && method !== "mobile") {
            sendJson(res, 400, { success: false, message: "Method must be email or mobile." });
            return;
        }
        if (!isValidEmail(email)) {
            sendJson(res, 400, { success: false, message: "Please enter a valid email address." });
            return;
        }
        if (!isValidMobile(phone)) {
            sendJson(res, 400, { success: false, message: "Use 09XXXXXXXXX or +639XXXXXXXXX." });
            return;
        }
        const signupContact = method === "mobile" ? phone : email;
        if (!enforceRateLimit(
            req,
            res,
            "signup-send-otp",
            signupContact,
            OTP_SEND_RATE_LIMIT_MAX,
            RATE_LIMIT_WINDOW_MS
        )) {
            return;
        }

        const emailDomainCheck = await validateEmailDomainExists(email);
        if (!emailDomainCheck.valid && !emailDomainCheck.uncertain) {
            sendJson(res, 400, {
                success: false,
                message: "This email domain cannot receive email. Use another email."
            });
            return;
        }

        if (!isDbConfigured()) {
            sendJson(res, 503, {
                success: false,
                message: "Signup verification is unavailable. Database is not configured."
            });
            return;
        }

        const pool = await getDbPool();
        const conflict = await findSignupContactConflict(pool, email, phone);
        if (conflict === "phone") {
            sendJson(res, 409, { success: false, message: "This mobile number is already in use." });
            return;
        }
        if (conflict === "email") {
            sendJson(res, 409, { success: false, message: "An account with this email already exists." });
            return;
        }

        const contact = method === "mobile" ? phone : email;
        const requestId = createVerificationToken("signupotp");
        const code = generateOtpCode();
        signupOtpSessions.set(requestId, {
            code: code,
            method: method,
            contact: contact,
            email: email,
            phone: phone,
            expiresAt: Date.now() + OTP_TTL_MS,
            verified: false,
            attempts: 0
        });

        const delivery = await deliverOtp(
            method,
            contact,
            code,
            { subject: "Ecodrive signup verification code" }
        );
        const isDemoMode = !delivery.sent;
        if (isDemoMode && !DEMO_OTP_ENABLED) {
            signupOtpSessions.delete(requestId);
            const deliveryReason = String(delivery.reason || "").trim();
            sendJson(res, 503, {
                success: false,
                message: deliveryReason
                    ? `OTP delivery is unavailable. ${deliveryReason}`
                    : "OTP delivery is unavailable. Configure SMTP or SMS provider first."
            });
            return;
        }

        const responsePayload = {
            success: true,
            message: isDemoMode ? "Verification code generated in demo mode." : "Verification code sent.",
            requestId: requestId,
            expiresInMs: OTP_TTL_MS,
            delivery: {
                method: method,
                mode: isDemoMode ? "demo" : "provider",
                provider: isDemoMode ? "local-demo" : String(delivery.provider || "configured-provider")
            }
        };

        if (isDemoMode && DEMO_OTP_ENABLED) {
            responsePayload.demoCode = code;
            responsePayload.deliveryReason = String(delivery.reason || "No provider configured.");
        }

        const codeLog = isDemoMode ? ` code=${code}` : "";
        console.log(`[signup-otp] ${method}:${contact} requestId=${requestId} mode=${responsePayload.delivery.mode}${codeLog}`);
        sendJson(res, 200, responsePayload);
    } catch (error) {
        sendJson(res, 500, { success: false, message: error.message || "Unable to send signup verification code." });
    }
}

async function handleSignupVerifyCode(req, res) {
    try {
        clearExpiredSignupOtpSessions();
        const body = await readBody(req);

        const requestId = String(body.requestId || "").trim();
        const method = String(body.method || "").trim().toLowerCase();
        const code = String(body.code || "").trim();
        const email = normalizeEmail(body.email);
        const phone = normalizeMobile(body.phone);

        if (!enforceRateLimit(
            req,
            res,
            "signup-verify-otp",
            requestId || email || phone,
            OTP_VERIFY_RATE_LIMIT_MAX,
            RATE_LIMIT_WINDOW_MS
        )) {
            return;
        }

        if (!requestId || !/^\d{4}$/.test(code)) {
            sendJson(res, 400, {
                success: false,
                verified: false,
                message: "requestId and 4-digit code are required."
            });
            return;
        }

        const session = signupOtpSessions.get(requestId);
        if (!session) {
            sendJson(res, 200, { success: true, verified: false, message: "Code expired or not found." });
            return;
        }

        if (method && method !== session.method) {
            sendJson(res, 400, {
                success: false,
                verified: false,
                message: "Verification method does not match this request."
            });
            return;
        }

        if (isValidEmail(email) && session.email !== email) {
            sendJson(res, 400, {
                success: false,
                verified: false,
                message: "Email does not match the verification request."
            });
            return;
        }

        if (isValidMobile(phone) && session.phone !== phone) {
            sendJson(res, 400, {
                success: false,
                verified: false,
                message: "Mobile number does not match the verification request."
            });
            return;
        }

        if (session.expiresAt <= Date.now()) {
            signupOtpSessions.delete(requestId);
            sendJson(res, 200, { success: true, verified: false, message: "Code expired. Request a new code." });
            return;
        }

        session.attempts += 1;
        if (session.code !== code) {
            if (session.attempts >= MAX_OTP_ATTEMPTS) {
                signupOtpSessions.delete(requestId);
                sendJson(res, 200, {
                    success: true,
                    verified: false,
                    message: "Too many failed attempts. Request a new code."
                });
                return;
            }
            signupOtpSessions.set(requestId, session);
            sendJson(res, 200, { success: true, verified: false, message: "Invalid verification code." });
            return;
        }

        session.verified = true;
        signupOtpSessions.set(requestId, session);
        sendJson(res, 200, {
            success: true,
            verified: true,
            message: "Code verified.",
            requestId: requestId,
            method: session.method
        });
    } catch (error) {
        sendJson(res, 500, { success: false, verified: false, message: error.message || "Verification failed." });
    }
}

async function handleSignup(req, res) {
    try {
        clearExpiredSignupOtpSessions();
        const body = await readBody(req);

        const firstName = normalizeNamePart(body.firstName);
        const middleInitial = normalizeMiddleInitial(body.middleInitial);
        const lastName = normalizeNamePart(body.lastName);
        const fullName = buildFullName(firstName, middleInitial, lastName);
        const email = normalizeEmail(body.email);
        const phone = normalizeMobile(body.phone);
        const address = normalizeNamePart(body.address);
        const password = String(body.password || "");
        const verificationRequestId = String(body.verificationRequestId || "").trim();
        const verificationMethod = String(body.verificationMethod || "").trim().toLowerCase();
        const emailVerificationRequestId = String(body.emailVerificationRequestId || "").trim();
        const phoneVerificationRequestId = String(body.phoneVerificationRequestId || "").trim();

        if (firstName.length < 2) {
            sendJson(res, 400, { success: false, message: "First name is required." });
            return;
        }
        if (lastName.length < 2) {
            sendJson(res, 400, { success: false, message: "Last name is required." });
            return;
        }
        if (!isValidEmail(email)) {
            sendJson(res, 400, { success: false, message: "Please enter a valid email address." });
            return;
        }
        if (!isValidMobile(phone)) {
            sendJson(res, 400, { success: false, message: "Use 09XXXXXXXXX or +639XXXXXXXXX." });
            return;
        }
        if (address.length < 5) {
            sendJson(res, 400, { success: false, message: "Please enter a complete address." });
            return;
        }
        if (!isStrongPassword(password)) {
            sendJson(res, 400, {
                success: false,
                message: "Password must be 8+ chars with upper, lower, number, and symbol."
            });
            return;
        }

        const emailDomainCheck = await validateEmailDomainExists(email);
        if (!emailDomainCheck.valid && !emailDomainCheck.uncertain) {
            sendJson(res, 400, {
                success: false,
                message: "This email domain cannot receive email. Use another email."
            });
            return;
        }

        let verifiedSession = null;
        const consumedRequestIds = [];

        if (verificationRequestId) {
            const expectedMethod = (
                verificationMethod === "email" ||
                verificationMethod === "mobile"
            )
                ? verificationMethod
                : "";
            verifiedSession = getVerifiedSignupOtpSession(verificationRequestId, expectedMethod);
            if (!verifiedSession) {
                sendJson(res, 400, {
                    success: false,
                    message: "Email or mobile verification is required before signup."
                });
                return;
            }
            consumedRequestIds.push(verificationRequestId);
        } else {
            const emailSession = emailVerificationRequestId
                ? getVerifiedSignupOtpSession(emailVerificationRequestId, "email")
                : null;
            const phoneSession = phoneVerificationRequestId
                ? getVerifiedSignupOtpSession(phoneVerificationRequestId, "mobile")
                : null;

            verifiedSession = phoneSession || emailSession;
            if (!verifiedSession) {
                sendJson(res, 400, {
                    success: false,
                    message: "Email or mobile verification is required before signup."
                });
                return;
            }
            if (emailSession && emailVerificationRequestId) {
                consumedRequestIds.push(emailVerificationRequestId);
            }
            if (phoneSession && phoneVerificationRequestId) {
                consumedRequestIds.push(phoneVerificationRequestId);
            }
        }

        if (!verifiedSession) {
            sendJson(res, 400, {
                success: false,
                message: "Email or mobile verification is required before signup."
            });
            return;
        }

        if (
            verifiedSession.email !== email ||
            verifiedSession.phone !== phone
        ) {
            sendJson(res, 400, {
                success: false,
                message: "Verified contact does not match your signup details."
            });
            return;
        }

        if (
            (verifiedSession.method === "email" && verifiedSession.contact !== email) ||
            (verifiedSession.method === "mobile" && verifiedSession.contact !== phone)
        ) {
            sendJson(res, 400, {
                success: false,
                message: "Verified contact does not match your signup details."
            });
            return;
        }

        const pool = await getDbPool();
        const passwordHash = hashPassword(password);

        const sql = `
            INSERT INTO users (
                first_name,
                middle_initial,
                last_name,
                full_name,
                email,
                phone,
                address,
                password_hash,
                role,
                is_blocked
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'user', 0)
        `;

        const values = [
            firstName,
            middleInitial || null,
            lastName,
            fullName,
            email,
            phone,
            address,
            passwordHash
        ];

        const [result] = await pool.execute(sql, values);

        for (const requestId of consumedRequestIds) {
            if (requestId) {
                signupOtpSessions.delete(requestId);
            }
        }

        const safeUser = {
            id: Number(result.insertId || 0),
            firstName: firstName,
            middleInitial: middleInitial,
            lastName: lastName,
            name: fullName,
            email: email,
            phone: phone,
            address: address,
            role: "user",
            status: "active"
        };

        const authSession = createAuthSession(safeUser);
        sendJson(res, 201, {
            success: true,
            user: safeUser,
            ...getAuthResponse(authSession)
        });
    } catch (error) {
        if (error && error.code === "ER_DUP_ENTRY") {
            const duplicateField = getDuplicateField(error.message);
            const message = duplicateField === "phone"
                ? "This mobile number is already in use."
                : "An account with this email already exists.";
            sendJson(res, 409, { success: false, message: message });
            return;
        }

        sendJson(res, 500, { success: false, message: error.message || "Signup failed." });
    }
}

async function handleLogin(req, res) {
    try {
        const body = await readBody(req);
        const loginId = normalizeAdminLoginId(body.email || body.username);
        const password = String(body.password || "");

        if (!loginId || !password) {
            sendJson(res, 400, { success: false, message: "Email/username and password are required." });
            return;
        }

        const adminCredentials = getAdminCredentials();
        if (!enforceRateLimit(req, res, "login", loginId, LOGIN_RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
            return;
        }
        if (
            adminCredentials &&
            loginId === adminCredentials.loginId &&
            verifyPassword(password, adminCredentials.passwordHash)
        ) {
            const adminUser = {
                id: 0,
                name: "Admin",
                email: adminCredentials.loginId,
                role: "admin",
                status: "active"
            };
            const authSession = createAuthSession(adminUser);
            sendJson(res, 200, {
                success: true,
                user: adminUser,
                ...getAuthResponse(authSession)
            });
            return;
        }

        if (!adminCredentials && !isValidEmail(loginId)) {
            sendJson(res, 503, {
                success: false,
                message: "Admin credentials are not initialized. Set ADMIN_LOGIN_ID and ADMIN_PASSWORD first."
            });
            return;
        }

        if (!isValidEmail(loginId)) {
            sendJson(res, 400, { success: false, message: "Please enter a valid email address or the admin username." });
            return;
        }

        const pool = await getDbPool();
        const [rows] = await pool.execute(
            `SELECT id, first_name, middle_initial, last_name, full_name, email, phone, address, password_hash, role, is_blocked
             FROM users
             WHERE email = ?
             LIMIT 1`,
            [loginId]
        );

        const user = Array.isArray(rows) && rows.length ? rows[0] : null;
        if (!user) {
            sendJson(res, 401, { success: false, message: "Invalid email or password." });
            return;
        }

        if (Number(user.is_blocked) === 1) {
            sendJson(res, 403, {
                success: false,
                message: "Your account is blocked. Please contact admin."
            });
            return;
        }

        const validPassword = verifyPassword(password, user.password_hash);
        if (!validPassword) {
            sendJson(res, 401, { success: false, message: "Invalid email or password." });
            return;
        }

        await pool.execute("UPDATE users SET last_login_at = NOW() WHERE id = ?", [user.id]);

        const safeUser = {
            id: Number(user.id || 0),
            firstName: String(user.first_name || ""),
            middleInitial: String(user.middle_initial || ""),
            lastName: String(user.last_name || ""),
            name: String(user.full_name || ""),
            email: String(user.email || ""),
            phone: String(user.phone || ""),
            address: String(user.address || ""),
            role: String(user.role || "user"),
            status: Number(user.is_blocked) === 1 ? "blocked" : "active"
        };

        const authSession = createAuthSession(safeUser);
        sendJson(res, 200, {
            success: true,
            user: safeUser,
            ...getAuthResponse(authSession)
        });
    } catch (error) {
        sendJson(res, 500, { success: false, message: error.message || "Login failed." });
    }
}

async function handleAuthMe(req, res) {
    const session = requireAuthSession(req, res);
    if (!session) {
        return;
    }

    sendJson(res, 200, {
        success: true,
        user: {
            id: Number(session.userId || 0),
            name: String(session.name || ""),
            email: String(session.email || ""),
            role: normalizeUserRole(session.role),
            status: "active"
        },
        ...getAuthResponse(session)
    });
}

async function handleLogout(req, res) {
    const token = getAuthTokenFromRequest(req);
    if (token) {
        authSessions.delete(token);
    }
    sendJson(res, 200, { success: true, message: "Logged out." });
}

async function handleAdminUsers(req, res) {
    try {
        const authSession = requireAuthSession(req, res, { role: "admin" });
        if (!authSession) {
            return;
        }

        const pool = await getDbPool();
        let userRows = [];
        try {
            const [joinedRows] = await pool.execute(
                `SELECT
                    u.id,
                    u.full_name,
                    u.email,
                    u.role,
                    u.is_blocked,
                    u.created_at,
                    COALESCE(ct.mode, 'bot') AS chat_mode,
                    ct.updated_at AS chat_updated_at
                 FROM users u
                 LEFT JOIN chat_threads ct
                   ON ct.user_email = u.email
                 WHERE u.role = 'user'
                 ORDER BY u.created_at DESC`
            );
            userRows = Array.isArray(joinedRows) ? joinedRows : [];
        } catch (queryError) {
            const [fallbackRows] = await pool.execute(
                `SELECT
                    id,
                    full_name,
                    email,
                    role,
                    is_blocked,
                    created_at
                 FROM users
                 WHERE role = 'user'
                 ORDER BY created_at DESC`
            );
            userRows = Array.isArray(fallbackRows)
                ? fallbackRows.map((row) => ({
                    ...row,
                    chat_mode: CHAT_THREAD_MODE_BOT,
                    chat_updated_at: null
                }))
                : [];
            console.warn("[chat] Falling back to users query without chat thread join:", queryError.message || queryError);
        }

        const [statRows] = await pool.execute(
            `SELECT
                COUNT(*) AS totalUsers,
                SUM(CASE WHEN is_blocked = 0 THEN 1 ELSE 0 END) AS activeUsers,
                SUM(CASE WHEN is_blocked = 1 THEN 1 ELSE 0 END) AS blockedUsers,
                SUM(CASE WHEN created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01') THEN 1 ELSE 0 END) AS newUsersThisMonth
             FROM users
             WHERE role = 'user'`
        );

        const stats = statRows && statRows[0] ? statRows[0] : {};
        const payload = {
            success: true,
            stats: {
                totalUsers: Number(stats.totalUsers || 0),
                activeUsers: Number(stats.activeUsers || 0),
                newUsersThisMonth: Number(stats.newUsersThisMonth || 0),
                blockedUsers: Number(stats.blockedUsers || 0)
            },
            users: (userRows || []).map((row) => ({
                id: Number(row.id || 0),
                name: String(row.full_name || ""),
                email: String(row.email || ""),
                role: String(row.role || "user"),
                status: Number(row.is_blocked) === 1 ? "blocked" : "active",
                createdAt: row.created_at || null,
                chatMode: normalizeChatMode(row.chat_mode),
                chatUpdatedAt: row.chat_updated_at || null
            }))
        };

        sendJson(res, 200, payload);
    } catch (error) {
        sendJson(res, 500, { success: false, message: error.message || "Unable to load users." });
    }
}

async function handleAdminDashboard(_req, res) {
    try {
        const authSession = requireAuthSession(_req, res, { role: "admin" });
        if (!authSession) {
            return;
        }

        const pool = await getDbPool();

        const [bookingStatsRows] = await pool.execute(
            `SELECT
                COUNT(*) AS totalBookings,
                COALESCE(SUM(total), 0) AS grossSales,
                COALESCE(SUM(
                    CASE
                        WHEN (
                            review_decision = 'approved'
                            OR LOWER(status) LIKE '%approve%'
                            OR LOWER(status) LIKE '%complete%'
                            OR LOWER(status) LIKE '%deliver%'
                        )
                        AND LOWER(status) NOT LIKE '%cancel%'
                        AND LOWER(fulfillment_status) NOT LIKE '%cancel%'
                        THEN total
                        ELSE 0
                    END
                ), 0) AS totalSales,
                COALESCE(SUM(
                    CASE
                        WHEN review_decision = 'none'
                            AND LOWER(status) NOT LIKE '%cancel%'
                            AND LOWER(fulfillment_status) NOT LIKE '%cancel%'
                            AND LOWER(status) NOT LIKE '%reject%'
                            AND LOWER(status) NOT LIKE '%approve%'
                            AND LOWER(status) NOT LIKE '%complete%'
                            AND LOWER(status) NOT LIKE '%deliver%'
                        THEN 1
                        ELSE 0
                    END
                ), 0) AS pendingBookings,
                COALESCE(SUM(
                    CASE
                        WHEN (
                            review_decision = 'approved'
                            OR LOWER(status) LIKE '%approve%'
                            OR LOWER(status) LIKE '%complete%'
                            OR LOWER(status) LIKE '%deliver%'
                        )
                        AND LOWER(status) NOT LIKE '%cancel%'
                        AND LOWER(fulfillment_status) NOT LIKE '%cancel%'
                        THEN 1
                        ELSE 0
                    END
                ), 0) AS approvedBookings,
                COALESCE(SUM(
                    CASE
                        WHEN (
                            review_decision = 'rejected'
                            OR LOWER(status) LIKE '%reject%'
                            OR LOWER(status) LIKE '%cancel%'
                            OR LOWER(fulfillment_status) LIKE '%cancel%'
                        )
                        THEN 1
                        ELSE 0
                    END
                ), 0) AS rejectedBookings,
                COALESCE(SUM(
                    CASE
                        WHEN LOWER(status) LIKE '%cancel%'
                            OR LOWER(fulfillment_status) LIKE '%cancel%'
                        THEN 1
                        ELSE 0
                    END
                ), 0) AS cancelledBookings,
                COALESCE(SUM(
                    CASE
                        WHEN (
                            review_decision = 'approved'
                            OR LOWER(status) LIKE '%approve%'
                            OR LOWER(status) LIKE '%complete%'
                            OR LOWER(status) LIKE '%deliver%'
                        )
                        AND LOWER(status) NOT LIKE '%cancel%'
                        AND LOWER(fulfillment_status) NOT LIKE '%cancel%'
                        THEN 1
                        ELSE 0
                    END
                ), 0) AS successfulBookings
             FROM bookings`
        );

        const [userStatsRows] = await pool.execute(
            `SELECT COUNT(*) AS totalUsers
             FROM users
             WHERE role = 'user'`
        );

        const [monthlyRows] = await pool.execute(
            `SELECT
                DATE_FORMAT(created_at, '%Y-%m-01') AS month_key,
                COALESCE(SUM(
                    CASE
                        WHEN (
                            review_decision = 'approved'
                            OR LOWER(status) LIKE '%approve%'
                            OR LOWER(status) LIKE '%complete%'
                            OR LOWER(status) LIKE '%deliver%'
                        )
                        AND LOWER(status) NOT LIKE '%cancel%'
                        AND LOWER(fulfillment_status) NOT LIKE '%cancel%'
                        THEN total
                        ELSE 0
                    END
                ), 0) AS sales,
                COUNT(*) AS bookings,
                COALESCE(SUM(
                    CASE
                        WHEN (
                            review_decision = 'approved'
                            OR LOWER(status) LIKE '%approve%'
                            OR LOWER(status) LIKE '%complete%'
                            OR LOWER(status) LIKE '%deliver%'
                        )
                        AND LOWER(status) NOT LIKE '%cancel%'
                        AND LOWER(fulfillment_status) NOT LIKE '%cancel%'
                        THEN 1
                        ELSE 0
                    END
                ), 0) AS approved,
                COALESCE(SUM(
                    CASE
                        WHEN (
                            review_decision = 'rejected'
                            OR LOWER(status) LIKE '%reject%'
                            OR LOWER(status) LIKE '%cancel%'
                            OR LOWER(fulfillment_status) LIKE '%cancel%'
                        )
                        THEN 1
                        ELSE 0
                    END
                ), 0) AS rejected,
                COALESCE(SUM(
                    CASE
                        WHEN review_decision = 'none'
                            AND LOWER(status) NOT LIKE '%cancel%'
                            AND LOWER(fulfillment_status) NOT LIKE '%cancel%'
                            AND LOWER(status) NOT LIKE '%reject%'
                            AND LOWER(status) NOT LIKE '%approve%'
                            AND LOWER(status) NOT LIKE '%complete%'
                            AND LOWER(status) NOT LIKE '%deliver%'
                        THEN 1
                        ELSE 0
                    END
                ), 0) AS pending
             FROM bookings
             WHERE created_at >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 11 MONTH), '%Y-%m-01')
             GROUP BY month_key
             ORDER BY month_key ASC`
        );

        const bookingStats = bookingStatsRows && bookingStatsRows[0] ? bookingStatsRows[0] : {};
        const userStats = userStatsRows && userStatsRows[0] ? userStatsRows[0] : {};
        const monthlyMap = new Map();
        (monthlyRows || []).forEach((row) => {
            const key = String(row.month_key || "").trim();
            if (!key) {
                return;
            }
            monthlyMap.set(key, row);
        });

        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const now = new Date();
        const salesOverview = [];
        for (let offset = 11; offset >= 0; offset -= 1) {
            const monthDate = new Date(now.getFullYear(), now.getMonth() - offset, 1);
            const monthKey = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}-01`;
            const row = monthlyMap.get(monthKey) || {};

            salesOverview.push({
                key: monthKey.slice(0, 7),
                label: `${monthNames[monthDate.getMonth()]} ${String(monthDate.getFullYear()).slice(-2)}`,
                sales: Number(row.sales || 0),
                bookings: Number(row.bookings || 0),
                approved: Number(row.approved || 0),
                rejected: Number(row.rejected || 0),
                pending: Number(row.pending || 0)
            });
        }

        sendJson(res, 200, {
            success: true,
            asOf: new Date().toISOString(),
            stats: {
                totalSales: Number(bookingStats.totalSales || 0),
                grossSales: Number(bookingStats.grossSales || 0),
                totalBookings: Number(bookingStats.totalBookings || 0),
                pendingBookings: Number(bookingStats.pendingBookings || 0),
                approvedBookings: Number(bookingStats.approvedBookings || 0),
                rejectedBookings: Number(bookingStats.rejectedBookings || 0),
                successfulBookings: Number(bookingStats.successfulBookings || 0),
                cancelledBookings: Number(bookingStats.cancelledBookings || 0),
                totalUsers: Number(userStats.totalUsers || 0)
            },
            salesOverview: salesOverview
        });
    } catch (error) {
        sendJson(res, 500, { success: false, message: error.message || "Unable to load dashboard stats." });
    }
}

async function handleBlockToggle(req, res, userId, action) {
    try {
        const authSession = requireAuthSession(req, res, { role: "admin" });
        if (!authSession) {
            return;
        }

        const pool = await getDbPool();
        const blockedValue = action === "block" ? 1 : 0;

        const [result] = await pool.execute(
            `UPDATE users
             SET is_blocked = ?, updated_at = NOW()
             WHERE id = ? AND role = 'user'`,
            [blockedValue, Number(userId)]
        );

        if (!result || Number(result.affectedRows || 0) < 1) {
            sendJson(res, 404, { success: false, message: "User not found." });
            return;
        }

        sendJson(res, 200, {
            success: true,
            message: blockedValue === 1 ? "User blocked successfully." : "User unblocked successfully."
        });
    } catch (error) {
        sendJson(res, 500, { success: false, message: error.message || "Unable to update user status." });
    }
}

async function resolveChatTargetUserFromEmail(pool, authSession, requestedEmailInput) {
    const requestedEmail = normalizeEmail(requestedEmailInput);
    const sessionEmail = normalizeEmail(authSession && authSession.email);
    const targetEmail = isValidEmail(requestedEmail) ? requestedEmail : sessionEmail;

    if (!isValidEmail(targetEmail)) {
        return { ok: false, statusCode: 400, message: "A valid email is required." };
    }
    if (!canAccessEmail(authSession, targetEmail)) {
        return { ok: false, statusCode: 403, message: "You can only access your own chat thread." };
    }

    const user = await findChatUserByEmail(pool, targetEmail);
    if (!user) {
        return { ok: false, statusCode: 404, message: "User not found." };
    }

    return { ok: true, user: user };
}

function toChatUserPayload(userRow) {
    const user = userRow && typeof userRow === "object" ? userRow : {};
    return {
        id: Number(user.id || 0),
        name: String(user.full_name || ""),
        email: String(user.email || "")
    };
}

async function handleChatThreadGet(req, res, parsedUrl) {
    try {
        const authSession = requireAuthSession(req, res);
        if (!authSession) {
            return;
        }

        const pool = await getDbPool();
        const target = await resolveChatTargetUserFromEmail(
            pool,
            authSession,
            parsedUrl.searchParams.get("email")
        );
        if (!target.ok) {
            sendJson(res, target.statusCode, { success: false, message: target.message });
            return;
        }

        const thread = await getOrCreateChatThreadForUser(pool, target.user);
        if (!thread) {
            sendJson(res, 500, { success: false, message: "Unable to open chat thread." });
            return;
        }

        const messages = await listChatMessagesForThread(pool, thread.id, {
            afterId: parsedUrl.searchParams.get("afterId"),
            limit: parsedUrl.searchParams.get("limit")
        });

        sendJson(res, 200, {
            success: true,
            user: toChatUserPayload(target.user),
            thread: thread,
            messages: messages
        });
    } catch (error) {
        sendJson(res, 500, { success: false, message: error.message || "Unable to load chat thread." });
    }
}

function parseIncomingChatEntries(bodyInput) {
    const body = bodyInput && typeof bodyInput === "object" ? bodyInput : {};
    if (Array.isArray(body.entries)) {
        return body.entries;
    }
    if (body.entry && typeof body.entry === "object") {
        return [body.entry];
    }
    if (body.message || body.text) {
        return [body];
    }
    return [];
}

async function handleChatMessagesPost(req, res) {
    try {
        const authSession = requireAuthSession(req, res);
        if (!authSession) {
            return;
        }

        const body = await readBody(req);
        const entries = parseIncomingChatEntries(body);
        if (!entries.length) {
            sendJson(res, 400, { success: false, message: "At least one chat message is required." });
            return;
        }

        const pool = await getDbPool();
        const target = await resolveChatTargetUserFromEmail(
            pool,
            authSession,
            body.email || body.userEmail
        );
        if (!target.ok) {
            sendJson(res, target.statusCode, { success: false, message: target.message });
            return;
        }

        const thread = await getOrCreateChatThreadForUser(pool, target.user);
        if (!thread) {
            sendJson(res, 500, { success: false, message: "Unable to open chat thread." });
            return;
        }

        const submittedClientIds = [];
        for (const rawEntry of entries) {
            const entry = rawEntry && typeof rawEntry === "object" ? rawEntry : {};
            const role = normalizeChatMessageRole(
                entry.role || entry.from || entry.senderRole,
                authSession.role === "admin" ? "admin" : "user"
            );
            if (role !== "user" && role !== "bot" && role !== "admin") {
                continue;
            }
            if (role === "admin" && authSession.role !== "admin") {
                continue;
            }
            if (thread.mode === CHAT_THREAD_MODE_ADMIN && role === "bot") {
                continue;
            }

            const text = normalizeChatMessageText(entry.text || entry.message || entry.messageText);
            if (!text) {
                continue;
            }

            const clientMessageId = normalizeChatClientMessageId(entry.clientMessageId || entry.client_message_id);
            const senderLabel = role === "user"
                ? normalizeText(target.user.full_name || target.user.email || "User")
                : (role === "admin"
                    ? normalizeText(authSession.name || authSession.email || "Admin")
                    : "Ecodrive Bot");

            const inserted = await insertChatMessage(pool, thread.id, role, text, {
                senderLabel: senderLabel,
                clientMessageId: clientMessageId
            });
            if (inserted && inserted.clientMessageId) {
                submittedClientIds.push(inserted.clientMessageId);
            } else if (clientMessageId) {
                submittedClientIds.push(clientMessageId);
            }
        }

        let persistedMessages = [];
        if (submittedClientIds.length) {
            persistedMessages = await listChatMessagesByClientMessageIds(pool, thread.id, submittedClientIds);
        } else {
            persistedMessages = await listChatMessagesForThread(pool, thread.id, { limit: 20 });
        }

        const [threadRows] = await pool.execute(
            `SELECT *
             FROM chat_threads
             WHERE id = ?
             LIMIT 1`,
            [thread.id]
        );
        const latestThread = Array.isArray(threadRows) && threadRows.length
            ? mapChatThreadRow(threadRows[0])
            : thread;

        sendJson(res, 200, {
            success: true,
            user: toChatUserPayload(target.user),
            thread: latestThread,
            messages: persistedMessages
        });
    } catch (error) {
        sendJson(res, 500, { success: false, message: error.message || "Unable to save chat messages." });
    }
}

async function handleChatThreadClear(req, res) {
    try {
        const authSession = requireAuthSession(req, res);
        if (!authSession) {
            return;
        }

        const body = await readBody(req);
        const pool = await getDbPool();
        const target = await resolveChatTargetUserFromEmail(
            pool,
            authSession,
            body.email || body.userEmail
        );
        if (!target.ok) {
            sendJson(res, target.statusCode, { success: false, message: target.message });
            return;
        }

        const thread = await getOrCreateChatThreadForUser(pool, target.user);
        if (!thread) {
            sendJson(res, 500, { success: false, message: "Unable to open chat thread." });
            return;
        }

        await pool.execute(
            `DELETE FROM chat_messages
             WHERE thread_id = ?`,
            [thread.id]
        );

        // Reset thread back to bot mode when user clears conversation.
        let latestThread = thread;
        if (normalizeUserRole(authSession.role) !== "admin") {
            const resetThread = await setChatThreadMode(pool, thread.id, CHAT_THREAD_MODE_BOT, null);
            if (resetThread) {
                latestThread = resetThread;
            }
        } else {
            const [rows] = await pool.execute(
                `SELECT *
                 FROM chat_threads
                 WHERE id = ?
                 LIMIT 1`,
                [thread.id]
            );
            if (Array.isArray(rows) && rows.length) {
                latestThread = mapChatThreadRow(rows[0]);
            }
        }

        sendJson(res, 200, {
            success: true,
            message: "Chat conversation deleted.",
            user: toChatUserPayload(target.user),
            thread: latestThread,
            messages: []
        });
    } catch (error) {
        sendJson(res, 500, { success: false, message: error.message || "Unable to clear chat thread." });
    }
}

async function resolveAdminChatUser(pool, userId) {
    const user = await findChatUserById(pool, userId);
    if (!user) {
        return null;
    }
    return user;
}

async function handleAdminChatThreadGet(req, res, parsedUrl, userId) {
    try {
        const authSession = requireAuthSession(req, res, { role: "admin" });
        if (!authSession) {
            return;
        }

        const pool = await getDbPool();
        const user = await resolveAdminChatUser(pool, userId);
        if (!user) {
            sendJson(res, 404, { success: false, message: "User not found." });
            return;
        }

        const thread = await getOrCreateChatThreadForUser(pool, user);
        if (!thread) {
            sendJson(res, 500, { success: false, message: "Unable to open chat thread." });
            return;
        }

        const messages = await listChatMessagesForThread(pool, thread.id, {
            afterId: parsedUrl.searchParams.get("afterId"),
            limit: parsedUrl.searchParams.get("limit")
        });

        sendJson(res, 200, {
            success: true,
            user: toChatUserPayload(user),
            thread: thread,
            messages: messages
        });
    } catch (error) {
        sendJson(res, 500, { success: false, message: error.message || "Unable to load admin chat thread." });
    }
}

async function handleAdminChatTakeover(req, res, userId) {
    try {
        const authSession = requireAuthSession(req, res, { role: "admin" });
        if (!authSession) {
            return;
        }

        const pool = await getDbPool();
        const user = await resolveAdminChatUser(pool, userId);
        if (!user) {
            sendJson(res, 404, { success: false, message: "User not found." });
            return;
        }

        const thread = await getOrCreateChatThreadForUser(pool, user);
        if (!thread) {
            sendJson(res, 500, { success: false, message: "Unable to open chat thread." });
            return;
        }

        const updatedThread = await setChatThreadMode(pool, thread.id, CHAT_THREAD_MODE_ADMIN, authSession);
        await insertChatMessage(pool, thread.id, "system", "Admin connected. Chatbot replies are paused.", {
            senderLabel: "System"
        });

        sendJson(res, 200, {
            success: true,
            message: "Admin takeover enabled.",
            user: toChatUserPayload(user),
            thread: updatedThread || thread
        });
    } catch (error) {
        sendJson(res, 500, { success: false, message: error.message || "Unable to enable admin takeover." });
    }
}

async function handleAdminChatRelease(req, res, userId) {
    try {
        const authSession = requireAuthSession(req, res, { role: "admin" });
        if (!authSession) {
            return;
        }

        const pool = await getDbPool();
        const user = await resolveAdminChatUser(pool, userId);
        if (!user) {
            sendJson(res, 404, { success: false, message: "User not found." });
            return;
        }

        const thread = await getOrCreateChatThreadForUser(pool, user);
        if (!thread) {
            sendJson(res, 500, { success: false, message: "Unable to open chat thread." });
            return;
        }

        const updatedThread = await setChatThreadMode(pool, thread.id, CHAT_THREAD_MODE_BOT, authSession);
        await insertChatMessage(pool, thread.id, "system", "Admin ended the takeover. Chatbot replies are active again.", {
            senderLabel: "System"
        });

        sendJson(res, 200, {
            success: true,
            message: "Chatbot mode restored.",
            user: toChatUserPayload(user),
            thread: updatedThread || thread
        });
    } catch (error) {
        sendJson(res, 500, { success: false, message: error.message || "Unable to release chat takeover." });
    }
}

async function handleAdminChatSendMessage(req, res, userId) {
    try {
        const authSession = requireAuthSession(req, res, { role: "admin" });
        if (!authSession) {
            return;
        }

        const body = await readBody(req);
        const messageText = normalizeChatMessageText(body.message || body.text || body.messageText);
        if (!messageText) {
            sendJson(res, 400, { success: false, message: "Message text is required." });
            return;
        }

        const pool = await getDbPool();
        const user = await resolveAdminChatUser(pool, userId);
        if (!user) {
            sendJson(res, 404, { success: false, message: "User not found." });
            return;
        }

        const thread = await getOrCreateChatThreadForUser(pool, user);
        if (!thread) {
            sendJson(res, 500, { success: false, message: "Unable to open chat thread." });
            return;
        }

        const updatedThread = await setChatThreadMode(pool, thread.id, CHAT_THREAD_MODE_ADMIN, authSession);
        const message = await insertChatMessage(pool, thread.id, "admin", messageText, {
            senderLabel: normalizeText(authSession.name || authSession.email || "Admin"),
            clientMessageId: normalizeChatClientMessageId(body.clientMessageId || body.client_message_id)
        });

        sendJson(res, 200, {
            success: true,
            user: toChatUserPayload(user),
            thread: updatedThread || thread,
            message: message
        });
    } catch (error) {
        sendJson(res, 500, { success: false, message: error.message || "Unable to send admin chat message." });
    }
}

async function handleAdminSettingsGet(req, res) {
    try {
        const authSession = requireAuthSession(req, res, { role: "admin" });
        if (!authSession) {
            return;
        }

        const adminCredentials = getAdminCredentials();
        if (!adminCredentials) {
            sendJson(res, 503, {
                success: false,
                message: "Admin credentials are not initialized. Set ADMIN_LOGIN_ID and ADMIN_PASSWORD first."
            });
            return;
        }
        sendJson(res, 200, {
            success: true,
            settings: {
                loginId: adminCredentials.loginId,
                updatedAt: adminCredentials.updatedAt
            }
        });
    } catch (error) {
        sendJson(res, 500, { success: false, message: error.message || "Unable to load admin settings." });
    }
}

async function handleAdminSettingsUpdateLoginId(req, res) {
    try {
        const authSession = requireAuthSession(req, res, { role: "admin" });
        if (!authSession) {
            return;
        }

        const body = await readBody(req);
        const currentPassword = String(body.currentPassword || "");
        const nextLoginId = normalizeAdminLoginId(
            body.newLoginId || body.loginId || body.username || body.email
        );

        if (!currentPassword) {
            sendJson(res, 400, { success: false, message: "Current password is required." });
            return;
        }
        if (!isValidAdminLoginId(nextLoginId)) {
            sendJson(res, 400, {
                success: false,
                message: "Username/email must be 3-190 chars using letters, numbers, dot, underscore, plus, hyphen, or @."
            });
            return;
        }

        const adminCredentials = getAdminCredentials();
        if (!adminCredentials) {
            sendJson(res, 503, {
                success: false,
                message: "Admin credentials are not initialized. Set ADMIN_LOGIN_ID and ADMIN_PASSWORD first."
            });
            return;
        }
        if (!verifyPassword(currentPassword, adminCredentials.passwordHash)) {
            sendJson(res, 401, { success: false, message: "Current password is incorrect." });
            return;
        }

        const updatedCredentials = saveAdminCredentials({ loginId: nextLoginId });
        authSession.email = updatedCredentials.loginId;
        authSessions.set(authSession.token, authSession);

        const isChanged = updatedCredentials.loginId !== adminCredentials.loginId;
        sendJson(res, 200, {
            success: true,
            message: isChanged ? "Admin login updated successfully." : "Admin login is already up to date.",
            settings: {
                loginId: updatedCredentials.loginId,
                updatedAt: updatedCredentials.updatedAt
            }
        });
    } catch (error) {
        sendJson(res, 500, { success: false, message: error.message || "Unable to update admin login." });
    }
}

async function handleAdminSettingsUpdatePassword(req, res) {
    try {
        const authSession = requireAuthSession(req, res, { role: "admin" });
        if (!authSession) {
            return;
        }

        const body = await readBody(req);
        const currentPassword = String(body.currentPassword || "");
        const newPassword = String(body.newPassword || "");

        if (!currentPassword) {
            sendJson(res, 400, { success: false, message: "Current password is required." });
            return;
        }
        if (!isStrongPassword(newPassword)) {
            sendJson(res, 400, {
                success: false,
                message: "Password must be 8+ chars with upper, lower, number, and symbol."
            });
            return;
        }

        const adminCredentials = getAdminCredentials();
        if (!adminCredentials) {
            sendJson(res, 503, {
                success: false,
                message: "Admin credentials are not initialized. Set ADMIN_LOGIN_ID and ADMIN_PASSWORD first."
            });
            return;
        }
        if (!verifyPassword(currentPassword, adminCredentials.passwordHash)) {
            sendJson(res, 401, { success: false, message: "Current password is incorrect." });
            return;
        }
        if (verifyPassword(newPassword, adminCredentials.passwordHash)) {
            sendJson(res, 400, { success: false, message: "New password must be different from current password." });
            return;
        }

        saveAdminCredentials({
            passwordHash: hashPassword(newPassword)
        });

        sendJson(res, 200, { success: true, message: "Admin password updated successfully." });
    } catch (error) {
        sendJson(res, 500, { success: false, message: error.message || "Unable to update admin password." });
    }
}

async function handleProfileSettingsGet(_req, res, parsedUrl) {
    try {
        const authSession = requireAuthSession(_req, res);
        if (!authSession) {
            return;
        }

        const sessionEmail = normalizeEmail(authSession.email);
        const requestedEmail = normalizeEmail(parsedUrl.searchParams.get("email"));
        const email = isValidEmail(requestedEmail) ? requestedEmail : sessionEmail;
        if (!isValidEmail(email)) {
            sendJson(res, 400, { success: false, message: "A valid email query parameter is required." });
            return;
        }
        if (!canAccessEmail(authSession, email)) {
            sendJson(res, 403, { success: false, message: "You can only access your own profile." });
            return;
        }

        const pool = await getDbPool();
        const [rows] = await pool.execute(
            `SELECT full_name, email, phone, address, avatar_data_url
             FROM users
             WHERE email = ?
             LIMIT 1`,
            [email]
        );

        if (!Array.isArray(rows) || rows.length < 1) {
            sendJson(res, 404, { success: false, message: "Profile not found." });
            return;
        }

        const profile = rows[0];
        sendJson(res, 200, {
            success: true,
            profile: {
                fullName: String(profile.full_name || ""),
                email: String(profile.email || ""),
                phone: String(profile.phone || ""),
                address: String(profile.address || ""),
                avatar: String(profile.avatar_data_url || "")
            }
        });
    } catch (error) {
        sendJson(res, 500, { success: false, message: error.message || "Unable to load profile." });
    }
}

async function handleProfileSettingsSave(req, res) {
    try {
        const authSession = requireAuthSession(req, res);
        if (!authSession) {
            return;
        }

        const body = await readBody(req);

        const fullName = normalizeText(body.fullName);
        const email = normalizeEmail(body.email);
        const phone = normalizeMobile(body.phone);
        const address = normalizeText(body.address);
        const avatar = typeof body.avatar === "string" ? body.avatar.trim() : "";
        const currentEmail = normalizeEmail(body.currentEmail);
        const lookupEmail = isValidEmail(currentEmail) ? currentEmail : email;
        const sessionEmail = normalizeEmail(authSession.email);

        if (fullName.length < 2) {
            sendJson(res, 400, { success: false, message: "Full name is required." });
            return;
        }
        if (!isValidEmail(email)) {
            sendJson(res, 400, { success: false, message: "Please enter a valid email address." });
            return;
        }
        if (!isValidMobile(phone)) {
            sendJson(res, 400, { success: false, message: "Use 09XXXXXXXXX or +639XXXXXXXXX." });
            return;
        }
        if (address.length < 5) {
            sendJson(res, 400, { success: false, message: "Please enter a complete address." });
            return;
        }
        if (!isValidEmail(lookupEmail)) {
            sendJson(res, 400, { success: false, message: "Missing current account email." });
            return;
        }
        if (authSession.role !== "admin" && lookupEmail !== sessionEmail) {
            sendJson(res, 403, { success: false, message: "You can only edit your own profile." });
            return;
        }

        const pool = await getDbPool();
        const [result] = await pool.execute(
            `UPDATE users
             SET full_name = ?,
                 email = ?,
                 phone = ?,
                 address = ?,
                 avatar_data_url = ?,
                 updated_at = NOW()
             WHERE email = ?
             LIMIT 1`,
            [fullName, email, phone, address, avatar || null, lookupEmail]
        );

        if (!result || Number(result.affectedRows || 0) < 1) {
            sendJson(res, 404, { success: false, message: "Account not found." });
            return;
        }

        const [rows] = await pool.execute(
            `SELECT full_name, email, phone, address, avatar_data_url
             FROM users
             WHERE email = ?
             LIMIT 1`,
            [email]
        );
        const profile = Array.isArray(rows) && rows.length ? rows[0] : null;

        if (authSession.role !== "admin") {
            authSession.email = email;
            authSessions.set(authSession.token, authSession);
        }

        sendJson(res, 200, {
            success: true,
            profile: {
                fullName: String((profile && profile.full_name) || fullName),
                email: String((profile && profile.email) || email),
                phone: String((profile && profile.phone) || phone),
                address: String((profile && profile.address) || address),
                avatar: String((profile && profile.avatar_data_url) || avatar || "")
            }
        });
    } catch (error) {
        if (error && error.code === "ER_DUP_ENTRY") {
            const duplicateField = getDuplicateField(error.message);
            const message = duplicateField === "phone"
                ? "This mobile number is already in use."
                : "An account with this email already exists.";
            sendJson(res, 409, { success: false, message: message });
            return;
        }
        sendJson(res, 500, { success: false, message: error.message || "Unable to save profile." });
    }
}

async function handleProfilePasswordChange(req, res) {
    try {
        const authSession = requireAuthSession(req, res);
        if (!authSession) {
            return;
        }

        const body = await readBody(req);
        const requestedEmail = normalizeEmail(body.email);
        const sessionEmail = normalizeEmail(authSession.email);
        const email = isValidEmail(requestedEmail) ? requestedEmail : sessionEmail;
        const currentPassword = String(body.currentPassword || "");
        const newPassword = String(body.newPassword || "");

        if (!isValidEmail(email)) {
            sendJson(res, 400, { success: false, message: "Please enter a valid email address." });
            return;
        }
        if (authSession.role !== "admin" && email !== sessionEmail) {
            sendJson(res, 403, { success: false, message: "You can only change your own password." });
            return;
        }
        if (!currentPassword) {
            sendJson(res, 400, { success: false, message: "Current password is required." });
            return;
        }
        if (!isStrongPassword(newPassword)) {
            sendJson(res, 400, {
                success: false,
                message: "Password must be 8+ chars with upper, lower, number, and symbol."
            });
            return;
        }

        const pool = await getDbPool();
        const [rows] = await pool.execute(
            `SELECT id, password_hash
             FROM users
             WHERE email = ?
             LIMIT 1`,
            [email]
        );

        const user = Array.isArray(rows) && rows.length ? rows[0] : null;
        if (!user) {
            sendJson(res, 404, { success: false, message: "Account not found." });
            return;
        }

        if (!verifyPassword(currentPassword, user.password_hash)) {
            sendJson(res, 401, { success: false, message: "Current password is incorrect." });
            return;
        }

        const passwordHash = hashPassword(newPassword);
        await pool.execute(
            "UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?",
            [passwordHash, user.id]
        );

        sendJson(res, 200, { success: true, message: "Password updated successfully." });
    } catch (error) {
        sendJson(res, 500, { success: false, message: error.message || "Unable to update password." });
    }
}

async function prepareBookingForInsert(bodyInput, options) {
    const body = bodyInput && typeof bodyInput === "object" ? bodyInput : {};
    const opts = options && typeof options === "object" ? options : {};
    const db = opts.db && typeof opts.db.execute === "function"
        ? opts.db
        : await getDbPool();
    const authSession = opts.authSession && typeof opts.authSession === "object"
        ? opts.authSession
        : null;
    const sessionEmail = authSession ? normalizeEmail(authSession.email) : "";
    const isAdminRequest = Boolean(opts.asAdmin) || Boolean(authSession && authSession.role === "admin");

    const forcedOrderId = normalizeOrderId(opts.orderId, false);
    const orderId = forcedOrderId || (
        isAdminRequest
            ? normalizeOrderId(body.orderId)
            : generateOrderId()
    );
    if (!orderId) {
        throw createHttpError(400, "Invalid booking order id.");
    }

    const ownerEmail = normalizeEmail(opts.ownerEmail || "");
    let email = normalizeEmail(ownerEmail || body.email || body.userEmail);
    let userEmail = normalizeEmail(ownerEmail || body.userEmail || body.email);
    const fullName = normalizeText(body.fullName || body.name);
    const phone = normalizeMobile(body.phone);
    const model = normalizeText(body.model || body.productName || body.itemName || "Ecodrive E-Bike");
    const bikeColor = normalizeText(body.bikeColor || body.color || body.selectedColor || body.bike_color).slice(0, 64);
    const bikeImage = normalizeText(body.bikeImage || body.image || body.img);
    const serviceType = normalizeServiceType(body.service);
    const forcedPaymentMethod = normalizeWalletPaymentMethod(opts.paymentMethod || "");
    const paymentMethod = (
        forcedPaymentMethod
            ? forcedPaymentMethod
            : normalizeText(body.payment || "CASH ON DELIVERY")
    ).slice(0, 80);
    const normalizedPaymentMethod = String(paymentMethod || "").trim().toUpperCase();
    if (normalizedPaymentMethod === "GCASH" || normalizedPaymentMethod === "MAYA" || normalizedPaymentMethod === "PAYMAYA") {
        throw createHttpError(400, "GCash and Maya payments are no longer available. Please use Cash on Delivery or Installment.");
    }
    const scheduleDateInput = body.scheduleDate || body.bookingDate || body.date;
    const scheduleTimeInput = body.scheduleTime || body.bookingTime || body.time;
    const scheduleDate = normalizeScheduleDate(scheduleDateInput);
    const scheduleTime = normalizeScheduleTime(scheduleTimeInput);
    let status = normalizeOrderStatus(body.status, serviceType);
    let fulfillmentStatus = normalizeFulfillmentStatus(body.fulfillmentStatus, serviceType);
    let trackingEta = normalizeText(body.trackingEta || body.eta).slice(0, 80);
    let trackingLocation = normalizeText(
        body.trackingLocation
        || body.locationNote
        || body.location
    ).slice(0, 120);
    let receiptNumber = normalizeText(body.receiptNumber).slice(0, 40);
    let receiptIssuedAt = null;
    let paymentStatus = normalizePaymentStatus(
        body.paymentStatus,
        getDefaultPaymentStatus(paymentMethod, serviceType)
    );
    const shippingAddress = normalizeText(body.shippingAddress).slice(0, 255);
    const shippingMapEmbedUrl = String(body.shippingMapEmbedUrl || "").trim().slice(0, 3000);
    const shippingCoordinates = body.shippingCoordinates && typeof body.shippingCoordinates === "object"
        ? body.shippingCoordinates
        : null;
    const shippingLat = normalizeOptionalNumber(shippingCoordinates && shippingCoordinates.lat);
    const shippingLng = normalizeOptionalNumber(shippingCoordinates && shippingCoordinates.lng);
    const subtotal = parseAmount(body.subtotal);
    const shippingFee = parseAmount(body.shippingFee);
    const total = parseAmount(body.total || (subtotal + shippingFee));
    let installmentPayload = null;
    if (body.installment && typeof body.installment === "object") {
        installmentPayload = JSON.stringify(body.installment);
    }

    const forceCustomerDefaults = opts.forceCustomerDefaults !== false
        && (!isAdminRequest || Boolean(opts.forceCustomerDefaults));
    if (forceCustomerDefaults) {
        if (sessionEmail) {
            if ((isValidEmail(email) && email !== sessionEmail) || (isValidEmail(userEmail) && userEmail !== sessionEmail)) {
                throw createHttpError(403, "You can only create bookings for your own account.");
            }
            email = sessionEmail;
            userEmail = sessionEmail;
        } else if (ownerEmail) {
            email = ownerEmail;
            userEmail = ownerEmail;
        }
        status = normalizeOrderStatus("", serviceType);
        fulfillmentStatus = normalizeFulfillmentStatus("", serviceType);
        trackingEta = "";
        trackingLocation = "";
        receiptNumber = "";
        receiptIssuedAt = null;
        paymentStatus = getDefaultPaymentStatus(paymentMethod, serviceType);
    }

    const forcedPaymentStatus = String(opts.paymentStatus || "").trim().toLowerCase();
    if (forcedPaymentStatus) {
        paymentStatus = normalizePaymentStatus(forcedPaymentStatus, paymentStatus);
    }

    const reviewDecision = getReviewDecisionFromStatus(status, fulfillmentStatus);
    const reviewedAt = reviewDecision === "none" ? null : new Date();
    if (reviewDecision === "approved") {
        if (!receiptNumber) {
            receiptNumber = buildReceiptNumber(orderId, reviewedAt || new Date());
        }
        receiptIssuedAt = reviewedAt || new Date();
    }

    if (!isValidEmail(email)) {
        throw createHttpError(400, "A valid email is required for booking.");
    }
    if (!fullName || fullName.length < 2) {
        throw createHttpError(400, "Customer full name is required.");
    }
    if (!isValidMobile(phone)) {
        throw createHttpError(400, "Use 09XXXXXXXXX or +639XXXXXXXXX.");
    }
    if ((scheduleDateInput || scheduleTimeInput) && (!scheduleDate || !scheduleTime)) {
        throw createHttpError(400, "Provide a valid schedule date and time.");
    }

    if (!opts.skipScheduleCapacity && scheduleDate) {
        const activeBookingsForDate = await countActiveBookingsByScheduleDate(db, scheduleDate, orderId);
        if (hasReachedDailyBookingLimit(activeBookingsForDate)) {
            throw createHttpError(
                409,
                `Maximum booking limit reached for ${scheduleDate}. Please choose another date.`,
                {
                    code: "MAX_BOOKINGS_REACHED",
                    date: scheduleDate,
                    maxBookingsPerDay: MAX_BOOKINGS_PER_DAY,
                    currentBookings: activeBookingsForDate
                }
            );
        }
    }

    let userId = null;
    const [userRows] = await db.execute(
        "SELECT id FROM users WHERE email = ? LIMIT 1",
        [email]
    );
    if (Array.isArray(userRows) && userRows.length > 0) {
        userId = Number(userRows[0].id || 0) || null;
    }

    return {
        orderId: orderId,
        userId: userId,
        fullName: fullName,
        email: email,
        phone: phone,
        model: model,
        bikeColor: bikeColor || null,
        bikeImage: bikeImage || null,
        subtotal: subtotal,
        shippingFee: shippingFee,
        total: total,
        paymentMethod: paymentMethod,
        paymentStatus: paymentStatus,
        serviceType: serviceType,
        scheduleDate: scheduleDate,
        scheduleTime: scheduleTime,
        status: status,
        fulfillmentStatus: fulfillmentStatus,
        trackingEta: trackingEta || null,
        trackingLocation: trackingLocation || null,
        receiptNumber: receiptNumber || null,
        receiptIssuedAt: receiptIssuedAt,
        shippingAddress: shippingAddress || null,
        shippingLat: shippingLat,
        shippingLng: shippingLng,
        shippingMapEmbedUrl: shippingMapEmbedUrl || null,
        userEmail: userEmail || null,
        installmentPayload: installmentPayload,
        reviewDecision: reviewDecision,
        reviewedAt: reviewedAt
    };
}

async function insertPreparedBooking(db, preparedInput) {
    const prepared = preparedInput && typeof preparedInput === "object" ? preparedInput : {};
    const orderId = normalizeOrderId(prepared.orderId, false);
    if (!orderId) {
        throw createHttpError(500, "Unable to resolve booking order id.");
    }

    await db.execute(
        `INSERT INTO bookings (
            order_id,
            user_id,
            full_name,
            email,
            phone,
            model,
            bike_color,
            bike_image,
            subtotal,
            shipping_fee,
            total,
            payment_method,
            payment_status,
            service_type,
            schedule_date,
            schedule_time,
            status,
            fulfillment_status,
            tracking_eta,
            tracking_location,
            receipt_number,
            receipt_issued_at,
            shipping_address,
            shipping_lat,
            shipping_lng,
            shipping_map_embed_url,
            user_email,
            installment_payload,
            review_decision,
            reviewed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            orderId,
            prepared.userId || null,
            prepared.fullName || "",
            prepared.email || "",
            prepared.phone || "",
            prepared.model || "Ecodrive E-Bike",
            prepared.bikeColor || null,
            prepared.bikeImage || null,
            parseAmount(prepared.subtotal),
            parseAmount(prepared.shippingFee),
            parseAmount(prepared.total),
            prepared.paymentMethod || "CASH ON DELIVERY",
            normalizePaymentStatus(prepared.paymentStatus, "awaiting_payment_confirmation"),
            prepared.serviceType || "Delivery",
            prepared.scheduleDate || null,
            prepared.scheduleTime || null,
            prepared.status || "Pending review",
            prepared.fulfillmentStatus || "In Process",
            prepared.trackingEta || null,
            prepared.trackingLocation || null,
            prepared.receiptNumber || null,
            prepared.receiptIssuedAt || null,
            prepared.shippingAddress || null,
            prepared.shippingLat,
            prepared.shippingLng,
            prepared.shippingMapEmbedUrl || null,
            prepared.userEmail || null,
            prepared.installmentPayload || null,
            prepared.reviewDecision || "none",
            prepared.reviewedAt || null
        ]
    );

    const [rows] = await db.execute(
        `SELECT *
         FROM bookings
         WHERE order_id = ?
         LIMIT 1`,
        [orderId]
    );
    return Array.isArray(rows) && rows.length ? mapBookingRow(rows[0]) : null;
}

async function createBookingFromDraft(bodyInput, options) {
    const opts = options && typeof options === "object" ? options : {};
    const db = opts.db && typeof opts.db.execute === "function"
        ? opts.db
        : await getDbPool();
    const prepared = await prepareBookingForInsert(bodyInput, Object.assign({}, opts, { db: db }));
    return insertPreparedBooking(db, prepared);
}

async function handleCreateBooking(req, res) {
    try {
        const authSession = requireAuthSession(req, res);
        if (!authSession) {
            return;
        }

        const body = await readBody(req);
        const booking = await createBookingFromDraft(body, {
            authSession: authSession,
            forceCustomerDefaults: authSession.role !== "admin"
        });
        sendJson(res, 201, { success: true, booking: booking });
    } catch (error) {
        if (error && error.code === "ER_DUP_ENTRY") {
            sendJson(res, 409, {
                success: false,
                message: "Duplicate booking reference detected. Please submit the booking again."
            });
            return;
        }
        if (error && Number(error.statusCode) >= 400 && Number(error.statusCode) < 600) {
            const details = error.details && typeof error.details === "object" ? error.details : {};
            sendJson(
                res,
                Number(error.statusCode),
                Object.assign({ success: false, message: error.message || "Unable to save booking." }, details)
            );
            return;
        }
        sendJson(res, 500, { success: false, message: error.message || "Unable to save booking." });
    }
}

async function handleBookingDateAvailability(req, res, parsedUrl) {
    try {
        const authSession = requireAuthSession(req, res);
        if (!authSession) {
            return;
        }

        const dateInput = parsedUrl.searchParams.get("date") || parsedUrl.searchParams.get("scheduleDate");
        const scheduleDate = normalizeScheduleDate(dateInput);
        if (!scheduleDate) {
            sendJson(res, 400, { success: false, message: "A valid date query parameter is required." });
            return;
        }

        const pool = await getDbPool();
        const currentBookings = await countActiveBookingsByScheduleDate(pool, scheduleDate, "");
        const available = !hasReachedDailyBookingLimit(currentBookings);

        sendJson(res, 200, {
            success: true,
            date: scheduleDate,
            maxBookingsPerDay: MAX_BOOKINGS_PER_DAY,
            currentBookings: currentBookings,
            available: available,
            message: available
                ? ""
                : `Maximum booking limit reached for ${scheduleDate}. Please choose another date.`
        });
    } catch (error) {
        sendJson(res, 500, { success: false, message: error.message || "Unable to check booking availability." });
    }
}

async function handleListBookings(_req, res, parsedUrl) {
    try {
        const authSession = requireAuthSession(_req, res);
        if (!authSession) {
            return;
        }

        const sessionEmail = normalizeEmail(authSession.email);
        const requestedEmail = normalizeEmail(parsedUrl.searchParams.get("email"));
        const email = isValidEmail(requestedEmail) ? requestedEmail : sessionEmail;
        if (!isValidEmail(email)) {
            sendJson(res, 400, { success: false, message: "A valid email query parameter is required." });
            return;
        }
        if (!canAccessEmail(authSession, email)) {
            sendJson(res, 403, { success: false, message: "You can only access your own bookings." });
            return;
        }

        const pool = await getDbPool();
        const [rows] = await pool.execute(
            `SELECT *
             FROM bookings
             WHERE email = ? OR user_email = ?
             ORDER BY created_at DESC`,
            [email, email]
        );

        const bookings = Array.isArray(rows) ? rows.map(mapBookingRow) : [];
        sendJson(res, 200, { success: true, bookings: bookings });
    } catch (error) {
        sendJson(res, 500, { success: false, message: error.message || "Unable to load bookings." });
    }
}

async function handleCancelBooking(req, res, orderId) {
    try {
        const authSession = requireAuthSession(req, res);
        if (!authSession) {
            return;
        }

        const body = await readBody(req);
        let email = normalizeEmail(body.email || body.userEmail);
        const sessionEmail = normalizeEmail(authSession.email);
        if (authSession.role !== "admin") {
            email = sessionEmail;
        }
        const normalizedOrderId = normalizeOrderId(orderId, false);
        if (!normalizedOrderId) {
            sendJson(res, 400, { success: false, message: "Invalid booking order id." });
            return;
        }
        const pool = await getDbPool();

        let result = null;
        if (isValidEmail(email)) {
            [result] = await pool.execute(
                `UPDATE bookings
                 SET status = 'Cancelled',
                     fulfillment_status = 'Cancelled',
                     review_decision = 'rejected',
                     reviewed_at = NOW(),
                     updated_at = NOW()
                 WHERE order_id = ?
                   AND (email = ? OR user_email = ?)`,
                [normalizedOrderId, email, email]
            );
        } else {
            if (authSession.role !== "admin") {
                sendJson(res, 400, { success: false, message: "A valid account email is required." });
                return;
            }
            [result] = await pool.execute(
                `UPDATE bookings
                 SET status = 'Cancelled',
                     fulfillment_status = 'Cancelled',
                     review_decision = 'rejected',
                     reviewed_at = NOW(),
                     updated_at = NOW()
                 WHERE order_id = ?`,
                [normalizedOrderId]
            );
        }

        if (!result || Number(result.affectedRows || 0) < 1) {
            sendJson(res, 404, { success: false, message: "Booking not found." });
            return;
        }

        sendJson(res, 200, { success: true, message: "Booking cancelled successfully." });
    } catch (error) {
        sendJson(res, 500, { success: false, message: error.message || "Unable to cancel booking." });
    }
}

async function handleAdminBookings(_req, res, parsedUrl) {
    try {
        const authSession = requireAuthSession(_req, res, { role: "admin" });
        if (!authSession) {
            return;
        }

        const scope = normalizeText(parsedUrl.searchParams.get("scope")).toLowerCase();
        const pool = await getDbPool();

        const query = scope === "all"
            ? `SELECT * FROM bookings ORDER BY created_at DESC`
            : `SELECT *
               FROM bookings
               WHERE review_decision = 'none'
                 AND LOWER(status) NOT LIKE '%cancel%'
                 AND LOWER(fulfillment_status) NOT LIKE '%cancel%'
                 AND LOWER(status) NOT LIKE '%reject%'
               ORDER BY created_at DESC`;

        const [rows] = await pool.execute(query);
        const bookings = Array.isArray(rows) ? rows.map(mapBookingRow) : [];
        sendJson(res, 200, { success: true, bookings: bookings });
    } catch (error) {
        sendJson(res, 500, { success: false, message: error.message || "Unable to load booking requests." });
    }
}

async function handleAdminBookingDetails(_req, res, orderId) {
    try {
        const authSession = requireAuthSession(_req, res, { role: "admin" });
        if (!authSession) {
            return;
        }

        const normalizedOrderId = normalizeOrderId(orderId, false);
        if (!normalizedOrderId) {
            sendJson(res, 400, { success: false, message: "Invalid booking order id." });
            return;
        }
        const pool = await getDbPool();
        const [rows] = await pool.execute(
            `SELECT *
             FROM bookings
             WHERE order_id = ?
             LIMIT 1`,
            [normalizedOrderId]
        );
        if (!Array.isArray(rows) || rows.length < 1) {
            sendJson(res, 404, { success: false, message: "Booking not found." });
            return;
        }

        sendJson(res, 200, { success: true, booking: mapBookingRow(rows[0]) });
    } catch (error) {
        sendJson(res, 500, { success: false, message: error.message || "Unable to load booking details." });
    }
}

async function handleAdminBookingDecision(_req, res, orderId, action) {
    try {
        const authSession = requireAuthSession(_req, res, { role: "admin" });
        if (!authSession) {
            return;
        }

        const normalizedOrderId = normalizeOrderId(orderId, false);
        if (!normalizedOrderId) {
            sendJson(res, 400, { success: false, message: "Invalid booking order id." });
            return;
        }
        const normalizedAction = String(action || "").toLowerCase() === "approve" ? "approve" : "reject";
        const pool = await getDbPool();
        const [beforeRows] = await pool.execute(
            `SELECT *
             FROM bookings
             WHERE order_id = ?
             LIMIT 1`,
            [normalizedOrderId]
        );
        if (!Array.isArray(beforeRows) || beforeRows.length < 1) {
            sendJson(res, 404, { success: false, message: "Booking not found." });
            return;
        }
        const beforeRow = beforeRows[0];
        const beforeMergedStatus = `${String(beforeRow.status || "")} ${String(beforeRow.fulfillment_status || "")}`.toLowerCase();
        const wasAlreadyRejected = String(beforeRow.review_decision || "").toLowerCase() === "rejected"
            || beforeMergedStatus.includes("reject")
            || beforeMergedStatus.includes("cancel");
        const existingReceiptNumber = normalizeText(beforeRow.receipt_number).slice(0, 40);
        const ensuredReceiptNumber = existingReceiptNumber || buildReceiptNumber(normalizedOrderId, new Date());

        if (normalizedAction === "approve") {
            await pool.execute(
                `UPDATE bookings
                 SET status = 'Approved',
                     fulfillment_status = CASE
                        WHEN fulfillment_status IS NULL
                            OR fulfillment_status = ''
                            OR LOWER(fulfillment_status) IN ('pending review', 'under review', 'in process')
                            THEN CASE
                                WHEN LOWER(service_type) LIKE '%pick%'
                                    THEN 'Preparing for Pick up'
                                WHEN LOWER(service_type) LIKE '%install%'
                                    THEN 'Application Approved'
                                ELSE 'Preparing for Dispatch'
                            END
                        ELSE fulfillment_status
                     END,
                     receipt_number = CASE
                        WHEN receipt_number IS NULL OR receipt_number = ''
                            THEN ?
                        ELSE receipt_number
                     END,
                     receipt_issued_at = COALESCE(receipt_issued_at, NOW()),
                     review_decision = 'approved',
                     reviewed_at = NOW(),
                     updated_at = NOW()
                 WHERE order_id = ?`,
                [ensuredReceiptNumber, normalizedOrderId]
            );
        } else {
            await pool.execute(
                `UPDATE bookings
                 SET status = 'Rejected',
                     fulfillment_status = 'Rejected',
                     review_decision = 'rejected',
                     reviewed_at = NOW(),
                     updated_at = NOW()
                 WHERE order_id = ?`,
                [normalizedOrderId]
            );
        }

        const [rows] = await pool.execute(
            `SELECT *
             FROM bookings
             WHERE order_id = ?
             LIMIT 1`,
            [normalizedOrderId]
        );
        if (!Array.isArray(rows) || rows.length < 1) {
            sendJson(res, 404, { success: false, message: "Booking not found." });
            return;
        }

        const booking = mapBookingRow(rows[0]);
        if (normalizedAction === "reject" && !wasAlreadyRejected) {
            const notifyResult = await sendBookingRejectedEmail(booking);
            if (!notifyResult.sent) {
                console.warn(
                    "[booking-reject-email] Unable to notify customer:",
                    notifyResult.reason || "Unknown reason",
                    "| orderId:",
                    normalizedOrderId
                );
            }
        }

        sendJson(res, 200, { success: true, booking: booking });
    } catch (error) {
        sendJson(res, 500, { success: false, message: error.message || "Unable to update booking status." });
    }
}

async function handleAdminBookingPaymentStatus(_req, res, orderId) {
    try {
        const authSession = requireAuthSession(_req, res, { role: "admin" });
        if (!authSession) {
            return;
        }

        const normalizedOrderId = normalizeOrderId(orderId, false);
        if (!normalizedOrderId) {
            sendJson(res, 400, { success: false, message: "Invalid booking order id." });
            return;
        }

        const body = await readBody(_req);
        const requestedStatus = String(body.paymentStatus || body.status || "").trim().toLowerCase();
        if (!ALLOWED_PAYMENT_STATUSES.has(requestedStatus)) {
            sendJson(res, 400, {
                success: false,
                message: `paymentStatus must be one of: ${Array.from(ALLOWED_PAYMENT_STATUSES).join(", ")}`
            });
            return;
        }

        const pool = await getDbPool();
        const [updateResult] = await pool.execute(
            `UPDATE bookings
             SET payment_status = ?,
                 updated_at = NOW()
             WHERE order_id = ?`,
            [requestedStatus, normalizedOrderId]
        );
        if (!updateResult || Number(updateResult.affectedRows || 0) < 1) {
            sendJson(res, 404, { success: false, message: "Booking not found." });
            return;
        }

        const [rows] = await pool.execute(
            `SELECT *
             FROM bookings
             WHERE order_id = ?
             LIMIT 1`,
            [normalizedOrderId]
        );
        if (!Array.isArray(rows) || rows.length < 1) {
            sendJson(res, 404, { success: false, message: "Booking not found." });
            return;
        }

        sendJson(res, 200, { success: true, booking: mapBookingRow(rows[0]) });
    } catch (error) {
        sendJson(res, 500, { success: false, message: error.message || "Unable to update payment status." });
    }
}

async function handleAdminBookingFulfillmentStatus(_req, res, orderId) {
    try {
        const authSession = requireAuthSession(_req, res, { role: "admin" });
        if (!authSession) {
            return;
        }

        const normalizedOrderId = normalizeOrderId(orderId, false);
        if (!normalizedOrderId) {
            sendJson(res, 400, { success: false, message: "Invalid booking order id." });
            return;
        }

        const body = await readBody(_req);
        const requestedFulfillmentStatus = normalizeText(body.fulfillmentStatus).slice(0, 80);
        const requestedTrackingEta = normalizeText(body.trackingEta || body.eta).slice(0, 80);
        const requestedTrackingLocation = normalizeText(
            body.trackingLocation
            || body.locationNote
            || body.location
        ).slice(0, 120);
        if (!requestedFulfillmentStatus) {
            sendJson(res, 400, { success: false, message: "fulfillmentStatus is required." });
            return;
        }

        const pool = await getDbPool();
        const [beforeRows] = await pool.execute(
            `SELECT *
             FROM bookings
             WHERE order_id = ?
             LIMIT 1`,
            [normalizedOrderId]
        );
        if (!Array.isArray(beforeRows) || beforeRows.length < 1) {
            sendJson(res, 404, { success: false, message: "Booking not found." });
            return;
        }

        const beforeRow = beforeRows[0];
        const reviewDecision = String(beforeRow.review_decision || "").trim().toLowerCase();
        const mergedBeforeStatus = `${String(beforeRow.status || "")} ${String(beforeRow.fulfillment_status || "")}`.toLowerCase();
        const isRejectedOrCancelled = reviewDecision === "rejected"
            || mergedBeforeStatus.includes("reject")
            || mergedBeforeStatus.includes("cancel");
        if (isRejectedOrCancelled) {
            sendJson(res, 409, { success: false, message: "Rejected or cancelled bookings cannot be updated." });
            return;
        }

        const isApprovedBooking = reviewDecision === "approved"
            || mergedBeforeStatus.includes("approve")
            || mergedBeforeStatus.includes("deliver")
            || mergedBeforeStatus.includes("complete")
            || mergedBeforeStatus.includes("picked up")
            || mergedBeforeStatus.includes("released");
        if (!isApprovedBooking) {
            sendJson(res, 409, {
                success: false,
                message: "Approve the booking first before updating fulfillment progress."
            });
            return;
        }

        const normalizedFulfillment = requestedFulfillmentStatus
            .toLowerCase()
            .replace(/[\-_]+/g, " ");
        const isCompletionStatus = /\b(delivered|completed|picked up|released)\b/.test(normalizedFulfillment);
        const nextStatus = isCompletionStatus ? "Completed" : "Approved";
        const ensuredReceiptNumber = normalizeText(beforeRow.receipt_number).slice(0, 40)
            || buildReceiptNumber(normalizedOrderId, new Date());

        const [updateResult] = await pool.execute(
            `UPDATE bookings
             SET status = ?,
                 fulfillment_status = ?,
                 tracking_eta = ?,
                 tracking_location = ?,
                 receipt_number = CASE
                    WHEN receipt_number IS NULL OR receipt_number = ''
                        THEN ?
                    ELSE receipt_number
                 END,
                 receipt_issued_at = COALESCE(receipt_issued_at, NOW()),
                 review_decision = 'approved',
                 reviewed_at = COALESCE(reviewed_at, NOW()),
                 updated_at = NOW()
             WHERE order_id = ?`,
            [
                nextStatus,
                requestedFulfillmentStatus,
                requestedTrackingEta || null,
                requestedTrackingLocation || null,
                ensuredReceiptNumber,
                normalizedOrderId
            ]
        );
        if (!updateResult || Number(updateResult.affectedRows || 0) < 1) {
            sendJson(res, 404, { success: false, message: "Booking not found." });
            return;
        }

        const [rows] = await pool.execute(
            `SELECT *
             FROM bookings
             WHERE order_id = ?
             LIMIT 1`,
            [normalizedOrderId]
        );
        if (!Array.isArray(rows) || rows.length < 1) {
            sendJson(res, 404, { success: false, message: "Booking not found." });
            return;
        }

        sendJson(res, 200, { success: true, booking: mapBookingRow(rows[0]) });
    } catch (error) {
        sendJson(res, 500, { success: false, message: error.message || "Unable to update fulfillment status." });
    }
}

function getProductCategoryFilter(parsedUrl) {
    const raw = String(parsedUrl.searchParams.get("category") || "").trim();
    if (!raw) {
        return "";
    }
    const normalized = normalizeProductCategory(raw);
    if (normalized === "Other" && raw.toLowerCase() !== "other") {
        return "";
    }
    return normalized;
}

async function fetchProductById(pool, productId) {
    const [rows] = await pool.execute(
        `SELECT *
         FROM products
         WHERE id = ?
         LIMIT 1`,
        [productId]
    );
    if (!Array.isArray(rows) || rows.length < 1) {
        return null;
    }
    return mapProductRow(rows[0]);
}

async function handleListProducts(_req, res, parsedUrl) {
    try {
        const pool = await getDbPool();
        const categoryFilter = getProductCategoryFilter(parsedUrl);

        let query = `
            SELECT *
            FROM products
            WHERE is_active = 1
        `;
        const params = [];
        if (categoryFilter) {
            query += " AND category = ?";
            params.push(categoryFilter);
        }
        query += " ORDER BY FIELD(category, '2-Wheel', '3-Wheel', '4-Wheel', 'Other'), model ASC";

        const [rows] = await pool.execute(query, params);
        const products = Array.isArray(rows) ? rows.map(mapProductRow) : [];
        sendJson(res, 200, { success: true, products: products });
    } catch (error) {
        sendJson(res, 500, { success: false, message: error.message || "Unable to load products." });
    }
}

async function handleAdminProducts(_req, res, parsedUrl) {
    try {
        const authSession = requireAuthSession(_req, res, { role: "admin" });
        if (!authSession) {
            return;
        }

        const pool = await getDbPool();
        const includeInactive = String(parsedUrl.searchParams.get("includeInactive") || "").trim().toLowerCase() === "true";
        const categoryFilter = getProductCategoryFilter(parsedUrl);

        let query = "SELECT * FROM products";
        const whereClauses = [];
        const params = [];

        if (!includeInactive) {
            whereClauses.push("is_active = 1");
        }
        if (categoryFilter) {
            whereClauses.push("category = ?");
            params.push(categoryFilter);
        }
        if (whereClauses.length > 0) {
            query += ` WHERE ${whereClauses.join(" AND ")}`;
        }
        query += " ORDER BY FIELD(category, '2-Wheel', '3-Wheel', '4-Wheel', 'Other'), model ASC";

        const [rows] = await pool.execute(query, params);
        const products = Array.isArray(rows) ? rows.map(mapProductRow) : [];
        sendJson(res, 200, { success: true, products: products });
    } catch (error) {
        sendJson(res, 500, { success: false, message: error.message || "Unable to load admin products." });
    }
}

async function handleAdminCreateProduct(req, res) {
    try {
        const authSession = requireAuthSession(req, res, { role: "admin" });
        if (!authSession) {
            return;
        }

        const body = await readBody(req);
        const model = normalizeProductModel(body.model);
        const price = normalizeProductPrice(body.price);
        const category = normalizeProductCategory(body.category);
        const productInfo = normalizeProductInfo(body.info || body.productInfo || body.description);
        const imageUrl = normalizeProductImage(body.imageUrl || body.image || body.image_url);
        const detailUrl = normalizeProductUrl(body.detailUrl || body.detailsUrl || body.detail_url);
        const isActive = normalizeOptionalBoolean(body.isActive, true) ? 1 : 0;

        if (model.length < 2) {
            sendJson(res, 400, { success: false, message: "Model name is required." });
            return;
        }
        if (price === null) {
            sendJson(res, 400, { success: false, message: "A valid product price is required." });
            return;
        }
        if (isDataImage(imageUrl) && imageUrl.length > MAX_PRODUCT_IMAGE_DATA_URL_LENGTH) {
            sendJson(res, 400, { success: false, message: "Image file is too large. Max size is 2MB." });
            return;
        }

        const pool = await getDbPool();
        const [result] = await pool.execute(
            `INSERT INTO products (
                model,
                price,
                category,
                product_info,
                image_url,
                detail_url,
                is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                model,
                price,
                category,
                productInfo || null,
                imageUrl || null,
                detailUrl || null,
                isActive
            ]
        );

        const product = await fetchProductById(pool, Number(result.insertId || 0));
        sendJson(res, 201, { success: true, product: product });
    } catch (error) {
        if (error && error.code === "ER_DUP_ENTRY") {
            sendJson(res, 409, { success: false, message: "This model already exists for the selected category." });
            return;
        }
        sendJson(res, 500, { success: false, message: error.message || "Unable to create product." });
    }
}

async function handleAdminUpdateProduct(req, res, productId) {
    try {
        const authSession = requireAuthSession(req, res, { role: "admin" });
        if (!authSession) {
            return;
        }

        const id = Number(productId);
        if (!Number.isFinite(id) || id < 1) {
            sendJson(res, 400, { success: false, message: "Invalid product id." });
            return;
        }

        const body = await readBody(req);
        const updates = [];
        const params = [];

        if (Object.prototype.hasOwnProperty.call(body, "model")) {
            const model = normalizeProductModel(body.model);
            if (model.length < 2) {
                sendJson(res, 400, { success: false, message: "Model name is required." });
                return;
            }
            updates.push("model = ?");
            params.push(model);
        }

        if (Object.prototype.hasOwnProperty.call(body, "price")) {
            const price = normalizeProductPrice(body.price);
            if (price === null) {
                sendJson(res, 400, { success: false, message: "A valid product price is required." });
                return;
            }
            updates.push("price = ?");
            params.push(price);
        }

        if (Object.prototype.hasOwnProperty.call(body, "category")) {
            updates.push("category = ?");
            params.push(normalizeProductCategory(body.category));
        }

        const hasInfoField = ["info", "productInfo", "description"].some((key) => Object.prototype.hasOwnProperty.call(body, key));
        if (hasInfoField) {
            const productInfo = normalizeProductInfo(body.info || body.productInfo || body.description);
            updates.push("product_info = ?");
            params.push(productInfo || null);
        }

        const hasImageField = ["imageUrl", "image", "image_url"].some((key) => Object.prototype.hasOwnProperty.call(body, key));
        if (hasImageField) {
            const imageUrl = normalizeProductImage(body.imageUrl || body.image || body.image_url);
            if (isDataImage(imageUrl) && imageUrl.length > MAX_PRODUCT_IMAGE_DATA_URL_LENGTH) {
                sendJson(res, 400, { success: false, message: "Image file is too large. Max size is 2MB." });
                return;
            }
            updates.push("image_url = ?");
            params.push(imageUrl || null);
        }

        const hasDetailField = ["detailUrl", "detailsUrl", "detail_url"].some((key) => Object.prototype.hasOwnProperty.call(body, key));
        if (hasDetailField) {
            const detailUrl = normalizeProductUrl(body.detailUrl || body.detailsUrl || body.detail_url);
            updates.push("detail_url = ?");
            params.push(detailUrl || null);
        }

        if (Object.prototype.hasOwnProperty.call(body, "isActive")) {
            updates.push("is_active = ?");
            params.push(normalizeOptionalBoolean(body.isActive, true) ? 1 : 0);
        }

        if (!updates.length) {
            sendJson(res, 400, { success: false, message: "No product fields provided for update." });
            return;
        }

        const pool = await getDbPool();
        params.push(id);
        const [result] = await pool.execute(
            `UPDATE products
             SET ${updates.join(", ")},
                 updated_at = NOW()
             WHERE id = ?`,
            params
        );

        let product = null;
        if (!result || Number(result.affectedRows || 0) < 1) {
            product = await fetchProductById(pool, id);
            if (!product) {
                sendJson(res, 404, { success: false, message: "Product not found." });
                return;
            }
            sendJson(res, 200, { success: true, product: product });
            return;
        }

        product = await fetchProductById(pool, id);
        sendJson(res, 200, { success: true, product: product });
    } catch (error) {
        if (error && error.code === "ER_DUP_ENTRY") {
            sendJson(res, 409, { success: false, message: "This model already exists for the selected category." });
            return;
        }
        sendJson(res, 500, { success: false, message: error.message || "Unable to update product." });
    }
}

async function handleForgotSendCode(req, res) {
    try {
        clearExpiredOtpSessions();
        const body = await readBody(req);

        const method = String(body.method || "").trim().toLowerCase();
        const contact = String(body.contact || "").trim();

        if (method !== "email" && method !== "mobile") {
            sendJson(res, 400, { success: false, message: "Method must be email or mobile." });
            return;
        }
        if (method === "email" && !isValidEmail(contact)) {
            sendJson(res, 400, { success: false, message: "Invalid email address." });
            return;
        }
        if (method === "mobile" && !isValidMobile(contact)) {
            sendJson(res, 400, { success: false, message: "Invalid mobile number." });
            return;
        }
        if (!enforceRateLimit(
            req,
            res,
            "forgot-send-otp",
            `${method}:${contact}`,
            OTP_SEND_RATE_LIMIT_MAX,
            RATE_LIMIT_WINDOW_MS
        )) {
            return;
        }

        if (!isDbConfigured()) {
            sendJson(res, 503, {
                success: false,
                message: "Password reset is unavailable. Database is not configured."
            });
            return;
        }

        const pool = await getDbPool();
        let account = null;

        if (method === "email") {
            const normalizedEmail = normalizeEmail(contact);
            const [rows] = await pool.execute(
                `SELECT id, email, phone, is_blocked
                 FROM users
                 WHERE email = ?
                 LIMIT 1`,
                [normalizedEmail]
            );
            account = Array.isArray(rows) && rows.length ? rows[0] : null;
        } else {
            const normalizedPhone = normalizeMobile(contact);
            const [rows] = await pool.execute(
                `SELECT id, email, phone, is_blocked
                 FROM users
                 WHERE phone = ?
                 LIMIT 1`,
                [normalizedPhone]
            );
            account = Array.isArray(rows) && rows.length ? rows[0] : null;
        }

        if (!account) {
            sendJson(res, 404, { success: false, message: "No account found for this contact." });
            return;
        }

        if (Number(account.is_blocked || 0) === 1) {
            sendJson(res, 403, { success: false, message: "This account is blocked." });
            return;
        }

        const accountEmail = normalizeEmail(account.email);

        const requestId = createVerificationToken("otp");
        const code = generateOtpCode();
        const normalizedContact = normalizeContact(method, contact);

        otpSessions.set(requestId, {
            code: code,
            method: method,
            contact: normalizedContact,
            accountEmail: accountEmail,
            expiresAt: Date.now() + OTP_TTL_MS,
            verified: false,
            attempts: 0
        });

        const delivery = await deliverOtp(
            method,
            contact,
            code,
            { subject: "Ecodrive password reset code" }
        );
        const isDemoMode = !delivery.sent;
        if (isDemoMode && !DEMO_OTP_ENABLED) {
            otpSessions.delete(requestId);
            const deliveryReason = String(delivery.reason || "").trim();
            sendJson(res, 503, {
                success: false,
                message: deliveryReason
                    ? `OTP delivery is unavailable. ${deliveryReason}`
                    : "OTP delivery is unavailable. Configure SMTP or SMS provider first."
            });
            return;
        }

        const responsePayload = {
            success: true,
            message: isDemoMode ? "Verification code generated in demo mode." : "Verification code sent.",
            requestId: requestId,
            accountEmail: accountEmail,
            expiresInMs: OTP_TTL_MS,
            delivery: {
                method: method,
                mode: isDemoMode ? "demo" : "provider",
                provider: isDemoMode ? "local-demo" : String(delivery.provider || "configured-provider")
            }
        };

        if (isDemoMode && DEMO_OTP_ENABLED) {
            responsePayload.demoCode = code;
            responsePayload.deliveryReason = String(delivery.reason || "No provider configured.");
        }

        const codeLog = isDemoMode ? ` code=${code}` : "";
        console.log(`[forgot-otp] ${method}:${normalizedContact} requestId=${requestId} mode=${responsePayload.delivery.mode}${codeLog}`);
        sendJson(res, 200, responsePayload);
    } catch (error) {
        sendJson(res, 500, { success: false, message: error.message || "Unable to send code." });
    }
}

async function handleForgotVerifyCode(req, res) {
    try {
        clearExpiredOtpSessions();
        const body = await readBody(req);

        const requestId = String(body.requestId || "").trim();
        const code = String(body.code || "").trim();

        if (!enforceRateLimit(
            req,
            res,
            "forgot-verify-otp",
            requestId,
            OTP_VERIFY_RATE_LIMIT_MAX,
            RATE_LIMIT_WINDOW_MS
        )) {
            return;
        }

        if (!requestId || !/^\d{4}$/.test(code)) {
            sendJson(res, 400, {
                success: false,
                verified: false,
                message: "requestId and 4-digit code are required."
            });
            return;
        }

        const session = otpSessions.get(requestId);
        if (!session) {
            sendJson(res, 200, { success: true, verified: false, message: "Code expired or not found." });
            return;
        }

        if (session.expiresAt <= Date.now()) {
            otpSessions.delete(requestId);
            sendJson(res, 200, { success: true, verified: false, message: "Code expired. Request a new code." });
            return;
        }

        session.attempts += 1;
        if (session.code !== code) {
            if (session.attempts >= MAX_OTP_ATTEMPTS) {
                otpSessions.delete(requestId);
                sendJson(res, 200, {
                    success: true,
                    verified: false,
                    message: "Too many failed attempts. Request a new code."
                });
                return;
            }
            otpSessions.set(requestId, session);
            sendJson(res, 200, { success: true, verified: false, message: "Invalid verification code." });
            return;
        }

        session.verified = true;
        otpSessions.set(requestId, session);
        sendJson(res, 200, { success: true, verified: true, message: "Code verified." });
    } catch (error) {
        sendJson(res, 500, { success: false, verified: false, message: error.message || "Verification failed." });
    }
}

async function handleResetPassword(req, res) {
    try {
        clearExpiredOtpSessions();
        const body = await readBody(req);

        const newPassword = String(body.newPassword || "");
        const requestId = String(body.requestId || "").trim();
        const method = String(body.method || "").trim().toLowerCase();
        const contact = String(body.contact || "").trim();

        if (!isStrongPassword(newPassword)) {
            sendJson(res, 400, {
                success: false,
                message: "Password must be 8+ chars with upper, lower, number, and symbol."
            });
            return;
        }

        if (!requestId) {
            sendJson(res, 400, { success: false, message: "OTP verification is required." });
            return;
        }

        const otpSession = otpSessions.get(requestId);
        if (!otpSession || !otpSession.verified || otpSession.expiresAt <= Date.now()) {
            otpSessions.delete(requestId);
            sendJson(res, 400, { success: false, message: "OTP verification is required." });
            return;
        }

        if (method && method !== otpSession.method) {
            sendJson(res, 400, { success: false, message: "Invalid reset method." });
            return;
        }

        if (contact) {
            const normalizedContact = normalizeContact(otpSession.method, contact);
            if (!normalizedContact || normalizedContact !== otpSession.contact) {
                sendJson(res, 400, { success: false, message: "Reset contact does not match verified contact." });
                return;
            }
        }

        const accountEmail = normalizeEmail(otpSession.accountEmail || body.email);
        if (!isValidEmail(accountEmail)) {
            sendJson(res, 400, { success: false, message: "Unable to resolve account for password reset." });
            return;
        }

        if (!isDbConfigured()) {
            sendJson(res, 503, {
                success: false,
                message: "Password reset is unavailable. Database is not configured."
            });
            return;
        }

        const pool = await getDbPool();
        const passwordHash = hashPassword(newPassword);
        const [result] = await pool.execute(
            "UPDATE users SET password_hash = ?, updated_at = NOW() WHERE email = ?",
            [passwordHash, accountEmail]
        );

        if (!result || Number(result.affectedRows || 0) < 1) {
            sendJson(res, 404, { success: false, message: "Account not found for password reset." });
            return;
        }

        otpSessions.delete(requestId);
        sendJson(res, 200, { success: true, message: "Password reset request accepted." });
    } catch (error) {
        sendJson(res, 500, { success: false, message: error.message || "Reset failed." });
    }
}

async function handleKycVerifyId(req, res) {
    try {
        const body = await readBody(req);
        const idType = String(body.idType || "").trim();
        const idImage = body.idImage;

        if (!idType) {
            sendJson(res, 400, { verified: false, reason: "Missing idType." });
            return;
        }
        if (!isDataImage(idImage)) {
            sendJson(res, 400, { verified: false, reason: "Invalid ID image payload." });
            return;
        }
        if (idImage.length < 9000) {
            sendJson(res, 200, { verified: false, reason: "ID image is too small or unclear." });
            return;
        }

        const verificationToken = createVerificationToken("id");
        sendJson(res, 200, {
            verified: true,
            reason: "ID passed server-side validation.",
            verificationToken: verificationToken
        });
    } catch (error) {
        sendJson(res, 500, { verified: false, reason: error.message || "ID verification failed." });
    }
}

async function handleKycVerifyFace(req, res) {
    try {
        const body = await readBody(req);
        const idImage = body.idImage;
        const selfieImage = body.selfieImage;
        const token = String(body.verificationToken || "").trim();

        if (!isDataImage(idImage) || !isDataImage(selfieImage)) {
            sendJson(res, 400, { verified: false, reason: "Invalid image payload." });
            return;
        }
        if (!token) {
            sendJson(res, 400, { verified: false, reason: "Missing verification token from ID step." });
            return;
        }

        const distance = estimateDistance(idImage, selfieImage);
        const verified = distance <= 0.52;
        sendJson(res, 200, {
            verified: verified,
            reason: verified ? "Face matched with ID on server." : "Face mismatch detected by server.",
            distance: distance
        });
    } catch (error) {
        sendJson(res, 500, { verified: false, reason: error.message || "Face verification failed." });
    }
}

const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    const pathname = parsedUrl.pathname;

    if (req.method === "OPTIONS") {
        sendJson(res, 200, { ok: true });
        return;
    }

    if (req.method === "GET" && pathname === "/api/health") {
        sendJson(res, 200, {
            ok: true,
            service: "ecodrive-api",
            dbConfigured: isDbConfigured(),
            smtpConfigured: isSmtpConfigured(),
            smsConfigured: isSmsDeliveryConfigured(),
            smsMode: isSemaphoreConfigured()
                ? "semaphore-direct"
                : (isSmsWebhookConfigured() ? "webhook-relay" : "not-configured"),
            semaphoreConfigured: isSemaphoreConfigured(),
            semaphoreSenderConfigured: Boolean(SEMAPHORE_SENDERNAME)
        });
        return;
    }

    if (req.method === "GET" && pathname === "/api/auth/me") {
        await handleAuthMe(req, res);
        return;
    }

    if (req.method === "POST" && pathname === "/api/logout") {
        await handleLogout(req, res);
        return;
    }

    if (req.method === "GET" && pathname === "/api/profile/settings") {
        await handleProfileSettingsGet(req, res, parsedUrl);
        return;
    }

    if (req.method === "POST" && pathname === "/api/profile/settings") {
        await handleProfileSettingsSave(req, res);
        return;
    }

    if (req.method === "POST" && pathname === "/api/profile/password") {
        await handleProfilePasswordChange(req, res);
        return;
    }

    if (req.method === "GET" && pathname === "/api/chat/thread") {
        await handleChatThreadGet(req, res, parsedUrl);
        return;
    }

    if (req.method === "POST" && pathname === "/api/chat/messages") {
        await handleChatMessagesPost(req, res);
        return;
    }

    if (req.method === "POST" && pathname === "/api/chat/thread/clear") {
        await handleChatThreadClear(req, res);
        return;
    }

    if (req.method === "GET" && pathname === "/api/bookings") {
        await handleListBookings(req, res, parsedUrl);
        return;
    }

    if (req.method === "GET" && pathname === "/api/bookings/availability") {
        await handleBookingDateAvailability(req, res, parsedUrl);
        return;
    }

    if (req.method === "POST" && pathname === "/api/bookings") {
        await handleCreateBooking(req, res);
        return;
    }

    if (req.method === "GET" && pathname === "/api/products") {
        await handleListProducts(req, res, parsedUrl);
        return;
    }

    const bookingCancelMatch = pathname.match(/^\/api\/bookings\/([^/]+)\/cancel$/);
    if (req.method === "POST" && bookingCancelMatch) {
        await handleCancelBooking(req, res, decodeURIComponent(bookingCancelMatch[1]));
        return;
    }

    if (req.method === "GET" && pathname === "/api/admin/bookings") {
        await handleAdminBookings(req, res, parsedUrl);
        return;
    }

    if (req.method === "GET" && pathname === "/api/admin/dashboard") {
        await handleAdminDashboard(req, res);
        return;
    }

    if (req.method === "GET" && pathname === "/api/admin/settings") {
        await handleAdminSettingsGet(req, res);
        return;
    }

    if (req.method === "POST" && pathname === "/api/admin/settings/login-id") {
        await handleAdminSettingsUpdateLoginId(req, res);
        return;
    }

    if (req.method === "POST" && pathname === "/api/admin/settings/password") {
        await handleAdminSettingsUpdatePassword(req, res);
        return;
    }

    if (req.method === "GET" && pathname === "/api/admin/products") {
        await handleAdminProducts(req, res, parsedUrl);
        return;
    }

    if (req.method === "POST" && pathname === "/api/admin/products") {
        await handleAdminCreateProduct(req, res);
        return;
    }

    const adminProductUpdateMatch = pathname.match(/^\/api\/admin\/products\/(\d+)$/);
    if (req.method === "POST" && adminProductUpdateMatch) {
        await handleAdminUpdateProduct(req, res, adminProductUpdateMatch[1]);
        return;
    }

    const adminBookingDetailMatch = pathname.match(/^\/api\/admin\/bookings\/([^/]+)$/);
    if (req.method === "GET" && adminBookingDetailMatch) {
        await handleAdminBookingDetails(req, res, decodeURIComponent(adminBookingDetailMatch[1]));
        return;
    }

    const adminBookingDecisionMatch = pathname.match(/^\/api\/admin\/bookings\/([^/]+)\/(approve|reject)$/);
    if (req.method === "POST" && adminBookingDecisionMatch) {
        await handleAdminBookingDecision(
            req,
            res,
            decodeURIComponent(adminBookingDecisionMatch[1]),
            adminBookingDecisionMatch[2]
        );
        return;
    }

    const adminBookingPaymentStatusMatch = pathname.match(/^\/api\/admin\/bookings\/([^/]+)\/payment-status$/);
    if (req.method === "POST" && adminBookingPaymentStatusMatch) {
        await handleAdminBookingPaymentStatus(
            req,
            res,
            decodeURIComponent(adminBookingPaymentStatusMatch[1])
        );
        return;
    }

    const adminBookingFulfillmentStatusMatch = pathname.match(/^\/api\/admin\/bookings\/([^/]+)\/fulfillment-status$/);
    if (req.method === "POST" && adminBookingFulfillmentStatusMatch) {
        await handleAdminBookingFulfillmentStatus(
            req,
            res,
            decodeURIComponent(adminBookingFulfillmentStatusMatch[1])
        );
        return;
    }

    if (req.method === "GET" && pathname === "/api/admin/users") {
        await handleAdminUsers(req, res);
        return;
    }

    const adminChatThreadMatch = pathname.match(/^\/api\/admin\/chat\/users\/(\d+)$/);
    if (req.method === "GET" && adminChatThreadMatch) {
        await handleAdminChatThreadGet(req, res, parsedUrl, adminChatThreadMatch[1]);
        return;
    }

    const adminChatTakeoverMatch = pathname.match(/^\/api\/admin\/chat\/users\/(\d+)\/takeover$/);
    if (req.method === "POST" && adminChatTakeoverMatch) {
        await handleAdminChatTakeover(req, res, adminChatTakeoverMatch[1]);
        return;
    }

    const adminChatReleaseMatch = pathname.match(/^\/api\/admin\/chat\/users\/(\d+)\/release$/);
    if (req.method === "POST" && adminChatReleaseMatch) {
        await handleAdminChatRelease(req, res, adminChatReleaseMatch[1]);
        return;
    }

    const adminChatMessageMatch = pathname.match(/^\/api\/admin\/chat\/users\/(\d+)\/messages$/);
    if (req.method === "POST" && adminChatMessageMatch) {
        await handleAdminChatSendMessage(req, res, adminChatMessageMatch[1]);
        return;
    }

    const blockMatch = pathname.match(/^\/api\/admin\/users\/(\d+)\/(block|unblock)$/);
    if (req.method === "POST" && blockMatch) {
        await handleBlockToggle(req, res, blockMatch[1], blockMatch[2]);
        return;
    }

    if (req.method === "POST" && pathname === "/api/integrations/sms/semaphore-relay") {
        await handleSmsSemaphoreRelay(req, res);
        return;
    }

    if (req.method === "POST" && pathname === "/api/signup/send-code") {
        await handleSignupSendCode(req, res);
        return;
    }

    if (req.method === "POST" && pathname === "/api/signup/verify-code") {
        await handleSignupVerifyCode(req, res);
        return;
    }

    if (req.method === "POST" && pathname === "/api/signup") {
        await handleSignup(req, res);
        return;
    }

    if (req.method === "POST" && pathname === "/api/login") {
        await handleLogin(req, res);
        return;
    }

    if (req.method === "POST" && pathname === "/api/forgot/send-code") {
        await handleForgotSendCode(req, res);
        return;
    }

    if (req.method === "POST" && pathname === "/api/forgot/verify-code") {
        await handleForgotVerifyCode(req, res);
        return;
    }

    if (req.method === "POST" && pathname === "/api/reset-password") {
        await handleResetPassword(req, res);
        return;
    }

    if (req.method === "POST" && pathname === "/api/kyc/verify-id") {
        await handleKycVerifyId(req, res);
        return;
    }

    if (req.method === "POST" && pathname === "/api/kyc/verify-face") {
        await handleKycVerifyFace(req, res);
        return;
    }

    sendJson(res, 404, { success: false, message: "Endpoint not found." });
});

server.listen(PORT, () => {
    void ensureDbSchema();
    const dbStatus = isDbConfigured() ? "configured" : "missing-config";
    const smtpStatus = isSmtpConfigured() ? "enabled" : "demo-fallback";
    const smsStatus = isSemaphoreConfigured()
        ? "semaphore-direct"
        : (isSmsWebhookConfigured() ? "webhook-relay" : "demo-fallback");
    const semaphoreStatus = isSemaphoreConfigured() ? "configured" : "missing-config";
    const otpMode = DEMO_OTP_ENABLED ? "demo-allowed" : "provider-required";
    const corsStatus = CORS_ALLOWED_ORIGINS.size > 0 ? `${CORS_ALLOWED_ORIGINS.size}-origins` : "none";
    const adminStatus = getAdminCredentials() ? "configured" : "missing";
    const apiUrl = PUBLIC_API_BASE || `http://127.0.0.1:${PORT}`;
    if (ALLOW_DEMO_OTP && IS_PRODUCTION) {
        console.warn("[security] ALLOW_DEMO_OTP is enabled but ignored in production mode.");
    }
    if (adminStatus === "missing") {
        console.warn("[admin-auth] Missing admin credentials. Set ADMIN_LOGIN_ID and ADMIN_PASSWORD or provide api/admin-credentials.json.");
    }
    console.log(
        `API server running at ${apiUrl} (DB: ${dbStatus}, SMTP: ${smtpStatus}, SMS: ${smsStatus}, Semaphore: ${semaphoreStatus}, OTP: ${otpMode}, CORS: ${corsStatus}, AdminAuth: ${adminStatus}, SessionTTLms: ${SESSION_TTL_MS})`
    );
});

