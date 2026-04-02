# Changelog

## Label Site Generator

This project extends the original `bandcamp-scraper` library into a full static site generator for music labels.

---

### v2.7.0 — 2026-04-02

**Multi-label support**
- Each label on a release now links to its own Discogs page (previously all labels shared the first label's URL)
- `labelUrls` array added to the data model — carries per-label Discogs URLs through enricher → cache → merger → templates
- Album pages render each label as a separate link (or plain text when no URL exists), separated by ` / `
- Merger normalizes old cache entries automatically — existing `labelUrl` string becomes `[url, null, …]` so no re-enrichment is required
- Enricher collects labels from all versions of a master release, capturing co-releasing labels across pressings
- Extracted `buildLabelData` as a pure function for testability
- Property-based tests (fast-check) for enricher consistency, URL distinctness, dedup/exclusion, template rendering, format filter, and merger normalization
- Unit tests for edge cases (single label, mixed null URLs, old/new cache formats, empty label name)

---

### v2.6.0 — 2026-04-03

**Label enrichment**
- Spotify label extraction from copyright P-line (label field removed in Spotify Feb 2026 API changes)
- 172 of 181 albums now have label names
- Copyright prefix cleanup: strips `(C)`, `(P)`, `©`, `℗`, year, catalog numbers
- `HOMEPAGE_LABELS` env var — filter which labels' releases appear on homepage and releases page
- Albums without a label still shown (benefit of doubt)

**Bug fixes**
- Fixed wrong Discogs matches for short artist names — marked as checked to prevent re-fetch
- Discogs enricher skips albums marked as `discogsChecked`

---

### v2.5.2 — 2026-04-03

**SEO improvements**
- JSON-LD on all pages: `WebSite` (index), `CollectionPage` (releases), `WebPage` (static pages), `MusicGroup` (artists), `MusicAlbum` (albums)
- Video sitemap entries with YouTube thumbnails, titles, and player URLs
- Sitemap namespace extended with `video:` schema

**Bug fixes**
- Newsletter form: "Stay in the loop" heading now hides after submission, only success message shown
- Discogs title search re-enabled as fallback for label names (physical formats still UPC-only)
- Short artist names (e.g. very short names) require exact match in Discogs results

---

### v2.5.1 — 2026-04-03

**Bug fixes**
- Fixed wrong Discogs matches for short artist names — short artist names (1-2 chars after normalisation) now require exact match
- Label names now sourced from the physical release itself (not the master) when physical sell links exist
- Multiple labels on a release shown as `Label 1 / Label 2` instead of just the first one
- Cleared wrong Discogs matches for specific albums

---

### v2.5.0 — 2026-04-02

**Label name enrichment**
- Label names shown on album cards: `(CD, Digital — Label Name)`
- Label names shown on album pages with Discogs link: `Released: 29 January 2021 · Label Name`
- Discogs disambiguation numbers stripped from label names (e.g. `Label (3)` → `Label`)
- "Not On Label" entries filtered out
- Digital-only Discogs releases now contribute label name (without setting physical formats)
- Spotify label fallback — fills `labelName` when Discogs has no data
- Label mismatch warning when Discogs and Spotify report different labels
- Additive enrichment — existing label data never overwritten

**Other**
- Newsletter subscription form with inline AJAX, double opt-in support
- Bandcamp "video" track entries filtered from tracklists

---

### v2.4.0 — 2026-04-02

**New features**
- Newsletter subscription form on homepage (News section)
  - Inline AJAX submission — no page redirect
  - Configurable via `NEWSLETTER_ACTION_URL`, `NEWSLETTER_LIST_ID`
  - Double opt-in support (`NEWSLETTER_DOUBLE_OPTIN=true`) — shows confirmation email message
  - Honeypot spam protection
  - GDPR consent checkbox
  - Responsive layout (stacks on mobile)
- Compatible with Sendy, Listmonk, and similar subscribe endpoints

---

### v2.3.1 — 2026-04-02

**Bug fixes**
- Filtered out Bandcamp "video" entries from tracklists (36 removed from cache, merger now filters automatically)
- Content folder matching now uses cache slug first, fixing duplicate-title albums getting wrong videos/stores
- Responsive video grid: single video full width, 2+ videos in two columns
- Video items now properly fill their grid cells

---

### v2.3.0 — 2026-04-02

**New features**
- YouTube video sync (`--sync-youtube`) — searches YouTube Data API v3 for each album and creates `videos.json` files automatically
- Responsive video grid — single video shows full width, 2+ videos show in two columns
- `API-SETUP.md` — comprehensive setup guide for all external APIs (Bandcamp, Spotify, Tidal, Discogs, YouTube, MusicFetch, Google Analytics, AWS, ElasticStage)

---

### v2.2.0 — 2026-04-02

**New features**
- Album reviews/press quotes via `content/{artist}/{album}/reviews.md` — rendered as styled blockquotes under a "Press" heading on album pages
- Video grid now shows two videos per row (wider layout)

---

### v2.1.2 — 2026-04-02

**Bug fixes**
- Fixed URL normalizer regex that was truncating `bandcamp.com` to `bandcamp.co`
- Repaired 86 corrupted Bandcamp URLs in cache

---

### v2.1.1 — 2026-04-02

**Bug fixes**
- Fixed double slash in Bandcamp album URLs (e.g. `bandcamp.com//album/`)
- Scraper now normalises URLs to prevent double slashes in future scrapes
- ElasticStage sync gracefully handles JS-rendered pages, reports existing stores.json links

**UI**
- Artist bios and album descriptions now use justified text alignment

---

### v2.1.0 — 2026-04-02

**Custom physical store links**
- `PHYSICAL_STORES` env var controls which stores appear on album pages and in what order (default: `bandcamp,discogs`)
- Custom stores defined via env vars: `STORE_{ID}_URL`, `STORE_{ID}_LABEL`, `STORE_{ID}_ICON`
- URL templates support `{artist}` and `{album}` placeholders (auto URL-encoded)
- Per-album `stores.json` override for direct product URLs on specific releases
- Custom stores appear after built-in stores in the configured order

**Bandcamp physical products**
- Physical format badges (Vinyl, CD etc.) now sourced directly from Bandcamp `packages` data
- "Buy on Bandcamp" button shown in physical section when physical packages exist
- No Discogs enrichment needed for Bandcamp-sold physical releases

**Artist biography**
- Biography text now fills full page width (removed 65ch max-width constraint)

---

### v2.0.1 — 2026-04-02

**Bug fixes**
- Discogs: per-format sell links (Vinyl/CD) now correctly resolved from master release versions endpoint
- Discogs: ambiguous format strings (e.g. "Album") now resolved by fetching full release object
- Discogs: title search fallback disabled when UPC exists but returns no results — prevents wrong physical data being attached to releases sharing a title with unrelated Discogs entries
- Navigation dropdown: removed gap between nav item and dropdown that caused it to close when moving the mouse into it
- Tidal: `searchAlbum` no longer falls back to first result — requires title match to prevent wrong links
- Tidal: `lookupByUpc` now verifies returned album title matches before accepting

---

### v2.0.0 — 2026-04-01

**SEO & Analytics**
- Meta descriptions, Open Graph tags, Twitter Card tags on all pages
- JSON-LD structured data (`MusicGroup`, `MusicAlbum`, `MusicRecording`) for rich search results
- Canonical URLs on all pages
- Auto-generated `sitemap.xml` with priorities and `robots.txt`
- Google Analytics 4 integration via `GA_MEASUREMENT_ID` env var
- Dynamic copyright year in footer

**Artwork**
- `--download-artwork` flag — downloads all remote artwork to `content/{artist}/{album}/artwork.jpg`
- Artwork served locally — no dependency on external CDN URLs
- SVG placeholder image for albums without artwork
- Correct artwork resolution for duplicate-slug albums (e.g. two releases with same title)

**Discogs improvements**
- Master release detection — uses `/masters/{id}/versions` for accurate per-format sell links
- Per-format sell links: separate "Buy Vinyl on Discogs" and "Buy CD on Discogs" buttons
- Digital-only releases filtered out — no physical section shown for digital-only Discogs entries
- Release dates no longer sourced from Discogs (Bandcamp/Spotify only)
- Catalogue numbers removed from album pages

**Tidal improvements**
- Artist-level Tidal URL fetched from album relationships (no separate artist search needed)
- `--tidal-only` flag — re-checks Tidal links without running other enrichment
- Title verification on UPC lookup — rejects mismatched results
- `searchAlbum` requires title match — no longer falls back to first result blindly
- `tidalArtistUrl` support in `content/artists.json` for manual override

**Enrichment pipeline**
- iTunes and Deezer: title search preferred over UPC (more reliable, avoids UPC mismatches)
- Concurrent enrichment — iTunes, Deezer, Tidal, MusicFetch run in parallel per album
- Discogs throttle reduced to 1100ms (from 2000ms) with shared global rate limiter
- Bandcamp-only releases preserved when Spotify rebuilds album list
- Artist field validation prevents cross-artist album contamination
- Improved album type matching (album/EP/single) for Spotify ↔ Bandcamp pairing

**Album cards (homepage, artist pages, releases page)**
- Format availability shown: `(Digital)`, `(Vinyl, Digital)`, `(CD, Vinyl, Digital)` etc.
- Release date shown on homepage and artist page album cards

**Videos**
- `videos.json` support — add YouTube links manually per album in `content/{artist}/{album}/videos.json`
- Discogs video import removed (unreliable)

**AWS deployment**
- `--deploy` flag — syncs `dist/` to S3 and creates CloudFront invalidation
- `AWS_S3_BUCKET`, `AWS_S3_REGION`, `AWS_CLOUDFRONT_DISTRIBUTION_ID` env vars
- CloudFront invalidation output suppressed, single log line with invalidation ID

**Bug fixes**
- Fixed duplicate slug collision for albums with same title (appends release year)
- Fixed artwork path resolution for deduplicated slugs
- Fixed cross-artist album contamination (releases from one artist appearing under another)
- Fixed Tidal artist links pointing to album URLs
- Fixed 1985 placeholder dates from Discogs
- Fixed `Content-Type` header for Tidal API requests

---

### v1.0.0 — 2026 (Initial Label Site Generator release)

**Core pipeline**
- Static site generator built on top of `bandcamp-scraper`
- Bandcamp API integration for label roster (OAuth2 client_credentials)
- JSON cache (`cache.json`) — incremental scraping, skip Bandcamp on re-runs
- Single-artist refresh (`--artist <name>`)
- `albumBelongsToArtist()` filter — prevents cross-artist album contamination
- NFD slug normalisation

**Streaming link enrichment (`--enrich`)**
- Spotify, iTunes/Apple Music, Deezer, Tidal, Discogs, MusicFetch
- `content/artists.json` — Spotify artist URL map
- `--init-artists` — auto-generates `artists.json`

**Content system**
- Artist bios (Markdown or Word .docx), photos, gallery images, album artwork
- Dynamic static pages from `content/pages/`
- `--init-content` — scaffolds content folders

**Design**
- Brand colours `#0c0032` / `#cacadb`
- Hero banners, artist photo gallery with lightbox
- Physical release badges, streaming links, YouTube video embeds
- Font Awesome 6, responsive layout

---

## Original bandcamp-scraper changelog

### Version 1.0.1 (2016-07-28)

- add property `artist` to album product
- add property `url` to album info

### Version 1.0.0 (2016-07-25)

- rename resource properties (`image` → `imageUrl`, `link` → `url`, etc.)
