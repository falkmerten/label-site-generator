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
   e. Merch prompt (y/N) — planned
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
| Detection summary | ✅ Done | Shows account type, mode, artists, connected, source |
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
| Merch CSV import (`*_merch.csv`) | 🔲 Planned | Same pattern as catalog CSV |
| Merch scrape (/merch page) | 🔲 Planned | HTML scraping of BC merch page |
| Merch prompt at onboarding | 🔲 Planned | "Include Merch page? [y/N]" |
| Merch page template | 🔲 Planned | Product cards + BC link, display_only |
| Detection confirmation (Y/n/edit) | 🔲 Planned | Override detected mode |
| Metadata quality flags | 🔲 Planned | Per-release UPC/ISRC/Spotify status |
| Spotify-first onboarding path | 🔲 v5.1 | For labels without Bandcamp |
| `source` object in config.json | 🔲 Planned | accountType, detection, confidence |

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

### 5. Merch (planned)

```
  Include a Merch page? [y/N]:
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
    "source": "bandcamp",
    "sourceUrl": "https://aenaos.bandcamp.com/",
    "discogsUrl": null
  },
  "artists": {
    "amautica": {
      "name": "Amáutica",
      "enabled": true,
      "source": "bandcamp",
      "relationship": "member_band",
      "bandcampUrl": "https://amautica.bandcamp.com/",
      "links": { "spotify": null, "soundcharts": null }
    },
    "shearer": {
      "name": "Shearer",
      "enabled": false,
      "source": "bandcamp",
      "relationship": "connected_account",
      "bandcampUrl": "https://shearer.bandcamp.com/",
      "links": { "spotify": null }
    }
  },
  "compilations": ["various-artists"],
  "newsletter": { "provider": null }
}
```

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
Spotify UPC (--force) > Bandcamp scrape (raw.current.upc) > CSV export > Discogs barcode
```

---

## Evaluation Response

Based on the workflow evaluation document, here's how each critical point is addressed:

| Evaluation Point | Status | Implementation |
|-----------------|--------|----------------|
| CSV not in assets/ | ✅ Fixed | `private/imports/`, gitignored |
| CSV non-blocking | ✅ Fixed | Default Y (continue), n to abort |
| Detection transparent | ✅ Done | Summary shown before scrape |
| Detection override | 🔲 Planned | Y/n/edit prompt after summary |
| accountType vs siteMode separation | 🔲 Planned | `source` object in config.json |
| Merch display_only | 🔲 Planned | No shop backend, just product cards |
| UPC as best-effort | ✅ Done | "when present", not guaranteed |
| Metadata quality flags | 🔲 Planned | Per-release status tracking |
| Non-interactive mode | ✅ Done | `--yes` flag |
| Direct BC export link | ✅ Done | `https://{slug}.bandcamp.com/tools#catalog` |
| relationship field | ✅ Done | member_band / connected_account |
| No legacy fallbacks | ✅ Done | .env = secrets only |

---

## .env Reference (v5)

```env
# Required
BANDCAMP_URL=https://your-label.bandcamp.com/

# Optional: Bandcamp API (improves detection, enables connected accounts)
BANDCAMP_CLIENT_ID=
BANDCAMP_CLIENT_SECRET=

# Optional: Spotify (streaming links)
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=

# Optional: Soundcharts (full metadata — recommended for labels)
SOUNDCHARTS_APP_ID=
SOUNDCHARTS_API_KEY=

# Optional: Discogs (physical formats)
DISCOGS_TOKEN=

# Optional: Deployment
AWS_S3_BUCKET=
AWS_S3_REGION=
AWS_CLOUDFRONT_DISTRIBUTION_ID=

# Optional: Ghost CMS (news)
GHOST_URL=
GHOST_CONTENT_API_KEY=
```

Everything else lives in `content/config.json`.
