# Label Site Generator

Static website generator for independent music labels and bands. Scrapes Bandcamp, enriches with streaming links from 7+ platforms, generates a complete branded website.

[See it live](https://aenaos-records.com) | [Quickstart](QUICKSTART.md) | [Full Documentation](https://github.com/falkmerten/label-site-generator/wiki)

---

## Features

- **Two site modes**: `label` (multi-artist roster) or `artist` (single band website)
- **Built-in theme system**: `standard` (light), `dark`, `bandcamp` (auto-colors from your page)
- Automatic Bandcamp scraping (label and artist/band accounts)
- Streaming link enrichment from Soundcharts, Spotify, Apple Music, Deezer, Tidal, MusicFetch, YouTube
- Physical release data from Discogs (Vinyl, CD, Cassette, sell links)
- Tour dates from Soundcharts, Bandsintown, and local files
- Newsletter integration (Sendy, Listmonk, Keila) with auto-campaign drafts
- Ghost CMS for news (headless mode with local file fallback)
- Upcoming releases with three-tier system (announce, preview, full)
- SEO optimized (JSON-LD, Open Graph, sitemap, RSS feed)
- One-command deploy to AWS S3 + CloudFront

---

## Quick Start

```bash
git clone https://github.com/falkmerten/label-site-generator.git
cd label-site-generator
npm install
cp .env.example .env    # edit with your Bandcamp URL
node generate.js        # scrape + build -> dist/
```

See [QUICKSTART.md](QUICKSTART.md) for setup details and optional enrichment.

---

## Configuration

Essential settings in `.env` (see [.env.example](.env.example) for the full reference):

| Variable | Description |
|---|---|
| `BANDCAMP_URL` | Your Bandcamp page URL (label or artist/band — auto-detected) |
| `SITE_NAME` | Display name for header, titles, footer |
| `SITE_URL` | Full site URL with trailing slash (for canonical URLs, sitemap, OG tags) |
| `SITE_THEME` | Theme: `standard`, `dark`, or `bandcamp` (default: `standard`) |
| `SITE_MODE` | Mode: `label` or `artist` (default: `label`) |

### Enrichment APIs

| Variable | Service |
|---|---|
| `SOUNDCHARTS_APP_ID` / `SOUNDCHARTS_API_KEY` | Soundcharts (recommended — all-in-one enrichment) |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | Spotify (album matching, UPC extraction) |
| `DISCOGS_TOKEN` | Discogs (physical formats, sell links) |
| `TIDAL_CLIENT_ID` / `TIDAL_CLIENT_SECRET` | Tidal streaming links |

See the [API Setup wiki page](https://github.com/falkmerten/label-site-generator/wiki/API-Setup) for credential setup instructions.

---

## CLI

```bash
node generate.js                    # generate from cache
node generate.js --scrape           # re-scrape Bandcamp
node generate.js --enrich           # fetch streaming links (incremental)
node generate.js --scrape --enrich --artist "Name"  # re-scrape + enrich one artist
node generate.js --deploy           # generate + sync to S3 + CloudFront invalidation
node generate.js --cleanup          # data quality audit (dry-run)
```

Additional flags: `--force`, `--sync-youtube`, `--import-subscribers`, `--sales-report`, `--init-artists`, `--init-content`. Run `node generate.js --help` for the full list.

---

## Documentation

Full documentation is in the [Wiki](https://github.com/falkmerten/label-site-generator/wiki):

- [Configuration](https://github.com/falkmerten/label-site-generator/wiki/Configuration) — All env vars
- [API Setup](https://github.com/falkmerten/label-site-generator/wiki/API-Setup) — Credential setup for all services
- [Templates and Modules](https://github.com/falkmerten/label-site-generator/wiki/Templates-and-Modules) — Template structure, theme system
- [Template Blueprint](https://github.com/falkmerten/label-site-generator/wiki/Template-Blueprint) — Custom theme creation guide
- [FAQ](https://github.com/falkmerten/label-site-generator/wiki/FAQ) — Common questions and troubleshooting
- [Security](https://github.com/falkmerten/label-site-generator/wiki/Security) — Security policy

---

## Deployment

```bash
node generate.js --deploy
```

Generates the site, syncs `dist/` to S3, and invalidates CloudFront. Requires `AWS_S3_BUCKET` and `AWS_CLOUDFRONT_DISTRIBUTION_ID` in `.env`.

---

## Support

If you find this tool useful for your label or band, you can support the ongoing work behind it.

[Support via Buy Me a Coffee](https://buymeacoffee.com/aenaosrecords) | [Support via PayPal](https://paypal.me/afmusic)

---

GPL-3.0 — see [LICENSE](LICENSE) for details.
