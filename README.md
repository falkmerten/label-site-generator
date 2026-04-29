# Label Site Generator

Static website generator for independent music labels and bands. Scrapes Bandcamp, enriches with streaming links from 7+ platforms, generates a complete branded website.

[See it live](https://aenaos-records.com) | [Quickstart](QUICKSTART.md) | [Full Documentation](https://github.com/falkmerten/label-site-generator/wiki)

---

## Features

- Automatic Bandcamp scraping (label and artist/band accounts)
- Streaming link enrichment from Soundcharts, Spotify, Apple Music, Deezer, Tidal, MusicFetch, YouTube
- Physical release data from Discogs (Vinyl, CD, Cassette, sell links)
- Tour dates from Soundcharts, Bandsintown, and local files
- Newsletter integration (Sendy, Listmonk, Keila) with auto-campaign drafts
- Ghost CMS for news (headless mode with local file fallback)
- Bandcamp theme colors auto-applied as CSS variables
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
| `BANDCAMP_URL` | Your Bandcamp page URL (label or artist/band - auto-detected) |
| `SITE_NAME` | Display name for header, titles, footer |
| `SITE_URL` | Full site URL with trailing slash (for canonical URLs, sitemap, OG tags) |
| `SITE_EMAIL` | Contact email (Imprint, newsletter error messages) |
| `SITE_ADDRESS` | Postal address (Imprint page) |
| `SITE_VAT_ID` | VAT ID (Imprint page) |
| `LABEL_ALIASES` | Alternative label names for enrichment matching (comma-separated) |

Legacy `LABEL_NAME`, `LABEL_EMAIL`, `LABEL_ADDRESS`, `LABEL_VAT_ID` still work as fallbacks.

### Enrichment APIs

| Variable | Service |
|---|---|
| `SOUNDCHARTS_APP_ID` / `SOUNDCHARTS_API_KEY` | Soundcharts (recommended - all-in-one enrichment) |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | Spotify (album matching, UPC extraction) |
| `DISCOGS_TOKEN` | Discogs (physical formats, sell links) |
| `TIDAL_CLIENT_ID` / `TIDAL_CLIENT_SECRET` | Tidal streaming links |

See [API-SETUP.md](API-SETUP.md) for credential setup instructions.

---

## CLI

```bash
node generate.js                    # generate from cache
node generate.js --scrape           # re-scrape Bandcamp
node generate.js --enrich           # fetch streaming links (incremental)
node generate.js --scrape --enrich --artist "Name"  # re-scrape + enrich one artist
node generate.js --deploy           # generate + sync to S3 + CloudFront invalidation
node generate.js --cleanup          # data quality audit (dry-run)
node generate.js --init-artists     # auto-generate content/artists.json
node generate.js --init-content     # scaffold content folders
```

Additional flags: `--force` (re-enrich all), `--sync-youtube`, `--import-subscribers`, `--sales-report`, `--analyze-csv`, `--fill-gaps`. Run `node generate.js --help` for the full list.

---

## Content Directory

```
content/
  artists.json               # Spotify artist URL map (--init-artists)
  upcoming.json              # Upcoming releases (private Bandcamp links)
  compilations.json          # Spotify IDs for Various Artists compilations
  stores.json                # Extra search-based physical stores
  news/2026/MM-DD-slug.md    # News articles (or use Ghost CMS)
  pages/about.md             # Homepage section
  pages/imprint.md           # Footer page (also supports .docx)
  {artist-slug}/
    bio.md                   # Artist biography (or bio.docx)
    photo.jpg                # Artist photo (hero banner)
    images/01.jpg            # Gallery photos
    tourdates.json           # Manual tour dates
    bandsintown.json         # Bandsintown fan engagement config
    links.json               # Manual social/streaming link overrides
    {album-slug}/
      artwork.jpg            # Album artwork override
      videos.json            # YouTube videos
      stores.json            # Custom store links or { "hidePhysical": true }
      reviews.md             # Press quotes
```

---

## Source Modules

| Module | Description |
|---|---|
| `src/generator.js` | Top-level pipeline: cache - merge - render - assets - summary |
| `src/scraper.js` | Orchestrates Bandcamp scraping for the full roster |
| `src/bandcamp.js` | Bandcamp HTML scraper |
| `src/bandcampApi.js` | Bandcamp OAuth2 API client |
| `src/enricher.js` | Enrichment pipeline orchestrator (Soundcharts or legacy mode) |
| `src/soundcharts.js` | Soundcharts API: streaming links, social, events, metadata |
| `src/spotify.js` | Spotify Web API: album matching, UPC extraction |
| `src/discogs.js` | Discogs API: physical formats, labels, sell links |
| `src/itunes.js` | iTunes/Apple Music API (gap-fill) |
| `src/deezer.js` | Deezer API (gap-fill) |
| `src/tidal.js` | Tidal API (gap-fill) |
| `src/merger.js` | Merges cache data with content overrides |
| `src/renderer.js` | Renders HTML pages via Nunjucks |
| `src/content.js` | Loads content overrides and discovers pages |
| `src/assets.js` | Static assets, stylesheet, auto-logo |
| `src/cache.js` | JSON cache read/write with atomic writes |
| `src/upcoming.js` | Upcoming releases (three-tier: announce, preview, full) |
| `src/news.js` | Local news article loader |
| `src/ghost.js` | Ghost Content API client |
| `src/newsletterCampaign.js` | Auto-creates campaign drafts (Sendy/Listmonk/Keila) |
| `src/bandsintown.js` | Bandsintown API: artist info, events, fan engagement |
| `src/refreshArtist.js` | Single-artist re-scrape with enrichment preservation |
| `src/slugs.js` | Slug generation (NFD normalization for accented characters) |
| `src/importCsv.js` | Bandcamp CSV import and gap analysis |
| `src/imageOptimizer.js` | Image resize + WebP conversion |
| `src/redirects.js` | Old URL redirect generation |

---

## Templates

Nunjucks templates in `templates/`:

| Template | Page |
|---|---|
| `base.njk` | Shared layout (hero, nav, footer) |
| `index.njk` | Homepage (artists, releases, news) |
| `artist.njk` | Artist page (bio, gallery, events, discography) |
| `album.njk` | Album page (player, streaming, physical, videos) |
| `releases.njk` | Full releases listing |
| `page.njk` | Static pages (Imprint, Contact, custom) |
| `news-list.njk` | News listing with pagination |
| `news-article.njk` | Individual news article |

---

## Deployment

```bash
node generate.js --deploy
```

Generates the site, syncs `dist/` to S3, and invalidates CloudFront. Requires `AWS_S3_BUCKET` and `AWS_CLOUDFRONT_DISTRIBUTION_ID` in `.env`.

See the [full documentation](https://github.com/falkmerten/label-site-generator/wiki) for S3/CloudFront setup details.

---

## Acknowledgments

Inspired by [bandcamp-scraper](https://github.com/masterT/bandcamp-scraper) by [masterT](https://github.com/masterT).

---

## Support

If you find this tool useful for your label or band, you can support the ongoing work behind it.

[Support via Buy Me a Coffee](https://buymeacoffee.com/aenaosrecords) | [Support via PayPal](https://paypal.me/afmusic)

No perks, no tiers - just a way to keep things running.

---

GPL-3.0 - see [LICENSE](LICENSE) for details.
