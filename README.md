# Label Site Generator

Static website generator for independent music labels and bands. Scrapes Bandcamp, enriches with streaming links, generates a complete branded website.

[See it live](https://aenaos-records.com) | [Quickstart](QUICKSTART.md) | [Full Documentation](https://github.com/falkmerten/label-site-generator/wiki)

---

## Features

- **One-command setup**: Set `BANDCAMP_URL`, run `node generate.js`, get a website
- **Two site modes**: `label` (multi-artist roster) or `artist` (single band website)
- **Built-in themes**: `standard` (light), `dark`, `bandcamp` (auto-colors from your page)
- **Single config file**: All content configuration in `content/config.json` (auto-generated on first run)
- Streaming link enrichment (Spotify, Apple Music, Deezer, Tidal)
- Full metadata enrichment via Soundcharts (recommended for labels with 50+ releases)
- Physical release data from Discogs (Vinyl, CD, Cassette, sell links)
- Tour dates from Bandsintown
- Newsletter integration (Sendy, Listmonk, Keila) with auto-campaign drafts
- Ghost CMS for news (headless mode with local file fallback)
- SEO optimized (JSON-LD, Open Graph, sitemap, RSS feed)
- One-command deploy to AWS S3 + CloudFront

---

## Quick Start

```bash
git clone https://github.com/falkmerten/label-site-generator.git
cd label-site-generator
npm install
```

Create `.env` with one line:

```env
BANDCAMP_URL=https://your-label.bandcamp.com/
```

Run:

```bash
node generate.js
```

That's it. The generator detects your account type, asks a few questions (theme, extra artists), scrapes your Bandcamp page, creates `content/config.json`, and builds a complete website to `dist/`.

Use `--yes` to skip prompts (non-interactive mode).

---

## Configuration

### `.env` — Secrets only

The `.env` file contains only API credentials:

| Variable | Required | Description |
|---|---|---|
| `BANDCAMP_URL` | Yes | Your Bandcamp page URL |
| `BANDCAMP_CLIENT_ID` / `SECRET` | No | Improves detection, enables connected accounts |
| `SPOTIFY_CLIENT_ID` / `SECRET` | No | For streaming link enrichment |
| `SOUNDCHARTS_APP_ID` / `API_KEY` | No | For full metadata enrichment |
| `DISCOGS_TOKEN` | No | For physical release data (only if "discogs" in stores) |
| `AWS_S3_BUCKET` | No | For deployment |

### `content/config.json` — Site configuration

Auto-generated on first run. Edit to configure your site:

```json
{
  "site": {
    "name": "Your Label",
    "url": "https://www.your-label.com/",
    "mode": "label",
    "theme": "standard",
    "template": null
  },
  "source": {
    "primary": "bandcamp",
    "url": "https://your-label.bandcamp.com/",
    "accountType": "label",
    "detection": "api_member_bands",
    "confidence": "high"
  },
  "artists": {
    "artist-slug": {
      "name": "Artist Name",
      "enabled": true,
      "bandcampUrl": "https://artist.bandcamp.com/",
      "links": { "spotify": null }
    }
  },
  "compilations": {
    "various-artists": {}
  },
  "stores": ["bandcamp"],
  "newsletter": { "provider": null }
}
```

**Adding a new artist**: Add an entry to `artists` with a `bandcampUrl`, then run `node generate.js --scrape`.

**Removing an artist**: Set `"enabled": false` or `"exclude": true`.

**Excluding albums**: Add album slugs to `"excludeAlbums": ["album-slug"]`.

---

## CLI

```bash
node generate.js                    # Generate from cache (offline, fast, ~2s)
node generate.js --scrape           # Re-scrape from Bandcamp
node generate.js --enrich           # Add streaming links (Spotify)
node generate.js --scrape --enrich  # Full update
node generate.js --deploy           # Generate + deploy to S3
node generate.js --migrate          # Convert v4 config to v5 format
```

### Filters

```bash
node generate.js --scrape --artist "Name"   # Re-scrape one artist
node generate.js --enrich --artist "Name"   # Enrich one artist
node generate.js --enrich --force           # Re-enrich already-enriched albums
```

Run `node generate.js --help` for the full list.

---

## Enrichment

### Spotify (streaming links)

The default enrichment adds Spotify, Apple Music, and Deezer links to your albums. Requires `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` in `.env`.

```bash
node generate.js --enrich
```

This makes ~3-5 API calls per artist (lightweight, no rate limit issues).

### Soundcharts (full metadata — recommended)

For professional catalog needs, Soundcharts provides UPC, ISRCs, labels, all streaming platforms, and social media links in a single API. Fewer calls, more data.

```env
SOUNDCHARTS_APP_ID=your_app_id
SOUNDCHARTS_API_KEY=your_api_key
```

See [API-SETUP.md](API-SETUP.md) for credential setup.

---

## Themes

Set `site.theme` in `config.json` (or choose during first-run prompt):

- **`standard`** — Clean light theme
- **`dark`** — Dark background, light text
- **`bandcamp`** — Auto-extracts colors from your Bandcamp page

Custom CSS: Place `style.css` in `content/global/` to override the theme entirely.

---

## Deployment

```bash
node generate.js --deploy
```

Generates the site, syncs `dist/` to S3, and invalidates CloudFront. Requires `AWS_S3_BUCKET` and `AWS_CLOUDFRONT_DISTRIBUTION_ID` in `.env`.

---

## Source Modules

| Module | Purpose |
|--------|---------|
| `generate.js` | CLI entry point |
| `src/generator.js` | Pipeline orchestrator |
| `src/scraper.js` | Bandcamp scraper (config-aware) |
| `src/enricher.js` | Enrichment pipeline (Spotify/Soundcharts/Discogs) |
| `src/configLoader.js` | Config loading with legacy fallback |
| `src/configGenerator.js` | Auto-generates config.json from scrape |
| `src/configValidator.js` | JSON Schema validation |
| `src/rateLimiter.js` | Per-service rate limiting with backoff |
| `src/migrator.js` | v4 → v5 config migration |
| `src/themeResolver.js` | Theme CSS resolution |
| `src/renderer.js` | Nunjucks template rendering |
| `src/merger.js` | Cache + content override merging |
| `src/assets.js` | Asset copying + image optimization |

---

## Support

If you find this tool useful for your label or band, you can support the ongoing work behind it.

[Support via Buy Me a Coffee](https://buymeacoffee.com/aenaosrecords) | [Support via PayPal](https://paypal.me/afmusic)

---

GPL-3.0 — see [LICENSE](LICENSE) for details.
