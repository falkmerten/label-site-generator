# Label Site Generator

Static website generator for independent music labels and bands. Supports multiple data sources (Bandcamp, Internet Archive), enriches with streaming links, generates a complete branded website.

[See it live](https://aenaos-records.com) | [Quickstart](QUICKSTART.md) | [Full Documentation](https://github.com/falkmerten/label-site-generator/wiki)

---

## Features

- **One-command setup**: Run `node generate.js`, choose your data source, get a website
- **Two site modes**: `label` (multi-artist roster) or `artist` (single band website)
- **Built-in themes**: `standard` (light), `dark`, `bandcamp` (auto-colors from your page)
- **Single config file**: All content configuration in `content/config.json` (auto-generated on first run)
- **Multiple data sources**: Bandcamp (default), Internet Archive (CC-licensed catalogs)
- Streaming link enrichment (Spotify, Apple Music, Deezer, Tidal, YouTube Music, Amazon Music)
- Automatic gap-fill via Songlink/Odesli (no API key needed)
- Artist metadata from Last.fm (bios, listener stats, tags, similar artists)
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

Run:

```bash
node generate.js
```

The interactive onboarding asks for your data source:

1. **Bandcamp** — paste your Bandcamp URL (default, most common)
2. **Internet Archive** — enter a collection identifier (for netlabels / CC catalogs)
3. **Spotify** — provide Spotify artist URLs (planned)

After source selection, the generator detects your account type, asks a few questions (theme, extra artists), scrapes your catalog, creates `content/config.json`, and builds a complete website to `dist/`.

Use `--yes` to skip prompts (non-interactive mode, requires `BANDCAMP_URL` in `.env`).

---

## Data Sources

| Source | Use case | Config |
|--------|----------|--------|
| **Bandcamp** (default) | Labels and bands with a Bandcamp page | `source.primary: "bandcamp"` |
| **Internet Archive** | Netlabels, CC-licensed catalogs, archive collections | `source.primary: "archive.org"` |

Internet Archive mode supports three strategies:
- **primary** — IA as sole data source (no Bandcamp needed)
- **secondary** — merge IA releases with Bandcamp catalog
- **archive** — fill gaps only (releases not on Bandcamp)

Set `source.ccOnly: true` to skip non-Creative Commons releases.

---

## Configuration

### `.env` — Secrets only

| Variable | Required | Description |
|---|---|---|
| `BANDCAMP_URL` | For Bandcamp source | Your Bandcamp page URL |
| `SPOTIFY_CLIENT_ID` / `SECRET` | No | For streaming link enrichment |
| `LASTFM_API_KEY` | No | For artist bios, tags, listener stats |
| `DISCOGS_TOKEN` | No | For physical release data |
| `AWS_S3_BUCKET` | No | For deployment |

Internet Archive requires no API credentials.

### `content/config.json` — Site configuration

Auto-generated on first run. Key sections:

```json
{
  "site": {
    "name": "Your Label",
    "url": "https://www.your-label.com/",
    "mode": "label",
    "theme": "standard"
  },
  "source": {
    "primary": "bandcamp",
    "url": "https://your-label.bandcamp.com/",
    "accountType": "label"
  },
  "artists": { },
  "stores": ["bandcamp"],
  "newsletter": { "provider": null }
}
```

---

## CLI

```bash
node generate.js                    # Generate from cache (offline, fast, ~2s)
node generate.js --scrape           # Re-scrape from data source
node generate.js --enrich           # Add streaming links (Spotify + gap-fill)
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

The enrichment pipeline adds streaming links and metadata to your albums:

**Spotify** → **Songlink/Odesli** → **YouTube Music** → **iTunes/Deezer/Tidal** → **Discogs**

- **Spotify** (requires API key) — Spotify, Apple Music, Deezer links
- **Songlink/Odesli** (automatic, no key) — YouTube Music, Amazon Music, SoundCloud, Pandora, Napster
- **YouTube Music** (automatic, no key) — YouTube Music search fallback
- **Last.fm** (requires API key) — Artist bios, listener stats, genre tags, similar artists
- **Discogs** (requires token) — Physical formats, sell links

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
| `src/archive.js` | Internet Archive data source |
| `src/enricher.js` | Enrichment pipeline (Spotify/Discogs/Last.fm) |
| `src/songlink.js` | Odesli API gap-fill (YouTube Music, Amazon, etc.) |
| `src/youtubeMusic.js` | YouTube Music album search |
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
