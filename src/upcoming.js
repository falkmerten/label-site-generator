'use strict'

const fs = require('fs/promises')
const path = require('path')
const bandcamp = require('./bandcamp')
const { toSlug } = require('./slugs')

const DELAY_MS = 1500

const KNOWN_FIELDS = new Set(['url', 'title', 'releaseDate', 'presaveUrl', 'description'])
const BANDCAMP_URL_RE = /bandcamp\.com/

/**
 * Normalizes a string for case-insensitive, accent-insensitive comparison.
 * Strips diacritics, lowercases, and removes non-alphanumeric characters.
 *
 * @param {string} s
 * @returns {string}
 */
const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Classifies an upcoming entry into a tier based on present fields.
 *
 * @param {string|object} entry - Raw entry from upcoming.json
 * @returns {{ tier: 'announce'|'preview'|'full', normalized: object }|null}
 *   Returns null if the entry is invalid (missing required fields).
 */
function classifyTier (entry) {
  if (typeof entry === 'string') {
    return { tier: 'full', normalized: { url: entry } }
  }
  if (!entry || typeof entry !== 'object') return null
  const normalized = { ...entry }
  if (entry.url) {
    return { tier: 'full', normalized }
  }
  if (entry.title && entry.releaseDate) {
    if (entry.presaveUrl || entry.description) {
      return { tier: 'preview', normalized }
    }
    return { tier: 'announce', normalized }
  }
  return null
}

/**
 * Validates an upcoming entry. Returns an array of warning messages (empty if valid).
 *
 * @param {object} entry - Normalized entry object
 * @param {string} artistSlug - Artist slug for error messages
 * @param {number} index - Entry index for error messages
 * @returns {string[]} Array of warning messages
 */
function validateEntry (entry, artistSlug, index) {
  const warnings = []
  if (!entry || typeof entry !== 'object') return warnings

  // Check for unrecognized fields
  for (const key of Object.keys(entry)) {
    if (!KNOWN_FIELDS.has(key)) {
      warnings.push(`[upcoming] "${artistSlug}" entry ${index}: unrecognized field "${key}"`)
    }
  }

  // Validate releaseDate is parseable
  if (entry.releaseDate != null) {
    const d = new Date(entry.releaseDate)
    if (isNaN(d.getTime())) {
      warnings.push(`[upcoming] "${artistSlug}" entry ${index}: releaseDate "${entry.releaseDate}" is not a valid date`)
    }
  }

  // Validate url matches Bandcamp pattern
  if (entry.url != null) {
    if (!BANDCAMP_URL_RE.test(entry.url)) {
      warnings.push(`[upcoming] "${artistSlug}" entry ${index}: url "${entry.url}" does not look like a Bandcamp URL`)
    }
  }

  // Validate title and releaseDate are present on non-URL entries
  if (!entry.url) {
    if (!entry.title) {
      warnings.push(`[upcoming] "${artistSlug}" entry ${index}: missing required field "title"`)
    }
    if (!entry.releaseDate) {
      warnings.push(`[upcoming] "${artistSlug}" entry ${index}: missing required field "releaseDate"`)
    }
  }

  return warnings
}

/**
 * Loads announce and preview tier upcoming releases (no Bandcamp scraping).
 * Creates content directories for new entries and logs CLI hints.
 *
 * @param {string} contentDir - Path to content directory
 * @param {object} rawData - Raw site data (mutated in place)
 * @param {string} [artistFilter] - Optional artist name/slug filter
 * @returns {Promise<number>} Number of entries added
 */
async function loadUpcomingLocal (contentDir, rawData, artistFilter) {
  let config
  try {
    const raw = await fs.readFile(path.join(contentDir, 'upcoming.json'), 'utf8')
    config = JSON.parse(raw)
  } catch {
    return 0 // no upcoming.json
  }

  let count = 0

  for (const [artistSlug, entries] of Object.entries(config)) {
    if (!Array.isArray(entries) || entries.length === 0) continue

    // Skip if artist filter is set and doesn't match
    if (artistFilter) {
      const filterNorm = norm(artistFilter)
      if (artistSlug !== toSlug(artistFilter) && norm(artistSlug) !== filterNorm) continue
    }

    // Find the artist in raw data
    const artist = (rawData.artists || []).find(a => {
      return toSlug(a.name) === artistSlug || norm(a.name) === norm(artistSlug)
    })
    if (!artist) {
      console.warn(`[upcoming] Artist "${artistSlug}" not found in cache — skipping`)
      continue
    }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      const result = classifyTier(entry)

      // Skip entries that classifyTier cannot classify (invalid)
      if (!result) {
        console.warn(`[upcoming] "${artistSlug}" entry ${i}: could not classify tier — skipping`)
        continue
      }

      const { tier, normalized } = result

      // Validate the normalized entry
      const warnings = validateEntry(normalized, artistSlug, i)
      for (const w of warnings) console.warn(w)

      // Skip entries with fatal validation issues (invalid date or invalid URL)
      const hasFatalWarning = warnings.some(w =>
        w.includes('is not a valid date') ||
        w.includes('does not look like a Bandcamp URL') ||
        w.includes('missing required field')
      )
      if (hasFatalWarning) continue

      // Skip full-tier entries — those are handled by loadUpcomingFull
      if (tier === 'full') continue

      const titleNorm = norm(normalized.title)
      const existing = artist.albums.find(a => norm(a.title) === titleNorm)

      if (existing) {
        // Duplicate/update handling: set tier if missing, upgrade when appropriate
        if (!existing.tier) {
          existing.tier = tier
        } else if (tier === 'preview' && existing.tier === 'announce') {
          existing.tier = 'preview'
        }
        // Update optional fields if present
        if (normalized.presaveUrl) existing.presaveUrl = normalized.presaveUrl
        if (normalized.description) existing.description = normalized.description
        if (normalized.releaseDate) existing.releaseDate = new Date(normalized.releaseDate).toISOString()
        continue
      }

      // Build album object for announce/preview entries
      const albumSlug = toSlug(normalized.title)
      const album = {
        title: normalized.title,
        releaseDate: new Date(normalized.releaseDate).toISOString(),
        upcoming: true,
        tier,
        slug: albumSlug,
        labelName: process.env.SITE_NAME || process.env.LABEL_NAME || null,
        artist: artist.name,
        url: null,
        privateUrl: null,
        imageUrl: null,
        tracks: [],
        tags: [],
        raw: null
      }

      // Add optional fields
      if (normalized.presaveUrl) album.presaveUrl = normalized.presaveUrl
      if (normalized.description) album.description = normalized.description

      artist.albums.push(album)

      // Content directory scaffolding (Task 2.2)
      const dirPath = path.join(contentDir, artistSlug, albumSlug)
      try {
        await fs.mkdir(dirPath, { recursive: true })
        console.log(`[upcoming] Created content/${artistSlug}/${albumSlug}/ — add artwork.jpg here for album artwork`)
      } catch (err) {
        console.warn(`[upcoming] Could not create directory ${dirPath}: ${err.message}`)
      }

      console.log(`  ✓ Upcoming (${tier}): "${normalized.title}" by ${artist.name}`)
      count++
    }
  }

  return count
}

/**
 * Loads full tier upcoming releases (with Bandcamp scraping).
 * Preserves current loadUpcoming behavior for full-tier entries.
 *
 * @param {string} contentDir - Path to content directory
 * @param {object} rawData - Raw site data (mutated in place)
 * @param {string} [artistFilter] - Optional artist name/slug filter
 * @returns {Promise<number>} Number of entries added
 */
async function loadUpcomingFull (contentDir, rawData, artistFilter) {
  let config
  try {
    const raw = await fs.readFile(path.join(contentDir, 'upcoming.json'), 'utf8')
    config = JSON.parse(raw)
  } catch {
    return 0 // no upcoming.json
  }

  let count = 0

  for (const [artistSlug, entries] of Object.entries(config)) {
    if (!Array.isArray(entries) || entries.length === 0) continue

    // Skip if artist filter is set and doesn't match
    if (artistFilter) {
      const filterNorm = norm(artistFilter)
      if (artistSlug !== toSlug(artistFilter) && norm(artistSlug) !== filterNorm) continue
    }

    // Find the artist in raw data
    const artist = (rawData.artists || []).find(a => {
      return toSlug(a.name) === artistSlug || norm(a.name) === norm(artistSlug)
    })
    if (!artist) {
      console.warn(`[upcoming] Artist "${artistSlug}" not found in cache — skipping`)
      continue
    }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      const result = classifyTier(entry)

      // Skip entries that classifyTier cannot classify (invalid)
      if (!result) {
        console.warn(`[upcoming] "${artistSlug}" entry ${i}: could not classify tier — skipping`)
        continue
      }

      const { tier, normalized } = result

      // Validate the normalized entry
      const warnings = validateEntry(normalized, artistSlug, i)
      for (const w of warnings) console.warn(w)

      // Skip entries with fatal validation issues (invalid date or invalid URL)
      const hasFatalWarning = warnings.some(w =>
        w.includes('is not a valid date') ||
        w.includes('does not look like a Bandcamp URL') ||
        w.includes('missing required field')
      )
      if (hasFatalWarning) continue

      // Skip announce/preview entries — those are handled by loadUpcomingLocal
      if (tier !== 'full') continue

      // Support both string format ("url") and object format ({ url, presaveUrl })
      const privateUrl = normalized.url
      const presaveUrl = normalized.presaveUrl || null
      if (!privateUrl) continue

      try {
        await new Promise(r => setTimeout(r, DELAY_MS))
        const info = await bandcamp.getAlbumInfo(privateUrl)
        if (!info || !info.title) continue

        const cur = info.raw && info.raw.current
        const releaseDate = cur && cur.release_date
          ? new Date(cur.release_date).toISOString()
          : null

        // Check if already in artist's albums (by title match)
        const titleNorm = norm(info.title)
        const existing = artist.albums.find(a => norm(a.title) === titleNorm)
        if (existing) {
          // Re-scrape / tier upgrade: merge Bandcamp metadata into existing album
          existing.tier = 'full'
          existing.presaveUrl = presaveUrl
          existing.privateUrl = privateUrl
          if (info.raw) existing.raw = info.raw
          if (info.tracks && info.tracks.length > 0) existing.tracks = info.tracks
          if (info.tags && info.tags.length > 0) existing.tags = info.tags
          if (info.imageUrl) existing.imageUrl = info.imageUrl
          if (releaseDate) existing.releaseDate = releaseDate
          // Set default label if not yet assigned
          if (!existing.labelName && existing.upcoming) {
            existing.labelName = process.env.SITE_NAME || process.env.LABEL_NAME || null
          }
          if (existing.upcoming) {
            console.log(`  ✓ Upcoming "${info.title}" re-scraped from private link`)
          }
          continue
        }

        const defaultLabel = process.env.SITE_NAME || process.env.LABEL_NAME || null
        const albumSlug = toSlug(info.title)

        artist.albums.push({
          url: null, // no public URL yet
          privateUrl,
          presaveUrl,
          title: info.title,
          artist: info.artist,
          imageUrl: info.imageUrl,
          tracks: info.tracks || [],
          tags: info.tags || [],
          raw: info.raw,
          releaseDate,
          labelName: defaultLabel,
          slug: albumSlug,
          upcoming: true,
          tier: 'full'
        })

        // Content directory scaffolding for new full-tier albums
        const dirPath = path.join(contentDir, artistSlug, albumSlug)
        try {
          await fs.mkdir(dirPath, { recursive: true })
          console.log(`[upcoming] Created content/${artistSlug}/${albumSlug}/ — add artwork.jpg here for album artwork`)
        } catch (mkdirErr) {
          console.warn(`[upcoming] Could not create directory ${dirPath}: ${mkdirErr.message}`)
        }

        console.log(`  ✓ Upcoming: "${info.title}" by ${info.artist} (${releaseDate || 'no date'})`)
        count++
      } catch (err) {
        console.warn(`  ⚠ Could not fetch upcoming release ${privateUrl}: ${err.message}`)
      }
    }
  }

  return count
}

/**
 * Applies presaveUrl from upcoming.json to existing albums in the cache.
 * Runs on every generate (no scraping). Only updates presaveUrl for albums
 * that already exist in the cache by title match.
 *
 * @param {string} contentDir - Path to content directory
 * @param {object} rawData - Raw site data (mutated in place)
 * @returns {Promise<number>} Number of presaveUrls applied
 */
async function applyPresaveUrls (contentDir, rawData) {
  let config
  try {
    const raw = await fs.readFile(path.join(contentDir, 'upcoming.json'), 'utf8')
    config = JSON.parse(raw)
  } catch {
    return 0
  }

  let count = 0
  for (const [artistSlug, entries] of Object.entries(config)) {
    if (!Array.isArray(entries) || entries.length === 0) continue
    const artist = (rawData.artists || []).find(a => {
      return toSlug(a.name) === artistSlug || norm(a.name) === norm(artistSlug)
    })
    if (!artist) continue

    for (const entry of entries) {
      if (!entry || typeof entry === 'string') continue
      if (!entry.presaveUrl) continue

      // Match by URL or title
      let existing = null
      if (entry.url) {
        existing = artist.albums.find(a => a.url && a.url === entry.url)
        if (!existing) {
          // Try title match via scraping the URL — but we don't scrape here.
          // Instead match by normalized URL slug
          const urlSlug = entry.url.replace(/.*\/(album|track)\//, '').replace(/[-/]/g, '')
          existing = artist.albums.find(a => a.slug && a.slug.replace(/-/g, '') === urlSlug)
        }
      }
      if (!existing && entry.title) {
        const titleNorm = norm(entry.title)
        existing = artist.albums.find(a => norm(a.title) === titleNorm)
      }

      if (existing && existing.presaveUrl !== entry.presaveUrl) {
        existing.presaveUrl = entry.presaveUrl
        count++
      }
    }
  }
  return count
}

// Backward-compatible alias
const loadUpcoming = loadUpcomingFull

module.exports = { loadUpcoming, loadUpcomingFull, loadUpcomingLocal, applyPresaveUrls, classifyTier, validateEntry }
