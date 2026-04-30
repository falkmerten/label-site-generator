# Quickstart

Get your label or band website running in 5 minutes.

## Prerequisites

- Node.js 18+
- A Bandcamp label or artist page

## 1. Install

```bash
git clone https://github.com/falkmerten/label-site-generator.git
cd label-site-generator
npm install
```

## 2. Configure

Create a `.env` file with two lines:

```env
BANDCAMP_URL=https://your-label.bandcamp.com/
SITE_MODE=label
```

Use `SITE_MODE=artist` if you're a single band (no label account).

### Optional: Choose a theme

```env
SITE_THEME=dark
```

Available: `standard` (default, light), `dark`, `bandcamp` (auto-colors from your page).

## 3. Generate

```bash
node generate.js
```

First run takes 1-2 minutes (scraping Bandcamp). The generator:
1. Scrapes all artists and albums from your Bandcamp page
2. Downloads album artwork
3. Creates `content/config.json` (your site configuration)
4. Builds the website to `dist/`

Subsequent runs take 2-3 seconds (offline, from cache).

## 4. View locally

```bash
npx serve dist
```

Open `http://localhost:3000` in your browser.

## 5. Add streaming links (optional)

Get Spotify API credentials from [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and add to `.env`:

```env
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
```

Then:

```bash
node generate.js --enrich
```

This adds Spotify, Apple Music, and Deezer links to all albums. Takes ~30 seconds for a typical label.

**For full metadata** (UPC, labels, all platforms), configure Soundcharts instead. See [API-SETUP.md](API-SETUP.md).

## 6. Deploy (optional)

Add AWS credentials to `.env`:

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
| Rebuild site (local changes) | `node generate.js` |
| New release on Bandcamp | `node generate.js --scrape` |
| Update streaming links | `node generate.js --enrich` |
| Full update + deploy | `node generate.js --scrape --enrich --deploy` |
| Update one artist only | `node generate.js --scrape --artist "Name"` |

## Adding content

| Content | Location |
|---------|----------|
| Artist bio | `content/{artist-slug}/bio.md` |
| Artist photo | `content/{artist-slug}/photo.jpg` |
| News articles | `content/news/2026/MM-DD-slug.md` |
| Static pages | `content/pages/imprint.md` |
| Album artwork override | `content/{artist-slug}/{album-slug}/artwork.jpg` |

## Adding a new artist

Edit `content/config.json` and add an entry with a `bandcampUrl`:

```json
"new-artist": {
  "name": "New Artist",
  "enabled": true,
  "source": "bandcamp",
  "exclude": false,
  "excludeAlbums": [],
  "bandcampUrl": "https://newartist.bandcamp.com/",
  "links": { "spotify": null }
}
```

Then run `node generate.js --scrape` to fetch their albums.

## Migrating from v4

If you have an existing v4 setup (artists.json, extra-artists.txt, etc.):

```bash
node generate.js --migrate
```

This converts all legacy files into a single `content/config.json`.

## Next steps

- [README.md](README.md) — Full configuration reference
- [API-SETUP.md](API-SETUP.md) — Enrichment API credentials
- [Wiki](https://github.com/falkmerten/label-site-generator/wiki) — Full documentation
