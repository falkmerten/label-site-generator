# Quickstart

Generate a website for your music label or band. No configuration file needed — the interactive setup guides you through everything.

## Prerequisites

- Node.js 18+

## 1. Install

```bash
git clone https://github.com/falkmerten/label-site-generator.git
cd label-site-generator
npm install
```

## 2. Run

```bash
node generate.js
```

That's it. No `.env` file required. The interactive setup asks you to choose a data source:

1. **Bandcamp** — paste your Bandcamp URL (label or artist page)
2. **Internet Archive** — enter a collection identifier (for netlabels / CC-licensed catalogs)
3. **Spotify** — provide Spotify artist URLs (planned, not yet fully implemented)

The generator then:
- Detects your account type (label vs. artist)
- Asks about theme preference (standard, dark, or bandcamp auto-colors)
- Scrapes your catalog
- Creates `content/config.json`
- Builds a complete website to `dist/`

First run takes 1-2 minutes (network requests). Subsequent runs rebuild from cache in 2-3 seconds.

### Non-interactive mode

If you prefer to skip prompts, create a `.env` file with your source URL:

```env
BANDCAMP_URL=https://your-label.bandcamp.com/
```

Then run with `--yes`:

```bash
node generate.js --yes
```

## 3. View locally

```bash
npx serve dist
```

Open `http://localhost:3000`.

## 4. Enrich with streaming links (optional)

Enrichment adds streaming links and artist metadata. All APIs are optional — the site works without them.

### Spotify (streaming links)

```env
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
```

Get credentials from [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard). Then:

```bash
node generate.js --enrich
```

Adds Spotify, Apple Music, Deezer, YouTube Music, and Amazon Music links.

### Last.fm (artist metadata — free, recommended)

```env
LASTFM_API_KEY=your_api_key
```

Get a key at [last.fm/api/account/create](https://www.last.fm/api/account/create).

Adds artist bios, listener stats, genre tags, and similar artist recommendations. Free, unlimited.

### Discogs (physical releases)

```env
DISCOGS_TOKEN=your_token
```

Get a token at [discogs.com/settings/developers](https://www.discogs.com/settings/developers).

Adds vinyl/CD/cassette format display and Discogs sell links. Only runs if `"discogs"` is in your stores config.

### Bandsintown (live events — automatic)

No API key needed. Tour dates are fetched automatically during `--enrich` for artists with a `bandsintown.json` config.

## 5. Add content

| Content | Location |
|---------|----------|
| Site logo | `content/global/logo.png` |
| Hero banner | `content/global/banner.jpg` |
| Favicons | `content/global/favicon.ico`, `favicon.svg`, etc. |
| Custom CSS | `content/global/style.css` (overrides theme entirely) |
| Artist bio | `content/{artist-slug}/bio.md` |
| Artist photo | `content/{artist-slug}/photo.jpg` |
| News articles | `content/news/2026/MM-DD-slug.md` |
| Static pages | `content/pages/imprint.md` |
| Album artwork | `content/{artist-slug}/{album-slug}/artwork.jpg` |

## 6. Deploy (optional)

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
| Backup workspace to S3 | `node generate.js --sync-up` |

## Data sources

| Source | Use case | Setup |
|--------|----------|-------|
| **Bandcamp** | Labels and bands with a Bandcamp page | Paste URL during first run |
| **Internet Archive** | Netlabels, CC-licensed catalogs | Enter collection ID during first run |
| **Spotify** | Labels without Bandcamp (planned) | Not yet fully implemented |

## Metadata quality levels

| Level | What you need | What you get |
|---|---|---|
| Basic | Just run `node generate.js` | Website with Bandcamp links, artwork, bios |
| + Spotify | Add `SPOTIFY_CLIENT_ID/SECRET` | + streaming links across all platforms |
| + Last.fm | Add `LASTFM_API_KEY` | + artist bios, listener stats, genre tags, similar artists |
| + Discogs | Add `DISCOGS_TOKEN` | + physical formats, sell links |
| Recommended | Spotify + Last.fm + Discogs | Full enrichment at zero cost |

## Bandcamp CSV (optional, recommended)

Export your Digital Catalog Report for reliable UPC/ISRC data:

**Bandcamp → Settings → Tools → Digital Catalog Report → Download CSV**

Place in `private/imports/`. The generator detects it automatically.

## Migrating from v4

```bash
node generate.js --migrate
```

See [README.md](README.md) for details.
