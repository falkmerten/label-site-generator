# Frequently Asked Questions

## General

**What is Label Site Generator?**
A static site generator for music labels. It scrapes your Bandcamp label page, enriches the data with streaming links from Spotify, Apple Music, Deezer, Tidal, and physical release data from Discogs, then generates a complete branded HTML website.

**Do I need a Bandcamp label account?**
Yes, a Bandcamp label account is required to use the API for fetching your artist roster. The generator falls back to HTML scraping if no API credentials are provided, but this is less reliable. API access is available from your Bandcamp label settings → API Access.

**Can I use this without Spotify credentials?**
Yes. Spotify enrichment is optional. Without it, the generator uses Bandcamp data only. Spotify adds UPCs, streaming links, and helps match releases across platforms.

**Does it work for individual artists (not labels)?**
The generator is designed for label accounts. Individual artist accounts don't have API access. You can still use it by setting `BANDCAMP_LABEL_URL` to your artist page and leaving the API credentials empty — it will fall back to HTML scraping.

---

## Setup

**Where do I put my logo and banner?**
Place `logo-round.png` and `banner.jpg` in the `assets/` folder. Both are gitignored (label-specific).

**How do I add artist bios?**
Create `content/{artist-slug}/bio.md` or `content/{artist-slug}/bio.docx`. Word documents are auto-converted on every generate run.

**How do I add artist photos?**
Place `photo.jpg` in `content/{artist-slug}/`. Gallery images go in `content/{artist-slug}/images/`.

**How do I add album artwork?**
Run `node generate.js --download-artwork` to automatically download all artwork from Bandcamp/Spotify. Or place `artwork.jpg` manually in `content/{artist-slug}/{album-slug}/`.

---

## Enrichment

**Why are some streaming links missing?**
Enrichment runs separately from generation. Run `node generate.js --enrich` to fetch streaming links. Some releases may not be found if they're not on a particular platform or if the title/UPC doesn't match.

**Why does Spotify enrichment take so long or fail?**
Spotify has rate limits. The generator respects these with delays between requests. If you hit a long `Retry-After` (hours), your app's quota is exhausted — wait and try again. Running `--artist <slug>` processes one artist at a time to reduce quota usage.

**Can I run enrichment without Spotify?**
Yes. Run `node generate.js --enrich` with `SPOTIFY_CLIENT_ID` unset. iTunes, Deezer, Tidal, and Discogs will still run.

**How do I re-check Tidal links only?**
Run `node generate.js --tidal-only`.

---

## Physical Releases

**How does physical release detection work?**
Physical formats (Vinyl, CD, Cassette) are detected from two sources:
1. **Bandcamp packages** — scraped directly from your Bandcamp pages (most reliable for your own releases)
2. **Discogs** — looked up by UPC barcode during `--enrich`

**Why does a release show physical badges but no buy links?**
The format was detected but no sell listings were found on Discogs. Run `--enrich` again — Discogs sell listings change frequently.

**How do I add a custom store (e.g. Rough Trade)?**
Add to your `.env`:
```
PHYSICAL_STORES=bandcamp,discogs,roughtradeurl
STORE_ROUGHTRADEURL=https://www.roughtrade.com/search?q={artist}+{album}
STORE_ROUGHTRADE_LABEL=Buy at Rough Trade
STORE_ROUGHTRADE_ICON=fa-solid fa-store
```

For a specific album with a direct product URL, create `content/{artist-slug}/{album-slug}/stores.json`.

---

## Deployment

**How do I deploy to AWS S3 + CloudFront?**
Run `node generate.js --deploy`. Requires `AWS_S3_BUCKET` and optionally `AWS_CLOUDFRONT_DISTRIBUTION_ID` in `.env`. The AWS CLI must be installed and configured with appropriate credentials.

**How do I get Google to index my site?**
Submit your sitemap at [Google Search Console](https://search.google.com/search-console). The sitemap is auto-generated at `/sitemap.xml` when `SITE_URL` is set in `.env`.

---

## Licensing

**Can I use this commercially?**
Under the GPL-3.0 license, you can use it freely but must open-source any modifications. For commercial use without GPL obligations, contact info@aenaos-records.com for a commercial license.

**Can I sell products built with this?**
Yes, under a commercial license. Contact us to discuss pricing.
