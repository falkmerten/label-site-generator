# Quickstart

Create a website from your Bandcamp catalog.

## Which setup are you?

Before starting, identify your situation:

### 1. Label with a Bandcamp Label account
Your Bandcamp page has an `/artists` section with multiple artists listed. This is the standard label setup.

### 2. Label using a Bandcamp Artist account
You operate as a label (multiple projects/artists), but your Bandcamp page is technically a normal artist account. The generator handles this via album regrouping — it splits releases by the artist field.

### 3. Artist/Band with a Bandcamp Artist account
The website is for one band, solo artist, or project.

---

## Prerequisites

- Node.js 18+
- A Bandcamp page (label or artist)

## 1. Install

```bash
git clone https://github.com/falkmerten/label-site-generator.git
cd label-site-generator
npm install
```

## 2. Configure

Create a `.env` file:

```env
BANDCAMP_URL=https://your-label.bandcamp.com/
SITE_MODE=label
```

Use `SITE_MODE=artist` only for setup 3 (single band). For setups 1 and 2, use `label`.

### Optional: Choose a theme

```env
SITE_THEME=dark
```

Available: `standard` (default), `dark`, `bandcamp` (auto-colors from your page).

## 3. Export Bandcamp CSV (optional, recommended)

Before running the generator, export your Digital Catalog Report from Bandcamp:

**Bandcamp → Settings → Tools → Digital Catalog Report → Download CSV**

Place the file in `content/` (filename: `{date}_{slug}_digital.csv`).

This provides reliable UPC and ISRC data without any API calls. The generator detects it automatically.

> Without the CSV, the generator still works — but UPC/ISRC matching for enrichment is less reliable.

## 4. Generate

```bash
node generate.js
```

First run (1-2 minutes): Scrapes Bandcamp, downloads artwork, creates `content/config.json`, builds website to `dist/`.

Subsequent runs (2-3 seconds): Rebuilds from cache, no network requests.

## 5. View locally

```bash
npx serve dist
```

Open `http://localhost:3000`.

## 6. Enrich with streaming links (optional)

### Basic: Spotify links

Get credentials from [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard):

```env
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
```

```bash
node generate.js --enrich
```

Adds Spotify, Apple Music, and Deezer links. ~3-5 API calls per artist.

### Recommended for labels: Soundcharts

For full metadata (UPC, ISRCs, all platforms, labels), configure Soundcharts:

```env
SOUNDCHARTS_APP_ID=your_app_id
SOUNDCHARTS_API_KEY=your_api_key
```

Soundcharts provides everything in one API — fewer calls, more data, no rate limit issues. See [API-SETUP.md](API-SETUP.md).

### Physical releases: Discogs

For vinyl/CD/cassette format display and sell links:

```env
DISCOGS_TOKEN=your_token
```

## 7. Add content

| Content | Location |
|---------|----------|
| Artist bio | `content/{artist-slug}/bio.md` |
| Artist photo | `content/{artist-slug}/photo.jpg` |
| News articles | `content/news/2026/MM-DD-slug.md` |
| Static pages | `content/pages/imprint.md` |
| Album artwork | `content/{artist-slug}/{album-slug}/artwork.jpg` |

## 8. Add a new artist

Edit `content/config.json`:

```json
"new-artist": {
  "name": "New Artist",
  "enabled": true,
  "bandcampUrl": "https://newartist.bandcamp.com/",
  "links": { "spotify": null }
}
```

Then: `node generate.js --scrape`

## 9. Deploy (optional)

```env
AWS_S3_BUCKET=your-bucket-name
AWS_S3_REGION=eu-central-1
AWS_CLOUDFRONT_DISTRIBUTION_ID=EXXXXXXXXX
```

```bash
node generate.js --deploy
```

## Day-to-day usage

| Task | Command |
|------|---------|
| Rebuild (local changes) | `node generate.js` |
| New release on Bandcamp | `node generate.js --scrape` |
| Update streaming links | `node generate.js --enrich` |
| Full update + deploy | `node generate.js --scrape --enrich --deploy` |
| One artist only | `node generate.js --scrape --artist "Name"` |

## Metadata quality levels

| Level | Data source | What you get |
|---|---|---|
| Basic | Bandcamp only | Website with Bandcamp links, artwork, bios |
| + CSV | Bandcamp + Digital Catalog CSV | + reliable UPC/ISRC |
| + Spotify | + Spotify API | + streaming links (Spotify, Apple, Deezer) |
| + Discogs | + Discogs API | + physical formats, sell links |
| Full | + Soundcharts | + all platforms, labels, social, events |

## Merchandise

Merchandise support is planned for v5.1 (LSG-144). Currently, link to your Bandcamp merch page from a static page (`content/pages/shop.md`).

## Migrating from v4

```bash
node generate.js --migrate
```

See [README.md](README.md) for details.
