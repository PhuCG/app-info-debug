// Monkey-patch google-play-scraper: extractCategories crashes on undefined input
// for apps that have no secondary categories (e.g. newly published apps).
const gplayHelpers = require("google-play-scraper/lib/utils/mappingHelpers");
const _origExtractCategories = gplayHelpers.extractCategories;
gplayHelpers.extractCategories = function patchedExtractCategories(arr, categories = []) {
  if (!arr) return categories;
  return _origExtractCategories.call(this, arr, categories);
};

const gplay = require("google-play-scraper");
const fetch = require("node-fetch");

const PLAY_STORE_BASE = "https://play.google.com/store/apps/details";

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractMetaContent(html, property) {
  const match = html.match(
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']`, "i")
  );
  return match ? decodeHtml(match[1]) : null;
}

function parseJsonSafe(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function extractSoftwareAppJsonLd(html) {
  const re = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const parsed = parseJsonSafe(m[1].trim());
    if (!parsed) continue;
    const items = Array.isArray(parsed) ? parsed : parsed["@graph"] ? parsed["@graph"] : [parsed];
    const found = items.find((item) => item && item["@type"] === "SoftwareApplication");
    if (found) return found;
  }
  return null;
}

function mapGplayApp(app) {
  return {
    platform: "android",
    bundleId: app.appId,
    name: app.title,
    version: app.version || null,
    icon: app.icon || null,
    rating: app.score ? parseFloat(app.score.toFixed(1)) : null,
    ratingCount: app.ratings || 0,
    developer: app.developer || null,
    developerId: app.developerId || null,
    developerEmail: app.developerEmail || null,
    developerWebsite: app.developerWebsite || null,
    minAndroidVersion: app.androidVersionText || null,
    minAndroidVersionCode: app.androidVersion || null,
    releaseDate: app.released || null,
    updated: app.updated ? new Date(app.updated).toISOString() : null,
    recentChanges: app.recentChanges || null,
    description: app.description || null,
    summary: app.summary || null,
    genre: app.genre || null,
    genreId: app.genreId || null,
    contentRating: app.contentRating || null,
    adSupported: app.adSupported ?? null,
    containsAds: app.containsAds ?? null,
    inAppPurchases: app.offersIAP ?? null,
    free: app.free ?? true,
    price: app.price ?? 0,
    currency: app.currency || "USD",
    installs: app.installs || null,
    minInstalls: app.minInstalls || null,
    storeUrl: app.url || null,
    headerImage: app.headerImage || null,
    screenshots: (app.screenshots || []).slice(0, 3),
  };
}

async function fetchFromPlayWeb(packageName, country, lang, timeoutMs) {
  const url = `${PLAY_STORE_BASE}?id=${encodeURIComponent(packageName)}&hl=${lang}&gl=${country}`;
  const response = await fetch(url, {
    timeout: timeoutMs,
    headers: {
      "user-agent": "Mozilla/5.0",
      "accept-language": `${lang}-${country.toUpperCase()},en;q=0.9`,
    },
  });

  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Play Store HTTP ${response.status}`);

  const html = await response.text();
  const lower = html.toLowerCase();
  if (lower.includes("requested url was not found") || lower.includes("item not found")) {
    return null;
  }

  const ld = extractSoftwareAppJsonLd(html);
  const titleRaw = extractMetaContent(html, "og:title");
  const name = titleRaw
    ? titleRaw.replace(/\s*-\s*apps on google play\s*$/i, "").trim()
    : ld?.name || null;
  const icon = extractMetaContent(html, "og:image");
  const description = extractMetaContent(html, "og:description");
  const installsMatch = html.match(/"numDownloads":"([^"]+)"/);

  if (!name && !ld) return null;

  return {
    platform: "android",
    bundleId: packageName,
    name: name || packageName,
    version: ld?.softwareVersion || null,
    icon: icon || null,
    rating: ld?.aggregateRating?.ratingValue
      ? parseFloat(ld.aggregateRating.ratingValue)
      : null,
    ratingCount: ld?.aggregateRating?.ratingCount || 0,
    developer: ld?.author?.name || null,
    developerId: null,
    developerEmail: null,
    developerWebsite: null,
    minAndroidVersion: null,
    minAndroidVersionCode: null,
    releaseDate: ld?.datePublished || null,
    updated: null,
    recentChanges: null,
    description: description || ld?.description || null,
    summary: description || ld?.description || null,
    genre: ld?.applicationCategory || null,
    genreId: null,
    contentRating: ld?.contentRating || null,
    adSupported: null,
    containsAds: null,
    inAppPurchases: null,
    free: true,
    price: 0,
    currency: "USD",
    installs: installsMatch ? installsMatch[1] : null,
    minInstalls: null,
    storeUrl: url,
    headerImage: null,
    screenshots: [],
  };
}

/**
 * Fetch app information from Google Play Store.
 * Primary: google-play-scraper (full data including version).
 * Fallback: direct HTML parse (basic data when scraper fails).
 *
 * @param {string} packageName - Android package name
 * @param {string} country     - Two-letter country code (default: "us")
 * @param {string} lang        - Language code (default: "en")
 * @param {object} options     - { timeoutMs }
 */
async function getAndroidAppInfo(packageName, country = "us", lang = "en", options = {}) {
  const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : 10000;

  const withTimeout = (promise) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Google Play request timeout")),
        timeoutMs
      );
      promise.then(
        (val) => { clearTimeout(timer); resolve(val); },
        (err) => { clearTimeout(timer); reject(err); }
      );
    });

  try {
    const app = await withTimeout(
      gplay.app({ appId: packageName, country, lang })
    );
    return mapGplayApp(app);
  } catch (scraperError) {
    if (scraperError.message && scraperError.message.includes("App not found")) {
      return null;
    }
    // Scraper failed for non-404 reason (parser error, timeout, etc.)
    // Fall through to HTML fallback.
    console.warn(`gplay scraper failed for ${packageName}: ${scraperError.message}`);
  }

  return fetchFromPlayWeb(packageName, country, lang, timeoutMs);
}

module.exports = { getAndroidAppInfo };
