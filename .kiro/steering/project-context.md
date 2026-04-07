---
inclusion: auto
description: Project architecture, data pipeline, CLI flags, enrichment fields, label handling, and content structure for the Label Site Generator.
---

# Label Site Generator — Project Context

## What this project is

A Node.js static site generator for independent music labels. It scrapes artist/album data from Bandcamp, enriches it with streaming links and metadata from multiple APIs (Soundcharts, Spotify, Discogs, Tidal, iTunes, Deezer), merges it with local content overrides, and renders a branded HTML website.

Live site: https://aenaos-records.com

## Architecture

### Data pipeline

```
Bandcamp scrape → cache.json → Enrichment (Soundcharts/Spotify/Discogs) → Merger (cache + content/) → Nunjucks renderer → dist/
```

### Key files

| File | Purpose |
|------|---------|
| `generate.js` | CLI entry point — all flags parsed here |
| `src/enricher.js` | Orchestrates enrichment pipeline (Soundcharts or legacy mode) |
| `src/refreshArtist.js` | Single-artist re-scrape with enrichment field preservation |
| `src/merger.js` | Merges cache data with content/ overrides, builds label URL map |
| `src/upcoming.js` | Loads upcoming releases from private Bandcamp links |
| `src/discogs.js` | Discogs API: labels, physical formats, sell links |
| `src/bandcamp.js` | Bandcamp HTML scraper |
| `src/generator.js` | Top-level pipeline: cache → merge → render → assets |
| `templates/album.njk` | Album page template (label rendering, streaming links, physical release) |
| `cache.json` | All scraped + enriched data (gitignored, ~80K lines) |
| `content/` | Local overrides: bios, artwork, videos, tour dates, upcoming releases |

### Data priority hierarchy

Content overrides > Cache (enriched) > Scraped (Bandcamp)

For release dates: Spotify/Soundcharts > Bandcamp (Spotify is authoritative)
For labels: Spotify label is primary (`labelName`), Discogs labels are secondary (`discogsLabel` + `discogsLabelUrls`)

### CLI flags

```
--scrape             Re-scrape from Bandcamp
--enrich             Run enrichment pipeline
--force              Re-enrich already-enriched albums (with --enrich)
--artist "Name"      Filter to one artist
--deploy             Generate + sync to S3 + CloudFront invalidation
--scrape --enrich --artist "Name"   Combined: re-scrape + enrich one artist
```

Deprecated: `--refresh` (alias for `--scrape` or `--force` with `--enrich`), `--artist` alone (implies `--scrape`)

## Enrichment field preservation

When re-scraping an artist (`--scrape --artist`), these fields are preserved from the cache (not overwritten by Bandcamp data):

`streamingLinks`, `upc`, `discogsUrl`, `discogsChecked`, `enrichmentChecked`, `discogsSellUrl*`, `physicalFormats`, `catalogNumber`, `labelName`, `labelUrl`, `labelUrls`, `videos`, `soundchartsUuid`, `soundchartsEnriched`, `spotifyLabel`, `distributor`, `copyright`, `discogsLabel`, `discogsLabelUrls`, `presaveUrl`

These are NOT preserved (updated from Bandcamp on re-scrape): `description`, `releaseDate` (only for new albums), `slug`, `tracks`, `tags`, `imageUrl`, `raw`

## Enrichment caching

Albums not found on external services are marked to avoid repeated API calls:
- `discogsChecked: true` — album searched on Discogs, not found
- `enrichmentChecked: { appleMusic: true, deezer: true, ... }` — per-platform skip
- Bandcamp-only albums (no Spotify, no UPC) skip gap-fill entirely
- `--force` clears all checked flags for re-querying
- Discogs sell URLs verified against `num_for_sale` on every `--enrich` run

## Upcoming releases

Private Bandcamp links in `content/upcoming.json`. Scraped during `--scrape`, not during plain generate/deploy. Get `LABEL_NAME` as default label. Skipped by all enrichment pipelines to prevent false matches.

## Label handling

- `labelName` = Spotify label (primary, from enricher)
- `labelUrls` = per-label Discogs URLs for `labelName`
- `discogsLabel` = Discogs physical release labels (when different from Spotify)
- `discogsLabelUrls` = per-label Discogs URLs for `discogsLabel`
- Merger builds a label URL map across all albums and backfills missing URLs
- Template renders both, filtering duplicates

## YouTrack project

- Project key: `LSG`
- URL: https://aenaos.youtrack.cloud/issue/LSG-XX
- Workflow: Create ticket → Develop → Staging → Done
- Commit format: `<type>: <description> (vX.Y.Z, LSG-XX)`

## Release policy

- Maximum one major or minor version bump per day (e.g. v4.2.0 → v4.3.0)
- Patch versions (e.g. v4.2.1) only for critical bugfixes
- Batch related changes into a single commit per day unless it's a critical bugfix
- Tag and push at end of work session, not after every change

## Testing

```bash
npx jest --no-coverage          # all tests
npx jest test/unit/             # unit tests only
npx jest test/property/         # property-based tests only
```

Pre-existing failures in `test/unit/exportLabelCopy.test.js` (5 tests, `source: 'soundcharts'` vs `'cache'` default) — unrelated to current work.

## Content directory structure

```
content/
  artists.json           # Spotify artist URL map
  upcoming.json          # Private Bandcamp links for unreleased albums
  compilations.json      # Spotify IDs for Various Artists compilations
  stores.json            # Extra search-based stores (Poponaut, Going Underground, etc.)
  youtube.json           # YouTube channel URLs per artist
  news/                  # Markdown news articles
  pages/                 # Static pages (imprint, contact, etc.)
  {artist-slug}/
    bio.md               # Artist biography
    photo.jpg            # Artist photo
    tourdates.json       # Manual tour dates
    links.json           # Manual link overrides
    {album-slug}/
      artwork.jpg        # Album artwork override
      videos.json        # YouTube videos
      stores.json        # Custom store links or { "hidePhysical": true }
      reviews.md         # Press quotes
```
