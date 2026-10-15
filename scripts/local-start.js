"use strict";

// Local runtime only. Does not load production credentials or modify an XAMPP database.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const net = require("node:net");
const { spawn } = require("node:child_process");
const mysql = require("mysql2/promise");
const root = path.resolve(__dirname, "..");
const localDir = path.join(root, ".local");
const dataDir = path.join(localDir, "mysql");
const configPath = path.join(localDir, "config.json");
const dbPort = Number(process.env.LOCAL_DB_PORT || 3307);
const port = Number(process.env.LOCAL_PORT || 5050);
const dbName = "ecodrive_local";
const base = `http://127.0.0.1:${port}`;
const localAdminPassword = String(process.env.LOCAL_ADMIN_PASSWORD || "ecodriveadmin123");
const branches = [
    ["ecodrive", "City of Baliwag"],
    ["ecodrivepulilan", "Pulilan"],
    ["ecodrivesanildefonso", "San Ildefonso"],
    ["ecodrivesanrafael", "San Rafael"],
    ["ecodrivebustos", "Bustos"]
];
let databaseProcess;
let apiProcess;
let shuttingDown = false;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function listening(checkPort) {
    return new Promise((resolve) => {
        const socket = net.connect({ host: "127.0.0.1", port: checkPort });
        socket.setTimeout(500);
        const finish = (value) => { socket.destroy(); resolve(value); };
        socket.once("connect", () => finish(true));
        socket.once("error", () => finish(false));
        socket.once("timeout", () => finish(false));
    });
}

function findDatabaseBin() {
    const candidates = [process.env.LOCAL_MYSQL_BIN, "C:\\xampp\\mysql\\bin", "C:\\laragon\\bin\\mysql"];
    const found = candidates.find((dir) => dir && fs.existsSync(path.join(dir, "mysqld.exe")) && fs.existsSync(path.join(dir, "mysql_install_db.exe")));
    if (!found) throw new Error("MariaDB binaries were not found. Install XAMPP, or set LOCAL_MYSQL_BIN to its mysql\\bin folder.");
    return found;
}

function run(executable, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(executable, args, { cwd: root, windowsHide: true, stdio: "inherit" });
        child.once("error", reject);
        child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(executable)} exited with code ${code}.`)));
    });
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    return `scrypt:${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}

async function waitForExit(child, timeoutMs) {
    if (!child || child.exitCode !== null || child.signalCode) return;
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(timeoutMs)]);
}

async function shutdown(code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    if (apiProcess && apiProcess.exitCode === null) {
        apiProcess.kill();
        await waitForExit(apiProcess, 3000);
    }
    if (databaseProcess && databaseProcess.exitCode === null) {
        try {
            const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
            const connection = await mysql.createConnection({ host: "127.0.0.1", port: dbPort, user: "root", password: config.dbPassword });
            await connection.query("SHUTDOWN");
            await connection.end().catch(() => {});
        } catch (error) {
            if (!/shutdown|closed|ECONNRESET/i.test(error.message)) console.error("Database shutdown:", error.message);
        }
        await waitForExit(databaseProcess, 10000);
    }
    process.exit(code);
}

async function main() {
    if (![port, dbPort].every((value) => Number.isInteger(value) && value > 1024 && value < 65536) || port === dbPort) {
        throw new Error("LOCAL_PORT and LOCAL_DB_PORT must be different valid ports above 1024.");
    }
    if (await listening(port)) {
        const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
        const health = response && await response.json().catch(() => null);
        if (health && health.service === "ecodrive-api" && health.localDemoMode) {
            console.log(`Ecodrive is already running: http://localhost:${port}`);
            return;
        }
        throw new Error(`Port ${port} is in use by another app. Set LOCAL_PORT to an available port.`);
    }
    fs.mkdirSync(localDir, { recursive: true });
    if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, JSON.stringify({ dbPassword: crypto.randomBytes(24).toString("hex"), sessionSecret: crypto.randomBytes(48).toString("hex") }, null, 2));
    }
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const bin = findDatabaseBin();
    if (!fs.existsSync(path.join(dataDir, "mysql", "db.frm"))) {
        if (fs.existsSync(dataDir) && fs.readdirSync(dataDir).length) {
            throw new Error("Local database initialization is incomplete. Inspect .local/mysql before retrying; existing data was preserved.");
        }
        console.log("Preparing the project's private local database (first run only)...");
        await run(path.join(bin, "mysql_install_db.exe"), [`--datadir=${dataDir}`, `--password=${config.dbPassword}`, `--port=${dbPort}`]);
    }
    if (!(await listening(dbPort))) {
        databaseProcess = spawn(path.join(bin, "mysqld.exe"), [
            "--no-defaults", `--basedir=${path.dirname(bin)}`, `--datadir=${dataDir}`,
            "--bind-address=127.0.0.1", `--port=${dbPort}`, "--character-set-server=utf8mb4",
            "--collation-server=utf8mb4_unicode_ci", "--max-allowed-packet=64M",
            `--log-error=${path.join(localDir, "mysql-error.log")}`, `--pid-file=${path.join(localDir, "mysql.pid")}`
        ], { cwd: root, windowsHide: true, stdio: ["ignore", "inherit", "inherit"] });
        databaseProcess.once("error", (error) => { console.error(error.message); void shutdown(1); });
        databaseProcess.once("exit", (code) => { if (!shuttingDown) { console.error(`Local database stopped (${code}). See .local/mysql-error.log.`); void shutdown(1); } });
    }
    let connection;
    for (let attempt = 0; attempt < 60; attempt++) {
        try {
            connection = await mysql.createConnection({ host: "127.0.0.1", port: dbPort, user: "root", password: config.dbPassword, connectTimeout: 1000 });
            break;
        } catch (error) {
            if (error.code === "ER_ACCESS_DENIED_ERROR") throw new Error(`Another database is using port ${dbPort}; set LOCAL_DB_PORT to a free port.`);
            if (attempt === 59) throw error;
            await delay(500);
        }
    }
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${dbName} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.end();
    const credentialsPath = path.join(root, "api", "admin-credentials.json");
    if (!fs.existsSync(credentialsPath)) {
        fs.writeFileSync(credentialsPath, JSON.stringify({ admins: branches.map(([loginId, branchCity]) => ({
            loginId, branchCity, passwordHash: hashPassword(localAdminPassword), updatedAt: new Date().toISOString()
        })) }, null, 2));
        console.log(`Created 5 local branch admins. Initial password: ${localAdminPassword}`);
    }
    // Set every remote/provider setting explicitly so api/.env cannot supply production values.
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
        if (/^(DB_|MYSQL|SMTP_|SEMAPHORE_|SMS_|ADMIN_|AUTH_|INSTALLMENT_|VERCEL|NOW_REGION|AWS_LAMBDA)/.test(key)) delete env[key];
    }
    Object.assign(env, {
        NODE_ENV: "development", HOST: "127.0.0.1", KYC_PORT: String(port), PORT: String(port), PUBLIC_API_BASE: base,
        LOCAL_DEMO_MODE: "true", ALLOW_DEMO_OTP: "true", DB_HOST: "127.0.0.1", DB_PORT: String(dbPort),
        DB_USER: "root", DB_PASSWORD: config.dbPassword, DB_NAME: dbName, DB_URL: "", DATABASE_URL: "",
        MYSQL_URL: "", MYSQL_PUBLIC_URL: "", MYSQL_PRIVATE_URL: "", DB_SSL: "false", DB_SSL_REJECT_UNAUTHORIZED: "true",
        AUTH_SESSION_SECRET: config.sessionSecret, ADMIN_CREDENTIALS_JSON: "", ADMIN_LOGIN_ID: "", ADMIN_PASSWORD: "",
        SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "", SMTP_FROM: "", SEMAPHORE_API_KEY: "", SMS_WEBHOOK_URL: "",
        SMS_WEBHOOK_TOKEN: "", SEMAPHORE_RELAY_TOKEN: "", INSTALLMENT_REMINDER_ENABLED: "false",
        VERCEL: "", AWS_LAMBDA_FUNCTION_NAME: "", NOW_REGION: "",
        CORS_ALLOWED_ORIGINS: `http://localhost:${port},${base},http://localhost:5500,http://127.0.0.1:5500`,
        LOGIN_RATE_LIMIT_MAX: "100", OTP_SEND_RATE_LIMIT_MAX: "30", OTP_VERIFY_RATE_LIMIT_MAX: "50"
    });
    apiProcess = spawn(process.execPath, [path.join(root, "api", "kyc-server.js")], { cwd: root, env, windowsHide: true, stdio: "inherit" });
    apiProcess.once("error", (error) => { console.error(error.message); void shutdown(1); });
    apiProcess.once("exit", (code) => { if (!shuttingDown) void shutdown(code || 0); });
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
        try {
            const response = await fetch(`${base}/api/products`, { signal: AbortSignal.timeout(2000) });
            const result = await response.json();
            if (response.ok && Array.isArray(result.products) && result.products.length) { ready = true; break; }
        } catch (_) { /* Wait for schema initialization. */ }
        await delay(500);
    }
    if (!ready) throw new Error("The API could not initialize. Check the error above or .local/mysql-error.log.");
    const seedPath = path.join(localDir, "inventory-seeded.json");
    if (!fs.existsSync(seedPath)) {
        const db = await mysql.createConnection({ host: "127.0.0.1", port: dbPort, user: "root", password: config.dbPassword, database: dbName });
        for (const [, branchCity] of branches) {
            await db.execute("INSERT IGNORE INTO product_branch_inventory (product_id, branch_city, stock_count) SELECT id, ?, 20 FROM products", [branchCity]);
        }
        await db.end();
        fs.writeFileSync(seedPath, JSON.stringify({ seededAt: new Date().toISOString() }));
    }
    console.log(`\nEcodrive is ready: http://localhost:${port}\nDemo OTP appears on the signup/reset screen. No email or SMS is sent.\nLocal data is saved in .local/mysql. Press Ctrl+C to stop.\n`);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
main().catch((error) => { console.error("Local startup failed:", error.message); void shutdown(1); });
