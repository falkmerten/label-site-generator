# v5.0.0 Onboarding Workflow

## Overview

The v5 onboarding replaces the old multi-file, multi-env-var setup with a single interactive flow. One env var (`BANDCAMP_URL`), one command (`node generate.js`), the generator handles the rest.

---

## First-Run Flow

```
1. .env: only BANDCAMP_URL (+ optional API credentials)

2. node generate.js
   a. CSV check (private/imports/) → prompt with direct export link
   b. Account-type detection → summary with connected accounts
   c. Extra artists prompt (interactive URL input)
   d. Theme prompt (1/2/3)
   e. Merch prompt (y/N) — v5.1, not active
   f. Scrape: Artists + Albums (+ Merch if enabled)
   g. UPC from Bandcamp data + CSV (if present)
   h. config.json generation (all settings, artists, merch)
   i. Website render

3. Summary (what was detected, imported, missing, next steps)
```

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
| Connected accounts (disabled) | ✅ Done | Saved in config.json with `relationship` field |
| Extra artists prompt | ✅ Done | Interactive URL input, saved in config.json |
| Theme prompt (1/2/3) | ✅ Done | Skippable with --yes or --theme flag |
| `--yes` flag (non-interactive) | ✅ Done | Skips all prompts |
| config.json as source of truth | ✅ Done | No legacy fallbacks |
| Config-driven scraping | ✅ Done | Artists with bandcampUrl in config are scraped |
| UPC from Bandcamp scrape | ✅ Done | raw.current.upc extracted |
| UPC from CSV | ✅ Done | Matched by Bandcamp album ID |
| Unicode-normalized deduplication | ✅ Done | Amáutica/AMAUTICA handled |
| Artist placeholder SVG | ✅ Done | Band silhouette for missing photos |
| Consistent hero banners | ✅ Done | Logo as fallback, same height |
| Lightweight Spotify enrichment | ✅ Done | 2-3 calls/artist, links only |
| Spotify 429 handling (60s stop) | ✅ Done | SC recommendation on rate limit |
| UPC from Spotify (--force only) | ✅ Done | Authoritative UPC, risk of 429 |
| SC recommendation in summary | ✅ Done | Always shown when SC not configured |
| Compilations: label-subdomain only | ✅ Done | No more 105 false positives |
| `relationship` field | ✅ Done | member_band / connected_account |
| No legacy env fallbacks | ✅ Done | .env = secrets only |
| No extra-artists.txt | ✅ Done | Replaced by interactive prompt + config.json |
| `source` object in config.json | ✅ Done | accountType, detection, confidence |
| `stores` array in config.json | ✅ Done | bandcamp, discogs, custom objects |
| `content/global/` for user assets | ✅ Done | Logo, CSS, banner — replaces manual assets/ editing |
| `compilations` as object in config | ✅ Done | `{ "various-artists": { "slug": "spotify-url" } }` |
| Discogs gated on stores config | ✅ Done | Only runs if "discogs" in stores array |
| config.json write-back per artist | ✅ Done | Spotify URLs saved after each artist, not just at end |
| Site name from Bandcamp page title | ✅ Done | No SITE_NAME env var needed |
| Merch CSV import (`*_merch.csv`) | 🔲 Planned | Same pattern as catalog CSV |
| Merch scrape (/merch page) | 🔲 Planned | HTML scraping of BC merch page |
| Merch prompt at onboarding | 🔲 Planned | "Include Merch page? [y/N]" |
| Merch page template | 🔲 Planned | Product cards + BC link, display_only |
| Detection confirmation (Y/n/edit) | ✅ Done | Override detected mode in interactive mode |
| Metadata quality flags | 🔲 Planned | Per-release UPC/ISRC/Spotify status |
| Spotify-first onboarding path | 🔲 v5.1 | For labels without Bandcamp |

---

## Prompt Sequence (First Run)

### 1. CSV Check

```
  No Bandcamp Digital Catalog CSV found in private/imports/.

  Export here: https://aenaos.bandcamp.com/tools#catalog
  Place the downloaded file in private/imports/ for reliable UPC/ISRC matching.

  Continue without CSV? [Y/n]:
```

### 2. Detection Summary

```
  Detected setup:
    Bandcamp account type: Label
    Site mode: Label (multi-artist)
    Artists found: 15
    Connected accounts: 2 (Shearer, afmusic)
    Source: Bandcamp API
```

### 3. Extra Artists

```
  Do you have additional Bandcamp pages to include? [y/N]:
  Enter Bandcamp URLs (one per line, empty line to finish):
  > https://goldenapes.bandcamp.com/
  > https://voyna-official.bandcamp.com/
  >
  Adding 2 additional artist(s).
```

### 4. Theme

```
  Choose a theme:
    1. standard (clean, light)
    2. dark (dark background, light text)
    3. bandcamp (auto-colors from your Bandcamp page)

  Theme [1]:
```

### 5. Merch (v5.1 — not active)

```
  Include a Merch page? [y/N]:    ← planned for v5.1
```

---

## config.json Structure (Generated)

```json
{
  "site": {
    "name": "Aenaos Records",
    "url": null,
    "mode": "label",
    "theme": "bandcamp",
    "template": null
  },
  "artists": {
    "amautica": {
      "name": "Amáutica",
      "enabled": true,
      "source": "bandcamp",
      "exclude": false,
      "excludeAlbums": [],
      "relationship": "member_band",
      "bandcampUrl": "https://amautica.bandcamp.com/",
      "links": { "spotify": null, "soundcharts": null, "bandcamp": "https://amautica.bandcamp.com/" }
    },
    "shearer": {
      "name": "Shearer",
      "enabled": false,
      "source": "bandcamp",
      "exclude": false,
      "excludeAlbums": [],
      "relationship": "connected_account",
      "bandcampUrl": "https://shearer.bandcamp.com/",
      "links": { "spotify": null, "bandcamp": "https://shearer.bandcamp.com/" }
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
    "url": "https://aenaos.bandcamp.com/",
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

Top-level metadata about how the site was detected/created. Written once during first-run, not modified afterwards:

| Field | Values | Description |
|-------|--------|-------------|
| `primary` | `bandcamp`, `spotify`, `archive` | Primary data source |
| `url` | URL string | Source URL used for scraping |
| `accountType` | `label`, `artist` | Bandcamp account type detected |
| `detection` | `api_member_bands`, `html_artists_page`, `html_regrouping` | How account type was determined |
| `confidence` | `high`, `medium`, `low` | Detection confidence |

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

## Enrichment Flow (after first run)

```
node generate.js --enrich

Per artist:
1. Resolve Spotify artist URL (1 search call, or from config)
2. Fetch album links from Spotify (1-2 pagination calls, limit=10)
3. Title-match: BC album ↔ Spotify album (local, Unicode-normalized)
4. Assign Spotify link to BC album
5. Save Spotify URL to config.json (write-back)

No UPC fetch, no metadata, no ISRCs.
For full metadata: configure Soundcharts.
```

---

## UPC Priority

```
Manual override > Soundcharts > Bandcamp CSV (by album ID) > Bandcamp scrape (raw.current.upc) > Spotify UPC (--force, confidence-gated) > Discogs barcode
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
| No legacy fallbacks | ✅ Done | .env = secrets only |
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

# Optional: Soundcharts (full metadata — recommended for professional catalog needs)
SOUNDCHARTS_APP_ID=
SOUNDCHARTS_API_KEY=

# Optional: Discogs (physical formats, sell links — only used if "discogs" in stores)
DISCOGS_TOKEN=

# Optional: Tidal (streaming link)
TIDAL_CLIENT_ID=
TIDAL_CLIENT_SECRET=

# Optional: YouTube (channel data, video embeds)
YOUTUBE_API_KEY=

# Optional: Deployment
AWS_S3_BUCKET=
AWS_S3_REGION=
AWS_CLOUDFRONT_DISTRIBUTION_ID=

# Optional: Ghost CMS (news articles)
GHOST_URL=
GHOST_CONTENT_API_KEY=

# Optional: Newsletter (campaign drafts)
NEWSLETTER_PROVIDER=
NEWSLETTER_API_TOKEN=
NEWSLETTER_AUTO_CAMPAIGN=true

# Optional: Label aliases (comma-separated, for Spotify label filter)
LABEL_ALIASES=
```

Everything else lives in `content/config.json`.
