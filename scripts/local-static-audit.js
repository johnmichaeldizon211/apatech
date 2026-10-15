"use strict";
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const base = process.env.LOCAL_TEST_BASE_URL || "http://127.0.0.1:5050";
const baseUrl = new URL(base);
if (!["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname)) throw new Error("Static audit may only target localhost.");
const root = path.resolve(__dirname, "..");
const files = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((file) => /\.(?:html?|css|js|mjs|png|jpe?g|gif|svg|webp|ico)$/i.test(file));
const htmlFiles = files.filter((file) => /\.html?$/i.test(file));
const URLs = new Map();
const externalUrls = new Set();

function addLocalUrl(rawUrl, sourceFile) {
    const value = String(rawUrl || "").trim();
    if (!value || value.startsWith("#") || /^(?:mailto:|tel:|javascript:|data:)/i.test(value)) return;
    if (/^https?:\/\//i.test(value)) {
        externalUrls.add(value);
        return;
    }
    const sourceUrl = new URL(`/${sourceFile.split(path.sep).join("/")}`, base);
    const url = new URL(value, sourceUrl);
    if (url.origin !== baseUrl.origin) {
        externalUrls.add(value);
        return;
    }
    url.search = "";
    url.hash = "";
    URLs.set(url.toString(), sourceFile);
}

for (const file of htmlFiles) {
    addLocalUrl(file, "repository index");
    const source = fs.readFileSync(path.join(root, file), "utf8");
    const attributePattern = /<(?:a|link|script|img|source|video|audio|iframe)\b[^>]*?\s(?:href|src)\s*=\s*["']([^"']+)["']/gi;
    let match;
    while ((match = attributePattern.exec(source))) addLocalUrl(match[1], file);
}

(async () => {
    const failures = [];
    for (const [url, source] of URLs) {
        const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10000) }).catch((error) => ({ status: 0, error }));
        if (!response || response.status < 200 || response.status >= 400) {
            failures.push(`${response ? response.status : 0} ${url} (linked by ${source})`);
        }
    }
    if (failures.length) {
        console.error(`Broken local routes/assets (${failures.length}):\n${failures.join("\n")}`);
        process.exitCode = 1;
        return;
    }
    console.log(`PASS: ${URLs.size} local routes/assets served successfully across ${htmlFiles.length} pages.`);
    if (externalUrls.size) console.log(`Note: ${externalUrls.size} external URLs were identified and excluded from the localhost route audit.`);
})();
