# Changelog

## Label Site Generator

---

### v3.5.0 — 2026-04-06

**Auto-create newsletter campaign drafts from news articles (LSG-28)**
- When `NEWSLETTER_AUTO_CAMPAIGN=true`, new news articles automatically create campaign drafts
- Sendy: POST to `/api/campaigns/create.php` with `send_campaign=0` (draft only)
- Listmonk: POST to `/api/campaigns` with `status: draft` (requires BasicAuth via `NEWSLETTER_API_USER`/`NEWSLETTER_API_TOKEN`)
- Campaign contains: title, excerpt, "Read more" button linking to article, feature image
- Tracking via `content/news/.campaigns-created` file — only new articles trigger campaigns
- Campaigns are never auto-sent — always created as drafts for manual review

---

### v3.4.0 — 2026-04-06

**Newsletter API Integration (LSG-27)**
- Provider-agnostic newsletter integration with `NEWSLETTER_PROVIDER` env var (sendy, listmonk)
- Sendy: switched from `mode: 'no-cors'` HTML endpoint to API mode (`boolean=true` + `api_key`) with real response parsing
- Listmonk: JSON POST to `/api/public/subscription` (no auth required) with proper HTTP status handling
- Specific error messages for subscriber states:
  - "Already subscribed" (Sendy plain-text / Listmonk HTTP 409)
  - "Bounced email address" → contact label email
  - "Email is suppressed" → contact label email
- Honeypot spam protection: Sendy sends `hp` field server-side, Listmonk checks client-side
- Double opt-in: DOI-aware success messages ("Check your inbox" vs "Successfully subscribed")
- Sendy `silent=true` parameter when DOI is disabled
- Backward compatible: no `NEWSLETTER_PROVIDER` + `NEWSLETTER_ACTION_URL` set = sendy default
- Provider config via extensible `NEWSLETTER_PROVIDERS` map in renderer (add new providers with one entry)
- `resolveNewsletter()` exported for testing

---

### v3.3.0 — 2026-04-06

**Spotify searchAlbum fallback (LSG-2)**
- After `fetchArtistAlbums` builds the album list, Bandcamp albums without a Spotify match now get a title-based search fallback via `searchAlbum`
- Catches albums that Spotify's artist page doesn't list (e.g., one artist had 9 of 20 albums missing from the artist endpoint)
- `albumBelongsToArtist` filter applied to search fallback — skips albums from other artists on shared Bandcamp pages (e.g., other artists' releases on shared Bandcamp pages)
- Works in both Soundcharts and legacy enrichment paths
- Rate limit (429) propagated correctly — disables Spotify for remaining artists
- Hardened `searchAlbum` scoring validation:
  - Artist-only match (score 1) removed — was causing false positives
  - Short artist names (≤3 chars after normalisation) require exact album match
  - Artists normalising to <2 chars (e.g. `Artist` → `a`) skip search entirely
  - Partial album match (score 2) requires target album ≥6 chars and only accepted with single candidate
  - `scoreSearchResult` extracted as testable function with 20 property-based tests
- Verified against live Spotify API: missing albums confirmed not on Spotify, short-name artist correctly blocked by short-name protection

---

### v3.2.5 — 2026-04-06

**Improvements**
- Spotify title normalization during `--artist` refresh (LSG-10) — after re-scraping, titles are normalized against Spotify catalog if artist has a configured Spotify URL
- Cache integrity property-based tests (LSG-4) — 20 tests covering backup rotation, enrichment preservation, conflict detection, content-first priority, and audit report completeness

---

### v3.2.4 — 2026-04-06

**Bug fixes**
- Fixed Bandcamp URL verification not scraping album data after HEAD request (LSG-25) — verified albums now get full metadata (albumId for embedded player, tracks, tags, artwork)

---

### v3.2.3 — 2026-04-06

**Bug fixes**
- Fixed news article image auto-detection not finding date-prefixed image files (e.g. `02-27-my-article.jpg`) — now checks both `{slug}.ext` and `{MM-DD-slug}.ext` naming conventions

---

### v3.2.2 — 2026-04-06

**Bug fixes — Mobile image variants**
- Fixed missing mobile `<source>` entries in `artist.njk` (hero, gallery, discography) and `album.njk` (hero) — mobile browsers now receive optimized `-mobile.webp` variants via `toMobileWebp` filter with `media="(max-width: 640px)"`
- Fixed missing mobile `<source>` in homepage news section (`index.njk`)
- Fixed image optimizer skipping mobile variant generation for images ≤ 600px wide — now always generates `-mobile.webp` and `-mobile.jpg` (at original size for small images, resized to 600px for larger ones)

---

### v3.2.1 — 2026-04-05

**Security fixes (CodeQL)**
- Fixed incomplete HTML tag sanitization in news excerpt extraction — iterative stripping prevents nested tag bypass (e.g. `<scr<script>ipt>`)
- Fixed incomplete URL substring check for Bandcamp domain — now validates hostname properly instead of substring match
- Added `permissions: contents: read` to GitHub Actions workflow (least privilege)
- Updated Actions to v4, Node test matrix to 18/20/22

**Bug fixes**
- Fixed Discogs physical format misattribution for singles sharing album title (LSG-20) — singles (≤3 tracks, `/track/` URL, or itemType track) skip physical format assignment
- Fixed "Coming Soon" badge covering entire card — now overlays artwork only
- Fixed Bandcamp player showing for private/upcoming releases
- Fixed `content/news/` flagged as orphaned artist folder
- Fixed label inconsistencies: inconsistent label name casing normalized

---

### v3.2.0 — 2026-04-05

**Upcoming / Coming Soon releases**
- `content/upcoming.json` — add private Bandcamp stream links for unreleased albums
- Private stream links (`https://bandcamp.com/private/{CODE}`) are scraped for metadata (title, artist, artwork, release date)
- "Coming Soon" badge on album cards for releases with future release dates (pre-orders and upcoming)
- Album pages show "Pre-order" instead of "Released" for future dates
- Upcoming releases bypass the homepage label filter — always shown
- `--artist` refresh now loads upcoming releases for the refreshed artist

**Dual label support (digital vs physical)**
- When Spotify and Discogs report different labels, both are stored
- `discogsLabel` field preserves the physical release label from Discogs
- Album pages show both labels separated by " / " when they differ
- Only set when the Discogs label comes from an actual physical release (Vinyl/CD/Cassette)

**Spotify improvements**
- Label extraction now prefers C-line (© = label) over P-line (℗ = sound recording copyright)
- Spotify release dates are authoritative — override Bandcamp dates when different
- Batch album endpoint (`/v1/albums?ids=`) blocked in dev mode — reverted to per-album calls
- Release dates extracted from Bandcamp raw data for 34 albums that were missing them
- UPCs fetched for 18 albums that had Spotify URLs but no UPC

**Enrichment & data quality**
- `compilations.json` — direct Spotify album ID mapping for Various Artists compilations
- Various Artists excluded from Spotify/Soundcharts enrichment (prevents junk matches)
- `albumBelongsToArtist` uses NFD normalization for accented artist names (fixes accented artist names)
- `refreshArtist` preserves Spotify-only and upcoming albums during re-scrape
- `releaseDate` and `slug` added to enrichment field preservation list
- Artist slug mismatch fixed in `artists.json`
- Inconsistent label name normalized

**Performance & Lighthouse**
- Self-hosted Font Awesome (no CDN dependency, served from own CloudFront)
- Font preloading (`woff2` files) + `font-display: swap` override
- `fetchpriority="high"` on hero banner image
- Mobile image variants (600px WebP) for all images
- `<picture>` tags with mobile srcset on grid cards
- Banner and logo converted to WebP with mobile variants
- S3 deploy with per-file-type `Cache-Control` headers
- `SiteNavigationElement` structured data for Google sitelinks
- Hamburger menu breakpoint raised to 960px for tablets
- Image optimizer skip logic fixed (small images no longer re-processed)

**News system**
- File-based news: `content/news/{year}/MM-DD-slug.md` (or `.docx`)
- Homepage shows latest 10 articles, `/news/` listing with pagination
- Individual article pages at `/news/{slug}/`
- Front-matter: `title`, `excerpt`, `image` fields
- News heading styles fixed (no section border/uppercase)
- Front-matter parsing handles Windows CRLF line endings

**Other**
- Compilation album pages link back to `/releases/` (not non-existent VA artist page)
- Duplicate detection considers item type and URL (no false positives)
- Removed spurious `appears_on` artifact from cache
- Cleaned up licensing: single `LICENSE` file with dual-license header
- FAQ updated with troubleshooting section
- YouTrack project tracking (LSG)

---

### v3.1.2 — 2026-04-04

**News system (markdown-first)**
- New file-based news system: `content/news/{year}/MM-DD-slug.md` (or `.docx`)
- Homepage shows latest 10 articles with title, excerpt, date, and feature image
- Dedicated `/news/` listing page with pagination (12 per page)
- Individual article pages at `/news/{slug}/`
- Front-matter support: `title`, `excerpt`, `image` fields
- Auto-detection of feature images by slug name in year folder
- "News" nav link appears in header when articles exist
- Backward compatible: no `content/news/` folder = existing behavior unchanged

**Bug fixes**
- Fixed `albumBelongsToArtist` dropping albums with accented artist names (e.g. accented vs non-accented artist names) — NFD normalization now decomposes accents before comparison
- Fixed news article `h2`/`h3` headings inheriting section border-bottom and uppercase styling
- Fixed news item titles on listing pages inheriting section heading styles
- Fixed front-matter parsing failing on Windows CRLF line endings

---

### v3.1.1 — 2026-04-04

**Bug fixes — Enrichment fallback chain**
- Fixed Soundcharts pre-check wasting 35+ seconds retrying on rate limit — now uses a single API call with no retry
- Fixed Soundcharts quota exhaustion mid-artist not triggering immediate fallback to Spotify — previously only detected after the artist was fully processed
- Fixed Spotify label fallback blocked when SC credentials exist but quota is exhausted — guard now checks actual mode, not just credential presence
- Fixed `fetchArtistAlbums` silently returning empty on Spotify rate limit — now throws a typed error so the enricher disables Spotify for remaining artists immediately
- Fixed `fetchArtistAlbums` rate limit error crashing the enrichment run in Soundcharts mode — now caught and handled gracefully
- Fixed Spotify `limit` parameter rejected by API (HTTP 400 "Invalid limit") — removed explicit limit, uses Spotify's default page size with `data.next` pagination
- Optimized `fetchArtistAlbums` UPC fetching — batch endpoint (`/v1/albums?ids=`) replaces per-album calls, reducing Spotify API calls from ~263 to ~62 for a full enrich

**Bug fixes — Compilation handling**
- Fixed scraper classifying all unscraped label page albums as "Various Artists" — now checks actual Bandcamp artist field, only albums with artist "Various Artists"/"various" are treated as compilations
- Fixed `fetchArtistAlbums` pulling `appears_on` compilations into individual artist catalogs — reverted to `album,single` groups only
- Fixed compilation album pages not being created — renderer now generates album pages for Various Artists while skipping the artist page and grid entry
- Fixed compilation album page back-links pointing to non-existent `/artists/various-artists/` — now links to `/releases/` page
- Fixed renderer label filter excluding label Bandcamp albums without a matching homepage label — albums from `BANDCAMP_LABEL_URL` origin always included

**Bug fixes — Audit & data quality**
- Fixed duplicate album detection false positives for album+single pairs with same title (multiple artists) — now considers item type and URL
- Normalized inconsistent label names across catalog
- Removed spurious `appears_on` artifact from cache

**Data recovery**
- Restored missing album from cache backup
- Scraped and added missing EP from Bandcamp
- Added "Join the dark side, we have the music!" compilation under Various Artists

---

### v3.1.0 — 2026-04-03

**Bandcamp URL verification**
- Spotify-only albums are now automatically verified against Bandcamp by constructing URLs from the title and checking with HEAD requests
- Catches albums the Bandcamp scraper misses due to `/music` page limitations (e.g. older releases not listed)
- Bandcamp-style slug generation drops apostrophes (Heart's → hearts) matching Bandcamp's URL format

**Bandcamp scraper improvements**
- `/music` page now parses the `#pagedata` data-blob JSON for album URLs, with fallback to `<a>` tag parsing
- Finds more albums on pages where Bandcamp embeds the catalog in JSON rather than HTML links

**Enrichment pipeline restructured**
- Pipeline order: Bandcamp → Spotify (album list) → Bandcamp verification → Soundcharts → gap-fill → Discogs
- Spotify builds the album catalog with title matching, Soundcharts enriches without adding extra releases
- Automatic cache backup before `--artist` re-scrape and `--enrich` operations

**Documentation**
- New "New release workflow" section in README
- Updated enrichment pipeline documentation

---

### v3.0.1 — 2026-04-03

**Bug fixes**
- Fixed artwork resolution for duplicate-title albums (e.g. self-titled album + EP) — merger now checks URL-derived and year-deduped content folder slugs
- Fixed missing label URLs — labels known from other albums (e.g. known from other albums) now get their Discogs link across the catalog
- Fixed `--sync-youtube --artist` triggering a Bandcamp re-scrape instead of filtering YouTube sync
- Fixed CLI argument parsing for `--sync-youtube`, `--sync-elasticstage`, `--cleanup` — no longer exits early, allows combining with `--artist`

**Improvements**
- Automatic cache backup before destructive operations (`--artist` re-scrape, `--enrich`) — saved as `cache.backup.{timestamp}.json`
- `--sync-youtube --artist "Name"` — sync YouTube videos for a single artist only

---

### v3.0.0 — 2026-04-03

**Soundcharts API integration**
- Soundcharts replaces Spotify/iTunes/Deezer/Tidal as the primary enrichment source when credentials are configured
- All streaming links (Spotify, Apple Music, Deezer, Tidal, Amazon Music, YouTube, SoundCloud) fetched in 1 API call per artist + 2 per album
- Album metadata: UPC, label, distributor, copyright (P-line) from Soundcharts
- Social media links auto-populated: Facebook, Instagram, TikTok, X/Twitter, Linktree
- Discovery links: Genius, Last.fm, MusicBrainz
- Upcoming shows/tour dates from Soundcharts events endpoint, rendered on artist pages
- Bandsintown and Songkick "More dates" links on artist pages
- Gap-fill: iTunes/Deezer/Tidal called only for links Soundcharts didn't return
- Legacy mode: full existing pipeline runs when Soundcharts credentials are absent
- Quota tracking: logs remaining credits, warns below 100, stops at 0
- Incremental: skips already-enriched artists/albums, only processes new or changed data

**Single-artist enrichment**
- `--enrich --artist "Name"` enriches a single artist without processing the full roster
- `--enrich --artist "Name" --refresh` forces re-enrichment (clears Soundcharts UUIDs)

**Artist pages**
- Unified links section: website + social media links with branded icons, then streaming links
- "Upcoming Shows" section with date, venue, city, country, festival badges
- Social links merged from both Bandcamp and Soundcharts (no duplicates)

**Bandcamp scraper rewrite**
- Replaced the original bandcamp-scraper library (MIT) with a native implementation (GPL-3.0)
- New `src/bandcamp.js` using native `https` + `cheerio` with async/await
- Removed `lib/`, `schemas/`, `spec/` directories and `LICENSE-MIT`
- Dropped dependencies: `tinyreq`, `scrape-it`, `ajv`, `json5`, `linez`, `jasmine`
- Codebase is now fully GPL-3.0

**Content & enrichment tools**
- `--cleanup` command to report orphaned content folders not matching any album in cache
- `links.json` support for manual artist link overrides (social, streaming, websites)
- Album discovery from Soundcharts — releases not on Bandcamp are automatically added (matched by title, UPC, and Soundcharts UUID)
- Fuzzy title matching for dedup (strips Single/Remastered suffixes, preserves Deluxe/Remixes/EP)

**UI fixes**
- Mobile navigation scroll fix (max-height + overflow-y on mobile nav)
- "Built with Label Site Generator" footer credit with GitHub link

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
- Static site generator for Bandcamp music labels
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
