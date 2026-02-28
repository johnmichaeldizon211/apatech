"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const CREDENTIALS_PATH = path.join(__dirname, "..", "admin-credentials.json");

function printUsage() {
    console.log(
        [
            "Usage:",
            "  node scripts/admin-credentials.js --login-id <value> --keep-password-hash",
            "  node scripts/admin-credentials.js --login-id <value> --password <strong-password>",
            "",
            "Options:",
            "  --login-id <value>       Required. New admin username/email.",
            "  --keep-password-hash     Keep current password hash from admin-credentials.json.",
            "  --password <value>       Set a new admin password (must be strong).",
            "  --help                   Show this help."
        ].join("\n")
    );
}

function parseArgs(argv) {
    const options = {
        loginId: "",
        keepPasswordHash: false,
        password: "",
        help: false
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = String(argv[index] || "");
        if (!arg) {
            continue;
        }

        if (arg === "--help" || arg === "-h") {
            options.help = true;
            continue;
        }

        if (arg === "--keep-password-hash") {
            options.keepPasswordHash = true;
            continue;
        }

        if (arg === "--login-id") {
            const next = String(argv[index + 1] || "").trim();
            if (!next) {
                throw new Error("Missing value for --login-id.");
            }
            options.loginId = next;
            index += 1;
            continue;
        }

        if (arg.startsWith("--login-id=")) {
            options.loginId = String(arg.slice("--login-id=".length) || "").trim();
            continue;
        }

        if (arg === "--password") {
            const nextPassword = String(argv[index + 1] || "");
            if (!nextPassword) {
                throw new Error("Missing value for --password.");
            }
            options.password = nextPassword;
            index += 1;
            continue;
        }

        if (arg.startsWith("--password=")) {
            options.password = String(arg.slice("--password=".length) || "");
            continue;
        }

        throw new Error(`Unknown option: ${arg}`);
    }

    return options;
}

function stripInvisibleIdentifierChars(value) {
    return String(value || "").replace(/[\u200B-\u200D\uFEFF\u00A0]/g, "");
}

function normalizeAdminLoginId(value) {
    return stripInvisibleIdentifierChars(value).trim().toLowerCase();
}

function isValidAdminLoginId(value) {
    const normalized = normalizeAdminLoginId(value);
    if (normalized.length < 3 || normalized.length > 190) {
        return false;
    }
    return /^[a-z0-9._@+\-]+$/.test(normalized);
}

function isStrongPassword(password) {
    return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/.test(String(password || ""));
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const derived = crypto.scryptSync(String(password || ""), salt, 64).toString("hex");
    return `scrypt:${salt}:${derived}`;
}

function readCredentialsFromDisk(filePath) {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object") {
        throw new Error("Invalid credentials file content.");
    }
    return parsed;
}

function writeCredentialsToDisk(filePath, credentials) {
    fs.writeFileSync(filePath, JSON.stringify(credentials, null, 2) + "\n", "utf8");
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printUsage();
        return;
    }

    if (!options.loginId) {
        throw new Error("The --login-id option is required.");
    }
    if (options.keepPasswordHash && options.password) {
        throw new Error("Use only one mode: --keep-password-hash OR --password.");
    }
    if (!options.keepPasswordHash && !options.password) {
        throw new Error("Choose a mode: --keep-password-hash or --password <strong-password>.");
    }

    const nextLoginId = normalizeAdminLoginId(options.loginId);
    if (!isValidAdminLoginId(nextLoginId)) {
        throw new Error("Invalid login ID. Use 3-190 chars from: a-z, 0-9, dot, underscore, @, +, -.");
    }

    let nextPasswordHash = "";
    if (options.keepPasswordHash) {
        if (!fs.existsSync(CREDENTIALS_PATH)) {
            throw new Error(
                "admin-credentials.json was not found. Cannot keep password hash. " +
                "Create credentials first with --password."
            );
        }
        const existing = readCredentialsFromDisk(CREDENTIALS_PATH);
        nextPasswordHash = String(existing.passwordHash || "").trim();
        if (!nextPasswordHash) {
            throw new Error("Existing credentials file does not contain passwordHash.");
        }
    } else {
        if (!isStrongPassword(options.password)) {
            throw new Error("Password must be 8+ chars with upper, lower, number, and symbol.");
        }
        nextPasswordHash = hashPassword(options.password);
    }

    const nextCredentials = {
        loginId: nextLoginId,
        passwordHash: nextPasswordHash,
        updatedAt: new Date().toISOString()
    };

    writeCredentialsToDisk(CREDENTIALS_PATH, nextCredentials);

    console.log(`[admin-credentials] Updated: ${CREDENTIALS_PATH}`);
    console.log(`[admin-credentials] loginId set to: ${nextCredentials.loginId}`);
    if (options.keepPasswordHash) {
        console.log("[admin-credentials] Password hash kept from existing credentials.");
    } else {
        console.log("[admin-credentials] Password hash regenerated from provided password.");
    }
}

try {
    main();
} catch (error) {
    console.error(`[admin-credentials] ${error && error.message ? error.message : String(error)}`);
    process.exitCode = 1;
}
