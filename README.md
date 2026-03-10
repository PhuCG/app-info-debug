# Bundle ID App Info Checker (Vercel)

Lookup live App Store / Google Play information by **bundle id / package name**.

- **Web UI**: `https://bundle-id-debug.vercel.app/`
- **API endpoint**: `GET /api/appinfo`

## API Usage

### Query params

- **bundleId** (required): app bundle id / package name
- **platform** (optional): `ios` | `android` | `both` (default: `both`)
- **country** (optional): 2-letter country code (default: `us`)

### Examples

Android:

```bash
curl "https://bundle-id-debug.vercel.app/api/appinfo?bundleId=com.konnect.konnect&platform=android"
```

iOS:

```bash
curl "https://bundle-id-debug.vercel.app/api/appinfo?bundleId=com.burningb.visitkorea&platform=ios"
```

Both:

```bash
curl "https://bundle-id-debug.vercel.app/api/appinfo?bundleId=com.burningb.visitkorea&platform=both"
```

## Notes about versions

- **iOS**: `version` is returned from Apple iTunes Lookup API.
- **Android**: Google Play sometimes returns `version: "VARY"` (meaning *Varies with device*). This is not an API bug; the store itself does not always expose a single version string.
- **Build version / build number** is generally **not available** from the public store endpoints used here.

## Local development

Install:

```bash
npm install
```

Run local serverless dev:

```bash
npx vercel dev
```

Then open:

- UI: `http://localhost:3000/`
- API: `http://localhost:3000/api/appinfo?bundleId=com.konnect.konnect&platform=android`

## Deploy

```bash
npx vercel --prod
```

## Project structure

- `api/appinfo.js`: Vercel Serverless Function (API)
- `src/ios.js`: iOS store fetcher
- `src/android.js`: Android store fetcher (google-play-scraper + HTML fallback)
- `public/index.html`: Web UI
