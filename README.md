# Label Site Generator

Generates a complete static website for a Bandcamp music label. Scrapes artist and album data from Bandcamp, enriches it with streaming links and physical release data from multiple APIs, merges it with local content, and renders a branded HTML site.

---

## Features

- Fetches the label roster via the **Bandcamp API** (falls back to HTML scraping)
- Supports **extra artist profiles** via `content/extra-artists.txt` or `EXTRA_ARTIST_URLS` env var
- **Caches** all scraped data to `cache.json` — subsequent runs skip Bandcamp entirely
- **Single-artist refresh** — re-scrape one artist without touching the rest
- **Soundcharts enrichment** (recommended) — all streaming links, social media, events, and metadata in ~2 API calls per album
- **Legacy enrichment** fallback via Spotify, iTunes, Deezer, Tidal, MusicFetch when Soundcharts credentials are absent
- **Physical release data** via Discogs API — formats (Vinyl, CD, Cassette), catalog number, label, sell links
- **Artist config** (`content/artists.json`) — maps artist slugs to Spotify artist URLs
- **Social media links** — auto-populated from Soundcharts (Facebook, Instagram, TikTok, X/Twitter, Linktree)
- **Upcoming shows** — tour dates from Soundcharts events, rendered on artist pages with Bandsintown/Songkick links
- **Content overrides**: artist bios (Markdown or Word .docx), photos, gallery images, album artwork
- **Upcoming releases**: private Bandcamp stream links in `content/upcoming.json` — "Coming Soon" badge on pre-orders and unreleased albums
- **Compilations**: `content/compilations.json` maps compilation slugs to Spotify album IDs — no search needed for Various Artists
- **Word document conversion** — drop `bio.docx` in an artist folder, auto-converted to `bio.md` on generate
- **Dynamic static pages** — any `.md` or `.docx` in `content/pages/` becomes a page with a footer link
- Artist pages with blurred hero banner, round artist photo, photo gallery with lightbox
- Album pages with Bandcamp embed, streaming links, physical release badges, Discogs sell link, YouTube videos
- **Branded design**: dark header, hero banner, brand colour scheme (`#0c0032` / `#cacadb`)
- Font Awesome icons throughout
- Responsive layout

---

## Requirements

- Node.js 18+
- npm (comes with Node.js)

### Required

- **Bandcamp label account** with API access — go to your Bandcamp label settings → **API Access** to obtain `CLIENT_ID` and `CLIENT_SECRET`. Without API credentials the generator falls back to HTML scraping, which is less reliable.

### Recommended (Enrichment)

- **Soundcharts API** — all streaming links, social media, events, and metadata in ~2 API calls per album. Free tier: 1,000 credits/month. [developers.soundcharts.com](https://developers.soundcharts.com)
- **Spotify API** — album catalog matching, UPC extraction, title normalization. Required for legacy mode (without Soundcharts). Free. [developer.spotify.com](https://developer.spotify.com/dashboard)
- **Discogs API** — physical release formats (Vinyl, CD, Cassette), label names, sell links. Free with personal access token. [discogs.com/settings/developers](https://www.discogs.com/settings/developers)

### Optional (Enrichment)

- **Tidal API** — Tidal streaming links. [developer.tidal.com](https://developer.tidal.com)
- **YouTube Data API** — auto-sync YouTube videos to album pages (`--sync-youtube`). [console.cloud.google.com](https://console.cloud.google.com)
- **MusicFetch API** — additional streaming platform links via RapidAPI. [rapidapi.com/musicfetch](https://rapidapi.com/musicfetch-musicfetch-default/api/musicfetch2)

### Optional (Hosting & Deployment)

- **AWS S3 + CloudFront** — static site hosting with CDN. Requires AWS CLI configured. `--deploy` flag syncs `dist/` to S3 and invalidates CloudFront.
- **Google Analytics 4** — page tracking via `GA_MEASUREMENT_ID`

### Optional (Newsletter)

- **Sendy** — self-hosted email marketing. Subscribe form on homepage, auto-campaign drafts from news articles. [sendy.co](https://sendy.co)
- **Listmonk** — self-hosted newsletter manager (Sendy alternative). Public subscription API, campaign creation via REST API. [listmonk.app](https://listmonk.app)

---

## Setup

```bash
git clone <your-repo-url>
cd <repo>
npm install
cp .env.example .env
```

Edit `.env` with your label's details. Place brand images in `assets/`:
- `assets/logo-round.png` — round logo shown overlapping the hero banner on the homepage
- `assets/banner.jpg` — wide banner image for the homepage hero

Both files are gitignored (label-specific).

---

## Configuration

All label-specific settings live in `.env` (gitignored, never committed).

| Variable | Description |
|---|---|
| **Bandcamp (required)** | |
| `BANDCAMP_CLIENT_ID` | Bandcamp API client ID (Settings → API Access) |
| `BANDCAMP_CLIENT_SECRET` | Bandcamp API client secret |
| `BANDCAMP_LABEL_URL` | Label Bandcamp URL — used as fallback for artist roster |
| **Label identity** | |
| `LABEL_NAME` | Display name shown in header, titles, footer |
| `LABEL_EMAIL` | Contact email (also shown in newsletter error messages) |
| `LABEL_ADDRESS` | Postal address for Imprint |
| `LABEL_VAT_ID` | VAT ID for Imprint |
| `SITE_URL` | Full site URL with trailing slash (e.g. `https://aenaos-records.com/`) — used for canonical URLs, sitemap, OG tags |
| `EXTRA_ARTIST_URLS` | Comma-separated extra Bandcamp artist URLs not on the label account |
| `HOMEPAGE_LABELS` | Comma-separated label names — filter which releases appear on homepage (empty = show all) |
| **Enrichment APIs** | |
| `SOUNDCHARTS_APP_ID` | Soundcharts API app ID ([developers.soundcharts.com](https://developers.soundcharts.com)) |
| `SOUNDCHARTS_API_KEY` | Soundcharts API key (free tier: 1,000 credits/month) |
| `SPOTIFY_CLIENT_ID` | Spotify app client ID ([developer.spotify.com](https://developer.spotify.com/dashboard)) |
| `SPOTIFY_CLIENT_SECRET` | Spotify app client secret |
| `DISCOGS_TOKEN` | Discogs personal access token ([discogs.com/settings/developers](https://www.discogs.com/settings/developers)) |
| `TIDAL_CLIENT_ID` | Tidal API client ID ([developer.tidal.com](https://developer.tidal.com)) |
| `TIDAL_CLIENT_SECRET` | Tidal API client secret |
| `MUSICFETCH_RAPIDAPI_KEY` | MusicFetch API key via RapidAPI (optional, legacy fallback) |
| `YOUTUBE_API_KEY` | YouTube Data API v3 key — for `--sync-youtube` ([console.cloud.google.com](https://console.cloud.google.com)) |
| **Social links (footer)** | |
| `LABEL_BANDCAMP_URL` | Label Bandcamp URL |
| `LABEL_SPOTIFY_URL` | Spotify profile URL |
| `LABEL_SOUNDCLOUD_URL` | SoundCloud URL |
| `LABEL_YOUTUBE_URL` | YouTube channel URL |
| `LABEL_INSTAGRAM_URL` | Instagram profile URL |
| `LABEL_FACEBOOK_URL` | Facebook page URL |
| `LABEL_TIKTOK_URL` | TikTok profile URL |
| `LABEL_TWITTER_URL` | X / Twitter profile URL |
| **Newsletter** | |
| `NEWSLETTER_PROVIDER` | Newsletter backend: `sendy` or `listmonk` (defaults to `sendy` if `NEWSLETTER_ACTION_URL` is set) |
| `NEWSLETTER_ACTION_URL` | Newsletter installation URL (without `/subscribe`) |
| `NEWSLETTER_API_KEY` | Sendy API key (from Sendy Settings) — required for Sendy |
| `NEWSLETTER_LIST_ID` | Mailing list ID (Sendy encrypted ID / Listmonk list UUID) |
| `NEWSLETTER_DOUBLE_OPTIN` | Set to `true` for GDPR double opt-in confirmation email |
| `NEWSLETTER_AUTO_CAMPAIGN` | Set to `true` to auto-create campaign drafts from new news articles |
| `NEWSLETTER_FROM_NAME` | Campaign sender name (defaults to `LABEL_NAME`) |
| `NEWSLETTER_FROM_EMAIL` | Campaign sender email (defaults to `LABEL_EMAIL`) |
| `NEWSLETTER_REPLY_TO` | Campaign reply-to email (defaults to `NEWSLETTER_FROM_EMAIL`) |
| `NEWSLETTER_BRAND_ID` | Sendy brand ID (default: `1`) |
| `NEWSLETTER_API_USER` | Listmonk API username — required for Listmonk campaign creation |
| `NEWSLETTER_API_TOKEN` | Listmonk API token — required for Listmonk campaign creation |
| **Physical stores** | |
| `PHYSICAL_STORES` | Comma-separated store IDs in display order (default: `bandcamp,discogs`) |
| `ELASTICSTAGE_LABEL_URL` | ElasticStage label page URL for on-demand vinyl/CD |
| `STORE_{ID}_URL` | Custom store search URL template (`{artist}` and `{album}` placeholders) |
| `STORE_{ID}_LABEL` | Custom store display label |
| `STORE_{ID}_ICON` | Custom store Font Awesome icon class |
| **Deployment** | |
| `AWS_S3_BUCKET` | S3 bucket name for `--deploy` |
| `AWS_S3_REGION` | S3 bucket region (optional) |
| `AWS_CLOUDFRONT_DISTRIBUTION_ID` | CloudFront distribution ID for cache invalidation |
| `GA_MEASUREMENT_ID` | Google Analytics 4 measurement ID (e.g. `G-XXXXXXXXXX`) |

---

## Workflow

### First run

```bash
# Scrape everything and generate the site
node generate.js
```

### Set up artist config (recommended before enriching)

```bash
# Auto-generate content/artists.json with Spotify artist URLs
# Validates each artist by comparing album lists
node generate.js --init-artists
```

Review `content/artists.json` and fix any `null` entries or low-confidence matches manually.

### Enrich streaming links

```bash
# Fetch streaming links, physical release data, and videos for all cached albums
node generate.js --enrich
```

The enricher is **incremental** — only fetches what's missing. Safe to re-run.

### Re-scrape a single artist

```bash
node generate.js --scrape --artist "Artist Name"
# or by slug:
node generate.js --scrape --artist artist-slug
```

Preserves all existing enrichment data (streaming links, UPCs, Discogs etc.). Bandcamp description, credits, and track changes are picked up.

### Re-scrape and enrich in one run

```bash
node generate.js --scrape --enrich --artist "Artist Name"
```

Re-scrapes from Bandcamp, then runs the full enrichment pipeline for that artist.

### Scaffold content folders

```bash
# Creates content/{artist-slug}/ folders with README.txt instructions
node generate.js --init-content
```

### Content cleanup

```bash
# Check for orphaned content folders and run data quality audit
node generate.js --cleanup
```

Reports content folders that don't match any album in the cache, plus data quality issues (missing labels, streaming links, UPCs, duplicates). Dry-run only — doesn't delete anything.

### Compilations (Various Artists)

The scraper automatically detects compilations on the label Bandcamp page (`BANDCAMP_LABEL_URL`). Albums where the Bandcamp artist field is "Various Artists" are collected under a special "Various Artists" entry:
- Compilations appear on the releases page and homepage
- Each compilation gets its own album page
- No artist page or grid entry is created for Various Artists
- Back-links on compilation album pages go to the releases page

### New release workflow

When a new album is released on Bandcamp and/or streaming platforms:

```bash
# 1. Re-scrape and enrich the artist in one run
node generate.js --scrape --enrich --artist "Artist Name"

# 2. (Optional) Sync YouTube videos for the new release
node generate.js --sync-youtube --artist "Artist Name"

# 3. Regenerate and deploy
node generate.js --deploy
```

The enrichment pipeline automatically:
- Matches Spotify releases to Bandcamp albums by title
- Verifies Bandcamp URLs for Spotify-only albums (catches scraper misses)
- Fills streaming links, social media, events, and metadata from Soundcharts
- Fills physical formats and sell links from Discogs
- Backs up the cache before any destructive operation

### Typical ongoing workflow

```bash
# After adding a new release on Bandcamp:
node generate.js --scrape --enrich --artist "Artist Name"   # re-scrape + enrich
node generate.js --deploy                                    # regenerate and deploy
```

---

## Enrichment Pipeline

Run `node generate.js --enrich`. The pipeline mode depends on which credentials are configured:

### Soundcharts mode (recommended)

When `SOUNDCHARTS_APP_ID` and `SOUNDCHARTS_API_KEY` are set:

1. **Spotify** — builds the album catalog by matching Spotify releases to Bandcamp albums by title. Adds Spotify-only releases not on Bandcamp.
2. **Bandcamp verification** — for Spotify-only albums (no Bandcamp URL), constructs Bandcamp URLs from the title and verifies they exist. Catches albums the scraper missed due to Bandcamp page limitations.
3. **Soundcharts** — resolves artist by Spotify ID, fetches all streaming links (Spotify, Apple Music, Deezer, Tidal, Amazon, YouTube, SoundCloud), social media links, album metadata (UPC, label, distributor, copyright), and upcoming events — all in ~2 API calls per album. Does not add extra releases.
4. **Gap-fill** — iTunes, Deezer, Tidal, MusicFetch called only for links Soundcharts didn't return. Spotify API is not called again.
5. **Discogs** — physical formats, sell links, per-label URLs (unchanged).

Budget: ~62 Spotify API calls + ~434 Soundcharts calls for 18 artists / 206 albums (initial run). Spotify calls optimized with batch UPC fetching. Incremental runs only process new/changed albums.

### Legacy mode (fallback)

When Soundcharts credentials are absent, the existing pipeline runs:

1. **Spotify** — fetches all releases from the artist's Spotify page, matches to Bandcamp albums by title, extracts UPCs.
2. **iTunes/Apple Music** — UPC lookup via iTunes API (free, no auth). Falls back to title search.
3. **Deezer** — UPC lookup via Deezer API (free, no auth). Falls back to title search.
4. **Tidal** — UPC lookup via Tidal API (requires `TIDAL_CLIENT_ID` + `TIDAL_CLIENT_SECRET`).
5. **Discogs** — UPC lookup, then artist+title search fallback. Fetches physical formats, label names with per-label Discogs URLs, sell links.
6. **MusicFetch** — optional, fills Amazon Music and other gaps (requires `MUSICFETCH_RAPIDAPI_KEY`).

### Single-artist enrichment

```bash
node generate.js --enrich --artist "Artist Name"            # enrich one artist only
node generate.js --enrich --force --artist "Artist Name"    # force re-enrich (even already-enriched albums)
node generate.js --scrape --enrich --artist "Artist Name"   # re-scrape + enrich in one run
```

---

## Content Directory

Drop files into `content/` to provide artist bios, photos, and static pages. This directory is gitignored.

```
content/
  extra-artists.txt          # Extra Bandcamp URLs (one per line, # = comment)
  artists.json               # Spotify artist URL map (generated by --init-artists)
  compilations.json          # Spotify album IDs for Various Artists compilations
  upcoming.json              # Private Bandcamp stream links for unreleased albums
  youtube.json               # YouTube channel URLs per artist
  news/                      # News articles (markdown-first)
    2026/
      04-04-welcome.md       # Article: MM-DD-slug.md (year from folder)
      04-04-welcome.jpg      # Optional feature image (auto-detected by slug)
  global/
    style.css                # Replaces the default stylesheet entirely
    favicon.ico
  pages/
    about.md                 # About Us section on homepage
    imprint.md               # Imprint page → footer link  ← can also be imprint.docx
    contact.md               # Contact page → footer link  ← can also be contact.docx
    data-protection.md       # Any extra page → footer link (auto-discovered)
    terms.md                 # Any extra page → footer link (auto-discovered)
    *.docx                   # Word documents auto-converted to .md on generate
  {artist-slug}/
    bio.md                   # Artist biography (Markdown)
    bio.docx                 # Artist biography (Word) — auto-converted to bio.md
    photo.jpg                # Main artist photo (used as hero banner on artist page)
    images/
      01.jpg                 # Gallery photos (shown in lightbox on artist page)
      02.jpg
    {album-slug}/
      notes.md               # Liner notes
      artwork.jpg            # Album artwork
      videos.json            # YouTube video links (see format below)
      stores.json            # Custom physical store links (see format below)
      reviews.md             # Press quotes / review excerpts (Markdown)
    links.json               # Manual social/streaming/website links override
```

### Album videos (`videos.json`)

To add YouTube videos to an album page, create a `videos.json` file in the album's content folder:

```
content/{artist-slug}/{album-slug}/videos.json
```

Format:
```json
[
  { "url": "https://www.youtube.com/watch?v=XXXXXXXXXXX", "title": "Official Music Video" },
  { "url": "https://youtu.be/XXXXXXXXXXX", "title": "Live at Venue Name" }
]
```

Both `youtube.com/watch?v=` and `youtu.be/` URL formats are supported. The `title` field is optional but recommended.

### Album reviews (`reviews.md`)

To add press quotes or review excerpts to an album page, create a `reviews.md` file:

```
content/{artist-slug}/{album-slug}/reviews.md
```

Use Markdown blockquotes for review excerpts:

```markdown
> "A stunning debut that blends post-punk energy with darkwave atmospherics."
> — *Some Music Magazine*

> "One of the most compelling releases of the year."
> — *Another Blog, January 2025*
```

Reviews appear at the bottom of the album page under a "Press" heading.

### Tour dates (`tourdates.json`)

To add tour dates for an artist manually (when Soundcharts/Bandsintown/Songkick data is unavailable), create a `tourdates.json` file:

```
content/{artist-slug}/tourdates.json
```

Format:
```json
[
  {
    "date": "2026-07-15",
    "venue": "Kulturhaus",
    "city": "Berlin",
    "country": "DE",
    "url": "https://tickets.example.com/event/123"
  },
  {
    "date": "2026-08-20",
    "venue": "Le Bataclan",
    "city": "Paris",
    "country": "FR"
  }
]
```

| Field     | Required | Description                              |
|-----------|----------|------------------------------------------|
| `date`    | yes      | ISO 8601 date (YYYY-MM-DD)               |
| `venue`   | yes      | Venue name                               |
| `city`    | yes      | City name                                |
| `country` | yes      | ISO 3166-1 alpha-2 country code          |
| `url`     | no       | Ticket purchase URL                      |

Local tour dates are merged with Soundcharts events and deduplicated. Past dates are automatically filtered out at generation time — you don't need to remove old entries. Events on the current day are still shown.

### Custom store links (`stores.json`)

To add a direct product URL for a specific album (overriding the global search URL), create a `stores.json` file:

```
content/{artist-slug}/{album-slug}/stores.json
```

Format:
```json
[
  { "store": "rough-trade", "label": "Buy at Rough Trade", "icon": "fa-solid fa-store", "url": "https://www.roughtrade.com/products/xyz" }
]
```

### Global custom stores (`.env`)

Define custom stores globally so they appear on all album pages with a search URL:

```env
# Which stores to show and in what order
PHYSICAL_STORES=bandcamp,discogs,roughtradeurl

# Custom store definition
STORE_ROUGHTRADEURL=https://www.roughtrade.com/search?q={artist}+{album}
STORE_ROUGHTRADE_LABEL=Buy at Rough Trade
STORE_ROUGHTRADE_ICON=fa-solid fa-store
```

URL templates support `{artist}` and `{album}` placeholders which are automatically URL-encoded. The store ID in `PHYSICAL_STORES` must match the suffix of `STORE_{ID}_URL` (case-insensitive).

Per-album `stores.json` entries always appear and are not filtered by `PHYSICAL_STORES`.

### Extra search stores (`content/stores.json`)

Define search-based stores that appear on all album pages with physical formats:

```json
[
  {
    "id": "poponaut",
    "label": "Search on Poponaut",
    "icon": "fa-solid fa-store",
    "url": "https://www.poponaut.de/advanced_search_result.php?language=en",
    "method": "POST",
    "params": { "keywords": "{artist} {album}" }
  },
  {
    "id": "goingunderground",
    "label": "Search on Going Underground",
    "icon": "fa-solid fa-store",
    "url": "https://www.going-underground.de/shop/en/search",
    "method": "GET",
    "params": { "sSearch": "{artist} {album}" }
  }
]
```

- `method: "GET"` builds a URL with query parameters (standard link)
- `method: "POST"` renders a hidden form with a submit button
- `{artist}` and `{album}` placeholders are replaced with actual values

### Hiding the physical section per album

To suppress the physical section on a specific release (e.g. out-of-print, not available anywhere), create `content/{artist}/{album}/stores.json`:

```json
{ "hidePhysical": true }
```

The array format for custom store links still works. Use the object format when you need `hidePhysical`:

```json
{
  "hidePhysical": true,
  "stores": [
    { "store": "elasticstage", "url": "https://..." }
  ]
}
```

### Artist links override (`links.json`)

To manually set social, streaming, or website links for an artist, create a `links.json` file:

```
content/{artist-slug}/links.json
```

Format:
```json
{
  "social": { "instagram": "https://instagram.com/...", "facebook": "https://facebook.com/..." },
  "streaming": { "tidal": "https://tidal.com/browse/artist/..." },
  "websites": [{ "name": "Official Website", "url": "https://example.com" }]
}
```

Manual links take priority. Bandcamp and Soundcharts fill in the rest.

### Upcoming releases (`upcoming.json`)

Add private Bandcamp stream links for unreleased albums. These are fetched during generation and displayed with a "Coming Soon" badge.

```json
{
  "nils-lassen": [
    "https://bandcamp.com/private/YSK5VZ0O"
  ],
  "art-noir": [
    "https://bandcamp.com/private/ANOTHER_CODE"
  ]
}
```

Private stream links are created in Bandcamp under the album's sharing settings. The generator fetches title, artist, artwork, and release date from these links. When the release goes public, remove it from `upcoming.json` — the normal scraper will pick it up.

Pre-order releases (published on Bandcamp with a future release date) are detected automatically and also get the "Coming Soon" badge — no `upcoming.json` entry needed.

### Compilations (`compilations.json`)

Map Various Artists compilation slugs to their Spotify album IDs. This avoids Spotify name search matching wrong albums for "Various Artists".

```json
{
  "join-the-dark-side-we-have-the-music-10-year-anniversary-compilation": {
    "spotifyUrl": "https://open.spotify.com/album/594T7JwkMHO2QjZWitpoO8",
    "upc": "4260345610661"
  }
}
```

Compilations are scraped from the label Bandcamp page (`BANDCAMP_LABEL_URL`) when the Bandcamp artist field is "Various Artists". They appear on the releases page and homepage but have no artist page.

### News articles

News articles are Markdown (or `.docx`) files in `content/news/{year}/` folders:

```
content/news/
  2026/
    04-04-welcome-to-our-new-website.md
    04-04-welcome-to-our-new-website.jpg   # optional feature image
    06-15-new-album-announcement.md
  2025/
    12-01-year-in-review.md
```

Filename format: `MM-DD-slug.md` — the year comes from the folder, month-day from the filename.

Articles support front-matter for metadata:

```yaml
---
title: Welcome to Our New Website
excerpt: Custom excerpt text for listing pages
image: welcome.jpg
---
```

- **Title**: from front-matter `title:`, or first heading, or derived from slug
- **Excerpt**: from front-matter `excerpt:`, or first paragraph (max 300 chars)
- **Image**: from front-matter `image:` (relative path or URL), or auto-detected `{slug}.jpg` in the year folder

News articles appear in three places:
- **Homepage**: latest 10 articles in the News section
- **News page**: `/news/` with all articles, paginated (12 per page)
- **Article pages**: `/news/{slug}/` for each article

A "News" link appears in the navigation when articles exist. Word documents (`.docx`) are auto-converted.

### Static pages

Any `.md` or `.docx` file placed in `content/pages/` automatically becomes a page:
- The filename (without extension) becomes the URL slug: `data-protection.md` → `/data-protection/`
- The page title is derived from the filename: `data-protection` → "Data Protection"
- A link is automatically added to the footer navigation
- Supported via `.docx` (auto-converted) or `.md` directly

Built-in page names with special behaviour:
- `about.md` — rendered as homepage section (not a separate page)
- `imprint.md` / `contact.md` — rendered as pages with footer links

### Word document support

Drop a `.docx` file anywhere the system expects a `.md` file:
- `content/{artist-slug}/bio.docx` → artist biography
- `content/pages/imprint.docx` → Imprint page
- `content/pages/terms.docx` → Terms page
- Any `content/pages/*.docx` → auto-discovered page

Conversion happens automatically on every `node generate.js` run. The `.md` is only regenerated if the `.docx` is newer.

---

## Assets Directory

Place brand images in `assets/` (gitignored):

| File | Used as |
|---|---|
| `logo-round.png` | Round logo overlapping the hero banner (homepage only) |
| `banner.jpg` | Full-width hero banner (homepage only) |

On artist and album pages, the artist photo / album artwork replaces the banner.

---

## Templates

HTML templates live in `templates/` and use [Nunjucks](https://mozilla.github.io/nunjucks/).

| Template | Used for |
|---|---|
| `base.njk` | Shared layout: hero, sticky nav, footer |
| `index.njk` | Homepage: artists, latest releases, news, about |
| `artist.njk` | Artist page: hero photo, bio, gallery, streaming links, discography |
| `album.njk` | Album page: hero artwork, player, streaming links, physical release, videos, tracklist |
| `releases.njk` | Full releases listing |
| `page.njk` | Static pages (Imprint, Contact, and any custom pages) |
| `news-list.njk` | News listing page with pagination |
| `news-article.njk` | Individual news article page |

Custom Nunjucks filters:

| Filter | Description |
|---|---|
| `isLocal` | Returns true if a URL is a local path |
| `nl2br` | Converts newlines to `<br>` |
| `formatDate` | Formats ISO date to human-readable |

---

## Source Modules

| Module | Description |
|---|---|
| `src/bandcamp.js` | Bandcamp HTML scraper: artist info, album info, album URLs, artist URLs |
| `src/scraper.js` | Orchestrates Bandcamp scraping for the full label roster |
| `src/refreshArtist.js` | Re-scrapes a single artist, preserving enrichment data |
| `src/bandcampApi.js` | Fetches label artist roster via Bandcamp OAuth2 API |
| `src/cache.js` | Reads/writes the JSON cache |
| `src/soundcharts.js` | Soundcharts API client: streaming links, social links, events, metadata |
| `src/spotify.js` | Spotify Web API: artist page fetch, album search, UPC extraction (legacy mode) |
| `src/itunes.js` | iTunes/Apple Music API: UPC lookup + title search (gap-fill / legacy) |
| `src/deezer.js` | Deezer API: UPC lookup + title search (gap-fill / legacy) |
| `src/tidal.js` | Tidal API: UPC lookup + title search (gap-fill / legacy) |
| `src/discogs.js` | Discogs API: physical formats, per-label URLs, catalog number, videos, sell links |
| `src/enricher.js` | Orchestrates the full enrichment pipeline (Soundcharts or legacy mode) |
| `src/cleanup.js` | Reports orphaned content folders and runs data quality audit on cache |
| `src/news.js` | Loads news articles from `content/news/` markdown files |
| `src/newsletterCampaign.js` | Auto-creates newsletter campaign drafts for new news articles (Sendy/Listmonk) |
| `src/upcoming.js` | Loads upcoming releases from `content/upcoming.json` private Bandcamp links |
| `src/initArtists.js` | Generates `content/artists.json` with Spotify artist URLs + validation |
| `src/initContent.js` | Scaffolds `content/{artist}/` folders |
| `src/convertDocs.js` | Converts `.docx` files to `.md` using mammoth |
| `src/content.js` | Loads content overrides and discovers dynamic pages |
| `src/merger.js` | Merges scraped data with content overrides |
| `src/renderer.js` | Renders all HTML pages via Nunjucks |
| `src/assets.js` | Copies static assets, writes default stylesheet |
| `src/generator.js` | Top-level pipeline: cache → merge → render → assets |
| `src/slugs.js` | Slug generation (NFD normalisation for accented characters) |
| `src/importCsv.js` | Bandcamp CSV import: parser, gap analysis, gap filling, full import |
| `src/salesRenderer.js` | Sales report Markdown renderer: GFM tables, artist reports, business reports |
| `src/bandcampSales.js` | Bandcamp Sales API client: OAuth2 auth, roster resolution, paginated sales fetch |
| `src/salesImport.js` | CSV import adapter for sales reports: ElasticStage, Amuse, MakeWaves, LabelCaster |
| `src/salesReport.js` | Sales report orchestrator: fetches, classifies, groups, renders, writes reports |
| `src/markdown.js` | Markdown rendering |

---

## Caching

Scraped data is saved to `cache.json` (gitignored). Delete it or use `--scrape` to re-scrape everything. Use `--scrape --artist <name>` to re-scrape a single artist.

Streaming links and enrichment data are stored in the cache. Re-running `--enrich` only fetches what's missing. Use `--enrich --force` to re-enrich already-processed albums.

Deprecated flags: `--refresh` still works as an alias for `--scrape` (or `--force` when combined with `--enrich`). `--artist` alone still implies `--scrape --artist`.

---

## CSV Import (Bandcamp Digital Export)

Import metadata from a Bandcamp digital catalog CSV export to fill gaps in your cache. The CSV provides catalog numbers, UPCs, ISRCs, Bandcamp IDs, and release dates that the scraper/enricher pipeline doesn't capture.

### Setup

1. In your Bandcamp label backend, go to **Tools → Digital Catalog Report → Export**
2. Place the downloaded CSV file in the `import/` directory (gitignored — contains label-specific data)

### Modes

**Gap analysis** (read-only — writes a detailed markdown report to `import/reports/`):
```bash
node generate.js --analyze-csv import/digital-catalog.csv
```

**Gap filling** (backfills missing fields into existing cache entries):
```bash
node generate.js --fill-gaps import/digital-catalog.csv
```

**Full import** (bootstraps a new cache entirely from CSV — requires roster source):
```bash
node generate.js --import-csv import/digital-catalog.csv --roster-source cache
node generate.js --import-csv import/digital-catalog.csv --roster-source api
```

### Flags

| Flag | Description |
|---|---|
| `--analyze-csv <path>` | Compare CSV against cache, print gap report |
| `--fill-gaps <path>` | Fill missing UPC, catalog number, Bandcamp ID, release date, ISRC from CSV |
| `--import-csv <path>` | Bootstrap cache from CSV (requires `--roster-source`) |
| `--roster-source <cache\|api>` | Where to get the active artist roster (with `--import-csv`) |
| `--dry-run` | Preview changes without writing to cache (with `--fill-gaps` or `--import-csv`) |

### Typical workflow

```bash
# 1. Export CSV from Bandcamp and place in import/
# 2. Analyze gaps first
node generate.js --analyze-csv import/digital-catalog.csv

# 3. Preview what would be filled
node generate.js --fill-gaps import/digital-catalog.csv --dry-run

# 4. Fill the gaps
node generate.js --fill-gaps import/digital-catalog.csv

# 5. Regenerate the site
node generate.js
```

Gap filling only writes to fields that are `null` or missing — existing enriched data (streaming links, artwork, Discogs data) is never overwritten. A timestamped backup of `cache.json` is created before any write.

Artists no longer on the label's active roster are automatically filtered out from the CSV data.

---

## Deployment (S3 + CloudFront)

After running `node generate.js`, upload the `dist/` folder to your S3 bucket:

```bash
aws s3 sync dist/ s3://your-bucket-name/ --delete
```

S3 bucket settings:
- Enable **Static website hosting**
- Index document: `index.html`
- Error document: `404.html`

CloudFront settings:
- Origin: your S3 bucket website endpoint
- Default root object: `index.html`
- Custom error response: 404 → `/404.html`

Old URL redirects are handled by static HTML pages in `dist/` (meta-refresh + JS redirect). Configure these in `content/redirects.json`.

---

## Utility Scripts

Standalone scripts in `scripts/` for tasks outside the main generation pipeline.

### Label Copy Export

Generates formatted release metadata (label copy) for distribution to stores, press, and partners.

```bash
# Export all artists from cache (no API calls) — recommended
node scripts/export-label-copy.js

# Export a single artist from cache
node scripts/export-label-copy.js --artist "Artist Name"

# Export a single release from cache
node scripts/export-label-copy.js --artist "Artist Name" --release "Album Title"

# Use Soundcharts as source (full credits: composers, producers, publishers)
node scripts/export-label-copy.js --source api --artist "Artist Name"

# Use Spotify as source (tracklist + ISRCs only, no credits)
node scripts/export-label-copy.js --source spotify --artist "Artist Name"

# Custom output directory
node scripts/export-label-copy.js --output ./my-exports
```

The default `--source cache` reads from `cache.json` — no API calls, no rate limits. This is the recommended mode for day-to-day use. Run `node generate.js --enrich` first to populate the cache with streaming links, ISRCs, and metadata.

Output is written to `label-copy/` (one Markdown file per artist). Includes tracklist with ISRCs, UPC, catalog number, label, release date, and credits.

**Data source comparison:**

| Field | `--source cache` | `--source api` (Spotify) | `--source api` (Soundcharts) |
|---|---|---|---|
| Tracklist + ISRCs | ✅ | ✅ | ✅ |
| UPC | ✅ | ✅ | ✅ |
| Label | ✅ | ❌ | ✅ |
| Distributor | ✅ (if SC enriched) | ❌ | ✅ |
| Copyright (P-line) | ✅ (if SC enriched) | ❌ | ✅ |
| Composers/Writers | ❌ | ❌ | ✅ (via ISWC) |
| Producers | ❌ | ❌ | ✅ |
| Publishers | ❌ | ❌ | ✅ (via ISWC) |

**Note:** The Spotify Web API does not expose songwriter, producer, or publisher credits — these are only available through Soundcharts. For complete label copy with credits, use `--source api` with Soundcharts credentials configured. The default `--source cache` is recommended for day-to-day use (no API calls, no rate limits).

### SEO Check

Validates the generated site for SEO basics.

```bash
node scripts/check-seo.js
```

Checks all `dist/` pages for: meta description, Open Graph tags, Twitter Card, canonical URL, JSON-LD structured data, lang attribute. Also verifies sitemap.xml and robots.txt.

### Newsletter Migration

Migrates subscribers from Sendy to Listmonk.

```bash
# Preview (no changes)
node scripts/migrate-sendy-to-listmonk.js export.csv --dry-run

# Execute migration
node scripts/migrate-sendy-to-listmonk.js export.csv
```

Requires `LISTMONK_URL`, `LISTMONK_API_USER`, `LISTMONK_API_TOKEN`, `LISTMONK_LIST_ID` in `.env`.

---

## Sales Reports

Generate per-artist settlement reports and an optional consolidated business report from Bandcamp sales data and CSV imports from digital distributors. Reports are GFM Markdown files designed for PDF conversion.

### Configuration

Add these to your `.env`:

| Variable | Required | Description |
|---|---|---|
| `BANDCAMP_CLIENT_ID` | yes | Already configured for site generation |
| `BANDCAMP_CLIENT_SECRET` | yes | Already configured for site generation |
| `STORAGE_S3_BUCKET` | for S3 sync | S3 bucket for report backup |
| `STORAGE_S3_PREFIX` | no | S3 key prefix (e.g. `my-label/`) |
| `STORAGE_MODE` | no | Set to `s3` to auto-sync after generation |

### Data sources

| Source | Type | How it gets in |
|---|---|---|
| Bandcamp Sales API | Physical + Digital | Automatic via OAuth2 |
| ElasticStage | Physical | CSV in `sales/import/elasticstage/` |
| Discogs Marketplace | Physical | CSV in `sales/import/discogs/` |
| Amuse | Digital | XLSX in `sales/import/amuse/` |
| MakeWaves | Digital | CSV in `sales/import/makewaves/` |
| LabelCaster | Digital | CSV in `sales/import/labelcaster/` |

### CSV import

Place CSV exports from your distributors in the corresponding `sales/import/` subdirectory. Required columns: `artist`, `release`, `revenue`, `currency`, `date`. Column names are matched flexibly (case-insensitive, common aliases supported).

Files are tracked via `sales/import/.imported.json` — re-running won't double-count. Modified files (changed checksum) are automatically re-imported. Use `--force` to re-import everything.

Non-EUR currencies (GBP, USD) are automatically converted to EUR using monthly ECB reference rates. Override with `SALES_EXCHANGE_RATES` env var (JSON, e.g. `{"GBP":1.17,"USD":0.92}`).

Year ranges are supported: `--year 2015-2026` generates reports for all years in a single run (one Bandcamp auth, one CSV import).

### Usage

```bash
# Annual reports for all artists
node generate.js --sales-report --year 2025

# Single artist
node generate.js --sales-report --year 2025 --artist "Artist Name"

# Quarterly reports
node generate.js --sales-report --year 2025 --period quarterly

# Monthly reports
node generate.js --sales-report --year 2025 --period monthly

# Half-yearly reports
node generate.js --sales-report --year 2025 --period half-yearly

# Include consolidated business report
node generate.js --sales-report --year 2025 --business-report

# Preview without writing files
node generate.js --sales-report --year 2025 --dry-run

# Re-import all CSVs (ignore tracking)
node generate.js --sales-report --year 2025 --force

# Sync reports to S3
node generate.js --sales-report --year 2025 --sync-s3

# Convert reports to PDF
node generate.js --sales-report --year 2025 --pdf

# Full run: all years, business reports, PDF, S3 sync
node generate.js --sales-report --year 2015-2026 --business-report --pdf --force
```

### Flags

| Flag | Description |
|---|---|
| `--sales-report` | Enable sales report generation |
| `--year <YYYY>` | Reporting year or range (required with `--sales-report`) |
| `--period <value>` | `monthly`, `quarterly`, `half-yearly` (default: annual) |
| `--business-report` | Generate consolidated label-wide report |
| `--artist <name>` | Filter to a single artist |
| `--dry-run` | Print reports to stdout, don't write files |
| `--force` | Re-import all CSV files (ignore tracking) |
| `--sync-s3` | Upload reports to S3 after generation |
| `--pdf` | Convert generated reports to PDF (requires `md-to-pdf`) |

### Output structure

```
sales/
  {artist-slug}/
    {artist-slug}-2025.md              # Annual report
    {artist-slug}-2025-Q1.md           # Quarterly
    {artist-slug}-2025-01.md           # Monthly
    {artist-slug}-2025-H1.md           # Half-yearly
  various-artists/
    various-artists-2025.md            # Non-roster artist transactions
  business-report-2025.md              # Consolidated label report
  import/
    .imported.json                     # Import tracking
    elasticstage/                      # ElasticStage CSV files
    discogs/                           # Discogs Marketplace CSV files
    amuse/                             # Amuse XLSX files
    makewaves/                         # MakeWaves CSV files
    labelcaster/                       # LabelCaster CSV files
```

### Report sections (per-artist)

1. Header (artist name, period, generation date)
2. Summary (total revenue per currency, physical/digital breakdown)
3. Bandcamp Sales — Physical (grouped by currency)
4. Bandcamp Sales — Digital (grouped by currency)
5. ElasticStage Sales
6. Other Distribution Overview (Discogs, Amuse, MakeWaves, LabelCaster)
7. Totals (grand total per currency)

Empty sections show "No data for this period." Multi-currency transactions are grouped with per-currency subtotals. Refunds appear as negative line items.

### Business report sections

1. Label Summary (revenue, units, transactions, physical/digital breakdown)
2. Revenue by Artist (sorted by total revenue descending)
3. Revenue by Source (Bandcamp Physical/Digital, ElasticStage, distributors)
4. Revenue by Month (12 rows, January–December)
5. Top Selling Releases (max 20, sorted by revenue descending)
6. Totals

### Typical workflow

```bash
# 1. Export CSVs from your distributors and place in sales/import/
# 2. Generate annual reports
node generate.js --sales-report --year 2025

# 3. Generate with business report + PDF
node generate.js --sales-report --year 2025 --business-report --pdf

# 4. Full run: all years, all sources, business reports, PDF, S3 sync
node generate.js --sales-report --year 2015-2026 --business-report --pdf --force
```

### Privacy

The `sales/` directory is gitignored. The generator warns if `sales/` is not in `.gitignore` before writing any reports.

---

## Acknowledgments

This project was inspired by [bandcamp-scraper](https://github.com/masterT/bandcamp-scraper) by [masterT](https://github.com/masterT). While the Label Site Generator uses its own Bandcamp scraping implementation, the original project provided the foundation and idea for programmatic access to Bandcamp data.

---

GPL-3.0 — see [LICENSE](LICENSE) for details.
