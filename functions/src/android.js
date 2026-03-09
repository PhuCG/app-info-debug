const gplay = require("google-play-scraper");

/**
 * Fetch app information from Google Play Store.
 * @param {string} packageName - Android package name
 * @param {string} country - Two-letter country code
 * @param {string} lang - Language code
 */
async function getAndroidAppInfo(packageName, country = "us", lang = "en", options = {}) {
    const retries = Number.isInteger(options.retries) ? options.retries : 1;
    const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : 10000;

    const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Google Play request timeout")), ms);
        promise
            .then((value) => {
                clearTimeout(timer);
                resolve(value);
            })
            .catch((error) => {
                clearTimeout(timer);
                reject(error);
            });
    });

    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            const app = await withTimeout(gplay.app({
                appId: packageName,
                country: country,
                lang: lang,
            }), timeoutMs);

            return {
                platform: "android",
                bundleId: app.appId,
                name: app.title,
                version: app.version,
                icon: app.icon,
                rating: app.score ? parseFloat(app.score.toFixed(1)) : null,
                ratingCount: app.ratings || 0,
                developer: app.developer,
                developerId: app.developerId,
                developerEmail: app.developerEmail,
                developerWebsite: app.developerWebsite,
                minAndroidVersion: app.androidVersionText || null,
                minAndroidVersionCode: app.androidVersion || null,
                fileSizeBytes: null,
                fileSizeMB: null,
                released: app.released,
                updated: app.updated ? new Date(app.updated).toISOString() : null,
                recentChanges: app.recentChanges || null,
                description: app.description,
                summary: app.summary,
                genre: app.genre,
                genreId: app.genreId,
                contentRating: app.contentRating,
                adSupported: app.adSupported,
                containsAds: app.containsAds,
                inAppPurchases: app.offersIAP,
                free: app.free,
                price: app.price,
                currency: app.currency,
                installs: app.installs,
                minInstalls: app.minInstalls,
                storeUrl: app.url,
                headerImage: app.headerImage,
                screenshots: (app.screenshots || []).slice(0, 3),
            };
        } catch (err) {
            if (err.message && err.message.includes("App not found")) {
                return null;
            }
            lastError = err;
            if (attempt < retries) {
                await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 300));
            }
        }
    }

    throw lastError;
}

module.exports = { getAndroidAppInfo };
