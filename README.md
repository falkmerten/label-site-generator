# Label Site Generator

Generates a complete static website for a Bandcamp music label. Scrapes artist and album data from Bandcamp, enriches it with streaming links and physical release data from multiple APIs, merges it with local content, and renders a branded HTML site.

Built on top of the [bandcamp-scraper](https://github.com/masterT/bandcamp-scraper) library.

---

## Features

- Fetches the label roster via the **Bandcamp API** (falls back to HTML scraping)
- Supports **extra artist profiles** via `content/extra-artists.txt` or `EXTRA_ARTIST_URLS` env var
- **Caches** all scraped data to `cache.json` — subsequent runs skip Bandcamp entirely
- **Single-artist refresh** — re-scrape one artist without touching the rest
- **Streaming link enrichment** via multiple APIs:
  - Spotify Web API — artist page fetch → UPC extraction (source of truth for album list)
  - iTunes/Apple Music API — UPC lookup (free, no auth)
  - Deezer API — UPC lookup (free, no auth)
  - Tidal API — UPC lookup (requires credentials)
  - MusicFetch via RapidAPI — optional, fills remaining gaps
- **Physical release data** via Discogs API — formats (Vinyl, CD, Cassette), catalog number, label, sell links, YouTube videos
- **Artist config** (`content/artists.json`) — maps artist slugs to Spotify artist URLs for reliable enrichment
- **Content overrides**: artist bios (Markdown or Word .docx), photos, gallery images, album artwork
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
- A Bandcamp label account with API access (see note below)
- Spotify Developer credentials (recommended — enables full enrichment pipeline)

> **Bandcamp API access**: The generator uses the Bandcamp API to fetch your label's artist roster. API access is available to Bandcamp label accounts — go to your Bandcamp label settings → **API Access** to obtain your `CLIENT_ID` and `CLIENT_SECRET`. Without API credentials the generator falls back to HTML scraping of your label page, which is less reliable. Note that Bandcamp API access is only available to label accounts, not individual artist accounts.

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
| `BANDCAMP_CLIENT_ID` | Bandcamp API client ID (Settings → API Access) |
| `BANDCAMP_CLIENT_SECRET` | Bandcamp API client secret |
| `BANDCAMP_LABEL_URL` | Label Bandcamp URL — used as fallback for artist roster |
| `LABEL_NAME` | Display name shown in header, titles, footer |
| `LABEL_EMAIL` | Contact email |
| `LABEL_ADDRESS` | Postal address for Imprint |
| `LABEL_VAT_ID` | VAT ID for Imprint |
| `EXTRA_ARTIST_URLS` | Comma-separated extra Bandcamp artist URLs |
| `SPOTIFY_CLIENT_ID` | Spotify app client ID ([developer.spotify.com](https://developer.spotify.com/dashboard)) |
| `SPOTIFY_CLIENT_SECRET` | Spotify app client secret |
| `TIDAL_CLIENT_ID` | Tidal API client ID ([developer.tidal.com](https://developer.tidal.com)) |
| `TIDAL_CLIENT_SECRET` | Tidal API client secret |
| `DISCOGS_TOKEN` | Discogs personal access token ([discogs.com/settings/developers](https://www.discogs.com/settings/developers)) |
| `MUSICFETCH_RAPIDAPI_KEY` | MusicFetch API key via RapidAPI (optional) |
| `LABEL_BANDCAMP_URL` | Label Bandcamp URL (footer social links) |
| `LABEL_SPOTIFY_URL` | Spotify profile URL |
| `LABEL_SOUNDCLOUD_URL` | SoundCloud URL |
| `LABEL_YOUTUBE_URL` | YouTube channel URL |
| `LABEL_INSTAGRAM_URL` | Instagram profile URL |
| `LABEL_FACEBOOK_URL` | Facebook page URL |
| `LABEL_TIKTOK_URL` | TikTok profile URL |
| `LABEL_TWITTER_URL` | X / Twitter profile URL |

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
node generate.js --artist "Artist Name"
# or by slug:
node generate.js --artist artist-slug
```

Preserves all existing enrichment data (streaming links, UPCs, Discogs etc.).

### Scaffold content folders

```bash
# Creates content/{artist-slug}/ folders with README.txt instructions
node generate.js --init-content
```

### Typical ongoing workflow

```bash
# After adding a new release on Bandcamp:
node generate.js --artist "Artist Name"   # re-scrape just that artist
node generate.js --enrich                  # enrich new albums
node generate.js                           # regenerate site
```

---

## Enrichment Pipeline

Run `node generate.js --enrich`. Per artist, the pipeline is:

1. **Spotify** — fetches all releases from the artist's Spotify page (using URL from `artists.json`), matches to Bandcamp albums by title, extracts UPCs. Spotify is the source of truth for the album list when an artist URL is configured.
2. **iTunes/Apple Music** — UPC lookup via iTunes API (free, no auth). Falls back to title search.
3. **Deezer** — UPC lookup via Deezer API (free, no auth). Falls back to title search. Also sets artist-level Deezer link.
4. **Tidal** — UPC lookup via Tidal API (requires `TIDAL_CLIENT_ID` + `TIDAL_CLIENT_SECRET`).
5. **Discogs** — UPC lookup, then artist+title search fallback. Fetches physical formats, catalog number, label name, sell link, and YouTube videos. Fills missing release dates and descriptions.
6. **MusicFetch** — optional, fills Amazon Music and other gaps (requires `MUSICFETCH_RAPIDAPI_KEY`).

---

## Content Directory

Drop files into `content/` to provide artist bios, photos, and static pages. This directory is gitignored.

```
content/
  extra-artists.txt          # Extra Bandcamp URLs (one per line, # = comment)
  artists.json               # Spotify artist URL map (generated by --init-artists)
  global/
    style.css                # Replaces the default stylesheet entirely
    favicon.ico
  pages/
    about.md                 # About Us section on homepage
    news.md                  # News section on homepage
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

### Static pages

Any `.md` or `.docx` file placed in `content/pages/` automatically becomes a page:
- The filename (without extension) becomes the URL slug: `data-protection.md` → `/data-protection/`
- The page title is derived from the filename: `data-protection` → "Data Protection"
- A link is automatically added to the footer navigation
- Supported via `.docx` (auto-converted) or `.md` directly

Built-in page names with special behaviour:
- `about.md` / `news.md` — rendered as homepage sections (not separate pages)
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
| `src/scraper.js` | Scrapes artist and album data from Bandcamp (uses `/music` for full album list) |
| `src/refreshArtist.js` | Re-scrapes a single artist, preserving enrichment data |
| `src/bandcampApi.js` | Fetches label artist roster via Bandcamp OAuth2 API |
| `src/cache.js` | Reads/writes the JSON cache |
| `src/spotify.js` | Spotify Web API: artist page fetch, album search, UPC extraction |
| `src/itunes.js` | iTunes/Apple Music API: UPC lookup + title search |
| `src/deezer.js` | Deezer API: UPC lookup + title search |
| `src/tidal.js` | Tidal API: UPC lookup + title search |
| `src/discogs.js` | Discogs API: physical formats, catalog number, videos, sell links |
| `src/enricher.js` | Orchestrates the full enrichment pipeline |
| `src/initArtists.js` | Generates `content/artists.json` with Spotify artist URLs + validation |
| `src/initContent.js` | Scaffolds `content/{artist}/` folders |
| `src/convertDocs.js` | Converts `.docx` files to `.md` using mammoth |
| `src/content.js` | Loads content overrides and discovers dynamic pages |
| `src/merger.js` | Merges scraped data with content overrides |
| `src/renderer.js` | Renders all HTML pages via Nunjucks |
| `src/assets.js` | Copies static assets, writes default stylesheet |
| `src/generator.js` | Top-level pipeline: cache → merge → render → assets |
| `src/slugs.js` | Slug generation (NFD normalisation for accented characters) |
| `src/markdown.js` | Markdown rendering |

---

## Caching

Scraped data is saved to `cache.json` (gitignored). Delete it or use `--refresh` to re-scrape everything. Use `--artist <name>` to re-scrape a single artist.

Streaming links and enrichment data are stored in the cache. Re-running `--enrich` only fetches what's missing.

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

MIT
