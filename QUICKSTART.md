# Quickstart

Get your label website running in 5 minutes.

## Prerequisites

- Node.js 18+
- A Bandcamp label or artist page

## Setup

```bash
git clone https://github.com/falkmerten/label-site-generator.git
cd label-site-generator
npm install
cp .env.example .env
```

Edit `.env` with your Bandcamp URL:

```env
BANDCAMP_URL=https://your-label-or-band.bandcamp.com/
SITE_NAME=Your Label Name
SITE_URL=https://www.your-label.com/
```

The generator auto-detects whether your Bandcamp page is a label account or an artist/band account.

## Generate

```bash
node generate.js
```

This scrapes your Bandcamp page, builds the site, and outputs to `dist/`.

## View locally

```bash
npx serve dist
```

Open `http://localhost:3000` in your browser.

## Optional: Enrich with streaming links

The enrichment pipeline adds Spotify, Apple Music, Deezer, Tidal, and other streaming links to all albums. It works with any combination of configured APIs - Soundcharts is recommended but not required.

Configure one or more enrichment sources in `.env` (see [API-SETUP.md](API-SETUP.md) for details):

- **Soundcharts** (recommended) - all streaming links, social media, events in one API
- **Spotify** - album matching, UPC extraction, label names
- **Discogs** - physical formats, sell links, label names
- **Tidal, iTunes, Deezer** - gap-fill for missing streaming links

Then run:

```bash
node generate.js --enrich
```

## Optional: Ghost CMS for news

Set up a headless Ghost instance (see [API-SETUP.md](API-SETUP.md#ghost-cms-optional---headless-news)):

```env
GHOST_URL=https://news.your-label.com
GHOST_CONTENT_API_KEY=your_content_api_key
```

Ghost posts replace local news files automatically. If Ghost is unavailable, the generator falls back to local `content/news/` markdown files.

## Optional: Deploy to AWS

```env
AWS_S3_BUCKET=your-bucket-name
AWS_S3_REGION=eu-central-1
AWS_CLOUDFRONT_DISTRIBUTION_ID=EXXXXXXXXX
```

```bash
node generate.js --deploy
```

This generates the site, syncs to S3, and invalidates CloudFront.

## Next steps

- Add artist bios: `content/{artist-slug}/bio.md`
- Add artist photos: `content/{artist-slug}/photo.jpg`
- Add news articles: `content/news/2026/MM-DD-slug.md`
- Set up newsletter: see [API-SETUP.md](API-SETUP.md)
- Full configuration reference: see [README.md](README.md)
