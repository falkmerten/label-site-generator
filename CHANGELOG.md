# Changelog

## Aenaos Static Site Generator

This project extends the original `bandcamp-scraper` library into a full static site generator for music labels.

---

### 2026 — Aenaos Static Site Generator

**Core pipeline**
- Static site generator built on top of `bandcamp-scraper`
- Bandcamp API integration for label roster (OAuth2 client_credentials)
- JSON cache (`cache.json`) — incremental scraping, skip Bandcamp on re-runs
- Single-artist refresh (`--artist <name>`) — re-scrapes one artist, preserves enrichment data
- Uses `/music` path for Bandcamp artist pages to ensure all releases are fetched
- `albumBelongsToArtist()` filter — prevents cross-artist album contamination (e.g. other artists' releases on shared Bandcamp pages)
- NFD slug normalisation — accented characters (e.g. `á`) correctly slugified

**Streaming link enrichment (`--enrich`)**
- Spotify Web API — artist page fetch (UPC extraction), album search fallback
- `content/artists.json` — maps artist slugs to Spotify artist URLs for reliable enrichment
- `--init-artists` — auto-generates `artists.json` with Spotify URLs + album list validation
- Spotify as source of truth — album list rebuilt from Spotify when artist URL is configured; unmatched Bandcamp-only releases dropped; Spotify-only releases added
- Fuzzy title matching — strips `, ALBUM`, `, EP`, `(Single)`, `feat.` suffixes for cross-platform matching
- iTunes/Apple Music API — UPC lookup, title search fallback (free, no auth)
- Deezer API — UPC lookup, title search fallback (free, no auth); sets artist-level Deezer link
- Tidal API — UPC lookup, title search fallback (requires credentials)
- Discogs API — physical formats (Vinyl, CD, Cassette), catalog number, label name, sell links, YouTube videos; fills missing release dates and descriptions
- MusicFetch via RapidAPI — optional, fills Amazon Music and other gaps

**Content system**
- `content/{artist-slug}/bio.md` — artist biography override
- `content/{artist-slug}/bio.docx` — Word document auto-converted to `bio.md` on generate
- `content/{artist-slug}/photo.jpg` — artist photo
- `content/{artist-slug}/images/` — gallery photos (lightbox on artist page)
- `content/pages/*.md` / `*.docx` — dynamic static pages (auto-discovered, footer links)
- `--init-content` — scaffolds `content/{artist}/` folders with README instructions
- Word document conversion via `mammoth` — artist bios, imprint, contact, terms, data protection, any page

**Design**
- Brand colours `#0c0032` / `#cacadb`
- Hero banner + overlapping round logo (homepage)
- Artist pages: blurred artist photo as hero banner, sharp round artist photo overlapping nav
- Album pages: blurred album artwork as hero banner, round artwork overlapping nav
- Artist photo gallery with lightbox (prev/next, keyboard navigation, click-outside-to-close)
- Physical release badges (Vinyl, CD, Cassette) with Discogs sell link and Amazon search link
- YouTube video embeds on album pages (from Discogs)
- Font Awesome 6 brand icons for all streaming services
- Sticky dark navigation with artists dropdown
- Responsive layout

**Pages**
- Homepage with latest 12 releases, artists grid, news section, about section
- Artist pages with bio, streaming links, discography, gallery
- Album pages with Bandcamp embed, streaming links, physical release section, tracklist, credits, videos
- Full releases page
- Dynamic static pages — any `.md`/`.docx` in `content/pages/` becomes a page with a footer link
- Imprint and Contact pages only rendered when content file exists

---

## Original bandcamp-scraper changelog

### Version 1.0.1 (2016-07-28)

- add property `artist` to album product
- add property `url` to album info
- fix typo in JSON schemas for `required` keyword
- fix add missing properties `releaseDate`, `numTracks`, `numMinutes` for search result type `"album"`

### Version 1.0.0 (2016-07-25)

- rename resource property `image` -> `imageUrl`
- rename resource property `images` -> `imageUrls`
- rename resource property `link` -> `url`
- rename resource property `from` -> `location`
- rename resource property `orMore` -> `offerMore`
- remove resource property `numRemaining`
