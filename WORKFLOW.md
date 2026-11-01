# Workflow (v5.2)

## Overview

One env var (`BANDCAMP_URL`), one command (`node generate.js`). The first run asks a few questions, scrapes Bandcamp, writes `content/config.json` and renders the site. After that, `config.json` is the source of truth and `.env` holds secrets only.

---

## First-Run Flow

Triggered when there is no `cache.json` and no `content/config.json`.

```
1. .env: BANDCAMP_URL (+ optional API credentials)

2. node generate.js
   a. Source selection — only if BANDCAMP_URL is not set:
      1. Bandcamp  2. Internet Archive  3. Spotify (not implemented yet)
   b. CSV check (private/imports/*_digital.csv) → prompt with direct export link
   c. Extra artists prompt (interactive URL input)
   d. Scrape starts → account-type detection → detection summary
   e. Detection confirmation (Y/n/edit) — override label/artist mode
   f. Scrape: artists + albums
   g. Theme prompt (1/2/3) — skipped if --theme or --yes is given
   h. config.json generation (site, artists, source, stores)
   i. UPC/catalog number gap-fill from the catalog CSV (if present)
   j. Website render

3. Summary (what was detected, what is missing, next steps)
```

`--yes` / `-y` skips every prompt and uses the defaults. `--theme <name>` only skips the theme prompt.

**Recovery:** if a previous first run was aborted after the scrape (cache exists, no `config.json`), the next run asks only the theme prompt and generates `config.json` from the cache.

**Internet Archive onboarding** (source 2) asks for a collection ID, a Creative-Commons-only filter and a theme (standard, dark, or a custom template folder), then writes `config.json` with `source.primary: "archive.org"` and scrapes the collection.

---

## Day-to-Day Commands

| Command | What it does |
|---------|--------------|
| `node generate.js` | Render the site from `cache.json` (no network scrape) |
| `node generate.js --scrape` | Re-scrape all artists from Bandcamp, then render |
| `node generate.js --scrape --artist "Name"` | Re-scrape one artist (no render) |
| `node generate.js --enrich` | Add streaming links, Last.fm data, etc., then render |
| `node generate.js --enrich --force` | Re-enrich albums that were already enriched |
| `node generate.js --scrape --enrich` | Scrape, **then** enrich, then render |
| `node generate.js --enrich --deploy` | Enrich, render, SEO check, upload to S3 + CloudFront invalidation |
| `node generate.js --rollback` | Restore the most recent cache backup |

Full list: `node generate.js --help`.

### Re-scraping keeps enrichment

A re-scrape (full or `--artist`) refreshes Bandcamp data but carries over everything enrichment added: streaming links, UPCs, Discogs data, Last.fm data, physical formats, presave URLs, release dates set by enrichment, and the established page slugs (so URLs don't change). The one exception: if Bandcamp now lists physical packages for an album, physical formats are re-derived from Bandcamp.

### Cache backups

`--scrape`, `--enrich`, `--fill-gaps` and `--import-csv` write a timestamped backup (`cache.backup.<timestamp>.json`) before changing the cache. The 5 most recent backups are kept. `--rollback` restores the newest one.

### Workspace sync

If a sync backend is configured (`sync` section in `config.json`, or `SYNC_BUCKET` / `SYNC_DIR` in `.env`), every run first pulls the latest cache + content. `--sync-up` pushes local state, `--sync-down` forces a pull.

---

## Implementation Status

| Feature | Status | Notes |
|---------|--------|-------|
| Single env var (`BANDCAMP_URL`) | ✅ Done | No SITE_MODE, SITE_NAME, SITE_URL needed |
| CSV in `private/imports/` | ✅ Done | Auto-detect `*_digital.csv`, direct BC export link |
| Non-blocking CSV prompt (Y/n) | ✅ Done | Default = continue without |
| Account-type detection (API) | ✅ Done | my_bands → member_bands + connected accounts |
| Account-type detection (HTML) | ✅ Done | /artists page or regrouping |
| Detection summary | ✅ Done | Shows account type, mode, source; artist count deferred for regrouping |
| Detection confirmation (Y/n/edit) | ✅ Done | Override detected mode in interactive mode |
| Connected accounts (disabled) | ✅ Done | Saved in config.json with `relationship` field |
| Extra artists prompt | ✅ Done | Interactive URL input, saved in config.json |
| Theme prompt (1/2/3) | ✅ Done | Skippable with --yes or --theme flag |
| `--yes` flag (non-interactive) | ✅ Done | Skips all prompts |
| Internet Archive as data source | ✅ Done | Primary source or gap-fill alongside Bandcamp |
| config.json as source of truth | ✅ Done | config.json always wins |
| Legacy env fallbacks | ⚠️ Partial | Still read as fallbacks when config.json lacks a value: `SITE_NAME`/`LABEL_NAME` (renderer), `SITE_THEME`, `SITE_URL`, `NEWSLETTER_*`, `LABEL_*_URL` social links, and others. Planned for removal |
| Config-driven scraping | ✅ Done | Artists with bandcampUrl in config are scraped |
| Re-scrape keeps enrichment | ✅ Done | Full and single-artist scrape, with cache backup |
| UPC from Bandcamp scrape | ✅ Done | raw.current.upc extracted |
| UPC from CSV | ✅ Done | Matched by Bandcamp album ID (RFC 4180 CSV parsing) |
| Unicode-normalized deduplication | ✅ Done | Amáutica/AMAUTICA handled |
| Artist placeholder SVG | ✅ Done | Band silhouette for missing photos |
| Consistent hero banners | ✅ Done | Artist photo, logo as fallback, same height |
| Lightweight Spotify enrichment | ✅ Done | 2-3 calls/artist, links only |
| Spotify 429 handling (60s stop) | ✅ Done | Graceful degradation on rate limit |
| UPC from Spotify (--force only) | ✅ Done | Authoritative UPC, risk of 429 |
| Last.fm enrichment | ✅ Done | Bios, tags, listener stats, similar artists |
| Bandcamp anti-bot handling | ✅ Done | "Client Challenge" page detected and retried with backoff |
| Compilations: label-subdomain only | ✅ Done | No more 105 false positives |
| `relationship` field | ✅ Done | member_band / connected_account |
| No extra-artists.txt | ✅ Done | Replaced by interactive prompt + config.json |
| `source` object in config.json | ✅ Done | accountType, detection, confidence |
| `stores` array in config.json | ✅ Done | bandcamp, discogs, custom objects |
| `content/global/` for user assets | ✅ Done | Logo, CSS, banner — replaces manual assets/ editing |
| `compilations` as object in config | ✅ Done | `{ "various-artists": { "slug": "spotify-url" } }` |
| Discogs gated on stores config | ✅ Done | Only runs if "discogs" in stores array |
| config.json write-back per artist | ✅ Done | Spotify URLs saved after each artist, not just at end |
| Site name from Bandcamp page title | ✅ Done | No SITE_NAME env var needed |
| Hi-res artwork | ✅ Done | 1200x1200; `--upgrade-artwork` re-downloads existing |
| Merch CSV import (`*_merch.csv`) | 🔲 Planned | Same pattern as catalog CSV |
| Merch scrape (/merch page) | 🔲 Planned | HTML scraping of BC merch page |
| Merch prompt at onboarding | 🔲 Planned | "Include Merch page? [y/N]" |
| Merch page template | 🔲 Planned | Product cards + BC link, display_only |
| Metadata quality flags | 🔲 Planned | Per-release UPC/ISRC/Spotify status |
| Spotify-first onboarding path | 🔲 Planned | Option 3 in source selection exits with "not yet implemented" |
| Subscriber import (`--import-subscribers`) | 🔲 Not in this build | Exits with an error |

---

## Prompt Sequence (First Run, Bandcamp)

### 1. Source (only if `BANDCAMP_URL` is not set)

```
  Welcome to the Label Site Generator!

  Choose your primary data source:
    1. Bandcamp
    2. Internet Archive
    3. Spotify (requires SPOTIFY_CLIENT_ID/SECRET in .env)

  Source [1]:
```

Choosing Bandcamp then asks for the URL (`https://name.bandcamp.com/`).

### 2. CSV Check

```
  No Bandcamp Digital Catalog CSV found in private/imports/.

  Export here: https://your-label.bandcamp.com/tools#catalog
  Place the downloaded file in private/imports/ for reliable UPC/ISRC matching.

  Continue with public Bandcamp data only? [Y/n]:
```

`n` prints the export link again and exits so you can add the file.

### 3. Extra Artists

```
  Do you have additional Bandcamp pages to include? [y/N]:
  Enter Bandcamp URLs (one per line, empty line to finish):
  > https://extra-artist.bandcamp.com/
  > https://another-artist.bandcamp.com/
  >
  Adding 2 additional artist(s).
```

### 4. Detection Summary + Confirmation

```
  Detected setup:
    Bandcamp account type: Label
    Site mode: Label (multi-artist)
    Artists found: 15 (incl. 2 extra)
    Connected accounts: 2 (Side Project, Other Band)
    Source: Bandcamp API

  Use this setup? [Y/n/edit]:
```

`edit` lets you switch between label website (multi-artist) and artist/band website (single band).

### 5. Theme (after the scrape)

```
  Choose a theme:
    1. standard (clean, light)
    2. dark (dark background, light text)
    3. bandcamp (auto-colors from your Bandcamp page)

  Theme [1]:
```

### 6. Merch (planned — not active)

```
  Include a Merch page? [y/N]:
```

---

## config.json Structure (Generated)

```json
{
  "site": {
    "name": "Your Label",
    "url": null,
    "mode": "label",
    "theme": "bandcamp",
    "template": null
  },
  "artists": {
    "artist-slug": {
      "name": "Artist Name",
      "enabled": true,
      "source": "bandcamp",
      "exclude": false,
      "excludeAlbums": [],
      "relationship": "member_band",
      "bandcampUrl": "https://artist-name.bandcamp.com/",
      "links": { "spotify": null, "bandcamp": "https://artist-name.bandcamp.com/" }
    },
    "side-project": {
      "name": "Side Project",
      "enabled": false,
      "source": "bandcamp",
      "exclude": false,
      "excludeAlbums": [],
      "relationship": "connected_account",
      "bandcampUrl": "https://side-project.bandcamp.com/",
      "links": { "spotify": null, "bandcamp": "https://side-project.bandcamp.com/" }
    }
  },
  "compilations": {
    "various-artists": {
      "album-slug": "https://open.spotify.com/album/XXXXX"
    }
  },
  "stores": ["bandcamp"],
  "newsletter": { "provider": null },
  "source": {
    "primary": "bandcamp",
    "url": "https://your-label.bandcamp.com/",
    "accountType": "label",
    "detection": "api_member_bands",
    "confidence": "high"
  }
}
```

### `stores` Array

Controls which purchase/physical store links are shown on album pages:

- `"bandcamp"` — Bandcamp purchase link (always available from scrape)
- `"discogs"` — Discogs Marketplace sell links (requires `DISCOGS_TOKEN` + enrichment)
- Custom objects: `{ "id": "poponaut", "label": "Poponaut", "url": "https://..." }`

Discogs enrichment only runs if `"discogs"` is in the stores array AND `DISCOGS_TOKEN` is set.

Default when omitted: `["bandcamp"]`

### `source` Object

Top-level metadata about how the site was detected/created. Written once during first run, not modified afterwards:

| Field | Values | Description |
|-------|--------|-------------|
| `primary` | `bandcamp`, `archive.org` | Primary data source |
| `url` | URL string | Source URL used for scraping (Bandcamp) |
| `collection` | collection ID | Internet Archive collection (`archive.org` only) |
| `ccOnly` | `true`, `false` | Only Creative Commons releases (`archive.org` only) |
| `accountType` | `label`, `artist` | Bandcamp account type detected |
| `detection` | `api_member_bands`, `html_artists_page`, `html_regrouping` | How account type was determined |
| `confidence` | `high`, `medium`, `low` | Detection confidence |

### `sync` Object (optional)

Workspace sync backend, e.g. `{ "backend": "s3", "bucket": "...", "prefix": "", "region": "eu-central-1" }` or `{ "backend": "local", "dir": "..." }`. Takes priority over the `SYNC_*` env vars.

### User Assets: `content/global/`

Site-wide files (logo, custom CSS, favicon overrides) go in `content/global/`. Everything in this directory is copied to the output root at build time.

| File | Purpose |
|------|---------|
| `content/global/logo.png` | Custom site logo (overrides auto-downloaded Bandcamp profile image) |
| `content/global/style.css` | Custom CSS (overrides theme system entirely) |
| `content/global/banner.jpg` | Custom hero banner |
| Any other file | Copied to output root as-is |

The `assets/` directory is for generated/downloaded files (auto-logo, placeholders, favicons) and should not be edited manually. It is gitignored in fresh installs.

---

## Enrichment Flow

```
node generate.js --enrich            # all services
node generate.js --enrich --spotify  # Spotify only
node generate.js --enrich --discogs  # Discogs only
node generate.js --enrich-lastfm     # Last.fm only

Per artist:
1. Resolve Spotify artist URL (1 search call, or from config)
2. Fetch album links from Spotify (1-2 pagination calls, limit=10)
3. Title-match: BC album ↔ Spotify album (local, Unicode-normalized)
4. Assign Spotify link to BC album
5. Songlink gap-fill (YouTube Music, Amazon Music, SoundCloud, Pandora, Napster)
6. Further link sources: YouTube Music, iTunes, Deezer, Tidal (Tidal needs credentials)
7. Discogs (only if "discogs" in stores): physical formats, sell links
8. Last.fm: artist bio, listener stats, genre tags, similar artists
9. Save Spotify URL to config.json (write-back)
```

Already-enriched albums are skipped unless `--force` is given. `--tidal-only` re-checks Tidal links only.

For full metadata (all platforms, UPC, ISRCs, labels): use lsg-pro with Soundcharts (Pro only).

---

## UPC Priority

```
Manual override > Bandcamp CSV (by album ID) > Bandcamp scrape (raw.current.upc) > Spotify UPC (--force, confidence-gated) > Discogs barcode
```

---

## Evaluation Response

Based on the workflow evaluation document, here's how each critical point is addressed:

| Evaluation Point | Status | Implementation |
|-----------------|--------|----------------|
| CSV not in assets/ | ✅ Fixed | `private/imports/`, gitignored |
| CSV non-blocking | ✅ Fixed | Default Y (continue), n to abort |
| Detection transparent | ✅ Done | Summary shown before scrape |
| Detection override | ✅ Done | Y/n/edit prompt after summary |
| accountType vs siteMode separation | ✅ Done | `source` object in config.json |
| Merch display_only | 🔲 Planned | No shop backend, just product cards |
| UPC as best-effort | ✅ Done | "when present", not guaranteed |
| Metadata quality flags | 🔲 Planned | Per-release status tracking |
| Non-interactive mode | ✅ Done | `--yes` flag |
| Direct BC export link | ✅ Done | `https://{slug}.bandcamp.com/tools#catalog` |
| relationship field | ✅ Done | member_band / connected_account |
| No legacy fallbacks | ⚠️ Partial | config.json wins; some env fallbacks remain (see status table) |
| Discogs gated on stores | ✅ Done | Only runs if "discogs" in stores array |
| Compilations manual Spotify | ✅ Done | config.json compilations object with URLs |

---

## .env Reference (v5)

```env
# Required
BANDCAMP_URL=https://your-label.bandcamp.com/

# Optional: Bandcamp API (improves detection, enables connected accounts)
BANDCAMP_CLIENT_ID=
BANDCAMP_CLIENT_SECRET=

# Optional: Spotify (streaming links — lightweight enrichment)
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=

# Optional: Last.fm (artist bios, tags, listener stats — free, unlimited)
LASTFM_API_KEY=

# Optional: Discogs (physical formats, sell links — only used if "discogs" in stores)
DISCOGS_TOKEN=

# Optional: Tidal (streaming link)
TIDAL_CLIENT_ID=
TIDAL_CLIENT_SECRET=

# Optional: YouTube (channel data, video embeds; --sync-youtube, --resolve-youtube)
YOUTUBE_API_KEY=

# Optional: MusicFetch via RapidAPI (extra streaming-link lookups during --enrich)
MUSICFETCH_RAPIDAPI_KEY=

# Optional: ElasticStage (--sync-elasticstage)
ELASTICSTAGE_LABEL_URL=

# Optional: Deployment (--deploy)
AWS_S3_BUCKET=
AWS_S3_REGION=
AWS_CLOUDFRONT_DISTRIBUTION_ID=

# Optional: Workspace sync (backup, multi-machine) — or use the "sync" section in config.json
SYNC_BUCKET=          # S3 backend
SYNC_PREFIX=
SYNC_REGION=          # defaults to AWS_S3_REGION, then eu-central-1
SYNC_DIR=             # local/network folder backend (alternative to SYNC_BUCKET)

# Optional: Ghost CMS (news articles)
GHOST_URL=
GHOST_CONTENT_API_KEY=

# Optional: Newsletter (campaign drafts). Provider and form settings live in config.json → newsletter
NEWSLETTER_API_TOKEN=
NEWSLETTER_AUTO_CAMPAIGN=false

# Optional: Label aliases (comma-separated, for Spotify label filter)
LABEL_ALIASES=
```

Everything else lives in `content/config.json`.
