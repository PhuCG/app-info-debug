const { getIosAppInfo } = require("../src/ios");
const { getAndroidAppInfo } = require("../src/android");

// ─── Constants ────────────────────────────────────────────────────────────────

const ALLOWED_PLATFORMS = new Set(["ios", "android", "both"]);
const BUNDLE_ID_REGEX = /^[a-z0-9](?:[a-z0-9._-]{0,253}[a-z0-9])?$/i;
const COUNTRY_REGEX = /^[a-z]{2}$/i;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_PER_WINDOW = 60;

// ─── Rate limiter (in-memory, best-effort per serverless instance) ─────────────

const requestBuckets = new Map();

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

function isRateLimited(ip) {
  const now = Date.now();
  const bucket = requestBuckets.get(ip);
  if (!bucket || now - bucket.windowStart > RATE_WINDOW_MS) {
    requestBuckets.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT_PER_WINDOW;
}

// ─── Input validation ─────────────────────────────────────────────────────────

function getScalar(value) {
  return Array.isArray(value) ? value[0] : value;
}

function validateQuery(query) {
  const rawBundleId = getScalar(query.bundleId);
  const rawPlatform = getScalar(query.platform) || "both";
  const rawCountry = getScalar(query.country) || "us";

  if (typeof rawBundleId !== "string" || !rawBundleId.trim()) {
    return { error: "Missing required parameter: bundleId" };
  }

  const bundleId = rawBundleId.trim().toLowerCase();
  if (!BUNDLE_ID_REGEX.test(bundleId)) {
    return { error: "Invalid bundleId format" };
  }

  const platform = String(rawPlatform).trim().toLowerCase();
  if (!ALLOWED_PLATFORMS.has(platform)) {
    return { error: "Invalid platform. Must be: ios | android | both" };
  }

  const country = String(rawCountry).trim().toLowerCase();
  if (!COUNTRY_REGEX.test(country)) {
    return { error: "Invalid country. Must be ISO 2-letter code, e.g. us, vn" };
  }

  return { bundleId, platform, country };
}

// ─── CORS ─────────────────────────────────────────────────────────────────────

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

// ─── Handler ──────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "Too many requests. Please wait and try again." });
  }

  const validated = validateQuery(req.query || {});
  if (validated.error) {
    return res.status(400).json({ error: validated.error });
  }

  const { bundleId, platform, country } = validated;
  const startTime = Date.now();
  const errors = {};
  let iosData = null;
  let androidData = null;

  try {
    // Fetch iOS and Android in parallel when platform=both for faster response
    if (platform === "both") {
      const [iosResult, androidResult] = await Promise.allSettled([
        getIosAppInfo(bundleId, country, { timeoutMs: 8000 }),
        getAndroidAppInfo(bundleId, country, "en", { timeoutMs: 12000 }),
      ]);

      if (iosResult.status === "fulfilled") {
        iosData = iosResult.value;
      } else {
        errors.ios = iosResult.reason?.message || "Unknown iOS error";
        console.warn(`[appinfo] iOS error for ${bundleId}:`, errors.ios);
      }

      if (androidResult.status === "fulfilled") {
        androidData = androidResult.value;
      } else {
        errors.android = androidResult.reason?.message || "Unknown Android error";
        console.warn(`[appinfo] Android error for ${bundleId}:`, errors.android);
      }
    } else if (platform === "ios") {
      try {
        iosData = await getIosAppInfo(bundleId, country, { timeoutMs: 8000 });
      } catch (e) {
        errors.ios = e.message;
        console.warn(`[appinfo] iOS error for ${bundleId}:`, e.message);
      }
    } else {
      try {
        androidData = await getAndroidAppInfo(bundleId, country, "en", { timeoutMs: 12000 });
      } catch (e) {
        errors.android = e.message;
        console.warn(`[appinfo] Android error for ${bundleId}:`, e.message);
      }
    }

    const hasErrors = Object.keys(errors).length > 0;
    const iosNotFound = (platform === "ios" || platform === "both") && iosData === null;
    const androidNotFound = (platform === "android" || platform === "both") && androidData === null;
    const allNotFound =
      (platform === "both" && iosNotFound && androidNotFound) ||
      (platform === "ios" && iosNotFound) ||
      (platform === "android" && androidNotFound);

    // Determine overall status
    let status = "success";
    if (allNotFound && !hasErrors) {
      return res.status(404).json({
        status: "not_found",
        bundleId,
        platform,
        country,
        error: "App not found on the selected platform(s)",
      });
    }
    if (allNotFound && hasErrors) status = "source_error";
    else if (hasErrors) status = "partial_success";

    const response = {
      status,
      bundleId,
      platform,
      country,
      latencyMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };

    if (platform === "ios" || platform === "both") response.ios = iosData;
    if (platform === "android" || platform === "both") response.android = androidData;
    if (hasErrors) response.errors = errors;

    return res.status(200).json(response);
  } catch (e) {
    console.error("[appinfo] Unexpected error:", e);
    return res.status(500).json({ error: "Internal server error", detail: e.message });
  }
};
