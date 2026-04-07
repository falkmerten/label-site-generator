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

**How does Bandcamp URL verification work?**
After Spotify adds releases to the catalog, the enricher checks each Spotify-only album (no Bandcamp URL) by constructing a Bandcamp URL from the title and verifying it exists with a HEAD request. This catches albums that exist on Bandcamp but weren't found by the scraper — for example, older releases not listed on the `/music` page. The verification uses Bandcamp-style slugs (apostrophes dropped, not hyphenated). Verified albums are fully scraped (tracks, tags, album ID for embedded player).

**What is the Spotify searchAlbum fallback?**
After `fetchArtistAlbums` builds the album list, Bandcamp albums that didn't match any Spotify release get a title-based search fallback. This catches albums that Spotify's artist endpoint doesn't return (e.g., one artist had 9 of 20 albums missing). The search uses strict scoring: artist name must match exactly, and for short artist names (≤3 chars) an exact album title match is required. Artists that normalize to fewer than 2 characters (e.g., `Artist` → `a`) skip the search entirely to prevent false positives. Albums belonging to other artists on shared Bandcamp pages are also excluded.

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

**What cache headers does `--deploy` set?**
The deploy command uses per-file-type Cache-Control headers:
- Images, fonts, WebP: `max-age=31536000, immutable` (1 year)
- CSS, JS: `max-age=604800, must-revalidate` (1 week)
- XML, TXT, webmanifest: `max-age=86400` (1 day)
- HTML: `max-age=0, must-revalidate` (always revalidate)

**How do I get Google to index my site?**
Submit your sitemap at [Google Search Console](https://search.google.com/search-console). The sitemap is auto-generated at `/sitemap.xml` when `SITE_URL` is set in `.env`. The sitemap includes video entries for albums with YouTube videos.

---

## Troubleshooting

**Spotify returns "Invalid limit" (HTTP 400) on artist album fetch**
Spotify occasionally rejects the `limit` query parameter on `/v1/artists/{id}/albums`. The generator handles this by omitting the limit and using Spotify's default page size with `data.next` pagination. If you see this error, update to the latest version.

**Spotify rate limit with 17-hour Retry-After**
Spotify's development mode has undocumented daily limits beyond the documented 250 requests/30 seconds. A full enrich across many artists can trigger this. The generator now uses batch API calls (`/v1/albums?ids=`) to reduce total calls from ~263 to ~45 per full enrich. If you hit the limit, the enricher automatically falls back to iTunes/Deezer/Tidal/Discogs and skips Spotify for the remainder of the run. Wait for the Retry-After period to expire before running again.

**Soundcharts quota exhausted mid-run**
When the Soundcharts monthly quota (1,000 credits on free tier) runs out during enrichment, the generator immediately switches to legacy mode (Spotify + per-platform lookups) for remaining artists. Already-enriched artists keep their data. The quota resets on the 1st of each month.

**Soundcharts pre-check hangs for 30+ seconds**
Fixed in v3.1.1. The pre-check now uses a single API call with no retry. If Soundcharts is rate-limiting, it falls back to legacy mode immediately.

**Albums by accented artists missing from artist pages (e.g. Amáutica)**
Fixed in v3.1.2. The artist name comparison now uses Unicode NFD normalization before stripping non-ASCII characters, so "AMAUTICA" correctly matches "Amáutica".

**Various Artists compilation appears under a regular artist**
Fixed in v3.1.1. The `fetchArtistAlbums` function now only fetches `album,single` groups from Spotify (not `appears_on,compilation`), preventing compilations from being attributed to individual artists. Compilations are handled separately via the label Bandcamp page scraper.

**Compilation album page links to non-existent artist page**
Fixed in v3.1.1. Compilation album pages now link back to `/releases/` instead of `/artists/various-artists/`.

**Some albums show as duplicates in the audit but are album + single with the same name**
Fixed in v3.1.1. The duplicate detection now considers both the item type (album vs track) and the URL, so an album and a single sharing the same title are not flagged.

**How do I run enrichment without Spotify and Soundcharts?**
Temporarily unset the credentials before running: the enricher will use iTunes, Deezer, Tidal, and Discogs only. This is useful when both Spotify and Soundcharts are rate-limited.

---

## Upcoming Releases

**How do I show unreleased albums on the site?**
Add private Bandcamp stream links to `content/upcoming.json`. Create a private stream link in Bandcamp (album settings → sharing), then add it to the JSON file mapped by artist slug. The generator fetches the metadata and shows the release with a "Coming Soon" badge.

**Do pre-orders get the badge automatically?**
Yes. Any release with a future release date gets the "Coming Soon" badge automatically — no `upcoming.json` entry needed. Pre-orders published on Bandcamp are scraped normally.

**When should I remove an entry from upcoming.json?**
When the release goes public on Bandcamp. The normal scraper will pick it up, and the "Coming Soon" badge disappears once the release date passes.

---

## News

**How do I add news articles?**
Create markdown files in `content/news/{year}/` with the naming pattern `MM-DD-slug.md`. For example: `content/news/2026/04-04-welcome-to-our-new-website.md`. Word documents (`.docx`) are also supported.

**How does the title get extracted?**
From front-matter `title:` field first, then the first `#` or `##` heading in the markdown, then derived from the filename slug.

**How do I add a feature image to a news article?**
Either add `image: filename.jpg` to the front-matter (file in the same year folder), or place a file named `{slug}.jpg` or `{MM-DD-slug}.jpg` in the year folder for auto-detection. Both naming conventions work.

**Where do news articles appear?**
The latest 10 appear on the homepage in the News section. All articles are listed on the `/news/` page with pagination. Each article gets its own page at `/news/{slug}/`.

---

## Newsletter

**Which newsletter systems are supported?**
Sendy and Listmonk. Set `NEWSLETTER_PROVIDER=sendy` or `NEWSLETTER_PROVIDER=listmonk` in `.env`. If `NEWSLETTER_PROVIDER` is not set but `NEWSLETTER_ACTION_URL` is, it defaults to Sendy for backward compatibility.

**What happens when someone subscribes with an already-subscribed email?**
Sendy returns "Already subscribed." which is shown as "You are already subscribed to this list." Listmonk returns HTTP 409 with the same message.

**What about bounced or suppressed emails?**
Sendy returns specific error messages for bounced and suppressed emails. The form shows a message asking the user to contact the label email directly.

**Can a user re-subscribe after unsubscribing?**
Yes. Sendy allows re-subscription — the user gets a new double opt-in confirmation email. No manual intervention needed.

**I get "Something went wrong" when subscribing on the live site**
This is a CORS issue. Your Sendy server needs to send `Access-Control-Allow-Origin` headers for your site domain. See the CORS section in `API-SETUP.md`. Listmonk supports CORS by default.

**How do auto-campaign drafts work?**
Set `NEWSLETTER_AUTO_CAMPAIGN=true` in `.env`. When you run `node generate.js` and new news articles are detected, a campaign draft is automatically created in your newsletter system. Campaigns are never auto-sent — you review and send manually. Tracking is via `content/news/.campaigns-created` so articles only trigger one campaign each.

**Do I need different credentials for subscribe vs campaigns?**
For Sendy: the same `NEWSLETTER_API_KEY` works for both. For Listmonk: the subscribe form uses the public API (no auth), but campaign creation requires `NEWSLETTER_API_USER` and `NEWSLETTER_API_TOKEN` (BasicAuth).

---

## CSV Import

**Where do I put the CSV file?**
Place it in the `import/` directory at the project root. This directory is gitignored since it contains label-specific data.

**How do I export the CSV from Bandcamp?**
In your Bandcamp label backend, go to **Tools → Digital Catalog Report → Export**. This produces a CSV with all your digital releases, including catalog numbers, UPCs, ISRCs, and release dates.

**What about other distributors (Believe Digital, etc.)?**
Currently only Bandcamp digital export CSVs are supported. Support for other distributor formats is planned as a future feature.

**Will it overwrite my enriched data?**
No. Gap filling only writes to fields that are `null` or missing. Existing data (streaming links, artwork, Discogs metadata, etc.) is never overwritten. A timestamped backup is created before any write.

---

## Licensing

**Can I use this commercially?**
Under the GPL-3.0 license, you can use it freely but must open-source any modifications. For commercial use without GPL obligations, contact info@aenaos-records.com for a commercial license.

**Can I sell products built with this?**
Yes, under a commercial license. Contact us to discuss pricing.
