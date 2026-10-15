"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const credentialsPath = path.join(root, "api", "admin-credentials.json");
const password = String(process.env.LOCAL_ADMIN_PASSWORD || "ecodriveadmin123");

if (!fs.existsSync(credentialsPath)) {
    throw new Error("Local admin credentials have not been created. Run npm.cmd start first.");
}

const credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
if (!Array.isArray(credentials.admins) || !credentials.admins.length) {
    throw new Error("No local branch admins were found.");
}

function hashPassword(value) {
    const salt = crypto.randomBytes(16).toString("hex");
    return `scrypt:${salt}:${crypto.scryptSync(value, salt, 64).toString("hex")}`;
}

credentials.admins = credentials.admins.map((admin) => ({
    ...admin,
    passwordHash: hashPassword(password),
    updatedAt: new Date().toISOString()
}));
credentials.updatedAt = new Date().toISOString();
fs.writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2) + "\n", "utf8");

console.log(`Reset ${credentials.admins.length} local branch-admin passwords.`);
