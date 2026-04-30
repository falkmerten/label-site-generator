# Label Site Generator — Code Review

**Date:** 2026-04-30  
**Version:** v4.11.1  
**Focus:** Logic traps, KISS violations, non-technical user experience, workflow friction

---

## Executive Summary

The generator is powerful and functional, but has accumulated complexity that creates friction for non-technical users. Three categories of problems:

1. **Logic traps** — behaviors that work but are confusing or fragile
2. **KISS violations** — unnecessary complexity for what the system does
3. **UX friction** — workflows that require too many steps or unclear mental models

---

## 1. Logic Traps & Edge Cases

### 1.1 Site Mode Detection — Three Conflicting Sources (CRITICAL)

The system has three sources of truth for site mode:

- `process.env.SITE_MODE` (explicit user setting)
- `data._siteMode` (auto-detected from Bandcamp account type)
- Fallback to `'label'` (hardcoded default)

**The trap:** The scraper detects the mode, the generator overwrites it with the env var (or default), and the renderer reads yet another combination. If a user has a band account but doesn't set `SITE_MODE`, behavior is unpredictable.

**Fix:** Make auto-detection the primary source. `SITE_MODE` env var should only override, never be the default.

---

### 1.2 Artwork Path Resolution — Three Different Systems

Artwork paths are handled inconsistently:

- `downloadArtwork.js` saves to `content/{artist}/{album}/artwork.jpg` and sets `album.artwork = 'artwork.jpg'`
- `merger.js` resolves artwork from content overrides or cache
- `assets.js` tries 5+ candidate paths to find the source file

**The trap:** If an album slug changes (deduplication, Unicode normalization), the artwork path resolution fails silently. The file exists but the code can't find it.

**Fix:** Store the full resolved content path in the cache during merge, not just the filename.

---

### 1.3 Cache Invalidation — Stale WebP

The image optimizer skips files where the WebP is "newer" than the source. But `fs.copyFile` preserves the original file's timestamp (from 2013!), so the optimizer thinks the old WebP is current.

**Current fix:** `assets.js` now calls `fs.utimes()` after copy. But this is a workaround, not a proper solution.

**Better fix:** Compare file sizes or checksums, not timestamps.

---

### 1.4 Regrouping Logic — Fragile Conditions

The scraper regroups albums by artist field only for the primary artist (`artists[0]`). This was recently fixed but the logic is still fragile:

- Only fires if the primary artist has albums with different artist fields
- Silent — no feedback if regrouping doesn't happen
- Can create duplicates if extra artists overlap with regrouped artists

**Fix:** Make regrouping explicit and logged. Warn if potential duplicates are detected.

---

### 1.5 Enrichment Skip Logic — Incomplete Recovery

Albums marked as "enriched" but with missing links can't be recovered without `--force`. The skip logic checks flags but not actual data completeness.

**Fix:** Check actual link presence, not just flags. "Enriched" should mean "all available links filled."

---

## 2. KISS Violations

### 2.1 Too Many Enrichment Modes

Three separate code paths (Soundcharts, Legacy, Tidal-only) with different logic, skip conditions, and error handling. ~1800 lines.

**Simpler:** Treat each source as a plugin. Call in order, each fills missing links only.

---

### 2.2 Label Filtering Duplicated 3 Times

The same Spotify-only album label filter is applied at three different stages in the enricher.

**Simpler:** Apply once, after all enrichment is complete.

---

### 2.3 Newsletter — 8+ Env Vars Per Provider

Each newsletter provider needs different env vars, but the code doesn't validate which are required.

**Simpler:** Single `NEWSLETTER_URL` + `NEWSLETTER_KEY` + auto-detect provider from URL pattern.

---

### 2.4 Slug Collision Handling — 5 Candidate Paths

`assets.js` tries 5+ path candidates to find artwork. This is a symptom of the slug system being unreliable.

**Simpler:** Resolve the path once during merge and store it.

---

## 3. Non-Technical User Experience

### 3.0 API Rate Limits — First Setup Kills Spotify (CRITICAL)

The enricher makes hundreds of API calls in rapid succession during first setup. For a label with 200 albums, this means:

- Spotify: ~200 search calls + ~200 album metadata calls + ~200 track ISRC calls = 600+ calls
- Soundcharts: ~200 identifier lookups + ~200 album metadata calls = 400+ calls
- No configurable delay between calls (only between artists, not between albums)
- No rate limit detection/backoff for Spotify (only for Soundcharts 429s)

**The trap:** A new user runs `--enrich` for the first time, the enricher fires 600 Spotify calls in 2-3 minutes, Spotify returns 429 Too Many Requests, and the enricher silently skips the remaining albums. The user doesn't know half their catalogue wasn't enriched.

**Worse:** Spotify rate limits are per-app, not per-user. Once hit, the app is throttled for all users for up to 30 seconds. Repeated violations can lead to temporary bans.

**Current state:**
- No delay between album-level Spotify calls
- No exponential backoff on 429 responses
- No "enriched X of Y albums" progress counter
- No warning when rate limit is hit
- `--force` re-enriches everything, maximizing API calls

**Fix (must-have):**
1. Add configurable delay between API calls (default 200ms for Spotify, 1000ms for Soundcharts)
2. Detect 429 responses and implement exponential backoff (1s, 2s, 4s, 8s)
3. Log clearly when rate-limited: "Spotify rate limit hit, waiting 4s..."
4. Add progress counter: "Enriching album 45 of 200..."
5. Add `--batch-size` flag to limit albums per run (e.g., `--enrich --batch-size 50`)
6. Consider caching Spotify access tokens across runs (currently re-authenticates every time)

---

### 3.1 Confusing Command Workflow

A new user needs to understand:

```bash
node generate.js                    # Generate from cache (but what cache?)
node generate.js --scrape           # Scrape from Bandcamp
node generate.js --enrich           # Add streaming links
node generate.js --scrape --enrich  # Both (but order matters?)
node generate.js --deploy           # Deploy to S3
```

**Problem:** What's the difference between running without flags and with `--scrape`? When do I need `--enrich`? What happens if I run `--enrich` without `--scrape` first?

**Fix:** Add `node generate.js --update` that does scrape + enrich + generate in one step. Make it the recommended command.

---

### 3.2 60+ Env Vars — Overwhelming

`.env.example` has 60+ variables. A new user doesn't know which 3 are essential.

**Fix:** Split into sections with clear "REQUIRED" vs "OPTIONAL" headers. Or better: a setup wizard that asks the 3 essential questions (Bandcamp URL, site name, site URL).

---

### 3.3 No Validation at Startup

Missing required env vars produce cryptic errors later in the pipeline.

**Fix:** Validate `BANDCAMP_URL`, `SITE_NAME`, `SITE_URL` at startup. Exit with clear message if missing.

---

### 3.4 Silent Failures

Many operations fail silently:
- Artwork not found → warning, continues
- Enrichment fails → skips album, continues
- Regrouping doesn't fire → no message
- Template not found → cryptic Nunjucks error

**Fix:** Add a summary at the end: "3 albums missing artwork, 2 artists without photos, 5 albums without streaming links. Run `--enrich` to fix."

---

### 3.5 No Dry-Run for Destructive Operations

`--enrich --force` re-enriches everything, potentially overwriting manual edits. No way to preview.

**Fix:** Add `--dry-run` that shows what would change without changing it.

---

## 4. Workflow Friction

### 4.1 First-Time Setup

Current workflow for a new user:

1. Clone repo
2. `npm install`
3. Copy `.env.example` to `.env`
4. Fill in 3+ env vars (which ones?)
5. `node generate.js --scrape`
6. Wait 2-5 minutes
7. `node generate.js --enrich` (optional, needs API keys)
8. Wait 5-10 minutes
9. Open `dist/index.html`

**Better:** Steps 5-9 should be one command with progress feedback.

---

### 4.2 Day-to-Day Usage

When a new release appears on Bandcamp:

1. `node generate.js --scrape --artist "Name"` (re-scrape one artist)
2. `node generate.js --enrich --artist "Name"` (enrich new album)
3. `node generate.js --deploy` (deploy)

**Better:** `node generate.js --update --artist "Name" --deploy` (one command).

---

### 4.3 Cache Backups Are Silent

The system creates timestamped backups but doesn't tell users. They don't know they can rollback.

**Fix:** Log "Cache backed up to cache.backup.2026-04-30.json" and document `--rollback`.

---

## 5. Recommendations (Priority Order)

### Must Fix Before Interview

| # | Issue | Impact | Effort |
|---|---|---|---|
| 1 | Site mode detection confusion | Users get wrong template | Low |
| 2 | Artwork path resolution | Missing artwork on site | Medium |
| 3 | Add `--update` command | Simplifies workflow | Low |
| 4 | Validate required env vars at startup | Clear error messages | Low |
| 5 | Add summary at end of generate | Users know what's missing | Low |
| 6 | API rate limit protection for first setup | Spotify/Soundcharts ban on first enrich | Medium |

### Should Fix Soon

| # | Issue | Impact | Effort |
|---|---|---|---|
| 6 | Enrichment skip logic | Incomplete data | Medium |
| 7 | Progress feedback during enrichment | Users think it's stuck | Low |
| 8 | Document the 3-command workflow clearly | New user onboarding | Low |
| 9 | Remove deprecated env var names | Reduces confusion | Low |

### Nice to Have

| # | Issue | Impact | Effort |
|---|---|---|---|
| 10 | Dry-run mode | Safety for --force | Medium |
| 11 | Setup wizard | First-time experience | High |
| 12 | Plugin-based enrichment | Code maintainability | High |
