'use strict'

const fs = require('fs/promises')
const { toSlug, assignSlugs } = require('./slugs')
const { readCache } = require('./cache')
const { loadExtraArtistUrls } = require('./scraper')
const { getLabelArtistUrls } = require('./bandcampApi')

const VALID_TYPES = new Set(['album', 'album_track', 'track', 'licensed_album'])
const REQUIRED_HEADERS = ['type', 'release_artist', 'release_title']
const CSV_COLUMNS = [
  'type', 'id', 'release_artist', 'release_title', 'album_track_title',
  'catalog_number', 'upc', 'isrc', 'release_date', 'price',
  'additional_contribution_allowed'
]

/**
 * Parse an RFC 4180 CSV string into an array of string arrays.
 * Handles quoted fields containing commas, double-quotes, and newlines.
 * @param {string} text - Raw CSV text
 * @returns {string[][]} Array of rows, each row an array of field values
 */
function parseRfc4180 (text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  let i = 0

  while (i < text.length) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"'
          i += 2
        } else {
          inQuotes = false
          i++
        }
      } else {
        field += ch
        i++
      }
    } else {
      if (ch === '"') {
        inQuotes = true
        i++
      } else if (ch === ',') {
        row.push(field)
        field = ''
        i++
      } else if (ch === '\r') {
        if (i + 1 < text.length && text[i + 1] === '\n') {
          i++
        }
        row.push(field)
        field = ''
        rows.push(row)
        row = []
        i++
      } else if (ch === '\n') {
        row.push(field)
        field = ''
        rows.push(row)
        row = []
        i++
      } else {
        field += ch
        i++
      }
    }
  }

  // Handle last field/row
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

/**
 * Parse a Bandcamp digital export CSV file into a flat array of CsvRow objects.
 *
 * @param {string} filePath - Path to the CSV file
 * @returns {Promise<CsvRow[]>} Parsed rows with recognised type values
 * @throws {Error} "CSV file not found: {path}" if file doesn't exist
 * @throws {Error} "Missing required CSV columns: {cols}" if headers are invalid
 */
async function parseCsv (filePath) {
  // Validate file existence
  try {
    await fs.access(filePath)
  } catch {
    throw new Error(`CSV file not found: ${filePath}`)
  }

  const text = await fs.readFile(filePath, 'utf8')
  const rawRows = parseRfc4180(text)

  if (rawRows.length === 0) {
    throw new Error('Missing required CSV columns: type, release_artist, release_title')
  }

  // Extract and validate headers
  const headers = rawRows[0].map(h => h.trim().toLowerCase())
  const missing = REQUIRED_HEADERS.filter(h => !headers.includes(h))
  if (missing.length > 0) {
    throw new Error(`Missing required CSV columns: ${missing.join(', ')}`)
  }

  // Build header index map
  const headerIndex = {}
  for (let i = 0; i < headers.length; i++) {
    headerIndex[headers[i]] = i
  }

  // Parse data rows
  const rows = []
  for (let r = 1; r < rawRows.length; r++) {
    const rawRow = rawRows[r]

    // Build row object from known columns
    const row = {}
    for (const col of CSV_COLUMNS) {
      const idx = headerIndex[col]
      row[col] = idx !== undefined && idx < rawRow.length ? rawRow[idx].trim() : ''
    }

    // Skip unrecognised type values
    if (!VALID_TYPES.has(row.type)) {
      console.warn(`Warning: skipping row with unrecognised type "${row.type}"`)
      continue
    }

    rows.push(row)
  }

  return rows
}

/**
 * Convert an empty string to null, otherwise return the value as-is.
 * @param {string} val
 * @returns {string|null}
 */
function emptyToNull (val) {
  return val === '' ? null : val
}

/**
 * Strip zero-width characters and common Bandcamp CSV title suffixes.
 * @param {string} title
 * @returns {string}
 */
function normalizeTitle (title) {
  if (!title) return title
  return title
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '') // strip zero-width chars
    .replace(/,\s*(ALBUM|SINGLE)\s*$/i, '')      // strip trailing ", ALBUM" / ", SINGLE"
    .replace(/\s*\(Single\)\s*$/i, '')            // strip trailing "(Single)"
    .trim()
}

/**
 * Group flat CSV rows into a structured artist → album → tracks hierarchy.
 *
 * @param {CsvRow[]} rows - Parsed CSV rows from parseCsv()
 * @returns {CsvArtist[]} Grouped artist data with albums and tracks
 */
function groupByArtist (rows) {
  /** @type {Map<string, CsvArtist>} keyed by artist slug */
  const artistMap = new Map()
  /** @type {Map<string, CsvAlbum>} keyed by "artistSlug::title::id" */
  const albumMap = new Map()
  /** dedup set keyed by "artistSlug::title::id" */
  const seenAlbums = new Set()

  // Helper: get or create artist entry
  function getArtist (name) {
    const slug = toSlug(name)
    if (!artistMap.has(slug)) {
      artistMap.set(slug, { name, slug, albums: [] })
    }
    return artistMap.get(slug)
  }

  // Helper: get or create album entry for album/licensed_album rows
  function getAlbum (row) {
    const artistSlug = toSlug(row.release_artist)
    const title = normalizeTitle(row.release_title)
    const key = `${artistSlug}::${title}::${row.id}`

    if (seenAlbums.has(key)) {
      if (albumMap.has(key)) {
        return albumMap.get(key)
      }
      return null
    }

    seenAlbums.add(key)

    const album = {
      title,
      slug: toSlug(title),
      catalogNumber: emptyToNull(row.catalog_number),
      upc: emptyToNull(row.upc),
      releaseDate: emptyToNull(row.release_date),
      bandcampId: emptyToNull(String(row.id)),
      licensed: row.type === 'licensed_album',
      tracks: []
    }

    albumMap.set(key, album)
    const artist = getArtist(row.release_artist)
    artist.albums.push(album)
    return album
  }

  // First pass: process album and licensed_album rows to create album entries
  for (const row of rows) {
    if (row.type === 'album' || row.type === 'licensed_album') {
      const artistSlug = toSlug(row.release_artist)
      const title = normalizeTitle(row.release_title)
      const key = `${artistSlug}::${title}::${row.id}`

      if (albumMap.has(key)) {
        console.warn(`Warning: duplicate album "${row.release_title}" by "${row.release_artist}" (id: ${row.id}), keeping first occurrence`)
        continue
      }

      getAlbum(row)
    }
  }

  // Second pass: attach album_track rows to their parent albums
  for (const row of rows) {
    if (row.type === 'album_track') {
      const artistSlug = toSlug(row.release_artist)
      const title = normalizeTitle(row.release_title)
      // Find parent album — match by artist slug + release_title
      let parentAlbum = null
      for (const [key, album] of albumMap) {
        if (key.startsWith(`${artistSlug}::${title}::`)) {
          parentAlbum = album
          break
        }
      }

      if (parentAlbum) {
        parentAlbum.tracks.push({
          name: row.album_track_title,
          isrc: emptyToNull(row.isrc)
        })
      } else {
        // Ensure artist exists even if no album row was found
        getArtist(row.release_artist)
      }
    }
  }

  // Third pass: create standalone singles for track rows
  for (const row of rows) {
    if (row.type === 'track') {
      const artistSlug = toSlug(row.release_artist)
      const title = normalizeTitle(row.release_title)
      const key = `${artistSlug}::${title}::${row.id}`

      if (albumMap.has(key)) {
        console.warn(`Warning: duplicate album "${title}" by "${row.release_artist}" (id: ${row.id}), keeping first occurrence`)
        continue
      }

      const album = {
        title,
        slug: toSlug(title),
        catalogNumber: emptyToNull(row.catalog_number),
        upc: emptyToNull(row.upc),
        releaseDate: emptyToNull(row.release_date),
        bandcampId: emptyToNull(String(row.id)),
        licensed: false,
        tracks: [{
          name: title,
          isrc: emptyToNull(row.isrc)
        }]
      }

      albumMap.set(key, album)
      const artist = getArtist(row.release_artist)
      artist.albums.push(album)
    }
  }

  // Log warnings for albums missing release_date or upc
  for (const album of albumMap.values()) {
    if (!album.releaseDate) {
      console.warn(`Warning: album "${album.title}" is missing release_date`)
    }
    if (!album.upc) {
      console.warn(`Warning: album "${album.title}" is missing upc`)
    }
  }

  return Array.from(artistMap.values())
}

/**
 * Extract artist slug from a Bandcamp URL.
 * e.g. "https://art-noir.bandcamp.com/" → "art-noir"
 * @param {string} url
 * @returns {string|null}
 */
function slugFromUrl (url) {
  try {
    const hostname = new URL(url).hostname
    const match = hostname.match(/^([^.]+)\.bandcamp\.com$/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

/**
 * Build the set of active artist slugs for roster filtering.
 *
 * @param {Object} options
 * @param {string} [options.cachePath] - Path to cache.json
 * @param {string} [options.contentDir] - Path to content directory
 * @param {string} [options.rosterSource] - 'cache' or 'api' (import mode)
 * @returns {Promise<Set<string>>} Set of active artist slugs
 */
async function buildActiveRoster (options = {}) {
  const { cachePath = 'cache.json', contentDir = './content', rosterSource } = options
  const slugs = new Set()

  // Collect primary roster slugs
  if (rosterSource === 'api') {
    const clientId = process.env.BANDCAMP_CLIENT_ID
    const clientSecret = process.env.BANDCAMP_CLIENT_SECRET
    const urls = await getLabelArtistUrls(clientId, clientSecret)
    for (const url of urls) {
      const s = slugFromUrl(url)
      if (s) slugs.add(s)
    }
  } else {
    const cache = await readCache(cachePath)
    if (cache && cache.artists) {
      for (const artist of cache.artists) {
        // Add explicit slug if present
        if (artist.slug) slugs.add(artist.slug)
        // Derive slug from artist name
        const nameSlug = toSlug(artist.name)
        if (nameSlug) slugs.add(nameSlug)
        // Derive slug from Bandcamp URL subdomain
        if (artist.url) {
          const urlSlug = slugFromUrl(artist.url)
          if (urlSlug) slugs.add(urlSlug)
        }
      }
    }
  }

  // Merge extra artist URLs from content/extra-artists.txt
  const extraUrls = await loadExtraArtistUrls(contentDir)
  for (const url of extraUrls) {
    const s = slugFromUrl(url)
    if (s) slugs.add(s)
  }

  // Merge extra artist URLs from EXTRA_ARTIST_URLS env var
  const envExtra = (process.env.EXTRA_ARTIST_URLS || '')
    .split(',')
    .map(u => u.trim())
    .filter(Boolean)
  for (const url of envExtra) {
    const s = slugFromUrl(url)
    if (s) slugs.add(s)
  }

  return slugs
}

/**
 * Try to find a cache album by fuzzy slug matching.
 * Checks if the CSV slug ends with a cache slug or vice versa (handles prefix differences
 * like "Demo Pt. I" in CSV vs "Pt. I" in cache).
 * @param {Map<string, Object>} albumMap - Cache album map (slug → album)
 * @param {string} csvSlug - CSV album slug
 * @returns {{ slug: string, album: Object }|null}
 */
function fuzzyMatchAlbum (albumMap, csvSlug) {
  if (!albumMap) return null
  for (const [cacheSlug, album] of albumMap) {
    if (csvSlug.endsWith(cacheSlug) || cacheSlug.endsWith(csvSlug)) {
      return { slug: cacheSlug, album }
    }
  }
  return null
}

/**
 * Compare CSV data against cache and produce a gap analysis report.
 * Does not modify cache.
 *
 * @param {CsvArtist[]} csvArtists - Grouped CSV data
 * @param {Object} cache - Current cache.json content
 * @param {Set<string>} activeRoster - Active artist slugs
 * @returns {AnalysisReport} Gap analysis report
 */
function analyzeGaps (csvArtists, cache, activeRoster) {
  const matched = []
  const notInCache = []
  const inactive = []
  const fillable = { upc: 0, catalogNumber: 0, bandcampId: 0, releaseDate: 0, isrc: 0 }

  // Build cache lookup: artistSlug → albumSlug → album
  const cacheIndex = new Map()
  const cacheAlbumSeen = new Set()
  if (cache && cache.artists) {
    for (const artist of cache.artists) {
      const artistSlug = artist.slug || toSlug(artist.name)
      const albumMap = new Map()
      for (const album of artist.albums || []) {
        const albumSlug = album.slug || toSlug(album.title)
        albumMap.set(albumSlug, album)
      }
      cacheIndex.set(artistSlug, { artist, albumMap })
    }
  }

  // Filter inactive artists, collect active CSV artists
  let totalInactiveRows = 0
  const activeCsvArtists = []
  for (const csvArtist of csvArtists) {
    if (!activeRoster.has(csvArtist.slug)) {
      const releaseCount = csvArtist.albums.length
      inactive.push({ name: csvArtist.name, releaseCount })
      totalInactiveRows += releaseCount
    } else {
      activeCsvArtists.push(csvArtist)
    }
  }

  // Process active CSV artists
  for (const csvArtist of activeCsvArtists) {
    const cacheEntry = cacheIndex.get(csvArtist.slug)

    for (const csvAlbum of csvArtist.albums) {
      const albumSlug = csvAlbum.slug || toSlug(csvAlbum.title)

      let cacheAlbum = null
      let matchedSlug = albumSlug

      if (cacheEntry && cacheEntry.albumMap.has(albumSlug)) {
        cacheAlbum = cacheEntry.albumMap.get(albumSlug)
      } else if (cacheEntry) {
        // Fuzzy fallback: try suffix matching
        const fuzzy = fuzzyMatchAlbum(cacheEntry.albumMap, albumSlug)
        if (fuzzy) {
          cacheAlbum = fuzzy.album
          matchedSlug = fuzzy.slug
        }
      }

      if (!cacheAlbum) {
        notInCache.push(`${csvArtist.name} - ${csvAlbum.title}`)
        continue
      }

      const key = `${csvArtist.slug}::${matchedSlug}`
      cacheAlbumSeen.add(key)

      // Check each fillable field
      const fields = {}

      for (const field of ['upc', 'catalogNumber', 'bandcampId', 'releaseDate']) {
        const cacheVal = cacheAlbum[field] != null ? cacheAlbum[field] : null
        const csvVal = csvAlbum[field] != null ? csvAlbum[field] : null
        const isFillable = cacheVal == null && csvVal != null
        fields[field] = { cache: cacheVal, csv: csvVal, fillable: isFillable }
        if (isFillable) fillable[field]++
      }

      // ISRC: match tracks by name (case-insensitive)
      let fillableIsrcCount = 0
      const totalTracks = (cacheAlbum.tracks || []).length
      for (const cacheTrack of (cacheAlbum.tracks || [])) {
        const cacheTrackName = (cacheTrack.name || '').toLowerCase()
        const csvTrack = (csvAlbum.tracks || []).find(
          t => (t.name || '').toLowerCase() === cacheTrackName
        )
        if (csvTrack && csvTrack.isrc != null && (cacheTrack.isrc == null)) {
          fillableIsrcCount++
        }
      }
      fields.isrc = { fillableCount: fillableIsrcCount, totalTracks }
      fillable.isrc += fillableIsrcCount

      matched.push({
        artist: csvArtist.name,
        title: csvAlbum.title,
        fields
      })
    }
  }

  // Find cache albums not in CSV
  const notInCsv = []
  if (cache && cache.artists) {
    for (const artist of cache.artists) {
      const artistSlug = artist.slug || toSlug(artist.name)
      if (!activeRoster.has(artistSlug)) continue
      for (const album of artist.albums || []) {
        const albumSlug = album.slug || toSlug(album.title)
        const key = `${artistSlug}::${albumSlug}`
        if (!cacheAlbumSeen.has(key)) {
          notInCsv.push(`${artist.name} - ${album.title}`)
        }
      }
    }
  }

  // Log summary
  console.log(`Inactive artists filtered: ${inactive.length} (${totalInactiveRows} releases excluded)`)

  return { matched, notInCache, notInCsv, inactive, fillable }
}

/**
 * Merge CSV metadata into existing cache entries, filling only missing/null fields.
 * Mutates the cache object in place.
 *
 * @param {CsvArtist[]} csvArtists - Grouped CSV data
 * @param {Object} cache - Current cache.json content (mutated in place)
 * @param {Set<string>} activeRoster - Active artist slugs
 * @returns {FillReport} Summary of fields filled
 */
function fillGaps (csvArtists, cache, activeRoster) {
  const report = {
    upc: 0,
    catalogNumber: 0,
    bandcampId: 0,
    releaseDate: 0,
    isrc: 0,
    unmatchedCsv: 0,
    skippedInactive: 0
  }

  // Build cache lookup: artistSlug → albumSlug → album
  const cacheIndex = new Map()
  if (cache && cache.artists) {
    for (const artist of cache.artists) {
      const artistSlug = artist.slug || toSlug(artist.name)
      const albumMap = new Map()
      for (const album of artist.albums || []) {
        const albumSlug = album.slug || toSlug(album.title)
        albumMap.set(albumSlug, album)
      }
      cacheIndex.set(artistSlug, albumMap)
    }
  }

  for (const csvArtist of csvArtists) {
    // Filter inactive artists
    if (!activeRoster.has(csvArtist.slug)) {
      report.skippedInactive += csvArtist.albums.length
      continue
    }

    const albumMap = cacheIndex.get(csvArtist.slug)

    for (const csvAlbum of csvArtist.albums) {
      const albumSlug = csvAlbum.slug || toSlug(csvAlbum.title)

      let cacheAlbum = null
      if (albumMap && albumMap.has(albumSlug)) {
        cacheAlbum = albumMap.get(albumSlug)
      } else if (albumMap) {
        const fuzzy = fuzzyMatchAlbum(albumMap, albumSlug)
        if (fuzzy) cacheAlbum = fuzzy.album
      }

      if (!cacheAlbum) {
        report.unmatchedCsv++
        continue
      }

      // Fill album-level fields (only when cache value is null/undefined)
      for (const field of ['upc', 'catalogNumber', 'bandcampId', 'releaseDate']) {
        if (cacheAlbum[field] == null && csvAlbum[field] != null) {
          cacheAlbum[field] = csvAlbum[field]
          report[field]++
        }
      }

      // Fill track-level ISRCs by case-insensitive name match
      if (cacheAlbum.tracks && csvAlbum.tracks) {
        for (const cacheTrack of cacheAlbum.tracks) {
          if (cacheTrack.isrc != null) continue
          const cacheTrackName = (cacheTrack.name || '').toLowerCase()
          const csvTrack = csvAlbum.tracks.find(
            t => (t.name || '').toLowerCase() === cacheTrackName
          )
          if (csvTrack && csvTrack.isrc != null) {
            cacheTrack.isrc = csvTrack.isrc
            report.isrc++
          }
        }
      }
    }
  }

  return report
}

/**
 * Build a complete cache object from CSV data.
 * Uses assignSlugs() for collision-safe slug assignment.
 *
 * @param {CsvArtist[]} csvArtists - Grouped CSV data (already roster-filtered)
 * @returns {Object} Cache-schema-conformant object
 */
function fullImport (csvArtists) {
  const withSlugs = assignSlugs(csvArtists)

  const artists = withSlugs.map(artist => ({
    name: artist.name,
    slug: artist.slug,
    url: '',
    albums: (artist.albums || []).map(album => ({
      title: album.title,
      slug: album.slug,
      artist: artist.name,
      url: '',
      imageUrl: '',
      tracks: (album.tracks || []).map(track => ({
        name: track.name,
        url: '',
        duration: '',
        isrc: track.isrc || null
      })),
      upc: album.upc || null,
      catalogNumber: album.catalogNumber || null,
      bandcampId: album.bandcampId || null,
      releaseDate: album.releaseDate || null,
      licensed: album.licensed || false
    }))
  }))

  return {
    scrapedAt: new Date().toISOString(),
    artists
  }
}

/**
 * Print a summary of parsed CSV data.
 * @param {CsvArtist[]} csvArtists
 */
function printParseSummary (csvArtists) {
  let albums = 0
  let singles = 0
  let tracks = 0
  for (const artist of csvArtists) {
    for (const album of artist.albums) {
      const isSingle = album.tracks.length === 1 && album.tracks[0].name === album.title
      if (isSingle) singles++
      else albums++
      tracks += album.tracks.length
    }
  }
  console.log(`Parsed: ${csvArtists.length} artist(s), ${albums} album(s), ${singles} single(s), ${tracks} track(s)`)
}

/**
 * Format an AnalysisReport as a GFM markdown string.
 * @param {AnalysisReport} report
 * @returns {string}
 */
function formatAnalysisReport (report) {
  const lines = []
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19)
  lines.push(`# CSV Gap Analysis Report`)
  lines.push('')
  lines.push(`Generated: ${ts}`)
  lines.push('')

  // Summary
  lines.push('## Summary')
  lines.push('')
  lines.push(`| Metric | Count |`)
  lines.push(`|--------|------:|`)
  lines.push(`| Matched albums | ${report.matched.length} |`)
  lines.push(`| Fillable UPCs | ${report.fillable.upc} |`)
  lines.push(`| Fillable catalog numbers | ${report.fillable.catalogNumber} |`)
  lines.push(`| Fillable Bandcamp IDs | ${report.fillable.bandcampId} |`)
  lines.push(`| Fillable release dates | ${report.fillable.releaseDate} |`)
  lines.push(`| Fillable ISRCs | ${report.fillable.isrc} |`)
  lines.push(`| CSV releases not in cache | ${report.notInCache.length} |`)
  lines.push(`| Cache albums not in CSV | ${report.notInCsv.length} |`)
  lines.push(`| Inactive artists filtered | ${report.inactive.length} |`)
  lines.push('')

  // Matched albums with fillable fields
  if (report.matched.length > 0) {
    const withFillable = report.matched.filter(m => {
      return m.fields.upc.fillable || m.fields.catalogNumber.fillable ||
        m.fields.bandcampId.fillable || m.fields.releaseDate.fillable ||
        m.fields.isrc.fillableCount > 0
    })
    if (withFillable.length > 0) {
      lines.push('## Fillable Fields')
      lines.push('')
      lines.push('Albums where the CSV can fill missing cache data:')
      lines.push('')
      lines.push('| Artist | Album | UPC | Catalog | BC ID | Date | ISRCs |')
      lines.push('|--------|-------|:---:|:-------:|:-----:|:----:|:-----:|')
      for (const m of withFillable) {
        const upc = m.fields.upc.fillable ? '✓' : ''
        const cat = m.fields.catalogNumber.fillable ? '✓' : ''
        const bc = m.fields.bandcampId.fillable ? '✓' : ''
        const date = m.fields.releaseDate.fillable ? '✓' : ''
        const isrc = m.fields.isrc.fillableCount > 0 ? `${m.fields.isrc.fillableCount}/${m.fields.isrc.totalTracks}` : ''
        lines.push(`| ${m.artist} | ${m.title} | ${upc} | ${cat} | ${bc} | ${date} | ${isrc} |`)
      }
      lines.push('')
    }
  }

  // Not in cache
  if (report.notInCache.length > 0) {
    lines.push('## CSV Releases Not in Cache')
    lines.push('')
    lines.push('These releases exist in the CSV but have no matching cache entry:')
    lines.push('')
    for (const entry of report.notInCache) {
      lines.push(`- ${entry}`)
    }
    lines.push('')
  }

  // Not in CSV
  if (report.notInCsv.length > 0) {
    lines.push('## Cache Albums Not in CSV')
    lines.push('')
    lines.push('These albums exist in the cache but have no matching CSV entry:')
    lines.push('')
    for (const entry of report.notInCsv) {
      lines.push(`- ${entry}`)
    }
    lines.push('')
  }

  // Inactive artists
  if (report.inactive.length > 0) {
    lines.push('## Filtered Out (Inactive Artists)')
    lines.push('')
    lines.push('| Artist | Releases |')
    lines.push('|--------|--------:|')
    for (const entry of report.inactive) {
      lines.push(`| ${entry.name} | ${entry.releaseCount} |`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

module.exports = { parseCsv, groupByArtist, buildActiveRoster, analyzeGaps, fillGaps, fullImport, printParseSummary, formatAnalysisReport }
