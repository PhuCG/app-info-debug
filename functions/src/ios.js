const fetch = require("node-fetch");

/**
 * Fetch app information from Apple iTunes Lookup API.
 * @param {string} bundleId - iOS bundle id
 * @param {string} country - Two-letter country code
 */
async function getIosAppInfo(bundleId, country = "us", options = {}) {
  const retries = Number.isInteger(options.retries) ? options.retries : 1;
  const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : 8000;
  const url = `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(bundleId)}&country=${country}&limit=1`;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, { timeout: timeoutMs });
      if (!response.ok) {
        throw new Error(`iTunes API error: ${response.status}`);
      }

      const data = await response.json();

      if (!data.results || data.results.length === 0) {
        return null;
      }

      const app = data.results[0];

      return {
        platform: "ios",
        bundleId: app.bundleId,
        name: app.trackName,
        version: app.version,
        icon: app.artworkUrl512 || app.artworkUrl100 || app.artworkUrl60,
        rating: app.averageUserRating ? parseFloat(app.averageUserRating.toFixed(1)) : null,
        ratingCount: app.userRatingCount || 0,
        developer: app.sellerName,
        developerId: app.artistId,
        minOsVersion: app.minimumOsVersion,
        fileSizeBytes: app.fileSizeBytes,
        fileSizeMB: app.fileSizeBytes ? (parseInt(app.fileSizeBytes, 10) / 1024 / 1024).toFixed(1) : null,
        releaseDate: app.releaseDate,
        currentVersionReleaseDate: app.currentVersionReleaseDate,
        releaseNotes: app.releaseNotes || null,
        description: app.description,
        genres: app.genres || [],
        primaryGenre: app.primaryGenreName,
        contentAdvisoryRating: app.contentAdvisoryRating,
        languages: app.languageCodesISO2A || [],
        storeUrl: app.trackViewUrl,
        price: app.price,
        currency: app.currency,
        supportedDevices: app.supportedDevices || [],
      };
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 250));
      }
    }
  }

  throw lastError;
}

module.exports = { getIosAppInfo };
