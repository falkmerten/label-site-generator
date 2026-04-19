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

**I changed something on Bandcamp (description, tracks, new album). Do I need `--scrape` or `--enrich`?**
You need `--scrape`. That's what pulls fresh data from Bandcamp (descriptions, tracks, tags, artwork, new albums). `--enrich` only fetches streaming links and metadata from external APIs (Soundcharts, Spotify, Discogs) and doesn't touch Bandcamp data. To do both in one run: `node generate.js --scrape --enrich --artist "Artist Name"`.

**Why are some streaming links missing?**
Enrichment runs separately from generation. Run `node generate.js --enrich` to fetch streaming links. With Soundcharts, most links are found in a single call. Some releases may not be on a particular platform.

**Why does Spotify enrichment take so long or fail?**
This only applies in legacy mode (no Soundcharts credentials). Spotify has aggressive rate limits. With Soundcharts configured, Spotify is not called at all.

**Can I run enrichment without Spotify?**
Yes. With Soundcharts credentials, Spotify is never called. Without Soundcharts, run `node generate.js --enrich` with `SPOTIFY_CLIENT_ID` unset — iTunes, Deezer, Tidal, and Discogs will still run.

**Can I enrich a single artist?**
Yes. Run `node generate.js --enrich --artist "Artist Name"`. To force re-enrichment (clear cached enrichment data), add `--force`.

**How do I re-check Tidal links only?**
Run `node generate.js --tidal-only`.

**Soundcharts discovered a release that's actually already on Bandcamp with a different title. What happened?**
The enricher matches Soundcharts releases to Bandcamp releases by normalized title and UPC. If the titles differ significantly (e.g. "In This Light Single Remixes" on Bandcamp vs "In This Light (Remixes)" on Soundcharts) and no UPC match exists, it gets added as a separate entry. To fix this: delete the duplicate from the cache manually, or re-scrape the artist with `node generate.js --scrape --artist "Name"` to refresh the Bandcamp data, then re-enrich with `--force`.

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

**Does `--enrich --force` re-enrich all artists?**
`--force` only clears enrichment flags when combined with `--artist`. Running `--enrich --force` without `--artist` clears all `enrichmentChecked` and `discogsChecked` flags globally, allowing re-querying of platforms that previously returned no results. Use `--enrich --artist "Name" --force` to force re-enrichment for a specific artist.

**What is the `--cleanup` command?**
Reports data quality issues in your cache and orphaned content folders. The audit checks for: empty tracklists, missing labels, missing streaming links, missing UPCs, label name inconsistencies, and duplicate albums. It also flags content folders that don't match any album in the cache. Dry-run only — doesn't delete or modify anything. Run `node generate.js --cleanup` to check.

**What happens if Soundcharts quota runs out mid-run?**
The enricher automatically switches to the legacy Spotify path for remaining artists. Already-enriched artists keep their Soundcharts data. If Spotify also hits a 429 rate limit, it's disabled for the rest of the run — iTunes/Deezer/Tidal/Discogs continue as gap-fill.

**What happens if my machine crashes during enrichment?**
The cache is written after each artist completes enrichment, so you lose at most one artist's worth of work. On restart, `--enrich` picks up where it left off (already-enriched artists are skipped).

**What about cache backups?**
Backups are created automatically before destructive operations (`--scrape --artist`, `--enrich`). Backup rotation keeps at most 5 files (`cache.backup.*.json`) — older ones are cleaned up automatically. Use `--rollback` to restore the most recent backup.

**What happens when I re-scrape an artist and Bandcamp data has changed?**
If the title, track count, or description changed significantly (>20% diff), the generator prompts for resolution in interactive mode (keep cached vs accept scraped). In CI or non-interactive mode, it defaults to keeping the cached version. All enrichment fields (streaming links, UPCs, Discogs data, social links, events) are preserved through re-scrapes.

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

**Albums by accented artists missing from artist pages**
Fixed in v3.1.2. The artist name comparison now uses Unicode NFD normalization before stripping non-ASCII characters, so accented names are matched correctly.

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

**I added a pre-save link to upcoming.json. Do I need to run enrichment?**
No. Run `node generate.js --scrape` (or `--scrape --artist "Artist Name"` for a single artist). A plain `node generate.js` does not re-read `upcoming.json` — the `--scrape` flag is needed to pick up changes. Enrichment is not required and actually skips upcoming releases entirely.

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
Sendy, Listmonk, and Keila. Set `NEWSLETTER_PROVIDER=sendy`, `NEWSLETTER_PROVIDER=listmonk`, or `NEWSLETTER_PROVIDER=keila` in `.env`. If `NEWSLETTER_PROVIDER` is not set but `NEWSLETTER_ACTION_URL` is, it defaults to Sendy for backward compatibility.

**How do I set up Keila?**
Set `NEWSLETTER_PROVIDER=keila`, `NEWSLETTER_ACTION_URL` to your Keila instance URL, and `NEWSLETTER_KEILA_FORM_ID` to your form ID (e.g. `nfrm_xxxxx`). The signup form POSTs directly to Keila's public form endpoint — no API token needed for subscriptions. For auto-campaign drafts, also set `NEWSLETTER_API_TOKEN` (Bearer token) and `NEWSLETTER_KEILA_SENDER_ID` (e.g. `nms_xxxxx`). In the Keila form settings, make sure `first_name` and `last_name` fields have "Cast" enabled — otherwise names from the signup form won't be stored. The site's single "Name" field is automatically split into first name and last name.

**What happens when someone subscribes with an already-subscribed email?**
Sendy returns "Already subscribed." which is shown as "You are already subscribed to this list." Listmonk returns HTTP 409 with the same message. Keila handles duplicates silently in its form processing.

**What about bounced or suppressed emails?**
Sendy returns specific error messages for bounced and suppressed emails. The form shows a message asking the user to contact the label email directly.

**Can a user re-subscribe after unsubscribing?**
Yes. Sendy allows re-subscription — the user gets a new double opt-in confirmation email. No manual intervention needed.

**I get "Something went wrong" when subscribing on the live site**
This is a CORS issue. Your Sendy server needs to send `Access-Control-Allow-Origin` headers for your site domain. See the CORS section in `API-SETUP.md`. Listmonk and Keila support CORS by default.

**How do auto-campaign drafts work?**
Set `NEWSLETTER_AUTO_CAMPAIGN=true` in `.env`. When you run `node generate.js` and new news articles are detected, a campaign draft is automatically created in your newsletter system. Campaigns are never auto-sent — you review and send manually. Tracking is via `content/news/.campaigns-created` so articles only trigger one campaign each.

**Do I need different credentials for subscribe vs campaigns?**
For Sendy: the same `NEWSLETTER_API_KEY` works for both. For Listmonk: the subscribe form uses the public API (no auth), but campaign creation requires `NEWSLETTER_API_USER` and `NEWSLETTER_API_TOKEN` (BasicAuth). For Keila: the subscribe form uses the public form endpoint (no auth), but campaign creation requires `NEWSLETTER_API_TOKEN` (Bearer auth) and `NEWSLETTER_KEILA_SENDER_ID`.

---

## Subscriber Import

**How do I import subscribers from Bandcamp?**
Export your mailing list from Bandcamp (Tools → Mailing List → Export) and place the CSV in `content/newsletter/import/`. Run `node generate.js --import-subscribers content/newsletter/import/`. The importer detects Bandcamp CSVs automatically by the `num purchases` column and processes them first.

**Can I import from multiple sources at once?**
Yes. Place all CSV files in one directory and point `--import-subscribers` at it. Bandcamp files are processed first (primary source), then other sources enrich and update existing contacts. Deduplication happens locally before any API calls — each email appears only once with the most restrictive status.

**How does the customer/subscriber split work?**
Use `--split-customers` with `--create-list "Newsletter"`. For Listmonk, this creates two lists: "Newsletter" (subscribers) and "Newsletter — Customers" (contacts with purchases). For Keila, all contacts go into one pool and two segments are created with filters on the `data.source` tag. The split is based on Bandcamp's `num purchases` column (>0 = customer) or the `Kundennummer` column in Sendy exports.

**Will the import send confirmation emails?**
No. All imported subscribers are preconfirmed — no double opt-in emails are sent during import. The lists are created as double opt-in for future signups via the website form, but imported contacts bypass this.

**What happens to unconfirmed contacts in the CSV?**
They are always skipped. Unconfirmed means the person never completed double opt-in, so there's no GDPR consent to import them.

**How are names handled?**
Names are proper-cased automatically (`john doe` → `John Doe`). Spam bot names (random strings) are filtered out. On re-import, existing contacts get improved names if the new source has a longer or more complete name. Only first names are sent to Listmonk and Sendy.

**Can I do a dry run first?**
Yes. Add `--dry-run` to preview what would be imported without making any API calls.

**What if I run the import twice?**
Duplicate contacts are handled gracefully. Listmonk returns 409 (already exists). Keila appends new tags and downgrades status if the new source has a more restrictive status (e.g. active → unsubscribed). Names are normalized on re-import.

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

## Bandsintown Integration

**How do I enable Bandsintown for an artist?**
Create `content/{artist-slug}/bandsintown.json` with your `app_id` and `artist_name`. The integration is fully opt-in — artists without this file are unaffected.

**Where do Bandsintown events appear?**
On the artist page in the "Upcoming Shows" section. Events are merged with Soundcharts and local tourdates.json using three-tier priority: Soundcharts > Bandsintown > tourdates.json. Duplicate events (same date + city) are deduplicated, with CTA fields (event URL, ticket offers) grafted from Bandsintown onto Soundcharts matches.

**What are the fan engagement CTAs?**
When Bandsintown is configured, artist pages can show: Follow on Bandsintown (with tracker count), RSVP (for events with ticket offers), Notify Me (for events without offers), and Play My City (when no upcoming events exist).

**What if the Bandsintown API is down?**
All errors are non-fatal. API failures, timeouts, and network errors log warnings but don't break site generation.

**How do I enable the email signup form on an artist page?**
Add `artist_id` (the numeric Bandsintown artist ID) to the artist's `bandsintown.json`. The form is rendered as an iframe below the events section. Default styling uses the site's brand colors. To customize colors, text, or layout, add an `email_signup` object — see the README for all available fields.

---

## Sales Reports

**How do I generate sales reports?**
Run `node generate.js --sales-report --year 2025`. This fetches Bandcamp sales data via OAuth2 and imports CSV/XLSX files from `sales/import/`. Reports are written as GFM Markdown files to `sales/{artist-slug}/`.

**Which data sources are supported?**
Bandcamp Sales API (automatic), ElasticStage CSV, Discogs Marketplace CSV, Amuse XLSX, MakeWaves CSV, and LabelCaster CSV. Place distributor exports in the corresponding `sales/import/` subdirectory.

**Will re-running double-count my CSV imports?**
No. Import tracking via `sales/import/.imported.json` uses checksums to prevent double-counting. Modified files are automatically re-imported. Use `--force` to re-import everything.

**Can I generate reports for multiple years at once?**
Yes. Use `--year 2015-2026` to generate all years in a single run (one Bandcamp auth, one CSV import pass).

**How do I get PDF reports?**
Add `--pdf` to the command. Requires `md-to-pdf` (included as a dev dependency). Example: `node generate.js --sales-report --year 2025 --business-report --pdf`.

**What about non-EUR currencies?**
GBP and USD are automatically converted to EUR using monthly ECB reference rates. Override with `SALES_EXCHANGE_RATES` env var if needed.

---

## Licensing

**Can I use this commercially?**
Under the GPL-3.0 license, you can use it freely but must open-source any modifications. For commercial use without GPL obligations, contact the maintainer for a commercial license.

**Can I sell products built with this?**
Yes, under a commercial license. Contact us to discuss pricing.
