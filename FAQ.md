# Frequently Asked Questions

## General

**What is Label Site Generator?**
A static site generator for music labels. It scrapes your Bandcamp label page, enriches the data with streaming links and metadata from Soundcharts (or Spotify/Apple Music/Deezer/Tidal as fallback), physical release data from Discogs, then generates a complete branded HTML website.

**Do I need a Bandcamp label account?**
Yes, a Bandcamp label account is required to use the API for fetching your artist roster. The generator falls back to HTML scraping if no API credentials are provided, but this is less reliable. API access is available from your Bandcamp label settings → API Access.

**Can I use this without Spotify credentials?**
Yes. With Soundcharts credentials configured, Spotify is not needed at all. Without either, the generator uses Bandcamp data only plus Discogs for physical releases.

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
Enrichment runs separately from generation. Run `node generate.js --enrich` to fetch streaming links. With Soundcharts, most links are found in a single call. Some releases may not be on a particular platform.

**Why does Spotify enrichment take so long or fail?**
This only applies in legacy mode (no Soundcharts credentials). Spotify has aggressive rate limits. With Soundcharts configured, Spotify is not called at all.

**Can I run enrichment without Spotify?**
Yes. With Soundcharts credentials, Spotify is never called. Without Soundcharts, run `node generate.js --enrich` with `SPOTIFY_CLIENT_ID` unset — iTunes, Deezer, Tidal, and Discogs will still run.

**Can I enrich a single artist?**
Yes. Run `node generate.js --enrich --artist "Artist Name"`. To force re-enrichment (clear cached Soundcharts data), add `--refresh`.

**How do I re-check Tidal links only?**
Run `node generate.js --tidal-only`.

**Soundcharts discovered a release that's actually already on Bandcamp with a different title. What happened?**
The enricher matches Soundcharts releases to Bandcamp releases by normalized title and UPC. If the titles differ significantly (e.g. "In This Light Single Remixes" on Bandcamp vs "In This Light (Remixes)" on Soundcharts) and no UPC match exists, it gets added as a separate entry. To fix this: delete the duplicate from the cache manually, or re-scrape the artist with `node generate.js --artist "Name"` to refresh the Bandcamp data, then re-enrich with `--refresh`.

**How do I add social or streaming links for an artist manually?**
Create a `links.json` file in `content/{artist-slug}/`:
```json
{
  "social": { "instagram": "https://instagram.com/...", "facebook": "https://facebook.com/..." },
  "streaming": { "tidal": "https://tidal.com/browse/artist/..." },
  "websites": [{ "name": "Official Website", "url": "https://example.com" }]
}
```
Manual links take priority. Bandcamp and Soundcharts links fill in the rest.

**Does `--enrich --refresh` re-enrich all artists?**
`--refresh` only clears Soundcharts data when combined with `--artist`. Running `--enrich --refresh` without `--artist` just runs normal incremental enrichment — it doesn't clear anything. Use `--enrich --artist "Name" --refresh` to force re-enrichment for a specific artist.

**What is the `--cleanup` command?**
Reports orphaned content folders that don't match any album in the cache. Dry-run only — doesn't delete anything. Run `node generate.js --cleanup` to check.

**How does Soundcharts album discovery work?**
When enriching, the enricher fetches the artist's full album list from Soundcharts and adds any releases not already in the cache (matched by title, UPC, and Soundcharts UUID). This catches streaming-only releases not on Bandcamp.

**What's the difference between Soundcharts mode and legacy mode?**
When `SOUNDCHARTS_APP_ID` and `SOUNDCHARTS_API_KEY` are set, the enricher uses Soundcharts as the primary source for streaming links, social media, events, and metadata. Missing links are filled by iTunes/Deezer/Tidal as needed. When Soundcharts credentials are absent, the full legacy pipeline (Spotify → iTunes → Deezer → Tidal → MusicFetch) runs instead. No CLI flags needed — the mode is automatic.

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
