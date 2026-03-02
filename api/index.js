"use strict";

const apiModule = require("./kyc-server");

const requestListener = (
    apiModule && typeof apiModule.requestListener === "function"
        ? apiModule.requestListener
        : (typeof apiModule === "function" ? apiModule : null)
);

function buildForwardedApiPath(rawPathInput) {
    const rawPath = String(rawPathInput || "")
        .trim()
        .replace(/^\/+/, "")
        .replace(/\/+$/, "");

    if (!rawPath) {
        return "/api";
    }
    return `/api/${rawPath}`;
}

module.exports = function vercelApiHandler(req, res) {
    if (typeof requestListener !== "function") {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ success: false, message: "API handler is not available." }));
        return;
    }

    const originalUrl = typeof req.url === "string" ? req.url : "/";
    const parsed = new URL(originalUrl, "http://127.0.0.1");
    const forwardedPath = buildForwardedApiPath(parsed.searchParams.get("path"));

    parsed.searchParams.delete("path");
    const queryString = parsed.searchParams.toString();
    req.url = queryString ? `${forwardedPath}?${queryString}` : forwardedPath;

    return requestListener(req, res);
};

module.exports.default = module.exports;
