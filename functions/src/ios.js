const fetch = require("node-fetch");

const ITUNES_LOOKUP_URL = "https://itunes.apple.com/lookup";

function mapItunesApp(app) {
  const fileSizeBytes = app.fileSizeBytes
    ? parseInt(app.fileSizeBytes, 10)
    : null;

  return {
    platform: "ios",
    bundleId: app.bundleId,
    name: app.trackName,
    version: app.version || null,
    icon: app.artworkUrl512 || app.artworkUrl100 || app.artworkUrl60 || null,
    rating: app.averageUserRating
      ? parseFloat(app.averageUserRating.toFixed(1))
      : null,
    ratingCount: app.userRatingCount || 0,
    developer: app.sellerName || null,
    developerId: app.artistId || null,
    minOsVersion: app.minimumOsVersion || null,
    fileSizeBytes: app.fileSizeBytes || null,
    fileSizeMB: fileSizeBytes
      ? (fileSizeBytes / 1024 / 1024).toFixed(1)
      : null,
    releaseDate: app.releaseDate || null,
    currentVersionReleaseDate: app.currentVersionReleaseDate || null,
    releaseNotes: app.releaseNotes || null,
    description: app.description || null,
    genres: app.genres || [],
    primaryGenre: app.primaryGenreName || null,
    contentAdvisoryRating: app.contentAdvisoryRating || null,
    languages: app.languageCodesISO2A || [],
    storeUrl: app.trackViewUrl || null,
    price: app.price ?? 0,
    currency: app.currency || "USD",
    supportedDevices: app.supportedDevices || [],
  };
}

/**
 * Fetch app information from Apple iTunes Lookup API.
 * Always fetches fresh data — no caller-level caching for version accuracy.
 *
 * @param {string} bundleId - iOS bundle id
 * @param {string} country  - Two-letter country code (default: "us")
 * @param {object} options  - { timeoutMs }
 */
async function getIosAppInfo(bundleId, country = "us", options = {}) {
  const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : 8000;
  const url = `${ITUNES_LOOKUP_URL}?bundleId=${encodeURIComponent(bundleId)}&country=${encodeURIComponent(country)}&limit=1`;

  const response = await fetch(url, { timeout: timeoutMs });
  if (!response.ok) {
    throw new Error(`iTunes API error: ${response.status}`);
  }

  const data = await response.json();
  if (!data.results || data.results.length === 0) {
    return null;
  }

  return mapItunesApp(data.results[0]);
}

module.exports = { getIosAppInfo };
