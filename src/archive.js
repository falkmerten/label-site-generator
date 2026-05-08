'use strict'

const https = require('https')

// ── Constants ────────────────────────────────────────────────────────────────

const COLLECTION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/
const AUDIO_FORMATS = ['VBR MP3', 'MP3', '128Kbps MP3', '64Kbps MP3', 'Ogg Vorbis', 'Flac', 'FLAC']
const ENRICHMENT_FIELDS = [
  'streamingLinks', 'upc', 'discogsUrl', 'discogsChecked',
  'enrichmentChecked', 'physicalFormats', 'catalogNumber',
  'labelName', 'labelUrl', 'labelUrls'
]
const DEFAULT_DELAY_MS = 1000
const MAX_RETRIES = 3
const PAGE_SIZE = 200

// ── Utility Functions ────────────────────────────────────────────────────────

function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Validates a collection ID against the allowed pattern.
 * @param {string} collectionId
 * @returns {boolean}
 */
function isValidCollectionId (collectionId) {
  return typeof collectionId === 'string' && COLLECTION_ID_PATTERN.test(collectionId)
}

/**
 * Normalizes an artist name for grouping and duplicate detection.
 * Lowercases, trims, and collapses multiple spaces.
 * @param {string} name
 * @returns {string}
 */
function normalizeArtistName (name) {
  return (name || '').toLowerCase().trim().replace(/\s+/g, ' ')
}

/**
 * Normalizes an album title for duplicate detection.
 * Lowercases, trims, collapses spaces, normalizes quotes.
 * @param {string} title
 * @returns {string}
 */
function normalizeTitle (title) {
  return (title || '').toLowerCase().trim()
    .replace(/\s+/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
}

/**
 * Builds a duplicate detection key from artist + title.
 * @param {string} artist
 * @param {string} title
 * @returns {string}
 */
function buildDuplicateKey (artist, title) {
  return `${normalizeArtistName(artist)}::${normalizeTitle(title)}`
}

/**
 * Formats seconds into MM:SS with zero-padding.
 * @param {number} seconds
 * @returns {string}
 */
function formatDuration (seconds) {
  if (!seconds || seconds < 0) return '00:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return `${String(mins).padStart(2, '0')}:${String(secs >= 60 ? 0 : secs).padStart(2, '0')}`
}

/**
 * Determines if a file is an audio file based on its format string.
 * @param {object} file - IA file object with `format` field
 * @returns {boolean}
 */
function isAudioFile (file) {
  if (!file || !file.format) return false
  return AUDIO_FORMATS.some(fmt => file.format.includes(fmt))
}

/**
 * Extracts a numeric track order from a file object.
 * Priority: track metadata > numeric filename prefix > 9999 (alphabetical fallback).
 * @param {object} file - IA file object
 * @returns {number}
 */
function extractTrackOrder (file) {
  // Priority 1: track metadata field
  if (file.track) {
    const num = parseInt(String(file.track).split('/')[0], 10)
    if (!isNaN(num)) return num
  }
  // Priority 2: numeric prefix in filename
  if (file.name) {
    const match = file.name.match(/^(\d{1,3})[\s._-]/)
    if (match) return parseInt(match[1], 10)
  }
  // Priority 3: fallback for alphabetical sort
  return 9999
}

/**
 * Extracts a track name from a file object.
 * Priority: title metadata > cleaned filename.
 * @param {object} file - IA file object
 * @returns {string}
 */
function extractTrackName (file) {
  // Priority 1: title from metadata
  if (file.title && String(file.title).trim()) return String(file.title).trim()
  // Priority 2: clean filename
  let name = (file.name || '')
    .replace(/\.[^.]+$/, '')           // remove extension
    .replace(/^\d{1,3}[\s._-]+/, '')   // remove track number prefix
    .replace(/[_-]+/g, ' ')            // underscores/dashes to spaces
    .trim()
  return name || file.name || 'Untitled'
}

// ── HTTP Request Logic ───────────────────────────────────────────────────────

/**
 * Makes an HTTPS GET request and returns parsed JSON.
 * Implements exponential backoff for 503/429 responses.
 * @param {string} url - Full URL to fetch
 * @param {number} [retries=0] - Current retry count
 * @returns {Promise<object|null>} Parsed JSON or null on failure
 */
function fetchJson (url, retries = 0) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', async () => {
        // Retry on 503/429 with exponential backoff
        if ((res.statusCode === 503 || res.statusCode === 429) && retries < MAX_RETRIES) {
          const backoffMs = Math.pow(2, retries) * 1000 // 1s, 2s, 4s
          console.warn(`  [archive] HTTP ${res.statusCode} — retrying in ${backoffMs / 1000}s (attempt ${retries + 1}/${MAX_RETRIES})`)
          await delay(backoffMs)
          resolve(fetchJson(url, retries + 1))
          return
        }
        if (res.statusCode !== 200) {
          resolve(null)
          return
        }
        try {
          const data = JSON.parse(raw)
          resolve(data)
        } catch {
          resolve(null)
        }
      })
    }).on('error', () => resolve(null))
  })
}

/**
 * Fetches metadata for a single Internet Archive item.
 * @param {string} identifier - The IA item identifier
 * @returns {Promise<object>} Raw IA metadata object { metadata, files, ... }
 * @throws {Error} If fetch fails after retries
 */
async function fetchItemMetadata (identifier) {
  const url = new URL(`/metadata/${encodeURIComponent(identifier)}`, 'https://archive.org')
  const data = await fetchJson(url.href)
  if (!data) {
    throw new Error(`Failed to fetch metadata for "${identifier}"`)
  }
  // Validate expected structure
  if (!data.metadata && !data.files) {
    throw new Error(`Invalid metadata structure for "${identifier}"`)
  }
  return data
}

// ── Track Parsing ────────────────────────────────────────────────────────────

/**
 * Selects the best format from derivative files when no originals exist.
 * Preference: MP3 > OGG > FLAC.
 * @param {object[]} files - Array of derivative audio files
 * @returns {object[]} Filtered files in preferred format
 */
function selectBestFormat (files) {
  const mp3 = files.filter(f => f.format && f.format.includes('MP3'))
  if (mp3.length > 0) return mp3
  const ogg = files.filter(f => f.format && f.format.includes('Ogg'))
  if (ogg.length > 0) return ogg
  return files.filter(f => f.format && (f.format.includes('Flac') || f.format.includes('FLAC')))
}

/**
 * Parses IA file list to extract ordered tracks.
 * Filters to audio files, prefers originals, sorts by track order.
 * @param {object[]} files - Array of files from IA metadata
 * @param {string} identifier - Item identifier (for download URLs)
 * @returns {object[]} Ordered track list [{name, url, duration}]
 */
function parseTracksFromFiles (files, identifier) {
  if (!Array.isArray(files) || files.length === 0) return []

  // Step 1: Filter to audio files — prefer originals
  let audioFiles = files.filter(f => isAudioFile(f) && f.source === 'original')

  // If no originals, fall back to derivatives
  if (audioFiles.length === 0) {
    const allAudio = files.filter(f => isAudioFile(f))
    audioFiles = selectBestFormat(allAudio)
  }

  if (audioFiles.length === 0) return []

  // Step 2: Build track entries with order info
  const tracksWithOrder = audioFiles.map(f => ({
    file: f,
    order: extractTrackOrder(f),
    name: extractTrackName(f),
    duration: f.length ? formatDuration(parseFloat(f.length)) : null,
    url: new URL(`/download/${encodeURIComponent(identifier)}/${encodeURIComponent(f.name)}`, 'https://archive.org').href
  }))

  // Step 3: Sort — by order number first, then alphabetically for ties (order === 9999)
  tracksWithOrder.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order
    // Alphabetical fallback for items with same order (9999 = no metadata)
    return (a.file.name || '').localeCompare(b.file.name || '')
  })

  // Step 4: Return in standard Track format
  return tracksWithOrder.map(t => {
    const track = { name: t.name }
    if (t.url) track.url = t.url
    if (t.duration) track.duration = t.duration
    return track
  })
}

// ── Item Transformation ──────────────────────────────────────────────────────

/**
 * Extracts artwork URL from an IA item's file list.
 * Looks for image files (JPEG, PNG) in the item.
 * @param {object[]} files - Array of files from IA metadata
 * @param {string} identifier - Item identifier
 * @returns {string|null} Artwork URL or null
 */
function extractArtworkUrl (files, identifier) {
  if (!Array.isArray(files)) return null
  const imageFormats = ['JPEG', 'PNG', 'Book Cover', 'Item Tile']
  // Exclude thumbnails and non-image files
  const excludePatterns = [/\.zip$/i, /\.txt$/i, /\.pdf$/i, /__ia_thumb/i]
  const coverPatterns = [/cover/i, /folder/i, /front/i, /artwork/i]

  const imageFiles = files.filter(f =>
    f.format && imageFormats.some(fmt => f.format.includes(fmt)) &&
    f.source === 'original' &&
    !excludePatterns.some(p => p.test(f.name || ''))
  )

  // Try to find a cover image by name pattern
  for (const pattern of coverPatterns) {
    const match = imageFiles.find(f => pattern.test(f.name || ''))
    if (match) {
      return new URL(`/download/${encodeURIComponent(identifier)}/${encodeURIComponent(match.name)}`, 'https://archive.org').href
    }
  }

  // Fall back to first original image
  if (imageFiles.length > 0) {
    return new URL(`/download/${encodeURIComponent(identifier)}/${encodeURIComponent(imageFiles[0].name)}`, 'https://archive.org').href
  }

  // Fall back to derivative images (but prefer non-thumb versions)
  const derivativeImages = files.filter(f =>
    f.format && imageFormats.some(fmt => f.format.includes(fmt)) &&
    !excludePatterns.some(p => p.test(f.name || ''))
  )
  // Prefer non-thumb derivatives
  const nonThumb = derivativeImages.filter(f => !(f.name || '').includes('__ia_thumb'))
  if (nonThumb.length > 0) {
    return new URL(`/download/${encodeURIComponent(identifier)}/${encodeURIComponent(nonThumb[0].name)}`, 'https://archive.org').href
  }
  if (derivativeImages.length > 0) {
    return new URL(`/download/${encodeURIComponent(identifier)}/${encodeURIComponent(derivativeImages[0].name)}`, 'https://archive.org').href
  }

  // Use IA's built-in thumbnail service as last resort
  return `https://archive.org/services/img/${encodeURIComponent(identifier)}`
}

/**
 * Transforms an IA item into the standard Album format.
 * @param {object} item - Raw IA item metadata { metadata, files, ... }
 * @param {string} collectionId - Parent collection ID (fallback for artist)
 * @returns {object} Album object compatible with the merger
 */
function transformItem (item, collectionId) {
  const metadata = item.metadata || {}
  const files = item.files || []
  const identifier = item.metadata ? (metadata.identifier || item.identifier || collectionId) : (item.identifier || collectionId)

  // Title: metadata.title > identifier
  const title = (Array.isArray(metadata.title) ? metadata.title[0] : metadata.title) || identifier

  // Artist: metadata.creator > collection name
  let artist = metadata.creator
  if (Array.isArray(artist)) artist = artist[0]
  if (!artist) artist = collectionId

  // Tracks
  const tracks = parseTracksFromFiles(files, identifier)

  // Tags from subject
  let tags = []
  if (metadata.subject) {
    const subjects = Array.isArray(metadata.subject) ? metadata.subject : [metadata.subject]
    // Split semicolon-separated tags and flatten
    const allTags = []
    for (const s of subjects) {
      const parts = String(s).split(';').map(p => p.trim()).filter(Boolean)
      allTags.push(...parts)
    }
    // Filter noise tags (artist names, label names, generic terms)
    const noiseLower = new Set(['afmusic', 'aenaos records', 'netlabel', 'creative commons', 'free music'])
    const artistLower = (Array.isArray(metadata.creator) ? metadata.creator[0] : metadata.creator || '').toLowerCase()
    tags = allTags
      .filter(t => {
        const lower = t.toLowerCase()
        return !noiseLower.has(lower) && lower !== artistLower
      })
      .map(s => ({ name: s }))
  }

  // Artwork
  const imageUrl = extractArtworkUrl(files, identifier)

  // Raw metadata subset for debugging
  const raw = {
    _source: 'archive.org',
    identifier,
    date: metadata.date || null,
    description: metadata.description || null,
    mediatype: metadata.mediatype || null,
    collection: metadata.collection || collectionId
  }

  return {
    url: new URL(`/details/${encodeURIComponent(identifier)}`, 'https://archive.org').href,
    title: String(title).trim(),
    artist: String(artist).trim(),
    imageUrl,
    tracks,
    tags,
    raw
  }
}

// ── Collection Scraping ──────────────────────────────────────────────────────

/**
 * Builds the IA Advanced Search API URL for a collection query.
 * @param {string} collectionId - Collection identifier
 * @param {number} page - Page number (1-based)
 * @param {number} rows - Items per page
 * @param {string} [artistFilter] - Optional creator filter
 * @returns {string} Full search URL
 */
function buildSearchUrl (collectionId, page, rows, artistFilter) {
  const url = new URL('/advancedsearch.php', 'https://archive.org')
  let query = `collection:${collectionId}`
  if (artistFilter) {
    query += ` AND creator:"${artistFilter}"`
  }
  url.searchParams.set('q', query)
  url.searchParams.set('fl[]', 'identifier,title,creator,date')
  url.searchParams.set('sort[]', 'date desc')
  url.searchParams.set('rows', String(rows))
  url.searchParams.set('page', String(page))
  url.searchParams.set('output', 'json')
  return url.href
}

/**
 * Scrapes all releases from an Internet Archive collection.
 * @param {string} collectionId - The IA collection identifier (e.g. 'afmusic')
 * @param {object} [options] - Scraping options
 * @param {number} [options.delayMs=1000] - Delay between API requests
 * @param {number} [options.maxItems] - Maximum items to fetch (for testing)
 * @param {string} [options.artistFilter] - Filter by creator name
 * @param {boolean} [options.ccOnly=false] - Only include Creative Commons licensed releases
 * @returns {Promise<object>} RawSiteData in the same format as scraper.js output
 */
async function scrapeArchiveCollection (collectionId, options = {}) {
  const { delayMs = DEFAULT_DELAY_MS, maxItems, artistFilter, ccOnly = false } = options

  if (!isValidCollectionId(collectionId)) {
    throw new Error(`[archive] Invalid collection ID: "${collectionId}" — must match /^[a-zA-Z0-9_-]+$/`)
  }

  console.log(`[archive] Scraping collection: ${collectionId}`)
  if (artistFilter) console.log(`[archive] Filtering by creator: "${artistFilter}"`)

  // Step 1: Fetch all item identifiers from collection
  let allItems = []
  let page = 1

  while (true) {
    const searchUrl = buildSearchUrl(collectionId, page, PAGE_SIZE, artistFilter)
    const response = await fetchJson(searchUrl)

    if (!response || !response.response) {
      console.error(`[archive] Failed to query collection "${collectionId}" — no response from API`)
      break
    }

    const docs = response.response.docs || []
    allItems = allItems.concat(docs)

    console.log(`[archive] Page ${page}: ${docs.length} items (total: ${allItems.length})`)

    if (docs.length < PAGE_SIZE || (maxItems && allItems.length >= maxItems)) break
    page++
    await delay(delayMs)
  }

  if (allItems.length === 0) {
    console.error(`[archive] Collection "${collectionId}" returned 0 items. Check the collection ID.`)
    return {
      scrapedAt: new Date().toISOString(),
      labelProfileImage: null,
      themeColors: {},
      _siteMode: 'label',
      _source: 'archive.org',
      _collectionId: collectionId,
      artists: []
    }
  }

  if (maxItems) allItems = allItems.slice(0, maxItems)

  // Step 2: Fetch metadata for each item and transform
  const artistsMap = new Map() // normalized name → Artist object
  let processed = 0
  let skipped = 0

  for (const doc of allItems) {
    if (processed > 0) await delay(delayMs)

    let itemMeta
    try {
      itemMeta = await fetchItemMetadata(doc.identifier)
    } catch (err) {
      console.warn(`  [archive] Skipping ${doc.identifier}: ${err.message}`)
      skipped++
      continue
    }

    // Skip non-CC items when ccOnly filter is active
    if (ccOnly) {
      const license = (itemMeta.metadata && itemMeta.metadata.licenseurl) || ''
      if (!license || !license.includes('creativecommons.org')) {
        skipped++
        continue
      }
    }

    // Skip items without audio files
    const audioFiles = (itemMeta.files || []).filter(f => isAudioFile(f))
    if (audioFiles.length === 0) {
      skipped++
      continue
    }

    const album = transformItem(itemMeta, collectionId)
    const artistKey = normalizeArtistName(album.artist)

    if (!artistsMap.has(artistKey)) {
      artistsMap.set(artistKey, {
        url: `https://archive.org/search?query=creator:${encodeURIComponent('"' + album.artist + '"')}`,
        name: album.artist,
        location: null,
        description: null,
        coverImage: null,
        bandLinks: [],
        streamingLinks: undefined,
        albums: []
      })
    }

    artistsMap.get(artistKey).albums.push(album)
    processed++

    if (processed % 10 === 0) {
      console.log(`  [archive] Processed ${processed}/${allItems.length} items...`)
    }
  }

  console.log(`[archive] Done: ${processed} albums from ${artistsMap.size} artist(s) (${skipped} skipped)`)

  return {
    scrapedAt: new Date().toISOString(),
    labelProfileImage: null,
    themeColors: {},
    _siteMode: artistsMap.size > 1 ? 'label' : 'artist',
    _source: 'archive.org',
    _collectionId: collectionId,
    artists: Array.from(artistsMap.values())
  }
}

// ── Merge Logic ──────────────────────────────────────────────────────────────

/**
 * Builds a Set of duplicate keys from all albums in a RawSiteData object.
 * @param {object} data - RawSiteData
 * @returns {Set<string>} Set of duplicate keys
 */
function buildAlbumIndex (data) {
  const index = new Set()
  for (const artist of data.artists || []) {
    for (const album of artist.albums || []) {
      index.add(buildDuplicateKey(album.artist || artist.name, album.title))
    }
  }
  return index
}

/**
 * Preserves enrichment fields from existing cache entries onto new data.
 * Used in primary mode where IA replaces Bandcamp but enrichment should persist.
 * @param {object} newData - New IA data (will be mutated)
 * @param {object} existingData - Existing cache data
 * @returns {object} newData with enrichment fields preserved
 */
function preserveEnrichmentFields (newData, existingData) {
  if (!existingData || !existingData.artists) return newData

  // Build a lookup of existing artists by normalized name
  const existingArtistMap = new Map()
  for (const artist of existingData.artists) {
    existingArtistMap.set(normalizeArtistName(artist.name), artist)
  }

  // Build a lookup of existing albums by duplicate key
  const existingAlbums = new Map()
  for (const artist of existingData.artists) {
    for (const album of artist.albums || []) {
      const key = buildDuplicateKey(album.artist || artist.name, album.title)
      existingAlbums.set(key, album)
    }
  }

  // Apply enrichment fields from existing to new
  for (const artist of newData.artists || []) {
    // Preserve artist-level enrichment (Last.fm, streaming links, etc.)
    const existingArtist = existingArtistMap.get(normalizeArtistName(artist.name))
    if (existingArtist) {
      if (existingArtist.lastfm) artist.lastfm = existingArtist.lastfm
      if (existingArtist.streamingLinks) artist.streamingLinks = existingArtist.streamingLinks
      if (existingArtist.description && !artist.description) artist.description = existingArtist.description
    }

    for (const album of artist.albums || []) {
      const key = buildDuplicateKey(album.artist || artist.name, album.title)
      const existing = existingAlbums.get(key)
      if (existing) {
        for (const field of ENRICHMENT_FIELDS) {
          if (existing[field] !== undefined && existing[field] !== null) {
            album[field] = existing[field]
          }
        }
      }
    }
  }

  return newData
}

/**
 * Merges Internet Archive data into existing cache data based on mode.
 * @param {object} existingData - Current cache (Bandcamp or previous)
 * @param {object} archiveData - Data from IA scrape
 * @param {string} mode - 'primary' | 'secondary' | 'archive'
 * @returns {object} Merged RawSiteData
 */
function mergeArchiveData (existingData, archiveData, mode) {
  if (mode === 'primary') {
    // IA is sole source — but preserve enrichment fields from existing cache
    const result = preserveEnrichmentFields(archiveData, existingData)
    result.scrapedAt = new Date().toISOString()
    return result
  }

  // secondary and archive modes: add non-duplicate IA albums to existing data
  // Build duplicate detection index from existing data
  const existingIndex = buildAlbumIndex(existingData)

  for (const iaArtist of archiveData.artists || []) {
    const artistKey = normalizeArtistName(iaArtist.name)

    // Filter to non-duplicate albums
    const newAlbums = (iaArtist.albums || []).filter(album => {
      const key = buildDuplicateKey(album.artist || iaArtist.name, album.title)
      return !existingIndex.has(key)
    })

    if (newAlbums.length === 0) continue

    // Add new album keys to index to prevent duplicates within IA data itself
    for (const album of newAlbums) {
      const key = buildDuplicateKey(album.artist || iaArtist.name, album.title)
      existingIndex.add(key)
    }

    // Find matching artist in existing data
    const existingArtist = (existingData.artists || []).find(a =>
      normalizeArtistName(a.name) === artistKey
    )

    if (existingArtist) {
      // Append new albums to existing artist
      existingArtist.albums = (existingArtist.albums || []).concat(newAlbums)
    } else {
      // Add new artist entirely
      if (!existingData.artists) existingData.artists = []
      existingData.artists.push({
        url: iaArtist.url,
        name: iaArtist.name,
        location: iaArtist.location || null,
        description: iaArtist.description || null,
        coverImage: iaArtist.coverImage || null,
        bandLinks: iaArtist.bandLinks || [],
        streamingLinks: iaArtist.streamingLinks,
        albums: newAlbums
      })
    }
  }

  existingData.scrapedAt = new Date().toISOString()
  return existingData
}

// ── Module Exports ───────────────────────────────────────────────────────────

module.exports = {
  // Main API
  scrapeArchiveCollection,
  fetchItemMetadata,
  transformItem,
  parseTracksFromFiles,
  mergeArchiveData,
  // Utilities (exported for testing)
  normalizeArtistName,
  normalizeTitle,
  buildDuplicateKey,
  formatDuration,
  extractTrackOrder,
  extractTrackName,
  isAudioFile,
  isValidCollectionId,
  buildAlbumIndex,
  ENRICHMENT_FIELDS
}
