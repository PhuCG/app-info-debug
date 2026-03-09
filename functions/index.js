const functions = require("firebase-functions");
const cors = require("cors")({ origin: true });
const { getIosAppInfo } = require("./src/ios");
const { getAndroidAppInfo } = require("./src/android");

const ALLOWED_PLATFORMS = new Set(["ios", "android", "both"]);
const BUNDLE_ID_REGEX = /^[a-z0-9](?:[a-z0-9._-]{0,253}[a-z0-9])?$/i;
const COUNTRY_REGEX = /^[a-z]{2}$/i;
const CACHE_TTL_MS = 10 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 60;
const appCache = new Map();
const requestBuckets = new Map();

function getScalarQueryValue(value) {
    if (Array.isArray(value)) return value[0];
    return value;
}

function validateInputs(query) {
    const rawBundleId = getScalarQueryValue(query.bundleId);
    const rawPlatform = getScalarQueryValue(query.platform) || "both";
    const rawCountry = getScalarQueryValue(query.country) || "us";

    if (typeof rawBundleId !== "string") {
        return { error: "Missing required parameter: bundleId" };
    }

    const bundleId = rawBundleId.trim();
    if (!bundleId) {
        return { error: "Missing required parameter: bundleId" };
    }
    if (!BUNDLE_ID_REGEX.test(bundleId)) {
        return { error: "Invalid bundleId format" };
    }

    const platform = String(rawPlatform).trim().toLowerCase();
    if (!ALLOWED_PLATFORMS.has(platform)) {
        return { error: "Invalid platform. Must be: ios | android | both" };
    }

    const country = String(rawCountry).trim().toLowerCase();
    if (!COUNTRY_REGEX.test(country)) {
        return { error: "Invalid country format. Must be ISO 2-letter code, e.g. us, vn" };
    }

    return { bundleId: bundleId.toLowerCase(), platform, country };
}

function getClientIp(req) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length > 0) {
        return forwarded.split(",")[0].trim();
    }
    return req.ip || "unknown";
}

function isRateLimited(ip) {
    const now = Date.now();
    const current = requestBuckets.get(ip);

    if (!current || now - current.windowStart > RATE_WINDOW_MS) {
        requestBuckets.set(ip, { windowStart: now, count: 1 });
        return false;
    }

    current.count += 1;
    return current.count > RATE_LIMIT;
}

function getCacheKey(bundleId, platform, country) {
    return `${bundleId}|${platform}|${country}`;
}

function getCachedResult(key) {
    const cached = appCache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.createdAt > CACHE_TTL_MS) {
        appCache.delete(key);
        return null;
    }
    return cached.payload;
}

function setCachedResult(key, payload) {
    appCache.set(key, { createdAt: Date.now(), payload });
}

/**
 * Unified HTTP endpoint: GET /api/appinfo
 * Query params:
 *   - bundleId (required): Bundle ID / Package Name
 *   - platform (optional): "ios" | "android" | "both" (default: "both")
 *   - country (optional): country code (default: "us")
 */
exports.api = functions
    .runWith({ timeoutSeconds: 30, memory: "256MB" })
    .https.onRequest((req, res) => {
        cors(req, res, async () => {
            // Only allow GET
            if (req.method !== "GET") {
                return res.status(405).json({ error: "Method Not Allowed" });
            }

            const clientIp = getClientIp(req);
            if (isRateLimited(clientIp)) {
                return res.status(429).json({
                    error: "Too many requests. Please try again later.",
                });
            }

            const validated = validateInputs(req.query || {});
            if (validated.error) {
                return res.status(400).json({
                    error: validated.error,
                });
            }

            const { bundleId: id, platform: plt, country } = validated;
            const cacheKey = getCacheKey(id, plt, country);
            const cached = getCachedResult(cacheKey);
            if (cached) {
                return res.status(200).json({
                    ...cached,
                    cache: "hit",
                });
            }

            const result = {
                status: "success",
                bundleId: id,
                platform: plt,
                country,
                timestamp: new Date().toISOString(),
                ios: null,
                android: null,
                cache: "miss",
            };

            const errors = {};

            try {
                // Fetch iOS info
                if (plt === "ios" || plt === "both") {
                    try {
                        result.ios = await getIosAppInfo(id, country, { retries: 1, timeoutMs: 8000 });
                    } catch (e) {
                        errors.ios = e.message;
                        functions.logger.warn("iOS fetch error:", e.message);
                    }
                }

                // Fetch Android info
                if (plt === "android" || plt === "both") {
                    try {
                        result.android = await getAndroidAppInfo(id, country, "en", { retries: 1, timeoutMs: 10000 });
                    } catch (e) {
                        errors.android = e.message;
                        functions.logger.warn("Android fetch error:", e.message);
                    }
                }

                if (Object.keys(errors).length > 0) {
                    result.errors = errors;
                    result.status = "partial_success";
                }

                // Check if nothing found at all
                const notFound =
                    (plt === "both" && result.ios === null && result.android === null) ||
                    (plt === "ios" && result.ios === null) ||
                    (plt === "android" && result.android === null);

                if (notFound && Object.keys(errors).length === 0) {
                    return res.status(404).json({
                        status: "not_found",
                        error: "App not found on the selected platform(s)",
                        bundleId: id,
                        platform: plt,
                        country,
                    });
                }

                if (notFound && Object.keys(errors).length > 0) {
                    result.status = "source_error";
                }

                setCachedResult(cacheKey, result);
                return res.status(200).json(result);
            } catch (e) {
                functions.logger.error("Unexpected error:", e);
                return res.status(500).json({ error: "Internal server error", detail: e.message });
            }
        });
    });
